import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {createHCollector} from '../src/h-collector.js';
import * as impl from '../src/h-scan-runtime.js';
import {createR2ExpansionEngine} from '../src/r2-expansion-engine.js';
import {createR2RoutedEngine} from '../src/r2-routed-engine.js';
import {createR2WorkerEndpoint} from '../src/r2-worker-entry.js';
import {createR2WorkerRuntime} from '../src/r2-worker-runtime.js';
import {protectsYHEngine,confirmedQrEngineFamily} from '../src/scanner-engine-route.js';
import {classifyQrValue,routeQrHits,qrHitToDecodeResult} from '../src/qr-bridge.js';
const field=()=>({width:16,height:16,data:new Float32Array(256).fill(.5)});
function observations(encoded){return Object.entries(encoded.faces).map(([face,levels])=>({...encoded,face,levels:levels.slice(),faces:undefined,ok:true,mirror:false,hamming:0,rotation:0,
  H:new Float64Array([1,0,0,0,1,0,0,0,1]),quad:[{x:1,y:1},{x:10,y:1},{x:10,y:10},{x:1,y:10}],quality:{score:.9}}));}
function yStub(){let enabled=true;const counters={push:0,reset:0,invalidate:0};let frames=0;return {counters,
  pushFrame(f,t,o){counters.push++;frames++;this.last={f,t,o};return null;},reset(){counters.reset++;frames=0;},invalidateLock(){counters.invalidate++;},setEnabled(on){enabled=on;},
  get enabled(){return enabled;},get stats(){return {frames,locked:0,progressD:0,candidateCount:0,indicator:'SEARCHING',phaseMs:{}};},view:{profile:'Y'},hudCandidates:[],accepted:null};}
function setup({mode=6,ttlMs=90_000,activeIntervalMs=0,decode}={}){
  const encoded=encodeH('H active Y pause',{version:2,mode,mask:0}),valid=observations(encoded),control={faces:[],error:null},y=yStub();
  const h=impl.createHScanRuntime({collector:createHCollector({ttlMs,...(decode?{decode}:{})}),coldIntervalMs:0,activeIntervalMs,
    detect:()=>{if(control.error)throw control.error;return {faces:control.faces};}});
  const engine=impl.createHCompositeEngine({yEngine:y,hRuntime:h});let id=0;
  const push=(timestamp,faces=[],extra={})=>{control.faces=faces;return engine.pushFrame(field(),timestamp,{frameId:++id,...extra});};
  return {encoded,valid,control,y,h,engine,push};
}

