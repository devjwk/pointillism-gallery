const stage = document.getElementById('stage');
const cv = document.getElementById('cv');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const captionEl = document.getElementById('caption');
let W = 0, H = 0, DPR = 1;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = p => p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
const REDUCED_MOTION = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ART = ARTWORKS.map(m => ({ meta: m, gray: null, rotation: 0, cache: null }));

// ---------- state ----------
const S = {
  cur: -1, mode: 'scatter', seq: 0,
  n: 0, nBase: 0, nSkirt: 0, aspect: 1, boxFrac: 0.88,
  yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, zoom: 1, zoomT: 1,
  dragging: false, interacted: false, sway: !REDUCED_MOTION, lastMove: 0, invert: false, limit: true,
  mouse: { on: false, x: 0, y: 0, pow: 0 },
  sel: -1, selPow: 0, lockId: -1, lineView: false, pan: { x: 0, y: 0, z: 0 }, panT: { x: 0, y: 0, z: 0 }, nLine: 0,
  endTime: 0, statusPending: false, dirty: true, err: null,
  params: { count: 45000, contrast: 1.2, gamma: 1.0, size: 0.85, glow: 0.3, depth: 0.9, fill: 1.0, dof: 0.5, invertTone: false, relief: 0.5, tone: 0.3, unify: 0.3, sep: 0.4, detail: 1.0, lineTone: 0.6, lineDots: 0.35, localContrast: 0.6, color: 0.85, sat: 1.4, split: 0, wb: 0.7 }
};

// =====================================================================
//  실행 환경 판별: PC(마우스/큰 화면) vs 모바일(터치/작은 화면)
//  ?view=mobile / ?view=pc 로 강제 지정 가능
// =====================================================================
const FORCE = new URLSearchParams(location.search).get('view');
const TOUCH = FORCE === 'mobile' ? true : FORCE === 'pc' ? false : !!(window.matchMedia && matchMedia('(pointer:coarse)').matches);
const LOWEND = TOUCH && ((navigator.deviceMemory || 4) <= 3 || (navigator.hardwareConcurrency || 4) <= 4);
const PROFILE = TOUCH
  ? { count: LOWEND ? 14000 : 22000, max: 40000, dpr: 1.75, px: 2.6e6, pick: 26, sens: 0.0062 }
  : { count: 45000, max: 80000, dpr: 2, px: 6e6, pick: 14, sens: 0.005 };
let DPR_CAP = PROFILE.dpr;
S.params.count = PROFILE.count;
{
  const c = document.getElementById('count');
  c.max = PROFILE.max; c.value = PROFILE.count; c.step = TOUCH ? 500 : 1000;
}
const rootEl = document.documentElement;
const side = document.getElementById('side');
function updateSheetScale() {
  if (!rootEl.classList.contains('compact') || side.dataset.sheet !== 'open') { rootEl.style.setProperty('--s', 1); return; }
  const land = rootEl.classList.contains('land');
  const s = land
    ? (innerWidth - Math.min(360, innerWidth * 0.52)) / Math.max(1, stage.clientWidth)
    : (innerHeight - Math.min(innerHeight * 0.52, 500)) / Math.max(1, stage.clientHeight);
  rootEl.style.setProperty('--s', clamp(s, 0.35, 1).toFixed(3));
}
function setSheet(state) {
  side.dataset.sheet = state;
  rootEl.classList.toggle('sheet-open', state === 'open' && rootEl.classList.contains('compact'));
  document.getElementById('pkOpen').textContent = state === 'open' ? '닫기' : '설정';
  updateSheetScale();
}
function setTab(t) {
  side.dataset.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  side.scrollTop = 0;
}
let wasCompact = null;
function applyLayout() {
  const compact = innerWidth <= 820 || (TOUCH && innerHeight <= 500);
  const land = compact && innerWidth > innerHeight;
  rootEl.classList.toggle('touch', TOUCH);
  rootEl.classList.toggle('compact', compact);
  rootEl.classList.toggle('land', land);
  if (compact !== wasCompact) {
    if (compact && wasCompact === null) { document.getElementById('mapbox').classList.add('hidden'); document.getElementById('bMap').textContent = '깊이맵 보기'; }
    wasCompact = compact;
    setSheet('peek');
  }
  updateSheetScale();
}

// =====================================================================
//  WebGL renderer: 이동/곡선/3D 투영/초점 흐림/마우스 반응을 GPU 셰이더에서 계산
// =====================================================================
const VS = `
attribute vec3 a_from; attribute vec3 a_to; attribute vec4 a_anim; attribute vec4 a_misc; attribute vec3 a_col;
uniform float u_time, u_form, u_pass, u_size, u_glow, u_zoom, u_dpr, u_dof, u_mpow, u_sel, u_selpow, u_line, u_lineview, u_color, u_sat, u_chan, u_split;
uniform vec3 u_pan;
uniform vec2 u_half; uniform vec2 u_mouse; uniform vec4 u_cam;
varying float v_a; varying float v_pass; varying float v_soft; varying vec3 v_col; varying float v_chan;
const float F = 1500.0;
void main() {
  float p = clamp((u_time - a_anim.x) / a_anim.y, 0.0, 1.0);
  float e = p < 0.5 ? 4.0*p*p*p : 1.0 - pow(-2.0*p + 2.0, 3.0) / 2.0;
  vec3 pos = mix(a_from, a_to, e);
  vec2 d = a_to.xy - a_from.xy;
  float len = max(length(d), 0.001);
  float sw = sin(3.14159265 * e) * min(120.0, len * 0.22) * a_anim.z;
  pos.xy += vec2(-d.y, d.x) / len * sw;
  float zr = a_misc.z, ph = a_anim.w;
  float a2 = (u_form > 0.5 ? 0.55 : 6.0 + 14.0*zr) * e;
  pos.x += sin(u_time*(0.6 + zr) + ph) * a2;
  pos.y += cos(u_time*(0.5 + zr*0.8) + ph*1.3) * a2;
  pos.z += sin(u_time*0.7 + ph*2.0) * a2 * 0.8;
  pos -= u_pan;                                  // 확대할 지점을 화면 중심으로
  float x1 = pos.x*u_cam.x + pos.z*u_cam.y;
  float z1 = -pos.x*u_cam.y + pos.z*u_cam.x;
  float y2 = pos.y*u_cam.z - z1*u_cam.w;
  float z2 = pos.y*u_cam.w + z1*u_cam.z;
  float den = F + z2;
  float l = a_misc.x;
  float typ = floor(a_misc.w / 256.0 + 0.001);   // 1 = 윤곽선 점
  float seg = a_misc.w - typ*256.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_a = 0.0; v_pass = u_pass; v_soft = 0.0; v_chan = u_chan;
  v_col = clamp(vec3(1.0) + (u_color*u_sat)*(a_col - vec3(1.0)), 0.0, 1.0);   // 그림의 색(색상/채도)을 점에 입힌다
  if (den < 200.0) return;
  float f = F / den;
  vec2 s = vec2(x1, y2) * f * u_zoom;
  if (u_mpow > 0.001) {                       // 커서 주변 점이 밀려난다
    vec2 dm = s - u_mouse; float dist = length(dm);
    float k = u_mpow * pow(max(0.0, 1.0 - dist / 110.0), 2.0);
    s += dm / max(dist, 1.0) * k * 46.0;
  }
  if (u_chan > 0.5) s.x += (u_chan - 2.0) * u_split * (2.0 + 6.0*abs(z2)/450.0);   // 깊이에 따라 R/G/B를 어긋나게 (색수차)
  float pf = f * u_zoom;
  float fade = clamp(0.8 + (f - 1.0)*1.6, 0.2, 1.1);
  float defocus = u_dof * clamp(abs(z2) / 450.0, 0.0, 1.0);   // 초점면(그림 평면)에서 멀수록 흐림
  if (u_pass < 0.5) {
    float r = (0.45 + 0.85*l) * u_size * pf * (1.0 + defocus*1.1);
    gl_Position = vec4(s.x / u_half.x, -s.y / u_half.y, 0.0, 1.0);
    gl_PointSize = max(2.0, 2.0*r*u_dpr + 1.5);
    v_a = min(1.0, (0.35 + 0.65*l) * fade) * a_misc.y * (1.0 - 0.38*defocus);
    v_soft = defocus;
  } else {
    bool ok = u_form > 0.5 ? l >= 0.5 : f >= 1.05;
    if (!ok || u_glow < 0.01) return;
    float r = (3.2 + 5.0*l) * u_size * pf;
    gl_Position = vec4(s.x / u_half.x, -s.y / u_half.y, 0.0, 1.0);
    gl_PointSize = 2.0 * r * u_dpr;
    v_a = u_glow * (u_form > 0.5 ? 0.25 + 0.5*l : 0.22) * fade * a_misc.y * clamp(1.6 / u_zoom, 0.2, 1.0);   // 확대하면 번짐을 줄여 세부가 보이게
  }
  if (typ > 0.5) v_a *= u_line;                  // 윤곽선 점은 슬라이더로 세기 조절
  if (u_lineview > 0.5) {                        // 선 분석 보기: 추출한 선만 또렷하게
    if (typ > 0.5) { v_a = (u_pass < 0.5 ? 0.95 : 0.35*u_glow) * a_misc.y; if (u_pass < 0.5) gl_PointSize *= 1.2; }
    else v_a *= 0.08;
  }
  if (u_sel >= 0.0 && u_selpow > 0.001) {      // 선택한 구성요소만 또렷하게, 나머지는 흐리게
    float isSel = abs(seg - u_sel) < 0.5 ? 1.0 : 0.0;
    v_a *= mix(1.0, mix(0.1, 1.35, isSel), u_selpow);
    if (u_pass < 0.5) gl_PointSize *= mix(1.0, mix(0.85, 1.25, isSel), u_selpow);
  }
}`;
const FS = `
precision mediump float;
varying float v_a; varying float v_pass; varying float v_soft; varying vec3 v_col; varying float v_chan;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a;
  if (v_pass < 0.5) a = 1.0 - smoothstep(0.6 - 0.45*v_soft, 1.0, d);
  else { float t = 1.0 - d; a = 0.55 * t * t; }
  a *= v_a;
  vec3 col = v_col;
  if (v_chan > 0.5) { col *= vec3(v_chan < 1.5 ? 1.0 : 0.0, (v_chan > 1.5 && v_chan < 2.5) ? 1.0 : 0.0, v_chan > 2.5 ? 1.0 : 0.0); a *= 0.75; }
  gl_FragColor = vec4(col*a, a);   // premultiplied
}`;

