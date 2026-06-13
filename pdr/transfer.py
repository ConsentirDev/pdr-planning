"""
Verified reason transfer across a curriculum.

PDR *learns* as it runs: every dead-end it proves becomes a reason clause that
prunes the search. Those reasons are usually thrown away between problems. Here
we keep them and carry them from small instances to larger ones of the same
domain -- a compounding curriculum, not just a well-configured one.

The catch: a dead-end on a 3-package logistics problem may NOT be a dead-end on a
5-package one, so blindly importing reasons would be unsound (it could forbid
states that can actually reach the goal). We make it sound by *verifying every
transferred reason on the target with a single SAT call before trusting it* --
exactly the check PDR already uses for clause pushing. Unverified candidates are
dropped. So transfer can only ever *speed things up*, never change the answer;
the plan is still validated.

Pipeline:
  harvest reasons from a solved small instance
    -> LIFT each (replace ground objects with typed variables)
       -> REGROUND onto the target's objects (all type-respecting substitutions)
          -> VERIFY each candidate is a genuine dead-end on the target (1 SAT call)
             -> seed the verified reasons into the target's layers L_0, L_1
"""

from __future__ import annotations

import re
import time

from .planning import Problem
from .pdr import PDR
from .encoding import Query
from .sat import make_solver

_ATOM = re.compile(r"^([^()]+)\(([^()]*)\)$")


# ---------------------------------------------------------------------------
# parsing + type inference
# ---------------------------------------------------------------------------
def parse_atom(name):
    """'at(P0,L1)' -> ('at', ('P0','L1')) ;  'handempty' -> ('handempty', ())."""
    m = _ATOM.match(name)
    if not m:
        return (name, ())
    pred = m.group(1)
    args = tuple(a.strip() for a in m.group(2).split(",")) if m.group(2).strip() else ()
    return (pred, args)


def object_types(problem):
    """Infer a 'type' for every object from the set of (predicate, position)
    roles it plays. Objects with identical role-sets share a type."""
    roles = {}
    for name in problem.props:
        pred, args = parse_atom(name)
        for pos, obj in enumerate(args):
            roles.setdefault(obj, set()).add((pred, pos))
    return {obj: frozenset(r) for obj, r in roles.items()}


def objects_by_type(types):
    out = {}
    for obj, t in types.items():
        out.setdefault(t, []).append(obj)
    return out


# ---------------------------------------------------------------------------
# harvest / lift / reground
# ---------------------------------------------------------------------------
def harvest_reasons(pdr: PDR):
    """The reason cubes PDR learned (clauses beyond the initial goal+invariants)."""
    base = pdr.layers[0] if pdr.layers else set()
    goal = {frozenset((l,)) for l in pdr.p.goal_cube()}
    inv = {frozenset(c) for c in pdr.p.invariants}
    learned = base - goal - inv
    # a clause c == not(reason cube r);  r = { -l : l in c }
    return [frozenset(-l for l in c) for c in learned if c]


def lift_reason(reason_cube, problem):
    """Replace ground objects with typed variables (shared consistently)."""
    types = object_types(problem)
    var_of = {}
    lits = []
    for lit in reason_cube:
        name = problem.name_of(lit)
        pred, args = parse_atom(name)
        vargs = []
        for obj in args:
            if obj not in var_of:
                var_of[obj] = (f"?{len(var_of)}", types.get(obj))
            vargs.append(var_of[obj][0])
        lits.append((lit > 0, pred, tuple(vargs)))
    var_types = {v: t for v, t in var_of.values()}
    return (frozenset(lits), var_types)


def reground(lifted, target: Problem, cap=400):
    """All type-respecting injective substitutions of variables -> target objects."""
    pattern, var_types = lifted
    ttypes = object_types(target)
    by_type = objects_by_type(ttypes)
    variables = list(var_types)
    # candidate objects per variable (matching type), fall back to all objects
    cand = {v: by_type.get(var_types[v], list(ttypes)) for v in variables}
    out = []

    def emit(assign):
        cube = []
        for is_pos, pred, vargs in pattern:
            ground = pred + "(" + ",".join(assign[v] for v in vargs) + ")" if vargs else pred
            if ground not in target.prop_id:
                return None
            cube.append(target.lit(ground, is_pos))
        return frozenset(cube)

    # backtracking over injective assignments
    def rec(idx, assign, used):
        if len(out) >= cap:
            return
        if idx == len(variables):
            c = emit(assign)
            if c is not None and len(c) == len(pattern):
                out.append(c)
            return
        v = variables[idx]
        for obj in cand[v]:
            if obj in used:
                continue
            assign[v] = obj
            rec(idx + 1, assign, used | {obj})
            del assign[v]

    rec(0, {}, set())
    return out


