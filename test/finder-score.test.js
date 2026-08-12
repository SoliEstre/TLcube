import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadFinderMaskCandidates, parseFinderMaskCandidates, runHarness,
} from '../tools/finder-score.mjs';

/**
 * finder-score 는 «검출기 없이» 파인더 후보를 거르는 자다. 자가 틀리면 후보 순위 전체가
 * 조용히 무의미해지므로, 자를 실측에 맞대어 보는 검증을 여기 고정한다.
 *
 * 실측(`.agent/decoder/004`·`005`): 현행 불스아이 53% · 중앙 QR 변형 89%.
 * 이 자는 그 «크기»가 아니라 «방향»만 재현하면 된다 — 성공률에 보정된 점수가 아니다.
 *
 * 한 번만 돌려 여러 test 가 나눠 본다 (전 후보 채점 ~3.4s + PNG 렌더).
 */
const OUTPUT_PARENT = path.join(os.tmpdir(), 'tlcube-finder-score-test');
const REPORT = await runHarness({ top: 1, outputParent: OUTPUT_PARENT });

const MASK_OUTPUT_PARENT = path.join(os.tmpdir(), 'tlcube-finder-score-mask-test');
const MASK_CANDIDATES = parseFinderMaskCandidates([
  {
    id: 'centered',
    cellMasks: Array(19).fill(7),
    params: { comparisonGroup: 'fixture', comparisonOrder: 0, comparisonLabel: 'seed' },
  },
  {
    id: 'offcenter',
    cellMasks: [0, 0, 0, 0, 0, 5, 0, 0, 4, 4, 7, 0, 0, 0, 0, 0, 0, 0, 0],
    params: { comparisonGroup: 'fixture', comparisonOrder: 1, comparisonLabel: 'h1' },
  },
  {
    id: 'three-tone-manual',
    toneRanks: { T: 2, L: 1, R: 0 },
    radiusCells: 3.5,
    params: { comparisonGroup: 'fixture', comparisonOrder: 2, comparisonLabel: '3tone' },
  },
]);
const MASK_REPORT = await runHarness({
  outputParent: MASK_OUTPUT_PARENT,
  maskCandidates: MASK_CANDIDATES,
});
test.after(async () => {
  await fs.rm(OUTPUT_PARENT, { recursive: true, force: true });
  await fs.rm(MASK_OUTPUT_PARENT, { recursive: true, force: true });
});

const bullseye = REPORT.baselines.find((b) => b.id === 'bullseye');
const centerQr = REPORT.baselines.find((b) => b.id === 'center-qr');
const winner = REPORT.topCandidates[0];
const AXES = ['rotation', 'lowResolution', 'localization', 'dataDistinction'];

test('자 검증 — 두 기준선을 모두 채점하고 통과 판정을 남긴다', () => {
  assert.ok(bullseye, '불스아이 기준선이 보고에 없다');
  assert.ok(centerQr, '중앙 QR 기준선이 보고에 없다');
  assert.equal(REPORT.rulerValidation.passed, true);
  assert.equal(bullseye.centerBalance, null, '기준선에 후보 게이트를 적용했다');
  assert.equal(centerQr.centerBalance, null, '기준선에 후보 게이트를 적용했다');
  const gate = REPORT.meta.centerBalanceGate;
  assert.equal(gate.limitCells, 0.5);
  assert.ok(gate.rejectedCount > 0, '중심 균형 게이트가 후보를 하나도 거르지 않았다');
  assert.equal(Object.values(gate.rejectedByFamily).reduce((sum, count) => sum + count, 0),
    gate.rejectedCount, '족별 중심 게이트 탈락 수의 합이 맞지 않는다');
  for (const candidate of [...REPORT.topCandidates, ...Object.values(REPORT.topByFamily).flat()]) {
    assert.equal(candidate.centerBalance.passed, true, candidate.id + '가 중심 게이트를 우회했다');
    assert.ok(candidate.centerOffsetCells <= gate.limitCells,
      candidate.id + ' 중심 오프셋이 ' + candidate.centerOffsetCells + 'c다');
  }
});

