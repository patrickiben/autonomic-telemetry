import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Invented feature frames exercise the production inference and render paths.
// There is deliberately no score override or access to private drawing state.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(
  path.join(root, "Autonomic_Telemetry_Console.html"),
).href;
const browser = await chromium.launch({ headless: true });
const errors = [], external = [];
const modeReferences = new Map();
let passed = 0;

async function check(name, callback) {
  await callback();
  passed++;
  console.log(`✓ ${name}`);
}

async function fixture({ mode = "work", reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
    reducedMotion,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) external.push(new URL(request.url()).origin);
  });
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.TelemetryLive?.getVisualState));
  await page.clock.pauseAt(new Date("2026-01-01T12:01:00Z"));
  if (mode === "rest") await page.locator("#rest-mode").click();

  async function frame(hr = 68, prv = 45, { motion = 0, step = 1000 } = {}) {
    const stamp = (await page.evaluate(() => Date.now())) + step;
    await page.clock.setSystemTime(stamp);
    const accepted = await page.evaluate(({ stamp, hr, prv, motion }) => {
      TelemetryLive.receive({
        type: "heart_rate", device: "hume", heart_rate_bpm: hr,
        source: "device-reported", received_at: stamp,
      });
      return TelemetryLive.features({
        type: "features", received_at: stamp, source: "device-reported",
        heart_rate_bpm: hr, pulse_rmssd_ms: prv, motion,
        quality: {
          heart_rate_bpm: {
            valid: true, received_at: stamp, source: "Invented cardiac fixture",
          },
          pulse_rmssd_ms: {
            valid: true, received_at: stamp, source: "Invented optical fixture",
          },
        },
      });
    }, { stamp, hr, prv, motion });
    assert.equal(accepted, true, "Valid invented feature frame must reach the real inference engine");
  }

  async function settle(hr = 68, prv = 45, milliseconds = 1500) {
    // Keep component freshness while RAF executes every intermediate frame.
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 500) {
      await page.clock.runFor(500);
      await frame(hr, prv, { step: 0 });
    }
    await page.clock.runFor(32);
  }

  async function reference() {
    for (let i = 0; i < 120; i++) await frame();
    await settle();
    const state = await page.evaluate(() => TelemetryLive.getState());
    assert.equal(state.arousal.phase, "ready");
    assert.equal(state.arousal.value, 50);
  }

  async function level(value) {
    const before = await visual();
    const hr = value === 0 ? 59 : value === 100 ? 77 : 68;
    const prv = value === 0 ? 45 * Math.exp(0.45) : value === 100 ? 45 * Math.exp(-0.45) : 45;
    // Fill the 15-second HR window and five-second output median after a transition.
    for (let i = 0; i < 25; i++) await frame(hr, prv);
    if (before.available && !before.paused && Math.abs(before.value - value) > 1) {
      await page.clock.runFor(120);
      const intermediate = await visual();
      assert.ok(
        intermediate.value > Math.min(before.value, value) &&
        intermediate.value < Math.max(before.value, value),
        "Fresh level changes should render an intermediate size and color before settling",
      );
    }
    await settle(hr, prv, 4000);
    const actual = await page.evaluate(() => TelemetryLive.getState().arousal);
    assert.equal(actual.phase, "ready");
    assert.ok(Math.abs(actual.value - value) < 0.01, `Expected engine-derived ${value}, got ${actual.value}`);
    return { hr, prv };
  }

  async function visual() {
    return page.evaluate(() => TelemetryLive.getVisualState());
  }

  async function pixels() {
    return page.locator("#field").evaluate((canvas) => {
      const { width, height } = canvas;
      const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
      const background = [data[0], data[1], data[2]];
      let energy = 0, red = 0, blue = 0, moment = 0;
      // RGB excess over the actual painted background isolates luminous matter.
      // Its second spatial moment checks expansion in the image, independently
      // of the diagnostic radius scale or its implementation formula.
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4;
          const r = Math.max(0, data[i] - background[0]);
          const g = Math.max(0, data[i + 1] - background[1]);
          const b = Math.max(0, data[i + 2] - background[2]);
          const weight = r + g + b;
          energy += weight;
          red += r;
          blue += b;
          moment += weight * ((x / width - 0.5) ** 2 + (y / height - 0.54) ** 2);
        }
      }
      return {
        energy: energy / (width * height),
        radiusMoment: Math.sqrt(moment / Math.max(energy, 1)),
        redBlueRatio: red / Math.max(blue, 1),
        image: canvas.toDataURL(),
      };
    });
  }

  async function toggle(id) {
    await page.locator("#space-button").click();
    await page.locator(`#${id}`).click();
    await page.locator("#space-sheet [data-close]").click();
  }

  return { page, frame, settle, reference, level, visual, pixels, toggle, close: () => context.close() };
}

