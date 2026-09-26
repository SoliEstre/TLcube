/** H 면/와이어와 분리된 코너 QR 합성. 안쪽 선택은 Y로 돌아갈 때까지 보존해요.
 *  H 의 «안쪽» 은 Y 의 윈도 β·슬롯이 아니라 빈 면 TL 스캐너 QR 이에요(운영자 2026-09-25·26) — 저장된 qrPosition 은 쓰지 않고
 *  면 자산(content 'qr')에서 유효 위치를 파생해요. 그래서 Y 로 돌아가면 Y 의 선택이 그대로예요. */
import {qrMatrix} from './qr.js';
import {hImageTargets} from './h-face-arrangement.js';
import {hModeFaces} from './h-profile.js';
import {SQUARE_CELL_STYLES,styledGridShapes} from './square-cell-style.js';
import {qrFunctionMapV1} from './qr-function-map.js';
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
/** 현재 이미지 대상(편집기 카드) 기준 면 QR 요약. 숨은 슬롯의 QR 은 세지 않아요.
 *  fillable = 이미지·텍스트·QR 이 없는 대상(에셋 없음 또는 배경만 바꾼 'fill') — 글자를 비운 텍스트 면도 여기에 들어요. */
export function hFaceQrSummary(state,faceImages={}){
  const mode=state.hFaces,faces=Object.fromEntries(hModeFaces(mode).map(face=>[face,true]));
  const targets=hImageTargets({mode,faces},{arrangement:state.hArrangement,renderFaces:state.hRenderFaces}).map(target=>target.face);
  const kind=face=>faceImages?.[face]?.content??null;
  const qr=targets.filter(face=>kind(face)==='qr'),fillable=targets.filter(face=>kind(face)===null||kind(face)==='fill');
  return {targets,qr,fillable,available:targets.length>0&&(qr.length>0||fillable.length>0),
    reason:!targets.length?'noTargets':qr.length||fillable.length?null:'occupied'};
}
/** H 의 유효 QR 위치 — 보이는 대상에 면 QR 이 하나라도 있으면 'inner', 아니면 저장된 코너(없으면 none)예요. */
export function hEffectiveQrPosition(qrPosition,summary){return summary.qr.length>0?'inner':hQrPosition(qrPosition);}
/** 면 QR 과 코너 QR 병행(고급 qrCornerToo)의 코너 — 저장된 코너가 있으면 그 자리, 없으면 좌상이에요.
 *  O/A 중앙 QR 병행은 숨은 코너 상태 없이 늘 좌상(scene.js 기본값)에 그려요. H 는 전에 고른 코너를 따르므로,
 *  그 코너가 숨은 상태가 되지 않게 카드 줄이 점선 보조 표시와 힌트로 보여 줘요(index.html renderQrPositionUi). */
export function hCornerTooCorner(qrPosition){const corner=hQrPosition(qrPosition);return corner==='none'?'TL':corner;}
// ── 코너 QR 꾸미기(DESIGN_001 §5.2 · §4.2 generator-h-qr) ──────────────────────
// deco 는 qr-colors.js `resolveQrDeco(state, basePalette, 'h')` 의 결과({dark, light, eye, cellStyle})예요 —
// 여는 결정은 그쪽 허용표·대비 가드가 해요. 여기서는 받은 값을 그리기만 하고, deco 가 없으면 기존 흑백 사각 그대로예요.
const isRgb=c=>!!c&&typeof c==='object'&&['r','g','b'].every(k=>Number.isInteger(c[k])&&c[k]>=0&&c[k]<=255);
/** deco 서명 — 캐시 키 확장용. deco 없음(null·undefined) → '' (기본값의 키 문자열은 그대로 둬요). 모양이 틀리면 던져요. */
export function hQrDecoKey(deco){
  if(deco===undefined||deco===null)return '';
  if(typeof deco!=='object'||!SQUARE_CELL_STYLES.includes(deco.cellStyle)||!['dark','light','eye'].every(k=>isRgb(deco[k])))
    throw new TypeError('H QR deco 는 resolveQrDeco 결과 {dark, light, eye, cellStyle} 여야 해요');
  const c=v=>`${v.r},${v.g},${v.b}`;
  return `${deco.cellStyle}|${c(deco.dark)}|${c(deco.light)}|${c(deco.eye)}`;
}
/**
 * 꾸민 코너 QR 모듈 조각 — 모듈 로컬 좌표(1 = 한 모듈, 원점 = QR 좌상단 모듈, quiet 제외)를 `map` 으로 옮겨요.
 * 기능 영역(파인더+분리자 · 타이밍 · 포맷 · dark module)은 qr-function-map 이 v1 규격에서 유도한 대로 **사각 고정**,
 * 데이터 어두운 모듈만 스타일을 받아요. 눈(파인더 7×7)의 어두운 모듈은 deco.eye, 나머지 어두운 모듈은 deco.dark.
 * 모든 조각에 {qr, selfQuiet, noSeam} 을 붙여요(host 'qr' 필수 태그 — safety M3 · wiring M12).
 * CPU 장면(withHCornerQr)과 GPU 텍스처(h-preview-renderer qrTexture)가 이 한 함수를 써서 같은 다각형을 그려요.
 */
