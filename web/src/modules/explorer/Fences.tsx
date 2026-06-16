import { AnimatePresence, motion } from "framer-motion";
import type { Lit, Meta } from "../../lib/trace/types";
import { cubeFacts, type ExplorerState } from "./derive";
import type { Inspect } from "./Inspector";
import "./fences.css";

// The backward layers (L0 = the goal, L1 = one move away, …). Each layer holds
// clauses: KNOWN mutex invariants (seeded up-front) and INDUCTIVELY-learned reasons.
// We distinguish them — they are not the same thing. Everything here is clickable.
const sortKey = (xs: Lit[]) => [...xs].sort((a, b) => a - b).join(",");

export function Fences({ meta, st, onInspect, selected }: {
  meta: Meta; st: ExplorerState;
  onInspect?: (t: Inspect) => void;
  selected?: Inspect;
}) {
  const deadKey = st.deadend ? st.deadend.reason.join(",") : null;
  const selFence = selected?.kind === "fence" ? selected.i : -1;
  const selReason = selected?.kind === "reason" ? selected.cube.join(",") : null;
  const inspectable = !!onInspect;
  // a layer cube blocks the clause ¬cube; it's a mutex invariant iff that clause
  // matches one of meta.invariants (i.e. it was seeded, not learned).
  const invClauses = new Set((meta.invariants ?? []).map(sortKey));
  const isInvariant = (cube: Lit[]) => invClauses.has(sortKey(cube.map((l) => -l)));
  return (
    <div className={`fences ${inspectable ? "clickable" : ""}`}>
      {st.layers.map((layer, i) => {
        const isCurrent = st.current?.layer === i;
        return (
          <div className={`fence ${isCurrent ? "current" : ""} ${selFence === i ? "sel" : ""}`} key={i}>
            <button className="fence-cap" disabled={!inspectable}
              onClick={() => onInspect?.({ kind: "fence", i })} title="inspect this layer’s clauses">
              <span className="fence-idx num">{i === 0 ? "L0" : `L${i}`}</span>
              <span className="fence-tag eyebrow">{i === 0 ? "goal" : "≤" + i + " steps"}</span>
            </button>
            <div className="fence-col">
              {i === 0 && (
                <div className="goal-anchor">
                  <span className="eyebrow">GOAL</span>
                  <FactRow facts={cubeFacts(meta, meta.goal)} />
                </div>
              )}
              <AnimatePresence initial={false}>
                {layer.map((cube, j) => {
                  const ck = cube.join(",");
                  const inv = isInvariant(cube);
                  const isNew = !inv && deadKey === ck && i <= (st.deadend?.layer ?? -1);
                  return (
                    <motion.button
                      key={ck}
                      className={`reason-chip ${inv ? "invariant" : ""} ${isNew ? "flash" : ""} ${selReason === ck ? "sel" : ""}`}
                      disabled={!inspectable}
                      onClick={() => onInspect?.({ kind: "reason", cube })}
                      title={inv ? "mutex invariant — known up-front (preprocessing), NOT a learned reason"
                                 : "inductively-learned reason — click to inspect the clause"}
                      initial={{ opacity: 0, x: -8, scale: 0.96 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{ duration: 0.28, delay: Math.min(j, 6) * 0.012 }}
                    >
                      <span className="reason-x">{inv ? "⊥" : "⚡"}</span>
                      <FactRow facts={cubeFacts(meta, cube)} />
                    </motion.button>
                  );
                })}
              </AnimatePresence>
              {layer.length === 0 && i > 0 && <div className="fence-empty eyebrow">open</div>}
            </div>
            {isCurrent && st.current && (
              <button className="fence-obl" disabled={!inspectable}
                onClick={() => onInspect?.({ kind: "obligation" })} title="inspect this SAT query">
                <span className="eyebrow">processing</span>
                <FactRow facts={cubeFacts(meta, st.current.state).filter((f) => f.pos)} compact />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FactRow({ facts, compact }: { facts: { name: string; pos: boolean }[]; compact?: boolean }) {
  const shown = facts.filter((f) => f.pos);
  return (
    <div className={`facts ${compact ? "compact" : ""}`}>
      {shown.map((f) => (
        <span className="fact" key={f.name}>{prettyFact(f.name)}</span>
      ))}
      {shown.length === 0 && <span className="fact dim">∅</span>}
    </div>
  );
}

// at(P0,L1) -> P0·L1 ; on(b0,b1) -> b0/b1
function prettyFact(name: string): string {
  const m = name.match(/^([^(]+)\(([^)]*)\)$/);
  if (!m) return name;
  return m[2].split(",").join("·");
}
