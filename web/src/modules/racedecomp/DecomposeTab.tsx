import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { runtime } from "../../lib/runtime/runtime";
import { useTracePlayer } from "../../lib/trace/player";
import { Transport } from "../../lib/ui/Transport";
import type { Ev, Trace } from "../../lib/trace/types";

type Domain = "logistics" | "fuel";

// ---- derived view-state from events[0..cursor] ----
interface DecompState {
  iteration: number;
  chunks: string[][];
  edges: [string[], string[]][];
  subgoals: string[][];
  subproblems: { goal: string[]; solvable: boolean | null; plan: string[][] }[];
  merge: { reason: string; problematic?: string } | null;
  concrete: string[][] | null;
  lastKind: string;
}

function derive(events: Ev[], cursor: number): DecompState {
  const st: DecompState = {
    iteration: 0, chunks: [], edges: [], subgoals: [],
    subproblems: [], merge: null, concrete: null, lastKind: "",
  };
  for (let i = 0; i <= cursor && i < events.length; i++) {
    const ev = events[i];
    st.lastKind = ev.t;
    switch (ev.t) {
      case "iteration":
        st.iteration = ev.iteration;
        st.chunks = ev.chunks; st.edges = ev.edges; st.subgoals = ev.subgoals;
        st.subproblems = []; st.merge = null; st.concrete = null; // new iteration resets
        break;
      case "subproblems":
        st.subproblems = ev.subproblems;
        break;
      case "merge":
        st.merge = { reason: ev.reason, problematic: ev.problematic };
        break;
      case "concrete_plan":
        st.concrete = ev.plan;
        break;
    }
  }
  return st;
}

// chunk identity by its label set (for subgoal highlight)
const key = (c: string[]) => c.join("|");
const shortName = (p: string) => p; // already short labels from backend

// ---- layout chunks left->right by topological-ish depth from edges ----
function layout(chunks: string[][], edges: [string[], string[]][]) {
  const idx = new Map<string, number>();
  chunks.forEach((c, i) => idx.set(key(c), i));
  const depth = new Array(chunks.length).fill(0);
  // bump downstream depth a couple passes
  for (let pass = 0; pass < chunks.length; pass++) {
    for (const [a, b] of edges) {
      const ai = idx.get(key(a)); const bi = idx.get(key(b));
      if (ai != null && bi != null) depth[bi] = Math.max(depth[bi], depth[ai] + 1);
    }
  }
  const maxDepth = Math.max(0, ...depth);
  const cols: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
  depth.forEach((d, i) => cols[d].push(i));

  const NW = 132, NH = 58, GX = 70, GY = 26, PADX = 20, PADY = 20;
  const pos: { x: number; y: number }[] = new Array(chunks.length);
  cols.forEach((col, d) => {
    col.forEach((ci, row) => {
      pos[ci] = { x: PADX + d * (NW + GX), y: PADY + row * (NH + GY) };
    });
  });
  const rows = Math.max(1, ...cols.map((c) => c.length));
  const W = PADX * 2 + (maxDepth + 1) * NW + maxDepth * GX;
  const H = PADY * 2 + rows * NH + (rows - 1) * GY;
  return { pos, NW, NH, W, H, idx };
}

