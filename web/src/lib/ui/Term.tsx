import "./term.css";

// A hover/focus glossary popover. Wrap any technical term: <Term k="obligation">.
// Definitions are written for a planning-literate reader and cite the thesis, so
// an expert hovering anything sees we mean the real thing.
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
};

export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const g = GLOSSARY[k];
  if (!g) return <>{children ?? k}</>;
  return (
    <span className="term" tabIndex={0}>
      {children ?? g.label}
      <span className="term-pop" role="tooltip">
        <span className="term-pop-label">{g.label}</span>
        <span className="term-pop-def">{g.def}</span>
        {g.ref && <span className="term-pop-ref">📑 {g.ref}</span>}
      </span>
    </span>
  );
}
