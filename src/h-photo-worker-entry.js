/** 사진의 휘도 변환과 H 부분면 수집도 워커에서 실행해요. */
import { createHScanRuntime } from './h-scan-runtime.js';
import { relativeLuminance8 } from './luminance.js';

export const H_PHOTO_WORKER_URL = import.meta.url;

/** 카메라와 같은 선형 휘도예요. 큰 사진은 검출기의4M픽셀 경계로 줄여요. */
export function hPhotoLuma(image, maxPixels=4_000_000) {
  if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)
    ||image.width<1||image.height<1||image.width*image.height>16_000_000
    ||!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>4_000_000)throw new TypeError('H photo dimensions');
  const pixels=image.width*image.height,linear=image.data instanceof Float32Array;
  if(!(linear||image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)
    ||image.data.length!==pixels*(linear?1:4))throw new TypeError('H photo data');
  const scale=Math.min(1,Math.sqrt(maxPixels/pixels));
  const width=Math.max(1,Math.floor(image.width*scale)),height=Math.max(1,Math.floor(image.height*scale));
  const data=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.min(image.width-1,Math.floor((x+.5)*image.width/width));
    const sy=Math.min(image.height-1,Math.floor((y+.5)*image.height/height)),at=sy*image.width+sx;
    if(linear)data[y*width+x]=image.data[at];
    else {
      const q=at*4,alpha=image.data[q+3]/255;
      // 완전 투명한 배경의 RGB잔재가 검은 파인더로 오인되지 않도록 흰 종이에 합성해요.
      data[y*width+x]=relativeLuminance8(Math.round(image.data[q]*alpha+255*(1-alpha)),
        Math.round(image.data[q+1]*alpha+255*(1-alpha)),Math.round(image.data[q+2]*alpha+255*(1-alpha)));
    }
  }
  return {width,height,data};
}

export function createHPhotoWorkerEndpoint(send,{createRuntime=createHScanRuntime}={}) {
  let runtime=null,generation=null;
  return function receive(message){
    if(!message||message.type!=='photo'||!Number.isSafeInteger(message.generation)
      ||!Number.isSafeInteger(message.requestId))return;
    try {
      if(!runtime||generation!==message.generation){runtime?.reset();generation=message.generation;
        runtime=createRuntime({enabled:true,sessionId:'photos',coldIntervalMs:0,activeIntervalMs:0});}
      const field=hPhotoLuma(message.image),started=performance.now();
      let hit=runtime.pushFrame(field,message.timestamp,{frameId:message.requestId,force:true});
      // 최대8묶음×64조합을8회씩 분할해 소진해요. 사진을 더 넣지 않아도 남은 CRC검사를 마쳐요.
      for(let turn=0;!hit&&turn<64&&runtime.stats.stats?.lastAttempts>0;turn++) {
        if(typeof runtime.retryPending!=='function')break;
        hit=runtime.retryPending();
      }
      send({type:'result',generation,requestId:message.requestId,hit,stats:runtime.stats,serviceMs:performance.now()-started});
    }catch(error){send({type:'error',generation:message.generation,requestId:message.requestId,message:String(error?.message??error)});}
  };
}
if(typeof DedicatedWorkerGlobalScope!=='undefined'&&globalThis instanceof DedicatedWorkerGlobalScope){
  const receive=createHPhotoWorkerEndpoint(message=>globalThis.postMessage(message));
  globalThis.onmessage=event=>receive(event.data);
}
