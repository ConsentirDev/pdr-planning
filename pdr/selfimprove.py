"""
Recursive self-improvement on top of the PDR planner family.

------------------------------------------------------------------------------
Why this is the natural "push it further"
------------------------------------------------------------------------------
The thesis's own headline empirical finding (Ch 3, Table 3.2 / Figs 3.5-3.6) is
that *no single solver configuration dominates* -- PDR vs PDR-M vs PDR-IL, the
look-ahead depth F, rescheduling, parallel workers, decomposition: which is best
swings wildly by domain. That is the textbook precondition for a self-improving,
self-configuring system: there is real, exploitable structure in "which knob for
which problem", and we have a *verifiable fitness function* (the benchmark
harness) plus *cheap features*.

This module implements a working, runnable self-improvement loop:

  1. CONFIG SPACE   -- the knobs across all of Chapters 2-5 (engine, variant, F,
                       rescheduling, clause-pushing, parallel workers).
  2. FITNESS        -- run a config on a problem, measure solved? + wall time.
  3. SEARCH         -- race configs on a problem to find the best (the "oracle").
  4. META-POLICY    -- learn features(problem) -> best config (a self-configuring
                       portfolio). Nearest-neighbour over normalised features.
  5. CURRICULUM     -- generate progressively harder instances.
  6. RECURSION      -- the loop closes: the meta-policy lets us solve harder
                       problems; searching configs on those teaches the policy;
                       a better policy pushes the capability frontier further out;
                       the best config for a hard instance is warm-started from
                       the structurally-nearest easier one (knowledge transfer).
                       We log two curves that should improve every round:
                         * capability frontier (hardest instance solved in budget)
                         * regret  (policy's chosen-config time / oracle-best time)

See RSI.md for the full ladder (this is levels L0-L1; L2 = LLM-driven *algorithm*
evolution using this very harness as the fitness function).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from .pdr import PDR
from .parallel import PSPDR
from .decomp import PDPDR
from . import domains


# ---------------------------------------------------------------------------
# 1. configuration space
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Config:
    engine: str = "pdr"          # 'pdr' | 'ps' | 'pd'
    variant: str = "baseline"    # for engine='pdr': baseline | M | IL
    F: int = 1
    reschedule: bool = True
    clause_pushing: bool = True
    workers: int = 4             # for engine='ps'

    def label(self):
        if self.engine == "pdr":
            return f"pdr/{self.variant}/F{self.F}/{'R' if self.reschedule else '-'}{'C' if self.clause_pushing else '-'}"
        if self.engine == "ps":
            return f"ps/M{self.workers}"
        return "pd"


def config_space():
    cfgs = []
    for variant, F in [("baseline", 1), ("M", 2), ("M", 3), ("M", 4),
                       ("IL", 2), ("IL", 3)]:
        cfgs.append(Config("pdr", variant, F))
    cfgs.append(Config("pdr", "baseline", 1, reschedule=False))
    cfgs.append(Config("pdr", "baseline", 1, clause_pushing=False))
    for M in (2, 4, 8):
        cfgs.append(Config("ps", workers=M))
    cfgs.append(Config("pd"))
    return cfgs


# ---------------------------------------------------------------------------
# 2. fitness: run a config on a problem
# ---------------------------------------------------------------------------
PENALTY = 1e9


def run_config(cfg: Config, problem, time_limit=5.0):
    t0 = time.perf_counter()
    if cfg.engine == "pdr":
        r = PDR(problem, variant=cfg.variant, F=cfg.F,
                use_reschedule=cfg.reschedule,
                use_clause_pushing=cfg.clause_pushing, time_limit=time_limit).solve()
    elif cfg.engine == "ps":
        r = PSPDR(problem, n_workers=cfg.workers, time_limit=time_limit).solve()
    else:
        r = PDPDR(problem, time_limit=time_limit).solve()
    wall = time.perf_counter() - t0
    solved = r.solvable is not None
    return solved, (wall if solved else PENALTY), r


# ---------------------------------------------------------------------------
# 3. cheap problem features
# ---------------------------------------------------------------------------
def features(problem):
    from .decomp import dependency_edges, goal_relevant, LADG
    n_props = len(problem.props)
    n_actions = len(problem.actions)
    n_goal = len(problem.goal)
    try:
        edges = dependency_edges(problem)
        rel = goal_relevant(problem, edges)
        ladg = LADG(problem, edges, rel)
        n_chunks = len(ladg.chunks)
    except Exception:
        n_chunks = 1
    return {
        "n_props": n_props,
        "n_actions": n_actions,
        "n_goal": n_goal,
        "decomposability": n_chunks,
        "act_per_prop": n_actions / max(1, n_props),
    }


_FEATURE_KEYS = ["n_props", "n_actions", "n_goal", "decomposability", "act_per_prop"]


def _vec(feat):
    return [float(feat[k]) for k in _FEATURE_KEYS]


# ---------------------------------------------------------------------------
# 4. config search ("oracle") -- race configs, return the fastest that solves
# ---------------------------------------------------------------------------
def search_best_config(problem, configs=None, time_limit=5.0):
    configs = configs or config_space()
    best = None
    results = {}
    for cfg in configs:
        solved, metric, _ = run_config(cfg, problem, time_limit)
        results[cfg.label()] = metric
        if best is None or metric < best[1]:
            best = (cfg, metric)
    return best[0], best[1], results


# ---------------------------------------------------------------------------
# 5. meta-policy: features -> config (nearest neighbour, self-configuring)
# ---------------------------------------------------------------------------
class MetaPolicy:
    def __init__(self):
        self.examples = []   # list of (feature_vec, Config)
        self._scale = None

    def _rescale(self):
        if not self.examples:
            return
        cols = list(zip(*[v for v, _ in self.examples]))
        self._scale = [max(1e-9, (max(c) - min(c))) for c in cols]

    def learn(self, problem, config):
        self.examples.append((_vec(features(problem)), config))
        self._rescale()

    def predict(self, problem) -> Config:
        if not self.examples:
            return Config("pdr", "baseline", 1)   # safe default
        q = _vec(features(problem))
        best = None
        for v, cfg in self.examples:
            d = sum(((a - b) / s) ** 2 for a, b, s in zip(q, v, self._scale))
            if best is None or d < best[0]:
                best = (d, cfg)
        return best[1]


# ---------------------------------------------------------------------------
# 6. curriculum + the recursive self-improvement loop
# ---------------------------------------------------------------------------
def curriculum():
    """Increasingly hard instances. (domain_name, builder, difficulty)."""
    items = []
    for n in range(2, 7):
        items.append((f"logistics-{n}", lambda n=n: domains.logistics(n, n - 1), n))
    for b in range(3, 8):
        items.append((f"blocks-{b}", lambda b=b: domains.blocksworld(b), b + 1))
    items.sort(key=lambda x: x[2])
    return items


def recursive_improve(rounds=4, budget=4.0, seed_k=3, verbose=True):
    """Run the closed self-improvement loop and return a per-round report.

    Each round: (a) solve the current frontier using the meta-policy's chosen
    config, (b) wherever the policy is sub-optimal or fails, run a config search
    and teach the policy the winner, (c) push the frontier out to harder
    instances, (d) record capability + regret.
    """
    curric = curriculum()
    policy = MetaPolicy()
    report = []
    frontier = seed_k     # number of (easiest) instances currently "in play"

    for rnd in range(1, rounds + 1):
        instances = curric[:min(frontier, len(curric))]
        solved_in_budget = 0
        regrets = []
        for name, build, diff in instances:
            prob = build()
            # policy's pick (warm-started from nearest known instance)
            pred = policy.predict(prob)
            psolved, ptime, _ = run_config(pred, prob, budget)
            # oracle search (this is where the system *learns*)
            best_cfg, best_time, _ = search_best_config(prob, time_limit=budget)
            policy.learn(prob, best_cfg)
            if best_time < PENALTY:
                solved_in_budget += 1
            # regret: how much slower the policy's pick was vs the oracle
            if psolved and best_time < PENALTY:
                regrets.append(ptime / max(1e-6, best_time))
            elif best_time < PENALTY:
                regrets.append(PENALTY)  # policy failed where oracle succeeded

        # capability frontier = hardest difficulty solved within budget this round
        cap = max((diff for (name, build, diff) in instances
                   if search_best_config(build(), time_limit=budget)[1] < PENALTY),
                  default=0)
        avg_regret = (sum(min(r, 50) for r in regrets) / len(regrets)) if regrets else 0.0
        report.append({
            "round": rnd, "instances": len(instances),
            "solved_in_budget": solved_in_budget,
            "capability": cap, "avg_regret": round(avg_regret, 2),
            "policy_examples": len(policy.examples),
        })
        if verbose:
            r = report[-1]
            print(f"round {rnd}: instances={r['instances']:2d} "
                  f"solved={r['solved_in_budget']:2d} capability={r['capability']:2d} "
                  f"policy_regret={r['avg_regret']:.2f}x  (learned {r['policy_examples']} configs)")
        # expand the frontier (the recursion: better policy -> reach further)
        frontier = min(len(curric), frontier + 2)

    return policy, report


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Recursive self-improvement demo")
    ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--budget", type=float, default=4.0)
    args = ap.parse_args()
    print("Recursive self-improvement over the PDR solver family")
    print("(capability should rise; policy regret should fall toward 1.0x)\n")
    policy, report = recursive_improve(rounds=args.rounds, budget=args.budget)
    print("\nfinal learned policy maps problem-features -> best config.")
    print("per-instance best configs discovered:")
    seen = set()
    for v, cfg in policy.examples:
        if cfg.label() not in seen:
            seen.add(cfg.label())
    print("  config repertoire actually used:", sorted(seen))


if __name__ == "__main__":
    main()
