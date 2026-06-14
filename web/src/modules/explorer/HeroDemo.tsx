import { motion } from "framer-motion";

// A self-contained, looping micro-animation of the core idea: a search token
// stepping backward through the reachability "fences" toward the goal, with
// reasons (amber sparks) being learned along the way. Pure decoration — sells
// the concept before a single real run.
const COLS = [0, 1, 2, 3]; // L3 (far) .. L0 (goal)
const W = 560, H = 210, PAD = 40;
const colX = (i: number) => PAD + (i * (W - 2 * PAD)) / (COLS.length - 1);

export function HeroDemo() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 560, display: "block" }} aria-hidden>
      <defs>
        <filter id="hglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="hpath" x1="0" x2="1">
          <stop offset="0" stopColor="var(--cyan)" stopOpacity="0.1" />
          <stop offset="1" stopColor="var(--mint)" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {/* fence columns */}
      {COLS.map((i) => {
        const x = colX(i);
        const isGoal = i === COLS.length - 1;
        return (
          <g key={i}>
            <rect x={x - 26} y={28} width={52} height={H - 70} rx={6}
                  fill={isGoal ? "rgba(89,242,176,0.06)" : "rgba(58,214,223,0.03)"}
                  stroke={isGoal ? "var(--mint)" : "var(--line)"} strokeWidth={1} />
            <text x={x} y={H - 22} textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize="11"
                  fill={isGoal ? "var(--mint)" : "var(--tx-3)"}>
              {isGoal ? "L0·goal" : `L${COLS.length - 1 - i}`}
            </text>
            {/* learned-reason sparks */}
            {!isGoal && [0, 1, 2].map((j) => (
              <motion.circle key={j} cx={x} cy={52 + j * 30} r={3} fill="var(--amber)"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 0.7, 1, 0], scale: [0, 1.4, 1, 1, 0] }}
                transition={{ duration: 5, times: [0, 0.12, 0.2, 0.85, 1], repeat: Infinity,
                  delay: 0.5 + i * 0.5 + j * 0.25, ease: "easeInOut" }} />
            ))}
          </g>
        );
      })}

      {/* the goal node */}
      <motion.circle cx={colX(3)} cy={H / 2 - 6} r={9} fill="var(--mint)" filter="url(#hglow)"
        animate={{ scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />

      {/* the search token stepping toward the goal */}
      <motion.g
        animate={{ x: [colX(0), colX(1), colX(2), colX(3)] }}
        transition={{ duration: 5, times: [0, 0.32, 0.62, 0.9], repeat: Infinity, ease: "easeInOut" }}>
        <motion.circle cx={0} cy={H / 2 - 6} r={6} fill="var(--cyan)" filter="url(#hglow)"
          animate={{ opacity: [0, 1, 1, 1, 0] }}
          transition={{ duration: 5, times: [0, 0.06, 0.5, 0.92, 1], repeat: Infinity }} />
      </motion.g>
    </svg>
  );
}
