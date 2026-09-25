/** 타입 H 빈 면에 넣는 TL 스캐너 QR — 코너 QR 과 같은 문구를 면 이미지 자산으로 만들어요(운영자 2026-09-25).
 *  새 렌더 경로를 만들지 않아요. 이 자산은 빈 면 이미지와 같은 통로(faceImages)로 2.5D·GPU·영상·전개도·glTF·.schem 에 실려요.
 *  모듈 피치가 정수(29모듈 × 35px = 1015px)라 합성기·최근접 표본에서 모듈 경계가 흐려지지 않아요.
 *  색은 #000/#fff 두 값뿐이고 팔레트·톤·hue 와 무관해요. 4모듈 quiet 는 타일 안에 들어 있어요. */
import {qrMatrix} from './qr.js';
import {rasterToPng} from './png.js';
import {assertSceneImage} from './scene-image.js';

export const H_FACE_QR_QUIET=4;
export const H_FACE_QR_MAX_SIDE=1024;

function pngHref(width,height,pixels){
  const bytes=rasterToPng({width,height,pixels});
  if(typeof Buffer!=='undefined')return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
  let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return `data:image/png;base64,${btoa(text)}`;
}

// 문구가 같으면 모든 QR 면이 같은 CPU 자산 객체를 공유해요(약 4 MB 한 번). GPU 미리보기 텍스처는 공유하지 않아요 —
// 렌더러가 면마다 따로 만들어 올리고, 자원 키에 인코딩 객체 정체성이 들어 있어 다시 렌더할 때마다 다시 올려요(성능 개선은 별도 변경).
let lastText,lastImage;
/** 문구 → 불투명 정사각 QR 면 raster. 문구가 QR 문자셋·용량 밖이면 qrMatrix 가 던지는 오류를 그대로 던져요. */
export function hFaceQrImage(text){
  if(lastImage&&text===lastText)return lastImage;
  const qr=qrMatrix(text),modules=qr.size+H_FACE_QR_QUIET*2,px=Math.floor(H_FACE_QR_MAX_SIDE/modules),side=modules*px;
  const pixels=new Uint8ClampedArray(side*side*4).fill(255);
  for(let r=0;r<qr.size;r++)for(let c=0;c<qr.size;c++){
    if(qr.modules[r*qr.size+c]!==1)continue;
    for(let y=(H_FACE_QR_QUIET+r)*px,ye=y+px;y<ye;y++)for(let x=(H_FACE_QR_QUIET+c)*px,xe=x+px,k=(y*side+x)*4;x<xe;x++,k+=4){pixels[k]=pixels[k+1]=pixels[k+2]=0;}
  }
  const image=Object.freeze(assertSceneImage({width:side,height:side,pixels,href:pngHref(side,side,pixels),pixelated:true,content:'qr',
    qr:Object.freeze({text,size:qr.size,modulePx:px,quiet:H_FACE_QR_QUIET})}));
  lastText=text;lastImage=image;
  return image;
}
/** .schem 에서 면 QR 의 모든 모듈(quiet 포함)이 블록을 하나 이상 받는 최소 셀당 블록 수예요. QR 면이 없으면 1 이에요.
 *  블록 중심 표본(cubeImageVoxelQuads)은 면 한 변 n·scale 블록이 모듈 수보다 적으면 모듈을 건너뛰어 QR 이 깨져요 —
 *  H3(n=25)·1×1 은 441 모듈 중 56 개가 틀리고, 2×2 와 H4(n=29)·1×1 은 전부 맞아요. */
export function hFaceQrMinBlockScale(model){
  let scale=1;
  for(const placement of model?.images??[]){
    const qr=placement.image?.content==='qr'?placement.image.qr:null;if(!qr)continue;
    // 이미지가 차지하는 면 위 한 변(셀 단위) — QR 면은 면 전체라 보통 n 이에요.
    const side=Math.min(placement.width??model.n,placement.height??model.n);
    scale=Math.max(scale,Math.ceil((qr.size+2*qr.quiet)/side));
  }
  return scale;
}
