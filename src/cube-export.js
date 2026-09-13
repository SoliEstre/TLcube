import { H_FACE_IDS, normalizeHProfile } from './h-profile.js';
import { hFacePoint } from './h-layout.js';
import { buildHSurface } from './h-render.js';
import {hFaceImagePlacements} from './h-face-images.js';
import {hDisplayMap} from './h-face-arrangement.js';
import {appendCubeImageGltf} from './cube-image-export.js';
export const CUBE_FACES=Object.freeze(['ZM','XM','YM','ZP','XP','YP']);
const N={ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]},T=1e-9,E=1e-4;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const p=(v)=>Array.isArray(v)?[v[0],v[1],v[2]]:[v.x,v.y,v.z],rgb=(c)=>({r:c.r,g:c.g,b:c.b});
function face(c,n){const on=(k,v)=>c.every((q)=>Math.abs(q[k]-v)<=T);if(on(2,0))return'ZM';if(on(0,0))return'XM';if(on(1,0))return'YM';if(on(2,n))return'ZP';if(on(0,n))return'XP';if(on(1,n))return'YP';throw new RangeError('큐브 표면 밖 쿼드');}
function winding(c,f){let o=c.map(p);if(dot(cross(sub(o[1],o[0]),sub(o[2],o[0])),N[f])<0)o=[o[0],o[3],o[2],o[1]];return o;}
function add(a,f,k,c,col,x={}){if(!col||![col.r,col.g,col.b].every(Number.isFinite))throw new TypeError('쿼드 RGB');a.push({face:f,kind:k,color:rgb(col),corners:winding(c,f),...x});}
export function buildHCubeModel(encoded,{palette,faceImages,...displayOptions}={}){const profile=normalizeHProfile(encoded),map=hDisplayMap(encoded,displayOptions),s=buildHSurface(encoded,{palette,...displayOptions}),q=[];for(const f of H_FACE_IDS){const levels=s.faces[f],data=!!levels;if(data&&levels.length!==s.n*s.n)throw new RangeError('H data surface 길이');for(let i=0;i<s.n;i++)for(let j=0;j<s.n;j++){const c=data?s.palette.colors[levels[i*s.n+j]]:s.palette.colors[5];if(!c)throw new RangeError('H surface 색');add(q,f,data?'module':'back',[hFacePoint(f,i,j,s.n),hFacePoint(f,i,j+1,s.n),hFacePoint(f,i+1,j+1,s.n),hFacePoint(f,i+1,j,s.n)],c,{i,j});}}const images=hFaceImagePlacements(encoded,faceImages,displayOptions).map(p=>({...p,background:s.palette.colors[5]}));return{n:s.n,dataN:profile.n,offset:s.offset,kind:'H',dataFaces:[...map.logicalDataFaces],quads:q,...(images.length?{images}:{})};}
export function buildYCubeModel(mesh){if(!mesh||!Number.isInteger(mesh.n)||mesh.n<1||!Array.isArray(mesh.quads))throw new TypeError('Y mesh');for(const k of['yaw','pitch','roll'])if(Math.abs(mesh[k]||0)>T)throw new RangeError('정위치 Y mesh가 아니다: '+k);const out=[];for(const q of mesh.quads){if(!['module','back','overlay'].includes(q.kind)||!Array.isArray(q.corners3d)||q.corners3d.length!==4)continue;const c=q.corners3d.map(p);add(out,face(c,mesh.n),q.kind,c,q.color,{sourceFace:q.face,i:q.i,j:q.j,side:q.side});}return{n:mesh.n,kind:'Y',dataFaces:[...new Set(out.filter((q)=>q.kind==='module').map((q)=>q.face))],quads:out};}
/* 접힘 edge: ZM-YM, ZM-XM, ZM-XP, ZM-YP, YP-ZP. */
const NET=Object.freeze({YM:{x:1,y:0,map:([x,,z],n)=>[x,n-z]},XM:{x:0,y:1,map:([,y,z],n)=>[n-z,y]},ZM:{x:1,y:1,map:([x,y])=>[x,y]},XP:{x:2,y:1,map:([,y,z])=>[z,y]},YP:{x:1,y:2,map:([x,,z])=>[x,z]},ZP:{x:1,y:3,map:([x,y],n)=>[x,n-y]}});
export function cubeNetScene(m,{margin=2}={}){if(!m||!Number.isInteger(m.n)||m.n<1||!Array.isArray(m.quads))throw new TypeError('cube model');if(!Number.isFinite(margin)||margin<0)throw new RangeError('net margin');const shapes=m.quads.map((q)=>{const s=NET[q.face];if(!s)throw new RangeError('net face');return{kind:'polygon',color:rgb(q.color),face:q.face,sourceKind:q.kind,points:q.corners.map((v)=>{const u=s.map(v,m.n);return{x:margin+s.x*m.n+u[0],y:margin+s.y*m.n+u[1]};})};});for(const p of m.images??[]){const s=NET[p.face];shapes.push({kind:'image',image:p.image,color:p.background,face:p.face,points:p.corners.map(v=>{const u=s.map(v,m.n);return{x:margin+s.x*m.n+u[0],y:margin+s.y*m.n+u[1]};})});}return{width:margin*2+m.n*3,height:margin*2+m.n*4,background:{r:255,g:255,b:255},shapes,cubeNet:{kind:m.kind,n:m.n,dataFaces:[...m.dataFaces]}};}
const linear=(v)=>{const s=Math.min(255,Math.max(0,v))/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;},bytes=(a)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
function join(a){const o=new Uint8Array(a.reduce((s,v)=>s+v.byteLength,0));let n=0;for(const v of a){o.set(v,n);n+=v.byteLength;}return o;}function b64(a){if(typeof Buffer!=='undefined')return Buffer.from(a).toString('base64');let s='';for(const v of a)s+=String.fromCharCode(v);return btoa(s);}function bounds(a,n,max){const o=[a[0],a[1],a[2]];for(let i=1;i<n;i++)for(let k=0;k<3;k++)o[k]=max?Math.max(o[k],a[i*3+k]):Math.min(o[k],a[i*3+k]);return o;}

