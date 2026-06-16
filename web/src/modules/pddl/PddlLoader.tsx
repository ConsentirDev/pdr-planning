import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { runtime } from "../../lib/runtime/runtime";
import { useTracePlayer } from "../../lib/trace/player";
import { Transport } from "../../lib/ui/Transport";
import { useResizableWidth } from "../../lib/ui/useResizableWidth";
import { Term } from "../../lib/ui/Term";
import type { Ev, Meta, Trace } from "../../lib/trace/types";
import { useMode } from "../../app/App";
// Reuse the Explorer's renderers (incl. the Inspector) to draw classical results identically.
import { Fences } from "../explorer/Fences";
import { WorldView } from "../explorer/WorldView";
import { deriveExplorer } from "../explorer/derive";
import { Inspector, type Inspect } from "../explorer/Inspector";
import { SAMPLES, LOGISTICS, type PddlSample } from "./samples";
import "./pddl.css";

// The PDDL Loader: ingest *real* PDDL text and run the SAME verified solver on
// it (parsing + grounding happen in Pyodide via pdr/pddl.py). Classical → PDR,
// FOND (any "oneof" in the domain) → the FOND solver.
export default function PddlLoader() {
  const { mode } = useMode();
  const [domainText, setDomainText] = useState(LOGISTICS.domain);
  const [problemText, setProblemText] = useState(LOGISTICS.problem);

  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [heavy, setHeavy] = useState(false);

  const isFond = domainText.includes("oneof");
  const onServer = runtime.backend === "server";

  function loadSample(s: PddlSample) {
    setDomainText(s.domain);
    setProblemText(s.problem);
    setHeavy(!!s.heavy);
    setTrace(null);
    setErr(null);
  }

  async function run() {
    setBusy(true);
    setErr(null);
    setTrace(null);
    try {
      const params = { domain_text: domainText, problem_text: problemText };
      // heavy/real instances get a far longer budget (the backend solves them in
      // seconds; pure-Python in-browser is much slower).
      const config = heavy ? { time_limit: 200, max_k: 90, max_events: 120000 }
                           : { time_limit: 30, max_k: 50 };
      const t = isFond
        ? await runtime.run({ module: "fond", domain: "pddl", params, config })
        : await runtime.run({ module: "pdr", domain: "pddl", params, config });
      setTrace(t);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pddl">
      {mode === "learn" && <Explainer isFond={isFond} />}

      {heavy && !onServer && (
        <div className="panel pddl-heavy-note">
          <span className="chip" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>⚡ heavy</span>
          <span>This is a real IPC instance (~1000 ground actions). In the browser
          it runs on the pure-Python solver and can take minutes. For ~15&times; speed,
          start the backend: <code className="mono">uvicorn server.app:app --port 8000</code> — the app auto-connects.</span>
        </div>
      )}

      <div className="panel pddl-samples">
        <span className="eyebrow">load sample</span>
        {SAMPLES.map((s) => (
          <button key={s.key} className="btn ghost pddl-sample-btn" onClick={() => loadSample(s)}>
            <span
              className="pddl-sample-dot"
              style={{
                background: s.kind === "fond" ? "var(--violet)" : s.heavy ? "var(--amber)" : "var(--cyan)",
                boxShadow: `0 0 7px ${s.kind === "fond" ? "var(--violet)" : s.heavy ? "var(--amber)" : "var(--cyan)"}`,
              }}
            />
            {s.label}
          </button>
        ))}
      </div>

      <div className="pddl-editors">
        <Editor
          label="domain"
          sub="actions, predicates, types"
          value={domainText}
          onChange={setDomainText}
          badge={isFond ? "FOND · oneof" : "classical"}
          badgeColor={isFond ? "var(--violet)" : "var(--cyan)"}
        />
        <Editor
          label="problem"
          sub="objects, init, goal"
          value={problemText}
          onChange={setProblemText}
        />
      </div>

      <div className="panel pddl-samples pddl-runrow">
        <span className="chip pddl-mode-chip">
          <span
            className="pddl-sample-dot"
            style={{ background: isFond ? "var(--violet)" : "var(--cyan)" }}
          />
          {isFond ? "FOND solver" : "classical PDR"}
        </span>
        <span className="eyebrow">same solver · parses your PDDL in-browser</span>
        <button className="btn primary pddl-run" onClick={run} disabled={busy}>
          {busy ? "parsing & solving…" : "▶ parse & run"}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {err && (
          <motion.div
            key="err"
            className="panel pddl-err"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="panel-h">
              <span className="eyebrow pddl-err-title">parse / ground failure</span>
              <span className="chip" style={{ color: "var(--rose)" }}>⚠ python</span>
            </div>
            <pre>{err}</pre>
          </motion.div>
        )}

        {!err && trace && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            {isFond ? (
              <FondResultView trace={trace} mode={mode} />
            ) : (
              <ClassicalResultView trace={trace} mode={mode} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// editor pane
// ---------------------------------------------------------------------------
function Editor({
  label,
  sub,
  value,
  onChange,
  badge,
  badgeColor,
}: {
  label: string;
  sub: string;
  value: string;
  onChange: (v: string) => void;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className="panel pddl-pane">
      <div className="panel-h">
        <div className="pddl-pane-tag">
          <span className="eyebrow">{label}</span>
          <span className="pddl-h-sub" style={{ fontSize: 11, color: "var(--tx-3)" }}>
            {sub}
          </span>
        </div>
        {badge && (
          <span className="chip" style={{ color: badgeColor, borderColor: badgeColor }}>
            {badge}
          </span>
        )}
      </div>
      <textarea
        className="pddl-ta"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`(define (${label} …) …)`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// classical result — reuse the Explorer renderers
// ---------------------------------------------------------------------------
function ClassicalResultView({ trace, mode }: { trace: Trace; mode: string }) {
  const meta = trace.meta as Meta;
  const events = (trace.events ?? []) as Ev[];
  const player = useTracePlayer(events.length, { speed: mode === "learn" ? 1.8 : 6, autoplay: true });
  const st = deriveExplorer(meta, events, player.cursor);
  const result = trace.result;
  const solvable: boolean | null = result?.solvable ?? null;
  const planLen = result?.plan?.length ?? (st.plan ? st.plan.length : 0);
  const curEvent = player.cursor >= 0 ? events[player.cursor] : null;
  const [inspect, setInspect] = useState<Inspect>({ kind: "encoding" });
  const { width: sideW, startDrag } = useResizableWidth("pddl-side-w", 340);

  return (
    <div className="pddl-result">
      <div className="panel pddl-resbar">
        <ResStat k="propositions" v={meta.props.length} accent="cyan" />
        <ResStat k="ground actions" v={meta.actions.length} accent="cyan" />
        <ResStat
          k="solvable"
          v={solvable === null ? "?" : solvable ? "yes" : "no"}
          accent={solvable ? "mint" : solvable === false ? "rose" : undefined}
        />
        <ResStat k="plan length" v={planLen} accent="mint" />
        <span className="chip" style={{ marginLeft: "auto" }}>{meta.name}</span>
      </div>

      <div className="pddl-main" style={{ gridTemplateColumns: `1fr ${sideW}px` }}>
        <div className="panel pddl-fences">
          <div className="panel-h">
            <span className="eyebrow">the fences — click a fence, ⚡ reason, or the processing state to inspect</span>
          </div>
          <div className="pddl-fences-body">
            <Fences meta={meta} st={st} onInspect={setInspect} selected={inspect} />
          </div>
        </div>

        <div className="pddl-side">
          <div className="pane-resize" onMouseDown={startDrag} title="drag to resize" />
          <div className="panel pddl-world">
            <div className="panel-h">
              <span className="eyebrow">world · state under inspection</span>
            </div>
            <WorldView meta={meta} state={st.current?.state ?? meta.init} />
          </div>
          <Inspector meta={meta} st={st} result={trace.result} target={inspect} onPick={setInspect} />
          {mode === "lab" && <LabStats trace={trace} />}
        </div>
      </div>

      <Transport player={player} label={curEvent ? curEvent.t : "ready"} />
    </div>
  );
}

function ResStat({ k, v, accent }: { k: string; v: any; accent?: string }) {
  const c =
    accent === "mint" ? "var(--mint)" :
    accent === "cyan" ? "var(--cyan)" :
    accent === "rose" ? "var(--rose)" :
    "var(--tx)";
  return (
    <span className="pddl-stat">
      <span className="eyebrow">{k}</span>
      <b style={{ color: c }}>{v}</b>
    </span>
  );
}

// ---------------------------------------------------------------------------
// FOND result — compact summary; the full AND/OR graph lives in another module
// ---------------------------------------------------------------------------
function FondResultView({ trace, mode }: { trace: Trace; mode: string }) {
  const meta = trace.meta as Meta;
  const result = trace.result;
  const hasPolicy: boolean | null = result?.has_policy ?? null;
  const stats = result?.stats ?? {};

  return (
    <div className="panel pddl-fond">
      <div className="pddl-fond-verdict">
        <span className={`pddl-fond-badge ${hasPolicy ? "yes" : "no"}`}>
          {hasPolicy ? "◆ policy found" : "no policy"}
        </span>
        <span className="eyebrow">{meta?.name ?? "fond-problem"} · strong-cyclic FOND</span>
      </div>

      <div className="pddl-fond-stats num">
        <ResStat k="k" v={stats.k ?? "—"} accent="cyan" />
        <ResStat k="states" v={stats.states ?? "—"} accent="cyan" />
        <ResStat k="decided by" v={stats.decided_by ?? "—"} accent={hasPolicy ? "mint" : "rose"} />
        {meta && <ResStat k="propositions" v={meta.props.length} />}
        {meta && <ResStat k="ground actions" v={meta.actions.length} />}
      </div>

      <p className="pddl-fond-note">
        This is a FOND problem (actions have non-deterministic <code>oneof</code> outcomes). The same
        solver builds a contingent <span className="hl">policy</span> rather than a linear plan — open
        the <span className="hl">FOND Policies</span> module for the full AND/OR graph.
      </p>

      {mode === "lab" && <LabStats trace={trace} bare />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// lab-only: raw parsed stats + copy-trace affordance
// ---------------------------------------------------------------------------
function LabStats({ trace, bare }: { trace: Trace; bare?: boolean }) {
  const [copied, setCopied] = useState(false);
  const meta = trace.meta as Meta | undefined;
  const stats = trace.result?.stats ?? {};

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  const body = (
    <>
      <div className="panel-h" style={bare ? { display: "none" } : undefined}>
        <span className="eyebrow">raw parsed stats</span>
      </div>
      <div className="pddl-lab-grid">
        {meta && <ResStat k="kind" v={meta.kind} />}
        {meta && <ResStat k="render" v={meta.render} />}
        {Object.entries(stats).map(([k, v]) => (
          <ResStat key={k} k={k} v={String(v)} accent="cyan" />
        ))}
      </div>
      <button className="btn ghost pddl-copy" onClick={copy}>
        {copied ? "✓ copied" : "⧉ copy trace JSON"}
      </button>
    </>
  );

  if (bare) return <div className="pddl-lab-grid-wrap">{body}</div>;
  return <div className="panel pddl-lab">{body}</div>;
}

// ---------------------------------------------------------------------------
// learn-mode explainer
// ---------------------------------------------------------------------------
function Explainer({ isFond }: { isFond: boolean }) {
  return (
    <motion.div
      className="panel pddl-explain"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>Feed it real PDDL.</h2>
      <p>
        <span className="hl">PDDL</span> is the standard text format for planning problems — the
        format the IPC benchmarks and the thesis use. A <code>domain</code> declares predicates and
        action schemas; a <code>problem</code> lists the objects, the initial state and the goal.
      </p>
      <p>
        This is the <em>same verified solver</em> you saw in the Explorer — only now it parses and{" "}
        <Term k="grounding"><span className="hl">grounds</span></Term> <em>your</em> problem (the PDDL
        front-end runs in Python, in your browser). If any action uses a non-deterministic{" "}
        <code>oneof</code> effect it's a <span className="hl">FOND</span> problem and routes to the
        FOND solver; otherwise classical <Term k="pdr"><span className="hl">PDR</span></Term> searches
        backward from the goal. Once it runs, click any fence or ⚡ reason to inspect the real clauses.
        {isFond ? " (Your domain has oneof — this will run FOND.)" : ""}
      </p>
    </motion.div>
  );
}