test('유효 H 부분 수집은 500ms 관측 창 이후에도 Y 입력·누적을 중단해요',()=>{
  for(const mode of [2,3,4,5,6]){const h=setup({mode});h.push(0);assert.equal(h.y.counters.push,1);
    h.push(10,[h.valid[0]]);assert.equal(h.h.stats.state,'COLLECTING');assert.equal(h.h.stats.count,1);
    for(const t of [511,1001,10_000,50_000,90_010])h.push(t);
    assert.equal(h.h.stats.count,1);assert.equal(h.y.counters.push,1);assert.equal(h.engine.stats.hSkippedY,6);
    assert.equal(h.y.counters.reset,0);assert.equal(h.y.counters.invalidate,0);
    h.push(90_011);assert.equal(h.h.stats.state,'EMPTY');assert.equal(h.y.counters.push,2);
  }
});
test('H frame/corner 검증을 통과하지 못한 표식·count 0은 Y를 막지 않아요',()=>{
  for(const change of [{ok:false},{mirror:true},{hamming:99},{rotation:4},{n:999},{levels:new Uint8Array(1)}]){
    const h=setup();h.push(0,[{...h.valid[0],...change}]);h.push(1001);
    assert.equal(h.h.stats.state,'EMPTY');assert.equal(h.y.counters.push,2);
  }
});
test('H 부분 수집 중 검출기 예외나 cadence skip은 살아 있는 collector를 지우지 않아요',()=>{
  const h=setup({activeIntervalMs:5000});h.push(10,[h.valid[0]]);h.control.faces=[];
  h.push(1000);assert.equal(h.h.stats.detectCalls,1);assert.equal(h.y.counters.push,0);
  h.control.error=Error('transient');h.push(6000);assert.equal(h.h.stats.count,1);assert.equal(h.y.counters.push,0);
  h.push(90_011);assert.equal(h.h.stats.state,'EMPTY');assert.equal(h.y.counters.push,1);
});
test('reset/disable/새 timestamp 세션은 수집과 pause를 비우고 invalidate는 부분면을 보존해요',()=>{
  const h=setup();h.push(100,[h.valid[0]]);h.engine.invalidateLock();h.push(2000);
  assert.equal(h.h.stats.count,1);assert.equal(h.y.counters.push,0);
  h.engine.reset();h.push(2001);assert.equal(h.h.stats.count,0);assert.equal(h.y.counters.push,1);
  h.push(3000,[h.valid[0]]);h.engine.setEnabled(false);h.push(4000);assert.equal(h.h.stats.state,'EMPTY');
  h.engine.setEnabled(true);h.push(4001);assert.equal(h.y.counters.push,2);
  h.push(5000,[h.valid[0]]);h.push(1);assert.equal(h.h.stats.state,'EMPTY');assert.equal(h.y.counters.push,3);
});
test('DONE은 진행 중 pause가 아니며 기존 500ms 이후 Y 재개 규칙을 유지해요',()=>{
  const h=setup({mode:3});assert.equal(h.push(0,h.valid).text,'H active Y pause');assert.equal(h.h.stats.state,'DONE');
  h.push(500);assert.equal(h.y.counters.push,0);h.push(501);assert.equal(h.y.counters.push,1);
});
test('모든 면을 모았어도 RS/CRC 실패로 COLLECTING이면 TTL까지 Y를 멈춰요',()=>{
  for(const mode of [2,3,4,5,6]){const h=setup({mode,ttlMs:1500,decode:()=>({ok:false,reason:'crc'})});assert.equal(h.push(0,h.valid),null);
    assert.equal(h.h.stats.count,mode);assert.equal(h.h.stats.state,'COLLECTING');h.push(1000);assert.equal(h.y.counters.push,0);
    h.push(1501);assert.equal(h.h.stats.state,'EMPTY');assert.equal(h.y.counters.push,1);}
});
test('Y 입력과 H overscan을 분리하고 중단 동안 원본 배열을 변경하지 않아요',()=>{
  const h=setup(),y=field(),over={width:20,height:20,data:new Float32Array(400).fill(.7)},before=y.data.slice(),beforeH=over.data.slice();
  h.control.faces=[h.valid[0]];h.engine.pushFrame(y,0,{frameId:'wide',hField:over});h.control.faces=[];
  h.engine.pushFrame(y,1001,{frameId:'wide-next',hField:over});assert.equal(h.y.counters.push,0);
  assert.deepEqual(y.data,before);assert.deepEqual(over.data,beforeH);
  h.engine.reset();h.engine.pushFrame(y,1002,{frameId:'resume',hField:over});assert.equal(h.y.last.f,y);assert.equal(h.y.last.o.hField,over);
});
test('실제 expansion의 Y-grid·Y-faces 소비자는 H partial 동안 둘 다 서비스되지 않아요',()=>{
  const y=yStub(),cube={calls:0,pushFrame(){this.calls++;return null;},reset(){},setCapacity(){},deferFrame(){},stats:{candidateCount:0,progressD:0,acquisitionPhase:'idle'},hudCandidates:[]};
  const inner=createR2ExpansionEngine({enabled:true,candidateScope:'y',yRuntime:y,cubeRuntime:cube,budgetMs:100});
  const h=setup(),engine=impl.createHCompositeEngine({yEngine:inner,hRuntime:h.h});
  for(let t=0;t<5;t++)engine.pushFrame(field(),t,{frameId:t});assert.equal(y.counters.push,5);assert.ok(cube.calls>0);
  h.control.faces=[h.valid[0]];engine.pushFrame(field(),10,{frameId:10});h.control.faces=[];
  const frames=inner.stats.frames,calls=cube.calls;engine.pushFrame(field(),1001,{frameId:1001});engine.pushFrame(field(),3000,{frameId:3000});
  assert.equal(inner.stats.frames,frames);assert.equal(y.counters.push,5);assert.equal(cube.calls,calls);
  engine.reset();engine.pushFrame(field(),3001,{frameId:3001});assert.equal(inner.stats.frames,1);
});
test('QR bridge/R1 자동전환의 기존 신선도 gate는 partial pause와 독립으로 유지돼요',()=>{
  const h=setup();let acquisitions=0;
  const engine=createR2RoutedEngine({autoRouteR1:true},{createEngine:()=>h.engine,createPool:()=>({reset(){},acquire(_f,origin){acquisitions++;return {origin,resumeBatch:()=>({state:'done'}),readOrigin:()=>({origin,finders:[]}),release(){}};}})});
  h.control.faces=[h.valid[0]];engine.pushFrame(field(),0,{frameId:0});h.control.faces=[];
  engine.pushFrame(field(),1001,{frameId:1});assert.equal(h.y.counters.push,0);assert.equal(acquisitions,1);
  assert.equal(protectsYHEngine(engine.stats,1001),false);
  assert.equal(confirmedQrEngineFamily([classifyQrValue('HTTPS://TLSCAN.ESTRE.SO/O')]),'hex');
  assert.equal(confirmedQrEngineFamily([classifyQrValue('HTTPS://TLSCAN.ESTRE.SO/Y')]),null);
  const ordinary=classifyQrValue('https://example.com/');
  const qr=qrHitToDecodeResult(routeQrHits([ordinary]).expose);assert.equal(qr.payload,'https://example.com/');assert.equal(qr.autoOpen,false);
  const tl=routeQrHits([ordinary,classifyQrValue('HTTPS://TLSCAN.ESTRE.SO/Y')]);assert.equal(tl.family,'cube');assert.equal(tl.expose,null);
});
test('Worker endpoint·fallback도 같은 pause를 쓰며 reset 이후 옛 답은 거절돼요',()=>{
  const sets=[],workers=[];const create=()=>{const h=setup();sets.push(h);return h.engine;};
  const runtime=createR2WorkerRuntime({enabled:true,createWorker(){const worker={messages:[],responses:[],terminate(){this.terminated=true;},postMessage(message,transfer=[]){this.messages.push(structuredClone(message,{transfer}));}};
    worker.receive=createR2WorkerEndpoint(message=>worker.responses.push(message),{createEngine:create});workers.push(worker);return worker;}});
  runtime.pushFrame(field(),0,{frameId:0});const w=workers[0];w.receive(w.messages[0]);w.onmessage({data:w.responses.shift()});
  sets[0].control.faces=[sets[0].valid[0]];runtime.pushFrame(field(),10,{frameId:1});w.receive(w.messages.at(-1));w.onmessage({data:w.responses.shift()});sets[0].control.faces=[];
  runtime.pushFrame(field(),1001,{frameId:2});w.receive(w.messages.at(-1));const stale=w.responses.shift();assert.equal(sets[0].y.counters.push,1);
  runtime.reset();w.onmessage({data:stale});assert.equal(runtime.stats.worker.staleResults,1);assert.equal(runtime.stats.h,undefined);runtime.dispose();
  const h=setup(),fallback=createR2WorkerRuntime({enabled:true,createWorker(){throw Error('no Worker');},createFallback:()=>h.engine});
  h.control.faces=[h.valid[0]];fallback.pushFrame(field(),0);h.control.faces=[];fallback.pushFrame(field(),1001);
  assert.equal(fallback.stats.worker.mode,'main-fallback');assert.equal(h.y.counters.push,0);fallback.dispose();
});
