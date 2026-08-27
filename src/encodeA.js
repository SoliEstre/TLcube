// encodeA.js — Type A 인코더 파이프라인 통합 (ADR 0005, encode.js 대칭)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 dataBytes까지) → base-211
// 심볼 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개
// → 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order-A(T3) 로 셀 배치 →
// 잔여 셀에 필러(프리마스크 0 + 마스크) → digit 확정까지. 배정(digit → (T,L,R)
// rank)·렌더는 다른 모듈 몫이다 — 여기서는 셀별 digit 확정까지만 한다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacityA.js/header.js/base211.js/rs211.js/
// mask.js/formatinfo.js/layoutA.js/placementA.js/placement.js(육각부 무수정 재사용)
// 가 이미 확정한 조각을 파이프라인 순서대로 조합만 한다.
//
// [D6 centerQr] formatIndex 는 VERSIONS_A 의 12(A1)/13(A2)에서 centerQr=true 면
// +2 오프셋(14=A1Q·15=A2Q) — 중앙 QR 파인더 변형(ADR 0004 §1-3 규약 승계, D7).
// 오버헤드·용량 수치는 centerQr 무관 동일하다(19셀 슬롯 기하 동일, D5 근거).

import { VERSIONS_A, VERSIONS_A_DAEHAN, capacityForA, capacityForADaehan, versionSpecA } from './capacityA.js';
import { turnASpec } from './turnA.js';
import { markerGSpec } from './markerG.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { dataCellsInScanOrderA, fillerCellsA } from './layoutA.js';
import { centralSlotCells } from './layout.js';
import { daehanReservedCells } from './finder-daehan.js';
import { anchorCells, referenceCellsAll, formatCells, REFERENCE_DIGIT } from './placement.js';
import { vertexAnchors, patchReferenceCells } from './placementA.js';
import {
  VERSIONS_ACM,
  capacityForAMarker,
  markerCellsA,
  h2oTonesByKeyA,
  patchReferenceCellsAMarker,
  dataCellsInScanOrderAMarker,
  fillerCellsAMarker,
} from './markerA.js';
import { co2SeatMarkerCellsA, co2SeatAnchorCellsA, CO2_NAME } from './finder-CO2.js';

/**
 * 레이아웃 공급자 — 레거시 A 와 A-CM(코너 마커)의 차이를 여기 한 곳에 모은다.
 * 파이프라인(헤더·base211·RS·마스크·포맷 정보)은 두 경로가 완전히 같다.
 * encode.js(Type O)의 `layoutProviderFor` 와 같은 구조다.
 *
 * `turnA` 는 **자리의 기본 심볼**만 가른다 (A-CM = H2O · V-CM = CO2). 회계
 * (versions·capacity·scan·filler·patchReference)는 두 자리가 완전히 같다 —
 * V-CM 은 A-CM 의 턴A 사상이고, CO2 의 마커 6셀은 A-CM 마커 21셀의 부분집합이다.
 */
