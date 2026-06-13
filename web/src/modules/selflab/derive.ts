import type { Ev } from "../../lib/trace/types";

// ---- narrowed event shapes (the "generation" Ev variant) ----
export interface Candidate {
  name: string;
  origin: string;
  sat_calls: number;
  safe: boolean;
}
export interface BestOp {
  name: string;
  origin: string;
  sat_calls: number;
  train: number;
  valid: number;
  spec: any;
}
export interface ArchiveEntry {
  name: string;
  sat_calls: number;
}
export interface GenerationEv {
  t: "generation";
  gen: number;
  seam: string;
  baseline: number;
  best: BestOp;
  candidates: Candidate[];
  archive: ArchiveEntry[];
}

export type Seam = "progression" | "reason" | "obligation";

export const isGeneration = (ev: Ev | undefined | null): ev is GenerationEv =>
  !!ev && ev.t === "generation";

// view-state derived from events.slice(0, cursor+1)
export interface SelfLabState {
  gen: number; // 1-based generation number being shown
  totalGens: number;
  seam: string;
  baseline: number;
  best: BestOp;
  candidates: Candidate[];
  archive: ArchiveEntry[];
  worst: number; // largest sat_calls seen (for bar scaling)
  isFirst: boolean;
  improvedFromPrev: boolean; // best improved vs previous generation
}

export function deriveSelfLab(events: Ev[], cursor: number): SelfLabState | null {
  const gens = events.filter(isGeneration);
  if (gens.length === 0) return null;
  // clamp cursor to a generation index (events are all generations here)
  const idx = Math.max(0, Math.min(gens.length - 1, cursor));
  const cur = gens[idx];
  const prev = idx > 0 ? gens[idx - 1] : null;

  // scale denominator: the largest number we want bars to be relative to —
  // the baseline or the worst archived operator, whichever is larger.
  let worst = cur.baseline;
  for (const a of cur.archive) worst = Math.max(worst, a.sat_calls);
  for (const c of cur.candidates) if (c.safe) worst = Math.max(worst, c.sat_calls);

  return {
    gen: cur.gen,
    totalGens: gens.length,
    seam: cur.seam,
    baseline: cur.baseline,
    best: cur.best,
    candidates: cur.candidates,
    archive: cur.archive,
    worst,
    isFirst: idx === 0,
    improvedFromPrev: prev ? cur.best.sat_calls < prev.best.sat_calls : false,
  };
}

// ---- spec rendering helpers ----
export type SpecKind = "source" | "weights" | "unknown";

export function classifySpec(spec: any, origin: string, kind?: string): SpecKind {
  if (kind === "source" || kind === "template") {
    return kind === "source" ? "source" : "weights";
  }
  if (typeof spec === "string") return "source";
  if (origin === "llm" || origin === "llm-discovered") return "source";
  if (spec && typeof spec === "object") return "weights";
  return "unknown";
}

export interface WeightRow {
  key: string;
  value: number;
}
export function toWeightRows(spec: any): WeightRow[] {
  if (!spec || typeof spec !== "object") return [];
  return Object.entries(spec)
    .filter(([, v]) => typeof v === "number")
    .map(([key, value]) => ({ key, value: value as number }));
}

// ratio with one decimal, e.g. 2.4
export function ratio(baseline: number, evolved: number): string {
  if (!evolved) return "—";
  return (baseline / evolved).toFixed(1);
}
