// encode.js — 인코더 파이프라인 통합 (SPEC §7.1)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 K까지) → base-211 심볼
// 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개 →
// 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order 로 셀 배치 → 잔여 셀에
// 필러(프리마스크 0) → digit 확정까지. 배정(digit → (T,L,R) rank)·렌더는 다른
// 모듈 몫이다 — 여기서는 셀별 digit 확정까지만 한다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacity.js/header.js/base211.js/rs211.js/
// mask.js/formatinfo.js/layout.js/placement.js 가 이미 확정한 조각을 파이프라인
// 순서대로 조합만 한다.

import { VERSIONS, capacityFor } from './capacity.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { centralSlotCells, dataCellsInScanOrder, fillerCells } from './layout.js';
import {
  anchorCells,
  referenceCellsAll,
  REFERENCE_DIGIT,
  formatCells,
} from './placement.js';
import {
  VERSIONS_OCM,
  capacityForOMarker,
  markerCells,
  formatCellsOMarker,
  referenceCellsOMarker,
  dataCellsInScanOrderOMarker,
  fillerCellsOMarker,
} from './markerO.js';
import { VERSIONS_DAEHAN, capacityForDaehan } from './capacityDaehan.js';
import { daehanReservedCells } from './finder-daehan.js';
import { markerGSpec } from './markerG.js';
import { hTonesByKeyO } from './finder-H.js';

function cellKey(q, r) {
  return `${q},${r}`;
}

/**
 * 레이아웃 공급자 — 레거시 O · O-CM(코너 마커) · daehan(전면 파인더)의 차이를
 * 여기 한 곳에 모은다. 파이프라인(헤더·base211·RS·마스크·포맷 정보)은 세 경로가
 * 완전히 같다.
 */
