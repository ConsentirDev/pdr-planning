import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./narration-feed.css";

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

// ---------------------------------------------------------------------------
// Guided narration pacer. In Learn mode, playback advances only when the CURRENT
// beat has been consumed — when the voice finishes speaking it (voice on) or after
// a reading-time dwell (voice off). Voice and visuals share one clock, so they can
// never desync. Pausing cancels everything cleanly.
// ---------------------------------------------------------------------------
export function useGuidedNarration(opts: {
  enabled: boolean;        // mode==="learn" && player.playing
  cursor: number;
  total: number;
  text: string | null;     // narration for the CURRENT cursor
  voiceOn: boolean;
  advance: () => void;     // player.advance — steps forward without pausing
}) {
  const { enabled, cursor, total, text, voiceOn, advance } = opts;
  useEffect(() => {
    if (!enabled || cursor >= total - 1) return;
    let cancelled = false;
    const go = () => { if (!cancelled) advance(); };

    if (voiceOn && canSpeak() && text) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      // safety net: if onend never fires (some browsers), advance anyway
      const safety = setTimeout(go, Math.min(12000, 1500 + text.length * 55));
      u.onend = () => { clearTimeout(safety); go(); };
      u.onerror = () => { clearTimeout(safety); go(); };
      window.speechSynthesis.speak(u);
      return () => { cancelled = true; clearTimeout(safety); window.speechSynthesis.cancel(); };
    }
    // voice off → dwell long enough to read the line
    const words = text ? text.trim().split(/\s+/).length : 0;
    const dwell = Math.min(7000, Math.max(1100, 420 + words * 70));
    const t = setTimeout(go, dwell);
    return () => { cancelled = true; clearTimeout(t); };
  }, [enabled, cursor, total, text, voiceOn, advance]);

  // stop talking the moment guided play is paused / unmounted
  useEffect(() => {
    if (!enabled && canSpeak()) window.speechSynthesis.cancel();
    return () => { if (canSpeak()) window.speechSynthesis.cancel(); };
  }, [enabled]);
}

// ---------------------------------------------------------------------------
// The feed: an accumulating, readable log of beats — current beat bright with a
// ▸ marker (and a live "narrating" pulse), older ones fading above.
// ---------------------------------------------------------------------------
export function NarrationFeed({
  lines, voiceOn, onToggleVoice, narrating, accent = "cyan",
}: {
  lines: string[];
  voiceOn: boolean;
  onToggleVoice: () => void;
  narrating?: boolean;
  accent?: "cyan" | "violet";
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  const shown = lines.slice(-6);
  const base = lines.length - shown.length;

  return (
    <div className={`panel nar-feed nar-${accent}`}>
      <div className="nar-feed-h">
        <span className="eyebrow">what's happening</span>
        {canSpeak() && (
          <button className={`nar-speak ${voiceOn ? "on" : ""}`} onClick={onToggleVoice}
            title={voiceOn ? "stop reading aloud (and speed up)" : "read the narration aloud, paced to the voice"}>
            {voiceOn ? "🔊 narrating" : "🔈 read aloud"}
          </button>
        )}
      </div>
      <div className="nar-feed-body" ref={bodyRef}>
        {shown.length === 0 && (
          <p className="nar-line cur nar-idle">
            Press play to watch the planner think — each step waits for you to read it.
          </p>
        )}
        <AnimatePresence initial={false}>
          {shown.map((ln, i) => {
            const isCur = i === shown.length - 1;
            return (
              <motion.p key={base + i} className={`nar-line ${isCur ? "cur" : "past"}`}
                initial={{ opacity: 0, y: 5, filter: "blur(2px)" }}
                animate={{ opacity: isCur ? 1 : 0.4, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.3 }}>
                {isCur && <span className={`nar-tick ${narrating ? "live" : ""}`}>▸</span>}
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
