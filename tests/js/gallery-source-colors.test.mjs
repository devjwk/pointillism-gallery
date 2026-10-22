import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// No browser, network, decoded artwork assets, or personal photos are needed.
const root = new URL('../../', import.meta.url);
const read = name => fs.readFile(new URL(name, root), 'utf8');
const files = [
  'src/gallery/scene/transitions.js', 'src/gallery/analysis/image-data.js',
  'src/gallery/analysis/lines-details.js', 'src/gallery/analysis/depth-composition.js',
  'src/gallery/sampling/stipple.js', 'src/gallery/ui/controls-upload.js',
  'src/gallery/core/state.js', 'src/gallery/render/webgl.js',
  'src/gallery/render/frame.js', 'assets/artworks/catalog.js'
];
const sources = Object.fromEntries(await Promise.all(files.map(async name => [name, await read(name)])));
const scripts = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, new vm.Script(source, { filename: name })]));
const run = (context, name) => scripts['src/gallery/' + name].runInContext(context);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const neutral = { invertTone: false, color: 1, sat: 1, wb: 0, glow: 0, dof: 0, split: 0 };
const geometry = {
  contrast: 1.2, gamma: 1, size: 0.85, depth: 0.9, fill: 1, relief: 0.5,
  tone: 0.3, unify: 0.3, sep: 0.4, detail: 1, lineTone: 0.6, lineDots: 0.35, localContrast: 0.6
};
const close = (actual, expected, label = '', tolerance = 6e-8) => {
  assert(Number.isFinite(actual), label + ': nonfinite value');
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
};
const vectorClose = (actual, expected, label = '') => {
  assert.equal(actual.length, expected.length, label + ': length');
  Array.from(actual).forEach((v, i) => close(v, expected[i], label + '[' + i + ']'));
};
const array = value => Array.from(value);
const same = (actual, expected, label) => assert.deepEqual(array(actual), array(expected), label);
const assertNeutral = params => {
  for (const [key, value] of Object.entries(neutral)) assert.equal(params[key], value, key);
};
function colorHarness() {
  const context = vm.createContext({ clamp });
  run(context, 'scene/transitions.js');
  return context;
}
function pointSet(coords) {
  return { n: coords.length, nx: Float32Array.from(coords, p => p[0]), ny: Float32Array.from(coords, p => p[1]) };
}
function rgbMap(pixels, w = pixels.length, h = 1) {
  return { w, h, lum: new Float32Array(w*h).fill(0.99), rgb: { w, h, data: Uint8Array.from(pixels.flat()) } };
}

const palette = [
  ['black', [0, 0, 0]], ['white', [255, 255, 255]],
  ['near black', [1, 1, 1]], ['dark gray', [32, 32, 32]],
  ['middle gray', [128, 128, 128]], ['light gray', [224, 224, 224]],
  ['red', [255, 0, 0]], ['green', [0, 255, 0]], ['blue', [0, 0, 255]],
  ['warm ochre', [180, 116, 54]], ['warm paper', [235, 211, 165]],
  ['dark warm pigment', [40, 24, 12]]
];
for (const [name, pixel] of palette) {
  test('neutral source RGB preserves ' + name + ' as byte/255, not max-channel normalized', () => {
    const context = colorHarness(), map = rgbMap([pixel]), set = pointSet([[0.5, 0.5]]);
    const before = array(map.rgb.data);
    const colors = context.writeSourceColors(set, map);
    assert.equal(colors, set.col, 'returned buffer must be the stored point colors');
    vectorClose(colors, pixel.map(v => v/255), name);
    same(map.rgb.data, before, 'source RGB must not be mutated');
  });
}

test('RGB lookup uses its own dimensions and clamps every coordinate edge to finite samples', () => {
  const context = colorHarness();
  const pixels = [[0, 0, 0], [255, 0, 0], [0, 128, 0], [24, 48, 96]];
  const map = rgbMap(pixels, 2, 2);
  map.w = 32; map.h = 32; map.lum = new Float32Array(1024).fill(1);
  const coords = [[0, 0], [1, 0], [0, 1], [1, 1], [-100, -2], [20, 40],
    [0.499, 0.499], [0.5, 0.5], [1.01, -0.01], [-0.01, 1.01]];
  const indices = [0, 1, 2, 3, 0, 3, 0, 3, 1, 2];
  vectorClose(context.writeSourceColors(pointSet(coords), map), indices.flatMap(i => pixels[i].map(v => v/255)));
});

