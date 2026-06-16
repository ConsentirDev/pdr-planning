// Runtime client: one `run(spec)` that returns a Trace. Prefers an optional
// local FastAPI backend (fast python-sat); otherwise uses the Pyodide worker
// (the real planner in WASM). Same JSON either way — the UI never knows which.

import PdrWorker from "./worker.ts?worker";
import type { Spec, Trace } from "../trace/types";

const BACKEND = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:8000";
// Optional shared token for a gated backend (set VITE_API_TOKEN on the host).
const API_TOKEN = (import.meta as any).env?.VITE_API_TOKEN || "";

type Status = "idle" | "booting" | "ready" | "error";
type Listener = (s: Status, message?: string) => void;

class Runtime {
  private worker: Worker | null = null;
  private backendOk = false;
  private pending = new Map<number, { resolve: (t: Trace) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private bootP: Promise<void> | null = null;
  status: Status = "idle";
  backend: "pyodide" | "server" = "pyodide";
  private listeners = new Set<Listener>();

  onStatus(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(s: Status, m?: string) { this.status = s; this.listeners.forEach((l) => l(s, m)); }

  async boot() {
    if (this.bootP) return this.bootP;
    this.bootP = this._boot();
    return this.bootP;
  }

  private async _boot() {
    this.emit("booting", "looking for a backend…");
    try {
      // Local dev fails fast to Pyodide when nothing's listening; a configured
      // remote backend (e.g. a Fly machine) may be suspended, so give it time to
      // wake and answer rather than falling back to the slower in-browser solver.
      const isLocal = /localhost|127\.0\.0\.1/.test(BACKEND);
      const r = await fetchTimeout(`${BACKEND}/health`, isLocal ? 700 : 4000);
      if (r.ok) { this.backendOk = true; this.backend = "server"; this.emit("ready", "backend connected"); return; }
    } catch { /* no backend — fall back to Pyodide */ }

    this.backend = "pyodide";
    this.worker = new PdrWorker();
    const wheelUrl = new URL(
      `${(import.meta as any).env?.BASE_URL || "/"}wheels/pdr_planning-0.1.0-py3-none-any.whl`,
      location.href
    ).href;
    await new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (e) => {
        const m = e.data;
        if (m.type === "status") this.emit("booting", m.message);
        else if (m.type === "ready") { this.emit("ready", "python ready (in your browser)"); resolve(); }
        else if (m.type === "result") this.pending.get(m.id)?.resolve(m.trace);
        else if (m.type === "error") {
          const p = this.pending.get(m.id);
          if (p) p.reject(new Error(m.message));
          else { this.emit("error", m.message); reject(new Error(m.message)); }
        }
      };
      this.worker!.postMessage({ type: "init", wheelUrl });
    });
  }

  async run(spec: Spec): Promise<Trace> {
    await this.boot();
    if (this.backendOk) {
      const r = await fetch(`${BACKEND}/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(API_TOKEN ? { "x-api-key": API_TOKEN } : {}),
        },
        body: JSON.stringify(spec),
      });
      if (r.status === 401) throw new Error("backend rejected the API token (401)");
      if (!r.ok) throw new Error(`backend error ${r.status}`);
      return (await r.json()) as Trace;
    }
    const id = ++this.seq;
    return new Promise<Trace>((resolve, reject) => {
      this.pending.set(id, { resolve: (t) => { this.pending.delete(id); resolve(t); },
                             reject: (e) => { this.pending.delete(id); reject(e); } });
      this.worker!.postMessage({ type: "run", id, spec });
    });
  }

  // Like run(), but streams live progress events (e.g. per-generation for the
  // evolution module) via Server-Sent Events while the backend computes — so the
  // slow runs show themselves advancing. Falls back to a single run() on Pyodide
  // (no backend) where there's no stream; onProgress simply isn't called.
  async runStream(spec: Spec, onProgress: (ev: any) => void): Promise<Trace> {
    await this.boot();
    if (!this.backendOk) return this.run(spec); // pyodide: no live stream available
    const r = await fetch(`${BACKEND}/run-stream`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(API_TOKEN ? { "x-api-key": API_TOKEN } : {}) },
      body: JSON.stringify(spec),
    });
    if (r.status === 401) throw new Error("backend rejected the API token (401)");
    if (!r.ok || !r.body) throw new Error(`backend error ${r.status}`);

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let final: Trace | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, sep); buf = buf.slice(sep + 2);
        let event = "message", data = "";
        for (const ln of frame.split("\n")) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) data += ln.slice(5).trim();
        }
        if (!data) continue;
        const payload = JSON.parse(data);
        if (event === "event") onProgress(payload);
        else if (event === "result") final = payload as Trace;
        else if (event === "error") throw new Error(payload?.message || "stream error");
      }
    }
    if (!final) throw new Error("the stream ended without a result");
    return final;
  }
}

function fetchTimeout(url: string, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

export const runtime = new Runtime();
