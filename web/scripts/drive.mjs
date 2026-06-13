import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:5173";
const OUT = "/tmp/pdr-shots";
import { mkdirSync } from "fs";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/1-load.png` });
console.log("LOADED. title:", await page.title());

// click Run
const runBtn = page.locator("button.ex-run");
await runBtn.waitFor({ timeout: 10000 });
await runBtn.click();
console.log("clicked run; booting pyodide (first load can take ~30s)…");

// wait for the fences to render (real trace data)
let ok = false;
try {
  await page.locator(".fences .fence").first().waitFor({ timeout: 90000 });
  ok = true;
} catch (e) {
  console.log("fences did not appear:", String(e.message).split("\n")[0]);
}
await page.waitForTimeout(2500); // let a few play-steps animate
const errText = await page.locator(".ex-err").textContent().catch(() => "");
if (errText) console.log("UI ERROR:", errText);
await page.screenshot({ path: `${OUT}/2-running.png`, fullPage: false });

// gather observed state
const fenceCount = await page.locator(".fences .fence").count();
const reasonCount = await page.locator(".reason-chip").count();
const hasWorld = (await page.locator(".logi, .blocks, .generic-world").count()) > 0;
const badge = await page.locator(".runtime-badge .num").textContent().catch(() => "?");
const narration = await page.locator(".ex-narration p").textContent().catch(() => "");
const planSteps = await page.locator(".plan-step").count();

console.log("RESULT", JSON.stringify({
  fencesRendered: ok, fenceCount, reasonCount, hasWorld,
  runtimeBadge: badge, planSteps, narration: (narration || "").slice(0, 120),
}, null, 2));
console.log("CONSOLE (last 12):");
console.log(logs.slice(-12).join("\n"));

await browser.close();
