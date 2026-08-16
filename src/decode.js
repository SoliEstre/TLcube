// decode.js — Type O/A/Y 후단 디코더 (SPEC §7.2)
//
// 이 모듈의 입력 경계는 "셀별 3면 순위 → digit"이 끝난 직후다. 따라서 Lehmer
// 순위 해석과 포맷 정보 3중 복제 판독은 앞단의 책임이며, 여기서는 이미 확정된
// scan-order digit 및 패밀리가 해석된 format만 받는다.
//
// 역순서는 encode*.js와 정확히 짝을 이룬다:
//
//   masked cell digit → maskSub → 3 digit/GF(211) symbol → RS decode
//   → base-211 chunk decode → header unframe → UTF-8 text
//
// Type Y의 QR-window 변형만은 encodeY.js 안의 로컬 scan 함수가 공개되지 않았다.
// 같은 공개 좌표 계약(capacityY.js의 windowed *CellsY)에서 동일한 래스터 순서를
// 여기서 재구성한다. 나머지 타입은 각 layout 모듈의 canonical scan 함수를 쓴다.

import { VERSIONS, capacityFor } from './capacity.js';
import { VERSIONS_A, capacityForA } from './capacityA.js';
import {
  VERSIONS_Y,
  capacityForY,
  capacityForY2Window,
  windowedReferenceCellsY,
  windowedFormatCellsY,
  windowExcludedCellsY,
} from './capacityY.js';
import {
  capacityForCellSurfaceY,
  dataCellsInScanOrderCellSurface,
  isCellSurfaceFormatIndex,
  tonesFromCellSurfaceFormatIndex,
} from './cellSurfaceY.js';
import {
  CELL_SURFACE_LAYOUT_V1R2,
  capacityForCellSurfaceLayout,
  dataCellsInScanOrderCellSurfaceLayout,
  isCellSurfaceLayoutFormatIndex,
  layoutIdFromFormatIndex,
  tonesFromCellSurfaceLayoutFormatIndex,
} from './cellSurfaceLayouts.js';
import {
  assertCellSurfaceFinalN,
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdForN,
  isCellSurfaceFinalFormatIndex,
  isCellSurfaceFinalId,
  tonesFromCellSurfaceFinalFormatIndex,
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
} from './cellSurfaceFinal.js';
import {
  CHUNK_BYTES,
  decodeChunkInto,
  packCellDigitsToSymbols,
  symbolCountForByteLength,
} from './base211.js';
import { rsDecode } from './rs211.js';
import { maskSub, DEFAULT_MASK_INDEX, assertMaskIndex } from './mask.js';
import { unframe } from './header.js';
import {
  VERSIONS_OCM,
  capacityForOMarker,
  dataCellsInScanOrderOMarker,
} from './markerO.js';
import {
  VERSIONS_ACM,
  capacityForAMarker,
  dataCellsInScanOrderAMarker,
} from './markerA.js';
import { dataCellsInScanOrder as dataCellsInScanOrderO } from './layout.js';
import { dataCellsInScanOrderA } from './layoutA.js';
import { dataCellsInScanOrder as dataCellsInScanOrderY } from './layoutY.js';

/**
 * 기본 소거 모드. rs211.js가 소거 위치 목록을 받는 복호 경로를 갖게 되면서
 * 불법 3-digit 조합과 "프레임 밖이라 표본이 없는 셀"은 **위치를 아는 소거**로
 * 넘긴다. 한계가 2v ≤ nsym에서 2v + s ≤ nsym으로 넓어진다.
 */
export const RS211_ERASURE_MODE = 'erasure';

/**
 * 옵트아웃 모드. rs211.js 소거 지원 이전의 동작 — 불법 심볼을 0으로 치환해
 * "위치를 모르는 일반 오류"로만 취급한다. 회귀 비교용으로만 남긴다.
 */
export const RS211_ERASURE_MODE_LEGACY = 'error-only-fallback';

const ILLEGAL_SYMBOL_PLACEHOLDER = 0;
const ECC_LEVEL_BY_VALUE = Object.freeze({ 0: 'L', 1: 'M', 2: 'H' });

function fail(stage, cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { ok: false, reason: stage + ': ' + detail };
}