let gl = null, GLP = null, GLU = {}, GLB = {};
function initGL() {
  gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
  if (!gl) { statusEl.textContent = '오류: 이 브라우저는 WebGL을 지원하지 않아요'; return false; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  GLP = gl.createProgram();
  gl.attachShader(GLP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(GLP, sh(gl.FRAGMENT_SHADER, FS));
  ['a_from', 'a_to', 'a_anim', 'a_misc', 'a_col'].forEach((n, i) => gl.bindAttribLocation(GLP, i, n));
  gl.linkProgram(GLP);
  if (!gl.getProgramParameter(GLP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(GLP));
  ['u_time','u_form','u_pass','u_size','u_glow','u_zoom','u_dpr','u_dof','u_mpow','u_sel','u_selpow','u_line','u_lineview','u_color','u_sat','u_chan','u_split','u_pan','u_half','u_mouse','u_cam'].forEach(n => GLU[n] = gl.getUniformLocation(GLP, n));
  ['from','to','anim','misc','col'].forEach(k => GLB[k] = gl.createBuffer());
  gl.enable(gl.BLEND);
  return true;
}
function uploadStatic() {
  if (!gl) return;
  const n = S.n, m = new Float32Array(n*4);
  for (let i=0;i<n;i++) { m[4*i] = S.lum[i]; m[4*i+1] = S.sa[i]; m[4*i+2] = S.z[i]; m[4*i+3] = S.sg[i]; }
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.misc); gl.bufferData(gl.ARRAY_BUFFER, m, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.col); gl.bufferData(gl.ARRAY_BUFFER, S.col, gl.STATIC_DRAW);
}
function uploadMotion() {
  if (!gl) return;
  const n = S.n, form = S.mode === 'form';
  const f = new Float32Array(n*3), t = new Float32Array(n*3), a = new Float32Array(n*4);
  let end = 0;
  for (let i=0;i<n;i++) {
    f[3*i] = S.fx[i]; f[3*i+1] = S.fy[i]; f[3*i+2] = S.fz[i];
    if (form) { t[3*i] = S.tx[i]; t[3*i+1] = S.ty[i]; t[3*i+2] = S.tz[i]; }
    else { t[3*i] = S.sx[i]; t[3*i+1] = S.sy[i]; t[3*i+2] = S.sz[i]; }
    a[4*i] = S.t0[i] / 1000; a[4*i+1] = S.dur[i] / 1000; a[4*i+2] = S.swirl[i]; a[4*i+3] = S.phase[i];
    const e = S.t0[i] + S.dur[i]; if (e > end) end = e;
  }
  S.endTime = end; S.dirty = true;
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.from); gl.bufferData(gl.ARRAY_BUFFER, f, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.to);   gl.bufferData(gl.ARRAY_BUFFER, t, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.anim); gl.bufferData(gl.ARRAY_BUFFER, a, gl.DYNAMIC_DRAW);
}

// CPU에서 현재 위치가 필요할 때 GPU 셰이더와 같은 수식으로 계산
function snapshot(now) {
  const time = now / 1000, form = S.mode === 'form';
  for (let i=0;i<S.n;i++) {
    const p = clamp((now - S.t0[i]) / S.dur[i], 0, 1), e = ease(p);
    const toX = form ? S.tx[i] : S.sx[i], toY = form ? S.ty[i] : S.sy[i], toZ = form ? S.tz[i] : S.sz[i];
    let x = S.fx[i] + (toX - S.fx[i]) * e, y = S.fy[i] + (toY - S.fy[i]) * e, z = S.fz[i] + (toZ - S.fz[i]) * e;
    const dx = toX - S.fx[i], dy = toY - S.fy[i], len = Math.max(Math.hypot(dx, dy), 0.001);
    const sw = Math.sin(Math.PI * e) * Math.min(120, len * 0.22) * S.swirl[i];
    x += (-dy / len) * sw; y += (dx / len) * sw;
    const zr = S.z[i], ph = S.phase[i], a2 = (form ? 0.55 : 6 + 14*zr) * e;
    x += Math.sin(time*(0.6 + zr) + ph) * a2;
    y += Math.cos(time*(0.5 + zr*0.8) + ph*1.3) * a2;
    z += Math.sin(time*0.7 + ph*2) * a2 * 0.8;
    S.rx[i] = x; S.ry[i] = y; S.rz[i] = z;
  }
}

// =====================================================================
//  이미지 -> 밝기/깊이 분석
// =====================================================================
function grayFromImage(img) {
  const LONG = 900;
  const k = LONG / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w*h);
  let sum = 0;
  for (let i=0;i<w*h;i++) { lum[i] = (0.2126*data[i*4] + 0.7152*data[i*4+1] + 0.0722*data[i*4+2]) / 255; sum += lum[i]; }
  if (sum < 1e-3) throw new Error('이 브라우저가 이미지 픽셀 읽기를 막고 있어요');
  const ck = Math.min(1, 280/Math.max(w, h)), cw = Math.max(4, Math.round(w*ck)), ch = Math.max(4, Math.round(h*ck));
  const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
  const g2 = c2.getContext('2d', { willReadFrequently: true }); g2.imageSmoothingQuality = 'high'; g2.drawImage(c, 0, 0, cw, ch);
  const px = g2.getImageData(0, 0, cw, ch).data, rgb = new Uint8Array(cw*ch*3);
  for (let i=0;i<cw*ch;i++) { rgb[3*i] = px[4*i]; rgb[3*i+1] = px[4*i+1]; rgb[3*i+2] = px[4*i+2]; }
  return { w, h, lum, rgb: { w: cw, h: ch, data: rgb } };
}
function bytesToGray(bytes, w, h) {
  const lum = new Float32Array(w*h);
  for (let i=0;i<lum.length;i++) lum[i] = bytes[i] / 255;
  return { w, h, lum };
}
async function inflateB64(b64) {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않아요');
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function ensureGray(i) {
  const a = ART[i];
  if (a.gray) return a.gray;
  const m = a.meta;
  const [g, d] = await Promise.all([inflateB64(m.gray), inflateB64(m.depth)]);
  a.gray = bytesToGray(g, m.w, m.h);
  const dm = bytesToGray(d, m.dw || m.w, m.dh || m.h);
  a.gray.depth = (dm.w === m.w && dm.h === m.h) ? dm.lum : resizeBilinear(dm.lum, dm.w, dm.h, m.w, m.h);
  if (m.rgb) a.gray.rgb = { w: m.rw, h: m.rh, data: await inflateB64(m.rgb) };
  if (m.seg) {
    const ids = await inflateB64(m.seg.ids);
    const sw0 = m.seg.w || m.w, sh0 = m.seg.h || m.h;
    a.seg = { w: sw0, h: sh0, ids, segs: m.seg.segs, context: m.seg.context || '' };
    a.gray.segIds = (sw0 === m.w && sh0 === m.h) ? ids : resizeIdsNearest(ids, sw0, sh0, m.w, m.h);
  }
  return a.gray;
}
function rotateGray(g, rot) {
  let { w, h, lum } = g;
  for (let r=0; r<rot; r++) { // 90도 시계방향
    const out = new Float32Array(w*h);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) out[x*h + (h-1-y)] = lum[y*w+x];
    lum = out; const t = w; w = h; h = t;
  }
  return { w, h, lum };
}
function resizeBilinear(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw*dh);
  for (let y=0;y<dh;y++) {
    const fy = Math.min(sh-1, Math.max(0, (y+0.5)*sh/dh - 0.5)), y0 = fy|0, y1 = Math.min(sh-1, y0+1), ty = fy - y0;
    for (let x=0;x<dw;x++) {
      const fx = Math.min(sw-1, Math.max(0, (x+0.5)*sw/dw - 0.5)), x0 = fx|0, x1 = Math.min(sw-1, x0+1), tx = fx - x0;
      const a = src[y0*sw+x0]*(1-tx) + src[y0*sw+x1]*tx, b = src[y1*sw+x0]*(1-tx) + src[y1*sw+x1]*tx;
      out[y*dw+x] = a*(1-ty) + b*ty;
    }
  }
  return out;
}
function resizeIdsNearest(ids, sw, sh, dw, dh) {
  const out = new Uint8Array(dw*dh);
  for (let y=0;y<dh;y++) { const sy = Math.min(sh-1, Math.floor((y+0.5)*sh/dh)); for (let x=0;x<dw;x++) out[y*dw+x] = ids[sy*sw + Math.min(sw-1, Math.floor((x+0.5)*sw/dw))]; }
  return out;
}
// Zhang-Suen 세선화: 두꺼운 선을 1픽셀 뼈대로
function thinSkeleton(bin, w, h) {
  const rm = [];
  let changed = true, guard = 0;
  while (changed && guard++ < 40) {
    changed = false;
    for (let step=0; step<2; step++) {
      rm.length = 0;
      for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
        const i = y*w + x; if (!bin[i]) continue;
        const p2 = bin[i-w], p3 = bin[i-w+1], p4 = bin[i+1], p5 = bin[i+w+1], p6 = bin[i+w], p7 = bin[i+w-1], p8 = bin[i-1], p9 = bin[i-w-1];
        const B = p2+p3+p4+p5+p6+p7+p8+p9; if (B < 2 || B > 6) continue;
        const A = (p2===0&&p3===1?1:0) + (p3===0&&p4===1?1:0) + (p4===0&&p5===1?1:0) + (p5===0&&p6===1?1:0) + (p6===0&&p7===1?1:0) + (p7===0&&p8===1?1:0) + (p8===0&&p9===1?1:0) + (p9===0&&p2===1?1:0);
        if (A !== 1) continue;
        if (step === 0) { if (p2*p4*p6 !== 0 || p4*p6*p8 !== 0) continue; }
        else { if (p2*p4*p8 !== 0 || p2*p6*p8 !== 0) continue; }
        rm.push(i);
      }
      if (rm.length) { changed = true; for (let k=0;k<rm.length;k++) bin[rm[k]] = 0; }
    }
  }
}
// 선 분석: 다중 스케일 '어두운 가는 선' 응답 + 경계 응답 -> 히스테리시스 -> 세선화 -> 짧은 조각 제거
function extractLines(lum, w, h) {
  const n = w*h, R = new Float32Array(n);
  for (const s of [0.8, 1.4, 2.2]) {
    const a = gaussBlur(lum, w, h, s), b = gaussBlur(lum, w, h, s*1.8), r = new Float32Array(n);
    for (let i=0;i<n;i++) r[i] = Math.max(0, b[i] - a[i]);
    const hi = percentiles(r, 0.5, 0.995)[1], k = 1/Math.max(1e-4, hi);
    for (let i=0;i<n;i++) { const v = r[i]*k; if (v > R[i]) R[i] = v; }
  }
  const g1 = gaussBlur(lum, w, h, 1.0), mag = new Float32Array(n);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) { const i = y*w + x, gx = g1[i+1] - g1[i-1], gy = g1[i+w] - g1[i-w]; mag[i] = Math.hypot(gx, gy); }
  const mk = 0.55/Math.max(1e-4, percentiles(mag, 0.5, 0.995)[1]);
  const E = new Float32Array(n);
  for (let i=0;i<n;i++) E[i] = Math.max(R[i], mag[i]*mk);
  // 지역 대비 정규화: 얼굴처럼 전체적으로 대비가 낮은 곳의 옅은 선(눈, 코, 입)도 잡는다
  const base = gaussBlur(E, w, h, 0.03*Math.max(w, h));
  for (let i=0;i<n;i++) E[i] = Math.min(1.5, E[i] / (2*base[i] + 0.08));
  const HI = 0.6, LO = 0.3, bin = new Uint8Array(n), stack = [];
  for (let i=0;i<n;i++) if (E[i] > HI) { bin[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) { const xx = x+dx, yy = y+dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy*w + xx; if (!bin[j] && E[j] > LO) { bin[j] = 1; stack.push(j); } }
  }
  thinSkeleton(bin, w, h);
  const lab = new Uint8Array(n), keep = [], st2 = [];
  for (let i0=0;i0<n;i0++) {
    if (!bin[i0] || lab[i0]) continue;
    const comp = []; st2.length = 0; st2.push(i0); lab[i0] = 1;
    while (st2.length) {
      const i = st2.pop(); comp.push(i); const x = i % w, y = (i / w) | 0;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) { const xx = x+dx, yy = y+dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy*w + xx; if (bin[j] && !lab[j]) { lab[j] = 1; st2.push(j); } }
    }
    if (comp.length >= 10) for (let k=0;k<comp.length;k++) keep.push(comp[k]); else for (let k=0;k<comp.length;k++) bin[comp[k]] = 0;
  }
  const strength = new Float32Array(n);
  for (let k=0;k<keep.length;k++) strength[keep[k]] = Math.min(1, E[keep[k]]);
  const mask = gaussBlur(strength, w, h, 0.9);
  for (let i=0;i<n;i++) mask[i] = Math.min(1, mask[i]/0.3);
  const order = Int32Array.from(keep).sort((a, b) => strength[b] - strength[a]);
  return { w, h, strength, mask, order };
}
// 선 위에 일정 간격으로 점을 놓는다 (강한 선부터, 간격은 개수에 맞게 자동 조절)
function selectLineDots(L, cap) {
  const { w, order } = L;
  if (!order.length || cap <= 0) return [];
  let s = 1.4, res = [];
  for (let attempt=0; attempt<8; attempt++) {
    const cell = s, gw = Math.ceil(w/cell) + 2, gh = Math.ceil(L.h/cell) + 2, grid = new Int32Array(gw*gh).fill(-1);
    res = [];
    for (let k=0;k<order.length;k++) {
      const i = order[k], x = i % w, y = (i / w) | 0, cx = (x/cell)|0, cy = (y/cell)|0;
      let ok = true;
      for (let yy=cy-1; yy<=cy+1 && ok; yy++) for (let xx=cx-1; xx<=cx+1; xx++) {
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const j = grid[yy*gw + xx]; if (j < 0) continue;
        const dx = (j % w) - x, dy = ((j / w)|0) - y; if (dx*dx + dy*dy < s*s) { ok = false; break; }
      }
      if (!ok) continue;
      grid[cy*gw + cx] = i; res.push(i);
    }
    if (res.length <= cap*1.15) break;
    s *= 1.25;
  }
  return res.length > cap ? res.slice(0, cap) : res;
}
function computeDetail(lum, w, h) {   // 미세한 선/질감이 많은 곳(얼굴, 손, 옷 주름 등)
  const g = gaussBlur(lum, w, h, 1.0), m = new Float32Array(w*h);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) { const i = y*w + x; m[i] = Math.hypot(g[i+1]-g[i-1], g[i+w]-g[i-w]); }
  return normalizeRange(boxBlur(m, w, h, 3), 0.3, 0.995);
}
function computeHotspots(D, w, h, segIds, segs) {
  const cell = Math.max(8, Math.round(Math.max(w, h)/30)), cw = Math.ceil(w/cell), ch = Math.ceil(h/cell), sc = new Float32Array(cw*ch);
  for (let cy=0;cy<ch;cy++) for (let cx=0;cx<cw;cx++) {
    let s = 0, c = 0; for (let y=cy*cell; y<Math.min(h, (cy+1)*cell); y++) for (let x=cx*cell; x<Math.min(w, (cx+1)*cell); x++) { s += D[y*w+x]; c++; }
    sc[cy*cw+cx] = s/Math.max(1,c);
  }
  const sm = new Float32Array(cw*ch);
  for (let cy=0;cy<ch;cy++) for (let cx=0;cx<cw;cx++) { let s=0,c=0; for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) { const x=cx+dx,y=cy+dy; if (x<0||y<0||x>=cw||y>=ch) continue; s+=sc[y*cw+x]; c++; } sm[cy*cw+cx]=s/c; }
  const out = []; let top = 0;
  for (let k=0;k<6;k++) {
    let bi = -1, bv = 0; for (let i=0;i<sm.length;i++) if (sm[i] > bv) { bv = sm[i]; bi = i; }
    if (bi < 0 || bv < 0.12) break; if (k === 0) top = bv; if (bv < top*0.5) break;
    const cx = bi % cw, cy = (bi / cw)|0;
    const px = Math.min(w-1, ((cx+0.5)*cell)|0), py = Math.min(h-1, ((cy+0.5)*cell)|0);
    const sid = segIds ? segIds[py*w+px] : 0; let nm = '';
    if (segs) { const sg = segs.find(s => s.id === sid); nm = sg ? sg.ko : ''; }
    out.push({ cx: (cx+0.5)*cell/w, cy: (cy+0.5)*cell/h, w: Math.min(1, 3*cell/w), h: Math.min(1, 3*cell/h), score: bv, seg: nm });
    for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) { const x=cx+dx,y=cy+dy; if (x>=0&&y>=0&&x<cw&&y<ch) sm[y*cw+x]=0; }
  }
  return out;
}
function rotateRGB(src, rot) {
  let { w, h, data } = src;
  for (let r=0; r<rot; r++) {
    const out = new Uint8Array(w*h*3);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) { const a = (y*w + x)*3, b = (x*h + (h-1-y))*3; out[b] = data[a]; out[b+1] = data[a+1]; out[b+2] = data[a+2]; }
    data = out; const tt = w; w = h; h = tt;
  }
  return { w, h, data };
}
function rotateIds(ids, w, h, rot) {
  for (let r=0; r<rot; r++) {
    const out = new Uint8Array(w*h);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) out[x*h + (h-1-y)] = ids[y*w+x];
    ids = out; const tt = w; w = h; h = tt;
  }
  return { ids, w, h };
}
// 구성요소(segment)별 면적, 중심, 대표 깊이(중앙값)
function computeSegStats(map) {
  const { w, h, segIds, depth0 } = map, n = w*h;
  let maxId = 0; for (let i=0;i<n;i++) if (segIds[i] > maxId) maxId = segIds[i];
  const K = maxId + 1, hist = new Uint32Array(K*256), area = new Float64Array(K), sx = new Float64Array(K), sy = new Float64Array(K);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i = y*w + x, id = segIds[i];
    hist[id*256 + Math.min(255, (depth0[i]*255)|0)]++; area[id]++; sx[id] += x; sy[id] += y;
  }
  const st = [];
  for (let id=0; id<K; id++) {
    let med = 0.5;
    if (area[id] > 0) { let acc = 0; for (let b=0;b<256;b++) { acc += hist[id*256+b]; if (acc >= area[id]/2) { med = b/255; break; } } }
    st[id] = { id, area: area[id], frac: area[id]/n, med, cx: area[id] ? sx[id]/area[id]/w : 0.5, cy: area[id] ? sy[id]/area[id]/h : 0.5 };
  }
  map.segStat = st;
  let acc = 0; for (let i=0;i<n;i++) acc += depth0[i]; map.gmed = acc / n;
}
function boxBlur(src, w, h, r) {   // 슬라이딩 윈도우: 반경과 무관하게 O(N)
  const tmp = new Float32Array(w*h), out = new Float32Array(w*h);
  for (let y=0;y<h;y++) {
    const row = y*w; let sum = 0, cnt = 0;
    for (let x=0;x<=r && x<w;x++) { sum += src[row+x]; cnt++; }
    for (let x=0;x<w;x++) {
      tmp[row+x] = sum / cnt;
      const a = x + r + 1, b = x - r;
      if (a < w) { sum += src[row+a]; cnt++; }
      if (b >= 0) { sum -= src[row+b]; cnt--; }
    }
  }
  for (let x=0;x<w;x++) {
    let sum = 0, cnt = 0;
    for (let y=0;y<=r && y<h;y++) { sum += tmp[y*w+x]; cnt++; }
    for (let y=0;y<h;y++) {
      out[y*w+x] = sum / cnt;
      const a = y + r + 1, b = y - r;
      if (a < h) { sum += tmp[a*w+x]; cnt++; }
      if (b >= 0) { sum -= tmp[b*w+x]; cnt--; }
    }
  }
  return out;
}
function gaussBlur(src, w, h, sigma) {   // 상자 흐림 3번 = 가우시안 근사
  if (sigma < 0.5) return Float32Array.from(src);
  const n = 3, wIdeal = Math.sqrt(12*sigma*sigma/n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12*sigma*sigma - n*wl*wl - 4*n*wl - 3*n) / (-4*wl - 4));
  let out = src;
  for (let i=0;i<n;i++) out = boxBlur(out, w, h, ((i < m ? wl : wu) - 1) / 2);
  return out;
}
function guidedFilter(I, p, w, h, r, eps) {   // 가이드 필터: 그림의 경계를 따라 깊이 경계를 정렬
  const N = w*h, Ip = new Float32Array(N), II = new Float32Array(N);
  for (let i=0;i<N;i++) { Ip[i] = I[i]*p[i]; II[i] = I[i]*I[i]; }
  const mI = boxBlur(I, w, h, r), mP = boxBlur(p, w, h, r), cIp = boxBlur(Ip, w, h, r), cII = boxBlur(II, w, h, r);
  const a = new Float32Array(N), b = new Float32Array(N);
  for (let i=0;i<N;i++) { const v = cII[i] - mI[i]*mI[i], c = cIp[i] - mI[i]*mP[i]; a[i] = c / (v + eps); b[i] = mP[i] - a[i]*mI[i]; }
  const mA = boxBlur(a, w, h, r), mB = boxBlur(b, w, h, r), q = new Float32Array(N);
  for (let i=0;i<N;i++) q[i] = mA[i]*I[i] + mB[i];
  return q;
}
function percentiles(arr, lo, hi) {   // 정렬 대신 히스토그램: O(N)
  let mn = Infinity, mx = -Infinity;
  for (let i=0;i<arr.length;i++) { const v = arr[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const B = 2048, sc = (B-1) / Math.max(1e-6, mx - mn), hist = new Uint32Array(B);
  for (let i=0;i<arr.length;i++) hist[((arr[i]-mn)*sc) | 0]++;
  const at = q => { let acc = 0; const t = q*arr.length; for (let b=0;b<B;b++) { acc += hist[b]; if (acc >= t) return mn + b/sc; } return mx; };
  return [at(lo), at(hi)];
}
function normalizeRange(arr, lo, hi) {
  const [a0, a1] = percentiles(arr, lo, hi), sp = Math.max(0.05, a1 - a0), out = new Float32Array(arr.length);
  for (let i=0;i<arr.length;i++) out[i] = clamp((arr[i] - a0) / sp, 0, 1);
  return out;
}
function analyzeImage(gray, rotation, p) {
  const rot = ((rotation % 4) + 4) % 4;
  const { w, h, lum: src } = rotateGray(gray, rot);
  const lum = new Float32Array(src);
  const blur = boxBlur(lum, w, h, 1);
  for (let i=0;i<w*h;i++) lum[i] = clamp(lum[i] + 0.9*(lum[i] - blur[i]), 0, 1);
  if (p.localContrast > 0) {   // 지역 대비: 얼굴처럼 전체가 밝은 곳 안의 미세한 명암(눈, 코, 입, 볼)을 끌어올린다
    const lg = gaussBlur(lum, w, h, 0.03*Math.max(w, h));
    for (let i=0;i<w*h;i++) lum[i] = clamp(lum[i] + p.localContrast*1.3*(lum[i] - lg[i]), 0, 1);
  }
  const lv = normalizeRange(lum, 0.02, 0.98);
  if (p.invertTone) for (let i=0;i<w*h;i++) lv[i] = 1 - lv[i];
  const out = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) out[i] = Math.pow(clamp((lv[i] - 0.5)*p.contrast + 0.5, 0, 1), p.gamma);
  // 선 분석과 디테일 지도 (원본 명암 기준, 회전별로 캐시)
  gray._an = gray._an || {};
  const akey = 'r' + rot;
  if (!gray._an[akey]) {
    const lines = extractLines(src, w, h), d0 = computeDetail(src, w, h);
    const dl = normalizeRange(gaussBlur(lines.strength, w, h, 3.0), 0.5, 0.995), detail = new Float32Array(w*h);
    for (let i=0;i<w*h;i++) detail[i] = Math.max(d0[i], 0.9*dl[i]);      // 기울기 + 선 밀도: 옅은 선이 모인 곳도 디테일로
    gray._an[akey] = { lines, detail };
  }
  const an = gray._an[akey];
  if (p.lineTone > 0) {   // 선이 점 밀도에서도 또렷하게: 어두운 선은 파고, 반전 모드에서는 밝게 돋운다
    const sg = p.invertTone ? 1 : -1, kk = p.lineTone*0.85, M = an.lines.mask;
    for (let i=0;i<w*h;i++) out[i] = clamp(out[i] + sg*kk*M[i], 0, 1);
  }
  let d0;
  if (gray.depth) {
    d0 = normalizeRange(rotateGray({ w: gray.w, h: gray.h, lum: gray.depth }, rot).lum, 0.01, 0.99);
    // 모델 깊이의 경계를 그림 자체의 경계에 맞춘다 (경계가 번져 보이는 문제 완화)
    d0 = normalizeRange(guidedFilter(out, d0, w, h, Math.max(2, Math.round(0.007*Math.max(w, h))), 0.004), 0.003, 0.997);
  } else {
    const big = boxBlur(out, w, h, 12), small = boxBlur(out, w, h, 3), dr = new Float32Array(w*h);
    for (let i=0;i<w*h;i++) dr[i] = 0.7*big[i] + 0.3*small[i];
    d0 = normalizeRange(dr, 0.02, 0.98);
  }
  const dens = new Float32Array(w*h), dk = p.detail;
  for (let i=0;i<w*h;i++) dens[i] = densityOf(out[i])*(1 + dk*an.detail[i]);   // 디테일이 많은 곳에 점을 더 몰아준다
  const map = { rgb: gray.rgb ? rotateRGB(gray.rgb, rot) : null, w, h, lum: out, dens, detail: an.detail, lines: an.lines, depth0: d0, depthReal: !!gray.depth, bands: null, segIds: null, segStat: null, gmed: 0.5 };
  if (gray.segIds) { map.segIds = rotateIds(gray.segIds, gray.w, gray.h, rot).ids; computeSegStats(map); }
  map.depth = composeDepth(map, p);
  return map;
}
// 깊이 = 모델 깊이 + 그림 자체의 단서(명암 -> 높이, 필치 -> 미세 부조)
// 사진으로 학습된 모델은 수묵화/풍속화를 거의 평평한 경사면으로 보기 때문에 그림의 명암과 필치를 보조 단서로 쓴다
function composeDepth(map, p) {
  const { w, h, lum, depth0 } = map, n = w*h, L = Math.max(w, h);
  if (!map.bands) {
    const s1 = gaussBlur(lum, w, h, 1.2), s2 = gaussBlur(lum, w, h, 3), s3 = gaussBlur(lum, w, h, 8), s4 = gaussBlur(lum, w, h, 0.04*L);
    const R = new Float32Array(n);
    for (let i=0;i<n;i++) R[i] = 0.45*(s1[i]-s2[i]) + 0.35*(s2[i]-s3[i]) + 0.2*(s3[i]-s4[i]);   // 다중 스케일 DoG
    const [r0, r1] = percentiles(R, 0.01, 0.99), sc = Math.max(1e-4, Math.max(Math.abs(r0), Math.abs(r1)));
    for (let i=0;i<n;i++) R[i] = clamp(R[i]/sc, -1, 1);
    map.bands = { R, T: normalizeRange(gaussBlur(lum, w, h, 0.012*L), 0.01, 0.99) };
  }
  const out = new Float32Array(n), tw = clamp(p.tone, 0, 1)*0.6, rw = p.relief*0.18, T = map.bands.T, R = map.bands.R;
  const ids = map.segIds, st = map.segStat, u = ids ? clamp(p.unify, 0, 1)*0.8 : 0, sp = ids ? p.sep*0.4 : 0;
  for (let i=0;i<n;i++) {
    let d = depth0[i];
    if (ids && ids[i]) {
      const m = st[ids[i]].med;
      d += (m - d)*u;                    // 같은 피사체는 하나의 덩어리로 (모델의 노이즈 억제)
      d += (m - map.gmed)*sp;            // 피사체 사이 간격을 벌려 층을 분리
    }
    out[i] = clamp(d*(1-tw) + T[i]*tw + rw*R[i], 0, 1);
  }
  return out;
}

// ---------- 밝기 가중 점 찍기 ----------
const densityOf = l => l*l*0.6 + l*0.4;
function stipple(map, N) {
  const { w, h, lum } = map;
  const dens = map.dens || (() => { const a = new Float32Array(w*h); for (let i=0;i<w*h;i++) a[i] = densityOf(lum[i]); return a; })();
  let sum = 0, mx = 0;
  for (let i=0;i<w*h;i++) { const d = dens[i]; sum += d; if (d > mx) mx = d; }
  if (sum < 1e-6) return { x:[], y:[], l:[], d:[], w, h, rb: 1 };
  const cdf = new Float64Array(w*h); let acc = 0;
  for (let i=0;i<w*h;i++) { acc += dens[i]; cdf[i] = acc; }
  const mean = sum / (w*h);
  const pick = () => {
    const r = Math.random()*acc; let lo = 0, hi = cdf.length-1;
    while (lo < hi) { const m = (lo+hi) >> 1; if (cdf[m] < r) lo = m+1; else hi = m; }
    return lo;
  };
  let rBase = 0.62 * Math.sqrt((w*h) / N), best = null;
  for (let attempt=0; attempt<7; attempt++) {
    const rMin = rBase / Math.sqrt(Math.max(1, mx/mean));
    const cell = Math.max(0.5, rMin / Math.SQRT2);
    const gw = Math.ceil(w/cell) + 1, gh = Math.ceil(h/cell) + 1;
    const grid = new Int32Array(gw*gh).fill(-1);
    const xs = [], ys = [];
    const maxTries = N*18;
    for (let t=0; t<maxTries && xs.length<N; t++) {
      const idx = pick();
      const px = (idx % w) + Math.random(), py = Math.floor(idx / w) + Math.random();
      const d = dens[idx];
      const rLoc = Math.min(rBase*3.5, rBase / Math.sqrt(Math.max(0.05, d/mean)));
      const cx = Math.floor(px/cell), cy = Math.floor(py/cell), rc = Math.ceil(rLoc/cell);
      let ok = true;
      for (let yy=Math.max(0,cy-rc); yy<=Math.min(gh-1,cy+rc) && ok; yy++)
        for (let xx=Math.max(0,cx-rc); xx<=Math.min(gw-1,cx+rc); xx++) {
          const j = grid[yy*gw+xx]; if (j < 0) continue;
          const dx = xs[j]-px, dy = ys[j]-py;
          if (dx*dx + dy*dy < rLoc*rLoc) { ok = false; break; }
        }
      if (!ok) continue;
      grid[cy*gw+cx] = xs.length;
      xs.push(px); ys.push(py);
    }
    best = { x: xs, y: ys };
    if (xs.length >= N*0.95) break;
    rBase *= 0.82;
  }
  const n = best.x.length, pts = { x: new Array(n), y: new Array(n), l: new Array(n), d: new Array(n), w, h, rb: rBase };
  for (let i=0;i<n;i++) {
    pts.x[i] = best.x[i]/w; pts.y[i] = best.y[i]/h;
    const ix = Math.min(w-1, best.x[i]|0), iy = Math.min(h-1, best.y[i]|0);
    pts.l[i] = lum[iy*w+ix]; pts.d[i] = map.depth[iy*w+ix];
  }
  return pts;
}

// ---------- Lloyd 완화: 밝기 가중 Voronoi 무게중심으로 점을 이동시켜 고르게 퍼뜨림 ----------
function relax(pts, map, iters) {
  const W0 = map.w, H0 = map.h, n = pts.x.length;
  if (!n || iters <= 0) return;
  const f = (W0*H0 > 350000) ? 2 : 1, w = Math.floor(W0/f), h = Math.floor(H0/f);   // 큰 이미지는 절반 해상도에서 완화
  const dens = new Float32Array(w*h); let sum = 0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    let a = 0;
    for (let dy=0;dy<f;dy++) for (let dx=0;dx<f;dx++) { const i = (y*f+dy)*W0 + x*f + dx; a += map.dens ? map.dens[i] : densityOf(map.lum[i]); }
    dens[y*w+x] = a/(f*f); sum += dens[y*w+x];
  }
  const dmin = (sum / (w*h)) * 0.04;
  const X = new Float32Array(n), Y = new Float32Array(n);
  for (let i=0;i<n;i++) { X[i] = pts.x[i]*w; Y[i] = pts.y[i]*h; }
  const cell = Math.max(2, Math.ceil(pts.rb/f));
  const gw = Math.ceil(w/cell), gh = Math.ceil(h/cell);
  for (let it=0; it<iters; it++) {
    const head = new Int32Array(gw*gh).fill(-1), next = new Int32Array(n);
    for (let i=0;i<n;i++) {
      const c = Math.min(gh-1, Math.max(0, (Y[i]/cell)|0))*gw + Math.min(gw-1, Math.max(0, (X[i]/cell)|0));
      next[i] = head[c]; head[c] = i;
    }
    const sx = new Float64Array(n), sy = new Float64Array(n), sw = new Float64Array(n);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const d = dens[y*w+x]; if (d < dmin) continue;
      const px = x + 0.5, py = y + 0.5, cx = (px/cell)|0, cy = (py/cell)|0;
      let best = -1, bd = Infinity;
      for (let k=0;k<=10;k++) {
        for (let yy=cy-k; yy<=cy+k; yy++) {
          if (yy < 0 || yy >= gh) continue;
          const edgeRow = (yy === cy-k || yy === cy+k);
          for (let xx=cx-k; xx<=cx+k; xx += (edgeRow ? 1 : 2*k || 1)) {
            if (xx < 0 || xx >= gw) continue;
            for (let j=head[yy*gw+xx]; j>=0; j=next[j]) {
              const dx = X[j]-px, dy = Y[j]-py, d2 = dx*dx + dy*dy;
              if (d2 < bd) { bd = d2; best = j; }
            }
          }
        }
        if (best >= 0 && bd <= (k*cell)*(k*cell)) break;
      }
      if (best >= 0) { sx[best] += px*d; sy[best] += py*d; sw[best] += d; }
    }
    for (let i=0;i<n;i++) if (sw[i] > 0) { X[i] = sx[i]/sw[i]; Y[i] = sy[i]/sw[i]; }
  }
  for (let i=0;i<n;i++) {
    const x = clamp(X[i], 0, w - 0.001), y = clamp(Y[i], 0, h - 0.001);
    pts.x[i] = x/w; pts.y[i] = y/h;
    const k = Math.min(H0-1, (pts.y[i]*H0)|0)*W0 + Math.min(W0-1, (pts.x[i]*W0)|0); pts.l[i] = map.lum[k]; pts.d[i] = map.depth[k];
  }
}

