/**
 * self-check-verdict.test.js — 자체검증 3태(사용가능 / 인식곤란 / 사용불가) 판정.
 *
 * 왜 순수 함수로 빼서 재는가: 세 갈래 중 «인식곤란»·«사용불가» 는 정상 팔레트로
 * 렌더해서는 재현되지 않는다 (기본 프리셋 셋 다 Δmin 여유가 34~35% 다 — 실측
 * 2026-08-16). 화면에서 못 만드는 갈래를 «있다고 치고» 두면, 나중에 그 갈래가
 * 필요할 때 처음으로 틀린 것을 알게 된다. 그래서 합성 입력으로 여기서 고정한다.
 *
 * 임의 라벨 방지: 이 테스트는 «라벨이 붙는가» 가 아니라 «게이트 여유에서 나오는가» 를
 * 잰다 — 각 게이트를 하나씩 조여서 그 게이트 때문에 등급이 내려가는지 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SELFCHECK_TIGHT_RATIO, selfCheckGateRatio, selfCheckTightPercent, selfCheckVerdict,
} from '../src/render-status.js';
import { DELTA_MIN_CONTRACT } from '../src/luminance.js';
import { EPSILON_FIT } from '../src/verifyY.js';

const CONTRACT = { deltaMinContract: DELTA_MIN_CONTRACT };

/** Type O/A 자체검증 산출물의 최소 형태. */
const oa = (minDelta, ok = true) => ({ ok, minDelta, total: 198, mismatches: [] });

/** Type Y 3톤. */
const y3 = (minDeltaY, maxResidual = 0) => ({
  ok: true,
  minDeltaY,
  logMargin: NaN,
  total: 441,
  mismatches: [],
  erasures: [],
  residualGate: { maxResidual, epsilon: EPSILON_FIT, ok: true },
});

/** Type Y 2톤. */
const y2 = (logMargin, maxResidual = 0) => ({
  ok: true,
  minDeltaY: NaN,
  logMargin,
  total: 441,
  mismatches: [],
  erasures: [],
  residualGate: { maxResidual, epsilon: EPSILON_FIT, ok: true },
});

test('경계 띠 폭은 0.8 — 게이트 여유 20% 가 «인식곤란» 의 문턱이다', () => {
  assert.equal(SELFCHECK_TIGHT_RATIO, 0.8);
  // 0.12 / 0.8 = 0.15 → Δmin 0.15 가 정확히 문턱이다.
  assert.equal(selfCheckVerdict(oa(0.15), CONTRACT).state, 'usable');
  assert.equal(selfCheckVerdict(oa(0.1499), CONTRACT).state, 'marginal');
});

test('실패한 자체검증은 무조건 «사용불가» 이고 여유를 보고하지 않는다', () => {
  const failed = { ok: false, minDelta: 0.4, mismatches: [{}, {}], total: 198 };
  const verdict = selfCheckVerdict(failed, CONTRACT);
  assert.equal(verdict.state, 'unusable');
  assert.equal(verdict.ratio, null);
  assert.equal(verdict.headroomPercent, null);
});

test('Δ 게이트 — 계약(0.12) 대비 여유가 등급을 정한다', () => {
  assert.equal(DELTA_MIN_CONTRACT, 0.12);
  // 실측(2026-08-16, 기본 프리셋 slate): Type O Δmin 0.182 → 여유 34%.
  const real = selfCheckVerdict(oa(0.182), CONTRACT);
  assert.equal(real.state, 'usable');
  assert.equal(real.headroomPercent, 34);
  // 계약 바로 위 — 통과지만 여유가 거의 없다.
  assert.equal(selfCheckVerdict(oa(0.125), CONTRACT).state, 'marginal');
  assert.equal(selfCheckVerdict(oa(0.125), CONTRACT).headroomPercent, 4);
});

test('잔차 게이트 — ε_fit 의 80% 를 넘으면 Δ 가 넉넉해도 «인식곤란»', () => {
  assert.equal(EPSILON_FIT, 0.01);
  assert.equal(selfCheckVerdict(y3(0.4, 0.001), CONTRACT).state, 'usable');
  assert.equal(selfCheckVerdict(y3(0.4, 0.0081), CONTRACT).state, 'marginal');
  // 가장 조인 게이트가 등급을 정한다 — Δ 는 여유 만점인데 잔차만으로 내려간다.
  assert.equal(selfCheckVerdict(y3(0.4, 0.0081), CONTRACT).headroomPercent, 19);
});

test('2톤 θ 마진 — ok 게이트에 하한이 없어 이 항이 유일한 «경계» 신호다', () => {
  const ideal = 1.327; // ½·ln(y_hi/y_lo) — 팔레트에서 나온다
  const c = { ...CONTRACT, idealLogMargin: ideal };
  // 실측(2026-08-16, 기본 프리셋 2톤): logMargin 1.261 → 여유 95%.
  assert.equal(selfCheckVerdict(y2(1.261), c).state, 'usable');
  assert.equal(selfCheckVerdict(y2(1.261), c).headroomPercent, 95);
  // 이상치의 5분의 1까지 줄면 h = 0.8 «초과» 가 아니라 정확히 0.8 → 아직 usable.
  assert.equal(selfCheckVerdict(y2(ideal * 0.2), c).state, 'usable');
  assert.equal(selfCheckVerdict(y2(ideal * 0.19), c).state, 'marginal');
  // idealLogMargin 이 없으면(팔레트를 못 읽는 경우) 이 항은 아예 안 센다 — 없는
  // 근거로 등급을 내리지 않는다.
  assert.equal(selfCheckVerdict(y2(0.01), CONTRACT).state, 'usable');
});

