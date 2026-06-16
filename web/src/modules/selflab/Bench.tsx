import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { runtime } from "../../lib/runtime/runtime";
import { Term } from "../../lib/ui/Term";
import { LAB, PROBLEM_SETS, type EvalResult } from "./lab-catalog";
import { ratio } from "./derive";
import "./bench.css";

type Kind = "operator" | "run";
interface BenchItem {
  id: number; kind: Kind; label: string; seam: string; problemSet: string;
  status: "running" | "done" | "error";
  result?: EvalResult; ratioToBase?: string; champion?: string; runGen?: string; error?: string;
}

const SAMPLE_PDDL = {
  domain: `(define (domain logistics)
 (:requirements :strips :typing :equality)
 (:types loc pkg truck)
 (:predicates (atp ?p - pkg ?l - loc) (att ?t - truck ?l - loc) (inn ?p - pkg ?t - truck))
 (:action drive :parameters (?t - truck ?from - loc ?to - loc)
   :precondition (and (att ?t ?from) (not (= ?from ?to)))
   :effect (and (not (att ?t ?from)) (att ?t ?to)))
 (:action load :parameters (?t - truck ?p - pkg ?l - loc)
   :precondition (and (atp ?p ?l) (att ?t ?l)) :effect (and (not (atp ?p ?l)) (inn ?p ?t)))
 (:action unload :parameters (?t - truck ?p - pkg ?l - loc)
   :precondition (and (inn ?p ?t) (att ?t ?l)) :effect (and (atp ?p ?l) (not (inn ?p ?t)))))`,
  problem: `(define (problem log1) (:domain logistics)
 (:objects p0 p1 - pkg l0 l1 l2 - loc t0 - truck)
 (:init (atp p0 l0) (atp p1 l0) (att t0 l0))
 (:goal (and (atp p0 l2) (atp p1 l2))))`,
};

let SEQ = 0;

