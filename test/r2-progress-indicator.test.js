/**
 * r2-progress-indicator.test.js — **표시 축의 자.**
 *
 * 🔴 왜 있나 (2026-09-04, 출하 결함 워크플로): PM/029B §18.5 ② 를 고치려는 안이
 * `session.js` 의 「복호를 시도할까」 술어(`internalD >= 1`)를 완화하는데, 그 술어가
 * 가리는 블록 안에는 **복호 호출만 있는 게 아니다** — `result.indicator` 를 FINALIZING
 * 으로 덮는 줄과 셀맵을 ERASURE 로 칠하는 루프가 같이 들어 있다. 즉 그 술어를 만지면
 * **사용자가 보는 표시가 같이 움직인다.**
 *
 * 그런데 실측(2026-09-04 grep): `R2_INDICATOR.FINALIZING` 과 `CELL_MAP_STATE.ERASURE`
 * 를 단언하는 테스트가 `test/`·`tools/` 전체에 **0건**이었다. 그래서 그 회귀는
 * **초록으로 착지한다.** 이 파일이 그 구멍을 막는다.
 *
 * ⚠ 이 파일은 «오늘 값이 옳다» 고 주장하지 않는다. 잠그는 것은 **「표시가 복호 시도와
 * 같이 움직인다」는 성질**이다 — ② 를 착지시킬 때 그 결합을 끊었는지 여기서 보인다.
 * 그래서 ② 가 들어오면 이 파일은 **바뀌어야 한다**. 안 바뀌고 초록이면 결합이 남은 것이다.
 *
 * ⚠ 못 재는 축: 실물 프레임에서의 표시. 여기 어댑터는 합성이라 「검출이 맞았나」는
 * 안 잰다 — 재는 것은 세션이 어떤 순서로 무엇을 표시하느냐뿐이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  R2_INDICATOR,
  R2_SESSION_STATUS,
  createR2Session,
} from '../src/r2/session.js';
import { CELL_MAP_STATE } from '../src/r2/progress.js';
import { Q15_ONE } from '../src/r2/params.js';

function adapters(onDecode, revealFor) {
  return {
    detectInto(luma, width, height, timestamp, pose, output) {
      output.found = 1;
      output.family = 7;
      return R2_SESSION_STATUS.OK;
    },
    alignInto(luma, width, height, timestamp, pose, detection, output, faceLuma, visibleCells) {
      const reveal = revealFor(visibleCells.length);
      output.gatePassed = 1;
      output.weightQ15 = Q15_ONE;
      output.mismatchCount = 0;
      output.matchCount = 0;
      output.visibleCount = reveal;
      for (let cell = 0; cell < visibleCells.length; cell += 1) {
        visibleCells[cell] = cell < reveal ? 1 : 0;
        if (cell < reveal) {
          faceLuma[cell * 3] = 255;
          faceLuma[(cell * 3) + 1] = 128;
          faceLuma[(cell * 3) + 2] = 0;
        }
      }
      return R2_SESSION_STATUS.OK;
    },
    decodeInto(symbolValues, symbolConfidenceQ8, erasures, symbolCount, layout, output) {
      onDecode();
      output.accepted = 0;
      output.payloadLength = 0;
      return R2_SESSION_STATUS.OK;
    },
  };
}

/*
 * 🔴 **하네스가 두 종류의 프레임을 다 내야 한다.** 첫 판(증거를 즉시 포화시키는
 * 어댑터)은 24프레임 전부 「시도 O · FINALIZING」이라 아래 결합 단언이 `true === true`
 * 로 **항상 참**이었고, FINALIZING 을 술어 밖으로 빼는 변이가 **안 물렸다.**
 * 그래서 여기서는 증거를 프레임마다 3칸씩 올려 「시도 X」 구간을 만들고,
 * 셀 3칸을 **영구 미관측**으로 남겨 ERASURE 칠하기도 실제로 발화시킨다.
 * 오늘 값: f0~f8 COLLECTING·시도 X·ERASURE 0칸 / f9~ FINALIZING·시도 O·ERASURE 6→3칸.
 */