test('비율은 0..1 로 잘리고, 잴 게이트가 없으면 0(여유 만점)', () => {
  assert.equal(selfCheckGateRatio(oa(10), CONTRACT), DELTA_MIN_CONTRACT / 10);
  assert.equal(selfCheckGateRatio({ ok: true }, CONTRACT), 0);
  // 게이트를 넘긴 값(ok=false 여야 정상)이 들어와도 1 을 넘지 않는다.
  assert.equal(selfCheckGateRatio(oa(0.01), CONTRACT), 1);
  // logMargin 이 이상치를 넘어서도 음수로 새지 않는다.
  assert.equal(selfCheckGateRatio(y2(5), { ...CONTRACT, idealLogMargin: 1.3 }), 0);
});

test('계약 상수가 없으면 조용히 0 을 쓰지 않고 던진다', () => {
  assert.throws(() => selfCheckGateRatio(oa(0.2), { deltaMinContract: 0 }), RangeError);
});

// ── 여유 % 가 뱃지와 어긋나지 않는가 ─────────────────────────────────────
//
// 화면 한 줄은 «[인식곤란] 게이트 여유 20% — 20% 미만이면 «인식곤란»» 처럼 두 주장을
// 나란히 놓는다. 그래서 뱃지와 숫자가 **서로를 반증하면 안 된다**. 옛 구현은
// `Math.round` 라 h = 0.801~0.805 에서 정확히 그렇게 됐다 (2026-08-16 적대 검증 nit 1).

test('문턱 %는 띠 폭에서 유도된다 (문구에 20 을 박지 않는다)', () => {
  assert.equal(selfCheckTightPercent(), 20);
  assert.equal(selfCheckTightPercent(SELFCHECK_TIGHT_RATIO), 20);
  assert.equal(selfCheckTightPercent(0.9), 10);
  assert.equal(selfCheckVerdict(oa(0.2), CONTRACT).tightPercent, 20);
  // 실패 판정에도 문턱은 실려 있어야 한다 (문구를 만드는 쪽이 갈라지지 않게).
  assert.equal(selfCheckVerdict({ ok: false }, CONTRACT).tightPercent, 20);
});

test('경계 띠(h 0.80~0.81)에서 여유 %와 뱃지가 서로 어긋나지 않는다', () => {
  // 옛 증상 재현 구간 — 반올림이면 여기서 전부 «20%» 로 적히면서 뱃지는 «인식곤란».
  const cases = [
    { ratio: 0.8, state: 'usable', pct: 20 },
    { ratio: 0.8005, state: 'marginal', pct: 19 },
    { ratio: 0.801, state: 'marginal', pct: 19 },
    { ratio: 0.803, state: 'marginal', pct: 19 },
    { ratio: 0.805, state: 'marginal', pct: 19 },
    { ratio: 0.81, state: 'marginal', pct: 19 },
    { ratio: 0.815, state: 'marginal', pct: 18 },
  ];
  for (const { ratio, state, pct } of cases) {
    const verdict = selfCheckVerdict(oa(DELTA_MIN_CONTRACT / ratio), CONTRACT);
    assert.equal(verdict.state, state, `h=${ratio} 의 등급`);
    assert.equal(verdict.headroomPercent, pct, `h=${ratio} 의 여유 %`);
  }
});

test('여유 %는 전 구간에서 판정과 같은 쪽을 가리킨다 (스윕)', () => {
  // 한 점이 아니라 «어디서도 어긋나지 않는다» 를 잰다 — 경계는 옮겨질 수 있고,
  // 그때 이 불변식이 자동으로 따라와야 한다.
  let marginalSeen = 0;
  let usableSeen = 0;
  for (let step = 0; step <= 5000; step += 1) {
    const minDelta = DELTA_MIN_CONTRACT + step * 0.0002;   // h = 1.0 → 약 0.1
    const verdict = selfCheckVerdict(oa(minDelta), CONTRACT);
    const badgeSaysTight = verdict.state === 'marginal';
    const textSaysTight = verdict.headroomPercent < verdict.tightPercent;
    assert.equal(badgeSaysTight, textSaysTight,
      `minDelta ${minDelta.toFixed(5)} (h ${verdict.ratio.toFixed(5)}): `
      + `뱃지 «${verdict.state}» 인데 문구는 «여유 ${verdict.headroomPercent}% / 문턱 `
      + `${verdict.tightPercent}%» 라고 말한다`);
    if (badgeSaysTight) marginalSeen += 1; else usableSeen += 1;
  }
  assert.ok(marginalSeen > 0 && usableSeen > 0, '스윕이 두 갈래를 다 지나야 한다');
});

test('여유 %는 내림이되 부동소수점 때문에 한 칸 깎이지 않는다', () => {
  // 잔차 0.0081 / ε 0.01 → h = 0.81 인데 (1−h)×100 이 18.999999999999996 으로 떨어진다.
  // 순수 floor 면 18 이 되어 «정확히 19%» 를 잃는다.
  assert.equal(selfCheckVerdict(y3(0.4, 0.0081), CONTRACT).headroomPercent, 19);
  // 반대로 진짜 19.9% 는 20 으로 올라가면 안 된다.
  assert.equal(selfCheckVerdict(oa(DELTA_MIN_CONTRACT / 0.801), CONTRACT).headroomPercent, 19);
  // 여유 만점·바닥은 그대로.
  assert.equal(selfCheckVerdict({ ok: true }, CONTRACT).headroomPercent, 100);
  assert.equal(selfCheckVerdict(oa(0.001), CONTRACT).headroomPercent, 0);
  // 내림이므로 99.88% 는 99 로 적힌다 (100 으로 올려 «여유 만점» 처럼 보이면 안 된다).
  assert.equal(selfCheckVerdict(oa(100), CONTRACT).headroomPercent, 99);
});
