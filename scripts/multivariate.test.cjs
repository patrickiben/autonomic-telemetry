const assert = require('node:assert/strict');
const M = require('../multivariate-engine.js');
const KEYS = ['heart_rate_bpm', 'pulse_rmssd_ms', 'resp_rate_brpm', 'eeg_beta_alpha', 'pulse_sdnn_ms'];
const CENTER = { heart_rate_bpm: 68, pulse_rmssd_ms: 45, resp_rate_brpm: 13, eeg_beta_alpha: 1, pulse_sdnn_ms: 55 };
let passed = 0;
function check(name, run) { run(); passed++; console.log('✓ ' + name); }
function near(a, b, tolerance = 1e-9) { assert.ok(Math.abs(a - b) < tolerance, `${a} should equal ${b}`); }
function harness({ keys = KEYS, synthetic = false, ...options } = {}) {
  let clock = 1800000000000;
  const engine = M.create({ now: () => clock, synthetic, ...options });
  function frame(values = {}, more = {}) {
    return { type: 'features', received_at: clock, source: synthetic ? 'synthetic' : 'device-reported', motion: .01,
      ...Object.fromEntries(keys.map(k => [k, CENTER[k]])), ...values,
      quality: Object.fromEntries(keys.map(k => [k, { valid: true, received_at: clock, source: synthetic ? 'Synthetic demo' : `Fixture ${k}` }])), ...more };
  }
  function send(values, more) { return engine.ingest(frame(values, more)); }
  return { engine, frame, send, get clock() { return clock; }, step(ms = 1000) { clock += ms; },
    train(values = {}) { for (let i = 0; i <= 120; i++) { send(values); if (i < 120) clock += 1000; } },
    repeat(values = {}, n = 8, more) { for (let i = 0; i < n; i++) { clock += 1000; send(values, typeof more === 'function' ? more(clock) : more); } } };
}

