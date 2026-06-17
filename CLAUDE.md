# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo. Read this first.

## What this is
A faithful, fully-tested, runnable reproduction of **all six technical chapters** of
Ava Clifton's PhD thesis on **Property Directed Reachability (PDR/IC3) planning**
(classical + FOND), plus:
- a live **in-browser visualizer** (`web/`, deployed) that runs the *real* solver via
  Pyodide/WASM or an optional backend, and
- an experimental, **honestly-scoped self-improvement layer** (`evolve.py`,
  `selfimprove.py`, …) that configures / selects / synthesizes search heuristics under
  the thesis's soundness validators.

The repo is **PUBLIC** (github.com/ConsentirDev/pdr-planning). Live app:
watch-it-think.vercel.app. Backend: pdr-visualized.fly.dev.

---

## ⚠️ Guardrails — do not violate

**Never commit secrets or Ava's thesis.** Before any `git add`/commit/push, confirm
these are untracked (they are gitignored; verify, don't assume):
- **`Final_Thesis_*.pdf` / any `*.pdf`** — Ava's unpublished dissertation. It lives on
  disk locally but must never enter git or be redistributed.
- **`.env`** (holds `ANTHROPIC_API_KEY`), `*.key`, `.env.*`.
- The backend **`API_TOKEN`** — it exists *only* as a Fly secret + a Vercel env var
  (`VITE_API_TOKEN`). It must never be hard-coded or committed. (It ends up in the
  public web bundle by design; that's a known, accepted "casual-abuse" gate, not a
  real secret — don't treat it as one, but don't commit it either.)
- **`.vercel/`** (project link) and **`ipc/`** (real IPC benchmark data; auto-downloaded
  by the experiments) are gitignored.

Quick pre-push check: `git ls-files | grep -iE '\.pdf$|\.env|\.key$|\.vercel'` → expect
nothing. The history is clean; keep it that way.

**Don't reintroduce the things the author corrected.** The narration/labels were
reviewed by the thesis author and fixed for fidelity. Hold the line:
- Call them **"layers"** (her term) — *not* "fences" (an invented word). "Frames" is the
  IC3 synonym, noted in the glossary.
- **Mutex invariants ≠ learned reasons.** Invariants are preprocessing (Schema 5),
  seeded into every layer; learned reasons are inductive (abstractions of failed
  progressions). The UI distinguishes ⊥ invariant vs ⚡ reason — keep them distinct.
- PDR looks **one layer ahead** ("can this obligation step into L_{i-1} in a single
  move?"), not "reach the goal in N steps".
- **SAT-call count ≠ runtime.** It's the reproducible *fitness/effort* proxy; report
  wall-clock for any *performance* claim. Don't frame SAT-calls as "speed".
- FOND policy generation is a clean **solved vs not-yet-solved** divide (no permanent
  per-state "dead-end").

**Don't oversell.** This codebase was deliberately de-hyped after an external review.
No "recursive self-improvement" framing; it's algorithm configuration / selection /
verifier-grounded synthesis. Report negative/null results, not just wins. See `RSI.md`.

---

## Commands

Python (zero-dep core; `[sat]` adds the fast Lingeling backend via `python-sat`):
```bash
pip install -e ".[sat,dev]"        # or plain `pip install -e .`
python3 -m pdr.tests               # full correctness suite — MUST stay green
ruff check pdr/ server/            # lint — MUST stay clean
python3 scripts/reproduce.py       # regenerate the thesis headline numbers
python3 -m pdr.experiments all     # self-improvement / scaling numbers (engine-pinned, CIs, negatives)
python3 -m pdr logistics --locs 3 --pkgs 2     # run the CLI solver
```

Web (`web/`):
```bash
npm --prefix web install
npm --prefix web run dev           # http://localhost:5173
npm --prefix web run build         # tsc -b && vite build  — MUST pass before commit
bash web/scripts/build-wheel.sh    # REBUILD the Pyodide wheel after ANY change under pdr/
```
> After changing anything in `pdr/`, rebuild the wheel (`web/public/wheels/…whl`) or the
> in-browser runtime serves stale Python.

Deploy (only when asked; both auto-deploy from the same source):
```bash
flyctl deploy --remote-only --ha=false              # backend (Lingeling); see DEPLOY.md
cd web && vercel deploy --prod --yes                # frontend
```

---

## Layout
- `pdr/` — the Python package (the truth). Key modules: `pdr.py` (core PDR + variants),
  `fond.py`/`fond_encoding.py` (FOND-PDR), `decomp.py` (PD-PDR), `parallel.py` (PS-PDR),
  `encoding.py` (∀-step Schemas), `planning.py` (Problem/validators), `pddl.py` (PDDL
  front-end), `domains.py` (parametric + IPC domains), `sat.py` (SAT abstraction),
  `trace.py` (replayable event tracer), `web.py` (`run_trace` entrypoint),
  `operators.py`/`evolve.py`/`selfimprove.py`/`selfauthor.py`/`transfer.py` (the
  self-improvement layer), `experiments.py` (reproducible experiments behind `RSI.md`),
  `tests.py`.
- `web/` — Vite + React + TS visualizer. `src/lib/` (shared: runtime, trace types,
  design system, glossary `Term`), `src/modules/` (explorer, fond, selflab, racedecomp,
  pddl), `src/app/` (shell, Learn/Lab, the login gauntlet). `public/wheels/` holds the
  committed `pdr` wheel.
- `server/app.py` — FastAPI wrapping `run_trace`; `/run`, `/run-stream` (SSE),
  `/health`, token-gated.
- `docs/SCALING.md`, `pdr/RSI.md`, `pdr/README.md`, `README.md`, `CONTRIBUTING.md`,
  `DEPLOY.md`, `FOR_AVA.md`, `CITATION.cff` — read before editing the corresponding area.

---

## Architecture — one trace contract
`pdr/web.py:run_trace(spec) -> {meta, events, result}` (pure JSON) backs **both**
runtimes:
- **Pyodide** (default, shareable): the real `pdr` wheel runs in a Web Worker (pure-Python
  SAT fallback).
- **Backend** (optional/deployed): FastAPI + Lingeling. The frontend auto-detects it via
  `GET /health` and routes there (`VITE_BACKEND_URL`).

`web/src/lib/trace/types.ts` **mirrors** `pdr/trace.py` — keep them in sync. A trace is
replayed by a player; modules derive view-state from `events[0..cursor]`. The solver runs
with an opt-in tracer (zero overhead when off), so the **visuals are the real algorithm**,
never a re-implementation.

---

## Conventions (the hard rules)
- **Validators are sacred.** `validate_plan`, `validate_policy`, `reference_answer`, and
  the FOND encoding cross-check are the backbone. Never weaken them; new features keep
  them green.
- **New heuristics go through a soundness-preserving seam, not a hack** (`operators.py`):
  tie-break only among minimal-layer obligations; reason-order (any order yields a valid
  reason); per-obligation look-ahead `F` under PDR-M semantics. A bad operator can only be
  *slower*, never *wrong*.
- **Determinism / fitness.** Randomised code takes an explicit `seed`. Fitness =
  **SAT-call count under the pinned engine** (`FITNESS_ENGINE = "minisat22"`); wall-clock
  is a *secondary, noisy* metric (`rank_by="wall"` exists but is non-deterministic). The
  evolution archive sorts by `(sat_calls, name)`, never wall-clock, so results are
  reproducible across runs and `workers` counts.
- **Numbers come from runs, negatives reported.** Empirical claims must be reproducible
  via `pdr.experiments` / `scripts/reproduce.py`. Don't bury null results.
- **TS mirrors Python.** Update `types.ts` when `trace.py`/`web.py` change.

---

## Verification ethos
Verify by **running the app**, not by re-running tests. For UI work: build, drive it
headless (Playwright/Chromium — see `web/scripts/*.mjs` and `web/_*.mjs` patterns),
screenshot the changed surface, confirm **0 page errors**. For solver/Python work: run
the actual entrypoint (`python3 -m pdr…`, the experiment, the CLI), capture real output.
Tests + ruff staying green is necessary, not sufficient.

---

## Deployment facts & gotchas
- **Backend (Fly):** app `pdr-visualized`, region `syd`, `performance-2x`, Lingeling,
  scale-to-zero. Auth: `API_TOKEN` secret ↔ `VITE_API_TOKEN`; CORS via `ALLOW_ORIGINS`.
  SSE `/run-stream` streams per-generation progress for the slow evolution runs.
- **Frontend (Vercel):** project `watch-it-think`, root dir `web/`, env
  `VITE_BACKEND_URL` + `VITE_API_TOKEN`. Only the clean `watch-it-think.vercel.app` alias
  is public; the `*-bmai-projects` URLs are 401 (deployment protection).
- **Docker gotcha:** `python-sat` only publishes **pre-release** wheels, **amd64-only**.
  The `Dockerfile` pins `--pre python-sat==1.9.dev5` and `FROM --platform=linux/amd64`.
  Build/deploy amd64 (Fly's remote builder is amd64).
- **FOND scale limit:** the all-futures FOND encoding blows up fast; in-browser uses
  pure-Python DPLL. FOND demo instances must be tiny (verify `<2s` with
  `prefer_pysat=False` before wiring any new FOND domain to the UI).
- **React:** keep all hooks above any conditional `return` (the login gate caught this).
- **Scale runs:** `python3 -m pdr.experiments ipc-evolve --workers N` runs the real-IPC
  sweep; pairs with `fly scale vm performance-8x` for a session (see `docs/SCALING.md`).

---

## Tone for this project
It's a gift to a friend (the thesis author) and a public, honestly-framed research
artifact. Be faithful to her work, credit it, label limits plainly, and don't write
cheques the experiments don't cash.
