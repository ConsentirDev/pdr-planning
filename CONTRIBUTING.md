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
3. **Determinism.** Randomised code takes an explicit `seed`. Prefer SAT-call
   counts over wall time for fitness so results reproduce across machines.

## Workflow
```bash
pip install -e ".[sat,dev]"
python -m pdr.tests            # full correctness suite (also runs in CI)
ruff check pdr                 # style
python scripts/reproduce.py    # regenerate headline numbers
```
Add a test for any new behaviour. CI runs the suite on Python 3.9/3.11/3.12 and
re-runs it with `python-sat` uninstalled to protect the zero-dependency path.

## Good first contributions
- A PDDL front-end that emits `Problem` / `FONDProblem`.
- An IPASIR SAT backend in `sat.py` (the biggest scaling win).
- A new evolvable seam (clause-push order; FOND sink-removal order).
- Delta-encoded layer storage in `pdr.py` / `fond.py` (memory).