// ---------- 레이아웃 (월드 좌표는 스테이지 중심 기준) ----------
function imageBox() {
  // 원근 때문에 앞으로 튀어나온 부분이 화면 밖으로 넘치지 않도록 그림 틀을 미리 줄여 둔다
  let maxW = W*S.boxFrac, maxH = H*0.9;
  if (!S.flat) { const a0 = Math.min(maxW, maxH), pf = 1500 / (1500 - 0.5 * S.params.depth * a0 * 0.6 * 0.8); maxW /= pf; maxH /= pf; }
  let bw = maxW, bh = bw / S.aspect;
  if (bh > maxH) { bh = maxH; bw = bh * S.aspect; }
  return { x: (W-bw)/2, y: (H-bh)/2, w: bw, h: bh };
}
function drawDepthMap(depth, w, h) {
  const c = document.getElementById('dmap'); if (!c) return;
  const k = 120 / Math.max(w, h);
  c.width = Math.max(1, Math.round(w*k)); c.height = Math.max(1, Math.round(h*k));
  const g = c.getContext('2d'), id = g.createImageData(c.width, c.height);
  for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
    const v = Math.round(255 * depth[Math.min(h-1, Math.floor(y/k))*w + Math.min(w-1, Math.floor(x/k))]);
    const o = (y*c.width + x)*4; id.data[o] = id.data[o+1] = id.data[o+2] = v; id.data[o+3] = 255;
  }
  g.putImageData(id, 0, 0);
}
function mapTargets() {
  const b = imageBox();
  const amp = S.params.depth * Math.min(b.w, b.h) * 0.6 * (S.invert ? -1 : 1) * (S.flat ? 0 : 1);
  for (let i=0;i<S.n;i++) {
    S.tx[i] = (S.nx[i]-0.5) * b.w;
    S.ty[i] = (S.ny[i]-0.5) * b.h;
    S.tz[i] = -(S.dep[i]-0.5) * amp;
  }
}
function randomScatter(i) {
  S.sx[i] = (Math.random()-0.5) * W * 1.25;
  S.sy[i] = (Math.random()-0.5) * H * 1.25;
  S.sz[i] = (Math.random()-0.5) * 1300;
}
function retargetDepth() {
  if (!S.n) return;
  mapTargets();
  if (S.mode === 'form') {
    const now = performance.now(); snapshot(now);
    for (let i=0;i<S.n;i++) { S.fx[i]=S.rx[i]; S.fy[i]=S.ry[i]; S.fz[i]=S.rz[i]; S.t0[i]=now; S.dur[i]=650; }
    uploadMotion();
  }
}

