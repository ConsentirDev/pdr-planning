import type { Ev, Lit, Meta } from "../../lib/trace/types";

// Replay FOND events[0..cursor] into the view-state the AND/OR graph renders.
// Pure + cheap (small traces), recomputed whenever the cursor moves.
//
// FOND = fully-observable nondeterministic planning. From a state, an action
// has SEVERAL possible outcomes and *nature* picks which happens. A solution is
// a strong-cyclic policy: a chosen action per state that — under fairness —
// always *eventually* reaches the goal no matter how the dice fall. FOND-PDR
// discovers an AND/OR graph of hyperarcs and runs a sink-removal policy
// generator until either the initial state is solved (has_policy) or a
// forward-push converges to prove no policy can exist (no_policy).

const skey = (s: Lit[]) => s.join(",");

export interface Arc {
  id: string;            // stable identity: state|action
  from: string;          // source state key
  action: string;
  outcomes: string[];    // outcome state keys
  isGoal: boolean[];     // per-outcome goal flag
  order: number;         // discovery index (for stagger)
}

export interface GNode {
  key: string;
  lits: Lit[];
  depth: number;         // BFS layer from init (root = 0)
  isInit: boolean;
  isGoal: boolean;       // a goal-satisfying outcome state
  order: number;         // discovery index
}

export type Outcome = "running" | "win" | "lose" | null;

export interface FondState {
  k: number;
  nodes: Map<string, GNode>;
  arcs: Arc[];
  // policy snapshot (latest seen so far)
  solved: Set<string>;     // states currently known-solved
  policy: Map<string, string>; // state-key -> chosen action
  hasInit: boolean;        // policy currently covers the init state
  deadends: Set<string>;   // states a "reason" marked as dead
  lastReason: string | null;
  // terminal verdict
  outcome: Outcome;
  decidedBy: string | null;
  policyStates: number | null;
  noPolicyK: number | null;
  // bookkeeping
  initKey: string | null;
  lastKind: string;
  arcCount: number;
  reasonCount: number;
  policySnaps: number;
}

export function deriveFond(meta: Meta, events: Ev[], cursor: number): FondState {
  const nodes = new Map<string, GNode>();
  const arcs: Arc[] = [];
  const arcSeen = new Set<string>();
  let solved = new Set<string>();
  let policy = new Map<string, string>();
  let hasInit = false;
  const deadends = new Set<string>();
  let lastReason: string | null = null;
  let outcome: Outcome = null;
  let decidedBy: string | null = null;
  let policyStates: number | null = null;
  let noPolicyK: number | null = null;
  let k = 0;
  let lastKind = "";
  let arcCount = 0;
  let reasonCount = 0;
  let policySnaps = 0;

  const initKey = meta.init ? skey(meta.init) : null;
  let order = 0;

  const ensureNode = (lits: Lit[], isGoal = false): GNode => {
    const key = skey(lits);
    let n = nodes.get(key);
    if (!n) {
      n = {
        key,
        lits,
        depth: -1,
        isInit: key === initKey,
        isGoal,
        order: order++,
      };
      nodes.set(key, n);
    } else if (isGoal) {
      n.isGoal = true;
    }
    return n;
  };

  // seed the root so the graph never looks empty after k-widen
  if (meta.init) ensureNode(meta.init);

  for (let n = 0; n <= cursor && n < events.length; n++) {
    const e = events[n];
    lastKind = e.t;
    switch (e.t) {
      case "k":
        k = e.k;
        break;
      case "arc": {
        const fromNode = ensureNode(e.state);
        const outKeys: string[] = [];
        e.outcomes.forEach((o, i) => {
          const on = ensureNode(o, !!e.is_goal?.[i]);
          outKeys.push(on.key);
        });
        const id = `${fromNode.key}|${e.action}`;
        if (!arcSeen.has(id)) {
          arcSeen.add(id);
          arcs.push({
            id,
            from: fromNode.key,
            action: e.action,
            outcomes: outKeys,
            isGoal: e.is_goal ?? e.outcomes.map(() => false),
            order: order++,
          });
        }
        arcCount++;
        break;
      }
      case "reason": {
        deadends.add(skey(e.state));
        lastReason = skey(e.state);
        reasonCount++;
        break;
      }
      case "policy": {
        solved = new Set(e.solved.map(skey));
        policy = new Map(e.policy.map(([s, a]) => [skey(s), a]));
        hasInit = e.has_init;
        policySnaps++;
        break;
      }
      case "no_policy":
        outcome = "lose";
        decidedBy = e.by;
        noPolicyK = e.k;
        break;
      case "has_policy":
        outcome = "win";
        decidedBy = e.by;
        policyStates = e.states;
        break;
    }
  }

  // ---- BFS layered layout from the init node over discovered arcs ----
  layout(nodes, arcs, initKey);

  return {
    k,
    nodes,
    arcs,
    solved,
    policy,
    hasInit,
    deadends,
    lastReason,
    outcome,
    decidedBy,
    policyStates,
    noPolicyK,
    initKey,
    lastKind,
    arcCount,
    reasonCount,
    policySnaps,
  };
}

