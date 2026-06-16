# PDR, visualized

An extremely visual, dual-mode (Learn ⇄ Lab) web app that lets you **watch the
real PDR planner think** — built on top of the `pdr/` Python package. It runs the
**genuine, verified solver in your browser** via Pyodide/WASM (no server, no
reimplementation), so it's instantly shareable.

> A companion to Ava Clifton's thesis. Aesthetic: "blueprint / watch-it-think".

**Live:** the frontend is deployed at **watch-it-think.vercel.app** (Vercel), backed
by a real solver service at **pdr-visualized.fly.dev** (Fly.io, Lingeling). On first
visit you'll meet a deliberately silly login gauntlet (the "Reachability Checkpoint")
— it's theatre, not security; the real gate is the backend token. See `../DEPLOY.md`.

## Run it locally

```bash
cd web
npm install
npm run dev            # http://localhost:5173
```

First "▶ run" boots Pyodide (~10–30s, ~8MB) and installs the `pdr` wheel; after
that everything is instant. Everything you see is real output from the actual
planner.

## Modules
- **PDR Explorer** — watch the reachability "fences" learn backward from the goal;
  animated logistics/blocksworld worlds, the plan assembling. Click any fence, ⚡
  reason, or the processing state to open the **Inspector** — the real CNF clauses,
  the ∀-step SAT encoding, and thesis citations. Hover any term for a glossary popover.
- **FOND Policies** — the AND/OR graph growing, the sink-removal policy generator,
  strong-cyclic policies (and proofs that none exist). Eight domains incl. several
  from Ava's FOND benchmark set — Triangle-Tireworld, Faults, Islands, First-Responders,
  Earth-Observation (a satellite) — each with a bespoke per-state visualization.
- **Self-Improvement Lab** — an *experimental layer on top of* the thesis (not part of
  it). Watch evolution stream generation-by-generation; click any candidate to see its
  lineage, the exact weight diff, and the held-out scores. A **Bench** tab (Lab mode)
  lets you queue operators/runs and compare two **per-instance**, with a SAT-calls ⇄
  wall-clock toggle. The honest framing and results live in `../pdr/RSI.md`.
- **Race & Decompose** — variants head-to-head; problems split into chunks and
  glued back (with merge-on-failure).
- **PDDL Loader** — paste/upload real PDDL (incl. a real IPC-2000 logistics instance);
  it's parsed, grounded, and solved by the same engine.

## Optional fast backend
Pyodide uses the pure-Python SAT solver (great for sharing, slower on big problems).
For speed — and for anything beyond toy sizes — run the FastAPI backend and the app
auto-detects it (badge shows **server**):

```bash
pip install -e ".[sat]" fastapi uvicorn   # from the repo root
uvicorn server.app:app --port 8000
```

The same backend is deployed on Fly.io (Lingeling) and powers the live site. It adds:
`/run-stream` (Server-Sent Events — per-generation progress for the slow evolution
runs), optional token auth (`API_TOKEN` ⇄ frontend `VITE_API_TOKEN`), and
`ALLOW_ORIGINS` CORS locking. Point the frontend at a deployed backend with
`VITE_BACKEND_URL`. Full instructions: `../DEPLOY.md`; the container is `../Dockerfile`
+ `../fly.toml`.

## Build & deploy (static, zero-config)
```bash
npm run build          # -> dist/ (a fully static site; Pyodide loads from CDN)
npm run preview
```
`base: "./"` makes `dist/` deployable on any static host. Vercel/Netlify: build
command `npm run build`, output dir `dist` (see `vercel.json`). GitHub Pages:
publish `dist/`.

## Regenerating the Pyodide wheel
The `pdr` wheel in `public/wheels/` is committed so a fresh clone works without a
Python build. After changing anything under `../pdr/`, rebuild it:
```bash
bash scripts/build-wheel.sh
```

## Architecture (one trace contract)
```
pdr/web.py:run_trace(spec)  →  { meta, events, result }   (pure JSON)
        ↑ runs the real solvers with an opt-in tracer (pdr/trace.py)
        │
   ┌────┴─────────────┐
   │                  │
Pyodide worker    FastAPI backend        ← interchangeable runtimes, same JSON
   │                  │
   └────→  React trace-player  →  per-module blueprint visualizations
```
TypeScript types in `src/lib/trace/types.ts` mirror `pdr/trace.py` exactly.

## Verifying (headless)
`scripts/drive*.mjs` drive the app in headless Chromium (Playwright) to confirm
the real planner runs in-browser and every module renders — that's how this app
was checked end-to-end.
