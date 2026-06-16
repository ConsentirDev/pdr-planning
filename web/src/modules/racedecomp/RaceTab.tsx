import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { runtime } from "../../lib/runtime/runtime";
import { useTracePlayer } from "../../lib/trace/player";
import { Transport } from "../../lib/ui/Transport";
import { Term } from "../../lib/ui/Term";
import type { Ev, Trace, PdrResult } from "../../lib/trace/types";

type Domain = "logistics" | "blocksworld";
type Run = { name: string; events: Ev[]; result: PdrResult };

// events that represent a SAT-ish unit of work (a "question asked")
const WORK = new Set(["pop", "progress", "reason"]);

const LANE_COLOR = ["var(--cyan)", "var(--violet)", "var(--mint)"];
const LANE_GLYPH = ["◆", "▲", "●"];

function workSeen(events: Ev[], n: number): number {
  let c = 0;
  for (let i = 0; i < n && i < events.length; i++) if (WORK.has(events[i].t)) c++;
  return c;
}
function planAt(events: Ev[], n: number): boolean {
  for (let i = 0; i < n && i < events.length; i++) if (events[i].t === "plan") return true;
  return false;
}

export function RaceTab({ mode }: { mode: string }) {
  const [domain, setDomain] = useState<Domain>("logistics");
  const [locs, setLocs] = useState(3);
  const [pkgs, setPkgs] = useState(2);
  const [blocks, setBlocks] = useState(4);

  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runs = (trace?.runs ?? []) as Run[];
  const maxLen = useMemo(() => runs.reduce((m, r) => Math.max(m, r.events.length), 0), [runs]);
  const player = useTracePlayer(maxLen, { speed: 8, autoplay: true });
  const cursor = player.cursor + 1; // # events applied

  async function run() {
    setBusy(true); setErr(null);
    try {
      const params = domain === "logistics" ? { locs, pkgs } : { blocks };
      const t = await runtime.run({ module: "race", domain, params });
      setTrace(t);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  // final sat_calls + winner
  const finals = runs.map((r) => r.result?.stats?.sat_calls ?? r.events.length);
  const minFinal = finals.length ? Math.min(...finals) : 0;
  const maxFinal = finals.length ? Math.max(...finals, 1) : 1;
  const winnerIdx = finals.indexOf(minFinal);
  const allDone = runs.length > 0 && runs.every((r, i) => planAt(r.events, cursor) || cursor >= r.events.length);

  return (
    <>
      <div className="rd-controls panel">
        <div className="rd-ctl-row">
          <Field label="domain">
            <select value={domain} onChange={(e) => { setDomain(e.target.value as Domain); }}>
              <option value="logistics">Logistics</option>
              <option value="blocksworld">Blocksworld</option>
            </select>
          </Field>
          {domain === "logistics" ? (
            <>
              <Slider label="locations" v={locs} set={setLocs} min={2} max={5} />
              <Slider label="packages" v={pkgs} set={setPkgs} min={1} max={3} />
            </>
          ) : (
            <Slider label="blocks" v={blocks} set={setBlocks} min={3} max={5} />
          )}
          <button className="btn primary rd-run" onClick={run} disabled={busy}>
            {busy ? "running…" : "▶ run"}
          </button>
        </div>
        {err && <div className="rd-err mono">{err}</div>}
      </div>

      {mode === "learn" && (
        <div className="panel rd-banner">
          <span className="eyebrow">the race</span>
          <p>
            Three solvers attack the <em>same</em> problem with different{" "}
            <Term k="lookahead">look-ahead</Term>.{" "}
            <span className="hl">baseline</span> asks one <Term k="sat">SAT</Term> question at a time;{" "}
            <span className="hl" style={{ color: "var(--violet)" }}>PDR-M (F=3)</span> and{" "}
            <span className="hl-mint">PDR-IL (F=2)</span> peek several fences ahead. Fewer SAT calls = smarter search.
            {domain === "logistics" && " On Logistics, PDR-M sometimes nails it in a single call."}
          </p>
        </div>
      )}

      {!trace ? (
        <Welcome busy={busy} />
      ) : (
        <div className="panel race-track">
          <div className="panel-h">
            <div><span className="eyebrow">live · shared timeline</span> <span className="rd-iter-tag" style={{ marginLeft: 8 }}>SAT calls accrue as each solver thinks</span></div>
          </div>
          <div className="race-lanes">
            {runs.map((r, i) => {
              const total = Math.max(1, r.events.length);
              const seen = Math.min(cursor, r.events.length);
              const frac = seen / total;
              const done = planAt(r.events, cursor);
              const isWinner = allDone && i === winnerIdx;
              // animate sat count: scale final by progress, snap to final when done
              const finalSat = r.result?.stats?.sat_calls ?? total;
              const liveSat = done ? finalSat : Math.round(finalSat * frac) || workSeen(r.events, cursor);
              const color = LANE_COLOR[i % 3];
              return (
                <div key={r.name} className={`race-lane ${done ? "done" : ""} ${isWinner ? "winner" : ""}`}>
                  <div className={`race-lane-name ${isWinner ? "winner" : ""}`}>
                    <b>{r.name}</b>
                    <span className="race-lane-tag eyebrow" style={{ color }}>{LANE_GLYPH[i % 3]} {r.result?.solvable ? "solver" : "—"}</span>
                  </div>
                  <div className="race-bar-wrap">
                    <div className="race-bar-ticks" />
                    <motion.div className="race-bar-fill" style={{ background: `linear-gradient(90deg, ${color}, transparent)`, opacity: 0.35 }}
                      animate={{ scaleX: frac }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
                    <motion.div className="race-bar-runner" style={{ color }}
                      animate={{ left: `calc(${frac * 100}% - 8px)` }} transition={{ type: "spring", stiffness: 120, damping: 20 }}>
                      {done ? "✓" : LANE_GLYPH[i % 3]}
                    </motion.div>
                  </div>
                  <div className="race-counter">
                    <span className="num" style={{ color: done ? color : "var(--tx)" }}>{liveSat}</span>
                    <span className="eyebrow">{done ? "✓ sat calls" : "sat calls"}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {allDone && (
            <motion.div className="race-podium" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="race-podium-h">
                <h3>Final tally</h3>
                <span className="eyebrow">SAT calls · lower is better</span>
              </div>
              <div className="race-cmp">
                {runs.map((r, i) => {
                  const v = finals[i];
                  const isWin = i === winnerIdx;
                  const w = (v / maxFinal) * 100;
                  const color = LANE_COLOR[i % 3];
                  return (
                    <div className="race-cmp-row" key={r.name}>
                      <span className={`race-cmp-label ${isWin ? "win" : ""}`}>{isWin && "♛ "}{r.name}</span>
                      <div className="race-cmp-track">
                        <motion.div className={`race-cmp-fill ${isWin ? "glow-mint" : ""}`}
                          style={{ background: isWin ? "var(--mint)" : color }}
                          initial={{ width: 0 }} animate={{ width: `${Math.max(4, w)}%` }}
                          transition={{ delay: i * 0.12, type: "spring", stiffness: 90, damping: 18 }} />
                      </div>
                      <span className="race-cmp-val" style={{ color: isWin ? "var(--mint)" : "var(--tx)" }}>{v}</span>
                    </div>
                  );
                })}
              </div>
              {mode === "learn" && winnerIdx >= 0 && (
                <p style={{ marginTop: 12, fontSize: 13, color: "var(--tx-2)", lineHeight: 1.6 }}>
                  <span className="race-crown">♛ {runs[winnerIdx].name}</span> wins with{" "}
                  <b style={{ color: "var(--mint)" }}>{minFinal}</b> SAT call{minFinal === 1 ? "" : "s"}
                  {minFinal === 1 ? " — it saw the whole plan in one question." :
                    `, vs ${maxFinal} for the slowest. Deeper look-ahead means fewer dead ends to learn from.`}
                </p>
              )}
            </motion.div>
          )}

          <div style={{ padding: "0 14px 14px" }}>
            <Transport player={player} label={allDone ? "race complete" : `tick ${cursor}/${maxLen}`} />
          </div>
        </div>
      )}
    </>
  );
}

function Welcome({ busy }: { busy: boolean }) {
  return (
    <div className="rd-welcome">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="rd-welcome-glyph">◆ ▲ ●</div>
        <h2>Three solvers, one finish line.</h2>
        <p className="rd-welcome-p">
          The same planning problem, attacked by <span className="hl">baseline</span> PDR and two
          look-ahead variants. Watch their SAT-call counters climb on a shared timeline — the one that
          reaches the goal with the fewest questions wins.
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
