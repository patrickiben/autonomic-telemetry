import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Exercises both practice modes against the actual offline HTML. Browser time
// is controlled so these checks need no real waiting or physiological input.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const consoleUrl = pathToFileURL(
  path.join(root, "Autonomic_Telemetry_Console.html"),
).href;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
context.setDefaultTimeout(10_000);
const externalRequests = [];
const pageErrors = [];
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (
    url.startsWith("file:") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return route.continue();
  }
  externalRequests.push(url);
  return route.abort();
});
context.on("page", (page) =>
  page.on("pageerror", (error) => pageErrors.push(error.message)),
);
let checks = 0;
async function check(name, run) {
  await run();
  checks += 1;
  console.log(`✓ ${name}`);
}

function installMuseMock() {
  const suffix = "-4c4d-454d-96be-f03bac821358";
  const mock = { commands: [], services: [], disconnects: 0, options: null };
  const characteristics = new Map();
  class Characteristic extends EventTarget {
    constructor(uuid) {
      super();
      this.uuid = uuid;
      this.value = null;
    }
    async startNotifications() {
      return this;
    }
    async stopNotifications() {
      return this;
    }
    async writeValue(value) {
      mock.commands.push(
        Array.from(
          new Uint8Array(
            value.buffer || value,
            value.byteOffset || 0,
            value.byteLength,
          ),
        ),
      );
    }
  }
  const service = {
    async getCharacteristic(uuid) {
      if (!characteristics.has(uuid))
        characteristics.set(uuid, new Characteristic(uuid));
      return characteristics.get(uuid);
    },
  };
  const device = new EventTarget();
  device.name = "Mock Muse S · not physical hardware";
  device.gatt = {
    connected: false,
    async connect() {
      this.connected = true;
      return this;
    },
    async getPrimaryService(uuid) {
      mock.services.push(uuid);
      if (uuid !== 0xfe8d) throw Error("Wrong Muse service UUID");
      return service;
    },
    disconnect() {
      this.connected = false;
      mock.disconnects += 1;
      device.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
  mock.emit = (shortUuid, bytes) => {
    const characteristic = characteristics.get(`273e${shortUuid}${suffix}`);
    if (!characteristic)
      throw Error(`Characteristic ${shortUuid} was not subscribed`);
    characteristic.value = new DataView(new Uint8Array(bytes).buffer);
    characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
  };
  window.__museMock = mock;
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    value: {
      async requestDevice(options) {
        mock.options = options;
        return device;
      },
    },
  });
}

