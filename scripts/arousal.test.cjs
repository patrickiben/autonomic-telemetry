const assert = require('node:assert/strict');
const { create } = require('../arousal-engine.js');
let passed = 0;
function check(name, run) { run(); console.log('✓ ' + name); passed++; }
const start = 1800000000000;
function harness(options = {}) {
  let clock = start;
  const engine = create({ now: () => clock, ...options });
  function send(hr = 68, prv = 45, more = {}) {
    return engine.ingest({ type: 'features', received_at: clock, source: options.synthetic ? 'synthetic' : 'device-reported',
      heart_rate_bpm: hr, pulse_rmssd_ms: prv, eeg_beta_alpha: 1, motion: .01,
      quality: Object.fromEntries(['heart_rate_bpm', 'pulse_rmssd_ms', 'eeg_beta_alpha'].map(k => [k, {valid: k === 'pulse_rmssd_ms' ? prv !== null : hr !== null, received_at: clock, reason: '', source: k === 'heart_rate_bpm' ? 'Hume current HR' : 'Muse'}])), ...more });
  }
  return { engine, send, step(ms = 1000) { clock += ms; }, get clock() {return clock;}, train() {for(let i=0;i<120;i++){send(); if(i<119)clock+=1000;}} };
}
check('No wearable or reference produces no inferred number', () => {
  const h=harness(); assert.equal(h.engine.snapshot().value,null); assert.equal(h.engine.snapshot().phase,'waiting');
});
check('Reference requires two elapsed minutes, not packet count', () => {
  const h=harness(); for(let i=0;i<1000;i++){h.send();h.step(1);} assert.equal(h.engine.snapshot().phase,'calibrating'); assert.equal(h.engine.snapshot().value,null);
});
check('Fixed reference maps its cardiac features to 50', () => {
  const h=harness();h.train();const s=h.engine.snapshot(); assert.equal(s.phase,'ready');assert.equal(s.value,50);assert.equal(s.track,'dual');assert.equal(s.components[0].reference,68);
});
check('Higher HR and lower optical PRV raise the estimate with bounded contributions', () => {
  const h=harness();h.train();for(let i=0;i<25;i++){h.step();h.send(77,45*Math.exp(-.45));}const s=h.engine.snapshot();assert.equal(s.value,100); assert.equal(s.components[0].reference,68);assert.ok(Math.abs(s.components[1].reference-45)<1e-10);assert.equal(s.components[2].contribution,null);
});
check('Lower HR and higher PRV show settling below reference', () => {
  const h=harness();h.train();for(let i=0;i<25;i++){h.step();h.send(59,45*Math.exp(.45));}const s=h.engine.snapshot();assert.equal(s.value,0);assert.equal(s.label,'Below your reference');
});
check('Missing PRV uses an explicitly limited, separately scaled HR track', () => {
  const h=harness();h.train();h.step();h.send(68,null);const s=h.engine.snapshot();assert.equal(s.track,'hr');assert.equal(s.coverage,'HR-only estimate');assert.equal(s.limited,true);assert.deepEqual(s.reference.channels,['heart_rate_bpm']);assert.equal(s.value,50);assert.equal(s.components[1].value,null);
});
check('No EEG ratio can independently raise the cardiac estimate', () => {
  const h=harness();h.train();for(let i=0;i<10;i++){h.step();h.send(68,45,{eeg_beta_alpha:100});}assert.equal(h.engine.snapshot().value,50);
});
check('Movement holds the estimate instead of making it look calmer', () => {
  const h=harness();h.train();h.step();h.send(90,20,{motion:.2});assert.equal(h.engine.snapshot().phase,'held');assert.equal(h.engine.snapshot().value,null);
});
check('Rejected movement cannot leak its HR into later quiet smoothing or reference formation', () => {
  const h=harness();h.train();h.step();h.send(200,45,{motion:.2});h.step();h.send(68,45);
  const resumed=h.engine.snapshot();assert.equal(resumed.components[0].value,68);assert.equal(resumed.value,50);
  const calibrating=harness();for(let i=0;i<30;i++){calibrating.send();calibrating.step();}
  calibrating.send(200,45,{motion:.2});calibrating.step();calibrating.send(68,45);
  assert.equal(calibrating.engine.snapshot().components[0].value,68);
});
check('Supplied invalid motion is held and cannot contaminate the next usable HR window', () => {
  for(const motion of [-.01,NaN,Infinity,'0.01',{},true]){
    const h=harness();h.train();h.step();h.send(200,45,{motion});
    assert.equal(h.engine.snapshot().phase,'held');assert.equal(h.engine.snapshot().value,null);
    h.step();h.send(68,45);assert.equal(h.engine.snapshot().components[0].value,68);
  }
});
check('Stale data and invalid supporting timestamps cannot become current scores', () => {
  const h=harness();h.train();h.step(6000);assert.equal(h.engine.snapshot().phase,'stale');assert.equal(h.engine.snapshot().value,null);const stale={valid:true,received_at:h.clock-6000,source:'Hume current HR'};h.send(68,45,{quality:{heart_rate_bpm:stale}});assert.equal(h.engine.snapshot().value,null);
});
check('An interrupted initial reference restarts rather than counting the gap', () => {
  const h=harness();for(let i=0;i<80;i++){h.send();h.step();}h.step(6000);h.send();assert.ok(h.engine.snapshot().reference.seconds<2);assert.equal(h.engine.snapshot().value,null);
});
check('Cardiac source changes reset the personal reference', () => {
  const h=harness();h.train();h.step();h.send(68,45,{quality:{heart_rate_bpm:{valid:true,received_at:h.clock,source:'Different cardiac device'}}});assert.equal(h.engine.snapshot().phase,'calibrating');assert.equal(h.engine.snapshot().value,null);
});
check('Synthetic reference is available only in an isolated synthetic engine', () => {
  const real=harness();assert.equal(real.engine.loadDemoReference(),false);assert.equal(real.send(68,45,{source:'synthetic'}),false);
  const demo=harness({synthetic:true});assert.equal(demo.engine.loadDemoReference(),true);demo.send();assert.equal(demo.engine.snapshot().source,'synthetic');assert.equal(demo.engine.snapshot().value,50);assert.equal(demo.send(68,45,{source:'device-reported'}),false);
});
check('Sustained elevation resets on invalid data and signal interruption', () => {
  const h=harness();h.train();for(let i=0;i<100;i++){h.step();h.send(85,20);}assert.ok(h.engine.snapshot().sustainedSeconds>=60);h.step();h.send(null,null);assert.equal(h.engine.snapshot().sustainedSeconds,0);h.step();h.send(85,20);assert.equal(h.engine.snapshot().sustainedSeconds,0);
});
check('Reset clears reference, trend, history and stale scores', () => {
  const h=harness();h.train();h.engine.resetReference();const s=h.engine.snapshot();assert.equal(s.phase,'waiting');assert.deepEqual(s.history,[]);assert.equal(s.value,null);
});
check('Invalid values, duplicate frames and future frames never train the score', () => {
  const h=harness();assert.equal(h.send(68,45,{received_at:h.clock+1000}),false);h.send();assert.equal(h.send(),false);h.step();h.send(NaN,-4);assert.equal(h.engine.snapshot().phase,'held');
});
check('Optical source changes cannot borrow the previous dual reference', () => {
  const h=harness();h.train();h.step();h.send(68,45,{quality:{heart_rate_bpm:{valid:true,received_at:h.clock,source:'Hume current HR'},pulse_rmssd_ms:{valid:true,received_at:h.clock,source:'Different optical path'}}});const s=h.engine.snapshot();assert.equal(s.track,'hr');assert.equal(s.reference.dualProgress,0);assert.equal(s.value,50);
});
check('A long signal gap clears old HR smoothing and trend history', () => {
  const h=harness();h.train();h.step(10000);h.send(90,45);const s=h.engine.snapshot();assert.equal(s.components[0].value,90);assert.equal(s.history.length,1);assert.equal(s.trend.delta,null);
});
console.log(`${passed} arousal-engine checks passed`);
