/**
 * corrections.js — **RS 가 고친 코드워드 위치 → 스캔 순서 셀 인덱스** (순수 · 할당 없음).
 *
 * `rs-soft.js` 의 `correctedPositions` 는 **코드워드 심볼 위치** p 다 (0..symbolCount-1,
 * 데이터·패리티 연속). HUD 는 셀을 그리므로 그 사이를 옮기는 함수가 하나 필요하다.
 *
 * ## 매핑의 근거 (7f360ef 기준 · 「가설」이 아니라 소스 두 방향에서 확인한 것)
 *   · 인코더 `src/encodeY.js:635~651` — `rsEncode(symbols, nsym)` 로 만든 코드워드를
 *     `unpackSymbolsToCellDigits(codewordSymbols)` 로 펴고(`src/base211.js:134~152`:
 *     심볼 i → digit 3i·3i+1·3i+2, MSD-first), 그 digit 배열을 **인덱스 그대로**
 *     `dataCellsInScanOrderCellSurfaceFinal(n, layoutId)` 의 앞부분에 얹는다
 *     (`dataCellCoords = scanCells.slice(0, preMaskDataDigits.length)`).
 *     즉 **인터리빙도 블록 분할도 없다** — 심볼 p 는 스캔 셀 3p·3p+1·3p+2 다.
 *   · 디코더 `src/r2/accumulate.js:208~216` — `materializeSymbolsInto` 가 심볼 s 를
 *     같은 세 칸에서 만든다 (`layout.symbolCells` 가 있으면 그 표를 따르고, 없으면
 *     연속 3칸). 세션의 셀맵 칠하기도 같은 식이다 (`src/r2/session.js:585~592`).
 *
 * 그래서 이 파일은 그 **한 규칙**을 한 곳에 적어 두고, 소거 셀맵과 정정 강조가
 * 같은 식을 쓰게 한다. 3 은 손 상수가 아니라 `base211.DIGITS_PER_SYMBOL` 이다.
 *
 * 예외를 내지 않는다 — 잘못된 입력은 -1 (호출자가 «못 그린다» 로 읽는다).
 *
 * @module r2/corrections
 */
import { DIGITS_PER_SYMBOL } from '../base211.js';

/** RS 심볼 하나가 차지하는 셀 수. 정본은 `base211.js` 다 (여기서 다시 세지 않는다). */
export const R2_CELLS_PER_SYMBOL = DIGITS_PER_SYMBOL;

function isIndexable(value) {
  return value !== null
    && value !== undefined
    && Number.isInteger(value.length)
    && value.length >= 0;
}

/**
 * 「이 레이아웃에 심볼이 몇 개인가」. 숫자를 주면 그대로, 레이아웃 객체를 주면
 * `symbolCells` → 없으면 `cellCount` 에서 **유도**한다 (session.js 의 `symbolCount` 와 같은 식).
 * 모르면 0.
 */
export function symbolCountOf(layoutOrSymbolCount) {
  const source = layoutOrSymbolCount;
  if (typeof source === 'number') {
    return Number.isInteger(source) && source > 0 ? source : 0;
  }
  if (source === null || typeof source !== 'object') return 0;
  if (isIndexable(source.symbolCells)) {
    return Math.floor(source.symbolCells.length / R2_CELLS_PER_SYMBOL);
  }
  const cellCount = Number(source.cellCount);
  if (!Number.isInteger(cellCount) || cellCount <= 0) return 0;
  return Math.floor(cellCount / R2_CELLS_PER_SYMBOL);
}

/**
 * 정정된 코드워드 위치들 → **스캔 순서 셀 인덱스**를 `out` 에 쓴다.
 *
 * 위치 하나가 셀 `R2_CELLS_PER_SYMBOL` 개를 낳는다 — 데이터든 패리티든 셀에 실려 있으므로
 * 구분하지 않는다 (패리티 심볼도 사용자가 「저기가 틀렸다」로 봐야 하는 자리다).
 *
 * @param {ArrayLike<number>} positions `rs-soft` 의 correctedPositions (앞 count 개만 유효)
 * @param {number} count 유효한 위치 수
 * @param {number|object} layoutOrSymbolCount 심볼 수, 또는 세션 레이아웃(`symbolCells`·`cellCount`)
 * @param {ArrayLike<number>} out 길이 >= count * R2_CELLS_PER_SYMBOL 인 caller-owned 버퍼
 * @returns {number} 쓴 셀 개수. 입력이 잘못됐으면 **-1** (예외 없음).
 */
