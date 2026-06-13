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
  `add_clause`, `solve(assumptions)`, `model`). Swapping the pure-Python DPLL or
  `python-sat` for an industrial incremental solver (Lingeling/CaDiCaL via
  IPASIR, as the thesis uses) is a one-class change and is the single biggest
  scaling win. Nothing else in the toolkit needs to change.
- **Fitness uses SAT *calls*, not wall time** (see `evolve.py`). This is
  deterministic and solver-independent, so operator-evolution results transfer
  across backends and machines — important for reproducible peer review.

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