function normalizeEccLevel(value) {
  if (value === 'L' || value === 'M' || value === 'H') return value;
  if (Number.isInteger(value) && ECC_LEVEL_BY_VALUE[value] !== undefined) {
    return ECC_LEVEL_BY_VALUE[value];
  }
  throw new RangeError('eccLevel은 L, M, H 또는 formatinfo.js의 값 0, 1, 2여야 한다: ' + value);
}

function assertOptionalDimension(value, name, expected) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value !== expected) {
    throw new RangeError(name + '가 선택한 버전의 격자 크기와 다르다: ' + value + ' !== ' + expected);
  }
}

function yKey(i, j) {
  return i + ',' + j;
}

/**
 * encodeY.js의 windowedDataCellsInScanOrder와 같은 규약이다. 그 함수는 의도적으로
 * encodeY.js의 로컬 구현이므로, 여기서는 공개된 재배치/제외 좌표만 조합한다.
 */
function windowedDataCellsInScanOrderY(n, tones) {
  const references = new Set(
    windowedReferenceCellsY(n, tones).map((cell) => yKey(cell.i, cell.j)),
  );
  const formats = new Set(windowedFormatCellsY(n).map((cell) => yKey(cell.i, cell.j)));
  const excluded = new Set(windowExcludedCellsY(n).map((cell) => yKey(cell.i, cell.j)));
  const out = [];

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const key = yKey(i, j);
      if (references.has(key) || formats.has(key) || excluded.has(key)) continue;
      out.push({ i, j });
    }
  }
  return out;
}

function finishProfile(profile) {
  const symbolDigits = profile.capacity.usedSymbols * 3;
  if (profile.scan.length !== profile.capacity.dataCells) {
    throw new Error(
      'scan order 셀 수 불일치: ' + profile.scan.length
      + ' !== capacity.dataCells ' + profile.capacity.dataCells,
    );
  }
  if (symbolDigits + profile.capacity.residualCells !== profile.scan.length) {
    throw new Error(
      '심볼 digit/필러 회계 불일치: ' + symbolDigits + ' + '
      + profile.capacity.residualCells + ' !== ' + profile.scan.length,
    );
  }
  const expectedDataSymbols = symbolCountForByteLength(profile.capacity.dataBytes);
  if (expectedDataSymbols !== profile.capacity.dataSymbols) {
    throw new Error(
      'base-211 data 심볼 수 불일치: ' + expectedDataSymbols
      + ' !== capacity.dataSymbols ' + profile.capacity.dataSymbols
      + ' — 이 포맷은 현행 인코더가 생성할 수 없다',
    );
  }
  return { ...profile, symbolDigits, maskIndex: profile.maskIndex ?? DEFAULT_MASK_INDEX };
}

/**
 * 포맷 정보의 version은 패밀리 안에서 두 해석이 가능하다. 논리 버전은 encode 계열의
 * version이고, raw format-index는 formatinfo.decode가 돌려주는 값이다. formatIndex를
 * 명시하면 항상 raw로 읽고, version만 주면 k/n 및 tones로 후보를 좁힌 뒤 논리 버전
 * 호환성을 우선한다. 그래서 앞단의 formatinfo 결과를 k/n과 함께 바로 넘길 수 있다.
 */
function uniqueSpecs(specs) {
  const out = [];
  for (const spec of specs) {
    if (spec && !out.includes(spec)) out.push(spec);
  }
  return out;
}

function selectVersionSpec(options) {
  const {
    type,
    logicalSpec,
    rawSpec,
    rawExplicit,
    dimension,
    dimensionName,
    requestedDimension,
    requestedTones,
  } = options;
  let candidates = uniqueSpecs(rawExplicit ? [rawSpec] : [rawSpec, logicalSpec]);

  if (requestedDimension !== undefined) {
    if (!Number.isInteger(requestedDimension)) {
      throw new RangeError(dimensionName + '은 정수여야 한다: ' + requestedDimension);
    }
    candidates = candidates.filter((spec) => spec[dimension] === requestedDimension);
  }
  if (requestedTones !== undefined) {
    candidates = candidates.filter((spec) => spec.tones === requestedTones);
  }
  if (candidates.length === 0) {
    throw new RangeError(
      '알 수 없거나 격자 크기와 맞지 않는 Type ' + type + ' version/formatIndex: '
      + (rawExplicit ? options.formatIndex : options.version),
    );
  }

  // format.version만 쓰던 호출자는 현재 logical version 의미를 유지한다. k/n 또는
  // formatIndex가 있으면 raw format-info 해석이 먼저 유일해지므로 그 경로가 선택된다.
  if (!rawExplicit && logicalSpec && candidates.includes(logicalSpec)) return logicalSpec;
  return candidates[0];
}

