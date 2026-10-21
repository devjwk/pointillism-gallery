// ---------- 밝기 가중 점 찍기 ----------
const densityOf = l => l*l*0.6 + l*0.4;
function stipple(map, N) {
  const { w, h, lum } = map;
  const dens = map.dens || (() => { const a = new Float32Array(w*h); for (let i=0;i<w*h;i++) a[i] = densityOf(lum[i]); return a; })();
  let sum = 0, mx = 0;
  for (let i=0;i<w*h;i++) { const d = dens[i]; sum += d; if (d > mx) mx = d; }
  if (sum < 1e-6) return { x:[], y:[], l:[], d:[], w, h, rb: 1 };
  const cdf = new Float64Array(w*h); let acc = 0;
  for (let i=0;i<w*h;i++) { acc += dens[i]; cdf[i] = acc; }
  const mean = sum / (w*h);
  const pick = () => {
    const r = Math.random()*acc; let lo = 0, hi = cdf.length-1;
    while (lo < hi) { const m = (lo+hi) >> 1; if (cdf[m] < r) lo = m+1; else hi = m; }
    return lo;
  };
  let rBase = 0.62 * Math.sqrt((w*h) / N), best = null;
  for (let attempt=0; attempt<7; attempt++) {
    const rMin = rBase / Math.sqrt(Math.max(1, mx/mean));
    const cell = Math.max(0.5, rMin / Math.SQRT2);
    const gw = Math.ceil(w/cell) + 1, gh = Math.ceil(h/cell) + 1;
    const grid = new Int32Array(gw*gh).fill(-1);
    const xs = [], ys = [];
    const maxTries = N*18;
    for (let t=0; t<maxTries && xs.length<N; t++) {
      const idx = pick();
      const px = (idx % w) + Math.random(), py = Math.floor(idx / w) + Math.random();
      const d = dens[idx];
      const rLoc = Math.min(rBase*3.5, rBase / Math.sqrt(Math.max(0.05, d/mean)));
      const cx = Math.floor(px/cell), cy = Math.floor(py/cell), rc = Math.ceil(rLoc/cell);
      let ok = true;
      for (let yy=Math.max(0,cy-rc); yy<=Math.min(gh-1,cy+rc) && ok; yy++)
        for (let xx=Math.max(0,cx-rc); xx<=Math.min(gw-1,cx+rc); xx++) {
          const j = grid[yy*gw+xx]; if (j < 0) continue;
          const dx = xs[j]-px, dy = ys[j]-py;
          if (dx*dx + dy*dy < rLoc*rLoc) { ok = false; break; }
        }
      if (!ok) continue;
      grid[cy*gw+cx] = xs.length;
      xs.push(px); ys.push(py);
    }
    best = { x: xs, y: ys };
    if (xs.length >= N*0.95) break;
    rBase *= 0.82;
  }
  const n = best.x.length, pts = { x: new Array(n), y: new Array(n), l: new Array(n), d: new Array(n), w, h, rb: rBase };
  for (let i=0;i<n;i++) {
    pts.x[i] = best.x[i]/w; pts.y[i] = best.y[i]/h;
    const ix = Math.min(w-1, best.x[i]|0), iy = Math.min(h-1, best.y[i]|0);
    pts.l[i] = lum[iy*w+ix]; pts.d[i] = map.depth[iy*w+ix];
  }
  return pts;
}

// ---------- Lloyd 완화: 밝기 가중 Voronoi 무게중심으로 점을 이동시켜 고르게 퍼뜨림 ----------
function relax(pts, map, iters) {
  const W0 = map.w, H0 = map.h, n = pts.x.length;
  if (!n || iters <= 0) return;
  const f = (W0*H0 > 350000) ? 2 : 1, w = Math.floor(W0/f), h = Math.floor(H0/f);   // 큰 이미지는 절반 해상도에서 완화
  const dens = new Float32Array(w*h); let sum = 0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    let a = 0;
    for (let dy=0;dy<f;dy++) for (let dx=0;dx<f;dx++) { const i = (y*f+dy)*W0 + x*f + dx; a += map.dens ? map.dens[i] : densityOf(map.lum[i]); }
    dens[y*w+x] = a/(f*f); sum += dens[y*w+x];
  }
  const dmin = (sum / (w*h)) * 0.04;
  const X = new Float32Array(n), Y = new Float32Array(n);
  for (let i=0;i<n;i++) { X[i] = pts.x[i]*w; Y[i] = pts.y[i]*h; }
  const cell = Math.max(2, Math.ceil(pts.rb/f));
  const gw = Math.ceil(w/cell), gh = Math.ceil(h/cell);
  for (let it=0; it<iters; it++) {
    const head = new Int32Array(gw*gh).fill(-1), next = new Int32Array(n);
    for (let i=0;i<n;i++) {
      const c = Math.min(gh-1, Math.max(0, (Y[i]/cell)|0))*gw + Math.min(gw-1, Math.max(0, (X[i]/cell)|0));
      next[i] = head[c]; head[c] = i;
    }
    const sx = new Float64Array(n), sy = new Float64Array(n), sw = new Float64Array(n);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const d = dens[y*w+x]; if (d < dmin) continue;
      const px = x + 0.5, py = y + 0.5, cx = (px/cell)|0, cy = (py/cell)|0;
      let best = -1, bd = Infinity;
      for (let k=0;k<=10;k++) {
        for (let yy=cy-k; yy<=cy+k; yy++) {
          if (yy < 0 || yy >= gh) continue;
          const edgeRow = (yy === cy-k || yy === cy+k);
          for (let xx=cx-k; xx<=cx+k; xx += (edgeRow ? 1 : 2*k || 1)) {
            if (xx < 0 || xx >= gw) continue;
            for (let j=head[yy*gw+xx]; j>=0; j=next[j]) {
              const dx = X[j]-px, dy = Y[j]-py, d2 = dx*dx + dy*dy;
              if (d2 < bd) { bd = d2; best = j; }
            }
          }
        }
        if (best >= 0 && bd <= (k*cell)*(k*cell)) break;
      }
      if (best >= 0) { sx[best] += px*d; sy[best] += py*d; sw[best] += d; }
    }
    for (let i=0;i<n;i++) if (sw[i] > 0) { X[i] = sx[i]/sw[i]; Y[i] = sy[i]/sw[i]; }
  }
  for (let i=0;i<n;i++) {
    const x = clamp(X[i], 0, w - 0.001), y = clamp(Y[i], 0, h - 0.001);
    pts.x[i] = x/w; pts.y[i] = y/h;
    const k = Math.min(H0-1, (pts.y[i]*H0)|0)*W0 + Math.min(W0-1, (pts.x[i]*W0)|0); pts.l[i] = map.lum[k]; pts.d[i] = map.depth[k];
  }
}

