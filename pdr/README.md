# PDR Planner — your friend's whole PhD thesis, as runnable code

A working, tested, benchmarkable reproduction of **all six technical chapters**
of Ava Clifton's PhD thesis, *"Advancing Property Directed Reachability for
Classical and Fully Observable Nondeterministic Planning"* (ANU, 2025) — plus an
experimental **self-improvement** layer that pushes the ideas further (a prototype;
[`RSI.md`](RSI.md) is candid about its scope and limits).

Runs on any laptop with just Python. It uses the fast `python-sat` solver if
present, otherwise a built-in pure-Python one — either way it just works.

```bash
# classical planning
python3 -m pdr logistics --locs 3 --pkgs 2
python3 -m pdr blocksworld --blocks 4 --variant M --F 3      # Ch 3 multi-step
python3 -m pdr logistics --locs 3 --pkgs 3 --engine ps --workers 4   # Ch 4 parallel
python3 -m pdr logistics --locs 3 --pkgs 3 --engine pd       # Ch 5 decomposition

# FOND planning (nondeterminism)
python3 -m pdr clumsy --blocks 3        # Ch 6 — finds a strong-cyclic policy
python3 -m pdr escher --blocks 3        # Ch 6 — proves NO policy exists

# verify everything is correct
python3 -m pdr.tests

# benchmarks
python3 -m pdr.benchmark --mode speedup     # Ch 3 PDR-M / PDR-IL speedup factors
python3 -m pdr.benchmark --mode compare     # coverage + time across solvers
python3 -m pdr.benchmark --mode fond        # FOND-PDR vs ground truth

# the "push it further" payoff
python3 -m pdr.selfimprove                  # L0/L1: self-configuring portfolio
python3 -m pdr.evolve --mode evolve --seam reason   # L2: evolve a search operator
python3 -m pdr.evolve --mode llm   --seam reason    # L2: LLM-in-the-loop (offline-capable)
python3 -m pdr.evolve --mode meta                   # L3: improve the improver
```

---

## Part 1 — Explain it
**Planning** = a toy world (a truck, packages, places) where you want the list of
moves that turns the start into the goal. **PDR** is a clever way to find it: it
thinks *backwards* from the goal using nested fences called "layers" (Layer 0 =
the goal, Layer 1 = one move away, …). It keeps a to-do list of little questions
("can this situation reach the goal in *i* moves?"), asks a fast yes/no machine
(a SAT solver), gets one step closer on "yes", and on "no" it learns *why it's
stuck* and bricks up that dead-end forever. Reach Layer 0 → a plan. Two fences
become identical → it *proved* there's no plan, without ever imagining the whole
giant world at once.

Your friend made this better in five ways — all built here:

* **Ch 3 — peek further ahead** (PDR-M / PDR-IL): each question looks *F* moves
  ahead in one shot, handing more work to the fast SAT machine.
* **Ch 4 — many helpers at once** (PS-PDR): an orchestrator hands a *batch* of
  questions to parallel workers.
* **Ch 5 — divide and conquer** (PD-PDR): split the goal into independent
  sub-goals, solve each small, glue the answers; if the glue fails (two parts
  fight over one tank of fuel) merge them and retry.
* **Ch 6 — plan when the world is unpredictable** (FOND-PDR): a *clumsy robot*
  may drop a block when it picks it up. You can't write a fixed list of moves;
  you need a **policy** — a rule for every situation that, no matter how the dice
  land, always eventually wins. FOND-PDR finds one, or proves none exists.

And then we **push it further**: since the thesis shows *no single setting is
best for every problem*, we wrap the whole family in a loop that learns which
setting to use for which problem, and gets better every round (see `RSI.md`).

---

## Part 2 — How the code maps to the thesis

| Thesis | File | What it is |
|---|---|---|
| §2.1 SAT / incremental SAT | `sat.py` | the yes/no machine (fast + pure-Python backends) |
| §2.2 classical problem `<X,A,I,G>` | `planning.py` | problems, actions, plan/policy validation |
| §2.4 ∀-step encoding (Schemas 1–5) | `encoding.py` | turns "can s step to a layer?" into SAT |
| §2.5 **Algorithm 2 (core PDR)** | `pdr.py` `variant="baseline"` | obligations, reasons, rescheduling, clause pushing |
| §3.1 **PDR-M** / §3.2 **PDR-IL** | `pdr.py` `variant="M"`/`"IL"` | multi-step look-ahead progression |
| §4 **PS-PDR** (Algorithm 3) | `parallel.py` | batch-parallel orchestrator + "wasted work" metric |
| §5 **PD-PDR** | `decomp.py` | PSDG→SCC→LADG, sub-problems, merge-on-failure |
| §6 **FOND-PDR** (Algorithm 4) | `fond.py` | layers + AND/OR graph + policy generator |
| §6.4 FOND encoding (Schemas 6–15) | `fond_encoding.py` | all-futures time-slices + progress-outcome vars |
| §6.3 policy generator (Algorithm 5) | `fond.py` `compute_policy` | sink-removal + backward strong-cyclic extraction |
| §3.3 / §5.4 / §6.6 evaluation | `benchmark.py` | speedup factors, coverage, FOND |
| Examples 1/4, 2/9, 7, 8 | `domains.py` | the thesis's own running examples, parameterised |
| **beyond the thesis** | `selfimprove.py`, `RSI.md` | self-improvement layer (prototype) |

