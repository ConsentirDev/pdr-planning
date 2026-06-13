import { useState } from "react";
import { useMode } from "../../app/App";
import { RaceTab } from "./RaceTab";
import { DecomposeTab } from "./DecomposeTab";
import "./racedecomp.css";

type Tab = "race" | "decompose";

export default function RaceDecomp() {
  const { mode } = useMode();
  const [tab, setTab] = useState<Tab>("race");

  return (
    <div className="rd">
      <div className="rd-tabs">
        <button className={`rd-tab ${tab === "race" ? "on" : ""}`} onClick={() => setTab("race")}>
          <span className="rd-tab-glyph">⇶</span> Race
        </button>
        <button className={`rd-tab ${tab === "decompose" ? "on" : ""}`} onClick={() => setTab("decompose")}>
          <span className="rd-tab-glyph">◈</span> Decompose
        </button>
      </div>

      {tab === "race" ? <RaceTab mode={mode} /> : <DecomposeTab mode={mode} />}
    </div>
  );
}
