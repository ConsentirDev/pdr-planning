"""
A PDDL front-end: parse + ground standard PDDL into our `Problem` / `FONDProblem`.

This is the "front-end" the toolkit was missing -- it lets the solvers (and the
visual app) ingest real, standard planning problems instead of only the
programmatic generators in `domains.py`.

Scope: STRIPS + `:typing` + `:negative-preconditions` + `:equality` (the
`(not (= ?x ?y))` idiom) + FOND `oneof` effects. That covers the classic IPC
Logistics / Blocksworld families and the FOND clumsy-robot domains. It targets
the clean `planning.py` boundary and touches no solver code.

Ground atoms are named `pred(arg1,arg2)` to match the rest of the toolkit (and
the trace render hints), so a parsed problem renders and solves identically to a
hand-built one.

    from pdr.pddl import parse_problem
    prob = parse_problem(domain_text, problem_text)   # -> Problem or FONDProblem
"""

from __future__ import annotations

import re
from itertools import product

from .planning import Problem, Action, FONDProblem, FONDAction


# ---------------------------------------------------------------------------
# s-expression reader
# ---------------------------------------------------------------------------
def tokenize(text):
    text = re.sub(r";[^\n]*", "", text)            # strip ; line comments
    return text.replace("(", " ( ").replace(")", " ) ").split()


def read_sexpr(tokens):
    """Parse one fully-parenthesised s-expression into nested lists/strings."""
    if not tokens:
        raise ValueError("unexpected EOF while reading PDDL")
    tok = tokens.pop(0)
    if tok == "(":
        lst = []
        while tokens and tokens[0] != ")":
            lst.append(read_sexpr(tokens))
        if not tokens:
            raise ValueError("missing ')' in PDDL")
        tokens.pop(0)                              # drop ')'
        return lst
    if tok == ")":
        raise ValueError("unexpected ')' in PDDL")
    return tok.lower()


def _sections(body):
    """Map ':keyword' -> the s-expr following it, for a (define ...) body."""
    out = {}
    for item in body:
        if isinstance(item, list) and item and isinstance(item[0], str) \
                and item[0].startswith(":"):
            out.setdefault(item[0], []).append(item)
    return out


# ---------------------------------------------------------------------------
# typed-list helper:  (?x ?y - block ?z - table)  /  (a b - loc c - truck)
# ---------------------------------------------------------------------------
def parse_typed_list(items):
    """Return [(name, type|None), ...] honouring `- type` annotations."""
    out = []
    pending = []
    i = 0
    while i < len(items):
        it = items[i]
        if it == "-":
            typ = items[i + 1]
            for p in pending:
                out.append((p, typ))
            pending = []
            i += 2
        else:
            pending.append(it)
            i += 1
    for p in pending:
        out.append((p, None))
    return out


# ---------------------------------------------------------------------------
# atom naming + effect/precondition walking
# ---------------------------------------------------------------------------
def atom_name(pred, args):
    return f"{pred}({','.join(args)})" if args else pred


def _bind(args, sub):
    return [sub.get(a, a) for a in args]


def _walk_literals(expr, sub, out, equality):
    """Collect literals from a precondition/effect conjunction into `out`
    ({name: bool}). Returns False if an (= ...) / (not (= ...)) constraint in a
    precondition is violated under `sub` (so the binding should be skipped)."""
    if not expr:
        return True
    head = expr[0]
    if head == "and":
        return all(_walk_literals(e, sub, out, equality) for e in expr[1:])
    if head == "not":
        inner = expr[1]
        if inner[0] == "=":                        # (not (= ?x ?y)) binding filter
            a, b = sub.get(inner[1], inner[1]), sub.get(inner[2], inner[2])
            return a != b
        pred, args = inner[0], _bind(inner[1:], sub)
        out[atom_name(pred, args)] = False
        return True
    if head == "=":                                # (= ?x ?y) binding filter
        a, b = sub.get(expr[1], expr[1]), sub.get(expr[2], expr[2])
        return a == b
    # a positive atom
    pred, args = head, _bind(expr[1:], sub)
    out[atom_name(pred, args)] = True
    return True


def _ground_effect(expr, sub):
    """Return a list of outcome dicts. `oneof` -> several; otherwise one."""
    det = {}
    branches = []     # list of dicts, one per oneof branch

    def visit(e):
        if not e:
            return
        if e[0] == "and":
            for sub_e in e[1:]:
                visit(sub_e)
        elif e[0] == "oneof":
            for opt in e[1:]:
                d = {}
                _walk_literals(opt, sub, d, True)
                branches.append(d)
        else:
            _walk_literals(e, sub, det, True)

    visit(expr)
    if not branches:
        return [det]
    return [{**det, **b} for b in branches]


