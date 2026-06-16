"""
Tracing layer: turn a planner run into a replayable stream of events for the UI.

This is *non-invasive*. Solvers take an optional `tracer=None`; every hook is a
guarded `if self._tracer: self._tracer.emit(...)`, so with tracing OFF (the
default) behaviour and performance are unchanged and the test suite is untouched.

A trace is JSON: `{ "meta": {...}, "events": [...], "result": {...} }`.
  * meta   -- the problem: propositions (id->name, parsed into pred+args so the
              UI can draw actual trucks/towers), init, goal, actions, invariants.
  * events -- an ordered list of `{ "t": <kind>, ... }` dicts. The UI replays them
              to derive the view-state at any scrub position.
  * result -- final answer + stats.

States/cubes are serialized as sorted lists of signed ints (a SAT/abstract
literal: +id means proposition id is TRUE, -id FALSE; id = index+1 into props).
"""

from __future__ import annotations

import re

_ATOM = re.compile(r"^([^()]+)\(([^()]*)\)$")


def parse_atom(name):
    """'at(P0,L1)' -> ('at', ['P0','L1']);  'handempty' -> ('handempty', [])."""
    m = _ATOM.match(name)
    if not m:
        return name, []
    pred = m.group(1)
    args = [a.strip() for a in m.group(2).split(",")] if m.group(2).strip() else []
    return pred, args


class Tracer:
    """Append-only event sink. `cube()` serialises a frozenset of abstract lits."""

    def __init__(self, enabled=True, max_events=300_000, on_emit=None):
        self.enabled = enabled
        self.events = []
        self.max_events = max_events
        self.on_emit = on_emit   # optional callback(event) for live streaming

    def emit(self, kind, **data):
        if not self.enabled or len(self.events) >= self.max_events:
            return
        ev = {"t": kind, **data}
        self.events.append(ev)
        if self.on_emit is not None:
            try:
                self.on_emit(ev)
            except Exception:
                pass

    @staticmethod
    def cube(c):
        return sorted(c, key=lambda l: (abs(l), l)) if c is not None else []

    @staticmethod
    def cubes(cs):
        return [Tracer.cube(c) for c in cs]


def problem_meta(problem, kind="classical"):
    """Static description the UI needs to render a problem's worlds."""
    atoms = []
    for i, name in enumerate(problem.props):
        pred, args = parse_atom(name)
        atoms.append({"id": i + 1, "name": name, "pred": pred, "args": args})
    meta = {
        "kind": kind,
        "name": getattr(problem, "name", "problem"),
        "props": list(problem.props),
        "atoms": atoms,
        "init": Tracer.cube(problem.init_cube()),
        "goal": Tracer.cube(problem.goal_cube()),
        "invariants": [Tracer.cube(c) for c in getattr(problem, "invariants", [])],
        "render": _render_family(problem),
        "statics": list(getattr(problem, "statics", [])),
    }
    if kind == "classical":
        meta["actions"] = [
            {"name": a.name, "pre": _lit_map(problem, a.pre),
             "eff": _lit_map(problem, a.eff)}
            for a in problem.actions
        ]
    else:  # fond
        meta["actions"] = [
            {"name": a.name, "pre": _lit_map(problem, a.pre),
             "outcomes": [_lit_map(problem, o) for o in a.outcomes]}
            for a in problem.actions
        ]
        meta["max_outcomes"] = problem.max_outcomes
    return meta


def _lit_map(problem, assignment):
    """{name: bool} -> [signed ids]."""
    return Tracer.cube(frozenset(problem.lit(n, v) for n, v in assignment.items()))


def _render_family(problem):
    """A coarse hint so the UI can pick a bespoke world renderer."""
    preds = {parse_atom(p)[0] for p in problem.props}
    if {"at", "in"} & preds and any(p.startswith("at(") for p in problem.props):
        return "logistics"
    if {"on", "ontable", "clear"} & preds:
        return "blocksworld"
    if "vehicleat" in preds:
        return "tireworld"
    if {"done", "broken"} <= preds:
        return "faults"
    if "swimmerat" in preds:
        return "islands"
    if "medicat" in preds:
        return "responders"
    if "imaged" in preds:
        return "satellite"
    return "generic"