function typeOSpecFromFormatIndex(index) {
  if (!Number.isInteger(index)) return undefined;
  let version;
  if (index >= 0 && index <= 2) version = index + 1;
  else if (index >= 4 && index <= 6) version = index - 3;
  else return undefined;
  return VERSIONS.find((spec) => spec.version === version);
}

function typeASpecFromFormatIndex(index) {
  if (!Number.isInteger(index)) return undefined;
  return VERSIONS_A.find(
    (spec) => spec.formatIndex === index || spec.formatIndex + 2 === index,
  );
}

function typeYSpecFromFormatIndex(index) {
  if (!Number.isInteger(index)) return undefined;
  return VERSIONS_Y.find((spec) => spec.formatIndex === index);
}

function rawFormatIndex(format) {
  return format.formatIndex === undefined ? format.version : format.formatIndex;
}

function resolveProfile(format) {
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    throw new TypeError('format은 객체여야 한다');
  }

  const type = format.type === undefined ? 'O' : format.type;
  const eccLevel = normalizeEccLevel(format.eccLevel);
  const rawExplicit = format.formatIndex !== undefined;
  const formatIndex = rawFormatIndex(format);

  if (type === 'O' && format.cornerMarker === true) {
    // O-CM (코너 마커) — formatIndex 는 레거시 O 와 같고(markerO.js §4: Y2W 와 같은
    // «광학 검출 + 사후 RS/CRC» 계약), 갈리는 것은 회계와 scan order 뿐이다.
    const spec = VERSIONS_OCM.find((entry) => entry.version === format.version);
    if (!spec) {
      throw new RangeError(
        'O-CM 버전을 모른다: ' + format.version
        + ' (허용 ' + VERSIONS_OCM.map((v) => v.version).join(', ') + ')',
      );
    }
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForOMarker(spec, eccLevel),
      scan: dataCellsInScanOrderOMarker(spec.k),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'O') {
    const logicalSpec = VERSIONS.find((entry) => entry.version === format.version);
    const spec = selectVersionSpec({
      type,
      logicalSpec,
      rawSpec: typeOSpecFromFormatIndex(formatIndex),
      rawExplicit,
      dimension: 'k',
      dimensionName: 'k',
      requestedDimension: format.k,
      version: format.version,
      formatIndex,
    });
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityFor(spec, eccLevel),
      scan: dataCellsInScanOrderO(spec.k),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'A' && format.cornerMarker === true) {
    // A-CM (코너 마커) — O-CM 과 같은 계약: formatIndex 는 레거시 A 와 같고
    // 회계·scan order 만 갈린다 (markerA.js 헤더 참조).
    const spec = VERSIONS_ACM.find((entry) => entry.version === format.version);
    if (!spec) {
      throw new RangeError(
        'A-CM 버전을 모른다: ' + format.version
        + ' (허용 ' + VERSIONS_ACM.map((v) => v.version).join(', ') + ')',
      );
    }
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForAMarker(spec, eccLevel),
      scan: dataCellsInScanOrderAMarker(spec.k),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'A') {
    const logicalSpec = VERSIONS_A.find((entry) => entry.version === format.version);
    const spec = selectVersionSpec({
      type,
      logicalSpec,
      rawSpec: typeASpecFromFormatIndex(formatIndex),
      rawExplicit,
      dimension: 'k',
      dimensionName: 'k',
      requestedDimension: format.k,
      version: format.version,
      formatIndex,
    });
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForA(spec, eccLevel),
      scan: dataCellsInScanOrderA(spec.k),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'Y') {
    const suppliedTones = format.tones;
    if (suppliedTones !== undefined && suppliedTones !== 2 && suppliedTones !== 3) {
      throw new RangeError('Type Y tones는 2 또는 3이어야 한다: ' + suppliedTones);
    }
    const logicalSpec = VERSIONS_Y.find(
      (entry) => entry.version === format.version && entry.tones === (suppliedTones === undefined ? 2 : suppliedTones),
    );
    if (format.n !== undefined && format.k !== undefined && format.n !== format.k) {
      throw new RangeError('Type Y n과 k가 다르다: ' + format.n + ' !== ' + format.k);
    }
    const requestedN = format.n === undefined ? format.k : format.n;
    const window = format.window === undefined ? false : format.window;
    if (typeof window !== 'boolean') {
      throw new TypeError('Type Y format.window은 boolean이어야 한다: ' + window);
    }

    // 최종 라인업 (cellSurfaceFinal.js, v0 · v2r2) — formatIndex 는 한 쌍(1/3)뿐이고
    // 레이아웃은 n 으로 정해진다. 디코더 앞단(bootstrap)은 항상 n 을 싣는다.
    // 프로파일 힌트는 **와이어가 초안 슬롯(4/5/6/7)을 말하지 않을 때만** 쓴다 —
    // 'cell-surface-v1r2' 는 최종 v1r2 와 소각된 초안 v1r2d 가 함께 쓰는 문자열이라,
    // formatIndex 가 초안이면 초안 경로로 내려보내야 한다.
    const draftIndexWire = format.formatIndex !== undefined
      && isCellSurfaceLayoutFormatIndex(format.formatIndex);
    const profileHintId = format.locatorProfile === 'cell-surface-v0'
      ? 'v0'
      : format.locatorProfile === 'cell-surface-v2r2'
        ? 'v2r2'
        : format.locatorProfile === 'cell-surface-v1r2'
          ? 'v1r2'
          // 'cell-surface-v0x' · 'cell-surface-v0xq' 는 초안 슬롯이 없어
          // draftIndexWire 충돌이 없다.
          : format.locatorProfile === 'cell-surface-v0x'
            ? 'v0x'
            : format.locatorProfile === 'cell-surface-v0xq'
              ? 'v0xq'
              : null;
    const finalIdHint = isCellSurfaceFinalId(format.cellSurfaceLayout)
      ? format.cellSurfaceLayout
      : (profileHintId !== null && !draftIndexWire ? profileHintId : null);
    const finalRequested = finalIdHint !== null
      || (format.formatIndex !== undefined && isCellSurfaceFinalFormatIndex(format.formatIndex));
    if (finalRequested) {
      if (window) {
        throw new RangeError('Type Y cellSurface와 window를 함께 쓸 수 없다');
      }
      let finalTones = suppliedTones;
      if (format.formatIndex !== undefined) {
        if (!isCellSurfaceFinalFormatIndex(format.formatIndex)) {
          throw new RangeError('신세대 셀 표면 formatIndex 가 아니다: ' + format.formatIndex);
        }
        const fromIndex = tonesFromCellSurfaceFinalFormatIndex(format.formatIndex);
        if (finalTones !== undefined && finalTones !== fromIndex) {
          throw new RangeError(
            '신세대 셀 표면 tones=' + finalTones
            + ' 와 formatIndex=' + format.formatIndex + ' 가 어긋난다',
          );
        }
        finalTones = fromIndex;
      } else {
        finalTones = finalTones === undefined ? 2 : finalTones;
      }
      let finalN = requestedN;
      if (finalN === undefined) {
        if (finalIdHint === 'v0') finalN = 13;
        else if (finalIdHint === 'v1r2' || finalIdHint === 'v0x' || finalIdHint === 'v0xq') {
          finalN = 21;
        }
        else {
          throw new RangeError('신세대 셀 표면 v2r2 는 format.n(21|25) 이 필요하다');
        }
      }
      if (finalLayoutIdForN(finalN) === null) {
        throw new RangeError('신세대 셀 표면의 n 은 13|21|25 다: ' + finalN);
      }
      if (finalIdHint !== null) assertCellSurfaceFinalN(finalIdHint, finalN);
      // n=21 은 후보가 둘 — 힌트가 없으면 기본(v2r2). 레이아웃 판별은 로케이터·평가 게이트가 한다.
      const finalId = finalIdHint === null ? finalLayoutIdForN(finalN) : finalIdHint;
      // 포맷 세대 — 기본은 현행 v2(18셀). `formatWire: 1` 이면 **레거시 판독**(15셀)이라
      // 예약 셀이 3개 적고 데이터 scan 이 그만큼 길다(통합자 결정 A · 폴백 경로).
      const formatWire = format.formatWire === undefined
        ? CELL_SURFACE_FINAL_FORMAT_WIRE
        : format.formatWire;
      if (formatWire !== CELL_SURFACE_FINAL_FORMAT_WIRE
        && formatWire !== CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY) {
        throw new RangeError('포맷 와이어 세대는 2(현행) 또는 1(레거시): ' + formatWire);
      }
      // 포맷 v2 — 마스크 index 는 포맷 워드에서 읽어 온 값이 여기로 들어온다.
      // 생략하면 0(개정 전 고정 마스크)이라 기존 호출부의 동작이 바뀌지 않는다.
      // 레거시 v1 워드에는 마스크 필드 자체가 없으므로 index 는 **0 고정**이다.
      const requestedMaskIndex = assertMaskIndex(
        format.maskIndex === undefined ? DEFAULT_MASK_INDEX : format.maskIndex,
      );
      if (formatWire === CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY
        && requestedMaskIndex !== DEFAULT_MASK_INDEX) {
        throw new RangeError(
          '레거시 포맷 v1 은 마스크 index 필드가 없다 — 0 이어야 한다: ' + requestedMaskIndex,
        );
      }
      return finishProfile({
        type,
        eccLevel,
        capacity: capacityForCellSurfaceFinal(finalN, eccLevel, finalTones, finalId, formatWire),
        scan: dataCellsInScanOrderCellSurfaceFinal(finalN, finalId, formatWire),
        coordinates: (cell) => [cell.i, cell.j],
        maskIndex: requestedMaskIndex,
        formatWire,
      });
    }

    const layoutId = format.cellSurfaceLayout
      || (format.formatIndex !== undefined
        ? layoutIdFromFormatIndex(format.formatIndex)
        : null)
      || (format.locatorProfile === 'cell-surface-v1r2'
        ? CELL_SURFACE_LAYOUT_V1R2
        : format.locatorProfile === 'cell-surface-v2'
          ? 'v2'
          : null);
    const cellSurface = format.cellSurface === true
      || format.locatorProfile === 'cell-surface-v1'
      || Boolean(layoutId);
    if (cellSurface && window) {
      throw new RangeError('Type Y cellSurface와 window를 함께 쓸 수 없다');
    }
    if (cellSurface && layoutId) {
      let cellSurfaceTones = suppliedTones;
      if (format.formatIndex !== undefined) {
        if (!isCellSurfaceLayoutFormatIndex(format.formatIndex)) {
          throw new RangeError(
            'cell-surface layout formatIndex 가 아니다: ' + format.formatIndex,
          );
        }
        const fromIndex = tonesFromCellSurfaceLayoutFormatIndex(format.formatIndex);
        if (cellSurfaceTones !== undefined && cellSurfaceTones !== fromIndex) {
          throw new RangeError(
            'cell-surface layout tones=' + cellSurfaceTones
            + ' 와 formatIndex=' + format.formatIndex + ' 가 어긋난다',
          );
        }
        cellSurfaceTones = fromIndex;
      } else {
        cellSurfaceTones = cellSurfaceTones === undefined ? 2 : cellSurfaceTones;
      }
      const resolvedLayout = layoutIdFromFormatIndex(format.formatIndex) || layoutId;
      const capacity = capacityForCellSurfaceLayout(resolvedLayout, eccLevel, cellSurfaceTones);
      if (requestedN !== undefined) assertOptionalDimension(format.n, 'n', capacity.n);
      if (format.k !== undefined) assertOptionalDimension(format.k, 'k', capacity.n);
      return finishProfile({
        type,
        eccLevel,
        capacity,
        scan: dataCellsInScanOrderCellSurfaceLayout(resolvedLayout),
        coordinates: (cell) => [cell.i, cell.j],
      });
    }
    if (cellSurface) {
      let cellSurfaceTones = suppliedTones;
      if (format.formatIndex !== undefined) {
        if (!isCellSurfaceFormatIndex(format.formatIndex)) {
          throw new RangeError(
            'cell-surface-v1 formatIndex는 12 또는 14 이어야 한다: ' + format.formatIndex,
          );
        }
        const fromIndex = tonesFromCellSurfaceFormatIndex(format.formatIndex);
        if (cellSurfaceTones !== undefined && cellSurfaceTones !== fromIndex) {
          throw new RangeError(
            'cell-surface-v1 tones=' + cellSurfaceTones
            + ' 와 formatIndex=' + format.formatIndex + ' 가 어긋난다',
          );
        }
        cellSurfaceTones = fromIndex;
      } else {
        cellSurfaceTones = cellSurfaceTones === undefined ? 2 : cellSurfaceTones;
      }
      const capacity = capacityForCellSurfaceY(eccLevel, cellSurfaceTones);
      if (requestedN !== undefined) assertOptionalDimension(format.n, 'n', capacity.n);
      if (format.k !== undefined) assertOptionalDimension(format.k, 'k', capacity.n);
      return finishProfile({
        type,
        eccLevel,
        capacity,
        scan: dataCellsInScanOrderCellSurface(),
        coordinates: (cell) => [cell.i, cell.j],
      });
    }
    const spec = selectVersionSpec({
      type,
      logicalSpec,
      rawSpec: typeYSpecFromFormatIndex(formatIndex),
      rawExplicit,
      dimension: 'n',
      dimensionName: 'n',
      requestedDimension: requestedN,
      requestedTones: suppliedTones,
      version: format.version,
      formatIndex,
    });
    assertOptionalDimension(format.n, 'n', spec.n);
    assertOptionalDimension(format.k, 'k', spec.n);

    if (window) {
      if (spec.version !== 2 || spec.tones !== 2) {
        throw new RangeError('Type Y window은 Y2, tones=2에서만 허용된다');
      }
      return finishProfile({
        type,
        eccLevel,
        capacity: capacityForY2Window(eccLevel),
        scan: windowedDataCellsInScanOrderY(spec.n, spec.tones),
        coordinates: (cell) => [cell.i, cell.j],
      });
    }

    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForY(spec, eccLevel),
      scan: dataCellsInScanOrderY(spec.n),
      coordinates: (cell) => [cell.i, cell.j],
    });
  }

  throw new RangeError('알 수 없는 코드 패밀리: ' + type + ' (허용 O, A, Y)');
}

