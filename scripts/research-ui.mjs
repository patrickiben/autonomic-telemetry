import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'Autonomic_Telemetry_Signal_Lab.html')).href;
const browser = await chromium.launch({ headless: true });
const errors = [], external = [];
let passed = 0;
const origin = Date.UTC(2026, 0, 1);
const samples = Array.from({ length: 180 }, (_, i) => ({
  timestamp: origin + i * 1000,
  heart_rate_bpm: 65 + Math.sin(i * 0.3),
  rmssd_ms: 45 + 2 * Math.cos(i * 0.2),
  resp_rate_brpm: 12 + 0.4 * Math.sin(i * 0.1),
  eeg_beta_alpha: null,
  motion_g: 0.01,
  quality: 'good',
}));
const recording = rows => ({ schema_version: 2, provenance: { kind: 'synthetic', label: 'Synthetic research UI check' },
  samples: rows, markers: [{ timestamp: origin + 20000, label: 'Invented browser marker' }] });

async function check(name, run) {
  await run();
  passed++;
  console.log(`✓ ${name}`);
}

async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce', ...options });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.goto(url);
  await page.waitForFunction(() => window.TelemetryResearchPanel && window.TelemetryResearch);
  await page.locator('#research-lenses summary').click();
  await load(page);
  return { page, close: () => context.close() };
}

async function load(page, rows = samples, cursor = 150) {
  await page.evaluate(({ fixture, cursor }) => {
    Telemetry.openSession(Telemetry.parseSession(JSON.stringify(fixture), 'json', 'Synthetic research UI check'));
    Telemetry.seek(cursor);
  }, { fixture: recording(rows), cursor });
}

async function core(page) {
  return page.evaluate(() => {
    const exported = Telemetry.getExport();
    delete exported.exported_at;
    return { exported, derived: Telemetry.getState().derived };
  });
}

