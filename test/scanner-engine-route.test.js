import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { encodeCentralN7 } from '../src/centralN7Codec.js';
import { encode as encodeFormat } from '../src/formatinfo.js';
import { classifyQrValue, routeQrHits, qrHitToDecodeResult } from '../src/qr-bridge.js';
import { CENTRAL_N7_PATTERN_FAMILY_ID, CENTRAL_N7_SCHEMA_ID } from '../src/centralN7Schema.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { createSharedCentralN7Pool } from '../src/r2/shared-central-n7.js';

import { confirmedQrEngineFamily, confirmedN7EngineFamily, protectsYHEngine, validEngineRouteEvidence } from '../src/scanner-engine-route.js';
import { createR2RoutedEngine } from '../src/r2-routed-engine.js';
import { createR2WorkerEndpoint } from '../src/r2-worker-entry.js';
import { createR2WorkerRuntime } from '../src/r2-worker-runtime.js';
const source = fs.readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(startToken, endToken) {
  const start = source.indexOf(startToken), end = source.indexOf(endToken, start);
  assert.ok(start >= 0 && end > start, startToken); return source.slice(start, end);
}
function node() { return { hidden: true, dataset: {}, attrs: {}, events: {},
  setAttribute(k,v) { this.attrs[k]=v; }, addEventListener(k,v) { this.events[k]=v; },
  click() { this.events.click(); } }; }
function context() {
  const writes=[], events=[], control=node();
  const ctx = vm.createContext({
    engineSwitch:node(),engineSwitchControl:control,r2Available:true,r2Wanted:true,
    transientEngineSwitch:false,autoR1Active:false,cameraStream:{},scanSession:5,
    r2Runtime:{enabled:true,stats:{},setEnabled(v){this.enabled=v;events.push(['engine',v]);},reset(){events.push(['reset']);}},
    acceptStopGate:{isPending:()=>false},stopCamera(){ctx.cameraStream=null;ctx.scanSession++;},
    resetHPhotos(){events.push(['photos']);},qrBridge:{reset(){events.push(['qr-reset']);}},
    runtimeFamilyHint:null,r2Latched:{},r2Correction:{},r2StatusHoldUntil:1,r2StatusCollecting:true,
    setStatus(){},t:key=>key,window:{localStorage:{setItem(k,v){writes.push([k,v]);}}},
    ENGINE_STORAGE_KEY:'tlscan.engine.r2',renderR2Progress(){},renderR2CellMap(){},refreshScanGuideCopy(){},
    resetFailureTiming(){ctx.failStreakSince=null;ctx.nextEscalationAt=null;},
    failStreakSince:0,nextEscalationAt:1600,yieldFrameOnce:false,nowMs:()=>1000,
    protectsYHEngine,validEngineRouteEvidence,confirmedQrEngineFamily,routeQrHits,qrHitToDecodeResult,
    cameraVideo:{},timestamp:1000,visibleVideoRegion:()=>({}),handleDecodeResult(){events.push(['result']);},
  });
  vm.runInContext(section('function setTransientEngine(', 'if (engineSwitch && engineSwitchControl && r2Available) {'),ctx);
  vm.runInContext(section('if (engineSwitch && engineSwitchControl && r2Available) {','const scanResetButton ='),ctx);
  return {ctx,writes,events};
}
const hits = (...values) => values.map(classifyQrValue);
function finder(family='hex') {
  const outerFormat=encodeFormat({version:1,eccLevel:1,mask:0});
  return {finderKind:CENTRAL_N7_PATTERN_FAMILY_ID,source:'central-n7-block-locator',
    centralN7:{schemaId:CENTRAL_N7_SCHEMA_ID,family,outerFormat,
      digits:encodeCentralN7({family,outerFormat})}};
}

test('정확한 비cube TL URL만 분류하고 일반·무힌트·Y/H·혼재는 전환하지 않아요',()=>{
  for(const [hint,family] of [['O','hex'],['A','tri'],['K','star'],['C','hex']]) {
    assert.equal(confirmedQrEngineFamily(hits('HTTPS://TLSCAN.ESTRE.SO/'+hint)),family);
  }
  for(const value of ['https://example.com/O','HTTPS://TLSCAN.ESTRE.SO','HTTPS://TLSCAN.ESTRE.SO/Y',
    'HTTPS://TLSCAN.ESTRE.SO/H','HTTPS://TLSCAN.ESTRE.SO/lab','HTTPS://TLSCAN.ESTRE.SO/O?x=1']) {
    assert.equal(confirmedQrEngineFamily(hits(value)),null,value);
  }
  assert.equal(confirmedQrEngineFamily([{kind:'tl-hint',family:'hex',text:'https://example.com'}]),null);
  for(const other of ['Y','H','A']) assert.equal(confirmedQrEngineFamily(hits('HTTPS://TLSCAN.ESTRE.SO/O','HTTPS://TLSCAN.ESTRE.SO/'+other)),null);
});

