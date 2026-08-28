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
