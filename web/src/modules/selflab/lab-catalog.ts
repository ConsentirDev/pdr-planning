// Mirror of pdr/web.py `_lab_catalog()` — the stable structural data the bench's
// config builder needs (preset NAMES, tunable feature keys, the curriculum). The
// backend resolves presets by name and does the real evaluation, so only these
// labels live here. Keep in sync with operators.py seed_operators().

export interface SeamSpec { keys: string[]; baseline: string; presets: string[] }

export const LAB: {
  curriculum: { train: string[]; valid: string[]; test: string[] };
  seams: Record<string, SeamSpec>;
} = {
  curriculum: {
    train: ["logistics-3-2", "logistics-4-3", "blocks-3", "blocks-4", "logistics-5-3"],
    valid: ["logistics-6-3", "logistics-5-4", "blocks-5", "blocks-6", "logistics-7-3", "logistics-7-4"],
    test: ["logistics-8-3", "logistics-6-5", "logistics-7-5", "blocks-7"],
  },
  seams: {
    progression: {
      keys: ["i_frac", "goalsat", "ntrue", "bias"],
      baseline: "baseline-F1",
      presets: ["baseline-F1", "fixed-F2", "fixed-F3", "deep-when-far", "llm-adaptive-depth", "llm-discovered-smooth"],
    },
    obligation: {
      keys: ["recency", "goalsat", "ntrue", "bias"],
      baseline: "baseline-recency",
      presets: ["baseline-recency", "greedy-goal", "goal+dfs", "few-true-first", "llm-goal-dfs-simple"],
    },
    reason: {
      keys: ["is_pos", "in_goal", "pid", "bias"],
      baseline: "baseline-idorder",
      presets: ["baseline-idorder", "drop-positive-first", "drop-nongoal-first"],
    },
  },
};

export const PROBLEM_SETS = [
  { id: "curriculum", label: "full curriculum (train+valid)" },
  { id: "valid", label: "validation only (held-out)" },
  { id: "train", label: "training only" },
  { id: "pddl", label: "a problem I load (PDDL)" },
] as const;

// shape returned by the evaluate endpoint
export interface PerInstance {
  name: string; set: string; sat: number | null; ms?: number | null; ok: boolean | null;
  note?: string; baseline_sat: number | null; baseline_ms?: number | null;
}
export interface EvalResult {
  op: { name: string; origin: string; kind: string; spec: any };
  sat_calls: number; coverage: number; n: number; safe: boolean; wall: number;
  baseline_name: string; baseline_sat: number; baseline_safe: boolean;
  per_instance: PerInstance[];
}
