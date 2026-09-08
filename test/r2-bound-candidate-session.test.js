import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoundCandidateSession} from '../src/r2/bound-candidate-session.js';
import {FAMILY_C} from '../src/r2/adapter-c.js';
import {syntheticC,observeAll} from './r2-c-fixtures.js';
import {createObservedCSession} from './r2-c-session-fixtures.js';

test('새 연결기는 실제 관측 C 후보에서 기존 검증 소비자와 전 프레임/누적 벡터가 같다',()=>{
  const {field}=syntheticC(0,'bound-session'),acquired=observeAll(field,{budget:{detectMs:32},maxHypotheses:8});
  const row=acquired.rows.find(r=>r.format.kind==='read'&&r.format.layoutId==='C0');assert.ok(row);
  const a=acquired.adapter.bindCandidate(row.observation,row.format),b=acquired.adapter.bindCandidate(row.observation,row.format);
  const current=createBoundCandidateSession(a,{family:FAMILY_C}),previous=createObservedCSession(b);
  for(let frame=0;frame<12;frame++){
    const timestamp=100000+frame,pose={frameId:timestamp,alpha:field.alpha};
    const result=current.pushFrame(field,timestamp,pose);
    const baseline=previous.session.pushFrame(field.data,field.width,field.height,timestamp,pose);
    assert.deepEqual(result,baseline);
    assert.deepEqual(current.session.buffers.accumulatorSoA,previous.session.buffers.accumulatorSoA);
  }
  assert.equal(current.calls.eligibility,previous.calls.detect);assert.equal(current.calls.align,previous.calls.align);
  assert.equal(current.calls.decode,previous.calls.decode);
  current.dispose();assert.equal(current.disposed,true);assert.equal(current.pushFrame(field,200000),null);
});
test('default 후보·미완성 key·family 누락으로 세션을 세우지 않는다',()=>{
  assert.throws(()=>createBoundCandidateSession(null,{family:FAMILY_C}));
  assert.throws(()=>createBoundCandidateSession({bound:{},alignInto(){}}));
});
