"""
One entrypoint for the visual app: `run_trace(spec) -> dict` (pure JSON).

The same function backs both runtimes -- Pyodide (in the browser, pure-Python
solver) and the optional FastAPI backend (python-sat). Given a small `spec`
describing what to run, it returns `{module, meta, events, result}`:
  * meta   -- the problem (props/atoms/init/goal/actions) for rendering;
  * events -- the replayable trace from `pdr/trace.py`;
  * result -- final answer + stats.

This is the contract the frontend's TypeScript types mirror.
"""

from __future__ import annotations

from .trace import Tracer, problem_meta
from .domains import (logistics, blocksworld, fuel_logistics, clumsy_blocksworld,
                      clumsy_blocksworld_thesis, escher_blocksworld)
from .pddl import parse_problem, SAMPLES
from .planning import FONDProblem
from .pdr import PDR
from .fond import FONDPDR, reference_answer
from .decomp import PDPDR


# ---------------------------------------------------------------------------
# JSON hygiene
# ---------------------------------------------------------------------------
def _json(x):
    if isinstance(x, (set, frozenset, tuple)):
        return [_json(v) for v in x]
    if isinstance(x, list):
        return [_json(v) for v in x]
    if isinstance(x, dict):
        return {str(k): _json(v) for k, v in x.items()}
    if isinstance(x, float):
        return round(x, 6)
    return x


# ---------------------------------------------------------------------------
# problem construction (programmatic generators + PDDL)
# ---------------------------------------------------------------------------
def build_problem(spec):
    dom = spec.get("domain", "logistics")
    p = spec.get("params", {}) or {}
    if dom == "logistics":
        return logistics(p.get("locs", 3), p.get("pkgs", 2),
                         truck_goal=p.get("truck_goal", False))
    if dom == "blocksworld":
        return blocksworld(p.get("blocks", 4))
    if dom == "fuel":
        return fuel_logistics(p.get("fuel", 2))
    if dom == "clumsy":
        return clumsy_blocksworld(p.get("blocks", 3))
    if dom == "clumsy_thesis":
        return clumsy_blocksworld_thesis()
    if dom == "escher":
        return escher_blocksworld(p.get("blocks", 3))
    if dom == "pddl":
        return parse_problem(p["domain_text"], p["problem_text"])
    if dom == "pddl_sample":
        s = SAMPLES[p.get("key", "logistics")]
        return parse_problem(s["domain"], s["problem"])
    raise ValueError(f"unknown domain {dom!r}")


def _is_fond(prob):
    return isinstance(prob, FONDProblem)


# ---------------------------------------------------------------------------
# the dispatcher
# ---------------------------------------------------------------------------
def run_trace(spec):
    module = spec.get("module", "pdr")
    handler = {
        "pdr": _run_pdr, "race": _run_race, "fond": _run_fond,
        "decomp": _run_decomp, "evolve": _run_evolve,
    }.get(module)
    if handler is None:
        raise ValueError(f"unknown module {module!r}")
    return _json(handler(spec))


def _run_pdr(spec):
    prob = build_problem(spec)
    cfg = spec.get("config", {}) or {}
    tr = Tracer(max_events=cfg.get("max_events", 60000))
    res = PDR(prob, variant=cfg.get("variant", "baseline"), F=cfg.get("F", 1),
              use_reschedule=cfg.get("reschedule", True),
              use_clause_pushing=cfg.get("clause_pushing", True),
              max_k=cfg.get("max_k", 40), time_limit=cfg.get("time_limit", 20),
              tracer=tr).solve()
    return {"module": "pdr", "meta": problem_meta(prob),
            "events": tr.events,
            "result": {"solvable": res.solvable, "plan": res.plan_actions or [],
                       "stats": res.stats}}


