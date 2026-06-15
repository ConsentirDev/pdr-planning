"""
Optional fast backend for "PDR, visualized".

The web app runs the real planner in the browser via Pyodide (pure-Python SAT),
which is perfect for sharing but slower on big instances. Run this tiny FastAPI
server and the frontend auto-detects it (GET /health) and routes runs here
instead, using the fast `python-sat` backend — same JSON contract, bigger
problems, snappier.

    pip install -e ".[sat]" fastapi uvicorn
    uvicorn server.app:app --port 8000
    # then just use the web app — it will say "backend connected"

Auth (optional, for a public deploy):
    Set API_TOKEN=<secret> and the solver endpoints require it via an
    `X-API-Key: <secret>` (or `Authorization: Bearer <secret>`) header. The
    frontend sends it from VITE_API_TOKEN. /health stays open so the app can still
    detect the backend. Unset → no auth (local dev). Restrict browsers to your
    site with ALLOW_ORIGINS=https://your-app.vercel.app (comma-separated).

    NOTE: a token baked into a public SPA is not truly secret (it ships in the
    bundle) — it stops casual/bot abuse of the compute endpoint, not a determined
    extractor. It's the right weight for a demo, not for guarding sensitive data.
"""

from __future__ import annotations

import os

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pdr.web import run_trace, catalog
from pdr.sat import pysat_solver_name, have_pysat

API_TOKEN = os.environ.get("API_TOKEN", "").strip()
_origins = os.environ.get("ALLOW_ORIGINS", "*").strip()
ALLOW_ORIGINS = ["*"] if _origins in ("", "*") else [o.strip() for o in _origins.split(",") if o.strip()]

app = FastAPI(title="PDR visualized — backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_token(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    """Gate an endpoint when API_TOKEN is set; a no-op otherwise (local dev)."""
    if not API_TOKEN:
        return
    supplied = x_api_key
    if not supplied and authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if supplied != API_TOKEN:
        raise HTTPException(status_code=401, detail="invalid or missing API token")


class Spec(BaseModel):
    module: str
    domain: str | None = None
    params: dict | None = None
    config: dict | None = None
    seam: str | None = None
    variants: list | None = None


@app.get("/health")
def health():
    # open so the frontend can detect the backend; also reports whether auth is on
    return {"ok": True,
            "engine": pysat_solver_name() if have_pysat() else "pure-python",
            "auth": bool(API_TOKEN)}


@app.get("/catalog")
def get_catalog(_: None = Depends(require_token)):
    return catalog()


@app.post("/run")
def run(spec: Spec, _: None = Depends(require_token)):
    return run_trace(spec.model_dump(exclude_none=True))