// ---------- 빈틈 채우기: 깊이 차이가 큰 곳에 보간 점 (밝기는 앞/뒤 점 사이를 섞음) ----------
function buildSkirts(map, pts, cap) {
  const out = { x: [], y: [], l: [], d: [], p: [] };
  const fill = S.params.fill;
  if (fill <= 0.01 || cap <= 0) return out;
  const { w, h, depth, lum } = map;
  const b = imageBox();
  const scale = b.w / w, amp = S.params.depth * Math.min(b.w, b.h) * 0.6;
  const sp = Math.max(1, pts.rb * 0.8), spW = sp * scale, r = Math.max(1, Math.round(sp));
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  const nb = pts.x.length;
  const cand = []; let total = 0;
  for (let i=0;i<nb;i++) {
    const ix = Math.min(w-1, Math.floor(pts.x[i]*w)), iy = Math.min(h-1, Math.floor(pts.y[i]*h));
    const dA = depth[iy*w+ix];
    let dMin = dA, bx = 0, by = 0, bl = 0;
    for (const [dx,dy] of dirs) {
      const x2 = ix + dx*r, y2 = iy + dy*r;
      if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
      const dv = depth[y2*w+x2];
      if (dv < dMin) { dMin = dv; bx = dx*r; by = dy*r; bl = lum[y2*w+x2]; }
    }
    if (dMin >= dA - 0.01) continue;
    const dz = (dA - dMin) * amp;
    const len = Math.hypot(Math.hypot(bx,by)*scale, dz);
    const k = Math.min(10, Math.floor(len / spW * fill) - 1);
    if (k <= 0) continue;
    cand.push(i, k, bx, by, dA, dMin, bl); total += k;
  }
  const keep = total > cap ? cap/total : 1;
  for (let c=0;c<cand.length;c+=7) {
    const i = cand[c], k = cand[c+1], bx = cand[c+2], by = cand[c+3], dA = cand[c+4], dB = cand[c+5], bl = cand[c+6];
    for (let j=1;j<=k;j++) {
      if (keep < 1 && Math.random() > keep) continue;
      if (out.x.length >= cap) return out;
      const t = j/(k+1);
      out.x.push((pts.x[i]*w + bx*t + (Math.random()-0.5)*0.6) / w);
      out.y.push((pts.y[i]*h + by*t + (Math.random()-0.5)*0.6) / h);
      out.l.push(pts.l[i]*(1-t) + bl*t);
      out.d.push(dA + (dB-dA)*t);
      out.p.push(i);
    }
  }
  return out;
}

