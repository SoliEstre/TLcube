/** 영상 밝기 패턴으로 H를 재관측하는 선택적 기하 추적기. 포맷/본문/identity 수용기는 아니다. */
import { projectPoint, invertHomography } from './homography.js';
import { trackPhotometric, multiply3 } from './c-photometric-track.js';

const validField=f=>Number.isSafeInteger(f?.width)&&Number.isSafeInteger(f?.height)&&f.width>0&&f.height>0&&f.data instanceof Float32Array&&f.data.length===f.width*f.height&&f.data.every(Number.isFinite)&&(!f.alpha||(f.alpha instanceof Uint8Array&&f.alpha.length===f.data.length));
const validH=H=>H instanceof Float64Array&&H.length===9&&H.every(Number.isFinite);
const copy=f=>({width:f.width,height:f.height,data:f.data.slice(),alpha:f.alpha?.slice()??null});
function equalPixels(a,b){if(a.width!==b.width||a.height!==b.height||!!a.alpha!==!!b.alpha)return false;for(let i=0;i<a.data.length;i++)if(!Object.is(a.data[i],b.data[i])||(a.alpha&&!Object.is(a.alpha[i],b.alpha[i])))return false;return true;}

export function cBodyTrackingPoints(field,H,k){
  const inverse=invertHomography(H);if(!inverse)return [];
  const corners=[[k,0],[0,k],[-k,k],[-k,0],[0,-k],[k,-k]].map(([q,r])=>projectPoint(H,{x:Math.sqrt(3)*(q+r/2),y:1.5*r}));
  if(corners.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return [];
  const minX=Math.max(2,Math.ceil(Math.min(...corners.map(p=>p.x)))),maxX=Math.min(field.width-3,Math.floor(Math.max(...corners.map(p=>p.x))));
  const minY=Math.max(2,Math.ceil(Math.min(...corners.map(p=>p.y)))),maxY=Math.min(field.height-3,Math.floor(Math.max(...corners.map(p=>p.y))));
  if(maxX<=minX||maxY<=minY)return [];
  const step=Math.max(1,Math.ceil(Math.sqrt((maxX-minX)*(maxY-minY)/1800))),points=[];
  for(let y=minY;y<=maxY;y+=step)for(let x=minX;x<=maxX;x+=step){const p=projectPoint(inverse,{x,y});if(!p)continue;const r=p.y/1.5,q=p.x/Math.sqrt(3)-r/2,extent=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));if(extent>=4&&extent<=k-.5)points.push({x,y});}
  return points;
}

/**
 * minNcc는 호출자가 평가로 지정하는 필수 값이며 기본값/자동 활성화는 없다.
 * ok는 기하 관측 후보이며 같은 본문/코드라는 identity 판정이 아니다.
 */
export function createCBodyTracker(initial,H,k,{minNcc,origin}={}){
  if(!validField(initial)||!validH(H)||!Number.isSafeInteger(k)||k<=4)throw new TypeError('유효한 영상·H·반경이 필요해요');
  if(!Number.isFinite(minNcc)||minNcc<0||minNcc>1)throw new TypeError('minNcc는 0..1의 필수 값이에요');
  if(!origin||!(typeof origin.frameId==='string'||Number.isSafeInteger(origin.frameId))||!Number.isFinite(origin.timestamp))throw new TypeError('유효한 origin이 필요해요');
  const originGeneration=origin.generation;
  const copiedAt=performance.now();
  let previous=copy(initial),pose=H.slice(),last={...origin},discarded=null,revision=0;
  const stats={copyMs:performance.now()-copiedAt,snapshotBytes:previous.data.byteLength+(previous.alpha?.byteLength??0),trackMs:0,observations:0};
  function discard(reason='discarded'){discarded=reason;previous=null;pose=null;stats.snapshotBytes=0;}
  function observe(field,current){
    if(discarded)return {ok:false,reason:discarded};
    if(!validField(field)||!current||!(typeof current.frameId==='string'||Number.isSafeInteger(current.frameId))||!Number.isFinite(current.timestamp))throw new TypeError('유효한 현재 프레임이 필요해요');
    if(originGeneration!==undefined&&current.generation!==originGeneration){discard('generation');return {ok:false,reason:discarded};}
    if(field.width!==previous.width||field.height!==previous.height){discard('resize');return {ok:false,reason:discarded};}
    if(current.timestamp<last.timestamp){discard('time-reversal');return {ok:false,reason:discarded};}
    const same=equalPixels(previous,field),sameFrame=Object.is(last.frameId,current.frameId)&&last.timestamp===current.timestamp;
    if(sameFrame&&!same){discard('same-frame-content-changed');return {ok:false,reason:discarded};}
    if(same){last={...current};return {ok:true,H:pose.slice(),revision,samePixels:true,quality:{ncc:1,rms:0}};}
    // alpha 변화는 밝기 추적으로 증명할 수 없어 재관측에 맡겨요.
    if(!!field.alpha!==!!previous.alpha||(field.alpha&&field.alpha.some((value,i)=>value!==previous.alpha[i]))){discard('alpha-changed');return {ok:false,reason:discarded};}
    const points=cBodyTrackingPoints(previous,pose,k);
    if(points.length<20){discard('points-starved');return {ok:false,reason:discarded};}
    const tracked=trackPhotometric(previous,field,points);stats.trackMs+=tracked.ms;stats.observations++;
    const moved=multiply3(tracked.motion,pose);
    if(!(tracked.after.ncc>=minNcc)||!(tracked.gain>0)||!validH(moved)||!invertHomography(moved)){
      const quality={...tracked.after,gain:tracked.gain,bias:tracked.bias};discard('photometric-unproven');return {ok:false,reason:discarded,quality};
    }
    const at=performance.now();previous=copy(field);stats.copyMs+=performance.now()-at;pose=moved;last={...current};revision++;
    return {ok:true,H:pose.slice(),revision,samePixels:false,quality:{...tracked.after,gain:tracked.gain,bias:tracked.bias}};
  }
  function fork(){
    if(discarded)return null;
    // 마지막으로 검증한 픽셀/H/프레임을 복사해 후보 간 수명을 분리해요.
    return createCBodyTracker(previous,pose,k,{minNcc,origin:{...last,generation:originGeneration}});
  }
  return Object.freeze({observe,discard,fork,stats,get discarded(){return discarded;},get H(){return pose?.slice()??null;}});
}