function layoutProviderForA(cornerMarker, daehanFinder = false, turnA = false) {
  if (daehanFinder) {
    // daehan (2026-08-19) — 육각 코어는 Type O 와 좌표가 같고, 예약 셀은 패치에
    // 0개다 (실측). 그래서 layoutA 의 선택 인자로 넘기면 패치 꼬리는 그대로다.
    return {
      versions: VERSIONS_A_DAEHAN,
      capacity: capacityForADaehan,
      scan: (k) => dataCellsInScanOrderA(k, daehanReservedCells(k)),
      filler: (k) => fillerCellsA(k, daehanReservedCells(k)),
      patchReference: patchReferenceCells,
      marker: () => [],
    };
  }
  if (!cornerMarker) {
    return {
      versions: VERSIONS_A,
      capacity: capacityForA,
      scan: dataCellsInScanOrderA,
      filler: fillerCellsA,
      patchReference: patchReferenceCells,
      marker: () => [],
    };
  }
  return {
    versions: VERSIONS_ACM,
    capacity: capacityForAMarker,
    scan: dataCellsInScanOrderAMarker,
    filler: fillerCellsAMarker,
    patchReference: patchReferenceCellsAMarker,
    // 정본 H2O 톤을 싣는다 — Type A **자리 예약**에 들어가는 기본 파인더의 심볼이다
    // (비-순열 조합이라 데이터 셀이 만들 수 없는 무늬가 나온다). 2026-08-20 에 한 번
    // 껐다가 2026-08-21 에 되살렸다.
    //
    // ⚠ 그때 껐던 이유는 톤 자체가 아니라 **팔레트**였다 — 마커를 파인더 축
    // (bullseyeLight = 순백)으로 그려서 안전영역·흰 지면과 구별이 안 돼 실루엣에
    // 구멍이 났다. 고칠 곳은 `scene.js` 의 색이었고, 끄면서 **심볼까지 같이 지웠다.**
    // 지금은 색은 데이터와 같고(palette.levels) 무늬만 다르다 — 운영자 지시 그대로다.
    // H2O 는 확장 영역 파인더이지 중앙 3톤 큐브가 아니다. A-CM 이 H2O 의 중앙
    // 파인더를 버린 것이 아니다.
    //
    // ── V-CM (턴A 자리) 은 **CO2** 를 싣는다 (운영자 작화 2026-08-24 · 편입 같은 날).
    // 자리 21셀의 좌표·digit·역할은 A-CM 과 바이트 동일이고 (회계 불변), CO2 가
    // 덮는 마커 6셀만 tones 를 든다. 나머지 15셀은 **digit-only** — 정본에 그 자리의
    // 톤이 없어서다. 없는 값을 H2O 에서 빌려 오면 «한 자리에 심볼 두 개» 가 된다.
    //
    // ⚠ 이 전환은 검출을 **살렸다**: H2O 21셀 톤을 V-CM 에 그대로 싣던 종전 경로는
    // V0CM(k=6)이 전 해상도 no-anchors 였는데, CO2 로 바꾸자 ppu 10\~48 × supersample
    // 1·2 14점 중 13점에서 원문까지 돌아온다 (`test/turnA-roundtrip.test.js` V-CM 왕복).
    marker: turnA
      ? co2SeatMarkerCellsA
      : (k) => markerCellsA(k, h2oTonesByKeyA(k)),
  };
}

