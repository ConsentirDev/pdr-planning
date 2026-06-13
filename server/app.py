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
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pdr.web import run_trace, catalog

app = FastAPI(title="PDR visualized — backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # dev convenience; tighten for a real deploy
    allow_methods=["*"],
    allow_headers=["*"],
)


class Spec(BaseModel):
    module: str
    domain: str | None = None
    params: dict | None = None
    config: dict | None = None
    seam: str | None = None
    variants: list | None = None


@app.get("/health")
def health():
    return {"ok": True, "backend": "python-sat"}


@app.get("/catalog")
def get_catalog():
    return catalog()


@app.post("/run")
def run(spec: Spec):
    return run_trace(spec.model_dump(exclude_none=True))
