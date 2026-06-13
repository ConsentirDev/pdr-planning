"""
Benchmark domains.

* Logistics  -- the thesis's running example (Example 1/4): trucks drive between
                locations, packages are loaded/unloaded. Parametric in the number
                of locations and packages.
* Blocksworld -- the classic STRIPS 4-action blocksworld: build a tower.

Every domain ships with *mutex invariants* (Schema 5): binary clauses that hold
in every reachable state (e.g. "a package is in at most one place"). They are not
needed for correctness but make the SAT calls much easier. Only provably-true
invariants are included -- a false "invariant" would prune real states and make
the planner unsound.

Each builder returns a `Problem`. `lit(name, sign)` style invariants are encoded
as tuples of abstract literals straight against the problem's proposition ids,
so invariants are built after the proposition list is known.
"""

from __future__ import annotations

from itertools import combinations

from .planning import Action, Problem


# ----------------------------------------------------------------------------
# Logistics
# ----------------------------------------------------------------------------
def logistics(n_locs=2, n_pkgs=2, goal_loc=None, truck_goal=False, name=None):
    locs = [f"L{j}" for j in range(n_locs)]
    pkgs = [f"P{j}" for j in range(n_pkgs)]
    T = "T"
    goal_loc = goal_loc if goal_loc is not None else n_locs - 1

    def at(o, l):
        return f"at({o},{l})"

    def inn(pk):
        return f"in({pk},{T})"

    props = []
    for pk in pkgs:
        for l in locs:
            props.append(at(pk, l))
        props.append(inn(pk))
    for l in locs:
        props.append(at(T, l))

    actions = []
    # drive(T, la, lb)
    for la in locs:
        for lb in locs:
            if la == lb:
                continue
            actions.append(Action(f"drive({T},{la},{lb})",
                                   pre={at(T, la): True},
                                   eff={at(T, la): False, at(T, lb): True}))
    # load / unload
    for pk in pkgs:
        for l in locs:
            actions.append(Action(f"load({T},{pk},{l})",
                                   pre={at(pk, l): True, at(T, l): True},
                                   eff={at(pk, l): False, inn(pk): True}))
            actions.append(Action(f"unload({T},{pk},{l})",
                                   pre={inn(pk): True, at(T, l): True},
                                   eff={at(pk, l): True, inn(pk): False}))

    init = {pname: False for pname in props}
    for pk in pkgs:
        init[at(pk, locs[0])] = True
    init[at(T, locs[0])] = True

    goal = {at(pk, locs[goal_loc]): True for pk in pkgs}
    if truck_goal:
        goal[at(T, locs[goal_loc])] = True

    prob = Problem(props, actions, init, goal, name=name or
                   f"logistics-{n_locs}loc-{n_pkgs}pkg")
    prob.invariants = _logistics_invariants(prob, pkgs, locs, T, at, inn)
    return prob


def _logistics_invariants(prob, pkgs, locs, T, at, inn):
    L = prob.lit
    inv = []
    # package in at most one location
    for pk in pkgs:
        for la, lb in combinations(locs, 2):
            inv.append((L(at(pk, la), False), L(at(pk, lb), False)))
        # package not at a location while in the truck
        for l in locs:
            inv.append((L(at(pk, l), False), L(inn(pk), False)))
    # truck in at most one location
    for la, lb in combinations(locs, 2):
        inv.append((L(at(T, la), False), L(at(T, lb), False)))
    return inv


def unsolvable_logistics():
    """A deliberately impossible instance: a package must move but there are no
    load/unload actions, so it can never leave its start location."""
    p = logistics(n_locs=2, n_pkgs=1, name="logistics-unsolvable")
    p.actions = [a for a in p.actions if a.name.startswith("drive")]
    return p


def fuel_logistics(n_fuel=2, name=None):
    """Thesis Example 8: 2 locations, 1 package, 1 truck, limited fuel.

    The truck can only drive `n_fuel` times. Decomposing per-chunk makes the
    package sub-plan and the truck sub-plan each want to drive, but there isn't
    enough fuel for both -- so PD-PDR's glue fails, identifies a fuel unit as the
    problematic proposition, MERGES the truck+package chunks, and re-solves.
    """
    locs = ["L0", "L1"]
    P, T = "P", "T"

    def at(o, l):
        return f"at({o},{l})"

    inn = f"in({P},{T})"
    fuels = [f"fuel{j}({T})" for j in range(1, n_fuel + 1)]

    props = [at(P, "L0"), at(P, "L1"), inn, at(T, "L0"), at(T, "L1")] + fuels

    actions = []
    for la, lb in [("L0", "L1"), ("L1", "L0")]:
        for f in fuels:                      # one drive action per fuel unit
            actions.append(Action(f"drive({T},{la},{lb},{f})",
                                  pre={at(T, la): True, f: True},
                                  eff={at(T, la): False, at(T, lb): True, f: False}))
    for l in locs:
        actions.append(Action(f"load({T},{P},{l})",
                              pre={at(P, l): True, at(T, l): True},
                              eff={at(P, l): False, inn: True}))
        actions.append(Action(f"unload({T},{P},{l})",
                              pre={inn: True, at(T, l): True},
                              eff={at(P, l): True, inn: False}))

    init = {pn: False for pn in props}
    init[at(P, "L0")] = True
    init[at(T, "L0")] = True
    for f in fuels:
        init[f] = True
    goal = {at(P, "L1"): True, at(T, "L1"): True}

    prob = Problem(props, actions, init, goal, name=name or f"fuel-logistics-{n_fuel}")
    L = prob.lit
    inv = [(L(at(P, "L0"), False), L(at(P, "L1"), False)),
           (L(at(P, "L0"), False), L(inn, False)),
           (L(at(P, "L1"), False), L(inn, False)),
           (L(at(T, "L0"), False), L(at(T, "L1"), False))]
    prob.invariants = inv
    return prob


