/**
 * QR 스캔 어시스트가 시간 문턱보다 먼저 낼 수 있는 안내를 결정한다.
 * 상태·DOM과 분리해 `모름`, 셀 하한, 잘림 우선순위를 성질로 잠근다.
 */

import { CELL_PX_FLOOR } from './scanner-zoom.js';

export function immediateCornerQrHint(result, options = {}) {
  const floor = options.cellPxFloor === undefined ? CELL_PX_FLOOR : options.cellPxFloor;
  if (!(floor > 0) || !Number.isFinite(floor)) return null;
  // 2면 이상 잘림은 기존 「조금 뒤로」 축이다. 작은 코드 안내와 동시에 내지 않는다.
  if (!result || result.clipSide === 'multi') return null;
  const assist = result.scanAssist;
  if (!assist || assist.ok !== true || !(assist.cellPx > 0)) return null;
  if (assist.cellPx >= floor) return null;
  return {
    messageKey: 'status.small',
    reason: 'cell-below-floor',
    cellPx: assist.cellPx,
    cellPxFloor: floor,
    center: assist.center,
    guide: assist.guide || null,
  };
}

/**
 * 복호 결과에서 화면에 보일 페이로드를 뽑는 **문**. 어느 경로(R1 단발 · R2 누적 · 파일)든
 * 여기를 지나야 결과 패널에 닿는다. 본체가 scanner.js 가 아니라 여기 있는 이유: 테스트가
 * R2 적중 객체를 이 함수에 **직접** 넣어 본다 — 2026-09-05 시험판(.04~.05.02)에서 R2 가
 * `{ text }` 로 넘겨 이 문에서 죽었고, 철자 자는 초록이었다 (PM/029B §24.9).
 */
export function normalizeDecodePayload(result) {
  if (!result || result.ok !== true || typeof result.payload !== 'string' || result.payload === '') {
    return null;
  }
  return result.payload;
}

/**
 * 스캔 범위 안내(«QR 및 다른 바코드는 읽히지 않아요»)의 문구 키. R2 누적이 켜져 있으면
 * 그 상태를 말하는 키로 바뀐다 (운영자 요구 ②, 2026-09-04). off · 모름은 정식 문구 그대로 —
 * 정식 경로(/)는 R2 가 항상 꺼져 있어 이 함수가 정식 문구 밖을 낼 수 없다.
 */
export function scanScopeCopyKey(r2Enabled) {
  return r2Enabled === true ? 'guide.scope.r2' : 'guide.tlcubeOnly';
}
