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

test('1위 후보는 중앙 QR 을 네 축 전부에서 이긴다 (파레토 지배)', () => {
  // 축 가중치는 아직 실측으로 보정되지 않았다. 지배가 성립하는 동안에는 가중치와
  // 무관하게 «1위가 89% 기준선보다 낫다» 가 성립하므로, 이 단언이 깨지면 순위표를
  // 종합점수만으로 읽어선 안 된다는 뜻이다.
  for (const axis of AXES) {
    assert.ok(winner.scores[axis] >= centerQr.scores[axis],
      `${axis}: 1위 ${winner.scores[axis]} < 중앙 QR ${centerQr.scores[axis]} — 지배가 깨졌다`);
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
