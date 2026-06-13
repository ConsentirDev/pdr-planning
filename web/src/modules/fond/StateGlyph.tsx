import type { Lit, Meta } from "../../lib/trace/types";
import { blocksWorld, trueAtoms } from "../../lib/world/state";

// A tiny, dense glyph of a single planning state — drawn small enough to be a
// node in the AND/OR graph. For blocksworld we draw stacked mini-blocks (the
// real towers); otherwise we fall back to a couple of fact chips.
export function StateGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  if (meta.render === "blocksworld") return <BlocksGlyph meta={meta} lits={lits} />;
  return <FactsGlyph meta={meta} lits={lits} />;
}

function BlocksGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const w = blocksWorld(meta, lits);
  return (
    <div className="sg-blocks">
      {w.holding && (
        <div className="sg-hold" title={`holding ${w.holding}`}>
          <span className="sg-claw">⊓</span>
          <span className="sg-blk held">{w.holding}</span>
        </div>
      )}
      <div className="sg-floor">
        {w.towers.length === 0 && !w.holding && <span className="sg-empty">∅</span>}
        {w.towers.map((tower, i) => (
          <div className="sg-tower" key={i}>
            {tower
              .slice()
              .reverse()
              .map((b) => (
                <span className="sg-blk" key={b}>
                  {b}
                </span>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FactsGlyph({ meta, lits }: { meta: Meta; lits: Lit[] }) {
  const trues = trueAtoms(meta, lits).slice(0, 4);
  return (
    <div className="sg-facts">
      {trues.map((a) => (
        <span className="sg-fact" key={a.name}>
          {pretty(a.name)}
        </span>
      ))}
      {trues.length === 0 && <span className="sg-empty">∅</span>}
    </div>
  );
}

function pretty(name: string): string {
  const m = name.match(/^([^(]+)\(([^)]*)\)$/);
  if (!m) return name;
  return m[2].split(",").join("·") || m[1];
}
