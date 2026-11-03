/* Rest scene: a lattice of light strands seen through a point-mass gravitational lens.
   Depth is session time. Each layer of cross strands is one moment of the session, newest
   nearest; long threads run back through every layer. A moment's estimate sets its warmth and
   how many of its strands are lit. Every view ray is bent by the thin-lens deflection of a
   point mass, alpha = thetaE^2 / theta, which weakens with angular distance from the mass. That
   gives the Einstein ring, the doubled and smeared images near it, and a dark core where light
   is captured. A per-region limiter, ported from the generative AV labs, caps how fast any large
   area may change brightness, so slow light never becomes a flash. Browser only. */
(function (root) {
  "use strict";
  const MAX_MOMENTS = 256;
  const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
  const HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv; out vec4 o;
`;
  const SCENE_FS = HEAD + `
uniform vec2 uRes, uLens, uDrift;
uniform vec3 uCam;
uniform float uThetaE, uShadow, uWave, uWaveGain, uShift, uFirst, uMomentCount, uHashBase,
  uWarm, uFade, uPix, uStars, uBand, uDirect;
uniform int uPlanes, uSteps;
uniform sampler2D uMoments;

float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float h31(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec2 h22(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p, float octaves){ float a = .5, s = 0.;
  for (int i = 0; i < 4; i++) { if (float(i) >= octaves) break; s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; }
  return s; }

const vec3 COOL = vec3(.16, .52, 1.0), WARM = vec3(1.0, .46, .14), NONE = vec3(.34, .36, .50), THREAD = vec3(.42, .52, .86);

void main(){
  float side = min(uRes.x, uRes.y);
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / side * 1.15;
  // Thin-lens deflection of a point mass: beta = theta - thetaE^2 theta / |theta|^2.
  vec2 th = p - uLens;
  float r = length(th);
  vec2 q = p;
  float captured = 1.;
  if (uThetaE > 0.) {
    q = uLens + th - uThetaE * uThetaE * th / max(r * r, 1e-6);
    captured = smoothstep(uShadow * uThetaE * .78, uShadow * uThetaE * 1.22, r);
  }
  // Source-plane size of this pixel: the lens squeezes some regions hard, and detail there is
  // averaged instead of aliasing into shimmer.
  float squeeze = clamp(length(fwidth(q)) / max(length(fwidth(p)), 1e-6), .05, 60.);
  float pix = uPix * squeeze;
  vec3 d = normalize(vec3(q, 1.));
  float cy = cos(uDrift.x), sy = sin(uDrift.x), cp = cos(uDrift.y), sp = sin(uDrift.y);
  d = vec3(cy * d.x + sy * d.z, d.y, -sy * d.x + cy * d.z);
  d = vec3(d.x, cp * d.y - sp * d.z, sp * d.y + cp * d.z);
  float dz = max(d.z, .2);
  vec3 col = vec3(0.);
  float w = .0075;
  vec2 home = floor(uCam.xy);

  // Moment layers: square frames of cross strands, one layer per moment, newest nearest.
  for (int k = 0; k < 64; k++) {
    if (k >= uPlanes) break;
    float z = .55 + float(k) + uShift;
    float t = (z - uCam.z) / dz;
    vec2 hp = uCam.xy + d.xy * t;
    vec4 m = float(k) < uMomentCount ? texelFetch(uMoments, ivec2(k, 0), 0) : vec4(0.);
    bool encoded = m.g > .5;
    float fp = t * pix;
    float we = sqrt(w * w + .45 * fp * fp);
    float a = w / we;
    vec2 g = abs(hp - floor(hp + .5));
    vec2 cell = floor(hp);
    float key = uHashBase - float(k);
    float density = encoded ? .04 + .30 * m.r : .03;
    // The frame around the viewer's own corridor is always lit, so every moment reads as a layer.
    vec2 rl = floor(hp + .5) - home;
    float frameX = cell.x == home.x && (rl.y == 0. || rl.y == 1.) ? 1. : 0.;
    float frameY = cell.y == home.y && (rl.x == 0. || rl.x == 1.) ? 1. : 0.;
    float litX = max(frameX, step(h31(vec3(cell.x, floor(hp.y + .5), key + .37)), density));
    float litY = max(frameY, step(h31(vec3(floor(hp.x + .5), cell.y, key + .71)), density));
    vec2 off = hp - uCam.xy;
    float radial = exp(-dot(off, off) / 7.);
    float lx = a * exp(-g.y * g.y / (we * we)) * litX;
    float ly = a * exp(-g.x * g.x / (we * we)) * litY;
    float node = a * a * exp(-dot(g, g) / (5. * we * we)) * max(litX, litY) * 1.7;
    vec3 c = encoded ? mix(COOL, WARM, m.r) : NONE;
    float bright = (encoded ? .5 + .5 * m.r : .26) * radial;
    float fog = exp(-t * .072);
    float near = smoothstep(.3, 1.25, t);
    float e = (z - uWave) / 1.5;
    float wave = 1. + uWaveGain * exp(-e * e);
    float first = k == 0 ? uFirst : 1.;
    col += c * ((lx + ly) * .42 + node * (encoded ? 1.1 : .45)) * bright * fog * near * wave * first;
  }

  // Threads: long strands along depth through every layer, found by walking grid cells along
  // the ray's sideways path. Each thread is counted once, from the cell holding its closest point.
  float len2 = length(d.xy);
  if (len2 > 1e-4) {
    vec2 u = d.xy / len2, ro = uCam.xy;
    float smax = 46. * len2;
    vec2 cell = floor(ro);
    vec2 sgn = vec2(u.x >= 0. ? 1. : -1., u.y >= 0. ? 1. : -1.);
    vec2 inv = 1. / max(abs(u), vec2(1e-5));
    vec2 sNext = (cell + max(sgn, 0.) - ro) * sgn * inv;
    float sIn = 0.;
    for (int i = 0; i < 48; i++) {
      if (i >= uSteps || sIn > smax) break;
      float sOut = min(sNext.x, sNext.y);
      for (int c = 0; c < 4; c++) {
        vec2 P = cell + vec2(float(c & 1), float(c >> 1));
        vec2 rel = P - ro;
        float sc = dot(rel, u);
        if (sc <= 0. || sc < sIn || sc >= sOut) continue;
        float h = abs(rel.x * u.y - rel.y * u.x);
        float t = sc / len2;
        float z = uCam.z + t * d.z;
        float we = sqrt(w * w + .45 * (t * pix) * (t * pix));
        float I = (w / we) * exp(-h * h / (we * we));
        float strength = .35 + .65 * h21(P + 17.);
        float e = (z - uWave) / 1.5;
        float wave = 1. + uWaveGain * 1.2 * exp(-e * e);
        col += THREAD * I * strength * exp(-t * .072 - dot(rel, rel) / 10.) * smoothstep(.3, 1.4, t) * wave * .22;
      }
      if (sNext.x < sNext.y) { sIn = sNext.x; cell.x += sgn.x; sNext.x += inv.x; }
      else { sIn = sNext.y; cell.y += sgn.y; sNext.y += inv.y; }
    }
  }

  // Far light and sky, behind the lattice. The light at the far end sits close to the mass, so
  // the lens draws it into the Einstein ring.
  vec2 sv = d.xy / dz;
  float cr2 = dot(sv, sv);
  vec3 coreC = uWarm < 0. ? vec3(.58, .62, .80) : mix(vec3(.42, .70, 1.), vec3(1., .60, .30), uWarm);
  col += coreC * (exp(-cr2 / .0024) * .7 + exp(-cr2 / .024) * .11) * (1. + uWaveGain * .6 * smoothstep(8., 14., uWave));
  if (uBand > 0.) {
    vec2 bv = vec2(sv.x * .97 + sv.y * .24, -sv.x * .24 + sv.y * .97);
    float n = fbm(bv * 3.1 + 4.2, uBand);
    float by = (bv.y + .05 * sin(bv.x * 2.3)) / .16;
    float band = exp(-by * by) * (.45 + .9 * n) * (1. - .55 * smoothstep(.55, .75, fbm(bv * 7.3, uBand)));
    col += vec3(.30, .40, .78) * band * .07;
  }
  for (int l = 0; l < 2; l++) {
    if (float(l) >= uStars) break;
    float N = l == 0 ? 34. : 95.;
    vec2 g = sv * N + float(l) * 41.7;
    vec2 id = floor(g), f = fract(g);
    vec2 hs = h22(id);
    if (hs.x < (l == 0 ? .16 : .10)) {
      vec2 pos = .22 + .56 * h22(id + 3.1);
      float sigma = (l == 0 ? .0011 : .0007) * N;
      float px = pix * N / dz;
      float se = sqrt(sigma * sigma + .5 * px * px);
      float dd = length(f - pos);
      float b = (l == 0 ? 1.1 : .45) * (.35 + hs.y) * (sigma / se) * (sigma / se) * exp(-dd * dd / (se * se));
      vec3 tint = mix(vec3(.75, .84, 1.), vec3(1., .86, .7), h21(id + 9.));
      col += tint * b;
    }
  }

  col *= captured;
  col = (1. - exp(-col * 1.1)) * uFade;
  if (uDirect > .5) {
    col = pow(col, vec3(1. / 2.2));
    col += (h21(gl_FragCoord.xy) - .5) / 255.;
  }
  o = vec4(col, 1.);
}`;
  // The limiter, as in the AV labs: each region may change luminance only so fast, either way.
  const LIMIT_FS = HEAD + `
uniform sampler2D uCur, uPrev; uniform float uLod, uMax;
void main(){
  float cur = dot(textureLod(uCur, vUv, uLod).rgb, vec3(.2126, .7152, .0722));
  float prev = texture(uPrev, vUv).r;
  o = vec4(prev + clamp(cur - prev, -uMax, uMax), cur, 0., 1.);
}`;
  const OUT_FS = HEAD + `
uniform sampler2D uScene, uLim;
float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  vec3 c = textureLod(uScene, vUv, 0.).rgb;
  vec2 L = texture(uLim, vUv).rg;
  c *= clamp((L.x + .003) / (L.y + .003), .05, 4.);
  c = pow(min(c, vec3(1.)), vec3(1. / 2.2));
  o = vec4(c + (h21(gl_FragCoord.xy) - .5) / 255., 1.);
}`;

  function create(canvas) {
    let gl = null;
    try {
      gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: "default" });
    } catch { gl = null; }
    if (!gl) return null;
    const floatTargets = !!gl.getExtension("EXT_color_buffer_float");
    function shader(type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
        throw new Error(gl.getShaderInfoLog(s) || "shader failed");
      return s;
    }
    function program(fs) {
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
        throw new Error(gl.getProgramInfoLog(p) || "link failed");
      const cache = new Map();
      return { p, loc: (n) => (cache.has(n) ? cache.get(n) : (cache.set(n, gl.getUniformLocation(p, n)), cache.get(n))) };
    }
    let scene, limit, out;
    try {
      scene = program(SCENE_FS); limit = program(LIMIT_FS); out = program(OUT_FS);
    } catch { return null; }
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const moments = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, moments);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MAX_MOMENTS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const momentBytes = new Uint8Array(MAX_MOMENTS * 4);
    let momentCount = 0;
    function target(w, h, mip) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const levels = mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return ok ? { tex, fbo, w, h } : (gl.deleteTexture(tex), gl.deleteFramebuffer(fbo), null);
    }
    const free = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } };
    let width = 0, height = 0, sceneT = null, limA = null, limB = null, lod = 0, fresh = true, limiter = false;
    function resize(w, h) {
      w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
      if (w === width && h === height) return;
      width = w; height = h; canvas.width = w; canvas.height = h;
      [sceneT, limA, limB].forEach(free);
      sceneT = limA = limB = null; limiter = false;
      if (floatTargets) {
        lod = Math.max(0, Math.floor(Math.log2(Math.max(w, h) / 24)));
        const lw = Math.max(1, w >> lod), lh = Math.max(1, h >> lod);
        sceneT = target(w, h, true); limA = target(lw, lh, false); limB = target(lw, lh, false);
        limiter = !!(sceneT && limA && limB);
      }
      fresh = true;
    }
    function setMoments(list, current) {
      // Slot 0 is the moment still being lived; later slots are committed moments, newest first.
      momentBytes.fill(0);
      const all = [current, ...list].slice(0, MAX_MOMENTS);
      all.forEach((m, i) => {
        if (!m || typeof m.value !== "number" || !Number.isFinite(m.value)) return;
        momentBytes[i * 4] = Math.round(Math.min(1, Math.max(0, m.value)) * 255);
        momentBytes[i * 4 + 1] = 255;
        momentBytes[i * 4 + 2] = m.synthetic ? 255 : 0;
      });
      momentCount = all.length;
      gl.bindTexture(gl.TEXTURE_2D, moments);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_MOMENTS, 1, gl.RGBA, gl.UNSIGNED_BYTE, momentBytes);
    }
    function render(u) {
      if (gl.isContextLost()) return false;
      gl.disable(gl.BLEND);
      gl.useProgram(scene.p);
      const L = scene.loc;
      gl.uniform2f(L("uRes"), width, height);
      gl.uniform2f(L("uLens"), u.lens[0], u.lens[1]);
      gl.uniform2f(L("uDrift"), u.drift[0], u.drift[1]);
      gl.uniform3f(L("uCam"), u.cam[0], u.cam[1], u.cam[2]);
      gl.uniform1f(L("uThetaE"), u.thetaE);
      gl.uniform1f(L("uShadow"), u.shadow);
      gl.uniform1f(L("uWave"), u.wave);
      gl.uniform1f(L("uWaveGain"), u.waveGain);
      gl.uniform1f(L("uShift"), u.shift);
      gl.uniform1f(L("uFirst"), u.first);
      gl.uniform1f(L("uMomentCount"), momentCount);
      gl.uniform1f(L("uHashBase"), u.hashBase);
      gl.uniform1f(L("uWarm"), u.warm);
      gl.uniform1f(L("uFade"), u.fade);
      gl.uniform1f(L("uPix"), 1.15 / Math.min(width, height));
      gl.uniform1f(L("uStars"), u.stars);
      gl.uniform1f(L("uBand"), u.band);
      gl.uniform1f(L("uDirect"), limiter ? 0 : 1);
      gl.uniform1i(L("uPlanes"), u.planes);
      gl.uniform1i(L("uSteps"), u.steps);
      gl.uniform1i(L("uMoments"), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, moments);
      gl.bindFramebuffer(gl.FRAMEBUFFER, limiter ? sceneT.fbo : null);
      gl.viewport(0, 0, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!limiter) return true;
      gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.useProgram(limit.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, limB.fbo);
      gl.viewport(0, 0, limB.w, limB.h);
      gl.uniform1i(limit.loc("uCur"), 0);
      gl.uniform1i(limit.loc("uPrev"), 1);
      gl.uniform1f(limit.loc("uLod"), lod);
      gl.uniform1f(limit.loc("uMax"), fresh ? 1e3 : u.maxStep);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, limA.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [limA, limB] = [limB, limA];
      fresh = false;
      gl.useProgram(out.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.uniform1i(out.loc("uScene"), 0);
      gl.uniform1i(out.loc("uLim"), 1);
      gl.bindTexture(gl.TEXTURE_2D, limA.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      return true;
    }
    return {
      resize, setMoments, render,
      restart: () => { fresh = true; },
      lost: () => gl.isContextLost(),
      info: () => ({ renderer: "webgl2", limiter, width, height, lod }),
    };
  }

  // Without WebGL2: the same lattice drawn flat, with no lens. A faint ring still keeps the breath.
  function draw2D(ctx, w, h, u, timeline) {
    const side = Math.min(w, h), k = side / 1.15, cx = w / 2, cy = h / 2;
    ctx.fillStyle = "#05070d"; ctx.fillRect(0, 0, w, h);
    const project = (x, y, z) => [cx + ((x - u.cam[0]) / z) * k, cy - ((y - u.cam[1]) / z) * k];
    const color = (m, a) => {
      if (!m || !Number.isFinite(m.value)) return `rgba(107,115,148,${a * 0.6})`;
      const v = Math.min(1, Math.max(0, m.value)), c = [0.4 + 0.6 * v, 0.7 - 0.12 * v, 1 - 0.72 * v];
      return `rgba(${c.map((x) => Math.round(x * 255)).join(",")},${a})`;
    };
    ctx.lineWidth = 1;
    for (let i = -3; i <= 4; i++) for (let j = -3; j <= 4; j++) {
      const [x0, y0] = project(i, j, 0.9), [x1, y1] = project(i, j, 40);
      ctx.strokeStyle = "rgba(158,178,235,.16)";
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    for (let s = Math.min(u.planes, 40) - 1; s >= 0; s--) {
      const z = 0.55 + s + u.shift, fog = Math.exp(-z * 0.072) * (s === 0 ? u.first : 1),
        wave = 1 + u.waveGain * Math.exp(-(((z - u.wave) / 1.5) ** 2)),
        m = s === 0 ? timeline.current : timeline.list[s - 1];
      ctx.strokeStyle = color(m, Math.min(1, 0.55 * fog * wave));
      ctx.lineWidth = Math.max(0.6, 2.2 / z);
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const lit = ((i * 73856093) ^ (j * 19349663) ^ ((u.hashBase - s) * 83492791)) >>> 0;
        if ((lit % 1000) / 1000 > (m && Number.isFinite(m.value) ? 0.14 + 0.64 * m.value : 0.1)) continue;
        const [a, b] = project(i, j, z), [c, d] = project(i + 1, j + 1, z);
        ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
      }
    }
    if (u.thetaE > 0) {
      ctx.strokeStyle = "rgba(225,230,255,.28)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx + u.lens[0] * k, cy - u.lens[1] * k, u.thetaE * k, 0, Math.PI * 2); ctx.stroke();
    }
  }

  const api = Object.freeze({ create, draw2D, MAX_MOMENTS });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RestLattice = api;
})(typeof window !== "undefined" ? window : globalThis);
