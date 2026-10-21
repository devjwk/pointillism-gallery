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
