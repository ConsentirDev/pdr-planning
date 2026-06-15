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
# static analysis helpers (predicate-typed STRIPS support + grounding pruning)
# ---------------------------------------------------------------------------
def _effect_preds(expr, out):
    """Collect predicate heads that appear in an effect (=> they are fluent)."""
    if not expr:
        return
    h = expr[0]
    if h in ("and", "oneof"):
        for e in expr[1:]:
            _effect_preds(e, out)
    elif h == "not":
        _effect_preds(expr[1], out)
    elif h != "=":
        out.add(h)


def _param_domains(sch, fluent_preds, static_by_pred, objs_of, all_objs):
    """Each parameter's candidate objects, restricted by its declared :type AND
    by any static UNARY precondition `(type ?param)`. This is what makes a real
    predicate-typed domain ground in milliseconds instead of exploding."""
    doms = {}
    for p, t in sch["params"]:
        doms[p] = set(objs_of[t]) if (t and t in objs_of) else set(all_objs)

    def visit(e):
        if not e:
            return
        h = e[0]
        if h == "and":
            for x in e[1:]:
                visit(x)
        elif h in ("not", "="):
            return
        elif h not in fluent_preds and len(e) == 2 and e[1] in doms:
            allowed = {args[0] for args in static_by_pred.get(h, ())}
            doms[e[1]] &= allowed

    visit(sch["pre"])
    return {p: sorted(doms[p]) for p in doms}