function unmaskSymbolDigits(cellDigits, profile) {
  if (!cellDigits || typeof cellDigits.length !== 'number' || typeof cellDigits === 'string') {
    throw new TypeError('cellDigits는 배열 유사 객체여야 한다');
  }

  const fullScanLength = profile.scan.length;
  if (cellDigits.length !== profile.symbolDigits && cellDigits.length !== fullScanLength) {
    throw new RangeError(
      'scan-order digit 수가 맞지 않는다: ' + cellDigits.length + ' (심볼 영역 '
      + profile.symbolDigits + ' 또는 필러 포함 ' + fullScanLength + ' 필요)',
    );
  }

  const out = new Uint8Array(profile.symbolDigits);
  for (let i = 0; i < profile.symbolDigits; i += 1) {
    const digit = cellDigits[i];
    if (!Number.isInteger(digit) || digit < 0 || digit > 5) {
      throw new RangeError('digit 범위 위반 (scan index ' + i + '): ' + digit + ' (허용 0..5)');
    }
    const [x, y] = profile.coordinates(profile.scan[i]);
    // maskIndex 는 포맷 v2(신세대 셀 표면)만 0 이 아닐 수 있다 — 다른 경로는
    // profile.maskIndex 가 0 이라 개정 전과 동일한 연산이다.
    out[i] = maskSub(digit, x, y, profile.maskIndex);
  }
  return out;
}

