// encodeK.js — Type K(육각별) 인코더 파이프라인 통합 (encodeA.js 대칭, 계약 K-3·K-4·K-6)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 dataBytes까지) → base-211
// 심볼 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개
// → 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order-K 로 셀 배치 → 잔여 셀에
// 필러(프리마스크 0 + 마스크) → digit 확정까지. 배정(digit → rank)·렌더는 다른
// 모듈 몫이다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacityK.js/formatK.js/header.js/base211.js/
// rs211.js/mask.js/formatinfo.js/layoutK.js/placementK.js/placement.js(육각부 무수정
// 재사용)가 이미 확정한 조각을 파이프라인 순서대로 조합만 한다.
//
// [중앙 슬롯 옵션 — 2026-08-25 KEX 실측 후 개설]
//   · centerQr·centralV0·centralN7 — K 코어가 O/A 와 좌표까지 같은 중앙 19셀 슬롯을 이미
//     비워 두며, 전 k 에서 그 슬롯과 data 셀의 교집합은 0 이다. 둘 다 «그림의
//     점유자 교체»라 회계는 불변이고 새 와이어 값도 없다: 평 K 는 7, K-CM 은 8을
//     그대로 공유한다. 전 k × ECC × 평/CM 프런트엔드 왕복이 이 결론을 잠근다.
//     K-CM × centralV0 도 반전 꼭짓점 W 의 전면-dark 정본 톤을 그대로 싣는다.
//     과거에는 별 끝 암점 3개가 비컨 블록 상위 컷을 밀어 중앙 가설을 0으로 만들어
//     예외를 뒀지만, 중앙 비컨 어댑터가 중앙 고정 계약(centreWindowFraction)을 주입한
//     뒤에는 전 k × ECC에서 비컨 가설이 유지된다 (레인 KVX 재계측).
//   · daehanFinder — 중앙 슬롯·예약 셀과 K 회계의 조합이 여전히 미검증이다.
//   · turnA — K = A ∪ 반전A 라 180° 회전이 실루엣을 보존한다(육각별 자기 대칭).
//     «턴 K» 는 별도 실루엣이 아니므로 옵션 자체가 성립하지 않는다.
//
// [cornerMarker(K-CM) — 2026-08-24 개설 (레인 C)] 종전 이 자리는 «보류 — H2CO3
//   발자국이 반전 꼭짓점 앵커 자리를 포함해 fixed 회계가 미해소(계약 K-8.1)» 였다.
//   배타 개설 정형 3단을 밟았다: ① 근거 실측 (`test/markerK-measure.mjs` — 방향
//   margin 1.0000 · 60° 사멸 유지 · 유/무 구분 0.4667 < 0.78) → ② 표 명시 확장
//   (formatK.js K*CM 3행 · markerK.js VERSIONS_KCM) → ③ 구 락(이 배타 목록의 행 +
//   test 의 throws 단언)을 양성 경로로. 회계는 운영자 확정 (다)안 «앵커 위 마커»:
//   꼭짓점 셀이 앵커 digit 과 마커 digit 을 **같은 값**으로 동시에 만족하므로
//   오버헤드 가산이 30 이 아니라 **27** 이다 (markerK.js 헤더 §3).

import { VERSIONS_K, capacityForK } from './capacityK.js';
import {
  VERSIONS_KCM,
  capacityForKMarker,
  chooseVersionKMarker,
  markerCellsK,
  h2co3TonesByKeyK,
  patchReferenceCellsKMarker,
  dataCellsInScanOrderKMarker,
  fillerCellsKMarker,
} from './markerK.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { dataCellsInScanOrderK, fillerCellsK } from './layoutK.js';
import { centralSlotCells } from './layout.js';
import { anchorCells, referenceCellsAll, formatCells, REFERENCE_DIGIT } from './placement.js';
import { vertexAnchorsK, patchReferenceCellsK } from './placementK.js';

function cellKey(q, r) {
  return `${q},${r}`;
}

