import type { Lit, Meta } from "../../lib/trace/types";
import { Term } from "../../lib/ui/Term";
import type { ExplorerState } from "./derive";
import "./inspector.css";

export type Inspect =
  | { kind: "encoding" }
  | { kind: "fence"; i: number }
  | { kind: "reason"; cube: Lit[] }
  | { kind: "obligation" };

// the inspector is the rigorous view — show the FULL ground atom, e.g. atp(P0,L2)
function atom(meta: Meta, l: Lit) { return meta.props[Math.abs(l) - 1] ?? `?${l}`; }

// render a list of signed literals as chips (¬ for negatives)
function Lits({ meta, lits, asClause }: { meta: Meta; lits: Lit[]; asClause?: boolean }) {
  if (!lits.length) return <span className="insp-empty">∅ (empty)</span>;
  return (
    <span className="insp-lits">
      {lits.map((l, i) => (
        <span key={i} className={`insp-lit ${l > 0 ? "pos" : "neg"}`}>
          {l < 0 && <span className="insp-not">¬</span>}{atom(meta, l)}
          {asClause && i < lits.length - 1 && <span className="insp-op"> ∨ </span>}
          {!asClause && i < lits.length - 1 && <span className="insp-op"> ∧ </span>}
        </span>
      ))}
    </span>
  );
}

