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
import { VERSIONS_A, VERSIONS_A_DAEHAN, capacityForA, capacityForADaehan } from './capacityA.js';
import { TURN_A_FORMAT_INDEX, turnASpecFromFormatIndex } from './turnA.js';
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
  hasFinalLayoutWireForN,
  isCellSurfaceFinalFormatIndex,
  isCellSurfaceFinalId,
  tonesFromCellSurfaceFinalFormatIndex,
  wirePreferredFinalLayoutIdForN,
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
  // 허용 n 정본 — format.n 이 없을 때의 유도 원천 (아래 §finalN 참조).
  CELL_SURFACE_FINAL_NS,
} from './cellSurfaceFinal.js';
import {
  CHUNK_BYTES,
  decodeChunkInto,
  packCellDigitsToSymbols,
  symbolCountForByteLength,
} from './base211.js';
import { rsDecode, rsDecodeBlocks } from './rs211.js';
import { maskSub, DEFAULT_MASK_INDEX, assertMaskIndex } from './mask.js';
import { unframe } from './header.js';
import {
  VERSIONS_OCM,
  capacityForOMarker,
  dataCellsInScanOrderOMarker,
} from './markerO.js';
import {
  VERSIONS_OCM_DAEHAN,
  capacityForOMarkerDaehan,
  dataCellsInScanOrderOMarkerDaehan,
} from './markerOdaehan.js';
import {
  VERSIONS_ACM,
  capacityForAMarker,
  dataCellsInScanOrderAMarker,
} from './markerA.js';
import { VERSIONS_DAEHAN, capacityForDaehan } from './capacityDaehan.js';
import { daehanReservedCells } from './finder-daehan.js';
import {
  VERSIONS_C, VERSIONS_C_DAEHAN, VERSIONS_C_Q, capacityForC,
} from './capacityC.js';
import { typeCReservedCells } from './notchC.js';
import { cSpecFromFormatIndex } from './formatC.js';
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

/**
 * formatIndex → Type O(hex 기저) 버전 스펙.
 *
 * 규약은 «version − 1, centerQr 이면 +4» 하나뿐이다 (SPEC §4.4 «변형 오프셋 —
 * hex Q +4»). **범위를 손으로 적지 않는다** — 초판은 `0..2` / `4..6` 이라는 리터럴
 * 범위였고 그건 «버전이 셋» 이라는 사실의 사본이었다. V4(k=12) 편입 2026-08-30 에
 * 그 사본이 정확히 예상대로 뒤처져 V4 프레임이 «알 수 없는 formatIndex 3» 으로
 * 죽었다 (인코더는 이미 3 을 싣고 있었다). 이제 `VERSIONS` 에서 유도한다.
 *
 * 두 사상은 서로 겹치지 않는다: version−1 ∈ [0, |VERSIONS|−1], +4 ∈ [4, |VERSIONS|+3]
 * 이고 hex 표가 4칸 블록으로 동결돼 있어(namespace.test.js D2) 버전이 4개까지는
 * 항상 배타다. 5번째 버전을 열면 겹치므로 그때 이 유도를 표 주도로 바꿔야 한다 —
 * 아래 단언이 그 시점에 던진다.
 */
const HEX_CENTER_QR_OFFSET = 4;

function typeOSpecFromFormatIndex(index) {
  if (!Number.isInteger(index)) return undefined;
  return VERSIONS.find((spec) => spec.version - 1 === index
    || spec.version - 1 + HEX_CENTER_QR_OFFSET === index);
}

{
  // 「기본 인덱스 블록과 Q 인덱스 블록이 안 겹친다」는 위 유도의 전제다. 겹치면
  // `typeOSpecFromFormatIndex` 가 조용히 잘못된 버전을 돌려준다 — 조용한 오독은
  // 이 저장소에서 가장 비싼 실패라 로드 시점에 던진다.
  const plain = new Set(VERSIONS.map((spec) => spec.version - 1));
  for (const spec of VERSIONS) {
    const q = spec.version - 1 + HEX_CENTER_QR_OFFSET;
    if (plain.has(q)) {
      throw new Error('decode: hex 기본 인덱스와 Q 인덱스가 겹친다 (V' + spec.version
        + 'Q = ' + q + ') — +' + HEX_CENTER_QR_OFFSET + ' 오프셋 유도를 표 주도로 바꿔라');
    }
  }
}

