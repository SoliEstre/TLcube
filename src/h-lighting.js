/** H의 물체 조명과 지면 음영. DOM/Canvas/WebGL과 독립이에요. */
export const H_LIGHTING_PROFILES=Object.freeze(['screen','soft','print','original']);
export const H_LIGHTING_SHADING=Object.freeze(['off','on']);
const NORMALS=Object.freeze({ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]});
// Chosen so the reset three faces reproduce the existing screen order (ZM > XM > YM).
const PROFILE=Object.freeze({screen:Object.freeze({l:.72,r:.62,floor:.62}),soft:Object.freeze({l:.85,r:.78,floor:.78}),print:Object.freeze({l:1,r:1,floor:1}),original:Object.freeze({l:.72,r:.52,floor:.52})});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const CAMERA=Object.freeze([-1/Math.sqrt(3),-1/Math.sqrt(3),-1/Math.sqrt(3)]);
const ROTATION_FILL_MAX=.56;
/** rotate 의 역 — 화면(월드)에 고정된 벡터를 회전 전 모델 좌표로 가져와요(Rz·Ry·Rx 의 전치 = Rx(−x)·Ry(−y)·Rz(−z)). */
function unrotate([x,y,z],{rotateX=0,rotateY=0,rotateZ=0}={}){
  const cx=Math.cos(rotateX),sx=Math.sin(rotateX),cy=Math.cos(rotateY),sy=Math.sin(rotateY),cz=Math.cos(rotateZ),sz=Math.sin(rotateZ);
  const a=[x*cz+y*sz,-x*sz+y*cz,z];
  const b=[a[0]*cy-a[2]*sy,a[1],a[0]*sy+a[2]*cy];
  return [b[0],b[1]*cx+b[2]*sx,-b[1]*sx+b[2]*cx];
}
/** 3D 지면 효과의 고정 화면-월드 벡터: 바닥은 +Z 쪽(아이소 정위치의 ZP 가 바닥, ZM 이 윗면), 그림자는 화면 오른쪽 아래(−Y 쪽)로 떨어져요(2.5D 띠의 관례와 같은 방향). */
const FLOOR_DOWN=Object.freeze([0,0,1]);
const SHADOW_CAST=Object.freeze((()=>{const v=[.15,-.75,1];const l=Math.hypot(...v);return v.map(x=>x/l);})());
function rotate([x,y,z],{rotateX=0,rotateY=0,rotateZ=0}={}){const cx=Math.cos(rotateX),sx=Math.sin(rotateX),cy=Math.cos(rotateY),sy=Math.sin(rotateY),cz=Math.cos(rotateZ),sz=Math.sin(rotateZ);const a=[x,y*cx-z*sx,y*sx+z*cx],b=[a[0]*cy+a[2]*sy,a[1],-a[0]*sy+a[2]*cy];return [b[0]*cz-b[1]*sz,b[0]*sz+b[1]*cz,b[2]];}
const smoothstep=(lo,hi,value)=>{const t=clamp((value-lo)/(hi-lo),0,1);return t*t*(3-2*t);};

/** 식별용 흑백 level만 음영에서 제외해요. 같은 RGB의 데이터/참조 level은 제외하지 않아요. */
export const isHUnshadedLevel=level=>level===3||level===4;

/** 중간톤 lift의 고정점은 0·255지만 뒤의 gain은 별개예요. 식별 셀 보호는 호출자가 역할로 결정해요. */
export function applyHRotationFill(color,strength=0,gain=1){
  const s=clamp(Number(strength)||0,0,ROTATION_FILL_MAX);
  if(s===0&&gain===1)return color;
  // GPU와 같이 lift→gain을 float로 계산한 뒤 한 번만 8-bit 양자화해요.
  const channel=value=>{const c=clamp(value/255,0,1);return Math.round((c+s*c*(1-c))*255*gain);};
  return {r:channel(color.r),g:channel(color.g),b:channel(color.b)};
}

