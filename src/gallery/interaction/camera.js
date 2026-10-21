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

