/* Personal reference-relative arousal heuristic. No clinical calibration.
 * HR and optical PRV are related cardiac features, not independent proof of a
 * mental state or sympathetic outflow. Source and coverage never mix silently.
 * Pure offline module; no storage, network, device discovery, or timers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TelemetryArousal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const median = a => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  };
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const spec = {
    heart_rate_bpm: { label: 'Heart rate', unit: 'bpm', floor: 3, transform: x => x, sign: 1, range: [30, 220] },
    pulse_rmssd_ms: { label: 'Pulse variability · PRV', unit: 'ms', floor: .15, transform: Math.log, sign: -1, range: [1, 300] },
    eeg_beta_alpha: { label: 'EEG beta / alpha · context only', unit: 'ratio', range: [.000001, 1000] }
  };
  const newTrack = keys => ({ keys, rows: [], reference: null, raw: [], history: [], lastAt: 0, aboveSince: 0, value: null });
  function create(options = {}) {
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const synthetic = options.synthetic === true;
    let tracks, latest = null, latestAt = 0, hrWindow = [], origin = null, pulseOrigin = null, latestMotionEligible = true;
    const reset = () => {
      tracks = { hr: newTrack(['heart_rate_bpm']), dual: newTrack(['heart_rate_bpm', 'pulse_rmssd_ms']) };
      latest = null; latestAt = 0; hrWindow = []; origin = null; pulseOrigin = null; latestMotionEligible = true;
    };
    reset();
    function usable(frame, key, stamp) {
      const s = spec[key], q = frame.quality?.[key], v = frame[key];
      return finite(v) && v >= s.range[0] && v <= s.range[1] && q?.valid === true &&
        finite(q.received_at) && q.received_at <= stamp + 100 && stamp - q.received_at <= 5000;
    }
    const motionEligible = frame => frame.motion == null || (finite(frame.motion) && frame.motion >= 0 && frame.motion <= .12);
    function ingest(frame) {
      const stamp = now();
      if (!frame || !finite(frame.received_at) || frame.received_at > stamp + 100 || stamp - frame.received_at > 5000 ||
          frame.received_at <= latestAt || frame.source !== (synthetic ? 'synthetic' : 'device-reported')) return false;
      // A change of cardiac source gets a new reference rather than borrowing
      // the old sensor's reference. Synthetic frames have their own instance.
      const source = frame.quality?.heart_rate_bpm?.source || 'unidentified cardiac source';
      if (origin && origin !== source && usable(frame, 'heart_rate_bpm', stamp)) reset();
      if (usable(frame, 'heart_rate_bpm', stamp)) origin = source;
      const pulseSource = frame.quality?.pulse_rmssd_ms?.source || 'unidentified optical source';
      if (pulseOrigin && pulseOrigin !== pulseSource && usable(frame, 'pulse_rmssd_ms', stamp))
        tracks.dual = newTrack(['heart_rate_bpm', 'pulse_rmssd_ms']);
      if (usable(frame, 'pulse_rmssd_ms', stamp)) pulseOrigin = pulseSource;
      if (latestAt && frame.received_at - latestAt > 5000) hrWindow = [];
      latest = JSON.parse(JSON.stringify(frame)); latestMotionEligible = motionEligible(frame); latestAt = frame.received_at;
      if (usable(frame, 'heart_rate_bpm', stamp) && motionEligible(frame)) {
        hrWindow.push({ timestamp: frame.received_at, value: frame.heart_rate_bpm });
        hrWindow = hrWindow.filter(x => frame.received_at - x.timestamp <= 15000);
      } else hrWindow = [];
      const values = { heart_rate_bpm: hrWindow.length ? mean(hrWindow.map(x => x.value)) : null,
        pulse_rmssd_ms: frame.pulse_rmssd_ms };
      for (const track of Object.values(tracks)) {
        const eligible = track.keys.every(k => usable(frame, k, stamp)) &&
          motionEligible(frame);
        if (!eligible) {
          track.aboveSince = 0;
          if (!track.reference && track.rows.length && frame.received_at - track.rows.at(-1).timestamp > 5000) track.rows = [];
          continue;
        }
        if (!track.reference) {
          const previous = track.rows.at(-1);
          if (previous && frame.received_at - previous.timestamp > 5000) track.rows = [];
          // At most two calibration observations per second. Repeated delivery
          // cannot shorten the 119s minimum span of the two-minute reference.
          if (!track.rows.length || frame.received_at - track.rows.at(-1).timestamp >= 500)
            track.rows.push({ timestamp: frame.received_at, ...values });
          const span = track.rows.length > 1 ? track.rows.at(-1).timestamp - track.rows[0].timestamp : 0;
          if (track.rows.length >= 60 && span >= 119000) {
            track.reference = {};
            for (const key of track.keys) {
              const x = track.rows.map(row => spec[key].transform(row[key])), center = median(x);
              track.reference[key] = { center, scale: Math.max(spec[key].floor, 1.4826 * median(x.map(v => Math.abs(v - center)))),
                value: key === 'pulse_rmssd_ms' ? Math.exp(center) : center };
            }
            track.rows = [];
          }
        }
        if (!track.reference) continue;
        const z = track.keys.map(key => clamp(spec[key].sign * (spec[key].transform(values[key]) - track.reference[key].center) / track.reference[key].scale, -3, 3));
        const signed = track.keys.length === 1 ? z[0] : .6 * z[0] + .4 * z[1];
        const raw = clamp(50 + 50 * signed / 3, 0, 100);
        if (track.lastAt && frame.received_at - track.lastAt > 5000) { track.raw = []; track.history = []; }
        // Median smoothing only within a contiguous five-second window.
        track.raw = track.raw.filter(x => frame.received_at - x.timestamp <= 5000);
        track.raw.push({ timestamp: frame.received_at, value: raw });
        track.value = median(track.raw.map(x => x.value));
        const contiguous = track.lastAt && frame.received_at - track.lastAt <= 5000;
        track.aboveSince = track.value >= 67 ? (contiguous && track.aboveSince ? track.aboveSince : frame.received_at) : 0;
        track.lastAt = frame.received_at;
        track.history.push({ timestamp: frame.received_at, value: track.value });
        track.history = track.history.filter(x => frame.received_at - x.timestamp <= 600000);
      }
      return true;
    }
    function snapshot(stamp = now()) {
      const fresh = latest && stamp - latestAt <= 5000 && stamp >= latestAt - 100;
      const valid = key => fresh && usable(latest, key, stamp) && latestMotionEligible;
      const dual = valid('heart_rate_bpm') && valid('pulse_rmssd_ms') && tracks.dual.reference;
      const kind = dual ? 'dual' : 'hr', track = tracks[kind];
      // No cross-coverage history or trend: each track has its own scale.
      const ready = Boolean(track.reference), eligible = valid('heart_rate_bpm') && (kind === 'hr' || valid('pulse_rmssd_ms'));
      const seconds = ready ? 120 : track.rows.length > 1 ? Math.min(120, (track.rows.at(-1).timestamp - track.rows[0].timestamp) / 1000 + 1) : track.rows.length;
      let phase = !latest ? 'waiting' : !fresh ? 'stale' : !eligible ? 'held' : !ready ? 'calibrating' : 'ready';
      const value = phase === 'ready' && stamp - track.lastAt <= 5000 ? track.value : null;
      if (phase === 'ready' && value === null) phase = 'held';
      const history = phase === 'ready' ? track.history.filter(x => stamp - x.timestamp <= 600000) : [];
      const tail = history.filter(x => stamp - x.timestamp <= 10000);
      const previous = history.filter(x => stamp - x.timestamp >= 50000 && stamp - x.timestamp <= 70000);
      const delta = tail.length >= 3 && previous.length >= 3 ? median(tail.map(x => x.value)) - median(previous.map(x => x.value)) : null;
      const components = Object.keys(spec).map(key => {
        const s = spec[key], ok = valid(key), ref = track.reference?.[key],
          current = key === 'heart_rate_bpm' && hrWindow.length ? mean(hrWindow.map(x => x.value)) : latest?.[key];
        const z = ok && ref ? clamp(s.sign * (s.transform(current) - ref.center) / ref.scale, -3, 3) : null;
        return { key, label: s.label, value: ok ? current : null, unit: s.unit, reference: ref?.value ?? null,
          delta: ok && ref ? current - ref.value : null, z,
          contribution: z === null ? null : 50 * z / 3 * (kind === 'hr' ? 1 : key === 'heart_rate_bpm' ? .6 : .4),
          valid: Boolean(ok), reason: !fresh ? 'Waiting for fresh device data' : !ok && latest?.quality?.[key]?.valid === true ? (latest && !latestMotionEligible ? 'Movement data are invalid or excessive; index input withheld.' : finite(latest?.[key]) && (latest[key] < s.range[0] || latest[key] > s.range[1]) ? 'Outside this index’s declared analysis range.' : 'Supporting component data are stale.') : latest?.quality?.[key]?.reason || (ok ? '' : 'Not available'),
          source: latest?.quality?.[key]?.source || '', contextOnly: key === 'eeg_beta_alpha' };
      });
      return { phase, value, label: value === null ? '' : value < 40 ? 'Below your reference' : value > 60 ? 'Above your reference' : 'Around your reference',
        reference: { ready, progress: seconds / 120, seconds, requiredSeconds: 120, channels: [...track.keys],
          dualProgress: tracks.dual.reference ? 1 : tracks.dual.rows.length > 1 ? Math.min(1, (tracks.dual.rows.at(-1).timestamp - tracks.dual.rows[0].timestamp + 1000) / 120000) : 0 },
        coverage: kind === 'dual' ? 'Heart rate + pulse variability' : 'HR-only estimate', limited: kind === 'hr', track: kind,
        source: synthetic ? 'synthetic' : 'device-reported', components, history,
        trend: { direction: delta === null || Math.abs(delta) < 3 ? 'steady' : delta > 0 ? 'rising' : 'falling', delta },
        sustainedSeconds: value !== null && track.aboveSince ? Math.max(0, (stamp - track.aboveSince) / 1000) : 0,
        reason: phase === 'waiting' ? 'Connect a wearable to start your personal reference.' : phase === 'calibrating' ? 'Sit comfortably while your initial reference is collected.' :
          phase === 'stale' ? 'Signal paused. The estimate is unavailable.' : phase === 'held' ? (latest && !latestMotionEligible ? 'Movement data are invalid or excessive. The estimate is on hold.' : components.find(x => x.key === 'heart_rate_bpm')?.reason || 'Waiting for a usable cardiac signal.') :
          kind === 'hr' ? 'Limited coverage · heart rate alone is nonspecific.' : 'Experimental personal estimate · 50 is your reference.' };
    }
    function loadDemoReference() {
      if (!synthetic) return false;
      tracks.hr.reference = { heart_rate_bpm: { center: 68, value: 68, scale: 3 } };
      tracks.dual.reference = { ...tracks.hr.reference, pulse_rmssd_ms: { center: Math.log(45), value: 45, scale: .15 } };
      return true;
    }
    return { ingest, snapshot, resetReference: reset, loadDemoReference };
  }
  return Object.freeze({ create });
});
