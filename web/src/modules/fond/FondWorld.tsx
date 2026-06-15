import type { Lit, Meta } from "../../lib/trace/types";
import {
  blocksWorld, faultsWorld, islandsWorld, layerByDistance, respondersWorld,
  satelliteWorld, tireWorld,
} from "../../lib/world/state";
import "./fond-world.css";

// A large "hero" view of the state currently under inspection — the same bespoke
// worlds the in-graph glyphs draw, but full-size and labelled so the scene reads
// at a glance while the AND/OR graph grows beside it.
export function FondWorld({ meta, lits }: { meta: Meta; lits: Lit[] | null }) {
  if (!lits) return <div className="fw-empty eyebrow">press run — the world appears here</div>;
  switch (meta.render) {
    case "satellite": return <SatelliteScene meta={meta} lits={lits} />;
    case "tireworld": return <TireScene meta={meta} lits={lits} />;
    case "islands": return <IslandsScene meta={meta} lits={lits} />;
    case "responders": return <RespondersScene meta={meta} lits={lits} />;
    case "faults": return <FaultsScene meta={meta} lits={lits} />;
    case "blocksworld": return <BlocksScene meta={meta} lits={lits} />;
    default: return <GenericScene meta={meta} lits={lits} />;
  }
}

// shared layered placement in a fixed viewBox
function place(layers: string[][], W: number, H: number, padX = 46) {
  const cols = layers.length;
  const stepX = cols > 1 ? (W - padX * 2) / (cols - 1) : 0;
  const pos: Record<string, { x: number; y: number }> = {};
  layers.forEach((col, ci) => {
    const n = col.length;
    col.forEach((loc, ri) => {
      pos[loc] = { x: padX + ci * stepX, y: H * ((ri + 1) / (n + 1)) };
    });
  });
  return pos;
}

const VB = { w: 380, h: 208 };

function Frame({ children, caption }: { children: any; caption?: string }) {
  return (
    <div className="fw">
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="fw-svg" preserveAspectRatio="xMidYMid meet">
        {children}
      </svg>
      {caption && <div className="fw-cap eyebrow">{caption}</div>}
    </div>
  );
}

