import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./auth-gate.css";

// ============================================================================
// THE REACHABILITY CHECKPOINT — a deliberately unhinged, four-act login gauntlet.
//
// Honesty: this is THEATRE, not security. The real gate is the backend token.
// This just makes a freshly-minted planning PhD laugh before she reaches the app.
// The "password" is that Ava is now Dr Clifton. 🎓
// ============================================================================

const ADMIT_KEY = "pdr-admitted-v1";
export const isAdmitted = () => sessionStorage.getItem(ADMIT_KEY) === "1";

const ACCEPT = ["dr clifton", "doctor clifton", "dr. clifton", "ava clifton",
  "dr ava clifton", "ava", "clifton", "dr c"];

const INSULTS = [
  "WEAK.", "NOT MINIMAL.", "REJECTED WITHOUT REVIEW.", "absolutely unsatisfiable.",
  "that isn't even a real word, Brenda.", "have you tried being correct?",
  "the committee laughed. AT you.", "Reviewer 2 wrote three pages about this.",
  "no. NO. a thousand times no.", "this state cannot reach the goal.",
];

const HINTS = [
  "psst — someone in this room recently survived a thesis defense.",
  "❌ Reviewer 2 is unconvinced. (it is a DOCTOR of something…)",
  "❌❌ the committee is whispering. (Dr C_______)",
  "❌❌❌ oh for the love of STRIPS — it is literally “Dr Clifton”. TYPE IT.",
  "are you okay? blink twice. the password is “Dr Clifton”. i believe in you.",
];

const RAIN = ["🚫", "❌", "📉", "😤", "🛑", "🙅", "📋", "💢"];
const CONFETTI = ["🎓", "🎉", "✨", "🛰️", "🚗", "🧱", "⛓️", "🏆", "🥳", "📈", "💅", "🤓"];

export function AuthGate({ onAdmit }: { onAdmit: () => void }) {
  const [act, setAct] = useState<"bouncer" | "captcha" | "oath" | "deliberation">("bouncer");
  const next = useCallback((to: typeof act) => setAct(to), []);

  return (
    <div className="ag-root">
      <div className="bp-canvas" />
      <div className="bp-aura ag-aura" />
      <div className="bp-grain" />
      <button className="ag-skip" onClick={onAdmit} title="developer escape hatch">
        skip (i’m just the dev, i have no soul)
      </button>

      <div className="ag-stage">
        <AnimatePresence mode="wait">
          {act === "bouncer" && <Bouncer key="b" onPass={() => next("captcha")} />}
          {act === "captcha" && <Captcha key="c" onPass={() => next("oath")} />}
          {act === "oath" && <Oath key="o" onPass={() => next("deliberation")} />}
          {act === "deliberation" && <Deliberation key="d" onPass={onAdmit} />}
        </AnimatePresence>
      </div>

      <div className="ag-progress">
        {(["bouncer", "captcha", "oath", "deliberation"] as const).map((a, i) => (
          <span key={a} className={`ag-pip ${act === a ? "on" : ""} ${
            ["bouncer", "captcha", "oath", "deliberation"].indexOf(act) > i ? "done" : ""}`} />
        ))}
      </div>
    </div>
  );
}

function actWrap(children: React.ReactNode) {
  return (
    <motion.div className="ag-card"
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -24, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}>
      {children}
    </motion.div>
  );
}