function cellKey(q, r) {
  return `${q},${r}`;
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS_A 항목을 고른다.
 * A2(ECC-eccLevel) 도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 * @returns {{name:string, version:number, k:number, formatIndex:number, overhead:number, symbolKey:string}}
 */
export function chooseVersionA(text, eccLevel = 'M') {
  const byteLength = payloadByteLength(text);
  for (const spec of VERSIONS_A) {
    const capacity = capacityForA(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = VERSIONS_A[VERSIONS_A.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 ${last.name}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * Type A 인코더 파이프라인 진입점. version 을 생략하면 `chooseVersionA` 로
 * 자동 선택한다.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H', centerQr?: boolean, centralV0?: boolean,
 *          centralN7?: boolean, daehanFinder?: boolean, sagoae?: boolean,
 *          co2AnchorTones?: boolean}} [options]
 *   `co2AnchorTones` — V-CM 기본 심볼 CO2 의 꼭짓점 앵커 3셀 톤까지 싣는다 (opt-in,
 *   자리 필수). 기본 적재는 마커 6셀뿐이다 — 앵커 피복은 앵커 검출을 죽인다.
 * @returns {{
 *   version: number, k: number, eccLevel: 'L'|'M'|'H', centerQr: boolean,
 *   centralV0: boolean, centralN7: boolean,
 *   daehanFinder: boolean, sagoae: boolean, co2AnchorTones: boolean, formatIndex: number,
 *   capacity: object,
 *   codewordSymbols: Uint8Array,
 *   dataDigits: Uint8Array,
 *   fillerDigits: Uint8Array,
 *   formatDigits: number[],
 *   cellDigits: Map<string, {digit:number, role:'anchor'|'reference'|'format'|'data'|'filler'}>,
 * }}
 */
export function encodeA(text, options = {}) {
  // encode.js(Type O) 전례: version 명시 경로가 chooseVersionA(→ payloadByteLength
  // 의 타입 검사)를 건너뛰면 TextEncoder 가 undefined → '' 로 조용히 강제 변환한다.
  // 두 경로의 판정을 여기서 먼저 일치시킨다.
  if (typeof text !== 'string') {
    throw new TypeError(`페이로드는 문자열이어야 한다: ${typeof text}`);
  }
  const {
    version, eccLevel = 'M', centerQr = false, centralV0 = false, centralN7 = false,
    cornerMarker = false, turnA = false,
    daehanFinder = false, sagoae = false, co2AnchorTones = false,
  } = options;
  if (typeof turnA !== 'boolean') {
    throw new TypeError(`turnA 는 boolean 이어야 한다: ${typeof turnA}`);
  }
  if (typeof daehanFinder !== 'boolean') {
    throw new TypeError(`daehanFinder 는 boolean 이어야 한다: ${typeof daehanFinder}`);
  }
  if (typeof sagoae !== 'boolean') {
    throw new TypeError(`sagoae 는 boolean 이어야 한다: ${typeof sagoae}`);
  }
  if (sagoae && daehanFinder) {
    throw new RangeError('sagoae 와 daehanFinder 를 동시에 켤 수 없다 — 원자 daehan 이 sagoae 를 이미 포함한다');
  }
  // Type O 와 같은 와이어 공유: sagoae 는 A*D 예약 레이아웃을 쓰고, 별도
  // formatIndex 를 만들지 않는다. 광학 합성 여부만 `sagoae` 메타로 남긴다.
  const usesDaehanLayout = daehanFinder || sagoae;
  // turnA × cornerMarker — **개설됐다** (V-CM, 2026-08-24 배타 개설 정형 3단):
  //   ① 근거 실측 — 마커 21셀은 전부 패치 안(A-CM §4)이고 턴A 사상(배치 반전,
  //      셀 정립)은 배치의 서로소성을 보존한다 (markerA ④ 자기검증 + 렌더 왕복 실측).
  //   ② 표 명시 확장 — V 표 말미 V0CM/V1CM/V2CM (turnA.js, 잔여 3칸 정확 소진).
  //   ③ 구 락(여기 있던 «배치 검증 미실시» 던짐)을 이 양성 경로로 전환.
  // V-CMQ — **개설** (2026-08-24 검수 4차). 구 «잔여 칸 0 보류» 는 «새 칸이
  // 필요하다» 는 전제가 틀렸다: V*CM 인덱스 공유가 무해하고 왕복이 선다
  // (turnA.js §turnASpec 의 근거·실측). 배타 개설 정형대로 락은 양성 단언으로.
  if (turnA && usesDaehanLayout) {
    throw new RangeError('turnA 와 daehan/sagoae 예약 레이아웃을 동시에 켤 수 없다 — 배치 검증 미실시 조합이다');
  }
  // co2AnchorTones — V-CM 기본 심볼 CO2 의 **꼭짓점 앵커 3셀** 톤을 추가로 싣는다.
  // 정본에는 그 3셀 톤이 있는데 **기본은 안 싣는다**: 앵커에 절대 톤을 실은 프레임은
  // digit 기반 앵커 검출이 거의 못 읽는다 (실측 2026-08-24 — 페이로드 4 × 버전 3 ×
  // ppu 2 = 24칸 중 2칸만 성공, 실패 20 이 no-anchors. 같은 격자에서 기본 적재는
  // 24/24). H 가 tetrad A 를 덮어 같은 공백을 가졌던 것과 정확히 같은 축이라
  // (`finder-H.js` §4 · `encode.js` markerTones) 같은 처방 — **opt-in** 으로 둔다.
  // 기본값 전환은 검출기 배선(통합자 몫)이 선 다음이다. 공백 잠금 finder-CO2.test ⑥.
  if (typeof co2AnchorTones !== 'boolean') {
    throw new TypeError(`co2AnchorTones 는 boolean 이어야 한다: ${typeof co2AnchorTones}`);
  }
  if (co2AnchorTones && !(turnA && cornerMarker)) {
    throw new RangeError(
      'co2AnchorTones 는 ' + CO2_NAME + ' 의 자리(V-CM = turnA + cornerMarker) 없이 못 켠다',
    );
  }
  if (typeof centerQr !== 'boolean') {
    throw new TypeError(`centerQr 는 boolean 이어야 한다: ${typeof centerQr}`);
  }
  if (typeof cornerMarker !== 'boolean') {
    throw new TypeError(`cornerMarker 는 boolean 이어야 한다: ${typeof cornerMarker}`);
  }
  // cornerMarker × centerQr — 배치 검증 후 개설 (C2a 2026-08-23, encode.js 와 동일
  // 근거 · 와이어는 markerG CMQ 변형). test/markerG-centerqr.test.js 가 잠근다.
  if (usesDaehanLayout && cornerMarker) {
    throw new RangeError('중앙 슬롯 점유자는 하나다 — daehan/sagoae 예약 레이아웃과 cornerMarker 를 동시에 켤 수 없다 — 배치 검증 미실시 조합이다');
  }
  // 중앙 v0 비컨 (2026-08-22 운영자 지시 «타입 OAK 모두») — A 의 육각 코어는 Type O
  // 와 좌표까지 같아(2026-08-19 실측, daehan 편입 근거) 중앙 19셀 슬롯 규약이 그대로
  // 성립한다. 회계도 O 와 같은 이유로 불변이다: 슬롯 셀은 애초에 어느 목록에도 없다.
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
    usesDaehanLayout ? 'daehan/sagoae' : null,
  ].filter(Boolean);
  if (centralSlotOccupants.length > 1) {
    throw new RangeError(
      `중앙 슬롯 점유자는 하나다 — ${centralSlotOccupants.join(' + ')} 를 동시에 켤 수 없다`,
    );
  }
  // centralV0 × turnA — **개설** (2026-08-24, 운영자 아침 검수 3차). 막던 근거는
  // «배치 검증 미실시» 였는데 턴A 기하가 «배치만 180° 회전·셀 정립» 으로 확정되며
  // 해소됐다: 비컨 슬롯은 중앙(회전 불변 위치)이고 회계상 셀 밖이라 turn 이 배치를
  // 건드릴 수 없다 (배치 검증 = 왕복 테스트 test/turnA-roundtrip.test.js ▽+비컨).
  const provider = layoutProviderForA(cornerMarker, usesDaehanLayout, turnA);

  let spec;
  if (version === undefined) {
    spec = provider.versions.find((v) => payloadByteLength(text) <= provider.capacity(v, eccLevel).maxPayloadBytes);
    if (!spec) {
      const last = provider.versions[provider.versions.length - 1];
      throw new RangeError(
        `페이로드 ${payloadByteLength(text)} B 는 ${last.name}(ECC-${eccLevel}) 용량을 초과한다`,
      );
    }
  } else {
    spec = provider.versions.find((v) => v.version === version);
    if (!spec) {
      throw new RangeError(`알 수 없는 Type A 버전 또는 용량 초과: ${version}`);
    }
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

  // 심볼 → 3 digit(MSD-first, 프리마스크) → scan order-A 좌표에 마스크 가산.
  //
  // `dataCellsInScanOrderA(k)` 는 role === 'data' 인 셀 **전부**(= dataCells 개,
  // capacity.dataCells)를 돌려준다 — 그중 앞 3S 개가 실제 심볼 3-digit 그룹이고
  // 나머지(residualCells 개, = `fillerCellsA(k)` 와 정확히 같은 셀)가 필러다
  // (layoutA.js `symbolCellGroupsA`/`fillerCellsA` 의 분할과 동일하게 슬라이스한다).
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols); // 길이 3S
  const scanCells = provider.scan(k);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order-A 셀 수 불일치: dataCellsInScanOrderA() ${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
    );
  }
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.q, c.r);
  }

  // 잔여 셀 = 프리마스크 0 에 마스크 가산(§5.6 준용). scan order-A 의 꼬리와 동일 셀.
  const fillerCoords = provider.filler(k);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: fillerCellsA() ${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.q, c.r);
  }

  // 포맷 정보(§5.4 승계, D6 네임스페이스): formatIndex(12~15) = spec.formatIndex +
  // centerQr(2) 오프셋 — 12=A1·13=A2·14=A1Q·15=A2Q. 이 인덱스는 파인더 종류
  // (불스아이 vs 중앙 QR)·실루엣(삼각 vs 육각)의 **사후 검증** 축이다(ADR 0004
  // "인덱스=사후 검증" 규약 승계, D6) — 인코더 쪽은 부착까지만 한다.
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  /*
   * formatIndex 산출 — 세 규약이 공존한다.
   *
   * ⓐ 정삼각 A (기본): `spec.formatIndex + centerQr*2` **산술 유도**.
   *    이것이 **발행 규약**이다 (A0 1 · A0Q 3 · A1 12 · A1Q 14 · A2 13 · A2Q 15).
   *    이미 돌아다니는 A 코드가 이 값으로 읽히므로 **한 자리도 못 바꾼다** —
   *    `test/turnA-wire-regression.test.js` 가 6벡터를 고정한다.
   *
   * ⓑ 턴A (역삼각 옵션): **표 주도**(`src/turnA.js`). 산술이 원리적으로 불가능하다 —
   *    A1=12 에 균일 오프셋 +4 를 주면 16 이라 4bit 를 넘친다. 그래서 표가 전부다.
   *
   * ⓒ 코너 마커 (내부 타입 G, A-CM): **표 주도**(`src/markerG.js`, 운영자 확정
   *    2026-08-20). 레거시 인덱스를 그대로 실으면 디코더가 마커 회계(21셀 차이)를
   *    와이어에서 구분할 수 없다 — 「코너 마커 코드가 스캔 불가」의 근본 원인.
   *    centerQr 와는 위 배타 가드가 조합을 막으므로 G 표에 Q 변형은 없다.
   *
   * 세 규약이 충돌하지 않는 이유: formatIndex 는 **(값, k) 쌍으로** 유일하면 되고
   *    (`decode.js` 의 typeO/typeA/typeY 별 해석 함수 + hex·tri 공유축 회계),
   *    턴A 는 역삼각 실루엣이라 정삼각 A 와 기하로 먼저 갈린다. G 는 빈 (값, k)
   *    칸만 쓴다 — `test/markerG.test.js` 의 코드-유도 충돌 테스트가 지킨다.
   *    운영자 확정 — «별도 타입처럼 취급하되 UI 상에만 같은 타입» (2026-08-18 턴A,
   *    2026-08-20 G 승계).
   */
  // ⚠ 중앙 v0 비컨은 formatIndex 에 손대지 않는다 — O 와 같은 결정이다 (와이어는
  //   표시층 불변, 「어떤 중앙 점유자인가」의 사후 검증 축은 비컨 메타 자신이 담당).
  // ⓑ′ V-CM (턴A + 코너 자리 예약): V 표 말미 행 — 회계·레이아웃은 A-CM 과 같고
  //     (provider 가 cornerMarker 로 이미 갈랐다) 와이어 값만 V 표가 가른다.
  const formatIndex = turnA
    ? turnASpec(spec.version, { centerQr, cornerMarker }).formatIndex
    : cornerMarker
      ? markerGSpec('tri', spec.version, centerQr).formatIndex
      : spec.formatIndex + (centerQr ? 2 : 0);
  const formatReplicas = encodeReplicated({ version: formatIndex, eccLevel: eccLevelValue });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(k) 순서와 정합

  // 셀별 digit + role 맵 (불스아이 셀은 애초에 어느 목록에도 없으므로 자동 제외).
  const cellDigits = new Map();

  // 앵커 = 육각 코너 3셀(보조, placement.js 무수정) + 꼭짓점 3셀(주, D2) = 6.
  const anchors = [...anchorCells(k), ...vertexAnchors(k)];
  for (const c of anchors) {
    cellDigits.set(cellKey(c.q, c.r), { digit: c.digit, role: 'anchor' });
  }

  // CO2 앵커 톤 오버레이 (opt-in) — digit 은 그대로 두고 `tones` 만 얹는다.
  // digit 은 와이어·알파벳 계약이고 tones 는 심볼 오버레이라 층이 다르다.
  if (co2AnchorTones) {
    for (const c of co2SeatAnchorCellsA(k)) {
      const kk = cellKey(c.q, c.r);
      const entry = cellDigits.get(kk);
      if (!entry || entry.role !== 'anchor' || entry.digit !== c.digit) {
        throw new Error(CO2_NAME + ' 앵커 톤 대상 ' + kk + ' 이 꼭짓점 앵커가 아니다');
      }
      cellDigits.set(kk, { ...entry, tones: c.tones });
    }
  }

  // 레퍼런스 = 육각 2(k-2)셀 + 패치 레퍼런스(규칙 R, D4) — 전부 REFERENCE_DIGIT.
  const references = [...referenceCellsAll(k), ...provider.patchReference(k)];
  for (const c of references) {
    cellDigits.set(cellKey(c.q, c.r), { digit: REFERENCE_DIGIT, role: 'reference' });
  }

  // 코너 마커 21셀 (A-CM 에서만) — 고정 digit, 마스크 없음. 꼭짓점 앵커와 안 겹친다.
  for (const c of provider.marker(k)) {
    cellDigits.set(cellKey(c.q, c.r), { digit: c.digit, tones: c.tones, role: 'marker' });
  }

  const formatCoords = formatCells(k); // 육각부 무수정 재사용(D7)
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

  // 중앙 v0·중앙 n=7: 슬롯 19셀이 payload 로 되살아나지 않았음을 인코더 경계에서 직접 단언
  // (encode.js 의 O 경로와 같은 방어 — 좌표 정본은 layout.js 하나).
  if (centralV0 || centralN7) {
    for (const cell of centralSlotCells()) {
      if (cellDigits.has(cellKey(cell.q, cell.r))) {
        const owner = centralV0 ? 'centralV0' : 'centralN7';
        throw new Error(`${owner} 중앙 슬롯 셀이 데이터에 남았다: ${cellKey(cell.q, cell.r)}`);
      }
    }
  }

  return {
    version: spec.version,
    k,
    eccLevel,
    centerQr,
    centralV0,
    centralN7,
    cornerMarker,
    turnA,
    daehanFinder: usesDaehanLayout,
    sagoae,
    co2AnchorTones,
    formatIndex,
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
