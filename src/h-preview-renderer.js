/** H 표시 전용 GPU 미리보기. 셀 텍스처는 입력 변경 때만 만들며 정확한 내보내기 경로와 분리해요. */
import { hPalette, hProjection } from './h-render.js';
import { hFacePoint } from './h-layout.js';
import { H_FACE_IDS } from './h-profile.js';
import { CUBE_OUTLINE_COLOR } from './cube-outline.js';
import { hCornerQrMetrics } from './generator-h-qr.js';
import { qrMatrix } from './qr.js';
import {hDisplayImageSource,hDisplayMap} from './h-face-arrangement.js';
import {resolveHLighting,hLightingGround,isHUnshadedLevel} from './h-lighting.js';

const CAMERA = [-1 / Math.sqrt(3), -1 / Math.sqrt(3), -1 / Math.sqrt(3)];
const RIGHT = [1 / Math.sqrt(2), -1 / Math.sqrt(2), 0];
const DOWN = [-1 / Math.sqrt(6), -1 / Math.sqrt(6), 2 / Math.sqrt(6)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const rgba = color => [color.r / 255, color.g / 255, color.b / 255, 1];
const outlineWidth = n => Math.min(.1, Math.max(.08, n * .006) / 2);

function shader(gl, type, source) {
  const handle = gl.createShader(type);
  gl.shaderSource(handle, source);
  gl.compileShader(handle);
  if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(handle) || 'WebGL shader compilation failed';
    gl.deleteShader(handle);
    throw new Error(message);
  }
  return handle;
}

function program(gl) {
  const vertex = shader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aClip;
    attribute vec2 aUv;
    varying vec2 vUv;
    void main() { gl_Position = vec4(aClip.xy, 0.0, aClip.z); vUv = aUv; }
  `);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec4 uOutline;
    uniform float uEdge;
    uniform float uOutlineOn;
    uniform float uFaceGain;
    uniform float uRotationFill;
    uniform float uCodeFace;
    void main() {
      vec4 pixel = texture2D(uTexture, vUv);
      float nearEdge = step(vUv.x, uEdge) + step(vUv.y, uEdge)
        + step(1.0 - uEdge, vUv.x) + step(1.0 - uEdge, vUv.y);
      // 코드 텍스처 alpha는 불투명도가 아니라 level3/4 역할 비트예요.
      // RGB가 흰 데이터도 존재하므로 색상 비교로 보호 대상을 추측하지 않아요.
      float marker = uCodeFace * step(.5, pixel.a);
      float gain = mix(uFaceGain, 1.0, marker);
      float fill = uRotationFill * (1.0 - marker);
      pixel = vec4((pixel.rgb+fill*pixel.rgb*(1.0-pixel.rgb))*gain,mix(pixel.a,1.0,uCodeFace));
      if (uOutlineOn > .5 && nearEdge > .5) pixel = uOutline;
      gl_FragColor = pixel;
    }
  `);
  const handle = gl.createProgram();
  gl.attachShader(handle, vertex); gl.attachShader(handle, fragment); gl.linkProgram(handle);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(handle) || 'WebGL program link failed';
    gl.deleteProgram(handle);
    throw new Error(message);
  }
  return handle;
}

function groundProgram(gl){const vertex=shader(gl,gl.VERTEX_SHADER,'attribute vec2 aClip; attribute float aAlpha; varying float vAlpha; void main(){gl_Position=vec4(aClip,0.,1.);vAlpha=aAlpha;}');const fragment=shader(gl,gl.FRAGMENT_SHADER,'precision mediump float; varying float vAlpha; uniform vec3 uColor; void main(){gl_FragColor=vec4(uColor,vAlpha);}');const handle=gl.createProgram();gl.attachShader(handle,vertex);gl.attachShader(handle,fragment);gl.linkProgram(handle);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(handle,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(handle)||'ground program');return handle;}

function canvasFor(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
  }
  return null;
}

