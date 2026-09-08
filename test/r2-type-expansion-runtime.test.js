import test from 'node:test';
import assert from 'node:assert/strict';
import {createR2TypeExpansionRuntime} from '../src/r2/type-expansion-runtime.js';
import {syntheticC} from './r2-c-fixtures.js';

function fakeY({trusted=true,candidateCount=1,doneAt=-1,interval=1,counts=null,onPublish=null}={}) {
  const stats={frames:0,locked:1,lockDistrusted:!trusted,format:{source:trusted?'locator':'default'},progressD:0,candidateCount};
  const calls=[],view={sentinel:'Y'},hit={text:'Y winner',layoutId:'v0tr',n:25};let enabled=true,reserve=null;
  return {stats,calls,view,hit,get enabled(){return enabled;},setEnabled(v){enabled=v===true;},
    setCandidateReservation(fn){if(fn)fn(stats.candidateCount);reserve=fn;},
    pushFrame(field,t){calls.push(t);if(!enabled||t%interval!==0)return null;const next=counts?.[stats.frames];if(next!==undefined){reserve?.(next);stats.candidateCount=next;onPublish?.(next);}stats.frames++;stats.progressD=stats.frames/100;return stats.frames===doneAt?hit:null;},
    reset(){stats.frames=0;stats.progressD=0;},invalidateLock(){return 1;}};
}
function fakeC({doneAt=-1,candidateCount=0}={}) {
  const stats={observations:0,candidateCount},calls=[],capacityCalls=[],adapters={stats:{budgetHits:0}};
  return {stats,calls,adapters,reset(){calls.length=0;stats.observations=0;stats.candidateCount=0;},
    capacityCalls,setCapacity(cap){capacityCalls.push(cap);stats.candidateCount=Math.min(stats.candidateCount,cap);},
    pushFrame(field,t,options){calls.push({t,...options});if(options.runDetect)stats.observations++;return calls.length===doneAt?{text:'C winner',frame:999,layoutId:'C0',n:14}:null;}};
}
const field={width:1,height:1,data:new Float32Array([1])};
const create=(y,c,extra={})=>createR2TypeExpansionRuntime({yRuntime:y,cRuntime:c,maxCandidates:6,maxTrustedFrames:3,maxStalledFrames:100,...extra});
test('정상 Y가 N보다 길어져도 Y 호출/객체를 보존하고 C 검출은 N 경계에서 실행한다',()=>{
  const y=fakeY(),c=fakeC(),runtime=create(y,c);
  for(let i=0;i<8;i++)assert.equal(runtime.pushFrame(field,i),null);
  assert.deepEqual(y.calls,[0,1,2,3,4,5,6,7]);
  assert.deepEqual(c.calls.filter(r=>r.runDetect).map(r=>r.t),[2,5]);
  assert.equal(runtime.stats,y.stats);assert.equal(runtime.view,y.view);
  assert.equal(runtime.expansionStats.cTries,2);assert.equal(runtime.expansionStats.framesSinceCTry,2);
});
test('불신 Y는 첫 프레임부터 C를 허용하며 합산 후보 여유만 넘긴다',()=>{
  const y=fakeY({trusted:false,candidateCount:4}),c=fakeC(),runtime=create(y,c);
  runtime.pushFrame(field,0);
  assert.equal(c.calls[0].runDetect,true);assert.equal(c.calls[0].maxCandidates,2);
  assert.equal(runtime.expansionStats.routerReason,'y-untrusted');
});
test('같은 프레임의 먼저 실행된 Y DONE이 이기며 C를 뒤늦게 실행하지 않는다',()=>{
  const y=fakeY({trusted:false,doneAt:1}),c=fakeC({doneAt:1}),runtime=create(y,c);
  assert.equal(runtime.pushFrame(field,0),y.hit);assert.equal(c.calls.length,0);
  assert.equal(runtime.expansionStats.lastWinner,'Y');
});
test('C 적중의 frame은 후보 생성 시점이 아니라 전체 입력 프레임으로 낸다',()=>{
  const y=fakeY({trusted:false}),c=fakeC({doneAt:2}),runtime=create(y,c);
  assert.equal(runtime.pushFrame(field,0),null);
  assert.deepEqual(runtime.pushFrame(field,1),{text:'C winner',frame:1,layoutId:'C0',n:14});
});
test('interval·disable·reset은 C 단독 진행이나 이전 라우터 증거를 남기지 않는다',()=>{
  const y=fakeY({interval:2}),c=fakeC(),runtime=create(y,c);
  runtime.pushFrame(field,0);runtime.pushFrame(field,1);assert.equal(c.calls.length,1);
  runtime.setEnabled(false);runtime.pushFrame(field,2);assert.equal(c.calls.length,0);
  runtime.setEnabled(true);runtime.pushFrame(field,4);assert.equal(c.calls.length,1);
  assert.equal(runtime.expansionStats.cTries,0);
  runtime.reset();assert.equal(c.calls.length,0);assert.equal(runtime.stats.frames,0);assert.equal(runtime.expansionStats.frames,0);
});
test('실제 무힌트 C 관측→후보 bind→기존 누적/RS가 조합기에서 원문을 낸다',()=>{
  const fixture=syntheticC(0,'C live composition'),y=fakeY({trusted:false,candidateCount:0});
  const runtime=createR2TypeExpansionRuntime({yRuntime:y,maxCandidates:32,maxTrustedFrames:3,maxStalledFrames:10,
    cOptions:{maxIdleFrames:40,observation:{budget:{detectMs:32},maxHypotheses:8}}});
  let hit=null;
  for(let frame=0;frame<200&&!hit;frame++)hit=runtime.pushFrame(fixture.field,frame*33);
  assert.ok(hit,JSON.stringify({c:runtime.cStats,x:runtime.expansionStats}));
  assert.equal(hit.text,fixture.text);assert.equal(hit.layoutId,'C0');assert.equal(hit.profile,'C');
  assert.ok(runtime.expansionStats.cTries>0);assert.ok(runtime.cStats.binds>0);assert.ok(runtime.cStats.decodeAttempts>0);
  assert.equal(runtime.expansionStats.lastWinner,'C');assert.ok(runtime.expansionStats.totalCandidateCount<=32);
});

