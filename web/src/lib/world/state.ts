import type { Atom, Lit, Meta } from "../trace/types";

// Decode an abstract state (signed literals) into the set of TRUE atoms, then
// into structured worlds the bespoke renderers can draw.

export function trueAtoms(meta: Meta, lits: Lit[]): Atom[] {
  const byId = new Map(meta.atoms.map((a) => [a.id, a]));
  const out: Atom[] = [];
  for (const l of lits) if (l > 0) { const a = byId.get(l); if (a) out.push(a); }
  return out;
}

export function trueNameSet(meta: Meta, lits: Lit[]): Set<string> {
  return new Set(trueAtoms(meta, lits).map((a) => a.name));
}

// ---- logistics ----
export interface LogiWorld {
  locations: string[];
  trucks: string[];
  packages: string[];
  pkgLoc: Record<string, string | "truck" | "?">;
  truckLoc: Record<string, string | "?">;
  inTruck: Record<string, string>; // package -> truck
}

export function logisticsWorld(meta: Meta, lits: Lit[]): LogiWorld {
  const atoms = trueAtoms(meta, lits);
  const locations = new Set<string>();
  const trucks = new Set<string>();
  const packages = new Set<string>();
  // classify objects from all atoms in meta
  for (const a of meta.atoms) {
    if (a.pred === "at" || a.pred === "att" || a.pred === "atp") {
      if (a.args[1]) locations.add(a.args[1]);
    }
    if (a.pred === "in" || a.pred === "inn") { packages.add(a.args[0]); trucks.add(a.args[1]); }
  }
  const pkgLoc: LogiWorld["pkgLoc"] = {};
  const truckLoc: LogiWorld["truckLoc"] = {};
  const inTruck: Record<string, string> = {};
  for (const a of atoms) {
    if (a.pred === "at" || a.pred === "atp") {
      const [o, l] = a.args;
      if (trucks.has(o)) truckLoc[o] = l;
      else { packages.add(o); pkgLoc[o] = l; }
    } else if (a.pred === "att") { truckLoc[a.args[0]] = a.args[1]; trucks.add(a.args[0]); }
    else if (a.pred === "in" || a.pred === "inn") { inTruck[a.args[0]] = a.args[1]; pkgLoc[a.args[0]] = "truck"; }
  }
  return {
    locations: [...locations].sort(),
    trucks: [...trucks].sort(),
    packages: [...packages].sort(),
    pkgLoc, truckLoc, inTruck,
  };
}

// ---- blocksworld ----
export interface BlockWorld {
  blocks: string[];
  on: Record<string, string>; // x -> y (x on y)
  ontable: Set<string>;
  holding: string | null;
  clear: Set<string>;
  towers: string[][]; // bottom..top
}

export function blocksWorld(meta: Meta, lits: Lit[]): BlockWorld {
  const atoms = trueAtoms(meta, lits);
  const blocks = new Set<string>();
  for (const a of meta.atoms) {
    if (["on", "ontable", "clear", "holding"].includes(a.pred)) a.args.forEach((x) => blocks.add(x));
  }
  const on: Record<string, string> = {};
  const ontable = new Set<string>();
  const clear = new Set<string>();
  let holding: string | null = null;
  for (const a of atoms) {
    if (a.pred === "on") on[a.args[0]] = a.args[1];
    else if (a.pred === "ontable") ontable.add(a.args[0]);
    else if (a.pred === "clear") clear.add(a.args[0]);
    else if (a.pred === "holding") holding = a.args[0];
  }
  // build towers bottom..top
  const below: Record<string, string> = {};
  Object.entries(on).forEach(([x, y]) => (below[x] = y)); // x sits on y
  const towers: string[][] = [];
  for (const base of [...ontable].sort()) {
    const tower = [base];
    let top = base;
    // find block sitting on `top`
    let guard = 0;
    while (guard++ < blocks.size) {
      const next = Object.entries(on).find(([, y]) => y === top)?.[0];
      if (!next) break;
      tower.push(next);
      top = next;
    }
    towers.push(tower);
  }
  return { blocks: [...blocks].sort(), on, ontable, holding, clear, towers };
}

