import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Meta } from "../../lib/trace/types";
import {
  geometry,
  NODE_DIMS,
  type FondState,
  type Geometry,
} from "./derive";
import { StateGlyph } from "./StateGlyph";

const { w: NW, h: NH } = NODE_DIMS;

// The AND/OR graph. Nodes = states (tower glyphs); an action is a small
// connector box with one arrow per outcome (the AND-branching of nature).
// As "arc" events play, nodes/edges spring in. The policy generator recolors
// solved states mint and the chosen-action arcs cyan.
export function GraphView({ meta, st }: { meta: Meta; st: FondState }) {
  const geo = useMemo(() => geometry(st), [st]);
  const { width, height } = geo;

  return (
    <div className="fg-scroll">
      <div className="fg-stage" style={{ width, height }}>
        <Edges geo={geo} st={st} />
        <Boxes geo={geo} st={st} />
        <Nodes geo={geo} st={st} meta={meta} />
      </div>
    </div>
  );
}

function policyChosen(st: FondState, from: string, action: string) {
  return st.policy.get(from) === action;
}

// ---- edges (SVG): source -> action box, action box -> each outcome ----
function Edges({ geo, st }: { geo: Geometry; st: FondState }) {
  const { width, height } = geo;
  return (
    <svg className="fg-edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <marker id="fg-arrow" markerWidth="7" markerHeight="7" refX="5.4" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--cyan-dim)" />
        </marker>
        <marker id="fg-arrow-on" markerWidth="7" markerHeight="7" refX="5.4" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--cyan)" />
        </marker>
        <marker id="fg-arrow-goal" markerWidth="7" markerHeight="7" refX="5.4" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--mint)" />
        </marker>
      </defs>
      {st.arcs.map((a) => {
        const src = geo.nodes.get(a.from);
        const box = geo.arcBoxes.get(a.id);
        if (!src || !box) return null;
        const chosen = policyChosen(st, a.from, a.action);
        const sx = src.x + NW / 2;
        const sy = src.y + NH;
        // stem: source bottom -> action box top
        const stem = `M ${sx} ${sy} C ${sx} ${sy + 26}, ${box.x} ${box.y - 26}, ${box.x} ${box.y - 9}`;
        return (
          <g key={`stem-${a.id}`}>
            <motion.path
              d={stem}
              className={`fg-edge stem ${chosen ? "chosen" : ""}`}
              fill="none"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
            {a.outcomes.map((o, i) => {
              const dst = geo.nodes.get(o);
              if (!dst) return null;
              const dx = dst.x + NW / 2;
              const dy = dst.y - 2;
              const isGoal = a.isGoal[i];
              const bx = box.x;
              const by = box.y + 9;
              const branch = `M ${bx} ${by} C ${bx} ${by + 30}, ${dx} ${dy - 34}, ${dx} ${dy}`;
              const marker = isGoal
                ? "url(#fg-arrow-goal)"
                : chosen
                ? "url(#fg-arrow-on)"
                : "url(#fg-arrow)";
              return (
                <motion.path
                  key={`br-${a.id}-${i}`}
                  d={branch}
                  className={`fg-edge branch ${chosen ? "chosen" : ""} ${isGoal ? "goal" : ""}`}
                  fill="none"
                  markerEnd={marker}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.45, ease: "easeOut", delay: 0.08 + i * 0.05 }}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ---- action connector boxes ----
function Boxes({ geo, st }: { geo: Geometry; st: FondState }) {
  return (
    <AnimatePresence initial={false}>
      {st.arcs.map((a) => {
        const box = geo.arcBoxes.get(a.id);
        if (!box) return null;
        const chosen = policyChosen(st, a.from, a.action);
        const nd = a.outcomes.length;
        return (
          <motion.div
            key={a.id}
            className={`fg-box ${chosen ? "chosen" : ""}`}
            style={{ left: box.x, top: box.y }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 22, delay: 0.12 }}
            title={`${a.action} — ${nd} possible outcome${nd > 1 ? "s" : ""} (nature chooses)`}
          >
            <span className="fg-box-act">{shortAct(a.action)}</span>
            {nd > 1 && <span className="fg-box-fan num">⋔{nd}</span>}
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

// ---- state nodes ----
function Nodes({ geo, st, meta }: { geo: Geometry; st: FondState; meta: Meta }) {
  const nodes = [...geo.nodes.values()];
  return (
    <AnimatePresence initial={false}>
      {nodes.map((n) => {
        const solved = st.solved.has(n.key);
        // The policy generator produces a clean SOLVED vs NOT-YET-SOLVED divide.
        // (We don't render individual "reason" states as permanent dead-ends — a
        // reason at a given horizon just means "not yet shown solvable".)
        const examining = !solved && st.lastReason === n.key;   // transient: currently set aside
        const cls = [
          "fg-node",
          n.isInit ? "init" : "",
          n.isGoal ? "goal" : "",
          solved ? "solved" : "",
          examining ? "examining" : "",
          st.solved.size > 0 && !solved && !n.isGoal ? "dim" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <motion.div
            key={n.key}
            className={cls}
            style={{ left: n.x, top: n.y, width: NW, height: NH }}
            initial={{ scale: 0.6, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
          >
            <div className="fg-node-tag eyebrow">
              {n.isInit ? "INIT" : n.isGoal ? "GOAL" : `s${n.order}`}
            </div>
            <div className="fg-node-body">
              <StateGlyph meta={meta} lits={n.lits} />
            </div>
            {solved && <span className="fg-node-dot" title="known-solved (alive)" />}
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

function shortAct(name: string): string {
  // pick-up(b0) -> pick·b0 ; stack(b0,b1) -> stk·b0/b1
  const m = name.match(/^([^(]+)\(([^)]*)\)$/);
  if (!m) return name;
  const verb = m[1]
    .replace(/[-_]/g, "")
    .slice(0, 4);
  const args = m[2].split(",").join("·");
  return args ? `${verb}·${args}` : verb;
}
