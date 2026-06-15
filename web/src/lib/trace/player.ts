import { useCallback, useEffect, useRef, useState } from "react";

// Generic trace player: manages a cursor over an event list with play/pause/
// step/scrub. Modules derive their own view-state from events.slice(0, cursor+1).

export interface Player {
  cursor: number; // index of the LAST applied event (-1 = before anything)
  total: number;
  playing: boolean;
  speed: number; // events per second
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  step: () => void;
  stepBack: () => void;
  reset: () => void;
  seek: (i: number) => void;
  setSpeed: (n: number) => void;
  advance: () => void; // step forward WITHOUT pausing (for externally-paced play)
}

export function useTracePlayer(
  total: number,
  opts?: { speed?: number; autoplay?: boolean; clock?: boolean },
): Player {
  const clock = opts?.clock ?? true; // false = an external pacer drives advance()
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(opts?.speed ?? 6);
  const raf = useRef<number | null>(null);
  const last = useRef(0);

  // reset when a new trace arrives
  useEffect(() => {
    setCursor(-1);
    setPlaying(!!opts?.autoplay && total > 0);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  const atEnd = cursor >= total - 1;

  // advance one event but keep `playing` true (the pacer decides when to stop)
  const advance = useCallback(() => {
    setCursor((c) => {
      if (c >= total - 1) { setPlaying(false); return c; }
      return c + 1;
    });
  }, [total]);

  useEffect(() => {
    if (!playing || !clock) return; // clock off → an external narration pacer drives it
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      if (dt >= 1 / speed) {
        last.current = now;
        setCursor((c) => {
          if (c >= total - 1) { setPlaying(false); return c; }
          return c + 1;
        });
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed, total, clock]);

  const play = useCallback(() => { if (cursor >= total - 1) setCursor(-1); setPlaying(true); }, [cursor, total]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);
  const step = useCallback(() => { setPlaying(false); setCursor((c) => Math.min(total - 1, c + 1)); }, [total]);
  const stepBack = useCallback(() => { setPlaying(false); setCursor((c) => Math.max(-1, c - 1)); }, []);
  const reset = useCallback(() => { setPlaying(false); setCursor(-1); }, []);
  const seek = useCallback((i: number) => { setPlaying(false); setCursor(Math.max(-1, Math.min(total - 1, i))); }, [total]);

  return { cursor, total, playing, speed, atEnd, play, pause, toggle, step, stepBack, reset, seek, setSpeed, advance };
}