def _run_race(spec):
    prob = build_problem(spec)
    variants = spec.get("variants") or [
        {"name": "baseline", "variant": "baseline", "F": 1},
        {"name": "PDR-M (F=3)", "variant": "M", "F": 3},
        {"name": "PDR-IL (F=2)", "variant": "IL", "F": 2},
    ]
    runs = []
    for v in variants:
        tr = Tracer(max_events=60000)
        res = PDR(build_problem(spec), variant=v["variant"], F=v["F"],
                  max_k=40, time_limit=20, tracer=tr).solve()
        runs.append({"name": v["name"], "events": tr.events,
                     "result": {"solvable": res.solvable, "plan": res.plan_actions or [],
                                "stats": res.stats}})
    return {"module": "race", "meta": problem_meta(prob), "runs": runs}


def _run_fond(spec):
    prob = build_problem(spec)
    if not _is_fond(prob):
        raise ValueError("fond module needs a FOND problem (clumsy/escher/oneof PDDL)")
    cfg = spec.get("config", {}) or {}
    truth, _ = reference_answer(prob)
    tr = Tracer(max_events=cfg.get("max_events", 80000))
    res = FONDPDR(prob, time_limit=cfg.get("time_limit", 30),
                  max_k=cfg.get("max_k", 60), tracer=tr).solve()
    return {"module": "fond", "meta": problem_meta(prob, kind="fond"),
            "events": tr.events,
            "result": {"has_policy": res.has_policy, "truth": truth,
                       "stats": res.stats}}


def _run_decomp(spec):
    prob = build_problem(spec)
    tr = Tracer(max_events=40000)
    res = PDPDR(prob, time_limit=spec.get("time_limit", 20), tracer=tr).solve()
    return {"module": "decomp", "meta": problem_meta(prob),
            "events": tr.events,
            "result": {"solvable": res.solvable, "plan": res.plan_actions or [],
                       "stats": res.stats}}


def _run_evolve(spec):
    # imported lazily: evolution is heavier and only this module needs it
    from .evolve import evolutionary_search, train_valid_split, build_instances, instance_pool
    cfg = spec.get("config", {}) or {}
    seam = spec.get("seam", "progression")
    split = cfg.get("split", True)
    gens = cfg.get("generations", 4)
    pop = cfg.get("pop_size", 8)
    if split:
        train, valid = train_valid_split()
    else:
        train, valid = build_instances(instance_pool()[:4]), None
    tr = Tracer(max_events=40000)
    best, base, arc, hist = evolutionary_search(
        seam=seam, instances=train, valid=valid, generations=gens, pop_size=pop,
        time_limit=cfg.get("time_limit", 6), verbose=False, tracer=tr)
    op, ev = best
    return {"module": "evolve", "meta": {"seam": seam, "split": bool(split)},
            "events": tr.events,
            "result": {"best": {"name": op.name, "origin": op.origin, "kind": op.kind,
                                "spec": op.spec if op.kind == "source"
                                else {k: round(v, 3) for k, v in op.spec.items()},
                                "sat_calls": ev.sat_calls, "train": ev.train_sat,
                                "valid": ev.valid_sat},
                       "baseline": base.sat_calls,
                       "archive": [{"name": n, "sat_calls": sc} for n, sc in arc.summary()]}}


# ---------------------------------------------------------------------------
# catalog -- what the UI menus offer
# ---------------------------------------------------------------------------
def catalog():
    return {
        "pddl_samples": {k: {"label": v["label"], "kind": v["kind"],
                             "domain": v["domain"], "problem": v["problem"]}
                         for k, v in SAMPLES.items()},
        "domains": {
            "classical": ["logistics", "blocksworld", "fuel"],
            "fond": ["clumsy", "clumsy_thesis", "escher"],
        },
        "variants": ["baseline", "M", "IL"],
        "seams": ["progression", "reason", "obligation"],
    }


def run_trace_json(spec_json):
    """Convenience for Pyodide: take a JSON string, return a JSON string."""
    import json
    return json.dumps(run_trace(json.loads(spec_json)))
