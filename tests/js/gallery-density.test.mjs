import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = name => fs.readFile(new URL(name, root), 'utf8');
const [webglSource, frameSource, controlsSource, stateSource, html] = await Promise.all([
  'src/gallery/render/webgl.js', 'src/gallery/render/frame.js',
  'src/gallery/ui/controls-upload.js', 'src/gallery/core/state.js', 'index.html'
].map(read));
const webglScript = new vm.Script(webglSource, { filename: 'webgl.js' });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = p => p < 0.5 ? 4*p*p*p : 1 - (-2*p + 2)**3 / 2;
const close = (actual, expected, tolerance = 1e-9) =>
  assert(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const vectorClose = (actual, expected, tolerance = 1e-9) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => close(v, expected[i], tolerance));
};
const expectedOffset = (phase, noise, spread) => [
  Math.sin(phase + noise*Math.PI*2)*spread,
  Math.cos(phase*2 + noise*Math.PI*2)*spread,
  Math.sin(phase*3 - noise*Math.PI*2)*spread*0.35
];
const pointFields = ['nx','ny','dep','lum','sa','sg','col','fx','fy','fz','tx','ty','tz',
  'sx','sy','sz','t0','dur','swirl','phase','z'];

function harness() {
  const S = {
    n: 3, mode: 'form', flat: false, density: 1,
    params: { density: 1, size: 1, glow: 0, dof: 0, lineDots: 1, color: 1, sat: 1, split: 0 },
    yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, zoom: 1, zoomT: 1,
    interacted: true, dragging: false, limit: false, sway: false,
    mouse: { on: false, pow: 0, x: 0, y: 0 },
    pan: { x: 0, y: 0, z: 0 }, panT: { x: 0, y: 0, z: 0 },
    sel: -1, selPow: 0, endTime: 0, statusPending: false, dirty: false
  };
  const values = {
    nx: [0.1,0.5,0.9], ny: [0.2,0.6,0.8], dep: [0.1,0.3,0.7],
    lum: [0.2,0.5,0.9], sa: [1,1,0.6], sg: [0,1,256], col: [1,0.5,0.2,0.2,1,0.4,0.3,0.6,1],
    fx: [-80,20,110], fy: [10,-30,80], fz: [40,-20,10],
    tx: [-50,30,100], ty: [-20,40,70], tz: [20,-10,30],
    sx: [200,-300,150], sy: [-100,200,120], sz: [100,-50,200],
    t0: [1000,1000,1000], dur: [1000,1000,1000],
    swirl: [-1,1,-1], phase: [0.2,1.1,2.8], z: [0.1,0.45,0.9]
  };
  for (const [key, data] of Object.entries(values)) S[key] = new Float32Array(data);
  for (const key of ['rx','ry','rz']) S[key] = new Float32Array(S.n);
  const box = { x: 0, y: 0, w: 800, h: 600 };
  const uniforms = {}, registeredUniforms = [], shaderSources = [];
  let draws = 0;
  const mockGL = new Proxy({
    isContextLost: () => false,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    shaderSource: (_shader, source) => shaderSources.push(source),
    getUniformLocation: (_program, name) => { registeredUniforms.push(name); return name; },
    uniform1f: (name, value) => { uniforms[name] = value; },
    drawArrays: () => { draws++; }
  }, { get: (target, key) => target[key] ?? (() => ({})) });
  const context = vm.createContext({
    S, clamp, ease, imageBox: () => box, performance: { now: () => 5000 },
    cv: { width: 1000, height: 800, getContext: () => mockGL },
    W: 1000, H: 800, DPR: 1, statusEl: {}, fpsEl: {}, rafTicks: 0,
    requestAnimationFrame() {}, adaptQuality() {}, setStatus() {},
    rotateCamera(yaw, pitch) { S.yaw = yaw; S.pitch = pitch; }
  });
  webglScript.runInContext(context);
  return { S, context, box, uniforms, registeredUniforms, shaderSources, draws: () => draws };
}
const positions = S => Array.from({ length: S.n }, (_, i) => [S.rx[i], S.ry[i], S.rz[i]]);
const immutablePoints = S => Object.fromEntries(pointFields.map(key => [key, Array.from(S[key])]));

test('density spread clamps density, rejects invalid inputs, and scales monotonically with the image box', () => {
  const { context } = harness();
  const spread = context.densitySpread;
  assert.equal(typeof spread, 'function');
  close(spread(1, 800, 600), 0);
  close(spread(0, 800, 600), 72);
  close(spread(-2, 800, 600), 72);
  close(spread(2, 800, 600), 0);
  close(spread(0.4, 800, 600), 43.2);
  close(spread(0.4, 600, 800), 43.2);
  close(spread(0.4, 1600, 1200), 86.4);
  for (const invalid of [NaN, Infinity, -Infinity, undefined]) {
    close(spread(invalid, 800, 600), 0);
  }
  for (const invalid of [0, -1, NaN, Infinity, -Infinity, undefined]) {
    close(spread(0.4, invalid, 600), 0);
    close(spread(0.4, 800, invalid), 0);
  }
  let previous = Infinity;
  for (let i = 0; i <= 100; i++) {
    const value = spread(i / 100, 800, 600);
    assert(value >= 0 && value <= 72);
    assert(value <= previous);
    previous = value;
  }
});

