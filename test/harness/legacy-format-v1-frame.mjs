/**
 * legacy-format-v1-frame.mjs — **개정 전(포맷 v1 · 15셀) 셀 표면 프레임 합성기**.
 *
 * 왜 있나: 「레거시 판독 공존」(2026-08-16 통합자 결정 A)은 *이미 발행된* 프레임을
 * 신 디코더가 읽는다는 계약이다. 그 계약을 재려면 v1 프레임이 필요한데, 현행
 * 인코더는 v2 만 만든다(그리고 만들어서도 안 된다 — 생성 경로에 레거시 스위치를
 * 두면 실수로 구세대를 발행하게 된다). 그래서 **테스트 쪽에만** 합성기를 둔다.
 *
 * 이 파일은 개정 전 `encodeY.js` 의 `encodeYCellSurfaceFinal` 을 세 군데만 바꿔
 * 옮긴 것이다 — 세대(`formatWire = 1`) · 포맷 인코더(`encodeReplicated`, 5 digit) ·
 * 데이터 마스크 index 고정 0. 나머지 산술(base-211 · RS · 헤더 · 스캔 순서)은
 * **같은 모듈을 그대로 부른다** — 자를 복제하지 않는다.
 *
 * 동치 검증: 이 합성기의 `cellDigits` 는 개정 전 트리(`git archive 04fdff4`)의
 * `encodeY(...)` 산출과 **바이트 동일**함을 300 프레임 코퍼스에서 확인했다
 * (r2 픽스 라운드, `scratchpad/r2-legacy-harness-check.mjs`). 그 동치가 이 파일의
 * 유일한 정당성이므로, 여기를 고치면 그 대조를 다시 돌려야 한다.
 */

import { frame } from '../../src/header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from '../../src/base211.js';
import { rsEncode } from '../../src/rs211.js';
import { maskAdd, DEFAULT_MASK_INDEX } from '../../src/mask.js';
import { encodeReplicated, ECC_LEVEL } from '../../src/formatinfo.js';
import {
  REFERENCE_GROUP_DIGITS_2T,
  REFERENCE_GROUP_DIGITS_3T,
} from '../../src/placementY.js';
import {
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
  capacityForCellSurfaceFinal,
  cellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  fillerCellsCellSurfaceFinal,
  formatIndexCellSurfaceFinal,
  locatorCellsCellSurfaceFinal,
} from '../../src/cellSurfaceFinal.js';

const WIRE = CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY;
const cellKey = (i, j) => i + ',' + j;

/**
 * 레거시(포맷 v1) 셀 표면 프레임을 만든다. 반환 모양은 `encodeY` 와 같다.
 * @param {string} text
 * @param {{cellSurfaceLayout:string, n:number, tones?:number, eccLevel?:string}} options
 */
export function encodeLegacyFormatV1(text, options) {
  const { cellSurfaceLayout: layoutId, n } = options;
  const tones = options.tones === undefined ? 2 : options.tones;
  const eccLevel = options.eccLevel === undefined ? 'M' : options.eccLevel;

  const surface = cellSurfaceFinal(n, layoutId, WIRE);
  const capacity = capacityForCellSurfaceFinal(n, eccLevel, tones, layoutId, WIRE);
  const framed = frame(text, capacity.dataBytes);
  const symbols = bytesToSymbols(framed);
  if (symbols.length !== capacity.dataSymbols) {
    throw new RangeError('레거시 합성기 심볼 수 불일치: ' + symbols.length
      + ' !== ' + capacity.dataSymbols);
  }
  const codewordSymbols = rsEncode(symbols, capacity.nsym);
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols);

  const scanCells = dataCellsInScanOrderCellSurfaceFinal(n, layoutId, WIRE);
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.i, c.j, DEFAULT_MASK_INDEX);
  }

  const fillerCoords = fillerCellsCellSurfaceFinal(n, layoutId, WIRE);
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.i, c.j, DEFAULT_MASK_INDEX);
  }

  const formatIndex = formatIndexCellSurfaceFinal(tones);
  // 레거시 포맷 v1 — 5 digit × 3복제 = 15. 마스크 필드 자체가 없다.
  const formatDigits = encodeReplicated({
    version: formatIndex,
    eccLevel: ECC_LEVEL[eccLevel],
  }).flat();
  if (formatDigits.length !== 15 || surface.formatCells.length !== 15) {
    throw new Error('레거시 포맷 셀 수가 15 가 아니다');
  }

  const cellDigits = new Map();
  for (const c of locatorCellsCellSurfaceFinal(n, layoutId)) {
    cellDigits.set(cellKey(c.i, c.j), {
      digit: null, role: 'locator', tones: { T: c.T, L: c.L, R: c.R },
    });
  }
  const refDigits = tones === 3 ? REFERENCE_GROUP_DIGITS_3T : REFERENCE_GROUP_DIGITS_2T;
  for (let index = 0; index < surface.referenceCells.length; index += 1) {
    const c = surface.referenceCells[index];
    cellDigits.set(cellKey(c.i, c.j), { digit: refDigits[index % 3], role: 'reference' });
  }
  for (let i = 0; i < surface.formatCells.length; i += 1) {
    const c = surface.formatCells[i];
    cellDigits.set(cellKey(c.i, c.j), { digit: formatDigits[i], role: 'format' });
  }
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    cellDigits.set(cellKey(c.i, c.j), { digit: dataDigits[i], role: 'data' });
  }
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    cellDigits.set(cellKey(c.i, c.j), { digit: fillerDigits[i], role: 'filler' });
  }
  if (cellDigits.size !== n * n) {
    throw new Error('레거시 합성기 셀 맵 ' + cellDigits.size + ' !== ' + (n * n));
  }

  return {
    version: surface.version,
    n,
    eccLevel,
    tones,
    formatIndex,
    maskIndex: DEFAULT_MASK_INDEX,
    formatWireVersion: 1,
    window: false,
    cellSurface: true,
    cellSurfaceLayout: layoutId,
    locatorProfile: surface.profile,
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
