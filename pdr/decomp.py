"""
Chapter 5 -- Parallel Decompositional PDR (PD-PDR).

Big idea (the "shared desk" analogy from the thesis): instead of solving the
whole planning problem at once, *split the goal into independent sub-goals*,
solve each small sub-problem in parallel, and glue the sub-plans together.

How the split is found:
  1. Build a dependency graph (PSDG) over goal-relevant propositions:
     p1 -> p2 if achieving p1 ever needs p2 (some action has p1 in its effect
     and p2 in its precondition).
  2. Collapse cycles into single nodes (SCCs) -> a DAG of "chunks" (the LADG).
  3. Each chunk that holds a goal proposition becomes a sub-problem, ordered so
     a chunk that depends on another comes first.
  4. Each sub-problem must achieve its slice of the goal AND hand the world back
     to later sub-problems the way they expect it (the `Dep` set -- "leave the
     truck where you found it").

Glue & repair:
  * Concatenate the sub-plans in order and validate against the real problem.
  * If the glue fails (two sub-plans fought over a one-shot resource like fuel),
    find the *problematic proposition*, MERGE the chunks involved, and try again
    with a coarser decomposition.
  * Worst case everything merges into one chunk == the original problem, solved
    directly by PDR. So PD-PDR is sound and complete; it just usually wins in
    one or two iterations.

Every sub-problem here is solved with the classical PDR from `pdr.py`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from .planning import Problem, validate_plan
from .pdr import PDR


@dataclass
class DResult:
    solvable: bool
    plan: list = None
    plan_actions: list = None
    stats: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# small graph helpers (no third-party deps)
# ---------------------------------------------------------------------------
def _tarjan_scc(nodes, succ):
    """Return list of SCCs (each a set) of a directed graph."""
    index = {}
    low = {}
    onstack = {}
    stack = []
    result = []
    counter = [0]

    import sys
    sys.setrecursionlimit(1_000_000)

    def strongconnect(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        onstack[v] = True
        for w in succ.get(v, ()):  # noqa
            if w not in index:
                strongconnect(w)
                low[v] = min(low[v], low[w])
            elif onstack.get(w):
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = set()
            while True:
                w = stack.pop()
                onstack[w] = False
                comp.add(w)
                if w == v:
                    break
            result.append(comp)

    for v in nodes:
        if v not in index:
            strongconnect(v)
    return result


class _UnionFind:
    def __init__(self, items):
        self.parent = {x: x for x in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb

    def classes(self):
        out = {}
        for x in self.parent:
            out.setdefault(self.find(x), set()).add(x)
        return list(out.values())


# ---------------------------------------------------------------------------
# dependency analysis
# ---------------------------------------------------------------------------
def _sigma_pre(a):
    return set(a.pre)


def _sigma_eff(a):
    return set(a.eff)


def dependency_edges(problem):
    """p1 -> p2 if some action has p1 in its effect and p2 in its precondition."""
    edges = set()
    for a in problem.actions:
        for p1 in _sigma_eff(a):
            for p2 in _sigma_pre(a):
                if p1 != p2:
                    edges.add((p1, p2))
    return edges


def goal_relevant(problem, edges):
    """Propositions reachable from goal props by following dependency edges."""
    succ = {}
    for u, v in edges:
        succ.setdefault(u, set()).add(v)
    relevant = set(problem.goal)
    frontier = list(problem.goal)
    while frontier:
        u = frontier.pop()
        for v in succ.get(u, ()):  # noqa
            if v not in relevant:
                relevant.add(v)
                frontier.append(v)
    return relevant


def monotone_props(problem):
    """X^+- : propositions appearing only-positively or only-negatively in effects."""
    pos, neg = set(), set()
    for a in problem.actions:
        for n, v in a.eff.items():
            (pos if v else neg).add(n)
    both = pos & neg
    return (pos | neg) - both | {p for p in problem.props if p not in pos and p not in neg}


def mutex_pairs(problem):
    """Binary mutex set {frozenset({n1,n2})} derived from invariants (¬f1∨¬f2)."""
    out = set()
    for clause in problem.invariants:
        if len(clause) == 2 and all(l < 0 for l in clause):
            n1 = problem.name_of(clause[0])
            n2 = problem.name_of(clause[1])
            out.add(frozenset((n1, n2)))
    return out


# ---------------------------------------------------------------------------
# the LADG (DAG of chunks), maintained via a union-find over propositions
# ---------------------------------------------------------------------------
class LADG:
    def __init__(self, problem, edges, relevant):
        self.problem = problem
        self.edges = edges
        self.relevant = relevant
        # union-find over ALL props so merges can pull in goal-irrelevant props.
        self.uf = _UnionFind(list(problem.props))
        # seed: collapse SCCs of the relevant subgraph.
        succ = {}
        for u, v in edges:
            if u in relevant and v in relevant:
                succ.setdefault(u, set()).add(v)
        for comp in _tarjan_scc(list(relevant), succ):
            comp = list(comp)
            for x in comp[1:]:
                self.uf.union(comp[0], x)
        self._condense()

    def _condense(self):
        """Recompute chunk graph; union any chunks that form a cycle (keep DAG)."""
        while True:
            rep = {}  # prop -> chunk representative (only relevant props matter)
            for p in self.relevant:
                rep[p] = self.uf.find(p)
            csucc = {}
            for u, v in self.edges:
                if u in rep and v in rep:
                    cu, cv = rep[u], rep[v]
                    if cu != cv:
                        csucc.setdefault(cu, set()).add(cv)
            chunks = set(rep.values())
            sccs = _tarjan_scc(list(chunks), csucc)
            merged = False
            for comp in sccs:
                comp = list(comp)
                if len(comp) > 1:
                    for x in comp[1:]:
                        self.uf.union(comp[0], x)
                    merged = True
            if not merged:
                self.csucc = csucc
                self.chunks = chunks
                return

    def chunk_of(self, prop):
        return self.uf.find(prop)

    def label(self, chunk):
        """Relevant props in a chunk."""
        return frozenset(p for p in self.relevant if self.uf.find(p) == chunk)

    def descendants(self, chunk):
        seen = set()
        frontier = [chunk]
        while frontier:
            c = frontier.pop()
            for d in self.csucc.get(c, ()):  # noqa
                if d not in seen:
                    seen.add(d)
                    frontier.append(d)
        return seen

    def parents(self, chunk):
        return {u for u, vs in self.csucc.items() if chunk in vs}

    def topo_order(self):
        """Chunks ordered so u (depender) before v when u -> v."""
        indeg = {c: 0 for c in self.chunks}
        for u, vs in self.csucc.items():
            for v in vs:
                indeg[v] += 1
        order = [c for c in self.chunks if indeg[c] == 0]
        out = []
        i = 0
        while i < len(order):
            u = order[i]
            i += 1
            out.append(u)
            for v in self.csucc.get(u, ()):  # noqa
                indeg[v] -= 1
                if indeg[v] == 0:
                    order.append(v)
        # any leftover (shouldn't happen on a DAG) appended arbitrarily
        for c in self.chunks:
            if c not in out:
                out.append(c)
        return out

    def merge(self, props_to_group):
        """Union the chunks containing the given props, then re-condense."""
        groups = list(props_to_group)
        for x in groups[1:]:
            self.uf.union(groups[0], x)
        self._condense()


# ---------------------------------------------------------------------------
# PD-PDR
# ---------------------------------------------------------------------------
class PDPDR:
    def __init__(self, problem: Problem, time_limit=None, max_iters=50, verbose=False):
        self.p = problem
        self.time_limit = time_limit
        self.max_iters = max_iters
        self.verbose = verbose
        self.stats = {"iterations": 0, "subproblems": [], "sat_calls": 0,
                      "sat_time": 0.0}

    def _log(self, *a):
        if self.verbose:
            print("[PD-PDR]", *a)

    def solve(self) -> DResult:
        p = self.p
        t0 = time.perf_counter()
        edges = dependency_edges(p)
        relevant = goal_relevant(p, edges)
        ladg = LADG(p, edges, relevant)
        mono = monotone_props(p)
        mtx = mutex_pairs(p)

        for it in range(1, self.max_iters + 1):
            self.stats["iterations"] = it
            order = ladg.topo_order()
            # Delta_G: chunks holding a goal proposition, in topo order.
            delta = [c for c in order if any(g in ladg.label(c) for g in p.goal)]
            self._log(f"iter {it}: {len(ladg.chunks)} chunks, {len(delta)} subproblems")

            if len(ladg.chunks) <= 1 or len(delta) <= 1:
                # Decomposition exhausted -> solve concrete problem directly.
                res = self._solve_concrete()
                res.stats.update(self._final_stats(it, n_sub=1))
                return res

            subs = self._build_subproblems(ladg, delta, mono, mtx)

            # Solve each subproblem (independently / "in parallel") with PDR.
            sub_results = []
            unsolved = None
            for pg, sub in subs:
                r = PDR(sub, time_limit=self.time_limit).solve()
                self.stats["sat_calls"] += r.stats.get("sat_calls", 0)
                self.stats["sat_time"] += r.stats.get("sat_time", 0.0)
                sub_results.append((pg, sub, r))
                if r.solvable is False:
                    # subproblem unsolvable
                    if self._dep_empty(ladg, delta, pg, mono, mtx):
                        return DResult(False, stats=self._final_stats(it, n_sub=len(subs)))
                    unsolved = (pg, sub)
                    break
                if r.solvable is None:
                    return DResult(None, stats=self._final_stats(it, n_sub=len(subs)))

            if unsolved is not None:
                self._merge_for_unsolvable(ladg, unsolved[1])
                continue

            # Concatenate sub-plans and validate against the concrete problem.
            concrete_plan = self._concatenate(sub_results)
            if validate_plan(p, concrete_plan):
                self.stats["subproblems"].append(len(subs))
                return DResult(True, plan=concrete_plan,
                               plan_actions=self._names(concrete_plan),
                               stats=self._final_stats(it, n_sub=len(subs)))

            # Glue failed: find the problematic proposition and merge chunks.
            prob_prop = self._problematic_prop(concrete_plan)
            self._log(f"  glue failed, problematic prop = {prob_prop}")
            self._merge_for_problematic(ladg, prob_prop, mtx)

        # safety net
        res = self._solve_concrete()
        res.stats.update(self._final_stats(self.max_iters, n_sub=1))
        return res

    # ----- subproblem construction -----------------------------------------
    def _F(self, ladg, chunk):
        props = set(ladg.label(chunk))
        for d in ladg.descendants(chunk):
            props |= set(ladg.label(d))
        return props

    def _Ex(self, ladg, F, mono):
        """Monotone props that co-occur in an effect with a prop in F."""
        ex = set()
        for a in self.p.actions:
            eff = set(a.eff)
            if eff & F:
                for x in eff:
                    if x in mono:
                        ex.add(x)
        return ex & mono

    def _Mbar(self, V, mtx):
        """Props not binary-mutex with any positive goal prop projected to V."""
        gproj = {n for n, v in self.p.goal.items() if v and n in V}
        out = set()
        for f in self.p.props:
            if any(frozenset((f, g)) in mtx for g in gproj):
                continue
            out.add(f)
        return out

    def _build_subproblems(self, ladg, delta, mono, mtx):
        p = self.p
        index = {pg: i for i, pg in enumerate(delta)}
        Fsets = {pg: self._F(ladg, pg) for pg in delta}
        subs = []
        for pg in delta:
            V = ladg.label(pg)
            F = Fsets[pg]
            Ex = self._Ex(ladg, F, mono)
            Mbar = self._Mbar(V, mtx)
            later = set()
            for pg2 in delta:
                if index[pg2] > index[pg]:
                    later |= Fsets[pg2]
            Dep = (later & F & Mbar) - Ex
            # Subproblem tuple
            Xs = F
            As = [a for a in p.actions
                  if _sigma_pre(a) <= F and _sigma_eff(a) <= F]
            Is = {n: p.init[n] for n in F}
            Gs = {}
            for n, v in p.goal.items():
                if n in V:
                    Gs[n] = v
            for f in Dep:
                Gs[f] = p.init[f]   # I|Dep : restore to initial value
            sub = Problem(sorted(Xs), As, Is, Gs, invariants=[],
                          name=f"{p.name}::sub[{sorted(V)[0] if V else '?'}]")
            # Invariants are abstract literals tied to the ORIGINAL prop ids;
            # remap them by name onto the subproblem's own ids.
            sub.invariants = [
                tuple(sub.lit(p.name_of(l), l > 0) for l in c)
                for c in p.invariants
                if all(p.name_of(l) in F for l in c)
            ]
            subs.append((pg, sub))
        return subs

    def _dep_empty(self, ladg, delta, pg, mono, mtx):
        index = {q: i for i, q in enumerate(delta)}
        F = self._F(ladg, pg)
        V = ladg.label(pg)
        Ex = self._Ex(ladg, F, mono)
        Mbar = self._Mbar(V, mtx)
        later = set()
        for q in delta:
            if index[q] > index[pg]:
                later |= self._F(ladg, q)
        Dep = (later & F & Mbar) - Ex
        return len(Dep) == 0

    # ----- concatenation / validation --------------------------------------
    def _concatenate(self, sub_results):
        name_to_idx = {a.name: i for i, a in enumerate(self.p.actions)}
        concrete = []
        for pg, sub, r in sub_results:
            for step in (r.plan or []):
                concrete.append({name_to_idx[sub.actions[a].name] for a in step})
        return concrete

    def _problematic_prop(self, concrete_plan):
        """First unmet precondition proposition when replaying the glued plan."""
        p = self.p
        state = dict(p.init)
        for step in concrete_plan:
            for ai in step:
                a = p.actions[ai]
                for n, v in a.pre.items():
                    if state.get(n) != v:
                        return n
            for ai in step:
                state = p.apply(state, p.actions[ai])
        # plan executed but goal unmet -> blame a goal prop
        for n, v in p.goal.items():
            if state.get(n) != v:
                return n
        return next(iter(p.goal))

    # ----- merges -----------------------------------------------------------
    def _merge_for_problematic(self, ladg, prob_prop, mtx):
        c = ladg.chunk_of(prob_prop)
        group = {prob_prop}
        # mutex-related props
        for pair in mtx:
            if prob_prop in pair:
                other = next(iter(pair - {prob_prop}))
                group.add(other)
        # descendants of c
        for d in ladg.descendants(c):
            group |= set(ladg.label(d))
        reps = {ladg.chunk_of(x) for x in group}
        if len(reps) >= 2:
            ladg.merge(group)
        else:
            # contract with parents instead
            par = ladg.parents(c)
            group = set(ladg.label(c))
            for pr in par:
                group |= set(ladg.label(pr))
            ladg.merge(group if len(group) else {prob_prop})

    def _merge_for_unsolvable(self, ladg, sub):
        subprops = set(sub.props)
        reps = {ladg.chunk_of(x) for x in subprops if x in ladg.uf.parent}
        if len(reps) >= 2:
            ladg.merge(subprops)
        else:
            c = next(iter(reps)) if reps else None
            group = set(subprops)
            if c is not None:
                for pr in ladg.parents(c):
                    group |= set(ladg.label(pr))
            ladg.merge(group)

    # ----- concrete fallback -----------------------------------------------
    def _solve_concrete(self):
        r = PDR(self.p, time_limit=self.time_limit).solve()
        self.stats["sat_calls"] += r.stats.get("sat_calls", 0)
        self.stats["sat_time"] += r.stats.get("sat_time", 0.0)
        return DResult(r.solvable, plan=r.plan, plan_actions=r.plan_actions,
                       stats=dict(r.stats))

    def _names(self, plan):
        return [[self.p.actions[a].name for a in sorted(step)] for step in plan]

    def _final_stats(self, it, n_sub=None):
        st = dict(self.stats)
        st["iterations"] = it
        if n_sub is not None:
            st["last_n_subproblems"] = n_sub
        return st