// ---- triangle-tireworld ----
export interface TireWorld {
  locations: string[];
  layers: string[][]; // locations grouped by distance from a source (left→right)
  roads: [string, string][]; // directed edges from static `road(a,b)` facts
  vehicleAt: string | null;
  spares: Set<string>; // locations that still hold a spare
  flat: boolean; // tire is currently flat (notflattire is false)
  goalLoc: string | null;
}

export function tireWorld(meta: Meta, lits: Lit[]): TireWorld {
  const trues = trueNameSet(meta, lits);
  const roads: [string, string][] = [];
  for (const s of meta.statics ?? []) {
    const m = s.match(/^road\(([^,]+),([^)]+)\)$/);
    if (m) roads.push([m[1], m[2]]);
  }
  const locations = new Set<string>();
  for (const [a, b] of roads) { locations.add(a); locations.add(b); }
  for (const a of meta.atoms) if (a.pred === "vehicleat") locations.add(a.args[0]);

  let vehicleAt: string | null = null;
  const spares = new Set<string>();
  for (const a of meta.atoms) {
    if (trues.has(a.name)) {
      if (a.pred === "vehicleat") vehicleAt = a.args[0];
      else if (a.pred === "sparein") spares.add(a.args[0]);
    }
  }
  const flat = !trues.has("notflattire");
  const goalLoc =
    meta.goal.filter((l) => l > 0).map((l) => meta.props[l - 1])
      .map((n) => n.match(/^vehicleat\(([^)]+)\)/)?.[1]).find(Boolean) ?? null;

  // layer locations by shortest distance from a source (no incoming road).
  const hasIncoming = new Set(roads.map(([, b]) => b));
  const sources = [...locations].filter((l) => !hasIncoming.has(l));
  const dist = new Map<string, number>();
  const queue = (sources.length ? sources : [...locations].slice(0, 1)).map((s) => {
    dist.set(s, 0); return s;
  });
  while (queue.length) {
    const u = queue.shift()!;
    for (const [a, b] of roads) if (a === u && !dist.has(b)) { dist.set(b, dist.get(u)! + 1); queue.push(b); }
  }
  const maxD = Math.max(0, ...[...dist.values()]);
  const layers: string[][] = Array.from({ length: maxD + 1 }, () => []);
  for (const l of [...locations].sort()) layers[dist.get(l) ?? maxD].push(l);

  return { locations: [...locations].sort(), layers, roads, vehicleAt, spares, flat, goalLoc };
}

// ---- faults ----
export interface FaultsWorld {
  comps: { id: string; status: "done" | "broken" | "pending" }[];
}

export function faultsWorld(meta: Meta, lits: Lit[]): FaultsWorld {
  const trues = trueNameSet(meta, lits);
  const ids = new Set<string>();
  for (const a of meta.atoms) if (a.pred === "done" || a.pred === "broken") ids.add(a.args[0]);
  const comps = [...ids].sort().map((id) => ({
    id,
    status: (trues.has(`broken(${id})`) ? "broken"
      : trues.has(`done(${id})`) ? "done" : "pending") as "done" | "broken" | "pending",
  }));
  return { comps };
}

// ---- shared helpers for "agent on a location graph" worlds ----
function staticEdges(meta: Meta, pred: string): [string, string][] {
  const out: [string, string][] = [];
  const re = new RegExp(`^${pred}\\(([^,]+),([^)]+)\\)$`);
  for (const s of meta.statics ?? []) {
    const m = s.match(re);
    if (m) out.push([m[1], m[2]]);
  }
  return out;
}

// BFS-layer locations left→right by distance from a source (no incoming edge).
export function layerByDistance(locations: string[], edges: [string, string][]): string[][] {
  const set = new Set(locations);
  const hasIncoming = new Set(edges.map(([, b]) => b));
  const sources = [...set].filter((l) => !hasIncoming.has(l));
  const dist = new Map<string, number>();
  const queue = (sources.length ? sources : [...set].slice(0, 1)).map((s) => { dist.set(s, 0); return s; });
  while (queue.length) {
    const u = queue.shift()!;
    for (const [a, b] of edges) if (a === u && !dist.has(b)) { dist.set(b, dist.get(u)! + 1); queue.push(b); }
  }
  const maxD = Math.max(0, ...[...dist.values()]);
  const layers: string[][] = Array.from({ length: maxD + 1 }, () => []);
  for (const l of [...set].sort()) layers[dist.get(l) ?? maxD].push(l);
  return layers;
}