export function hStyledQrPieces(qr,deco,map){
  hQrDecoKey(deco);
  const fn=qrFunctionMapV1();
  if(qr?.size!==fn.size)throw new RangeError(`H QR deco 는 v1(${fn.size}×${fn.size}) 전용이에요: ${qr?.size}`);
  const dark=(r,c)=>qr.modules[r*qr.size+c]===1;
  // 밝은 기능 모듈(분리자 · 파인더 흰 고리 · 타이밍 흰 칸 등)도 'fixed' 로 넘겨요 — null(빈 칸)이면 liquid 오목 필렛이
  // 그 모서리를 어두운 색으로 칠해 검출 요소를 바꿔요. 그 자리의 흰 사각 조각은 밝은 판과 같아 버려요(모듈 로컬에서 가른 뒤 map).
  const local=styledGridShapes({rows:qr.size,cols:qr.size,style:deco.cellStyle,host:'qr',
    role:(r,c)=>fn.isFunctionModule(c,r)?'fixed':dark(r,c)?'data':null,
    color:(r,c)=>!dark(r,c)?deco.light:fn.isEyeModule(c,r)?deco.eye:deco.dark,
    map:(x,y)=>({x,y}),tags:{qr:true,selfQuiet:true,noSeam:true}});
  const out=[];
  for(const piece of local){
    let sx=0,sy=0;for(const point of piece.points){sx+=point.x;sy+=point.y;}
    const r=Math.floor(sy/piece.points.length),c=Math.floor(sx/piece.points.length);
    if(fn.isFunctionModule(c,r)&&!dark(r,c))continue;
    out.push({...piece,points:piece.points.map(point=>map(point.x,point.y))});
  }
  return out;
}
// 회전 프레임마다 같은 조각을 다시 펴지 않게 모듈 로컬 조각을 한 칸 보관해요. 키 = 문구 + deco 서명 —
// 문구 캐시(cornerQrMatrix)와 따로라 기본 경로(deco 없음)의 키·동작은 그대로예요.
let lastStyledKey,lastStyledPieces;
function styledQrLocal(text,qr,deco){
  const key=JSON.stringify([text,hQrDecoKey(deco)]);
  if(!lastStyledPieces||key!==lastStyledKey){const next=hStyledQrPieces(qr,deco,(x,y)=>({x,y}));lastStyledKey=key;lastStyledPieces=next;}
  return lastStyledPieces;
}
export function withHCornerQr(scene,{text,corner,deco}={}){
  if(text===undefined||!CORNERS.includes(corner))return scene;
  const qr=cornerQrMatrix(text),{block,module,quiet,inset}=hCornerQrMetrics(scene,qr.size);
  const left=corner.endsWith('L'),top=corner.startsWith('T');
  const width=scene.width,height=scene.height;
  const x=left?inset:width-inset-block,y=top?inset:height-inset-block;
  const rect=(x0,y0,w,h,color)=>({kind:'polygon',color,qr:true,points:[{x:x0,y:y0},{x:x0+w,y:y0},{x:x0+w,y:y0+h},{x:x0,y:y0+h}]});
  const shapes=scene.shapes.map(shape=>({...shape,color:{...shape.color},points:shape.points.map(point=>({...point}))}));
  if(deco!==undefined&&deco!==null){
    // 밝은 판(quiet 포함)은 deco.light(= #fff, G3)이고 selfQuiet·noSeam 을 같이 달아요.
    shapes.push({...rect(x,y,block,block,{...deco.light}),selfQuiet:true,noSeam:true});
    for(const piece of styledQrLocal(text,qr,deco))shapes.push({...piece,color:{...piece.color},
      points:piece.points.map(p=>({x:x+(quiet+p.x)*module,y:y+(quiet+p.y)*module}))});
    return {...scene,shapes,hCornerQr:{text,corner,x,y,size:block,module,quiet,inset,cellStyle:deco.cellStyle}};
  }
  shapes.push(rect(x,y,block,block,{r:255,g:255,b:255}));
  for(let row=0;row<qr.size;row++)for(let col=0;col<qr.size;col++)if(qr.modules[row*qr.size+col]===1){
    shapes.push(rect(x+(quiet+col)*module,y+(quiet+row)*module,module,module,{r:0,g:0,b:0}));
  }
  return {...scene,shapes,hCornerQr:{text,corner,x,y,size:block,module,quiet,inset}};
}