// =====================================================================
//  목표 점 집합 (작품 / 제목 글자) 만들기
// =====================================================================
function computeArtwork(i, reuse) {
  const a = ART[i];
  if (reuse && a.cache) return a.cache;
  const map = analyzeImage(a.gray, a.rotation, S.params);
  const pts = stipple(map, S.params.count);
  relax(pts, map, 3);
  pts.s = new Array(pts.x.length);
  for (let i=0;i<pts.x.length;i++) pts.s[i] = map.segIds ? map.segIds[Math.min(map.h-1, (pts.y[i]*map.h)|0)*map.w + Math.min(map.w-1, (pts.x[i]*map.w)|0)] : 0;
  const hot = computeHotspots(map.detail, map.w, map.h, map.segIds, a.seg ? a.seg.segs : null);
  a.cache = { map, pts, hot };
  return a.cache;
}
// 항상 같은 개수(N+K)로 맞춰서 작품 사이를 1:1로 변형(morph)할 수 있게 한다
function makeArtworkSet(i) {
  const { map, pts } = ART[i].cache;
  const N = S.params.count, K = Math.round(N * 0.12), Lc = Math.round(N * 0.25), n = N + K + Lc;
  const m = pts.x.length, w = map.w, h = map.h;
  const set = { n, nx: new Float32Array(n), ny: new Float32Array(n), lum: new Float32Array(n), dep: new Float32Array(n), sa: new Float32Array(n), sg: new Float32Array(n),
                aspect: w / h, boxFrac: 0.88, nSkirt: 0, nBase: N, nLine: 0, flat: false };
  const put = (o, x, y, l, d, s, g) => { set.nx[o] = x; set.ny[o] = y; set.lum[o] = l; set.dep[o] = d; set.sa[o] = s; set.sg[o] = g || 0; };
  for (let o=0;o<N;o++) {
    if (o < m) put(o, pts.x[o], pts.y[o], pts.l[o], pts.d[o], 1, pts.s[o]);
    else { const s = (Math.random()*m)|0; put(o, clamp(pts.x[s] + (Math.random()-0.5)*0.4/w, 0, 1), clamp(pts.y[s] + (Math.random()-0.5)*0.4/h, 0, 1), pts.l[s], pts.d[s], 1, pts.s[s]); }
  }
  const sk = buildSkirts(map, pts, K);
  set.nSkirt = sk.x.length;
  for (let j=0;j<K;j++) {
    const o = N + j;
    if (j < sk.x.length) put(o, sk.x[j], sk.y[j], sk.l[j], sk.d[j], 0.6, pts.s[sk.p[j]]);
    else if (sk.x.length) { const s = (Math.random()*sk.x.length)|0; put(o, sk.x[s], sk.y[s], sk.l[s], sk.d[s], 0.6, pts.s[sk.p[s]]); }
    else { const s = (Math.random()*m)|0; put(o, pts.x[s], pts.y[s], pts.l[s], pts.d[s], 1, pts.s[s]); }
  }
  // 윤곽선 점: 선 분석으로 얻은 뼈대 위에 일정 간격으로 (같은 개수를 유지하려고 모자라면 복제)
  const ld = selectLineDots(map.lines, Lc), L = map.lines;
  set.nLine = ld.length;
  const putLine = (o, px) => {
    const x = ((px % w) + 0.5)/w, y = (((px / w)|0) + 0.5)/h, sid = map.segIds ? map.segIds[px] : 0;
    put(o, x, y, 0.5 + 0.5*L.strength[px], map.depth[px], 1, 256 + sid);
  };
  for (let j=0;j<Lc;j++) {
    const o = N + K + j;
    if (j < ld.length) putLine(o, ld[j]);
    else if (ld.length) putLine(o, ld[(Math.random()*ld.length)|0]);
    else { const s = (Math.random()*m)|0; put(o, pts.x[s], pts.y[s], pts.l[s], pts.d[s], 1, pts.s[s]); }
  }
  set.col = new Float32Array(n*3).fill(1);
  const R = map.rgb;
  if (R) {
    // 화이트밸런스: 종이/조명 전체의 색 기운을 빼야 안료 고유의 색(파랑, 빨강)이 살아난다
    let sr = 0, sg = 0, sb = 0, cn = 0;
    for (let i=0;i<R.w*R.h;i++) { const r = R.data[3*i], g = R.data[3*i+1], b = R.data[3*i+2]; if (Math.max(r, g, b) > 80) { sr += r; sg += g; sb += b; cn++; } }
    const avg = (sr + sg + sb)/3, gr = cn ? avg/Math.max(1, sr) : 1, gg = cn ? avg/Math.max(1, sg) : 1, gb = cn ? avg/Math.max(1, sb) : 1, wbk = S.params.wb;
    const fr = Math.pow(gr, wbk), fg = Math.pow(gg, wbk), fb = Math.pow(gb, wbk);
    for (let o=0;o<n;o++) {
      const cx = Math.min(R.w-1, (set.nx[o]*R.w)|0), cy = Math.min(R.h-1, (set.ny[o]*R.h)|0), q = (cy*R.w + cx)*3;
      const r = Math.min(1, R.data[q]/255*fr), g = Math.min(1, R.data[q+1]/255*fg), b = Math.min(1, R.data[q+2]/255*fb), mx = Math.max(r, g, b, 1e-3);
      const k = clamp((mx - 0.08)/0.2, 0, 1);               // 아주 어두운 곳은 색을 빼서 잡음 방지
      set.col[3*o] = 1 + k*(r/mx - 1); set.col[3*o+1] = 1 + k*(g/mx - 1); set.col[3*o+2] = 1 + k*(b/mx - 1);
    }
  }
  return set;
}
// 작품 제목 글자를 점으로 (캔버스에 글자를 그린 뒤 같은 점 찍기 알고리즘 사용)
function makeTitleSet(text, n) {
  const cw = 960, ch = 260, c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const fam = '"Noto Serif KR","Nanum Myeongjo","Apple Myungjo","Apple SD Gothic Neo",serif';
  let size = 190; g.font = `700 ${size}px ${fam}`;
  const tw = g.measureText(text).width; if (tw > cw*0.92) { size = Math.floor(size*cw*0.92/tw); g.font = `700 ${size}px ${fam}`; }
  g.fillText(text, cw/2, ch/2 + size*0.04);
  const data = g.getImageData(0, 0, cw, ch).data;
  const lum = new Float32Array(cw*ch); let sum = 0;
  for (let i=0;i<cw*ch;i++) { lum[i] = data[i*4]/255; sum += lum[i]; }
  if (sum < 50) throw new Error('title unreadable');
  const depth = new Float32Array(cw*ch).fill(0.5);
  const pts = stipple({ w: cw, h: ch, lum, depth }, n);
  const m = pts.x.length;
  const set = { n, nx: new Float32Array(n), ny: new Float32Array(n), lum: new Float32Array(n).fill(1), dep: new Float32Array(n).fill(0.5), sa: new Float32Array(n).fill(1), sg: new Float32Array(n),
                aspect: cw/ch, boxFrac: 0.6, nSkirt: 0, nBase: n, flat: true };
  for (let o=0;o<n;o++) { const s = o < m ? o : (Math.random()*m)|0; set.nx[o] = clamp(pts.x[s] + (o<m?0:(Math.random()-0.5)*0.002), 0, 1); set.ny[o] = pts.y[s]; }
  return set;
}

// ---------- 점 풀 관리 ----------
const FIELDS = ['nx','ny','lum','dep','sa','sg','rx','ry','rz','fx','fy','fz','tx','ty','tz','sx','sy','sz','t0','dur','swirl','phase','z'];
function allocPool(n) {
  const prev = S.n ? { n: S.n, rx:S.rx, ry:S.ry, rz:S.rz, sx:S.sx, sy:S.sy, sz:S.sz, z:S.z, phase:S.phase, swirl:S.swirl } : null;
  if (prev && prev.n === n) return;
  FIELDS.forEach(f => S[f] = new Float32Array(n));
  S.col = new Float32Array(n*3).fill(1);
  S.n = n;
  for (let i=0;i<n;i++) {
    if (prev) { // 기존 점의 위치/성질을 이어받는다 (개수가 바뀌면 순환 매핑)
      const s = i % prev.n;
      S.rx[i]=prev.rx[s]; S.ry[i]=prev.ry[s]; S.rz[i]=prev.rz[s]; S.sx[i]=prev.sx[s]; S.sy[i]=prev.sy[s]; S.sz[i]=prev.sz[s];
      S.z[i]=prev.z[s]; S.phase[i]=prev.phase[s]; S.swirl[i]=prev.swirl[s];
    } else {
      randomScatter(i); S.rx[i]=S.sx[i]; S.ry[i]=S.sy[i]; S.rz[i]=S.sz[i];
      S.z[i]=Math.random(); S.phase[i]=Math.random()*Math.PI*2; S.swirl[i]=Math.random()<0.5?-1:1;
    }
  }
}
// style: init | quick | gather | morph | scatter
function applyTargets(set, mode, style) {
  const now = performance.now();
  if (S.n) snapshot(now);
  allocPool(set.n);
  S.nx.set(set.nx); S.ny.set(set.ny); S.lum.set(set.lum); S.dep.set(set.dep); S.sa.set(set.sa); S.sg.set(set.sg); if (set.col) S.col.set(set.col); else S.col.fill(1);
  S.aspect = set.aspect; S.boxFrac = set.boxFrac; S.flat = set.flat; S.nBase = set.nBase; S.nSkirt = set.nSkirt; S.nLine = set.nLine || 0;
  mapTargets();
  S.mode = mode;
  const diag = Math.hypot(W, H);
  for (let i=0;i<S.n;i++) {
    S.fx[i]=S.rx[i]; S.fy[i]=S.ry[i]; S.fz[i]=S.rz[i];
    if (style === 'scatter') randomScatter(i);
    const dist = Math.hypot(S.tx[i], S.ty[i]) / diag;
    let t0, dur;
    if (style === 'quick') { t0 = now; dur = 700; }
    else if (style === 'gather') { t0 = now + dist*900 + Math.random()*500; dur = 1400 + Math.random()*1400; }
    else if (style === 'morph') { t0 = now + Math.random()*450; dur = 1700 + Math.random()*900; }
    else if (style === 'scatter') { t0 = now + Math.random()*400; dur = 1400 + Math.random()*1400; }
    else { t0 = now + Math.random()*600; dur = 1500 + Math.random()*1300; }
    S.t0[i] = t0; S.dur[i] = dur;
  }
  uploadStatic(); uploadMotion();
  S.statusPending = true;
  document.getElementById('bToggle').textContent = mode === 'form' ? '흩어지기' : '모이기';
}
function setStatus(extra) {
  const a = ART[S.cur], dep = a && a.cache && a.cache.map.depthReal ? 'AI 추정' : '밝기 기반';
  statusEl.textContent = `점 ${S.nBase.toLocaleString()}개 + 보간 ${S.nSkirt.toLocaleString()}개 + 윤곽 ${S.nLine.toLocaleString()}개 · 깊이: ${dep} · ${extra}`;
}
function showCaption(on) {
  const a = ART[S.cur]; if (!a) return;
  if (on) {
    captionEl.querySelector('h2').textContent = a.meta.title;
    captionEl.querySelector('p').textContent = [a.meta.artist, a.meta.year, a.meta.medium].filter(Boolean).join(' · ');
  }
  captionEl.classList.toggle('show', !!on);
}

// ---------- 파라미터 변경 시: 현재 작품 목표만 다시 계산 ----------
async function rebuild(keepMode, reuse) {
  if (S.cur < 0) return;
  try {
    await ensureGray(S.cur);
    computeArtwork(S.cur, reuse);
    const set = makeArtworkSet(S.cur);
    applyTargets(set, S.mode, reuse || keepMode ? 'quick' : 'init');
    drawDepthMap(ART[S.cur].cache.map.depth, ART[S.cur].cache.map.w, ART[S.cur].cache.map.h);
    setStatus(S.mode === 'form' ? '모이는 중' : '흩어진 상태');
  } catch (e) { S.err = e.message; statusEl.textContent = '오류: ' + e.message; }
}

// ---------- 작품 선택 연출: (흩어진 상태) 제목 글자 -> 그림 / (모인 상태) 바로 변형 ----------
function setTone(on) { S.params.invertTone = !!on; document.getElementById('bTone').textContent = '명암 반전: ' + (on ? '켜짐' : '꺼짐'); }
function applyTune(t) {
  setTone(!!(t && t.invertTone));
  if (!t) return;
  for (const [k, v] of Object.entries(t)) { if (k === 'invertTone') continue; const el = document.getElementById(k); if (!el) continue; el.value = v; S.params[k] = +v; el.dispatchEvent(new Event('x-sync')); }
}
async function playArtwork(idx) {
  const token = ++S.seq;
  const wasForm = S.mode === 'form' && S.cur >= 0 && S.cur !== idx;
  S.cur = idx;
  document.querySelectorAll('.item').forEach(x => x.classList.toggle('active', +x.dataset.idx === idx));
  try {
    await ensureGray(idx);
    if (token !== S.seq) return;
    applyTune(ART[idx].meta.tune);
    statusEl.textContent = '선과 디테일을 분석하는 중...'; await sleep(40);
    computeArtwork(idx, false);
    drawDepthMap(ART[idx].cache.map.depth, ART[idx].cache.map.w, ART[idx].cache.map.h);
    renderSegPanel();
    const set = makeArtworkSet(idx);
    showCaption(false);
    // 카메라: 처음 모일 때는 비스듬히 멀리서 들어온다
    if (!S.interacted && S.mode !== 'form') { S.yaw = -0.7; S.zoom = 0.72; S.zoomT = 1; S.dirty = true; }
    if (wasForm) {
      applyTargets(set, 'form', 'morph'); setStatus('다음 작품으로 변형 중');
    } else {
      let titled = false;
      if (!REDUCED_MOTION) {
        try {
          const ts = makeTitleSet(ART[idx].meta.title, set.n);
          applyTargets(ts, 'form', 'gather'); setStatus('제목');
          titled = true;
          await sleep(Math.max(0, S.endTime - performance.now()) + 700);
          if (token !== S.seq) return;
        } catch (e) { /* 글자 점 만들기가 막힌 환경: 제목 단계 생략 */ }
      }
      applyTargets(set, 'form', titled ? 'morph' : 'gather'); setStatus('모이는 중');
    }
    const wait = Math.max(0, S.endTime - performance.now());
    setTimeout(() => { if (token === S.seq) showCaption(true); }, Math.max(600, wait - 500));
  } catch (e) { S.err = e.message; statusEl.textContent = '오류: ' + e.message; }
}
function startMove(mode) {          // 흩어지기/모이기 버튼용 (현재 목표 집합 그대로)
  if (!S.n) return;
  if (mode === 'form' && S.flat && S.cur >= 0) { playArtwork(S.cur); return; }
  S.seq++;
  const now = performance.now();
  snapshot(now);
  S.mode = mode;
  const diag = Math.hypot(W, H);
  for (let i=0;i<S.n;i++) {
    S.fx[i]=S.rx[i]; S.fy[i]=S.ry[i]; S.fz[i]=S.rz[i];
    if (mode === 'scatter') randomScatter(i);
    const dist = Math.hypot(S.tx[i], S.ty[i]) / diag;
    S.t0[i] = now + (mode === 'form' ? dist*900 + Math.random()*500 : Math.random()*400);
    S.dur[i] = 1400 + Math.random()*1400;
  }
  uploadMotion();
  S.statusPending = true;
  showCaption(mode === 'form' && !S.flat);
  setStatus(mode === 'form' ? '모이는 중' : '흩어지는 중');
  document.getElementById('bToggle').textContent = mode === 'form' ? '흩어지기' : '모이기';
}

