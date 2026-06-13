"""
A tiny SAT-solver abstraction used by the PDR planner.

The whole thesis is built "on top of a SAT solver": every question PDR asks
("can this state step closer to the goal?") is turned into a little SAT problem
and handed to a solver. So everything here funnels through one small interface:

    s = make_solver()
    a = s.new_var(); b = s.new_var()
    s.add_clause([a, b])          # (a OR b)
    s.add_clause([-a])            # (NOT a)
    if s.solve():                 # optionally solve(assumptions=[...])
        print(s.model())          # set of TRUE signed literals

Two backends are provided:

* PySatSolver  - wraps `python-sat` (a fast C solver). Used automatically if
                 the `pysat` package is importable.
* DpllSolver   - a small, dependency-free DPLL solver in pure Python. Slower,
                 but means the project runs on any laptop with just Python.

`make_solver()` picks the fast one if available, else the pure-Python one.
Both support *assumptions*: temporary unit facts that hold for a single solve
call. PDR leans on this heavily -- the transition rules stay loaded in the
solver and only the "starting state" changes between calls (see encoding.py).
"""

from __future__ import annotations

import sys

try:  # pragma: no cover - exercised by whichever backend exists
    from pysat.solvers import Solver as _PySolver  # type: ignore

    _HAVE_PYSAT = True
except Exception:  # pragma: no cover
    _HAVE_PYSAT = False

# The CDCL engine the fast backend uses. Chosen by BENCHMARK on this PDR workload
# (many small assumption-based incremental re-solves) on real IPC logistics, not
# by reputation: Lingeling won — ~1.5x faster and ~half the SAT calls of
# minisat/glucose/cadical on logistics-10-0, and the most efficient on the harder
# -15. Its heavier inprocessing makes each solve more informative, so PDR needs
# fewer iterations overall (it's also the engine the thesis used). Override for
# any pysat engine via set_pysat_solver("cadical195" / "glucose42" / …).
_PYSAT_NAME = "lingeling"


def set_pysat_solver(name: str) -> None:
    global _PYSAT_NAME
    _PYSAT_NAME = name


def pysat_solver_name() -> str:
    return _PYSAT_NAME


class _BaseSolver:
    backend = "base"

    def new_var(self) -> int:
        raise NotImplementedError

    def add_clause(self, lits) -> None:
        raise NotImplementedError

    def solve(self, assumptions=()) -> bool:
        raise NotImplementedError

    def model(self):
        """Set of signed literals that are TRUE in the last satisfying model."""
        raise NotImplementedError

    def value(self, var: int) -> bool:
        return var in self.model()


class PySatSolver(_BaseSolver):
    backend = "pysat"

    def __init__(self, name=None):
        self.backend = name or _PYSAT_NAME      # report the engine in stats
        self._s = _PySolver(name=name or _PYSAT_NAME)
        self._nvars = 0
        self._model = set()

    def new_var(self) -> int:
        self._nvars += 1
        return self._nvars

    def add_clause(self, lits) -> None:
        self._s.add_clause(list(lits))

    def solve(self, assumptions=()) -> bool:
        ok = self._s.solve(assumptions=list(assumptions))
        if ok:
            self._model = set(self._s.get_model())
        else:
            self._model = set()
        return ok

    def model(self):
        return self._model

    def delete(self):
        try:
            self._s.delete()
        except Exception:
            pass


