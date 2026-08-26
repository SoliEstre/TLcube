/**
 * scanner-state-reset.test.js — 시도 단위 상태가 시도 경계에서 실제로 지워지는가.
 *
 * F-86 (2026-08-23): beginScanAttempt 가 잘림 스트릭 **하나만** 리셋했다.
 * 실패 스트릭 · failStreakSince · autoCropIndex 는 성공 프레임에서만
 * 지워져서, 실패로 끝난 이전 세션의 값이 새 세션 첫 프레임을 오염시켰다 —
 * ① grab 승격(1440) 판정이 남의 스트릭을 읽고 ② 자동 크롭 사다리가 이전 카메라의
 * 단에서 시작하며 ③ failStreakSince 가 과거 시각이라 사다리가 즉시 윗단으로 오른다.
 *
 * F-61 (2026-08-23): resetZoomState 가 autoCropIndex 를 안 지웠다. stopCamera() →
 * 사진 경로에서 분석은 크롭하지 않는데(imageDataWhole) 계측은 직전 카메라의 사다리
 * 값을 그대로 실어 «분석 1배 / 계측 2.2배» 로 갈렸다.
 *
 * scanner.js 는 DOM 모듈이라 임포트할 수 없다 — 소스 슬라이스 단언을 쓴다
 * (zoom-telemetry-autocrop.test.js ⑤ 와 같은 기법: «그 함수 본문에 그 리셋이
 * 실재한다» 까지 보증하고, 동작 확인은 /lab/ 배포 후 실기기·ClickHouse 로 잰다).
 * 이 단언들은 수리 전 소스에서 전부 빨강이었다 (해당 리셋 줄이 없었다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');

/** 함수 선언부터 다음 최상위 function 까지의 본문 슬라이스. */
function sliceOf(name, nextName) {
  const start = SRC.indexOf('function ' + name);
  assert.ok(start >= 0, 'scanner.js 에 function ' + name + ' 이 없다');
  const end = SRC.indexOf('function ' + nextName, start + 1);
  assert.ok(end > start, 'scanner.js 에 function ' + nextName + ' 이 없다');
  return SRC.slice(start, end);
}

test('F-86: beginScanAttempt 가 시도 단위 시간 상태를 전부 리셋한다', () => {
  const body = sliceOf('beginScanAttempt', 'activeVideoTrack');
  assert.match(body, /resetFailureTiming\(\)/,
    '실패·잘림 안내와 승격 시계 리셋이 없다 — 이전 세션의 시간이 새 시도로 샌다');
  assert.match(body, /lastFrameCostMs\s*=\s*0/,
    '직전 카메라의 프레임 비용이 새 시도의 호출 간격을 오염시킨다');
  assert.match(body, /autoCropIndex\s*=\s*0/,
    'autoCropIndex 리셋이 없다 — 이전 세션의 사다리 단이 새 시도로 샌다');
  // 사다리를 지웠으면 프리뷰도 같은 값으로 — «가이드 = 분석» 불변식 (2026-08-15 사고).
  assert.match(body, /syncPreviewTransform\(\)/,
    'beginScanAttempt 가 사다리를 지우고 프리뷰를 재동기화하지 않는다');
});

test('F-86: resetFailureTiming 이 모든 시간 소비자 상태를 실제로 비운다', () => {
  const body = sliceOf('resetFailureTiming', 'beginScanAttempt');
  assert.match(body, /failStreakSince\s*=\s*null/);
  assert.match(body, /clipStreakSince\s*=\s*null/);
  assert.match(body, /clipHintShown\s*=\s*false/);
  assert.match(body, /closerHintShown\s*=\s*false/);
  assert.match(body, /nextEscalationAt\s*=\s*null/);
});

test('F-61: resetZoomState 가 자동 크롭 사다리도 지운다', () => {
  const body = sliceOf('resetZoomState', 'revealZoomControls');
  assert.match(body, /autoCropIndex\s*=\s*0/,
    'resetZoomState 에 autoCropIndex 리셋이 없다 — stopCamera 뒤 사진 프레임이 '
    + '직전 카메라의 사다리 값을 상속 보고한다 (분석 1배 / 계측 2.2배 괴리)');
});

test('전제 배선이 살아 있다 — 계측·승격·사다리가 시간 상태를 실제로 읽는다', () => {
  // 위 리셋 단언이 공허해지지 않게, 소비 지점의 실재를 함께 잠근다.
  assert.match(sliceOf('currentZoomTelemetry', 'formatZoomLabel'),
    /autoCropRung\s*:\s*autoCropIndex/);
  assert.match(sliceOf('grabVideoFrame', 'normalizePayload'),
    /escalationDue\(atMs, nextEscalationAt\)/);
  assert.match(sliceOf('handleDecodeResult', 'startFrameLoop'),
    /elapsedSinceMs\(failStreakSince, handledAt\)/);
});
