import type { Player } from "../trace/player";
import "./transport.css";

// The playback bar used by every module. Scrub, step, play/pause, speed.
export function Transport({ player, label }: { player: Player; label?: string }) {
  const { cursor, total, playing, speed } = player;
  const pct = total > 0 ? ((cursor + 1) / total) * 100 : 0;
  return (
    <div className="transport">
      <div className="transport-btns">
        <button className="tbtn" onClick={player.reset} title="Reset">⏮</button>
        <button className="tbtn" onClick={player.stepBack} title="Step back" disabled={cursor < 0}>◀</button>
        <button className="tbtn primary" onClick={player.toggle} title={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="tbtn" onClick={player.step} title="Step" disabled={player.atEnd}>▶▌</button>
      </div>

      <div className="transport-scrub">
        <input
          type="range" min={-1} max={Math.max(0, total - 1)} value={cursor}
          onChange={(e) => player.seek(parseInt(e.target.value, 10))}
          style={{ ["--pct" as any]: `${pct}%` }}
        />
        <div className="transport-meta num">
          <span>{cursor + 1}/{total}</span>
          {label && <span className="transport-label">{label}</span>}
        </div>
      </div>

      <div className="transport-speed num">
        <span className="eyebrow">spd</span>
        <input type="range" min={1} max={30} value={speed}
               onChange={(e) => player.setSpeed(parseInt(e.target.value, 10))} />
        <span>{speed}/s</span>
      </div>
    </div>
  );
}
