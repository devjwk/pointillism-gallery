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

