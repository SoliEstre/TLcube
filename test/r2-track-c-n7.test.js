import test from 'node:test';
import assert from 'node:assert/strict';
import { moveHomographyWithN7, reobserveCentralN7 } from '../src/decoder/c-n7-track.js';
import { projectPoint } from '../src/decoder/homography.js';
import { discoverCentralN7Finders } from '../src/decoder/central-n7-observe.js';
import { syntheticC } from './r2-c-fixtures.js';

const previous = { center: { x: 140, y: 170 }, modulePitch: 5, degrees: 12 };
const H = new Float64Array([8, 0.3, 140, -0.2, 7, 170, 0.002, -0.004, 1]);
test('n7 similarity는 이전 영상 좌표→현재 영상 좌표이며 원근 H 왼쪽에 곱해요', () => {
  const current = { center: { x: 147, y: 161 }, modulePitch: 5.2, degrees: 15 };
  const actual = moveHomographyWithN7(H, previous, current);
  const angle = 3 * Math.PI / 180;
  for (const p of [{x:0,y:0},{x:12,y:-8},{x:-7,y:16}]) {
    const old = projectPoint(H,p), got = projectPoint(actual,p);
    const dx=old.x-140,dy=old.y-170;
    const x=147+1.04*(dx*Math.cos(angle)-dy*Math.sin(angle));
    const y=161+1.04*(dx*Math.sin(angle)+dy*Math.cos(angle));
    assert.ok(Math.abs(got.x-x)<1e-10);assert.ok(Math.abs(got.y-y)<1e-10);
  }
  assert.deepEqual(actual.slice(6),H.slice(6));
});
test('n7 항등 이동은 H 값을 보존하고 별칭을 만들지 않아요', () => {
  const result=moveHomographyWithN7(H,previous,previous);
  assert.deepEqual(result,H);assert.notEqual(result,H);
});
test('n7 similarity 잘못된 H·영 피치·비유한 포즈는 거절해요', () => {
  assert.equal(moveHomographyWithN7(new Float64Array(8),previous,previous),null);
  assert.equal(moveHomographyWithN7(H,previous,{...previous,modulePitch:0}),null);
  assert.equal(moveHomographyWithN7(H,{...previous,degrees:NaN},previous),null);
  assert.equal(moveHomographyWithN7(Float64Array.from(H,(_,i)=>i===8?Infinity:H[i]),previous,previous),null);
});
test('n7 재관측은 무지/잘못된 입력에서 관측을 만들어내지 않아요', () => {
  const finder={center:previous.center,rotationDegrees:previous.degrees,H,cellSize:20,
    centralN7:{modulePitch:previous.modulePitch,family:'hex',outerFormat:0}};
  assert.deepEqual(reobserveCentralN7({width:320,height:320,data:new Float32Array(320*320).fill(0.5)},finder,H),[]);
  assert.deepEqual(reobserveCentralN7({width:3,height:4,data:new Float32Array(3)},finder,H),[]);
  assert.throws(()=>reobserveCentralN7(null,finder,H,{searchRadiusCells:3}),TypeError);
});
test('n7 실제 광학 재관측은 outerFormat 배열을 객체 참조가 아니라 코드워드 값으로 대조해요', () => {
  const field=syntheticC().field;
  const finders=discoverCentralN7Finders(field).filter(f=>f.centralN7.family==='hex');
  assert.ok(finders.length>0);
  const finder=finders[0],results=reobserveCentralN7(field,finder,finder.H);
  assert.ok(results.length>0,'같은 실화소/새 outerFormat 배열도 읽혀야 해요');
  for(const row of results){
    assert.deepEqual(row.finder.centralN7.outerFormat,finder.centralN7.outerFormat);
    assert.notEqual(row.finder.centralN7.outerFormat,finder.centralN7.outerFormat);
  }
  const changed={...finder,centralN7:{...finder.centralN7,outerFormat:finder.centralN7.outerFormat.map((x,i)=>i===0?(x+1)%6:x)}};
  assert.deepEqual(reobserveCentralN7(field,changed,finder.H),[]);
});
