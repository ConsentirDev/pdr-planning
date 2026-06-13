"""
Property Directed Reachability for classical planning -- Algorithm 2 of the
thesis -- plus the two Chapter 3 variants, PDR-M and PDR-IL.

------------------------------------------------------------------------------
The idea in one breath
------------------------------------------------------------------------------
PDR never plans forward from the start. Instead it reasons *backward* from the
goal using "layers". Layer L_i is an over-approximation of "states that might
reach the goal in i steps or fewer". L_0 = the goal itself.

It keeps a queue of *obligations* <s, i>, each meaning the question:
    "can state s reach the goal in i steps?"
To answer one, it asks a SAT solver: is there a successor of s that satisfies
L_{i-1} (one step closer)?
  * YES -> that successor t becomes a new obligation <t, i-1>.
  * NO  -> we learn a *reason* r (a small partial state explaining the failure)
           and add the clause "not r" to layers 0..i, permanently forbidding
           that dead-end. This is how PDR learns.

If an obligation ever reaches layer 0, the goal is reachable -> a plan exists.
If two adjacent layers ever become identical, no plan exists -> unsolvable,
proven without ever unrolling the whole problem.

------------------------------------------------------------------------------
The three variants (selected with `variant=`)
------------------------------------------------------------------------------
* "baseline"  classical single-step PDR (Algorithm 2).
* "M"  (PDR-M, Sec 3.1)  the progression SAT call looks F steps ahead in one
                          shot: (T^0 & ... & T^{F-1}) & L_{i-1}^F. Successor is
                          read off the far end; the layer index still drops by 1.
* "IL" (PDR-IL, Sec 3.2) also looks ahead, but each intermediate step m is
                          constrained by its own layer L_{i-m}, and every
                          intermediate state becomes its own obligation <t_m,i-m>.

With F=1 all three coincide -- that F=1 run is the "baseline" the thesis
benchmarks PDR-M / PDR-IL against.
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field

from .encoding import Query
from .planning import Problem, validate_plan
from .sat import make_solver

sys.setrecursionlimit(1_000_000)


class _PDRTimeout(Exception):
    pass


@dataclass
class Result:
    solvable: bool
    plan: list = None              # list of sets of action indices (parallel plan)
    plan_actions: list = None      # same plan, action names, flattened per step
    stats: dict = field(default_factory=dict)


class PDR:
    def __init__(self, problem: Problem, variant="baseline", F=1,
                 use_reschedule=True, use_clause_pushing=True,
                 prefer_pysat=True, max_k=10_000, time_limit=None):
        assert variant in ("baseline", "M", "IL")
        if variant == "baseline":
            F = 1
        self.p = problem
        self.variant = variant
        self.F = F
        self.use_reschedule = use_reschedule
        self.use_clause_pushing = use_clause_pushing
        self.prefer_pysat = prefer_pysat
        self.max_k = max_k
        self.time_limit = time_limit
        self._deadline = None

        # layers[i] = set of clauses (each clause = frozenset of abstract lits).
        # Invariant: layers[0] >= layers[1] >= ... (more clauses = tighter/lower).
        goal_clauses = {frozenset((l,)) for l in problem.goal_cube()}
        inv_clauses = {frozenset(inv) for inv in problem.invariants}
        self.layers = [set(goal_clauses | inv_clauses)]   # L_0
        self.parent = {}   # state -> (parent_state, [action-sets per primitive step])

        self.stats = {"sat_calls": 0, "sat_time": 0.0, "reasons": 0,
                      "k": 0, "backend": None}

        # ----- evolvable seams (L2) ---------------------------------------
        # Both are soundness-preserving by construction:
        #  * tie_breaker only re-orders obligations that ALREADY share the
        #    minimal layer index (the termination invariant is untouched);
        #  * reason_order only changes WHICH literals are tried first during
        #    reason minimisation (every order still yields a valid reason).
        # Default None == the thesis behaviour (most-recent / id order).
        self.tie_breaker = None    # f(entry, cands, ctx) -> float (higher popped first)
        self.reason_order = None   # f(literal, state, ctx) -> sort key (lower tried first)
        # Wider seam: per-obligation macro look-ahead depth (PDR-M, adaptive F).
        self.progress_strategy = None   # f(i, k, state, ctx) -> int F >= 1
        self._maxF = 8
        self._k = 0
        self._ctx = {"goal": problem.goal_cube(), "nprops": len(problem.props)}

    # ----- layer bookkeeping ------------------------------------------------
    def _ensure_layers(self, upto):
        while len(self.layers) <= upto:
            self.layers.append(set())

    def _add_reason_clause(self, reason, upto_index):
        """Add clause (not reason) to layers 0..upto_index."""
        clause = frozenset(-l for l in reason)
        self._ensure_layers(upto_index)
        for j in range(upto_index + 1):
            self.layers[j].add(clause)

    @staticmethod
    def _state_models_layer(state, layer_clauses):
        # state is a full cube (one literal per prop). clause satisfied iff it
        # shares a literal with the state.
        for clause in layer_clauses:
            if not (clause & state):
                return False
        return True

    # ----- one progression SAT call ----------------------------------------
    def _new_query(self, n_steps):
        s = make_solver(self.prefer_pysat)
        if self.stats["backend"] is None:
            self.stats["backend"] = s.backend
        return Query(self.p, s, n_steps)

    def _timed_solve(self, q, cube, t_state=0):
        self.stats["sat_calls"] += 1
        t0 = time.perf_counter()
        ok = q.solve(cube, t_state)
        self.stats["sat_time"] += time.perf_counter() - t0
        return ok

    def _progress(self, s, i):
        """Try to step obligation <s,i> closer to the goal.

        Returns either:
            ("sat",  [(successor_state, layer_index, seq_of_action_sets), ...])
            ("unsat", reason_cube)
        """
        if self.progress_strategy is not None:
            # Wider, evolvable seam: an operator chooses the macro look-ahead F
            # for THIS obligation (PDR-M semantics: layer index drops by 1, the
            # successor is reached via F primitive steps). Adaptive F-schedules
            # can beat any fixed F. Soundness is preserved -- every extracted plan
            # is still validated; only speed/coverage are at stake.
            F = self.progress_strategy(i, self._k, s, self._ctx)
            F = max(1, min(int(F), self._maxF))
            n_steps = F
            layer_at = [(F, i - 1)]
            targets = [(F, i - 1)]
        elif self.variant == "baseline":
            n_steps = 1
            layer_at = [(1, i - 1)]
            targets = [(1, i - 1)]
        elif self.variant == "M":
            n_steps = self.F
            layer_at = [(self.F, i - 1)]
            targets = [(self.F, i - 1)]
        else:  # IL
            B = min(self.F, i)
            n_steps = B
            layer_at = [(m, i - m) for m in range(1, B + 1)]
            targets = list(layer_at)

        q = self._new_query(n_steps)
        for step, lidx in layer_at:
            self._ensure_layers(lidx)
            q.add_layer(self.layers[lidx], step)

        if self._timed_solve(q, s, 0):
            succ = []
            for step, j in targets:
                t = q.extract_state(step)
                seq = [q.extract_actions(tt) for tt in range(step)]
                succ.append((t, j, seq))
            return ("sat", succ)

        # UNSAT: derive and minimise a reason, reusing the same solver
        # (only the assumptions change -- this is the incremental-SAT trick).
        reason = set(s)
        order = (list(s) if self.reason_order is None
                 else sorted(s, key=lambda l: self.reason_order(l, s, self._ctx)))
        for lit in order:
            cand = reason - {lit}
            if not self._timed_solve(q, frozenset(cand), 0):
                reason = cand
        self.stats["reasons"] += 1
        return ("unsat", frozenset(reason))

    # ----- clause pushing (Lines 26-29) ------------------------------------
    def _clause_push(self, k):
        push_steps = self.F if self.variant == "M" else 1
        self._ensure_layers(k + 1)
        for i in range(1, k + 2):
            candidates = self.layers[i - 1] - self.layers[i]
            if not candidates:
                continue
            q = self._new_query(push_steps)
            q.add_layer(self.layers[i - 1], push_steps)
            for c in list(candidates):
                neg_c = frozenset(-l for l in c)   # cube = negation of clause
                if not self._timed_solve(q, neg_c, 0):
                    self.layers[i].add(c)

    def _converged(self, k):
        """Unsolvable iff `need` consecutive layers are identical."""
        need = (self.F + 1) if self.variant == "IL" else 2
        run = 1
        for i in range(1, k + 2):
            if i < len(self.layers) and self.layers[i] == self.layers[i - 1]:
                run += 1
                if run >= need:
                    return True
            else:
                run = 1
        return False

    # ----- plan reconstruction ---------------------------------------------
    def _reconstruct(self, goal_state):
        init = self.p.init_cube()
        plan = []
        cur = goal_state
        guard = 0
        while cur != init:
            if cur not in self.parent:
                return None
            par, seq = self.parent[cur]
            plan = list(seq) + plan
            cur = par
            guard += 1
            if guard > 10_000_000:
                return None
        return plan

    # ----- the main loop (Algorithm 2) -------------------------------------
    def _check_deadline(self):
        if self._deadline is not None and time.perf_counter() > self._deadline:
            raise _PDRTimeout()

    def solve(self) -> Result:
        try:
            return self._solve()
        except _PDRTimeout:
            return Result(None, stats=self._final_stats(self.stats["k"], timeout=True))

    def _solve(self) -> Result:
        p = self.p
        init = p.init_cube()
        if self.time_limit is not None:
            self._deadline = time.perf_counter() + self.time_limit

        # Line 2: trivially solved if the initial state already satisfies L_0.
        if self._state_models_layer(init, self.layers[0]):
            return Result(True, plan=[], plan_actions=[], stats=self._final_stats(0))

        order = [0]  # monotonic counter for "most recently added" tie-break

        for k in range(1, self.max_k + 1):
            self.stats["k"] = k
            self._k = k
            self._ensure_layers(k)
            # Q holds entries [layer_index, order, state]; present set dedupes.
            Q = []
            present = set()

            def push_obl(state, idx):
                key = (idx, state)
                if key in present:
                    return
                present.add(key)
                order[0] += 1
                Q.append([idx, order[0], state])

            def pop_obl():
                # minimal layer index (REQUIRED for termination); the
                # tie-breaker only chooses among those minimal-i obligations.
                min_i = min(e[0] for e in Q)
                cands = [e for e in Q if e[0] == min_i]
                if self.tie_breaker is None:
                    best = max(cands, key=lambda e: e[1])     # most recent
                else:
                    best = max(cands, key=lambda e: self.tie_breaker(e, cands, self._ctx))
                Q.remove(best)
                present.discard((best[0], best[2]))
                return best[2], best[0]

            push_obl(init, k)

            while Q:
                self._check_deadline()
                s, i = pop_obl()
                kind, payload = self._progress(s, i)

                if kind == "sat":
                    for t, j, seq in payload:
                        if t not in self.parent and t != init:
                            self.parent[t] = (s, seq)
                        if j == 0:
                            # Goal reached -> extract and validate a plan.
                            plan = self._reconstruct(t)
                            ok = plan is not None and validate_plan(p, plan)
                            return Result(True, plan=plan,
                                          plan_actions=self._names(plan) if plan else None,
                                          stats=self._final_stats(k, validated=ok))
                        push_obl(t, j)
                    push_obl(s, i)   # re-queue the originating obligation
                else:
                    reason = payload
                    self._add_reason_clause(reason, i)
                    if self.use_reschedule and i < k:
                        push_obl(s, i + 1)      # obligation rescheduling
                    # queue trimming (Lines 19-25)
                    new_entries = []
                    new_present = set()
                    for idx, od, z in Q:
                        consistent = reason <= z   # UNSAT(r & z) == not consistent
                        if idx > i or not consistent:
                            keep = (idx, od, z)
                        elif i < k:
                            keep = (i + 1, od, z)
                        else:
                            continue  # drop
                        if (keep[0], keep[2]) not in new_present:
                            new_present.add((keep[0], keep[2]))
                            new_entries.append(list(keep))
                    Q = new_entries
                    present = new_present

            # queue empty: push clauses forward and test for convergence
            # Clause pushing assumes a single fixed step semantics; under an
            # adaptive F-schedule there isn't one, so we skip it (pushing is an
            # optimisation, never required for soundness).
            if self.use_clause_pushing and self.progress_strategy is None:
                self._clause_push(k)
            if self._converged(k):
                return Result(False, stats=self._final_stats(k))

        return Result(False, stats=self._final_stats(self.max_k, hit_max=True))

    # ----- misc -------------------------------------------------------------
    def _names(self, plan):
        return [[self.p.actions[a].name for a in sorted(step)] for step in plan]

    def _final_stats(self, k, **extra):
        st = dict(self.stats)
        st["k"] = k
        st.update(extra)
        return st
