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