// =====================================================================
//  프레임 루프: 움직임이 없으면 그리지 않는다 (절전)
// =====================================================================
let drawnFrames = 0, fpsStamp = performance.now();
const LIM = () => S.limit ? { yaw: 0.95, pitch: 0.6 } : { yaw: 1.5, pitch: 1.1 };
function softK(a, lim) { const t = Math.abs(a) / lim; return t < 0.6 ? 1 : Math.max(0.12, 1 - (t - 0.6) / 0.5); }
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); rafTicks++;
  if (now - fpsStamp > 700) {
    const fpsNow = drawnFrames * 1000 / (now - fpsStamp);
    fpsEl.textContent = drawnFrames === 0 ? '대기 · 렌더 중단(절전)' : Math.round(fpsNow) + ' fps';
    adaptQuality(fpsNow, drawnFrames, rafTicks, now);
    drawnFrames = 0; rafTicks = 0; fpsStamp = now;
  }
  if (!gl || !S.n || gl.isContextLost()) return;

  // 카메라 (한계 근처에서는 저항, 놓으면 부드럽게 되돌아옴)
  const L = LIM();
  let camMoving = false;
  if (S.dragging) camMoving = true;
  else if (S.interacted) {
    if (S.limit) {
      const ey = Math.abs(S.yaw) - L.yaw*0.9, ep = Math.abs(S.pitch) - L.pitch*0.9;
      if (ey > 0) S.vyaw -= Math.sign(S.yaw) * ey * 0.06;
      if (ep > 0) S.vpitch -= Math.sign(S.pitch) * ep * 0.06;
    }
    if (Math.abs(S.vyaw) > 1e-4 || Math.abs(S.vpitch) > 1e-4) {
      S.yaw = clamp(S.yaw + S.vyaw, -L.yaw*1.1, L.yaw*1.1); S.pitch = clamp(S.pitch + S.vpitch, -L.pitch*1.1, L.pitch*1.1);
      S.vyaw *= 0.92; S.vpitch *= 0.92; camMoving = true;
    }
  } else {
    const t = now / 1000;
    const yawT = S.sway ? Math.sin(t*0.45)*0.34 : 0, pitchT = S.sway ? Math.sin(t*0.31+1)*0.1 : 0;
    if (S.sway || Math.abs(S.yaw - yawT) > 1e-3 || Math.abs(S.pitch - pitchT) > 1e-3) {
      S.yaw += (yawT - S.yaw)*0.05; S.pitch += (pitchT - S.pitch)*0.05; camMoving = true;
    }
  }
  if (Math.abs(S.zoomT - S.zoom) > 5e-4) { S.zoom += (S.zoomT - S.zoom)*0.12; camMoving = true; } else S.zoom = S.zoomT;

  // 마우스 반응 세기
  const mt = (S.mouse.on && !S.dragging) ? 1 : 0;
  let mouseAnim = false;
  if (Math.abs(mt - S.mouse.pow) > 0.01) { S.mouse.pow += (mt - S.mouse.pow)*0.15; mouseAnim = true; }
  else if (S.mouse.pow !== mt) { S.mouse.pow = mt; mouseAnim = true; }

  let panAnim = false;
  for (const k of ['x','y','z']) { const dd = S.panT[k] - S.pan[k]; if (Math.abs(dd) > 0.05) { S.pan[k] += dd*0.12; panAnim = true; } else S.pan[k] = S.panT[k]; }
  const st = S.sel >= 0 ? 1 : 0; let selAnim = false;
  if (Math.abs(st - S.selPow) > 0.01) { S.selPow += (st - S.selPow)*0.18; selAnim = true; } else if (S.selPow !== st) { S.selPow = st; selAnim = true; }

  if (S.statusPending && now >= S.endTime) { S.statusPending = false; setStatus(S.mode === 'form' ? '모인 상태' : '흩어진 상태'); }
  const animating = now < S.endTime + 80 || S.mode === 'scatter';
  if (!(camMoving || animating || mouseAnim || selAnim || panAnim || S.dirty)) return;
  S.dirty = false; drawnFrames++;

  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(GLP);
  const bind = (k, loc, size) => { gl.bindBuffer(gl.ARRAY_BUFFER, GLB[k]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
  bind('from', 0, 3); bind('to', 1, 3); bind('anim', 2, 4); bind('misc', 3, 4); bind('col', 4, 3);
  gl.uniform1f(GLU.u_time, now / 1000);
  gl.uniform1f(GLU.u_form, S.mode === 'form' ? 1 : 0);
  gl.uniform1f(GLU.u_size, S.params.size);
  gl.uniform1f(GLU.u_glow, S.params.glow);
  gl.uniform1f(GLU.u_dof, S.params.dof);
  gl.uniform1f(GLU.u_zoom, S.zoom);
  gl.uniform1f(GLU.u_dpr, DPR);
  gl.uniform1f(GLU.u_mpow, S.mouse.pow);
  gl.uniform1f(GLU.u_sel, S.sel >= 0 ? S.sel : -1);
  gl.uniform1f(GLU.u_selpow, S.selPow);
  gl.uniform1f(GLU.u_line, S.params.lineDots);
  gl.uniform1f(GLU.u_color, S.params.color);
  gl.uniform1f(GLU.u_sat, S.params.sat);
  gl.uniform1f(GLU.u_split, S.params.split*3.0);
  gl.uniform1f(GLU.u_chan, 0);
  gl.uniform1f(GLU.u_lineview, S.lineView ? 1 : 0);
  gl.uniform3f(GLU.u_pan, S.pan.x, S.pan.y, S.pan.z);
  gl.uniform2f(GLU.u_mouse, S.mouse.x, S.mouse.y);
  gl.uniform2f(GLU.u_half, W/2, H/2);
  gl.uniform4f(GLU.u_cam, Math.cos(S.yaw), Math.sin(S.yaw), Math.cos(S.pitch), Math.sin(S.pitch));
  if (S.params.glow > 0.01) {
    gl.blendFunc(gl.ONE, gl.ONE); gl.uniform1f(GLU.u_pass, 1); gl.drawArrays(gl.POINTS, 0, S.n);
  }
  gl.uniform1f(GLU.u_pass, 0);
  if (S.params.split > 0.01) {                       // RGB 분리: R, G, B를 따로 그려 더한다
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let ch = 1; ch <= 3; ch++) { gl.uniform1f(GLU.u_chan, ch); gl.drawArrays(gl.POINTS, 0, S.n); }
    gl.uniform1f(GLU.u_chan, 0);
  } else {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, S.n);
  }
}

// =====================================================================
//  배선
// =====================================================================
let resizeTimer = null;
function resize() {
  const r0 = stage.getBoundingClientRect(); if (r0.width < 10 || r0.height < 10) return;
  W = r0.width; H = r0.height;
  setCanvasSize();
  S.dirty = true;
  if (S.n) {
    // 화면 크기가 바뀌면 흩어졌다 다시 모이지 않고 현재 위치에서 새 배치로 부드럽게 이동
    const now = performance.now(); snapshot(now);
    mapTargets();
    for (let i=0;i<S.n;i++) { if (S.mode === 'scatter') randomScatter(i); S.fx[i]=S.rx[i]; S.fy[i]=S.ry[i]; S.fz[i]=S.rz[i]; S.t0[i]=now; S.dur[i]=550; }
    uploadMotion();
  }
}
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
if (window.ResizeObserver) new ResizeObserver(() => {
  const r = stage.getBoundingClientRect();
  if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1) { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); }
}).observe(stage);

// 업로드 이미지용 깊이 추정 (Depth Anything V2 small, 브라우저에서 실행, 인터넷 필요)
// transformers.js를 한 번만 불러오고 설정을 공유 (모델 계산은 워커에서 실행해 화면이 멈추지 않게 함)
let _T = null;
async function getT() {
  if (_T) return _T;
  const T = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1');
  T.env.allowLocalModels = false;
  T.env.backends.onnx.wasm.proxy = true;
  _T = T;
  return T;
}
let _depthPipe = null;
async function getDepthPipe() {
  if (_depthPipe) return _depthPipe;
  const T = await getT();
  _depthPipe = await T.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' });
  return _depthPipe;
}
async function runDepthEstimate(idx, url) {
  statusEl.textContent = '깊이 추정 중... (처음에는 모델 다운로드로 수십 초 걸려요)';
  try {
    const pipe = await getDepthPipe();
    const out = await pipe(url);
    const g = ART[idx].gray, d = out.depth, gw = g.w, gh = g.h;
    const lum = new Float32Array(gw*gh);
    for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
      const sx = Math.min(d.width-1, Math.floor((x+0.5)*d.width/gw)), sy = Math.min(d.height-1, Math.floor((y+0.5)*d.height/gh));
      lum[y*gw+x] = d.data[(sy*d.width + sx)*d.channels] / 255;
    }
    g.depth = lum;
    if (S.cur === idx) rebuild(true, false);
  } catch (e) { statusEl.textContent = '깊이 추정 실패 (인터넷 필요) · 밝기 기반 깊이로 표시: ' + e.message; }
}
function addListItem(i) {
  const m = ART[i].meta, b = document.createElement('button');
  b.className = 'item'; b.dataset.idx = i;
  b.innerHTML = '<span></span><small></small>';
  b.firstChild.textContent = m.title; b.querySelector('small').textContent = [m.artist, m.year].filter(Boolean).join(' · ');
  document.getElementById('list').appendChild(b);
}
ART.forEach((a, i) => addListItem(i));

