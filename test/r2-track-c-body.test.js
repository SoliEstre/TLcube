import test from 'node:test';
import assert from 'node:assert/strict';
import {createCBodyTracker} from '../src/decoder/c-body-track.js';
const texture=(x,y)=>.5+.12*Math.sin(x*.13)+.12*Math.cos(y*.17)+.12*Math.sin(x*.09+y*.07);
const field=(dx=0,dy=0)=>({width:128,height:128,data:Float32Array.from({length:128*128},(_,i)=>texture(i%128-dx,Math.floor(i/128)-dy))});
const H=()=>new Float64Array([2,0,64,0,2,64,0,0,1]);
const origin={frameId:0,timestamp:0,generation:3},current={frameId:1,timestamp:1,generation:3};
const make=(f=field())=>createCBodyTracker(f,H(),14,{minNcc:.96,origin});
test('임계값/원프레임은 필수이고 유한한 영상만 받는다',()=>{
  assert.throws(()=>createCBodyTracker(field(),H(),14));
  assert.throws(()=>createCBodyTracker(field(),H(),14,{origin}));
  const bad=field();bad.data[10]=NaN;assert.throws(()=>make(bad));
});
test('원영상/H/반환 H의 별칭이 추적 상태로 새지 않는다',()=>{
  const source=field(),saved={...source,data:source.data.slice()},matrix=H(),tracker=createCBodyTracker(source,matrix,14,{minNcc:.96,origin});
  source.data.fill(0);matrix.fill(0);
  const first=tracker.observe(saved,origin);assert.equal(first.ok,true);assert.deepEqual(first.H,H());
  first.H.fill(0);assert.deepEqual(tracker.H,H());
  assert.ok(tracker.stats.copyMs>=0);assert.equal(tracker.stats.snapshotBytes,saved.data.byteLength);
});
test('해석 영상의 실제 이동은 H를 개정하고 같은 프레임은 재추적하지 않는다',()=>{
  const tracker=make(),target=field(2,-2),result=tracker.observe(target,current);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.revision,1);assert.ok(result.quality.ncc>.999);
  assert.ok(Math.abs(result.H[2]-66)<.02);assert.ok(Math.abs(result.H[5]-62)<.02);
  const observed=tracker.stats.observations;assert.equal(tracker.observe(target,current).samePixels,true);assert.equal(tracker.stats.observations,observed);
});
test('같은 프레임 ID/시간의 내용 교체는 폐기한다',()=>{
  const tracker=make(),changed=field(2,-2);const result=tracker.observe(changed,origin);
  assert.equal(result.reason,'same-frame-content-changed');assert.equal(tracker.H,null);assert.equal(tracker.stats.snapshotBytes,0);
});
test('단색은 잔차가 작아도 거부하고 폐기 뒤 원본으로 되살아나지 않는다',()=>{
  const tracker=make(),blank=field();blank.data.fill(1);const result=tracker.observe(blank,current);
  assert.equal(result.ok,false);assert.equal(result.reason,'photometric-unproven');assert.equal(result.quality.ncc,null);
  assert.equal(tracker.observe(field(),{...current,frameId:2,timestamp:2}).ok,false);
});
test('리사이즈·세대·시간역전·명시폐기는 스냅샷을 내려놓는다',()=>{
  for(const [reason,frame,at]of [
    ['resize',{width:64,height:64,data:new Float32Array(4096)},current],
    ['generation',field(),{...current,generation:4}],
    ['time-reversal',field(),{...current,timestamp:-1}],
  ]){const tracker=make();assert.equal(tracker.observe(frame,at).reason,reason);assert.equal(tracker.stats.snapshotBytes,0);}
  const tracker=make();tracker.discard('reset');assert.equal(tracker.observe(field(),current).reason,'reset');
});
test('alpha 내용 변경은 별도 관측을 요구한다',()=>{
  const f=field();f.alpha=new Uint8Array(f.data.length).fill(255);const tracker=make(f),changed={...f,alpha:f.alpha.slice()};changed.alpha[4]=0;
  assert.equal(tracker.observe(changed,current).reason,'alpha-changed');
});
test('호출자의 origin 수정은 획득 세대 검증을 바꾸지 않는다',()=>{
  const callerOrigin={...origin},tracker=createCBodyTracker(field(),H(),14,{minNcc:.96,origin:callerOrigin});
  callerOrigin.generation=4;
  assert.equal(tracker.observe(field(),current).ok,true);
  assert.equal(tracker.observe(field(),{...current,frameId:2,timestamp:2,generation:4}).reason,'generation');
});
test('fork는 현재 검증 프레임을 복사하고 수명과 같은 프레임 검증을 분리한다',()=>{
  const source=make(),target=field(2,-2);assert.equal(source.observe(target,current).ok,true);
  const first=source.fork(),second=source.fork();assert.ok(first);assert.deepEqual(first.H,source.H);
  assert.equal(first.observe(field(3,-2),current).reason,'same-frame-content-changed');
  assert.equal(second.observe(target,current).ok,true);assert.equal(source.observe(target,current).ok,true);
  source.discard('reset');assert.equal(source.fork(),null);assert.equal(second.observe(target,current).ok,true);
});
