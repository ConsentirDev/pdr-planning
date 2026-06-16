import { useCallback, useRef, useState } from "react";

// Drag-to-resize the width of a right-hand panel. Returns the current width and a
// mousedown handler for a left-edge handle: dragging LEFT widens the panel.
// Persists to localStorage so a reader's chosen width sticks.
export function useResizableWidth(key: string, initial: number, min = 280, max = 760) {
  const [width, setWidth] = useState<number>(() => {
    const s = typeof localStorage !== "undefined" && localStorage.getItem(key);
    const n = s ? parseInt(s, 10) : NaN;
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : initial;
  });
  const w = useRef(width);
  w.current = width;

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = w.current;
    const move = (ev: MouseEvent) => {
      const next = Math.max(min, Math.min(max, w0 - (ev.clientX - x0)));
      setWidth(next);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(key, String(w.current)); } catch { /* ignore */ }
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [key, min, max]);

  return { width, startDrag };
}
