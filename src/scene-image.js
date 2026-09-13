/** 내장 PNG 면 이미지. 외부 URL/SVG/HTML은 렌더러에 전달하지 않아요. */
import {rasterToPng} from './png.js';
const MAX_SIDE=1024;
export function assertSceneImage(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)
    ||image.width<1||image.height<1||image.width>MAX_SIDE||image.height>MAX_SIDE
    ||!(image.pixels instanceof Uint8ClampedArray)||image.pixels.length!==image.width*image.height*4
    ||typeof image.href!=='string'||image.href.length>8*1024*1024
    ||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(image.href))throw new TypeError('내장 PNG 면 이미지가 필요해요');
  return image;
}
/** 단위 정사각형을 네 꼭짓점(TL/TR/BR/BL)으로 보내는 사영 행렬. */
export function imageQuadTransform(points){
  if(!Array.isArray(points)||points.length!==4||points.some(p=>![p.x,p.y].every(Number.isFinite)))throw new TypeError('이미지 사각형');
  const [a,b,c,d]=points,dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x,
    dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y,den=dx1*dy2-dx2*dy1;
  if(Math.abs(den)<1e-12)return null;
  const g=(dx3*dy2-dx2*dy3)/den,h=(dx1*dy3-dx3*dy1)/den;
  return [b.x-a.x+g*b.x,d.x-a.x+h*d.x,a.x,b.y-a.y+g*b.y,d.y-a.y+h*d.y,a.y,g,h,1];
}
export function projectImagePoint(m,u,v){const w=m[6]*u+m[7]*v+m[8];return{x:(m[0]*u+m[1]*v+m[2])/w,y:(m[3]*u+m[4]*v+m[5])/w};}
export function inverseImageTransform(m){
  if(!m)return null;const[a,b,c,d,e,f,g,h,i]=m;
  const out=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const det=a*out[0]+b*out[3]+c*out[6];return Math.abs(det)<1e-12?null:out.map(x=>x/det);
}
export function sampleSceneImage(image,u,v){
  const x=Math.max(0,Math.min(image.width-1,Math.floor(u*image.width))),y=Math.max(0,Math.min(image.height-1,Math.floor(v*image.height)));
  const k=(y*image.width+x)*4;return image.pixels.subarray(k,k+4);
}
/** 이미지 픽셀의 알파는 기존 불투명 빈 면 위에 합성해요. */
export function imageColorOver(image,u,v,background){
  const p=sampleSceneImage(image,u,v),a=p[3]/255;
  return {r:Math.round(p[0]*a+background.r*(1-a)),g:Math.round(p[1]*a+background.g*(1-a)),b:Math.round(p[2]*a+background.b*(1-a))};
}
function pngHref(width,height,pixels){
  const png=rasterToPng({width,height,pixels});
  if(typeof Buffer!=='undefined')return 'data:image/png;base64,'+Buffer.from(png).toString('base64');
  const parts=[];for(let k=0;k<png.length;k+=32768)parts.push(String.fromCharCode(...png.subarray(k,k+32768)));
  return 'data:image/png;base64,'+btoa(parts.join(''));
}
const canonicalCache=new WeakMap();
/** RGBA가 자산의 정본이에요. pixels는 제자리 수정하지 않고 새 자산으로 교체해요.
 * SVG/glTF에는 입력 href 대신 RGBA에서 한 번 만든 완결 PNG를 내보내요. */
