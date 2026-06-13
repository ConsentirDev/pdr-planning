# Recursively self-improving PDR — design & roadmap

This doc explains how to push your friend's thesis "even further" by wrapping the
whole solver family in a **recursive self-improvement (RSI) loop**, why the
thesis is an unusually good substrate for it, what's implemented today, and the
ladder from here to LLM-driven algorithm discovery.

---

## Why PDR is a great substrate for self-improvement

Three properties have to hold for self-improvement to actually compound. The
thesis hands us all three:

1. **A verifiable fitness function, for free.** Every PDR variant is *sound and
   complete*, and every output is independently checkable — `validate_plan`
   replays a classical plan against the real world; `validate_policy` checks a
   FOND policy is genuinely strong-cyclic; `reference_answer` gives ground truth.
   So a proposed improvement can never "cheat" the score: a faster-but-wrong
   solver is caught. RSI loops die without a trustworthy fitness signal; here it
   is mechanical.

2. **A big, structured knob space where nothing dominates.** Table 3.2 / Figs
   3.5–3.6 show PDR-M, PDR-IL, the look-ahead `F`, rescheduling, parallel
   workers, and decomposition each win on *some* domain and lose on others. That
   variance is not noise — it's exploitable structure tied to cheap, observable
   problem features (size, branching, decomposability). Wherever there is
   structure + a fitness function, a learner can climb.

3. **Composable knowledge.** PDR *learns* (reasons / layer clauses); PD-PDR
   literally *builds large solutions out of small sub-problem solutions*. So
   solving easy instances produces artifacts that make hard instances easier —
   the precondition for a frontier that expands rather than plateaus.

---

## The ladder of self-improvement

### L0 — Auto-tuning (self-configuration). *Implemented.*
Treat the knobs as a search problem and the benchmark harness as fitness. For a
given problem, *race* the configs and keep the fastest that solves
(`search_best_config`). This already beats any fixed default, because the thesis
showed no fixed default is good everywhere.

### L1 — A learned meta-policy (self-configuring portfolio). *Implemented.*
Auto-tuning per problem is expensive. Instead, learn a function
`features(problem) → config` from the races, so a *new* problem gets a good
config without a search. `selfimprove.MetaPolicy` is a nearest-neighbour learner
over normalised features (`n_props`, `n_actions`, goal size, decomposability,
action density). It is warm-started from the structurally-nearest solved
instance — cheap knowledge transfer.

**The recursive loop (`recursive_improve`)** closes L0+L1 over a *curriculum*:

```
solve current frontier with the meta-policy
  └─ where the policy is sub-optimal, run a config search (LEARN the winner)
       └─ teach the meta-policy, then PUSH the frontier to harder instances
            └─ harder instances are warm-started from easier neighbours … repeat
```

Measured outcome (run `python3 -m pdr.selfimprove`):

| round | instances | capability frontier | policy regret vs oracle |
|------:|----------:|--------------------:|------------------------:|
| 1 | 3 | 4 | 2.80× |
| 2 | 5 | 5 | 1.64× |
| 3 | 7 | 6 | 1.12× |
| 4 | 9 | 7 | 1.11× |

Capability climbs while regret collapses toward 1.0× — the system gets *both*
broader and sharper each round, and it rediscovers, on its own, the thesis's
finding that PDR-M with large `F` is the right tool for the logistics-shaped
instances.

### L2 — Algorithm/operator evolution (LLM-in-the-loop). *Implemented.*
L0/L1 search a *fixed* knob space. The thesis's contributions (PDR-M, PDR-IL,
PS-PDR, …) are themselves points a human invented by varying the algorithm. L2
automates *that*: propose **new search operators as code**, scored by this repo's
verifiable harness — FunSearch / AlphaEvolve, but grounded so it can't fake a win.

**The seams (`pdr.py`).** Two of PDR's hot decision points are exposed as
pluggable callables, chosen specifically because they are *soundness-preserving
by construction*:
  * `tie_breaker` — orders only the obligations that **already share the minimal
    layer index** (the termination invariant is untouched);
  * `reason_order` — orders which literals are tried first during reason
    minimisation (**every** order still yields a valid reason).
A candidate operator can therefore only ever be slower, never wrong — so the
loop is safe to run unattended, and the safety gate cannot be cheated.

**Operators (`operators.py`)** come in two forms: TEMPLATE (a weight vector over
normalised features — what the autonomous engine mutates) and SOURCE (a sandboxed
Python function over those features — what an LLM writes).

**The loop (`evolve.py`):**
```
propose operator → SAFETY GATE (must solve & validate every instance)
                 → FITNESS (total SAT calls; deterministic, noise-free)
                 → Pareto ARCHIVE → feed the leaderboard back into the prompt
```
Two engines: `evolutionary_search` (autonomous, no LLM) and `llm_search`
(proposer = the Anthropic API, or a manual callback so it runs offline).

