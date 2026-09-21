#!/usr/bin/env node
/**
 * Screenshot runner for the artifacts viewer.
 *
 * Reads a recipe (JSON array of shots) and writes one PNG per entry, so a
 * design change can be looked at instead of guessed at. Runs headless Chromium
 * from the Playwright image; the host has no browser and no node.
 *
 * Recipe entry:
 *   {
 *     "name": "viewer-light",              // output file name, no extension
 *     "url":  "http://127.0.0.1:5174/a/x", // required
 *     "width": 1440, "height": 900,        // viewport, default 1440x900
 *     "scheme": "light" | "dark",          // default light
 *     "full": true,                        // full page instead of viewport
 *     "scale": 2,                          // device pixel ratio, default 2
 *     "steps": [                           // optional interactions
 *       { "click": ".pin" },
 *       { "hover": ".btn" },
 *       { "press": "c" },
 *       { "type": ["textarea", "hello"] },
 *       { "scroll": 600 },
 *       { "wait": 300 }
 *     ]
 *   }
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [recipePath, outDir = "/out"] = process.argv.slice(2);
if (!recipePath) {
  console.error("usage: shot.mjs <recipe.json> [outDir]");
  process.exit(2);
}

const shots = JSON.parse(readFileSync(recipePath, "utf8"));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
const report = [];

for (const shot of Array.isArray(shots) ? shots : [shots]) {
  const scheme = shot.scheme === "dark" ? "dark" : "light";
  const context = await browser.newContext({
    viewport: { width: shot.width ?? 1440, height: shot.height ?? 900 },
    deviceScaleFactor: shot.scale ?? 2,
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  // The app reads the scheme from localStorage before first paint.
  await context.addInitScript((value) => {
    try {
      localStorage.setItem("art-scheme", value);
    } catch {
      /* private mode */
    }
  }, scheme);

  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  try {
    // Not networkidle: the viewer holds a server-sent events connection open,
    // so the network is never idle and the wait would always time out.
    await page.goto(shot.url, { waitUntil: "load", timeout: 30000 });
    // Charts and custom elements upgrade a frame or two after load.
    await page.waitForTimeout(shot.settle ?? 600);

    for (const step of shot.steps ?? []) {
      if (step.click) await page.click(step.click, { timeout: 5000 });
      if (step.hover) await page.hover(step.hover, { timeout: 5000 });
      if (step.press) await page.keyboard.press(step.press);
      if (step.type) await page.fill(step.type[0], step.type[1]);
      if (step.scroll !== undefined) await page.evaluate((y) => window.scrollTo(0, y), step.scroll);
      if (step.eval) {
        // Ask the page a question and print the answer, for when a screenshot
        // shows that something is wrong but not why.
        const value = await page.evaluate(step.eval);
        console.log(`    eval ${JSON.stringify(step.eval)} -> ${JSON.stringify(value)}`);
      }
      if (step.wait) await page.waitForTimeout(step.wait);
      if (!step.wait) await page.waitForTimeout(250);
    }

    const file = path.join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: shot.full === true });
    report.push({ name: shot.name, file, problems });
    console.log(`${problems.length ? "!" : "+"} ${shot.name} -> ${file}${problems.length ? ` (${problems.length} console problems)` : ""}`);
    for (const p of problems) console.log(`    ${p}`);
  } catch (err) {
    report.push({ name: shot.name, error: String(err && err.message ? err.message : err), problems });
    console.log(`x ${shot.name}: ${err && err.message ? err.message : err}`);
  } finally {
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
