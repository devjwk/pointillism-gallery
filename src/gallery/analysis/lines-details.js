// Zhang-Suen 세선화: 두꺼운 선을 1픽셀 뼈대로
function thinSkeleton(bin, w, h) {
  const rm = [];
  let changed = true, guard = 0;
  while (changed && guard++ < 40) {
    changed = false;
    for (let step=0; step<2; step++) {
      rm.length = 0;
      for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
        const i = y*w + x; if (!bin[i]) continue;
        const p2 = bin[i-w], p3 = bin[i-w+1], p4 = bin[i+1], p5 = bin[i+w+1], p6 = bin[i+w], p7 = bin[i+w-1], p8 = bin[i-1], p9 = bin[i-w-1];
        const B = p2+p3+p4+p5+p6+p7+p8+p9; if (B < 2 || B > 6) continue;
        const A = (p2===0&&p3===1?1:0) + (p3===0&&p4===1?1:0) + (p4===0&&p5===1?1:0) + (p5===0&&p6===1?1:0) + (p6===0&&p7===1?1:0) + (p7===0&&p8===1?1:0) + (p8===0&&p9===1?1:0) + (p9===0&&p2===1?1:0);
        if (A !== 1) continue;
        if (step === 0) { if (p2*p4*p6 !== 0 || p4*p6*p8 !== 0) continue; }
        else { if (p2*p4*p8 !== 0 || p2*p6*p8 !== 0) continue; }
        rm.push(i);
      }
      if (rm.length) { changed = true; for (let k=0;k<rm.length;k++) bin[rm[k]] = 0; }
    }
  }
}
// 선 분석: 다중 스케일 '어두운 가는 선' 응답 + 경계 응답 -> 히스테리시스 -> 세선화 -> 짧은 조각 제거
function extractLines(lum, w, h) {
  const n = w*h, R = new Float32Array(n);
  for (const s of [0.8, 1.4, 2.2]) {
    const a = gaussBlur(lum, w, h, s), b = gaussBlur(lum, w, h, s*1.8), r = new Float32Array(n);
    for (let i=0;i<n;i++) r[i] = Math.max(0, b[i] - a[i]);
    const hi = percentiles(r, 0.5, 0.995)[1], k = 1/Math.max(1e-4, hi);
    for (let i=0;i<n;i++) { const v = r[i]*k; if (v > R[i]) R[i] = v; }
  }
  const g1 = gaussBlur(lum, w, h, 1.0), mag = new Float32Array(n);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) { const i = y*w + x, gx = g1[i+1] - g1[i-1], gy = g1[i+w] - g1[i-w]; mag[i] = Math.hypot(gx, gy); }
  const mk = 0.55/Math.max(1e-4, percentiles(mag, 0.5, 0.995)[1]);
  const E = new Float32Array(n);
  for (let i=0;i<n;i++) E[i] = Math.max(R[i], mag[i]*mk);
  // 지역 대비 정규화: 얼굴처럼 전체적으로 대비가 낮은 곳의 옅은 선(눈, 코, 입)도 잡는다
  const base = gaussBlur(E, w, h, 0.03*Math.max(w, h));
  for (let i=0;i<n;i++) E[i] = Math.min(1.5, E[i] / (2*base[i] + 0.08));
  const HI = 0.6, LO = 0.3, bin = new Uint8Array(n), stack = [];
  for (let i=0;i<n;i++) if (E[i] > HI) { bin[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) { const xx = x+dx, yy = y+dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy*w + xx; if (!bin[j] && E[j] > LO) { bin[j] = 1; stack.push(j); } }
  }
  thinSkeleton(bin, w, h);
  const lab = new Uint8Array(n), keep = [], st2 = [];
  for (let i0=0;i0<n;i0++) {
    if (!bin[i0] || lab[i0]) continue;
    const comp = []; st2.length = 0; st2.push(i0); lab[i0] = 1;
    while (st2.length) {
      const i = st2.pop(); comp.push(i); const x = i % w, y = (i / w) | 0;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) { const xx = x+dx, yy = y+dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy*w + xx; if (bin[j] && !lab[j]) { lab[j] = 1; st2.push(j); } }
    }
    if (comp.length >= 10) for (let k=0;k<comp.length;k++) keep.push(comp[k]); else for (let k=0;k<comp.length;k++) bin[comp[k]] = 0;
  }
  const strength = new Float32Array(n);
  for (let k=0;k<keep.length;k++) strength[keep[k]] = Math.min(1, E[keep[k]]);
  const mask = gaussBlur(strength, w, h, 0.9);
  for (let i=0;i<n;i++) mask[i] = Math.min(1, mask[i]/0.3);
  const order = Int32Array.from(keep).sort((a, b) => strength[b] - strength[a]);
  return { w, h, strength, mask, order };
}
// 선 위에 일정 간격으로 점을 놓는다 (강한 선부터, 간격은 개수에 맞게 자동 조절)
function selectLineDots(L, cap) {
  const { w, order } = L;
  if (!order.length || cap <= 0) return [];
  let s = 1.4, res = [];
  for (let attempt=0; attempt<8; attempt++) {
    const cell = s, gw = Math.ceil(w/cell) + 2, gh = Math.ceil(L.h/cell) + 2, grid = new Int32Array(gw*gh).fill(-1);
    res = [];
    for (let k=0;k<order.length;k++) {
      const i = order[k], x = i % w, y = (i / w) | 0, cx = (x/cell)|0, cy = (y/cell)|0;
      let ok = true;
      for (let yy=cy-1; yy<=cy+1 && ok; yy++) for (let xx=cx-1; xx<=cx+1; xx++) {
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const j = grid[yy*gw + xx]; if (j < 0) continue;
        const dx = (j % w) - x, dy = ((j / w)|0) - y; if (dx*dx + dy*dy < s*s) { ok = false; break; }
      }
      if (!ok) continue;
      grid[cy*gw + cx] = i; res.push(i);
    }
    if (res.length <= cap*1.15) break;
    s *= 1.25;
  }
  return res.length > cap ? res.slice(0, cap) : res;
}
function computeDetail(lum, w, h) {   // 미세한 선/질감이 많은 곳(얼굴, 손, 옷 주름 등)
  const g = gaussBlur(lum, w, h, 1.0), m = new Float32Array(w*h);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) { const i = y*w + x; m[i] = Math.hypot(g[i+1]-g[i-1], g[i+w]-g[i-w]); }
  return normalizeRange(boxBlur(m, w, h, 3), 0.3, 0.995);
}
function computeHotspots(D, w, h, segIds, segs) {
  const cell = Math.max(8, Math.round(Math.max(w, h)/30)), cw = Math.ceil(w/cell), ch = Math.ceil(h/cell), sc = new Float32Array(cw*ch);
  for (let cy=0;cy<ch;cy++) for (let cx=0;cx<cw;cx++) {
    let s = 0, c = 0; for (let y=cy*cell; y<Math.min(h, (cy+1)*cell); y++) for (let x=cx*cell; x<Math.min(w, (cx+1)*cell); x++) { s += D[y*w+x]; c++; }
    sc[cy*cw+cx] = s/Math.max(1,c);
  }
  const sm = new Float32Array(cw*ch);
  for (let cy=0;cy<ch;cy++) for (let cx=0;cx<cw;cx++) { let s=0,c=0; for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) { const x=cx+dx,y=cy+dy; if (x<0||y<0||x>=cw||y>=ch) continue; s+=sc[y*cw+x]; c++; } sm[cy*cw+cx]=s/c; }
  const out = []; let top = 0;
  for (let k=0;k<6;k++) {
    let bi = -1, bv = 0; for (let i=0;i<sm.length;i++) if (sm[i] > bv) { bv = sm[i]; bi = i; }
    if (bi < 0 || bv < 0.12) break; if (k === 0) top = bv; if (bv < top*0.5) break;
    const cx = bi % cw, cy = (bi / cw)|0;
    const px = Math.min(w-1, ((cx+0.5)*cell)|0), py = Math.min(h-1, ((cy+0.5)*cell)|0);
    const sid = segIds ? segIds[py*w+px] : 0; let nm = '';
    if (segs) { const sg = segs.find(s => s.id === sid); nm = sg ? sg.ko : ''; }
    out.push({ cx: (cx+0.5)*cell/w, cy: (cy+0.5)*cell/h, w: Math.min(1, 3*cell/w), h: Math.min(1, 3*cell/h), score: bv, seg: nm });
    for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) { const x=cx+dx,y=cy+dy; if (x>=0&&y>=0&&x<cw&&y<ch) sm[y*cw+x]=0; }
  }
  return out;
}
