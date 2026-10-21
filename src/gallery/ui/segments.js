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
