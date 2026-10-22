import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Runs against the actual standalone HTML, including its public import/export API.
// No build step, sensor hardware, cloud account, or personal data are required.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = {
  ".html": "text/html",
  ".csv": "text/csv",
  ".json": "application/json",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const filename = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!filename.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": `${types[path.extname(filename)] || "text/plain"}; charset=utf-8`,
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium
  .launch({ headless: true })
  .catch(async (error) => {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
context.setDefaultTimeout(10_000);
const externalRequests = [];
const pageErrors = [];
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (
    url.startsWith(base + "/") ||
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

const origin = Date.parse("2026-01-01T12:00:00Z");
const makeSamples = (count = 180) =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: origin + i * 1000,
    heart_rate_bpm: 60 + Math.sin(i / 3),
    rmssd_ms: 50 + Math.cos(i / 4) * 2,
    resp_rate_brpm: 12 + Math.sin(i / 7) * 0.2,
    eeg_beta_alpha: null,
    motion_g: 0.02,
    quality: "good",
  }));
const session = (samples, label = "Synthetic browser check") => ({
  schema_version: 2,
  provenance: { kind: "synthetic", label },
  samples,
  markers: [],
});
const samples = makeSamples();

try {
  const page = await context.newPage();
  await page.goto(`${base}/Autonomic_Telemetry_Console.html`);
  await page.waitForFunction(() => Boolean(window.Telemetry));

  await check(
    "default demo is explicitly synthetic and reproducible",
    async () => {
      const result = await page.evaluate(() => {
        const T = window.Telemetry;
        return {
          provenance: T.getState().dataset.provenance,
          deterministic:
            JSON.stringify(T.makeDemo()) === JSON.stringify(T.makeDemo()),
          text: document.body.innerText,
        };
      });
      assert.equal(result.provenance.kind, "synthetic");
      assert.equal(result.deterministic, true);
      assert.match(result.text, /synthetic/i);
    },
  );

  await check(
    "scores are withheld until a complete reference exists",
    async () => {
      const result = await page.evaluate(
        (rows) => window.Telemetry.analyze(rows),
        samples,
      );
      assert.equal(result.derived.length, samples.length);
      assert.ok(
        result.derived.slice(0, 119).every((row) => row.score === null),
      );
      assert.ok(Number.isFinite(result.derived.at(-1).score));
    },
  );

  await check(
    "reference formation uses elapsed recording time as well as sample count",
    async () => {
      const rows = makeSamples(62).map((row, i) => ({
        ...row,
        timestamp: origin + i * 2000,
      }));
      const result = await page.evaluate(
        (rows) => ({
          short: window.Telemetry.analyze(rows.slice(0, 60)),
          enough: window.Telemetry.analyze(rows),
        }),
        rows,
      );
      assert.ok(result.short.derived.every((row) => row.score === null));
      assert.ok(Number.isFinite(result.enough.derived.at(-1).score));
    },
  );

  await check(
    "poor, unknown, and high-motion windows withhold model outputs",
    async () => {
      const rows = makeSamples();
      rows[140].quality = "poor";
      rows[141].quality = "unknown";
      rows[142].motion_g = 0.9;
      rows[140].heart_rate_bpm =
        rows[141].heart_rate_bpm =
        rows[142].heart_rate_bpm =
          180;
      const result = await page.evaluate(
        (rows) => window.Telemetry.analyze(rows),
        rows,
      );
      for (const i of [140, 141, 142]) {
        assert.equal(result.derived[i].score, null);
        assert.equal(result.derived[i].novelty, null);
      }
      assert.ok(
        !result.events.some((event) =>
          [140, 141, 142].some(
            (i) => Number(event.timestamp) === rows[i].timestamp,
          ),
        ),
      );
    },
  );

  await check("rejected windows cannot contaminate the reference", async () => {
    const rows = makeSamples(210);
    for (let i = 20; i < 60; i += 1) {
      rows[i].quality = "poor";
      rows[i].heart_rate_bpm = 180;
      rows[i].rmssd_ms = 1;
      rows[i].resp_rate_brpm = 35;
    }
    const result = await page.evaluate(
      (rows) => window.Telemetry.analyze(rows),
      rows,
    );
    assert.ok(
      result.baseline,
      "Expected a reference after enough later clean data",
    );
    assert.ok(Number.isFinite(result.derived.at(-1).score));
    assert.ok(
      result.derived.at(-1).score < 5,
      "A clean return should remain close to its clean reference",
    );
  });

  await check(
    "coincident change events need multiple channels and do not repeat over a plateau",
    async () => {
      const one = makeSamples(210);
      const convergent = makeSamples(210);
      for (let i = 160; i < 210; i += 1) {
        one[i].heart_rate_bpm += 20;
        convergent[i].heart_rate_bpm += 20;
        convergent[i].rmssd_ms -= 30;
        convergent[i].resp_rate_brpm += 8;
      }
      const result = await page.evaluate(
        ({ one, convergent }) => ({
          one: window.Telemetry.analyze(one).events,
          convergent: window.Telemetry.analyze(convergent).events,
        }),
        { one, convergent },
      );
      assert.equal(result.one.length, 0);
      assert.equal(result.convergent.length, 1);
    },
  );

  await check(
    "opposite-direction changes score zero without being labeled close to the reference",
    async () => {
      const rows = makeSamples().map((row, i) =>
        i < 140
          ? row
          : { ...row, heart_rate_bpm: 40, rmssd_ms: 90, resp_rate_brpm: 6 },
      );
      const result = await page.evaluate((fixture) => {
        const T = window.Telemetry;
        T.openSession(
          T.parseSession(JSON.stringify(fixture), "json", "Opposite changes"),
        );
        T.seek(160);
        return {
          score: T.getState().derived[160].score,
          tier: document.querySelector("#tier").textContent,
          copy: document.querySelector("#plain-heading").textContent,
        };
      }, session(rows));
      assert.equal(result.score, 0);
      assert.match(result.tier, /Low directional shift/);
      assert.doesNotMatch(result.copy, /close to.*reference/i);
    },
  );

  await check(
    "the first excluded sample is counted and timeline paths break across recording gaps",
    async () => {
      const rows = makeSamples().map((row, i) => ({
        ...row,
        timestamp: row.timestamp + (i >= 150 ? 30_000 : 0),
      }));
      rows[0].quality = "poor";
      const result = await page.evaluate((fixture) => {
        const T = window.Telemetry;
        T.openSession(
          T.parseSession(JSON.stringify(fixture), "json", "Recording gap"),
        );
        T.seek(0);
        const firstExcluded = document.querySelector(
          "#session-summary > div:last-child .value",
        ).textContent;
        T.seek(179);
        return {
          firstExcluded,
          path: document
            .querySelector('#timeline path[stroke="#8bd5c5"]')
            .getAttribute("d"),
          noveltyAfterGap: T.getState().derived[150].novelty,
        };
      }, session(rows));
      assert.equal(result.firstExcluded, "1");
      assert.equal((result.path.match(/M/g) || []).length, 2);
      assert.equal(result.noveltyAfterGap, null);
    },
  );

  await check(
    "absent channels remain absent, and reference channel changes are withheld",
    async () => {
      const result = await page.evaluate((rows) => {
        const T = window.Telemetry;
        const one = rows.map((row) => ({
          ...row,
          rmssd_ms: null,
          resp_rate_brpm: null,
        }));
        const two = rows.map((row) => ({ ...row, rmssd_ms: null }));
        const changed = rows.map((row, i) => ({
          ...row,
          rmssd_ms: i >= 140 ? null : row.rmssd_ms,
        }));
        const added = rows.map((row, i) => ({
          ...row,
          rmssd_ms: i < 140 ? null : row.rmssd_ms,
        }));
        const parsed = T.parseSession(
          JSON.stringify({
            schema_version: 2,
            provenance: { kind: "user-supplied", label: "Missing RMSSD" },
            samples: two,
          }),
          "json",
          "Missing RMSSD",
        );
        T.openSession(parsed);
        const exported = T.getExport();
        return {
          one: T.analyze(one),
          two: T.analyze(two),
          changed: T.analyze(changed),
          added: T.analyze(added),
          exported:
            typeof exported === "string" ? JSON.parse(exported) : exported,
        };
      }, samples);
      assert.ok(result.one.derived.every((row) => row.score === null));
      assert.ok(Number.isFinite(result.two.derived.at(-1).score));
      assert.ok(
        result.changed.derived.slice(140).every((row) => row.score === null),
      );
      assert.ok(
        result.added.derived.slice(140).every((row) => row.score === null),
      );
      assert.ok(result.exported.samples.every((row) => row.rmssd_ms === null));
    },
  );

  await check(
    "malformed, missing, duplicate, unordered, and ambiguous timestamps are rejected",
    async () => {
      const result = await page.evaluate((rows) => {
        const T = window.Telemetry;
        const rejects = (value) => {
          try {
            T.parseSession(value, "json", "Invalid fixture");
            return false;
          } catch {
            return true;
          }
        };
        const badRows = [
          rows.map((r, i) => (i === 3 ? { ...r, timestamp: undefined } : r)),
          rows.map((r, i) =>
            i === 3 ? { ...r, timestamp: rows[2].timestamp } : r,
          ),
          rows.map((r, i) =>
            i === 3 ? { ...r, timestamp: rows[1].timestamp } : r,
          ),
          rows.map((r, i) =>
            i === 3 ? { ...r, timestamp: "2026-01-01T12:00:03" } : r,
          ),
          [{ ...rows[0], timestamp: "2026-02-30T12:00:00Z" }],
        ];
        return [
          rejects("{broken JSON"),
          ...badRows.map((samples) =>
            rejects(
              JSON.stringify({
                schema_version: 2,
                provenance: { kind: "user-supplied", label: "Invalid fixture" },
                samples,
              }),
            ),
          ),
        ];
      }, samples);
      assert.ok(result.every(Boolean));
    },
  );

  await check(
    "CSV quoting and blank numeric fields preserve normalized values",
    async () => {
      const csv =
        "timestamp,heart_rate_bpm,rmssd_ms,resp_rate_brpm,eeg_beta_alpha,motion_g,quality\r\n" +
        '"2026-01-01T12:00:00Z","60",,12,,0.02,"good"\r\n' +
        `${origin + 1000},61,"   ",12.1,,0.02,good\r\n`;
      const result = await page.evaluate(
        (csv) =>
          window.Telemetry.parseSession(csv, "csv", "Quoted, synthetic CSV"),
        csv,
      );
      assert.equal(result.samples.length, 2);
      assert.equal(result.samples[0].heart_rate_bpm, 60);
      assert.equal(result.samples[0].rmssd_ms, null);
      assert.equal(result.samples[0].eeg_beta_alpha, null);
      assert.equal(result.samples[1].timestamp, origin + 1000);
      assert.equal(result.samples[1].rmssd_ms, null);
    },
  );

  await check(
    "export and reimport preserve synthetic provenance, nulls, and markers",
    async () => {
      const fixture = session(makeSamples());
      fixture.markers = [
        { timestamp: samples[125].timestamp, label: "Test marker, with comma" },
      ];
      const result = await page.evaluate((fixture) => {
        const T = window.Telemetry;
        T.openSession(
          T.parseSession(JSON.stringify(fixture), "json", "Round trip"),
        );
        const exported = T.getExport();
        const text =
          typeof exported === "string" ? exported : JSON.stringify(exported);
        return T.parseSession(text, "json", "Reimported export");
      }, fixture);
      assert.equal(result.provenance.kind, "synthetic");
      assert.equal(result.samples[0].eeg_beta_alpha, null);
      assert.equal(result.markers[0].label, fixture.markers[0].label);
    },
  );

  await check(
    "untrusted session labels and markers render as text",
    async () => {
      const payload =
        '<img data-probe="injection" src="https://invalid.example/probe" onerror="window.sessionInjected=1">';
      const fixture = session(makeSamples(), payload);
      fixture.markers = [{ timestamp: samples[125].timestamp, label: payload }];
      const result = await page.evaluate((fixture) => {
        const T = window.Telemetry;
        T.openSession(
          T.parseSession(JSON.stringify(fixture), "json", "Untrusted label"),
        );
        T.seek(130);
        return {
          injected: Boolean(window.sessionInjected),
          elements: document.querySelectorAll('img[data-probe="injection"]')
            .length,
          labelPreserved:
            T.getState().dataset.provenance.label === fixture.provenance.label,
        };
      }, fixture);
      assert.equal(result.injected, false);
      assert.equal(result.elements, 0);
      assert.equal(result.labelPreserved, true);
    },
  );

  await check(
    "Health context chooses newest timestamps and preserves device sources without changing the model",
    async () => {
      const xml = `<?xml version="1.0"?><HealthData>
      <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" value="78" startDate="2026-10-20 08:00:00 -0400"/>
      <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" value="12" startDate="2026-10-19 08:00:00 -0400"/>
      <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Hume" unit="count/min" value="80" startDate="2026-10-21 08:00:00 -0400"/>
      <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" unit="count/min" value="58" startDate="2026-10-18 08:00:00 -0400"/>
    </HealthData>`;
      const result = await page.evaluate((xml) => {
        const T = window.Telemetry;
        const before = T.getState();
        const fingerprint = (state) =>
          JSON.stringify({
            dataset: state.dataset,
            baseline: state.baseline,
            derived: state.derived,
          });
        const original = fingerprint(before);
        T.loadHealth(xml);
        return {
          unchanged: original === fingerprint(T.getState()),
          context: T.getState().context,
          text: document.body.innerText,
        };
      }, xml);
      assert.equal(result.unchanged, true);
      assert.equal(
        result.context.records.find(
          (record) =>
            record.metric === "sdnn" && record.source === "Apple Watch",
        )?.value,
        78,
      );
      assert.equal(
        result.context.records.find(
          (record) => record.metric === "restHR" && record.source === "Hume",
        )?.value,
        80,
      );
      const stored = JSON.stringify(result.context);
      assert.match(stored, /78/);
      assert.match(stored, /80/);
      assert.match(stored, /Hume/);
      assert.match(stored, /Apple Watch/);
      assert.match(result.text, /SDNN/);
      assert.match(result.text, /Hume/);
    },
  );

  await check("Health source labels cannot inject markup", async () => {
    const xml = `<?xml version="1.0"?><HealthData><Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Hume &lt;img data-probe='health' src='https://invalid.example/health' onerror='window.healthInjected=1'&gt;" unit="count/min" value="70" startDate="2026-10-21 08:00:00 -0400"/></HealthData>`;
    const result = await page.evaluate((xml) => {
      window.Telemetry.loadHealth(xml);
      return {
        injected: Boolean(window.healthInjected),
        elements: document.querySelectorAll('img[data-probe="health"]').length,
      };
    }, xml);
    assert.equal(result.injected, false);
    assert.equal(result.elements, 0);
  });

  await check(
    "standard Apple XML declarations load while custom entities are rejected",
    async () => {
      const record =
        '<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" unit="count/min" value="64" startDate="2026-10-21 08:00:00 -0400"/>';
      const xml = `<?xml version="1.0"?><!DOCTYPE HealthData [<!ELEMENT HealthData (Record*)><!ELEMENT Record EMPTY><!ATTLIST Record type CDATA #REQUIRED>]><HealthData>${record}</HealthData>`;
      const custom = `<?xml version="1.0"?><!DOCTYPE HealthData [<!ENTITY custom "unsupported entity">]><HealthData>${record}</HealthData>`;
      const result = await page.evaluate(
        ({ xml, custom }) => {
          const T = window.Telemetry;
          const context = T.loadHealth(xml);
          const before = JSON.stringify(T.getState().context);
          let rejected = false;
          try {
            T.loadHealth(custom);
          } catch {
            rejected = true;
          }
          return {
            value: context.records[0].value,
            rejected,
            unchanged: before === JSON.stringify(T.getState().context),
          };
        },
        { xml, custom },
      );
      assert.equal(result.value, 64);
      assert.equal(result.rejected, true);
      assert.equal(result.unchanged, true);
    },
  );

  await check(
    "Hume entry keeps unspecified HRV and confirmed RMSSD separate, exports context, and clears it",
    async () => {
      const fingerprint = () =>
        page.evaluate(() => {
          const s = window.Telemetry.getState();
          return JSON.stringify({
            dataset: s.dataset,
            baseline: s.baseline,
            derived: s.derived,
          });
        });
      const before = await fingerprint();
      const form = page.locator("#hume-form");
      await page
        .getByRole("button", { name: "Add Hume reading", exact: true })
        .click();
      await form.locator('[name="date"]').fill("2026-01-01");
      await form.locator('[name="restHR"]').fill("58");
      await form.locator('[name="hrv"]').fill("64");
      await form.locator('[name="resp"]').fill("12");
      await form
        .getByRole("button", { name: "Keep in this session", exact: true })
        .click();
      let context = await page.evaluate(
        () => window.Telemetry.getState().context,
      );
      assert.equal(context.kind, "manual");
      assert.equal(
        context.records.find((record) => record.metric === "hrv")?.value,
        64,
      );
      assert.ok(
        !context.records.some((record) =>
          ["rmssd", "sdnn"].includes(record.metric),
        ),
      );
      assert.match(
        await page.locator("#context-body").innerText(),
        /definition unconfirmed/,
      );

      await page
        .getByRole("button", { name: "Add Hume reading", exact: true })
        .click();
      await form.locator('[name="date"]').fill("2026-01-02");
      await form.locator('[name="hrv"]').fill("62");
      await form.locator('[name="definition"]').selectOption("rmssd");
      await form
        .getByRole("button", { name: "Keep in this session", exact: true })
        .click();
      const exported = await page.evaluate(() => window.Telemetry.getExport());
      context = exported.context;
      assert.equal(
        context.records.find((record) => record.metric === "rmssd")?.value,
        62,
      );
      assert.ok(!context.records.some((record) => record.metric === "hrv"));
      assert.equal(
        await fingerprint(),
        before,
        "Daily entries must not fill or change session channels",
      );
      await page.locator("#clear-context").click();
      assert.equal(
        await page.evaluate(() => window.Telemetry.getState().context),
        null,
      );
      assert.equal(
        await page.evaluate(() => window.Telemetry.getExport().context),
        null,
      );
    },
  );

  await check(
    "reduced-motion pacer starts and pauses, is keyboard adjustable, and leaves the model unchanged",
    async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const before = await page.evaluate(() =>
        JSON.stringify(window.Telemetry.getState().derived),
      );
      const control = page.locator("#pacer-rate");
      await control.focus();
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "pacer-rate",
      );
      await control.press("End");
      assert.equal(await control.inputValue(), "8");
      assert.equal(await page.locator("#pacer-rate-value").innerText(), "8.0");
      await page.locator("#pacer-toggle").click();
      await page.waitForFunction(
        () => document.querySelector("#orb").getAttribute("r") === "52",
      );
      assert.equal(await page.locator("#pacer-toggle").innerText(), "Pause");
      assert.match(
        await page.locator("#pacer-cue").innerText(),
        /^Breathe (in|out)$/,
      );
      await page.locator("#pacer-toggle").click();
      assert.equal(await page.locator("#pacer-toggle").innerText(), "Start");
      assert.equal(
        await page.locator("#pacer-cue").innerText(),
        "At your own pace",
      );
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify(window.Telemetry.getState().derived),
        ),
        before,
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
    },
  );

  await check(
    "seek and restart preserve sample timestamps and provenance",
    async () => {
      const result = await page.evaluate(() => {
        const T = window.Telemetry;
        T.openSession(T.makeDemo());
        const initialCursor = T.getState().cursor;
        const timestamps = T.getState().dataset.samples.map(
          (row) => row.timestamp,
        );
        T.seek(160);
        const seekCursor = T.getState().cursor;
        T.restart();
        const restarted = T.getState();
        return {
          seekCursor,
          initialCursor,
          restartedCursor: restarted.cursor,
          unchanged:
            JSON.stringify(timestamps) ===
            JSON.stringify(
              restarted.dataset.samples.map((row) => row.timestamp),
            ),
          kind: restarted.dataset.provenance.kind,
        };
      });
      assert.equal(result.seekCursor, 160);
      assert.equal(result.restartedCursor, result.initialCursor);
      assert.equal(result.unchanged, true);
      assert.equal(result.kind, "synthetic");
    },
  );

  await check(
    "file chooser cancellation leaves the active recording unchanged",
    async () => {
      await page.evaluate(() => window.Telemetry.seek(150));
      const before = await page.evaluate(() => {
        const s = window.Telemetry.getState();
        return JSON.stringify({
          dataset: s.dataset,
          cursor: s.cursor,
          baseline: s.baseline,
        });
      });
      const picker = page.locator("#session-file");
      const chosen = page.waitForEvent("filechooser");
      await page
        .getByRole("button", { name: "Open session", exact: true })
        .click();
      await chosen;
      await picker.dispatchEvent("cancel");
      const after = await page.evaluate(() => {
        const s = window.Telemetry.getState();
        return JSON.stringify({
          dataset: s.dataset,
          cursor: s.cursor,
          baseline: s.baseline,
        });
      });
      assert.equal(after, before);
    },
  );

  await check(
    "file upload opens a recording and a malformed upload preserves it",
    async () => {
      const fixture = session(samples, "Synthetic uploaded fixture");
      await page
        .locator("#session-file")
        .setInputFiles({
          name: "synthetic-session.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(fixture)),
        });
      await page.waitForFunction(
        () =>
          window.Telemetry.getState().dataset.provenance.label ===
          "Synthetic uploaded fixture",
      );
      const before = await page.evaluate(() => {
        const s = window.Telemetry.getState();
        return { dataset: s.dataset, cursor: s.cursor, playing: s.playing };
      });
      assert.equal(before.cursor, 0);
      assert.equal(before.playing, false);
      await page
        .locator("#session-file")
        .setInputFiles({
          name: "broken.json",
          mimeType: "application/json",
          buffer: Buffer.from("{broken"),
        });
      await page.waitForFunction(() =>
        document
          .querySelector("#message")
          .textContent.includes("Session unchanged"),
      );
      const after = await page.evaluate(() => {
        const s = window.Telemetry.getState();
        return { dataset: s.dataset, cursor: s.cursor, playing: s.playing };
      });
      assert.deepEqual(after, before);
    },
  );

  await check(
    "the export button downloads a complete labeled JSON recording",
    async () => {
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export JSON ↓", exact: true })
        .click();
      const download = await pending;
      assert.match(download.suggestedFilename(), /SYNTHETIC.*\.json$/);
      const exported = JSON.parse(
        await readFile(await download.path(), "utf8"),
      );
      assert.equal(exported.provenance.kind, "synthetic");
      assert.equal(exported.provenance.label, "Synthetic uploaded fixture");
      assert.equal(exported.samples.length, samples.length);
    },
  );

  await check(
    "4× playback retains fractional time and pause stops the clock",
    async () => {
      const clockPage = await context.newPage();
      await clockPage.clock.install({ time: new Date("2026-10-22T12:00:00Z") });
      await clockPage.goto(`${base}/Autonomic_Telemetry_Console.html`);
      await clockPage.clock.pauseAt(new Date("2026-10-22T12:00:01Z"));
      await clockPage.evaluate(() => {
        window.Telemetry.restart();
        const speed = document.querySelector("#speed");
        speed.value = "4";
        speed.dispatchEvent(new Event("change"));
        document.querySelector("#play-button").click();
      });
      await clockPage.clock.runFor(1000);
      const advanced = await clockPage.evaluate(
        () => window.Telemetry.getState().cursor,
      );
      assert.equal(advanced, 4);
      await clockPage.evaluate(() =>
        document.querySelector("#play-button").click(),
      );
      await clockPage.clock.runFor(1000);
      const paused = await clockPage.evaluate(() => ({
        cursor: window.Telemetry.getState().cursor,
        playing: window.Telemetry.getState().playing,
      }));
      assert.equal(paused.cursor, advanced);
      assert.equal(paused.playing, false);
      await clockPage.close();
    },
  );

  await check(
    "field guide anchors and console link resolve locally",
    async () => {
      const guide = await context.newPage();
      await guide.goto(`${base}/Autonomic_Telemetry_Field_Guide.html`);
      const links = await guide.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"), (anchor) => ({
          href: anchor.getAttribute("href"),
          valid:
            !anchor.hash ||
            Boolean(
              document.getElementById(decodeURIComponent(anchor.hash.slice(1))),
            ),
        })),
      );
      assert.ok(
        links.some((link) =>
          /Autonomic_Telemetry_Console\.html/.test(link.href),
        ),
      );
      assert.ok(
        links
          .filter((link) => link.href.startsWith("#"))
          .every((link) => link.valid),
      );
      for (const link of links.filter(
        (link) => !/^(?:https?:|#|mailto:)/.test(link.href),
      )) {
        const response = await context.request.get(`${base}/${link.href}`);
        assert.equal(
          response.status(),
          200,
          `Broken local field-guide link: ${link.href}`,
        );
      }
      await guide.close();
    },
  );

  await check("console and guide fit a 390px viewport", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const filename of [
      "Autonomic_Telemetry_Console.html",
      "Autonomic_Telemetry_Field_Guide.html",
    ]) {
      await page.goto(`${base}/${filename}`);
      const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        content: document.documentElement.scrollWidth,
      }));
      assert.ok(
        overflow.content <= overflow.viewport + 1,
        `${filename}: ${overflow.content}px content in ${overflow.viewport}px viewport`,
      );
    }
  });

  await check(
    "recording import and interaction work with browser networking offline",
    async () => {
      await page.goto(`${base}/Autonomic_Telemetry_Console.html`);
      await page.waitForFunction(() => Boolean(window.Telemetry));
      await context.setOffline(true);
      const result = await page.evaluate((fixture) => {
        const T = window.Telemetry;
        T.openSession(
          T.parseSession(
            JSON.stringify(fixture),
            "json",
            "Offline synthetic fixture",
          ),
        );
        T.seek(150);
        const exported = T.getExport();
        return {
          cursor: T.getState().cursor,
          exported:
            typeof exported === "string" ? JSON.parse(exported) : exported,
          persisted: localStorage.length + sessionStorage.length,
        };
      }, session(samples));
      assert.equal(result.cursor, 150);
      assert.equal(result.exported.samples.length, samples.length);
      assert.equal(
        result.persisted,
        0,
        "Imported health data must not persist in browser storage",
      );
      await context.setOffline(false);
    },
  );

  assert.deepEqual(pageErrors, [], "Unexpected browser exceptions");
  assert.deepEqual(
    externalRequests,
    [],
    "The offline dashboard attempted an external request",
  );
  console.log(
    `\n${checks} browser checks passed; no page errors or external requests.`,
  );
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
