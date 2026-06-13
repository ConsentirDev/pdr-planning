"""
The planning problem (Section 2.2 of the thesis).

A classical planning problem is a tuple <X, A, I, G>:

    X : a set of propositions      -- yes/no facts about the world
    A : a set of actions           -- each with a precondition and an effect
    I : the initial state          -- a full yes/no assignment to every fact
    G : the goal condition         -- the facts we want to be true at the end

A *plan* is a sequence of actions that turns I into a state satisfying G.

Propositions are referred to by name (a string). Internally each name also has
an integer id (1..|X|); a signed id is an "abstract literal":
    +id  means "this fact is TRUE"
    -id  means "this fact is FALSE"
A *cube* / partial state is a frozenset of abstract literals. A *full state*
has exactly one literal per proposition.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Action:
    name: str
    pre: dict          # proposition name -> bool (required values)
    eff: dict          # proposition name -> bool (resulting values)


class Problem:
    def __init__(self, props, actions, init, goal, invariants=None, name="problem"):
        self.name = name
        self.props = list(props)                       # ordered names
        self.prop_id = {p: i + 1 for i, p in enumerate(self.props)}
        self.actions = list(actions)
        self.init = dict(init)                          # full assignment
        self.goal = dict(goal)                          # partial assignment
        # invariants: list of clauses, each a tuple of abstract literals.
        self.invariants = list(invariants or [])
        self._validate()

    # -- helpers to move between names and abstract literals ----------------
    def lit(self, name, sign=True):
        """Abstract literal: +id if sign else -id."""
        i = self.prop_id[name]
        return i if sign else -i

    def name_of(self, abstract_lit):
        return self.props[abs(abstract_lit) - 1]

    def cube(self, assignment):
        """Turn a {name: bool} dict into a frozenset of abstract literals."""
        return frozenset(self.lit(n, v) for n, v in assignment.items())

    def init_cube(self):
        return self.cube(self.init)

    def goal_cube(self):
        return self.cube(self.goal)

    # -- concrete semantics, used only to *validate* extracted plans --------
    def applicable(self, state, action):
        return all(state.get(n) == v for n, v in action.pre.items())

    def apply(self, state, action):
        s = dict(state)
        s.update(action.eff)
        return s

    def satisfies_goal(self, state):
        return all(state.get(n) == v for n, v in self.goal.items())

    def _validate(self):
        for n in self.init:
            assert n in self.prop_id, f"init mentions unknown prop {n}"
        for n in self.goal:
            assert n in self.prop_id, f"goal mentions unknown prop {n}"
        # init must be a full state.
        assert set(self.init) == set(self.props), "init must assign every prop"
        for a in self.actions:
            for n in list(a.pre) + list(a.eff):
                assert n in self.prop_id, f"action {a.name} mentions unknown prop {n}"


# ----------------------------------------------------------------------------
# Action interaction (needed for the forall-step encoding, Schema 4).
# ----------------------------------------------------------------------------
def conflict(a: Action, b: Action) -> bool:
    """Effects disagree on some proposition (cannot both happen)."""
    for n, v in a.eff.items():
        if n in b.eff and b.eff[n] != v:
            return True
    return False


def interfere(a: Action, b: Action) -> bool:
    """One action's effect contradicts the other's precondition."""
    for n, v in a.eff.items():
        if n in b.pre and b.pre[n] != v:
            return True
    for n, v in b.eff.items():
        if n in a.pre and a.pre[n] != v:
            return True
    return False


# ----------------------------------------------------------------------------
# FOND (Fully Observable Non-Deterministic) planning -- Section 2.3.
# ----------------------------------------------------------------------------
@dataclass(frozen=True)
class FONDAction:
    """An action with ONE precondition but SEVERAL possible outcomes. When the
    action runs, nature picks one outcome (we don't control which). `outcomes`
    is a list of effect-dicts."""
    name: str
    pre: dict
    outcomes: tuple   # tuple of {name: bool} effect dicts


class FONDProblem:
    def __init__(self, props, actions, init, goal, invariants=None, name="fond"):
        self.name = name
        self.props = list(props)
        self.prop_id = {p: i + 1 for i, p in enumerate(self.props)}
        self.actions = list(actions)
        self.init = dict(init)
        self.goal = dict(goal)
        self.invariants = list(invariants or [])
        self.max_outcomes = max((len(a.outcomes) for a in self.actions), default=1)

    # name <-> abstract literal helpers (shared with classical Problem)
    def lit(self, name, sign=True):
        i = self.prop_id[name]
        return i if sign else -i

    def name_of(self, abstract_lit):
        return self.props[abs(abstract_lit) - 1]

    def cube(self, assignment):
        return frozenset(self.lit(n, v) for n, v in assignment.items())

    def init_cube(self):
        return self.cube(self.init)

    def goal_cube(self):
        return self.cube(self.goal)

    def state_dict(self, cube):
        """frozenset of abstract literals (full state) -> {name: bool}."""
        return {self.props[abs(l) - 1]: (l > 0) for l in cube}

    # concrete semantics
    def applicable(self, state, action):
        return all(state.get(n) == v for n, v in action.pre.items())

    def succ(self, state, action, outcome_idx):
        s = dict(state)
        s.update(action.outcomes[outcome_idx])
        return s

    def all_succ(self, state, action):
        return [self.succ(state, action, i) for i in range(len(action.outcomes))]

    def satisfies_goal(self, state):
        return all(state.get(n) == v for n, v in self.goal.items())


def validate_policy(problem: FONDProblem, policy) -> bool:
    """Check `policy` (a dict {state-frozenset: action_index}) is a valid strong
    cyclic policy for the initial state: from I, following the policy, EVERY
    reachable state can still reach a goal (no dead ends), and goal states are
    sinks. We verify by (a) closure: every non-goal reachable state has a policy
    action whose every outcome is also covered, and (b) liveness: from every
    covered state a goal is reachable through policy edges.
    """
    init = problem.init_cube()
    # explore states reachable under the policy
    covered = set()
    frontier = [init]
    while frontier:
        s = frontier.pop()
        if s in covered:
            continue
        sd = problem.state_dict(s)
        if problem.satisfies_goal(sd):
            covered.add(s)
            continue
        if s not in policy:
            return False  # non-goal reachable state with no prescribed action
        a = problem.actions[policy[s]]
        if not problem.applicable(sd, a):
            return False
        covered.add(s)
        for nd in problem.all_succ(sd, a):
            frontier.append(problem.cube(nd))
    # liveness: every covered state must reach a goal through policy edges
    goal_states = {s for s in covered
                   if problem.satisfies_goal(problem.state_dict(s))}
    can_reach = set(goal_states)
    changed = True
    while changed:
        changed = False
        for s in covered:
            if s in can_reach:
                continue
            if s in policy:
                a = problem.actions[policy[s]]
                outs = [problem.cube(nd)
                        for nd in problem.all_succ(problem.state_dict(s), a)]
                if any(o in can_reach for o in outs):
                    can_reach.add(s)
                    changed = True
    return init in can_reach


def validate_plan(problem: Problem, parallel_plan) -> bool:
    """Replay a plan (a list of *sets of action indices*, one set per step) on
    the concrete initial state and check the goal is reached. The forall-step
    encoding allows several non-interfering actions per step; we apply them all.
    """
    state = dict(problem.init)
    for step in parallel_plan:
        acts = [problem.actions[i] for i in step]
        for a in acts:
            if not problem.applicable(state, a):
                return False
        # Non-interfering actions commute, so order does not matter.
        for a in acts:
            state = problem.apply(state, a)
    return problem.satisfies_goal(state)