try {
  for (const mode of ["work", "rest"]) {
    await check(`${mode === "work" ? "Work" : "Rest"} renders visibly ordered low, reference, and high inferred arousal`, async () => {
      const f = await fixture({ mode });
      try {
        await f.reference();
        const captures = [];
        for (const value of [0, 50, 100]) {
          await f.level(value);
          const state = await f.visual();
          assert.equal(state.available, true);
          assert.equal(state.mode, mode);
          assert.equal(state.hasReferenceOrbit, true);
          assert.ok(Math.abs(state.value - value) < 0.01);
          captures.push({ state, pixels: await f.pixels() });
        }
        for (let i = 1; i < captures.length; i++) {
          const lower = captures[i - 1], higher = captures[i];
          assert.ok(higher.state.radiusScale > lower.state.radiusScale);
          assert.ok(higher.state.brightness > lower.state.brightness);
          assert.ok(higher.state.warmth > lower.state.warmth);
          assert.ok(higher.pixels.energy > lower.pixels.energy * 1.1, "The painted high-value field must visibly brighten");
          assert.ok(higher.pixels.radiusMoment > lower.pixels.radiusMoment * 1.04, "The luminous field must actually occupy a wider radius");
          assert.ok(higher.pixels.redBlueRatio > lower.pixels.redBlueRatio, "The painted field must shift from cool toward warm colors");
          assert.notEqual(higher.pixels.image, lower.pixels.image);
        }
        modeReferences.set(mode, captures[1].pixels.image);
        if (mode === "rest")
          assert.notEqual(modeReferences.get("work"), modeReferences.get("rest"), "Work and Rest should render distinct compositions at the same reference value");
      } finally { await f.close(); }
    });
  }

  await check("Waiting, stale, and motion-held estimates remove score encoding instead of presenting reference", async () => {
    const f = await fixture();
    try {
      let visual = await f.visual();
      assert.equal(visual.available, false);
      assert.equal(visual.value, null);
      assert.equal(visual.radiusScale, null);
      assert.equal(visual.brightness, null);
      assert.equal(visual.warmth, null);
      const waitingClock = visual.clock;
      await f.page.clock.runFor(2000);
      const waitingPace = (await f.visual()).clock - waitingClock;
      await f.reference();
      await f.level(100);
      const high = await f.pixels();
      await f.page.clock.runFor(5500);
      visual = await f.visual();
      assert.equal((await f.page.evaluate(() => TelemetryLive.getState())).arousal.phase, "stale");
      assert.equal(visual.available, false);
      assert.equal(visual.value, null);
      assert.equal(visual.radiusScale, null);
      assert.equal(visual.brightness, null);
      assert.equal(visual.warmth, null);
      assert.notEqual((await f.pixels()).image, high.image);
      const staleClock = visual.clock;
      await f.page.clock.runFor(2000);
      const stalePace = (await f.visual()).clock - staleClock;
      assert.ok(Math.abs(stalePace - waitingPace) < 0.04, "Ambient drift must not retain the previous high estimate's faster pace");
      await f.level(50);
      await f.frame(68, 45, { motion: 0.5 });
      await f.page.clock.runFor(32);
      assert.equal((await f.page.evaluate(() => TelemetryLive.getState())).arousal.phase, "held");
      visual = await f.visual();
      assert.equal(visual.available, false);
      assert.equal(visual.value, null);
      assert.equal(visual.radiusScale, null);
      const heldClock = visual.clock;
      await f.page.clock.runFor(2000);
      const heldPace = (await f.visual()).clock - heldClock;
      assert.ok(Math.abs(heldPace - waitingPace) < 0.04, "Motion-held estimates must use the same independent ambient pace");
    } finally { await f.close(); }
  });

  await check("Reduced motion keeps the composition still while fresh low-to-high estimates update its size and color", async () => {
    const f = await fixture({ reducedMotion: "reduce" });
    try {
      await f.reference();
      await f.level(0);
      const low = await f.visual(), lowImage = await f.pixels();
      assert.equal(low.gentle, true);
      await f.settle(59, 45 * Math.exp(0.45), 1500);
      assert.equal((await f.visual()).clock, low.clock);
      assert.equal((await f.pixels()).image, lowImage.image, "Reduced motion must suppress rotation and drift");
      await f.level(100);
      const high = await f.visual();
      assert.equal(high.clock, low.clock);
      assert.ok(high.radiusScale > low.radiusScale);
      assert.notEqual((await f.pixels()).image, lowImage.image, "Static size and color must still reflect the new estimate");
      await f.toggle("gentle-toggle");
      await f.settle(77, 45 * Math.exp(-0.45), 500);
      assert.ok((await f.visual()).clock > high.clock, "Enabling regular motion should resume the visual clock");
    } finally { await f.close(); }
  });

  await check("Still image freezes actual pixels while fresh feature inference continues, and resume catches up", async () => {
    const f = await fixture();
    try {
      await f.reference();
      await f.toggle("pause-toggle");
      await f.page.clock.runFor(32);
      const paused = await f.visual(), frozen = await f.pixels();
      assert.equal(paused.paused, true);
      await f.level(100);
      assert.equal((await f.visual()).clock, paused.clock);
      assert.equal((await f.pixels()).image, frozen.image);
      assert.equal((await f.page.evaluate(() => TelemetryLive.getState())).arousal.value, 100);
      await f.page.clock.runFor(5500);
      const stale = await f.visual();
      assert.equal(stale.paused, true);
      assert.equal(stale.available, false, "Staleness must clear old score encoding even in a still image");
      assert.equal(stale.value, null);
      assert.equal(stale.radiusScale, null);
      assert.notEqual((await f.pixels()).image, frozen.image);
      await f.level(100);
      await f.toggle("pause-toggle");
      await f.settle(77, 45 * Math.exp(-0.45));
      const resumed = await f.visual();
      assert.equal(resumed.paused, false);
      assert.equal(resumed.available, true);
      assert.ok(resumed.value > paused.value);
      assert.notEqual((await f.pixels()).image, frozen.image);
    } finally { await f.close(); }
  });

  await check("Rest breathing changes its separate guide without changing the estimate's radius", async () => {
    const f = await fixture({ mode: "rest", reducedMotion: "reduce" });
    try {
      await f.reference();
      await f.level(50);
      const before = await f.visual();
      await f.page.locator("#mode-action").click();
      await f.page.clock.runFor(32);
      const guide = await f.visual(), initial = await f.pixels();
      assert.equal(guide.breathing, true);
      await f.settle(68, 45, 3500);
      const later = await f.visual();
      assert.equal(later.value, before.value);
      assert.equal(later.radiusScale, before.radiusScale);
      assert.equal(later.clock, before.clock);
      assert.notEqual((await f.pixels()).image, initial.image, "The breathing guide should move independently of the static score composition");
      assert.equal(await f.page.locator("#breath-cue").isVisible(), true);
    } finally { await f.close(); }
  });

  assert.deepEqual(errors, [], "Visual feedback should not raise browser errors");
  assert.deepEqual(external, [], "Standalone visual feedback must not make network requests");
  console.log(`\n${passed} visual feedback checks passed.`);
} finally {
  await browser.close();
}