test('N7은 실제 codeword와 schema/source를 확인하고 모양 후보를 쓰지 않아요',()=>{
  for(const family of ['hex','tri','star']) assert.equal(confirmedN7EngineFamily([finder(family)]),family);
  const real=finder();
  for(const invalid of [{centralN7:{family:'hex'}},{...real,source:'shape'},
    {...real,centralN7:{...real.centralN7,schemaId:'other'}},
    {...real,centralN7:{...real.centralN7,digits:Array(19).fill(5)}},
    {...real,centralN7:{...real.centralN7,family:'cube'}}]) assert.equal(confirmedN7EngineFamily([invalid]),null);
  assert.equal(confirmedN7EngineFamily([finder('hex'),finder('tri')]),null);
});

test('실제 자동 전환은 클릭 callback으로 UI·타이머를 바꾸고 저장하지 않아요',()=>{
  const {ctx,writes}=context();
  assert.equal(vm.runInContext("autoRouteToR1('hex')",ctx),true);
  assert.equal(ctx.r2Runtime.enabled,false);assert.equal(ctx.engineSwitchControl.dataset.engine,'r1');
  assert.equal(ctx.engineSwitchControl.attrs['aria-checked'],'false');
  assert.equal(ctx.failStreakSince,null);assert.equal(ctx.nextEscalationAt,null);
  assert.equal(ctx.scanSession,5);assert.equal(ctx.autoR1Active,true);assert.equal(ctx.r2Wanted,true);
  assert.equal(ctx.runtimeFamilyHint.evidence.family,'hex');assert.equal(writes.length,0);
  assert.equal(ctx.yieldFrameOnce,true);
});

test('실제 QR callback의 stale·일반·Y/H 경계와 자동 분기를 실행해요',()=>{
  for(const [value,expected] of [['HTTPS://TLSCAN.ESTRE.SO/O',false],['HTTPS://TLSCAN.ESTRE.SO/Y',true],
    ['HTTPS://TLSCAN.ESTRE.SO/H',true],['https://example.com/',true]]) {
    const {ctx,writes}=context();ctx.session=5;let onHits;
    ctx.qrBridge.pushFrame=(_video,_timestamp,fn)=>{onHits=fn;};
    vm.runInContext(section('qrBridge.pushFrame(cameraVideo, timestamp, (hits) => {','\n    }\n\n    // detect'),ctx);
    onHits(hits(value));assert.equal(ctx.r2Runtime.enabled,expected,value);assert.equal(writes.length,0);
    if(expected){ctx.scanSession=6;onHits(hits('HTTPS://TLSCAN.ESTRE.SO/O'));assert.equal(ctx.r2Runtime.enabled,true);}
  }
});

test('현재 Y/H 수집·수용 유예·카메라 종료 중에는 자동 전환하지 않아요',()=>{
  for(const state of [{h:{count:1,lastConfirmedAt:1000}},{h:{observedFaces:[{}],observedAt:1000}},
    {locked:1,progressD:.1,engineRouteYConfirmedAt:1000}]) {
    const {ctx,writes}=context();ctx.r2Runtime.stats=state;
    assert.equal(vm.runInContext("autoRouteToR1('hex')",ctx),false);assert.equal(writes.length,0);
  }
  for(const kind of ['pending','no-camera']) {
    const {ctx}=context();if(kind==='pending')ctx.acceptStopGate.isPending=()=>true;else ctx.cameraStream=null;
    assert.equal(vm.runInContext("autoRouteToR1('hex')",ctx),false);
  }
});

