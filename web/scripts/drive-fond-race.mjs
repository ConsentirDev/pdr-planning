import { chromium } from "playwright";
const OUT = "/tmp/pdr-shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.locator(".mode-btn", { hasText: "Lab" }).click().catch(() => {});

async function seekEnd() {
  // drag every transport scrubber to its max so the final state renders
  const ranges = page.locator(".transport input[type=range]");
  const n = await ranges.count();
  for (let i = 0; i < n; i++) {
    const r = ranges.nth(i);
    const max = await r.getAttribute("max");
    if (max) await r.evaluate((el, m) => { el.value = m; el.dispatchEvent(new Event("input", { bubbles: true })); }, max);
  }
  await page.waitForTimeout(1500);
}

// ---- FOND clumsy-3 ----
await page.locator(".rail-item", { hasText: "FOND Policies" }).click();
await page.waitForTimeout(600);
await page.locator("button", { hasText: /run/i }).first().click().catch(() => {});
await page.waitForTimeout(28000); // pyodide boot + solve
await seekEnd();
await page.screenshot({ path: `${OUT}/fond-final.png` });
const svgEls = await page.locator("svg circle, svg rect, [class*='node']").count();
console.log(`FOND: svg/node elements = ${svgEls}, errors=${errs.length}`);

// ---- Race ----
await page.locator(".rail-item", { hasText: "Race & Decompose" }).click();
await page.waitForTimeout(600);
await page.locator("button", { hasText: /run/i }).first().click().catch(() => {});
await page.waitForTimeout(10000);
await seekEnd();
await page.screenshot({ path: `${OUT}/race-final.png` });
const bars = await page.locator("[class*='lane'], [class*='bar'], [class*='podium']").count();
console.log(`RACE: lane/bar elements = ${bars}, errors=${errs.length}`);

console.log("total pageerrors:", errs.length, errs.slice(0, 3).join(" | "));
await browser.close();
