// =====================================================================
//  WebGL renderer: 이동/곡선/3D 투영/초점 흐림/마우스 반응을 GPU 셰이더에서 계산
// =====================================================================
// 같은 점의 phase/noise를 재사용하므로 밀집도를 되돌리면 같은 배치로 돌아옵니다.
function densitySpread(density, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const value = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 1;
  return (1 - value) * Math.min(width, height) * 0.12;
}
function densityOffset(phase, noise, spread, out = [0, 0, 0]) {
  const turn = noise * Math.PI * 2;
  out[0] = Math.sin(phase + turn) * spread;
  out[1] = Math.cos(phase * 2 + turn) * spread;
  out[2] = Math.sin(phase * 3 - turn) * spread * 0.35;
  return out;
}
const VS = `
attribute vec3 a_from; attribute vec3 a_to; attribute vec4 a_anim; attribute vec4 a_misc; attribute vec3 a_col;
uniform float u_time, u_form, u_pass, u_size, u_glow, u_zoom, u_dpr, u_dof, u_mpow, u_sel, u_selpow, u_line, u_lineview, u_color, u_sat, u_chan, u_split, u_spread, u_invertColor, u_flat, u_darkBackground;
uniform vec3 u_pan;
uniform vec2 u_half; uniform vec2 u_mouse; uniform vec4 u_cam;
varying float v_a; varying float v_pass; varying float v_soft; varying vec3 v_col; varying float v_chan;
const float F = 1500.0;
vec3 densityOffset3(float ph, float zr, float amount) {
  float turn = zr * 6.28318530718;
  return vec3(sin(ph + turn), cos(ph * 2.0 + turn), sin(ph * 3.0 - turn) * 0.35) * amount;
}
void main() {
  float p = clamp((u_time - a_anim.x) / a_anim.y, 0.0, 1.0);
  float e = p < 0.5 ? 4.0*p*p*p : 1.0 - pow(-2.0*p + 2.0, 3.0) / 2.0;
  vec3 pos = mix(a_from, a_to, e);
  vec2 d = a_to.xy - a_from.xy;
  float len = max(length(d), 0.001);
  float sw = sin(3.14159265 * e) * min(120.0, len * 0.22) * a_anim.z;
  pos.xy += vec2(-d.y, d.x) / len * sw;
  float zr = a_misc.z, ph = a_anim.w;
  float a2 = (u_form > 0.5 ? 0.55 : 6.0 + 14.0*zr) * e;
  pos.x += sin(u_time*(0.6 + zr) + ph) * a2;
  pos.y += cos(u_time*(0.5 + zr*0.8) + ph*1.3) * a2;
  pos.z += sin(u_time*0.7 + ph*2.0) * a2 * 0.8;
  // e=0에서는 출발 위치에 이미 반영된 흩어짐을 다시 더하지 않습니다.
  if (u_form > 0.5 && u_spread > 0.0) pos += densityOffset3(ph, zr, u_spread * e);
  pos -= u_pan;                                  // 확대할 지점을 화면 중심으로
  float x1 = pos.x*u_cam.x + pos.z*u_cam.y;
  float z1 = -pos.x*u_cam.y + pos.z*u_cam.x;
  float y2 = pos.y*u_cam.z - z1*u_cam.w;
  float z2 = pos.y*u_cam.w + z1*u_cam.z;
  float den = F + z2;
  float l = a_misc.x;
  float typ = floor(a_misc.w / 256.0 + 0.001);   // 1 = 윤곽선 점
  float seg = a_misc.w - typ*256.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_a = 0.0; v_pass = u_pass; v_soft = 0.0; v_chan = u_chan;
  // RGB의 밝기를 유지한다. 채도 1·색 반영 1·반전 꺼짐이면 입력 점 색 그대로다.
  float sourceLuma = dot(a_col, vec3(0.2126, 0.7152, 0.0722));
  vec3 saturated = clamp(vec3(sourceLuma) + (a_col - vec3(sourceLuma)) * u_sat, 0.0, 1.0);
  v_col = mix(vec3(sourceLuma), saturated, u_color);
  if (u_invertColor > 0.5) v_col = vec3(1.0) - v_col;
  if (u_flat > 0.5) v_col = u_darkBackground > 0.5 ? vec3(0.95) : vec3(0.12);
  if (den < 200.0) return;
  float f = F / den;
  vec2 s = vec2(x1, y2) * f * u_zoom;
  if (u_mpow > 0.001) {                       // 커서 주변 점이 밀려난다
    vec2 dm = s - u_mouse; float dist = length(dm);
    float k = u_mpow * pow(max(0.0, 1.0 - dist / 110.0), 2.0);
    s += dm / max(dist, 1.0) * k * 46.0;
  }
  if (u_chan > 0.5) s.x += (u_chan - 2.0) * u_split * (2.0 + 6.0*abs(z2)/450.0);   // 깊이에 따라 R/G/B를 어긋나게 (색수차)
  float pf = f * u_zoom;
  float fade = clamp(0.8 + (f - 1.0)*1.6, 0.2, 1.1);
  float defocus = u_dof * clamp(abs(z2) / 450.0, 0.0, 1.0);   // 초점면(그림 평면)에서 멀수록 흐림
  if (u_pass < 0.5) {
    float r = 0.95 * u_size * pf * (1.0 + defocus*1.1);
    gl_Position = vec4(s.x / u_half.x, -s.y / u_half.y, 0.0, 1.0);
    gl_PointSize = max(2.0, 2.0*r*u_dpr + 1.5);
    // 기본 점의 검정·회색도 같은 불투명도로 그린다. 밝기 이중 적용을 막는다.
    v_a = a_misc.y * (1.0 - 0.38*defocus);
    v_soft = defocus;
  } else {
    bool ok = u_form > 0.5 ? l >= 0.5 : f >= 1.05;
    if (!ok || u_glow < 0.01) return;
    float r = (3.2 + 5.0*l) * u_size * pf;
    gl_Position = vec4(s.x / u_half.x, -s.y / u_half.y, 0.0, 1.0);
    gl_PointSize = 2.0 * r * u_dpr;
    v_a = u_glow * (u_form > 0.5 ? 0.25 + 0.5*l : 0.22) * fade * a_misc.y * clamp(1.6 / u_zoom, 0.2, 1.0);   // 확대하면 번짐을 줄여 세부가 보이게
  }
  if (typ > 0.5) v_a *= u_line;                  // 윤곽선 점은 슬라이더로 세기 조절
  if (u_lineview > 0.5) {                        // 선 분석 보기: 추출한 선만 또렷하게
    if (typ > 0.5) { v_col = u_darkBackground > 0.5 ? vec3(1.0) : vec3(0.08); v_a = (u_pass < 0.5 ? 0.95 : 0.35*u_glow) * a_misc.y; if (u_pass < 0.5) gl_PointSize *= 1.2; }
    else v_a *= 0.08;
  }
  if (u_sel >= 0.0 && u_selpow > 0.001) {      // 선택한 구성요소만 또렷하게, 나머지는 흐리게
    float isSel = abs(seg - u_sel) < 0.5 ? 1.0 : 0.0;
    v_a *= mix(1.0, mix(0.1, 1.35, isSel), u_selpow);
    if (u_pass < 0.5) gl_PointSize *= mix(1.0, mix(0.85, 1.25, isSel), u_selpow);
  }
}`;
const FS = `
precision mediump float;
varying float v_a; varying float v_pass; varying float v_soft; varying vec3 v_col; varying float v_chan;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a;
  if (v_pass < 0.5) a = 1.0 - smoothstep(0.6 - 0.45*v_soft, 1.0, d);
  else { float t = 1.0 - d; a = 0.55 * t * t; }
  a *= v_a;
  vec3 col = v_col;
  if (v_chan > 0.5) { col *= vec3(v_chan < 1.5 ? 1.0 : 0.0, (v_chan > 1.5 && v_chan < 2.5) ? 1.0 : 0.0, v_chan > 2.5 ? 1.0 : 0.0); a *= 0.75; }
  gl_FragColor = vec4(col*a, a);   // premultiplied
}`;

