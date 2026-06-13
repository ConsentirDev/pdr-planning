"""
L2 / L3 -- evolving PDR search operators, scored by the verifiable harness.

This is FunSearch / AlphaEvolve, grounded so it cannot fake a win:

    propose operator  ->  SAFETY GATE (must still solve & validate everything)
                      ->  FITNESS (total SAT calls across an instance set)
                      ->  ARCHIVE the Pareto-best  ->  feed back into proposals

Because the seams are soundness-preserving (see pdr.py / operators.py), the
safety gate can never be cheated: a wrong "improvement" fails validation and is
discarded; only genuinely-faster-and-correct operators survive.

Engines
-------
* evolutionary_search   L2, autonomous: mutates template weight-vectors. No LLM.
* llm_search            L2, LLM-in-the-loop: a proposer writes operator *source*;
                        works with a manual callback (you/Claude) or the
                        Anthropic API.
* meta_evolve           L3: improves the improver -- adapts mutation scale, grows
                        the curriculum toward the frontier, and picks which seam
                        to invest in.

Fitness uses *SAT calls* (deterministic, noise-free) as the primary signal --
fewer SAT calls means better search guidance -- with wall-time as a tiebreak.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass

from .pdr import PDR
from .planning import validate_plan
from . import domains
from . import operators as ops
from .operators import Operator


# ---------------------------------------------------------------------------
# instance sets (curriculum)
# ---------------------------------------------------------------------------
def instance_pool():
    """Ordered easy->hard; the L3 curriculum reveals these progressively."""
    return [
        ("logistics-3-2", lambda: domains.logistics(3, 2)),
        ("blocks-3", lambda: domains.blocksworld(3)),
        ("logistics-4-3", lambda: domains.logistics(4, 3)),
        ("blocks-4", lambda: domains.blocksworld(4)),
        ("logistics-5-3", lambda: domains.logistics(5, 3)),
        ("logistics-4-4", lambda: domains.logistics(4, 4)),
        ("blocks-5", lambda: domains.blocksworld(5)),
    ]


def build_instances(names_builders):
    return [(name, build()) for name, build in names_builders]


# ---------------------------------------------------------------------------
# evaluation + safety gate
# ---------------------------------------------------------------------------
@dataclass
class Eval:
    coverage: int
    n: int
    sat_calls: int
    wall: float
    valid: bool

    @property
    def safe(self):
        return self.valid and self.coverage == self.n

    def fitness(self):
        # lower is better; unsafe operators are sent to the back.
        return self.sat_calls if self.safe else 10 ** 12 + (self.n - self.coverage)


def reference_table(instances, time_limit, k_cap):
    refs = {}
    for name, prob in instances:
        r = PDR(prob, time_limit=time_limit, max_k=k_cap).solve()
        refs[name] = r.solvable
    return refs


def evaluate(operator: Operator, instances, refs, time_limit=4.0, k_cap=60):
    cov = sat = 0
    wall = 0.0
    valid = True
    for name, prob in instances:
        pdr = PDR(prob, time_limit=time_limit, max_k=k_cap)
        operator.install(pdr)
        t0 = time.perf_counter()
        try:
            res = pdr.solve()
        except Exception:
            valid = False
            continue
        wall += time.perf_counter() - t0
        if res.solvable is None:           # timed out -> not covered
            continue
        if res.solvable != refs[name]:     # wrong answer -> unsafe
            valid = False
        if res.solvable and not validate_plan(prob, res.plan):
            valid = False                  # invalid plan -> unsafe
        cov += 1
        sat += res.stats["sat_calls"]
    return Eval(cov, len(instances), sat, wall, valid)


# ---------------------------------------------------------------------------
# Pareto archive (keep diverse, safe, fast operators)
# ---------------------------------------------------------------------------
class Archive:
    def __init__(self, capacity=8):
        self.capacity = capacity
        self.members = []   # list of (Operator, Eval)

    def consider(self, op, ev):
        if not ev.safe:
            return False
        # de-duplicate operators that score identically (keep the first name)
        for _, e in self.members:
            if e.sat_calls == ev.sat_calls and e.wall <= ev.wall + 1e-9:
                # an equally-fast member already exists; only archive if novel name
                if any(o.name == op.name for o, _ in self.members):
                    return False
        self.members.append((op, ev))
        self.members.sort(key=lambda m: (m[1].sat_calls, m[1].wall))
        # keep capacity, but always retain distinct sat_call levels for diversity
        self.members = self.members[:self.capacity]
        return any(o is op for o, _ in self.members)

    def best(self):
        return self.members[0] if self.members else None

    def summary(self):
        return [(o.name, e.sat_calls) for o, e in self.members]


# ---------------------------------------------------------------------------
# L2 -- autonomous evolutionary search over template weight vectors
# ---------------------------------------------------------------------------
_SEAM_KEYS = {
    "obligation": ops.OBL_FEATURE_KEYS,
    "reason": ops.REASON_FEATURE_KEYS,
    "progression": ops.PROG_FEATURE_KEYS,
}


def _random_weights(rng, keys, scale=1.0):
    return {k: rng.gauss(0, scale) for k in keys}


def _mutate(weights, rng, scale, keys):
    child = dict(weights)
    for k in keys:
        if rng.random() < 0.8:
            child[k] = child.get(k, 0.0) + rng.gauss(0, scale)
    return child


def evolutionary_search(seam="obligation", instances=None, generations=6,
                        pop_size=10, elite=3, scale=0.6, seed=0,
                        time_limit=4.0, k_cap=60, archive=None, verbose=True):
    rng = random.Random(seed)
    instances = instances or build_instances(instance_pool()[:4])
    refs = reference_table(instances, time_limit, k_cap)
    keys = _SEAM_KEYS[seam]
    archive = archive or Archive()

    # generation 0: seeds + random
    pop = list(ops.seed_operators()[seam])
    while len(pop) < pop_size:
        w = _random_weights(rng, keys, scale)
        pop.append(Operator(f"rand{len(pop)}", seam, "template", w, origin="random"))

    baseline_ev = evaluate(ops.baseline_operator(seam), instances, refs, time_limit, k_cap)
    history = []
    best = None
    for gen in range(generations):
        scored = []
        for op in pop:
            ev = evaluate(op, instances, refs, time_limit, k_cap)
            scored.append((op, ev))
            archive.consider(op, ev)
        scored.sort(key=lambda x: x[1].fitness())
        if best is None or scored[0][1].fitness() < best[1].fitness():
            best = scored[0]
        history.append(best[1].sat_calls if best[1].safe else None)
        if verbose:
            b = best
            print(f"  gen {gen}: best={b[0].name:18s} sat_calls={b[1].sat_calls} "
                  f"(baseline {baseline_ev.sat_calls})  scale={scale:.2f}")
        # next generation: mutate elites
        parents = [op for op, ev in scored[:elite] if ev.safe] or [scored[0][0]]
        nxt = list(parents)
        gi = 0
        while len(nxt) < pop_size:
            par = parents[gi % len(parents)]
            base_w = par.spec if par.kind == "template" else _random_weights(rng, keys, scale)
            child = _mutate(base_w if isinstance(base_w, dict) else {}, rng, scale, keys)
            nxt.append(Operator(f"g{gen}m{len(nxt)}", seam, "template", child, origin="mutation"))
            gi += 1
        pop = nxt

    return best, baseline_ev, archive, history


# ---------------------------------------------------------------------------
# L2 -- LLM-in-the-loop search (proposer writes operator SOURCE)
# ---------------------------------------------------------------------------
def build_prompt(seam, archive, baseline_ev):
    feats = (ops.OBL_FEATURE_KEYS if seam == "obligation" else ops.REASON_FEATURE_KEYS)
    leaderboard = "\n".join(f"  {name}: {sc} SAT calls" for name, sc in archive.summary()) or "  (empty)"
    if seam == "obligation":
        sig = ("def score(f, entry, state, ctx):\n    # higher score == popped first\n"
               "    return <float>")
        fdesc = ("f['recency'] in [0,1] (1=most recently queued), "
                 "f['goalsat'] in [0,1] (fraction of goal already satisfied), "
                 "f['ntrue'] in [0,1] (fraction of props true), f['bias']=1.0")
    elif seam == "reason":
        sig = ("def key(f, lit, state, ctx):\n    # lower key == literal tried for removal first\n"
               "    return <float>")
        fdesc = ("f['is_pos'] (1 if literal positive), f['in_goal'] (1 if its prop is in the goal), "
                 "f['pid'] in [0,1], f['bias']=1.0")
    else:  # progression
        sig = ("def depth(f, i, k, state, ctx):\n    # macro look-ahead depth F >= 1 for this obligation\n"
               "    return <int>")
        fdesc = ("f['i_frac'] in [0,1] (1=far from goal), f['goalsat'] in [0,1] "
                 "(fraction of goal satisfied), f['ntrue'] in [0,1], f['bias']=1.0")
    return f"""You are improving a Property Directed Reachability planner by writing a
