// TypeScript mirror of pdr/trace.py + pdr/web.py. The single source of truth for
// the data contract between the Python solvers and the UI.

export type Lit = number; // signed: +id = prop true, -id = prop false; id = index+1

export interface Atom {
  id: number;
  name: string; // e.g. "at(P0,L0)"
  pred: string; // "at"
  args: string[]; // ["P0","L0"]
}

export interface ActionMeta {
  name: string;
  pre: Lit[];
  eff?: Lit[]; // classical
  outcomes?: Lit[][]; // FOND
}

export interface Meta {
  kind: "classical" | "fond";
  name: string;
  props: string[];
  atoms: Atom[];
  init: Lit[];
  goal: Lit[];
  invariants: Lit[][];
  render: "logistics" | "blocksworld" | "tireworld" | "faults" | "generic";
  actions: ActionMeta[];
  max_outcomes?: number;
  statics?: string[]; // ground static-atom names (e.g. road topology), if any
}

// ---- event union (the `t` discriminator matches trace.py) ----
export type Ev =
  // classical PDR
  | { t: "k"; k: number }
  | { t: "pop"; state: Lit[]; layer: number; qsize: number }
  | { t: "progress"; state: Lit[]; layer: number; successor: Lit[]; succ_layer: number; actions: string[][] }
  | { t: "reason"; state: Lit[]; layer: number; reason: Lit[]; upto?: number }
  | { t: "reschedule"; state: Lit[]; to_layer: number }
  | { t: "push"; layer: number; clause: Lit[] }
  | { t: "converged"; k: number }
  | { t: "plan"; plan: string[][]; steps: number; trivial?: boolean }
  // FOND
  | { t: "arc"; state: Lit[]; action: string; outcomes: Lit[][]; is_goal: boolean[] }
  | { t: "policy"; solved: Lit[][]; policy: [Lit[], string][]; has_init: boolean }
  | { t: "no_policy"; k: number; by: string }
  | { t: "has_policy"; by: string; states: number }
  // PD-PDR
  | { t: "iteration"; iteration: number; chunks: string[][]; edges: [string[], string[]][]; subgoals: string[][] }
  | { t: "subproblems"; iteration: number; subproblems: { goal: string[]; solvable: boolean | null; plan: string[][] }[] }
  | { t: "merge"; iteration: number; reason: string; problematic?: string }
  | { t: "concrete_plan"; iteration: number; plan: string[][] }
  // evolution
  | {
      t: "generation";
      gen: number;
      seam: string;
      baseline: number;
      best: { name: string; origin: string; sat_calls: number; train: number; valid: number; spec: any };
      candidates: { name: string; origin: string; sat_calls: number; safe: boolean }[];
      archive: { name: string; sat_calls: number }[];
    };

export interface Stats {
  sat_calls?: number;
  k?: number;
  reasons?: number;
  states?: number;
  decided_by?: string;
  iterations?: number;
  [k: string]: unknown;
}

export interface PdrResult { solvable: boolean | null; plan: string[][]; stats: Stats }
export interface FondResult { has_policy: boolean | null; truth: boolean; stats: Stats }

export interface Trace {
  module: "pdr" | "race" | "fond" | "decomp" | "evolve";
  meta?: Meta | { seam: string; split: boolean };
  events?: Ev[];
  runs?: { name: string; events: Ev[]; result: PdrResult }[];
  result?: any;
}

// ---- run specification (what the UI sends to run_trace) ----
export interface Spec {
  module: Trace["module"];
  domain?: string;
  params?: Record<string, any>;
  config?: Record<string, any>;
  seam?: string;
  variants?: { name: string; variant: string; F: number }[];
}

// ---- literal helpers ----
export const litTrue = (l: Lit) => l > 0;
export const litId = (l: Lit) => Math.abs(l);
export const litName = (meta: Meta, l: Lit) => meta.props[Math.abs(l) - 1];
