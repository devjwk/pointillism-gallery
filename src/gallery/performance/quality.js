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