def transfer_candidates(source_problem, reasons, target, cap_per_reason=200):
    cands = set()
    for r in reasons:
        lifted = lift_reason(r, source_problem)
        for g in reground(lifted, target, cap=cap_per_reason):
            cands.add(g)
    return list(cands)


# ---------------------------------------------------------------------------
# verify + seed
# ---------------------------------------------------------------------------
def verify_reason(target: Problem, reason_cube, layer0_clauses):
    """A reason is valid iff no state consistent with it can reach a goal state in
    one step: UNSAT(reason  &  T  &  L_0')."""
    q = Query(target, make_solver(), 1)
    q.add_layer(layer0_clauses, 1)
    return not q.solve(reason_cube, 0)     # UNSAT == valid reason


def make_seeded_pdr(target: Problem, candidates, **pdr_kwargs):
    """Return (pdr, stats) where pdr has every VERIFIED transferred reason already
    installed in layers L_0 and L_1."""
    pdr = PDR(target, **pdr_kwargs)
    l0 = set(pdr.layers[0])
    verified = 0
    t0 = time.perf_counter()
    pdr._ensure_layers(1)
    for r in candidates:
        if verify_reason(target, r, l0):
            clause = frozenset(-l for l in r)
            pdr.layers[0].add(clause)
            pdr.layers[1].add(clause)
            verified += 1
    stats = {"candidates": len(candidates), "verified": verified,
             "verify_time": time.perf_counter() - t0}
    return pdr, stats


def transfer(source_problem, target_problem, **pdr_kwargs):
    """End-to-end: solve the source, harvest+lift+reground+verify, return a
    target PDR pre-seeded with the verified reasons (plus transfer stats)."""
    src = PDR(source_problem, **pdr_kwargs)
    src.solve()
    reasons = harvest_reasons(src)
    cands = transfer_candidates(source_problem, reasons, target_problem)
    pdr, stats = make_seeded_pdr(target_problem, cands, **pdr_kwargs)
    stats["source_reasons"] = len(reasons)
    return pdr, stats


def main():
    from . import domains
    from .planning import validate_plan
    print("Verified reason transfer across a curriculum.\n")
    print("Headline property: SOUNDNESS. Every transferred reason is re-verified on")
    print("the target by SAT before it is trusted, so the answer can never change --")
    print("only the search can speed up. (Naive cross-instance transfer is unsound.)\n")
    pairs = [(domains.logistics(3, 2), domains.logistics(5, 3)),
             (domains.blocksworld(3), domains.blocksworld(5))]
    for src, tgt in pairs:
        base = PDR(tgt).solve()
        seeded, st = transfer(src, tgt)
        res = seeded.solve()
        ok = (res.solvable == base.solvable) and (
            not res.solvable or validate_plan(tgt, res.plan))
        sp = base.stats["sat_calls"] / max(1, res.stats["sat_calls"])
        print(f"{src.name:20s} -> {tgt.name:20s}: "
              f"{st['source_reasons']} reasons -> {st['candidates']} cands "
              f"-> {st['verified']} VERIFIED & seeded | "
              f"SAT {base.stats['sat_calls']}->{res.stats['sat_calls']} ({sp:.2f}x) | "
              f"answer preserved & valid: {ok}")
    print("\nNote: on these small, plan-rich benchmarks PDR derives few reasons, so")
    print("transfer is ~neutral. Its payoff grows with scale and with dead-end-heavy")
    print("regimes (unsolvability proofs, combinatorial bottlenecks) -- the value is")
    print("the SOUND mechanism that lets a curriculum compound safely.")


if __name__ == "__main__":
    main()