function decodeSymbolsToFramedBytes(symbols, byteLength) {
  const expectedSymbolCount = symbolCountForByteLength(byteLength);
  if (symbols.length !== expectedSymbolCount) {
    throw new RangeError(
      'RS 메시지 심볼 수 불일치: ' + symbols.length + ' !== ' + expectedSymbolCount
      + ' (dataBytes ' + byteLength + ')',
    );
  }

  const out = new Uint8Array(byteLength);
  let byteOffset = 0;
  let symbolOffset = 0;
  while (byteOffset < byteLength) {
    const take = Math.min(CHUNK_BYTES, byteLength - byteOffset);
    symbolOffset += decodeChunkInto(symbols, symbolOffset, take, out, byteOffset);
    byteOffset += take;
  }

  if (symbolOffset !== symbols.length) {
    throw new RangeError(
      'base-211 청크 소비량 불일치: ' + symbolOffset + ' !== ' + symbols.length,
    );
  }
  return out;
}

/**
 * 앞단이 "표본이 없다"고 판정한 scan-order 셀 인덱스 / 심볼 인덱스를 하나의
 * 오름차순 심볼 소거 목록으로 모은다. filler 구간(심볼 digit 밖)의 셀은
 * 코드워드가 아니므로 조용히 버리는 게 아니라 **소거 대상이 아님**이 정의다.
 */
