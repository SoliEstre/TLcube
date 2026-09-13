import test from 'node:test';
import assert from 'node:assert/strict';
import {createHPhotoReader} from '../src/h-photo-reader.js';
import {createHPhotoWorkerEndpoint,hPhotoLuma} from '../src/h-photo-worker-entry.js';
import {encodeH} from '../src/h-codec.js';
import {buildHScene,hAutoRotation} from '../src/h-render.js';
import {rasterize} from '../src/raster.js';
import {H_SCANNER_COPY,hProgressModel,hScannerText,hCameraActive} from '../src/h-scanner-ui.js';
import {normalizeDecodePayload,resultAutoOpen} from '../src/scanner-scan-assist.js';
import {hHitToDecodeResult,createHScanRuntime,isVerifiedHDecodeResult} from '../src/h-scan-runtime.js';
import {hLayout} from '../src/h-layout.js';

const imageAt=(encoded,t)=>{const r=rasterize(buildHScene(encoded,{...hAutoRotation(t),perspective:.18}),{pixelsPerUnit:12,supersample:2});
  return {width:r.width,height:r.height,data:r.pixels};};
function endpointWorker(){
  const worker={terminate(){this.terminated=true;}};
  const receive=createHPhotoWorkerEndpoint(data=>worker.onmessage?.({data}));
  worker.postMessage=message=>queueMicrotask(()=>{if(!worker.terminated)receive(message);});
  return worker;
}

test('두 사진의 실제 픽셀이 워커 메시지 경로에서3/6→6/6→원문으로 이어져요',async()=>{
  const encoded=encodeH('photo',{version:1,mode:6,tones:2,ecc:'M',mask:3});
  const reader=createHPhotoReader({createWorker:endpointWorker});
  const front=await reader.read(imageAt(encoded,0),{timestamp:0});
  assert.equal(front.hit,null);assert.equal(front.stats.count,3);assert.equal(front.stats.required,6);
  const model=hProgressModel(front.stats,'ko',{source:'photos',now:0});
  assert.deepEqual(model.present,['ZM','XM','YM']);assert.equal(model.summary,'3/6면 수집');
  const back=await reader.read(imageAt(encoded,12000),{timestamp:12000});
  assert.equal(back.stats.state,'DONE');assert.equal(back.stats.count,6);assert.equal(back.hit.text,'photo');
  const result=hHitToDecodeResult(back.hit);assert.equal(normalizeDecodePayload(result),'photo');
  assert.equal(resultAutoOpen(result,{isVerifiedHResult:isVerifiedHDecodeResult}),true);
  assert.equal(resultAutoOpen({...result},{isVerifiedHResult:isVerifiedHDecodeResult}),false);
  assert.equal(hHitToDecodeResult({...back.hit,crc:-1}),null);
  assert.match(hScannerText('ko','summary',result.hSummary),/H1.*6면.*2톤/);
  assert.equal(reader.metrics.processed,2);reader.dispose();
});
test('워커가 없는 환경도 같은 부분면 계약으로 두 사진을 읽어요',async()=>{
  const encoded=encodeH('fallback',{version:1,mode:6});
  const reader=createHPhotoReader({createWorker:()=>{throw new Error('unavailable');}});
  const first=await reader.read(imageAt(encoded,0),{timestamp:0});assert.equal(first.stats.count,3);
  const last=await reader.read(imageAt(encoded,12000),{timestamp:1000});assert.equal(last.hit.text,'fallback');
  assert.equal(reader.metrics.mode,'main-fallback');reader.dispose();
});
test('사진 초기화는 진행중 Promise를 취소하고 늦은 메시지를 거절해요',async()=>{
  let worker;
  const reader=createHPhotoReader({createWorker:()=>worker={postMessage(m){this.message=m;},terminate(){}}});
  const request=reader.read({width:1,height:1,data:new Float32Array([1])},{timestamp:1});
  const rejected=assert.rejects(request,{name:'AbortError'});
  reader.reset();await rejected;
  worker.onmessage({data:{type:'result',generation:worker.message.generation,requestId:worker.message.requestId,stats:{state:'DONE'},hit:{text:'old'}}});
  assert.equal(reader.stats,null);assert.equal(reader.metrics.staleResults,1);reader.dispose();
});
test('H 사진은 다른 세대의 세 면과 합쳐서 완료하지 않아요',()=>{
  const encoded=encodeH('H',{version:0,mode:6});const responses=[];
  const receive=createHPhotoWorkerEndpoint(row=>responses.push(row));
  receive({type:'photo',generation:1,requestId:1,timestamp:0,image:imageAt(encoded,0)});
  receive({type:'photo',generation:2,requestId:2,timestamp:12000,image:imageAt(encoded,12000)});
  assert.equal(responses[0].stats.count,3);assert.equal(responses[1].stats.count,3);assert.equal(responses[1].hit,null);
});
test('휘도 변환은 투명 RGB 잔재를 제거하고 면적 경계를 지켜요',()=>{
  const image={width:4,height:2,data:new Uint8ClampedArray(32)};
  const white=hPhotoLuma(image);assert(white.data.every(v=>v===1));
  const small=hPhotoLuma({...image,data:new Float32Array(8).fill(.4)},4);
  assert(small.width*small.height<=4);assert(Math.abs(small.data[0]-.4)<1e-6);
  assert.throws(()=>hPhotoLuma({width:4,height:2,data:new Uint8Array(8)}));
});
test('H 전용8언어는 같은키를 갖고 면수100%를CRC완료로 오표시하지 않아요',()=>{
  const keys=Object.keys(H_SCANNER_COPY.ko).sort();assert.equal(Object.keys(H_SCANNER_COPY).length,8);
  for(const dictionary of Object.values(H_SCANNER_COPY))assert.deepEqual(Object.keys(dictionary).sort(),keys);
  const stats={state:'COLLECTING',count:6,required:6,leadingId:'a',assemblies:[{id:'a',present:['ZM','XM','YM','ZP','XP','YP'],expiresAt:100}]};
  assert.equal(hProgressModel(stats,'ko').summary,'6/6면 · 본문 재확인 중');
  assert.equal(hProgressModel(stats,'ko',{now:101}).state,'EMPTY');
  assert.equal(hProgressModel(null,'en').required,0);
});