function run(frames) {
  let decodeCalls = 0;
  let frame = 0;
  const session = createR2Session({
    layout: { cellCount: 36, requiredSymbolCount: 6 },
    params: { tauCellQ8: 256, erasureMarginQ8: 256 },
    // 마지막 3칸은 끝까지 안 보여 준다 — 그래야 소거가 실제로 생긴다.
    ...adapters(() => { decodeCalls += 1; }, (total) => Math.min(total - 3, (frame + 1) * 3)),
  });
  const luma = new Uint8Array([128]);
  const trace = [];
  let previousCalls = 0;
  for (frame = 0; frame < frames; frame += 1) {
    session.pushFrame(luma, 1, 1, frame * 33, undefined);
    const cellMap = session.result.progress.cellMap;
    let erasureCells = 0;
    for (let i = 0; i < cellMap.length; i += 1) {
      if (cellMap[i] === CELL_MAP_STATE.ERASURE) erasureCells += 1;
    }
    trace.push({
      indicator: session.result.indicator,
      erasureCells,
      attempted: decodeCalls > previousCalls,
    });
    previousCalls = decodeCalls;
  }
  return trace;
}

test('표시(FINALIZING)와 셀맵(ERASURE)은 복호 시도와 **같은 프레임**에서만 움직인다', () => {
  const trace = run(20);

  // ── 공허 방지: 두 종류의 프레임이 **둘 다** 있어야 결합 단언이 판별력을 갖는다 ──
  const attempts = trace.filter((t) => t.attempted).length;
  assert.ok(attempts > 0,
    '20프레임 안에 복호 시도가 없다 — 분모가 도달 불가해졌거나 어댑터가 게이트를 못 넘는다');
  assert.ok(attempts < trace.length,
    '모든 프레임이 복호를 시도한다 — 그러면 아래 단언이 true === true 로 **항상 참**이다. '
    + '증거 램프가 무너졌다 (하네스 주석 참조). 이 자는 지금 아무것도 안 가른다');
  assert.ok(trace.some((t) => t.indicator === R2_INDICATOR.FINALIZING),
    'FINALIZING 이 한 번도 안 나왔다 — 표시 경로가 죽었거나 술어가 이미 바뀌었다');
  assert.ok(trace.some((t) => t.indicator === R2_INDICATOR.COLLECTING),
    'COLLECTING 이 한 번도 안 나왔다 — 램프 구간이 사라졌다');

  // ── 결합 성질: FINALIZING 인 프레임 ⇔ 그 프레임에서 복호를 시도한 프레임 ──
  trace.forEach((entry, i) => {
    const finalizing = entry.indicator === R2_INDICATOR.FINALIZING;
    assert.equal(finalizing, entry.attempted,
      `프레임 ${i}: FINALIZING=${finalizing} 인데 복호 시도=${entry.attempted} 다.
`
      + `    → 표시와 복호 시도의 결합이 끊겼다. PM/029B §18.5 ② 를 착지시키는 중이면
`
      + `      **이게 의도한 변경이다** — 이 파일을 같이 고치고, 표시가 무엇을 따라가는지
`
      + `      새로 적어라. 의도한 게 아니면 session.js 의 표시 쓰기가 술어 안팎으로 샜다.`);
  });
});

test('셀맵 ERASURE 는 복호를 시도한 뒤에만 칠해진다', () => {
  const trace = run(20);
  const firstAttempt = trace.findIndex((t) => t.attempted);
  assert.ok(firstAttempt > 0,
    `첫 복호 시도가 프레임 ${firstAttempt} 다 — 시도 전 구간이 없으면 이 테스트는 공허하다`);
  for (let i = 0; i < firstAttempt; i += 1) {
    assert.equal(trace[i].erasureCells, 0,
      `프레임 ${i} 는 복호 전인데 ERASURE 셀이 ${trace[i].erasureCells}칸 칠해졌다`);
  }
  // 공허 방지: 시도 뒤에는 실제로 칠해져야 한다 (안 칠해지면 위 루프가 공짜로 참이다).
  assert.ok(trace[firstAttempt].erasureCells > 0,
    '복호를 시도했는데 ERASURE 가 0칸이다 — 영구 미관측 셀이 소거로 안 잡힌다. '
    + '하네스의 reveal 상한이 깨졌거나 소거 트리거가 바뀌었다');
});
