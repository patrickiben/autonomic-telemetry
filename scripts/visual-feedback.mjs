import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Invented complete feature frames exercise the production multivariate model
// and painted pixels. There is no score override or private drawing-state write.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "Autonomic_Telemetry_Console.html")).href;
const browser = await chromium.launch({ headless: true });
const errors = [], external = [], modeReferences = new Map();
const CENTER = { heart_rate_bpm: 68, pulse_rmssd_ms: 45, resp_rate_brpm: 12, eeg_beta_alpha: 1.5, pulse_sdnn_ms: 65 };
let passed = 0;
async function check(name, callback) { await callback(); passed++; console.log(`✓ ${name}`); }

async function fixture({ mode = "work", reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (/^https?:/.test(r.url())) external.push(new URL(r.url()).origin); });
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.TelemetryLive?.getVisualState && window.TelemetryMultivariate));
  await page.clock.pauseAt(new Date("2026-01-01T12:01:00Z"));
  if (mode === "rest") await page.locator("#rest-mode").click();
  let current = { ...CENTER };
  async function frame(values = current, { motion = 0, step = 1000 } = {}) {
    current = { ...values };
    const stamp = (await page.evaluate(() => Date.now())) + step;
    await page.clock.setSystemTime(stamp);
    const accepted = await page.evaluate(({ stamp, values, motion }) => {
      TelemetryLive.receive({ type: "heart_rate", device: "hume", heart_rate_bpm: values.heart_rate_bpm, source: "device-reported", received_at: stamp });
      return TelemetryLive.features({ type: "features", received_at: stamp, source: "device-reported", ...values, motion,
        quality: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { valid: value !== null, received_at: stamp, source: "Invented multivariate fixture:" + key }])) });
    }, { stamp, values, motion });
    assert.equal(accepted, true, "Invented feature frame must reach the real multivariate model");
  }
  async function settle(milliseconds = 1500) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 500) { await page.clock.runFor(500); await frame(current, { step: 0 }); }
    await page.clock.runFor(32);
  }
  async function visual() { return page.evaluate(() => TelemetryLive.getVisualState()); }
  async function reference() {
    for (let i = 0; i < 121; i++) await frame(CENTER);
    await settle();
    const a = await page.evaluate(() => TelemetryLive.getState().arousal);
    assert.equal(a.phase, "ready");
    assert.equal(a.reference.value, 0, "The restored model's reference origin is zero");
    assert.ok(Math.abs(a.value) < 0.01, "An unchanged complete reference must not retain the archived 50-point offset");
  }
  async function level(level) {
    const before = await visual();
    const a = await page.evaluate(() => TelemetryLive.getState().arousal);
    const directions = { heart_rate_bpm: 1, pulse_rmssd_ms: -1, resp_rate_brpm: 1, eeg_beta_alpha: 1, pulse_sdnn_ms: -1 };
    const z = level === "reference" ? 0 : level === "high" ? 6 : 2;
    const values = Object.fromEntries(Object.keys(CENTER).map(key => {
      const ref = a.reference.stats[key];
      return [key, Math.max(key === "eeg_beta_alpha" ? 0.01 : 1, ref.mean + directions[key] * z * ref.sd)];
    }));
    for (let i = 0; i < 25; i++) await frame(values);
    const target = (await page.evaluate(() => TelemetryLive.getState().arousal)).value;
    if (before.available && !before.paused && Math.abs(before.value - target) > 1) {
      await page.clock.runFor(120);
      const intermediate = await visual();
      assert.ok(intermediate.value > Math.min(before.value, target) && intermediate.value < Math.max(before.value, target), "Fresh changes must visibly interpolate before settling");
    }
    await settle(4000);
    const actual = await page.evaluate(() => TelemetryLive.getState().arousal);
    assert.equal(actual.phase, "ready");
    if (level === "reference") assert.ok(Math.abs(actual.value) < 0.01);
    else if (level === "high") assert.ok(actual.value >= 95, `A convergent large multivariate shift should approach the top of the scale, got ${actual.value}`);
    else assert.ok(actual.value > 10 && actual.value < 90, "The moderate fixture must produce an intermediate engine-derived value");
    return actual.value;
  }
  async function pixels() {
    return page.locator("#field").evaluate(canvas => {
      const { width, height } = canvas, data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
      const background = [data[0], data[1], data[2]];
      let energy = 0, red = 0, blue = 0, moment = 0;
      for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = Math.max(0, data[i] - background[0]), g = Math.max(0, data[i + 1] - background[1]), b = Math.max(0, data[i + 2] - background[2]);
        const weight = r + g + b; energy += weight; red += r; blue += b;
        moment += weight * ((x / width - .5) ** 2 + (y / height - .54) ** 2);
      }
      return { energy: energy / (width * height), radiusMoment: Math.sqrt(moment / Math.max(energy, 1)), redBlueRatio: red / Math.max(blue, 1), image: canvas.toDataURL() };
    });
  }
  async function toggle(id) { await page.locator("#space-button").click(); await page.locator(`#${id}`).click(); await page.locator("#space-sheet [data-close]").click(); }
  return { page, frame, settle, reference, level, visual, pixels, toggle, close: () => context.close() };
}