test('density offsets use deterministic bounded XYZ formulas and reuse an optional output array', () => {
  const { context } = harness();
  assert.equal(typeof context.densityOffset, 'function');
  for (const phase of [0, 0.2, 1.1, -2.7, Math.PI*4]) {
    for (const noise of [0, 0.1, 0.45, 0.9, 1]) {
      for (const spread of [0, 43.2, 72]) {
        const expected = expectedOffset(phase, noise, spread);
        const first = context.densityOffset(phase, noise, spread);
        vectorClose(Array.from(first), expected);
        vectorClose(Array.from(context.densityOffset(phase, noise, spread)), expected);
        assert(Math.abs(first[0]) <= spread && Math.abs(first[1]) <= spread);
        assert(Math.abs(first[2]) <= spread*0.35);
        const out = [999,999,999];
        assert.equal(context.densityOffset(phase, noise, spread, out), out);
        vectorClose(out, expected);
      }
    }
  }
});

test('density 1 -> 0.4 -> 1 restores fixed-time positions without changing the point pool or targets', () => {
  const { S, context, box } = harness();
  const references = Object.fromEntries(pointFields.map(key => [key, S[key]]));
  const before = immutablePoints(S), n = S.n;
  context.snapshot(2500);
  const original = positions(S);
  S.density = 0.4;
  // The target must not replace the currently rendered density in CPU snapshots.
  S.params.density = 0.9;
  context.snapshot(2500);
  const expanded = positions(S);
  const spread = (1 - S.density)*Math.min(box.w, box.h)*0.12;
  for (let i = 0; i < S.n; i++) {
    const offset = expectedOffset(S.phase[i], S.z[i], spread);
    vectorClose(expanded[i], original[i].map((v, axis) => v + offset[axis]), 2e-5);
  }
  assert.notDeepEqual(expanded, original);
  S.density = 1;
  context.snapshot(2500);
  assert.deepEqual(positions(S), original);
  assert.equal(S.n, n);
  assert.deepEqual(immutablePoints(S), before);
  for (const key of pointFields) assert.equal(S[key], references[key], `${key} was replaced`);
});

test('CPU snapshot eases displacement once and preserves a captured source at transition e=0', () => {
  const dense = harness(), loose = harness();
  loose.S.density = 0.4;
  for (const now of [1000,1250,1500,1750,2000]) {
    dense.context.snapshot(now);
    loose.context.snapshot(now);
    const e = ease(clamp((now - 1000)/1000, 0, 1));
    for (let i = 0; i < dense.S.n; i++) {
      const offset = expectedOffset(loose.S.phase[i], loose.S.z[i], 43.2);
      vectorClose(positions(loose.S)[i], positions(dense.S)[i].map((v, axis) => v + offset[axis]*e), 2e-5);
    }
  }
  loose.context.snapshot(2500);
  const captured = positions(loose.S);
  for (const [from, current] of [['fx','rx'],['fy','ry'],['fz','rz']]) loose.S[from].set(loose.S[current]);
  loose.S.t0.fill(2500);
  loose.context.snapshot(2500);
  assert.deepEqual(positions(loose.S), captured, 'new transition must not add density twice at its first frame');
});

test('scatter and flat title snapshots ignore density', () => {
  for (const [mode, flat] of [['scatter',false], ['form',true], ['scatter',true]]) {
    const { S, context } = harness();
    S.mode = mode; S.flat = flat;
    for (const now of [1000,1500,2500]) {
      S.density = 1; context.snapshot(now);
      const baseline = positions(S);
      S.density = 0; context.snapshot(now);
      assert.deepEqual(positions(S), baseline, `${mode}, flat=${flat}, time=${now}`);
    }
  }
});

