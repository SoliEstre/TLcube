/** 기존 Y 런타임과 면별-H 평가가 공유하는 동일한 레이아웃 조립 규칙이에요. */
import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
} from '../cellSurfaceFinal.js';
import { maskValue } from '../mask.js';

export function buildYLayout(n, layoutId, eccName, maskIndex, formatWire) {
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId, formatWire);
  const capacity = capacityForCellSurfaceFinal(n, eccName, 2, layoutId, formatWire);
  const maskDigits = new Uint8Array(scan.length);
  for (let k = 0; k < scan.length; k += 1) {
    maskDigits[k] = maskValue(scan[k].i, scan[k].j, maskIndex);
  }
  return {
    layoutId,
    cellCount: scan.length,
    requiredSymbolCount: capacity.dataSymbols,
    nsym: capacity.nsym,
    maskDigits,
    maxPayloadBytes: capacity.dataBytes,
    payloadBytes: capacity.dataBytes,
    eccName,
    maskIndex,
    formatWire,
  };
}
