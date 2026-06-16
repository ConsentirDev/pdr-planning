# Self-improving PDR — what it is, what it shows, and what it doesn't (yet)

This document describes an experimental layer built **on top of** Ava Clifton's PDR
thesis: a fitness-driven loop that *configures*, *selects*, and ultimately
*synthesises* PDR search heuristics, with the thesis's soundness/validation
machinery as a verifier. It is a follow-on to the thesis, not a parallel claim.

> **On the name.** Earlier drafts called this "recursive self-improvement (RSI)."
> That framing over-promises: RSI in the strong sense means a system that improves
> its own *cognition*, not just its configuration. What's actually here is a
> well-understood stack — algorithm configuration, per-instance algorithm
> selection, and verifier-grounded program synthesis — plumbed into PDR. The file
> keeps the `RSI.md` name for continuity; the honest description is below.

---

## TL;DR (the honest version)

The thesis spent five chapters hand-designing a family of PDR moves (PDR-M,
PDR-IL, look-ahead `F`, rescheduling, parallelism, decomposition) and showed
empirically that **the right move depends on the problem**. This layer turns that
observation into a loop that *picks* the right move per problem, and — on one
seam — *invents* a new one, under a verifier that makes a bad candidate slower but
never wrong. The single result worth defending is the **held-out story**: a
naïve optimiser overfit four training instances; a train/validation/test split
caught it; and the re-run produced a *simpler* operator that genuinely
generalised to disjoint instances. That is honest research practice and the
strongest part of the work.

