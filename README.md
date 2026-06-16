# pdr-planning

A faithful, fully-tested, runnable reproduction of **all six technical chapters**
of Ava Clifton's PhD thesis *"Advancing Property Directed Reachability for
Classical and Fully Observable Nondeterministic Planning"* (ANU, 2025) — together
with an experimental **self-improvement layer** built on top of it: a known stack
(algorithm configuration → per-instance selection → verifier-grounded operator
synthesis) plumbed into PDR, so it not only *configures* the planner but, on one
seam, *synthesises* a new search operator — scored by a verifiable harness, so a
candidate can only ever be slower, never wrong. It is a **prototype on small demo
domains**; the design doc [`pdr/RSI.md`](pdr/RSI.md) is candid about exactly what
that does and doesn't show (fitness is SAT-calls not runtime, single-seed, etc.).

[![ci](https://img.shields.io/badge/tests-28%20passing-brightgreen)](pdr/tests.py)
[![python](https://img.shields.io/badge/python-3.9%2B-blue)](pyproject.toml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
Zero required dependencies (pure-Python SAT fallback) · `python-sat` used automatically if present.

```bash
pip install -e ".[sat]"          # or just `pip install -e .` for the zero-dep path
python -m pdr.tests              # 28 correctness tests, every output validated
python scripts/reproduce.py      # regenerate every headline result (a few minutes)
```

### 🖥️  Or *watch it think* — the visual app (`web/`)
A blueprint-aesthetic, dual-mode (Learn ⇄ Lab) web app that runs the **real
solver in your browser** (Pyodide/WASM) and visualizes it: the reachability
"fences" learning backward from the goal, FOND AND/OR policy graphs, the
operator-evolution lab, variant races, and a **PDDL loader** for your own
problems. No server needed.

```bash
cd web && npm install && npm run dev      # http://localhost:5173
```
See [`web/README.md`](web/README.md). (Building it surfaced — and we fixed — a
real FOND-PDR soundness bug on 2-block instances; the app is wired to the same
verified engine, so the visuals can't lie.)

---

## What's here

| Layer | Module(s) | Summary |
|---|---|---|
| **Ch 2/3** | `pdr.py`, `encoding.py` | Core PDR (Alg. 2) + PDR-M + PDR-IL (∀-step Schemas 1–5) |
| **Ch 4** | `parallel.py` | PS-PDR — parallel obligation processing (Alg. 3) |
| **Ch 5** | `decomp.py` | PD-PDR — dependency decomposition + merge-on-failure |
| **Ch 6** | `fond.py`, `fond_encoding.py` | FOND-PDR (Alg. 4) + Schemas 6–15 + sink-removal policy generator (Alg. 5) |
| **L0/L1** | `selfimprove.py` | Self-configuring portfolio over the whole solver family |
| **L2** | `operators.py`, `evolve.py` | Evolvable, **soundness-preserving** search operators; autonomous evolution **and** LLM-in-the-loop |
| **L3** | `evolve.py`, `selfauthor.py`, `transfer.py` | Meta-evolution (learns *where* the leverage is), self-authored features/curriculum, verified reason transfer |

New here? Start with **[`pdr/README.md`](pdr/README.md)** (a from-scratch,
"explain it like I'm 10" tour with the thesis mapping). The self-improvement
design is in **[`pdr/RSI.md`](pdr/RSI.md)**; scaling/architecture in
**[`docs/SCALING.md`](docs/SCALING.md)**.

## Headline results (all reproduced by `scripts/reproduce.py`)

- **Faithful & validated.** Reproduces the thesis's own examples — the
  `load→drive→unload` plan (Ex. 1), PD-PDR decomposing logistics in one iteration
  (Ex. 7) and merging on the fuel conflict (Ex. 8), FOND-PDR solving the clumsy
  blocksworld (Ex. 9) and proving Escher-blocksworld has **no policy via
  forward-push convergence**. The FOND SAT encoding is cross-checked against an
  enumeration oracle (agreement on every probe).
- **L2 surpasses a hand-designed thesis variant.** Autonomous + LLM-in-the-loop
  evolution discovers an **adaptive look-ahead** operator that, on **held-out**
  instances, beats the F=1 baseline by **≈4.3×** and fixed **PDR-M (F=3) by
  ≈1.28×** in SAT calls — fully validated.
- **L3 learns where to look.** Meta-evolution ranks the operator seams by
  measured payoff (**progression ≫ reason > obligation**) and concentrates its
  budget on the high-leverage one, while auto-expanding its curriculum and
  adapting its own mutation scale.
- **Safe by construction.** The evolvable seams only reorder *already-valid*
  decisions, and transferred reasons are re-verified by SAT before use — so the
  fitness gate cannot be cheated. This is what makes the loop safe to run
  unattended.

## Quickstart

```bash
# classical
python -m pdr logistics --locs 3 --pkgs 2
python -m pdr blocksworld --blocks 4 --variant M --F 3
python -m pdr logistics --locs 3 --pkgs 3 --engine pd      # decomposition

# nondeterministic (FOND)
python -m pdr clumsy --blocks 3        # finds a strong-cyclic policy
python -m pdr escher --blocks 3        # proves no policy exists

# benchmarks
python -m pdr.benchmark --mode speedup     # Ch 3 speedup factors
python -m pdr.benchmark --mode compare     # coverage + time across solvers
python -m pdr.benchmark --mode fond        # FOND-PDR vs ground truth

# self-improvement layer (prototype — see pdr/RSI.md for honest scope)
python -m pdr.selfimprove                   # L0/L1 config + per-instance selection
python -m pdr.evolve --mode evolve --seam progression   # L2 evolve an operator
python -m pdr.evolve --mode llm   --seam reason         # L2 LLM-in-the-loop (offline-capable)
python -m pdr.evolve --mode meta                        # L3 improve the improver
python -m pdr.selfauthor                                # L3 self-authored features + frontier
python -m pdr.transfer                                  # verified reason transfer
```

For the **live** LLM-in-the-loop, `export ANTHROPIC_API_KEY=...` and
`pip install -e ".[llm]"`; otherwise it runs offline with curated proposals.

## Correctness guarantees

Soundness is not incidental — it is enforced mechanically and end-to-end:

- every classical plan is replayed against the concrete model (`validate_plan`);
- every FOND policy is checked to be genuinely strong-cyclic (`validate_policy`);
- the FOND encoding is cross-validated against an independent enumeration oracle;
- `reference_answer` provides explicit-search ground truth for FOND decisions;
- the self-improvement seams are *soundness-preserving by construction* and every
  transferred reason is re-verified by SAT — a faster-but-wrong operator fails
  validation and is discarded.

See `docs/SCALING.md` for the architecture, the path to industrial-scale SAT
backends, parallelism, and honest limitations.

## Provenance & citation

This is an **independent re-implementation** of algorithms from Ava Clifton's
thesis (and the associated KR'23 / ICAPS-KEPS papers). The thesis is the author's
intellectual property and is **not** redistributed here. Please cite it — see
[`CITATION.cff`](CITATION.cff). Licensed MIT (see [`LICENSE`](LICENSE)).