function collectDeclaredErasures(options, profile, symbolCount) {
  const out = new Set();
  const cells = options.erasureCells;
  if (cells !== undefined && cells !== null) {
    if (!Array.isArray(cells) && !ArrayBuffer.isView(cells)) {
      throw new TypeError('erasureCells는 배열이어야 한다');
    }
    for (let i = 0; i < cells.length; i += 1) {
      const index = cells[i];
      if (!Number.isInteger(index) || index < 0 || index >= profile.scan.length) {
        throw new RangeError(
          'erasureCells[' + i + ']는 0..' + (profile.scan.length - 1) + ' 정수여야 한다: ' + index,
        );
      }
      if (index >= profile.symbolDigits) continue; // filler는 코드워드가 아니다
      out.add(Math.floor(index / 3));
    }
  }
  const symbols = options.erasureSymbols;
  if (symbols !== undefined && symbols !== null) {
    if (!Array.isArray(symbols) && !ArrayBuffer.isView(symbols)) {
      throw new TypeError('erasureSymbols는 배열이어야 한다');
    }
    for (let i = 0; i < symbols.length; i += 1) {
      const index = symbols[i];
      if (!Number.isInteger(index) || index < 0 || index >= symbolCount) {
        throw new RangeError(
          'erasureSymbols[' + i + ']는 0..' + (symbolCount - 1) + ' 정수여야 한다: ' + index,
        );
      }
      out.add(index);
    }
  }
  return [...out].sort((left, right) => left - right);
}