test('동심원은 회전 점수가 정확히 0 — 격자 회전 사상이 실제 대칭이라는 증거', () => {
  // 동심원은 반지름만의 함수라 두 비자명 격자 회전 모두에서 자기 자신이다. 회전 사상이
  // 기하학적으로 틀렸다면 이 값은 0 이 아니게 된다 — 즉 이 단언이 사상의 검증이다.
  assert.equal(bullseye.scores.rotation, 0);
  assert.equal(bullseye.diagnostics.rotation.minDifferenceCount, 0);
  assert.equal(REPORT.rulerValidation.bullseyeStructurallyZero, true);
});

test('중앙 QR 은 어떤 회전에서도 자기 자신이 아니다 — 방향을 스스로 준다', () => {
  assert.ok(centerQr.scores.rotation > 0,
    '중앙 QR 회전 점수가 0 이면 자가 방향 정보를 못 재고 있다');
  assert.ok(centerQr.diagnostics.rotation.minDifferenceCount > 0);
});

test('실측 방향 재현 — 중앙 QR 종합 > 현행 불스아이 종합', () => {
  assert.ok(centerQr.scores.total > bullseye.scores.total,
    `실측은 89% > 53% 인데 자는 ${centerQr.scores.total} vs ${bullseye.scores.total} 로 갈랐다`);
  assert.equal(REPORT.rulerValidation.totalOrderingMatches, true);
});

test('회전 바닥 — 상위권에 89% 기준선 이상의 방향 정보를 주는 후보가 남아 있다', () => {
  // 4축 시절엔 1위가 중앙 QR 을 네 축 전부에서 지배해서 가중치를 안 써도 «89%보다
  // 낫다» 가 성립했다. 구조 단순성·결손 집중도가 들어오면서 그 지배는 깨졌다 —
  // 마크답게 만들수록 국소화가 떨어지는 실제 상충이다. 그래서 지배 대신 «바닥» 을 건다:
  // 방향은 실측이 지목한 지배 변수이므로, 상위권에 89% 기준선만큼 방향을 주는 후보가
  // 하나도 안 남으면 그 순위표로는 아무것도 고를 수 없다.
  // 족별 상위까지 포함한 «보고서가 사람에게 보여주는 후보 전체» 를 본다. 종합 상위만
  // 보면 top=1 로 돌렸을 때 표본이 하나뿐이라 바닥이 우연에 흔들린다.
  const shortlist = [...REPORT.topCandidates, ...Object.values(REPORT.topByFamily).flat()];
  const best = Math.max(...shortlist.map((c) => c.scores.rotation));
  assert.ok(best >= centerQr.scores.rotation,
    `상위 후보 최대 회전 ${best} < 중앙 QR ${centerQr.scores.rotation}`);
});

test('종합 1위를 그대로 채택하면 안 된다 — 축 하나는 반드시 후퇴해 있다', () => {
  // 종합은 «[미검증] 동일 가중 기하평균» 이다. 이 단언은 그 사실을 눈에 보이게 붙들어 둔다.
  // 후퇴하는 축은 대개 국소화인데, 국소화는 실측을 예측하지 못한다는 반례가 이미 있다 —
  // 현행 불스아이가 국소화 32.22 로 «가장 좋으면서» 실측은 53% 로 가장 나빴다.
  // 지배가 되살아나 이 테스트가 실패하면 그건 좋은 소식이고, 그때 규칙을 다시 쓴다.
  const regressed = AXES.filter((axis) => winner.scores[axis] < centerQr.scores[axis]);
  assert.ok(regressed.length > 0,
    '1위가 중앙 QR 을 전 축에서 지배한다 — 파레토 규칙으로 되돌릴 수 있다');
});