function paletteSignature(colors) {
  return `${colors.colors.map(color => `${color.r},${color.g},${color.b}`).join('|')}|${colors.background
    ? `${colors.background.r},${colors.background.g},${colors.background.b}` : 'transparent'}`;
}

function faceImageSignature(faceImages,displayMap) {
  return H_FACE_IDS.map(face => {
    const image = hDisplayImageSource(displayMap,faceImages,face)?.image;
    // data URI를 매 frame cache key로 이어 붙이면 수 MB 문자열 비교가 hot path로 들어와요.
    // pixels identity와 치수면 이 renderer가 실제로 upload할 입력을 충분히 구분해요.
    return image ? `${face}:${objectId(image)}:${objectId(image.pixels)}:${image.width}x${image.height}` : face;
  }).join('|');
}

const ids = new WeakMap(); let nextId = 1;
function objectId(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return String(value ?? '');
  if (!ids.has(value)) ids.set(value, nextId++);
  return ids.get(value);
}

function depthDenominator(point, n, { rotateX = 0, rotateY = 0, rotateZ = 0, perspective = .18 }) {
  const [x, y, z] = point.map(value => value - n / 2);
  const cx = Math.cos(rotateX), sx = Math.sin(rotateX);
  const cy = Math.cos(rotateY), sy = Math.sin(rotateY);
  const cz = Math.cos(rotateZ), sz = Math.sin(rotateZ);
  const a = [x, y * cx - z * sx, y * sx + z * cx];
  const b = [a[0] * cy + a[2] * sy, a[1], -a[0] * sy + a[2] * cy];
  const q = [b[0] * cz - b[1] * sz, b[0] * sz + b[1] * cz, b[2]];
  const beta = Math.sin(clamp01(perspective) * Math.PI / 3);
  return 1 - beta * dot(q, CAMERA) / (n * Math.sqrt(3) / 2);
}

function faceTextureCanvas(encoded, face, palette, displayMap, faceImages) {
  const n = encoded.n;
  const sourceFace=displayMap.physicalToLogical[face],source=sourceFace&&encoded.faces?.[sourceFace];
  const faceImage=hDisplayImageSource(displayMap,faceImages,face)?.image;
  if(source){
    // 원시 RGBA upload라 alpha=0인 데이터의 RGB가 Canvas premultiply로 소실되지 않아요.
    // 같은 텍스처의 alpha에 역할을 실어 프레임별 upload나 추가 sampler를 만들지 않아요.
    if(source.length!==n*n)throw new RangeError(`H preview face length: ${face}`);
    const scale=4,side=n*scale,pixels=new Uint8Array(side*side*4);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const level=source[i*n+j],color=palette.colors[level];
      if(!color)throw new RangeError(`H preview level: ${face}`);
      const marker=isHUnshadedLevel(level)?255:0;
      for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){
        const o=((i*scale+y)*side+j*scale+x)*4;
        pixels[o]=color.r;pixels[o+1]=color.g;pixels[o+2]=color.b;pixels[o+3]=marker;
      }
    }
    return {pixels,width:side,height:side,linear:false};
  }
  // 3F 빈면은 이미지 유무와 무관하게 불투명 level-5 base여야 해요. 텍스처가 없다고
  // face를 생략하면 transparent cube가 되어, CPU drawScene의 정확 fallback과도 달라져요.
  const scale = Math.max(1, Math.ceil(Math.max(faceImage?.width ?? 0, faceImage?.height ?? 0) / n));
  const side = n * scale;
  const canvas = canvasFor(side, side);
  const ctx = canvas?.getContext('2d'); if (!ctx) return null;
  const base = palette.colors[5];
  if (!base) throw new RangeError(`H preview base level: ${face}`);
  ctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!faceImage) return { canvas, linear: false };
  if (!(faceImage.pixels instanceof Uint8ClampedArray)
    || !Number.isInteger(faceImage.width) || !Number.isInteger(faceImage.height)
    || faceImage.width < 1 || faceImage.height < 1
    || faceImage.pixels.length !== faceImage.width * faceImage.height * 4) {
    throw new TypeError(`Invalid faceImages.${face}`);
  }
  const imageCanvas = canvasFor(faceImage.width, faceImage.height);
  const imageCtx = imageCanvas?.getContext('2d'); if (!imageCtx || typeof ImageData !== 'function') return null;
  imageCtx.putImageData(new ImageData(faceImage.pixels, faceImage.width, faceImage.height), 0, 0);
  // canonical blank-face contain: row=i/down, column=j/right; 남는 띠는 투명이에요.
  const ratio = Math.min(1, faceImage.width / faceImage.height);
  const w = side * ratio, h = side * Math.min(1, faceImage.height / faceImage.width);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(imageCanvas, (side - w) / 2, (side - h) / 2, w, h);
  return { canvas, linear: true };
}