function mergeSorted(left, right) {
  const set = new Set(left);
  for (const value of right) set.add(value);
  return [...set].sort((a, b) => a - b);
}

function assertZeroPadding(framed, payloadLength) {
  const paddingStart = 1 + payloadLength;
  for (let i = paddingStart; i < framed.length; i += 1) {
    if (framed[i] !== 0) {
      throw new RangeError('0x00 패딩이 아니다 (byte index ' + i + '): ' + framed[i]);
    }
  }
}

/**
 * scan order로 정렬된 셀 digit 배열을 UTF-8 텍스트로 복호한다.
 *
 * format.version은 encode 계열의 논리 버전 또는 formatinfo.decode의 raw version-index를
 * 받을 수 있다. 후자와 전자가 충돌하는 값은 k/n(및 Type Y tones)으로 판별하며,
 * formatIndex를 쓰면 raw index임을 명시한다. type을 생략하면 Type O다.
 *
 * cellDigits는 실제 심볼 digit만(3S개) 또는 scan order 전체(3S + filler개) 모두
 * 허용한다. filler는 코드워드가 아니므로 전체 입력일 때도 꼬리에서 무시한다.
 *
 * options.erasureCells는 "프레임 밖이라 표본이 없었다"고 앞단이 판정한 scan-order
 * 셀 인덱스다. digit 3개가 심볼 1개이므로 셀 인덱스는 ⌊index/3⌋ 심볼 소거가 된다.
 * 불법 211..215 심볼도 같은 소거 표에 합쳐진다. 소거는 오류와 달리 패리티를 1개만
 * 쓰므로 한계가 2v ≤ nsym에서 2v + s ≤ nsym으로 넓어진다.
 *
 * @param {Uint8Array|number[]} cellDigits
 * @param {{
 *   type?: 'O'|'A'|'Y',
 *   version:number,
 *   formatIndex?:number,
 *   eccLevel:'L'|'M'|'H'|0|1|2,
 *   k?:number,
 *   n?:number,
 *   tones?:2|3,
 *   window?:boolean,
 * }} format
 * @param {{
 *   erasureCells?:number[],
 *   erasureSymbols?:number[],
 *   erasureMode?:'erasure'|'error-only-fallback',
 * }} [options]
 * @returns {{
 *   ok:true,
 *   text:string,
 *   corrected:number,
 *   crsDistance:number,
 *   erasureFallback?: {
 *     mode:'erasure'|'error-only-fallback',
 *     illegalSymbolIndices:number[],
 *     erasureSymbolIndices:number[],
 *     placeholder:number,
 *   },
 * } | {ok:false, reason:string}}
 */
