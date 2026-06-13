import { createContext, useContext, useEffect, useState, Suspense } from "react";
import { MODULES } from "./modules";
import { runtime } from "../lib/runtime/runtime";
import "./app.css";

// ---- shared mode (Learn ⇄ Lab) ----
export type Mode = "learn" | "lab";
const ModeCtx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: "learn", setMode: () => {} });
export const useMode = () => useContext(ModeCtx);

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { module: h.get("m") || "explorer", mode: (h.get("mode") as Mode) || "learn" };
}

export function App() {
  const [{ module, mode }, setState] = useState(readHash);
  const setModule = (m: string) => setState((s) => ({ ...s, module: m }));
  const setMode = (mode: Mode) => setState((s) => ({ ...s, mode }));

  useEffect(() => {
    const h = new URLSearchParams();
    h.set("m", module); h.set("mode", mode);
    history.replaceState(null, "", `#${h.toString()}`);
  }, [module, mode]);

  const active = MODULES.find((m) => m.id === module) ?? MODULES[0];
  const Active = active.Component;

  return (
    <ModeCtx.Provider value={{ mode, setMode }}>
      <div className="bp-canvas" />
      <div className="bp-grain" />
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">▙▟</span>
            <div>
              <div className="brand-name">PDR<span className="brand-dim">·visualized</span></div>
              <div className="eyebrow">property directed reachability — the real solver, thinking</div>
            </div>
          </div>
          <div className="topbar-right">
            <RuntimeBadge />
            <ModeToggle mode={mode} setMode={setMode} />
          </div>
        </header>

        <div className="body">
          <nav className="rail">
            {MODULES.map((m) => (
              <button key={m.id}
                className={`rail-item ${m.id === module ? "active" : ""}`}
                onClick={() => setModule(m.id)}>
                <span className="rail-glyph">{m.glyph}</span>
                <span className="rail-text">
                  <span className="rail-label">{m.label}</span>
                  <span className="rail-blurb">{m.blurb}</span>
                </span>
              </button>
            ))}
            <div className="rail-foot eyebrow">
              an interactive companion to<br />Ava Clifton's PDR thesis
            </div>
          </nav>

          <main className="stage">
            <Suspense fallback={<div className="stage-load eyebrow">loading module…</div>}>
              <Active key={active.id} />
            </Suspense>
          </main>
        </div>
      </div>
    </ModeCtx.Provider>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="mode-toggle" role="tablist">
      {(["learn", "lab"] as Mode[]).map((m) => (
        <button key={m} className={`mode-btn ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
          {m === "learn" ? "◐ Learn" : "◑ Lab"}
        </button>
      ))}
    </div>
  );
}

function RuntimeBadge() {
  const [s, setS] = useState<{ status: string; msg?: string }>({ status: runtime.status });
  useEffect(() => runtime.onStatus((status, msg) => setS({ status, msg })), []);
  const dot = s.status === "ready" ? "var(--mint)" : s.status === "error" ? "var(--rose)" : "var(--amber)";
  return (
    <div className="runtime-badge chip" title={`runtime: ${runtime.backend}`}>
      <span className="rt-dot" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
      <span className="num">{s.status === "ready" ? runtime.backend : s.msg || s.status}</span>
    </div>
  );
}
