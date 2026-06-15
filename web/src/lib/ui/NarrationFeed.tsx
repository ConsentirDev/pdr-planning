import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./narration-feed.css";

// A Learn-mode narration *feed*: instead of replacing one caption on every event
// (which flickers faster than anyone can read), we accumulate the beats into a
// short scrolling log — the current beat is bright, the recent ones fade above
// it, so you can read the story unfold at your own pace and glance back.
//
// Optional read-aloud uses the browser's built-in speech synthesis (no network,
// no data leaves the page); it's off by default and speaks only the newest beat.
export function NarrationFeed({ lines, accent = "cyan" }: { lines: string[]; accent?: "cyan" | "violet" }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [speak, setSpeak] = useState(false);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  // auto-scroll to the newest beat
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  // speak the newest beat when it changes (opt-in)
  const last = lines[lines.length - 1];
  useEffect(() => {
    if (!speak || !canSpeak || !last) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(last);
    u.rate = 1.02;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  }, [last, speak, canSpeak]);

  // stop talking when read-aloud is switched off or the component unmounts
  useEffect(() => {
    if (!speak && canSpeak) window.speechSynthesis.cancel();
    return () => { if (canSpeak) window.speechSynthesis.cancel(); };
  }, [speak, canSpeak]);

  const shown = lines.slice(-6);
  const base = lines.length - shown.length;

  return (
    <div className={`panel nar-feed nar-${accent}`}>
      <div className="nar-feed-h">
        <span className="eyebrow">what's happening</span>
        {canSpeak && (
          <button
            className={`nar-speak ${speak ? "on" : ""}`}
            onClick={() => setSpeak((s) => !s)}
            title={speak ? "stop reading aloud" : "read the narration aloud"}
          >
            {speak ? "🔊 reading" : "🔈 read aloud"}
          </button>
        )}
      </div>
      <div className="nar-feed-body" ref={bodyRef}>
        {shown.length === 0 && (
          <p className="nar-line cur nar-idle">
            Press play to watch the planner think — I'll narrate each move here, one beat at a time.
          </p>
        )}
        <AnimatePresence initial={false}>
          {shown.map((ln, i) => {
            const isCur = i === shown.length - 1;
            return (
              <motion.p
                key={base + i}
                className={`nar-line ${isCur ? "cur" : "past"}`}
                initial={{ opacity: 0, y: 5, filter: "blur(2px)" }}
                animate={{ opacity: isCur ? 1 : 0.42, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.3 }}
              >
                {isCur && <span className="nar-tick">▸</span>}
                {ln}
              </motion.p>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Build the accumulated beat list from a trace: map each applied event to a
// sentence, dropping consecutive duplicates so repeats don't spam the feed.
export function buildBeats<E>(events: E[], cursor: number, line: (ev: E, i: number) => string | null): string[] {
  const out: string[] = [];
  for (let i = 0; i <= cursor && i < events.length; i++) {
    const t = line(events[i], i);
    if (t && t !== out[out.length - 1]) out.push(t);
  }
  return out;
}
