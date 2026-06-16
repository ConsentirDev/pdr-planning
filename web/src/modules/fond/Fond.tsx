import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { runtime } from "../../lib/runtime/runtime";
import { useTracePlayer } from "../../lib/trace/player";
import { Transport } from "../../lib/ui/Transport";
import { NarrationFeed, buildBeats, useGuidedNarration } from "../../lib/ui/NarrationFeed";
import type { Ev, Lit, Meta, Trace } from "../../lib/trace/types";
import { useMode } from "../../app/App";
import { deriveFond, type FondState } from "./derive";
import { GraphView } from "./GraphView";
import { FondWorld } from "./FondWorld";
import "./fond.css";

type Domain = "clumsy" | "escher" | "clumsy_thesis" | "tireworld" | "faults"
  | "islands" | "first_responders" | "earthobs";

const DOMAINS: { id: Domain; label: string; blurb: string; tone: string }[] = [
  { id: "clumsy", label: "Clumsy gripper", blurb: "policy exists", tone: "mint" },
  { id: "tireworld", label: "Triangle-Tireworld", blurb: "drive around blow-outs", tone: "cyan" },
  { id: "earthobs", label: "Earth-Observation 🛰", blurb: "satellite images patches", tone: "cyan" },
  { id: "islands", label: "Islands", blurb: "bridge it or swim it", tone: "cyan" },
  { id: "first_responders", label: "First-Responders", blurb: "fire, then rescue", tone: "cyan" },
  { id: "faults", label: "Faults", blurb: "retry through failures", tone: "cyan" },
  { id: "escher", label: "Escher", blurb: "impossible — no policy", tone: "rose" },
  { id: "clumsy_thesis", label: "Clumsy (3-block thesis)", blurb: "the thesis example", tone: "cyan" },
];

// which domains take a size slider, and what it controls
const SCALE: Record<Domain, { label: string; min: number; max: number } | null> = {
  clumsy: { label: "blocks", min: 2, max: 3 },
  escher: { label: "blocks", min: 2, max: 3 },
  faults: { label: "components", min: 2, max: 3 },
  clumsy_thesis: null,
  tireworld: null,
  islands: null,
  first_responders: null,
  earthobs: null,
};

