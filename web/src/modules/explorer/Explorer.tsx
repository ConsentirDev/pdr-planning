import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { runtime } from "../../lib/runtime/runtime";
import { useTracePlayer } from "../../lib/trace/player";
import { Transport } from "../../lib/ui/Transport";
import { NarrationFeed, buildBeats, useGuidedNarration } from "../../lib/ui/NarrationFeed";
import type { Ev, Meta, Trace } from "../../lib/trace/types";
import { useMode } from "../../app/App";
import { deriveExplorer } from "./derive";
import { Fences } from "./Fences";
import { WorldView } from "./WorldView";
import { HeroDemo } from "./HeroDemo";
import "./explorer.css";

type Domain = "logistics" | "blocksworld";

export default function Explorer() {
  const { mode } = useMode();
  const [domain, setDomain] = useState<Domain>("logistics");
  const [locs, setLocs] = useState(3);
  const [pkgs, setPkgs] = useState(2);
  const [blocks, setBlocks] = useState(3);
  const [variant, setVariant] = useState("baseline");
  const [F, setF] = useState(1);
  const [reschedule, setReschedule] = useState(true);
  const [clausePush, setClausePush] = useState(true);

  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const events = (trace?.events ?? []) as Ev[];
  const meta = trace?.meta as Meta | undefined;
  // Learn mode is narration-paced (the clock is OFF; each step advances only when
  // its beat is read/spoken). Lab mode runs on the fast clock.
  const guided = mode === "learn";
  const [voiceOn, setVoiceOn] = useState(false);
  const player = useTracePlayer(events.length, { speed: 6, autoplay: true, clock: !guided });
  const st = useMemo(
    () => (meta ? deriveExplorer(meta, events, player.cursor) : null),
    [meta, events, player.cursor]
  );
  const beats = useMemo(
    () => (meta && st ? buildBeats(events, player.cursor, (ev) => narrate(meta, ev, st)) : []),
    [meta, events, player.cursor, st]
  );
  const currentBeat = meta && st && player.cursor >= 0 ? narrate(meta, events[player.cursor], st) : null;
  useGuidedNarration({
    enabled: guided && player.playing, cursor: player.cursor, total: events.length,
    text: currentBeat, voiceOn, advance: player.advance,
  });

  async function run() {
    setBusy(true); setErr(null);
    try {
      const params = domain === "logistics" ? { locs, pkgs } : { blocks };
      const t = await runtime.run({
        module: "pdr", domain, params,
        config: { variant, F: variant === "baseline" ? 1 : F, reschedule, clause_pushing: clausePush, max_k: 30 },
      });
      setTrace(t);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  const curEvent = st && player.cursor >= 0 ? events[player.cursor] : null;

  return (
    <div className="explorer">
      <div className="ex-controls panel">
        <div className="ex-ctl-row">
          <Field label="domain">
            <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
              <option value="logistics">Logistics</option>
              <option value="blocksworld">Blocksworld</option>
            </select>
          </Field>
          {domain === "logistics" ? (
            <>
              <Slider label="locations" v={locs} set={setLocs} min={2} max={8} />
              <Slider label="packages" v={pkgs} set={setPkgs} min={1} max={6} />
            </>
          ) : (
            <Slider label="blocks" v={blocks} set={setBlocks} min={2} max={7} />
          )}
          {mode === "lab" && (
            <>
              <Field label="variant">
                <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                  <option value="baseline">baseline</option>
                  <option value="M">PDR-M</option>
                  <option value="IL">PDR-IL</option>
                </select>
              </Field>
              {variant !== "baseline" && <Slider label="F" v={F} set={setF} min={2} max={5} />}
              <Toggle label="reschedule" v={reschedule} set={setReschedule} />
              <Toggle label="clause-push" v={clausePush} set={setClausePush} />
            </>
          )}
          <button className="btn primary ex-run" onClick={run} disabled={busy}>
            {busy ? "running…" : "▶ run"}
          </button>
        </div>
        {err && <div className="ex-err mono">{err}</div>}
      </div>

      {!trace ? (
        <Welcome mode={mode} busy={busy} />
      ) : (
        <>
          <div className="ex-main">
            <div className="ex-fences panel">
              <div className="panel-h">
                <div><span className="eyebrow">the fences</span> <span className="ex-h-sub">reachability layers, learned backward from the goal</span></div>
                <Stats st={st!} result={trace.result} />
              </div>
              <div className="ex-fences-body">
                <Fences meta={meta!} st={st!} />
              </div>
            </div>

            <div className="ex-side">
              <div className="panel ex-world">
                <div className="panel-h"><span className="eyebrow">world · state under inspection</span></div>
                <WorldView meta={meta!} state={st?.current?.state ?? meta!.init} />
              </div>
              {mode === "learn" && (
                <NarrationFeed lines={beats} voiceOn={voiceOn} onToggleVoice={() => setVoiceOn((v) => !v)}
                  narrating={player.playing} />
              )}
            </div>
          </div>

          <PlanStrip st={st!} />
          <Transport player={player} label={curEvent ? labelFor(curEvent) : "ready"} />
        </>
      )}
    </div>
  );
}

// ---- sub-components ----
function Welcome({ mode, busy }: { mode: string; busy: boolean }) {
  return (
    <div className="ex-welcome">
      <div className="ex-hero">
        <div className="ex-hero-copy">
          <motion.div className="kicker rise" >property directed reachability</motion.div>
          <motion.h1 className="display ex-hero-title rise-2">
            Watch a planner<br />think.
          </motion.h1>
          <motion.p className="ex-welcome-p rise-3">
            PDR reasons <em>backward</em> from the goal, keeping nested fences —
            {" "}<span className="hl">L0</span> is the goal, <span className="hl">L1</span> is one
            move away — and <span className="hl-amber">learning from every dead end</span> until
            a path appears, or it proves none can.
          </motion.p>
          <motion.div className="ex-hero-cta rise-3">
            <span className="chip">{mode === "learn" ? "◐ Learn mode — narrated" : "◑ Lab mode — full control"}</span>
            <span className="ex-hero-go">{busy ? "booting Python in your browser…" : "pick a world, press ▶ run"}</span>
          </motion.div>
        </div>
        <motion.div className="ex-hero-viz" initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.1 }}>
          <HeroDemo />
        </motion.div>
      </div>
    </div>
  );
}

