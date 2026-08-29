/**
 * markerG.js — 내부 타입 G (코너 **자리 예약**) formatIndex 배정 «표» — 유일한 진실.
 *
 * ⚠ 2026-08-21 운영자 정정: G 자체는 파인더가 아니다. O-CM / A-CM 자리 예약의
 *   와이어 인덱스 표다. 그 자리에 들어가는 기본 파인더는 Type G → **H**,
 *   Type A → **H2O**.
 *
 * 운영자 확정 (2026-08-20): 코너 자리 예약(O-CM / A-CM)은 **내부 타입 G** 로 분리한다.
 * 선례는 턴A 다 (`src/turnA.js`) — UI·분류상으로는 O/A 그대로지만 **내부적으로 자기
 * formatIndex 배정을 갖는다.** 이 표가 markerO.js §4 의 옛 계약(«formatIndex 를
 * 신설하지 않는다, 광학 검출 + 사후 RS/CRC 로 가른다»)을 **뒤집는다**: 실기 보고
 * 「코너 마커로 만든 코드가 스캔이 안 된다」의 근본 원인이 그 계약이었다 — CM 은
 * 레거시와 같은 인덱스를 실으므로 디코더가 마커 유무(= 회계·scan order 차이)를
 * 와이어에서 구분할 수 없었다. 019 의 교훈 그대로, 검출기 배선만으로는 효과가 0 이다.
 *
 * ⚠ 글자는 **G** 다. `Q` 를 쓰지 마라 — 이 저장소에서 Q 는 centerQr 를 뜻한다
 *   (A0Q · O V1Q · V2Q(턴A) 실재). 그리고 **포맷 v2 / 예비 비트(RESERVED_BITS_V2)로
 *   우회하지 않는다** — 그 경로는 hex 링 3 의 «15 포맷 + 2 레퍼런스» 계약을 깨고,
 *   검증되지 않은 «hex/tri 폴백 오독 0» 전제에 의존해 기각됐다 (운영자 결정).
 *
 * 배정 원리 (턴A 헤더의 기제 승계):
 *   · hex(O)·tri(A) 는 한 4bit 공간을 **(formatIndex, k) 쌍**으로 갈라 쓴다 —
 *     정본 전례: O V2=1(k8) 과 A0=1(k6). 값은 겹쳐도 (값, k) 쌍은 절대 안 겹친다.
 *   · **표 주도, 산술 유도 금지** — 턴A 가 실측으로 고정했듯(A1=12 에 균일 오프셋
 *     +4 는 4bit 를 넘친다) 이 공간엔 균일 규칙이 살아남을 자리가 없다. 값은 아래
 *     표에 직접 적혀 있고, 정합성은 로드 시점 자기검증 + `test/markerG.test.js` 의
 *     코드-유도 충돌 테스트가 지킨다 (목록 손 관리 금지 — 이 저장소 최다 결함).
 *   · 7 은 쓰지 않는다 — K1 예약 (015 §16). 8..11 은 쓰지 않는다 — hex·tri의
 *     cube 기저 예약 정책 밴드다. cube 실점유 전체는 `formatY.js`가 유도한다.
 *   · **Q(centerQr) 변형 — 있다** (C2a, 2026-08-23 · PM/022 항목 1ⓑ): 원판은
 *     «배치 검증 미실시 조합» 이라 인코더가 던졌는데, 배치 검증이 끝났다 —
 *     centerQr 는 셀 회계를 바꾸지 않고(중앙 슬롯은 애초에 셀 밖 — V*Q 전례),
 *     마커 tetrad(링 k·k−1)와 중앙 슬롯(ring ≤2)은 전 k 에서 서로소이며,
 *     OMarker/AMarker 의 재배치 format·reference 셀이 중앙 슬롯을 침범하지 않음을
 *     `test/markerG-centerqr.test.js` 가 전 k 실측으로 잠근다. 그래서 타입당
 *     3칸(CM) + 3칸(CMQ) = 6칸씩이다.
 *
 * O-CM / A-CM 을 **가른다** (6칸, 묶으면 3칸):
 *   현행 점유는 (formatIndex, k) 쌍마다 소유자가 정확히 하나다 — 패밀리는 키에
 *   없다 (`formatindex-occupancy.mjs` 실측: hex·tri 합산 충돌 0). O-CM 과 A-CM 을
 *   같은 값에 묶으면 같은 (값, k) 쌍에 두 패밀리 소유자가 생겨 이 관례가 처음으로
 *   깨지고, 역조회(`markerGSpecFromFormatIndex`)와 점유 회계 전부에 패밀리 축을
 *   새로 끼워야 한다. 빈 칸 15개에 6칸은 넉넉하므로(잔여 9) 관례 보존이 싸다.
 *
 * 값 선택 (빈 칸: k6 {6,12,13,14,15} · k8 {0,2,3,13,15} · k10 {1,4,5,12,14}):
 *   · hex(O-CM) 는 레거시 O 가 사는 **저대역(0..6)** 에 둔다 — V1CM=6 은 k6 의
 *     유일한 저대역 빈 칸이고(k6 행 0..5 는 턴A 가 채웠다), V2CM=0 · V3CM=1 은
 *     각 k 의 최소 빈 값이다. 덤으로 값 0 행(O V1·V2(턴A))과 1 행(A0·O V2)이 가득 찬다.
 *   · tri(A-CM) 는 레거시 A 기저(A1=12·A2=13)가 사는 **고대역(12..15)** 에서
 *     **연속 배정 12+version** 으로 둔다 — A0CM=12(k6) · A1CM=13(k8) ·
 *     A2CM=14(k10). 외우기 쉽고, 점유표에서 패밀리 대역이 눈으로 갈린다.
 *
 * CMQ 값 선택 (C2a — CM 반영 후 빈 칸 9 = k6 {13,14,15} · k8 {2,3,15} · k10 {4,5,12}):
 *   · hex(O-CM+Q) 는 각 k 의 **최소 빈 값** — V1CMQ=13(k6, 저대역이 이미 만석) ·
 *     V2CMQ=2(k8) · V3CMQ=4(k10).
 *   · tri(A-CM+Q) 는 **고대역** — A0CMQ=15(k6) · A1CMQ=15(k8) · A2CMQ=12(k10,
 *     A 기저 대역 12..15 안).
 *
 * 결과 점유 (CM+CMQ 반영 후): 빈 칸 3 = k6 {14} · k8 {3} · k10 {5}.
 */