# ---------------------------------------------------------------------------
# domain + problem parsing
# ---------------------------------------------------------------------------
class _Domain:
    def __init__(self, text):
        toks = tokenize(text)
        tree = read_sexpr(toks)
        assert tree[0] == "define"
        body = tree[1:]
        secs = _sections(body)
        # type hierarchy (child -> parent)
        self.parent = {}
        for sec in secs.get(":types", []):
            for name, par in parse_typed_list(sec[1:]):
                self.parent[name] = par
        # constants (rare) -> typed objects available to every problem
        self.constants = []
        for sec in secs.get(":constants", []):
            self.constants += parse_typed_list(sec[1:])
        # action schemas
        self.actions = []
        for item in body:
            if isinstance(item, list) and item and item[0] == ":action":
                self.actions.append(self._action(item))

    def _action(self, item):
        name = item[1]
        params, pre, eff = [], ["and"], ["and"]
        i = 2
        while i < len(item):
            key = item[i]
            val = item[i + 1]
            if key == ":parameters":
                params = parse_typed_list(val)
            elif key == ":precondition":
                pre = val
            elif key == ":effect":
                eff = val
            i += 2
        return {"name": name, "params": params, "pre": pre, "eff": eff}

    def supertypes(self, t):
        out = set()
        while t is not None and t not in out:
            out.add(t)
            t = self.parent.get(t)
        return out


def _object_types(objs, parent):
    """obj -> set of types it satisfies (including supertypes and 'object')."""
    out = {}
    for name, typ in objs:
        types = {"object"}
        t = typ
        while t is not None:
            types.add(t)
            t = parent.get(t)
        out[name] = types
    return out


def parse_problem(domain_text, problem_text):
    """Parse + ground a PDDL domain+problem into a Problem (or FONDProblem)."""
    dom = _Domain(domain_text)
    toks = tokenize(problem_text)
    tree = read_sexpr(toks)
    body = tree[1:]

    name = "pddl-problem"
    objs = list(dom.constants)
    init_atoms, goal_expr = [], ["and"]
    for item in body:
        if not isinstance(item, list):
            continue
        if item[0] == "problem":
            name = item[1]
        elif item[0] == ":objects":
            objs += parse_typed_list(item[1:])
        elif item[0] == ":init":
            init_atoms = item[1:]
        elif item[0] == ":goal":
            goal_expr = item[1]

    obj_types = _object_types(objs, dom.parent)
    objs_of = {}                                   # type -> [objects]
    for o, types in obj_types.items():
        for t in types:
            objs_of.setdefault(t, []).append(o)

    # ---- ground every action schema over type-respecting bindings ----
    ground_actions = []
    is_fond = False
    for sch in dom.actions:
        param_names = [p for p, _ in sch["params"]]
        choices = [objs_of.get(t or "object", []) for _, t in sch["params"]]
        for combo in product(*choices) if choices else [()]:
            sub = dict(zip(param_names, combo))
            pre = {}
            if not _walk_literals(sch["pre"], sub, pre, True):
                continue                           # binding filtered by (= )/(not (= ))
            outcomes = _ground_effect(sch["eff"], sub)
            gname = atom_name(sch["name"], list(combo))
            if len(outcomes) > 1:
                is_fond = True
            ground_actions.append((gname, pre, outcomes))

    # ---- collect propositions (atoms mentioned anywhere) ----
    props = set()
    for gname, pre, outcomes in ground_actions:
        props |= set(pre)
        for o in outcomes:
            props |= set(o)
    init_set = {atom_name(a[0], a[1:]) for a in init_atoms}
    props |= init_set
    goal = {}
    _walk_literals(goal_expr, {}, goal, True)
    props |= set(goal)
    props = sorted(props)

    init = {p: (p in init_set) for p in props}     # closed-world

    # ---- build the planning problem ----
    if is_fond:
        actions = [FONDAction(gn, pre, tuple(outs)) for gn, pre, outs in ground_actions]
        prob = FONDProblem(props, actions, init, goal, name=name)
    else:
        actions = [Action(gn, pre, outs[0]) for gn, pre, outs in ground_actions]
        prob = Problem(props, actions, init, goal, name=name)
    return prob


