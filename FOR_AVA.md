# For Ava — your thesis, brought to life as runnable code

Hi Ava,

Congratulations on the PhD. I read your dissertation, *"Advancing Property
Directed Reachability for Classical and Fully Observable Nondeterministic
Planning,"* properly — and I loved it enough that I wanted to do more than just
read it. So I built it. This repository is a faithful, tested, runnable
re-implementation of **all six technical chapters**, plus a small research
extension I think you'll find fun. It's a gift; do whatever you like with it.

A note up front, because you're the expert and I want to be straight with you: I
built this together with an AI coding assistant (Claude). I drove the design,
the choices, and the verification; the assistant did a lot of the typing. I'm
telling you that partly because it's honest, and partly because the *way* it was
built is itself relevant to the extension at the end.

---

## What I reproduced (and how I made sure it's faithful)

Everything is independent code — I did **not** copy anything from your
implementation, and your dissertation PDF is deliberately **not** in the repo
(it's yours, and it's under review). I worked from the algorithms and schemas as
written. Each chapter maps to a module:

| Your chapter | What I built | Where |
|---|---|---|
| Ch 2/3 — PDR (Alg. 2), PDR-M, PDR-IL | core solver + ∀-step encoding (Schemas 1–5) | `pdr/pdr.py`, `pdr/encoding.py` |
| Ch 4 — PS-PDR (Alg. 3) | batch-parallel orchestrator (+ the "wasted work" caveat from §4.3.2, as a metric) | `pdr/parallel.py` |
| Ch 5 — PD-PDR | PSDG → SCC → LADG, sub-problem construction (F, Ex, Dep, M̄, A↓Y, s↓Y), merge-on-failure | `pdr/decomp.py` |
| Ch 6 — FOND-PDR (Alg. 4 + 5) | the all-futures SAT encoding (Schemas 6–15), the locked/unlocked queue, the sink-removal policy generator | `pdr/fond.py`, `pdr/fond_encoding.py` |

The part I cared about most was **not lying to myself about faithfulness**, so
the whole thing is built around independent verification:

- every classical plan is replayed against the concrete model (`validate_plan`);
- every FOND policy is checked to be genuinely strong-cyclic (`validate_policy`);
- the FOND SAT encoding (Schemas 6–15) is **cross-checked against a from-scratch
  enumeration oracle** — they agreed on every progressability probe I threw at
  them, which is what finally convinced me the PO / all-futures time-slice
  encoding was right;
- FOND answers are cross-checked against an explicit AND/OR search
  (`reference_answer`).

It reproduces your worked examples specifically: the `load → drive → unload`
plan of Example 1; PD-PDR decomposing Logistics in **one iteration** (Example 7)
and then **merging on the fuel conflict**, correctly fingering a fuel unit as the
problematic proposition (Example 8); FOND-PDR solving the clumsy Blocksworld
(Example 9); and — my favourite — proving Escher-Blocksworld has **no policy via
forward-push convergence**, "almost instantly," exactly as you report.

A couple of honest differences from your setup, so you're not surprised:
- It now uses **Lingeling** (via `python-sat`, with a pure-Python fallback for the
  zero-dep / in-browser path) — chosen by a small backend benchmark, not reputation.
  But the instances are still small, so absolute times are tiny; the *trends* are the
  point, not the milliseconds.
- It **does** have a PDDL front-end now (`pdr/pddl.py`, `:strips`/`:typing`/`oneof`):
  it parses and grounds real IPC files — your IPC-2000 `logistics-10-0` grounds to
  1040 actions in ~8 ms and solves — and I ran the evolved operator on real gripper /
  miconic instances. It doesn't do full ADL yet, and the *hard* IPC instances still
  time out (that's the real remaining gap, written up in `docs/SCALING.md`).
- Layers are stored as full clause sets, not your delta encoding — clarity over
  memory.

If anything here misrepresents an algorithm, I'd genuinely like to know — the
code is the question, and you're the authority.

There's a kid-level tour in `pdr/README.md` (I wrote it to check my own
understanding), and `python scripts/reproduce.py` regenerates every headline
number in about 20 seconds.

---

## The extension: using your framework as a substrate for self-improvement

Here's the part I got excited about. Your Table 3.2 / Figures 3.5–3.6 make a
point that stuck with me: **no single configuration dominates** — PDR vs PDR-M
vs PDR-IL, the look-ahead `F`, rescheduling, decomposition — the best choice
swings by domain. That's usually framed as a caveat. I think it's an
*opportunity*, because two things are true at once: there's exploitable
structure in "which knob for which problem," and your solvers are **sound and
complete with independently-checkable outputs.**

That second property is the rare and important one. It means you can let a
machine *search the space of search strategies* and never have to trust it,
because a wrong "improvement" simply fails validation. So I built a
self-improvement layer on top of your planners — honestly, a known stack
(algorithm configuration, per-instance algorithm selection, and verifier-grounded
program synthesis — SATzilla / ParamILS / FunSearch territory) plumbed into PDR
with your validators as the referee (`pdr/operators.py`, `pdr/evolve.py`,
`pdr/selfimprove.py`, `pdr/selfauthor.py`). The write-up `pdr/RSI.md` positions it
against that prior art and is deliberately candid — a serious external reviewer
pushed me to stop overselling it, and the version below is the honest one:

- **L0/L1** — a self-configuring portfolio that learns `features(problem) →
  best config`.
- **L2** — *evolving new search operators as code*. I exposed three
  **soundness-preserving seams** in your algorithm: the obligation tie-break
  (only among minimal-layer obligations, so termination is untouched), the
  reason-minimisation order (every order still yields a valid reason), and — the
  high-leverage one — the **per-obligation look-ahead depth** under PDR-M
  semantics. Your **§7.2 future work conjectures exactly this** ("the macro length
  could be adapted online to suit the problem"); I just operationalised it under a
  held-out criterion, so the credit for the idea is yours. A candidate operator can
  only ever be *slower*, never *wrong* (there's a short soundness lemma for the
  per-state `F` in `RSI.md`). The search runs two ways: an autonomous evolutionary
  loop, and an **LLM-in-the-loop** that writes the operator's code.
- **L3** — meta-search over the search's own knobs: it learns which seam pays off
  and concentrates there, and does greedy feature engineering + difficulty-band
  curriculum generation (standard techniques — I'd been calling this
  "self-authoring," which oversold it).

The result I most want to show you, stated carefully: under proper **train /
validation / test** protocol the evolved adaptive look-ahead operator uses **~1.4×
fewer SAT calls than fixed PDR-M (F=3), ~4–7× fewer than F=1, on instances it never
saw** — a simple adaptive `F`-schedule (deeper while far from the goal) that your
PDR-M framework makes expressible and a fixed `F` can't. Two honest caveats you'd
ask about immediately: (1) that's **SAT calls, not runtime** — when I ran it on
*real IPC* instances it had never seen (gripper, miconic) it still cut calls ~4.5×
but was **no faster in wall-clock** there (fewer-but-harder queries); and (2)
multi-seed runs show the win is mostly the **curated seed operator**, not live
mutation discovering something new. Both are in `RSI.md` with the numbers. I'd
rather you have the real picture than a flattering one.

And a result I like even more *because* it's a failure-then-fix: the first live
LLM run **overfit** — brilliant on the training instances, worse than PDR-M on
held-out. The harness *caught* it, I added a validation split, and the loop then
produced a smooth, generalising operator. To me that's the whole thesis-of-the-
extension: your soundness/completeness guarantees are exactly the guardrail that
makes an otherwise-untrustworthy automated search safe and honest.

None of this competes with your work — it stands entirely on top of it. PDR-M and
PDR-IL are themselves ~5-line variations of the progression step; I just let a
search explore that same space, with your validators refereeing.

---

## Running it

```bash
pip install -e ".[sat]"          # or plain `pip install -e .` (zero-dep)
python -m pdr.tests              # 29 tests, every output validated
python -m pdr.experiments all    # the self-improvement numbers (engine-pinned, CIs, negatives)
python scripts/reproduce.py      # all headline numbers, ~20s

python -m pdr clumsy --blocks 3  # FOND-PDR finds a strong-cyclic policy
python -m pdr escher --blocks 3  # ...proves none exists (forward-push)
python -m pdr.evolve --mode llm --seam progression --split   # the L2 loop
```

### And a thing to actually *see* it

There's a visual companion — and it's live, so you can just open it:
**watch-it-think.vercel.app** (you'll have to get past a deliberately ridiculous
login first; the password is that you're now *Dr Clifton* — I couldn't resist).
It runs the **real solver** — in your browser via Pyodide/WASM, or on a Lingeling
backend on Fly.io — and lets you *watch it think*: the reachability fences filling
backward from the goal and learning from dead ends (click any fence or ⚡ reason to
see the actual CNF clauses and the ∀-step encoding); the FOND AND/OR graph growing
(Escher proving itself impossible; plus several of your FOND-set domains —
Triangle-Tireworld, Faults, Islands, First-Responders, even a satellite for
Earth-Observation — each with its own little world); the self-improvement lab
streaming generation-by-generation with the train→validation→test story and a bench
to compare operators per-instance; variant races; and a PDDL loader (it'll happily
chew on a real IPC instance). "Learn" mode is narrated; "Lab" mode has all the knobs,
for you. Run it yourself with `cd web && npm install && npm run dev`.

Building it actually flushed out a real soundness bug in my FOND-PDR no-policy check
on 2-block instances — the visualization disagreed with the explicit oracle, which is
how I caught it — now fixed and regression-tested. The visuals are wired to the same
validated engine, so they can't lie.

The repo is MIT-licensed and cites your thesis and the KR'23 paper in
`CITATION.cff`. There's CI, a scaling/architecture note (`docs/SCALING.md`), and
the design doc for the self-improvement layer (`pdr/RSI.md`).

I did finally point it at real IPC with a proper backend, and the honest punchline
is in `RSI.md`: the evolved operator *does* generalise to domains it never saw (on
SAT calls), but that doesn't buy wall-clock there — which is exactly the kind of
thing your evaluation methodology is careful about and mine had to be dragged toward.
If you spot a place where I got an algorithm subtly wrong, I'd genuinely love to hear
it. Mostly, though, I just wanted you to be able to *run* the thing you spent five
years proving correct — and to see that the soundness you fought for turns out to be
the foundation for something neither of us would have trusted without it.

With admiration,
Jordan
