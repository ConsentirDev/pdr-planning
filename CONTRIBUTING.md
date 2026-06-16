# Contributing

Thanks for your interest. This project values **correctness above all** — the
whole point is a planner whose every output is independently verified.

## Ground rules
1. **Never weaken a validator.** `validate_plan`, `validate_policy`,
   `reference_answer`, and the FOND encoding cross-check are the project's
   backbone. New features must keep them green.
2. **New search heuristics go through a seam, not a hack.** If you want the
   planner to behave differently for speed, add/extend a *soundness-preserving*
   seam (see `operators.py` and `docs/SCALING.md`) so that a bad heuristic can
   only be slower, never wrong.
3. **Determinism.** Randomised code takes an explicit `seed`. Use SAT-call counts
   (engine-pinned) as the reproducible fitness; wall-clock is recorded as a
   *secondary* metric — report it for any performance claim, since fewer SAT calls
   need not mean faster (see `pdr/RSI.md` and `pdr/experiments.py`).
4. **Numbers come from runs, not hope.** Any empirical claim should be reproducible
   via `pdr.experiments` (or `scripts/reproduce.py`), and negative/null results are
   reported, not buried — that honesty is the project's credibility.

## Workflow
```bash
pip install -e ".[sat,dev]"
python -m pdr.tests            # full correctness suite (also runs in CI)
ruff check pdr                 # style
python scripts/reproduce.py    # regenerate the thesis headline numbers
python -m pdr.experiments all  # regenerate the self-improvement / scaling numbers
```
Add a test for any new behaviour. CI runs the suite on Python 3.9/3.11/3.12 and
re-runs it with `python-sat` uninstalled to protect the zero-dependency path.

## Good first contributions
These map to the open gaps in `docs/SCALING.md` and `pdr/RSI.md`:
- **Parallelise operator evaluation** in `evolve.py` (`ProcessPoolExecutor` over the
  embarrassingly-parallel operator×instance grid) — the highest-value scaling change.
- **Full ADL in the PDDL front-end** (`pddl.py` is `:strips`/`:typing`/`oneof` today;
  conditional effects / quantifiers / derived predicates would unlock more IPC domains).
- **A real selector benchmark** — wire the L1 learner to ASlib / AutoFolio with proper
  CV (the demo pool is too narrow to evaluate selection; the RF+CV harness is ready).
- A new evolvable seam (clause-push order; FOND sink-removal order).
- Delta-encoded layer storage in `pdr.py` / `fond.py` (memory).

A PDDL front-end and a fast SAT backend (Lingeling via `python-sat`) already exist.