test('실제 후보 상한5 안의 Y 증가도 생성 전에 C를 비우며 Y DONE 뒤 총K를 지킨다',()=>{
  const c=fakeC({candidateCount:4}),published=[];
  const y=fakeY({trusted:false,candidateCount:1,counts:[1,5],doneAt:2,
    onPublish(count){published.push(count+c.stats.candidateCount);}});
  const runtime=create(y,c,{maxCandidates:8});
  assert.equal(runtime.pushFrame(field,0),null);
  assert.equal(runtime.pushFrame(field,1),y.hit);
  assert.deepEqual(published,[5,8], 'Y 후보가 공개된 순간 상한을 넘었다');
  assert.equal(c.calls.length,1,'Y DONE 뒤 C를 진행했다');
  assert.equal(c.stats.candidateCount,3);
  assert.equal(runtime.expansionStats.totalCandidateCount,8);
  assert.equal(runtime.expansionStats.yCandidateCount,5);
  assert.equal(runtime.expansionStats.cCandidateCount,3);
  assert.equal(runtime.expansionStats.lastCMs,0);
  assert.equal(runtime.expansionStats.routerReason,'y-done');
  runtime.pushFrame(field,2);
  assert.equal(runtime.expansionStats.lastWinner,null,'현재 무적중 프레임에 이전 Y 적중을 남겼다');
});

test('합산 예약 소켓이 없는 주입 런타임은 조용히 상한을 가장하지 않는다',()=>{
  const y=fakeY(),c=fakeC();
  const {setCandidateReservation: _reserve,...missingY}=y;
  assert.throws(()=>create(missingY,c),TypeError);
  const {setCapacity: _capacity,...missingC}=c;
  assert.throws(()=>create(y,missingC),TypeError);
});