function exportQuadBounds(q,n){
  if(!q||!Object.hasOwn(N,q.face)||!['module','back','overlay'].includes(q.kind))throw new RangeError('glTF quad face/kind');
  if(!q.color||![q.color.r,q.color.g,q.color.b].every(Number.isFinite))throw new TypeError('glTF RGB');
  if(!Array.isArray(q.corners)||q.corners.length!==4)throw new TypeError('glTF quad 꼭짓점 4개');
  const normal=N[q.face],axis=normal.findIndex(v=>v!==0),uv=[0,1,2].filter(k=>k!==axis),plane=normal[axis]>0?n:0;
  for(const v of q.corners){
    if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw new TypeError('glTF 유한 좌표');
    if(v.some(x=>x<-T||x>n+T)||Math.abs(v[axis]-plane)>T)throw new RangeError('glTF 큐브 표면 밖 좌표');
  }
  const us=q.corners.map(v=>v[uv[0]]),vs=q.corners.map(v=>v[uv[1]]);
  const u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs);
  if(u1-u0<=T||v1-v0<=T||new Set(us.map((u,i)=>`${u},${vs[i]}`)).size!==4
    ||us.some(u=>Math.abs(u-u0)>T&&Math.abs(u-u1)>T)||vs.some(v=>Math.abs(v-v0)>T&&Math.abs(v-v1)>T))throw new RangeError('glTF 직사각형 면');
  for(let i=0;i<4;i++)if(dot(cross(sub(q.corners[(i+1)%4],q.corners[i]),sub(q.corners[(i+2)%4],q.corners[(i+1)%4])),normal)<=T)throw new RangeError('glTF 바깥 winding');
  return {u0,u1,v0,v1};
}

/** painter 순서를 깊이로 보존해요. 흰 QR 바탕=1, 겹치지 않는 검정 모듈=2.
 * 모델/net/voxel 좌표는 그대로이고 glTF만 최대 .0032셀의 얇은 층을 써요. */
function gltfOverlayLayers(m){
  if(!m||!Number.isInteger(m.n)||m.n<1||m.n>64||!Array.isArray(m.quads)||!m.quads.length||m.quads.length>100000)throw new RangeError('glTF cube model 한도');
  if(m.quads.reduce((s,q)=>s+(q?.kind==='overlay'),0)>4096)throw new RangeError('glTF overlay 한도');
  const layers=new Uint8Array(m.quads.length),byFace=new Map();
  for(let i=0;i<m.quads.length;i++){
    const q=m.quads[i],box=exportQuadBounds(q,m.n);
    if(q.kind!=='overlay')continue;
    const previous=byFace.get(q.face)??[];let layer=1;
    for(const p of previous)if(Math.min(box.u1,p.u1)-Math.max(box.u0,p.u0)>T&&Math.min(box.v1,p.v1)-Math.max(box.v0,p.v0)>T)layer=Math.max(layer,p.layer+1);
    if(layer>32)throw new RangeError('glTF 겹침 층 한도');
    layers[i]=layer;previous.push({...box,layer});byFace.set(q.face,previous);
  }
  return layers;
}
function exportCorners(q,layer){return q.kind==='overlay'?q.corners.map(v=>v.map((x,k)=>x+N[q.face][k]*E*layer)):q.corners;}
export function cubeModelToGltf(m){
  const layers=gltfOverlayLayers(m),v=m.quads.length*4,pos=new Float32Array(v*3),col=new Float32Array(v*4),I=v>65535?Uint32Array:Uint16Array,ind=new I(m.quads.length*6);
  let at=0,it=0;
  for(let qi=0;qi<m.quads.length;qi++){
    const q=m.quads[qi],b=at;
    for(const x of exportCorners(q,layers[qi])){pos.set(x,at*3);col.set([linear(q.color.r),linear(q.color.g),linear(q.color.b),1],at*4);at++;}
    ind.set([b,b+1,b+2,b,b+2,b+3],it);it+=6;
  }
  const pb=bytes(pos),cb=bytes(col),ib=bytes(ind),co=pb.byteLength,io=co+cb.byteLength,bin=join([pb,cb,ib]);
  return appendCubeImageGltf({asset:{version:'2.0',generator:'tlcube-cube-export'},extensionsUsed:['KHR_materials_unlit'],scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:1},indices:2,mode:4,material:0}]}],materials:[{doubleSided:true,extensions:{KHR_materials_unlit:{}},pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1}}],accessors:[{bufferView:0,componentType:5126,count:v,type:'VEC3',min:bounds(pos,v,false),max:bounds(pos,v,true)},{bufferView:1,componentType:5126,count:v,type:'VEC4'},{bufferView:2,componentType:I===Uint32Array?5125:5123,count:ind.length,type:'SCALAR'}],bufferViews:[{buffer:0,byteOffset:0,byteLength:pb.byteLength,target:34962},{buffer:0,byteOffset:co,byteLength:cb.byteLength,target:34962},{buffer:0,byteOffset:io,byteLength:ib.byteLength,target:34963}],buffers:[{byteLength:bin.byteLength,uri:'data:application/octet-stream;base64,'+b64(bin)}]},m);
}
