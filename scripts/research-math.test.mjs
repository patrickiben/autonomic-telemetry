import assert from "node:assert/strict";
import "../research-math.js";
const R = globalThis.TelemetryResearch;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("✓ " + name);
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
}
const close = (a, b, tol = 1e-8) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const rng = () => {
  let x = 701;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
};
const makeSamples = (n) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: 1700000000000 + i * 2000,
    quality: "good",
    heart_rate_bpm: 65 + 3 * Math.sin(i * 0.43) + Math.cos(i * 0.17),
    rmssd_ms: 50 + 4 * Math.cos(i * 0.37),
    resp_rate_brpm: 12 + Math.sin(i * 0.23),
    eeg_beta_alpha: 1.2 + 0.2 * Math.sin(i * 0.41),
    motion_g: 0.02 + 0.01 * Math.sin(i * 0.19),
  }));
test("sample covariance and analytic eigenvalues", () => {
  const c = R.covariance([
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
  assert.deepEqual(c.means, [3, 4]);
  assert.deepEqual(c.matrix, [
    [4, 4],
    [4, 4],
  ]);
  const e = R.eigenSymmetric(c.matrix);
  close(e.values[0], 8);
  close(e.values[1], 0);
});
test("eigenvectors reconstruct a symmetric matrix", () => {
  const A = [
      [4, 1, 2],
      [1, 3, -1],
      [2, -1, 5],
    ],
    e = R.eigenSymmetric(A);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      close(
        e.values.reduce(
          (s, l, k) => s + l * e.vectors[k][i] * e.vectors[k][j],
          0,
        ),
        A[i][j],
      );
});
test("non-symmetric and malformed matrices rejected", () => {
  assert.equal(
    R.eigenSymmetric([
      [1, 2],
      [3, 4],
    ]).available,
    false,
  );
  assert.equal(
    R.covariance([
      [1, 2],
      [3, NaN],
    ]).available,
    false,
  );
});
test("PCA captures exact rank one with unit-invariant coordinates", () => {
  const rows = Array.from({ length: 30 }, (_, i) => [i, 2 * i]);
  const p = R.principalComponents(rows),
    q = R.principalComponents(rows.map(([a, b]) => [a * 1000, b]));
  close(p.absorptionRatio, 1);
  close(p.explainedVariance[0], 1);
  for (let i = 0; i < 30; i++)
    for (let j = 0; j < 2; j++) close(p.coordinates[i][j], q.coordinates[i][j]);
});
test("PCA handles constant channels explicitly and deterministically", () => {
  assert.equal(
    R.principalComponents(Array.from({ length: 30 }, () => [1, 2])).available,
    false,
  );
  const a = R.principalComponents(Array.from({ length: 30 }, (_, i) => [i, 2]));
  assert.deepEqual(a.columns, [0]);
  assert.equal(a.dimensions, 1);
  assert.ok(a.coordinates.every((x) => x[1] === 0));
  assert.deepEqual(
    a,
    R.principalComponents(Array.from({ length: 30 }, (_, i) => [i, 2])),
  );
});
test("Mahalanobis identity-correlation fixture", () => {
  const r = R.makeReference(
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ],
    ["heart_rate_bpm", "rmssd_ms"],
  );
  const d = R.mahalanobis([Math.sqrt(2 / 3), Math.sqrt(2 / 3)], r);
  close(d.distance, Math.sqrt(2));
  close(R.mahalanobis([0, 0], r).distance, 0);
});
test("regularization survives collinearity and preserves unit scaling", () => {
  const rows = Array.from({ length: 30 }, (_, i) => [i, i * 2]),
    a = R.makeReference(rows, ["heart_rate_bpm", "rmssd_ms"]),
    b = R.makeReference(
      rows.map(([x, y]) => [x * 1000, y]),
      ["heart_rate_bpm", "rmssd_ms"],
    );
  const d = R.mahalanobis([31, 60], a);
  assert.ok(Number.isFinite(d.distance));
  close(d.distance, R.mahalanobis([31000, 60], b).distance);
});
test("reference export/import round-trip and invalid matrix refusal", () => {
  const ref = R.makeReference(
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ],
    ["heart_rate_bpm", "rmssd_ms"],
  );
  assert.deepEqual(
    R.importReference(R.exportReference(ref).json),
    R.validateReference(ref),
  );
  const broken = {
    ...ref,
    correlation: [
      [1, 2],
      [2, 1],
    ],
  };
  assert.equal(R.validateReference(broken).available, false);
  assert.equal(R.importReference("{oops").available, false);
});
test("AR1 forecast is unchanged by the target observation", () => {
  const prior = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.5));
  const a = R.ar1Surprise([...prior, 2]).latest,
    b = R.ar1Surprise([...prior, 200]).latest;
  close(a.prediction, b.prediction);
  close(a.variance, b.variance);
  assert.ok(b.halfSquaredError > a.halfSquaredError);
});
test("AR1 past predictions never change when future observations arrive", () => {
  const a = Array.from({ length: 80 }, (_, i) => 2 + Math.sin(i * 0.3)),
    prefix = R.ar1Surprise(a).series;
  assert.deepEqual(
    R.ar1Surprise([...a, 1e6, -1e6, 1e6]).series.slice(0, a.length),
    prefix,
  );
});
test("AR1 constant history predicts its constant without fake variance", () => {
  const r = R.ar1Surprise(Array(30).fill(7));
  assert.equal(r.latest.prediction, 7);
  assert.equal(r.latest.halfSquaredError, 0);
  assert.equal(r.latest.variance, 1e-8);
});
test("AR1 missing values and long gaps reset training", () => {
  const a = Array(30).fill(4);
  assert.equal(R.ar1Surprise([...a, null, 6]).latest, null);
  const t = Array.from({ length: 31 }, (_, i) => i * 1000);
  t[30] = 100000;
  assert.equal(R.ar1Surprise([...a, 6], { timestamps: t }).latest, null);
});
test("entropy constant and periodic inputs have transparent zero value", () => {
  const a = R.sampleEntropy(Array(40).fill(7));
  close(a.value, 0);
  assert.equal(a.constant, true);
  assert.ok(a.matchesM > 0);
  assert.equal(a.matchesM, a.matchesM1);
  close(R.sampleEntropy(Array.from({ length: 40 }, (_, i) => i % 2)).value, 0);
});
test("entropy never substitutes a finite constant for absent matches", () => {
  const r = R.sampleEntropy(
    Array.from({ length: 30 }, (_, i) => i),
    { r: 0 },
  );
  assert.equal(r.available, false);
  assert.equal(r.matchesM, 0);
  assert.equal(R.sampleEntropy([1, 2, 3]).available, false);
});
test("crosslag positive convention recovers known +3-sample delay", () => {
  const random = rng(),
    a = Array.from({ length: 100 }, random),
    b = [0.4, 0.9, 0.1, ...a.slice(0, -3)];
  const r = R.crossLag(a, b);
  assert.equal(r.lagSamples, 3);
  close(r.correlation, 1);
  const anti = R.crossLag(
    a,
    b.map((x) => -x),
  );
  assert.equal(anti.lagSamples, 3);
  close(anti.correlation, -1);
});
test("crosslag constant input is unavailable", () =>
  assert.equal(
    R.crossLag(Array(40).fill(1), Array(40).fill(2)).available,
    false,
  ));