test('옛 부분 H나 갱신되지 않은 Y 락은 새로운 비Y/H QR 전환을 막지 않아요',()=>{
  for(const state of [{h:{count:3,lastConfirmedAt:-1}},{h:{count:3}},
    {h:{observedFaces:[{}],observedAt:-1}},{locked:1,progressD:.2,engineRouteYConfirmedAt:-1}]) {
    const {ctx,writes}=context();ctx.r2Runtime.stats=state;
    assert.equal(vm.runInContext("autoRouteToR1('hex')",ctx),true);
    assert.equal(ctx.r2Runtime.enabled,false);assert.equal(writes.length,0);
  }
  assert.equal(protectsYHEngine({h:{lastConfirmedAt:0}},1000),true);
  assert.equal(protectsYHEngine({h:{lastConfirmedAt:0}},1001),false);
});

test('새 카메라·사진 진입은 자동 선택만 복원하고 수동 R1 저장은 남겨요',()=>{
  for(const entry of ['camera','photo']) {
    const {ctx,writes}=context();vm.runInContext("autoRouteToR1('star')",ctx);
    if(entry==='camera') {
      const prefix=section('function startFrameLoop(session) {','  const nextFrame = (timestamp) => {');
      vm.runInContext(prefix+'}\nstartFrameLoop(5);',ctx);
    } else {
      const prefix=section('async function decodeImageFile(file) {','  // 새 사진 선택');
      vm.runInContext(prefix+'}\ndecodeImageFile({});',ctx);
    }
    assert.equal(ctx.r2Runtime.enabled,true);assert.equal(ctx.autoR1Active,false);assert.equal(writes.length,0);
    ctx.engineSwitchControl.click();assert.equal(ctx.r2Wanted,false);assert.equal(writes.at(-1)[1],'0');
    vm.runInContext('restorePreferredEngine()',ctx);assert.equal(ctx.r2Runtime.enabled,false);
  }
});

test('유효기간과 신뢰 source를 벗어난 Worker evidence는 거절해요',()=>{
  const evidence={source:'central-n7',family:'hex',timestamp:100};
  assert.equal(validEngineRouteEvidence(evidence,3100),true);
  for(const at of [99,3101,NaN])assert.equal(validEngineRouteEvidence(evidence,at),false);
  assert.equal(validEngineRouteEvidence({...evidence,source:'shape'},200),false);
  assert.equal(validEngineRouteEvidence({...evidence,family:'cube'},200),false);
});

test('N7 라우팅은 결과를 만들지 않고 off/Y/H 때 pool을 만들지 않아요',()=>{
  let acquired=0;const inner={enabled:true,stats:{},view:{},hudCandidates:[],
    pushFrame:()=>null,reset(){},invalidateLock(){},setEnabled(v){this.enabled=v;}};
  const createPool=()=>({reset(){},acquire(_field,current){acquired++;return {origin:current,
    resumeBatch:()=>({state:'done'}),readOrigin:()=>({origin:current,finders:[finder()]}),release(){}};}});
  const runtime=createR2RoutedEngine({autoRouteR1:true},{createEngine:()=>inner,createPool});
  const field={width:32,height:32,data:new Float32Array(1024)};
  assert.equal(runtime.pushFrame(field,100,{frameId:1}),null);
  assert.equal(runtime.stats.engineRoute.family,'hex');assert.equal(acquired,1);
  inner.stats={h:{count:1,lastConfirmedAt:200}};runtime.pushFrame(field,200,{frameId:2});
  assert.equal(acquired,1);assert.equal(runtime.stats.engineRoute,null);
  runtime.setEnabled(false);runtime.pushFrame(field,300,{frameId:3});assert.equal(acquired,1);
  assert.equal(createR2RoutedEngine({autoRouteR1:false},{createEngine:()=>inner,createPool}),inner);
});

test('N7 경로도 옛 H를 넘어서고 Y 보호 시각은 실제 새 프레임에서만 갱신해요',()=>{
  let count=0,bump=true;
  const inner={enabled:true,stats:{frames:0,locked:1,progressD:.2,h:{count:2,lastConfirmedAt:0}},view:{},hudCandidates:[],
    pushFrame(){if(bump)this.stats.frames++;return null;},reset(){},invalidateLock(){},setEnabled(){}};
  const runtime=createR2RoutedEngine({autoRouteR1:true},{createEngine:()=>inner,
    createPool:()=>({reset(){},acquire(_field,current){count++;return {origin:current,resumeBatch:()=>({state:'done'}),
      readOrigin:()=>({origin:current,finders:[finder()]}),release(){}};}}),
  });
  const field={width:32,height:32,data:new Float32Array(1024)};
  runtime.pushFrame(field,0,{frameId:0});assert.equal(runtime.stats.engineRouteYConfirmedAt,0);assert.equal(count,0);
  bump=false;runtime.pushFrame(field,1001,{frameId:1});
  assert.equal(runtime.stats.engineRouteYConfirmedAt,0);assert.equal(count,1);assert.equal(runtime.stats.engineRoute.family,'hex');
  runtime.invalidateLock();assert.equal(runtime.stats.engineRouteYConfirmedAt,null);assert.equal(runtime.stats.engineRoute,null);
});