function uploadTexture(gl, source) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Canvas row 0과 local i=0은 모두 top이에요. uv[0,0]을 top-left로 쓰므로 flip하면
  // 빈면 이미지가 상하 반전돼요.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, source.linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, source.linear ? gl.LINEAR : gl.NEAREST);
  if(source.pixels)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,source.width,source.height,0,gl.RGBA,gl.UNSIGNED_BYTE,source.pixels);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.canvas);
  return texture;
}

function qrTexture(gl, qr) {
  if (!qr?.text || !['TL', 'TR', 'BL', 'BR'].includes(qr.corner)) return null;
  const matrix = qrMatrix(qr.text), quiet = 4, side = matrix.size + quiet * 2;
  const canvas = canvasFor(side, side), ctx = canvas?.getContext('2d'); if (!ctx) return null;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, side, side); ctx.fillStyle = '#000';
  for (let row = 0; row < matrix.size; row++) for (let col = 0; col < matrix.size; col++) {
    if (matrix.modules[row * matrix.size + col]) ctx.fillRect(quiet + col, quiet + row, 1, 1);
  }
  return { texture: uploadTexture(gl, { canvas, linear: false }), size: matrix.size };
}

function clipPoint(point, view, n, options) {
  const p = view.project(point), w = depthDenominator(point, n, options);
  return [(p.x / view.width * 2 - 1) * w, (1 - p.y / view.height * 2) * w, w];
}