# Ready sample domains the UI can offer out of the box (each verified to
# parse + ground + solve). {key: {"label","kind","domain","problem"}}.
SAMPLES = {
    "logistics": {
        "label": "Logistics (classical)",
        "kind": "classical",
        "domain": """(define (domain logistics)
 (:requirements :strips :typing :equality)
 (:types loc pkg truck)
 (:predicates (atp ?p - pkg ?l - loc) (att ?t - truck ?l - loc) (inn ?p - pkg ?t - truck))
 (:action drive :parameters (?t - truck ?from - loc ?to - loc)
   :precondition (and (att ?t ?from) (not (= ?from ?to)))
   :effect (and (not (att ?t ?from)) (att ?t ?to)))
 (:action load :parameters (?t - truck ?p - pkg ?l - loc)
   :precondition (and (atp ?p ?l) (att ?t ?l))
   :effect (and (not (atp ?p ?l)) (inn ?p ?t)))
 (:action unload :parameters (?t - truck ?p - pkg ?l - loc)
   :precondition (and (inn ?p ?t) (att ?t ?l))
   :effect (and (atp ?p ?l) (not (inn ?p ?t)))))""",
        "problem": """(define (problem log1) (:domain logistics)
 (:objects p0 p1 - pkg l0 l1 l2 - loc t0 - truck)
 (:init (atp p0 l0) (atp p1 l0) (att t0 l0))
 (:goal (and (atp p0 l2) (atp p1 l2))))""",
    },
    "blocksworld": {
        "label": "Blocksworld (classical)",
        "kind": "classical",
        "domain": """(define (domain blocks)
 (:requirements :strips :typing :equality)
 (:types block)
 (:predicates (on ?x - block ?y - block) (ontable ?b - block) (clear ?b - block)
              (holding ?b - block) (handempty))
 (:action pickup :parameters (?b - block)
   :precondition (and (ontable ?b) (clear ?b) (handempty))
   :effect (and (not (ontable ?b)) (not (clear ?b)) (not (handempty)) (holding ?b)))
 (:action putdown :parameters (?b - block)
   :precondition (holding ?b)
   :effect (and (ontable ?b) (clear ?b) (handempty) (not (holding ?b))))
 (:action stack :parameters (?x - block ?y - block)
   :precondition (and (holding ?x) (clear ?y) (not (= ?x ?y)))
   :effect (and (not (holding ?x)) (not (clear ?y)) (clear ?x) (handempty) (on ?x ?y)))
 (:action unstack :parameters (?x - block ?y - block)
   :precondition (and (on ?x ?y) (clear ?x) (handempty) (not (= ?x ?y)))
   :effect (and (holding ?x) (not (clear ?x)) (clear ?y) (not (on ?x ?y)) (not (handempty)))))""",
        "problem": """(define (problem bw1) (:domain blocks)
 (:objects b0 b1 b2 - block)
 (:init (ontable b0) (ontable b1) (ontable b2) (clear b0) (clear b1) (clear b2) (handempty))
 (:goal (and (on b0 b1) (on b1 b2))))""",
    },
    "clumsy": {
        "label": "Clumsy Blocksworld (FOND)",
        "kind": "fond",
        "domain": """(define (domain clumsy)
 (:requirements :strips :typing :equality :non-deterministic)
 (:types block)
 (:predicates (on ?x - block ?y - block) (ontable ?b - block) (clear ?b - block)
              (holding ?b - block) (handempty))
 (:action pickup :parameters (?b - block)
   :precondition (and (ontable ?b) (clear ?b) (handempty))
   :effect (oneof (and (not (ontable ?b)) (not (clear ?b)) (not (handempty)) (holding ?b))
                  (and)))
 (:action putdown :parameters (?b - block)
   :precondition (holding ?b)
   :effect (and (ontable ?b) (clear ?b) (handempty) (not (holding ?b))))
 (:action stack :parameters (?x - block ?y - block)
   :precondition (and (holding ?x) (clear ?y) (not (= ?x ?y)))
   :effect (oneof (and (not (holding ?x)) (not (clear ?y)) (clear ?x) (handempty) (on ?x ?y))
                  (and (not (holding ?x)) (clear ?x) (handempty) (ontable ?x)))))""",
        "problem": """(define (problem c1) (:domain clumsy)
 (:objects b0 b1 - block)
 (:init (ontable b0) (ontable b1) (clear b0) (clear b1) (handempty))
 (:goal (on b0 b1)))""",
    },
}

