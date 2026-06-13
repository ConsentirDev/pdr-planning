"""
L3 self-authoring -- the improver rewrites two of its OWN ingredients:

  1. FEATURES   -- the problem features the L1 meta-policy uses to pick a config.
                   We start from the hand-written base features and let a greedy
                   search ADD derived features (ratios, products, logs) whenever
                   they lower the meta-policy's prediction regret. Because the
                   base set is always available, the authored set can only ever
                   match or beat it -- never regress.

  2. DOMAINS    -- the curriculum the search trains on. Instead of a fixed list,
                   we auto-generate instances calibrated to a difficulty band
                   (hard-but-solvable within a budget) -- the frontier, where
                   learning signal is richest.

Both reuse the verifiable harness, so "better" always means measured, not
asserted.
"""

from __future__ import annotations

import math

from . import domains
from .selfimprove import features as base_features, config_space, run_config


# ---------------------------------------------------------------------------
# 1. self-authored features
# ---------------------------------------------------------------------------
BASE_KEYS = ["n_props", "n_actions", "n_goal", "decomposability", "act_per_prop"]

# candidate derived features, each a function of the base feature dict
FEATURE_TRANSFORMS = {
    "actions_x_props": lambda f: f["n_actions"] * f["n_props"],
    "goal_frac": lambda f: f["n_goal"] / max(1.0, f["n_props"]),
    "decomp_frac": lambda f: f["decomposability"] / max(1.0, f["n_props"]),
    "log_actions": lambda f: math.log1p(f["n_actions"]),
    "props_sq": lambda f: f["n_props"] ** 2,
    "branch": lambda f: f["n_actions"] / max(1.0, f["n_goal"]),
}


def full_feature_vector(problem, keys):
    base = base_features(problem)
    vals = []
    for k in keys:
        if k in base:
            vals.append(float(base[k]))
        else:
            vals.append(float(FEATURE_TRANSFORMS[k](base)))
    return vals


def _loo_regret(examples, keys):
    """Leave-one-out regret of a nearest-neighbour config policy on `keys`.
    examples: list of dict{features(base), vec_cache, best_cfg, times{label->t}}.
    """
    # normalise per key over the set
    vectors = [full_feature_vector(e["problem"], keys) for e in examples]
    cols = list(zip(*vectors)) if vectors else []
    scale = [max(1e-9, (max(c) - min(c))) for c in cols]
    total = 0.0
    for i, ei in enumerate(examples):
        # nearest other example by scaled feature distance
        best_j, best_d = None, None
        for j, ej in enumerate(examples):
            if j == i:
                continue
            d = sum(((a - b) / s) ** 2 for a, b, s in zip(vectors[i], vectors[j], scale))
            if best_d is None or d < best_d:
                best_d, best_j = d, j
        predicted = examples[best_j]["best_cfg"]
        t_pred = ei["times"].get(predicted.label(), 1e9)
        t_best = ei["times"][ei["best_cfg"].label()]
        total += t_pred / max(1e-6, t_best)
    return total / max(1, len(examples))


def label_examples(instances, configs=None, time_limit=4.0):
    """Run every config on every instance once; record per-config time + oracle best."""
    configs = configs or config_space()
    out = []
    for name, prob in instances:
        times = {}
        best = None
        for cfg in configs:
            solved, metric, _ = run_config(cfg, prob, time_limit)
            times[cfg.label()] = metric
            if best is None or metric < best[1]:
                best = (cfg, metric)
        out.append({"name": name, "problem": prob, "times": times, "best_cfg": best[0]})
    return out


def author_features(examples, verbose=True):
    """Greedy forward selection: keep BASE_KEYS, add derived features only while
    they reduce leave-one-out regret. Returns (chosen_keys, base_regret, final)."""
    keys = list(BASE_KEYS)
    base_regret = _loo_regret(examples, keys)
    cur = base_regret
    added = []
    remaining = list(FEATURE_TRANSFORMS)
    improved = True
    while improved and remaining:
        improved = False
        best_k, best_r = None, cur
        for k in remaining:
            r = _loo_regret(examples, keys + [k])
            if r < best_r - 1e-9:
                best_r, best_k = r, k
        if best_k is not None:
            keys.append(best_k)
            added.append(best_k)
            remaining.remove(best_k)
            cur = best_r
            improved = True
            if verbose:
                print(f"  + added feature '{best_k}': regret {cur:.3f}")
    if verbose and not added:
        print("  (no derived feature improved on the base set)")
    return keys, base_regret, cur


# ---------------------------------------------------------------------------
# 2. self-authored frontier domains
# ---------------------------------------------------------------------------
DOMAIN_FAMILIES = {
    "logistics": lambda a, b: domains.logistics(a, b),
    "blocksworld": lambda a, b=None: domains.blocksworld(a),
}


def _grid(family):
    if family == "logistics":
        return [(n, m) for n in range(2, 8) for m in range(1, n) if m <= 4]
    return [(b, None) for b in range(3, 8)]


def find_frontier(family="logistics", lo_pct=0.6, hi_pct=0.95,
                  time_limit=10.0, verbose=True):
    """Generate the hard-but-solvable frontier: instances whose best-config
    difficulty (measured by SAT calls, which scale cleanly) sits in the
    [lo_pct, hi_pct] percentile band of the family's grid. Auto-calibrating, so
    it works regardless of how fast the current best configs are."""
    from .pdr import PDR
    builder = DOMAIN_FAMILIES[family]
    measured = []
    for params in _grid(family):
        prob = builder(*params)
        # difficulty measured by the DEFAULT solver -- this is where the learned
        # operators/policy earn their value (the best config may trivialise it).
        diff = PDR(prob, time_limit=time_limit).solve().stats.get("sat_calls", 1)
        measured.append((f"{family}{params}", prob, diff))
    diffs = sorted(m[2] for m in measured)
    if not diffs:
        return []
    lo = diffs[int(lo_pct * (len(diffs) - 1))]
    hi = diffs[int(hi_pct * (len(diffs) - 1))]
    chosen = []
    for name, prob, sat in measured:
        band = lo <= sat <= hi
        if verbose:
            print(f"  {name}: default-solver {sat:4d} SAT calls"
                  f"{'   <-- frontier' if band else ''}")
        if band:
            chosen.append((name, prob, sat))
    return chosen


# ---------------------------------------------------------------------------
# demo
# ---------------------------------------------------------------------------
def main():
    print("L3 self-authoring\n")
    print("== 1. self-authored FEATURES (lower meta-policy regret is better) ==")
    inst = [("logistics-3-2", domains.logistics(3, 2)),
            ("logistics-4-3", domains.logistics(4, 3)),
            ("logistics-5-3", domains.logistics(5, 3)),
            ("logistics-4-4", domains.logistics(4, 4)),
            ("blocks-3", domains.blocksworld(3)),
            ("blocks-4", domains.blocksworld(4)),
            ("blocks-5", domains.blocksworld(5)),
            ("fuel", domains.fuel_logistics(2))]
    examples = label_examples(inst)
    keys, base_r, final_r = author_features(examples)
    print(f"  base-feature regret : {base_r:.3f}")
    print(f"  authored regret     : {final_r:.3f}   features: {keys}\n")

    print("== 2. self-authored frontier DOMAINS (auto-calibrated difficulty band) ==")
    front = find_frontier("logistics")
    print(f"  -> generated {len(front)} frontier instances: "
          f"{[n for n, _, _ in front]}")


if __name__ == "__main__":
    main()
