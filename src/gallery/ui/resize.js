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

