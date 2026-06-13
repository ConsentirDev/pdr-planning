"""
Chapter 6 -- the FOND progression SAT encoding (Schemas 6-15).

Classical PDR asks "is there ONE successor of s that steps toward the goal?".
FOND has to ask something stronger, because nature chooses the outcome:

    "Is there an action a at s such that
        * at least ONE outcome lands in L_{i-1}  (real progress), AND
        * EVERY outcome stays inside L_k         (never falls out of the
                                                  k-horizon -- no dead ends)?"

To express "every outcome", the encoding uses *time-slices* instead of the two
time-steps of classical PDR:
    slice 'o'      : the originating state s
    slice 'P'      : the chosen "progress outcome" (constrained by L_{i-1})
    slices 1..n    : the "all-futures" -- one per possible outcome
                     (each constrained by L_k);  n = max #outcomes of any action

`PO(a, j)` is a variable: "outcome j of action a is the progress outcome".
This module builds exactly Schemas 7-15 for that, plus the Schema 6 layer
constraints. It is the encoding that lets FOND-PDR learn *reasons* over partial
states, just like classical PDR.
"""

from __future__ import annotations

from .planning import FONDProblem


class FONDQuery:
    def __init__(self, problem: FONDProblem, solver, layer_k=None, layer_im1=None,
                 forward=False):
        """Build the progression formula.

        layer_im1 : clause set for L_{i-1}  (constrains the 'P' slice)
        layer_k   : clause set for L_k      (constrains all-futures slices)
        forward   : if True, omit the L_k all-futures constraints (Schema 6
                    forward-push variant) -- used for the no-policy check.
        """
        self.p = problem
        self.s = solver
        self.n = problem.max_outcomes
        self._pvar = {}
        self._avar = {}
        self._povar = {}
        self._build_static()
        self._add_invariants()
        if layer_im1 is not None:
            self._add_layer(layer_im1, 'P')
        if not forward and layer_k is not None:
            for j in range(1, self.n + 1):
                self._add_layer(layer_k, j)

    # -- variables -----------------------------------------------------------
    def pvar(self, pid, slc):
        key = (pid, slc)
        v = self._pvar.get(key)
        if v is None:
            v = self.s.new_var()
            self._pvar[key] = v
        return v

    def avar(self, ai):
        v = self._avar.get(ai)
        if v is None:
            v = self.s.new_var()
            self._avar[ai] = v
        return v

    def povar(self, ai, oi):
        key = (ai, oi)
        v = self._povar.get(key)
        if v is None:
            v = self.s.new_var()
            self._povar[key] = v
        return v

    def plit(self, abstract_lit, slc):
        var = self.pvar(abs(abstract_lit), slc)
        return var if abstract_lit > 0 else -var

    def _nlit(self, name, val, slc):
        return self.plit(self.p.lit(name, val), slc)

    # -- the schemas ---------------------------------------------------------
    def _build_static(self):
        p = self.p
        nprops = len(p.props)
        acts = p.actions

        for ai, a in enumerate(acts):
            av = self.avar(ai)
            # Schema 7: action implies precondition (originating slice)
            for n, v in a.pre.items():
                self.s.add_clause([-av, self._nlit(n, v, 'o')])
            # Schema 8: action implies effects in each all-futures slice
            for oi, eff in enumerate(a.outcomes):
                slc = oi + 1
                for n, v in eff.items():
                    self.s.add_clause([-av, self._nlit(n, v, slc)])
            # Schema 9: progress outcome implies effect (P slice)
            for oi, eff in enumerate(a.outcomes):
                pov = self.povar(ai, oi)
                for n, v in eff.items():
                    self.s.add_clause([-pov, self._nlit(n, v, 'P')])
            # Schema 12: action implies at least one of its progress outcomes
            self.s.add_clause([-av] + [self.povar(ai, oi)
                                       for oi in range(len(a.outcomes))])
            # Schema 13: progress outcome implies its action
            for oi in range(len(a.outcomes)):
                self.s.add_clause([-self.povar(ai, oi), av])
            # Schema 14: at most one progress outcome per action
            for oi in range(len(a.outcomes)):
                for oj in range(oi + 1, len(a.outcomes)):
                    self.s.add_clause([-self.povar(ai, oi), -self.povar(ai, oj)])

        # Schema 10: progress-outcome frame axioms
        po_adders = {pid: [] for pid in range(1, nprops + 1)}
        po_deleters = {pid: [] for pid in range(1, nprops + 1)}
        for ai, a in enumerate(acts):
            for oi, eff in enumerate(a.outcomes):
                for n, v in eff.items():
                    pid = p.prop_id[n]
                    (po_adders if v else po_deleters)[pid].append(self.povar(ai, oi))
        for pid in range(1, nprops + 1):
            p_o = self.pvar(pid, 'o')
            p_P = self.pvar(pid, 'P')
            self.s.add_clause([-p_P, p_o] + po_adders[pid])
            self.s.add_clause([p_P, -p_o] + po_deleters[pid])

        # Schema 11: all-futures frame axioms (per outcome slice)
        for slc in range(1, self.n + 1):
            adders = {pid: [] for pid in range(1, nprops + 1)}
            deleters = {pid: [] for pid in range(1, nprops + 1)}
            no_ith = []  # actions that do not have an slc-th outcome
            for ai, a in enumerate(acts):
                if len(a.outcomes) < slc:
                    no_ith.append(self.avar(ai))
                    continue
                eff = a.outcomes[slc - 1]
                for n, v in eff.items():
                    pid = p.prop_id[n]
                    (adders if v else deleters)[pid].append(self.avar(ai))
            for pid in range(1, nprops + 1):
                p_o = self.pvar(pid, 'o')
                p_i = self.pvar(pid, slc)
                self.s.add_clause([-p_i, p_o] + adders[pid] + no_ith)
                self.s.add_clause([p_i, -p_o] + deleters[pid] + no_ith)

        # Schema 15: at most one action (pairwise -- action counts are small)
        for ai in range(len(acts)):
            for aj in range(ai + 1, len(acts)):
                self.s.add_clause([-self.avar(ai), -self.avar(aj)])
        # at least one action must fire for a real progression
        if acts:
            self.s.add_clause([self.avar(ai) for ai in range(len(acts))])

    def _add_invariants(self):
        # binary mutex invariants added to every slice (Schema 6 footnote)
        for clause in self.p.invariants:
            for slc in ['o', 'P'] + list(range(1, self.n + 1)):
                self.s.add_clause([self.plit(l, slc) for l in clause])

    def _add_layer(self, clauses, slc):
        for clause in clauses:
            self.s.add_clause([self.plit(l, slc) for l in clause])

    # -- solving / extraction ------------------------------------------------
    def solve(self, state_cube, banned_action_idxs=()):
        assumptions = [self.plit(l, 'o') for l in state_cube]
        assumptions += [-self.avar(ai) for ai in banned_action_idxs]
        return self.s.solve(assumptions)

    def fired_action(self):
        model = self.s.model()
        for ai, v in self._avar.items():
            if v in model:
                return ai
        return None

    def successors(self, ai):
        """All-futures successor states (full state per outcome of action ai)."""
        model = self.s.model()
        a = self.p.actions[ai]
        outs = []
        for oi in range(len(a.outcomes)):
            slc = oi + 1
            st = frozenset(
                pid if self.pvar(pid, slc) in model else -pid
                for pid in range(1, len(self.p.props) + 1))
            outs.append(st)
        return outs
