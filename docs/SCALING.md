# Scaling & architecture notes

This document is for reviewers and for anyone pushing the toolkit past the demo
domains toward IPC-scale benchmarks or a research deployment.

## Where time goes
PDR's runtime is dominated by the underlying SAT solver — the thesis measures
*SAT time* for exactly this reason, and so does this toolkit (`stats["sat_time"]`,
`stats["sat_calls"]`). Everything else (queue management, layer bookkeeping,
reason minimisation control flow) is cheap by comparison.

Consequences for scaling:
- **The SAT backend is the lever.** `sat.py` is a thin abstraction (`new_var`,
  `add_clause`, `solve(assumptions)`, `model`), and `python-sat` already bundles
  every serious engine (CaDiCaL 1.x–3.0, Lingeling, Glucose, Kissat, MergeSat).
  Picking the right one is a one-line change (`set_pysat_solver(name)`); the rest
  of the toolkit is untouched.
- **The default fast engine is Lingeling — chosen by benchmark, not reputation**
  (`scripts/bench_backends.py`). PDR fires *many small assumption-based
  incremental* SAT calls, so the engine that scales hardest here is the one whose
  heavier inprocessing reduces the *number* of PDR iterations, not the one with
  the best one-shot competition score. On a real IPC logistics-10-0, Lingeling
  was ~1.5× faster (13.8s) and used ~half the SAT calls (6.7k vs 12–14k) of
  minisat/glucose/cadical; it was also the most efficient on the harder -15.
  (Kissat is excluded: it doesn't support assumptions, so it returns *wrong*
  answers on this incremental workload — a good reminder to verify, not assume.)
- **SAT-call counts are ENGINE-RELATIVE — so the fitness engine is pinned.** A
  stronger solver can reorder which operator looks best (under Lingeling, the
  evolved look-ahead's edge over fixed PDR-M shrinks, because better learning
  makes the heuristic matter less). Operator *fitness* (`evolve.py`) is therefore
  always measured under one pinned engine (`FITNESS_ENGINE = "minisat22"`),
  decoupled from the fast *solving* default — so evolution stays reproducible
  while solving stays fast. This is itself a finding worth stating in a paper:
  self-improvement results are relative to the underlying engine.
- **Where the wall actually is.** Even with the best engine, `logistics-15`
  (~2250 ground actions, scattered goals) exceeds 200s — the bottleneck there is
  the *encoding/search*, not the engine. The next wins are algorithmic: a
  reachability/landmark-pruned grounder, the thesis's ∃-step encoding, and
  Madagascar-style preprocessing (the thesis got much further than this pipeline
  precisely because of those, on top of Lingeling).

## Architectural seams (extension points)
- **SAT backend** — `sat.make_solver()`; add a class implementing the 5-method
  interface.
- **Domains** — `domains.py`; parametric STRIPS/FOND generators. PDDL ingestion
  would slot in here (parse → `Problem` / `FONDProblem`).
- **Search operators** — `operators.py`; the obligation / reason / progression
  seams are soundness-preserving (see below). New seams (e.g. clause-push order,
  FOND sink-removal order) follow the same pattern.
- **Self-improvement** — `evolve.py` (operator evolution), `selfimprove.py`
  (portfolio), `selfauthor.py` (features/curriculum), `transfer.py` (reason
  reuse). Each consumes the same verifiable harness.

## Soundness is structural, not incidental
Every PDR variant here is sound and complete, and **every result is independently
validated**: `validate_plan` replays classical plans against the concrete model;
`validate_policy` checks FOND policies are genuinely strong-cyclic; the FOND SAT
encoding is cross-checked against an enumeration oracle; `reference_answer` gives
explicit-search ground truth.

The self-improvement layers cannot compromise this:
- the evolvable seams only reorder *already-valid* choices (tie-breaking within
  minimal-layer obligations; literal order in reason minimisation; per-obligation
  look-ahead depth under PDR-M semantics) — a bad operator can be slower, never
  wrong;
- transferred reasons are re-verified by SAT on the target before use;
- so the fitness gate **cannot be cheated** — an incorrect "improvement" fails
  validation and is discarded. This is what makes an unattended evolutionary /
  LLM-in-the-loop loop safe.

## Memory
Layers are stored as full clause sets per index for clarity. The thesis stores
only the *delta* between adjacent layers (since `L_i ⊆ L_{i-1}`); switching to
delta storage is a localised change in `pdr.py`/`fond.py` and is the main memory
optimisation for large horizons.

## Parallelism
- **PS-PDR** (`parallel.py`) processes a batch of obligations per round; the
  thread backend gets real parallelism because the C SAT solver releases the GIL.
  For true multi-core scaling, a process-pool / MPI orchestrator replaces the
  thread pool with no change to the merge logic.
- **PD-PDR** (`decomp.py`) solves independent sub-problems concurrently; the
  thesis reports simulated-core runtimes because sub-problem counts can be large.
- **Operator evaluation** in `evolve.py` is embarrassingly parallel across
  (operator × instance) and is the natural place to add a pool for large sweeps.

## Reproducibility
- All randomised components take an explicit `seed`.
- Fitness is deterministic (SAT-call counts).
- `scripts/reproduce.py` regenerates every headline number in one run.
- CI runs the full suite on Python 3.9/3.11/3.12 **and** re-runs it after
  uninstalling `python-sat` to guarantee the zero-dependency path stays correct.

## Honest limitations
- Demo instances are small; absolute speedups (e.g. the large L2/L3 factors) are
  inflated by single-SAT-call effects on tiny problems. The **held-out** numbers
  (≈4.3× over baseline, ≈1.28× over fixed PDR-M for the evolved look-ahead) are
  the defensible ones.
- Verified reason transfer is sound but ≈neutral on these plan-rich benchmarks
  (few reasons are derived); its payoff is expected on dead-end-heavy / larger
  instances.
- No PDDL front-end yet; domains are generated programmatically.
- The pure-Python SAT solver is for portability and testing, not performance;
  use `python-sat` (or an IPASIR solver) for any real scaling.
