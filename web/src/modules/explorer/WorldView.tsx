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

function Truck({ id, pkgs }: { id: string; pkgs: string[] }) {
  return (
    <motion.div className="truck" layoutId={`tok-${id}`} layout
                transition={{ type: "spring", stiffness: 240, damping: 24 }}>
      <svg viewBox="0 0 40 24" className="truck-svg" width="40" height="24">
        <path d="M2 4h18v10H2z" fill="rgba(58,214,223,0.14)" stroke="var(--cyan)" strokeWidth="1.2" />
        <path d="M20 8h9l5 5v1h-14z" fill="rgba(58,214,223,0.1)" stroke="var(--cyan)" strokeWidth="1.2" />
        <circle cx="8" cy="16" r="3" fill="var(--ink)" stroke="var(--cyan)" strokeWidth="1.2" />
        <circle cx="27" cy="16" r="3" fill="var(--ink)" stroke="var(--cyan)" strokeWidth="1.2" />
      </svg>
      <span className="tok-label">{id}</span>
      {pkgs.length > 0 && (
        <div className="truck-bed">
          {pkgs.map((p) => (
            <motion.span className="pkg in" layoutId={`tok-${p}`} key={p} layout>{p}</motion.span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function Logistics({ meta, state }: { meta: Meta; state: Lit[] }) {
  const w = logisticsWorld(meta, state);
  const goalLocs = new Set(
    meta.goal.filter((l) => l > 0).map((l) => meta.props[l - 1])
      .map((n) => n.match(/^at[pt]?\(([^,]+),([^)]+)\)/)?.[2]).filter(Boolean) as string[]
  );
  return (
    <div className="logi-scene">
      <div className="logi-row">
        {w.locations.map((loc) => {
          const isGoal = goalLocs.has(loc);
          return (
            <div className={`logi-loc ${isGoal ? "goal" : ""}`} key={loc}>
              <div className="logi-pad">
                {w.trucks.filter((t) => w.truckLoc[t] === loc).map((t) => (
                  <Truck key={t} id={t} pkgs={w.packages.filter((p) => w.inTruck[p] === t)} />
                ))}
                {w.packages.filter((p) => w.pkgLoc[p] === loc).map((p) => (
                  <motion.span className="pkg" layoutId={`tok-${p}`} key={p} layout
                               transition={{ type: "spring", stiffness: 240, damping: 24 }}>{p}</motion.span>
                ))}
              </div>
              <div className="logi-marker"><span className="logi-dot" /></div>
              <div className={`logi-loc-label ${isGoal ? "goal" : ""}`}>{loc}{isGoal && " ◍"}</div>
            </div>
          );
        })}
      </div>
      <div className="logi-road" />
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