test("RR alternating intervals match analytic RMSSD/SDNN/pNN50", () => {
  const r = R.rrMetrics(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? 1000 : 800)),
  );
  close(r.meanRRms, 900);
  close(r.rmssdMs, 200);
  close(r.sdnnMs, Math.sqrt(200000 / 19));
  close(r.pnn50Percent, 100);
  close(r.sd1Ms, Math.sqrt(400000 / 19));
  close(r.sd2Ms, 0, 1e-5);
});
test("RR requires actual supplied intervals and rejects outliers without deletion", () => {
  assert.equal(R.rrMetrics([]).available, false);
  assert.equal(R.rrMetrics([800, 900]).available, false);
  assert.equal(R.rrMetrics([...Array(20).fill(800), 6000]).available, false);
  const r = R.rrMetrics(Array(20).fill(800));
  assert.equal(r.rmssdMs, 0);
  assert.equal(r.sdnnMs, 0);
  assert.equal(R.rrSpectrum(Array(400).fill(800)).available, false);
});
test("threshold episodes report elapsed recovery and missing/gap censoring", () => {
  let r = R.eventSummary([0, 4, 5, 0.5], [0, 1000, 2000, 3000]);
  assert.equal(r.events[0].recoveryMs, 2000);
  assert.equal(r.events[0].peak, 5);
  r = R.eventSummary([0, 4, null, 0.5], [0, 1000, 2000, 3000]);
  assert.equal(r.events[0].recoveryMs, null);
  assert.equal(r.events[0].endReason, "missing signal");
  r = R.eventSummary([0, 4, 0.5], [0, 1000, 30000]);
  assert.equal(r.events[0].endReason, "timestamp gap");
});
test("complete evaluation preserves separate descriptive modules", () => {
  const result = R.evaluate(makeSamples(160));
  assert.equal(result.available, true);
  for (const k of ["surprise", "turbulence", "coupling", "manifold"])
    assert.equal(result[k].available, true, k);
  assert.ok(result.reference.n >= 60);
  assert.equal(result.rr.available, false);
  assert.equal(result.spectrum.available, false);
  assert.equal("score" in result, false);
});
test("future append cannot change aggregate historical surprise", () => {
  const prefix = makeSamples(80),
    a = R.evaluate(prefix),
    all = makeSamples(100);
  all[90].heart_rate_bpm = 200;
  assert.deepEqual(
    R.evaluate(all).surprise.series.slice(0, 80),
    a.surprise.series,
  );
});
test("current poor quality excludes every current analysis window", () => {
  const s = makeSamples(160);
  s.at(-1).quality = "poor";
  const r = R.evaluate(s);
  assert.equal(r.turbulence.available, false);
  assert.equal(r.surprise.latest, null);
  assert.equal(r.manifold.available, false);
  assert.ok(r.crosslags.every((x) => !x.available));
});
test("reference construction excludes every poor-quality sample", () => {
  const s = makeSamples(160);
  s[20].quality = "poor";
  s[20].heart_rate_bpm = 249;
  const r = R.evaluate(s);
  assert.equal(r.reference.start, s[21].timestamp);
  assert.equal(r.reference.n, 60);
});
test("irregular cadence never becomes misleading lag seconds", () => {
  const s = makeSamples(100);
  for (let i = 50; i < s.length; i++) s[i].timestamp += 500;
  const r = R.evaluate(s);
  assert.ok(r.crosslags.every((x) => !x.available));
});
test("missing channels stay absent; incomplete latest data stays unavailable", () => {
  const s = makeSamples(100).map(({ timestamp, quality, heart_rate_bpm }) => ({
      timestamp,
      quality,
      heart_rate_bpm,
    })),
    r = R.evaluate(s);
  assert.deepEqual(r.keys, ["heart_rate_bpm"]);
  assert.equal(r.coupling.available, false);
  assert.equal(r.manifold.available, false);
  assert.equal(r.rr.available, false);
  assert.equal(
    R.evaluate([{ timestamp: 1 }, { timestamp: 1 }]).available,
    false,
  );
});
test("Health Auto Export adapter preserves timezone, units and context separation", () => {
  const r = R.healthAutoExport({
    data: {
      metrics: [
        {
          name: "heart_rate",
          units: "bpm",
          data: [
            {
              date: "2026-10-22 08:00:00 -0400",
              Avg: 70,
              Min: 60,
              Max: 80,
              source: "Example device",
            },
          ],
        },
        {
          name: "heart_rate_variability",
          units: "ms",
          data: [{ date: "2026-10-22 08:00:00 -0400", qty: 40 }],
        },
      ],
    },
  });
  assert.equal(r.contextOnly, true);
  assert.equal(r.records[0].timestamp, Date.parse("2026-10-22T12:00:00Z"));
  assert.equal(r.records[1].metric, "hrv");
  assert.equal("samples" in r, false);
});
test("Mind Monitor bel powers are converted before ratios; no invented channels", () => {
  const row = {
    TimeStamp: "2026-10-22 08:00:00",
    HeadBandOn: 1,
    Accelerometer_X: 0,
    Accelerometer_Y: 0,
    Accelerometer_Z: 1,
  };
  for (const name of ["TP9", "AF7", "AF8", "TP10"]) {
    row["Alpha_" + name] = 1;
    row["Beta_" + name] = 2;
    row["HSI_" + name] = 1;
  }
  const r = R.mindMonitorRows([row], {
    bandScale: "bel",
    timezoneOffset: "-04:00",
  });
  assert.equal(r.available, true);
  const s = r.samples[0];
  close(s.eeg_beta_alpha, 10);
  assert.equal(s.heart_rate_bpm, null);
  assert.equal(s.resp_rate_brpm, null);
  assert.equal(s.rmssd_ms, null);
  assert.equal(s.motion_g, 0);
  assert.equal(s.quality, "good");
  assert.equal(R.mindMonitorRows([row], { bandScale: "bel" }).available, false);
});
test("invalid supplied motion cannot enter any eligible reference window", () => {
  for (const motion of [-1, "9", NaN, Infinity]) {
    const s = makeSamples(100);
    s.at(-1).motion_g = motion;
    const r = R.evaluate(s);
    assert.equal(r.surprise.latest, null);
    assert.equal(r.turbulence.available, false);
  }
});
test("finite-pair Poincare SD2 is zero for odd-length alternation", () => {
  const r = R.rrMetrics(
    Array.from({ length: 21 }, (_, i) => (i % 2 ? 1100 : 1000)),
  );
  assert.equal(r.available, true);
  close(r.sd2Ms, 0);
  assert.equal(R.rrMetrics([800, 900], { minIntervals: 2 }).available, false);
});
test("Mind Monitor CSV parser handles quoted fields and rejects malformed rows", () => {
  const csv =
    'TimeStamp,Alpha_AF7,Alpha_AF8,Beta_AF7,Label\n"2026-10-22 08:00:00",1,2,3,"A, B"';
  const r = R.mindMonitorCSV(csv, {
    bandScale: "bel",
    timezoneOffset: "-04:00",
  });
  assert.equal(r.available, true);
  assert.equal(r.samples[0].eeg_beta_alpha, null);
  close(r.samples[0].frontalAlphaLogRatio, 1);
  assert.equal(
    R.mindMonitorCSV("TimeStamp,A\n1,2,3", { bandScale: "bel" }).available,
    false,
  );
  assert.equal(
    R.mindMonitorCSV('TimeStamp,A\n"oops', { bandScale: "bel" }).available,
    false,
  );
});
test("calendar-invalid adapter dates are rejected instead of shifted", () => {
  for (const date of [
    "2026-02-30 08:00:00 -0400",
    "2026-10-22 24:00:00 -0400",
    "2026-10-22 08:00:00 +1460",
  ]) {
    const r = R.healthAutoExport({
      metrics: [
        { name: "heart_rate", units: "bpm", data: [{ date, Avg: 70 }] },
      ],
    });
    assert.equal(r.available, false);
  }
  const r = R.mindMonitorRows([{ TimeStamp: "2026-02-30 08:00:00" }], {
    bandScale: "bel",
    timezoneOffset: "-04:00",
  });
  assert.equal(r.available, false);
});
test("tiny shrinkage and nonpositive reference matrices cannot return false zero or infinity", () => {
  const r = R.makeReference(
    [
      [1, 1],
      [2, 2],
      [3, 3],
    ],
    ["heart_rate_bpm", "rmssd_ms"],
  );
  assert.equal(R.mahalanobis([1, -1], r, 1e-20).available, false);
  const broken = {
    ...r,
    correlation: [
      [1, 1.000000001],
      [1.000000001, 1],
    ],
  };
  assert.equal(R.mahalanobis([1, -1], broken, 1e-12).available, false);
  const d = R.mahalanobis([1, -1], r, 1e-6);
  assert.equal(d.available, true);
  assert.ok(Number.isFinite(d.distance) && d.distance > 0);
});

test("CSV rejects characters after closing quotes", () => {
  const result = R.mindMonitorCSV(
    'TimeStamp,Alpha_AF7\n2026-10-22T08:00:00Z,"1"2',
    { bandScale: "bel" },
  );
  assert.equal(result.available, false);
});
console.log(`\n${passed} research math checks passed.`);