export function canonicalSceneImage(image){
  assertSceneImage(image);
  let cached=canonicalCache.get(image);if(cached)return cached;
  cached=Object.freeze({width:image.width,height:image.height,pixels:image.pixels,href:pngHref(image.width,image.height,image.pixels)});
  canonicalCache.set(image,cached);canonicalCache.set(cached,cached);return cached;
}
const canvasCache=new WeakMap();
const opaqueCache=new WeakMap();
function opaqueImage(image,background){
  image=canonicalSceneImage(image);
  let byColor=opaqueCache.get(image);if(!byColor){byColor=new Map();opaqueCache.set(image,byColor);}
  const key=[background.r,background.g,background.b].join(',');if(byColor.has(key))return byColor.get(key);
  let opaque=true;for(let k=3;k<image.pixels.length;k+=4)if(image.pixels[k]!==255){opaque=false;break;}
  if(opaque){byColor.set(key,image);return image;}
  const pixels=new Uint8ClampedArray(image.pixels.length);
  for(let k=0;k<pixels.length;k+=4){const a=image.pixels[k+3]/255;for(let c=0;c<3;c++)pixels[k+c]=Math.round(image.pixels[k+c]*a+background[['r','g','b'][c]]*(1-a));pixels[k+3]=255;}
  const result={width:image.width,height:image.height,pixels,href:pngHref(image.width,image.height,pixels)};byColor.set(key,result);return result;
}
function expandedTriangle(points,padding){
  const [a,b,c]=points,sign=Math.sign((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
  return points.map((p,k)=>{
    const prev=points[(k+2)%3],next=points[(k+1)%3],l0=Math.hypot(p.x-prev.x,p.y-prev.y),l1=Math.hypot(next.x-p.x,next.y-p.y);
    if(l0<1e-12||l1<1e-12)return p;
    const n0={x:sign*(p.y-prev.y)/l0,y:-sign*(p.x-prev.x)/l0},n1={x:sign*(next.y-p.y)/l1,y:-sign*(next.x-p.x)/l1};
    const denominator=Math.max(.01,1+n0.x*n1.x+n0.y*n1.y),dx=padding*(n0.x+n1.x)/denominator,dy=padding*(n0.y+n1.y)/denominator;
    const limit=Math.min(1,padding*8/Math.max(Math.hypot(dx,dy),1e-12));return{x:p.x+dx*limit,y:p.y+dy*limit};
  });
}
function clipPolygon(ctx,points){ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.clip();}
function imageCanvas(image){
  let canvas=canvasCache.get(image);if(canvas)return canvas;assertSceneImage(image);
  canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(image.width,image.height):document.createElement('canvas');
  canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이미지 Canvas를 만들 수 없어요');
  const data=ctx.createImageData(image.width,image.height);data.data.set(image.pixels);ctx.putImageData(data,0,0);
  canvasCache.set(image,canvas);return canvas;
}
/** 삼각형 단위 사영 근사. 이미지가 없는 기존 도형 경로는 바꾸지 않아요. */
export function imageTriangles(points,steps=12){
  const m=imageQuadTransform(points);if(!m)return[];
  // 평행 투영/전개도는 affine 한 장이면 정확해요.
  if(Math.abs(m[6])+Math.abs(m[7])<1e-10)steps=1;
  const out=[];
  for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
    const a=[x/steps,y/steps],b=[(x+1)/steps,y/steps],c=[(x+1)/steps,(y+1)/steps],d=[x/steps,(y+1)/steps];
    for(const uv of [[a,b,c],[a,c,d]])out.push({uv,points:uv.map(([u,v])=>projectImagePoint(m,u,v))});
  }
  return out;
}
function affineTriangle(uv,points){
  const [[u0,v0],[u1,v1],[u2,v2]]=uv,[p0,p1,p2]=points,den=(u1-u0)*(v2-v0)-(u2-u0)*(v1-v0);
  if(Math.abs(den)<1e-14)return null;
  const a=((p1.x-p0.x)*(v2-v0)-(p2.x-p0.x)*(v1-v0))/den;
  const c=((p2.x-p0.x)*(u1-u0)-(p1.x-p0.x)*(u2-u0))/den;
  const b=((p1.y-p0.y)*(v2-v0)-(p2.y-p0.y)*(v1-v0))/den;
  const d=((p2.y-p0.y)*(u1-u0)-(p1.y-p0.y)*(u2-u0))/den;
  return[a,b,c,d,p0.x-a*u0-c*v0,p0.y-b*u0-d*v0];
}
export function drawSceneImage(ctx,shape){
  const image=opaqueImage(shape.image,shape.color),canvas=imageCanvas(image),m=ctx.getTransform();
  const padding=.75/Math.max(1e-6,Math.min(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)));
  ctx.save();clipPolygon(ctx,shape.points);
  for(const t of imageTriangles(shape.points)){
    const matrix=affineTriangle(t.uv,t.points);if(!matrix)continue;
    // 내부 clip만 겹치고 외곽 clip은 유지해 AA 틈을 없애요. 알파는 먼저 빈면에 합성해 중복 누적을 막아요.
    ctx.save();clipPolygon(ctx,expandedTriangle(t.points,padding));
    ctx.transform(...matrix);ctx.imageSmoothingEnabled=true;ctx.drawImage(canvas,0,0,1,1);ctx.restore();
  }
  ctx.restore();
  // Session RGBA remains immutable; this clipped multiply pass matches the face's cell gain.
  if(Number.isFinite(shape.gain)&&shape.gain<1){ctx.save();clipPolygon(ctx,shape.points);ctx.globalCompositeOperation='multiply';const v=Math.round(shape.gain*255);ctx.fillStyle=`rgb(${v},${v},${v})`;ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();}
}
export function sceneImageSvg(shape,id,precision=4){
  const image=opaqueImage(shape.image,shape.color),f=n=>Number(n.toFixed(precision)).toString(),lines=[];
  const padding=Math.max(.01,Math.max(...shape.points.map(p=>p.x))-Math.min(...shape.points.map(p=>p.x)),Math.max(...shape.points.map(p=>p.y))-Math.min(...shape.points.map(p=>p.y)))/512;
  lines.push(`<defs><image id="${id}" width="1" height="1" preserveAspectRatio="none" href="${image.href}"/></defs>`);
  lines.push(`<clipPath id="${id}outer"><polygon points="${shape.points.map(p=>`${f(p.x)},${f(p.y)}`).join(' ')}"/></clipPath><g clip-path="url(#${id}outer)">`);
  const gain=Number.isFinite(shape.gain)?Math.min(1,Math.max(0,shape.gain)):1;
  if(gain<1)lines.push(`<defs><filter id="${id}gain" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="${f(gain)}"/><feFuncG type="linear" slope="${f(gain)}"/><feFuncB type="linear" slope="${f(gain)}"/></feComponentTransfer></filter></defs><g filter="url(#${id}gain)">`);
  for(const [k,t]of imageTriangles(shape.points).entries()){
    const matrix=affineTriangle(t.uv,t.points);if(!matrix)continue;
    lines.push(`<clipPath id="${id}c${k}" clipPathUnits="userSpaceOnUse"><polygon points="${expandedTriangle(t.points,padding).map(p=>`${f(p.x)},${f(p.y)}`).join(' ')}"/></clipPath>`);
    lines.push(`<g clip-path="url(#${id}c${k})"><use href="#${id}" transform="matrix(${matrix.map(f).join(' ')})"/></g>`);
  }
  if(gain<1)lines.push('</g>');
  lines.push('</g>');
  return lines.join('\n');
}
