"""
L2 substrate: *evolvable operators* for the two soundness-preserving seams in PDR.

An "operator" is a small strategy plugged into one of PDR's decision points:

  seam = "obligation" : tie-break among minimal-layer obligations
                        callable(entry, cands, ctx) -> float   (higher popped first)
  seam = "reason"     : order literals during reason minimisation
                        callable(literal, state, ctx) -> sort key (lower tried first)

Neither can affect correctness (see pdr.py) -- only search efficiency. That is
exactly what makes them safe to *evolve*: a bad candidate can only be slower,
never wrong, and the harness still validates every plan.

Two operator representations are supported:
  * TEMPLATE  -- a weight vector over normalised features. Cheap to mutate; the
                 autonomous evolutionary engine searches this space.
  * SOURCE    -- a Python expression over the same features (+ raw state). This is
                 the form an LLM proposes; compiled in a restricted sandbox.

Both reduce to a plain callable installed on a PDR instance.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# features
# ---------------------------------------------------------------------------
OBL_FEATURE_KEYS = ["recency", "goalsat", "ntrue", "bias"]


def obl_features(entry, cands, ctx):
    """Normalised features for one obligation among its minimal-layer peers."""
    i, order, state = entry
    goal = ctx["goal"]
    nprops = max(1, ctx["nprops"])
    orders = [e[1] for e in cands]
    omin, omax = min(orders), max(orders)
    recency = (order - omin) / (omax - omin) if omax > omin else 1.0
    goalsat = (len(goal & state) / len(goal)) if goal else 1.0
    ntrue = sum(1 for l in state if l > 0) / nprops
    return {"recency": recency, "goalsat": goalsat, "ntrue": ntrue, "bias": 1.0}


PROG_FEATURE_KEYS = ["i_frac", "goalsat", "ntrue", "bias"]


def prog_features(i, k, state, ctx):
    """Features for choosing the macro look-ahead depth F of one obligation."""
    goal = ctx["goal"]
    nprops = max(1, ctx["nprops"])
    return {
        "i_frac": i / max(1, k),                              # 1=far from goal
        "goalsat": (len(goal & state) / len(goal)) if goal else 1.0,
        "ntrue": sum(1 for l in state if l > 0) / nprops,
        "bias": 1.0,
    }


REASON_FEATURE_KEYS = ["is_pos", "in_goal", "pid", "bias"]


def reason_features(lit, state, ctx):
    goal_pids = {abs(l) for l in ctx["goal"]}
    nprops = max(1, ctx["nprops"])
    return {
        "is_pos": 1.0 if lit > 0 else 0.0,
        "in_goal": 1.0 if abs(lit) in goal_pids else 0.0,
        "pid": abs(lit) / nprops,
        "bias": 1.0,
    }


# ---------------------------------------------------------------------------
# template operators (weight vectors)
# ---------------------------------------------------------------------------
def template_obligation(weights):
    w = {k: float(weights.get(k, 0.0)) for k in OBL_FEATURE_KEYS}

    def score(entry, cands, ctx):
        f = obl_features(entry, cands, ctx)
        return sum(w[k] * f[k] for k in OBL_FEATURE_KEYS)
    return score


def template_reason(weights):
    w = {k: float(weights.get(k, 0.0)) for k in REASON_FEATURE_KEYS}

    def key(lit, state, ctx):
        f = reason_features(lit, state, ctx)
        return sum(w[k] * f[k] for k in REASON_FEATURE_KEYS)
    return key


def template_progression(weights):
    w = {k: float(weights.get(k, 0.0)) for k in PROG_FEATURE_KEYS}

    def depth(i, k, state, ctx):
        f = prog_features(i, k, state, ctx)
        return sum(w[kk] * f[kk] for kk in PROG_FEATURE_KEYS)
    return depth


# ---------------------------------------------------------------------------
# source operators (the LLM-proposed form), compiled in a restricted sandbox
# ---------------------------------------------------------------------------
_SAFE_BUILTINS = {
    "min": min, "max": max, "abs": abs, "len": len, "sum": sum, "sorted": sorted,
    "float": float, "int": int, "bool": bool, "range": range, "enumerate": enumerate,
    "any": any, "all": all, "map": map, "list": list, "set": set, "frozenset": frozenset,
    "round": round, "pow": pow,
}


def _compile(src, fname):
    """Compile `src` (which must define `def <fname>(...)`) in a sandbox."""
    glb = {"__builtins__": _SAFE_BUILTINS}
    code = compile(src, f"<operator:{fname}>", "exec")
    exec(code, glb)  # noqa: S102 -- sandboxed: no imports, safe builtins only
    fn = glb.get(fname)
    if not callable(fn):
        raise ValueError(f"source must define {fname}(...)")
    return fn


def compile_obligation_source(src):
    """`src` defines:  def score(f, entry, state, ctx): -> float
    where f = normalised feature dict. Higher score == popped first."""
    raw = _compile(src, "score")

    def wrapped(entry, cands, ctx):
        try:
            f = obl_features(entry, cands, ctx)
            return float(raw(f, entry, entry[2], ctx))
        except Exception:
            return float(entry[1])  # graceful fallback == recency
    return wrapped


def compile_reason_source(src):
    """`src` defines:  def key(f, lit, state, ctx): -> float  (lower tried first)."""
    raw = _compile(src, "key")

    def wrapped(lit, state, ctx):
        try:
            f = reason_features(lit, state, ctx)
            return float(raw(f, lit, state, ctx))
        except Exception:
            return abs(lit)
    return wrapped


def compile_progression_source(src):
    """`src` defines:  def depth(f, i, k, state, ctx): -> int (macro look-ahead)."""
    raw = _compile(src, "depth")

    def wrapped(i, k, state, ctx):
        try:
            f = prog_features(i, k, state, ctx)
            return float(raw(f, i, k, state, ctx))
        except Exception:
            return 1.0
    return wrapped


# ---------------------------------------------------------------------------
# the Operator object
# ---------------------------------------------------------------------------
@dataclass
class Operator:
    name: str
    seam: str           # "obligation" | "reason"
    kind: str           # "template" | "source"
    spec: object        # weights dict OR source string
    origin: str = "seed"
    parent: str = None          # name of the operator this was mutated from (lineage)
    parent_spec: object = field(default=None, repr=False)  # parent weights, for the diff
    _callable: object = field(default=None, repr=False)

    _TEMPLATES = {"obligation": template_obligation, "reason": template_reason,
                  "progression": template_progression}
    _SOURCES = {"obligation": compile_obligation_source, "reason": compile_reason_source,
                "progression": compile_progression_source}

    def build(self):
        if self._callable is None:
            table = self._TEMPLATES if self.kind == "template" else self._SOURCES
            self._callable = table[self.seam](self.spec)
        return self._callable

    def install(self, pdr):
        fn = self.build()
        if self.seam == "obligation":
            pdr.tie_breaker = fn
        elif self.seam == "reason":
            pdr.reason_order = fn
        else:  # progression
            pdr.progress_strategy = fn
        return pdr


def baseline_operator(seam="obligation"):
    if seam == "obligation":
        return Operator("baseline-recency", "obligation", "template",
                        {"recency": 1.0}, origin="thesis")
    if seam == "reason":
        return Operator("baseline-idorder", "reason", "template",
                        {"pid": 1.0}, origin="thesis")
    return Operator("baseline-F1", "progression", "template",
                    {"bias": 1.0}, origin="thesis")     # F == 1 everywhere


# ---------------------------------------------------------------------------
# seed library  (hand-designed proposals -- this is the human/LLM "generation 0")
# ---------------------------------------------------------------------------
def seed_operators():
    seeds = [
        baseline_operator("obligation"),
        Operator("greedy-goal", "obligation", "template",
                 {"goalsat": 1.0, "recency": 0.01}, origin="seed"),
        Operator("goal+dfs", "obligation", "template",
                 {"goalsat": 1.0, "recency": 1.0}, origin="seed"),
        Operator("few-true-first", "obligation", "template",
                 {"ntrue": -1.0, "recency": 0.01}, origin="seed"),
        # LLM-style source proposal: greedy toward goal, but keep DFS momentum
        # by adding recency, and gently prefer simpler (fewer-true) states.
        Operator("llm-goal-dfs-simple", "obligation", "source",
                 "def score(f, entry, state, ctx):\n"
                 "    return 2.0*f['goalsat'] + 1.0*f['recency'] - 0.3*f['ntrue']\n",
                 origin="llm-seed"),
    ]
    reason_seeds = [
        baseline_operator("reason"),
        Operator("drop-positive-first", "reason", "template",
                 {"is_pos": -1.0, "pid": 0.001}, origin="seed"),
        Operator("drop-nongoal-first", "reason", "template",
                 {"in_goal": 1.0, "pid": 0.001}, origin="seed"),
    ]
    prog_seeds = [
        baseline_operator("progression"),                       # F = 1 (baseline)
        Operator("fixed-F3", "progression", "template",
                 {"bias": 3.0}, origin="seed"),                 # == thesis PDR-M F=3
        Operator("fixed-F2", "progression", "template",
                 {"bias": 2.0}, origin="seed"),
        # adaptive: look deep when far from the goal, F=1 near it
        Operator("deep-when-far", "progression", "template",
                 {"bias": 1.0, "i_frac": 4.0}, origin="seed"),
        # LLM-style: deeper early, shallower as more of the goal is satisfied
        Operator("llm-adaptive-depth", "progression", "source",
                 "def depth(f, i, k, state, ctx):\n"
                 "    return 1 + round(4 * (1.0 - f['goalsat']))\n",
                 origin="llm-seed"),
        # Discovered by the LIVE LLM-in-the-loop under a train/validation split
        # (claude-sonnet-4-6). A smooth distance-to-goal rule that GENERALISES:
        # on a fresh test set it beats baseline ~4.6x and fixed PDR-M(F=3) ~1.4x.
        Operator("llm-discovered-smooth", "progression", "source",
                 "def depth(f, i, k, state, ctx):\n"
                 "    distance = 0.5 * f['i_frac'] + 0.5 * (1.0 - f['goalsat'])\n"
                 "    raw = 2.0 + 4.0 * distance + 0.5 * (1.0 - abs(f['ntrue'] - 0.5) * 2.0)\n"
                 "    return max(2, min(7, int(round(raw))))\n",
                 origin="llm-discovered"),
    ]
    return {"obligation": seeds, "reason": reason_seeds, "progression": prog_seeds}
