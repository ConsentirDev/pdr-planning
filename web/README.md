# PDR, visualized

An extremely visual, dual-mode (Learn ⇄ Lab) web app that lets you **watch the
real PDR planner think** — built on top of the `pdr/` Python package. It runs the
**genuine, verified solver in your browser** via Pyodide/WASM (no server, no
reimplementation), so it's instantly shareable.

> A companion to Ava Clifton's thesis. Aesthetic: "blueprint / watch-it-think".

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
  animated logistics/blocksworld worlds, the obligation queue, the plan assembling.
- **FOND Policies** — the AND/OR graph growing, the sink-removal policy generator,
  strong-cyclic policies (and proofs that none exist).
- **Self-Improvement Lab** — evolve new search operators; the leaderboard, the
  discovered operator's code, and the train→validation→test (overfitting) story.
- **Race & Decompose** — variants head-to-head; problems split into chunks and
  glued back (with merge-on-failure).
- **PDDL Loader** — paste/upload real PDDL; it's parsed, grounded, and solved by
  the same engine.

## Optional fast backend
Pyodide uses the pure-Python SAT solver (great for sharing, slower on big
problems). For speed, run the FastAPI backend and the app auto-detects it:

```bash
pip install -e ".[sat]" fastapi uvicorn   # from the repo root
uvicorn server.app:app --port 8000
```
The runtime badge (top-right) will show **backend connected**.

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