function goalUnary(meta: Meta, pred: string): string | null {
  return meta.goal.filter((l) => l > 0).map((l) => meta.props[l - 1])
    .map((n) => n.match(new RegExp(`^${pred}\\(([^)]+)\\)`))?.[1]).find(Boolean) ?? null;
}

// ---- islands ----
export interface IslandsWorld {
  locations: string[]; layers: string[][];
  bridges: [string, string][]; waters: [string, string][];
  figureAt: string | null; goalLoc: string | null;
}
export function islandsWorld(meta: Meta, lits: Lit[]): IslandsWorld {
  const trues = trueNameSet(meta, lits);
  const bridges = staticEdges(meta, "bridge");
  const waters = staticEdges(meta, "water");
  const locs = new Set<string>();
  for (const [a, b] of [...bridges, ...waters]) { locs.add(a); locs.add(b); }
  for (const a of meta.atoms) if (a.pred === "swimmerat") locs.add(a.args[0]);
  let figureAt: string | null = null;
  for (const a of meta.atoms) if (a.pred === "swimmerat" && trues.has(a.name)) figureAt = a.args[0];
  const undirected: [string, string][] = [...bridges, ...waters];
  return {
    locations: [...locs].sort(), layers: layerByDistance([...locs], undirected),
    bridges, waters, figureAt, goalLoc: goalUnary(meta, "swimmerat"),
  };
}

// ---- first-responders ----
export interface RespondersWorld {
  locations: string[]; layers: string[][]; roads: [string, string][];
  medicAt: string | null; fires: Set<string>; victims: Set<string>; saved: Set<string>;
}
export function respondersWorld(meta: Meta, lits: Lit[]): RespondersWorld {
  const trues = trueNameSet(meta, lits);
  const roads = staticEdges(meta, "road");
  const locs = new Set<string>();
  for (const [a, b] of roads) { locs.add(a); locs.add(b); }
  for (const a of meta.atoms) if (["medicat", "fire", "saved"].includes(a.pred)) locs.add(a.args[0]);
  let medicAt: string | null = null;
  const fires = new Set<string>(), saved = new Set<string>();
  for (const a of meta.atoms) if (trues.has(a.name)) {
    if (a.pred === "medicat") medicAt = a.args[0];
    else if (a.pred === "fire") fires.add(a.args[0]);
    else if (a.pred === "saved") saved.add(a.args[0]);
  }
  const victims = new Set<string>();
  for (const s of meta.statics ?? []) { const m = s.match(/^victim\(([^)]+)\)$/); if (m) victims.add(m[1]); }
  return { locations: [...locs].sort(), layers: layerByDistance([...locs], roads), roads, medicAt, fires, victims, saved };
}

// ---- earth-observation (satellite imaging ground patches) ----
export interface SatelliteWorld {
  patches: string[]; over: string | null; imaged: Set<string>;
}
export function satelliteWorld(meta: Meta, lits: Lit[]): SatelliteWorld {
  const trues = trueNameSet(meta, lits);
  const patches = new Set<string>();
  for (const a of meta.atoms) if (a.pred === "over" || a.pred === "imaged") patches.add(a.args[0]);
  for (const s of meta.statics ?? []) { const m = s.match(/^adj\(([^,]+),([^)]+)\)$/); if (m) { patches.add(m[1]); patches.add(m[2]); } }
  let over: string | null = null;
  const imaged = new Set<string>();
  for (const a of meta.atoms) if (trues.has(a.name)) {
    if (a.pred === "over") over = a.args[0];
    else if (a.pred === "imaged") imaged.add(a.args[0]);
  }
  return { patches: [...patches].sort(), over, imaged };
}
