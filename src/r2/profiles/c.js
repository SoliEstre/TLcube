/**
 * Type C의 코드워드 표를 획득 시 바인딩한다. 영상 검출/표본 기능은 제공하지 않는다.
 * 표는 인코더와 같은 용량·예약·스캔·인터리브 정본에서 생성한다.
 */
import { VERSIONS_C, VERSIONS_C_DAEHAN, VERSIONS_C_Q, capacityForC } from '../../capacityC.js';
import { dataCellsInScanOrder } from '../../layout.js';
import { typeCReservedCells } from '../../notchC.js';
import { daehanReservedCells } from '../../finder-daehan.js';
import { rsBlockInterleaveMap, NSYM_TABLE_C } from '../../rs211.js';
import { DIGITS_PER_SYMBOL } from '../../base211.js';
import { DEFAULT_MASK_INDEX, maskValue } from '../../mask.js';
import { FACE_COUNT, FACES } from '../../lehmer.js';
import { createR2CandidateKey } from '../candidate-key.js';

const SPECS = Object.freeze([...VERSIONS_C, ...VERSIONS_C_DAEHAN, ...VERSIONS_C_Q]);
const EMPTY_DIMENSIONS = Object.freeze([]);
const DIMENSIONS = new Map(SPECS.map((spec) => [spec.name, Object.freeze([spec.k])]));

// 현행 Type C는 5-digit formatinfo v1 + 기본 마스크다. 새 와이어를 발행하지 않는다.
export const TYPE_C_FORMAT_WIRE = 1;
// 현행 C 와이어는 서로 다른 3개 휘도 순위를 쓴다. C 행에는 톤 변형 축이 없다.
// 면 개수와는 다른 속성이다(Y의 2톤 행도 면은 3개이므로 FACE_COUNT로 유도하지 않는다).
export const TYPE_C_DATA_TONES = 3;

function noteBind(diagnostics, status, reason = '') {
  // 진단 수신기는 선택 사항이다. 동결 객체나 setter도 bind의 예외 0 계약을 깨지 않는다.
  try {
    if (diagnostics && typeof diagnostics === 'object') {
      diagnostics.status = status;
      diagnostics.reason = reason;
    }
  } catch { /* 진단 기록 실패는 바인딩 결과를 바꾸지 않는다. */ }
}

function bind(context, diagnostics) {
  let spec, key;
  noteBind(diagnostics, 'UNSUPPORTED', '지원하지 않거나 불완전한 C 바인딩 문맥');
  try {
    if (context === null || typeof context !== 'object'
      || context.wire !== TYPE_C_FORMAT_WIRE
      || context.tones !== TYPE_C_DATA_TONES
      || context.maskIndex !== DEFAULT_MASK_INDEX) return null;
    spec = SPECS.find((entry) => entry.name === context.layoutId && entry.k === context.dimension);
    if (spec === undefined) return null;
    key = createR2CandidateKey({ ...context, profile: 'C', dimensionKind: 'radius-k' });
    if (key === null) return null;
  } catch {
    return null;
  }
  // 외부 문맥 검사와 정본 표 접근을 분리한다. ECC 미지원은 null이지만 표 부재는 고장이다.
  try {
    const row = NSYM_TABLE_C[spec.symbolKey];
    if (row === null || typeof row !== 'object') {
      throw new Error(`NSYM_TABLE_C 에 키 ${spec.symbolKey} 가 없다`);
    }
    const levels = row.blocks;
    if (levels === null || typeof levels !== 'object') {
      throw new Error(`NSYM_TABLE_C.${spec.symbolKey}.blocks 가 없다`);
    }
    if (!Object.hasOwn(levels, key.ecc)) return null;
    const capacity = capacityForC(spec, key.ecc);
    const reserved = typeCReservedCells(spec.k, spec.daehanFinder ? daehanReservedCells(spec.k) : undefined);
    const scan = dataCellsInScanOrder(spec.k, reserved);
    const symbolCount = capacity.usedSymbols;
    const cellCount = symbolCount * DIGITS_PER_SYMBOL;
    if (scan.length !== capacity.dataCells || cellCount > scan.length) {
      throw new Error('C 스캔 셀 수와 정본 용량 회계가 다르다');
    }
    const cellCoord = new Int32Array(cellCount * 2);
    const maskDigit = new Uint8Array(cellCount);
    for (let i = 0; i < cellCount; i += 1) {
      cellCoord[2 * i] = scan[i].q;
      cellCoord[2 * i + 1] = scan[i].r;
      maskDigit[i] = maskValue(scan[i].q, scan[i].r, key.maskIndex);
    }
    const blocks = Object.freeze(capacity.rsDataSymbolsPerBlock.map((dataSymbols, block) => Object.freeze({
      block, dataSymbols, nsym: capacity.rsParitySymbolsPerBlock,
      symbolCount: dataSymbols + capacity.rsParitySymbolsPerBlock,
    })));
    const map = rsBlockInterleaveMap(capacity.rsBlockConfig);
    if (map.length !== symbolCount) throw new Error('C 인터리브 맵과 정본 심볼 수가 다르다');
    const symbolToBlock = new Int32Array(symbolCount * 2);
    const blockToSymbol = blocks.map((block) => new Int32Array(block.symbolCount));
    const workOffsets = new Int32Array(blocks.length);
    let workOffset = 0;
    for (let b = 0; b < blocks.length; b += 1) {
      workOffsets[b] = workOffset;
      workOffset += blocks[b].symbolCount;
    }
    for (let g = 0; g < map.length; g += 1) {
      const { blockIndex, codewordIndex } = map[g];
      symbolToBlock[2 * g] = blockIndex;
      symbolToBlock[2 * g + 1] = codewordIndex;
      blockToSymbol[blockIndex][codewordIndex] = g;
    }
    const bound = Object.freeze({
      key, layoutId: spec.name, dimensionKind: 'radius-k', dimension: spec.k,
      cellCount, cellCoord, facesPerCell: FACE_COUNT, faceLabels: FACES,
      cellsPerSymbol: DIGITS_PER_SYMBOL, symbolCount, blocks,
      symbolToBlock, blockToSymbol: Object.freeze(blockToSymbol), workOffsets, maskDigit,
      dataBytes: capacity.dataBytes, requiredSymbolCount: capacity.dataSymbols,
      framed: true, messageOrder: 'block-concat',
      // 기존 세션/복호 소켓에 직접 주입하기 위한 같은 버퍼/값의 별칭이다.
      payloadBytes: capacity.dataBytes, maxPayloadBytes: capacity.dataBytes,
      maskDigits: maskDigit, nsym: capacity.nsym,
      formatIndex: spec.formatIndex, residualCells: capacity.residualCells,
    });
    noteBind(diagnostics, 'OK');
    return bound;
  } catch (error) {
    noteBind(diagnostics, 'DERIVATION_ERROR', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export const R2_TYPE_C_PROFILE = Object.freeze({
  id: 'C', dimensionKind: 'radius-k',
  layoutIds: Object.freeze(SPECS.map((spec) => spec.name)),
  dimensionsOf(layoutId) { return DIMENSIONS.get(layoutId) ?? EMPTY_DIMENSIONS; },
  capabilities: Object.freeze({ bind: true, detector: false, readFormat: false, sampler: false }),
  bind,
});
