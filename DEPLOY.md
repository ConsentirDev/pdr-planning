# Deploying "PDR, visualized"

Two pieces:

1. **Frontend** (`web/`) — a static Vite app that runs the *real* planner in the
   browser via Pyodide. Deploys to Vercel with zero backend.
2. **Backend** (`server/`, this `Dockerfile`) — optional FastAPI service that runs
   the same solver with the fast `python-sat` (lingeling) backend on a real
   machine. This is the "more grunt than the browser" path: always-on, multi-core,
   no per-request timeout. The frontend auto-detects it and routes runs there.

The frontend works on its own. Add the backend when you want bigger instances.

---

## 1. Frontend → Vercel

The frontend is a normal Vite app rooted at `web/`.

- **New Vercel project** → import this repo → set **Root Directory = `web/`**.
  `web/vercel.json` handles the build (`npm run build` → `dist/`).
- To point it at your backend, set an environment variable in the Vercel project:

  ```
  VITE_BACKEND_URL = https://your-backend-host   # no trailing slash
  ```

  With it set, the app pings `‹url›/health` on load and, if healthy, sends every
  run to the backend (badge shows **server**). Without it, everything runs in the
  browser (badge shows **pyodide**). The default when unset is `http://localhost:8000`
  for local dev.

---

## 2. Backend → a container host (recommended for grunt)

The backend is a single `Dockerfile`. Any container host builds it directly. It
listens on `$PORT` (default 8000) and exposes `/health`, `/catalog`, `/run`.

Local sanity check:

```bash
docker build -t pdr-backend .
docker run -p 8000:8000 pdr-backend
curl localhost:8000/health        # {"ok":true,"engine":"lingeling"}
```

### Fly.io  (`fly.toml` included)

```bash
fly launch --no-deploy            # creates the app, keeps the bundled fly.toml
fly deploy                        # builds the Dockerfile and ships it
fly scale vm performance-4x       # more cores → bigger instances + parallel variants
```

`fly.toml` scales to zero when idle (cheap) and wakes on the first request.

### Railway / Render

Point a new service at this repo; both auto-detect the `Dockerfile`. They inject
`$PORT` (the container already honours it). Then bump the instance size:
Railway → service resources; Render → instance type. Set the frontend's
`VITE_BACKEND_URL` to the service URL.

### Why a container, not Vercel serverless

Vercel Python functions cap at ~300s/request (60s on Hobby) and can't spawn the
multi-process **PS-PDR** (parallel) variant. A persistent container has no request
timeout, keeps the solver warm (no cold start), and scales with vCPUs — which is
exactly what the parallel and decompositional (**PD-PDR**) variants need to push
past what one core can do.

---

## Grunt vs. the algorithmic wall — be realistic

More cores/RAM buys a tier or two and much bigger FOND AND/OR graphs, but it is not
unlimited. On a laptop core, real IPC `logistics-10-0` solves in ~13–40s while
`logistics-15` times out at 200s. To go bigger you want a multi-core box **and** the
parallel/decomposition variants, not just a faster single solve. Size the VM to the
instances you actually want to demo.

## Hardening for a public deploy

- `server/app.py` sets `allow_origins=["*"]` for dev. For a public backend, restrict
  it to your Vercel domain(s).
- The backend has no auth; if it's public, put it behind the host's access controls
  or add a simple token check, since `/run` executes solver work on each call.
