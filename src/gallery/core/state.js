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