class DpllSolver(_BaseSolver):
    """A compact, correct DPLL solver with watched literals and assumptions.

    No clause learning -- it is meant to be readable and dependency-free, not to
    win competitions. It is plenty fast for the small transition problems PDR
    generates on the demo domains.
    """

    backend = "dpll"

    def __init__(self):
        self.nvars = 0
        self.clauses = []          # list[list[int]]
        self._model = set()

    def new_var(self) -> int:
        self.nvars += 1
        return self.nvars

    def add_clause(self, lits) -> None:
        # De-duplicate; drop tautological clauses (x and -x both present).
        seen = set()
        out = []
        for l in lits:
            if -l in seen:
                return  # tautology, always satisfied
            if l not in seen:
                seen.add(l)
                out.append(l)
        self.clauses.append(out)

    def solve(self, assumptions=()) -> bool:
        nv = self.nvars
        # value[v] in {0 unknown, 1 true, -1 false}
        value = [0] * (nv + 1)

        # Two-watched-literal scheme, rebuilt fresh per solve call (simple +
        # correct; the demo problems are small enough that this is fine).
        watches = [[] for _ in range(2 * nv + 2)]

        def widx(lit):
            return 2 * abs(lit) + (0 if lit > 0 else 1)

        units = []
        for ci, cl in enumerate(self.clauses):
            if len(cl) == 0:
                return self._fail()
            if len(cl) == 1:
                units.append(cl[0])
                continue
            watches[widx(cl[0])].append(ci)
            watches[widx(cl[1])].append(ci)

        trail = []

        def assign(lit):
            value[abs(lit)] = 1 if lit > 0 else -1
            trail.append(lit)

        def lit_true(lit):
            v = value[abs(lit)]
            return v == (1 if lit > 0 else -1)

        def lit_false(lit):
            v = value[abs(lit)]
            return v == (-1 if lit > 0 else 1)

        def propagate(start):
            qi = start
            while qi < len(trail):
                p = trail[qi]
                qi += 1
                wl = watches[widx(-p)]
                i = 0
                while i < len(wl):
                    ci = wl[i]
                    cl = self.clauses[ci]
                    # Ensure cl[1] is the falsified watch.
                    if cl[0] == -p:
                        cl[0], cl[1] = cl[1], cl[0]
                    if lit_true(cl[0]):
                        i += 1
                        continue
                    # Find a new literal to watch.
                    found = False
                    for k in range(2, len(cl)):
                        if not lit_false(cl[k]):
                            cl[1], cl[k] = cl[k], cl[1]
                            watches[widx(cl[1])].append(ci)
                            wl[i] = wl[-1]
                            wl.pop()
                            found = True
                            break
                    if found:
                        continue
                    # No new watch: clause is unit or conflicting on cl[0].
                    if lit_false(cl[0]):
                        return False  # conflict
                    assign(cl[0])
                    i += 1
            return True

        # Seed with unit clauses and assumptions.
        base = list(units) + list(assumptions)
        for lit in base:
            if lit_false(lit):
                return self._fail()
            if value[abs(lit)] == 0:
                assign(lit)
        if not propagate(0):
            return self._fail()

        # Iterative decisions with chronological backtracking.
        # decisions: list of (trail_len_before_decision, decision_lit, flipped)
        decisions = []

        def next_unassigned():
            for v in range(1, nv + 1):
                if value[v] == 0:
                    return v
            return 0

        while True:
            v = next_unassigned()
            if v == 0:
                return self._succeed(value)
            qstart = len(trail)
            decisions.append([len(trail), v, False])
            assign(v)
            while not propagate(qstart):
                # Backtrack to the most recent flippable decision.
                ok = False
                while decisions:
                    tlen, dlit, flipped = decisions[-1]
                    # undo down to tlen
                    while len(trail) > tlen:
                        value[abs(trail.pop())] = 0
                    if not flipped:
                        decisions[-1][2] = True
                        qstart = len(trail)
                        assign(-dlit)
                        ok = True
                        break
                    else:
                        decisions.pop()
                if not ok:
                    return self._fail()

    def _fail(self):
        self._model = set()
        return False

    def _succeed(self, value):
        m = set()
        for v in range(1, self.nvars + 1):
            m.add(v if value[v] >= 0 else -v)  # default unknowns to True
        self._model = m
        return True

    def model(self):
        return self._model


def make_solver(prefer_pysat: bool = True) -> _BaseSolver:
    """Return the fastest available solver instance."""
    if prefer_pysat and _HAVE_PYSAT:
        return PySatSolver()
    return DpllSolver()


def have_pysat() -> bool:
    return _HAVE_PYSAT


if __name__ == "__main__":  # tiny smoke test
    sys.setrecursionlimit(100000)
    for S in ([PySatSolver] if _HAVE_PYSAT else []) + [DpllSolver]:
        s = S()
        a, b, c = s.new_var(), s.new_var(), s.new_var()
        s.add_clause([a, b])
        s.add_clause([-a, c])
        s.add_clause([-b, c])
        assert s.solve(), S
        assert s.solve(assumptions=[-c]) is False, S  # forces a=b=false vs a|b
        print(f"{s.backend}: OK")