test('대칭 증거판 — C3/C6은 0점, C2는 중심을 지키면서 0점이 아니다', () => {
  // C6 꽃과 C3 바람개비는 120도 대칭을 포함해서 죽는다. C2는 120도 대칭을 포함하지
  // 않으며, 180도는 rhombille orientation 가설이 아니므로 회전 축에서 손실이 없어야 한다.
  const harmful = REPORT.symmetryWitnesses.filter((witness) =>
    witness.params.symmetryClass === 'C3' || witness.params.symmetryClass === 'C6');
  const c2 = REPORT.symmetryWitnesses.filter((witness) =>
    witness.params.symmetryClass === 'C2');
  assert.equal(harmful.length, 2, 'C3/C6 대칭 증거판 수가 맞지 않는다');
  assert.equal(c2.length, 4, '네 우선 족의 C2 증거판이 모두 없다');
  for (const witness of harmful) {
    assert.equal(witness.scores.rotation, 0,
      witness.id + ' 회전 점수가 0 이 아니다');
    assert.equal(witness.scores.total, 0,
      witness.id + ' 종합 점수가 0 이 아니다');
  }
  for (const witness of c2) {
    assert.ok(witness.scores.rotation > 0,
      witness.id + ' C2 회전 점수가 0 이다');
    assert.ok(witness.scores.total > 0,
      witness.id + ' C2 종합 점수가 0 이다');
    assert.equal(witness.centerBalance.passed, true,
      witness.id + ' C2 판본이 중심 게이트를 통과하지 못했다');
  }
});

test('회전 축은 실재하는 모호성만 잰다 — 최악 회전은 120도 아니면 240도', () => {
  // rhombille 의 유일한 비자명 회전 대칭은 120/240 뿐이다 (src/placement.js).
  // 60/180/300 을 넣으면 존재하지 않는 해석에 최솟값이 걸려 멀쩡한 후보가 떨어진다 —
  // 실제로 중앙 QR 이 180도에 걸려 42.38 로 저평가돼 있었다 (바로잡은 뒤 64.89).
  for (const entry of [...REPORT.baselines, ...REPORT.topCandidates]) {
    assert.ok([120, 240].includes(entry.diagnostics.rotation.worstDegrees),
      `${entry.id}: 최악 회전 ${entry.diagnostics.rotation.worstDegrees}도 — 격자 대칭이 아니다`);
  }
});

test('데이터 구별도는 아직 포화 상태 — 순위를 가르지 못한다고 보고에 남는다', () => {
  // 포화 자체는 결함이 아니라 «잡음 없는 모델의 상계» 라는 한계다. 다만 이 축이
  // 100 으로 붙어 있는 동안 상위권 순위는 사실상 3축으로 결정된다 — 그 사실이
  // 보고에서 사라지면 없는 판별력을 있다고 읽게 된다.
  assert.equal(winner.scores.dataDistinction, 100);
  assert.ok(REPORT.limitations.some((line) => line.includes('[미검증]')),
    '한계 항목에 [미검증] 표기가 없다');
});


test('임의 마스크 입력은 이름→배열·후보 배열·파일을 같은 후보 형식으로 읽는다', async () => {
  const masks = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const mapped = parseFinderMaskCandidates({ bird: masks });
  const listed = parseFinderMaskCandidates([{ name: 'bird-2', cellMasks: masks }]);
  assert.equal(mapped[0].id, 'bird');
  assert.equal(mapped[0].name, 'bird');
  assert.deepEqual(mapped[0].cellMasks, masks);
  assert.equal(mapped[0].bits.length, 57);
  assert.equal(listed[0].id, 'bird-2');

  const tone = parseFinderMaskCandidates({
    cube: { toneRanks: { T: 2, L: 1, R: 0 }, radiusCells: 3.5 },
  });
  assert.deepEqual(tone[0].toneRanks, { T: 2, L: 1, R: 0 });
  assert.equal(tone[0].radiusCells, 3.5);
  const inputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tlcube-finder-masks-'));
  const inputPath = path.join(inputDir, 'masks.json');
  try {
    await fs.writeFile(inputPath, JSON.stringify({ 'bird-file': masks }), 'utf8');
    const loaded = await loadFinderMaskCandidates({ masksFile: inputPath });
    assert.equal(loaded[0].id, 'bird-file');
    assert.deepEqual(loaded[0].cellMasks, masks);
  } finally {
    await fs.rm(inputDir, { recursive: true, force: true });
  }
});

