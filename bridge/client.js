/* Injected only by the local Mac relay. The published standalone page never
 * starts this connection. No third-party endpoint or persistent credentials. */
(() => {
  'use strict';
  const config = window.__AUTONOMIC_RELAY__;
  const live = window.TelemetryLive;
  if (!config || !live || !/^\/[A-Za-z0-9_-]+\/$/.test(config.base)) return;
  let stream = null, disposed = false, transport = false, lastContact = 0;
  let sequence = -1, offsetUpper = null, syncAt = 0, lastSync = 0;
  const latest = {muse: null, hume: null};
  const phases = {muse: 'idle', hume: 'idle'};
  const synthetic = Boolean(config.simulated);
  const source = synthetic ? 'synthetic' : 'device-reported';
  const context = connected => live.setRelayContext({available: true, connected,
    simulated: synthetic, url: location.href, session: config.session,
    phoneUrl: config.phoneUrl, qrUrl: config.qrUrl});
  const status = payload => {
    if (!['muse', 'hume'].includes(payload.device)) return;
    phases[payload.device] = payload.phase || payload.state || 'idle';
    live.status({...payload, state: phases[payload.device], source,
      simulated: synthetic, transport: 'relay'});
  };
  const dispatchDevices = payload => window.dispatchEvent(new CustomEvent('telemetry:devices', {detail: payload}));

  async function synchronize() {
    const begin = Date.now();
    const response = await fetch(config.base + 'api/state', {cache: 'no-store', credentials: 'same-origin'});
    if (!response.ok) throw Error('The Mac bridge could not be reached.');
    const state = await response.json();
    if (state.session !== config.session || !Number.isFinite(state.server_now)) {
      throw Error('This bridge session changed. Open the new link from your Mac.');
    }
    // Using the request's start, rather than response arrival, overestimates
    // sample age by the outbound transit time. A delayed packet cannot become
    // fresh merely by arriving at this browser. Clock skew is removed here.
    offsetUpper = state.server_now - begin;
    syncAt = Date.now();
    lastSync = syncAt;
    for (const device of Object.values(state.devices || {})) status(device);
    dispatchDevices(state.discovery || {devices: [], scanning: false});
    return state;
  }

  function raw(payload) {
    if (!['muse', 'hume'].includes(payload.device) || !Number.isFinite(payload.received_at)) return;
    if (offsetUpper === null || Date.now() - syncAt > 60000) return;
    const observedAge = Date.now() + offsetUpper - payload.received_at;
    if (observedAge < -100 || observedAge > 5000) return;
    const age = Math.max(0, observedAge);
    latest[payload.device] = Date.now() - age;
    live.receive({...payload, source, simulated: synthetic, transport: 'relay',
      origin_received_at: payload.received_at, received_at: Date.now() - age});
  }

  function features(payload) {
    if (!Number.isFinite(payload.received_at) || offsetUpper === null || Date.now() - syncAt > 60000) return;
    const observedAge = Date.now() + offsetUpper - payload.received_at;
    if (observedAge < -100 || observedAge > 5000) return;
    const age = Math.max(0, observedAge);
    const quality = {};
    for (const [key, value] of Object.entries(payload.quality || {})) {
      const componentAge = Number.isFinite(value.received_at)
        ? Math.max(0, Date.now() + offsetUpper - value.received_at) : Infinity;
      quality[key] = {...value, received_at: Number.isFinite(componentAge) ? Date.now() - componentAge : null,
        origin_received_at: value.received_at, valid: value.valid === true && componentAge <= 5000 &&
          value.received_at <= Date.now() + offsetUpper + 100};
    }
    live.features?.({...payload, quality, source, simulated: synthetic, transport: 'relay',
      origin_received_at: payload.received_at, received_at: Date.now() - age});
  }

  function open() {
    if (disposed) return;
    stream = new EventSource(config.base + 'api/events');
    stream.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.session !== config.session) {
        if (message.kind === 'hello') {
          stream?.close();
          disposed = true;
          live.setRelayContext({available: true, connected: false,
            simulated: synthetic, phoneUrl: config.phoneUrl, qrUrl: config.qrUrl,
            message: 'Your Mac bridge restarted. Refresh this page to reconnect.'});
          for (const device of ['muse', 'hume']) live.status({device,
            state: 'disconnected', source, message: 'Refresh this page to reconnect to the restarted Mac bridge.'});
        }
        return;
      }
      lastContact = Date.now();
      transport = true;
      context(true);
      if (message.kind === 'hello') {
        // Snapshot does not replay raw Muse data. Hume resumes on a new reading.
        for (const device of Object.values(message.payload.devices || {})) status(device);
        dispatchDevices(message.payload.discovery || {devices: [], scanning: false});
        return;
      }
      if (message.kind === 'heartbeat') return;
      if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence) return;
      sequence = message.sequence;
      if (message.kind === 'raw') raw(message.payload);
      else if (message.kind === 'features') features(message.payload);
      else if (message.kind === 'status') status(message.payload);
      else if (message.kind === 'devices') dispatchDevices(message.payload);
    };
    stream.onerror = () => {
      transport = false;
      context(false);
      for (const device of ['muse', 'hume']) {
        if (['connecting', 'waiting', 'streaming', 'stale'].includes(phases[device])) {
          live.status({device, state: 'stale', source, transport: 'relay',
            message: 'The Mac connection paused. Keep the Mac awake and check Wi-Fi.'});
        }
      }
    };
  }

  async function control(action, device, id) {
    try {
      const response = await fetch(config.base + 'api/control', {method: 'POST',
        headers: {'Content-Type': 'application/json'}, credentials: 'same-origin',
        body: JSON.stringify({action, device, id})});
      if (!response.ok) throw Error('The Mac bridge could not perform that action.');
    } catch (error) {
      if (action === 'scan') dispatchDevices({devices: [], scanning: false, error: error.message});
      if (device) status({device, phase: 'error', message: error.message});
    }
  }
  const connect = event => control('scan', event.detail?.device);
  const pair = event => control('connect', event.detail?.device, event.detail?.id);
  const disconnect = event => control('disconnect', event.detail?.device);
  window.addEventListener('telemetry:connect', connect);
  window.addEventListener('telemetry:pair', pair);
  window.addEventListener('telemetry:disconnect', disconnect);
  context(false);
  synchronize().then(open).catch(error => {
    dispatchDevices({devices: [], scanning: false, error: error.message});
    context(false);
  });
  const timer = setInterval(() => {
    if (disposed) return;
    const now = Date.now();
    if (transport && now - lastContact > 4500) {
      transport = false;
      context(false);
    }
    for (const device of ['muse', 'hume']) {
      if (phases[device] === 'streaming' && latest[device] !== null && now - latest[device] > 5000) {
        live.status({device, state: 'stale', source, transport: 'relay', message: 'Waiting for a fresh device reading.'});
      }
    }
    if (now - lastSync > 30000) {
      lastSync = now;
      synchronize().catch(() => {});
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) synchronize().catch(() => {});
  });
  addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    clearInterval(timer);
    stream?.close();
    window.removeEventListener('telemetry:connect', connect);
    window.removeEventListener('telemetry:pair', pair);
    window.removeEventListener('telemetry:disconnect', disconnect);
  });
})();
