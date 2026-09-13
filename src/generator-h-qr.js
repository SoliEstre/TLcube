/** H 면/와이어와 분리된 코너 QR 합성. 안쪽 선택은 Y로 돌아갈 때까지 보존해요. */
import {qrMatrix} from './qr.js';
const CORNERS=Object.freeze(['TL','TR','BL','BR']);
const QUIET=4,TARGET_RATIO=.17,INSET_RATIO=.035,GAP_RATIO=.01;
/** 회전 불변인 투영 외접구 밖에 QR을 놓아 큐브 중심·크기를 유지해요. */
export function hCornerQrMetrics(scene,qrSize){
  const n=scene?.hModel?.surfaceN,projection=scene?.hModel?.projection??{};
  if(!Number.isFinite(n)||n<=0||!Number.isInteger(qrSize)||qrSize<=0)throw new RangeError('H QR metrics');
  const perspective=projection.perspective??.18;
  if(!Number.isFinite(perspective)||!Number.isFinite(scene.width)||scene.width<=0||scene.width!==scene.height)throw new RangeError('H QR projection');
  const beta=Math.sin(Math.min(1,Math.max(0,perspective))*Math.PI/3),denom=Math.sqrt(1-beta*beta);
  const radius=n*Math.sqrt(3)/(2*denom),inset=scene.width*INSET_RATIO,gap=scene.width*GAP_RATIO;
  const safeBlock=scene.width/2-radius/Math.SQRT2-gap-inset,block=Math.min(scene.width*TARGET_RATIO,safeBlock);
  if(!(block>0))throw new RangeError('H QR has no safe corner block');
  return {block,module:block/(qrSize+QUIET*2),quiet:QUIET,inset,gap,radius};
}
// 회전 중 같은 QR의 RS/마스크를 반복하지 않아요. 한 항목만 보관하고 모듈은 외부에 노출하지 않아요.
let lastQrText,lastQr;
function cornerQrMatrix(text){
  if(!lastQr||text!==lastQrText){const next=qrMatrix(text);lastQrText=text;lastQr=next;}
  return lastQr;
}
export function hQrPosition(position){return CORNERS.includes(position)?position:'none';}
export function withHCornerQr(scene,{text,corner}={}){
  if(text===undefined||!CORNERS.includes(corner))return scene;
  const qr=cornerQrMatrix(text),{block,module,quiet,inset}=hCornerQrMetrics(scene,qr.size);
  const left=corner.endsWith('L'),top=corner.startsWith('T');
  const width=scene.width,height=scene.height;
  const x=left?inset:width-inset-block,y=top?inset:height-inset-block;
  const rect=(x0,y0,w,h,color)=>({kind:'polygon',color,qr:true,points:[{x:x0,y:y0},{x:x0+w,y:y0},{x:x0+w,y:y0+h},{x:x0,y:y0+h}]});
  const shapes=scene.shapes.map(shape=>({...shape,color:{...shape.color},points:shape.points.map(point=>({...point}))}));
  shapes.push(rect(x,y,block,block,{r:255,g:255,b:255}));
  for(let row=0;row<qr.size;row++)for(let col=0;col<qr.size;col++)if(qr.modules[row*qr.size+col]===1){
    shapes.push(rect(x+(quiet+col)*module,y+(quiet+row)*module,module,module,{r:0,g:0,b:0}));
  }
  return {...scene,shapes,hCornerQr:{text,corner,x,y,size:block,module,quiet,inset}};
}