// Assign each node a depth = shortest hop-count from init over arcs (an arc is
// one hop from its source to each outcome). Nodes unreachable from init keep
// the smallest depth seen as an outcome, else trail at the bottom.
function layout(nodes: Map<string, GNode>, arcs: Arc[], initKey: string | null) {
  // adjacency: from -> outcomes
  const adj = new Map<string, string[]>();
  for (const a of arcs) {
    const list = adj.get(a.from) ?? [];
    for (const o of a.outcomes) list.push(o);
    adj.set(a.from, list);
  }
  const queue: string[] = [];
  if (initKey && nodes.has(initKey)) {
    nodes.get(initKey)!.depth = 0;
    queue.push(initKey);
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = nodes.get(cur)!.depth;
    for (const o of adj.get(cur) ?? []) {
      const on = nodes.get(o);
      if (on && on.depth === -1) {
        on.depth = d + 1;
        queue.push(o);
      }
    }
  }
  // any node never reached (orphan outcome of a not-yet-connected arc): give it
  // a depth just past the deepest known node so it still draws somewhere sane.
  let maxD = 0;
  nodes.forEach((nn) => { if (nn.depth > maxD) maxD = nn.depth; });
  nodes.forEach((nn) => { if (nn.depth === -1) nn.depth = maxD + 1; });
}

// ---- positioning: rows by depth, evenly spread within each row ----
export interface Positioned extends GNode { x: number; y: number; }
export interface Geometry {
  width: number;
  height: number;
  nodes: Map<string, Positioned>;
  // action box positions live midway between a source and the centroid of outcomes
  arcBoxes: Map<string, { x: number; y: number }>;
}

const NODE_W = 108;
const NODE_H = 78;
const COL_GAP = 46;
const ROW_GAP = 96;
const PAD_X = 36;
const PAD_Y = 28;

export function geometry(st: FondState): Geometry {
  // group nodes by depth, ordered by discovery for stable left-to-right
  const byDepth = new Map<number, GNode[]>();
  st.nodes.forEach((n) => {
    const arr = byDepth.get(n.depth) ?? [];
    arr.push(n);
    byDepth.set(n.depth, arr);
  });
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  let maxRowCount = 0;
  for (const d of depths) {
    const arr = byDepth.get(d)!;
    arr.sort((a, b) => a.order - b.order);
    if (arr.length > maxRowCount) maxRowCount = arr.length;
  }
  const rowWidth = Math.max(1, maxRowCount) * (NODE_W + COL_GAP) - COL_GAP;
  const width = rowWidth + PAD_X * 2;
  const height =
    (depths.length || 1) * (NODE_H + ROW_GAP) - ROW_GAP + PAD_Y * 2 + 24;

  const pos = new Map<string, Positioned>();
  depths.forEach((d, rowIdx) => {
    const arr = byDepth.get(d)!;
    const totalW = arr.length * (NODE_W + COL_GAP) - COL_GAP;
    const startX = PAD_X + (rowWidth - totalW) / 2;
    const y = PAD_Y + rowIdx * (NODE_H + ROW_GAP) + 24;
    arr.forEach((n, i) => {
      const x = startX + i * (NODE_W + COL_GAP);
      pos.set(n.key, { ...n, x, y });
    });
  });

  // action boxes sit just below the source node, biased toward outcome centroid
  const arcBoxes = new Map<string, { x: number; y: number }>();
  for (const a of st.arcs) {
    const src = pos.get(a.from);
    if (!src) continue;
    const outs = a.outcomes.map((o) => pos.get(o)).filter(Boolean) as Positioned[];
    const cx = outs.length
      ? outs.reduce((s, o) => s + (o.x + NODE_W / 2), 0) / outs.length
      : src.x + NODE_W / 2;
    const sx = src.x + NODE_W / 2;
    arcBoxes.set(a.id, {
      x: (sx + cx) / 2,
      y: src.y + NODE_H + ROW_GAP * 0.42,
    });
  }

  return { width, height, nodes: pos, arcBoxes };
}

export const NODE_DIMS = { w: NODE_W, h: NODE_H };
