import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Invented feature frames only. These checks prove live/replay wiring and UI
// behavior; they do not assert physiological accuracy or contact quality.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const address = file => pathToFileURL(path.join(root, file)).href;
const CENTER = { heart_rate_bpm: 68, pulse_rmssd_ms: 45, resp_rate_brpm: 12, eeg_beta_alpha: 1.5, pulse_sdnn_ms: 65 };
const KEYS = Object.keys(CENTER), errors = [], external = [];
const browser = await chromium.launch({ headless: true });
let passed = 0, exportedSession, exportedState;
async function check(name, run) { await run(); passed++; console.log(`✓ ${name}`); }
async function open(file = "Autonomic_Telemetry_Console.html", mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (/^https?:/.test(r.url())) external.push(new URL(r.url()).origin); });
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.goto(address(file));
  await page.waitForFunction(() => Boolean(window.TelemetryMultivariate));
  await page.clock.pauseAt(new Date("2026-01-01T12:01:00Z"));
  return { page, close: () => context.close() };
}
async function live(mobile = false) {
  const f = await open(undefined, mobile), { page } = f;
  const frames = [];
  async function frame(values = CENTER, { motion = 0, valid = {}, step = 1000 } = {}) {
    const stamp = (await page.evaluate(() => Date.now())) + step;
    await page.clock.setSystemTime(stamp);
    const payload = { type: "features", received_at: stamp, observed_at: stamp, source: "device-reported", ...values, motion,
      quality: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
        valid: value !== null && valid[key] !== false, received_at: stamp, source: "Invented fixture:" + key,
        reason: value === null || valid[key] === false ? "Fixture component withheld" : "Invented accepted component",
      }])) };
    const accepted = await page.evaluate(frame => {
      if (frame.heart_rate_bpm !== null && frame.heart_rate_bpm !== undefined)
        TelemetryLive.receive({ device: "hume", type: "heart_rate", heart_rate_bpm: frame.heart_rate_bpm, source: "device-reported", received_at: frame.received_at });
      return TelemetryLive.features(frame);
    }, payload);
    assert.equal(accepted, true);
    frames.push(payload);
  }
  const snapshot = () => page.evaluate(() => TelemetryLive.getState().arousal);
  async function baseline(keys = KEYS, varying = false) {
    for (let i = 0; i < 121; i++) {
      const values = { ...CENTER };
      if (varying) Object.assign(values, { heart_rate_bpm: 68 + .2 * Math.sin(i / 3), pulse_rmssd_ms: 45 + .5 * Math.cos(i / 5),
        resp_rate_brpm: 12 + .05 * Math.cos(i / 4), eeg_beta_alpha: 1.5 + .01 * Math.sin(i / 6), pulse_sdnn_ms: 65 + .4 * Math.sin(i / 7) });
      await frame(Object.fromEntries(keys.map(k => [k, values[k]])));
    }
    const state = await snapshot();
    assert.equal(state.phase, "ready"); assert.equal(state.reference.value, 0);
    return state;
  }
  async function repeat(values, count = 12) { for (let i = 0; i < count; i++) await frame(values); }
  async function draw() { await page.clock.runFor(32); return page.evaluate(() => TelemetryLive.getVisualState()); }
  return { ...f, frame, frames, snapshot, baseline, repeat, draw };
}
const component = (state, key) => state.components.find(c => c.key === key);

