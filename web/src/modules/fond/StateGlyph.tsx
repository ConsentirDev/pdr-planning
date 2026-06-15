import type { Lit, Meta } from "../../lib/trace/types";
import {
  blocksWorld, faultsWorld, islandsWorld, respondersWorld, satelliteWorld,
  tireWorld, trueAtoms,
} from "../../lib/world/state";

// A tiny, dense glyph of a single planning state — drawn small enough to be a
// node in the AND/OR graph. Each domain gets a bespoke mini-world so the graph
// reads as actual trucks / road-networks / machines rather than abstract facts.
export function StateGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  if (meta.render === "blocksworld") return <BlocksGlyph meta={meta} lits={lits} />;
  if (meta.render === "tireworld") return <TireGlyph meta={meta} lits={lits} />;
  if (meta.render === "faults") return <FaultsGlyph meta={meta} lits={lits} />;
  if (meta.render === "islands") return <IslandsGlyph meta={meta} lits={lits} />;
  if (meta.render === "responders") return <RespondersGlyph meta={meta} lits={lits} />;
  if (meta.render === "satellite") return <SatelliteGlyph meta={meta} lits={lits} />;
  return <FactsGlyph meta={meta} lits={lits} />;
}

// shared: place layered locations left→right, vertically centred per column
function layeredPositions(layers: string[][], COLW: number, ROWH: number, padX = 14, padY = 14) {
  const maxRows = Math.max(1, ...layers.map((c) => c.length));
  const width = padX + (layers.length - 1) * COLW + padX;
  const height = maxRows * ROWH + padY;
  const mid = height / 2;
  const pos: Record<string, { x: number; y: number }> = {};
  layers.forEach((col, ci) => {
    const h = (col.length - 1) * ROWH;
    col.forEach((loc, ri) => { pos[loc] = { x: padX + ci * COLW, y: mid + ri * ROWH - h / 2 }; });
  });
  return { pos, width, height };
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
    <svg className="sg-tire" viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
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

// Islands: islands laid out left→right; sure bridges as solid spans, risky water
// as a dashed channel; the swimmer glows on their island, the goal island is mint.
function IslandsGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = islandsWorld(meta, lits);
  const { pos, width, height } = layeredPositions(w.layers, 40, 26);
  return (
    <svg className="sg-isl" viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {w.waters.map(([a, b], i) => pos[a] && pos[b] ? (
        <line key={"w" + i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="sg-isl-water" />
      ) : null)}
      {w.bridges.map(([a, b], i) => pos[a] && pos[b] ? (
        <line key={"b" + i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="sg-isl-bridge" />
      ) : null)}
      {w.locations.map((loc) => {
        const p = pos[loc]; if (!p) return null;
        const here = w.figureAt === loc, goal = w.goalLoc === loc;
        return (
          <g key={loc}>
            <ellipse cx={p.x} cy={p.y} rx={9} ry={6} className={`sg-isl-land ${goal ? "goal" : ""}`} />
            {here && <circle cx={p.x} cy={p.y - 1} r={3} className="sg-isl-fig" />}
          </g>
        );
      })}
    </svg>
  );
}

// First-responders: a little map — roads, a fire 🔥 where it burns, a victim that
// turns from amber to a mint ✓ when saved, and the medic at its location.
function RespondersGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = respondersWorld(meta, lits);
  const { pos, width, height } = layeredPositions(w.layers, 46, 28);
  return (
    <svg className="sg-fr" viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {w.roads.map(([a, b], i) => pos[a] && pos[b] ? (
        <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="sg-fr-road" />
      ) : null)}
      {w.locations.map((loc) => {
        const p = pos[loc]; if (!p) return null;
        const fire = w.fires.has(loc), saved = w.saved.has(loc), victim = w.victims.has(loc);
        const medic = w.medicAt === loc;
        return (
          <g key={loc}>
            <circle cx={p.x} cy={p.y} r={7} className={`sg-fr-node ${medic ? "medic" : ""}`} />
            {fire && <text x={p.x} y={p.y - 8} className="sg-fr-icon">🔥</text>}
            {victim && !saved && <text x={p.x} y={p.y + 3} className="sg-fr-icon">🧍</text>}
            {saved && <text x={p.x} y={p.y + 3} className="sg-fr-saved">✓</text>}
            {medic && <text x={p.x} y={p.y + 12} className="sg-fr-icon">🚑</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Earth-Observation (space): a planet with ground patches on an orbit ring; the
// satellite sits over the current patch, imaged patches glow mint, the rest dim.
function SatelliteGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = satelliteWorld(meta, lits);
  const S = 64, C = S / 2, R = 22;
  const n = Math.max(1, w.patches.length);
  const ang = (i: number) => (-Math.PI / 2) + (i * 2 * Math.PI) / n;
  return (
    <svg className="sg-sat" viewBox={`0 0 ${S} ${S}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <circle cx={C} cy={C} r={R} className="sg-sat-orbit" />
      <circle cx={C} cy={C} r={9} className="sg-sat-planet" />
      {w.patches.map((p, i) => {
        const x = C + R * Math.cos(ang(i)), y = C + R * Math.sin(ang(i));
        const done = w.imaged.has(p), over = w.over === p;
        return (
          <g key={p}>
            <circle cx={x} cy={y} r={4.2} className={`sg-sat-patch ${done ? "done" : ""}`} />
            {over && <text x={x} y={y - 6} className="sg-sat-icon">🛰️</text>}
          </g>
        );
      })}
    </svg>
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
