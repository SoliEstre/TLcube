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
/** Convert normalized ground-band specs into viewport-clipped quad/gradient records. */
export function hLightingGround(scene,lighting){
  if(!lighting?.ground?.length)return[];
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