check('No source or reference produces no invented score', () => {
  const h = harness(), s = h.engine.snapshot();
  assert.equal(s.phase, 'waiting'); assert.equal(s.value, null); assert.equal(s.reference.value, 0);
  assert.deepEqual(s.reference.channels, []); assert.equal(h.engine.exportReference(), null);
});
check('Reference needs a full 120 elapsed seconds rather than packet count or 119 seconds', () => {
  const h = harness();
  for (let i = 0; i < 120; i++) { h.send(); if (i < 119) h.step(); }
  assert.equal(h.engine.snapshot().phase, 'calibrating'); near(h.engine.snapshot().reference.seconds, 119);
  h.step(); h.send(); assert.equal(h.engine.snapshot().phase, 'ready');
  const fast = harness(); for (let i = 0; i < 1000; i++) { fast.send(); fast.step(1); }
  assert.equal(fast.engine.snapshot().phase, 'calibrating'); assert.equal(fast.engine.snapshot().value, null);
  const sparse = harness(); for (let i = 0; i <= 30; i++) { sparse.send(); if (i < 30) sparse.step(4000); }
  assert.equal(sparse.engine.snapshot().phase, 'calibrating'); assert.ok(sparse.engine.snapshot().reference.progress < 1);
  assert.equal(sparse.engine.snapshot().reference.requiredSamples, 60);
});
check('Full profile freezes original weights, reference0, and constant-channel covariance floors', () => {
  const h = harness(); h.train(); const s = h.engine.snapshot();
  assert.equal(s.phase, 'ready'); near(s.value, 0); assert.equal(s.limited, false);
  assert.deepEqual(s.reference.channels, KEYS); assert.equal(s.weights.frozen, true);
  assert.deepEqual(s.weights.effective, s.weights.nominal); near(Object.values(s.weights.effective).reduce((a, b) => a + b), 100);
  assert.equal(s.reference.stats.heart_rate_bpm.sd, 3); assert.equal(s.reference.stats.pulse_sdnn_ms.sd, 5);
  assert.equal(s.research.turbulence.available, true); near(s.research.turbulence.distance, 0);
});
check('Every original weighted term contributes with explicit premodulation and bounded final attribution', () => {
  const h = harness(); h.train();
  h.repeat({ heart_rate_bpm: 80, pulse_rmssd_ms: 25, resp_rate_brpm: 17, eeg_beta_alpha: 1.6, pulse_sdnn_ms: 35 });
  const s = h.engine.snapshot(); near(s.value, 100);
  for (const component of s.components) near(component.contribution, component.nominalWeight);
  near(s.baseScore, s.components.reduce((sum, c) => sum + c.contribution, 0));
  near(s.rawScore, Math.min(100, s.baseScore * s.modifierMultiplier));
  assert.ok(s.modifierMultiplier >= 1 && s.modifierMultiplier <= 1.1);
});
check('Actual SDNN is independent supplied data; no RMSSD alias fills it', () => {
  const h = harness(); h.train(); h.repeat({ pulse_sdnn_ms: 35 });
  const s = h.engine.snapshot(), component = key => s.components.find(c => c.key === key);
  near(component('pulse_sdnn_ms').contribution, 10); near(component('pulse_rmssd_ms').contribution, 0);
  assert.ok(s.value > 10, 'SDNN may also affect the covariance-distance component');
  const missing = harness({ keys: KEYS.filter(k => k !== 'pulse_sdnn_ms') }); missing.train();
  const m = missing.engine.snapshot(); assert.equal(m.weights.effective.pulse_sdnn_ms, 0);
  assert.equal(m.components.find(c => c.key === 'pulse_sdnn_ms').value, null);
  assert.equal(m.weights.coveredNominal, 90);
});
check('Opposite-direction multivariate excursions can contribute covariance distance without positive directional terms', () => {
  const h = harness(); h.train();
  h.repeat({ heart_rate_bpm: 56, pulse_rmssd_ms: 65, resp_rate_brpm: 9, eeg_beta_alpha: .4, pulse_sdnn_ms: 75 });
  const s = h.engine.snapshot();
  for (const c of s.components.filter(c => c.key !== 'turbulence')) near(c.contribution, 0);
  near(s.baseScore, 15); assert.ok(s.value > 0); assert.match(s.reason, /no contribution under this model/);
});
check('Partial profile renormalizes once and names its omitted coverage', () => {
  const h = harness({ keys: ['heart_rate_bpm', 'pulse_rmssd_ms'] }); h.train(); const s = h.engine.snapshot();
  near(s.weights.effective.heart_rate_bpm, 100 * 20 / 65);
  near(s.weights.effective.pulse_rmssd_ms, 100 * 30 / 65);
  near(s.weights.effective.turbulence, 100 * 15 / 65);
  assert.equal(s.weights.coveredNominal, 65); assert.equal(s.limited, true);
  assert.equal(s.weights.effective.resp_rate_brpm, 0); assert.equal(s.track, 'multivariate');
});
check('Missing frozen channel holds the score and does not select an easier fallback', () => {
  const h = harness(); h.train(); const before = h.engine.snapshot(); h.step(); h.send({ pulse_rmssd_ms: null });
  const held = h.engine.snapshot(); assert.equal(held.phase, 'held'); assert.equal(held.value, null);
  assert.deepEqual(held.weights, before.weights); assert.deepEqual(held.reference.channels, before.reference.channels);
  h.repeat(); assert.equal(h.engine.snapshot().phase, 'ready'); near(h.engine.snapshot().value, 0);
});
check('Late eligible channels request a reset without rescaling or source-resetting the frozen profile', () => {
  const h = harness({ keys: ['heart_rate_bpm'] }); h.train(); const initial = h.engine.snapshot();
  h.step(); h.send({ eeg_beta_alpha: 2 }, { quality: {
    heart_rate_bpm: { valid: true, received_at: h.clock, source: 'Fixture heart_rate_bpm' },
    eeg_beta_alpha: { valid: true, received_at: h.clock, source: 'Extra EEG A' },
  } });
  const added = h.engine.snapshot(); assert.equal(added.phase, 'ready');
  assert.deepEqual(added.reference.resetNeeded, ['eeg_beta_alpha']); assert.deepEqual(added.weights, initial.weights);
  h.step(); h.send({ eeg_beta_alpha: 2 }, { quality: {
    heart_rate_bpm: { valid: true, received_at: h.clock, source: 'Fixture heart_rate_bpm' },
    eeg_beta_alpha: { valid: true, received_at: h.clock, source: 'Extra EEG B' },
  } }); assert.equal(h.engine.snapshot().phase, 'ready');
});
check('Explicit HR-only mode excludes covariance and optional sources even when all channels are supplied', () => {
  const h = harness({ profile: 'hr' }); h.train(); const s = h.engine.snapshot();
  assert.deepEqual(s.reference.channels, ['heart_rate_bpm']); assert.equal(s.track, 'hr'); assert.equal(s.limited, true);
  near(s.weights.effective.heart_rate_bpm, 100); near(s.weights.effective.turbulence, 0);
  h.step(); const f = h.frame(); f.quality.eeg_beta_alpha.source = 'Changed excluded EEG'; h.engine.ingest(f);
  assert.equal(h.engine.snapshot().phase, 'ready'); assert.deepEqual(h.engine.snapshot().reference.resetNeeded, []);
});
check('Selected HR, optical, respiratory, and EEG source changes reset the entire fixed reference', () => {
  for (const key of KEYS) {
    const h = harness(); h.train(); h.step(); const f = h.frame(); f.quality[key].source = 'A different sensor or protocol';
    h.engine.ingest(f); const s = h.engine.snapshot(); assert.equal(s.phase, 'calibrating', key);
    assert.equal(s.value, null); assert.equal(s.reference.ready, false); assert.deepEqual(s.events, []); assert.deepEqual(s.history, []);
  }
});
check('Unknown, poor, stale, or blank-source component quality cannot enter a fixed profile', () => {
  for (const invalid of [{ valid: false }, { valid: 'true' }, { received_at: -1 }, { source: '' }, { source: 'x'.repeat(201) }]) {
    const h = harness(); h.train(); h.step(); const f = h.frame(); Object.assign(f.quality.pulse_rmssd_ms, invalid);
    h.engine.ingest(f); assert.equal(h.engine.snapshot().phase, 'held'); assert.equal(h.engine.snapshot().value, null);
  }
});
check('Invalid numeric motion and explicit motion-quality failures are withheld before all model buffers', () => {
  for (const motion of [-.01, NaN, Infinity, '0.01', {}, true, .2]) {
    const h = harness(); h.train(); h.step(); h.send({ heart_rate_bpm: 200 }, { motion });
    assert.equal(h.engine.snapshot().phase, 'held'); h.step(); h.send();
    const s = h.engine.snapshot(); near(s.value, 0); near(s.reference.stats.heart_rate_bpm.mean, 68);
    assert.equal(s.research.surprise.available, false); assert.equal(s.history.length, 1);
  }
  for (const q of [{ valid: false, received_at: 1800000121000 }, { valid: true, received_at: -1 }]) {
    const h = harness(); h.train(); h.step(); const f = h.frame({ heart_rate_bpm: 200 }); f.quality.motion = q;
    h.engine.ingest(f); assert.equal(h.engine.snapshot().phase, 'held'); h.step(); h.send(); near(h.engine.snapshot().value, 0);
  }
});
check('An explicitly unknown absent accelerometer does not pretend to be a failed observed sample', () => {
  const h = harness({ keys: ['heart_rate_bpm'] });
  for (let i = 0; i <= 120; i++) { const f = h.frame({}, { motion: null }); f.quality.motion = { valid: false, received_at: null, source: 'No accelerometer', reason: 'No sample' }; h.engine.ingest(f); if (i < 120) h.step(); }
  assert.equal(h.engine.snapshot().phase, 'ready'); assert.equal(h.engine.snapshot().track, 'hr');
});
check('Quality breaks and changing calibration channel sets restart 120 contiguous elapsed seconds', () => {
  const h = harness(); for (let i = 0; i < 119; i++) { h.send(); h.step(); }
  h.send({}, { motion: .2 }); h.step(); h.send(); assert.equal(h.engine.snapshot().reference.seconds, 0);
  assert.equal(h.engine.snapshot().phase, 'calibrating');
  const a = harness({ keys: ['heart_rate_bpm'] }); for (let i = 0; i < 100; i++) { a.send(); a.step(); }
  const f = a.frame({ pulse_rmssd_ms: 45 }); f.quality.pulse_rmssd_ms = { valid: true, received_at: a.clock, source: 'New optical' };
  a.engine.ingest(f); assert.equal(a.engine.snapshot().reference.seconds, 0);
});
check('Long gaps invalidate score freshness and break rolling trend, forecasts, and event windows', () => {
  const h = harness(); h.train(); h.repeat({ heart_rate_bpm: 80, pulse_rmssd_ms: 25 }, 30);
  h.step(6000); assert.equal(h.engine.snapshot().phase, 'stale'); assert.equal(h.engine.snapshot().value, null);
  h.send(); const s = h.engine.snapshot(); near(s.value, 0); assert.equal(s.history.length, 1);
  assert.equal(s.trend.delta, null); assert.equal(s.research.surprise.available, false); assert.equal(s.sustainedSeconds, 0);
});
check('Duplicate, reversed, stale and future frame envelopes do not mutate the reference', () => {
  const h = harness(); h.train(); const before = h.engine.snapshot();
  assert.equal(h.send(), false); assert.equal(h.send({}, { received_at: h.clock - 1 }), false);
  assert.equal(h.send({}, { received_at: h.clock + 1000 }), false);
  h.step(10000); assert.equal(h.send({}, { received_at: h.clock - 6000 }), false);
  assert.deepEqual(h.engine.exportReference().stats, before.reference.stats);
});
check('HR-only and single EEG or SDNN jumps never become convergent onset events', () => {
  for (const key of ['heart_rate_bpm', 'eeg_beta_alpha', 'pulse_sdnn_ms']) {
    const h = harness(); h.train(); h.repeat({ [key]: key === 'heart_rate_bpm' ? 100 : key === 'eeg_beta_alpha' ? 3 : 15 }, 8);
    assert.deepEqual(h.engine.snapshot().events, [], key);
  }
});
check('Causal surprise plus two directional cardiac/respiratory steps creates one attributed onset, not plateau spam', () => {
  const h = harness(); h.train(); h.repeat({ heart_rate_bpm: 90, pulse_rmssd_ms: 10 }, 10);
  let s = h.engine.snapshot(); assert.equal(s.events.length, 1);
  assert.deepEqual(s.events[0].drivers, ['heart_rate_bpm', 'pulse_rmssd_ms']); assert.equal(s.events[0].classification, 'Observed convergence');
  h.repeat({ heart_rate_bpm: 90, pulse_rmssd_ms: 10 }, 70); s = h.engine.snapshot(); assert.equal(s.events.length, 1);
  assert.equal(s.events[0].censored, false); assert.ok(s.events[0].recoveryMs > 0);
});
check('An interrupted ongoing onset is censored rather than assigned physiological recovery', () => {
  const h = harness(); h.train(); h.repeat({ heart_rate_bpm: 90, pulse_rmssd_ms: 10 }, 1);
  assert.equal(h.engine.snapshot().events.length, 1);
  h.step(6000); const stale = h.engine.snapshot().events[0]; assert.equal(stale.censored, true); assert.equal(stale.recoveryMs, null); assert.match(stale.endReason, /stale/);
  h.step(); h.send({}, { motion: .5 });
  const e = h.engine.snapshot().events[0]; assert.equal(e.censored, true); assert.equal(e.recoveryMs, null); assert.match(e.endReason, /excluded/);
});
check('Streaming and chronological replay produce identical causal forecasts, weights, scores, and events', () => {
  const a = harness(), b = harness(), frames = [];
  for (let i = 0; i < 180; i++) {
    const values = i < 130 ? {} : { heart_rate_bpm: 90, pulse_rmssd_ms: 10, resp_rate_brpm: 18 };
    const frame = a.frame(values); frames.push(frame); a.engine.ingest(frame); if (i < 179) a.step();
  }
  for (const frame of frames) { while (b.clock < frame.received_at) b.step(); b.engine.ingest(frame); }
  assert.deepEqual(b.engine.snapshot(), a.engine.snapshot());
});
check('Appending future values cannot revise any previously emitted prediction error', () => {
  const h = harness(); h.train(); h.repeat({}, 10); const prefix = h.engine.snapshot().research.surprise.series;
  h.repeat({ heart_rate_bpm: 100, pulse_rmssd_ms: 5 }, 20);
  assert.deepEqual(h.engine.snapshot().research.surprise.series.slice(0, prefix.length), prefix);
});
check('Eigenvalue coupling/PCA, entropy, HR autocorrelation and additive modifiers are exposed without changing coverage', () => {
  const h = harness();
  for (let i = 0; i <= 150; i++) {
    const w = Math.sin(i * .11), z = Math.sin(i * .17 + .3);
    h.send({ heart_rate_bpm: 68 + w, pulse_rmssd_ms: 45 + z, resp_rate_brpm: 13 + Math.sin((i + 3) * .11) * .3,
      eeg_beta_alpha: 1 + .04 * z, pulse_sdnn_ms: 55 + .5 * w }); if (i < 150) h.step();
  }
  const s = h.engine.snapshot(); assert.equal(s.research.manifold.available, true); assert.equal(s.research.coupling.available, true);
  assert.equal(s.research.entropy.available, true); assert.equal(s.research.autocorrelation.available, true);
  assert.equal(s.research.fragility.available, true); assert.ok(s.research.fragility.value >= 0 && s.research.fragility.value <= 1);
  near(s.modifierMultiplier, 1 + (s.research.fragility.multiplier - 1) + (s.research.lead.multiplier - 1));
  assert.deepEqual(s.reference.channels, KEYS);
});
check('Positive breath-leading correlation is bounded and irregular cadence is not mislabeled as seconds', () => {
  const regular = harness();
  for (let i = 0; i <= 150; i++) { regular.send({ heart_rate_bpm: 68 + Math.sin(i * .17), resp_rate_brpm: 13 + Math.sin((i + 3) * .17) }); if (i < 150) regular.step(); }
  const lead = regular.engine.snapshot().research.lead; assert.equal(lead.available, true); assert.ok(lead.value > .9); near(lead.lagSeconds, 3); assert.ok(lead.multiplier <= 1.05);
  const irregular = harness(); irregular.train();
  for (let i = 0; i < 30; i++) { irregular.step(i % 2 ? 800 : 1200); irregular.send({ heart_rate_bpm: 68 + Math.sin(i), resp_rate_brpm: 13 + Math.cos(i) }); }
  const r = irregular.engine.snapshot().research; assert.equal(r.lead.available, false);
  assert.match(r.crosslags[0].reason, /Uniform/); assert.equal(r.crosslags[0].lagSeconds, undefined);
});
check('Snapshots and exported references cannot mutate internal model state', () => {
  const h = harness(); h.train(); const snapshot = h.engine.snapshot(), ref = h.engine.exportReference();
  snapshot.reference.stats.heart_rate_bpm.mean = 200; snapshot.weights.effective.heart_rate_bpm = 100; snapshot.components[0].value = 200;
  ref.stats.pulse_sdnn_ms.mean = 0; ref.correlation[0][1] = 100;
  const after = h.engine.snapshot(); near(after.reference.stats.heart_rate_bpm.mean, 68); near(after.weights.effective.heart_rate_bpm, 20); near(after.reference.stats.pulse_sdnn_ms.mean, 55);
});
check('Reference JSON roundtrip restores fixed statistics and sources, never a stale score', () => {
  const a = harness(); a.train(); a.repeat({ heart_rate_bpm: 80 }, 8); const ref = a.engine.exportReference();
  const b = harness(); assert.equal(b.engine.importReference(JSON.stringify(ref)), true);
  assert.equal(b.engine.snapshot().phase, 'waiting'); assert.equal(b.engine.snapshot().value, null);
  b.send(); near(b.engine.snapshot().value, 0); assert.deepEqual(b.engine.snapshot().reference.stats, a.engine.snapshot().reference.stats);
  const c = harness(); assert.equal(c.engine.importReference(ref), true); c.send(); assert.deepEqual(c.engine.snapshot(), b.engine.snapshot());
  b.step(); const changed = b.frame(); changed.quality.heart_rate_bpm.source = 'Different source'; b.engine.ingest(changed); assert.equal(b.engine.snapshot().reference.ready, false);
});
check('Malformed reference metadata, covariance, provenance and impossible scales are rejected atomically', () => {
  const h = harness(); h.train(); const ref = h.engine.exportReference();
  for (const mutate of [r => { r.synthetic = true; }, r => { r.count = 0; }, r => { r.start = null; r.end = null; }, r => { r.end = r.start + 119000; },
    r => { r.stats.heart_rate_bpm.sd = 0; }, r => { r.stats.heart_rate_bpm.sd = 1e100; }, r => { r.stats.pulse_sdnn_ms.mean = -1; },
    r => { r.stats.pulse_sdnn_ms.source = ''; }, r => { r.correlation[0][1] = .9; r.correlation[1][0] = -.9; }, r => { r.correlation[0][0] = 2; },
    r => { r.profile.push('unknown'); }]) {
    const bad = structuredClone(ref); mutate(bad); assert.equal(h.engine.importReference(bad), false); assert.deepEqual(h.engine.exportReference(), ref);
  }
  assert.equal(h.engine.importReference('{bad json'), false); near(h.engine.snapshot().value, 0);
});
check('Synthetic seed and complete demo frames stay isolated from measured references', () => {
  const real = harness(); assert.equal(real.engine.loadDemoReference(), false); assert.equal(real.engine.ingest(M.demoFrame(real.clock, 0)), false);
  const demo = harness({ synthetic: true }); assert.equal(demo.engine.loadDemoReference(), true);
  assert.equal(demo.engine.ingest(M.demoFrame(demo.clock, 0)), true); near(demo.engine.snapshot().value, 0);
  assert.equal(demo.engine.snapshot().weights.coveredNominal, 100); assert.equal(demo.engine.snapshot().source, 'synthetic');
  const seed = demo.engine.exportReference(); assert.equal(real.engine.importReference(seed), false);
  assert.throws(() => M.demoFrame(NaN), /finite/); assert.throws(() => M.create({ profile: 'arbitrary' }), /Profile/);
});
check('Reset clears references, research, events, score history and all source identities', () => {
  const h = harness(); h.train(); h.repeat({ heart_rate_bpm: 90, pulse_rmssd_ms: 10 }, 5); h.engine.resetReference();
  const s = h.engine.snapshot(); assert.equal(s.phase, 'waiting'); assert.equal(s.reference.ready, false); assert.equal(s.value, null);
  assert.deepEqual(s.history, []); assert.deepEqual(s.events, []); assert.equal(s.research.surprise.available, false);
});
console.log(`${passed} multivariate-engine checks passed`);