### Faithfulness & correctness (why you can trust it)
- All five ∀-step schemas, the FOND Schemas 6–15, reason minimisation,
  obligation rescheduling, queue trimming, clause pushing, both classical
  termination rules (2 equal layers; **F+1** for PDR-IL), the FOND locked/queue +
  forward-push no-policy check, and the sink-removal policy generator are all
  implemented as described.
- **Every output is independently verified.** Classical plans are replayed
  against the real world (`validate_plan`); FOND policies are checked to be
  genuinely strong-cyclic (`validate_policy`); FOND answers are cross-checked
  against an explicit-search oracle (`reference_answer`).
- The FOND SAT encoding was cross-tested against a from-scratch enumeration
  oracle (the test asserts they agree on every progressability check).
- PS-PDR and PD-PDR are asserted to agree with baseline PDR on every instance.
- Reproduces specific thesis results: the exact `load→drive→unload` plan of
  Example 1; PD-PDR decomposing logistics in one iteration (Example 7) and
  merging on the fuel conflict (Example 8); FOND-PDR solving the clumsy
  blocksworld (Example 9) and proving Escher-blocksworld has no policy *via
  forward-push convergence* — "almost instantly", as the thesis reports.

### Honest differences from the thesis
- The thesis uses bespoke/industrial solvers (Lingeling) on a server over
  hundreds of IPC instances; here it's a general solver on a handful of small
  instances, so **absolute times are tiny and the trends, not the milliseconds,
  are the point.** Scale up freely (`logistics(6,4)`, `clumsy_blocksworld(4)`).
- PS-PDR's parallelism is real (thread pool; the C SAT solver releases the GIL)
  but on tiny instances overhead dominates — it's faithful in *structure* and
  in reproducing the thesis's own "wasted work" caveat (Sec 4.3.2).
- FOND-PDR proves no-policy via the thesis's forward-push convergence; as a
  guaranteed completeness-threshold backstop it can fall back to the explicit
  reachable-graph oracle (this only ever triggers past `max_k`).

---

## Part 3 — Pushing it further: a self-improvement layer (prototype)

The thesis's key empirical finding is that **no single configuration dominates** —
PDR-M, PDR-IL, F, rescheduling, parallelism, decomposition each win on some
domains. That is the perfect setting for a self-improving system, because we also
have a **verifiable fitness function** (the benchmark + validators) and **cheap
problem features**.

`selfimprove.py` implements a working loop that:
1. searches the config space to find the best solver per problem (auto-tuning),
2. learns a `features(problem) → config` meta-policy (a self-configuring portfolio),
3. runs a curriculum of ever-harder instances, warm-starting each from the
   nearest solved one, and pushes the capability frontier outward each round.

```
round 1: capability=4  policy_regret=2.80x
round 2: capability=5  policy_regret=1.64x
round 3: capability=6  policy_regret=1.12x
round 4: capability=7  policy_regret=1.11x   # broader AND sharper every round
```

And it doesn't stop at picking knobs — on one seam it **synthesises a new search
operator** (verifier-grounded program synthesis, FunSearch/AlphaEvolve in spirit):

* **L2 (`evolve.py`)** searches PDR's tie-breaking / reason-ordering / progression
  strategies, scored by the verifiable harness. The seams are soundness-preserving
  by construction, so a candidate can only be *slower*, never *wrong*. On the
  reason seam it re-derives a known-good ordering (**1.22× fewer SAT calls**,
  1.19× held-out) — *confirmation* of a thesis hint, not new discovery; the
  obligation seam shows ~1.0× (a reported null result). On the **progression**
  seam — operationalising Ava's §7.2 conjecture of online-adaptive macro length —
  it finds an adaptive look-ahead that beats fixed PDR-M (F=3). Runs
  LLM-in-the-loop (Anthropic API, or offline with curated proposals).
* **L3 (`--mode meta`)** meta-search over the search's own knobs: it learns which
  seam has leverage and concentrates budget there, auto-expands the curriculum, and
  adapts its mutation scale.

> Read these as **SAT-call** reductions on **small demo domains**, single-seed —
> not "faster planner" and not benchmark results. [`RSI.md`](RSI.md) is the honest
> write-up: prior-art positioning, the SAT-calls≠runtime caveat, a soundness lemma,
> and a Threats-to-validity section.

---

## File index
```
pdr/
  sat.py           yes/no SAT machine (pysat + pure-Python fallback)
  planning.py      classical + FOND problems, plan/policy validation
  encoding.py      classical ∀-step encoding (Schemas 1–5)
  pdr.py           Ch 2/3: core PDR + PDR-M + PDR-IL
  parallel.py      Ch 4: PS-PDR
  decomp.py        Ch 5: PD-PDR
  fond_encoding.py Ch 6: FOND SAT encoding (Schemas 6–15)
  fond.py          Ch 6: FOND-PDR + policy generator (Algorithm 5)
  domains.py       Logistics, Blocksworld, fuel, clumsy/Escher blocksworld
  benchmark.py     speedup / compare / fond benchmark modes
  selfimprove.py   L0/L1: self-configuring portfolio
  operators.py     L2: evolvable, soundness-preserving search operators
  evolve.py        L2/L3: evolutionary + LLM-in-the-loop search, meta-evolution
  tests.py         correctness tests for every chapter  (python3 -m pdr.tests)
  __main__.py      CLI                                   (python3 -m pdr ...)
  README.md  RSI.md
```
