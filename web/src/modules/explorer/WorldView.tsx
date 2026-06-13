import { motion } from "framer-motion";
import type { Lit, Meta } from "../../lib/trace/types";
import { blocksWorld, logisticsWorld } from "../../lib/world/state";
import "./world.css";

// The concrete "world" for the current state — bespoke renderers per domain so
// you watch actual trucks/towers, not abstract nodes.
export function WorldView({ meta, state }: { meta: Meta; state: Lit[] | null }) {
  if (!state) return <div className="world-empty eyebrow">no state yet — press run</div>;
  if (meta.render === "logistics") return <Logistics meta={meta} state={state} />;
  if (meta.render === "blocksworld") return <Blocks meta={meta} state={state} />;
  return <Generic meta={meta} state={state} />;
}

function Logistics({ meta, state }: { meta: Meta; state: Lit[] }) {
  const w = logisticsWorld(meta, state);
  return (
    <div className="logi">
      {w.locations.map((loc) => (
        <div className="logi-loc" key={loc}>
          <div className="logi-pad">
            {w.trucks.filter((t) => w.truckLoc[t] === loc).map((t) => (
              <motion.div className="truck" layoutId={`tok-${t}`} key={t} layout
                          transition={{ type: "spring", stiffness: 260, damping: 26 }}>
                <span className="tok-label">{t}</span>
                <div className="truck-bed">
                  {w.packages.filter((p) => w.inTruck[p] === t).map((p) => (
                    <motion.span className="pkg in" layoutId={`tok-${p}`} key={p} layout>{p}</motion.span>
                  ))}
                </div>
              </motion.div>
            ))}
            {w.packages.filter((p) => w.pkgLoc[p] === loc).map((p) => (
              <motion.span className="pkg" layoutId={`tok-${p}`} key={p} layout
                           transition={{ type: "spring", stiffness: 260, damping: 26 }}>{p}</motion.span>
            ))}
          </div>
          <div className="logi-loc-label eyebrow">{loc}</div>
        </div>
      ))}
    </div>
  );
}

function Blocks({ meta, state }: { meta: Meta; state: Lit[] }) {
  const w = blocksWorld(meta, state);
  return (
    <div className="blocks">
      {w.holding && (
        <div className="bw-hand">
          <motion.div className="block held" layoutId={`blk-${w.holding}`} layout>{w.holding}</motion.div>
          <div className="bw-claw eyebrow">⊓ holding</div>
        </div>
      )}
      <div className="bw-floor">
        {w.towers.map((tower, i) => (
          <div className="bw-tower" key={i}>
            {tower.slice().reverse().map((b) => (
              <motion.div className="block" layoutId={`blk-${b}`} key={b} layout
                          transition={{ type: "spring", stiffness: 280, damping: 28 }}>{b}</motion.div>
            ))}
          </div>
        ))}
      </div>
      <div className="bw-line" />
    </div>
  );
}

function Generic({ meta, state }: { meta: Meta; state: Lit[] }) {
  const trues = state.filter((l) => l > 0).map((l) => meta.props[Math.abs(l) - 1]);
  return (
    <div className="generic-world">
      {trues.map((n) => <span className="chip glow-cyan" key={n}>{n}</span>)}
    </div>
  );
}
