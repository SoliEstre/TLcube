/** H 논리1…6면을 공통 물리 표시 맵으로 그려요. 와이어 배열은 바꾸지 않아요. */
import { H_FACE_IDS, hModeFaces, normalizeHProfile } from './h-profile.js';
import { hFacePoint, hLayout } from './h-layout.js';
import { CUBE_OUTLINE_COLOR } from './cube-outline.js';
import {hScreenSpin} from './h-rotation.js';
import {hFaceImagePlacements} from './h-face-images.js';
import {hDisplayMap} from './h-face-arrangement.js';
import { applyHRotationFill, resolveHLighting, hLightingGround, isHUnshadedLevel } from './h-lighting.js';
import { SQUARE_CELL_STYLES, styledGridShapes } from './square-cell-style.js';
const NORMALS={ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const CAMERA=[-1/Math.sqrt(3),-1/Math.sqrt(3),-1/Math.sqrt(3)];
const RIGHT=[1/Math.sqrt(2),-1/Math.sqrt(2),0];
const DOWN=[-1/Math.sqrt(6),-1/Math.sqrt(6),2/Math.sqrt(6)];
const rgb=v=>({r:v,g:v,b:v});
const litColor=(color,gain,fill=0)=>{
  if(gain===undefined)return color;
  if(fill>0)return applyHRotationFill(color,fill,gain);
  return {r:Math.round(color.r*gain),g:Math.round(color.g*gain),b:Math.round(color.b*gain)};
};
const DEFAULT_LEVELS=[rgb(104),rgb(173),rgb(226)];
export const H_ROTATION_PERIOD_MS=48000;
/** X는 한 주기2회, Y는1회 돌아 반대꼭짓점도 보여요. 단순X회전으로는 전6면이 안 보여요. */
export function hAutoRotation(elapsedMs, options) {
  if(options){
    return hScreenSpin(elapsedMs,options);
  }
  const phase=((Math.max(0,elapsedMs)%H_ROTATION_PERIOD_MS)/H_ROTATION_PERIOD_MS)*Math.PI*2;
  return {rotateX:phase*2,rotateY:phase};
}
function rotationProjector(x,y,z) {
  const cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  return p=>{
    const a=[p[0],p[1]*cx-p[2]*sx,p[1]*sx+p[2]*cx];
    const b=[a[0]*cy+a[2]*sy,a[1],-a[0]*sy+a[2]*cy];
    return [b[0]*cz-b[1]*sz,b[0]*sz+b[1]*cz,b[2]];
  };
}
export function hPalette({levels=DEFAULT_LEVELS,background=rgb(255)}={},tones=3) {
  if(!Array.isArray(levels)||levels.length<3)throw new RangeError('H palette requires low/mid/high');
  const data=tones===2?[levels[0],levels[2],levels[2]]:levels.slice(0,3);
  return {background,colors:[...data,rgb(0),rgb(255),levels[1]]};
}
/** 공통 3D 출력용 면 표현. 추가 외곽 없이 원래 격자를 유지해요. */
export function hSurfaceProfile(profile){
  const p=normalizeHProfile(profile);
  return {dataN:p.n,n:p.n,offset:0,assisted:false};
}
export function buildHSurface(encoded,options={}){
  const p=normalizeHProfile(encoded),surface=hSurfaceProfile(p),palette=hPalette(options.palette,p.tones),faces={};
  const displayMap=hDisplayMap(encoded,options);
  for(const face of H_FACE_IDS){
    const sourceFace=displayMap.physicalToLogical[face],source=sourceFace&&encoded.faces[sourceFace];if(!source)continue;
    if(source.length!==p.n*p.n)throw new RangeError('H surface data length');
    faces[face]=source;
  }
  return {...surface,palette,faces};
}
export function hProjection(n,{rotateX=0,rotateY=0,rotateZ=0,perspective=0.18,margin=2,zoom=1}={}) {
  if(![n,rotateX,rotateY,rotateZ,perspective,margin,zoom].every(Number.isFinite)||n<=0||margin<0||zoom<=0||zoom>4)throw new RangeError('H projection');
  const beta=Math.sin(Math.min(1,Math.max(0,perspective))*Math.PI/3);
  const width=n*2.15/Math.sqrt(1-beta*beta)+margin*2,height=width;
  const rotated=rotationProjector(rotateX,rotateY,rotateZ);
  const project=p=>{
    const q=rotated(p.map(v=>v-n/2)),scale=1/(1-beta*dot(q,CAMERA)/(n*Math.sqrt(3)/2));
    return {x:width/2+dot(q,RIGHT)*scale*zoom,y:height/2+dot(q,DOWN)*scale*zoom};
  };
  // 원근 카메라는 중심에서 n√3/(2β) 거리에 있어요. 면 중심도 n/2만큼
  // 이동하므로 평행 시선(dot>0)으로 가리면 뒷면이 앞면 위에 칠해져요.
  const facingThreshold=beta/Math.sqrt(3);
  const visible=H_FACE_IDS.filter(face=>dot(rotated(NORMALS[face]),CAMERA)>facingThreshold+1e-10);
  return {width,height,project,visible};
}
export function buildHScene(encoded,options={}) {
  const p=normalizeHProfile(encoded),surface=buildHSurface(encoded,options),n=surface.n,view=hProjection(n,options),palette=surface.palette,shapes=[];
  const lighting=resolveHLighting(options.lighting,options);
  const images=new Map(hFaceImagePlacements(encoded,options.faceImages,options).map(image=>[image.face,image]));
  // 셀 꾸미기(§3.3) — 옵션에 키가 있을 때만(hPreviewOptions 가 허용표로 연 값). 없으면 아래 기존 루프 그대로(바이트 동일).
  const cellStyle=hCellStyleOf(options,p),styledRoles=cellStyle?hStyledCellRoles(p.version,p.finder):null;
  for(const face of view.visible) {
    const levels=surface.faces[face];
    // 빈(비데이터) 물리면은 불투명 단색이에요 — 3면 렌더의 뒷면·수평/수직 cap 등. 반복 사본은 hDisplayMap 이 코드 면으로 넘겨요.
    if(!levels){
      shapes.push({kind:'polygon',color:litColor(palette.colors[5],lighting?.faceGains[face]),...(lighting?{gain:lighting.faceGains[face]}:{}),points:[[0,0],[0,n],[n,n],[n,0]].map(([i,j])=>view.project(hFacePoint(face,i,j,n)))});
      const asset=images.get(face);if(asset)shapes.push({kind:'image',face,...(lighting?{gain:lighting.faceGains[face]}:{}),color:palette.colors[5],image:asset.image,points:asset.corners.map(view.project)});
      continue;
    }
    // 공유 격자 꼭짓점은 한 번만 투영하되 반환 point 객체는 셀마다 독립으로 둬요.
    const stride=n+1,grid=new Array(stride*stride);
    for(let i=0;i<=n;i++)for(let j=0;j<=n;j++)grid[i*stride+j]=view.project(hFacePoint(face,i,j,n));
    if(cellStyle){pushStyledHFace(shapes,{face,levels,n,grid,stride,view,palette,lighting,cellStyle,styledRoles});continue;}
    for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
      const level=levels[i*n+j],baseColor=palette.colors[level];if(!baseColor)throw new RangeError('H render level');
      const unshaded=isHUnshadedLevel(level),gain=unshaded?1:(lighting?.faceReadGains?.[face]??lighting?.faceGains[face]);
      const color=unshaded?baseColor:litColor(baseColor,gain,lighting?.faceFills?.[face]);
      const k=i*stride+j;
      shapes.push({kind:'polygon',color,face,i,j,...(lighting?{gain}:{}),points:[{...grid[k]},{...grid[k+1]},{...grid[k+stride+1]},{...grid[k+stride]}]});
    }
  }
  if(options.outline)shapes.push(...hPhysicalOutline(view,n));
  const scene={width:view.width,height:view.height,background:palette.background,shapes,
    hModel:{version:p.version,mode:p.mode,tones:p.tones,finder:p.finder,visible:view.visible.filter(f=>surface.faces[f]),surfaceN:n,assisted:surface.assisted,projection:options},layout:hLayout(p.version,p.finder)};
  if(cellStyle)scene.hModel.cellStyle={style:cellStyle.style,ground:cellStyle.ground};
  if(lighting){scene.hLighting=lighting;scene.shading=hLightingGround({...view,n},lighting);}
  return scene;
}
// ── H 셀 꾸미기 (DESIGN_001 §3.3 · §4.2 h-render) ──────────────────────────────
// 여는 결정은 generator-h.js `resolveHCellStyleSpec`(허용표)이 해요. 여기는 연 값을 그리기만 해요.
// CPU 장면(여기)과 GPU 면 텍스처(h-preview-renderer.js)는 `hStyledFacePieces` 가 낸 **같은 다각형**을 써요 —
// 앞은 원근 투영 map, 뒤는 면 로컬 map. 그래서 두 경로의 셀 모양이 사본으로 갈라지지 않아요.
/** H 셀 바탕 → 팔레트 레벨. level5 = 조명받는 중간톤(빈 면과 같은 색, 기본 §9.3 Q2) · white = 예약 무음영 흰색(레벨 4). */
export const H_CELL_GROUND_LEVELS=Object.freeze({level5:5,white:4});
/** 옵션의 셀 스타일 → {style, ground, groundLevel} | null. 키 없음·square → null(기존 경로).
 *  모르는 스타일·바탕은 던져요 — 리졸버를 거치지 않은 값이에요. 2톤·corners 파인더는 리졸버가 1차 잠금이지만
 *  생산자도 null(사각 그대로)로 닫아요 — 리졸버를 우회한 호출이 재지 않은 조합을 그리지 않게(fail-closed). */