async function upload(page, button, text, name = 'synthetic-check.json') {
  const choosing = page.waitForEvent('filechooser');
  await page.locator(`#${button}`).click();
  const chooser = await choosing;
  await chooser.setFiles({ name, mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/json', buffer: Buffer.from(text) });
}

async function downloaded(page, button) {
  const waiting = page.waitForEvent('download');
  await page.locator(`#${button}`).click();
  const download = await waiting;
  assert.match(download.suggestedFilename(), /\.json$/);
  const text = await readFile(await download.path(), 'utf8');
  return { text, value: JSON.parse(text) };
}

try {
  await check('Research analysis stops at the cursor, respects quality/population gates, and preserves the main model', async () => {
    const { page, close } = await open();
    const before = await core(page);
    await page.locator('#research-run').click();
    const result = await page.evaluate(() => TelemetryResearchPanel.getState());
    assert.equal(result.n, 151);
    assert.equal(result.surprise.series.length, 151);
    assert.equal(result.manifold.timestamps.at(-1), samples[150].timestamp);
    assert.equal(result.manifold.available, true);
    assert.equal(result.turbulence.available, true);
    assert.equal(await page.locator('#research-pca').isVisible(), true);
    assert.deepEqual(await core(page), before);

    await load(page, samples, 10);
    assert.equal(await page.evaluate(() => TelemetryResearchPanel.getState()), null);
    assert.equal(await page.locator('#research-summary').isVisible(), false);
    assert.equal(await page.locator('#research-pca').isVisible(), false);
    await page.locator('#research-run').click();
    assert.equal((await page.evaluate(() => TelemetryResearchPanel.getState())).reference, null);
    assert.equal(await page.locator('#research-save-reference').isDisabled(), true);
    assert.equal(await page.locator('#research-pca').isVisible(), false);
    const poor = samples.map((sample, i) => i === 150 ? { ...sample, quality: 'poor' } : sample);
    await load(page, poor);
    await page.locator('#research-run').click();
    const gated = await page.evaluate(() => TelemetryResearchPanel.getState());
    assert.equal(gated.turbulence.available, false);
    assert.equal(gated.manifold.available, false);
    assert.equal(gated.entropy.available, false);
    assert.equal(await page.locator('#research-summary strong').allTextContents().then(values => values.every(value => value === 'Unavailable')), true);
    await close();
  });

  await check('Reference download is valid JSON, reopens and resets without changing recording or main scores', async () => {
    const { page, close } = await open();
    await page.locator('#research-run').click();
    const before = await core(page);
    const exported = await downloaded(page, 'research-save-reference');
    assert.equal(exported.value.schema, 'autonomic-research-reference');
    assert.equal(exported.value.n, 60);
    assert.ok(exported.value.scales.every(value => Number.isFinite(value) && value > 0));
    await upload(page, 'research-load-reference', exported.text, 'synthetic-reference.json');
    await page.waitForFunction(() => !document.getElementById('research-clear-reference').hidden);
    const imported = await page.evaluate(() => TelemetryResearchPanel.getState().reference);
    assert.deepEqual(imported.keys, exported.value.keys);
    assert.deepEqual(imported.means, exported.value.means);
    assert.deepEqual(await core(page), before);
    await upload(page, 'research-load-reference', '{"schema":"wrong"}', 'invalid-reference.json');
    await page.waitForFunction(() => /Unsupported reference/.test(document.getElementById('research-status').textContent));
    assert.deepEqual((await page.evaluate(() => TelemetryResearchPanel.getState().reference)).means, imported.means);
    await page.locator('#research-clear-reference').click();
    assert.equal(await page.locator('#research-clear-reference').isVisible(), false);
    assert.equal((await page.evaluate(() => TelemetryResearchPanel.getState().reference)).end, samples[59].timestamp);
    assert.deepEqual(await core(page), before);
    await close();
  });

  await check('RR file analysis uses actual intervals and exact paired statistics without inferring data from HR', async () => {
    const { page, close } = await open();
    const before = await core(page);
    const rr = Array.from({ length: 21 }, (_, i) => 1000 + 100 * (i % 2));
    await upload(page, 'research-rr-open', JSON.stringify({ rr_intervals_ms: rr }), 'invented-intervals.json');
    await page.waitForFunction(() => document.getElementById('research-rr-result').textContent.includes('rmssdMs'));
    const result = JSON.parse(await page.locator('#research-rr-result').innerText());
    assert.equal(result.available, true);
    assert.equal(result.n, 21);
    assert.equal(result.rmssdMs, 100);
    assert.equal(result.sd2Ms, 0);
    assert.equal(result.pnn50Percent, 100);
    await upload(page, 'research-rr-open', JSON.stringify({ heart_rate_bpm: 70 }), 'rate-is-not-intervals.json');
    await page.waitForFunction(() => document.getElementById('research-rr-result').textContent.includes('"available": false'));
    assert.match(await page.locator('#research-rr-result').innerText(), /real RR intervals/);
    assert.deepEqual(await core(page), before);
    await close();
  });

  await check('Mind Monitor import requires timezone and declared band scale, preserves supplied metadata, and creates no missing channels', async () => {
    const { page, close } = await open();
    const sensors = ['TP9', 'AF7', 'AF8', 'TP10'];
    const header = ['TimeStamp', ...sensors.map(sensor => 'Alpha_' + sensor), ...sensors.map(sensor => 'Beta_' + sensor),
      ...sensors.map(sensor => 'HSI_' + sensor), 'HeadBandOn', 'Accelerometer_X', 'Accelerometer_Y', 'Accelerometer_Z', 'Label'];
    const csv = [header.join(','), ...Array.from({ length: 70 }, (_, i) => [new Date(origin + i * 1000).toISOString().replace('T', ' ').replace('Z', ''),
      ...Array(4).fill('1'), ...Array(4).fill('2'), ...Array(4).fill('1'), '1', '0', '0', '1', '"Invented, ""quoted"" label"'].join(','))].join('\r\n');
    await page.locator('#research-run').click();
    assert.equal((await page.evaluate(() => TelemetryResearchPanel.getState())).available, true);
    const before = await core(page);
    await upload(page, 'research-mind-open', csv, 'synthetic-bands.csv');
    await page.waitForFunction(() => /timezone/i.test(document.getElementById('research-status').textContent));
    assert.deepEqual(await core(page), before);
    assert.equal((await page.evaluate(() => TelemetryResearchPanel.getState())).n, 151);
    await page.locator('#research-timezone').fill('+00:00');
    await page.locator('#research-band-scale').selectOption('bel');
    await upload(page, 'research-mind-open', csv, 'synthetic-bands.csv');
    await page.waitForFunction(() => Telemetry.getExport().provenance.label.includes('Mind Monitor'));
    assert.equal(await page.evaluate(() => TelemetryResearchPanel.getState()), null);
    assert.equal(await page.locator('#research-summary').isVisible(), false);
    assert.equal(await page.locator('#research-pca').isVisible(), false);
    const session = (await core(page)).exported;
    assert.equal(session.samples.length, 70);
    assert.equal(session.samples[0].timestamp, origin);
    assert.ok(session.samples.every(sample => sample.heart_rate_bpm === null && sample.rmssd_ms === null && sample.resp_rate_brpm === null));
    assert.ok(session.samples.every(sample => sample.eeg_beta_alpha === 10));
    const adapter = (await downloaded(page, 'research-adapter-export')).value;
    assert.equal(adapter.samples[0].suppliedBands.scale, 'bel');
    assert.deepEqual(adapter.samples[0].suppliedBands.alpha, [1, 1, 1, 1]);
    assert.deepEqual(adapter.samples[0].suppliedBands.beta, [2, 2, 2, 2]);
    assert.equal(adapter.samples[0].frontalAlphaLogRatio, 0);
    const current = await core(page);
    const duplicate = csv.replace('Alpha_AF7', 'Alpha_TP9');
    await upload(page, 'research-mind-open', duplicate, 'duplicate-headers.csv');
    await page.waitForFunction(() => /duplicate|unique|column count/i.test(document.getElementById('research-status').textContent));
    assert.deepEqual(await core(page), current);
    await close();
  });

  await check('Health Auto Export stays context-only, escapes source text, and the research panel fits 390px without storage or network', async () => {
    const { page, close } = await open({ viewport: { width: 390, height: 844 } });
    const before = await core(page);
    const malicious = '<img src="https://example.invalid/private" onerror="window.injected=true">';
    const payload = { data: { metrics: [
      { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-01-01 09:00:00 -0400', qty: 60, source: malicious }] },
      { name: 'heart_rate_variability', units: 'ms', data: [{ date: '2026-01-01 09:00:00 -0400', qty: 42, source: 'Invented watch' }] },
    ] } };
    await upload(page, 'research-health-open', JSON.stringify(payload), 'invented-health-context.json');
    await page.waitForFunction(() => document.getElementById('research-adapter-result').textContent.includes('health-auto-export'));
    const displayed = JSON.parse(await page.locator('#research-adapter-result').innerText());
    assert.equal(displayed.available, true);
    assert.equal(displayed.contextOnly, true);
    assert.equal(displayed.records.find(record => record.metric === 'hrv').value, 42);
    assert.equal(displayed.records.find(record => record.metric === 'restHR').source, malicious);
    assert.equal(await page.locator('#research-adapter-result img').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
    const exported = (await downloaded(page, 'research-adapter-export')).value;
    assert.equal(exported.contextOnly, true);
    assert.deepEqual(await core(page), before);
    await page.locator('#research-run').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await page.locator('#research-lenses').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await close();
  });

  console.log(`\n${passed} research UI checks passed; no page errors or external requests.`);
} finally {
  await browser.close();
}