import { VERSIONS } from './capacity.js';
import { VERSIONS_A } from './capacityA.js';
import {
  TURN_A_FORMAT_INDEX,
  K1_RESERVED_FORMAT_INDEX,
  CUBE_RESERVED_FORMAT_INDEXES,
  hexTriAxisOccupancy,
} from './turnA.js';

/** 내부 타입 G 배정 표 — 항목마다 값이 «표에 직접» 적혀 있다. 산술 유도 금지.
 *
 * `defaultFinder` (운영자 결정 2026-08-21): CM 은 파인더가 아니라 **자리 예약**이고,
 * 그 자리에 들어가는 **심볼**이 기본 파인더다 — hex(O-CM 12셀 자리)는 **H**
 * (`finder-H.js`), tri(A-CM 21셀 자리)는 **H2O** (`markerA.js` H2O_LOCAL_TONES_A).
 * 톤 표는 각 모듈이 유일한 진실이고, 여기는 배정만 든다 (finder-H 로드 자기검증이
 * hex 열을, 아래 자기검증이 패밀리 내 일관성을 강제한다). */
export const MARKER_G_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'V1CM', family: 'hex', version: 1, k: 6, formatIndex: 6, centerQr: false, defaultFinder: 'H' }),
  Object.freeze({ name: 'V2CM', family: 'hex', version: 2, k: 8, formatIndex: 0, centerQr: false, defaultFinder: 'H' }),
  Object.freeze({ name: 'V3CM', family: 'hex', version: 3, k: 10, formatIndex: 1, centerQr: false, defaultFinder: 'H' }),
  Object.freeze({ name: 'A0CM', family: 'tri', version: 0, k: 6, formatIndex: 12, centerQr: false, defaultFinder: 'H2O' }),
  Object.freeze({ name: 'A1CM', family: 'tri', version: 1, k: 8, formatIndex: 13, centerQr: false, defaultFinder: 'H2O' }),
  Object.freeze({ name: 'A2CM', family: 'tri', version: 2, k: 10, formatIndex: 14, centerQr: false, defaultFinder: 'H2O' }),
  // CM+Q (C2a, 2026-08-23) — 자리 예약 + 중앙 QR. 회계는 CM 과 동일(중앙은 셀 밖),
  // 와이어만 가른다. defaultFinder 는 자리(코너) 심볼이라 CM 과 같다 — 중앙은 QR.
  Object.freeze({ name: 'V1CMQ', family: 'hex', version: 1, k: 6, formatIndex: 13, centerQr: true, defaultFinder: 'H' }),
  Object.freeze({ name: 'V2CMQ', family: 'hex', version: 2, k: 8, formatIndex: 2, centerQr: true, defaultFinder: 'H' }),
  Object.freeze({ name: 'V3CMQ', family: 'hex', version: 3, k: 10, formatIndex: 4, centerQr: true, defaultFinder: 'H' }),
  Object.freeze({ name: 'A0CMQ', family: 'tri', version: 0, k: 6, formatIndex: 15, centerQr: true, defaultFinder: 'H2O' }),
  Object.freeze({ name: 'A1CMQ', family: 'tri', version: 1, k: 8, formatIndex: 15, centerQr: true, defaultFinder: 'H2O' }),
  Object.freeze({ name: 'A2CMQ', family: 'tri', version: 2, k: 10, formatIndex: 12, centerQr: true, defaultFinder: 'H2O' }),
  // ── V4 «대용량» (hex, k=12 — 2026-08-30) ──────────────────────────────────
  //
  // **k=12 는 (값,k) 공간의 새 행이다.** 위 「결과 점유 … 빈 칸 3」·「잔여 0」 회계는
  // 전부 k6/k8/k10 세 행 이야기이고 k=12 와는 아무 관계가 없다 — 새 k 는 16칸을
  // 통째로 새로 연다. 그래서 V-CMQ 가 보류된 이유(앉힐 칸 없음)가 여기엔 없다.
  //
  // k=12 의 사전 점유는 hex 기저 축뿐이다: 3 = V4 · 7 = V4Q (`hexTriAxisOccupancy`
  // 의 version−1 / +4 유도). 예약 밴드(K1=7 · cube 8..11)를 빼면 빈 칸은
  // {0,1,2,4,5,6,12,13,14,15} 10칸이다. 값 7 은 V4Q 가 가져가는데, 이는 K 예약과
  // 충돌하지 않는다 — 예약의 실질은 **(값,k) 쌍**이고 star 축은 k6/k8/k10 에만
  // 산다 (`formatK.js` 로드 가드가 K_FORMAT_INDEX 의 k 에 대해서만 잰다). 그리고
  // `test/namespace.test.js` 의 HEX_RESERVED 가 3·7 을 애초에 V4·V4Q 로 예약해 뒀다.
  //
  // 값 선택은 위 §값 선택 규칙 그대로다 — hex(O-CM)는 **각 k 의 최소 빈 값**:
  // V4CM = 0 · V4CMQ = 1.
  Object.freeze({ name: 'V4CM', family: 'hex', version: 4, k: 12, formatIndex: 0, centerQr: false, defaultFinder: 'H' }),
  Object.freeze({ name: 'V4CMQ', family: 'hex', version: 4, k: 12, formatIndex: 1, centerQr: true, defaultFinder: 'H' }),
]);

