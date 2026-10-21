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

