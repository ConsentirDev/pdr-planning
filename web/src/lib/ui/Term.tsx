import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./term.css";

// A hover/focus glossary popover. Wrap any technical term: <Term k="obligation">.
// Definitions are written for a planning-literate reader and cite the thesis, so
// an expert hovering anything sees we mean the real thing. The popover renders in
// a portal with viewport clamping, so it can never be clipped by a panel.
export const GLOSSARY: Record<string, { label: string; def: string; ref?: string }> = {
  pdr: {
    label: "PDR / IC3",
    def: "Property Directed Reachability: prove reachability incrementally by maintaining frames (fences) of clauses and discharging proof obligations with a SAT solver — never building the whole state space.",
    ref: "Bradley 2011; thesis Ch 3",
  },
  fence: {
    label: "fence (frame Fᵢ)",
    def: "A CNF over-approximation of the states that can reach the goal in ≤ i steps. F₀ is the goal itself. A state is “in Fᵢ” iff it satisfies every clause in Fᵢ.",
    ref: "Algorithm 2, Ch 3",
  },
  obligation: {
    label: "proof obligation",
    def: "A state PDR must resolve: can it step one fence closer to the goal? Pulled from a priority queue, lowest layer first. Resolving it either yields a successor (progress) or a learned reason (dead-end).",
    ref: "Algorithm 2",
  },
  reason: {
    label: "learned reason",
    def: "A small set of facts (a cube) proven unable to reach the goal within i steps. Its negation is added as a clause to every fence up to i, so the search never revisits that region. Reasons are minimised to generalise as far as soundly possible.",
    ref: "reason minimisation, Ch 3",
  },
  forallstep: {
    label: "∀-step encoding",
    def: "A SAT encoding where one time step may fire several mutually non-interfering actions at once. This collapses plan length and the number of SAT calls. The thesis defines five ∀-step schemas.",
    ref: "Schemas 1–5, Ch 3",
  },
  clause: {
    label: "clause / cube",
    def: "A cube is a conjunction of literals (a partial state); a clause is a disjunction (the negation of a blocked cube). A fence is a set of clauses; blocking a dead-end cube means adding its negated clause.",
  },
  sat: {
    label: "SAT query",
    def: "Each PDR step is a Boolean satisfiability question: does a truth assignment exist satisfying the encoded transition plus the target fence? Answered by a real solver — lingeling on the backend, a pure-Python DPLL in the browser.",
  },
  push: {
    label: "clause pushing",
    def: "Propagating a learned clause forward to a later fence when it still holds there. Strengthens the frames and drives the convergence test.",
    ref: "Algorithm 2",
  },
  reschedule: {
    label: "reschedule",
    def: "When a state can’t progress at layer i, it is re-queued at a looser layer to be retried once the fences have learned more.",
  },
  converged: {
    label: "convergence",
    def: "When two adjacent fences become equal, nothing more can be learned — PDR has proved no plan exists, without ever enumerating the whole state space.",
    ref: "termination, Ch 3",
  },
  strongcyclic: {
    label: "strong-cyclic policy",
    def: "A FOND policy that, under fairness, reaches the goal from every reachable state no matter how the nondeterminism resolves. The acceptance criterion for FOND-PDR.",
    ref: "Ch 6",
  },
  frame: {
    label: "frame axiom",
    def: "A constraint saying a fluent keeps its value across a step unless an applied action changes it. Without frame axioms the encoding could “teleport” the state.",
  },
  lookahead: {
    label: "look-ahead depth (F)",
    def: "How many ∀-step transitions one obligation expands per SAT call. F=1 is baseline PDR; PDR-M with larger F peeks several fences ahead — more SAT work per call, but fewer calls overall. PDR-IL interleaves layers.",
    ref: "PDR-M / PDR-IL, Ch 3",
  },
  decomposition: {
    label: "decomposition (PD-PDR)",
    def: "Split the goal into independent sub-goals via a dependency graph, solve each as a small sub-problem, then concatenate the plans. If two sub-plans conflict over a shared resource (e.g. fuel), the offending parts are MERGED and re-solved as one.",
    ref: "Ch 5",
  },
  grounding: {
    label: "grounding",
    def: "Instantiating a lifted PDDL domain (action schemas with variables) into concrete ground actions and propositions over the problem's objects — the Boolean variables the SAT encoding then operates on.",
  },
};

const POP_W = 300;

export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const g = GLOSSARY[k];
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // clamp horizontally so the (centred) box stays on screen
    const half = POP_W / 2 + 10;
    const x = Math.max(half, Math.min(window.innerWidth - half, r.left + r.width / 2));
    const above = r.top > 230; // open upward if there's room, else downward
    setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  if (!g) return <>{children ?? k}</>;
  return (
    <>
      <span ref={ref} className="term" tabIndex={0}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {children ?? g.label}
      </span>
      {pos && createPortal(
        <span className={`term-pop ${pos.above ? "above" : "below"}`} role="tooltip"
          style={{ left: pos.x, top: pos.y }}>
          <span className="term-pop-label">{g.label}</span>
          <span className="term-pop-def">{g.def}</span>
          {g.ref && <span className="term-pop-ref">📑 {g.ref}</span>}
        </span>,
        document.body,
      )}
    </>
  );
}