test('missing RGB falls back to raw grayscale, including black, without normalization or WB', () => {
  const context = colorHarness();
  const lum = Float32Array.from([0, 0.1, 0.5, 1]), map = { w: 2, h: 2, lum };
  const coords = [[0, 0], [1, 0], [0, 1], [1, 1], [-2, -3], [4, 5]];
  const expected = [0, lum[1], 0.5, 1, 0, 1].flatMap(v => [v, v, v]);
  for (const wb of [0, 0.5, 1]) vectorClose(context.writeSourceColors(pointSet(coords), map, wb), expected);
  same(lum, [0, Math.fround(0.1), 0.5, 1], 'grayscale input unchanged');
});

test('explicit white balance applies only channel multipliers, while WB zero preserves source brightness', () => {
  const context = colorHarness(), pixels = [[0, 0, 0], [180, 120, 60], [120, 90, 60], [30, 20, 10]];
  const map = rgbMap(pixels), before = array(map.rgb.data);
  const coords = pixels.map((_, i) => [(i + 0.5)/pixels.length, 0.5]);
  // Only the two pixels with maximum channel > 80 contribute to the estimator.
  const sums = [300, 210, 120], avg = 210;
  for (const wb of [0, 0.5, 1, 2]) {
    const expected = pixels.flatMap(pixel => pixel.map((v, c) => clamp(v/255 * (avg/sums[c]) ** clamp(wb, 0, 1), 0, 1)));
    vectorClose(context.writeSourceColors(pointSet(coords), map, wb), expected, 'WB=' + wb);
  }
  same(map.rgb.data, before, 'WB must not rewrite source pixels');
  const darkMap = rgbMap([[0, 0, 0], [30, 20, 10]]);
  vectorClose(context.writeSourceColors(pointSet([[0, 0], [1, 1]]), darkMap, 1), [0, 0, 0, 30/255, 20/255, 10/255]);
});

const catalogContext = vm.createContext({});
scripts['assets/artworks/catalog.js'].runInContext(catalogContext);
const presets = JSON.parse(vm.runInContext('JSON.stringify(ARTWORKS.map(({id,tune}) => ({id,tune})))', catalogContext));
test('the regression suite covers all ten legacy catalog presets without editing catalog data', () => {
  assert.equal(presets.length, 10);
  assert.equal(new Set(presets.map(p => p.id)).size, 10);
});
for (const { id, tune } of presets) {
  test(id + ': sourceColorTune neutralizes appearance, preserves geometry and never mutates the legacy preset', () => {
    const context = colorHarness(), before = JSON.stringify(tune);
    Object.freeze(tune);
    const result = context.sourceColorTune(tune);
    assert.notEqual(result, tune);
    assertNeutral(result);
    assert.equal(result.samplingInvert, !!tune.invertTone);
    for (const [key, value] of Object.entries(tune)) {
      if (!(key in neutral) && key !== 'samplingInvert') assert.equal(result[key], value, id + '.' + key);
    }
    assert.equal(JSON.stringify(tune), before);
    const second = context.sourceColorTune(tune);
    assert.notEqual(result, second, 'pure helper returns a fresh object');
    result.size = -99;
    assert.equal(second.size, tune.size ?? geometry.size);
  });
}