export function Inspector({
  meta, st, result, target, onPick,
}: {
  meta: Meta; st: ExplorerState; result: any;
  target: Inspect; onPick: (t: Inspect) => void;
}) {
  return (
    <div className="panel insp">
      <div className="insp-h">
        <span className="eyebrow">inspector · the real machinery</span>
        <div className="insp-tabs">
          {([["encoding", "encoding"], ["obligation", "SAT call"]] as const).map(([k, label]) => (
            <button key={k} className={`insp-tab ${target.kind === k ? "on" : ""}`}
              onClick={() => onPick({ kind: k } as Inspect)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="insp-body">
        {target.kind === "encoding" && <Encoding meta={meta} st={st} result={result} />}
        {target.kind === "fence" && <Fence meta={meta} st={st} i={target.i} />}
        {target.kind === "reason" && <Reason meta={meta} st={st} cube={target.cube} />}
        {target.kind === "obligation" && <Obligation meta={meta} st={st} onPick={onPick} />}
      </div>

      <div className="insp-foot eyebrow">
        click any <b>fence</b>, <b>⚡ reason</b>, or the <b>processing</b> state to inspect its real clauses
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: any }) {
  return <span className="insp-stat"><b className="num">{v}</b><span className="eyebrow">{k}</span></span>;
}

function Encoding({ meta, st, result }: { meta: Meta; st: ExplorerState; result: any }) {
  // pick a representative ground action to show "as encoded"
  const a = meta.actions[0];
  const sat = result?.stats?.sat_calls;
  return (
    <>
      <p className="insp-lede">
        Every step is a genuine <Term k="sat">SAT query</Term> on the thesis’s{" "}
        <Term k="forallstep">∀-step encoding</Term> — no animation tricks. The solver is
        real (lingeling / pure-Python DPLL).
      </p>
      <div className="insp-grid">
        <Stat k="boolean vars" v={meta.props.length} />
        <Stat k="ground actions" v={meta.actions.length} />
        <Stat k="reasons learned" v={st.reasons} />
        {sat != null && <Stat k="SAT calls" v={sat} />}
      </div>

      <div className="insp-card">
        <div className="insp-card-h">the query at layer <span className="mono">i</span></div>
        <p className="insp-math">
          ∃ a <Term k="forallstep">∀-step</Term> transition <span className="mono">S → S′</span> with{" "}
          <span className="mono">S′ ⊨ F<sub>i−1</sub></span>?
        </p>
        <ul className="insp-clauses">
          <li><b>target</b> — the next <Term k="fence">fence</Term> <span className="mono">F<sub>i−1</sub></span>’s clauses must hold in <span className="mono">S′</span></li>
          <li><Term k="frame">frame axioms</Term> — a fluent keeps its value unless an action changes it</li>
          <li><Term k="forallstep">∀-step mutex</Term> — no two interfering actions in one step</li>
          <li><b>action laws</b> — each action implies its precondition (before) &amp; effect (after)</li>
        </ul>
      </div>

      {a && (
        <div className="insp-card">
          <div className="insp-card-h">one action, as encoded · <span className="mono">{a.name}</span></div>
          <div className="insp-row"><span className="insp-tag">pre</span><Lits meta={meta} lits={a.pre} /></div>
          <div className="insp-row"><span className="insp-tag">eff</span><Lits meta={meta} lits={a.eff ?? []} /></div>
          <p className="insp-note">becomes clauses: <span className="mono">act → pre(before)</span> and{" "}
            <span className="mono">act → eff(after)</span>, conjoined over all {meta.actions.length} ground actions.</p>
        </div>
      )}
    </>
  );
}

function Fence({ meta, st, i }: { meta: Meta; st: ExplorerState; i: number }) {
  const clauses = st.layers[i] ?? [];
  return (
    <>
      <p className="insp-lede">
        <b className="mono">F{i}</b> — the <Term k="fence">fence</Term> for states ≤ <b>{i}</b>{" "}
        step{i === 1 ? "" : "s"} from the goal{i === 0 ? " (the goal itself)" : ""}. It holds{" "}
        <b>{clauses.length}</b> learned <Term k="clause">clause{clauses.length === 1 ? "" : "s"}</Term>;
        a state is admitted only if it satisfies all of them.
      </p>
      {clauses.length === 0
        ? <p className="insp-note">No clauses yet — this fence is still wide open.</p>
        : <div className="insp-clauselist">
            {clauses.slice(0, 24).map((cube, j) => (
              <div key={j} className="insp-clause-row">
                <span className="insp-clause-i num">¬cₖ{j}</span>
                <Lits meta={meta} lits={cube.map((l) => -l)} asClause />
              </div>
            ))}
            {clauses.length > 24 && <div className="insp-note">+{clauses.length - 24} more…</div>}
          </div>}
    </>
  );
}

function Reason({ meta, st, cube }: { meta: Meta; st: ExplorerState; cube: Lit[] }) {
  const key = cube.join(",");
  const inLayers = st.layers.map((cs, i) => (cs.some((c) => c.join(",") === key) ? i : -1)).filter((i) => i >= 0);
  const upto = inLayers.length ? Math.max(...inLayers) : 0;
  return (
    <>
      <p className="insp-lede">
        A <Term k="reason">learned reason</Term>: a region of states <b>proven unable</b> to reach
        the goal within {upto} step{upto === 1 ? "" : "s"}.
      </p>
      <div className="insp-card">
        <div className="insp-card-h">blocked cube (the dead-end)</div>
        <Lits meta={meta} lits={cube} />
      </div>
      <div className="insp-card">
        <div className="insp-card-h">clause added to the fences</div>
        <Lits meta={meta} lits={cube.map((l) => -l)} asClause />
        <p className="insp-note">pushed into <span className="mono">F0 … F{upto}</span> — every state matching
          the cube is now excluded, so PDR never re-examines it. (<Term k="push">clause pushing</Term>
          {" "}carries it further as the frames grow.)</p>
      </div>
    </>
  );
}

function Obligation({ meta, st, onPick }: { meta: Meta; st: ExplorerState; onPick: (t: Inspect) => void }) {
  const o = st.current;
  if (!o) return <p className="insp-note">No obligation is being processed at this step. Press play, or step to a{" "}
    <span className="mono">pop</span> event.</p>;
  const trues = new Set(o.state.filter((l) => l > 0).map((l) => Math.abs(l)));
  // ground actions whose positive preconditions the obligation state satisfies
  const applicable = meta.actions.filter((a) =>
    a.pre.every((l) => (l > 0 ? trues.has(Math.abs(l)) : !trues.has(Math.abs(l))))).slice(0, 6);
  return (
    <>
      <p className="insp-lede">
        A <Term k="sat">SAT query</Term> for the <Term k="obligation">obligation</Term> at{" "}
        <b className="mono">L{o.layer}</b>: can this state step one <Term k="fence">fence</Term> closer
        (into <span className="mono">F{o.layer - 1}</span>)? Yes → <b>progress</b>; no → <b>learn a reason</b>.
      </p>
      <div className="insp-card">
        <div className="insp-card-h">state under inspection</div>
        <Lits meta={meta} lits={o.state.filter((l) => l > 0)} />
      </div>
      <div className="insp-card">
        <div className="insp-card-h">{applicable.length} applicable action{applicable.length === 1 ? "" : "s"} (real, from the grounding)</div>
        {applicable.length === 0
          ? <p className="insp-note">none directly applicable — the solver looks for a ∀-step combination.</p>
          : <div className="insp-acts">{applicable.map((a) => <span key={a.name} className="insp-act mono">{a.name}</span>)}</div>}
      </div>
      <button className="insp-link" onClick={() => onPick({ kind: "encoding" })}>↳ see how this becomes a SAT formula</button>
    </>
  );
}
