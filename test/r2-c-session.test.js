import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticC, observeAll } from './r2-c-fixtures.js';
import { createObservedCSession } from './r2-c-session-fixtures.js';
import { R2_SESSION_STATUS, R2_INDICATOR } from '../src/r2/session.js';
import { unframe } from '../src/header.js';

// 제품 materialize 함수를 다시 부르지 않고 GF(211)의 합법 심볼을 전수 열거해 대조한다.
// 균일한 입력은 균일한 confidence가 정답일 수 있으므로 분산 자체를 요구하지 않는다.
function expectedConfidence(session) {
  const { cellCount, symbolCount, symbolCells } = session.layout;
  const scores = session.buffers.accumulator;
  return Array.from({ length: symbolCount }, (_, symbol) => {
    const cells = Array.from({ length: 3 }, (_, digit) => symbolCells?.[symbol * 3 + digit] ?? symbol * 3 + digit);
    const legalScores = [];
    for (let first = 0; first < 6; first++) for (let second = 0; second < 6; second++) for (let third = 0; third < 6; third++) {
      if (first * 36 + second * 6 + third >= 211) continue;
      legalScores.push(scores[first * cellCount + cells[0]] + scores[second * cellCount + cells[1]] + scores[third * cellCount + cells[2]]);
    }
    legalScores.sort((a, b) => b - a);
    return Math.min(32767, legalScores[0] - legalScores[1]);
  });
}

for(const version of [0,1,2,3]) test(`실제 C${version}/M 관측 후보 → 기본 세션 누적 → 원문, 계산 confidence`,()=>{
  const fixture=syntheticC(version), acquired=observeAll(fixture.field);
  const successes=[];
  let frame=acquired.calls;
  for(const observation of acquired.rows){
    const candidate=acquired.adapter.bindCandidate(observation.observation,observation.format);
    if(!candidate)continue;
    const vectors=[];
    const {session,calls}=createObservedCSession(candidate,({confidence})=>{
      const actual = [...confidence];
      assert.deepEqual(actual, expectedConfidence(session), 'RS 입력 confidence는 현재 누적 점수의 합법 최선/차선 차이여야 한다');
      vectors.push(actual);
    });
    assert.equal(session.layout,candidate.bound,'BoundLayout 소유권');
    for(let repeat=0;repeat<20;repeat++){
      const timestamp=frame++;
      const out=session.pushFrame(fixture.field.data,fixture.field.width,fixture.field.height,timestamp,{frameId:timestamp,alpha:fixture.field.alpha});
      assert.equal(out.status,R2_SESSION_STATUS.OK);
      if(out.indicator===R2_INDICATOR.DONE){
        assert.equal(unframe(out.payload.subarray(0,out.payloadLength)).text,fixture.text);
        assert.ok(calls.align>0&&calls.decode>0,'실제 표본·복호 도달');
        assert.ok(session.buffers.observations.some(n=>n>0),'누적 미우회');
        assert.ok(vectors.flat().some(v=>v>0),'실제 누적에서 양의 심볼 여유가 생긴다');
        successes.push(candidate);break;
      }
    }
  }
  assert.ok(successes.length>0,`C${version} 실제 관측 복호 후보 없음`);
});

test('confidence 독립 자는 합법 후보 동률·클램프·셀 매핑·서로 다른 여유를 구별한다',()=>{
  const cellCount=9, scores=new Int16Array(cellCount*6);
  const margins=[0,7,32767];
  for(let cell=0;cell<cellCount;cell++)for(let digit=0;digit<6;digit++){
    scores[digit*cellCount+cell]=digit===0?0:-margins[Math.floor(cell/3)];
  }
  const model={layout:{cellCount,symbolCount:3},buffers:{accumulator:scores}};
  assert.deepEqual(expectedConfidence(model),margins);
  model.layout.symbolCells=Uint16Array.from([6,7,8,3,4,5,0,1,2]);
  assert.deepEqual(expectedConfidence(model),[32767,7,0]);
  // 215(5,5,5)는 불법이므로 유일한 전체 최선이어도 confidence의 최선으로 쓸 수 없다.
  scores.fill(0); for(let cell=0;cell<cellCount;cell++)scores[5*cellCount+cell]=100;
  assert.deepEqual(expectedConfidence(model),[0,0,0]);
});

test('표본 가시성·가중치가 없으면 누적·RS 도달이 없다',()=>{
  const fixture=syntheticC(0),acquired=observeAll(fixture.field);
  const observed=acquired.rows.find(o=>o.format.kind==='read');assert.ok(observed);
  for(const mode of ['weight','visible']){
    const candidate=acquired.adapter.bindCandidate(observed.observation,observed.format);assert.ok(candidate);
    const wrapped={bound:candidate.bound,alignInto(...args){const status=candidate.alignInto(...args);
      if(mode==='weight')args[6].weightQ15=0;else args[8].fill(0);return status;}};
    const {session,calls}=createObservedCSession(wrapped);
    for(let i=0;i<20;i++){
      const t=acquired.calls+100+i;
      session.pushFrame(fixture.field.data,fixture.field.width,fixture.field.height,t,{frameId:t,alpha:fixture.field.alpha});
    }
    assert.equal(calls.align,20);assert.equal(calls.decode,0);
    assert.ok(session.buffers.observations.every(n=>n===0));
    assert.notEqual(session.result.indicator,R2_INDICATOR.DONE);
  }
});
