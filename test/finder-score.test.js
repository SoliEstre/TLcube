import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runHarness } from '../tools/finder-score.mjs';

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
test.after(() => fs.rm(OUTPUT_PARENT, { recursive: true, force: true }));

const bullseye = REPORT.baselines.find((b) => b.id === 'bullseye');
const centerQr = REPORT.baselines.find((b) => b.id === 'center-qr');
const winner = REPORT.topCandidates[0];
const AXES = ['rotation', 'lowResolution', 'localization', 'dataDistinction'];

test('자 검증 — 두 기준선을 모두 채점하고 통과 판정을 남긴다', () => {
  assert.ok(bullseye, '불스아이 기준선이 보고에 없다');
  assert.ok(centerQr, '중앙 QR 기준선이 보고에 없다');
  assert.equal(REPORT.rulerValidation.passed, true);
});

test('동심원은 회전 점수가 정확히 0 — 격자 회전 사상이 실제 대칭이라는 증거', () => {
  // 동심원은 반지름만의 함수라 6가지 격자 회전 전부에서 자기 자신이다. 회전 사상이
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

test('대칭 판본은 정확히 0점 — 꽃잎 6장·날개 3장을 왜 깨야 하는지의 근거', () => {
  // C6 꽃과 C3 바람개비는 «예쁜 꽃» 의 가장 자연스러운 형태이면서 현행 불스아이와
  // 똑같은 방식으로 죽는다. 그 사실을 표에 증거로 남기는 것이 이 판본들의 존재 이유다.
  assert.ok(REPORT.symmetryWitnesses.length >= 2, '대칭 증거판이 보고에 없다');
  for (const witness of REPORT.symmetryWitnesses) {
    assert.equal(witness.scores.rotation, 0, `${witness.id} 회전 점수가 0 이 아니다`);
    assert.equal(witness.scores.total, 0, `${witness.id} 종합 점수가 0 이 아니다`);
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