export function hCellStyleOf(options,profile){
  const style=options?.hCellStyle;
  if(style===undefined||style==='square')return null;
  if(!SQUARE_CELL_STYLES.includes(style))throw new RangeError(`H cell style: ${style}`);
  const ground=options.hCellGround??'level5';
  if(!Object.prototype.hasOwnProperty.call(H_CELL_GROUND_LEVELS,ground))throw new RangeError(`H cell ground: ${ground}`);
  if(profile&&(profile.tones===2||profile.finder==='corners'))return null;
  return Object.freeze({style,ground,groundLevel:H_CELL_GROUND_LEVELS[ground]});
}
const styledRoleCache=new Map();
/** 면 격자의 꾸밈 대상(1) / 사각 고정(0). 역할은 h-layout 에서 유도해요: data · filler(레벨 5, 읽히지 않음)만 꾸미고,
 *  frame 파인더의 r=0 흰 경계 · r=1 레일 · r=2 링 · 태그 · 포맷 · 루트 · 레퍼런스와 **모르는 역할**은 고정이에요(fail-closed). */
export function hStyledCellRoles(version,finder){
  const key=`${version}|${finder}`;
  if(styledRoleCache.has(key))return styledRoleCache.get(key);
  const layout=hLayout(version,finder),n=normalizeHProfile({version}).n,out=new Uint8Array(n*n);
  for(const c of layout.roles.values())if(c.role==='data'||c.role==='filler')out[c.i*n+c.j]=1;
  styledRoleCache.set(key,out);return out;
}
/** 한 면의 꾸밈 조각(검출 셀 제외). 이웃 = 같은 레벨의 꾸밈 셀(§3.3 반박 ①). 무음영 레벨(3/4)이 꾸밈 자리에 오면
 *  고정으로 돌려요 — 역할 유도가 어긋나도 식별 셀을 꾸미지 않게. `isStyled(k)` 로 호출자가 같은 판정을 써요.
 *  검출 셀은 styledGridShapes 에 'fixed' 로 넘겨요 — null(빈 칸)로 넘기면 liquid 오목 필렛이 그 셀 모서리를 데이터 색으로
 *  칠해요(검출 요소를 꾸미는 것 — 2026-09-26 h-cell-style 자가 레퍼런스 5,5 에서 잡음). 'fixed' 가 내는 사각 조각은
 *  호출자가 기존 사각을 따로 그리므로 여기서 버려요: 면 로컬 좌표로 먼저 펴서 조각 무게중심의 셀로 가른 뒤 `map` 을 적용해요.
 *  @returns {{pieces: object[], isStyled: (k:number)=>boolean}} */
