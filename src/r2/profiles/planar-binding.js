/** 평면 타입의 단일 RS 블록 바인딩 공통부. 영상 관측 기능은 의도적으로 없다. */
import { DIGITS_PER_SYMBOL } from '../../base211.js';
import { DEFAULT_MASK_INDEX, maskValue } from '../../mask.js';
import { FACE_COUNT, FACES } from '../../lehmer.js';
import { ECC_NAME_BY_VALUE } from '../../formatinfo.js';
import { createR2CandidateKey } from '../candidate-key.js';

export const PLANAR_FORMAT_WIRE = 1;
export const PLANAR_DATA_TONES = 3;
const SUPPORTED_ECC = Object.freeze(Object.values(ECC_NAME_BY_VALUE));
const EMPTY_DIMENSIONS = Object.freeze([]);

function note(diagnostics, status, reason = '') {
  try {
    if (diagnostics && typeof diagnostics === 'object') {
      diagnostics.status = status;
      diagnostics.reason = reason;
    }
  } catch { /* caller-owned 진단 기록은 바인딩을 막지 않는다. */ }
}

/**
 * 각 variant는 인코더 정본의 spec/용량 함수/scan 함수만 공급한다.
 * 평면 O/A/V/K는 rsEncode 단일 코드워드 경로이므로 wire 순서는 곧 블록 내 순서다.
 */
export function createPlanarProfile(id, variants) {
  const frozen = Object.freeze(variants.map((variant) => Object.freeze(variant)));
  const dimensions = new Map(frozen.map((variant) => [variant.layoutId, Object.freeze([variant.spec.k])]));
  function bind(context, diagnostics) {
    note(diagnostics, 'UNSUPPORTED', `지원하지 않거나 불완전한 ${id} 바인딩 문맥`);
    let variant, key;
    try {
      if (context === null || typeof context !== 'object'
        || context.wire !== PLANAR_FORMAT_WIRE
        || context.tones !== PLANAR_DATA_TONES
        || context.maskIndex !== DEFAULT_MASK_INDEX) return null;
      variant = frozen.find((entry) => entry.layoutId === context.layoutId
        && entry.spec.k === context.dimension);
      if (!variant) return null;
      key = createR2CandidateKey({ ...context, profile: id, dimensionKind: 'radius-k' });
      if (!key) return null;
      if (!SUPPORTED_ECC.includes(key.ecc)) return null;
    } catch { return null; }
    try {
      const capacity = variant.capacity(variant.spec, key.ecc);
      const scan = variant.scan(variant.spec.k);
      const symbolCount = capacity.usedSymbols;
      const cellCount = symbolCount * DIGITS_PER_SYMBOL;
      if (scan.length !== capacity.dataCells || cellCount > scan.length) {
        throw new Error(`${id} 스캔 셀 수와 정본 용량 회계가 다르다`);
      }
      if (!Number.isInteger(capacity.nsym) || capacity.nsym <= 0
        || !Number.isInteger(capacity.dataSymbols) || capacity.dataSymbols <= 0
        || capacity.dataSymbols + capacity.nsym !== symbolCount) {
        throw new Error(`${id} 단일 RS 블록 회계가 정본 용량과 다르다`);
      }
      const cellCoord = new Int32Array(cellCount * 2);
      const maskDigit = new Uint8Array(cellCount);
      for (let i = 0; i < cellCount; i += 1) {
        const cell = scan[i];
        cellCoord[2 * i] = cell.q;
        cellCoord[2 * i + 1] = cell.r;
        // V는 인코더가 canonical A 좌표에서 마스크한 뒤 장면만 180° 회전한다.
        // cellCoord는 관측 좌표, maskCell은 인코더 좌표다. 나머지는 항등이다.
        const maskCell = variant.maskCell ? variant.maskCell(cell) : cell;
        maskDigit[i] = maskValue(maskCell.q, maskCell.r, key.maskIndex);
      }
      const block = Object.freeze({ block: 0, dataSymbols: capacity.dataSymbols,
        nsym: capacity.nsym, symbolCount });
      const symbolToBlock = new Int32Array(symbolCount * 2);
      const blockToSymbol = new Int32Array(symbolCount);
      for (let g = 0; g < symbolCount; g += 1) {
        symbolToBlock[2 * g] = 0;
        symbolToBlock[2 * g + 1] = g;
        blockToSymbol[g] = g;
      }
      const bound = Object.freeze({
        key, layoutId: variant.layoutId, dimensionKind: 'radius-k', dimension: variant.spec.k,
        cellCount, cellCoord, facesPerCell: FACE_COUNT, faceLabels: FACES,
        cellsPerSymbol: DIGITS_PER_SYMBOL, symbolCount, blocks: Object.freeze([block]),
        symbolToBlock, blockToSymbol: Object.freeze([blockToSymbol]), workOffsets: new Int32Array([0]), maskDigit,
        dataBytes: capacity.dataBytes, requiredSymbolCount: capacity.dataSymbols,
        framed: true, messageOrder: 'block-concat', payloadBytes: capacity.dataBytes,
        maxPayloadBytes: capacity.dataBytes, maskDigits: maskDigit, nsym: capacity.nsym,
        formatIndex: variant.formatIndex, residualCells: capacity.residualCells,
      });
      note(diagnostics, 'OK');
      return bound;
    } catch (error) {
      note(diagnostics, 'DERIVATION_ERROR', error instanceof Error ? error.message : String(error));
      return null;
    }
  }
  return Object.freeze({
    id, dimensionKind: 'radius-k', layoutIds: Object.freeze(frozen.map((entry) => entry.layoutId)),
    formatEntries: Object.freeze(frozen.map((entry) => Object.freeze({
      layoutId: entry.layoutId, dimension: entry.spec.k, formatIndex: entry.formatIndex, version: entry.spec.version,
    }))),
    dimensionsOf(layoutId) { return dimensions.get(layoutId) ?? EMPTY_DIMENSIONS; },
    capabilities: Object.freeze({ bind: true, detector: false, readFormat: false, sampler: false }), bind,
  });
}
