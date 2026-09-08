import assert from 'node:assert/strict';
import test from 'node:test';

import { detectSeedlessBgLinefitCandidates as observe } from '../src/decoder/cube-silhouette-observe.js';
import { listLumaDumps, readLumaDump } from '../tools/read-luma.mjs';
import { detectSeedlessBgLinefitCandidates as privateOracle } from '../../../lanes/r2-lead-20260908/seedless-bg-linefit.mjs';

const FIRST_TWO = [
  'sil3d-plain-dark-front-tele3x.1440.luma',
  'sil3d-emph-dark-front-tele3x.1440.luma',
];

function corpusEntry(base) {
  const entry = listLumaDumps().find((candidate) => candidate.name.endsWith('/' + base)
    || candidate.name === base);
  assert.ok(entry, `실물 luma fixture가 필요하다: ${base}`);
  return entry;
}

function stableContract(result) {
  return {
    ok: result.ok,
    source: result.source,
    candidates: result.candidates.map((candidate) => ({
      preRankingIndex: candidate.preRankingIndex,
      policyArm: candidate.policyArm,
      vertices: candidate.vertices,
      center: candidate.center,
      radius: candidate.radius,
      provenance: candidate.provenance,
      diagnostics: {
        stage: candidate.diagnostics.stage,
        foregroundPixels: candidate.diagnostics.foregroundPixels,
        edgePoints: candidate.diagnostics.edgePoints,
        hullLength: candidate.diagnostics.hullLength,
        componentSize: candidate.diagnostics.componentSize,
        componentCount: candidate.diagnostics.componentCount,
        lineSpans: candidate.diagnostics.lineSpans,
      },
    })),
    diagnostics: {
      measuredArms: result.diagnostics.measuredArms,
      emittedCandidates: result.diagnostics.emittedCandidates,
      arms: result.diagnostics.arms.map(({ ms: _ms, ...arm }) => arm),
    },
  };
}

test('private 절단 wrapper의 첫 2개 좌표와 mask 진단을 그대로 보존한다', () => {
  for (const base of FIRST_TWO) {
    const luma = readLumaDump(corpusEntry(base).path);
    const actual = observe(luma);
    const expected = privateOracle(luma);
    assert.deepEqual(stableContract(actual), stableContract(expected), base);
    for (const candidate of actual.candidates) {
      assert.deepEqual(candidate.diagnostics.pixelExtrema, {
        construction: 'leftmost and rightmost kept foreground pixel per image row',
        count: candidate.diagnostics.edgePoints,
      });
      assert.deepEqual(candidate.diagnostics.tlsIntersections, {
        construction: 'weighted total-least-squares hull lines, adjacent intersections',
        count: 6,
      });
      assert.equal(candidate.vertices.length, 6);
      assert.ok(['luma > threshold', 'luma < threshold']
        .includes(candidate.provenance.foregroundRule));
      assert.ok(Number.isFinite(candidate.provenance.threshold));
    }
  }
});

test('반환값 mutation이 다음 관찰에 새지 않고 oracle 성격 getter를 읽지 않는다', () => {
  const original = readLumaDump(corpusEntry(FIRST_TWO[0]).path);
  const forbidden = ['n', 'layout', 'format', 'expected', 'body', 'pose', 'registry', 'encodeY'];
  for (const name of forbidden) {
    Object.defineProperty(original, name, {
      enumerable: true,
      get() { throw new Error(`금지된 oracle getter를 읽었다: ${name}`); },
    });
  }
  const first = observe(original);
  const pristine = stableContract(observe(original));
  first.candidates[0].vertices[0].x = -123456;
  first.candidates[0].diagnostics.lineSpans[0] = -1;
  first.source.candidatePolicy.push('forbidden');
  assert.deepEqual(stableContract(observe(original)), pristine);
});

test('빈 화면과 희소 잡음에서 기하를 지어내지 않는다', () => {
  const blank = { width: 16, height: 16, data: new Float32Array(256).fill(0.5) };
  const noisy = { width: 16, height: 16, data: new Float32Array(256).fill(0.5) };
  for (const index of [0, 19, 70, 141, 238]) noisy.data[index] = 1;
  for (const input of [blank, noisy]) {
    const result = observe(input);
    assert.equal(result.ok, true);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.diagnostics.measuredArms, 2);
    assert.equal(result.diagnostics.emittedCandidates, 0);
    assert.ok(result.diagnostics.arms.every((arm) => arm.emitted === false));
  }
});

test('malformed LumaField를 명시적으로 거부한다', () => {
  for (const input of [
    null,
    {},
    { width: 0, height: 1, data: new Float32Array(0) },
    { width: 1.5, height: 1, data: new Float32Array(1) },
    { width: 2, height: 2, data: new Float32Array(3) },
  ]) {
    assert.throws(() => observe(input), {
      name: 'TypeError',
      message: '유효한 LumaField가 필요하다',
    });
  }
});
