import { chromium } from "playwright";
import { mkdirSync } from "fs";
const OUT = "/tmp/pdr-shots";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });

async function shot(name) { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log("shot", name); }
async function go(label) { await page.locator(".rail-item", { hasText: label }).click(); await page.waitForTimeout(700); }
async function run() {
  const b = page.locator("button", { hasText: /run/i }).first();
  try { await b.waitFor({ timeout: 4000 }); await b.click(); } catch {}
}
async function midScrub(frac = 0.5) {
  const rs = page.locator(".transport input[type=range]");
  const n = await rs.count();
  for (let i = 0; i < n; i++) {
    const r = rs.nth(i); const max = parseInt(await r.getAttribute("max") || "0");
    if (max) await r.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, String(Math.floor(max * frac)));
  }
  await page.waitForTimeout(1200);
}

await page.waitForTimeout(500);
await shot("00-shell-welcome");          // first impression
await run(); await page.waitForTimeout(30000); await midScrub(0.55); await shot("01-explorer-mid");
await go("FOND Policies"); await run(); await page.waitForTimeout(18000); await midScrub(1.0); await shot("02-fond");
await go("Self-Improvement Lab"); await run(); await page.waitForTimeout(28000); await midScrub(1.0); await shot("03-selflab");
await go("Race & Decompose"); await run(); await page.waitForTimeout(14000); await midScrub(1.0); await shot("04-race");
// decompose tab
const dt = page.locator("button", { hasText: /decompose/i }).first(); try { await dt.click(); await page.waitForTimeout(500); await run(); await page.waitForTimeout(8000); await midScrub(1.0); await shot("05-decompose"); } catch {}
await go("PDDL Loader"); await run(); await page.waitForTimeout(14000); await midScrub(0.5); await shot("06-pddl");
await browser.close();
console.log("done");