export function correctedCellsFromPositions(positions, count, layoutOrSymbolCount, out) {
  if (!isIndexable(positions) || !isIndexable(out)) return -1;
  if (!Number.isInteger(count) || count < 0) return -1;
  if (count > positions.length) return -1;
  const symbolCount = symbolCountOf(layoutOrSymbolCount);
  if (symbolCount <= 0) return -1;
  const need = count * R2_CELLS_PER_SYMBOL;
  if (out.length < need) return -1;

  const symbolCells = (layoutOrSymbolCount !== null
    && typeof layoutOrSymbolCount === 'object'
    && isIndexable(layoutOrSymbolCount.symbolCells))
    ? layoutOrSymbolCount.symbolCells
    : null;
  if (symbolCells !== null && symbolCells.length < symbolCount * R2_CELLS_PER_SYMBOL) return -1;

  /*
   * 셀 인덱스의 상한. 기본은 «심볼이 차지하는 칸» 이고(인코더는 스캔 순서 앞부분에만
   * digit 을 얹는다 — 꼬리는 필러다), `symbolCells` 표가 있으면 그 표는 레이아웃 전체를
   * 가리킬 수 있으므로 선언된 `cellCount` 를 쓴다.
   */
  const declaredCells = (layoutOrSymbolCount !== null && typeof layoutOrSymbolCount === 'object')
    ? Number(layoutOrSymbolCount.cellCount)
    : NaN;
  const cellCount = (symbolCells !== null && Number.isInteger(declaredCells) && declaredCells > 0)
    ? declaredCells
    : symbolCount * R2_CELLS_PER_SYMBOL;
  let written = 0;
  for (let index = 0; index < count; index += 1) {
    const position = positions[index];
    if (!Number.isInteger(position) || position < 0 || position >= symbolCount) return -1;
    const base = position * R2_CELLS_PER_SYMBOL;
    for (let offset = 0; offset < R2_CELLS_PER_SYMBOL; offset += 1) {
      const cell = symbolCells === null ? base + offset : symbolCells[base + offset];
      // 표가 범위 밖을 가리키면 **그 자리만** 버리지 않고 통째로 거절한다 —
      // 반쪽 강조는 「어느 셀이 틀렸나」에 거짓말을 한다.
      if (!Number.isInteger(cell) || cell < 0 || cell >= cellCount) return -1;
      out[written] = cell;
      written += 1;
    }
  }
  return written;
}

/** 「그릴 셀이 없다」의 표현. 매번 새 배열을 만들지 않게 모듈이 하나 들고 있는다. */
const NO_CELLS = new Uint16Array(0);

/**
 * 🔴 **DONE 적중의 정정 셀** — 세션 결과 → `{count, cells}` (3b 검토 F4).
 *
 * 런타임의 DONE 접착부를 자가 값으로 지날 수 있게 순수 함수로 뺀 것이다. 이전에는 이 논리가
 * `r2-scan-runtime.js` 의 DONE 분기 안에만 있었고, 코퍼스의 DONE 이 전부 `correctedCount 0` 이라
 * **한 번도 안 타는 분기**였다 (스크래치 성장 · 뷰 자르기 · 매핑 실패가 전부 무자였다).
 *
 * `holder` 는 caller-owned 다: `scratch` 는 **필요할 때만 자라고**(줄지 않는다 — 재bind 마다 다시
 * 잡으면 그것도 할당이다), `cells` 는 그 스크래치의 **뷰**라 다음 호출까지만 유효하다.
 *
 * 매핑이 거절되면(`-1`) `count` 는 그대로 두고 `cells` 만 비운다 — **수는 맞고 자리는 모른다**가
 * 참이기 때문이다. 반쪽 강조는 「어느 셀이 틀렸나」에 거짓말을 한다.
 *
 * @param {{correctedCount?:number, correctedPositions?:ArrayLike<number>}} result 세션 결과
 * @param {number|object} layoutOrSymbolCount 세션 레이아웃(`cellCount`·`symbolCells`) 또는 심볼 수
 * @param {{scratch:Uint16Array, count:number, cells:ArrayLike<number>}} holder caller-owned 보관함
 * @returns {number} 채운 셀 수 (0 이면 그릴 게 없다). 예외 없음.
 */
export function correctedCellsForHit(result, layoutOrSymbolCount, holder) {
  if (holder === null || typeof holder !== 'object') return 0;
  holder.count = 0;
  holder.cells = NO_CELLS;
  if (result === null || typeof result !== 'object') return 0;
  const count = Number.isInteger(result.correctedCount) && result.correctedCount > 0
    ? result.correctedCount
    : 0;
  if (count === 0) return 0;
  holder.count = count;
  const need = count * R2_CELLS_PER_SYMBOL;
  if (!(holder.scratch instanceof Uint16Array) || holder.scratch.length < need) {
    holder.scratch = new Uint16Array(need);
  }
  const written = correctedCellsFromPositions(
    result.correctedPositions,
    count,
    layoutOrSymbolCount,
    holder.scratch,
  );
  if (written <= 0) return 0;
  holder.cells = holder.scratch.subarray(0, written);
  return written;
}