def _ground_pre(expr, sub, fluent_preds, static_facts, out):
    """Ground a precondition. Static literals act as binding FILTERS (checked
    against the initial state) and are dropped; fluent literals are collected
    into `out` ({name: bool}). Returns False if the binding is filtered out."""
    if not expr:
        return True
    h = expr[0]
    if h == "and":
        return all(_ground_pre(e, sub, fluent_preds, static_facts, out) for e in expr[1:])
    if h == "not":
        inner = expr[1]
        if inner[0] == "=":
            return sub.get(inner[1], inner[1]) != sub.get(inner[2], inner[2])
        pred, args = inner[0], _bind(inner[1:], sub)
        nm = atom_name(pred, args)
        if pred in fluent_preds:
            out[nm] = False
            return True
        return nm not in static_facts            # static negative: must be absent
    if h == "=":
        return sub.get(expr[1], expr[1]) == sub.get(expr[2], expr[2])
    pred, args = h, _bind(expr[1:], sub)
    nm = atom_name(pred, args)
    if pred in fluent_preds:
        out[nm] = True
        return True
    return nm in static_facts                    # static positive: must hold in init


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
    all_objs = list(obj_types)
    for o, types in obj_types.items():
        for t in types:
            objs_of.setdefault(t, []).append(o)

    # ---- static analysis (crucial for real :strips/predicate-typed domains) ----
    # A predicate is FLUENT if it appears in any action effect; otherwise STATIC
    # (fixed by the initial state — e.g. (package ?x), (in-city ?l ?c), type
    # predicates). Static facts prune the grounding instead of bloating it.
    fluent_preds = set()
    for sch in dom.actions:
        _effect_preds(sch["eff"], fluent_preds)
    init_set = {atom_name(a[0], a[1:]) for a in init_atoms}
    static_facts = set()                            # ground static atom names
    static_by_pred = {}                             # pred -> set of arg-tuples (from init)
    for a in init_atoms:
        pred = a[0]
        if pred not in fluent_preds:
            static_facts.add(atom_name(pred, a[1:]))
            static_by_pred.setdefault(pred, set()).add(tuple(a[1:]))

    # ---- ground every action schema (typed OR static-predicate-typed) ----
    ground_actions = []
    is_fond = False
    for sch in dom.actions:
        param_names = [p for p, _ in sch["params"]]
        # restrict each parameter's domain: by its declared :type if any, AND by
        # any static UNARY precondition (type ?param) — this is what keeps a real
        # logistics instance from exploding into hundreds of thousands of bindings.
        dom_of = _param_domains(sch, fluent_preds, static_by_pred, objs_of, all_objs)
        choices = [dom_of[p] for p in param_names]
        if any(len(c) == 0 for c in choices):
            continue
        for combo in product(*choices) if choices else [()]:
            sub = dict(zip(param_names, combo))
            pre = {}
            if not _ground_pre(sch["pre"], sub, fluent_preds, static_facts, pre):
                continue                           # filtered by a static / (=) precondition
            outcomes = _ground_effect(sch["eff"], sub)
            gname = atom_name(sch["name"], list(combo))
            if len(outcomes) > 1:
                is_fond = True
            ground_actions.append((gname, pre, outcomes))

    # ---- collect FLUENT propositions only (static atoms never change) ----
    props = set()
    for gname, pre, outcomes in ground_actions:
        props |= set(pre)
        for o in outcomes:
            props |= set(o)
    props |= {atom_name(a[0], a[1:]) for a in init_atoms if a[0] in fluent_preds}
    goal = {}
    _ground_pre(goal_expr, {}, fluent_preds, static_facts, goal)
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
    # static facts (e.g. road topology) never change but the UI may want them to
    # draw a faithful world — keep them around as plain ground-atom names.
    prob.statics = sorted(static_facts)
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
    "logistics-ipc": {
        "label": "Logistics — IPC style (trucks + airplane + cities)",
        "kind": "classical",
        # The standard IPC-2000 logistics domain: untyped objects, types asserted
        # by static predicates (package/truck/airplane/location/airport/city/
        # in-city). Exercises the grounder's static analysis.
        "domain": """(define (domain logistics)
 (:requirements :strips)
 (:predicates (package ?o) (truck ?t) (airplane ?a) (airport ?p) (location ?l)
              (city ?c) (in-city ?l ?c) (at ?o ?l) (in ?o ?v))
 (:action load-truck :parameters (?o ?t ?l)
   :precondition (and (package ?o) (truck ?t) (location ?l) (at ?t ?l) (at ?o ?l))
   :effect (and (not (at ?o ?l)) (in ?o ?t)))
 (:action unload-truck :parameters (?o ?t ?l)
   :precondition (and (package ?o) (truck ?t) (location ?l) (at ?t ?l) (in ?o ?t))
   :effect (and (not (in ?o ?t)) (at ?o ?l)))
 (:action load-airplane :parameters (?o ?a ?l)
   :precondition (and (package ?o) (airplane ?a) (location ?l) (at ?o ?l) (at ?a ?l))
   :effect (and (not (at ?o ?l)) (in ?o ?a)))
 (:action unload-airplane :parameters (?o ?a ?l)
   :precondition (and (package ?o) (airplane ?a) (location ?l) (in ?o ?a) (at ?a ?l))
   :effect (and (not (in ?o ?a)) (at ?o ?l)))
 (:action drive-truck :parameters (?t ?from ?to ?c)
   :precondition (and (truck ?t) (location ?from) (location ?to) (city ?c)
                      (at ?t ?from) (in-city ?from ?c) (in-city ?to ?c))
   :effect (and (not (at ?t ?from)) (at ?t ?to)))
 (:action fly-airplane :parameters (?a ?from ?to)
   :precondition (and (airplane ?a) (airport ?from) (airport ?to) (at ?a ?from))
   :effect (and (not (at ?a ?from)) (at ?a ?to))))""",
        "problem": """(define (problem logistics-mini) (:domain logistics)
 (:objects c1 c2 pos1 apt1 pos2 apt2 t1 t2 a1 p1 p2)
 (:init (city c1) (city c2) (location pos1) (location apt1) (location pos2)
        (location apt2) (airport apt1) (airport apt2)
        (truck t1) (truck t2) (airplane a1) (package p1) (package p2)
        (in-city pos1 c1) (in-city apt1 c1) (in-city pos2 c2) (in-city apt2 c2)
        (at t1 pos1) (at t2 pos2) (at a1 apt1) (at p1 pos1) (at p2 pos1))
 (:goal (and (at p1 pos2) (at p2 apt2))))""",
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