// ---- ACT I — the bouncer ---------------------------------------------------
function Bouncer({ onPass }: { onPass: () => void }) {
  const [val, setVal] = useState("");
  const [fails, setFails] = useState(0);
  const [insult, setInsult] = useState("");
  const [shake, setShake] = useState(0);
  const [rain, setRain] = useState(false);
  const [dodge, setDodge] = useState({ x: 0, y: 0 });
  const [won, setWon] = useState(false);

  const submit = () => {
    if (ACCEPT.includes(val.trim().toLowerCase())) {
      setWon(true);
      setTimeout(onPass, 1700);
      return;
    }
    setFails((f) => f + 1);
    setInsult(INSULTS[Math.floor(Math.random() * INSULTS.length)]);
    setShake((s) => s + 1);
    setRain(true);
    setTimeout(() => setRain(false), 1400);
  };

  // the submit button flees the cursor — but only acts 2-4, then gives up, defeated
  const flee = () => {
    if (fails < 1 || fails > 3) return;
    setDodge({ x: (Math.random() - 0.5) * 280, y: (Math.random() - 0.5) * 120 });
  };

  return actWrap(
    <>
      {won ? (
        <motion.div className="ag-win" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Confetti />
          <div className="ag-bouncer-emoji" style={{ filter: "none" }}>🎩</div>
          <h1 className="ag-h1 mint">AH. DOCTOR.</h1>
          <p className="ag-lede">A thousand pardons. I didn’t recognise you with the
            <em> qualifications</em>. Right this way…</p>
        </motion.div>
      ) : (
        <>
          {rain && <EmojiRain set={RAIN} />}
          <motion.div className="ag-bouncer-emoji"
            animate={{ rotate: [0, -4, 4, -3, 0] }} transition={{ duration: 3, repeat: Infinity }}>
            🕴️
          </motion.div>
          <div className="ag-kicker">⛓ the velvet fence · access control ⛓</div>
          <h1 className="ag-h1">STATE YOUR TITLE.</h1>
          <p className="ag-lede">This is a <b>strong-cyclic</b> establishment. We do not admit
            riff-raff, undergraduates, or unresolved nondeterminism. Riff-raff get pushed to layer&nbsp;∞.</p>

          <motion.div className="ag-inputrow" key={shake}
            animate={shake ? { x: [0, -16, 14, -10, 8, 0] } : {}} transition={{ duration: 0.45 }}>
            <input autoFocus className={`ag-input ${insult ? "bad" : ""}`} value={val}
              placeholder="your hard-earned honorific…"
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
            <motion.button className="ag-go" onClick={submit} onMouseEnter={flee}
              animate={{ x: dodge.x, y: dodge.y }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
              {fails > 3 ? "fine. enter. →" : "ENTER →"}
            </motion.button>
          </motion.div>

          {insult && <motion.div className="ag-insult" key={insult}
            initial={{ scale: 2.4, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: -7 }}>
            {insult}
          </motion.div>}
          <p className="ag-hint">{HINTS[Math.min(fails, HINTS.length - 1)]}</p>
        </>
      )}
    </>
  );
}

// ---- ACT II — the anti-planner CAPTCHA -------------------------------------
const CAP_PROMPTS = [
  "UNRESOLVED NONDETERMINISM", "EXISTENTIAL DREAD", "things Reviewer 2 would reject",
  "VIBES", "states that cannot reach the goal", "your unfinished side-projects",
];
const CAP_TILES = ["🌀", "🔥", "🫠", "💀", "🛰️", "🚗", "🧱", "⛓️", "🐙", "👁️", "📉", "🫥"];

function Captcha({ onPass }: { onPass: () => void }) {
  const [prompt] = useState(() => CAP_PROMPTS[Math.floor(Math.random() * CAP_PROMPTS.length)]);
  const [tiles] = useState(() => [...CAP_TILES].sort(() => Math.random() - 0.5).slice(0, 9));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [scold, setScold] = useState("");
  const [verifying, setVerifying] = useState(false);

  const toggle = (i: number) => setSel((s) => {
    const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n;
  });

  const verify = () => {
    if (sel.size === 0) {
      setScold("you selected NOTHING. that is the most nondeterministic answer of all. choose violence (and at least one tile).");
      return;
    }
    setScold("");
    setVerifying(true);
    setTimeout(onPass, 1900);
  };

  return actWrap(
    <>
      <div className="ag-kicker">turing-adjacent verification · form 27-B</div>
      <h1 className="ag-h1 sm">prove you are not<br />an automated planner</h1>
      {verifying ? (
        <div className="ag-verify">
          <Spinner />
          <p className="ag-lede">{`${(93 + Math.random() * 6).toFixed(1)}% human. honestly, lower than we hoped, but close enough.`}</p>
        </div>
      ) : (
        <>
          <p className="ag-lede">Select every square containing <b className="amber">{prompt}</b>.
            An honest mistake is fine; we are not FOND-SAT.</p>
          <div className="ag-grid">
            {tiles.map((t, i) => (
              <button key={i} className={`ag-tile ${sel.has(i) ? "sel" : ""}`} onClick={() => toggle(i)}>
                <span>{t}</span>
              </button>
            ))}
          </div>
          {scold && <p className="ag-insult sm">{scold}</p>}
          <button className="ag-go wide" onClick={verify}>VERIFY MY HUMANITY →</button>
        </>
      )}
    </>
  );
}

// ---- ACT III — the oath (press & hold) -------------------------------------
const OATH_LABELS: [number, string][] = [
  [0, "place cursor upon the seal…"],
  [12, "summoning the committee…"],
  [34, "checking your vibes…"],
  [52, "verifying you are not Reviewer 2…"],
  [71, "bribing the SAT solver…"],
  [88, "achieving strong cyclicity…"],
  [97, "it’s happening. don’t let go…"],
];

function Oath({ onPass }: { onPass: () => void }) {
  const [pct, setPct] = useState(0);
  const [broke, setBroke] = useState(false);
  const holding = useRef(false);
  const raf = useRef<number | null>(null);

  const tick = useCallback(() => {
    setPct((p) => {
      const np = Math.min(100, p + 1.15);
      if (np >= 100) { holding.current = false; setTimeout(onPass, 700); return 100; }
      return np;
    });
    if (holding.current) raf.current = requestAnimationFrame(tick);
  }, [onPass]);

  const start = () => {
    if (pct >= 100) return;
    holding.current = true; setBroke(false);
    raf.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (!holding.current || pct >= 100) return;
    holding.current = false;
    if (raf.current) cancelAnimationFrame(raf.current);
    setBroke(true);
    setPct(0);
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const label = pct >= 100 ? "OATH SWORN. ⚖️"
    : [...OATH_LABELS].reverse().find(([t]) => pct >= t)?.[1] ?? "";
  const R = 86, C = 2 * Math.PI * R;

  return actWrap(
    <>
      <div className="ag-kicker">binding magical contract · clause 6.6</div>
      <h1 className="ag-h1 sm">the oath of<br />strong cyclicity</h1>
      <p className="ag-lede">Press and <b>hold</b> the seal. You swear your policy reaches the goal under
        all fairness, that you will never cite Reviewer 2, and that you genuinely think this app is cool.</p>

      <div className="ag-seal-wrap"
        onMouseDown={start} onMouseUp={stop} onMouseLeave={stop}
        onTouchStart={start} onTouchEnd={stop}>
        <svg viewBox="0 0 200 200" className="ag-seal">
          <circle cx="100" cy="100" r={R} className="ag-seal-track" />
          <circle cx="100" cy="100" r={R} className="ag-seal-fill"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 100 100)" />
          <text x="100" y="96" className="ag-seal-emoji">🤚</text>
          <text x="100" y="128" className="ag-seal-pct">{Math.round(pct)}%</text>
        </svg>
      </div>
      <p className={`ag-hint big ${broke ? "broke" : ""}`}>
        {broke ? "💔 COMMITMENT ISSUES DETECTED — that policy was NOT strong-cyclic. hold it like you mean it." : label}
      </p>
    </>
  );
}

// ---- ACT IV — deliberation → ADMITTED --------------------------------------
const DELIB = [
  "consulting the velvet fence…", "asking nature to pick an outcome…",
  "Reviewer 2 is typing…", "Reviewer 2 stopped typing…", "Reviewer 2 is typing again…",
  "minimising your reason…", "pushing you forward one layer…",
  "checking the policy is genuinely strong-cyclic…", "it is. it really is.",
  "confiscating your unresolved nondeterminism…", "it’s happening…",
];

function Deliberation({ onPass }: { onPass: () => void }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (i >= DELIB.length) { setDone(true); setTimeout(onPass, 2400); return; }
    const t = setTimeout(() => setI((x) => x + 1), 230);
    return () => clearTimeout(t);
  }, [i, onPass]);

  return actWrap(
    done ? (
      <motion.div className="ag-win" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        <Confetti big />
        <div className="ag-admit-stamp">✓ ADMITTED</div>
        <h1 className="ag-h1 mint">welcome, Dr Clifton.</h1>
        <p className="ag-lede">You have been admitted to the strong-cyclic establishment.
          Your thesis is now an app. We’re all very normal about it.</p>
      </motion.div>
    ) : (
      <>
        <div className="ag-kicker">the committee is deliberating · do not refresh</div>
        <h1 className="ag-h1 sm">final review</h1>
        <div className="ag-delib">
          {DELIB.slice(Math.max(0, i - 4), i + 1).map((line, k, arr) => (
            <motion.div key={i - (arr.length - 1) + k} className={`ag-delib-line ${k === arr.length - 1 ? "cur" : ""}`}
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: k === arr.length - 1 ? 1 : 0.35, x: 0 }}>
              <span className="ag-delib-tick">▸</span>{line}
            </motion.div>
          ))}
        </div>
        <Spinner />
      </>
    )
  );
}

// ---- bits ------------------------------------------------------------------
function Spinner() {
  return (
    <motion.div className="ag-spinner"
      animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
      ⛓️
    </motion.div>
  );
}

function EmojiRain({ set }: { set: string[] }) {
  const drops = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="ag-rain">
      {drops.map((d) => (
        <span key={d} className="ag-drop" style={{
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 0.6}s`,
          animationDuration: `${0.9 + Math.random() * 0.8}s`,
          fontSize: `${16 + Math.random() * 22}px`,
        }}>{set[d % set.length]}</span>
      ))}
    </div>
  );
}

function Confetti({ big }: { big?: boolean }) {
  const n = big ? 80 : 40;
  const bits = Array.from({ length: n }, (_, i) => i);
  return (
    <div className="ag-confetti">
      {bits.map((b) => (
        <span key={b} className="ag-conf" style={{
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 0.5}s`,
          animationDuration: `${1.4 + Math.random() * 1.4}s`,
          fontSize: `${16 + Math.random() * 26}px`,
        }}>{CONFETTI[b % CONFETTI.length]}</span>
      ))}
    </div>
  );
}