**Measured (run `python3 -m pdr.evolve --mode evolve --seam reason`):** the
search autonomously discovers a reason-ordering operator — *drop True / non-goal
literals first, keep goal literals last* — that uses **927 vs 1128 SAT calls
(1.22×)**, fully validated. It **generalises**: on four held-out instances it
holds **1.19×**. (This matches the thesis's own hint that reasons denoting
propositions *False* yield looser reasons → tighter layers.) The obligation seam,
by contrast, shows ~1.0× here — a real finding the harness surfaced: that lever
doesn't move these domains.

### L3 — Improving the improver (meta-RSI). *Implemented.*
The search's own choices are parameters; `meta_evolve` adapts them online:
  * **Seam selection** (warm-up + payoff-greedy): the meta-loop *learns which
    seam pays off* and concentrates budget there. Run
    `python3 -m pdr.evolve --mode meta` and it discovers
    `payoff[reason]≈1.3× ≫ payoff[obligation]≈1.0×` and spends ~5/6 rounds on the
    reason seam — i.e. it learns *where to look*, not just what to try.
  * **Mutation scale** shrinks on improvement (exploit), grows on stagnation.
  * **Curriculum** auto-expands toward the frontier (3→7 instances) as the
    current set is mastered.

This is where "recursive" becomes literal: the object-level planner, the L1
policy that configures it, and the L2/L3 search that improves that configuration
are all under one fitness-driven loop, with the thesis's
soundness/validation guarantees as the guardrail at every level.

### Wider seams — the progression operator. *Implemented.*
The richest seam is the *progression formula* itself (`pdr.py:_progress`): how far
to look ahead per obligation. We expose it as `progress_strategy(i, k, state, ctx)
-> F` under PDR-M semantics (still soundness-preserving — every plan is
validated). PDR-M / PDR-IL are themselves ~5-line diffs of `_progress`, so this is
the seam where an evolved operator can *surpass a hand-designed thesis variant* —
and it does: evolution finds an **adaptive look-ahead** (deeper while far from the
goal) that on **held-out** instances beats F=1 by ≈4.3× and **fixed PDR-M (F=3) by
≈1.28×** in SAT calls. In the L3 meta-loop this seam dominates the payoff ranking
(`progression ≫ reason > obligation`), and the improver concentrates its budget
there. Run `python3 -m pdr.evolve --mode evolve --seam progression`.

### Transferred learned reasons across the curriculum. *Implemented (sound).*
`transfer.py` harvests the dead-ends (reason clauses) PDR learns on a small
instance, *lifts* them (ground objects → typed variables), *regrounds* onto a
larger instance, and **re-verifies each by SAT before trusting it** — so transfer
can only ever speed things up, never change the answer (naive transfer would be
unsound). On the small, plan-rich demo domains PDR derives few reasons so the
effect is ≈neutral; the contribution is the *sound mechanism* that lets a
curriculum compound safely, with payoff expected on dead-end-heavy / larger
instances. Run `python3 -m pdr.transfer`.

### L3 self-authoring of features & domains. *Implemented.*
`selfauthor.py` lets L3 rewrite two of its own ingredients: (1) it greedily ADDS
derived features (ratios, products, logs) to the L1 meta-policy whenever they
lower leave-one-out prediction regret (the base set is always retained, so it can
never regress); and (2) it auto-generates a *frontier curriculum* — instances in
an auto-calibrated difficulty band (hard-but-solvable for the default solver),
where learning signal is richest. Run `python3 -m pdr.selfauthor`.

### Still open
  * A PDDL front-end and an IPASIR/CaDiCaL SAT backend (the biggest scaling win —
    `sat.py` is a 5-method seam).
  * More seams: clause-push order, the FOND sink-removal order.
  * Live, large-budget LLM-in-the-loop sweeps across all seams at once.

---

## Concrete near-term roadmap (grounded in this repo)

1. **Transfer learned reasons across a curriculum (cheap, high value).** Lift
   PDR reason-clauses on small instances into *schemas* and seed them into
   larger instances of the same domain. The layers in `pdr.py`/`fond.py` are
   already clause sets — seeding is an `_add_reason_clause` at startup. Expect
   the biggest single speedup, and it makes the frontier genuinely compounding
   rather than just well-configured.

2. **Auto-generate the curriculum** instead of hand-listing sizes: mutate a
   domain (add packages/blocks/fuel/outcomes) and keep instances near the
   capability boundary — the ones that teach the most.

3. **Wire L2's first operator seam.** Expose `PDR._progress` and the obligation
   comparator as pluggable strategies, give the harness a `--candidate` hook,
   and run a small FunSearch loop over LLM-proposed comparators. Obligation
   ordering is the safest first target (it can't affect soundness, only speed),
   so a bad candidate just loses on time, never on correctness.

4. **Self-improving FOND.** The FOND policy generator's sink-removal ordering and
   the forward-push schedule are tunable; the same L0/L1 machinery applies, with
   `reference_answer` as the correctness oracle.

The throughline: the thesis spent five chapters hand-designing a family of PDR
moves and showed empirically that the *right move depends on the problem*. RSI
turns that observation into a system that selects, and then invents, those moves
on its own — with the thesis's soundness/validation guarantees as the guardrail
that keeps the loop honest.
