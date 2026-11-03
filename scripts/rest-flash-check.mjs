// Measure Rest's flicker and frame rate on a real GPU. Not part of `npm test`: CI runners have no GPU.
//
// Uses the WCAG 2.2 general flash definition, as the generative AV labs check does: a flash is a pair of
// opposing changes of at least 10% of maximum relative luminance where the darker image is below 0.80, and
// the limit is three in any one second over no more than 25% of a 10 degree field. Each third of the
// screen stands in for that field. Every frame, the page's two canvases are composited as the browser
// shows them (the lattice over the galaxy at its crossfade opacity) and area-averaged into a 64 x 36 grid.
// A strict screen, not a certificate: it has no red-flash test, and only a person can judge comfort.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const page = "file://" + path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "Autonomic_Telemetry_Console.html");
const W = 64, H = 36;
const rel = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function flashesPerSecond(series, times) {
  const turns = [];
  let ref = series[0], direction = 0;
  series.forEach((v, i) => {
    if (direction >= 0 && v - ref >= 0.1 && Math.min(v, ref) < 0.8) { turns.push(times[i]); direction = -1; ref = v; }
    else if (direction <= 0 && ref - v >= 0.1 && Math.min(v, ref) < 0.8) { turns.push(times[i]); direction = 1; ref = v; }
    else ref = direction === -1 ? Math.max(ref, v) : direction === 1 ? Math.min(ref, v) : ref;
  });
  let best = 0;
  turns.forEach((t, i) => { best = Math.max(best, Math.floor(turns.slice(i).filter((x) => x < t + 1000).length / 2)); });
  return best;
}
function analyze(frames) {
  const times = frames.map((f) => f.t), grids = frames.map((f) => f.grid.map(rel));
  const perCell = Array.from({ length: W * H }, (_, c) => flashesPerSecond(grids.map((g) => g[c]), times));
  let worstRegion = 0;
  for (let ry = 0; ry < 3; ry++) for (let rx = 0; rx < 3; rx++) {
    const cells = [];
    for (let y = Math.floor((ry * H) / 3); y < Math.floor(((ry + 1) * H) / 3); y++)
      for (let x = Math.floor((rx * W) / 3); x < Math.floor(((rx + 1) * W) / 3); x++) cells.push(x + y * W);
    worstRegion = Math.max(worstRegion, cells.filter((c) => perCell[c] > 3).length / cells.length);
  }
  const means = grids.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  let maxStep = 0;
  for (let i = 1; i < grids.length; i++)
    for (let c = 0; c < W * H; c++) maxStep = Math.max(maxStep, Math.abs(grids[i][c] - grids[i - 1][c]));
  return {
    frames: frames.length,
    capturedFps: +(frames.length / ((times.at(-1) - times[0]) / 1000)).toFixed(1),
    worstRegionOver3PerSec: +worstRegion.toFixed(3),
    worstCellFlashesPerSec: Math.max(...perCell),
    wholeFrameFlashesPerSec: flashesPerSecond(means, times),
    largestCellStepPct: +(maxStep * 100).toFixed(1),
    meanLuminancePct: [+(Math.min(...means) * 100).toFixed(2), +(Math.max(...means) * 100).toFixed(2)],
  };
}
// Runs in the page: sample the composite after every app frame for `ms` milliseconds.
const record = (ms) => new Promise((resolve) => {
  const field = document.getElementById("field"), lattice = document.getElementById("rest-field");
  const c = document.createElement("canvas"); c.width = 256; c.height = 144;
  const g = c.getContext("2d", { willReadFrequently: true });
  const frames = [], start = performance.now();
  (function grab(now) {
    g.globalAlpha = 1; g.fillStyle = "#000"; g.fillRect(0, 0, 256, 144);
    g.drawImage(field, 0, 0, 256, 144);
    const alpha = lattice.hidden ? 0 : +getComputedStyle(lattice).opacity;
    if (alpha > 0) { g.globalAlpha = alpha; g.drawImage(lattice, 0, 0, 256, 144); }
    const d = g.getImageData(0, 0, 256, 144).data, grid = new Array(64 * 36).fill(0);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      grid[(y >> 2) * 64 + (x >> 2)] += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 16;
    }
    frames.push({ t: now - start, grid });
    if (now - start < ms) requestAnimationFrame(grab); else resolve(frames);
  })(start);
});

const browser = await chromium.launch({ channel: "chromium", args: ["--ignore-gpu-blocklist", "--enable-gpu"] });
const results = [], bad = [];
const sizes = { desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
for (const [size, options] of Object.entries(sizes)) for (const motion of ["no-preference", "reduce"]) {
  const context = await browser.newContext({ ...options, reducedMotion: motion });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(page);
  await p.waitForTimeout(800);
  await p.click("#demo-button");
  await p.waitForTimeout(2500);
  // Entering Rest: the galaxy gives way to the lattice, then a full breath and the controls withdrawing.
  const entering = p.evaluate(record, 14000);
  await p.waitForTimeout(300);
  await p.click("#rest-mode");
  const enter = analyze(await entering);
  const fps = await p.evaluate(() => TelemetryLive.getVisualState().rest);
  // Hardest honest case: switching between Work and Rest as fast as a person can click.
  const toggling = p.evaluate(record, 6000);
  for (let i = 0; i < 18; i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(150); await p.click("#rest-mode", { force: true }); await p.waitForTimeout(150); }
  const hardest = analyze(await toggling);
  results.push({ size, motion, tier: fps.tier, renderer: fps.renderer, restFps: fps.fps && +fps.fps.toFixed(1), enter, hardest, errors });
  for (const [name, x] of [["enter", enter], ["hardest", hardest]]) {
    if (x.worstRegionOver3PerSec > 0.25) bad.push(`${size} ${motion} ${name}: ${(x.worstRegionOver3PerSec * 100).toFixed(0)}% of a region flashes more than 3 times a second`);
    if (x.wholeFrameFlashesPerSec > 3) bad.push(`${size} ${motion} ${name}: the whole frame flashes ${x.wholeFrameFlashesPerSec} times in a second`);
  }
  if (errors.length) bad.push(`${size} ${motion}: page errors ${errors.join("; ")}`);
  await context.close();
}
await browser.close();
for (const r of results) console.log(JSON.stringify(r));
console.log(bad.join("\n") || "Rest flicker check passed");
process.exit(bad.length ? 1 : 0);