function putQuad(gl, buffer, data, positions) {
  for (let i = 0; i < 4; i++) {
    const offset = i * 5, point = positions[i];
    data[offset] = point[0]; data[offset + 1] = point[1]; data[offset + 2] = point[2];
    data[offset + 3] = i === 1 || i === 2 ? 1 : 0;
    data[offset + 4] = i > 1 ? 1 : 0;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
}

/**
 * @returns {{draw(encoded: object, options: object): boolean, dispose(): void}}
 */
export function createHPreviewRenderer(canvas) {
  let gl; try { gl = canvas?.getContext?.('webgl', { alpha: true, antialias: true, premultipliedAlpha: false }); } catch { gl = null; }
  let lost = !gl, failed = false, handle, groundHandle, vertexBuffer, indexBuffer, groundBuffer, cacheKey = '', textures = new Map(), qrCacheKey = '', qrCached = null;
  let displayMapKey = '', cachedDisplayMap = null, firstDraw = true, uncheckedPoseDraws = 0;
  const quadData = new Float32Array(4 * 5);
  const outlineRgba = new Float32Array(rgba(CUBE_OUTLINE_COLOR));
  const unavailable = { draw: () => false, dispose: () => {} };
  if (!gl) return unavailable;
  try {
    handle = program(gl); groundHandle=groundProgram(gl); vertexBuffer = gl.createBuffer(); groundBuffer=gl.createBuffer(); indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    if (gl.getError() !== gl.NO_ERROR) return unavailable;
  } catch { return unavailable; }
  const aClip = gl.getAttribLocation(handle, 'aClip'), aUv = gl.getAttribLocation(handle, 'aUv');
  const uTexture = gl.getUniformLocation(handle, 'uTexture'), uOutline = gl.getUniformLocation(handle, 'uOutline');
  const uEdge = gl.getUniformLocation(handle, 'uEdge'), uOutlineOn = gl.getUniformLocation(handle, 'uOutlineOn'), uFaceGain=gl.getUniformLocation(handle,'uFaceGain'), uRotationFill=gl.getUniformLocation(handle,'uRotationFill');
  const uCodeFace=gl.getUniformLocation(handle,'uCodeFace');
  const gaClip=gl.getAttribLocation(groundHandle,'aClip'),gaAlpha=gl.getAttribLocation(groundHandle,'aAlpha'),guColor=gl.getUniformLocation(groundHandle,'uColor');
  const clear = () => { lost = true; };
  const onContextLost = event => { event.preventDefault?.(); clear(); };
  canvas.addEventListener?.('webglcontextlost', onContextLost);

  function disposeTextures() { for (const texture of textures.values()) gl.deleteTexture(texture); textures = new Map(); }
  function bind(texture, edge, outline) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(uTexture, 0);
    gl.uniform4fv(uOutline, outlineRgba); gl.uniform1f(uEdge, edge); gl.uniform1f(uOutlineOn, outline ? 1 : 0);
  }
  function draw(encoded, { lighting, palette, rotateX = 0, rotateY = 0, rotateZ = 0, perspective = .18, margin = 2, zoom = 1, outline = true, arrangement = 'isometric', renderFaces, faceImages = {}, qr, diagnosticStrict = false } = {}) {
    try {
      if (lost || failed || !encoded || !Number.isInteger(encoded.n) || encoded.n < 1) return false;
      const nextDisplayMapKey = `${objectId(encoded)}|${encoded.mode}|${arrangement}|${Array.isArray(renderFaces) ? renderFaces.join('|') : String(renderFaces ?? '')}`;
      if (nextDisplayMapKey !== displayMapKey) {
        cachedDisplayMap = hDisplayMap(encoded, { arrangement, renderFaces });
        displayMapKey = nextDisplayMapKey;
      }
      const displayMap = cachedDisplayMap;
      const colors = hPalette(palette, encoded.tones);
      const nextKey = `${objectId(encoded)}|${encoded.n}|${displayMap.cacheKey}|${paletteSignature(colors)}|${faceImageSignature(faceImages,displayMap)}`;
      const resourcesChanged = nextKey !== cacheKey;
      if (resourcesChanged) {
        disposeTextures();
        for (const face of H_FACE_IDS) {
          const source = faceTextureCanvas(encoded, face, colors, displayMap, faceImages);
          if (source) textures.set(face, uploadTexture(gl, source));
        }
        cacheKey = nextKey;
      }
      const qrKey = qr?.text && qr?.corner ? `${qr.text}|${qr.corner}|${encoded.n}|${perspective}` : '';
      const qrChanged = qrKey !== qrCacheKey;
      if (qrChanged) { if (qrCached) gl.deleteTexture(qrCached.texture); qrCached = qrTexture(gl, qr); qrCacheKey = qrKey; }
      const view = hProjection(encoded.n, { rotateX, rotateY, rotateZ, perspective, margin, zoom });
      const light=resolveHLighting(lighting,{rotateX,rotateY,rotateZ});
      const background = colors.background;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(...(background === null ? [0, 0, 0, 0] : rgba(background)));
      gl.clear(gl.COLOR_BUFFER_BIT);
      const ground=hLightingGround({...view,n:encoded.n},light);
      if(ground.length){
        gl.useProgram(groundHandle);gl.bindBuffer(gl.ARRAY_BUFFER,groundBuffer);gl.enableVertexAttribArray(gaClip);gl.enableVertexAttribArray(gaAlpha);gl.vertexAttribPointer(gaClip,2,gl.FLOAT,false,12,0);gl.vertexAttribPointer(gaAlpha,1,gl.FLOAT,false,12,8);
        for(const band of ground){
          const g=band.gradient,dx=g.x2-g.x1,dy=g.y2-g.y1,den=dx*dx+dy*dy||1;
          const v=new Float32Array(band.points.flatMap(p=>{const t=clamp01(((p.x-g.x1)*dx+(p.y-g.y1)*dy)/den);return[p.x/view.width*2-1,1-p.y/view.height*2,g.a1+(g.a2-g.a1)*t];}));
          gl.bufferData(gl.ARRAY_BUFFER,v,gl.STREAM_DRAW);gl.uniform3f(guColor,band.color.r/255,band.color.g/255,band.color.b/255);gl.drawArrays(gl.TRIANGLE_FAN,0,band.points.length);
        }
      }
      gl.useProgram(handle);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      // vertexAttribPointer는 호출 시점의 ARRAY_BUFFER를 붙잡아요. putQuad가 나중에 bind해도
      // 이미 INVALID_OPERATION이라 draw가 매번 false로 끝나요.
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(aClip); gl.vertexAttribPointer(aClip, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 20, 12);
      for (const face of view.visible) {
        const texture = textures.get(face); if (!texture) continue;
        const sourceFace=displayMap.physicalToLogical[face],hasCodeFace=Boolean(sourceFace&&encoded.faces?.[sourceFace]);
        const corners = [[0, 0], [0, encoded.n], [encoded.n, encoded.n], [encoded.n, 0]]
          .map(([i, j]) => hFacePoint(face, i, j, encoded.n));
        putQuad(gl, vertexBuffer, quadData, corners.map(point => clipPoint(point, view, encoded.n, { rotateX, rotateY, rotateZ, perspective })));
        const gain=hasCodeFace?(light?.faceReadGains?.[face]??light?.faceGains[face]??1):(light?.faceGains[face]??1);
        gl.uniform1f(uCodeFace,hasCodeFace?1:0);gl.uniform1f(uFaceGain,gain);
        gl.uniform1f(uRotationFill,hasCodeFace?(light?.faceFills?.[face]??0):0);
        bind(texture, outlineWidth(encoded.n) / encoded.n, outline); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }
      if (qrCached) {
        const metrics = hCornerQrMetrics({ width: view.width, height: view.height, hModel: { surfaceN: encoded.n, projection: { perspective } } }, qrCached.size);
        const x = qr.corner.endsWith('L') ? metrics.inset : view.width - metrics.inset - metrics.block;
        const y = qr.corner.startsWith('T') ? metrics.inset : view.height - metrics.inset - metrics.block;
        const point = (px, py) => [px / view.width * 2 - 1, 1 - py / view.height * 2, 1];
        putQuad(gl, vertexBuffer, quadData, [point(x, y), point(x + metrics.block, y), point(x + metrics.block, y + metrics.block), point(x, y + metrics.block)]);
        gl.uniform1f(uCodeFace,0);gl.uniform1f(uFaceGain,1);gl.uniform1f(uRotationFill,0); bind(qrCached.texture, 0, false); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }
      // pose 0…59는 오류 동기화 없이 제출하고 pose 60에서 한 번 확인해, hot loop의
      // 영구 오류를 숨기지 않으면서 매 frame driver flush 비용은 피한다.
      const periodicCheck = !firstDraw && !resourcesChanged && !qrChanged && !diagnosticStrict
        && uncheckedPoseDraws === 60;
      const checked = firstDraw || resourcesChanged || qrChanged || diagnosticStrict || periodicCheck;
      firstDraw = false;
      if (!checked) { uncheckedPoseDraws++; return true; }
      uncheckedPoseDraws = 0;
      if (gl.getError() === gl.NO_ERROR) return true;
      // 오류를 확인한 renderer는 계속 성공을 가장하면 안 돼요. CPU fallback이 다음 frame을 맡는다.
      failed = true;
      return false;
    } catch { return false; }
  }
  return { draw, dispose() {
    canvas.removeEventListener?.('webglcontextlost', onContextLost);
    if (lost) return;
    disposeTextures(); if (qrCached) gl.deleteTexture(qrCached.texture);
    gl.deleteBuffer(vertexBuffer); gl.deleteBuffer(groundBuffer); gl.deleteBuffer(indexBuffer); gl.deleteProgram(handle);gl.deleteProgram(groundHandle); lost = true;
  } };
}