function element() {
  const handlers = new Map(), attributes = {}, classes = new Set();
  return {
    value: '1', textContent: '', attributes, classes,
    addEventListener(type, handler) { const list = handlers.get(type) || []; list.push(handler); handlers.set(type, list); },
    dispatchEvent(event) { for (const handler of handlers.get(event.type) || []) handler({ ...event, target: this }); },
    setAttribute(key, value) { attributes[key] = value; },
    classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); } }
  };
}
function uiHarness() {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const calls = { upload: 0, rebuild: 0, timers: 0, sampling: 0 };
  const S = {
    params: { count: 17000, density: 0.63, ...geometry, ...neutral, samplingInvert: true },
    n: 4, cur: 0, flat: false, dirty: false, darkBackground: false,
    nx: Float32Array.from([0, 1, 0, 1]), ny: Float32Array.from([0, 0, 1, 1]),
    col: new Float32Array(12).fill(0.8), dep: Float32Array.from([0.1, 0.2, 0.3, 0.4]),
    lum: Float32Array.from([0, 0.3, 0.7, 1]), sg: Float32Array.from([0, 1, 256, 257]),
    tx: Float32Array.from([10, 20, 30, 40]), ty: Float32Array.from([5, 6, 7, 8]), tz: Float32Array.from([1, 2, 3, 4])
  };
  const map = rgbMap([[0, 0, 0], [255, 255, 255], [128, 128, 128], [180, 120, 60]], 2, 2);
  const ART = [{ cache: { map, pts: { x: [0, 1], y: [0, 1], d: [0.2, 0.7] } } }];
  const context = vm.createContext({
    S, ART, clamp, document: { getElementById: node }, stage: node('stage'),
    Event: class { constructor(type) { this.type = type; } },
    uploadStatic() { calls.upload++; },
    setTimeout() { calls.timers++; return 1; }, clearTimeout() {}
  });
  run(context, 'scene/transitions.js');
  run(context, 'ui/controls-upload.js');
  context.rebuild = () => { calls.rebuild++; };
  for (const name of ['computeArtwork', 'stipple', 'relax', 'analyzeImage', 'makeArtworkSet']) {
    context[name] = () => { calls.sampling++; throw new Error('Unexpected geometry work: ' + name); };
  }
  return { context, S, ART, node, calls };
}
const geometrySnapshot = h => JSON.stringify({
  params: Object.fromEntries(['count', 'density', 'samplingInvert', ...Object.keys(geometry)].map(k => [k, h.S.params[k]])),
  points: Object.fromEntries(['nx', 'ny', 'dep', 'lum', 'sg', 'tx', 'ty', 'tz'].map(k => [k, array(h.S[k])])),
  cache: h.ART[0].cache
});
const noResampling = calls => { assert.equal(calls.rebuild, 0); assert.equal(calls.timers, 0); assert.equal(calls.sampling, 0); };

test('null upload tune resets previous geometry and appearance but does not invent count/density overrides', () => {
  const h = uiHarness();
  for (const key of Object.keys(geometry)) h.S.params[key] = 8.5;
  Object.assign(h.S.params, { invertTone: true, color: 0.1, sat: 2.2, wb: 1, glow: 0.5, dof: 1, split: 0.4 });
  h.S.lineView = true; h.node('bLine').textContent = '선 분석 보기: 켜짐';
  h.context.applyTune(null);
  assert.equal(h.S.lineView, false, 'upload must disable the RGB-masking line view');
  assert.equal(h.node('bLine').textContent, '선 분석 보기');
  assertNeutral(h.S.params);
  assert.equal(h.S.params.samplingInvert, false);
  for (const [key, value] of Object.entries(geometry)) assert.equal(h.S.params[key], value, key);
  assert.equal(h.S.params.count, 17000); assert.equal(h.S.params.density, 0.63);
  const result = h.context.sourceColorTune(null);
  assert.equal(Object.hasOwn(result, 'count'), false); assert.equal(Object.hasOwn(result, 'density'), false);
  noResampling(h.calls);
});

test('provided geometry, count, and density survive tune conversion and application', () => {
  const h = uiHarness(), tune = Object.freeze({ ...geometry, size: 0.71, relief: 0.93, count: 12345, density: 0.42, invertTone: true, sat: 2, wb: 0.9 });
  h.context.applyTune(tune);
  assertNeutral(h.S.params);
  assert.equal(h.S.params.samplingInvert, true);
  for (const key of ['size', 'relief', 'count', 'density']) assert.equal(h.S.params[key], tune[key], key);
});

test('tone button is display-only, dirties rendering, and never rebuilds or changes cached geometry/colors', () => {
  const h = uiHarness(), before = geometrySnapshot(h), colors = array(h.S.col), cache = h.ART[0].cache;
  for (const expected of [true, false]) {
    h.S.dirty = false; h.node('bTone').dispatchEvent({ type: 'click' });
    assert.equal(h.S.params.invertTone, expected); assert.equal(h.S.dirty, true);
    assert.equal(h.node('bTone').attributes['aria-pressed'], String(expected));
    assert.equal(geometrySnapshot(h), before); same(h.S.col, colors); assert.equal(h.ART[0].cache, cache);
  }
  assert.equal(h.calls.upload, 0); noResampling(h.calls);
});

test('white-balance slider only refreshes source colors, with no resampling or motion changes', () => {
  const h = uiHarness(), before = geometrySnapshot(h), colors = array(h.S.col), colorBuffer = h.S.col;
  h.node('wb').value = '0.6'; h.node('wb').dispatchEvent({ type: 'input' });
  assert.equal(h.S.params.wb, 0.6); assert.equal(h.S.dirty, true);
  assert.equal(h.calls.upload, 1); assert.equal(h.S.col, colorBuffer);
  assert.notDeepEqual(array(h.S.col), colors); assert.equal(geometrySnapshot(h), before); noResampling(h.calls);
});

