"""
Chapter 6 -- FOND-PDR (Algorithm 4) and the policy generator (Algorithm 5).

What's different from classical PDR (kid version): in a FOND world an action can
have several outcomes and *nature* picks which one happens. So a "plan" isn't a
list of actions -- it's a *policy*: a rule that says, in every situation you
might end up in, which action to try next, so that no matter how the dice land
you always eventually reach the goal (a "strong cyclic policy").

FOND-PDR keeps PDR's backward layers and learns-from-dead-ends machinery, but:
  * the SAT question becomes "is there an action where ONE outcome makes progress
    and EVERY outcome stays safe?" (see fond_encoding.py),
  * it records every (state, action, outcomes) it discovers into an AND/OR graph,
  * a *policy generator* (Algorithm 5) repeatedly deletes "sink" states (states
    with no path to the goal) and the actions leading into them; whatever
    survives has a policy. The moment the initial state survives -> done.

No-policy is proved either by PDR layer convergence (the fast, thesis path) or,
as a guaranteed completeness-threshold backstop, by running the policy generator
on the fully-explored reachable graph.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from .planning import FONDProblem, validate_policy
from .fond_encoding import FONDQuery
from .sat import make_solver


@dataclass
class FONDResult:
    has_policy: bool          # True / False / None (timeout)
    policy: dict = None       # {state-frozenset: action_index}
    stats: dict = field(default_factory=dict)


def _models(state, layer_clauses):
    return all((cl & state) for cl in layer_clauses)


# ---------------------------------------------------------------------------
# Algorithm 5 -- policy generator (sink removal on the AND/OR graph)
# ---------------------------------------------------------------------------
def compute_policy(arcs, goal_states):
    """arcs: {state: set of (action_idx, tuple(outcome_states))}.
    Returns (solved_states, policy) where policy[state] = action_idx.
    A state is solved iff it survives repeated removal of states that cannot
    reach a goal (and of any action whose outcome is a removed state)."""
    states = set(arcs) | set(goal_states)
    for outs in arcs.values():
        for _, succ in outs:
            states |= set(succ)
    alive = set(states)
    cur_arcs = {s: set(a) for s, a in arcs.items()}

    while True:
        # reachability to a goal over outcome edges among alive states
        reach = set(g for g in goal_states if g in alive)
        frontier = list(reach)
        # build reverse edges
        pred = {}
        for s, outs in cur_arcs.items():
            if s not in alive:
                continue
            for _, succ in outs:
                for t in succ:
                    if t in alive:
                        pred.setdefault(t, set()).add(s)
        while frontier:
            t = frontier.pop()
            for s in pred.get(t, ()):  # noqa
                if s not in reach:
                    reach.add(s)
                    frontier.append(s)
        sinks = alive - reach
        if not sinks:
            break
        alive -= sinks
        # drop arcs whose source or any outcome is now dead
        new_arcs = {}
        for s, outs in cur_arcs.items():
            if s not in alive:
                continue
            keep = {(a, succ) for (a, succ) in outs
                    if all(t in alive for t in succ)}
            if keep:
                new_arcs[s] = keep
        cur_arcs = new_arcs

    # Extract a strong-cyclic policy by assigning actions in waves *backward*
    # from the goal. A state's chosen action must have all outcomes alive AND at
    # least one outcome already assigned (strictly closer to the goal). That
    # "closer" outcome is a well-founded progress measure: under fairness the
    # policy can't loop forever among non-goal states.
    policy = {}
    assigned = set(g for g in goal_states if g in alive)
    changed = True
    while changed:
        changed = False
        for s in alive:
            if s in assigned or s in goal_states:
                continue
            for a, succ in sorted(cur_arcs.get(s, ())):
                if all(t in alive for t in succ) and any(t in assigned for t in succ):
                    policy[s] = a
                    assigned.add(s)
                    changed = True
                    break
    return assigned, policy


# ---------------------------------------------------------------------------
# full reachable AND/OR graph (guaranteed-correct backstop / oracle)
# ---------------------------------------------------------------------------
def reachable_graph(problem: FONDProblem):
    arcs = {}
    goal_states = set()
    init = problem.init_cube()
    seen = set()
    frontier = [init]
    while frontier:
        s = frontier.pop()
        if s in seen:
            continue
        seen.add(s)
        sd = problem.state_dict(s)
        if problem.satisfies_goal(sd):
            goal_states.add(s)
            continue
        outs = set()
        for ai, a in enumerate(problem.actions):
            if not problem.applicable(sd, a):
                continue
            succ = tuple(sorted(problem.cube(nd)
                                for nd in problem.all_succ(sd, a)))
            outs.add((ai, succ))
            for nd in problem.all_succ(sd, a):
                ns = problem.cube(nd)
                if ns not in seen:
                    frontier.append(ns)
        if outs:
            arcs[s] = outs
    return arcs, goal_states


def reference_answer(problem: FONDProblem):
    """Ground-truth decision via explicit strong-cyclic search (Algorithm 5 on
    the full reachable graph). Used as a test oracle and as FOND-PDR's backstop."""
    arcs, goal_states = reachable_graph(problem)
    solved, policy = compute_policy(arcs, goal_states)
    return (problem.init_cube() in solved), policy


