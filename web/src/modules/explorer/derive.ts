import type { Ev, Lit, Meta } from "../../lib/trace/types";

// Replay events[0..cursor] into the view-state the Explorer renders. Pure +
// cheap (small traces), recomputed whenever the cursor moves.

export interface Obl { state: Lit[]; layer: number }
export interface ProgressArrow { from: Lit[]; to: Lit[]; fromLayer: number; toLayer: number; actions: string[][] }

export interface ExplorerState {
  k: number;
  layers: Lit[][][]; // layers[i] = list of forbidden "reason" cubes (dead-ends) at depth i
  current: Obl | null; // obligation being processed
  arrow: ProgressArrow | null; // last progression (state -> successor, one layer closer)
  deadend: { state: Lit[]; reason: Lit[]; layer: number } | null;
  reschedule: { state: Lit[]; toLayer: number } | null;
  reasons: number;
  progressions: number;
  plan: string[][] | null;
  done: "plan" | "unsat" | null;
  lastKind: string;
}

const key = (cube: Lit[]) => cube.join(",");

export function deriveExplorer(meta: Meta, events: Ev[], cursor: number): ExplorerState {
  const layers: Lit[][][] = [[]]; // L0
  const seen: Set<string>[] = [new Set()];
  let k = 0;
  let current: Obl | null = null;
  let arrow: ProgressArrow | null = null;
  let deadend: ExplorerState["deadend"] = null;
  let reschedule: ExplorerState["reschedule"] = null;
  let reasons = 0;
  let progressions = 0;
  let plan: string[][] | null = null;
  let done: ExplorerState["done"] = null;
  let lastKind = "";

  const ensure = (i: number) => {
    while (layers.length <= i) { layers.push([]); seen.push(new Set()); }
  };
  const addReason = (i: number, cube: Lit[]) => {
    ensure(i);
    const kk = key(cube);
    if (!seen[i].has(kk)) { seen[i].add(kk); layers[i].push(cube); }
  };

  for (let n = 0; n <= cursor && n < events.length; n++) {
    const e = events[n];
    lastKind = e.t;
    // only the most-recent transient highlights survive
    if (e.t !== "progress") arrow = arrow && n === cursor ? arrow : arrow;
    switch (e.t) {
      case "k":
        k = e.k; ensure(k); arrow = null; deadend = null; reschedule = null; break;
      case "pop":
        current = { state: e.state, layer: e.layer }; arrow = null; deadend = null; reschedule = null; break;
      case "progress":
        arrow = { from: e.state, to: e.successor, fromLayer: e.layer, toLayer: e.succ_layer, actions: e.actions };
        progressions++; deadend = null; break;
      case "reason": {
        const upto = e.upto ?? e.layer;
        for (let j = 0; j <= upto; j++) addReason(j, e.reason);
        deadend = { state: e.state, reason: e.reason, layer: e.layer };
        reasons++; arrow = null; break;
      }
      case "reschedule":
        reschedule = { state: e.state, toLayer: e.to_layer }; break;
      case "push": {
        const reason = e.clause.map((l) => -l); // ¬clause = the forbidden cube
        addReason(e.layer, reason); break;
      }
      case "plan":
        plan = e.plan; done = "plan"; break;
      case "converged":
        done = "unsat"; break;
    }
  }

  return { k, layers, current, arrow, deadend, reschedule, reasons, progressions, plan, done, lastKind };
}

// human label for a reason cube: positive facts only (mirrors the thesis tables)
export function cubeFacts(meta: Meta, cube: Lit[]): { name: string; pos: boolean }[] {
  return cube.map((l) => ({ name: meta.props[Math.abs(l) - 1], pos: l > 0 }));
}