// =====================================================================
//  구성요소(피사체) 패널 / 선택 / 클릭 선택
// =====================================================================
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function depthWord(m) { return m > 0.66 ? '앞' : m > 0.33 ? '중간' : '뒤'; }
function autoContext(a) {
  const st = a.cache.map.segStat, segs = a.seg.segs;
  const items = segs.map(s => ({ s, st: st[s.id] })).filter(x => x.st && x.st.area > 0).sort((p, q) => q.st.med - p.st.med);
  if (!items.length) return '';
  const big = [...items].sort((p, q) => q.st.frac - p.st.frac)[0];
  return `<b>${items.length}개</b>의 구성요소를 구분했어요. 가장 가까운 것은 <b>${esc(items[0].s.ko)}</b>, 가장 큰 것은 <b>${esc(big.s.ko)}</b>(화면의 ${Math.round(big.st.frac*100)}%)예요. 가까운 순서: ${items.map(x => esc(x.s.ko)).join(' → ')}.`;
}
function setSelHover(id) { S.sel = id >= 0 ? id : S.lockId; S.dirty = true; }
function lockSel(id) {
  S.lockId = (S.lockId === id) ? -1 : id; S.sel = S.lockId; S.dirty = true;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', +c.dataset.id === S.lockId));
}
function zoomTo(hs) {
  const a = ART[S.cur]; if (!a || !a.cache) return;
  const map = a.cache.map, b = imageBox();
  const amp = S.params.depth*Math.min(b.w, b.h)*0.6*(S.invert ? -1 : 1)*(S.flat ? 0 : 1);
  const px = Math.min(map.w-1, (hs.cx*map.w)|0), py = Math.min(map.h-1, (hs.cy*map.h)|0), d = map.depth[py*map.w + px];
  S.panT = { x: (hs.cx - 0.5)*b.w, y: (hs.cy - 0.5)*b.h, z: -(d - 0.5)*amp };
  S.zoomT = clamp(0.55*Math.min(W, H)/Math.max(hs.w*b.w, hs.h*b.h), 1.4, 7);
  S.interacted = true; S.dirty = true;
}
function renderHotChips(a) {
  const box = document.getElementById('hots'); box.innerHTML = '';
  if (!a || !a.cache || !a.cache.hot) return;
  a.cache.hot.forEach((hs, k) => {
    const b = document.createElement('button'); b.className = 'chip'; b.title = '세부 묘사가 가장 많은 곳 (얼굴, 손, 옷 주름 등)';
    const nm = document.createElement('span'); nm.textContent = '디테일 ' + (k+1);
    const sm = document.createElement('small'); sm.textContent = hs.seg || '';
    b.append(nm, sm); b.addEventListener('click', () => zoomTo(hs)); box.appendChild(b);
  });
}
function renderSegPanel() {
  const panel = document.getElementById('segpanel'), chips = document.getElementById('chips'), ctx = document.getElementById('ctx');
  const a = ART[S.cur]; chips.innerHTML = ''; S.lockId = -1; S.sel = -1;
  if (!a) { panel.classList.remove('on'); return; }
  panel.classList.add('on');
  renderHotChips(a);
  if (!a.seg || !a.cache || !a.cache.map.segStat) { ctx.innerHTML = '아직 구성요소를 분석하지 않았어요. 아래 <b>구성요소 분석 (SAM)</b>을 누르면 피사체를 구분합니다.'; return; }
  const st = a.cache.map.segStat;
  const list = a.seg.segs.filter(s => st[s.id] && st[s.id].area > 0).sort((p, q) => st[q.id].med - st[p.id].med);
  list.forEach(s => {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.id = s.id; b.title = (s.desc || '') + ' (더블클릭: 이름 바꾸기)';
    const sw = document.createElement('i'); sw.style.opacity = (0.35 + 0.65*st[s.id].med).toFixed(2);
    const nm = document.createElement('span'); nm.textContent = s.ko;
    const sm = document.createElement('small'); sm.textContent = depthWord(st[s.id].med);
    b.append(sw, nm, sm);
    b.addEventListener('mouseenter', () => setSelHover(s.id));
    b.addEventListener('mouseleave', () => setSelHover(-1));
    b.addEventListener('click', () => lockSel(s.id));
    b.addEventListener('dblclick', () => { const v = prompt('이 구성요소의 이름', s.ko); if (v && v.trim()) { s.ko = v.trim(); renderSegPanel(); } });
    chips.appendChild(b);
  });
  ctx.innerHTML = (a.seg.context ? '<b>맥락</b> ' + esc(a.seg.context) + '<br><br>' : '') + autoContext(a);
}
// 화면의 한 점을 눌렀을 때 그 위치의 가장 앞쪽 점이 속한 구성요소를 찾는다 (셰이더와 같은 투영식)
function pickSegment(clientX, clientY) {
  const r = stage.getBoundingClientRect(), mx = clientX - r.left - W/2, my = clientY - r.top - H/2;
  snapshot(performance.now());
  const cY = Math.cos(S.yaw), sY = Math.sin(S.yaw), cP = Math.cos(S.pitch), sP = Math.sin(S.pitch), R2 = Math.pow(PROFILE.pick, 2);
  let best = -1, bz = 1e9;
  for (let i=0;i<S.n;i++) {
    const x = S.rx[i] - S.pan.x, y = S.ry[i] - S.pan.y, z = S.rz[i] - S.pan.z;
    const x1 = x*cY + z*sY, z1 = -x*sY + z*cY, y2 = y*cP - z1*sP, z2 = y*sP + z1*cP, den = 1500 + z2;
    if (den < 200) continue;
    const f = 1500/den*S.zoom, dx = x1*f - mx, dy = y2*f - my;
    if (dx*dx + dy*dy <= R2 && z2 < bz) { bz = z2; best = S.sg[i] % 256; }
  }
  return best;
}
function onStageClick(e) {
  if (!S.n || S.flat || S.mode !== 'form') return;
  const a = ART[S.cur]; if (!a || !a.seg) return;
  const id = pickSegment(e.clientX, e.clientY);
  if (id < 0) { S.lockId = -1; S.sel = -1; document.querySelectorAll('.chip').forEach(c => c.classList.remove('sel')); S.dirty = true; return; }
  lockSel(id);
}
// =====================================================================
//  구성요소 분석: SAM(slimsam)에 격자 점을 프롬프트로 주고 마스크를 모아 피사체 지도를 만든다
//  (브라우저에서 실행, 처음에는 모델 다운로드 필요)
// =====================================================================
let _sam = null;
async function getSam() {
  if (_sam) return _sam;
  const T = await getT();
  const model = await T.SamModel.from_pretrained('Xenova/slimsam-77-uniform');
  const processor = await T.AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
  _sam = { T, model, processor };
  return _sam;
}
function loadImageEl(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
async function runSegmentation(idx, PTS) {
  const a = ART[idx]; if (!a) return;
  PTS = PTS || 8;
  const bAn = document.getElementById('bAnalyze'); bAn.disabled = true;
  try {
    await ensureGray(idx);
    const g = a.gray, kk = Math.min(1, 520/Math.max(g.w, g.h)), gw = Math.max(8, Math.round(g.w*kk)), gh = Math.max(8, Math.round(g.h*kk)), total = gw*gh;   // SAM은 520px 격자에서 돌린다
    statusEl.textContent = '구성요소 분석 중... (모델 내려받기와 계산에 1~3분 걸려요)';
    const { T, model, processor } = await getSam();
    const sc = document.createElement('canvas'); sc.width = gw; sc.height = gh;
    const sg = sc.getContext('2d');
    if (a.url) { const im = await loadImageEl(a.url); sg.drawImage(im, 0, 0, gw, gh); }
    else { const hc = document.createElement('canvas'); hc.width = g.w; hc.height = g.h; const hg = hc.getContext('2d'); const id = hg.createImageData(g.w, g.h); for (let i=0;i<g.w*g.h;i++) { const v = Math.round(g.lum[i]*255); id.data[4*i] = id.data[4*i+1] = id.data[4*i+2] = v; id.data[4*i+3] = 255; } hg.putImageData(id, 0, 0); sg.imageSmoothingQuality = 'high'; sg.drawImage(hc, 0, 0, gw, gh); }
    const image = await T.RawImage.fromURL(sc.toDataURL('image/png'));
    const emb = await model.get_image_embeddings(await processor(image));
    const cands = [];
    for (let py = 0; py < PTS; py++) for (let px = 0; px < PTS; px++) {
      statusEl.textContent = `구성요소 분석 중... ${py*PTS + px + 1}/${PTS*PTS}`;
      await sleep(0);
      const inputs = await processor(image, { input_points: [[[(px + 0.5)/PTS*image.width, (py + 0.5)/PTS*image.height]]] });
      const out = await model({ ...emb, ...inputs });
      const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
      const m = masks[0], H = m.dims[2], Wd = m.dims[3], scores = out.iou_scores.data;
      for (let k = 0; k < 3; k++) {
        const mk = new Uint8Array(total); let area = 0;
        for (let yy = 0; yy < gh; yy++) { const sy = Math.min(H-1, Math.floor((yy+0.5)*H/gh));
          for (let xx = 0; xx < gw; xx++) { const sx = Math.min(Wd-1, Math.floor((xx+0.5)*Wd/gw)); if (m.data[k*H*Wd + sy*Wd + sx]) { mk[yy*gw+xx] = 1; area++; } } }
        cands.push({ mk, area, score: scores[k] });
      }
    }
    statusEl.textContent = '구성요소 정리 중...';
    await sleep(0);
    const kept = cands.filter(c => c.score >= 0.72 && c.area >= total*0.003 && c.area <= total*0.6).sort((p, q) => q.score - p.score);
    const sel = [];
    for (const c of kept) {
      let dup = false;
      for (const s of sel) { let inter = 0; for (let i=0;i<total;i++) if (c.mk[i] && s.mk[i]) inter++; if (inter/(c.area + s.area - inter) > 0.7) { dup = true; break; } }
      if (!dup) sel.push(c);
    }
    sel.sort((p, q) => q.area - p.area);                       // 큰 것부터 칠하고 작은 것을 위에 덮는다
    const ids = new Uint8Array(total);
    sel.slice(0, 24).forEach((c, k) => { for (let i=0;i<total;i++) if (c.mk[i]) ids[i] = k + 1; });
    const cnt = new Array(sel.length + 2).fill(0); for (let i=0;i<total;i++) cnt[ids[i]]++;
    const segs = [{ id: 0, ko: '바탕·배경', desc: '분리되지 않은 나머지 영역' }];
    let n = 0;
    for (let id = 1; id <= Math.min(24, sel.length); id++) {
      if (cnt[id] < total*0.012) { for (let i=0;i<total;i++) if (ids[i] === id) ids[i] = 0; continue; }
      segs.push({ id, ko: '피사체 ' + (++n), desc: '' });
    }
    a.seg = { w: gw, h: gh, ids, segs, context: '' };
    a.gray.segIds = resizeIdsNearest(ids, gw, gh, g.w, g.h); a.cache = null;
    await rebuild(true, false);
    renderSegPanel();
    setStatus(S.mode === 'form' ? '모인 상태' : '흩어진 상태');
  } catch (e) { statusEl.textContent = '구성요소 분석 실패 (인터넷 필요): ' + e.message; }
  bAn.disabled = false;
}
document.getElementById('bAnalyze').addEventListener('click', () => { if (TOUCH && !confirm('구성요소 분석(SAM)은 휴대폰에서 1~3분 걸리고 메모리를 많이 써요. PC에서 쓰는 걸 권장해요. 계속할까요?')) return; if (S.cur >= 0) runSegmentation(S.cur, 8); });

// 깊이 단서(부조/명암) 가중치만 바뀌면 점을 다시 찍지 않고 깊이만 다시 계산한다
let depthTimer = null;
function scheduleDepthRefresh() {
  clearTimeout(depthTimer);
  depthTimer = setTimeout(() => {
    const a = ART[S.cur]; if (!a || !a.cache) return;
    const { map, pts } = a.cache;
    map.depth = composeDepth(map, S.params);
    for (let i=0;i<pts.x.length;i++) pts.d[i] = map.depth[Math.min(map.h-1, (pts.y[i]*map.h)|0)*map.w + Math.min(map.w-1, (pts.x[i]*map.w)|0)];
    drawDepthMap(map.depth, map.w, map.h);
    rebuild(true, true);
  }, 120);
}
let rebuildTimer = null;
function scheduleRebuild(reuse) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => rebuild(true, !!reuse), 180); }
function bindRange(id, outId, key, fmt) {
  const el = document.getElementById(id), out = document.getElementById(outId);
  const show = () => out.textContent = fmt ? fmt(+el.value) : el.value;
  el.addEventListener('input', () => {
    S.params[key] = +el.value; show();
    if (key === 'size' || key === 'glow' || key === 'dof' || key === 'lineDots' || key === 'color' || key === 'sat' || key === 'split') { S.dirty = true; return; }
    if (key === 'depth') { retargetDepth(); return; }
    if (key === 'relief' || key === 'tone' || key === 'unify' || key === 'sep') { scheduleDepthRefresh(); return; }
    scheduleRebuild(key === 'fill' || key === 'wb');
  });
  el.addEventListener('x-sync', show);
  show();
}
bindRange('count','oCount','count', v => v.toLocaleString());
bindRange('contrast','oContrast','contrast', v => v.toFixed(2));
bindRange('gamma','oGamma','gamma', v => v.toFixed(2));
bindRange('size','oSize','size', v => v.toFixed(2));
bindRange('glow','oGlow','glow', v => v.toFixed(2));
bindRange('dof','oDof','dof', v => v.toFixed(2));
bindRange('depth','oDepth','depth', v => v.toFixed(2));
bindRange('fill','oFill','fill', v => v.toFixed(1));
bindRange('relief','oRelief','relief', v => v.toFixed(2));
bindRange('detail','oDetail','detail', v => v.toFixed(1));
bindRange('color','oColor','color', v => v.toFixed(2));
bindRange('wb','oWb','wb', v => v.toFixed(2));
bindRange('sat','oSat','sat', v => v.toFixed(2));
bindRange('split','oSplit','split', v => v.toFixed(2));
bindRange('localContrast','oLocal','localContrast', v => v.toFixed(2));
bindRange('lineTone','oLineTone','lineTone', v => v.toFixed(2));
bindRange('lineDots','oLineDots','lineDots', v => v.toFixed(2));
document.getElementById('bLine').addEventListener('click', e => { S.lineView = !S.lineView; e.target.textContent = S.lineView ? '선 분석 보기: 켜짐' : '선 분석 보기'; S.dirty = true; });
bindRange('unify','oUnify','unify', v => v.toFixed(2));
bindRange('sep','oSep','sep', v => v.toFixed(2));
bindRange('tone','oTone','tone', v => v.toFixed(2));
document.getElementById('depth').addEventListener('change', () => scheduleRebuild(true));