export default function Fond() {
  const { mode } = useMode();
  const [domain, setDomain] = useState<Domain>("clumsy");
  const [blocks, setBlocks] = useState(3);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const events = (trace?.events ?? []) as Ev[];
  const meta = trace?.meta as Meta | undefined;
  // Learn mode is narration-paced (clock off); Lab runs on the fast clock.
  const guided = mode === "learn";
  const [voiceOn, setVoiceOn] = useState(false);
  const player = useTracePlayer(events.length, { speed: 5, autoplay: true, clock: !guided });

  const st = useMemo(
    () => (meta ? deriveFond(meta, events, player.cursor) : null),
    [meta, events, player.cursor]
  );
  const curEvent = player.cursor >= 0 ? events[player.cursor] : null;
  const beats = useMemo(
    () => (meta && st ? buildBeats(events, player.cursor, (ev) => narrate(meta, ev, st)) : []),
    [meta, events, player.cursor, st]
  );
  const currentBeat = meta && st && curEvent ? narrate(meta, curEvent, st) : null;
  useGuidedNarration({
    enabled: guided && player.playing, cursor: player.cursor, total: events.length,
    text: currentBeat, voiceOn, advance: player.advance,
  });
  // the state currently under inspection — drives the big hero world panel
  const focusLits = useMemo<Lit[] | null>(() => {
    if (!meta) return null;
    const e = curEvent as { state?: Lit[] } | null;
    return e && Array.isArray(e.state) ? e.state : meta.init;
  }, [meta, curEvent]);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const t = await runtime.run({ module: "fond", domain, params: { blocks, comps: blocks } });
      setTrace(t);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const result = trace?.result;
  const dirty = domain === "escher"; // escher proves impossibility

  return (
    <div className="fond">
      <div className="fond-controls panel">
        <div className="fond-ctl-row">
          <Field label="domain">
            <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
              {DOMAINS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.blurb}
                </option>
              ))}
            </select>
          </Field>
          {SCALE[domain] && (
            <Slider label={SCALE[domain]!.label} v={blocks} set={setBlocks}
                    min={SCALE[domain]!.min} max={SCALE[domain]!.max} />
          )}
          <button className="btn primary fond-run" onClick={run} disabled={busy}>
            {busy ? "running…" : "▶ run"}
          </button>
        </div>
        {err && <div className="fond-err mono">{err}</div>}
      </div>

      {!st || !meta ? (
        <Welcome mode={mode} busy={busy} />
      ) : (
        <div className="fond-main">
          <div className="fond-graph panel">
            <div className="panel-h">
              <div>
                <span className="eyebrow">the AND/OR graph</span>
                <span className="fond-h-sub">
                  states · actions branch into the outcomes nature can pick
                </span>
              </div>
              <Stats st={st} result={result} mode={mode} />
            </div>
            <div className="fond-graph-body">
              <GraphView meta={meta} st={st} />
              <Legend />
            </div>
            <Verdict st={st} dirty={dirty} />
          </div>

          <div className="fond-side">
            <div className="panel fond-world-panel">
              <div className="panel-h"><span className="eyebrow">world · state under inspection</span></div>
              <FondWorld meta={meta} lits={focusLits} />
            </div>
            {mode === "learn" && (
              <NarrationFeed lines={beats} accent="violet" voiceOn={voiceOn}
                onToggleVoice={() => setVoiceOn((v) => !v)} narrating={player.playing} />
            )}
            <PolicyPanel st={st} meta={meta} mode={mode} />
          </div>
        </div>
      )}

      {st && (
        <Transport player={player} label={curEvent ? labelFor(curEvent) : "ready"} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Welcome({ mode, busy }: { mode: string; busy: boolean }) {
  return (
    <div className="fond-welcome">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="fond-welcome-glyph">◍ ⋔ ▣ ⋔ ◍</div>
        <h2>Plan when the world rolls dice.</h2>
        <p className="fond-welcome-p">
          In <em>nondeterministic</em> planning an action has several possible
          outcomes and <span className="hl">nature</span> chooses which happens —
          a clumsy gripper sometimes drops the block. A solution isn't a straight
          line of moves; it's a <span className="hl">strong-cyclic policy</span>:
          a rule for every situation that, under fairness, always{" "}
          <em>eventually</em> wins no matter how the dice fall. FOND-PDR grows an
          AND/OR graph and runs a sink-removal generator until the start is solved
          — or proves no policy can exist.
        </p>
        <p className="eyebrow">
          {busy ? "booting python in your browser…" : "pick a domain and press ▶ run"}
        </p>
        {mode === "lab" && (
          <p className="fond-welcome-note mono">
            clumsy = solvable · escher = provably impossible · clumsy_thesis = 3-block case
          </p>
        )}
      </motion.div>
    </div>
  );
}

function Stats({
  st,
  result,
  mode,
}: {
  st: FondState;
  result: any;
  mode: string;
}) {
  return (
    <div className="fond-stats num">
      <Stat k="k" v={st.k} />
      <Stat k="states" v={st.nodes.size} accent="cyan" />
      <Stat k="arcs" v={st.arcs.length} accent="cyan" />
      {st.solved.size > 0 && <Stat k="solved" v={st.solved.size} accent="mint" />}
      {mode === "lab" && st.reasonCount > 0 && (
        <Stat k="dead-ends" v={st.deadends.size} accent="amber" />
      )}
      {mode === "lab" && result?.stats?.decided_by && (
        <span className="chip" title="how the verdict was reached">
          {result.stats.decided_by}
        </span>
      )}
    </div>
  );
}
function Stat({ k, v, accent }: { k: string; v: any; accent?: string }) {
  const c =
    accent === "amber"
      ? "var(--amber)"
      : accent === "cyan"
      ? "var(--cyan)"
      : accent === "mint"
      ? "var(--mint)"
      : "var(--tx)";
  return (
    <span className="fond-stat">
      <span className="eyebrow">{k}</span>
      <b style={{ color: c }}>{v}</b>
    </span>
  );
}

function Legend() {
  return (
    <div className="fond-legend">
      <span className="lg"><i className="lg-sw init" /> init</span>
      <span className="lg"><i className="lg-sw goal" /> goal outcome</span>
      <span className="lg"><i className="lg-sw solved" /> solved (has a policy)</span>
      <span className="lg"><i className="lg-sw dim" /> not yet solved</span>
      <span className="lg"><i className="lg-sw chosen" /> policy action</span>
    </div>
  );
}

function Verdict({ st, dirty }: { st: FondState; dirty: boolean }) {
  if (!st.outcome) {
    if (st.hasInit) {
      return (
        <motion.div
          className="fond-verdict pending"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="num">init now covered — closing the policy…</span>
        </motion.div>
      );
    }
    return null;
  }
  if (st.outcome === "win") {
    return (
      <motion.div
        className="fond-verdict win"
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
      >
        <span className="fv-mark">◍</span>
        <div>
          <b>STRONG-CYCLIC POLICY FOUND</b>
          <p>
            Under fairness you always <em>eventually</em> win — whatever nature
            rolls, every chosen action leads back toward the goal.
            {st.policyStates != null && (
              <span className="num"> {st.policyStates} states in the policy.</span>
            )}
          </p>
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div
      className="fond-verdict lose"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 20 }}
    >
      <span className="fv-mark">⦸</span>
      <div>
        <b>NO POLICY EXISTS — proved</b>
        <p>
          {dirty ? "Escher's goal is unreachable for sure: " : ""}
          proved by <span className="hl">forward-push layer convergence</span> at
          k={st.noPolicyK} — two horizons agreed nothing new can ever become
          solvable, so no strong-cyclic policy can exist. The solver{" "}
          <em>never had to try every plan</em>.
        </p>
      </div>
    </motion.div>
  );
}

function PolicyPanel({
  st,
  meta,
  mode,
}: {
  st: FondState;
  meta: Meta;
  mode: string;
}) {
  const entries = [...st.policy.entries()];
  return (
    <div className="panel fond-policy">
      <div className="panel-h">
        <span className="eyebrow">the policy · action chosen per solved state</span>
        {st.hasInit && <span className="chip fond-chip-init">covers init ✓</span>}
      </div>
      <div className="fond-policy-body">
        {entries.length === 0 ? (
          <div className="fond-policy-empty eyebrow">
            no states solved yet — the generator removes "sink" states (those that
            can't reach the goal) and keeps what survives
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {entries.map(([key, action]) => {
              const node = st.nodes.get(key);
              const isInit = key === st.initKey;
              return (
                <motion.div
                  className={`fond-prow ${isInit ? "init" : ""}`}
                  key={key}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="fond-prow-state mono">
                    {isInit ? "INIT" : node ? `s${node.order}` : "state"}
                  </span>
                  <span className="fond-prow-arrow">→</span>
                  <span className="fond-prow-act mono">{action}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
        {mode === "lab" && st.decidedBy && (
          <div className="fond-policy-foot eyebrow">decided by · {st.decidedBy}</div>
        )}
      </div>
    </div>
  );
}

// ---- text -----------------------------------------------------------------
function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="fond-field">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}
function Slider({
  label,
  v,
  set,
  min,
  max,
}: {
  label: string;
  v: number;
  set: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="fond-field">
      <span className="eyebrow">
        {label} <b className="num">{v}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={v}
        onChange={(e) => set(parseInt(e.target.value, 10))}
      />
    </label>
  );
}

function labelFor(ev: Ev): string {
  switch (ev.t) {
    case "k":
      return `widen horizon → k=${ev.k}`;
    case "arc": {
      const n = ev.outcomes.length;
      return `discover ${ev.action} → ${n} outcome${n > 1 ? "s" : ""}`;
    }
    case "reason":
      return `learn dead-end @ layer ${ev.layer}`;
    case "policy":
      return `policy snapshot · ${ev.solved.length} solved`;
    case "no_policy":
      return `proved: no policy (${ev.by})`;
    case "has_policy":
      return `✓ strong-cyclic policy (${ev.states} states)`;
    default:
      return ev.t;
  }
}

function narrate(meta: Meta, ev: Ev | null, st: FondState): string {
  if (!ev)
    return "Press play. We'll grow an AND/OR graph: state nodes, and action boxes that fan out into every outcome nature might pick.";
  switch (ev.t) {
    case "k":
      return `Widening the horizon to k=${ev.k}: FOND-PDR lets itself look one more layer deep when searching for a policy.`;
    case "arc": {
      const n = ev.outcomes.length;
      const goals = ev.is_goal?.filter(Boolean).length ?? 0;
      if (n === 1)
        return `Doing "${ev.action}" here has a single, certain outcome — a deterministic move on the graph.`;
      return `Doing "${ev.action}" is nondeterministic: nature picks ONE of ${n} outcomes (the ⋔ branch).${
        goals ? ` ${goals} of them already satisfies the goal (mint).` : ""
      } A policy must cope with all of them.`;
    }
    case "reason":
      return `With the information so far, the solver can't yet show "${facts(meta, ev.state)}" is always able to reach the goal — so it's set aside as not-yet-solved (it may still become solvable as the search continues; it is not a permanent dead-end).`;
    case "policy": {
      if (ev.has_init)
        return `The policy generator now knows ${ev.solved.length} states are SOLVED — have a strong-cyclic policy (mint) — and the start is among them. We're closing in.`;
      return `Sink removal: starting from the goal states and assuming the rest solved, the generator prunes any state that can be driven to a sink — leaving ${ev.solved.length} states KNOWN to be solvable (mint), the rest still unknown. Each solved state gets the action that keeps it safe.`;
    }
    case "no_policy":
      return `Proved impossible. A forward push converged at k=${ev.k}: two horizons agreed no new state can ever become solvable. No strong-cyclic policy exists — and we proved it without enumerating every plan.`;
    case "has_policy":
      return `Done. A strong-cyclic policy covers the start: across ${ev.states} states, every chosen action eventually drives you to the goal no matter how the dice land. Under fairness, you always win.`;
    default:
      return "…";
  }
}

function facts(meta: Meta, state: number[]): string {
  return (
    state
      .filter((l) => l > 0)
      .map((l) => meta.props[Math.abs(l) - 1])
      .slice(0, 3)
      .join(", ") || "∅"
  );
}