function layoutProviderFor(cornerMarker, daehanFinder = false, markerTones = false) {
  if (daehanFinder) {
    // daehan (2026-08-18) — anchor/format/reference 좌표는 **레거시와 같다**
    // (예약 60셀이 그 셋과 하나도 안 겹치는 것이 전 k 에서 실측 확인됐다).
    // 갈리는 것은 「어떤 셀이 data 가 아닌가」 하나뿐이라 layout.js 의 선택 인자로 준다.
    return {
      versions: VERSIONS_DAEHAN,
      capacity: capacityForDaehan,
      scan: (k) => dataCellsInScanOrder(k, daehanReservedCells(k)),
      filler: (k) => fillerCells(k, daehanReservedCells(k)),
      format: formatCells,
      reference: referenceCellsAll,
      fixed: (k) => anchorCells(k).map((c) => ({ ...c, role: 'anchor' })),
    };
  }
  if (!cornerMarker) {
    return {
      versions: VERSIONS,
      capacity: capacityFor,
      scan: dataCellsInScanOrder,
      filler: fillerCells,
      format: formatCells,
      reference: referenceCellsAll,
      // 레거시는 앵커 3셀만 — 마커 셀이 없다.
      fixed: (k) => anchorCells(k).map((c) => ({ ...c, role: 'anchor' })),
    };
  }
  return {
    versions: VERSIONS_OCM,
    capacity: capacityForOMarker,
    scan: dataCellsInScanOrderOMarker,
    filler: fillerCellsOMarker,
    format: formatCellsOMarker,
    reference: referenceCellsOMarker,
    // 코너 마커 12셀 = 앵커 3(digit 5/0/0, 레거시 계약 그대로) + 마커 9.
    //
    // markerTones — 타입 G 기본 파인더 **H** 의 심볼 톤(`finder-H.js` 정본)을 12셀에
    // 싣는다 (encodeA 의 H2O 적재와 같은 기제, 운영자 결정 2026-08-21). 단 **opt-in**
    // 이다: H 는 tetrad A(= 레거시 앵커 3셀)까지 덮으므로 톤 프레임은 digit 기반
    // 앵커 검출이 못 읽는다. 코너 마커 검출기의 H 톤 변형이 그 자리를 읽는다 (F-85).
    // 생성기는 o-cm 선택이 이 플래그를 파생한다 (F-38). 기본값 전환은 실기기 라운드
    // 뒤 운영자 판단이다. digit 은 그대로 남는다 — digit 은 와이어·알파벳 계약이고
    // tones 는 심볼 오버레이라 층이 다르다.
    fixed: markerTones
      ? (k) => markerCells(k, hTonesByKeyO(k)).map((c) => ({
        q: c.q, r: c.r, digit: c.digit, role: c.role, tones: c.tones,
      }))
      : (k) => markerCells(k).map((c) => ({
        q: c.q, r: c.r, digit: c.digit, role: c.role,
      })),
  };
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS 항목을 고른다.
 * V3(ECC-eccLevel) 도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 * @returns {{version:number, k:number, overhead:number, symbolKey:string}} VERSIONS 원소
 */
export function chooseVersion(text, eccLevel = 'M', cornerMarker = false, daehanFinder = false) {
  const byteLength = payloadByteLength(text);
  const provider = layoutProviderFor(cornerMarker, daehanFinder);
  for (const spec of provider.versions) {
    const capacity = provider.capacity(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = provider.versions[provider.versions.length - 1];
  const suffix = daehanFinder ? 'D' : cornerMarker ? 'CM' : '';
  throw new RangeError(
    `페이로드 ${byteLength} B 는 V${last.version}${suffix}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * 인코더 파이프라인 진입점 (SPEC §7.1). version 을 생략하면 `chooseVersion` 으로
 * 자동 선택한다.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H', centerQr?: boolean, centralV0?: boolean,
 *          sagoae?: boolean}} [options]
 * @returns {{
 *   version: number, k: number, eccLevel: 'L'|'M'|'H', centerQr: boolean, centralV0: boolean,
 *   capacity: object,
 *   codewordSymbols: Uint8Array,
 *   dataDigits: Uint8Array,
 *   fillerDigits: Uint8Array,
 *   formatDigits: number[],
 *   cellDigits: Map<string, {digit:number, role:'anchor'|'reference'|'format'|'data'|'filler'}>,
 * }}
 */
export function encode(text, options = {}) {
  // version 명시 경로는 chooseVersion(→ payloadByteLength 의 타입 검사)을 건너뛰는데,
  // TextEncoder 는 undefined → '' · 숫자 → 문자열로 조용히 강제 변환한다 — 호출자의
  // undefined 실수가 유효해 보이는 빈 코드로 렌더된다. 두 경로의 판정을 일치시킨다
  // (T9 검증 라운드 발견).
  if (typeof text !== 'string') {
    throw new TypeError(`페이로드는 문자열이어야 한다: ${typeof text}`);
  }
  const {
    version, eccLevel = 'M', centerQr = false, centralV0 = false,
    cornerMarker = false, daehanFinder = false, sagoae = false, markerTones = false,
  } = options;
  if (typeof centerQr !== 'boolean') {
    throw new TypeError(`centerQr 는 boolean 이어야 한다: ${typeof centerQr}`);
  }
  if (typeof cornerMarker !== 'boolean') {
    throw new TypeError(`cornerMarker 는 boolean 이어야 한다: ${typeof cornerMarker}`);
  }
  if (typeof daehanFinder !== 'boolean') {
    throw new TypeError(`daehanFinder 는 boolean 이어야 한다: ${typeof daehanFinder}`);
  }
  if (typeof sagoae !== 'boolean') {
    throw new TypeError(`sagoae 는 boolean 이어야 한다: ${typeof sagoae}`);
  }
  // 원자 daehan 은 이미 taegeuk+sagoae 전체를 뜻한다. sagoae=true 는 중앙
  // 파인더를 호출자가 따로 고르는 **분해 합성** 경로라 둘을 함께 켜면 같은 고리를
  // 두 번 주장한다. 회계는 같아도 광학 의미가 다르므로 조용히 합치지 않는다.
  if (sagoae && daehanFinder) {
    throw new RangeError('sagoae 와 daehanFinder 를 동시에 켤 수 없다 — 원자 daehan 이 sagoae 를 이미 포함한다');
  }
  // 와이어에는 sagoae 전용 formatIndex 가 없다. 기존 daehan 예약 레이아웃을
  // 그대로 공유하고, `sagoae` 메타만 장면에서 중앙/내곽을 분리하는 데 쓴다.
  const usesDaehanLayout = daehanFinder || sagoae;
  if (typeof markerTones !== 'boolean') {
    throw new TypeError(`markerTones 는 boolean 이어야 한다: ${typeof markerTones}`);
  }
  if (typeof centralV0 !== 'boolean') {
    throw new TypeError(`centralV0 는 boolean 이어야 한다: ${typeof centralV0}`);
  }
  // markerTones 는 «O-CM 이 예약한 자리» 에 심는 심볼(H)이다 — 자리 없이 심볼만 켤 수 없다.
  if (markerTones && !cornerMarker) {
    throw new RangeError('markerTones 는 cornerMarker(자리 예약) 없이 켤 수 없다');
  }
  // 코너 마커는 중앙 슬롯을 안 건드리지만, 중앙 QR 은 링3 을 먹고 마커는 링 k·k−1 을
  // 먹는다 — 두 변형의 동시 사용은 배치 검증을 안 했으므로 조용히 허용하지 않는다.
  // cornerMarker × centerQr — 원래 «배치 검증 미실시 조합» 으로 던졌는데, 배치 검증이
  // 끝나 개설됐다 (C2a 2026-08-23, PM/022 항목 1ⓑ): 마커 tetrad(링 k·k−1)와 중앙
  // 슬롯(ring ≤2)은 서로소이고 OMarker 재배치 셀이 중앙을 침범하지 않음을
  // test/markerG-centerqr.test.js 가 전 k 실측으로 잠근다. 와이어는 CMQ 6칸(markerG).
  // daehanFinder 는 와이어 플래그(광학+RS/CRC, formatIndex 공유). 분류 층에서는
  // taegeuk(내부 19, 분류 1) + sagoae(예약 셀, 분류 2) 로 갈린다. 중앙 QR(링3
  // 점유)과도, 코너 자리 예약(링 k·k−1 점유)과도 겹친다. 조합 검증을 안 했으므로
  // 조용히 허용하지 않는다.
  if (usesDaehanLayout && centerQr) {
    throw new RangeError('중앙 슬롯 점유자는 하나다 — daehan/sagoae 예약 레이아웃과 centerQr 를 동시에 켤 수 없다 — 검출 합성 미지원 조합이다');
  }
  if (usesDaehanLayout && cornerMarker) {
    throw new RangeError('중앙 슬롯 점유자는 하나다 — daehan/sagoae 예약 레이아웃과 cornerMarker 를 동시에 켤 수 없다 — 배치 검증 미실시 조합이다');
  }
  // 중앙 슬롯 점유자는 하나다. 중앙 v0는 중앙 QR·daehan과 같은 19셀을 쓴다.
  // cornerMarker(Type G)는 바깥 링 점유자라 v0와 함께 쓸 수 있으며 여기서 막지 않는다.
  if (centralV0 && centerQr) {
    throw new RangeError('중앙 슬롯 점유자는 하나다 — centralV0 와 centerQr 는 같은 19셀을 쓴다');
  }
  if (centralV0 && usesDaehanLayout) {
    throw new RangeError('중앙 슬롯 점유자는 하나다 — centralV0 와 daehan/sagoae 예약 레이아웃을 동시에 켤 수 없다 — 검출 합성 미지원 조합이다');
  }
  const provider = layoutProviderFor(cornerMarker, usesDaehanLayout, markerTones);

  const spec = version === undefined
    ? chooseVersion(text, eccLevel, cornerMarker, usesDaehanLayout)
    : provider.versions.find((v) => v.version === version);
  if (!spec) {
    throw new RangeError(`알 수 없는 버전: ${version} (허용 ${provider.versions.map((v) => v.version).join(', ')})`);
  }

  const capacity = provider.capacity(spec, eccLevel);
  const { k } = spec;

  // 길이 헤더 + 0x00 패딩 (header.js) → base-211 심볼 (base211.js).
  const framed = frame(text, capacity.dataBytes);
  const symbols = bytesToSymbols(framed);
  if (symbols.length !== capacity.dataSymbols) {
    // 조용히 맞추지 않는다 — 파이프라인 자기검증(과제 지침 절대 규칙).
    throw new RangeError(
      `심볼 개수 불일치: bytesToSymbols() ${symbols.length} !== capacity.dataSymbols ${capacity.dataSymbols}`,
    );
  }

  // RS(GF(211)) 패리티 부착 → 코드워드 = 데이터 심볼 ‖ 패리티, 길이 S(=usedSymbols).
  const codewordSymbols = rsEncode(symbols, capacity.nsym);
  if (codewordSymbols.length !== capacity.usedSymbols) {
    throw new RangeError(
      `코드워드 심볼 개수 불일치: rsEncode() ${codewordSymbols.length} !== capacity.usedSymbols ${capacity.usedSymbols}`,
    );
  }

  // 심볼 → 3 digit(MSD-first, 프리마스크) → scan order 좌표에 마스크 가산.
  //
  // `dataCellsInScanOrder(k)` 는 role === 'data' 인 셀 **전부**(= dataCells 개,
  // capacity.dataCells)를 돌려준다 — 그중 앞 3S 개가 실제 심볼 3-digit 그룹이고
  // 나머지 (residualCells 개, = `fillerCells(k)` 와 정확히 같은 셀)가 필러다
  // (layout.js `symbolCellGroups`/`fillerCells` 의 분할과 동일하게 여기서도 슬라이스한다).
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols); // 길이 3S
  const scanCells = provider.scan(k);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order 셀 수 불일치: dataCellsInScanOrder() ${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
    );
  }
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.q, c.r);
  }

  // 잔여 셀 = 프리마스크 0 에 마스크 가산(§5.6 필러). scan order 의 꼬리와 동일 셀.
  const fillerCoords = provider.filler(k);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: fillerCells() ${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.q, c.r);
  }

  // 포맷 정보(§5.4): 버전 인덱스 = version − 1(V1→0…), eccLevel 문자 → formatinfo 매핑.
  // centerQr(V*Q, ADR 0004 §1-3): 인덱스에 +4 오프셋 — V1Q=4·V2Q=5·V3Q=6. 이 인덱스는
  // 파인더 종류의 **사후 검증**이다(디코더가 발견한 파인더 종류와 복호 인덱스가
  // 일치하는지 대조) — 여기 인코더 쪽은 오프셋 부착까지만 한다.
  //
  // cornerMarker(O-CM): **내부 타입 G 의 전용 인덱스**를 싣는다 (`markerG.js` 표 주도,
  // 운영자 확정 2026-08-20). 레거시 인덱스를 그대로 쓰면 디코더가 마커 회계를 와이어에서
  // 알 수 없다 — 「코너 마커 코드가 스캔이 안 된다」의 근본 원인이었다. centerQr 조합은
  // G 표의 **CMQ 변형** (C2a 2026-08-23 — 배치 검증 후 개설, 회계는 CM 동일).
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  const versionIndex = cornerMarker
    ? markerGSpec('hex', spec.version, centerQr).formatIndex
    : (spec.version - 1) + (centerQr ? 4 : 0);
  const formatReplicas = encodeReplicated({ version: versionIndex, eccLevel: eccLevelValue });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(k) 순서와 정합

  // 셀별 digit + role 맵 (불스아이 셀은 애초에 어느 목록에도 없으므로 자동 제외).
  const cellDigits = new Map();

  // 앵커(+O-CM 이면 마커 9셀). 각 원소가 이미 digit 을 들고 있다 — 마스크 없음.
  // markerTones 프레임은 tones(절대 톤)도 함께 든다 — encodeA 의 마커 적재와 같은 계약.
  const fixedCells = provider.fixed(k);
  for (const c of fixedCells) {
    cellDigits.set(
      cellKey(c.q, c.r),
      c.tones ? { digit: c.digit, tones: c.tones, role: c.role } : { digit: c.digit, role: c.role },
    );
  }

  const references = provider.reference(k); // 전부 REFERENCE_DIGIT — 마스크 없음.
  for (const c of references) {
    cellDigits.set(cellKey(c.q, c.r), { digit: REFERENCE_DIGIT, role: 'reference' });
  }

  const formatCoords = provider.format(k);
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

  // 중앙 v0는 별도 데이터 레이아웃이 아니라 기존 중앙 슬롯의 새 점유자다. 그래도
  // O와 G 어느 공급자에서도 그 19셀이 payload로 되살아나지 않았음을 인코더 경계에서
  // 직접 단언한다. 좌표는 layout.js의 bullseye 정본에서 유도한다.
  if (centralV0) {
    for (const cell of centralSlotCells()) {
      if (cellDigits.has(cellKey(cell.q, cell.r))) {
        throw new Error(`centralV0 중앙 슬롯 셀이 데이터에 남았다: ${cellKey(cell.q, cell.r)}`);
      }
    }
  }

  return {
    version: spec.version,
    k,
    eccLevel,
    centerQr,
    centralV0,
    cornerMarker,
    // `daehanFinder` 는 후단 decodeCells 가 이미 쓰는 예약-레이아웃 회계 신호다.
    // 분해 합성도 같은 회계를 쓰므로 true 이고, 광학 구분은 `sagoae` 가 맡는다.
    daehanFinder: usesDaehanLayout,
    sagoae,
    markerTones,
    // capacity.formatIndex 는 표(VERSIONS_OCM 등)의 기본값이라 CMQ(C2a)에서 와이어와
    // 갈린다 — 산출물 메타데이터는 실제 실린 인덱스를 말해야 한다 (주장≠사실 방지).
    capacity: capacity.formatIndex !== undefined && capacity.formatIndex !== versionIndex
      ? Object.freeze({ ...capacity, formatIndex: versionIndex })
      : capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
