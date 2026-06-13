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
