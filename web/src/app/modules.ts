import type { ComponentType } from "react";
import { lazy } from "react";

// Module registry. Each module is a self-contained feature consuming the trace
// schema. Lazy-loaded so a parallel-built module can't break the rest.
export interface ModuleDef {
  id: string;
  label: string;
  blurb: string;
  glyph: string;
  Component: ComponentType;
}

export const MODULES: ModuleDef[] = [
  {
    id: "explorer",
    label: "PDR Explorer",
    blurb: "Watch the layers learn backward from the goal.",
    glyph: "▣",
    Component: lazy(() => import("../modules/explorer/Explorer")),
  },
  {
    id: "fond",
    label: "FOND Policies",
    blurb: "Plan when the world is unpredictable. AND/OR graphs.",
    glyph: "⌖",
    Component: lazy(() => import("../modules/fond/Fond")),
  },
  {
    id: "selflab",
    label: "Self-Improvement Lab",
    blurb: "Evolve new search operators. Watch them compete.",
    glyph: "✦",
    Component: lazy(() => import("../modules/selflab/SelfLab")),
  },
  {
    id: "racedecomp",
    label: "Race & Decompose",
    blurb: "Variants head-to-head; problems split into chunks.",
    glyph: "⇶",
    Component: lazy(() => import("../modules/racedecomp/RaceDecomp")),
  },
  {
    id: "pddl",
    label: "PDDL Loader",
    blurb: "Bring your own problem. Parse, ground, solve.",
    glyph: "◫",
    Component: lazy(() => import("../modules/pddl/PddlLoader")),
  },
];
