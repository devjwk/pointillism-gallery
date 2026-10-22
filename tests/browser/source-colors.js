// 실제 갤러리의 색상 작성 함수와 WebGL 셰이더를 사용한 점 중심 색 검사.
// 개인 사진·모델·외부 요청 없이 합성 색상만 사용한다.
function runSourceColorGPUCheck({vertexSource,fragmentSource,writeColors}) {
  const palette=[[0,0,0],[32,32,32],[64,64,64],[128,128,128],[192,192,192],[255,255,255],[255,0,0],[0,255,0],[0,0,255],[128,64,32],[218,198,158],[24,48,72]];
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=120;
  const gl=canvas.getContext('webgl',{antialias:false,preserveDrawingBuffer:true,alpha:true,premultipliedAlpha:true});
  if(!gl)throw new Error('WebGL unavailable');
  const compile=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  const vs=compile(gl.VERTEX_SHADER,vertexSource),fs=compile(gl.FRAGMENT_SHADER,fragmentSource),program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const n=palette.length,set={n,nx:Float32Array.from(palette,(_,i)=>(i+.5)/n),ny:new Float32Array(n).fill(.5)};
  const map={w:n,h:1,lum:Float32Array.from(palette,c=>(.2126*c[0]+.7152*c[1]+.0722*c[2])/255),rgb:{w:n,h:1,data:Uint8Array.from(palette.flat())}};writeColors(set,map,0);
  const buffers=[];function attribute(name,size,data){const loc=gl.getAttribLocation(program,name);if(loc<0)return;const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}
  const positions=palette.flatMap((_,i)=>[40+80*i-canvas.width/2,0,0]);
  attribute('a_from',3,positions);attribute('a_to',3,positions);attribute('a_anim',4,palette.flatMap(()=>[0,1,0,0]));attribute('a_misc',4,palette.flatMap((_,i)=>[map.lum[i],1,0,0]));attribute('a_col',3,set.col);
  const f=(name,v)=>gl.uniform1f(gl.getUniformLocation(program,name),v);
  for(const[name,v]of Object.entries({u_time:2,u_form:1,u_pass:0,u_size:12,u_glow:0,u_zoom:1,u_dpr:1,u_dof:0,u_mpow:0,u_sel:-1,u_selpow:0,u_line:1,u_lineview:0,u_color:1,u_sat:1,u_chan:0,u_split:0,u_spread:0,u_flat:0,u_darkBackground:0,u_invertColor:0}))f(name,v);
  gl.uniform2f(gl.getUniformLocation(program,'u_half'),canvas.width/2,canvas.height/2);gl.uniform2f(gl.getUniformLocation(program,'u_mouse'),0,0);gl.uniform3f(gl.getUniformLocation(program,'u_pan'),0,0,0);gl.uniform4f(gl.getUniformLocation(program,'u_cam'),1,0,1,0);gl.viewport(0,0,canvas.width,canvas.height);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  const results=[];
  for(const[mode,invert,color]of[['source',0,1],['inverted',1,1],['grayscale',0,0],['source-restored',0,1]]){
    f('u_invertColor',invert);f('u_color',color);gl.clearColor(229/255,229/255,229/255,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.POINTS,0,n);
    for(let i=0;i<n;i++){const pixel=new Uint8Array(4);gl.readPixels(40+80*i,60,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const expected=color?palette[i].map(v=>invert?255-v:v):new Array(3).fill(Math.round(.2126*palette[i][0]+.7152*palette[i][1]+.0722*palette[i][2]));const error=Math.max(...expected.map((v,c)=>Math.abs(v-pixel[c])));results.push({mode,source:palette[i],expected,actual:Array.from(pixel),maximumChannelError:error});}
  }
  const glError=gl.getError(),maximumChannelError=Math.max(...results.map(r=>r.maximumChannelError));
  for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();
  return {passed:maximumChannelError<=1&&glError===0,paletteCount:n,checks:results.length,maximumChannelError,glError,results,scope:'Opaque point centers in a controlled synthetic fixture. Not a whole-image perceptual or mobile-performance score.'};
}