let gl = null, GLP = null, GLU = {}, GLB = {};
function initGL() {
  gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
  if (!gl) { statusEl.textContent = '오류: 이 브라우저는 WebGL을 지원하지 않아요'; return false; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  GLP = gl.createProgram();
  gl.attachShader(GLP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(GLP, sh(gl.FRAGMENT_SHADER, FS));
  ['a_from', 'a_to', 'a_anim', 'a_misc', 'a_col'].forEach((n, i) => gl.bindAttribLocation(GLP, i, n));
  gl.linkProgram(GLP);
  if (!gl.getProgramParameter(GLP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(GLP));
  ['u_time','u_form','u_pass','u_size','u_glow','u_zoom','u_dpr','u_dof','u_mpow','u_sel','u_selpow','u_line','u_lineview','u_color','u_sat','u_chan','u_split','u_spread','u_invertColor','u_flat','u_darkBackground','u_pan','u_half','u_mouse','u_cam'].forEach(n => GLU[n] = gl.getUniformLocation(GLP, n));
  ['from','to','anim','misc','col'].forEach(k => GLB[k] = gl.createBuffer());
  gl.enable(gl.BLEND);
  return true;
}
function uploadStatic() {
  if (!gl) return;
  const n = S.n, m = new Float32Array(n*4);
  for (let i=0;i<n;i++) { m[4*i] = S.lum[i]; m[4*i+1] = S.sa[i]; m[4*i+2] = S.z[i]; m[4*i+3] = S.sg[i]; }
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.misc); gl.bufferData(gl.ARRAY_BUFFER, m, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.col); gl.bufferData(gl.ARRAY_BUFFER, S.col, gl.STATIC_DRAW);
}
function uploadMotion() {
  if (!gl) return;
  const n = S.n, form = S.mode === 'form';
  const f = new Float32Array(n*3), t = new Float32Array(n*3), a = new Float32Array(n*4);
  let end = 0;
  for (let i=0;i<n;i++) {
    f[3*i] = S.fx[i]; f[3*i+1] = S.fy[i]; f[3*i+2] = S.fz[i];
    if (form) { t[3*i] = S.tx[i]; t[3*i+1] = S.ty[i]; t[3*i+2] = S.tz[i]; }
    else { t[3*i] = S.sx[i]; t[3*i+1] = S.sy[i]; t[3*i+2] = S.sz[i]; }
    a[4*i] = S.t0[i] / 1000; a[4*i+1] = S.dur[i] / 1000; a[4*i+2] = S.swirl[i]; a[4*i+3] = S.phase[i];
    const e = S.t0[i] + S.dur[i]; if (e > end) end = e;
  }
  S.endTime = end; S.dirty = true;
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.from); gl.bufferData(gl.ARRAY_BUFFER, f, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.to);   gl.bufferData(gl.ARRAY_BUFFER, t, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, GLB.anim); gl.bufferData(gl.ARRAY_BUFFER, a, gl.DYNAMIC_DRAW);
}

// CPU에서 현재 위치가 필요할 때 GPU 셰이더와 같은 수식으로 계산
function snapshot(now) {
  const time = now / 1000, form = S.mode === 'form';
  const box = form && !S.flat ? imageBox() : null;
  const spread = box ? densitySpread(S.density, box.w, box.h) : 0;
  const offset = [0, 0, 0];
  for (let i=0;i<S.n;i++) {
    const p = clamp((now - S.t0[i]) / S.dur[i], 0, 1), e = ease(p);
    const toX = form ? S.tx[i] : S.sx[i], toY = form ? S.ty[i] : S.sy[i], toZ = form ? S.tz[i] : S.sz[i];
    let x = S.fx[i] + (toX - S.fx[i]) * e, y = S.fy[i] + (toY - S.fy[i]) * e, z = S.fz[i] + (toZ - S.fz[i]) * e;
    const dx = toX - S.fx[i], dy = toY - S.fy[i], len = Math.max(Math.hypot(dx, dy), 0.001);
    const sw = Math.sin(Math.PI * e) * Math.min(120, len * 0.22) * S.swirl[i];
    x += (-dy / len) * sw; y += (dx / len) * sw;
    const zr = S.z[i], ph = S.phase[i], a2 = (form ? 0.55 : 6 + 14*zr) * e;
    x += Math.sin(time*(0.6 + zr) + ph) * a2;
    y += Math.cos(time*(0.5 + zr*0.8) + ph*1.3) * a2;
    z += Math.sin(time*0.7 + ph*2) * a2 * 0.8;
    if (spread > 0) {
      densityOffset(ph, zr, spread * e, offset);
      x += offset[0]; y += offset[1]; z += offset[2];
    }
    S.rx[i] = x; S.ry[i] = y; S.rz[i] = z;
  }
}