export function DecomposeTab({ mode }: { mode: string }) {
  const [domain, setDomain] = useState<Domain>("logistics");
  const [locs, setLocs] = useState(4);
  const [pkgs, setPkgs] = useState(2);

  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const events = (trace?.events ?? []) as Ev[];
  const player = useTracePlayer(events.length, { speed: 3, autoplay: true });
  const st = useMemo(() => derive(events, player.cursor), [events, player.cursor]);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const params = domain === "logistics" ? { locs, pkgs } : {};
      const t = await runtime.run({ module: "decomp", domain, params });
      setTrace(t);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  const merging = st.merge != null;
  const subgoalKeys = new Set(st.subgoals.map(key));
  const lay = useMemo(() => layout(st.chunks, st.edges), [st.chunks, st.edges]);

  return (
    <>
      <div className="rd-controls panel">
        <div className="rd-ctl-row">
          <Field label="domain">
            <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
              <option value="logistics">Logistics</option>
              <option value="fuel">Fuel-limited</option>
            </select>
          </Field>
          {domain === "logistics" ? (
            <>
              <Slider label="locations" v={locs} set={setLocs} min={2} max={5} />
              <Slider label="packages" v={pkgs} set={setPkgs} min={1} max={3} />
            </>
          ) : (
            <span className="chip" style={{ alignSelf: "center" }}>fixed scenario — fuel forces a merge</span>
          )}
          <button className="btn primary rd-run" onClick={run} disabled={busy}>
            {busy ? "running…" : "▶ run"}
          </button>
        </div>
        {err && <div className="rd-err mono">{err}</div>}
      </div>

      {mode === "learn" && (
        <div className="panel rd-banner">
          <span className="eyebrow">decompose</span>
          <p>
            Instead of solving the whole goal at once, the planner splits it into{" "}
            <span className="hl">independent chunks</span>, solves each as a mini-problem, then{" "}
            <span className="hl-mint">glues</span> the plans together.
            {domain === "fuel"
              ? " But fuel is shared: the glue FAILS on a fuel proposition, so the chunks must MERGE and re-solve as one."
              : " When the chunks don't share a scarce resource, the glue just works."}
          </p>
        </div>
      )}

      {!trace ? (
        <Welcome busy={busy} domain={domain} />
      ) : (
        <div className="dc-main">
          <div className="panel dc-graph-panel">
            <div className="panel-h">
              <div>
                <span className="eyebrow">dependency decomposition</span>{" "}
                <span className="dc-iter-tag" style={{ marginLeft: 8 }}>iteration {st.iteration}</span>
              </div>
              <div className="chip">{st.chunks.length} chunk{st.chunks.length === 1 ? "" : "s"} · {st.subgoals.length} sub-goal{st.subgoals.length === 1 ? "" : "s"}</div>
            </div>
            <div className="dc-graph-body">
              {st.chunks.length === 0 ? (
                <div className="dc-empty eyebrow">press play — the goal graph appears as the planner partitions it</div>
              ) : (
                <svg className="dc-svg" viewBox={`0 0 ${lay.W} ${lay.H}`} style={{ height: lay.H }}>
                  <defs>
                    <marker id="dc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" className="dc-edge-arrow" />
                    </marker>
                  </defs>
                  {/* edges */}
                  {st.edges.map(([a, b], i) => {
                    const ai = lay.idx.get(key(a)); const bi = lay.idx.get(key(b));
                    if (ai == null || bi == null) return null;
                    const pa = lay.pos[ai], pb = lay.pos[bi];
                    if (!pa || !pb) return null;
                    const x1 = pa.x + lay.NW, y1 = pa.y + lay.NH / 2;
                    const x2 = pb.x, y2 = pb.y + lay.NH / 2;
                    const mx = (x1 + x2) / 2;
                    return (
                      <path key={i} className="dc-edge" markerEnd="url(#dc-arrow)"
                        d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 8},${y2}`} />
                    );
                  })}
                  {/* nodes */}
                  {st.chunks.map((c, i) => {
                    const p = lay.pos[i]; if (!p) return null;
                    const isSub = subgoalKeys.has(key(c));
                    const probHit = merging && c.some((prop) => prop === st.merge?.problematic);
                    const cls = merging ? (probHit ? "problem" : "merged") : isSub ? "subgoal" : "";
                    return (
                      <motion.g key={key(c)}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1, x: merging ? (lay.W / 2 - p.x - lay.NW / 2) * 0.18 : 0 }}
                        transition={{ type: "spring", stiffness: 100, damping: 18 }}>
                        <rect x={p.x} y={p.y} width={lay.NW} height={lay.NH} rx={4}
                          className={`dc-node-box ${cls}`} />
                        <text x={p.x + 8} y={p.y + 16} className="dc-node-label">
                          {isSub ? "◈ " : ""}chunk {i + 1}
                        </text>
                        {c.slice(0, 3).map((prop, j) => (
                          <text key={j} x={p.x + 8} y={p.y + 30 + j * 11}
                            className={`dc-node-prop ${prop === st.merge?.problematic ? "flash" : ""}`}>
                            {shortName(prop).slice(0, 18)}
                          </text>
                        ))}
                        {c.length > 3 && (
                          <text x={p.x + 8} y={p.y + 30 + 3 * 11} className="dc-node-prop">+{c.length - 3} more</text>
                        )}
                      </motion.g>
                    );
                  })}
                </svg>
              )}
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
              <Transport player={player} label={labelFor(st)} />
            </div>
          </div>

          <div className="dc-side">
            <AnimatePresence>
              {merging && (
                <motion.div className="dc-merge" key="merge"
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  <h3>⚡ Glue failed — merging</h3>
                  <p>
                    {st.merge?.reason === "glue-failed" ? (
                      <>The chunks were solved independently, but concatenating their plans broke on{" "}
                        <span className="prob">{st.merge?.problematic ?? "a shared proposition"}</span> — a resource
                        one chunk consumed that the next still needed. The chunks merge into a single problem and re-solve as one.</>
                    ) : (
                      <>A sub-problem turned out <span className="prob">unsolvable</span> in isolation. The decomposition
                        was too aggressive; the chunks merge and re-solve together.</>
                    )}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="panel" style={{ padding: 12 }}>
              <span className="eyebrow">sub-problems · this iteration</span>
              {st.subproblems.length === 0 ? (
                <div className="dc-empty">solving sub-problems…</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                  {st.subproblems.map((sp, i) => {
                    const solved = sp.solvable === true;
                    const unsolved = sp.solvable === false;
                    return (
                      <motion.div key={i} className={`dc-subprob ${solved ? "solved" : unsolved ? "unsolved" : ""}`}
                        initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                        <div className="dc-subprob-h">
                          <span className="dc-subprob-goal">⊢ {sp.goal.slice(0, 2).join(", ")}{sp.goal.length > 2 ? "…" : ""}</span>
                          <span className="chip" style={{ color: solved ? "var(--mint)" : unsolved ? "var(--rose)" : "var(--amber)" }}>
                            {solved ? "✓ solved" : unsolved ? "✗ unsolvable" : "…"}
                          </span>
                        </div>
                        <div className="dc-miniplan">
                          {sp.plan.length === 0 ? (
                            <span className="dc-empty">{solved ? "(already true)" : "no plan"}</span>
                          ) : sp.plan.map((step, s) => (
                            <div className="dc-miniplan-step" key={s}>
                              <span className="dc-miniplan-n">{s + 1}</span>
                              <span className="dc-miniplan-act">{step.join(" + ")}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>concrete plan</span>
              {st.concrete ? (
                <motion.div className="dc-plan" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {st.concrete.map((step, i) => (
                    <motion.div className="dc-plan-step" key={i}
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}>
                      <span className="dc-plan-n">{i + 1}</span>
                      <span className="dc-plan-acts">{step.join(" + ")}</span>
                    </motion.div>
                  ))}
                  <span className="dc-plan-goal">◍ goal</span>
                </motion.div>
              ) : (
                <div className="dc-empty">assembles in mint when the glued plan succeeds</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function labelFor(st: DecompState): string {
  switch (st.lastKind) {
    case "iteration": return `iteration ${st.iteration} — partition into ${st.chunks.length} chunks`;
    case "subproblems": return `solved ${st.subproblems.length} sub-problems`;
    case "merge": return `⚡ merge — ${st.merge?.reason}`;
    case "concrete_plan": return `✓ glued plan (${st.concrete?.length ?? 0} steps)`;
    default: return "ready";
  }
}

function Welcome({ busy, domain }: { busy: boolean; domain: string }) {
  return (
    <div className="rd-welcome">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="rd-welcome-glyph">▢→▢ ◈ ▢</div>
        <h2>Split the goal. Solve the pieces. Glue.</h2>
        <p className="rd-welcome-p">
          The planner partitions the goal into a dependency graph of <span className="hl">chunks</span>,
          solves each chunk as its own little problem, and concatenates the plans.
          {domain === "fuel"
            ? " In the fuel scenario, watch the glue snap on a shared fuel proposition — the chunks must merge and re-solve as one."
            : " Pick fuel-limited to watch a merge happen when a shared resource breaks the glue."}
        </p>
        <p className="eyebrow">{busy ? "booting python in your browser…" : "press ▶ run above"}</p>
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="rd-field"><span className="eyebrow">{label}</span>{children}</label>;
}
function Slider({ label, v, set, min, max }: { label: string; v: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <label className="rd-field">
      <span className="eyebrow">{label} <b className="num">{v}</b></span>
      <input type="range" min={min} max={max} value={v} onChange={(e) => set(parseInt(e.target.value, 10))} />
    </label>
  );
}
