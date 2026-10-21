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

