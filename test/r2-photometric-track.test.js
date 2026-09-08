import test from 'node:test';
import assert from 'node:assert/strict';
import {trackPhotometric} from '../src/decoder/c-photometric-track.js';
const texture=(x,y)=>.5+.12*Math.sin(x*.13)+.12*Math.cos(y*.17)+.12*Math.sin(x*.09+y*.07);
const field=(dx=0,dy=0,gain=1,bias=0)=>({width:128,height:128,data:Float32Array.from({length:128*128},(_,i)=>gain*texture(i%128-dx,Math.floor(i/128)-dy)+bias)});
const points=[];for(let y=10;y<118;y+=3)for(let x=10;x<118;x+=3)points.push({x,y});
test('같은 영상은 영 이동이며 원본 배열을 바꾸지 않는다',()=>{
  const f=field(),before=f.data.slice(),result=trackPhotometric(f,f,points);
  assert.deepEqual(f.data,before);assert.equal(result.after.rms,0);
  assert.deepEqual(result.motion,new Float64Array([1,0,0,0,1,0,0,0,1]));
});
test('독립 해석 텍스처의 2px 이동을 역복원한다',()=>{
  const result=trackPhotometric(field(),field(2,-2),points);
  assert.ok(result.after.rms<1e-5);
  assert.ok(Math.abs(result.motion[2]-2)<.01);assert.ok(Math.abs(result.motion[5]+2)<.01);
  assert.ok(result.after.ncc>.99999);
});
test('이동과 밝기 gain/bias를 동시에 복원한다',()=>{
  const result=trackPhotometric(field(),field(2,-2,.8,.05),points);
  assert.ok(result.after.rms<1e-5);
  assert.ok(Math.abs(result.motion[2]-2)<.01);assert.ok(Math.abs(result.motion[5]+2)<.01);
  assert.ok(Math.abs(result.gain-.8)<.001);assert.ok(Math.abs(result.bias-.05)<.001);
});
test('단색 영상은 RMS가 작아도 상관도 없음을 드러낸다',()=>{
  const result=trackPhotometric(field(),{width:128,height:128,data:new Float32Array(128*128).fill(1)},points);
  assert.ok(result.after.rms<1e-5);assert.equal(result.after.ncc,null);
  assert.ok(Math.abs(result.gain)<.001);assert.ok(Math.abs(result.bias-1)<.001);
});
test('크기 변경과 빈 관측은 누적 증거로 사용하지 않는다',()=>{
  assert.throws(()=>trackPhotometric(field(),{width:129,height:128,data:new Float32Array(129*128)},points));
  assert.throws(()=>trackPhotometric(field(),field(),[]));
});
