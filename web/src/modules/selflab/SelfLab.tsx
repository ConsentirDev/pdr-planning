import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { runtime } from "../../lib/runtime/runtime";
import { useTracePlayer } from "../../lib/trace/player";
import { Transport } from "../../lib/ui/Transport";
import { Term } from "../../lib/ui/Term";
import type { Ev, Trace } from "../../lib/trace/types";
import { useMode } from "../../app/App";
import {
  deriveSelfLab,
  classifySpec,
  toWeightRows,
  ratio,
  type Seam,
  type SelfLabState,
  type BestOp,
  type Candidate,
} from "./derive";
import { CodeBlock } from "./CodeBlock";
import "./selflab.css";

const SEAMS: { id: Seam; label: string; note: string }[] = [
  { id: "progression", label: "progression", note: "most leverage" },
  { id: "reason", label: "reason", note: "dead-end learning" },
  { id: "obligation", label: "obligation", note: "queue order" },
];

export default function SelfLab() {
  const { mode } = useMode();
  const [seam, setSeam] = useState<Seam>("progression");
  const [split, setSplit] = useState(true);
  const [generations, setGenerations] = useState(3);

  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // live per-generation events streamed from the backend while it computes
  const [live, setLive] = useState<Ev[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  const events = (trace?.events ?? []) as Ev[];
  const result = trace?.result as
    | { best: BestOp & { kind?: string }; baseline: number; archive: { name: string; sat_calls: number }[] }
    | undefined;
  const traceSplit = (trace?.meta as any)?.split ?? split;

  const player = useTracePlayer(events.length, { speed: 1.2, autoplay: true });
  const st = useMemo(
    () => (events.length ? deriveSelfLab(events, player.cursor) : null),
    [events, player.cursor]
  );
  // while streaming, derive the live view from the events received so far
  const liveSt = useMemo(
    () => (live.length ? deriveSelfLab(live, live.length - 1) : null),
    [live]
  );
  const streamedGen = live.length ? (live[live.length - 1] as any).gen ?? 0 : -1;
  const totalGens = (live.length && (live[live.length - 1] as any).total_gens) || generations;

  // elapsed-time ticker while a run is in flight
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 200);
    return () => clearInterval(id);
  }, [busy]);

  async function run() {
    setBusy(true); setErr(null); setTrace(null); setLive([]); setElapsed(0);
    startedAt.current = Date.now();
    try {
      const t = await runtime.runStream(
        { module: "evolve", seam, config: { split, generations } },
        (ev) => setLive((cur) => [...cur, ev as Ev]),
      );
      setTrace(t);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const showLive = busy && !trace;

  return (
    <div className="selflab">
      <Controls
        mode={mode}
        seam={seam} setSeam={setSeam}
        split={split} setSplit={setSplit}
        generations={generations} setGenerations={setGenerations}
        busy={busy} run={run} err={err}
      />

      {showLive ? (
        <LiveProgress seam={seam} st={liveSt} gen={streamedGen} total={totalGens}
          elapsed={elapsed} streaming={live.length > 0} backend={runtime.backend} />
      ) : !st ? (
        <Welcome mode={mode} busy={busy} />
      ) : (
        <>
          <div className="sl-main">
            <div className="sl-left">
              <Headline st={st} split={traceSplit} />
              <Leaderboard st={st} />
              <Candidates st={st} />
            </div>
            <div className="sl-right">
              <OperatorCard st={st} resultKind={result?.best?.kind} />
              {mode === "learn" && <Narration st={st} split={traceSplit} />}
              <HowItWorks compact />
            </div>
          </div>
          <Transport player={player} label={`generation ${st.gen} / ${st.totalGens}`} />
        </>
      )}
    </div>
  );
}

/* ============================ live progress (the slow run, made legible) ===== */
function LiveProgress({ seam, st, gen, total, elapsed, streaming, backend }: {
  seam: string; st: SelfLabState | null; gen: number; total: number;
  elapsed: number; streaming: boolean; backend: string;
}) {
  const pct = total > 0 ? Math.min(100, ((gen + 1) / total) * 100) : 0;
  return (
    <div className="sl-live">
      <div className="sl-live-head panel">
        <div className="sl-live-top">
          <div>
            <span className="eyebrow">evolving · <b style={{ color: "var(--cyan)" }}>{seam}</b> seam</span>
            <div className="sl-live-title">
              {streaming ? <>generation <b className="num">{gen + 1}</b> of <b className="num">{total}</b></>
                : "warming up the curriculum…"}
            </div>
          </div>
          <div className="sl-live-clock num">{elapsed.toFixed(1)}s</div>
        </div>
        <div className="sl-live-track">
          <motion.div className="sl-live-fill" animate={{ width: `${streaming ? pct : 8}%` }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
          {!streaming && <div className="sl-live-indeterminate" />}
        </div>
        <p className="sl-live-note">
          {streaming
            ? <>each generation runs the <b>real</b> planner across the whole training curriculum, gates every candidate for soundness, then ranks survivors on the held-out set — watch the champion improve below.</>
            : backend === "server"
              ? "the backend is spinning up the run — the first generation appears in a moment."
              : "running in your browser (no backend) — this is the heavy module, so it can take a while; progress streaming needs the backend."}
        </p>
      </div>

      {st ? (
        <div className="sl-main">
          <div className="sl-left">
            <Headline st={st} split={true} />
            <Leaderboard st={st} />
            <Candidates st={st} />
          </div>
          <div className="sl-right">
            <OperatorCard st={st} resultKind={undefined} />
            <HowItWorks compact />
          </div>
        </div>
      ) : (
        <div className="sl-live-skeleton">
          <div className="sl-evolving-row">
            {["✦", "◆", "●", "◇", "✕", "◆", "●"].map((g, i) => (
              <motion.span key={i} className="sl-evolving-glyph"
                animate={{ opacity: [0.2, 1, 0.2], y: [0, -4, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.12 }}>{g}</motion.span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ controls ============================ */
function Controls(props: {
  mode: string;
  seam: Seam; setSeam: (s: Seam) => void;
  split: boolean; setSplit: (b: boolean) => void;
  generations: number; setGenerations: (n: number) => void;
  busy: boolean; run: () => void; err: string | null;
}) {
  const { seam, setSeam, split, setSplit, generations, setGenerations, busy, run, err } = props;
  return (
    <div className="sl-controls panel">
      <div className="sl-ctl-row">
        <label className="sl-field">
          <span className="eyebrow">seam</span>
          <div className="sl-seams">
            {SEAMS.map((s) => (
              <button
                key={s.id}
                className={`sl-seam ${seam === s.id ? "on" : ""}`}
                onClick={() => setSeam(s.id)}
                title={s.note}
              >
                <span className="sl-seam-label">{s.label}</span>
                <span className="sl-seam-note">{s.note}</span>
              </button>
            ))}
          </div>
        </label>

        <button
          className={`sl-toggle ${split ? "on" : ""}`}
          onClick={() => setSplit(!split)}
          title="rank candidates on a held-out validation set, not the training set"
        >
          <span className="eyebrow">held-out split</span>
          <span className="sl-toggle-dot" />
        </button>

        <label className="sl-field">
          <span className="eyebrow">generations <b className="num">{generations}</b></span>
          <input
            type="range" min={2} max={5} value={generations}
            onChange={(e) => setGenerations(parseInt(e.target.value, 10))}
          />
        </label>

        <button className="btn primary sl-run" onClick={run} disabled={busy}>
          {busy ? "evolving…" : "▶ run"}
        </button>
      </div>
      {err && <div className="sl-err mono">{err}</div>}
    </div>
  );
}

/* ============================ headline ============================ */
function Headline({ st, split }: { st: SelfLabState; split: boolean }) {
  const r = ratio(st.baseline, st.best.sat_calls);
  const win = st.best.sat_calls < st.baseline;
  return (
    <div className="sl-headline panel">
      <div className="sl-head-metric">
        <div className="sl-head-block">
          <span className="eyebrow">evolved</span>
          <motion.b
            key={st.best.sat_calls}
            className="num sl-big"
            style={{ color: win ? "var(--mint)" : "var(--tx)" }}
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          >
            {st.best.sat_calls}
          </motion.b>
          <span className="eyebrow">sat-calls</span>
        </div>
        <span className="sl-vs num">vs</span>
        <div className="sl-head-block">
          <span className="eyebrow">baseline</span>
          <b className="num sl-big" style={{ color: "var(--tx-2)" }}>{st.baseline}</b>
          <span className="eyebrow">hand-designed</span>
        </div>
        <div className="sl-head-ratio">
          <motion.b key={r} className="num" initial={{ scale: 0.8 }} animate={{ scale: 1 }}
                    style={{ color: win ? "var(--mint)" : "var(--amber)" }}>
            {r}×
          </motion.b>
          <span className="eyebrow">{win ? "faster" : "no gain yet"}</span>
        </div>
      </div>

      {split && <TrainValid best={st.best} />}
    </div>
  );
}

function TrainValid({ best }: { best: BestOp }) {
  const hi = Math.max(best.train, best.valid, 1);
  const scale = hi * 1.15;
  const overfit = best.train < best.valid; // looks better on train than it really is
  return (
    <div className="sl-tv">
      <div className="sl-tv-head">
        <span className="eyebrow">train vs held-out validation</span>
        <span className="sl-tv-note">
          ranking on <b>validation</b> (larger held-out set) is what stops the operator overfitting the training puzzles
        </span>
      </div>
      <div className="sl-tv-bars">
        <TvBar label="train" v={best.train} scale={scale} color="var(--violet)" />
        <TvBar label="valid" v={best.valid} scale={scale} color="var(--cyan)" />
      </div>
      {overfit && (
        <div className="sl-tv-flag mono">
          ▲ train={best.train} flatters it; the true score is valid={best.valid}. We rank on valid.
        </div>
      )}
      <div className="sl-tv-spread eyebrow">spread {Math.abs(best.valid - best.train)} · lower is better</div>
    </div>
  );
}
function TvBar({ label, v, scale, color }: { label: string; v: number; scale: number; color: string }) {
  const pct = Math.max(2, (v / scale) * 100);
  return (
    <div className="sl-tvbar-row">
      <span className="eyebrow sl-tvbar-label">{label}</span>
      <div className="sl-tvbar-track">
        <motion.div
          className="sl-tvbar-fill"
          style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="num sl-tvbar-v">{v}</span>
    </div>
  );
}

/* ============================ leaderboard ============================ */
function Leaderboard({ st }: { st: SelfLabState }) {
  const rows = [...st.archive].sort((a, b) => a.sat_calls - b.sat_calls).slice(0, 8);
  const bestName = st.best.name;
  const scale = Math.max(st.worst, 1) * 1.1;
  const basePct = Math.min(100, (st.baseline / scale) * 100);
  return (
    <div className="sl-board panel">
      <div className="panel-h">
        <span className="eyebrow">leaderboard · archive</span>
        <span className="sl-board-sub">shorter bar = fewer sat-calls = better</span>
      </div>
      <div className="sl-board-body">
        <div className="sl-board-baseline" style={{ left: `${basePct}%` }}>
          <span className="eyebrow">baseline {st.baseline}</span>
        </div>
        <AnimatePresence initial={false}>
          {rows.map((op) => {
            const pct = Math.max(3, (op.sat_calls / scale) * 100);
            const isBest = op.name === bestName;
            return (
              <motion.div
                className={`sl-board-row ${isBest ? "best" : ""}`}
                key={op.name}
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
              >
                <span className="sl-board-name mono" title={op.name}>{op.name}</span>
                <div className="sl-board-track">
                  <motion.div
                    className="sl-board-fill"
                    layout
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {isBest && <span className="sl-board-crown">◆</span>}
                  </motion.div>
                </div>
                <span className="sl-board-v num">{op.sat_calls}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ============================ candidates / safety gate ============================ */
function Candidates({ st }: { st: SelfLabState }) {
  const cs = st.candidates;
  const safe = cs.filter((c) => c.safe).length;
  const rejected = cs.length - safe;
  return (
    <div className="sl-cands panel">
      <div className="panel-h">
        <span className="eyebrow">generation {st.gen} · candidates</span>
        <span className="sl-cands-sub num">
          <span style={{ color: "var(--cyan)" }}>{safe} safe</span>
          {rejected > 0 && <> · <span style={{ color: "var(--rose)" }}>{rejected} rejected ✕</span></>}
        </span>
      </div>
      <div className="sl-cands-body">
        <AnimatePresence mode="popLayout">
          {cs.map((c) => (
            <CandidateDot key={`${st.gen}:${c.name}`} c={c} />
          ))}
        </AnimatePresence>
        {cs.length === 0 && <span className="eyebrow sl-cands-empty">no proposals this generation</span>}
      </div>
      <div className="sl-cands-foot eyebrow">
        the safety gate rejects any candidate that isn't soundness-preserving — a bad operator can only be <b>slower</b>, never <b>wrong</b>
      </div>
    </div>
  );
}

function CandidateDot({ c }: { c: Candidate }) {
  return (
    <motion.div
      className={`sl-cand ${c.safe ? "safe" : "unsafe"}`}
      layout
      initial={{ opacity: 0, scale: 0.6, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      title={`${c.name} · ${c.origin} · ${c.safe ? `${c.sat_calls} sat-calls` : "rejected by safety gate"}`}
    >
      <span className="sl-cand-mark">{c.safe ? "●" : "✕"}</span>
      <span className="sl-cand-name mono">{c.name}</span>
      <span className="sl-cand-v num">{c.safe ? c.sat_calls : "—"}</span>
    </motion.div>
  );
}

/* ============================ operator definition ============================ */
function OperatorCard({ st, resultKind }: { st: SelfLabState; resultKind?: string }) {
  const best = st.best;
  const kind = classifySpec(best.spec, best.origin, resultKind);
  return (
    <div className="sl-op panel">
      <div className="panel-h">
        <span className="eyebrow">best operator · definition</span>
        <span className="sl-op-origin chip">{best.origin}</span>
      </div>
      <div className="sl-op-body">
        <div className="sl-op-name mono">
          <span className="sl-op-crown">◆</span> {best.name}
        </div>
        {kind === "source" ? (
          <CodeBlock source={typeof best.spec === "string" ? best.spec : safeStringify(best.spec)} />
        ) : kind === "weights" ? (
          <Weights spec={best.spec} />
        ) : (
          <pre className="sl-code mono"><code>{safeStringify(best.spec)}</code></pre>
        )}
      </div>
    </div>
  );
}

function Weights({ spec }: { spec: any }) {
  const rows = toWeightRows(spec);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (rows.length === 0) {
    return <pre className="sl-code mono"><code>{safeStringify(spec)}</code></pre>;
  }
  return (
    <div className="sl-weights">
      {rows.map((r) => {
        const pct = (Math.abs(r.value) / max) * 100;
        const neg = r.value < 0;
        return (
          <div className="sl-weight-row" key={r.key}>
            <span className="sl-weight-key mono">{r.key}</span>
            <div className="sl-weight-track">
              <motion.div
                className="sl-weight-fill"
                style={{ background: neg ? "var(--rose)" : "var(--mint)" }}
                initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className="sl-weight-v num">{round(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ============================ narration (learn mode) ============================ */
function Narration({ st, split }: { st: SelfLabState; split: boolean }) {
  const text = narrate(st, split);
  return (
    <motion.div
      className="panel sl-narration"
      key={`${st.gen}:${st.best.sat_calls}`}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
    >
      <span className="eyebrow">what's happening</span>
      <p>{text}</p>
    </motion.div>
  );
}

/* ============================ how-it-works explainer ======================= */
function HowItWorks({ compact }: { compact?: boolean }) {
  return (
    <div className={`panel sl-hiw ${compact ? "compact" : ""}`}>
      <div className="panel-h">
        <span className="eyebrow">how this works</span>
        <span className="chip sl-overlay-chip">⚗ not from the thesis</span>
      </div>
      <ol className="sl-hiw-steps">
        <li><b>propose</b> — seed + mutate operators for one <Term k="forallstep">seam</Term> (a tiny heuristic the planner consults).</li>
        <li><b>gate</b> — a verifiable harness rejects any candidate that isn't <b>soundness-preserving</b>. A bad operator can only ever be <span style={{ color: "var(--mint)" }}>slower</span>, never <span style={{ color: "var(--rose)" }}>wrong</span>.</li>
        <li><b>validate</b> — rank survivors on a <b>held-out</b> set, not the puzzles they were tuned on, so memorised winners are filtered out.</li>
      </ol>
      {!compact && (
        <p className="sl-hiw-foot">
          The reported speed-up is the honest, held-out number — the same discipline Ava’s evaluation uses.
        </p>
      )}
    </div>
  );
}

/* ============================ welcome ============================ */
function Welcome({ mode, busy }: { mode: string; busy: boolean }) {
  return (
    <div className="sl-welcome">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <span className="chip sl-overlay-chip big">⚗ experimental layer · not part of the thesis</span>
        <h2 className="sl-welcome-h">Can search invent<br />better search?</h2>
        <p className="sl-welcome-p">
          Every other module here <em>visualises</em> Ava’s thesis. This one is different — it’s an
          experiment layered <b>on top</b> of her planner. PDR has tiny decision points
          (<span className="hl">seams</span>); here an evolutionary loop invents new heuristics for one
          seam and a verifiable harness proves they stay correct.
        </p>
        <div className="sl-welcome-cols">
          <HowItWorks />
          <div className="sl-welcome-aside">
            <p className="sl-welcome-p sm">
              <b>Why it matters:</b> it’s self-improvement you can <em>trust</em> — the safety gate can’t be
              cheated, and the win is measured on instances the operator never saw.
            </p>
            <p className="sl-welcome-p sm">
              <b>Heads-up:</b> this is the heavy module — it runs the real planner hundreds of times. It
              <b> streams its progress</b> generation by generation, so you watch it work rather than wait
              on a frozen screen. More generations dig deeper (and take longer).
            </p>
            <p className="eyebrow">
              {busy ? "starting the run…"
                : mode === "learn" ? "pick a seam (progression has the most leverage) and press ▶ run"
                  : "pick a seam, keep the held-out split on, and press ▶ run"}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ============================ text ============================ */
function narrate(st: SelfLabState, split: boolean): string {
  const r = ratio(st.baseline, st.best.sat_calls);
  const win = st.best.sat_calls < st.baseline;
  if (st.isFirst) {
    return `Generation ${st.gen}. We seed the archive and start proposing operators for the ${st.seam} seam. The harness runs each one and counts SAT-calls — fewer is better. The hand-designed baseline costs ${st.baseline}.`;
  }
  const rejected = st.candidates.filter((c) => !c.safe).length;
  let s = `Generation ${st.gen}. We proposed ${st.candidates.length} new operator(s)`;
  if (rejected > 0) s += `; the safety gate rejected ${rejected} for not preserving soundness (those can't enter the archive — correctness is non-negotiable)`;
  s += `. `;
  if (split) {
    s += `Crucially we rank survivors on the held-out VALIDATION set, not the puzzles they were tuned on. An operator that merely memorised the training set scores worse here, so overfit winners get filtered out. `;
  }
  if (win) {
    s += `The current champion "${st.best.name}" needs ${st.best.sat_calls} SAT-calls vs the baseline's ${st.baseline} — ${r}× faster, and provably just as correct.`;
  } else {
    s += `So far nothing beats the baseline (${st.baseline}); evolution keeps proposing.`;
  }
  return s;
}

/* ============================ tiny utils ============================ */
function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function safeStringify(v: any): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