function rotationReadLight(pose,gains){
  const faceFills={},faceReadGains={};
  for(const face of Object.keys(NORMALS)){
    const facing=clamp(dot(rotate(NORMALS[face],pose),CAMERA),0,1);
    // 카메라 쪽으로 충분히 드러나는 면은 원래 팔레트 밝기까지 회복해요.
    // 반사광 뒤에 어두운 gain을 다시 곱해 peak가 죽는 것을 막고, 옆으로 돌면
    // smoothstep으로 원래 음영에 복귀해요. 특정 물리면/회전축 예외는 없어요.
    const exposure=smoothstep(.12,.50,facing);
    faceReadGains[face]=gains[face]+(1-gains[face])*exposure;
    faceFills[face]=ROTATION_FILL_MAX*.35*exposure;
  }
  return {faceFills:Object.freeze(faceFills),faceReadGains:Object.freeze(faceReadGains)};
}
export function resolveHLighting(lighting,pose={}){
  if(lighting===undefined)return null;
  const profile=lighting.profile??'screen',shading=lighting.shading??'off';
  if(!H_LIGHTING_PROFILES.includes(profile)||!H_LIGHTING_SHADING.includes(shading))throw new RangeError('H lighting');
  if(lighting.rotationFill!==undefined&&typeof lighting.rotationFill!=='boolean')throw new RangeError('H lighting rotationFill');
  const p=PROFILE[profile];
  const worldLight=profile==='print'?[-1,-1,-1]:[-p.l,-p.r,-1];
  const faceGains=profile==='print'
    ?Object.freeze(Object.fromEntries(Object.keys(NORMALS).map(face=>[face,1])))
    // Light is fixed in world space. Rotating normals (not the light) makes the cube respond to pose.
    :Object.freeze(Object.fromEntries(Object.keys(NORMALS).map(face=>[face,clamp(dot(rotate(NORMALS[face],pose),worldLight),p.floor,1)])));
  const result={profile,shading,faceGains,worldLight:Object.freeze(worldLight),ground:shading==='on'?groundBands(worldLight):[]};
  // 3D 지면 사영용: 화면에 고정된 빛·아래 방향을 모델 좌표로 가져와 둬요(scene.project 가 자세를 다시 적용해요).
  if(shading==='on'){
    result.groundCast=Object.freeze({cast:Object.freeze(unrotate(SHADOW_CAST,pose)),down:Object.freeze(unrotate(FLOOR_DOWN,pose))});
  }
  // false/omission deliberately keeps the old object shape and exact pixels.
  if(lighting.rotationFill===true)Object.assign(result,rotationReadLight(pose,faceGains));
  return Object.freeze(result);
}
function groundBands(light){
  // Project the fixed light into the same screen basis as the cube. A cast
  // shadow travels away from the source; the reflection points toward it.
  const x=-(light[0]-light[1])/Math.sqrt(2),y=-(-light[0]-light[1]+2*light[2])/Math.sqrt(6);
  const len=Math.hypot(x,y)||1,dx=x/len,dy=y/len;return Object.freeze([
  Object.freeze({role:'shadow',dx,dy,color:Object.freeze({r:0,g:0,b:0}),a1:.22,a2:0}),
  Object.freeze({role:'reflect',dx:-dx,dy:-dy,color:Object.freeze({r:255,g:255,b:255}),a1:.16,a2:0}),
]);}
/** 2D 볼록 껍질(monotone chain). 입력 점이 3개 미만이면 그대로 돌려줘요. */
function convexHull(points){
  const pts=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(pts.length<3)return pts;
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[];for(const p of pts){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
  const upper=[];for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
/** 3D 지면 효과 — 바닥(+Z, 회전한 큐브의 가장 낮은 꼭짓점 바로 밑)에 큐브 8 꼭짓점을 그림자 방향으로 사영한 볼록 껍질 그림자와, 바닥 거울상 반사광.
 *  scene.project 가 자세·원근을 적용하므로 계산은 모델 좌표(0…n)에서 해요. 운영자 2026-09-14: 2.5D 띠는 3D 회전과 안 맞아요. */
function hLightingGround3d(scene,lighting){
  const n=scene.n,{cast,down}=lighting.groundCast;
  const denom=dot(cast,down);
  if(!(denom>1e-6))return null;
  const corners=[0,n].flatMap(x=>[0,n].flatMap(y=>[0,n].map(z=>[x,y,z])));
  const heights=corners.map(v=>dot(v,down));
  const ground=Math.max(...heights)+.03*n;
  const point=(x,y)=>({x:clamp(x,0,scene.width),y:clamp(y,0,scene.height)});
  const project=v=>{const p=scene.project(v);return point(p.x,p.y);};
  const shadowPts=corners.map((v,i)=>{const t=(ground-heights[i])/denom;return project(v.map((c,k)=>c+cast[k]*t));});
  const reflectPts=corners.map((v,i)=>project(v.map((c,k)=>c-down[k]*2*(heights[i]-ground))));
  const lowest=corners[heights.indexOf(Math.max(...heights))],contact=project(lowest);
  const band=(role,pts,color,a1)=>{
    const hull=convexHull(pts);if(hull.length<3)return null;
    // 접점(가장 낮은 꼭짓점의 사영)에서 가장 먼 껍질 점까지 알파가 a1→0 으로 줄어요.
    const far=hull.reduce((best,p)=>Math.hypot(p.x-contact.x,p.y-contact.y)>Math.hypot(best.x-contact.x,best.y-contact.y)?p:best,hull[0]);
    return {role,group:'h-ground',color,points:hull,gradient:{x1:contact.x,y1:contact.y,x2:far.x,y2:far.y,a1,a2:0}};
  };
  return [band('shadow',shadowPts,Object.freeze({r:0,g:0,b:0}),.22),band('reflect',reflectPts,Object.freeze({r:255,g:255,b:255}),.16)].filter(Boolean);
}
/** Convert normalized ground-band specs into viewport-clipped quad/gradient records. 3D 장면(project·n)에서는 사영 그림자·반사광을 써요. */
export function hLightingGround(scene,lighting){
  if(!lighting?.ground?.length)return[];
  if(lighting.groundCast&&typeof scene?.project==='function'&&Number.isFinite(scene?.n)&&scene.n>0){
    const bands=hLightingGround3d(scene,lighting);
    if(bands&&bands.length)return bands;
  }
  const side=Math.min(scene.width,scene.height),cx=scene.width/2;
  const vertices=typeof scene.project==='function'&&scene.n?[0,scene.n].flatMap(x=>[0,scene.n].flatMap(y=>[0,scene.n].map(z=>scene.project([x,y,z])))):null;
  const cy=vertices?Math.max(...vertices.map(p=>p.y))-.025*side:scene.height*.79;
  const base=side*.17,depth=side*.16,point=(x,y)=>({x:clamp(x,0,scene.width),y:clamp(y,0,scene.height)});
  return lighting.ground.map(b=>{
    const nx=-b.dy,ny=b.dx;
    const raw=[{x:cx+nx*base,y:cy+ny*base},{x:cx-nx*base,y:cy-ny*base}];
    const points=[...raw,{x:raw[1].x+b.dx*depth,y:raw[1].y+b.dy*depth},{x:raw[0].x+b.dx*depth,y:raw[0].y+b.dy*depth}].map(p=>point(p.x,p.y));
    return {role:b.role,group:'h-ground',color:b.color,points,gradient:{x1:cx,y1:cy,x2:cx+b.dx*depth,y2:cy+b.dy*depth,a1:b.a1,a2:b.a2}};
  });
}