function sliderHarness() {
  const start = controlsSource.indexOf('function bindRange(');
  const end = controlsSource.indexOf("\nbindRange(", start);
  assert(start >= 0 && end > start, 'bindRange function boundaries must exist');
  const calls = { rebuild: 0, depth: 0, refresh: 0 };
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'density' ? '1' : '0', textContent: '', listeners: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.listeners[name] = callback; }
    });
    return elements.get(id);
  } };
  const S = { density: 1, params: { density: 1 }, dirty: false };
  const context = vm.createContext({
    S, document, scheduleRebuild() { calls.rebuild++; },
    retargetDepth() { calls.depth++; }, scheduleDepthRefresh() { calls.refresh++; }
  });
  new vm.Script(controlsSource.slice(start, end)).runInContext(context);
  const binding = controlsSource.match(/^bindRange\(['"]density['"][^\n]*$/m);
  assert(binding, 'density must bind to its actual percentage formatter');
  new vm.Script(binding[0]).runInContext(context);
  return { S, elements, calls };
}

test('density slider updates only its target, percentage, and dirty flag without scheduling a rebuild', () => {
  const { S, elements, calls } = sliderHarness();
  const input = elements.get('density'), output = elements.get('oDensity');
  assert.equal(output.textContent, '100%');
  for (const density of [0.4,0,1]) {
    S.dirty = false;
    input.value = String(density); input.listeners.input();
    assert.equal(S.params.density, density);
    assert.equal(S.density, 1, 'input must leave the rendered value for frame smoothing');
    assert.equal(S.dirty, true);
    assert.equal(output.textContent, `${Math.round(density*100)}%`);
    assert.equal(input.attributes['aria-valuetext'], output.textContent);
  }
  assert.deepEqual(calls, { rebuild: 0, depth: 0, refresh: 0 });
  input.value = '0.37'; input.listeners['x-sync']();
  assert.equal(output.textContent, '37%');
});

test('state and source markup initialize density at 100 percent with an independent 0..1 range', () => {
  const context = vm.createContext({
    document: { getElementById: () => ({}) }, window: {}, ARTWORKS: []
  });
  new vm.Script(stateSource).runInContext(context);
  const initial = new vm.Script('({ density: S.density, target: S.params.density })').runInContext(context);
  assert.equal(initial.density, 1);
  assert.equal(initial.target, 1);
  const input = html.match(/<input\b[^>]*\bid=["']density["'][^>]*>/);
  assert(input, 'density range is present');
  for (const [name, expected] of Object.entries({ type: 'range', min: '0', max: '1', step: '0.01', value: '1' })) {
    const attribute = input[0].match(new RegExp(`\\b${name}=["']([^"']+)["']`));
    assert(attribute, `missing ${name}`);
    if (name === 'type') assert.equal(attribute[1], expected);
    else assert.equal(Number(attribute[1]), Number(expected));
  }
  assert.match(html, /<output\b[^>]*\bid=["']oDensity["']/);
});

test('shader spread is registered and frame smoothing renders through the exact target before idling', () => {
  const h = harness(), { S, context, uniforms, registeredUniforms, shaderSources } = h;
  assert.equal(context.initGL(), true);
  assert(registeredUniforms.includes('u_spread'));
  const shader = shaderSources[0];
  assert.match(shader, /uniform\s+float\s+[^;]*\bu_spread\b/);
  assert.match(shader, /vec3\s+densityOffset3\s*\(/);
  assert.match(shader.replace(/\s+/g, ''), /pos\+=densityOffset3\(ph,zr,u_spread(?:\*e\)|\)\*e);/);
  // These are source-contract checks, not a claim of GPU execution or float parity.
  const densityFunction = shader.match(/vec3\s+densityOffset3\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/);
  assert(densityFunction);
  const parameters = densityFunction[1].split(',').map(p => p.trim().split(/\s+/).at(-1));
  assert.equal(parameters.length, 3);
  const [phase, noise, spread] = parameters;
  const body = densityFunction[2].replace(/\s+/g, '');
  const turnDeclaration = body.match(new RegExp(`float(\\w+)=${noise}\\*(6\\.283185\\d*);`));
  assert(turnDeclaration, 'shader must use stable per-point noise times a full turn');
  const turn = turnDeclaration[1];
  close(Number(turnDeclaration[2]), Math.PI*2, 1e-11);
  assert(body.endsWith(`returnvec3(sin(${phase}+${turn}),cos(${phase}*2.0+${turn}),sin(${phase}*3.0-${turn})*0.35)*${spread};`),
    'GLSL must express the same XYZ formula as the CPU helper');

  new vm.Script(frameSource, { filename: 'frame.js' }).runInContext(context);
  for (const target of [0.4,1]) {
    S.params.density = target;
    let previous = S.density, reached = false;
    for (let tick = 0; tick < 500; tick++) {
      const before = h.draws();
      context.frame();
      assert(h.draws() > before, 'every density-moving frame, including final snap, must render');
      assert(S.density >= Math.min(previous,target) && S.density <= Math.max(previous,target));
      if (tick === 0) assert(S.density !== previous && S.density !== target, 'density must ease, not jump');
      close(uniforms.u_spread, (1-S.density)*Math.min(h.box.w,h.box.h)*0.12);
      previous = S.density;
      if (S.density === target) { reached = true; break; }
    }
    assert(reached, 'density must settle to the exact target');
    const settledDraws = h.draws(); context.frame();
    assert.equal(h.draws(), settledDraws, 'settled form should resume idling');
  }
  S.params.density = S.density = 0.4;
  for (const [mode,flat] of [['scatter',false],['form',true]]) {
    S.mode = mode; S.flat = flat; S.dirty = true; context.frame();
    assert.equal(uniforms.u_spread, 0, `${mode}, flat=${flat} must not disperse`);
  }
});