export function Bench() {
  const [seam, setSeam] = useState("progression");
  const [problemSet, setProblemSet] = useState("curriculum");
  const [pddl, setPddl] = useState(SAMPLE_PDDL);
  const [cfgType, setCfgType] = useState<Kind>("operator");
  // operator config
  const [opMode, setOpMode] = useState<"preset" | "custom">("preset");
  const [preset, setPreset] = useState(LAB.seams.progression.presets.slice(-1)[0]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  // run config
  const [generations, setGenerations] = useState(3);
  const [split, setSplit] = useState(true);

  const [queue, setQueue] = useState<BenchItem[]>([]);
  const [picked, setPicked] = useState<number[]>([]);

  const keys = LAB.seams[seam]?.keys ?? [];
  const presets = LAB.seams[seam]?.presets ?? [];

  function setSeamSafe(s: string) {
    setSeam(s);
    setPreset(LAB.seams[s].presets.slice(-1)[0]);
    setWeights({});
  }
  function update(id: number, patch: Partial<BenchItem>) {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function add() {
    const id = ++SEQ;
    const pddlCfg = problemSet === "pddl" ? { domain_text: pddl.domain, problem_text: pddl.problem } : {};
    if (cfgType === "operator") {
      const opCfg = opMode === "preset"
        ? { preset }
        : { weights: Object.fromEntries(keys.map((k) => [k, weights[k] ?? 0])), name: "custom" };
      const label = opMode === "preset" ? preset : `custom(${keys.map((k) => (weights[k] ?? 0)).join(",")})`;
      setQueue((q) => [{ id, kind: "operator", label, seam, problemSet, status: "running" }, ...q]);
      try {
        const t: any = await runtime.run({ module: "evaluate", seam, config: { ...opCfg, ...pddlCfg, problem_set: problemSet, time_limit: 4 } });
        const r = t.result as EvalResult;
        update(id, { status: "done", result: r, ratioToBase: ratio(r.baseline_sat, r.sat_calls) });
      } catch (e: any) { update(id, { status: "error", error: String(e?.message || e) }); }
    } else {
      const label = `evolve · ${generations}gen${split ? " · split" : ""}`;
      setQueue((q) => [{ id, kind: "run", label, seam, problemSet, status: "running" }, ...q]);
      try {
        const t: any = await runtime.runStream(
          { module: "evolve", seam, config: { split, generations } },
          (ev) => update(id, { runGen: `gen ${ev.gen + 1}/${ev.total_gens ?? generations}` }));
        const best = t.result.best;
        // re-evaluate the champion for a per-instance breakdown (same as operator items)
        const champCfg = best.kind === "source" ? { source: best.spec } : { weights: best.spec, name: best.name };
        const ev: any = await runtime.run({ module: "evaluate", seam, config: { ...champCfg, ...pddlCfg, problem_set: problemSet, time_limit: 4 } });
        const r = ev.result as EvalResult;
        update(id, { status: "done", result: r, champion: best.name, ratioToBase: ratio(r.baseline_sat, r.sat_calls) });
      } catch (e: any) { update(id, { status: "error", error: String(e?.message || e) }); }
    }
  }

  function togglePick(id: number) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2));
  }

  const a = queue.find((i) => i.id === picked[0]);
  const b = queue.find((i) => i.id === picked[1]);

  return (
    <div className="bench">
      <div className="bench-build panel">
        <div className="panel-h"><span className="eyebrow">bench · build a configuration to queue</span>
          <span className="chip sl-overlay-chip">deep-dive · researcher mode</span></div>

        <div className="bench-row">
          <Field label="seam">
            <select value={seam} onChange={(e) => setSeamSafe(e.target.value)}>
              {Object.keys(LAB.seams).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="problem set">
            <select value={problemSet} onChange={(e) => setProblemSet(e.target.value)}>
              {PROBLEM_SETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="what to queue">
            <div className="bench-seg">
              {(["operator", "run"] as Kind[]).map((t) => (
                <button key={t} className={cfgType === t ? "on" : ""} onClick={() => setCfgType(t)}>
                  {t === "operator" ? "operator" : "evolution run"}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {problemSet === "pddl" && (
          <div className="bench-pddl">
            <textarea value={pddl.domain} onChange={(e) => setPddl({ ...pddl, domain: e.target.value })} spellCheck={false} />
            <textarea value={pddl.problem} onChange={(e) => setPddl({ ...pddl, problem: e.target.value })} spellCheck={false} />
          </div>
        )}

        {cfgType === "operator" ? (
          <div className="bench-op">
            <div className="bench-seg sm">
              {(["preset", "custom"] as const).map((m) => (
                <button key={m} className={opMode === m ? "on" : ""} onClick={() => setOpMode(m)}>{m === "preset" ? "a preset" : "custom weights"}</button>
              ))}
            </div>
            {opMode === "preset" ? (
              <Field label="preset operator">
                <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {presets.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            ) : (
              <div className="bench-weights">
                {keys.map((k) => (
                  <label className="bench-wrow" key={k}>
                    <span className="mono bench-wk">{k}</span>
                    <input type="range" min={-3} max={3} step={0.1} value={weights[k] ?? 0}
                      onChange={(e) => setWeights({ ...weights, [k]: parseFloat(e.target.value) })} />
                    <span className="num bench-wv">{(weights[k] ?? 0).toFixed(1)}</span>
                  </label>
                ))}
                <p className="bench-hint">score = Σ weightₖ · featureₖ. <Term k="forallstep">progression</Term> chooses look-ahead depth; bigger bias ≈ deeper (PDR-M).</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bench-op bench-runcfg">
            <Field label={`generations ${generations}`}>
              <input type="range" min={2} max={6} value={generations} onChange={(e) => setGenerations(parseInt(e.target.value, 10))} />
            </Field>
            <button className={`sl-toggle ${split ? "on" : ""}`} onClick={() => setSplit(!split)}>
              <span className="eyebrow">held-out split</span><span className="sl-toggle-dot" />
            </button>
          </div>
        )}

        <button className="btn primary bench-add" onClick={add}>+ evaluate &amp; add to queue</button>
      </div>

      {a && b && a.result && b.result && <Compare a={a} b={b} />}

      <div className="bench-queue panel">
        <div className="panel-h"><span className="eyebrow">queue · {queue.length} configuration{queue.length === 1 ? "" : "s"}</span>
          <span className="bench-q-hint eyebrow">select two to compare ↔</span></div>
        <div className="bench-rows">
          <AnimatePresence initial={false}>
            {queue.map((it) => (
              <BenchRow key={it.id} it={it} picked={picked.includes(it.id)} onPick={() => togglePick(it.id)} />
            ))}
          </AnimatePresence>
          {queue.length === 0 && <div className="bench-empty eyebrow">build a configuration above and add it — operators evaluate against the real curriculum, runs evolve then re-score their champion. then pick two to compare per-instance.</div>}
        </div>
      </div>
    </div>
  );
}

function BenchRow({ it, picked, onPick }: { it: BenchItem; picked: boolean; onPick: () => void }) {
  const r = it.result;
  const win = r && r.safe && r.sat_calls < r.baseline_sat;
  return (
    <motion.button className={`bench-rowi ${picked ? "picked" : ""} ${it.kind}`} layout onClick={onPick}
      disabled={it.status !== "done"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <span className="bench-rk">{it.kind === "run" ? "⚗" : "▢"}</span>
      <span className="bench-rlabel mono">{it.label}<span className="bench-rmeta"> · {it.seam} · {it.problemSet}{it.champion ? ` · ★${it.champion}` : ""}</span></span>
      {it.status === "running" && <span className="bench-rstatus">{it.runGen ?? "evaluating…"}</span>}
      {it.status === "error" && <span className="bench-rstatus err" title={it.error}>error</span>}
      {it.status === "done" && r && (
        <span className="bench-rscore">
          <b className="num" style={{ color: r.safe ? (win ? "var(--mint)" : "var(--tx)") : "var(--rose)" }}>{r.safe ? r.sat_calls : "unsafe"}</b>
          {r.safe && <span className="num bench-rratio" style={{ color: win ? "var(--mint)" : "var(--amber)" }}>{it.ratioToBase}×</span>}
        </span>
      )}
    </motion.button>
  );
}

function Compare({ a, b }: { a: BenchItem; b: BenchItem }) {
  const ra = a.result!, rb = b.result!;
  const [metric, setMetric] = useState<"sat" | "ms">("sat");
  const names = ra.per_instance.map((p) => p.name);
  const bByName = Object.fromEntries(rb.per_instance.map((p) => [p.name, p]));
  const val = (p: any) => (p == null ? null : metric === "sat" ? p.sat : p.ms);
  const baseVal = (p: any) => (p == null ? null : metric === "sat" ? p.baseline_sat : p.baseline_ms);
  const totA = names.reduce((s, nm) => s + (val(ra.per_instance.find((p) => p.name === nm)) ?? 0), 0);
  const totB = names.reduce((s, nm) => s + (val(bByName[nm]) ?? 0), 0);
  const unit = metric === "sat" ? "" : " ms";
  const fmt = (v: number | null) => (v == null ? "—" : metric === "ms" ? v.toFixed(1) : v);

  return (
    <div className="bench-compare panel">
      <div className="panel-h"><span className="eyebrow">side-by-side · per-instance deep dive</span>
        <div className="bench-metric">
          {(["sat", "ms"] as const).map((m) => (
            <button key={m} className={metric === m ? "on" : ""} onClick={() => setMetric(m)}>
              {m === "sat" ? "SAT calls" : "wall-clock"}
            </button>
          ))}
        </div>
      </div>
      <div className="bench-cmp-heads">
        <CmpHead it={a} side="A" /><span className="bench-vs num">vs</span><CmpHead it={b} side="B" />
      </div>
      <table className="bench-table num">
        <thead><tr><th className="l">instance</th><th>set</th><th>A · {a.label}</th><th>B · {b.label}</th><th>baseline</th><th>winner</th></tr></thead>
        <tbody>
          {names.map((nm) => {
            const pa = ra.per_instance.find((p) => p.name === nm)!;
            const pb = bByName[nm];
            const av = val(pa), bv = val(pb);
            const winner = av == null ? "B" : bv == null ? "A" : av < bv ? "A" : bv < av ? "B" : "=";
            return (
              <tr key={nm}>
                <td className="l mono">{nm}</td>
                <td className="dim">{pa?.set}</td>
                <td className={winner === "A" ? "win" : ""}>{fmt(av)}{unit}</td>
                <td className={winner === "B" ? "win" : ""}>{fmt(bv)}{unit}</td>
                <td className="dim">{fmt(baseVal(pa))}{unit}</td>
                <td className={`wcol ${winner === "A" ? "wa" : winner === "B" ? "wb" : ""}`}>{winner}</td>
              </tr>
            );
          })}
          <tr className="bench-total">
            <td className="l">TOTAL</td><td className="dim">{ra.coverage}/{ra.n}</td>
            <td className={ra.safe && totA <= totB ? "win" : ""}>{ra.safe ? fmt(totA) + unit : "unsafe"}</td>
            <td className={rb.safe && totB <= totA ? "win" : ""}>{rb.safe ? fmt(totB) + unit : "unsafe"}</td>
            <td className="dim">—</td><td />
          </tr>
        </tbody>
      </table>
      <p className="bench-cmp-note">
        {metric === "sat"
          ? <>SAT-calls is the <b>reproducible</b> metric (engine-pinned, noise-free) — but calls ≠ runtime: an operator can issue <b>fewer but harder</b> calls. Flip to wall-clock to check the two agree.</>
          : <>Wall-clock is what you actually feel, but it's <b>noisy</b> (one run, this machine, this backend). The reproducible ranking uses SAT-calls. Where the two disagree, trust neither blindly.</>}
        {" "}Coverage must be {ra.n}/{ra.n} to count as <Term k="strongcyclic">safe</Term>.
      </p>
    </div>
  );
}

function CmpHead({ it, side }: { it: BenchItem; side: string }) {
  const r = it.result!;
  return (
    <div className={`bench-chead ${side === "A" ? "a" : "b"}`}>
      <span className="bench-chead-side">{side}</span>
      <div>
        <div className="mono bench-chead-name">{r.op.name} <span className="chip">{r.op.origin}</span></div>
        <div className="eyebrow">{it.seam} · {it.problemSet}{it.champion ? ` · champion of a run` : ""}</div>
        {r.op.kind !== "source" && typeof r.op.spec === "object" && (
          <div className="bench-chead-w mono">{Object.entries(r.op.spec).map(([k, v]) => `${k}=${v}`).join("  ")}</div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="bench-field"><span className="eyebrow">{label}</span>{children}</label>;
}