test('restore-original resets appearance and point RGB in place, without touching sampling polarity or geometry', () => {
  const h = uiHarness(), before = geometrySnapshot(h), col = h.S.col;
  Object.assign(h.S.params, { invertTone: true, color: 0, sat: 2, wb: 0.9, glow: 0.4, dof: 0.7, split: 0.3 });
  h.S.lineView = true; h.node('bLine').textContent = '선 분석 보기: 켜짐';
  h.node('bOriginal').dispatchEvent({ type: 'click' });
  assert.equal(h.S.lineView, false, 'restore must disable the RGB-masking line view');
  assert.equal(h.node('bLine').textContent, '선 분석 보기');
  assertNeutral(h.S.params); assert.equal(h.S.dirty, true); assert.equal(h.S.col, col);
  vectorClose(h.S.col, array(h.ART[0].cache.map.rgb.data).map(v => v/255));
  assert.equal(geometrySnapshot(h), before); assert.equal(h.calls.upload, 1); noResampling(h.calls);
  h.node('bOriginal').dispatchEvent({ type: 'click' });
  vectorClose(h.S.col, array(h.ART[0].cache.map.rgb.data).map(v => v/255));
  noResampling(h.calls);
});

test('background toggle is independent of inversion, source colors and cached geometry', () => {
  const h = uiHarness(), before = geometrySnapshot(h), colors = array(h.S.col);
  for (const expected of [true, false]) {
    h.S.dirty = false; h.node('bBackground').dispatchEvent({ type: 'click' });
    assert.equal(h.S.darkBackground, expected); assert.equal(h.S.dirty, true);
    assert.equal(h.node('stage').classes.has('dark-background'), expected);
    assert.equal(h.node('bBackground').attributes['aria-pressed'], String(expected));
    assert.equal(h.S.params.invertTone, false); same(h.S.col, colors); assert.equal(geometrySnapshot(h), before);
  }
  noResampling(h.calls);
});

function analysisHarness() {
  const context = vm.createContext({ clamp });
  for (const name of ['analysis/image-data.js', 'analysis/lines-details.js', 'analysis/depth-composition.js', 'sampling/stipple.js', 'scene/transitions.js']) run(context, name);
  return context;
}
function fixture(withDepth) {
  const w = 32, h = 32, lum = new Float32Array(w*h), data = new Uint8Array(w*h*3);
  const depth = withDepth ? new Float32Array(w*h) : undefined;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i = y*w+x;
    // An asymmetric ramp, dark line, and bright patch exercise real detail/line analysis.
    const v = x === 9 || y === 21 ? 0.03 : x > 19 && y < 11 ? 0.96 : (15 + x*4 + y*2)/255;
    lum[i] = v; data[3*i] = Math.round(v*255); data[3*i+1] = (x*7+y*3)%256; data[3*i+2] = (x*3+y*5)%256;
    if (depth) depth[i] = (x + y*2)/(31*3);
  }
  return { w, h, lum, rgb: { w, h, data }, ...(depth ? { depth } : {}) };
}
for (const withDepth of [false, true]) for (const rotation of [0, 1]) {
  const label = `depth=${withDepth}, rotation=${rotation}`;
  test('analyzeImage display inversion leaves raw luminance, density and depth identical (' + label + ')', () => {
    const c = analysisHarness(), gray = fixture(withDepth), source = array(gray.lum), rgb = array(gray.rgb.data);
    const params = { ...geometry, ...neutral, samplingInvert: false };
    const normal = c.analyzeImage(gray, rotation, params);
    const inverted = c.analyzeImage(gray, rotation, { ...params, invertTone: true });
    for (const key of ['lum', 'samplingLum', 'dens', 'depth', 'depth0', 'detail']) same(inverted[key], normal[key], key);
    same(normal.lum, c.rotateGray(gray, rotation).lum, 'display luminance is raw source, not sharpened/normalized importance');
    assert.notDeepEqual(array(normal.samplingLum), array(normal.lum), 'fixture must exercise nontrivial importance processing');
    for (const key of ['lum', 'dens', 'depth']) assert(array(normal[key]).every(Number.isFinite), key + ' finite');
    same(gray.lum, source, 'source luminance unmodified'); same(gray.rgb.data, rgb, 'source RGB unmodified');
  });
  test('samplingInvert changes density only, not raw luminance, RGB or depth (' + label + ')', () => {
    const c = analysisHarness(), gray = fixture(withDepth), params = { ...geometry, ...neutral, samplingInvert: false };
    const normal = c.analyzeImage(gray, rotation, params);
    const inverted = c.analyzeImage(gray, rotation, { ...params, samplingInvert: true });
    assert.notDeepEqual(array(inverted.dens), array(normal.dens), 'sampling polarity must affect actual density');
    assert.notDeepEqual(array(inverted.samplingLum), array(normal.samplingLum));
    for (const key of ['lum', 'depth', 'depth0', 'detail']) same(inverted[key], normal[key], key);
    same(inverted.rgb.data, normal.rgb.data, 'RGB independent of sampling inversion');
    assert.equal(inverted.depthReal, withDepth);
    assert(array(inverted.dens).every(v => Number.isFinite(v) && v >= 0));
  });
}