test('사진 워커 장애는 취소와 구별하고 다음 사진은 fallback에서 새로 모아요',async()=>{
  let worker;
  const reader=createHPhotoReader({createWorker:()=>worker={postMessage(){},terminate(){}}});
  const request=reader.read({width:1,height:1,data:new Float32Array([1])},{timestamp:1});
  const rejected=assert.rejects(request,{name:'WorkerError'});
  worker.onerror({message:'module failure',preventDefault(){}});await rejected;
  assert.equal(reader.stats,null);assert.equal(reader.metrics.mode,'main-fallback');
  const next=await reader.read(imageAt(encodeH('A',{version:0,mode:6}),0),{timestamp:2});
  assert.equal(next.stats.count,3);assert.equal(next.hit,null);reader.dispose();
});

test('사진 UI는 묶음 전체보다 먼저 만료되는 면과 다음 갱신 시각을 표시해요',()=>{
  const stats={state:'COLLECTING',required:6,leadingId:'a',assemblies:[{id:'a',present:['ZM','XM','YM','ZP'],
    expiresAt:150000,faceExpiresAt:{ZM:90000,XM:90000,YM:90000,ZP:150000}}]};
  assert.equal(hProgressModel(stats,'ko',{now:60000}).nextExpiryAt,90001);
  const later=hProgressModel(stats,'ko',{now:91000});
  assert.deepEqual(later.present,['ZP']);assert.equal(later.count,1);assert.equal(later.nextExpiryAt,150001);
  assert.equal(hProgressModel(stats,'ko',{now:150001}).state,'EMPTY');
  assert.equal(hCameraActive({lastConfirmedAt:1000},1400),true);
  assert.equal(hCameraActive({lastConfirmedAt:1000},1501),false);
  assert.equal(hCameraActive({lastConfirmedAt:null},0),false);
});

test('사진 워커는9번째 이후의 면 후보 조합도 새 영상 검출 없이 끝까지 검사해요',()=>{
  const e=encodeH('retry',{version:1,mode:6,tones:2,ecc:'L'});let detections=0;
  const faces=Object.entries(e.faces).flatMap(([face,levels])=>{
    const base={ok:true,version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,
      routeId:e.routeId,face,rotation:0,mirror:false,hamming:0};
    const bad=levels.slice();for(const {i,j} of hLayout(e.version).scan)bad[i*e.n+j]=1-bad[i*e.n+j];
    return [{...base,levels:bad,quality:{score:1}},{...base,levels:levels.slice(),quality:{score:.1}}];
  });
  const responses=[];
  const receive=createHPhotoWorkerEndpoint(row=>responses.push(row),{createRuntime:options=>createHScanRuntime({...options,
    detect:()=>{detections++;return {faces};}})});
  receive({type:'photo',generation:1,requestId:1,timestamp:0,image:{width:1,height:1,data:new Float32Array([1])}});
  assert.equal(responses[0].hit?.text,'retry');assert.equal(responses[0].stats.state,'DONE');
  assert(responses[0].stats.stats.decodeAttempts>8);assert.equal(detections,1);
});