try {
  for (const mode of ["work", "rest"]) await check(`${mode === "work" ? "Work" : "Rest"} paints ordered zero-reference, moderate, and high multivariate estimates`, async () => {
    const f = await fixture({ mode });
    try {
      await f.reference(); const captures = [];
      for (const level of ["reference", "moderate", "high"]) {
        const value = await f.level(level), state = await f.visual();
        assert.equal(state.available, true); assert.equal(state.mode, mode); assert.equal(state.hasReferenceOrbit, true);
        assert.ok(Math.abs(state.value - value) < .05);
        captures.push({ state, pixels: await f.pixels() });
      }
      for (let i = 1; i < captures.length; i++) {
        const lower = captures[i - 1], higher = captures[i];
        assert.ok(higher.state.radiusScale > lower.state.radiusScale); assert.ok(higher.state.brightness > lower.state.brightness); assert.ok(higher.state.warmth > lower.state.warmth);
        assert.ok(higher.pixels.energy > lower.pixels.energy * 1.1, "Painted light must visibly brighten");
        assert.ok(higher.pixels.radiusMoment > lower.pixels.radiusMoment * 1.04, "Painted light must occupy a wider radius");
        assert.ok(higher.pixels.redBlueRatio > lower.pixels.redBlueRatio, "Painted light must become warmer");
        assert.notEqual(higher.pixels.image, lower.pixels.image);
      }
      modeReferences.set(mode, captures[0].pixels.image);
      if (mode === "rest") assert.notEqual(modeReferences.get("work"), modeReferences.get("rest"), "Modes must have distinct compositions at the same zero-reference estimate");
    } finally { await f.close(); }
  });

  await check("Waiting, stale, and motion-held multivariate estimates clear score encoding", async () => {
    const f = await fixture();
    try {
      let v = await f.visual();
      for (const key of ["value", "radiusScale", "brightness", "warmth"]) assert.equal(v[key], null);
      assert.equal(v.available, false); const waitingClock = v.clock;
      await f.page.clock.runFor(2000); const waitingPace = (await f.visual()).clock - waitingClock;
      await f.reference(); await f.level("high"); const high = await f.pixels();
      await f.page.clock.runFor(5500); v = await f.visual();
      assert.equal((await f.page.evaluate(() => TelemetryLive.getState())).arousal.phase, "stale");
      assert.equal(v.available, false); for (const key of ["value", "radiusScale", "brightness", "warmth"]) assert.equal(v[key], null);
      assert.notEqual((await f.pixels()).image, high.image);
      const staleClock = v.clock; await f.page.clock.runFor(2000);
      assert.ok(Math.abs(((await f.visual()).clock - staleClock) - waitingPace) < .04, "Unavailable data must use independent ambient pace");
      await f.level("reference"); await f.frame(CENTER, { motion: .5 }); await f.page.clock.runFor(32);
      assert.equal((await f.page.evaluate(() => TelemetryLive.getState())).arousal.phase, "held");
      v = await f.visual(); assert.equal(v.available, false); assert.equal(v.value, null); assert.equal(v.radiusScale, null);
    } finally { await f.close(); }
  });

  await check("Reduced motion freezes drift while genuine model changes update static size and color", async () => {
    const f = await fixture({ reducedMotion: "reduce" });
    try {
      await f.reference(); await f.level("reference"); const low = await f.visual(), lowImage = await f.pixels();
      assert.equal(low.gentle, true); await f.settle();
      assert.equal((await f.visual()).clock, low.clock); assert.equal((await f.pixels()).image, lowImage.image);
      await f.level("high"); const high = await f.visual();
      assert.equal(high.clock, low.clock); assert.ok(high.radiusScale > low.radiusScale); assert.notEqual((await f.pixels()).image, lowImage.image);
      await f.toggle("gentle-toggle"); await f.settle(500); assert.ok((await f.visual()).clock > high.clock);
    } finally { await f.close(); }
  });

  await check("Still image preserves fresh pixels, clears stale encoding, and resumes at the actual model value", async () => {
    const f = await fixture();
    try {
      await f.reference(); await f.toggle("pause-toggle"); await f.page.clock.runFor(32);
      const paused = await f.visual(), frozen = await f.pixels(); assert.equal(paused.paused, true);
      await f.level("high"); assert.equal((await f.visual()).clock, paused.clock); assert.equal((await f.pixels()).image, frozen.image);
      assert.ok((await f.page.evaluate(() => TelemetryLive.getState())).arousal.value >= 95);
      await f.page.clock.runFor(5500); const stale = await f.visual();
      assert.equal(stale.paused, true); assert.equal(stale.available, false); assert.equal(stale.value, null); assert.equal(stale.radiusScale, null);
      assert.notEqual((await f.pixels()).image, frozen.image);
      await f.level("high"); await f.toggle("pause-toggle"); await f.settle(); const resumed = await f.visual();
      assert.equal(resumed.paused, false); assert.equal(resumed.available, true); assert.ok(resumed.value > paused.value); assert.notEqual((await f.pixels()).image, frozen.image);
    } finally { await f.close(); }
  });

  await check("Rest breathing animates its separate ring without changing zero-reference model size", async () => {
    const f = await fixture({ mode: "rest", reducedMotion: "reduce" });
    try {
      await f.reference(); await f.level("reference"); const before = await f.visual();
      await f.page.locator("#mode-action").click(); await f.page.clock.runFor(32);
      assert.equal((await f.visual()).breathing, true); const initial = await f.pixels(); await f.settle(3500); const later = await f.visual();
      assert.equal(later.value, before.value); assert.equal(later.radiusScale, before.radiusScale); assert.equal(later.clock, before.clock);
      assert.notEqual((await f.pixels()).image, initial.image); assert.equal(await f.page.locator("#breath-cue").isVisible(), true);
    } finally { await f.close(); }
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(`\n${passed} visual feedback checks passed.`);
} finally { await browser.close(); }