/**
 * G 항목 조회 — 인코더 측. family('hex'|'tri') + version + centerQr(기본 false —
 * 기존 소비자 무변경). 없으면 RangeError — 조용한 레거시 폴백은 «와이어에 신호가
 * 없다» 는 원래 결함의 재생산이다.
 */
export function markerGSpec(family, version, centerQr = false) {
  const spec = MARKER_G_FORMAT_INDEX.find(
    (entry) => entry.family === family && entry.version === version
      && entry.centerQr === centerQr,
  );
  if (!spec) {
    throw new RangeError('알 수 없는 내부 타입 G 항목: ' + family + ' version ' + version
      + (centerQr ? ' (+Q)' : ''));
  }
  return spec;
}

/**
 * formatIndex + k → G 항목 (디코더 측 역해석). 없으면 null.
 * (formatIndex, k) 쌍은 전 표(hex·tri 실배선 + 턴A + G) 에서 유일하므로 패밀리
 * 없이 결정된다 — 호출자는 entry.family 로 자기 패밀리 소유인지 대조한다.
 */
export function markerGSpecFromFormatIndex(formatIndex, k) {
  return MARKER_G_FORMAT_INDEX.find(
    (entry) => entry.formatIndex === formatIndex && entry.k === k,
  ) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 (턴A 전례) — 표의 무경합 주장이 거짓이면 즉시 throw
// ─────────────────────────────────────────────────────────────────────────────
{
  const seen = new Map(); // "formatIndex|k" → owner
  const claim = (owner, formatIndex, k) => {
    if (!Number.isInteger(formatIndex) || formatIndex < 0 || formatIndex > 15) {
      throw new Error('markerG: formatIndex 4bit 범위 위반 — ' + owner + '=' + formatIndex);
    }
    const key = formatIndex + '|' + k;
    if (seen.has(key)) {
      throw new Error('markerG: (값,k) 경합 — ' + owner + ' 와 ' + seen.get(key)
        + ' 이 (' + formatIndex + ', k' + k + ') 를 겹쳐 쓴다');
    }
    seen.set(key, owner);
  };
  for (const occ of hexTriAxisOccupancy()) claim(occ.owner, occ.formatIndex, occ.k);
  for (const entry of TURN_A_FORMAT_INDEX) claim(entry.name, entry.formatIndex, entry.k);
  for (const entry of MARKER_G_FORMAT_INDEX) {
    if (entry.formatIndex === K1_RESERVED_FORMAT_INDEX) {
      throw new Error('markerG: K1 예약값 7 침범 — ' + entry.name);
    }
    if (CUBE_RESERVED_FORMAT_INDEXES.includes(entry.formatIndex)) {
      throw new Error('markerG: cube 축 값 침범 — ' + entry.name + '=' + entry.formatIndex);
    }
    claim(entry.name, entry.formatIndex, entry.k);
  }
  // 표의 k 는 기저 버전의 k 와 같아야 한다 (G 는 «옵션» — 격자 크기 동일, 턴A 전례).
  for (const entry of MARKER_G_FORMAT_INDEX) {
    const base = entry.family === 'hex'
      ? VERSIONS.find((v) => v.version === entry.version)
      : VERSIONS_A.find((v) => v.version === entry.version);
    if (!base || base.k !== entry.k) {
      throw new Error('markerG: ' + entry.name + ' 의 k=' + entry.k
        + ' 가 기저 버전 k=' + (base ? base.k : '없음') + ' 와 다르다');
    }
  }
  // 포맷 공간 회계 (2026-08-24 V-CM 편입) — G 12칸 + 턴A V 표(6 + V-CM 3) 반영 후
  // k6/k8/k10 의 **잔여 0** 을 못 박는다. V-CMQ 보류의 산술 근거가 이 단언이다:
  // 다음 소비자는 여기가 던지는 것을 보고 «빈 칸이 없다» 를 코드에서 확인하게 된다.
  //
  // ⚠ **만석을 주장하는 k 와 안 하는 k 를 둘 다 잰다.** k=12(V4, 2026-08-30)는 새로
  // 연 행이라 빈 칸이 남아 있는 것이 정상이고, 그냥 루프에서 빼 두면 «빠뜨렸다» 와
  // «비어 있기로 했다» 가 똑같이 생긴다. 그래서 비-만석 k 에 대해서는 반대 방향
  // 단언(«예고 없이 만석이 되면 던진다»)을 건다. k 목록 자체는 표에서 유도한다 —
  // 손 사본을 두면 다음 k 가 늘 때 이 검사만 뒤처진다.
  {
    const banned = new Set([K1_RESERVED_FORMAT_INDEX, ...CUBE_RESERVED_FORMAT_INDEXES]);
    /** 「48/48 꽉 찼다」를 주장하는 k — V1~V3 시절 회계. 여기 없는 k 는 여유가 있다. */
    const SATURATED_KS = Object.freeze([6, 8, 10]);
    const tableKs = Array.from(new Set(MARKER_G_FORMAT_INDEX.map((entry) => entry.k)))
      .sort((a, b) => a - b);
    for (const k of tableKs) {
      let free = 0;
      for (let value = 0; value <= 15; value += 1) {
        if (banned.has(value)) continue;
        if (!seen.has(value + '|' + k)) free += 1;
      }
      if (SATURATED_KS.includes(k)) {
        if (free !== 0) {
          throw new Error('markerG: k' + k + ' 잔여 칸이 ' + free
            + ' — 점유 회계가 «잔여 0» 주장과 다르다 (V-CMQ 보류 근거 재검토)');
        }
      } else if (free === 0) {
        throw new Error('markerG: k' + k + ' 이 예고 없이 만석 — 새 행을 앉힐 칸이 없다;'
          + ' SATURATED_KS 에 넣고 그 사실을 헤더에 적어라');
      }
    }
  }
  // (family, version, centerQr) 커버리지 — 기저 버전×Q축마다 정확히 한 항목
  // (빠지면 인코더가 던진다).
  for (const spec of VERSIONS) {
    markerGSpec('hex', spec.version, false);
    markerGSpec('hex', spec.version, true);
  }
  for (const spec of VERSIONS_A) {
    markerGSpec('tri', spec.version, false);
    markerGSpec('tri', spec.version, true);
  }
  // defaultFinder — 항목마다 비어 있지 않고, 같은 패밀리(= 같은 자리 모양)는 같은
  // 심볼을 든다. 값 자체(H·H2O)는 심볼 모듈의 로드 자기검증이 대조한다.
  for (const entry of MARKER_G_FORMAT_INDEX) {
    if (typeof entry.defaultFinder !== 'string' || entry.defaultFinder === '') {
      throw new Error('markerG: ' + entry.name + ' 의 defaultFinder 가 비었다');
    }
  }
  for (const family of ['hex', 'tri']) {
    const symbols = new Set(MARKER_G_FORMAT_INDEX
      .filter((entry) => entry.family === family)
      .map((entry) => entry.defaultFinder));
    if (symbols.size !== 1) {
      throw new Error('markerG: ' + family + ' 패밀리의 defaultFinder 가 갈린다 — ' + [...symbols].join(','));
    }
  }
}