test('임의 마스크 입력 오류는 조용히 보정하지 않는다', () => {
  assert.throws(() => parseFinderMaskCandidates({}), /하나 이상/);
  assert.throws(() => parseFinderMaskCandidates({ empty: Array(19).fill(0) }), /켜진 면/);
  assert.throws(() => parseFinderMaskCandidates({ short: [1, 2] }), /19개/);
  assert.throws(() => parseFinderMaskCandidates({ bad: [...Array(18).fill(0), 8] }), /0..7/);
  assert.throws(() => parseFinderMaskCandidates([
    { id: 'same', cellMasks: Array(19).fill(1) },
    { id: 'same', cellMasks: Array(19).fill(2) },
  ]), /중복/);
  assert.throws(() => parseFinderMaskCandidates({
    bullseye: Array(19).fill(1),
  }), /충돌/);
});

test('임의 후보 모드는 3톤까지 고정 12종·기준선과 한 표에서 6축만 채점한다', () => {
  assert.equal(MASK_REPORT.rulerValidation.passed, true);
  assert.equal(MASK_REPORT.meta.mode, 'manual-masks');
  assert.equal(MASK_REPORT.customMasks.table.length, 2 + 12 + MASK_CANDIDATES.length);
  assert.equal(MASK_REPORT.customMasks.candidates.length, MASK_CANDIDATES.length);
  assert.equal(MASK_REPORT.meta.centerBalanceGate.scoredCount, MASK_CANDIDATES.length);
  assert.equal(MASK_REPORT.meta.centerBalanceGate.passedCount, 2);
  assert.equal(MASK_REPORT.meta.centerBalanceGate.rejectedCount, 1);
  assert.match(MASK_REPORT.meta.centerBalanceGate.policy, /탈락시키지 않음/);

  const offcenter = MASK_REPORT.customMasks.candidates.find((entry) => entry.id === 'offcenter');
  assert.equal(offcenter.centerBalanceGatePassed, false);
  assert.ok(offcenter.centerOffsetCells > 0.5, offcenter.centerOffsetCells);
  for (const entry of MASK_REPORT.customMasks.table) {
  const tone = MASK_REPORT.customMasks.candidates.find((entry) => entry.id === 'three-tone-manual');
  assert.ok(tone.scores.rotation > 0);
  assert.deepEqual(tone.toneRanks, { T: 2, L: 1, R: 0 });
    assert.deepEqual(Object.keys(entry.scores), [
      'rotation', 'lowResolution', 'localization', 'dataDistinction',
      'structuralSimplicity', 'defectConcentration',
    ]);
    assert.equal('total' in entry.scores, false, entry.id + ': total 노출');
    assert.equal('legacyTotal' in entry.scores, false, entry.id + ': legacyTotal 노출');
  }
});

test('임의 마스크는 탈락 여부와 무관하게 단독·실제 Type O PNG를 각각 남긴다', async () => {
  const outputDir = MASK_REPORT.meta.outputDir;
  const manifest = MASK_REPORT.customMasks.renderManifest;
  assert.equal(manifest.files.length, MASK_CANDIDATES.length);
  for (const entry of manifest.files) {
    for (const image of [entry.finder, entry.typeO]) {
      const bytes = await fs.readFile(path.join(outputDir, image.file));
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
      assert.ok(image.width > 0 && image.height > 0 && image.bytes === bytes.length);
    }
    assert.ok(entry.typeO.selfCheck.total > 0, entry.id);
    assert.ok(entry.typeO.selfCheck.minDelta > 0, entry.id);
  }

  assert.equal(manifest.comparisons.files.length, 1);
  const comparison = manifest.comparisons.files[0];
  assert.deepEqual(comparison.columns.map((column) => column.label), ['seed', 'h1', '3tone']);
  for (const image of [comparison.finder, comparison.typeO]) {
    const bytes = await fs.readFile(path.join(outputDir, image.file));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
    assert.ok(image.width > 0 && image.height > 0 && image.bytes === bytes.length);
  }
});
