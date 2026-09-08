import test from 'node:test';
import assert from 'node:assert/strict';
import {createCAdapters} from '../src/r2/adapter-c.js';
import {syntheticC,observeAll,alignCandidate} from './r2-c-fixtures.js';

function movedField(source,dx,dy) {
  const data=new Float32Array(source.data.length).fill(1);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const ox=x-dx,oy=y-dy;
    if(ox>=0&&oy>=0&&ox<source.width&&oy<source.height)data[y*source.width+x]=source.data[oy*source.width+ox];
  }
  return {width:source.width,height:source.height,data,alpha:source.alpha?.slice()??null};
}
function acquisition(text='tracking-C0') {
  const {field}=syntheticC(0,text),acquired=observeAll(field,{budget:{detectMs:32},maxHypotheses:8,tracking:{minNcc:.96}});
  const row=acquired.rows.find(r=>r.format.kind==='read'&&r.format.layoutId==='C0');assert.ok(row);
  const candidate=acquired.adapter.bindCandidate(row.observation,row.format);assert.ok(candidate);
  return {field,adapter:acquired.adapter,candidate,row,calls:acquired.calls};
}
test('tracking 수치는 명시한 평가값만 받고 기본 옵션을 몰래 채우지 않는다',()=>{
  for(const tracking of [{},true,null,{minNcc:NaN},{minNcc:-1},{minNcc:2}])assert.throws(()=>createCAdapters({tracking}));
  assert.doesNotThrow(()=>createCAdapters());assert.doesNotThrow(()=>createCAdapters({tracking:false}));
});
test('실제 C 관측 후보가 이동 프레임의 H를 갱신하고 같은 key로 표본을 공급한다',()=>{
  const {field,adapter,candidate}=acquisition(),key=candidate.key,H=candidate.H;
  assert.equal(alignCandidate(candidate,field,100000).output.gatePassed,1);
  const revision=candidate.revision,target=movedField(field,2,-2);
  const observed=alignCandidate(candidate,target,100001);
  assert.equal(candidate.invalidated,null);assert.equal(observed.output.gatePassed,1);
  assert.equal(candidate.key,key);assert.equal(candidate.revision,revision+1);
  assert.ok(Math.abs(candidate.H[2]-H[2]-2)<.15);assert.ok(Math.abs(candidate.H[5]-H[5]+2)<.15);
  const count=adapter.stats.trackingObservations,computations=adapter.stats.sampleComputations;
  alignCandidate(candidate,target,100001);
  assert.equal(adapter.stats.trackingObservations,count);assert.equal(adapter.stats.sampleComputations,computations);
  assert.ok(adapter.stats.trackingCopyMs>=0);assert.ok(adapter.stats.trackingRetainedBytes>=field.data.byteLength);
  assert.equal(candidate.dispose(),true);assert.equal(candidate.dispose(),false);assert.equal(adapter.stats.trackingRetainedBytes,0);
});
test('완료 획득 회전은 옛 관측 사본만 해제하고 bind된 후보 추적은 보존한다',()=>{
  const {field,adapter,candidate,row,calls}=acquisition('continuous-acquisition');
  assert.equal(adapter.stats.scanComplete,true);
  const output={};
  adapter.detectInto(field,field.width,field.height,calls,{frameId:calls},output);
  assert.equal(adapter.stats.scanComplete,true,'완료된 획득의 관측은 한 번 더 replay해요');
  adapter.detectInto(field,field.width,field.height,calls+1,{frameId:calls+1},output);
  assert.equal(adapter.stats.scanComplete,false);
  assert.equal(adapter.stats.resumeCursor.originFrameId,calls+1);
  assert.equal(adapter.bindCandidate(row.observation,row.format),null,'회전 전 관측 토큰은 다시 bind되지 않아요');
  const current=alignCandidate(candidate,field,calls+1);
  assert.equal(candidate.invalidated,null);
  assert.equal(current.output.gatePassed,1);
  candidate.dispose();
});
test('같은 프레임 ID/시간 내용 교체는 추적을 켜도 수용하지 않는다',()=>{
  const {field,adapter,candidate}=acquisition();alignCandidate(candidate,field,100000);
  const result=alignCandidate(candidate,movedField(field,2,-2),100000);
  assert.equal(result.output.gatePassed,0);assert.equal(candidate.invalidated,'same-frame-content-changed');
  assert.equal(adapter.stats.trackingRetainedBytes,0);assert.equal(candidate.H,null);assert.equal(candidate.hud,null);
});
test('같은 포맷의 다른 본문과 단색은 이 진단 입력에서 후보를 폐기한다',()=>{
  for(const kind of ['different-body','blank']){
    const {field,adapter,candidate}=acquisition('content-A');alignCandidate(candidate,field,100000);
    const target=kind==='different-body'?syntheticC(0,'content-B').field:{...field,data:new Float32Array(field.data.length).fill(1)};
    const result=alignCandidate(candidate,target,100001);
    assert.equal(result.output.gatePassed,0,kind);assert.ok(candidate.invalidated,kind);assert.equal(adapter.stats.trackingRetainedBytes,0);
  }
});
test('여러 프레임에 걸친 실제 획득은 원본을 보존하고 현재 영상에서 H와 포맷을 재검증한다',()=>{
  const {field}=syntheticC(0,'aged-acquisition'),target=movedField(field,2,-2);
  const adapter=createCAdapters({budget:{detectMs:32},maxHypotheses:8,tracking:{minNcc:.96}});
  const output={};let timestamp=0,moved=false,row=null;
  for(;timestamp<1000;timestamp++){
    if(timestamp===1)moved=true;
    adapter.detectInto(moved?target:field,field.width,field.height,timestamp,{frameId:timestamp},output);
    if(output.found&&output.format.layoutId==='C0'){row={...output};break;}
  }
  assert.ok(moved);assert.ok(row,'실제 커서가 이동 뒤 현재 H를 발행해야 해요');
  assert.equal(row.observation.originFrameId,0);assert.ok(row.observation.ageFrames>0);
  assert.equal(adapter.stats.acquisitionCheckpointUses,1);
  const fieldBytes=field.data.byteLength+(field.alpha?.byteLength??0);
  assert.ok(adapter.stats.acquisitionCheckpointBytes>=fieldBytes);
  assert.equal(adapter.stats.acquisitionCheckpointRetainedBytes,fieldBytes);
  assert.ok(adapter.stats.acquisitionTrackingMs>0);assert.ok(adapter.stats.acquisitionTrackingRetainedBytes>0);
  const candidate=adapter.bindCandidate(row.observation,row.format);assert.ok(candidate);
  const current=alignCandidate(candidate,target,timestamp);assert.equal(current.output.gatePassed,1);
  assert.equal(candidate.invalidated,null);assert.deepEqual(candidate.H,row.H);
  // 발행과 bind 뒤 같은 프레임의 내용 교체는 추적으로 정당화하지 못해요.
  adapter.detectInto(field,field.width,field.height,timestamp,{frameId:timestamp},output);
  assert.equal(output.found,0);assert.equal(adapter.bindCandidate(row.observation,row.format),null);
  const rejected=alignCandidate(candidate,field,timestamp);assert.equal(rejected.output.gatePassed,0);
  assert.equal(candidate.invalidated,'same-frame-content-changed');
  adapter.reset();assert.equal(adapter.stats.acquisitionTrackingRetainedBytes,0);assert.equal(adapter.stats.trackingRetainedBytes,0);
});