try {
  await check("Main loads the multivariate model, learns zero reference, and exposes integrated mathematical state", async () => {
    const f = await live();
    try {
      const before = await f.snapshot(); assert.equal(before.phase, "waiting"); assert.equal(before.value, null);
      const state = await f.baseline(KEYS, true);
      assert.equal(state.modelVersion, "multivariate-1"); assert.equal(state.weights.coveredNominal, 100); assert.equal(state.limited, false);
      assert.deepEqual(state.reference.profile, KEYS);
      for (const key of [...KEYS, "turbulence"]) assert.ok(component(state, key).effectiveWeight > 0);
      assert.equal(state.research.surprise.available, true);
      assert.equal(state.research.turbulence.available, true);
      assert.equal(state.research.coupling.available, true);
      assert.equal(state.research.manifold.available, true);
      await f.page.locator("#arousal-button").click();
      const text = await f.page.locator("#live-analysis").innerText();
      for (const label of ["Predictive surprise", "Multivariate distance", "Shared-mode fraction", "Sample entropy", "HR autocorrelation", "Pattern modifiers", "Convergent onsets"]) assert.ok(text.includes(label), label);
      assert.equal(await f.page.locator('#live-analysis svg[aria-label="Standardized PCA trajectory"]').count(), 1);
      assert.match(await f.page.locator("#reference-description").innerText(), /Zero.*reference origin/);
    } finally { await f.close(); }
  });

  await check("An explicitly supplied EEG feature contributes to the headline and the score-encoded visual", async () => {
    const f = await live();
    try {
      await f.baseline(); const initial = await f.snapshot(), initialVisual = await f.draw();
      await f.repeat({ ...CENTER, eeg_beta_alpha: 4 });
      const changed = await f.snapshot(); await f.page.clock.runFor(1200); const changedVisual = await f.draw();
      assert.ok(component(changed, "eeg_beta_alpha").contribution >= 9);
      assert.ok(changed.value > initial.value + 8);
      assert.ok(changedVisual.radiusScale > initialVisual.radiusScale);
      assert.ok(changedVisual.warmth > initialVisual.warmth);
      assert.ok(changedVisual.value > initialVisual.value);
    } finally { await f.close(); }
  });

  await check("Multivariate distance affects the headline even when all directional physical contributions are zero", async () => {
    const f = await live();
    try {
      await f.baseline();
      await f.repeat({ heart_rate_bpm: 48, pulse_rmssd_ms: 85, resp_rate_brpm: 6, eeg_beta_alpha: .1, pulse_sdnn_ms: 105 });
      const state = await f.snapshot();
      assert.equal(state.phase, "ready");
      for (const key of KEYS) assert.equal(component(state, key).contribution, 0, key);
      assert.ok(state.research.turbulence.distance > 2.5);
      assert.ok(component(state, "turbulence").contribution > 0);
      assert.ok(state.value > 0, "Distance must be integrated into the score, not merely shown as an unrelated lens");
    } finally { await f.close(); }
  });

  await check("A fixed partial profile is labeled, has no invented respiration, and requires reset to add late channels", async () => {
    const f = await live();
    try {
      const state = await f.baseline(["heart_rate_bpm"]);
      assert.equal(state.track, "hr"); assert.equal(state.limited, true); assert.equal(state.weights.coveredNominal, 20);
      assert.equal(state.weights.effective.heart_rate_bpm, 100); assert.equal(state.weights.effective.turbulence, 0);
      assert.equal(component(state, "resp_rate_brpm").value, null); assert.equal(component(state, "resp_rate_brpm").included, false);
      await f.page.locator("#arousal-button").click();
      assert.match(await f.page.locator("#arousal-coverage").innerText(), /HR-only.*limited/i);
      assert.match(await f.page.locator("#arousal-components").innerText(), /Respiratory rate[\s\S]*Unavailable/);
      await f.frame(CENTER); const late = await f.snapshot();
      assert.deepEqual(late.weights, state.weights); assert.deepEqual(late.reference.profile, ["heart_rate_bpm"]);
      assert.ok(late.reference.resetNeeded.includes("eeg_beta_alpha"));
      assert.equal(component(late, "eeg_beta_alpha").contribution, null);
      assert.match(await f.page.locator("#live-analysis").innerText(), /New inputs are available/);
    } finally { await f.close(); }
  });

  await check("A four-feature wearable profile declares 85/100 nominal coverage and never synthesizes breathing", async () => {
    const f = await live();
    try {
      const state = await f.baseline(KEYS.filter(key => key !== "resp_rate_brpm"), true);
      assert.equal(state.phase, "ready"); assert.equal(state.limited, true);
      assert.equal(state.reference.profile.length, 4);
      assert.equal(state.weights.coveredNominal, 85);
      assert.equal(state.weights.effective.resp_rate_brpm, 0);
      assert.ok(Math.abs(Object.values(state.weights.effective).reduce((sum, weight) => sum + weight, 0) - 100) < 1e-10);
      assert.equal(component(state, "resp_rate_brpm").value, null);
      assert.equal(component(state, "resp_rate_brpm").included, false);
      assert.equal(state.research.lead.available, false);
      assert.equal(state.research.crosslags.find(lag => lag.from === "resp_rate_brpm").available, false);
      await f.page.locator("#arousal-button").click();
      assert.match(await f.page.locator("#arousal-coverage").innerText(), /4 physiological channels.*85\/100.*limited/i);
      assert.match(await f.page.locator("#arousal-components").innerText(), /Respiratory rate[\s\S]*Unavailable/);
      await f.frame(CENTER);
      const late = await f.snapshot();
      assert.ok(late.reference.resetNeeded.includes("resp_rate_brpm"));
      assert.deepEqual(late.weights, state.weights);
      assert.equal(component(late, "resp_rate_brpm").contribution, null);
    } finally { await f.close(); }
  });

  await check("Missing required channels hold the fixed model and stale data clear its visual instead of falling back", async () => {
    const f = await live();
    try {
      const before = await f.baseline(); const weights = before.weights;
      await f.repeat({ ...CENTER, heart_rate_bpm: 100, pulse_rmssd_ms: 15, pulse_sdnn_ms: 35, resp_rate_brpm: 20, eeg_beta_alpha: 4 }); await f.draw();
      await f.frame({ ...CENTER, pulse_sdnn_ms: null });
      const held = await f.snapshot(); const heldVisual = await f.draw();
      assert.equal(held.phase, "held"); assert.equal(held.value, null); assert.deepEqual(held.weights, weights);
      assert.equal(held.track, "multivariate"); assert.equal(heldVisual.available, false); assert.equal(heldVisual.radiusScale, null);
      assert.equal(await f.page.locator("#arousal-value").innerText(), "—");
      await f.page.clock.runFor(6000); const stale = await f.snapshot();
      assert.equal(stale.phase, "stale"); assert.equal(stale.value, null); assert.equal((await f.draw()).value, null);
    } finally { await f.close(); }
  });

  await check("Causal prediction history already displayed is unchanged when future observations are appended", async () => {
    const f = await live();
    try {
      await f.baseline(KEYS, true); await f.repeat({ ...CENTER, heart_rate_bpm: 75, pulse_rmssd_ms: 35 }, 15);
      const prefix = (await f.snapshot()).research.surprise.series;
      assert.ok(prefix.length > 100);
      await f.repeat({ ...CENTER, heart_rate_bpm: 110, pulse_rmssd_ms: 10, pulse_sdnn_ms: 20, resp_rate_brpm: 24, eeg_beta_alpha: 5 }, 20);
      const appended = (await f.snapshot()).research.surprise.series;
      assert.deepEqual(appended.slice(0, prefix.length), prefix, "Later frames must not refit past prediction errors");
    } finally { await f.close(); }
  });

  await check("A convergent onset appears live and an explicit session download preserves its replay inputs", async () => {
    const f = await live();
    try {
      await f.baseline(KEYS, true);
      await f.repeat({ ...CENTER, heart_rate_bpm: 95, pulse_rmssd_ms: 20, pulse_sdnn_ms: 35, resp_rate_brpm: 22, eeg_beta_alpha: 4 }, 8);
      exportedState = await f.snapshot();
      assert.ok(exportedState.events.length >= 1); assert.ok(exportedState.events[0].drivers.length >= 2);
      await f.page.locator("#arousal-button").click();
      assert.match(await f.page.locator("#live-analysis .math-events").innerText(), /HR|Pulse RMSSD|Breathing/);
      const promise = f.page.waitForEvent("download"); await f.page.locator("#export-live-session").click();
      const download = await promise; exportedSession = JSON.parse(await readFile(await download.path(), "utf8"));
      assert.equal(exportedSession.schema_version, "live-multivariate-1"); assert.equal(exportedSession.model_version, "multivariate-1");
      assert.equal(exportedSession.provenance.kind, "user-supplied"); assert.equal(exportedSession.demo_reference, false);
      assert.deepEqual(exportedSession.frames, f.frames); assert.ok(exportedSession.frames.every(frame => Number.isFinite(frame.pulse_sdnn_ms)));
    } finally { await f.close(); }
  });

  await check("Lab opens the exported live session, reproduces the same integrated model, and scrubs causally", async () => {
    const f = await open("Autonomic_Telemetry_Signal_Lab.html");
    try {
      await f.page.waitForFunction(() => Boolean(window.TelemetryMultivariateReplay));
      await f.page.locator("#multi-file").setInputFiles({ name: "invented-live-session.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exportedSession)) });
      await f.page.waitForFunction(() => document.getElementById("multi-status").textContent.includes("Exported live session"));
      const replay = await f.page.evaluate(() => TelemetryMultivariateReplay.getState());
      assert.equal(replay.modelVersion, exportedState.modelVersion); assert.equal(replay.value, exportedState.value);
      assert.deepEqual(replay.weights, exportedState.weights); assert.deepEqual(replay.events, exportedState.events);
      assert.deepEqual(replay.research.surprise.series, exportedState.research.surprise.series);
      await f.page.evaluate(() => TelemetryMultivariateReplay.seek(80));
      assert.equal((await f.page.evaluate(() => TelemetryMultivariateReplay.getState())).phase, "calibrating");
      assert.equal(await f.page.locator("#multi-value").innerText(), "—");
      await f.page.evaluate(last => TelemetryMultivariateReplay.seek(last), exportedSession.frames.length - 1);
      assert.deepEqual((await f.page.evaluate(() => TelemetryMultivariateReplay.getState())).events, exportedState.events);
    } finally { await f.close(); }
  });

  await check("Live to Demo to Live preserves separate recording histories and exact export/replay", async () => {
    const f = await live();
    let replayPage;
    try {
      async function downloadSession() {
        if (!(await f.page.locator("#arousal-sheet").evaluate(dialog => dialog.open)))
          await f.page.locator("#arousal-button").click();
        const pending = f.page.waitForEvent("download");
        await f.page.locator("#export-live-session").click();
        const download = await pending;
        return JSON.parse(await readFile(await download.path(), "utf8"));
      }
      const shift = { ...CENTER, heart_rate_bpm: 95, pulse_rmssd_ms: 20, pulse_sdnn_ms: 35, resp_rate_brpm: 22, eeg_beta_alpha: 4 };
      await f.baseline(KEYS, true); await f.repeat(shift, 8);
      const originalLive = await downloadSession();
      assert.deepEqual(originalLive.frames, f.frames);
      await f.page.locator("#arousal-sheet [data-close]").click();
      await f.page.locator("#demo-button").click(); await f.page.clock.runFor(2100);
      const demoState = await f.snapshot(), demoSession = await downloadSession();
      assert.equal(demoState.source, "synthetic");
      assert.equal(demoSession.provenance.kind, "synthetic"); assert.equal(demoSession.demo_reference, true);
      assert.ok(demoSession.frames.length >= 2);
      assert.ok(demoSession.frames.every(frame => frame.source === "synthetic"));
      await f.page.locator("#arousal-sheet [data-close]").click();
      await f.page.locator("#demo-button").click();
      await f.frame(shift);
      const resumed = await f.snapshot(), liveSession = await downloadSession();
      assert.equal(resumed.phase, "ready"); assert.equal(resumed.source, "device-reported");
      assert.equal(liveSession.provenance.kind, "user-supplied"); assert.equal(liveSession.demo_reference, false);
      assert.deepEqual(liveSession.frames.slice(0, originalLive.frames.length), originalLive.frames,
        "Returning from Demo must retain all live frames that established the retained live engine");
      assert.deepEqual(liveSession.frames, f.frames);
      assert.equal(liveSession.frames.length, originalLive.frames.length + 1);
      assert.ok(liveSession.frames.every(frame => frame.source === "device-reported"));
      replayPage = await open("Autonomic_Telemetry_Signal_Lab.html");
      await replayPage.page.waitForFunction(() => Boolean(window.TelemetryMultivariateReplay));
      const replay = await replayPage.page.evaluate(session => TelemetryMultivariateReplay.openSession(session), liveSession);
      assert.equal(replay.value, resumed.value);
      assert.deepEqual(replay.events, resumed.events);
      assert.deepEqual(replay.history, resumed.history);
      assert.deepEqual(replay.research.surprise.series, resumed.research.surprise.series);
      const replayedDemo = await replayPage.page.evaluate(session => TelemetryMultivariateReplay.openSession(session), demoSession);
      assert.equal(replayedDemo.value, demoState.value);
      assert.deepEqual(replayedDemo.research.surprise.series, demoState.research.surprise.series);
    } finally { await replayPage?.close(); await f.close(); }
  });

  await check("Replay rejects a future-learned reference or unsupported source without changing the open session", async () => {
    const f = await open("Autonomic_Telemetry_Signal_Lab.html");
    try {
      await f.page.waitForFunction(() => Boolean(window.TelemetryMultivariateReplay));
      const result = await f.page.evaluate(session => {
        const replay = TelemetryMultivariateReplay;
        replay.openSession(session);
        const capture = () => ({ state: replay.getState(), status: document.getElementById("multi-status").textContent,
          cursor: document.getElementById("multi-cursor").value, maximum: document.getElementById("multi-cursor").max,
          value: document.getElementById("multi-value").textContent });
        const before = capture();
        let clock = session.frames[0].received_at;
        const learner = TelemetryMultivariate.create({ now: () => clock });
        for (const frame of session.frames) { clock = frame.received_at; learner.ingest(frame); }
        const reference = learner.exportReference();
        if (!(reference.end > session.frames[0].received_at)) throw Error("The regression fixture needs a genuinely later learned reference");
        let futureError = "", sourceError = "";
        try { replay.openSession({ ...session, reference }); } catch (error) { futureError = error.message; }
        const afterFuture = capture();
        const unsupported = JSON.parse(JSON.stringify(session)); unsupported.frames[0].source = "unsupported-source";
        try { replay.openSession(unsupported); } catch (error) { sourceError = error.message; }
        return { before, afterFuture, afterSource: capture(), futureError, sourceError };
      }, exportedSession);
      assert.match(result.futureError, /future|reference must precede/i);
      assert.deepEqual(result.afterFuture, result.before,
        "Rejected future calibration must leave replay data, cursor, score, and status untouched");
      assert.match(result.sourceError, /provenance|source/i);
      assert.deepEqual(result.afterSource, result.before, "Rejected provenance must not partially replace the open replay");
    } finally { await f.close(); }
  });

  await check("A nonfinite motion hold survives JSON serialization and replay instead of becoming an eligible null", async () => {
    const f = await live();
    let replayPage;
    try {
      await f.baseline(); await f.frame(CENTER, { motion: NaN });
      assert.equal((await f.snapshot()).phase, "held");
      await f.page.locator("#arousal-button").click();
      const pending = f.page.waitForEvent("download"); await f.page.locator("#export-live-session").click();
      const download = await pending, session = JSON.parse(await readFile(await download.path(), "utf8"));
      assert.equal(session.frames.at(-1).motion, null, "JSON cannot represent the original nonfinite value");
      assert.equal(session.frames.at(-1).quality.motion.valid, false,
        "The exported validity flag must preserve the exclusion after NaN becomes null");
      replayPage = await open("Autonomic_Telemetry_Signal_Lab.html");
      await replayPage.page.waitForFunction(() => Boolean(window.TelemetryMultivariateReplay));
      const replay = await replayPage.page.evaluate(input => TelemetryMultivariateReplay.openSession(input), session);
      assert.equal(replay.phase, "held"); assert.equal(replay.value, null);
      assert.equal(await replayPage.page.locator("#multi-value").innerText(), "—");
    } finally { await replayPage?.close(); await f.close(); }
  });

  await check("Delayed feature envelopes preserve ingestion-time component expiry during export and causal replay", async () => {
    const f = await live();
    let replayPage;
    try {
      await f.baseline();
      const observed = (await f.page.evaluate(() => Date.now())) + 4000;
      await f.page.clock.setSystemTime(observed);
      const delayed = { type: "features", source: "device-reported", received_at: observed - 2000,
        ...CENTER, motion: 0,
        quality: Object.fromEntries(KEYS.map(key => [key, { valid: true, received_at: observed - 6000,
          source: "Invented fixture:" + key, reason: "Invented support that expired before ingestion" }])) };
      assert.equal(await f.page.evaluate(frame => TelemetryLive.features(frame), delayed), true);
      const held = await f.snapshot();
      assert.equal(held.phase, "held"); assert.equal(held.value, null);
      await f.page.locator("#arousal-button").click();
      const pending = f.page.waitForEvent("download");
      await f.page.locator("#export-live-session").click();
      const download = await pending, session = JSON.parse(await readFile(await download.path(), "utf8"));
      const saved = session.frames.at(-1);
      assert.equal(saved.observed_at, observed, "Export must preserve the clock used by the actual ingest");
      assert.equal(saved.observed_at - saved.received_at, 2000);
      assert.equal(saved.observed_at - saved.quality.heart_rate_bpm.received_at, 6000);
      replayPage = await open("Autonomic_Telemetry_Signal_Lab.html");
      const replay = await replayPage.page.evaluate(input => TelemetryMultivariateReplay.openSession(input), session);
      assert.deepEqual(replay, held, "Replay must not make six-second-old support fresh by using a two-second-old envelope as its clock");
      const last = session.frames.length - 1;
      await replayPage.page.evaluate(index => TelemetryMultivariateReplay.seek(index), last - 1);
      assert.equal((await replayPage.page.evaluate(() => TelemetryMultivariateReplay.getState())).phase, "ready");
      await replayPage.page.evaluate(index => TelemetryMultivariateReplay.seek(index), last);
      assert.equal((await replayPage.page.evaluate(() => TelemetryMultivariateReplay.getState())).phase, "held");
    } finally { await replayPage?.close(); await f.close(); }
  });

  await check("A ten-second gap resets the Rest comparison even when fresh input arrives before a stale render", async () => {
    const f = await live();
    try {
      await f.baseline(); await f.page.locator("#rest-mode").click();
      const shift = { ...CENTER, heart_rate_bpm: 95, pulse_rmssd_ms: 20, pulse_sdnn_ms: 35, resp_rate_brpm: 22, eeg_beta_alpha: 4 };
      await f.repeat(shift, 12);
      const before = await f.page.evaluate(() => TelemetryLive.getState());
      assert.equal(before.arousal.phase, "ready"); assert.ok(before.arousal.value > before.restStartValue + 10);
      const jump = (await f.page.evaluate(() => Date.now())) + 10000;
      await f.page.clock.setSystemTime(jump); // No RAF, timer callback, or stale render between these operations.
      assert.equal((await f.page.evaluate(() => TelemetryLive.getState())).arousal.phase, "ready");
      await f.frame(shift);
      const resumed = await f.page.evaluate(() => TelemetryLive.getState());
      assert.equal(resumed.arousal.phase, "ready");
      assert.equal(resumed.restStartValue, resumed.arousal.value);
      assert.notEqual(resumed.restStartValue, before.restStartValue);
      assert.match(await f.page.locator("#arousal-trend").innerText(), /starting level/);
    } finally { await f.close(); }
  });

  await check("Lab automatically follows normalized recording cursor and reports unavailable channels without inventing SDNN", async () => {
    const f = await open("Autonomic_Telemetry_Signal_Lab.html", true);
    try {
      await f.page.waitForFunction(() => Boolean(window.TelemetryMultivariateReplay));
      await f.page.evaluate(() => {
        const start = Date.parse("2026-01-01T12:00:00Z");
        const samples = Array.from({ length: 180 }, (_, i) => ({ timestamp: start + i * 1000, heart_rate_bpm: i < 140 ? 68 : 90,
          rmssd_ms: i < 140 ? 45 : 20, resp_rate_brpm: i < 140 ? 12 : 20, eeg_beta_alpha: null, motion_g: 0, quality: "good" }));
        Telemetry.openSession({ schema_version: 2, provenance: { kind: "synthetic", label: "Invented cursor fixture" }, samples, markers: [] });
        Telemetry.seek(130);
      });
      await f.page.clock.runFor(32);
      let replay = await f.page.evaluate(() => TelemetryMultivariateReplay.getState());
      assert.equal(replay.phase, "ready"); assert.equal(replay.limited, true);
      assert.equal(component(replay, "pulse_sdnn_ms").value, null); assert.equal(component(replay, "pulse_sdnn_ms").included, false);
      const before = replay.value;
      await f.page.evaluate(() => Telemetry.seek(165)); await f.page.clock.runFor(32);
      replay = await f.page.evaluate(() => TelemetryMultivariateReplay.getState());
      assert.ok(replay.value > before); assert.match(await f.page.locator("#multi-status").innerText(), /166 \/ 180 frames/);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await f.page.evaluate(() => Telemetry.seek(80)); await f.page.clock.runFor(32);
      assert.equal((await f.page.evaluate(() => TelemetryMultivariateReplay.getState())).phase, "calibrating");
      assert.equal(await f.page.locator("#multi-value").innerText(), "—");
    } finally { await f.close(); }
  });
  assert.deepEqual(errors, [], "Main and Lab integration must avoid browser errors");
  assert.deepEqual(external, [], "Standalone multivariate flows must remain offline");
  console.log(`\n${passed} multivariate UI checks passed.`);
} finally { await browser.close(); }
