import type { Lit, Meta } from "../../lib/trace/types";
import { blocksWorld, faultsWorld, tireWorld, trueAtoms } from "../../lib/world/state";

// A tiny, dense glyph of a single planning state — drawn small enough to be a
// node in the AND/OR graph. Each domain gets a bespoke mini-world so the graph
// reads as actual trucks / road-networks / machines rather than abstract facts.
export function StateGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  if (meta.render === "blocksworld") return <BlocksGlyph meta={meta} lits={lits} />;
  if (meta.render === "tireworld") return <TireGlyph meta={meta} lits={lits} />;
  if (meta.render === "faults") return <FaultsGlyph meta={meta} lits={lits} />;
  return <FactsGlyph meta={meta} lits={lits} />;
}

// Triangle-Tireworld: a compact road network. Nodes laid out left→right by
// distance from the source; the car's node glows, a blown tire flashes amber,
// locations still carrying a spare wear a tyre pip.
function TireGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = tireWorld(meta, lits);
  const COLW = 38, ROWH = 26, R = 7;
  const maxRows = Math.max(1, ...w.layers.map((c) => c.length));
  const width = 14 + (w.layers.length - 1) * COLW + 14;
  const height = maxRows * ROWH + 14;
  const mid = height / 2;
  const pos: Record<string, { x: number; y: number }> = {};
  w.layers.forEach((col, ci) => {
    const h = (col.length - 1) * ROWH;
    col.forEach((loc, ri) => {
      pos[loc] = { x: 14 + ci * COLW, y: mid + ri * ROWH - h / 2 };
    });
  });
  return (
    <svg className="sg-tire" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {w.roads.map(([a, b], i) =>
        pos[a] && pos[b] ? (
          <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y}
                className="sg-tire-road" />
        ) : null
      )}
      {w.locations.map((loc) => {
        const p = pos[loc]; if (!p) return null;
        const here = w.vehicleAt === loc;
        const goal = w.goalLoc === loc;
        return (
          <g key={loc}>
            <circle cx={p.x} cy={p.y} r={R}
                    className={`sg-tire-node ${here ? "car" : ""} ${goal ? "goal" : ""} ${here && w.flat ? "flat" : ""}`} />
            {w.spares.has(loc) && <circle cx={p.x + R - 1} cy={p.y - R + 1} r={2.4} className="sg-tire-spare" />}
            {here && <text x={p.x} y={p.y + 3} className="sg-tire-car">🚗</text>}
          </g>
        );
      })}
      {w.vehicleAt && w.flat && <text x={width - 8} y={12} className="sg-tire-flat">⚠</text>}
    </svg>
  );
}

// Faults: each component is a little machine tile — pending (idle), broken
// (cracked / amber), or done (mint check).
function FaultsGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = faultsWorld(meta, lits);
  return (
    <div className="sg-faults">
      {w.comps.map((c) => (
        <span key={c.id} className={`sg-comp ${c.status}`} title={`${c.id}: ${c.status}`}>
          <span className="sg-comp-icon">{c.status === "done" ? "✓" : c.status === "broken" ? "⚡" : "▣"}</span>
          <span className="sg-comp-id">{c.id}</span>
        </span>
      ))}
    </div>
  );
}

function BlocksGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = blocksWorld(meta, lits);
  return (
    <div className="sg-blocks">
      {w.holding && (
        <div className="sg-hold" title={`holding ${w.holding}`}>
          <span className="sg-claw">⊓</span>
          <span className="sg-blk held">{w.holding}</span>
        </div>
      )}
      <div className="sg-floor">
        {w.towers.length === 0 && !w.holding && <span className="sg-empty">∅</span>}
        {w.towers.map((tower, i) => (
          <div className="sg-tower" key={i}>
            {tower
              .slice()
              .reverse()
              .map((b) => (
                <span className="sg-blk" key={b}>
                  {b}
                </span>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FactsGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const trues = trueAtoms(meta, lits).slice(0, 4);
  return (
    <div className="sg-facts">
      {trues.map((a) => (
        <span className="sg-fact" key={a.name}>
          {pretty(a.name)}
        </span>
      ))}
      {trues.length === 0 && <span className="sg-empty">∅</span>}
    </div>
  );
}

function pretty(name: string): string {
  const m = name.match(/^([^(]+)\(([^)]*)\)$/);
  if (!m) return name;
  return m[2].split(",").join("·") || m[1];
}