/**
 * K-CM 정본은 반전 꼭짓점 W 를 전면 dark 로 칠한다. 중앙 v0 조합도 예외가 아니다.
 * 과거의 3셀 제외는 별 끝 암점이 비컨 블록 상위 컷을 점거하던 검출기 양보였으나,
 * 중앙 비컨 어댑터가 중앙 고정 계약으로 후보를 가른 뒤 재계측한 전 k × ECC에서
 * 정본 톤 30셀과 비컨 가설 9개가 함께 유지됐다. N0·N1 톤과 회계·와이어는 그대로다.
 */
export function h2co3IncludeVertexK(options = {}) {
  return options.cornerMarker === true;
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS_K 항목을 고른다.
 * K2(ECC-eccLevel) 도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 */
export function chooseVersionK(text, eccLevel = 'M', cornerMarker = false) {
  const byteLength = payloadByteLength(text);
  if (cornerMarker) return chooseVersionKMarker(byteLength, eccLevel);
  for (const spec of VERSIONS_K) {
    const capacity = capacityForK(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = VERSIONS_K[VERSIONS_K.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 ${last.name}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * Type K 인코더 파이프라인 진입점. version 을 생략하면 chooseVersionK 로 자동 선택.
 * `cornerMarker: true` 면 K-CM — 격자·앵커·포맷은 그대로이고 마커 30셀 · 회계
 * (overhead + 27) · 와이어 값(star 축 8)만 갈린다.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H', cornerMarker?: boolean,
 *          centerQr?: boolean, centralV0?: boolean, centralN7?: boolean}} [options]
 * @returns {{
 *   version:number, k:number, eccLevel:'L'|'M'|'H', cornerMarker:boolean,
 *   centerQr:boolean, centralV0:boolean, centralN7:boolean, formatIndex:number,
 *   capacity:object, codewordSymbols:Uint8Array, dataDigits:Uint8Array,
 *   fillerDigits:Uint8Array, formatDigits:number[],
 *   cellDigits: Map<string, {digit:number, role:'anchor'|'marker'|'reference'|'format'|'data'|'filler'}>,
 * }}
 */
export function encodeK(text, options = {}) {
  // encodeA 전례: version 명시 경로가 payloadByteLength 의 타입 검사를 건너뛰면
  // TextEncoder 가 undefined → '' 로 조용히 강제 변환한다. 판정을 먼저 일치시킨다.
  if (typeof text !== 'string') {
    throw new TypeError(`페이로드는 문자열이어야 한다: ${typeof text}`);
  }
  const {
    version, eccLevel = 'M', cornerMarker = false, centerQr = false, centralV0 = false,
    centralN7 = false,
  } = options;
  // 배타 가드 — 모듈 헤더 §옵션 배타. 조용한 무시는 «와이어와 그림이 어긋난
  // 자기모순 아티팩트» 의 씨앗이라 명시 값이 오면 던진다.
  for (const [name, reason] of [
    ['daehanFinder', 'daehan × K 는 배치 검증 미실시 조합이다'],
    ['turnA', 'K 실루엣은 180° 자기 대칭이라 턴 옵션이 성립하지 않는다'],
  ]) {
    if (options[name] !== undefined && options[name] !== false) {
      throw new RangeError(`Type K 는 ${name} 를 지원하지 않는다 — ${reason}`);
    }
  }
  if (typeof cornerMarker !== 'boolean') {
    throw new TypeError(`cornerMarker 는 boolean 이어야 한다: ${typeof cornerMarker}`);
  }
  if (typeof centerQr !== 'boolean') {
    throw new TypeError(`centerQr 는 boolean 이어야 한다: ${typeof centerQr}`);
  }
  if (typeof centralV0 !== 'boolean') {
    throw new TypeError(`centralV0 는 boolean 이어야 한다: ${typeof centralV0}`);
  }
  if (typeof centralN7 !== 'boolean') {
    throw new TypeError(`centralN7 는 boolean 이어야 한다: ${typeof centralN7}`);
  }
  const centralSlotOccupants = [
    centerQr ? 'centerQr' : null,
    centralV0 ? 'centralV0' : null,
    centralN7 ? 'centralN7' : null,
  ].filter(Boolean);
  if (centralSlotOccupants.length > 1) {
    throw new RangeError(
      `중앙 슬롯 점유자는 하나다 — ${centralSlotOccupants.join(' + ')} 를 동시에 켤 수 없다`,
    );
  }

  // K-CM 은 «옵션» 이다 — 격자(k)·앵커·포맷 셀은 평 K 와 같고 회계와 와이어 값만
  // 갈린다. 그래서 표도 버전 표를 갈아 끼우는 방식이다 (encodeA 의 provider 문법).
  const versionTable = cornerMarker ? VERSIONS_KCM : VERSIONS_K;
  const capacityOf = cornerMarker ? capacityForKMarker : capacityForK;

  let spec;
  if (version === undefined) {
    spec = chooseVersionK(text, eccLevel, cornerMarker);
  } else {
    spec = versionTable.find((entry) => entry.version === version);
    if (!spec) {
      throw new RangeError(`알 수 없는 Type K 버전: ${version}${cornerMarker ? ' (+CM)' : ''}`);
    }
  }

  const capacity = capacityOf(spec, eccLevel);
  const { k } = spec;

  // 길이 헤더 + 0x00 패딩 → base-211 심볼.
  const framed = frame(text, capacity.dataBytes);
  const symbols = bytesToSymbols(framed);
  if (symbols.length !== capacity.dataSymbols) {
    throw new RangeError(
      `심볼 개수 불일치: bytesToSymbols() ${symbols.length} !== capacity.dataSymbols ${capacity.dataSymbols}`,
    );
  }

  // RS(GF(211)) 패리티 부착 → 코드워드.
  const codewordSymbols = rsEncode(symbols, capacity.nsym);
  if (codewordSymbols.length !== capacity.usedSymbols) {
    throw new RangeError(
      `코드워드 심볼 개수 불일치: rsEncode() ${codewordSymbols.length} !== capacity.usedSymbols ${capacity.usedSymbols}`,
    );
  }

  // 심볼 → 3 digit(MSD-first, 프리마스크) → scan order-K 좌표에 마스크 가산.
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols); // 길이 3S
  const scanCells = cornerMarker ? dataCellsInScanOrderKMarker(k) : dataCellsInScanOrderK(k);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order-K 셀 수 불일치: ${cornerMarker ? 'dataCellsInScanOrderKMarker' : 'dataCellsInScanOrderK'}()`
      + ` ${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
    );
  }
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.q, c.r);
  }

  // 잔여 셀 = 프리마스크 0 에 마스크 가산(§5.6 준용). scan order-K 의 꼬리와 동일 셀.
  const fillerCoords = cornerMarker ? fillerCellsKMarker(k) : fillerCellsK(k);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: ${cornerMarker ? 'fillerCellsKMarker' : 'fillerCellsK'}()`
      + ` ${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.q, c.r);
  }

  // 포맷 정보 — formatIndex 는 star 축 표(formatK.js)가 정본이다 (평 K 7 · K-CM 8,
  // 각각 k 로 가른다). centerQr·centralV0·centralN7은 중앙 슬롯의 그림만 바꾸고 본문 회계가
  // 같으므로 새 값을 만들지 않고 이 인덱스를 공유한다. 인코더 쪽은 부착까지만 한다.
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  const formatIndex = spec.formatIndex;
  const formatReplicas = encodeReplicated({ version: formatIndex, eccLevel: eccLevelValue });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(k) 순서와 정합

  // 셀별 digit + role 맵 (불스아이 셀은 애초에 어느 목록에도 없으므로 자동 제외).
  const cellDigits = new Map();

  // 코너 마커 30셀 (K-CM 에서만) — 고정 digit, 마스크 없음. **앵커보다 먼저 쓴다**:
  // 반전 꼭짓점 3셀은 마커 발자국 안이면서 앵커이고, (다)안에서 두 digit 이 같은
  // 값이라 뒤에 오는 앵커가 role 만 'anchor' 로 덮는다 — 회계를 «한 번» 세는
  // roleOfKMarker 와 같은 우선순위다 (markerK.js 헤더 §3).
  // ⭐ **정본 H2CO3 톤 채택 (2026-08-25, 계약 K-8.2)** — encodeA 가 H2O 에 하는 것과
  //    같은 계약이다(`markerCellsA(k, h2oTonesByKeyA(k))`). 운영자 지적: 「H·H2O·CO2 는
  //    비-순열도 넣지 않았나? 왜 K 에는 못 넣지?」 — 맞다. 못 넣는 게 아니라 K-8.2 가
  //    미해소로 남아 있었을 뿐이다. digit 은 그대로 두고 `tones` 를 얹는다
  //    (scene.js §셀 한 면의 색 — entry.tones 가 있으면 파인더 축 절대 톤으로 그린다).
  //
  // 반전 꼭짓점 3셀은 마커 발자국이면서 앵커다. 정본 톤은 전면 동톤 (0,0,0) —
  // 운영자 작화(레인 KVTX). digit 은 앵커 값이 남고 tones 만 얹는다. 앵커 패스는
  // role 을 'anchor' 로 덮되, 이미 실린 tones 는 보존한다 (CO2 앵커 톤과 같은 층).
  // 중앙 v0 조합도 W 를 뺄 이유가 없다 — `h2co3IncludeVertexK`.
  if (cornerMarker) {
    const tones = h2co3TonesByKeyK(k, {
      includeVertex: h2co3IncludeVertexK({ cornerMarker, centralV0 }),
    });
    for (const c of markerCellsK(k, tones)) {
      const entry = { digit: c.digit, role: 'marker' };
      if (c.tones) entry.tones = c.tones;
      cellDigits.set(cellKey(c.q, c.r), entry);
    }
  }

  // 앵커 = 육각 코너 3셀(보조, placement.js 무수정) + 별 꼭짓점 6셀(주, K-2) = 9.
  const anchors = [...anchorCells(k), ...vertexAnchorsK(k)];
  for (const c of anchors) {
    const kk = cellKey(c.q, c.r);
    const prev = cellDigits.get(kk);
    const entry = { digit: c.digit, role: 'anchor' };
    if (prev && prev.tones) entry.tones = prev.tones;
    cellDigits.set(kk, entry);
  }

  // 레퍼런스 = 육각 2(k-2)셀 + 패치 레퍼런스(규칙 R′) — 전부 REFERENCE_DIGIT.
  const references = [
    ...referenceCellsAll(k),
    ...(cornerMarker ? patchReferenceCellsKMarker(k) : patchReferenceCellsK(k)),
  ];
  for (const c of references) {
    cellDigits.set(cellKey(c.q, c.r), { digit: REFERENCE_DIGIT, role: 'reference' });
  }

  const formatCoords = formatCells(k); // 육각부 무수정 재사용
  for (let i = 0; i < formatCoords.length; i += 1) {
    const c = formatCoords[i];
    cellDigits.set(cellKey(c.q, c.r), { digit: formatDigits[i], role: 'format' });
  }

  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    cellDigits.set(cellKey(c.q, c.r), { digit: dataDigits[i], role: 'data' });
  }

  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    cellDigits.set(cellKey(c.q, c.r), { digit: fillerDigits[i], role: 'filler' });
  }

  // 세 중앙 옵션은 기존 19셀 슬롯의 점유자 교체다. 평 K/K-CM 어느 공급자에서도
  // 그 셀이 payload 로 되살아나지 않았음을 인코더 경계에서 직접 단언한다.
  if (centerQr || centralV0 || centralN7) {
    for (const cell of centralSlotCells()) {
      if (cellDigits.has(cellKey(cell.q, cell.r))) {
        const owner = centralSlotOccupants[0];
        throw new Error(`${owner} 중앙 슬롯 셀이 데이터에 남았다: ${cellKey(cell.q, cell.r)}`);
      }
    }
  }

  return {
    version: spec.version,
    k,
    eccLevel,
    cornerMarker,
    centerQr,
    centralV0,
    centralN7,
    formatIndex,
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
