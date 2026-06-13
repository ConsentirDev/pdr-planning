import { chromium } from "playwright";
import { mkdirSync } from "fs";
const OUT = "/tmp/pdr-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_REFUSED|vite/.test(m.text())) errors.push(`[console.error] ${m.text()}`); });

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
// switch to Lab mode for full controls
await page.locator(".mode-btn", { hasText: "Lab" }).click().catch(() => {});
await page.waitForTimeout(400);

const mods = [
  { label: "PDR Explorer", shot: "m1-explorer" },
  { label: "FOND Policies", shot: "m2-fond" },
  { label: "Self-Improvement Lab", shot: "m3-selflab" },
  { label: "Race & Decompose", shot: "m4-race" },
  { label: "PDDL Loader", shot: "m5-pddl" },
];

for (const m of mods) {
  const before = errors.length;
  await page.locator(".rail-item", { hasText: m.label }).click();
  await page.waitForTimeout(700);
  // click the module's run button (text contains "run")
  const runBtn = page.locator("button", { hasText: /run/i }).first();
  let clicked = false;
  try { await runBtn.waitFor({ timeout: 4000 }); await runBtn.click(); clicked = true; } catch {}
  // wait for a result to appear OR settle (first run boots pyodide ~20s)
  await page.waitForTimeout(m.shot === "m1-explorer" ? 30000 : 16000);
  // surface any visible error panel text
  const errPanels = await page.locator('[class$="-err"], .pddl-err pre, .ex-err, .sl-err').allTextContents().catch(() => []);
  const newErrs = errors.slice(before);
  await page.screenshot({ path: `${OUT}/${m.shot}.png` });
  console.log(`\n=== ${m.label} ===`);
  console.log(`  run clicked: ${clicked}`);
  console.log(`  visible error panels: ${errPanels.filter(Boolean).map((t) => t.slice(0, 100)).join(" | ") || "none"}`);
  console.log(`  runtime errors: ${newErrs.length ? newErrs.slice(0, 4).join(" || ") : "none"}`);
}

console.log(`\nTOTAL runtime errors across all modules: ${errors.length}`);
await browser.close();