function Stats({ st, result }: { st: ReturnType<typeof deriveExplorer>; result: any }) {
  return (
    <div className="ex-stats num">
      <Stat k="k" v={st.k} />
      <Stat k="reasons" v={st.reasons} accent="amber" />
      <Stat k="steps" v={st.progressions} accent="cyan" />
      {st.done === "plan" && <Stat k="✓ plan" v={result?.stats?.sat_calls ?? ""} accent="mint" />}
      {st.done === "unsat" && <span className="chip" style={{ color: "var(--rose)" }}>no plan exists</span>}
    </div>
  );
}
function Stat({ k, v, accent }: { k: string; v: any; accent?: string }) {
  const c = accent === "amber" ? "var(--amber)" : accent === "cyan" ? "var(--cyan)" : accent === "mint" ? "var(--mint)" : "var(--tx)";
  return <span className="ex-stat"><span className="eyebrow">{k}</span><b style={{ color: c }}>{v}</b></span>;
}

function PlanStrip({ st }: { st: ReturnType<typeof deriveExplorer> }) {
  if (!st.plan) return <div className="ex-plan empty eyebrow">plan assembles here when the goal is reached</div>;
  return (
    <div className="ex-plan">
      <span className="eyebrow">plan</span>
      {st.plan.map((step, i) => (
        <motion.div className="plan-step" key={i}
                    initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}>
          <span className="plan-n num">{i + 1}</span>
          <span className="plan-acts mono">{step.join(" + ")}</span>
        </motion.div>
      ))}
      <span className="plan-goal">◍ goal</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="ex-field"><span className="eyebrow">{label}</span>{children}</label>;
}
function Slider({ label, v, set, min, max }: { label: string; v: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <label className="ex-field">
      <span className="eyebrow">{label} <b className="num">{v}</b></span>
      <input type="range" min={min} max={max} value={v} onChange={(e) => set(parseInt(e.target.value, 10))} />
    </label>
  );
}
function Toggle({ label, v, set }: { label: string; v: boolean; set: (b: boolean) => void }) {
  return (
    <button className={`ex-toggle ${v ? "on" : ""}`} onClick={() => set(!v)}>
      <span className="eyebrow">{label}</span><span className="ex-toggle-dot" />
    </button>
  );
}

// ---- text ----
function labelFor(ev: Ev): string {
  switch (ev.t) {
    case "k": return `widen horizon → k=${ev.k}`;
    case "pop": return `process obligation @ L${ev.layer}`;
    case "progress": return `step closer → L${ev.succ_layer}`;
    case "reason": return `learn reason @ L${ev.layer}`;
    case "reschedule": return `reschedule → L${ev.to_layer}`;
    case "push": return `push clause → L${ev.layer}`;
    case "plan": return `✓ plan found (${ev.steps})`;
    case "converged": return `converged — no plan`;
    default: return ev.t;
  }
}
function narrate(meta: Meta, ev: Ev | null, st: ReturnType<typeof deriveExplorer>): string {
  if (!ev) return "Press play to watch PDR search backward from the goal, one little SAT question at a time.";
  switch (ev.t) {
    case "k": return `No plan exists within ${ev.k - 1} step(s), so PDR widens the horizon to k=${ev.k} and tries again.`;
    case "pop": return `PDR asks a little yes/no question: can THIS state reach the goal in ${ev.layer} step(s)?`;
    case "progress": return `Yes — there's a move (${(ev.actions[0] || []).join(", ") || "an action"}) landing one fence closer, at L${ev.succ_layer}. That successor becomes the next question.`;
    case "reason": return `Dead end. PDR works out a small reason it's stuck and bricks "${facts(meta, ev.reason)}" into every fence up to L${ev.layer}, so it never wastes time there again.`;
    case "reschedule": return `The state couldn't progress here, so PDR gives it another chance at the looser fence L${ev.to_layer}.`;
    case "push": return `A learned dead-end is pushed forward to L${ev.layer} — strengthening the fences.`;
    case "plan": return ev.steps === 0 ? "The start already satisfies the goal — nothing to do!" : `An obligation reached L0 — the goal is reachable from the start. PDR stitches the moves into a ${ev.steps}-step plan.`;
    case "converged": return "Two neighbouring fences became identical — nothing can change anymore, so PDR has PROVED no plan exists. (It never had to imagine the whole world at once.)";
    default: return "…";
  }
}
function facts(meta: Meta, cube: number[]): string {
  return cube.filter((l) => l > 0).map((l) => meta.props[Math.abs(l) - 1]).join(", ") || "∅";
}
