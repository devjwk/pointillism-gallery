// ---------- 빈틈 채우기: 깊이 차이가 큰 곳에 보간 점 (밝기는 앞/뒤 점 사이를 섞음) ----------
function buildSkirts(map, pts, cap) {
  const out = { x: [], y: [], l: [], d: [], p: [] };
  const fill = S.params.fill;
  if (fill <= 0.01 || cap <= 0) return out;
  const { w, h, depth, lum } = map;
  const b = imageBox();
  const scale = b.w / w, amp = S.params.depth * Math.min(b.w, b.h) * 0.6;
  const sp = Math.max(1, pts.rb * 0.8), spW = sp * scale, r = Math.max(1, Math.round(sp));
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  const nb = pts.x.length;
  const cand = []; let total = 0;
  for (let i=0;i<nb;i++) {
    const ix = Math.min(w-1, Math.floor(pts.x[i]*w)), iy = Math.min(h-1, Math.floor(pts.y[i]*h));
    const dA = depth[iy*w+ix];
    let dMin = dA, bx = 0, by = 0, bl = 0;
    for (const [dx,dy] of dirs) {
      const x2 = ix + dx*r, y2 = iy + dy*r;
      if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
      const dv = depth[y2*w+x2];
      if (dv < dMin) { dMin = dv; bx = dx*r; by = dy*r; bl = lum[y2*w+x2]; }
    }
    if (dMin >= dA - 0.01) continue;
    const dz = (dA - dMin) * amp;
    const len = Math.hypot(Math.hypot(bx,by)*scale, dz);
    const k = Math.min(10, Math.floor(len / spW * fill) - 1);
    if (k <= 0) continue;
    cand.push(i, k, bx, by, dA, dMin, bl); total += k;
  }
  const keep = total > cap ? cap/total : 1;
  for (let c=0;c<cand.length;c+=7) {
    const i = cand[c], k = cand[c+1], bx = cand[c+2], by = cand[c+3], dA = cand[c+4], dB = cand[c+5], bl = cand[c+6];
    for (let j=1;j<=k;j++) {
      if (keep < 1 && Math.random() > keep) continue;
      if (out.x.length >= cap) return out;
      const t = j/(k+1);
      out.x.push((pts.x[i]*w + bx*t + (Math.random()-0.5)*0.6) / w);
      out.y.push((pts.y[i]*h + by*t + (Math.random()-0.5)*0.6) / h);
      out.l.push(pts.l[i]*(1-t) + bl*t);
      out.d.push(dA + (dB-dA)*t);
      out.p.push(i);
    }
  }
  return out;
}