/**
 * formatIndex → Type A 버전 스펙.
 *
 * 두 규약을 본다 (2026-08-18 턴A 편입):
 *   ⓐ 기본 A (정삼각): 산술 유도 `spec.formatIndex (+2 면 centerQr)`. **발행 규약**이다.
 *   ⓑ 턴A (역삼각):    `src/turnA.js` 의 **표**. 산술이 원리적으로 불가능하다
 *      (A1=12 에 균일 오프셋 +4 면 16 — 4bit 넘침).
 *
 * ⚠ `turn` 은 **검출이 정한다** — `family.js` 의 tri 점수가 실루엣 방향을 가르고
 * (정삼각 ↔ 역삼각 패치가 100% 배타적이라 확실히 갈린다) 그 결과가 여기로 온다.
 * 방향을 모르면(`turn` 미지정) 기본 A 로 본다 — 종전 동작 그대로다.
 *
 * 이 분리가 있어야 `V2Q(3)` 과 기본 `A0Q(3)` 이 같은 값을 써도 서로를 안 먹는다.
 */
function typeASpecFromFormatIndex(index, turn = false) {
  if (!Number.isInteger(index)) return undefined;
  if (turn === true) {
    // 턴A 표는 (formatIndex, k) 쌍으로 유일하다. k 를 모르면 formatIndex 만으로 찾는다.
    // V-CM 행(cornerMarker)은 여기서 배제한다 — 그 경로는 format.cornerMarker 분기
    // (VERSIONS_ACM 회계)가 처리하고, 배제하지 않으면 V1CM=3(k8) 이 V2Q=3(k10) 과
    // 값이 같아 이 인덱스-단독 조회가 이중해석이 된다.
    const entry = TURN_A_FORMAT_INDEX.find(
      (row) => row.formatIndex === index && row.cornerMarker !== true,
    );
    if (!entry) return undefined;
    return VERSIONS_A.find((spec) => spec.version === entry.version);
  }
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

  if (type === 'C') {
    // Type C는 같은 formatIndex를 k=14/17/20이 공유한다. logical version과 raw
    // formatIndex를 `format.version` 하나만으로 겸용하면 C1(논리 1)과 C1D(raw 1)가
    // 모호해지므로 C-DEC 계약 그대로 `(formatIndex,k)`를 둘 다 필수로 받는다.
    // 선택적 version은 행을 고르지 않으며, generic 어댑터 호환을 위해 raw/논리 중
    // 어느 의미든 표와 일치할 때만 받아들인다.
    if (!Number.isInteger(format.formatIndex)) {
      throw new RangeError('Type C는 raw formatIndex가 필요하다');
    }
    if (!Number.isInteger(format.k)) {
      throw new RangeError('Type C는 formatIndex와 짝인 k가 필요하다');
    }
    const wireSpec = cSpecFromFormatIndex(format.formatIndex, format.k);
    if (!wireSpec) {
      throw new RangeError(
        `알 수 없는 Type C (formatIndex,k): (${format.formatIndex},${format.k})`,
      );
    }
    if (format.version !== undefined
      && format.version !== format.formatIndex
      && format.version !== wireSpec.version) {
      throw new RangeError(
        `Type C version ${format.version}이 raw formatIndex ${format.formatIndex}`
        + ` 또는 논리 version ${wireSpec.version} 어느 쪽과도 다르다`,
      );
    }
    if (format.daehanFinder !== undefined) {
      if (typeof format.daehanFinder !== 'boolean') {
        throw new TypeError(`daehanFinder는 boolean이어야 한다: ${typeof format.daehanFinder}`);
      }
      if (format.daehanFinder !== wireSpec.daehanFinder) {
        throw new RangeError(
          `Type C daehanFinder=${format.daehanFinder}가 formatIndex ${format.formatIndex}`
          + `의 표 값 ${wireSpec.daehanFinder}와 다르다`,
        );
      }
    }
    const versions = wireSpec.centerQr === true
      ? VERSIONS_C_Q
      : wireSpec.daehanFinder ? VERSIONS_C_DAEHAN : VERSIONS_C;
    const spec = versions.find((entry) => entry.name === wireSpec.name);
    if (!spec) {
      throw new Error(`Type C 와이어 행 ${wireSpec.name}의 용량 행이 없다`);
    }
    const additional = spec.daehanFinder ? daehanReservedCells(spec.k) : undefined;
    const capacity = capacityForC(spec, eccLevel);
    return finishProfile({
      type,
      eccLevel,
      capacity,
      rsBlockConfig: capacity.rsBlockConfig,
      scan: dataCellsInScanOrderO(spec.k, typeCReservedCells(spec.k, additional)),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'O' && format.daehanFinder === true && format.cornerMarker === true) {
    // G(CM) × daehan — 와이어는 V*CM(G) index를 그대로 쓴다. daehan 검출 결과가
    // 추가되면 같은 G index의 평 CM 대신 CMD 회계·scan order를 쓴다. k는 파인더
    // 템플릿 id가 아니라 프레임 차원이라, daehan 단독 경로와 같이 우선 k로 찾는다.
    const wantK = format.k === undefined ? undefined : format.k;
    const spec = wantK === undefined
      ? VERSIONS_OCM_DAEHAN.find((entry) => entry.version === format.version)
      : VERSIONS_OCM_DAEHAN.find((entry) => entry.k === wantK);
    if (!spec) {
      throw new RangeError(
        'G×daehan 버전을 모른다: k=' + format.k + ' version=' + format.version
        + ' (허용 k ' + VERSIONS_OCM_DAEHAN.map((v) => v.k).join(', ') + ')',
      );
    }
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForOMarkerDaehan(spec, eccLevel),
      scan: dataCellsInScanOrderOMarkerDaehan(spec.k),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'O' && format.daehanFinder === true) {
    // daehan (전면 파인더, 2026-08-18) — O-CM 과 **같은 와이어 계약**이다:
    // formatIndex 는 레거시 O 와 같고(`capacityDaehan.js` 헤더 §와이어), 갈리는 것은
    // 회계와 scan order 뿐이다. 판별 정보는 와이어가 아니라 **파인더 검출 결과**로
    // 온다 — `bootstrap.js` 가 patternId(`oak-daehan-k*`)를 이 플래그로 바꾼다.
    //
    // ⚠ `format.version` 이 아니라 **k** 로 찾는다. daehan 의 version 은 기존과 같은
    //   1/2/3 이지만, 이 경로로 들어오는 신호(patternId)가 직접 말하는 것은 k 다.
    //   version 으로 찾으면 「k 는 6 인데 version 은 3」 같은 모순을 조용히 통과시킨다.
    const wantK = format.k === undefined ? undefined : format.k;
    const spec = wantK === undefined
      ? VERSIONS_DAEHAN.find((entry) => entry.version === format.version)
      : VERSIONS_DAEHAN.find((entry) => entry.k === wantK);
    if (!spec) {
      throw new RangeError(
        'daehan 버전을 모른다: k=' + format.k + ' version=' + format.version
        + ' (허용 k ' + VERSIONS_DAEHAN.map((v) => v.k).join(', ') + ')',
      );
    }
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForDaehan(spec, eccLevel),
      scan: dataCellsInScanOrderO(spec.k, daehanReservedCells(spec.k)),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

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

  if (type === 'A' && format.daehanFinder === true) {
    // Type A + daehan (2026-08-19) — O daehan 과 같은 와이어 계약: formatIndex 는
    // 레거시 A 와 같고, 갈리는 것은 회계와 scan order 뿐이다. 육각 코어가 O 와
    // 좌표 동일하고 예약 셀은 패치에 0개라 daehan 좌표를 그대로 재사용한다.
    const wantK = format.k === undefined ? undefined : format.k;
    const spec = wantK === undefined
      ? VERSIONS_A_DAEHAN.find((entry) => entry.version === format.version)
      : VERSIONS_A_DAEHAN.find((entry) => entry.k === wantK);
    if (!spec) {
      throw new RangeError(
        'A daehan 버전을 모른다: k=' + format.k + ' version=' + format.version
        + ' (허용 k ' + VERSIONS_A_DAEHAN.map((v) => v.k).join(', ') + ')',
      );
    }
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForADaehan(spec, eccLevel),
      scan: dataCellsInScanOrderA(spec.k, daehanReservedCells(spec.k)),
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
      rawSpec: typeASpecFromFormatIndex(formatIndex, format.turn === true),
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
          // 'cell-surface-v0x' · 'cell-surface-v0xq' · 'cell-surface-v0w' ·
          // 'cell-surface-v0wq' · 'cell-surface-v0w2' · 'cell-surface-v0wy' 는
          // 초안 슬롯이 없어 draftIndexWire 충돌이 없다.
          //
          // ⚠ **의도적 갱신 (2026-08-17 v0WY 재설계)** — 이 자리에는
          // 「'cell-surface-v0wy' 라는 프로파일은 없다 — v0WY 는 와이어가 v0W 다」
          // 가 적혀 있었다. 구 v0WY(허공 마름모 QR)의 서술이고, QR 이 실루엣
          // 안쪽 먼 코너로 들어오면서 셀 집합·회계가 달라져 진짜 레이아웃이 됐다.
          : format.locatorProfile === 'cell-surface-v0x'
            ? 'v0x'
            : format.locatorProfile === 'cell-surface-v0xq'
              ? 'v0xq'
              : format.locatorProfile === 'cell-surface-v0w'
                ? 'v0w'
                : format.locatorProfile === 'cell-surface-v0wq'
                  ? 'v0wq'
                  : format.locatorProfile === 'cell-surface-v0w2'
                    ? 'v0w2'
                    : format.locatorProfile === 'cell-surface-v0wy'
                      ? 'v0wy'
                      // v0T 편입 (2026-08-17) — 'cell-surface-v0t' · 'cell-surface-v0ty'
                      // 도 초안 슬롯이 없어 draftIndexWire 충돌이 없다.
                      : format.locatorProfile === 'cell-surface-v0t'
                        ? 'v0t'
                        : format.locatorProfile === 'cell-surface-v0ty'
                          ? 'v0ty'
                          // v0TR 계열 편입 (2026-08-17) — 같은 이유로 충돌이 없다.
                          : format.locatorProfile === 'cell-surface-v0tr'
                            ? 'v0tr'
                            : format.locatorProfile === 'cell-surface-v0trq'
                              ? 'v0trq'
                              // v0TRY (2026-08-18) — v0TR 의 먼 코너 QR 파생.
                              : format.locatorProfile === 'cell-surface-v0try'
                                ? 'v0try'
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
        // 허용 n 의 정본은 `CELL_SURFACE_FINAL_NS` 다 — 여기에 손 목록을 두지 않는다.
        // 여기엔 「v0 → 13, 그 밖의 T/W/X 계열 → 21」 이라는 사본이 있었고 **이미
        // 썩어 있었다**: v0wq·v0w2·v0wy 가 목록에서 빠져, 합법 n 이 21 하나뿐인데도
        // 「v2r2 는 format.n 이 필요하다」로 던졌다 (실측 2026-08-25, 3종 전부).
        //
        // ⚠ **복수 n 이면 유도하지 않고 던진다.** 2026-08-25 에 v0t·v0tr 이
        // [21, 25] 로 열리면서(9ce2883) 「없으면 21」 은 잘못된 회계를 고르는 길이
        // 됐다 — v0t@25 를 21 로 읽어도 아래 `assertCellSurfaceFinalN` 은 21 이
        // NS 에 있으니 **안 던진다**. 구 동작 실측: v0t@25(491셀)·v0tr@25(493셀)이
        // 21 회계(307·309)로 내려가 `mask: scan-order digit 수가 맞지 않는다` 로
        // 죽었다 — 실패하긴 하되 **원인을 엉뚱한 단계에 씌운다**. 셀 수가 우연히
        // 같아지는 조합이 생기면 그때는 조용히 틀린 답이 된다.
        //
        // 던진 예외는 `decodeCells` 가 `{ ok: false, reason: 'format: …' }` 로
        // 접어 호출자에게 **실패로** 보인다 (삼키지 않는다 — 정식 앞단
        // `decoder/bootstrap.js` 는 이것을 `diagnostics.bodyFailures` 에 적는다).
        const allowedNs = finalIdHint === null ? undefined : CELL_SURFACE_FINAL_NS[finalIdHint];
        if (allowedNs !== undefined && allowedNs.length === 1) {
          finalN = allowedNs[0];
        } else {
          throw new RangeError(
            '신세대 셀 표면 ' + (finalIdHint === null ? '(레이아웃 힌트 없음)' : finalIdHint)
            + ' 는 format.n('
            + (allowedNs === undefined ? '13|21|25' : allowedNs.join('|'))
            + ') 이 필요하다',
          );
        }
      }
      // **와이어** 질의다 — 라인업(finalLayoutIdForN)이 아니라 «읽을 수 있는 n 인가».
      // v2r2 드랍으로 n=25 는 라인업에서 빠졌지만 발행된 v2r2@25 프레임은 여전히 읽는다.
      if (!hasFinalLayoutWireForN(finalN)) {
        throw new RangeError('신세대 셀 표면의 n 은 13|21|25 다: ' + finalN);
      }
      if (finalIdHint !== null) assertCellSurfaceFinalN(finalIdHint, finalN);
      // 힌트가 없으면 그 n 의 **와이어 선호** 레이아웃 (n=21·25 → v2r2). 드랍은 검출
      // 라인업과 카드에만 걸리고, 힌트 없는 와이어 해소는 발행 이력을 그대로 따른다.
      const finalId = finalIdHint === null
        ? wirePreferredFinalLayoutIdForN(finalN)
        : finalIdHint;
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

  throw new RangeError('알 수 없는 코드 패밀리: ' + type + ' (허용 O, A, Y, C)');
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
 * formatIndex를 쓰면 raw index임을 명시한다. 단 Type C는 두 의미가 실제로 모호하므로
 * `type:'C'`와 raw `formatIndex`+`k`를 반드시 함께 쓴다. Type C의 선택적 version은
 * raw 또는 논리값의 호환성 대조에만 쓰며 행을 선택하지 않는다. type을 생략하면 Type O다.
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
 *   type?: 'O'|'A'|'Y'|'C',
 *   version?:number,
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
    if (profile.rsBlockConfig) {
      rsResult = erasureIndices.length > 0
        ? rsDecodeBlocks(received, profile.rsBlockConfig, { erasures: erasureIndices })
        : rsDecodeBlocks(received, profile.rsBlockConfig);
    } else {
      rsResult = erasureIndices.length > 0
        ? rsDecode(received, profile.capacity.nsym, { erasures: erasureIndices })
        : rsDecode(received, profile.capacity.nsym);
    }
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
  if (rsResult.blockResults) {
    result.blockCorrections = rsResult.blockResults.map((block, blockIndex) => ({
      blockIndex,
      errorCount: block.errorCount,
      erasureCount: block.erasureCount ?? 0,
      crsDistance: 2 * block.errorCount + (block.erasureCount ?? 0),
    }));
  }
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