document.getElementById('list').addEventListener('click', e => {
  const it = e.target.closest('.item'); if (!it) return;
  playArtwork(+it.dataset.idx);
});
document.getElementById('bToggle').addEventListener('click', () => startMove(S.mode === 'form' ? 'scatter' : 'form'));
document.getElementById('bRotate').addEventListener('click', () => { if (S.cur < 0) return; ART[S.cur].rotation = (ART[S.cur].rotation+1) % 4; rebuild(true, false); });
document.getElementById('bTone').addEventListener('click', () => { setTone(!S.params.invertTone); rebuild(true, false); });
document.getElementById('bInvert').addEventListener('click', () => { S.invert = !S.invert; retargetDepth(); });
document.getElementById('bLimit').addEventListener('click', e => { S.limit = !S.limit; e.target.textContent = '회전 제한: ' + (S.limit ? '켜짐' : '꺼짐'); S.dirty = true; });
document.getElementById('bUpload').addEventListener('click', () => document.getElementById('file').click());
document.getElementById('file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f), im = new Image();
  im.onload = () => {
    try {
      const gray = grayFromImage(im);
      ART.push({ meta: { id: 'upload', title: f.name.replace(/\.[^.]+$/, ''), artist: '내 이미지', year: '', tune: null }, gray, rotation: 0, cache: null, url });
      const idx = ART.length - 1; addListItem(idx);
      playArtwork(idx).then(() => { if (!TOUCH || confirm('AI 깊이 추정은 휴대폰에서 30초~1분 걸리고 배터리를 많이 써요. 진행할까요? (취소하면 밝기 기반 깊이로 보여줘요)')) runDepthEstimate(idx, url); });
    } catch (err) { statusEl.textContent = '오류: ' + err.message; }
  };
  im.onerror = () => { statusEl.textContent = '오류: 이미지를 불러오지 못했어요'; };
  im.src = url;
});

// --- 시점 조작 ---
//  PC: 드래그 회전 / 휠·트랙패드 핀치 확대 / 더블클릭 초기화 / 키보드
//  모바일: 한 손가락 회전 / 두 손가락 핀치 확대 / 두 번 탭 초기화
let lastPt = null, downPt = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 };
const ptrs = new Map();
const hintEl = document.getElementById('hint');
function hideHint() { if (TOUCH) hintEl.classList.add('gone'); }
hintEl.textContent = TOUCH
  ? '아래에서 작품을 골라 보세요 · 한 손가락: 회전 · 두 손가락: 확대 · 두 번 탭: 초기화'
  : '클릭: 모으기 · 드래그: 회전 · 휠: 확대 · 더블클릭: 초기화 · 스페이스 · H 패널 · F 전체화면';
if (TOUCH) setTimeout(hideHint, 9000);
stage.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (rootEl.classList.contains('compact') && side.dataset.sheet === 'open') setSheet('peek');
  hideHint();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  if (ptrs.size === 1) {
    S.dragging = true; S.vyaw = 0; S.vpitch = 0;
    downPt = { x: e.clientX, y: e.clientY }; lastPt = { x: e.clientX, y: e.clientY };
    stage.classList.add('grabbing');
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z: S.zoomT };
    S.dragging = false; lastPt = null; downPt = null; S.interacted = true; S.vyaw = 0; S.vpitch = 0;
  }
});
stage.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') {
    const r = stage.getBoundingClientRect();
    S.mouse.on = true; S.mouse.x = e.clientX - r.left - W/2; S.mouse.y = e.clientY - r.top - H/2; S.dirty = true;
  }
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    S.zoomT = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.5, 2.6); S.dirty = true;
    return;
  }
  if (!S.dragging || !lastPt) return;
  if (downPt && Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 4) S.interacted = true;
  const dx = e.clientX - lastPt.x, dy = e.clientY - lastPt.y, L = LIM(), K = PROFILE.sens;
  lastPt = { x: e.clientX, y: e.clientY };
  S.yaw = clamp(S.yaw - dx*K*(S.limit ? softK(S.yaw, L.yaw) : 1), -L.yaw*1.1, L.yaw*1.1);
  S.pitch = clamp(S.pitch + dy*K*(S.limit ? softK(S.pitch, L.pitch) : 1), -L.pitch*1.1, L.pitch*1.1);
  S.vyaw = clamp(-dx*K, -0.05, 0.05); S.vpitch = clamp(dy*K, -0.05, 0.05); S.lastMove = performance.now();
});
stage.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { S.mouse.on = false; S.dirty = true; } });
const endDrag = () => {
  if (!S.dragging) return;
  S.dragging = false; lastPt = null; stage.classList.remove('grabbing');
  if (performance.now() - S.lastMove > 80) { S.vyaw = 0; S.vpitch = 0; }
};
stage.addEventListener('pointerup', e => {
  const wasClick = downPt && ptrs.size === 1 && Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) < 5;
  ptrs.delete(e.pointerId);
  if (pinch && ptrs.size < 2) { pinch = null; downPt = null; }
  endDrag();
  if (!wasClick) return;
  if (e.pointerType !== 'mouse') {   // 터치: 두 번 탭 = 시점 초기화
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32) { lastTap.t = 0; resetView(); return; }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  onStageClick(e);
});
stage.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pinch = null; downPt = null; endDrag(); });
stage.addEventListener('contextmenu', e => { if (TOUCH) e.preventDefault(); });
document.addEventListener('gesturestart', e => e.preventDefault());
stage.addEventListener('wheel', e => { e.preventDefault(); S.zoomT = clamp(S.zoomT * Math.exp(-e.deltaY*(e.ctrlKey ? 0.01 : 0.0012)), 0.5, 2.6); S.dirty = true; }, { passive: false });
function resetView() { S.interacted = false; S.vyaw = 0; S.vpitch = 0; S.zoomT = 1; S.panT = { x: 0, y: 0, z: 0 }; S.dirty = true; }
stage.addEventListener('dblclick', e => { if (e.pointerType !== 'touch') resetView(); });
document.getElementById('bView').addEventListener('click', resetView);
document.getElementById('bMap').addEventListener('click', e => {
  const b = document.getElementById('mapbox'); b.classList.toggle('hidden');
  e.target.textContent = b.classList.contains('hidden') ? '깊이맵 보기' : '깊이맵 숨기기';
});
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const step = 0.09, L = LIM(); let hit = true; const k = e.key;
  const onBtn = !!(e.target.closest && e.target.closest('button, summary'));
  if (k === 'ArrowLeft') { S.interacted = true; S.yaw = clamp(S.yaw - step, -L.yaw, L.yaw); }
  else if (k === 'ArrowRight') { S.interacted = true; S.yaw = clamp(S.yaw + step, -L.yaw, L.yaw); }
  else if (k === 'ArrowUp') { S.interacted = true; S.pitch = clamp(S.pitch - step, -L.pitch, L.pitch); }
  else if (k === 'ArrowDown') { S.interacted = true; S.pitch = clamp(S.pitch + step, -L.pitch, L.pitch); }
  else if (k === '+' || k === '=') S.zoomT = clamp(S.zoomT * 1.15, 0.5, 2.6);
  else if (k === '-' || k === '_') S.zoomT = clamp(S.zoomT / 1.15, 0.5, 2.6);
  else if (k === '0') resetView();
  else if (k === ' ' && !onBtn) document.getElementById('bToggle').click();
  else if (k === 'l' || k === 'L') document.getElementById('bLine').click();
  else if (k === 'h' || k === 'H') window.__togglePanel();
  else if (k === 'f' || k === 'F') window.__toggleFull();
  else if ((k === 'n' || k === 'N' || k === 'p' || k === 'P') && ART.length) { const d = (k === 'n' || k === 'N') ? 1 : -1; playArtwork(((S.cur + d) % ART.length + ART.length) % ART.length); }
  else hit = false;
  if (hit) { e.preventDefault(); S.vyaw = 0; S.vpitch = 0; S.dirty = true; }
});
cv.addEventListener('webglcontextlost', e => e.preventDefault());
cv.addEventListener('webglcontextrestored', () => { if (initGL() && S.n) { uploadStatic(); uploadMotion(); S.dirty = true; } });

// ---------- 모바일 하단 시트 / 탭 ----------
{
  const grab = document.getElementById('grab');
  let g0 = null;
  grab.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; g0 = { x: e.clientX, y: e.clientY }; try { grab.setPointerCapture(e.pointerId); } catch (_) {} });
  grab.addEventListener('pointerup', e => {
    if (!g0) return;
    const land = rootEl.classList.contains('land'), d = land ? e.clientX - g0.x : e.clientY - g0.y; g0 = null;
    if (Math.abs(d) < 8) setSheet(side.dataset.sheet === 'open' ? 'peek' : 'open');
    else setSheet(d < 0 ? 'open' : 'peek');
  });
  grab.addEventListener('pointercancel', () => { g0 = null; });
  document.getElementById('pkOpen').addEventListener('click', () => setSheet(side.dataset.sheet === 'open' ? 'peek' : 'open'));
  document.getElementById('pkToggle').addEventListener('click', () => document.getElementById('bToggle').click());
  new MutationObserver(() => { document.getElementById('pkToggle').textContent = document.getElementById('bToggle').textContent; })
    .observe(document.getElementById('bToggle'), { childList: true, characterData: true, subtree: true });
  document.getElementById('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  // 작품을 고르거나 구성요소/디테일을 누르면 시트를 접어서 그림이 보이게
  document.getElementById('list').addEventListener('click', e => { if (rootEl.classList.contains('compact') && e.target.closest('.item') && side.dataset.sheet === 'open') setTimeout(() => setSheet('peek'), 120); });
  ['chips', 'hots'].forEach(id => document.getElementById(id).addEventListener('click', e => { if (rootEl.classList.contains('compact') && e.target.closest('.chip')) setTimeout(() => setSheet('peek'), 160); }));
  document.getElementById('bAnalyze').addEventListener('click', () => { if (rootEl.classList.contains('compact')) setSheet('peek'); }, true);
}
setTab('works');
applyLayout();
window.addEventListener('resize', applyLayout);
window.addEventListener('orientationchange', () => setTimeout(applyLayout, 200));

// ---------- PC: 패널 숨기기 / 전체화면 ----------
{
  const app = document.getElementById('app');
  const togglePanel = () => app.classList.toggle('nopanel');
  window.__togglePanel = togglePanel;
  document.getElementById('bPanel').addEventListener('click', togglePanel);
  document.getElementById('panelOpen').addEventListener('click', togglePanel);
  const bFull = document.getElementById('bFull');
  if (!document.fullscreenEnabled) bFull.style.display = 'none';
  window.__toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else rootEl.requestFullscreen().catch(() => {}); };
  bFull.addEventListener('click', window.__toggleFull);
  document.addEventListener('fullscreenchange', () => { bFull.textContent = document.fullscreenElement ? '전체화면 끝내기 (F)' : '전체화면 (F)'; });
}

// ---------- 자동 화질 조절: 화면이 느리면 해상도 -> 점 개수 순서로 낮춘다 ----------
let slowCount = 0, adaptCool = performance.now() + 4000, rafTicks = 0;
function setCanvasSize() {
  DPR = Math.min(DPR_CAP, window.devicePixelRatio || 1);
  while (W*H*DPR*DPR > PROFILE.px && DPR > 1) DPR = Math.max(1, DPR - 0.25);
  cv.width = Math.round(W*DPR); cv.height = Math.round(H*DPR);
}
function adaptQuality(fps, drawn, ticks, now) {
  if (document.hidden || now < adaptCool || S.mode !== 'form' && S.mode !== 'scatter') { slowCount = 0; return; }
  if (drawn < 10 || drawn / Math.max(1, ticks) < 0.85) { slowCount = 0; return; }
  if (fps >= (TOUCH ? 34 : 30)) { slowCount = Math.max(0, slowCount - 1); return; }
  if (++slowCount < 3) return;
  slowCount = 0; adaptCool = now + 3000;
  const c = document.getElementById('count');
  if (DPR > 1.01) {
    DPR_CAP = Math.max(1, DPR - 0.5); setCanvasSize(); S.dirty = true;
    statusEl.textContent = '화면이 느려서 해상도를 낮췄어요 (' + Math.round(fps) + 'fps)';
  } else if (S.params.count > 9000) {
    const nc = Math.max(8000, Math.round(S.params.count * 0.72 / 1000) * 1000);
    S.params.count = nc; c.value = nc; c.dispatchEvent(new Event('x-sync')); scheduleRebuild(false);
    statusEl.textContent = '화면이 느려서 점 개수를 ' + nc.toLocaleString() + '개로 줄였어요 (' + Math.round(fps) + 'fps)';
  }
}

// ---------- start: 흩어진 점으로 시작, 목록에서 작품을 고르면 모인다 ----------
(async function start() {
  try { initGL(); } catch (e) { statusEl.textContent = '오류: ' + e.message; return; }
  resize();
  window.addEventListener('error', e => { statusEl.textContent = '오류: ' + e.message; });
  try {
    S.cur = 0;
    await ensureGray(0);
    applyTune(ART[0].meta.tune);
    computeArtwork(0, false);
    drawDepthMap(ART[0].cache.map.depth, ART[0].cache.map.w, ART[0].cache.map.h);
    applyTargets(makeArtworkSet(0), 'scatter', 'init');
    setStatus('흩어진 상태');
    document.querySelectorAll('.item').forEach(x => x.classList.remove('active'));
  } catch (e) { S.err = e.message; statusEl.textContent = '오류: ' + e.message; }
  requestAnimationFrame(frame);
})();
window.__adapt = adaptQuality; window.__prof = () => ({ DPR, DPR_CAP, TOUCH, count: S.params.count });
window.__S = S; window.__ART = ART; window.__startMove = startMove; window.__play = playArtwork;