# ---------------------------------------------------------------------------
# Algorithm 4 -- FOND-PDR
# ---------------------------------------------------------------------------
class FONDPDR:
    def __init__(self, problem: FONDProblem, time_limit=None, max_k=200,
                 prefer_pysat=True):
        self.p = problem
        self.time_limit = time_limit
        self.max_k = max_k
        self.prefer_pysat = prefer_pysat
        goal = {frozenset((l,)) for l in problem.goal_cube()}
        inv = {frozenset(c) for c in problem.invariants}
        self.layers = [set(goal | inv)]      # L_0
        # discovered AND/OR graph for the policy generator
        self.arcs = {}
        self.goal_states = set()
        self.solved = set()
        self.policy = {}
        self.tried = {}          # state -> set of actions already used (global)
        self.stats = {"k": 0, "sat_calls": 0, "sat_time": 0.0, "reasons": 0,
                      "states": 0, "backend": None, "decided_by": None}
        self._deadline = None

    # -- layer helpers -------------------------------------------------------
    def _ensure(self, upto):
        while len(self.layers) <= upto:
            self.layers.append(set())

    def _lowest_layer(self, state):
        j = 0
        while j < len(self.layers) and _models(state, self.layers[j]):
            j += 1
        return j - 1 if j > 0 else 0

    def _add_reason(self, reason, upto):
        clause = frozenset(-l for l in reason)
        self._ensure(upto)
        for j in range(upto + 1):
            self.layers[j].add(clause)

    # -- SAT progression -----------------------------------------------------
    def _query(self, k, im1, forward=False):
        s = make_solver(self.prefer_pysat)
        if self.stats["backend"] is None:
            self.stats["backend"] = s.backend
        self._ensure(max(k, im1))
        return FONDQuery(self.p, s, layer_k=self.layers[k],
                         layer_im1=self.layers[im1], forward=forward)

    def _timed(self, q, cube, banned):
        self.stats["sat_calls"] += 1
        t0 = time.perf_counter()
        ok = q.solve(cube, banned)
        self.stats["sat_time"] += time.perf_counter() - t0
        return ok

    def _progress(self, s, i, k, tried):
        """Return ('act', a, successors) | ('exhausted', None) | ('deadend', r)."""
        q = self._query(k, i - 1)
        if self._timed(q, s, tried):
            a = q.fired_action()
            succ = q.successors(a)
            return ("act", a, succ)
        # nothing outside `tried` works; is anything progressable at all?
        q0 = self._query(k, i - 1)
        if self._timed(q0, s, ()):
            return ("exhausted", None)
        # genuine dead-end: minimise a reason on the all-bans-free query
        reason = set(s)
        for lit in list(s):
            cand = reason - {lit}
            if not self._timed(q0, frozenset(cand), ()):
                reason = cand
        self.stats["reasons"] += 1
        return ("deadend", frozenset(reason))

    # -- main loop -----------------------------------------------------------
    def solve(self) -> FONDResult:
        try:
            return self._solve()
        except TimeoutError:
            return FONDResult(None, stats=dict(self.stats))

    def _check_deadline(self):
        if self._deadline is not None and time.perf_counter() > self._deadline:
            raise TimeoutError()

    def _record_arc(self, s, a, succ):
        self.arcs.setdefault(s, set()).add((a, tuple(sorted(succ))))
        for ns in succ:
            nd = self.p.state_dict(ns)
            if self.p.satisfies_goal(nd):
                self.goal_states.add(ns)
        self.stats["states"] = len(self.arcs) + len(self.goal_states)

    def _refresh_policy(self):
        self.solved, self.policy = compute_policy(self.arcs, self.goal_states)
        return self.p.init_cube() in self.solved

    def _solve(self) -> FONDResult:
        p = self.p
        if self.time_limit is not None:
            self._deadline = time.perf_counter() + self.time_limit
        init = p.init_cube()
        if _models(init, self.layers[0]):
            return FONDResult(True, policy={}, stats=self._fin("trivial"))

        for k in range(1, self.max_k + 1):
            self.stats["k"] = k
            self._ensure(k)

            # ---- no-policy check via forward-push convergence (lines 4-5) ----
            if self._forward_push_converges(k) and not _models(init, self.layers[k]):
                return FONDResult(False, stats=self._fin("layer-convergence"))

            # ---- obligation processing (lines 7-25) ----
            # queue entries: [layer, order, state]; tried-actions tracked globally
            Q = []
            present = set()
            done = set()       # states finished THIS k-iteration
            order = [0]

            def push(state, idx):
                key = (idx, state)
                if key in present or state in self.solved or state in done:
                    return
                present.add(key)
                order[0] += 1
                Q.append([idx, order[0], state])

            def push_known_succ(s):
                for a, succ in self.arcs.get(s, ()):  # noqa
                    for ns in succ:
                        if ns not in self.goal_states and ns not in self.solved:
                            push(ns, self._lowest_layer(ns))

            push(init, k)
            while Q:
                self._check_deadline()
                # unlocked obligation, lowest layer, most recent
                best = None
                for e in Q:
                    if best is None or e[0] < best[0] or (e[0] == best[0] and e[1] > best[1]):
                        best = e
                Q.remove(best)
                s, i = best[2], best[0]
                present.discard((i, s))
                if s in self.solved or s in done:
                    continue

                tried = self.tried.get(s, frozenset())
                kind, payload, *rest = self._progress(s, i, k, tried) + (None,)
                if kind == "act":
                    a = payload
                    succ = rest[0]
                    self.tried[s] = tried | {a}
                    self._record_arc(s, a, succ)
                    push(s, i)                      # keep exploring other actions
                    for ns in succ:
                        if ns not in self.goal_states and ns not in self.solved:
                            push(ns, self._lowest_layer(ns))
                    if self._refresh_policy() and init in self.solved:
                        ok = validate_policy(p, self.policy)
                        return FONDResult(True, policy=self.policy,
                                          stats=self._fin("policy-found", validated=ok))
                elif kind == "exhausted":
                    # no new progressable action; keep traversing known arcs
                    done.add(s)
                    push_known_succ(s)
                else:  # deadend: learn a reason, reschedule to a looser layer
                    reason = payload
                    self._add_reason(reason, i)
                    if i < k:
                        push(s, i + 1)

            # end of k-iteration: did a policy emerge?
            if self._refresh_policy() and init in self.solved:
                ok = validate_policy(p, self.policy)
                return FONDResult(True, policy=self.policy,
                                  stats=self._fin("policy-found", validated=ok))

        # hit max_k: fall back to the guaranteed-correct reachable-graph answer
        ans, pol = reference_answer(p)
        return FONDResult(ans, policy=pol if ans else None,
                          stats=self._fin("ct-fallback"))

    # -- forward-push convergence (faithful no-policy fast path) -------------
    def _forward_push_converges(self, k):
        """Reset layers to {L_0=G+inv}; forward-push every learned reason as far
        as it stays *forward-valid*; return True iff L_k == L_{k-1} (clause-set)."""
        # snapshot every clause currently known across all layers (the reasons)
        all_reasons = set()
        for lay in self.layers:
            all_reasons |= lay
        if not hasattr(self, "_base0"):
            self._base0 = set(self.layers[0])   # L_0 = G + invariants
        new = [set(self._base0)] + [set() for _ in range(k)]
        reasons = list(all_reasons)
        for j in range(1, k + 1):
            for c in reasons:
                if c in new[j]:
                    continue
                r = frozenset(-l for l in c)  # the reason cube
                if self._forward_valid(r, j, new):
                    for t in range(j + 1):
                        new[t].add(c)
        converged = (new[k] == new[k - 1])
        # adopt the rebuilt (and possibly stronger) layers
        for j in range(len(new)):
            self._ensure(j)
            self.layers[j] = new[j]
        return converged

    def _forward_valid(self, reason, j, layerstack):
        """A reason is forward-valid at layer j if no state consistent with it
        has an action whose progress-outcome satisfies L_{j-1} (Schema 6 forward
        variant -- no all-futures constraint)."""
        s = make_solver(self.prefer_pysat)
        q = FONDQuery(self.p, s, layer_k=None, layer_im1=layerstack[j - 1],
                      forward=True)
        self.stats["sat_calls"] += 1
        t0 = time.perf_counter()
        ok = q.solve(reason, ())
        self.stats["sat_time"] += time.perf_counter() - t0
        return not ok  # forward-valid iff UNSAT

    def _fin(self, how, **extra):
        st = dict(self.stats)
        st["decided_by"] = how
        st.update(extra)
        return st