// ---- space ----
function SatelliteScene({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = satelliteWorld(meta, lits);
  const cx = VB.w / 2, cy = VB.h / 2, R = 74;
  const n = Math.max(1, w.patches.length);
  const done = w.patches.filter((p) => w.imaged.has(p)).length;
  return (
    <Frame caption={`satellite imaging · ${done}/${n} patches captured`}>
      <defs>
        <radialGradient id="planet" cx="40%" cy="35%">
          <stop offset="0%" stopColor="#2aa7c4" /><stop offset="70%" stopColor="#15596b" />
          <stop offset="100%" stopColor="#0c2a33" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={R} className="fw-orbit" />
      <circle cx={cx} cy={cy} r={30} fill="url(#planet)" stroke="var(--cyan)" strokeWidth={1.2} opacity={0.95} />
      {w.patches.map((p, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
        const imaged = w.imaged.has(p), over = w.over === p;
        return (
          <g key={p}>
            {over && <line x1={cx} y1={cy} x2={x} y2={y} className="fw-beam" />}
            <circle cx={x} cy={y} r={11} className={`fw-patch ${imaged ? "done" : ""} ${over ? "over" : ""}`} />
            {imaged && <text x={x} y={y + 4} className="fw-patch-ok">✓</text>}
            <text x={x} y={y - 16} className="fw-label">{p}</text>
            {over && <text x={x + 13} y={y - 9} className="fw-emoji">🛰️</text>}
          </g>
        );
      })}
    </Frame>
  );
}

// ---- tireworld ----
function TireScene({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = tireWorld(meta, lits);
  const pos = place(w.layers, VB.w, VB.h);
  return (
    <Frame caption={w.flat ? "⚠ flat tyre — find a spare" : "rolling"}>
      {w.roads.map(([a, b], i) => pos[a] && pos[b] &&
        <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="fw-road" />)}
      {w.locations.map((loc) => {
        const p = pos[loc]; if (!p) return null;
        const here = w.vehicleAt === loc, goal = w.goalLoc === loc;
        return (
          <g key={loc}>
            <circle cx={p.x} cy={p.y} r={15} className={`fw-node ${here ? "here" : ""} ${goal ? "goal" : ""} ${here && w.flat ? "flat" : ""}`} />
            {w.spares.has(loc) && <text x={p.x + 14} y={p.y - 9} className="fw-emoji">🛞</text>}
            {here && <text x={p.x} y={p.y + 6} className="fw-emoji-lg">🚗</text>}
            <text x={p.x} y={p.y + 30} className="fw-label">{loc}{goal ? " ◍" : ""}</text>
          </g>
        );
      })}
    </Frame>
  );
}

// ---- islands ----
function IslandsScene({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = islandsWorld(meta, lits);
  const pos = place(w.layers, VB.w, VB.h);
  return (
    <Frame caption="bridges are sure · swimming may sweep you back">
      <rect x={0} y={0} width={VB.w} height={VB.h} className="fw-sea" />
      {w.waters.map(([a, b], i) => pos[a] && pos[b] &&
        <line key={"w" + i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="fw-water" />)}
      {w.bridges.map(([a, b], i) => pos[a] && pos[b] &&
        <line key={"b" + i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="fw-bridge" />)}
      {w.locations.map((loc) => {
        const p = pos[loc]; if (!p) return null;
        const here = w.figureAt === loc, goal = w.goalLoc === loc;
        return (
          <g key={loc}>
            <ellipse cx={p.x} cy={p.y} rx={26} ry={16} className={`fw-island ${goal ? "goal" : ""}`} />
            {here && <text x={p.x} y={p.y + 5} className="fw-emoji-lg">🏊</text>}
            <text x={p.x} y={p.y + 30} className="fw-label">{loc}{goal ? " ◍" : ""}</text>
          </g>
        );
      })}
    </Frame>
  );
}

// ---- first-responders ----
function RespondersScene({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = respondersWorld(meta, lits);
  const pos = place(w.layers, VB.w, VB.h);
  return (
    <Frame caption="drive in · put out the fire · rescue the victim">
      {w.roads.map(([a, b], i) => pos[a] && pos[b] &&
        <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="fw-road" />)}
      {w.locations.map((loc) => {
        const p = pos[loc]; if (!p) return null;
        const fire = w.fires.has(loc), saved = w.saved.has(loc), victim = w.victims.has(loc), medic = w.medicAt === loc;
        return (
          <g key={loc}>
            <circle cx={p.x} cy={p.y} r={16} className={`fw-node ${medic ? "here" : ""}`} />
            {fire && <text x={p.x - 12} y={p.y - 12} className="fw-emoji-lg">🔥</text>}
            {victim && !saved && <text x={p.x + 13} y={p.y - 10} className="fw-emoji">🧍</text>}
            {saved && <text x={p.x + 13} y={p.y - 9} className="fw-saved">✓ safe</text>}
            {medic && <text x={p.x} y={p.y + 6} className="fw-emoji-lg">🚑</text>}
            <text x={p.x} y={p.y + 32} className="fw-label">{loc}</text>
          </g>
        );
      })}
    </Frame>
  );
}

// ---- faults ----
function FaultsScene({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = faultsWorld(meta, lits);
  return (
    <div className="fw fw-faults">
      {w.comps.map((c) => (
        <div key={c.id} className={`fw-comp ${c.status}`}>
          <div className="fw-comp-icon">{c.status === "done" ? "✓" : c.status === "broken" ? "⚡" : "▣"}</div>
          <div className="fw-comp-id mono">{c.id}</div>
          <div className="fw-comp-st eyebrow">{c.status}</div>
        </div>
      ))}
    </div>
  );
}

// ---- blocks ----
function BlocksScene({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = blocksWorld(meta, lits);
  return (
    <div className="fw fw-blocks">
      {w.holding && <div className="fw-blk held">⊓ {w.holding}</div>}
      <div className="fw-floor">
        {w.towers.map((t, i) => (
          <div className="fw-tower" key={i}>
            {t.slice().reverse().map((b) => <div className="fw-blk" key={b}>{b}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenericScene({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const trues = lits.filter((l) => l > 0).map((l) => meta.props[l - 1]).slice(0, 10);
  // re-layer nothing; just show the live true facts
  void layerByDistance;
  return (
    <div className="fw fw-generic">
      {trues.map((n) => <span className="chip glow-cyan" key={n}>{n}</span>)}
    </div>
  );
}