try {
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-10-22T12:00:00Z") });
  await page.goto(consoleUrl);
  await page.waitForFunction(() => Boolean(window.Telemetry?.getModeState));
  await page.clock.pauseAt(new Date("2026-10-22T12:00:01Z"));

  await check(
    "Rest is the default and each mode has its own initial duration",
    async () => {
      const rest = await page.evaluate(() => window.Telemetry.getModeState());
      assert.equal(rest.mode, "rest");
      assert.equal(rest.practice.mode, "rest");
      assert.equal(rest.practice.phase, "idle");
      assert.equal(rest.practice.durationMs, 10 * 60_000);
      assert.equal(rest.practice.elapsedMs, 0);
      const work = await page.evaluate(() => {
        window.Telemetry.setMode("work");
        return window.Telemetry.getModeState();
      });
      assert.equal(work.practice.mode, "work");
      assert.equal(work.practice.durationMs, 25 * 60_000);
      assert.equal(work.practice.phase, "idle");
    },
  );

  await check(
    "mode switches preserve recording provenance, markers, context, reference, and model",
    async () => {
      const result = await page.evaluate(() => {
        const T = window.Telemetry;
        T.restart();
        T.seek(140);
        T.loadHealth(
          '<HealthData><Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Hume" unit="count/min" value="60" startDate="2026-10-21 08:00:00 -0400"/></HealthData>',
        );
        const fingerprint = () => {
          const s = T.getState();
          return JSON.stringify({
            dataset: s.dataset,
            cursor: s.cursor,
            markers: s.markers,
            context: s.context,
            baseline: s.baseline,
            derived: s.derived,
          });
        };
        const before = fingerprint();
        T.setMode("rest");
        T.setMode("work");
        T.setMode("rest");
        return before === fingerprint();
      });
      assert.equal(result, true);
    },
  );

  await check(
    "invalid modes and durations are rejected without changing the active practice",
    async () => {
      const result = await page.evaluate(() => {
        const T = window.Telemetry;
        const before = JSON.stringify(T.getModeState());
        const rejects = (run) => {
          try {
            run();
            return false;
          } catch {
            return true;
          }
        };
        const modes = ["focus", "", null].map((value) =>
          rejects(() => T.setMode(value)),
        );
        const durations = [0, -1, 181, NaN, Infinity].map((value) =>
          rejects(() => T.setSessionDuration(value)),
        );
        return {
          rejected: [...modes, ...durations],
          unchanged: before === JSON.stringify(T.getModeState()),
        };
      });
      assert.ok(result.rejected.every(Boolean));
      assert.equal(result.unchanged, true);
    },
  );

  await check(
    "practice elapsed time follows wall time while recording playback stays paused",
    async () => {
      await page.evaluate(() => {
        const T = window.Telemetry;
        T.restart();
        T.setMode("rest");
        T.resetPractice();
        T.setSessionDuration(2);
        T.startPractice();
      });
      await page.clock.runFor(2500);
      const result = await page.evaluate(() => ({
        practice: window.Telemetry.getModeState().practice,
        recording: window.Telemetry.getState().cursor,
      }));
      assert.equal(result.practice.elapsedMs, 2500);
      assert.equal(result.practice.remainingMs, 117500);
      assert.equal(result.practice.phase, "running");
      assert.equal(result.recording, 0);
      await page.evaluate(() => window.Telemetry.pausePractice());
      await page.clock.runFor(1700);
      const paused = await page.evaluate(
        () => window.Telemetry.getModeState().practice,
      );
      assert.equal(paused.phase, "paused");
      assert.equal(paused.elapsedMs, 2500);
      await page.evaluate(() => window.Telemetry.startPractice());
      await page.clock.runFor(1500);
      const resumed = await page.evaluate(
        () => window.Telemetry.getModeState().practice,
      );
      assert.equal(resumed.elapsedMs, 4000);
      assert.equal(resumed.remainingMs, 116000);
      await page.evaluate(() => window.Telemetry.pausePractice());
    },
  );

  await check(
    "switching modes pauses the timer and restores independent per-mode progress",
    async () => {
      await page.evaluate(() => {
        const T = window.Telemetry;
        T.setMode("rest");
        T.resetPractice();
        T.setSessionDuration(2);
        T.startPractice();
      });
      await page.clock.runFor(3500);
      await page.evaluate(() => window.Telemetry.setMode("work"));
      await page.clock.runFor(5000);
      const rest = await page.evaluate(() => {
        const T = window.Telemetry;
        T.setMode("rest");
        return T.getModeState().practice;
      });
      assert.equal(rest.phase, "paused");
      assert.equal(rest.elapsedMs, 3500);
      assert.equal(rest.durationMs, 120000);
      await page.evaluate(() => {
        const T = window.Telemetry;
        T.setMode("work");
        T.resetPractice();
        T.setSessionDuration(3);
        T.startPractice();
      });
      await page.clock.runFor(2000);
      const work = await page.evaluate(() => {
        const T = window.Telemetry;
        T.setMode("rest");
        T.setMode("work");
        return T.getModeState().practice;
      });
      assert.equal(work.phase, "paused");
      assert.equal(work.elapsedMs, 2000);
      assert.equal(work.durationMs, 180000);
    },
  );

  await check(
    "automatic completion caps elapsed time and repeated finishing does not duplicate sessions",
    async () => {
      await page.evaluate(() => {
        const T = window.Telemetry;
        T.resetPractice();
        T.setSessionDuration(1);
        T.startPractice();
      });
      // Simulate a suspended/background page waking after the deadline, too.
      await page.clock.fastForward(65000);
      const complete = await page.evaluate(() =>
        window.Telemetry.getModeState(),
      );
      assert.equal(complete.practice.phase, "complete");
      assert.equal(complete.practice.elapsedMs, 60000);
      assert.equal(complete.practice.remainingMs, 0);
      const count = complete.sessions.length;
      assert.ok(count > 0);
      await page.evaluate(() => {
        window.Telemetry.finishPractice();
        window.Telemetry.finishPractice();
      });
      assert.equal(
        await page.evaluate(
          () => window.Telemetry.getModeState().sessions.length,
        ),
        count,
      );
    },
  );

  const ui = await context.newPage();
  await ui.goto(consoleUrl);
  await ui.waitForFunction(() => Boolean(window.Telemetry?.getModeState));

  await check(
    "mode controls expose different workspaces and support keyboard navigation",
    async () => {
      const restTitle = await ui.locator("#practice-title").innerText();
      assert.equal(await ui.locator(".pacer").isVisible(), true);
      assert.equal(await ui.locator(".work-companion").isVisible(), false);
      assert.equal(await ui.locator("#signal-index").isVisible(), false);
      await ui.locator("#mode-rest").focus();
      await ui.locator("#mode-rest").press("End");
      assert.equal(
        await ui.evaluate(() => document.activeElement.id),
        "mode-work",
      );
      assert.equal(
        await ui.locator("#mode-work").getAttribute("aria-pressed"),
        "true",
      );
      assert.notEqual(
        await ui.locator("#practice-title").innerText(),
        restTitle,
      );
      assert.equal(await ui.locator(".pacer").isVisible(), false);
      assert.equal(await ui.locator(".work-companion").isVisible(), true);
      assert.equal(await ui.locator("#signal-index").isVisible(), true);
      await ui.locator("#practice-activity").selectOption("learn");
      assert.match(
        await ui.locator("#work-companion-heading").innerText(),
        /idea|words/i,
      );
      await ui.locator("#practice-activity").selectOption("practice");
      assert.match(
        await ui.locator("#work-companion-heading").innerText(),
        /skill/i,
      );
      await ui.locator("#mode-work").focus();
      await ui.locator("#mode-work").press("Home");
      assert.equal(
        await ui.evaluate(() => document.activeElement.id),
        "mode-rest",
      );
      assert.equal(await ui.locator("#practice-title").innerText(), restTitle);
    },
  );

  await check(
    "optional self-ratings and escaped intentions stay distinct for Rest and Work",
    async () => {
      const payload =
        '<img data-mode-probe="x" src="https://invalid.example/mode" onerror="window.modeInjected=1">';
      await ui.locator("#practice-intention").fill(payload);
      await ui.locator("#practice-duration").fill("2");
      await ui.locator("#practice-duration").press("Tab");
      await ui.locator("#rating-before").selectOption("2");
      await ui.locator("#practice-start").click();
      await ui.locator("#practice-pause").click();
      await ui.locator("#practice-finish").click();
      await ui.locator("#rating-after").selectOption("5");
      assert.equal(await ui.locator("#session-recap").isVisible(), true);
      assert.match(
        await ui.locator("#recap-ratings").innerText(),
        /Ease.*2.*5.*self-reported/,
      );
      assert.ok(
        (await ui.locator("#recap-intention").innerText()).includes(payload),
      );
      assert.equal(await ui.locator("img[data-mode-probe]").count(), 0);
      assert.equal(
        await ui.evaluate(() => Boolean(window.modeInjected)),
        false,
      );
      await ui.locator("#mode-work").click();
      await ui.locator("#practice-intention").fill("Explain one idea");
      await ui.locator("#practice-duration").fill("1");
      await ui.locator("#practice-duration").press("Tab");
      await ui.locator("#rating-before").selectOption("3");
      await ui.locator("#practice-start").click();
      await ui.locator("#practice-finish").click();
      await ui.locator("#rating-after").selectOption("4");
      assert.match(
        await ui.locator("#recap-ratings").innerText(),
        /Focus.*3.*4.*self-reported/,
      );
      const records = await ui.evaluate(
        () => window.Telemetry.getModeState().sessions,
      );
      assert.equal(records.length, 2);
      for (const record of records) {
        assert.equal(record.source, "self-reported");
        assert.ok(Number.isFinite(record.startedAt));
        assert.ok(
          Number.isFinite(record.endedAt) && record.endedAt >= record.startedAt,
        );
      }
      assert.equal(records[0].before, 2);
      assert.equal(records[0].after, 5);
      assert.equal(records[1].before, 3);
      assert.equal(records[1].after, 4);
      await ui.locator("#mode-rest").click();
      assert.equal(
        await ui.locator("#practice-intention").inputValue(),
        payload,
      );
      await ui.locator("#mode-work").click();
      assert.equal(
        await ui.locator("#practice-intention").inputValue(),
        "Explain one idea",
      );
    },
  );

  await check(
    "workspace exports round-trip notes and restore running timers paused",
    async () => {
      const result = await ui.evaluate(() => {
        const T = window.Telemetry;
        T.resetPractice();
        T.startPractice();
        const exported = T.getExport();
        T.openSession(
          T.parseSession(JSON.stringify(exported), "json", "Saved workspace"),
        );
        return {
          exported,
          restored: T.getModeState(),
          savedAgain: T.getExport(),
        };
      });
      assert.equal(result.exported.workspace.active_mode, "work");
      assert.equal(result.exported.workspace.practices.work.phase, "running");
      assert.equal(result.restored.mode, "work");
      assert.equal(result.restored.practice.phase, "paused");
      assert.equal(
        result.restored.practice.elapsedMs,
        result.exported.workspace.practices.work.elapsedMs,
      );
      assert.deepEqual(
        result.savedAgain.workspace.sessions,
        result.exported.workspace.sessions,
      );
      assert.deepEqual(result.savedAgain.samples, result.exported.samples);
      assert.equal(result.savedAgain.provenance.kind, "synthetic");
    },
  );

  await check(
    "invalid imported ratings and timers fail, and old sessions without workspace remain compatible",
    async () => {
      const result = await ui.evaluate(() => {
        const T = window.Telemetry;
        const exported = T.getExport();
        const rejected = [];
        for (const edit of [
          (w) => (w.practices.rest.before = 0),
          (w) => (w.practices.work.after = 6),
          (w) => (w.practices.rest.durationMs = 1),
          (w) => (w.practices.work.elapsedMs = w.practices.work.durationMs + 1),
        ]) {
          const copy = structuredClone(exported);
          edit(copy.workspace);
          try {
            T.parseSession(JSON.stringify(copy), "json", "Invalid workspace");
            rejected.push(false);
          } catch {
            rejected.push(true);
          }
        }
        delete exported.workspace;
        T.openSession(
          T.parseSession(JSON.stringify(exported), "json", "Legacy session"),
        );
        return {
          rejected,
          provenance: T.getState().dataset.provenance.kind,
          running: T.getModeState().practice.phase === "running",
        };
      });
      assert.ok(result.rejected.every(Boolean));
      assert.equal(result.provenance, "synthetic");
      assert.equal(result.running, false);
    },
  );

  await check(
    "duration controls validate changes and mode changes stop the optional pacer",
    async () => {
      await ui.evaluate(() => {
        window.Telemetry.setMode("work");
        window.Telemetry.resetPractice();
      });
      const before = await ui.evaluate(
        () => window.Telemetry.getModeState().practice.durationMs,
      );
      await ui.locator("#practice-duration").fill("0");
      await ui.locator("#practice-duration").press("Tab");
      assert.equal(
        await ui.evaluate(
          () => window.Telemetry.getModeState().practice.durationMs,
        ),
        before,
      );
      await ui.locator("#practice-duration").fill("180");
      await ui.locator("#practice-duration").press("Tab");
      assert.equal(
        await ui.evaluate(
          () => window.Telemetry.getModeState().practice.durationMs,
        ),
        180 * 60000,
      );
      await ui.locator('[data-duration="25"]').click();
      assert.equal(
        await ui.evaluate(
          () => window.Telemetry.getModeState().practice.durationMs,
        ),
        25 * 60000,
      );
      await ui.locator("#mode-rest").click();
      await ui.locator("#pacer-toggle").click();
      assert.equal(
        await ui.evaluate(() => window.Telemetry.getModeState().pacerOn),
        true,
      );
      await ui.locator("#mode-work").click();
      assert.equal(
        await ui.evaluate(() => window.Telemetry.getModeState().pacerOn),
        false,
      );
      await ui.locator("#mode-rest").click();
      assert.equal(await ui.locator("#pacer-toggle").innerText(), "Start");
    },
  );

  await check(
    "both modes and device dialogs fit mobile widths with usable touch controls",
    async () => {
      for (const width of [360, 390]) {
        await ui.setViewportSize({ width, height: 844 });
        for (const mode of ["rest", "work"]) {
          await ui.locator(`#mode-${mode}`).click();
          const dimensions = await ui.evaluate(() => ({
            viewport: innerWidth,
            content: document.documentElement.scrollWidth,
            buttons: [
              "mode-rest",
              "mode-work",
              "practice-start",
              "connect-devices",
            ].map((id) => ({
              id,
              height: document.getElementById(id).getBoundingClientRect()
                .height,
            })),
          }));
          assert.ok(
            dimensions.content <= dimensions.viewport + 1,
            `${mode}: ${dimensions.content}px content in ${width}px viewport`,
          );
          assert.ok(
            dimensions.buttons.every((button) => button.height >= 44),
            `Undersized mobile control: ${JSON.stringify(dimensions.buttons)}`,
          );
          await ui.locator("#connect-devices").click();
          for (const kind of ["hume", "muse", "apple"]) {
            await ui.locator(`[data-device-choice="${kind}"]`).click();
            const overflow = await ui
              .locator("#device-dialog")
              .evaluate((dialog) => ({
                content: dialog.scrollWidth,
                available: dialog.clientWidth,
              }));
            assert.ok(
              overflow.content <= overflow.available + 1,
              `${kind} device dialog overflows at ${width}px`,
            );
          }
          await ui.evaluate(() => window.TelemetryDevices.close());
        }
      }
      await ui.close();
    },
  );

  await check(
    "the mobile quick bar stays reachable while scrolling and controls each mode's shared timer",
    async () => {
      const quick = await context.newPage();
      await quick.goto(consoleUrl);
      await quick.waitForFunction(() =>
        Boolean(window.Telemetry?.getModeState),
      );
      const action = quick.locator("#mobile-practice-action");
      assert.equal(
        await action.isVisible(),
        false,
        "Quick controls should be hidden on desktop",
      );
      await quick.setViewportSize({ width: 390, height: 844 });
      for (const mode of ["rest", "work"]) {
        await quick.evaluate((mode) => {
          const T = window.Telemetry;
          T.setMode(mode);
          T.resetPractice();
          T.setSessionDuration(1);
          window.scrollTo(0, document.documentElement.scrollHeight);
        }, mode);
        await quick.waitForFunction(() => scrollY > 100);
        const box = await action.boundingBox();
        assert.ok(
          box && box.y >= 0 && box.y + box.height <= 844,
          "Quick controls must remain in the visible viewport",
        );
        assert.equal(await action.innerText(), "Begin");
        assert.match(
          await quick.locator("#mobile-practice-label").innerText(),
          mode === "rest" ? /Rest/ : /Focus/,
        );
        await action.click();
        assert.equal(
          await quick.evaluate(
            () => window.Telemetry.getModeState().practice.phase,
          ),
          "running",
        );
        assert.equal(await action.innerText(), "Pause");
        assert.equal(
          await quick.locator("#mobile-practice-time").innerText(),
          await quick.locator("#practice-time").innerText(),
        );
        await action.click();
        assert.equal(
          await quick.evaluate(
            () => window.Telemetry.getModeState().practice.phase,
          ),
          "paused",
        );
        assert.equal(await action.innerText(), "Resume");
        await action.click();
        assert.equal(
          await quick.evaluate(
            () => window.Telemetry.getModeState().practice.phase,
          ),
          "running",
        );
        await quick.evaluate(() => window.Telemetry.finishPractice());
        const count = await quick.evaluate(
          () => window.Telemetry.getModeState().sessions.length,
        );
        assert.equal(await action.innerText(), "New session");
        await action.click();
        const restarted = await quick.evaluate(() =>
          window.Telemetry.getModeState(),
        );
        assert.equal(restarted.practice.phase, "running");
        assert.ok(restarted.practice.elapsedMs < 1000);
        assert.equal(
          restarted.sessions.length,
          count,
          "Starting again must not duplicate the completed recap",
        );
      }
      await quick.evaluate(() => window.Telemetry.pausePractice());
      await quick.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await action.isVisible(), false);
      await quick.close();
    },
  );

  await check(
    "unsupported Bluetooth gives a guided fallback without claiming a connection",
    async () => {
      const devicePage = await context.newPage();
      await devicePage.addInitScript(() =>
        Object.defineProperty(navigator, "bluetooth", {
          configurable: true,
          value: undefined,
        }),
      );
      await devicePage.goto(consoleUrl);
      await devicePage.waitForFunction(() => Boolean(window.TelemetryDevices));
      await devicePage.locator("#connect-devices").click();
      await devicePage.locator('[data-device-choice="muse"]').click();
      assert.match(
        await devicePage.locator("#muse-capability").innerText(),
        /bluetooth|browser|Chrome|Edge/i,
      );
      const pair = devicePage.locator("#muse-pair");
      if (await pair.isEnabled()) await pair.click();
      const state = await devicePage.evaluate(() =>
        window.TelemetryDevices.getState(),
      );
      assert.equal(state.connected, false);
      assert.notEqual(state.phase, "streaming");
      await devicePage.close();
    },
  );

  await check(
    "the device guide opens Hume manual entry and both Health XML paths",
    async () => {
      const devicePage = await context.newPage();
      await devicePage.goto(consoleUrl);
      await devicePage.waitForFunction(() => Boolean(window.TelemetryDevices));
      await devicePage.evaluate(() => window.TelemetryDevices.open("hume"));
      await devicePage.locator("#device-hume-entry").click();
      assert.equal(
        await devicePage
          .locator("#hume-dialog")
          .evaluate((dialog) => dialog.open),
        true,
      );
      await devicePage.locator("#hume-cancel").click();
      for (const [kind, id] of [
        ["hume", "#device-hume-xml"],
        ["apple", "#device-apple-xml"],
      ]) {
        await devicePage.evaluate(
          (kind) => window.TelemetryDevices.open(kind),
          kind,
        );
        const chooser = devicePage.waitForEvent("filechooser");
        await devicePage.locator(id).click();
        await chooser;
        await devicePage.locator("#health-file").dispatchEvent("cancel");
      }
      await devicePage.close();
    },
  );

  await check(
    "mock Muse uses verified service and command framing, gates freshness, and disconnects",
    async () => {
      const devicePage = await context.newPage();
      await devicePage.addInitScript(installMuseMock);
      await devicePage.clock.install({
        time: new Date("2026-10-22T12:00:00Z"),
      });
      await devicePage.goto(consoleUrl);
      await devicePage.waitForFunction(() => Boolean(window.TelemetryDevices));
      await devicePage.clock.pauseAt(new Date("2026-10-22T12:00:01Z"));
      await devicePage.evaluate(() => {
        window.Telemetry.restart();
        window.TelemetryDevices.open("muse");
        document.querySelector("#muse-pair").click();
      });
      await devicePage.waitForFunction(
        () => window.TelemetryDevices.getState().connected,
      );
      const connected = await devicePage.evaluate(() => ({
        state: window.TelemetryDevices.getState(),
        commands: window.__museMock.commands,
        services: window.__museMock.services,
      }));
      assert.ok(
        connected.services.length > 0 &&
          connected.services.every((service) => service === 0xfe8d),
      );
      assert.deepEqual(connected.commands, [
        [2, 104, 10],
        [4, 112, 53, 48, 10],
        [2, 115, 10],
        [2, 100, 10],
      ]);
      assert.notEqual(connected.state.phase, "streaming");
      const before = await devicePage.evaluate(() =>
        JSON.stringify(window.Telemetry.getState().dataset),
      );
      await devicePage.evaluate(() =>
        window.__museMock.emit("000b", [0, 1, 200, 0]),
      );
      assert.notEqual(
        await devicePage.evaluate(
          () => window.TelemetryDevices.getState().phase,
        ),
        "streaming",
      );
      await devicePage.evaluate(() =>
        window.__museMock.emit("0003", [
          0,
          1,
          ...Array.from({ length: 6 }, () => [128, 8, 0]).flat(),
        ]),
      );
      const streaming = await devicePage.evaluate(() =>
        window.TelemetryDevices.getState(),
      );
      assert.equal(streaming.phase, "streaming");
      assert.ok(streaming.packets.eeg > 0);
      await devicePage.clock.fastForward(6000);
      assert.equal(
        await devicePage.evaluate(
          () => window.TelemetryDevices.getState().phase,
        ),
        "stale",
      );
      await devicePage.evaluate(() =>
        document.querySelector("#muse-disconnect").click(),
      );
      const disconnected = await devicePage.evaluate(() => ({
        state: window.TelemetryDevices.getState(),
        count: window.__museMock.disconnects,
        dataset: JSON.stringify(window.Telemetry.getState().dataset),
      }));
      assert.equal(disconnected.state.connected, false);
      assert.equal(disconnected.state.phase, "disconnected");
      assert.equal(disconnected.count, 1);
      assert.equal(
        disconnected.dataset,
        before,
        "Raw device previews must not fabricate session features",
      );
      await devicePage.close();
    },
  );

  assert.deepEqual(pageErrors, [], "Unexpected browser exceptions");
  assert.deepEqual(
    externalRequests,
    [],
    "A practice mode attempted an external request",
  );
  console.log(
    `\n${checks} mode checks passed; no page errors or external requests.`,
  );
} finally {
  await context.close();
  await browser.close();
}
