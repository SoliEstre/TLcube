import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSampledOrientation, scoreSampledOrientationPhase, hexRotationHypotheses } from '../src/decoder/orientation-scorer.js';

const hypotheses = hexRotationHypotheses();
const layout = [
  { key: '0,0', tones: { T: 0, L: 1, R: 2 } },
  { key: '1,0', tones: { T: 2, L: 0, R: 1 } },
  { key: '0,1', tones: { T: 1, L: 2, R: 0 } },
];
const values = new Map(layout.map(e => [e.key, Object.fromEntries(Object.entries(e.tones).map(([f,t]) => [f, t / 2]))]));
const anchors = { T: { dark: 0, bright: 1 }, L: { dark: 0, bright: 1 }, R: { dark: 0, bright: 1 } };

test('단상 채점은 항등 및 비항등 모두 기존 다상 항목 전체와 같아요', () => {
  for (const options of [undefined, { toneAnchors: anchors }, { toneAnchors: { T: anchors.T } },
    { calibration: { orientationScorer: { classifyMidFraction: 0.5, minimumSamplesPerTone: 1 } } }]) {
    for (const missing of [null, '0,0', '1,0']) {
      const sample = key => key === missing ? null : values.get(key);
      const all = scoreSampledOrientation(layout, hypotheses, sample, options);
      for (let i = 0; i < hypotheses.length; i++) {
        assert.deepEqual(scoreSampledOrientationPhase(layout, hypotheses[i], sample, options), all.phases[i]);
      }
    }
  }
});

test('알려진 톤은 9슬롯 일치, 미관측은 소거이며 주입 앵커가 표본수를 부풀리지 않아요', () => {
  const phase = scoreSampledOrientationPhase(layout, hypotheses[0], key => values.get(key), { toneAnchors: anchors });
  assert.equal(phase.matches, 9); assert.equal(phase.total, 9); assert.equal(phase.agreement, 1);
  assert.equal(phase.enoughSamples, false); assert.deepEqual(phase.sampleCounts.T, { dark: 1, bright: 1 });
  const missing = scoreSampledOrientationPhase(layout, hypotheses[0], () => ({ T: NaN, L: Infinity, R: null }), { toneAnchors: anchors });
  assert.equal(missing.total, 0); assert.equal(missing.matches, 0); assert.equal(missing.agreement, 0);
  assert.deepEqual(missing.sampleCounts.T, { dark: 0, bright: 0 });
});

test('집합 밖 사상은 관측이 없어도 불일치 분모에 남아요', () => {
  const h = { ...hypotheses[0], id: 'outside', mapKey: () => null };
  const phase = scoreSampledOrientationPhase(layout, h, () => null);
  assert.equal(phase.total, 9); assert.equal(phase.matches, 0); assert.equal(phase.enoughSamples, false);
});

test('경계 동률과 붕괴 앵커도 원래 다상 결과와 같아요', () => {
  for (const value of [0.36, 0.64, 0.5, 0, 1]) {
    for (const bright of [1, 0]) {
      const options = { toneAnchors: Object.fromEntries(['T','L','R'].map(f => [f, { dark: 0, bright }])) };
      const sample = () => ({ T: value, L: value, R: value });
      assert.deepEqual(scoreSampledOrientationPhase(layout, hypotheses[0], sample, options), scoreSampledOrientation(layout, hypotheses, sample, options).phases[0]);
    }
  }
});

test('단상 소비자는 라이벌 샘플 콜백을 실행하지 않아요', () => {
  let singleCalls = 0, allCalls = 0;
  scoreSampledOrientationPhase(layout, hypotheses[0], key => { singleCalls++; return values.get(key); });
  scoreSampledOrientation(layout, hypotheses, key => { allCalls++; return values.get(key); });
  assert.equal(singleCalls, 18); assert.ok(allCalls > singleCalls);
});

test('단상 API도 빈 레이아웃과 잘못된 사상을 거부해요', () => {
  assert.throws(() => scoreSampledOrientationPhase([], hypotheses[0], () => null), TypeError);
  assert.throws(() => scoreSampledOrientationPhase(layout, {}, () => null), TypeError);
});