# ----------------------------------------------------------------------------
# Blocksworld (classic STRIPS)
# ----------------------------------------------------------------------------
def blocksworld(n_blocks=3, goal_tower=None, name=None):
    blocks = [f"b{i}" for i in range(n_blocks)]

    def on(x, y):
        return f"on({x},{y})"

    def ontable(x):
        return f"ontable({x})"

    def clear(x):
        return f"clear({x})"

    def holding(x):
        return f"holding({x})"

    HE = "handempty"

    props = [HE]
    for b in blocks:
        props += [ontable(b), clear(b), holding(b)]
    for x in blocks:
        for y in blocks:
            if x != y:
                props.append(on(x, y))

    actions = []
    for b in blocks:
        actions.append(Action(f"pickup({b})",
                              pre={ontable(b): True, clear(b): True, HE: True},
                              eff={ontable(b): False, clear(b): False, HE: False,
                                   holding(b): True}))
        actions.append(Action(f"putdown({b})",
                              pre={holding(b): True},
                              eff={holding(b): False, ontable(b): True,
                                   clear(b): True, HE: True}))
    for x in blocks:
        for y in blocks:
            if x == y:
                continue
            actions.append(Action(f"stack({x},{y})",
                                  pre={holding(x): True, clear(y): True},
                                  eff={holding(x): False, clear(y): False,
                                       clear(x): True, HE: True, on(x, y): True}))
            actions.append(Action(f"unstack({x},{y})",
                                  pre={on(x, y): True, clear(x): True, HE: True},
                                  eff={on(x, y): False, clear(x): False,
                                       clear(y): True, holding(x): True, HE: False}))

    init = {pname: False for pname in props}
    init[HE] = True
    for b in blocks:
        init[ontable(b)] = True
        init[clear(b)] = True

    # Default goal: a single tower b0 on b1 on b2 ... (b0 at top).
    if goal_tower is None:
        goal_tower = blocks
    goal = {}
    for i in range(len(goal_tower) - 1):
        goal[on(goal_tower[i], goal_tower[i + 1])] = True

    prob = Problem(props, actions, init, goal, name=name or
                   f"blocksworld-{n_blocks}")
    prob.invariants = _blocks_invariants(prob, blocks, on, ontable, clear,
                                          holding, HE)
    return prob


def _blocks_invariants(prob, blocks, on, ontable, clear, holding, HE):
    L = prob.lit
    inv = []
    for b in blocks:
        inv.append((L(holding(b), False), L(HE, False)))       # holding -> hand not empty
        inv.append((L(holding(b), False), L(ontable(b), False)))
        inv.append((L(holding(b), False), L(clear(b), False)))
    for a, b in combinations(blocks, 2):
        inv.append((L(holding(a), False), L(holding(b), False)))  # hold <= 1
    for x in blocks:
        for y in blocks:
            if x == y:
                continue
            inv.append((L(on(x, y), False), L(ontable(x), False)))
            inv.append((L(on(x, y), False), L(clear(y), False)))
            inv.append((L(on(x, y), False), L(holding(x), False)))
            inv.append((L(on(x, y), False), L(holding(y), False)))
            inv.append((L(on(y, x), False), L(holding(x), False)))
        # b on at most one block; at most one block on b
        for y, z in combinations([c for c in blocks if c != x], 2):
            inv.append((L(on(x, y), False), L(on(x, z), False)))
            inv.append((L(on(y, x), False), L(on(z, x), False)))
    return inv


# ----------------------------------------------------------------------------
# FOND domains (Chapter 6)
# ----------------------------------------------------------------------------
from .planning import FONDAction, FONDProblem  # noqa: E402