Everything else should be read as a **prototype on small, plan-rich demo
domains**. The [Empirical results](#empirical-results--captured-reproducible-negatives-included)
section reports what actually happens when you run it on real IPC instances —
including the finding that the discovered operator generalises on SAT-calls but is
*slower in wall-clock* than the baseline there — and [Threats to validity](#methodology--threats-to-validity)
is not glossed. Reproduce any of it with `python3 -m pdr.experiments <name>`.

---

## Positioning: this is a known stack, applied to PDR

Each rung below is a mature subfield. The contribution is **not** the technique;
it is (a) wiring this stack into PDR, and (b) doing it through a
**soundness-preserving** verifier plus a held-out generalisation criterion. Where
this layer sits in the literature:

| Here | The actual technique | Prior art it should be measured against |
|---|---|---|
| L0 auto-tuning | per-problem **algorithm configuration** | ParamILS, SMAC, irace |
| L1 meta-policy | per-instance **algorithm selection** | SATzilla (2008), AutoFolio, claspfolio, Hydra |
| L2 operator evolution | **verifier-grounded program synthesis** | FunSearch, AlphaEvolve; learning-to-branch (Khalil et al. 2016, Gasse et al. 2019) |
| L3 meta-search | hyperparameter/curriculum adaptation | teacher–student curricula; standard meta-search |

We do not benchmark against any of these yet (see threats below). Until we do, the
defensible claim is *"we operationalised this stack inside PDR with a verifier,"*
not *"we beat / advanced it."*

---

## Why PDR is a good substrate

1. **A verifiable fitness signal, for free.** Every PDR variant is sound and
   complete and every output is independently checkable — `validate_plan` replays
   a classical plan, `validate_policy` checks a FOND policy is genuinely
   strong-cyclic, `reference_answer` gives ground truth. So a *faster-but-wrong*
   solver is mechanically rejected. Optimisation loops die without a trustworthy
   fitness signal; here correctness is not part of the objective, it is a gate.

2. **A structured knob space where nothing dominates.** The thesis (Table 3.2,
   Figs 3.5–3.6) shows each variant winning on *some* domains and losing on
   others, tied to cheap, observable features (size, branching, decomposability).
   That exploitable variance is what an algorithm selector climbs.

3. **Composable knowledge.** PDR learns reasons/layer clauses; PD-PDR builds large
   solutions from sub-problem solutions. So easy instances can, in principle,
   produce artifacts that make hard instances easier.

---

## The ladder

### L0 — Algorithm configuration. *Implemented.*
Race the configs on a problem, keep the fastest that solves (`search_best_config`).
Beats any fixed default because — per the thesis — no fixed default is good
everywhere. This is ParamILS/SMAC-style configuration, brute-forced (we race
rather than model-search the space).

### L1 — Per-instance algorithm selection. *Implemented (with a caveat).*
Learn `features(problem) → config` from the races so a *new* problem gets a good
config without searching. `selfimprove.MetaPolicy` is a **nearest-neighbour**
learner over normalised features (`n_props`, `n_actions`, goal size,
decomposability, action density), warm-started from the structurally-nearest
solved instance.

`recursive_improve` closes L0+L1 over a curriculum (solve with the policy →
config-search where it's sub-optimal → teach the policy → push the frontier →
repeat), and the measured trajectory (`python3 -m pdr.selfimprove`) is:

| round | instances | capability frontier | policy regret vs oracle |
|------:|----------:|--------------------:|------------------------:|
| 1 | 3 | 4 | 2.80× |
| 2 | 5 | 5 | 1.64× |
| 3 | 7 | 6 | 1.12× |
| 4 | 9 | 7 | 1.11× |

Capability climbs while regret collapses toward 1.0×, and the loop re-derives the
thesis's finding that PDR-M with large `F` suits these logistics-shaped instances.

> **Caveat (important).** Nearest-neighbour is the *weakest* defensible selector —
> SATzilla used ridge/RF with cross-validation in 2008; AutoFolio learns selectors
> over ASlib. A regret of 1.11× on a narrow demo distribution may say more about
> the distribution than the learner. The honest next step is RF/AutoFolio with
> proper CV, benchmarked head-to-head. This number is a *demonstration*, not a
> result.

### L2 — Verifier-grounded operator synthesis. *Implemented.*
L0/L1 search a *fixed* knob space; L2 proposes **new search heuristics as code**,
scored by the verifiable harness — FunSearch/AlphaEvolve in spirit, grounded so it
can't fake a win.

**The seams are soundness-preserving *by construction*** (this is the careful
part, and it is by construction, not assertion):
  * `tie_breaker` orders only obligations that **already share the minimal layer
    index** — the termination invariant is literally untouched, so any order
    terminates with the same answer;
  * `reason_order` orders which literals are tried first during reason
    minimisation — **every** order still yields a valid reason (minimisation only
    drops literals whose removal preserves the unsat core);
  * `progress_strategy` (the look-ahead `F`) — see the lemma below.

So a candidate can only ever be **slower, never wrong**, and the loop is safe to
run unattended.

Operators come as TEMPLATE (a weight vector the autonomous engine mutates) or
SOURCE (a sandboxed Python function an LLM writes). The loop: propose → **safety
gate** (must solve & validate every instance it runs on) → **fitness** → Pareto
archive → feed the leaderboard back into the prompt. Two engines:
`evolutionary_search` (no LLM) and `llm_search` (Anthropic API or an offline
callback).

**Measured (`--mode evolve --seam reason`):** the search finds *drop True /
non-goal literals first, keep goal literals last* — **927 vs 1128 SAT calls
(1.22×)**, holding **1.19×** on four held-out instances. This is **confirmation,
not discovery**: it re-derives the thesis's own hint (looser reasons → tighter
layers), and is worth keeping as a sanity check that the loop finds *known-good*
moves before we trust it on unknown ones. The obligation seam shows ~1.0× — a
genuine null result the harness surfaced, reported rather than buried: that lever
doesn't move these domains.

### Progression seam — operationalising Ava §7.2. *Implemented.*
**Credit where it's due: Ava's §7.2 future work conjectures exactly this** — *"the
macro length could be adapted online to suit the problem being solved … combined
with PS-PDR, with each worker considering a different length macro."* We
operationalise her conjecture via LLM-guided synthesis under a held-out
generalisation criterion. That is the sharp, honest framing of this result — not
"evolution invented adaptive `F`."

The progression formula (`pdr.py:_progress`) decides how far to look ahead per
obligation, exposed as `progress_strategy(i, k, state, ctx) -> F` under PDR-M
semantics. Evolution finds an **adaptive look-ahead** (deeper while far from the
goal) that on held-out instances beats F=1 by ≈4.3× and fixed PDR-M (F=3) by
≈1.28× **in SAT calls** (read the [metric caveat](#methodology--threats-to-validity)).

> **Soundness lemma (per-state / per-call adaptive `F`).** PDR-M's soundness does
> not depend on `F` being constant across calls. A single progression expands a
> macro of `F` ∀-step transitions; each transition is a set of real, non-interfering
> action applications validated against the layer invariants exactly as in the
> fixed-`F` proof, and the macro is admitted only if every intermediate state
> satisfies the relevant frame. Choosing `F` from `(i, k, state)` changes only
> *how many* transitions a call expands, never *whether* an expanded transition is
> legal. Finally the returned plan is independently replayed by `validate_plan`.
> Hence any `progress_strategy` is sound; it can only change cost. ∎
> (Two lines, as requested — and necessary, since this seam dominates the payoff
> ranking.)

### L3 — Meta-search over the search's own knobs. *Implemented.*
`meta_evolve` adapts the *search's* parameters online: **seam selection**
(warm-up then payoff-greedy — it learns `payoff[progression] ≫ payoff[reason] >
payoff[obligation]` and spends budget there), **mutation scale** (shrink on
improvement, grow on stagnation), and **curriculum** (auto-expand toward the
frontier). This is standard meta-search and teacher–student curriculum learning —
useful, not novel, and not "the system rewriting its own cognition."

### Held-out selection: catching, then fixing, overfitting. *Implemented.*
**This is the part worth showing a serious reader.** Running the live LLM
(`claude-sonnet-4-6`) on the progression seam surfaced a real failure mode the
harness caught: the model wrote an elaborate multi-branch operator that was
spectacular on the four *training* instances (4 SAT calls) but on held-out
instances generalised **worse than fixed PDR-M** (615 vs 460). It had overfit.

The fix is standard ML hygiene, now built into `evolve.py`: a train/validation
split (`evaluate_split`, `train_valid_split`). Candidates are scored on training
but **ranked and archived by *validation* SAT calls on larger held-out problems**,
and must be safe on both. Re-running with the split, the model produced a smooth
distance-to-goal rule:

```python
def depth(f, i, k, state, ctx):
    distance = 0.5 * f['i_frac'] + 0.5 * (1.0 - f['goalsat'])
    raw = 2.0 + 4.0 * distance + 0.5 * (1.0 - abs(f['ntrue'] - 0.5) * 2.0)
    return max(2, min(7, int(round(raw))))
```

Under train / validation / **test**:

| set | F=1 baseline | PDR-M (F=3) | LLM-discovered (split-selected) |
|---|---:|---:|---:|
| validation (6 larger) | 2497 | 652 | **349** (7.2×; 1.9× vs PDR-M) — *SAT calls* |
| fresh **test** (disjoint) | 3080 | 924 | **662** (4.7×; 1.4× vs PDR-M) — *SAT calls* |

The same loop that overfit when optimising *training* fitness produced a
generalising operator once it optimised *held-out* fitness. Kept as the
`llm-discovered-smooth` seed. (`--mode llm --seam progression --split`.)

### Transferred learned reasons. *Implemented (sound, ≈neutral here).*
`transfer.py` lifts the reason-clauses PDR learns on a small instance (ground →
typed variables), regrounds them on a larger instance, and **re-verifies each by
SAT before trusting it** — naïve transfer would be unsound; this can only speed up,
never change the answer. On the small, plan-rich demo domains PDR derives few
reasons, so the effect is ≈neutral. The contribution is the *sound mechanism*; the
payoff is expected on dead-end-heavy / larger instances we haven't run.

### Feature engineering & curriculum generation. *Implemented.*
(Previously oversold as "L3 self-authoring.") `selfauthor.py` does two known,
useful things: (1) greedy **LOOCV-guided feature engineering** — adds derived
features to the L1 policy only when they lower leave-one-out regret (base set
always retained, so it can't regress); and (2) **difficulty-band curriculum
generation** — instances in an auto-calibrated hard-but-solvable band. These are
feature selection and teacher–student curriculum learning, fine on their own
merits and labelled as such.

---

## Empirical results — captured, reproducible, negatives included

These came out of the third-party review. Every number below is from a live run of
`python3 -m pdr.experiments <name>` (reproducible; small real IPC instances
auto-download from the Fast Downward benchmark set). They are deliberately reported
*with* their failures.

### (#2 + #5) Real IPC instances, held-out domains — the headline, and it cuts both ways
We evaluated three progression operators — baseline `F=1`, fixed PDR-M `F=3`, and the
`llm-discovered-smooth` operator (tuned only on synthetic logistics/blocks) — on **10
real IPC instances** (gripper, miconic, movie) the operator had **never seen**. These
are the held-out *domains* the review asked for; gripper is structurally unlike
logistics. Totals over the 10 instances (all solved):

| operator | SAT calls | wall-clock | verdict |
|---|---:|---:|---|
| baseline `F=1` | 20807 | **4238 ms** | most calls, **fastest in time** |
| PDR-M `F=3` | 9242 | 7464 ms | |
| discovered (tuned on synthetic) | **5432** | 7426 ms | **fewest calls**, but ~1.75× slower than `F=1` |

Two honest findings in one table:
1. **The discovered operator *does* generalise** to unseen real domains on the metric
   it was selected by — 5432 SAT calls vs 9242 (PDR-M) vs 20807 (baseline). It is not
   merely memorising logistics.
2. **…but SAT-calls ≠ runtime, demonstrated on real IPC.** Baseline `F=1` issues **4×
   more SAT calls yet is the fastest in wall-clock** — because on gripper the extra
   calls are cheap, while `F≥3` issues *fewer but harder* queries. This is exactly the
   reviewer's #1 concern, confirmed on a substrate we did not design. **The headline
   speed-ups are "fewer queries," not "faster planner."**

### (#1) Do the two metrics agree? (`fitness`)
On the synthetic curriculum the SAT-call-best and wall-clock-best configs agree on
**9/10** instances (the one disagreement is a 1.06× wall penalty). So on small,
homogeneous instances they mostly track — but the real-IPC result above shows they
**diverge sharply** when call-cost varies across domains. We therefore keep SAT-calls
as the **reproducible primary** (engine-pinned, noise-free) and now (a) record
per-instance wall-clock everywhere, (b) expose a SAT-calls/wall-clock **toggle in the
in-app bench**, and (c) added a `rank_by="wall"` option to `evolutionary_search` so the
objective itself can be switched (noisier, non-deterministic — used with eyes open).

### (#4) Multi-seed evolution, with a CI (`seeds`)
Over 6 seeds, the evolved champion is **349 valid SAT calls, 95% CI [349, 349]**
(7.15× vs the F=1 baseline of 2497). The zero-width CI is itself the finding: **the
champion is the same curated seed (`llm-discovered-smooth`) on every seed** — live
mutation does not beat it in 4 generations. So the win is **selection of a pre-found
operator, not online discovery**, exactly as the review suspected. (Honest discovery
would need a much larger live-LLM budget, or harder instances where the seed isn't
already near-optimal.)

### (#3) Is the L1 learner any good? We can't tell here (`selector`)
On a 10-instance logistics+blocks pool, leave-one-out regret-vs-oracle is **1.00× for
every selector — oracle, single-best-static, nearest-neighbour, *and* a random forest
with proper CV**. The reason: **one config (PDR-M `F=3/4`) dominates every instance**,
so the single-best static *is* the oracle and there is nothing for a per-instance
selector to learn. This means the L1 "regret → 1.11×" number says **nothing about the
learner** — it reflects a narrow demo distribution. Evaluating selection at all
requires a diverse benchmark (ASlib / AutoFolio); the RF+CV machinery is now in place
for when one is wired in.

### (#5) Held-out domains, synthetic (`crossdomain`)
Evolve a champion on logistics only, test on blocks only (and vice-versa). The
logistics-tuned champion *does* transfer to blocks (**2.74× vs baseline**) but is
**weaker than the blocks-native champion (4.55×)** — a real, measurable
generalisation gap across domains, not a clean transfer. (On logistics both pick deep
look-ahead and tie, so that direction is uninformative — another sign the demo pool is
a weak test.)

---

## Methodology & threats to validity

Read the headline numbers through these. They are the difference between
"prototype" and "result," and the work is currently the former.

1. **Fitness is SAT-call count, not wall-clock. This is the biggest caveat.**
   Ava's Table 3.1 shows cost-per-call moving ~4 orders of magnitude (F=3 ≈ 0.6s
   vs F=6 ≈ 6197s at comparable macro counts). An operator that issues *fewer but
   harder* SAT queries can win on calls while **losing on runtime**. So the
   1.22×/1.28×/4.7× numbers mean **"fewer SAT queries,"** not "faster planner."
   - *Why calls, not time, for the objective:* SAT-call count is deterministic and
     engine-pinned (`FITNESS_ENGINE = minisat22`), so the search is reproducible
     and noise-free. Wall-clock is what you feel but is machine/backend/noise
     dependent.
   - *What we now also do:* the evaluator records **per-instance wall-clock (ms)**
     alongside calls, and the in-app bench lets you flip the comparison between SAT
     calls and wall-clock — precisely so you can see where the two disagree. A
     runtime-primary (or multi-objective) fitness, and peak-memory, are the right
     next step.

2. **Demo domains, not benchmarks. Structural, not a footnote.** The thesis's
   load-bearing observation comes from IPC 1998–2014 across diverse domains. Our
   loop "rediscovering" that large-`F` PDR-M suits logistics-shaped instances is a
   *sanity check*, and risks circularity if the demo generator is logistics-shaped
   to begin with. The claim "the loop selects, then invents, those moves on its
   own" is only evaluable on a substrate we did **not** design.
   - *Now done (closes part of the gap):* a real PDDL front-end (`pddl.py`) and a
     real SAT backend (python-sat / **Lingeling**, also CaDiCaL) exist, and a real
     **IPC-2000 logistics-10-0** instance solves end-to-end (1040 ground actions).
   - *Still the real gap:* the **evolution loop has not been re-run on the IPC
     suite at scale.** Doing so is what would move this from prototype to result.

3. **Sample sizes, seeds, variance.** The L1 table is 4 rows, 3–9 instances each;
   the evolution numbers are single-seed; there are no confidence intervals, no
   ablation over curriculum order, no robustness check across demo generators. For
   anything framed as "compounding," multi-seed runs with CIs are not optional.
   Treat every number here as a single-seed point estimate.

4. **"Held-out" is held-out *instances*, not *domains*.** The validation/test sets
   are larger instances from the same generators as training. The fresh test set
   helps, but the stronger (and honest) version is held-out **domains** — train on
   logistics, test on blocksworld/depots/etc.

5. **The safety gate is not "uncheatable."** It guarantees **soundness on every
   instance an operator runs on** — that genuinely cannot be gamed. It does **not**
   guarantee *fitness* generalisation: an operator can be sound everywhere yet slow
   on instances outside the suite. That's exactly the overfitting the held-out
   story documents, and the right framing is *"soundness preserved always;
   generalisation enforced by held-out validation, which is necessary and not
   automatic,"* not "cannot be cheated."

6. **The L1 learner is a placeholder** (see its caveat): NN, not RF/AutoFolio with
   CV.

---

## What's done, and what would make this credible to a serious reader

**Now in the repo (some of it since the first review):**
- PDDL front-end (`pddl.py`); real SAT backend (Lingeling/CaDiCaL via python-sat);
  a real IPC-2000 instance solving end-to-end.
- Per-instance wall-clock recorded alongside SAT calls; an interactive bench that
  compares two operator/run configs per-instance and flips between the two metrics.
- The held-out train/validation/test discipline, with the overfitting failure and
  its fix both reproducible.

**The review's "what would cash the cheques" list — status after the empirical pass
above (`pdr/experiments.py`):**
1. **Wall-clock fitness** — *partly done.* Wall-clock is now recorded per-instance,
   shown in the bench, and selectable as the objective (`rank_by="wall"`). We keep
   SAT-calls as the reproducible *primary*; the real-IPC result is the argument for
   why runtime must be reported (and why we don't blindly optimise the noisy metric).
   *Still open:* a multi-objective / repeated-measurement runtime objective.
2. **Re-run on real IPC** — *done at small scale.* The evolution/eval now runs on real
   IPC gripper/miconic/movie; the headline finding (generalises on calls, not on
   runtime) is above. *Still the real gap:* the full IPC suite at scale — blocks-10
   and logistics-10 still time out, so the loop hasn't been run on the hard instances.
3. **RF vs NN learner with CV** — *done, but uninformative here.* Both tie the oracle
   at 1.00× because one config dominates the demo pool. The honest conclusion is that
   a real ASlib/AutoFolio benchmark is needed; the RF+CV harness is ready for it.
4. **Seeds + CIs** — *done.* Reported above; the zero-width CI exposed that the win is
   a curated seed, not live discovery. *Still open:* curriculum-order ablation at scale.
5. **Held-out domains** — *done* (real IPC gripper/miconic + synthetic logistics→blocks),
   with a measured transfer gap. *Stronger version still open:* a domain-stratified
   benchmark suite.
6. **Cite and position against prior art** — *done* (table above + references below).

The remaining true gap is **scale**: every result here is on small instances
(the hard IPC ones time out), single-machine, with the objective a reproducible proxy.
That is the honest line between "a credible, self-aware prototype" and "a result."

---

## References (the prior art this is measured against)

- **PDR / IC3.** A. Bradley, *SAT-Based Model Checking without Unrolling*, VMCAI 2011.
  (The model-checking algorithm Ava's thesis adapts to planning.)
- **Algorithm configuration.** F. Hutter, H. Hoos, K. Leyton-Brown, T. Stützle,
  *ParamILS*, JAIR 2009; F. Hutter, H. Hoos, K. Leyton-Brown, *Sequential
  Model-Based Optimization (SMAC)*, LION 2011.
- **Per-instance algorithm selection.** L. Xu, F. Hutter, H. Hoos, K. Leyton-Brown,
  *SATzilla*, JAIR 2008; M. Lindauer, H. Hoos, F. Hutter, T. Schaub, *AutoFolio*,
  JAIR 2015; L. Xu, H. Hoos, K. Leyton-Brown, *Hydra*, AAAI 2010.
- **Learning to branch / search.** E. Khalil, P. Le Bodic, L. Song, G. Nemhauser,
  B. Dilkina, *Learning to Branch in MILP*, AAAI 2016; M. Gasse et al., *Exact
  Combinatorial Optimization with GNNs*, NeurIPS 2019.
- **Verifier-grounded program synthesis.** B. Romera-Paredes et al., *FunSearch*,
  Nature 2024; *AlphaEvolve*, DeepMind 2025.

This layer plumbs (configuration → selection → verifier-grounded synthesis) into PDR
with a soundness-preserving verifier and a held-out criterion. It does not yet
benchmark against any of the above; doing so is the work that would make the
comparison earned rather than asserted.

---

## The honest throughline

The thesis hand-designed a family of PDR moves and showed the right move depends on
the problem. This layer turns that into a loop that **selects** the right move per
problem and, on the progression seam, **synthesises** a new one — operationalising
Ava's own §7.2 conjecture — with her soundness/validation guarantees as a gate that
keeps the loop honest. The mechanism is sound and the held-out discipline is real.
The *evidence* is currently prototype-scale: demo domains, SAT-call proxy,
single-seed, a placeholder selector. Tighten those and it is a credible follow-on
to the thesis; left as-is, it is a promising prototype that should not be dressed
as more.
