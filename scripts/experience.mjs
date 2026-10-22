import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = pathToFileURL(
  path.join(root, "Autonomic_Telemetry_Console.html"),
).href;
const browser = await chromium.launch({ headless: true });
const errors = [],
  external = [];
let passed = 0;

async function check(name, callback) {
  await callback();
  passed++;
  console.log(`✓ ${name}`);
}

async function pageFor(url = standalone, { clock = false, ...options } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    ...options,
  });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (
      /^https?:$/.test(target.protocol) &&
      (!/^https?:/.test(url) || target.origin !== new URL(url).origin)
    )
      external.push(target.origin);
  });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.TelemetryLive));
  return { page, close: () => context.close() };
}

async function closeSheet(page, id) {
  await page.locator(`#${id} [data-close]`).click();
}

async function startRelay() {
  const child = spawn(
    process.env.PYTHON || "python3",
    ["-m", "bridge.server", "--simulate", "--host", "127.0.0.1", "--port", "0"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Local synthetic relay did not start")),
      10000,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(Error(`Local relay exited before startup (${code}): ${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\//);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
  }).catch((error) => {
    child.kill("SIGTERM");
    throw error;
  });
  return {
    url,
    async stop() {
      if (child.exitCode !== null) return;
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 6000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
      assert.equal(
        stderr,
        "",
        "Relay should not emit tracebacks or runtime warnings",
      );
    },
  };
}

let relay;
try {
  await check(
    "Untimed Work starts with an unavailable arousal estimate and no automatic device connection",
    async () => {
      const { page, close } = await pageFor();
      const state = await page.evaluate(() => TelemetryLive.getState());
      assert.equal(state.mode, "work");
      assert.equal(state.source, "ambient");
      assert.equal(state.timer.active, false);
      assert.equal(state.devices.muse.state, "idle");
      assert.equal(state.devices.hume.state, "idle");
      assert.equal(await page.locator("#task-input, #task-title").count(), 0);
      assert.equal(await page.locator("#arousal-value").innerText(), "—");
      assert.equal(state.arousal.phase, "waiting");
      assert.match(await page.locator("#source-label").innerText(), /Ambient/);
      assert.equal(await page.locator("#timer-chip").isVisible(), false);
      await page.locator("#about-button").click();
      assert.equal(
        await page
          .locator('a[href="Autonomic_Telemetry_Signal_Lab.html"]')
          .isVisible(),
        true,
        "The preserved signal tools must remain reachable from the ambient experience",
      );
      await closeSheet(page, "about-sheet");
      await close();
    },
  );

  await check(
    "Work and Rest change the whole palette and expose optional Rest breathing",
    async () => {
      const { page, close } = await pageFor();
      const work = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      await page.locator("#rest-mode").click();
      await page.waitForFunction(
        () => TelemetryLive.getState().mode === "rest",
      );
      await page.locator("#space-button").click();
      assert.equal(await page.locator("#breathing-row").isVisible(), true);
      await page.locator("#breath-toggle").click();
      await closeSheet(page, "space-sheet");
      assert.equal(await page.locator("#breath-cue").isVisible(), true);
      const rest = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      assert.notEqual(work, rest);
      await page.locator("#work-mode").click();
      assert.equal(await page.locator("#breath-cue").isVisible(), false);
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).timer.active,
        false,
      );
      await close();
    },
  );

  await check(
    "Demo is explicit, labeled synthetic, and returns to ambient when ended",
    async () => {
      const { page, close } = await pageFor();
      await page.locator("#demo-button").click();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).source,
        "demo",
      );
      assert.match(
        await page.locator("#source-label").innerText(),
        /Demo.*synthetic/,
      );
      await page.locator("#connect-button").click();
      assert.equal(
        await page.locator("#trace-source").innerText(),
        "SYNTHETIC",
      );
      await closeSheet(page, "connect-sheet");
      await page.locator("#demo-button").click();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).source,
        "ambient",
      );
      assert.match(await page.locator("#source-label").innerText(), /Ambient/);
      await close();
    },
  );

  await check(
    "Only valid fresh raw data can establish a live device source",
    async () => {
      const { page, close } = await pageFor();
      const result = await page.evaluate(() => {
        const data = {
          device: "muse",
          type: "eeg",
          channel: 0,
          samples: [0, 1, -1],
          source: "device-reported",
        };
        return [
          TelemetryLive.receive({ ...data, received_at: Date.now() - 10000 }),
          TelemetryLive.receive({ ...data, received_at: Date.now() + 10000 }),
          TelemetryLive.receive({
            ...data,
            samples: [NaN, Infinity],
            received_at: Date.now(),
          }),
          TelemetryLive.receive({ ...data, received_at: Date.now() }),
        ];
      });
      assert.deepEqual(result, [false, false, false, true]);
      await page.waitForFunction(
        () => TelemetryLive.getState().source === "live",
      );
      assert.match(
        await page.locator("#source-label").innerText(),
        /Live.*Muse/,
      );
      const state = await page.evaluate(() => TelemetryLive.getState());
      assert.equal(
        state.signals.heartRate,
        null,
        "EEG must not fabricate pulse or HRV",
      );
      await close();
    },
  );

  await check(
    "Status alone never creates LIVE, and stale/disconnected devices return to ambient",
    async () => {
      const { page, close } = await pageFor();
      await page.evaluate(() =>
        TelemetryLive.status({ device: "muse", state: "streaming" }),
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).source,
        "ambient",
      );
      await page.evaluate(() =>
        TelemetryLive.receive({
          device: "hume",
          type: "heart_rate",
          heart_rate_bpm: 71,
          received_at: Date.now(),
          source: "device-reported",
        }),
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).signals.heartRate,
        71,
      );
      await page.evaluate(() =>
        TelemetryLive.status({
          device: "hume",
          state: "stale",
          message: "Signal paused",
        }),
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).source,
        "ambient",
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).signals.heartRate,
        null,
      );
      await page.evaluate(() =>
        TelemetryLive.status({ device: "muse", state: "disconnected" }),
      );
      assert.match(await page.locator("#source-label").innerText(), /Ambient/);
      await close();
    },
  );

  await check(
    "Freshness expires from receipt time without switching to synthetic data",
    async () => {
      const { page, close } = await pageFor(standalone, { clock: true });
      const receipt = await page.evaluate(() => {
        const received_at = Date.now() - 3000;
        TelemetryLive.receive({
          device: "muse",
          type: "eeg",
          samples: [1, -1, 0],
          received_at,
          source: "device-reported",
        });
        return received_at;
      });
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).devices.muse
          .lastAt,
        receipt,
      );
      await page.clock.fastForward(8000);
      const state = await page.evaluate(() => TelemetryLive.getState());
      assert.equal(state.devices.muse.state, "stale");
      assert.equal(state.source, "ambient");
      assert.equal(state.demo, false);
      await close();
    },
  );

  await check(
    "Quiet, reduced motion, still image, and keyboard dialog controls work",
    async () => {
      const { page, close } = await pageFor();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).gentle,
        true,
      );
      await page.locator("#space-button").focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("#space-sheet").evaluate((dialog) => dialog.open),
        true,
      );
      await page.locator("#quiet-toggle").click();
      await page.locator("#pause-toggle").click();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).quiet,
        true,
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).paused,
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#space-sheet").evaluate((dialog) => dialog.open),
        false,
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "space-button",
      );
      const image = await page
        .locator("#field")
        .evaluate((canvas) => canvas.toDataURL());
      await page.waitForTimeout(80);
      assert.equal(
        await page.locator("#field").evaluate((canvas) => canvas.toDataURL()),
        image,
        "Still image must stay still",
      );
      await close();
    },
  );

  await check(
    "Optional timer validates duration and uses wall time through pause, resume, and completion",
    async () => {
      const { page, close } = await pageFor(standalone, { clock: true });
      await page.locator("#timer-button").click();
      await page.locator("#custom-minutes").fill("0");
      await page.locator("#start-timer").click();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).timer.active,
        false,
      );
      await page.locator("#custom-minutes").fill("1");
      await page.locator("#start-timer").click();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).timer.active,
        true,
      );
      await page.clock.fastForward(20000);
      await page.locator("#timer-chip").click();
      await page.locator("#pause-timer").click();
      const remaining = (await page.evaluate(() => TelemetryLive.getState()))
        .timer.remaining;
      assert.ok(remaining <= 40000 && remaining >= 38000);
      await page.clock.fastForward(30000);
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).timer.remaining,
        remaining,
      );
      await page.locator("#pause-timer").click();
      await page.clock.fastForward(41000);
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).timer.active,
        false,
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).source,
        "ambient",
      );
      await close();
    },
  );

  await check(
    "All five sheets and both spaces fit 360px portrait and short landscape screens",
    async () => {
      for (const viewport of [
        { width: 360, height: 780 },
        { width: 844, height: 390 },
      ]) {
        const { page, close } = await pageFor(standalone, {
          viewport,
          isMobile: true,
          hasTouch: true,
        });
        for (const mode of ["work", "rest"]) {
          await page.locator(`#${mode}-mode`).click();
          for (const name of [
            "connect",
            "timer",
            "space",
            "about",
            "arousal",
          ]) {
            await page.locator(`#${name}-button`).click();
            const bounds = await page.locator(`#${name}-sheet`).boundingBox();
            assert.ok(
              bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1,
              `${mode} ${name} sheet must fit screen width`,
            );
            assert.ok(
              bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1,
              `${mode} ${name} sheet must fit screen height`,
            );
            await closeSheet(page, `${name}-sheet`);
          }
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          const dock = await page.locator(".dock").boundingBox();
          assert.ok(
            dock.y >= 0 && dock.y + dock.height <= viewport.height,
            "Phone dock stays reachable",
          );
        }
        await close();
      }
    },
  );

  await check(
    "A fixed personal reference enables a visible estimate; Work and Rest share it",
    async () => {
      const { page, close } = await pageFor(standalone, { clock: true });
      let stamp = await page.evaluate(() => Date.now());
      async function frame(
        hr = 68,
        prv = 45,
        source = "Fixture cardiac source",
      ) {
        stamp += 1000;
        await page.clock.setSystemTime(stamp);
        await page.evaluate(
          ({ stamp, hr, prv, source }) =>
            TelemetryLive.features({
              received_at: stamp,
              source: "device-reported",
              heart_rate_bpm: hr,
              pulse_rmssd_ms: prv,
              motion: 0,
              quality: {
                heart_rate_bpm: { valid: true, received_at: stamp, source },
                pulse_rmssd_ms: {
                  valid: prv !== null,
                  received_at: stamp,
                  source: "Fixture optical signal",
                  reason: prv === null ? "No usable optical waveform" : "",
                },
              },
            }),
          { stamp, hr, prv, source },
        );
      }
      await frame();
      assert.equal(await page.locator("#arousal-value").innerText(), "—");
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).arousal.phase,
        "calibrating",
      );
      for (let i = 1; i < 120; i++) await frame();
      let a = (await page.evaluate(() => TelemetryLive.getState())).arousal;
      assert.equal(a.phase, "ready");
      assert.equal(a.value, 50);
      assert.equal(a.track, "dual");
      assert.equal(await page.locator("#arousal-value").innerText(), "50");
      await page.locator("#rest-mode").click();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).arousal.value,
        50,
      );
      assert.match(
        await page.locator("#arousal-trend").innerText(),
        /starting level/,
      );
      assert.match(
        await page.locator("#mode-action").innerText(),
        /breathing guide/i,
      );
      await page.locator("#mode-action").click();
      assert.equal(await page.locator("#breath-cue").isVisible(), true);
      for (let i = 0; i < 20; i++) await frame(80, 25);
      assert.match(
        await page.locator("#arousal-trend").innerText(),
        /higher since entering Rest/,
      );
      await frame(80, null);
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).arousal.track,
        "hr",
      );
      assert.match(
        await page.locator("#arousal-coverage").innerText(),
        /HR-only.*limited/,
      );
      assert.match(
        await page.locator("#arousal-trend").innerText(),
        /starting level/,
        "Coverage switches must not compare different reference scales",
      );
      await page.clock.fastForward(6000);
      assert.equal(await page.locator("#arousal-value").innerText(), "—");
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).restStartValue,
        null,
      );
      await frame(72, null);
      assert.match(
        await page.locator("#arousal-trend").innerText(),
        /starting level/,
        "Resuming after stale data starts a fresh Rest comparison",
      );
      await page.locator("#arousal-button").click();
      assert.match(
        await page.locator("#arousal-components").innerText(),
        /Fixture cardiac source/,
      );
      await page.locator("#reset-reference").click();
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).arousal.phase,
        "waiting",
      );
      assert.equal(await page.locator("#arousal-value").innerText(), "—");
      await close();
    },
  );

  await check(
    "Demo arousal is synthetic and cannot seed the personal live reference",
    async () => {
      const { page, close } = await pageFor(standalone, { clock: true });
      await page.locator("#demo-button").click();
      await page.clock.runFor(1100);
      let a = (await page.evaluate(() => TelemetryLive.getState())).arousal;
      assert.equal(a.phase, "ready");
      assert.equal(a.source, "synthetic");
      assert.match(
        await page.locator("#arousal-coverage").innerText(),
        /Synthetic demo/,
      );
      await page.locator("#demo-button").click();
      a = (await page.evaluate(() => TelemetryLive.getState())).arousal;
      assert.equal(a.phase, "waiting");
      assert.equal(a.value, null);
      await close();
    },
  );

  await check(
    "Work cue is optional and requires sustained elevation; Rest has a separate breathing action",
    async () => {
      const { page, close } = await pageFor(standalone, { clock: true });
      let stamp = await page.evaluate(() => Date.now());
      async function frame(hr) {
        stamp += 1000;
        await page.clock.setSystemTime(stamp);
        await page.evaluate(
          ({ stamp, hr }) =>
            TelemetryLive.features({
              received_at: stamp,
              source: "device-reported",
              heart_rate_bpm: hr,
              motion: 0,
              quality: {
                heart_rate_bpm: {
                  valid: true,
                  received_at: stamp,
                  source: "Fixture cardiac source",
                },
              },
            }),
          { stamp, hr },
        );
      }
      for (let i = 0; i < 120; i++) await frame(68);
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).elevationCue,
        false,
      );
      await page.locator("#mode-action").click();
      for (let i = 0; i < 85; i++) await frame(90);
      assert.match(
        await page.locator("#toast").innerText(),
        /stayed above reference/,
      );
      await page.locator("#rest-mode").click();
      assert.match(
        await page.locator("#mode-action").innerText(),
        /breathing guide/i,
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).arousal.phase,
        "ready",
      );
      await close();
    },
  );

  relay = await startRelay();
  await check(
    "Same-origin relay starts without pairing and exposes a synthetic connection honestly",
    async () => {
      const { page, close } = await pageFor(relay.url);
      await page.waitForFunction(
        () => TelemetryLive.getState().relay.connected,
      );
      const state = await page.evaluate(() => TelemetryLive.getState());
      assert.equal(state.relay.simulated, true);
      assert.equal(state.source, "ambient");
      assert.equal(state.devices.muse.state, "idle");
      await page.locator("#connect-button").click();
      assert.match(await page.locator("#relay-note").innerText(), /synthetic/i);
      await close();
    },
  );

  await check(
    "Phone device picker filters Muse and Hume, streams over real SSE, and disconnects both",
    async () => {
      const { page, close } = await pageFor(relay.url, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await page.waitForFunction(
        () => TelemetryLive.getState().relay.connected,
      );
      await page.locator("#connect-button").click();
      for (const kind of ["muse", "hume"]) {
        await page.locator(`#${kind}-connect`).click();
        await page.waitForFunction(
          () => document.querySelectorAll("#device-results button").length > 0,
        );
        assert.equal(await page.locator("#device-results button").count(), 1);
        assert.match(
          await page.locator("#device-results").innerText(),
          kind === "muse" ? /Synthetic Muse/ : /Synthetic Hume/,
        );
        await page.locator("#device-results button").click();
        await page.waitForFunction(
          (kind) =>
            TelemetryLive.getState().devices[kind].state === "streaming",
          kind,
        );
      }
      await page.waitForFunction(
        () => TelemetryLive.getState().signals.heartRate !== null,
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).source,
        "demo",
      );
      assert.match(
        await page.locator("#source-label").innerText(),
        /Demo.*synthetic/,
      );
      assert.equal(
        await page.locator("#trace-source").innerText(),
        "SYNTHETIC",
      );
      for (const kind of ["muse", "hume"]) {
        await page.locator(`#${kind}-connect`).click();
        await page.waitForFunction(
          (kind) =>
            TelemetryLive.getState().devices[kind].state === "disconnected",
          kind,
        );
      }
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).source,
        "ambient",
      );
      assert.equal(
        (await page.evaluate(() => TelemetryLive.getState())).signals.heartRate,
        null,
      );
      await close();
    },
  );

  await check(
    "Relay rejects stale packets and repeated sequence numbers before UI ingress",
    async () => {
      // Observe the browser adapter before its timestamp/session/sequence checks.
      // A fake EventSource supplies controlled messages; all HTTP state sync is real.
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      const controlled = await context.newPage();
      controlled.on("pageerror", (error) => errors.push(error.message));
      await controlled.addInitScript(() => {
        window.EventSource = class {
          constructor() {
            window.__stream = this;
          }
          close() {}
        };
      });
      await controlled.goto(relay.url);
      await controlled.waitForFunction(
        () => window.__stream && window.TelemetryLive,
      );
      const result = await controlled.evaluate(() => {
        const cfg = window.__AUTONOMIC_RELAY__,
          original = TelemetryLive.receive,
          originalFeatures = TelemetryLive.features;
        const accepted = [],
          acceptedFeatures = [];
        TelemetryLive.features = (value) => {
          acceptedFeatures.push(value);
          return originalFeatures(value);
        };
        TelemetryLive.receive = (value) => {
          accepted.push(value);
          return original(value);
        };
        const message = (sequence, received_at, session = cfg.session) =>
          window.__stream.onmessage({
            data: JSON.stringify({
              kind: "raw",
              session,
              sequence,
              payload: {
                device: "muse",
                type: "eeg",
                samples: [1, 0, -1],
                received_at,
              },
            }),
          });
        message(1000, Date.now() - 20000);
        message(1001, Date.now());
        message(1001, Date.now());
        message(1002, Date.now(), "different-session");
        const featureMessage = (
          sequence,
          received_at,
          componentAt = received_at,
        ) =>
          window.__stream.onmessage({
            data: JSON.stringify({
              kind: "features",
              session: cfg.session,
              sequence,
              payload: {
                received_at,
                source: "device-reported",
                heart_rate_bpm: 68,
                quality: {
                  heart_rate_bpm: {
                    valid: true,
                    received_at: componentAt,
                    source: "Fixture",
                  },
                },
              },
            }),
          });
        featureMessage(1003, Date.now() - 20000);
        featureMessage(1004, Date.now(), Date.now() - 20000);
        featureMessage(1004, Date.now());
        featureMessage(1005, Date.now(), Date.now() - 3000);
        return {
          accepted: accepted.length,
          acceptedFeatures,
          state: TelemetryLive.getState(),
        };
      });
      assert.equal(result.accepted, 1);
      assert.equal(
        result.acceptedFeatures.length,
        2,
        "Stale and duplicated feature frames stop before UI ingress",
      );
      assert.equal(
        result.acceptedFeatures[0].quality.heart_rate_bpm.valid,
        false,
        "A fresh envelope must not make old supporting HR fresh",
      );
      assert.equal(
        result.acceptedFeatures[0].source,
        "synthetic",
        "Simulated relay cannot claim measured feature provenance",
      );
      const supportAge =
        result.acceptedFeatures[1].received_at -
        result.acceptedFeatures[1].quality.heart_rate_bpm.received_at;
      assert.ok(
        supportAge >= 2900 && supportAge <= 3100,
        "Fresh feature frame preserves component age",
      );
      assert.equal(
        result.state.source,
        "demo",
        "Synthetic relay must never claim live hardware",
      );
      await context.close();
    },
  );

  await check(
    "Standalone remains offline and all exercised flows avoid JavaScript errors",
    async () => {
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
    },
  );
  console.log(`\n${passed} experience checks passed.`);
} finally {
  await browser.close();
  await relay?.stop();
}