export function hStyledFacePieces({levels,n,styledRoles,style,color,map,tags}){
  const isStyled=k=>styledRoles[k]===1&&!isHUnshadedLevel(levels[k]);
  const local=styledGridShapes({rows:n,cols:n,style,host:'h',
    role:(r,c)=>isStyled(r*n+c)?'data':'fixed',
    neighbor:(r,c,nr,nc)=>isStyled(r*n+c)&&isStyled(nr*n+nc)&&levels[r*n+c]===levels[nr*n+nc],
    color:(r,c)=>color(levels[r*n+c]),map:(x,y)=>({x,y}),tags});
  const pieces=[];
  for(const piece of local){
    let sx=0,sy=0;for(const point of piece.points){sx+=point.x;sy+=point.y;}
    const row=Math.floor(sy/piece.points.length),col=Math.floor(sx/piece.points.length);
    if(!isStyled(row*n+col))continue;
    pieces.push({...piece,points:piece.points.map(point=>map(point.x,point.y))});
  }
  return {pieces,isStyled};
}
function pushStyledHFace(shapes,{face,levels,n,grid,stride,view,palette,lighting,cellStyle,styledRoles}){
  // 데이터와 같은 gain·fill 경로(litColor) — 바탕도 «같은 면 데이터와 같은 조명» 을 받아요(safety M12).
  const readGain=lighting?.faceReadGains?.[face]??lighting?.faceGains[face],fill=lighting?.faceFills?.[face];
  const lit=new Map();
  const colorOf=level=>{
    if(lit.has(level))return lit.get(level);
    const baseColor=palette.colors[level];if(!baseColor)throw new RangeError('H render level');
    const color=isHUnshadedLevel(level)?baseColor:litColor(baseColor,readGain,fill);lit.set(level,color);return color;
  };
  // ① 바탕 한 장(데이터 도형보다 먼저, noSeam — seam stroke 가 인접 면 r=0 흰 경계를 넘지 않게, safety m4).
  const gLevel=cellStyle.groundLevel,gGain=isHUnshadedLevel(gLevel)?1:readGain;
  shapes.push({kind:'polygon',color:{...colorOf(gLevel)},face,hCellGround:cellStyle.ground,noSeam:true,...(lighting?{gain:gGain}:{}),
    points:[grid[0],grid[n],grid[n*stride+n],grid[n*stride]].map(point=>({...point}))});
  const {pieces,isStyled}=hStyledFacePieces({levels,n,styledRoles,style:cellStyle.style,color:colorOf,
    map:(x,y)=>view.project(hFacePoint(face,y,x,n)),tags:{noSeam:true,face,...(lighting?{gain:readGain}:{})}});
  // ② 검출 셀 — 기존 루프와 같은 사각 polygon(같은 색·필드·꼭짓점).
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    if(isStyled(i*n+j))continue;
    const level=levels[i*n+j],baseColor=palette.colors[level];if(!baseColor)throw new RangeError('H render level');
    const unshaded=isHUnshadedLevel(level),gain=unshaded?1:readGain;
    const color=unshaded?baseColor:litColor(baseColor,gain,fill);
    const k=i*stride+j;
    shapes.push({kind:'polygon',color,face,i,j,...(lighting?{gain}:{}),points:[{...grid[k]},{...grid[k+1]},{...grid[k+stride+1]},{...grid[k+stride]}]});
  }
  // ③ 꾸밈 조각(data · filler). 조각 색 객체는 레벨마다 공유하지 않게 복사해요(withHCornerQr 선례).
  for(const piece of pieces)shapes.push({...piece,color:{...piece.color}});
}
// 선을 화면 고정폭으로 덧그리면 먼 quiet 셀이나 아주 얇은 제3면을 덮어요.
// 물리면 안쪽 0.1셀 이하의 띠를 먼저 만든 뒤 투영해 중심70% 표본을 보호해요.
// 공유 변은 양면의 반폭 띠로 구성하며 면 밖으로 miter/cap을 확장하지 않아요.
function hPhysicalOutline(view,n) {
  const w=Math.min(.1,Math.max(.08,n*.006)/2);
  const strips=[
    [[0,0],[n,0],[n,w],[0,w]],[[n-w,0],[n,0],[n,n],[n-w,n]],
    [[0,n-w],[n,n-w],[n,n],[0,n]],[[0,0],[w,0],[w,n],[0,n]],
  ];
  return view.visible.flatMap(face=>strips.map(points=>({
    kind:'polygon',color:{...CUBE_OUTLINE_COLOR},
    points:points.map(([i,j])=>view.project(hFacePoint(face,i,j,n))),
  })));
}
/** 모든 본문면을 빠짐없이 내보내는 면시트. 6면현재시점PNG 한장에는 반대3면이 없어요. */
export function buildHFaceSheet(encoded,options={}) {
  const p=normalizeHProfile(encoded),gap=options.margin??2,cols=3,faces=hModeFaces(p.mode),rows=Math.ceil(faces.length/cols),palette=hPalette(options.palette,p.tones),shapes=[];
  for(let f=0;f<faces.length;f++){
    const face=faces[f],levels=encoded.faces[face],ox=gap+(f%cols)*(p.n+gap),oy=gap+Math.floor(f/cols)*(p.n+gap);
    if(!(levels instanceof Uint8Array)||levels.length!==p.n*p.n)throw new RangeError('H face sheet data length');
    for(let i=0;i<p.n;i++)for(let j=0;j<p.n;j++)shapes.push({kind:'polygon',color:palette.colors[levels[i*p.n+j]],face,i,j,
      points:[{x:ox+j,y:oy+i},{x:ox+j+1,y:oy+i},{x:ox+j+1,y:oy+i+1},{x:ox+j,y:oy+i+1}]});
  }
  return {width:cols*p.n+(cols+1)*gap,height:rows*p.n+(rows+1)*gap,background:palette.background,shapes,
    hModel:{version:p.version,mode:p.mode,tones:p.tones,faces,export:'all-faces'}};
}
