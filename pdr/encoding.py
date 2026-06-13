"""
The forall-step SAT encoding (Section 2.4 of the thesis) and the query builder
PDR uses to ask "can state s step toward the goal?".

We translate a *bounded* planning problem into SAT. SAT variables come in two
kinds, each tagged with a time-step t:

    prop(p, t)    -- is fact p true at time-step t?
    act(a, t)     -- is action a executed during the transition t -> t+1?

The transition formula T (one copy per transition t -> t+1) is built from the
five schemas in the thesis:

    Schema 1  action implies precondition   (a@t  -> pre@t)
    Schema 2  action implies effect         (a@t  -> eff@t+1)
    Schema 3  frame axioms                   (a fact only changes if some action
                                              that causes the change is taken)
    Schema 4  interfering actions are mutex  (forall-step: actions in one step
                                              must be reorderable)
    Schema 5  state mutex invariants         (helper constraints, e.g. a package
                                              is in at most one place)

PDR never unrolls T over the whole horizon (that is the *monolithic* SAT
planning it is contrasted against). Instead it builds a *small* formula -- just
one (or, for the Chapter 3 variants, a few) transition copies -- and re-asks it
with different starting states.
"""

from __future__ import annotations

from .planning import Problem, conflict, interfere


class Query:
    """A freshly-built SAT formula for one PDR question.

    Owns its own solver, variable maps, and the transition copies for steps
    0..n_steps. Layer clauses and the starting-state assumptions are added on
    top, then `solve()` is called.
    """

    def __init__(self, problem: Problem, solver, n_steps: int):
        self.p = problem
        self.s = solver
        self.n_steps = n_steps
        self._pvar = {}
        self._avar = {}
        # Pre-compute interfering/conflicting action pairs (Schema 4).
        self._mutex_pairs = _mutex_pairs(problem)
        for t in range(n_steps):
            self._add_transition(t)
        for t in range(n_steps + 1):
            self._add_invariants(t)

    # -- variable allocation -------------------------------------------------
    def pvar(self, prop_id: int, t: int) -> int:
        key = (prop_id, t)
        v = self._pvar.get(key)
        if v is None:
            v = self.s.new_var()
            self._pvar[key] = v
        return v

    def avar(self, a_idx: int, t: int) -> int:
        key = (a_idx, t)
        v = self._avar.get(key)
        if v is None:
            v = self.s.new_var()
            self._avar[key] = v
        return v

    def plit(self, abstract_lit: int, t: int) -> int:
        """Map an abstract literal (+/- prop_id) to a signed SAT variable @t."""
        var = self.pvar(abs(abstract_lit), t)
        return var if abstract_lit > 0 else -var

    # -- the transition formula ---------------------------------------------
    def _add_transition(self, t: int) -> None:
        p = self.p
        for ai, a in enumerate(p.actions):
            av = self.avar(ai, t)
            # Schema 1: a@t -> pre@t
            for n, val in a.pre.items():
                self.s.add_clause([-av, self.plit(p.lit(n, val), t)])
            # Schema 2: a@t -> eff@t+1
            for n, val in a.eff.items():
                self.s.add_clause([-av, self.plit(p.lit(n, val), t + 1)])

        # Schema 3: frame axioms for every proposition.
        adders = {pid: [] for pid in range(1, len(p.props) + 1)}   # actions making p TRUE
        deleters = {pid: [] for pid in range(1, len(p.props) + 1)}  # ... making p FALSE
        for ai, a in enumerate(p.actions):
            for n, val in a.eff.items():
                pid = p.prop_id[n]
                (adders if val else deleters)[pid].append(ai)
        for pid in range(1, len(p.props) + 1):
            p_t = self.pvar(pid, t)
            p_t1 = self.pvar(pid, t + 1)
            # p@t+1 -> p@t OR (some adder fired)
            self.s.add_clause([-p_t1, p_t] + [self.avar(ai, t) for ai in adders[pid]])
            # ¬p@t+1 -> ¬p@t OR (some deleter fired)
            self.s.add_clause([p_t1, -p_t] + [self.avar(ai, t) for ai in deleters[pid]])

        # Schema 4: interfering/conflicting actions cannot share a step.
        for ai, bi in self._mutex_pairs:
            self.s.add_clause([-self.avar(ai, t), -self.avar(bi, t)])

    def _add_invariants(self, t: int) -> None:
        for clause in self.p.invariants:
            self.s.add_clause([self.plit(l, t) for l in clause])

    # -- layers and states ---------------------------------------------------
    def add_layer(self, layer_clauses, t: int) -> None:
        """Add a layer formula (set of clauses over abstract literals) at @t."""
        for clause in layer_clauses:
            self.s.add_clause([self.plit(l, t) for l in clause])

    def assumptions_for(self, cube, t: int):
        """Assumptions pinning a state/cube at time-step t."""
        return [self.plit(l, t) for l in cube]

    # -- solving / model extraction -----------------------------------------
    def solve(self, cube, t_state: int = 0) -> bool:
        return self.s.solve(self.assumptions_for(cube, t_state))

    def extract_state(self, t: int):
        """Full state (frozenset of abstract literals) read off time-step t."""
        model = self.s.model()
        out = []
        for pid in range(1, len(self.p.props) + 1):
            v = self.pvar(pid, t)
            out.append(pid if v in model else -pid)
        return frozenset(out)

    def extract_actions(self, t: int):
        """Indices of actions executed during transition t -> t+1."""
        model = self.s.model()
        return frozenset(ai for ai in range(len(self.p.actions))
                         if self._avar.get((ai, t)) in model)


def _mutex_pairs(problem: Problem):
    pairs = []
    acts = problem.actions
    for i in range(len(acts)):
        for j in range(i + 1, len(acts)):
            if conflict(acts[i], acts[j]) or interfere(acts[i], acts[j]):
                pairs.append((i, j))
    return pairs