export function decodeCells(cellDigits, format, options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options는 객체여야 한다');
  }
  const erasureMode = options.erasureMode ?? RS211_ERASURE_MODE;
  if (erasureMode !== RS211_ERASURE_MODE && erasureMode !== RS211_ERASURE_MODE_LEGACY) {
    throw new RangeError('erasureMode는 ' + RS211_ERASURE_MODE + ' 또는 '
      + RS211_ERASURE_MODE_LEGACY + '여야 한다: ' + erasureMode);
  }

  let profile;
  try {
    profile = resolveProfile(format);
  } catch (cause) {
    return fail('format', cause);
  }

  // 마스크 index 를 «조용히 무시» 하지 않는다 — 포맷 v2(신세대 셀 표면) 이외의
  // 경로에 0 이 아닌 index 가 오면 호출자가 경로를 착각한 것이다.
  if (format.maskIndex !== undefined && format.maskIndex !== profile.maskIndex) {
    return fail('format', new RangeError(
      'maskIndex=' + format.maskIndex + ' 는 이 경로(포맷 v1)가 쓰지 않는다',
    ));
  }

  let unmasked;
  try {
    unmasked = unmaskSymbolDigits(cellDigits, profile);
  } catch (cause) {
    return fail('mask', cause);
  }

  let packed;
  try {
    packed = packCellDigitsToSymbols(unmasked);
  } catch (cause) {
    return fail('symbol', cause);
  }

  let declaredErasures;
  try {
    declaredErasures = collectDeclaredErasures(options, profile, packed.symbols.length);
  } catch (cause) {
    return fail('erasure', cause);
  }

  // 211..215는 체 밖이라 그대로 rsDecode에 넣을 수 없으므로 0이라는 유효한 수신값으로
  // 치환한다. 치환값 자체는 소거 복호에서 의미가 없다 — 위치만 쓰인다.
  const received = packed.symbols.slice();
  for (const index of packed.illegalIndices) received[index] = ILLEGAL_SYMBOL_PLACEHOLDER;
  for (const index of declaredErasures) received[index] = ILLEGAL_SYMBOL_PLACEHOLDER;

  const erasureIndices = erasureMode === RS211_ERASURE_MODE
    ? mergeSorted(packed.illegalIndices, declaredErasures)
    : [];

  let rsResult;
  try {
    rsResult = erasureIndices.length > 0
      ? rsDecode(received, profile.capacity.nsym, { erasures: erasureIndices })
      : rsDecode(received, profile.capacity.nsym);
  } catch (cause) {
    return fail('rs', cause);
  }
  if (!rsResult.ok) {
    const marked = packed.illegalIndices.length + declaredErasures.length;
    const fallback = marked === 0
      ? ''
      : erasureMode === RS211_ERASURE_MODE
        ? '; 소거 ' + erasureIndices.length + '개(불법 심볼 ' + packed.illegalIndices.length
          + ' + 미표본 ' + declaredErasures.length + ')를 위치 지정 소거로 넘겼다'
        : '; 표시된 심볼 ' + marked + '개는 legacy 모드라 일반 오류(0 치환)로 처리했다';
    return fail('rs', rsResult.reason + fallback);
  }

  let framed;
  try {
    framed = decodeSymbolsToFramedBytes(rsResult.message, profile.capacity.dataBytes);
  } catch (cause) {
    return fail('base211', cause);
  }

  let payload;
  try {
    payload = unframe(framed);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail(message.includes('UTF-8') ? 'utf8' : 'header', cause);
  }

  try {
    assertZeroPadding(framed, payload.payloadLength);
  } catch (cause) {
    return fail('header', cause);
  }

  const erasureCount = rsResult.erasureCount ?? 0;
  const result = {
    ok: true,
    text: payload.text,
    corrected: rsResult.errorCount,
    // rsResult.errorCount는 rs211.js가 고친 **위치 미상** 오류 수 u다.
    // C_RS = 2u + e — 소거 e개는 패리티를 1개씩만 쓴다. 점수 계약은 이 필드를 쓴다.
    crsDistance: 2 * rsResult.errorCount + erasureCount,
  };
  if (packed.illegalIndices.length > 0 || declaredErasures.length > 0) {
    result.erasureFallback = {
      mode: erasureMode,
      illegalSymbolIndices: packed.illegalIndices.slice(),
      erasureSymbolIndices: erasureIndices.slice(),
      placeholder: ILLEGAL_SYMBOL_PLACEHOLDER,
    };
  }
  return result;
}