def _clumsy_common(blocks):
    def on(x, y): return f"on({x},{y})"
    def ontable(x): return f"ontable({x})"
    def clear(x): return f"clear({x})"
    def holding(x): return f"holding({x})"
    HE = "handempty"

    props = [HE]
    for b in blocks:
        props += [ontable(b), clear(b), holding(b)]
    for x in blocks:
        for y in blocks:
            if x != y:
                props.append(on(x, y))

    actions = []
    for b in blocks:
        # clumsy pickup: success -> holding; failure -> block stays on table.
        actions.append(FONDAction(
            f"pickup({b})",
            pre={ontable(b): True, clear(b): True, HE: True},
            outcomes=(
                {ontable(b): False, clear(b): False, HE: False, holding(b): True},
                {ontable(b): True, clear(b): True, HE: True, holding(b): False},
            )))
        # deterministic putdown
        actions.append(FONDAction(
            f"putdown({b})",
            pre={holding(b): True},
            outcomes=({holding(b): False, ontable(b): True, clear(b): True, HE: True},)))
    for x in blocks:
        for y in blocks:
            if x == y:
                continue
            # clumsy stack: success -> on(x,y); failure -> x dropped on table.
            actions.append(FONDAction(
                f"stack({x},{y})",
                pre={holding(x): True, clear(y): True},
                outcomes=(
                    {holding(x): False, clear(y): False, clear(x): True,
                     HE: True, on(x, y): True},
                    {holding(x): False, clear(x): True, HE: True, ontable(x): True},
                )))
    return props, actions, on, ontable, clear, holding, HE


def _clumsy_invariants(prob, blocks, on, ontable, clear, holding, HE):
    L = prob.lit
    inv = []
    for b in blocks:
        inv.append((L(holding(b), False), L(HE, False)))
        inv.append((L(holding(b), False), L(ontable(b), False)))
        inv.append((L(holding(b), False), L(clear(b), False)))
    for a, b in combinations(blocks, 2):
        inv.append((L(holding(a), False), L(holding(b), False)))
    for x in blocks:
        for y in blocks:
            if x == y:
                continue
            inv.append((L(on(x, y), False), L(ontable(x), False)))
            inv.append((L(on(x, y), False), L(clear(y), False)))
            inv.append((L(on(x, y), False), L(holding(x), False)))
            inv.append((L(on(x, y), False), L(holding(y), False)))
        for y, z in combinations([c for c in blocks if c != x], 2):
            inv.append((L(on(x, y), False), L(on(x, z), False)))
            inv.append((L(on(y, x), False), L(on(z, x), False)))
    return inv


def clumsy_blocksworld(n_blocks=3, name=None):
    """A clumsy robot building a tower: every pickup/stack may instead drop the
    block on the table. A *strong cyclic* policy exists -- keep trying and, under
    fairness, the tower eventually gets built."""
    blocks = [f"b{i}" for i in range(n_blocks)]
    props, actions, on, ontable, clear, holding, HE = _clumsy_common(blocks)
    init = {pn: False for pn in props}
    init[HE] = True
    for b in blocks:
        init[ontable(b)] = True
        init[clear(b)] = True
    goal = {on(blocks[i], blocks[i + 1]): True for i in range(n_blocks - 1)}
    prob = FONDProblem(props, actions, init, goal, name=name or f"clumsy-blocks-{n_blocks}")
    prob.invariants = _clumsy_invariants(prob, blocks, on, ontable, clear, holding, HE)
    return prob


def clumsy_blocksworld_thesis():
    """The exact 3-block instance from thesis Examples 2 & 9: blocks to/from/move,
    move starts on from, goal is move on to."""
    blocks = ["to", "from", "move"]
    props, actions, on, ontable, clear, holding, HE = _clumsy_common(blocks)
    init = {pn: False for pn in props}
    init[HE] = True
    init[ontable("to")] = True
    init[ontable("from")] = True
    init[on("move", "from")] = True
    init[clear("to")] = True
    init[clear("move")] = True
    # add unstack so move can be taken off from
    for x in blocks:
        for y in blocks:
            if x != y:
                actions.append(FONDAction(
                    f"unstack({x},{y})",
                    pre={on(x, y): True, clear(x): True, HE: True},
                    outcomes=(
                        {on(x, y): False, clear(y): True, clear(x): False,
                         HE: False, holding(x): True},
                        {on(x, y): False, clear(y): True, clear(x): True,
                         HE: True, ontable(x): True},
                    )))
    goal = {on("move", "to"): True}
    prob = FONDProblem(props, actions, init, goal, name="clumsy-blocks-thesis")
    prob.invariants = _clumsy_invariants(prob, blocks, on, ontable, clear, holding, HE)
    return prob


def escher_blocksworld(n_blocks=3, name=None):
    """Thesis Sec 6.6: an IMPOSSIBLE goal -- a circular tower (b1 on b0, b2 on b1,
    ..., and b0 on b_{n-1}). No policy exists; FOND-PDR proves it."""
    blocks = [f"b{i}" for i in range(n_blocks)]
    props, actions, on, ontable, clear, holding, HE = _clumsy_common(blocks)
    init = {pn: False for pn in props}
    init[HE] = True
    for b in blocks:
        init[ontable(b)] = True
        init[clear(b)] = True
    goal = {on(blocks[(i + 1) % n_blocks], blocks[i]): True for i in range(n_blocks)}
    prob = FONDProblem(props, actions, init, goal, name=name or f"escher-blocks-{n_blocks}")
    prob.invariants = _clumsy_invariants(prob, blocks, on, ontable, clear, holding, HE)
    return prob


ALL_DOMAINS = {
    "logistics": logistics,
    "blocksworld": blocksworld,
}

FOND_DOMAINS = {
    "clumsy": clumsy_blocksworld,
    "escher": escher_blocksworld,
}
