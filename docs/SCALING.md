# Scaling & architecture notes

This document is for reviewers and for anyone pushing the toolkit past the demo
domains toward IPC-scale benchmarks or a research deployment. It reflects the
current reality: a real PDDL front-end, a fast SAT backend, a live cloud
deployment, and a reproducible empirical harness (`pdr.experiments`) — plus an
honest account of what still doesn't scale and the concrete plan to attack it.

## Where time goes
PDR's runtime is dominated by the underlying SAT solver — the thesis measures
*SAT time* for exactly this reason, and so does this toolkit (`stats["sat_time"]`,
`stats["sat_calls"]`). Everything else (queue management, layer bookkeeping,
reason minimisation control flow) is cheap by comparison.

- **The SAT backend is the lever.** `sat.py` is a thin abstraction (`new_var`,
  `add_clause`, `solve(assumptions)`, `model`), and `python-sat` bundles every
  serious engine (CaDiCaL 1.x–3.0, Lingeling, Glucose, Kissat, MergeSat). Picking
  one is a one-line change (`set_pysat_solver(name)`).
- **The default fast engine is Lingeling — chosen by benchmark** (`scripts/bench_backends.py`).
  PDR fires *many small assumption-based incremental* SAT calls, so what scales
  hardest is the engine whose inprocessing cuts the *number* of PDR iterations.
  On real IPC `logistics-10-0` Lingeling was ~1.5× faster and used ~half the SAT
  calls of minisat/glucose/cadical. (Kissat is excluded: no assumptions support →
  wrong answers on this incremental workload — verify, don't assume.)
- **SAT-call counts are ENGINE-RELATIVE, so the fitness engine is pinned.** A
  stronger solver reorders which operator looks best, so operator *fitness*
  (`evolve.py`, `pdr.experiments`) is always measured under one pinned engine
  (`FITNESS_ENGINE = "minisat22"`), decoupled from the fast *solving* default.
  Evolution stays reproducible; solving stays fast. This is itself a paper-worthy
  finding: self-improvement results are relative to the underlying engine.

## What is tractable today (measured, not guessed)
Run `python3 -m pdr.experiments ipc`; it auto-downloads a small **real IPC** subset
(Fast Downward benchmarks). Current single-machine reality (PDR-M `F=3`, Lingeling,
~12 s/instance cap):

| real IPC instance | ground actions | result |
|---|---:|---|
| gripper prob01–04 | 36–84 | solve (0–4 s) |
| miconic s1-*, movie | 4–32 | solve (<0.1 s) |
| `logistics-10-0` | 1040 | solves in ~27 s (times out under `F=1`) |
| blocks-10/11, logistics-11 | 220–1040 | **time out at 12 s** |

So the loop runs end-to-end on small real IPC domains; the **bigger real instances
(blocks-10, logistics-10/15) are the wall.** `logistics-15` (~2250 actions) exceeds
200 s on every engine — there the bottleneck is the *encoding/search*, not the
solver. The next algorithmic wins (the thesis's, which is why it went further):
reachability/landmark-pruned grounding, the ∃-step encoding, Madagascar-style
preprocessing.

## SAT-calls ≠ wall-clock (important for any scaling claim)
A reduction in SAT calls does **not** imply a runtime win — an operator can issue
*fewer but harder* calls. Measured on the real IPC subset (`pdr.experiments ipc`,
minisat22-pinned): the evolved look-ahead cuts SAT-calls **4.5×** (21122 → 4707)
yet wall-clock is a **tie** (1393 vs 1433 ms). So SAT-calls is the *reproducible*
fitness proxy, but **report wall-clock for any performance claim**. The toolkit now
records per-instance wall-clock everywhere, exposes a SAT-calls/wall-clock toggle in
the in-app bench, and `evolutionary_search(rank_by="wall")` can optimise time
directly (noisier). Full empirical write-up + negatives: `pdr/RSI.md`.

## Architectural seams (extension points)
- **SAT backend** — `sat.make_solver()`; implement the 5-method interface.
- **PDDL front-end — done.** `pddl.py` parses + grounds `:strips`/`:typing`/
  `:negative-preconditions`/`:equality`/`oneof`, with static-predicate analysis so a
  real predicate-typed IPC domain grounds in milliseconds (logistics-10-0: ~700k
  candidate bindings → 1040 actions in ~7 ms). It does **not** yet handle full ADL
  (conditional effects, quantifiers, derived predicates) — that excludes some IPC
  domains (Trucks-ADL, Openstacks-ADL, several FOND domains).
- **Domains** — `domains.py` (parametric STRIPS/FOND) + `pddl.py` (real files).
- **Search operators** — `operators.py`; the obligation / reason / progression
  seams are soundness-preserving (below). New seams (clause-push order, FOND
  sink-removal order) follow the same pattern.
- **Self-improvement** — `evolve.py` (operator evolution), `selfimprove.py`
  (portfolio), `selfauthor.py` (features/curriculum), `transfer.py` (reason reuse).
- **Empirical harness** — `experiments.py`; reproducible runs behind every number
  in `RSI.md` (selector CV, multi-seed CIs, real-IPC generalisation, metric agreement).

## Soundness is structural, not incidental
Every PDR variant here is sound and complete, and **every result is independently
validated**: `validate_plan` replays classical plans; `validate_policy` checks FOND
policies are genuinely strong-cyclic; the FOND SAT encoding is cross-checked against
an enumeration oracle; `reference_answer` gives explicit-search ground truth.

The self-improvement layer cannot compromise this: the evolvable seams only reorder
*already-valid* choices (tie-breaking within minimal-layer obligations; literal
order in reason minimisation; per-obligation look-ahead under PDR-M semantics — see
the soundness lemma in `RSI.md`); transferred reasons are re-verified by SAT before
use. So a bad operator can be **slower, never wrong**, and an unattended evolution /
LLM-in-the-loop loop is safe. (Caveat: this guarantees *soundness* on every instance
an operator runs on — *fitness generalisation* is a separate matter, enforced by
held-out validation, which `RSI.md` shows is necessary and not automatic.)

## Deployment: the live stack
- **Backend** — `Dockerfile` + `fly.toml`; deployed on Fly.io
  (`pdr-visualized.fly.dev`), Lingeling engine, **performance-2x (2 vCPU / 4 GB)**,
  scale-to-zero. Endpoints: `/run`, `/run-stream` (SSE per-generation progress for
  the slow evolution runs), `/health`; token-gated, CORS-locked.
- **Frontend** — Vite/React on Vercel (`watch-it-think.vercel.app`); runs the real
  planner in-browser via Pyodide, or routes to the backend when present.
- **Reproducing experiments at the backend tier** — `python3 -m pdr.experiments all`
  inside the container (or any machine with `python-sat`) reproduces the RSI numbers.

## Plan for scaled testing (Fly, bigger instances)
The single remaining gap is **scale**: the evolution loop has only run on small real
IPC instances; the bigger ones time out on the current 2-vCPU box. The concrete plan
to close it, in order of leverage:

1. **Bigger VM for a testing session.** `fly scale vm performance-8x` (8 vCPU /
   16 GB) — or a one-off `fly machine run` — then raise the per-instance
   `time_limit`/`k_cap` and re-run `pdr.experiments ipc` with the larger instances
   included (blocks-10, logistics-10-0/11). Scale back to `performance-2x` (or
   scale-to-zero) afterward so idle cost stays near nothing. The SSE stream already
   surfaces progress on minutes-long runs.
2. **Parallelise operator evaluation.** The `(operator × instance)` grid in
   `evolve.py` is embarrassingly parallel; a `ProcessPoolExecutor` over a
   generation's population gives ~Nx throughput on an 8-vCPU box — turning
   evolution-on-real-IPC from hours into minutes. This is the highest-value code
   change and touches only the evaluation loop (the merge/archive logic is
   unchanged). PS-PDR (`parallel.py`) already releases the GIL via the C solver, so
   process-pool scaling is a natural fit.
3. **Run the IPC subset Ava uses, multi-seed, with CIs.** `experiments.load_ipc`
   already pulls real strips-typed IPC domains; extend it to the `:strips` subset of
   her evaluation set (logistics, gripper, blocks, miconic, movie, …), run
   multi-seed evolution + per-instance selection, and report per-domain coverage and
   runtime tables with confidence intervals. **This is the experiment that would let
   us drop the "prototype" caveat** in `RSI.md`.
4. **Report wall-clock as a co-primary at scale.** With a bigger box, repeat each
   timing K× and report median wall-clock + CI alongside SAT-calls — so the
   "fewer-but-harder calls" effect is quantified on real instances, not just flagged.

**Honest ceiling:** a bigger Fly VM closes the *evolution-on-medium-IPC* gap, not the
hardest-instance gap. `logistics-15`-class instances need the algorithmic upgrades
above (∃-step encoding, landmark-pruned grounding) before any amount of compute helps
— more cores make a slow encoding finish, they don't make it fast.

## Memory
Layers are stored as full clause sets per index for clarity. The thesis stores only
the *delta* between adjacent layers (`L_i ⊆ L_{i-1}`); switching to delta storage is a
localised change in `pdr.py`/`fond.py` and is the main memory optimisation for large
horizons.

## Parallelism
- **PS-PDR** (`parallel.py`) processes a batch of obligations per round; the thread
  backend gets real parallelism because the C SAT solver releases the GIL. For
  multi-core scaling, a process-pool / MPI orchestrator replaces the thread pool with
  no change to the merge logic.
- **PD-PDR** (`decomp.py`) solves independent sub-problems concurrently.
- **Operator evaluation** in `evolve.py` is embarrassingly parallel across
  (operator × instance) — the natural place to add a pool for large sweeps (see plan #2).

## Reproducibility
- All randomised components take an explicit `seed`.
- Fitness is deterministic (SAT-call counts under the pinned `minisat22`); wall-clock
  is recorded as a secondary, noisy metric.
- `scripts/reproduce.py` regenerates the headline thesis numbers; `pdr.experiments`
  regenerates the self-improvement / scaling numbers (engine-pinned, CIs, negatives).
- CI runs the full suite on Python 3.9/3.11/3.12 **and** re-runs it after uninstalling
  `python-sat` to guarantee the zero-dependency path stays correct.

## Honest limitations
- Demo instances are small; absolute speed-ups are inflated by single-SAT-call effects
  on tiny problems. The defensible numbers are the **held-out, engine-pinned** ones in
  `RSI.md` — and even those are *SAT-call* reductions, which (see above) need not be
  wall-clock wins.
- Self-improvement wins are currently driven by **curated seed operators**, not live
  mutation (multi-seed runs show a zero-width CI on the same champion). Genuine live
  discovery needs a larger LLM budget or harder instances.
- The L1 selector is nearest-neighbour; on the narrow demo pool it (and a random
  forest with CV) tie the oracle, so the low regret says nothing about the learner — a
  real ASlib/AutoFolio benchmark is needed.
- Verified reason transfer is sound but ≈neutral on these plan-rich benchmarks; payoff
  is expected on dead-end-heavy / larger instances.
- The PDDL front-end is `:strips`/`:typing`/`oneof` only — no full ADL yet.
- The pure-Python SAT solver is for portability/testing, not performance; use
  `python-sat` (or an IPASIR solver) for any real scaling.