test('실제 Worker endpoint→snapshot→onProcessed가 임시 R1로 전환하고 옛 답은 버려요',()=>{
  const {ctx,writes}=context();let options;
  ctx.hAvailable=true;ctx.noteFrameProcessed=()=>{};ctx.renderHProgress=()=>{};
  ctx.createR2WorkerRuntime=value=>{options=value;return ctx.r2Runtime;};
  vm.runInContext(section('const r2Runtime = createR2WorkerRuntime(', 'const hPhotoReader =').replace('const r2Runtime =','const captured ='),ctx);
  const messages=[];
  const worker={postMessage(message,transfer){messages.push(structuredClone(message,{transfer}));},terminate(){this.terminated=true;}};
  const runtime=createR2WorkerRuntime({...options,createWorker:()=>worker});ctx.r2Runtime=runtime;
  const field=()=>({width:32,height:32,data:new Float32Array(1024)});
  runtime.pushFrame(field(),1000,{frameId:1,ownedInput:true});
  runtime.pushFrame(field(),1001,{frameId:2,ownedInput:true});
  const request=messages[0];let response;
  const inner={enabled:true,stats:{},view:{},hudCandidates:[],pushFrame:()=>null,reset(){},invalidateLock(){},setEnabled(){}};
  const receive=createR2WorkerEndpoint(message=>response=structuredClone(message),{createEngine:opts=>createR2RoutedEngine(opts,{
    createEngine:()=>inner,createPool:()=>({reset(){},acquire(_field,current){return {origin:current,
      resumeBatch:()=>({state:'done'}),readOrigin:()=>({origin:current,finders:[finder()]}),release(){}};}}),
  })});
  receive(request);assert.equal(response.hit,null);assert.equal(response.snapshot.stats.engineRoute.family,'hex');
  worker.onmessage({data:response});
  assert.equal(runtime.enabled,false);assert.equal(ctx.engineSwitchControl.dataset.engine,'r1');assert.equal(writes.length,0);
  assert.equal(worker.terminated,true);assert.equal(runtime.stats.worker.pending,0);
  const session=ctx.scanSession;worker.onmessage({data:response});assert.equal(ctx.scanSession,session);
  assert.equal(runtime.stats.worker.staleResults,1);runtime.dispose();
});

test('실제 N7 합성 픽셀→증분 pool→검증 family가 도달해요',()=>{
  const encoded=encode('route',{version:1,centralN7:true});
  const palette={background:{r:248,g:249,b:251},levels:[{r:20,g:28,b:42},{r:96,g:116,b:145},{r:218,g:228,b:242}],
    bullseyeDark:{r:0,g:0,b:0},bullseyeLight:{r:255,g:255,b:255}};
  const scene=buildScene(encoded,{palette,margin:4,finderPatternId:'central-n7-payload',centralN7Family:'hex'});
  const field=toRelativeLuminance(rasterize(scene,{pixelsPerUnit:960/scene.width,supersample:2}));
  const inner={enabled:true,stats:{},view:{},hudCandidates:[],pushFrame:()=>null,reset(){},invalidateLock(){},setEnabled(){}};
  for(const interval of [16,100]) {
    let pool;
    const runtime=createR2RoutedEngine({autoRouteR1:true},{createEngine:()=>inner,createPool:options=>{
      pool=createSharedCentralN7Pool(options);
      return {reset:()=>pool.reset(),acquire(field,current){
        const lease=pool.acquire(field,current);
        // CI 속도에 따라 원본 수명이 달라지지 않게 원자 수만 고정해요.
        return {...lease,resumeBatch:(at,budget)=>lease.resumeBatch(at,{...budget,budgetMs:Infinity})};
      }};
    }});
    let evidence=null,frames=0;
    for(let i=0;i<65&&!evidence;i++){runtime.pushFrame(field,i*interval,{frameId:i});frames++;evidence=runtime.stats.engineRoute;}
    assert.equal(evidence?.family,'hex');runtime.reset();assert.equal(runtime.stats.engineRoute,null);
  }
});