test('initial runtime state starts with neutral source colors and a light stage', () => {
  const context = vm.createContext({
    document: { getElementById: () => element() }, ARTWORKS: [],
    window: { matchMedia: () => ({ matches: false }) }, matchMedia: () => ({ matches: false })
  });
  run(context, 'core/state.js');
  const S = vm.runInContext('S', context);
  assertNeutral(S.params); assert.equal(S.params.samplingInvert, false); assert.equal(S.darkBackground, false);
});

test('frame uploads explicit inversion, neutral appearance, flat/title and background uniforms at runtime', () => {
  const h = uiHarness(), uniforms = {}, registered = new Set(), shaders = [];
  const gl = new Proxy({
    isContextLost: () => false, getShaderParameter: () => true, getProgramParameter: () => true,
    shaderSource: (_shader, source) => shaders.push(source),
    getUniformLocation: (_program, name) => { registered.add(name); return name; },
    uniform1f: (name, value) => { uniforms[name] = value; }
  }, { get: (target, key) => target[key] ?? (() => ({})) });
  Object.assign(h.S, {
    mode: 'form', density: 0.63, yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, zoom: 1, zoomT: 1,
    interacted: true, dragging: false, limit: false, sel: -1, selPow: 0, endTime: 0,
    mouse: { on: false, pow: 0, x: 0, y: 0 }, pan: { x: 0, y: 0, z: 0 }, panT: { x: 0, y: 0, z: 0 }
  });
  Object.assign(h.context, {
    cv: { width: 800, height: 600, getContext: () => gl }, statusEl: {}, fpsEl: {},
    performance: { now: () => 5000 }, rafTicks: 0, requestAnimationFrame() {},
    W: 800, H: 600, DPR: 1, imageBox: () => ({ w: 640, h: 480 }), adaptQuality() {}
  });
  run(h.context, 'render/webgl.js'); run(h.context, 'render/frame.js');
  assert.equal(h.context.initGL(), true);
  for (const inverted of [false, true, false]) {
    h.context.setTone(inverted); h.context.frame();
    assert.equal(uniforms.u_invertColor, Number(inverted));
    for (const [uniform, value] of Object.entries({ u_color: 1, u_sat: 1, u_glow: 0, u_dof: 0, u_split: 0, u_flat: 0, u_darkBackground: 0 })) {
      assert(registered.has(uniform), uniform + ' is registered'); assert.equal(uniforms[uniform], value, uniform);
    }
  }
  h.S.flat = true; h.context.setStageBackground(true); h.context.frame();
  assert.equal(uniforms.u_flat, 1); assert.equal(uniforms.u_darkBackground, 1);
  assert(registered.has('u_invertColor'));
  // GLSL is not executed by this mock. These assertions guard the shader contract;
  // real compilation and framebuffer fidelity belong to the browser test suite.
  const vertex = shaders.find(source => source.includes('attribute vec3 a_col'));
  assert.match(vertex, /dot\(a_col,\s*vec3\(0\.2126,\s*0\.7152,\s*0\.0722\)\)/);
  assert.match(vertex, /if\s*\(u_invertColor\s*>\s*0\.5\)\s*v_col\s*=\s*vec3\(1\.0\)\s*-\s*v_col/);
  const basePass = vertex.match(/if\s*\(u_pass\s*<\s*0\.5\)\s*\{([\s\S]*?)\}\s*else\s*\{/);
  assert(basePass, 'base opacity pass exists');
  assert.doesNotMatch(basePass[1], /\bl\b|sourceLuma/, 'neutral point alpha/size must not multiply source luminance again');
});


function blackFixture() {
  const w = 32, h = 32;
  return { w, h, lum: new Float32Array(w*h), rgb: { w, h, data: new Uint8Array(w*h*3) } };
}

test('all-black analysis supplies positive finite density while keeping raw luminance and RGB black', () => {
  const c = analysisHarness(), gray = blackFixture();
  for (const samplingInvert of [false, true]) {
    const map = c.analyzeImage(gray, 0, { ...geometry, ...neutral, samplingInvert });
    assert.equal(map.dens.length, 32*32);
    assert(array(map.dens).every(v => Number.isFinite(v) && v > 0), 'black input must remain sampleable');
    assert(array(map.lum).every(v => v === 0), 'density fallback must not brighten raw luminance');
    assert(array(map.rgb.data).every(v => v === 0), 'density fallback must not whiten RGB');
    assert(array(map.depth).every(Number.isFinite), 'black input depth must be finite');
    const colors = c.writeSourceColors(pointSet([[0, 0], [0.5, 0.5], [1, 1]]), map);
    same(colors, new Float32Array(9), 'source point colors remain black');
  }
  assert(array(gray.lum).every(v => v === 0));
  assert(array(gray.rgb.data).every(v => v === 0));
});

test('all-black density fallback produces nonempty finite stippled points instead of an empty/NaN set', () => {
  const c = analysisHarness();
  // Seed only this VM, making the actual sampler deterministic without changing host Math.
  vm.runInContext('let blackSeed = 123456789; Math.random = () => ((blackSeed = (Math.imul(1664525, blackSeed) + 1013904223) >>> 0) / 4294967296);', c);
  const map = c.analyzeImage(blackFixture(), 0, { ...geometry, ...neutral, samplingInvert: false });
  const pts = c.stipple(map, 64);
  assert(pts.x.length > 0, 'opaque black must not yield zero sampled points');
  assert.equal(pts.y.length, pts.x.length); assert.equal(pts.l.length, pts.x.length); assert.equal(pts.d.length, pts.x.length);
  for (const field of ['x', 'y', 'l', 'd']) assert(array(pts[field]).every(Number.isFinite), field + ' must be finite');
  for (const field of ['x', 'y']) assert(array(pts[field]).every(v => v >= 0 && v <= 1), field + ' must be normalized');
  assert(array(pts.l).every(v => v === 0), 'sampling fallback does not invent brightness');
  const set = { n: pts.x.length, nx: pts.x, ny: pts.y };
  assert(array(c.writeSourceColors(set, map)).every(v => v === 0));
});

test('grayFromImage accepts opaque black and composites a transparent uniform image onto white first', () => {
  const canvases = [];
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      // Minimal uniform-pixel canvas stub: no browser or external image is used.
      const canvas = { width: 0, height: 0, pixel: [0, 0, 0, 0], calls: [] };
      const g = {
        fillStyle: '',
        fillRect() {
          canvas.calls.push('fill');
          assert.equal(this.fillStyle, '#fff');
          canvas.pixel = [255, 255, 255, 255];
        },
        drawImage(source) {
          canvas.calls.push('draw');
          const pixel = source.pixel ?? source.rgba, alpha = pixel[3]/255;
          canvas.pixel = pixel.slice(0, 3).map((v, i) => Math.round(v*alpha + canvas.pixel[i]*(1-alpha)));
          canvas.pixel.push(255);
        },
        getImageData(_x, _y, w, h) {
          const data = new Uint8ClampedArray(w*h*4);
          for (let i=0;i<w*h;i++) data.set(canvas.pixel, i*4);
          return { data };
        }
      };
      canvas.getContext = type => { assert.equal(type, '2d'); return g; };
      canvases.push(canvas);
      return canvas;
    }
  };
  const c = vm.createContext({ document });
  run(c, 'analysis/image-data.js');
  for (const [rgba, expected] of [[[0, 0, 0, 255], 0], [[0, 0, 0, 0], 255]]) {
    let gray;
    assert.doesNotThrow(() => { gray = c.grayFromImage({ naturalWidth: 32, naturalHeight: 32, rgba }); });
    assert(gray.lum.length > 0); assert(gray.rgb.data.length > 0);
    assert(array(gray.lum).every(v => v === expected/255), 'decoded uniform luminance');
    assert(array(gray.rgb.data).every(v => v === expected), 'decoded uniform RGB');
    assert.deepEqual(canvases.at(-2).calls, ['fill', 'draw'], 'white backing must precede image drawing');
  }
});
