// 깊이 단서(부조/명암) 가중치만 바뀌면 점을 다시 찍지 않고 깊이만 다시 계산한다
let depthTimer = null;
function scheduleDepthRefresh() {
  clearTimeout(depthTimer);
  depthTimer = setTimeout(() => {
    const a = ART[S.cur]; if (!a || !a.cache) return;
    const { map, pts } = a.cache;
    map.depth = composeDepth(map, S.params);
    for (let i=0;i<pts.x.length;i++) pts.d[i] = map.depth[Math.min(map.h-1, (pts.y[i]*map.h)|0)*map.w + Math.min(map.w-1, (pts.x[i]*map.w)|0)];
    drawDepthMap(map.depth, map.w, map.h);
    rebuild(true, true);
  }, 120);
}
let rebuildTimer = null;
function scheduleRebuild(reuse) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => rebuild(true, !!reuse), 180); }
function bindRange(id, outId, key, fmt) {
  const el = document.getElementById(id), out = document.getElementById(outId);
  const show = () => {
    const text = fmt ? fmt(+el.value) : el.value;
    out.textContent = text;
    if (key === 'density') el.setAttribute('aria-valuetext', text);
  };
  el.addEventListener('input', () => {
    S.params[key] = +el.value; show();
    if (key === 'density' || key === 'size' || key === 'glow' || key === 'dof' || key === 'lineDots' || key === 'color' || key === 'sat' || key === 'split') { S.dirty = true; return; }
    if (key === 'wb') { refreshSourceColors(); return; }
    if (key === 'depth') { retargetDepth(); return; }
    if (key === 'relief' || key === 'tone' || key === 'unify' || key === 'sep') { scheduleDepthRefresh(); return; }
    scheduleRebuild(key === 'fill' || key === 'wb');
  });
  el.addEventListener('x-sync', show);
  show();
}
bindRange('count','oCount','count', v => v.toLocaleString());
bindRange('density','oDensity','density', v => Math.round(v*100) + '%');
bindRange('contrast','oContrast','contrast', v => v.toFixed(2));
bindRange('gamma','oGamma','gamma', v => v.toFixed(2));
bindRange('size','oSize','size', v => v.toFixed(2));
bindRange('glow','oGlow','glow', v => v.toFixed(2));
bindRange('dof','oDof','dof', v => v.toFixed(2));
bindRange('depth','oDepth','depth', v => v.toFixed(2));
bindRange('fill','oFill','fill', v => v.toFixed(1));
bindRange('relief','oRelief','relief', v => v.toFixed(2));
bindRange('detail','oDetail','detail', v => v.toFixed(1));
bindRange('color','oColor','color', v => v.toFixed(2));
bindRange('wb','oWb','wb', v => v.toFixed(2));
bindRange('sat','oSat','sat', v => v.toFixed(2));
bindRange('split','oSplit','split', v => v.toFixed(2));
bindRange('localContrast','oLocal','localContrast', v => v.toFixed(2));
bindRange('lineTone','oLineTone','lineTone', v => v.toFixed(2));
bindRange('lineDots','oLineDots','lineDots', v => v.toFixed(2));
document.getElementById('bLine').addEventListener('click', e => { S.lineView = !S.lineView; e.target.textContent = S.lineView ? '선 분석 보기: 켜짐' : '선 분석 보기'; S.dirty = true; });
bindRange('unify','oUnify','unify', v => v.toFixed(2));
bindRange('sep','oSep','sep', v => v.toFixed(2));
bindRange('tone','oTone','tone', v => v.toFixed(2));
document.getElementById('depth').addEventListener('change', () => scheduleRebuild(true));

document.getElementById('list').addEventListener('click', e => {
  const it = e.target.closest('.item'); if (!it) return;
  playArtwork(+it.dataset.idx);
});
document.getElementById('bToggle').addEventListener('click', () => startMove(S.mode === 'form' ? 'scatter' : 'form'));
document.getElementById('bRotate').addEventListener('click', () => { if (S.cur < 0) return; ART[S.cur].rotation = (ART[S.cur].rotation+1) % 4; rebuild(true, false); });
// 색 반전과 배경은 표시만 바꾼다. 점 위치·중요도·깊이는 다시 계산하지 않는다.
document.getElementById('bTone').addEventListener('click', () => setTone(!S.params.invertTone));
document.getElementById('bOriginal').addEventListener('click', () => restoreSourceColors());
document.getElementById('bBackground').addEventListener('click', () => setStageBackground(!S.darkBackground));
document.getElementById('bInvert').addEventListener('click', () => { S.invert = !S.invert; retargetDepth(); });
document.getElementById('bLimit').addEventListener('click', () => setRotationMode(!S.limit));
document.getElementById('bUpload').addEventListener('click', () => document.getElementById('file').click());
document.getElementById('file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f), im = new Image();
  im.onload = () => {
    try {
      const gray = grayFromImage(im);
      ART.push({ meta: { id: 'upload', title: f.name.replace(/\.[^.]+$/, ''), artist: '내 이미지', year: '', tune: null }, gray, rotation: 0, cache: null, url });
      const idx = ART.length - 1; addListItem(idx);
      playArtwork(idx).then(() => { if (!TOUCH || confirm('AI 깊이 추정은 휴대폰에서 30초~1분 걸리고 배터리를 많이 써요. 진행할까요? (취소하면 밝기 기반 깊이로 보여줘요)')) runDepthEstimate(idx, url); });
    } catch (err) { statusEl.textContent = '오류: ' + err.message; }
  };
  im.onerror = () => { statusEl.textContent = '오류: 이미지를 불러오지 못했어요'; };
  im.src = url;
});