search-ordering operator for the '{seam}' seam. Correctness is guaranteed by the
host; you only affect SPEED (total SAT calls -- lower is better).

Write ONLY a Python function with this signature (no imports, safe builtins only):

{sig}

Available features: {fdesc}

Current best operators (fewer SAT calls is better):
{leaderboard}
baseline: {baseline_ev.sat_calls} SAT calls

Propose a NEW operator that you predict will use fewer SAT calls. Return only code."""


def manual_proposer(sources):
    """Wrap a fixed list of source strings as a proposer (you/Claude as the LLM)."""
    state = {"i": 0}

    def propose(prompt, n):
        out = sources[state["i"]: state["i"] + n]
        state["i"] += n
        return out
    return propose


# Curated "LLM" proposals -- written by Claude acting as the proposer, so the
# LLM-in-the-loop pipeline (compile -> safety-gate -> fitness -> archive) can be
# demonstrated offline. Swap in anthropic_proposer() for live generation.
_CURATED = {
    "reason": [
        # drop True (positive) literals first, keep goal literals till last
        "def key(f, lit, state, ctx):\n"
        "    return -1.0*f['is_pos'] + 1.0*f['in_goal']\n",
        # try non-goal literals first (looser reasons), tie-break by id
        "def key(f, lit, state, ctx):\n"
        "    return 1.0*f['in_goal'] + 0.001*f['pid']\n",
        # combined: goal literals last, positive-before-negative, stable id tail
        "def key(f, lit, state, ctx):\n"
        "    return 2.0*f['in_goal'] - 1.0*f['is_pos'] + 0.001*f['pid']\n",
    ],
    "obligation": [
        # greedy toward the goal, DFS momentum as tie-break
        "def score(f, entry, state, ctx):\n"
        "    return 3.0*f['goalsat'] + 1.0*f['recency']\n",
        # prefer simpler (fewer-true) states, recency as tie-break
        "def score(f, entry, state, ctx):\n"
        "    return -1.0*f['ntrue'] + 0.5*f['recency']\n",
    ],
    "progression": [
        # look several steps ahead while far from the goal, then settle to F=1
        "def depth(f, i, k, state, ctx):\n"
        "    return 1 + round(3 * f['i_frac'])\n",
        # depth driven by how little of the goal is satisfied
        "def depth(f, i, k, state, ctx):\n"
        "    return 1 + round(4 * (1.0 - f['goalsat']))\n",
        # mild constant look-ahead (a learned compromise around PDR-M F=2/3)
        "def depth(f, i, k, state, ctx):\n"
        "    return 2 + round(2 * f['i_frac'] * (1.0 - f['goalsat']))\n",
    ],
}


def curated_proposer(seam):
    return manual_proposer(list(_CURATED.get(seam, [])))


def anthropic_proposer(model="claude-sonnet-4-6", api_key=None):
    """Real LLM proposer via the Anthropic API (optional; needs `anthropic` + key)."""
    import os
    try:
        import anthropic
    except Exception as e:  # pragma: no cover
        raise RuntimeError("pip install anthropic to use the API proposer") from e
    client = anthropic.Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))

    def propose(prompt, n):  # pragma: no cover - needs network
        out = []
        for _ in range(n):
            msg = client.messages.create(
                model=model, max_tokens=600,
                messages=[{"role": "user", "content": prompt}])
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
            out.append(_extract_code(text))
        return out
    return propose


def _extract_code(text):
    if "```" in text:
        parts = text.split("```")
        for p in parts:
            p = p.lstrip()
            if p.startswith("python"):
                p = p[len("python"):]
            if "def score" in p or "def key" in p:
                return p.strip()
    return text.strip()


def llm_search(seam="obligation", instances=None, rounds=3, per_round=3,
               proposer=None, time_limit=4.0, k_cap=60, archive=None, verbose=True):
    instances = instances or build_instances(instance_pool()[:4])
    refs = reference_table(instances, time_limit, k_cap)
    archive = archive or Archive()
    baseline_ev = evaluate(ops.baseline_operator(seam), instances, refs, time_limit, k_cap)
    if proposer is None:
        proposer = anthropic_proposer()
    # seed the archive so the prompt has a leaderboard
    for op in ops.seed_operators()[seam]:
        archive.consider(op, evaluate(op, instances, refs, time_limit, k_cap))

    accepted = []
    for rnd in range(rounds):
        prompt = build_prompt(seam, archive, baseline_ev)
        sources = proposer(prompt, per_round)
        for j, src in enumerate(sources):
            op = Operator(f"llm-r{rnd}-{j}", seam, "source", src, origin="llm")
            try:
                op.build()                       # compile in sandbox
            except Exception as e:
                if verbose:
                    print(f"  round {rnd}: candidate {j} failed to compile ({e})")
                continue
            ev = evaluate(op, instances, refs, time_limit, k_cap)
            kept = archive.consider(op, ev)
            tag = "SAFE" if ev.safe else "REJECT(unsafe)"
            if verbose:
                print(f"  round {rnd}.{j}: {tag} sat_calls={ev.sat_calls} "
                      f"(baseline {baseline_ev.sat_calls})  {'ARCHIVED' if kept else ''}")
            if ev.safe:
                accepted.append((op, ev))
    return archive.best(), baseline_ev, archive, accepted


# ---------------------------------------------------------------------------
# L3 -- meta-evolution: improve the improver
# ---------------------------------------------------------------------------
def meta_evolve(meta_rounds=8, seed=0, seams=("obligation", "reason", "progression"),
                verbose=True):
    """L3 -- improve the improver. The search's OWN choices are adapted online:

      * SEAM SELECTION (warm-up + payoff-greedy bandit): the meta-loop learns
        which of the seams actually pays off and concentrates budget there. It
        should discover that the progression seam has by far the most leverage,
        the reason seam some, and the obligation seam ~none -- i.e. it learns
        *where to look* across the whole operator space.
      * MUTATION SCALE: shrinks on improvement (exploit), grows on stagnation.
      * CURRICULUM: grows toward the frontier once the current set is mastered.

    Returns (archives, report, seam_payoff).
    """
    rng = random.Random(seed)
    pool = instance_pool()
    curric = 3
    seams = list(seams)
    scale = {s: 0.6 for s in seams}
    archives = {s: Archive() for s in seams}
    payoff = {s: 1.0 for s in seams}          # EMA of speedup per seam
    spent = {s: 0 for s in seams}
    last_best = {s: None for s in seams}
    report = []

    for rnd in range(1, meta_rounds + 1):
        # warm up each seam once, then exploit the learned payoff (random
        # tie-break), exploring 20% of the time.
        if rnd <= len(seams):
            seam = seams[rnd - 1]
        elif rng.random() < 0.2:
            seam = rng.choice(seams)
        else:
            best_p = max(payoff.values())
            seam = rng.choice([s for s in seams if payoff[s] == best_p])
        spent[seam] += 1
        instances = build_instances(pool[:curric])
        best, base, _, _ = evolutionary_search(
            seam=seam, instances=instances, generations=4, pop_size=8,
            scale=scale[seam], seed=seed + rnd, time_limit=4.0,
            archive=archives[seam], verbose=False)
        speedup = base.sat_calls / max(1, best[1].sat_calls)
        payoff[seam] = 0.5 * payoff[seam] + 0.5 * speedup
        improved = (last_best[seam] is None or best[1].sat_calls < last_best[seam])
        last_best[seam] = min(best[1].sat_calls, last_best[seam] or best[1].sat_calls)
        scale[seam] = max(0.1, scale[seam] * 0.7) if improved else min(2.0, scale[seam] * 1.4)
        if best[1].safe and best[1].coverage == best[1].n and curric < len(pool):
            curric += 1
        report.append({"round": rnd, "seam_evolved": seam, "curriculum": curric,
                       "scale": round(scale[seam], 2), "speedup": round(speedup, 2),
                       "payoff": {s: round(payoff[s], 2) for s in seams}})
        if verbose:
            r = report[-1]
            pay = "  ".join(f"{s[:4]}={payoff[s]:.2f}x" for s in seams)
            print(f"meta-round {rnd}: evolved {seam:11s} curriculum={r['curriculum']} "
                  f"scale={r['scale']:.2f} -> {r['speedup']:.2f}x   payoffs[{pay}]")
    if verbose:
        ranked = sorted(seams, key=lambda s: -payoff[s])
        print("\nimprover learned where the value is (payoff, rounds spent):")
        for s in ranked:
            b = archives[s].best()
            tag = f"best={b[0].name} ({b[1].sat_calls} SAT calls)" if b else "(none safe)"
            print(f"  {s:11s} payoff={payoff[s]:.2f}x  spent={spent[s]}  {tag}")
    return archives, report, payoff


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Evolve PDR search operators (L2/L3)")
    ap.add_argument("--mode", default="evolve", choices=["evolve", "llm", "meta"])
    ap.add_argument("--seam", default="obligation", choices=["obligation", "reason", "progression"])
    ap.add_argument("--generations", type=int, default=6)
    args = ap.parse_args()

    if args.mode == "meta":
        print("L3 meta-evolution (improving the improver):\n")
        meta_evolve()
        return
    if args.mode == "llm":
        import os
        if os.environ.get("ANTHROPIC_API_KEY"):
            print("L2 LLM-in-the-loop (live Anthropic API proposer):\n")
            proposer = None  # llm_search builds anthropic_proposer()
        else:
            print("L2 LLM-in-the-loop (offline: curated Claude-authored proposals;"
                  " set ANTHROPIC_API_KEY for live generation):\n")
            proposer = curated_proposer(args.seam)
        best, base, arc, _ = llm_search(seam=args.seam, rounds=1,
                                        per_round=len(_CURATED.get(args.seam, [])) or 3,
                                        proposer=proposer)
    else:
        print(f"L2 autonomous evolution of the '{args.seam}' operator:\n")
        best, base, arc, hist = evolutionary_search(
            seam=args.seam, generations=args.generations)
    if best:
        op, ev = best
        print(f"\nbest discovered: {op.name} ({op.origin}, {op.kind})")
        print(f"  SAT calls: {ev.sat_calls}  vs baseline {base.sat_calls}  "
              f"= {base.sat_calls/max(1,ev.sat_calls):.2f}x")
        if op.kind == "template":
            print(f"  weights: { {k: round(v,3) for k,v in op.spec.items() if abs(v)>1e-3} }")
        print(f"  archive: {arc.summary()}")


if __name__ == "__main__":
    main()
