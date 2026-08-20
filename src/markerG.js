/**
 * markerG.js — 내부 타입 G (코너 마커) formatIndex 배정 «표» — 유일한 진실.
 *
 * 운영자 확정 (2026-08-20): 코너 마커(O-CM / A-CM)는 **내부 타입 G** 로 분리한다.
 * 선례는 턴A 다 (`src/turnA.js`) — UI·분류상으로는 O/A 그대로지만 **내부적으로 자기
 * formatIndex 배정을 갖는다.** 이 표가 markerO.js §4 의 옛 계약(«formatIndex 를
 * 신설하지 않는다, 광학 검출 + 사후 RS/CRC 로 가른다»)을 **뒤집는다**: 실기 보고
 * 「코너 마커로 만든 코드가 스캔이 안 된다」의 근본 원인이 그 계약이었다 — CM 은
 * 레거시와 같은 인덱스를 실으므로 디코더가 마커 유무(= 회계·scan order 차이)를
 * 와이어에서 구분할 수 없었다. 019 의 교훈 그대로, 검출기 배선만으로는 효과가 0 이다.
 *
 * ⚠ 글자는 **G** 다. `Q` 를 쓰지 마라 — 이 저장소에서 Q 는 centerQr 를 뜻한다
 *   (A0Q · O V1Q · A2TQ 실재). 그리고 **포맷 v2 / 예비 비트(RESERVED_BITS_V2)로
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
 *   · 7 은 쓰지 않는다 — K1 예약 (015 §16). 8..11 은 쓰지 않는다 — cube 축.
 *   · **Q(centerQr) 변형은 없다** — cornerMarker × centerQr 는 인코더가 던진다
 *     (`encode.js` · `encodeA.js` 의 배타 가드, 배치 검증 미실시 조합). 그래서
 *     타입당 3칸이면 족하다.
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
 *     각 k 의 최소 빈 값이다. 덤으로 값 0 행(O V1·A2T)과 1 행(A0·O V2)이 가득 찬다.
 *   · tri(A-CM) 는 레거시 A 기저(A1=12·A2=13)가 사는 **고대역(12..15)** 에서
 *     **연속 배정 12+version** 으로 둔다 — A0CM=12(k6) · A1CM=13(k8) ·
 *     A2CM=14(k10). 외우기 쉽고, 점유표에서 패밀리 대역이 눈으로 갈린다.
 *
 * 결과 점유 (이 표 반영 후): 빈 칸 9 = k6 {13,14,15} · k8 {2,3,15} · k10 {4,5,12}.
 */

import { VERSIONS } from './capacity.js';
import { VERSIONS_A } from './capacityA.js';
import {
  TURN_A_FORMAT_INDEX,
  K1_RESERVED_FORMAT_INDEX,
  CUBE_AXIS_FORMAT_INDEXES,
  hexTriAxisOccupancy,
} from './turnA.js';

/** 내부 타입 G 배정 표 — 항목마다 값이 «표에 직접» 적혀 있다. 산술 유도 금지. */
export const MARKER_G_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'V1CM', family: 'hex', version: 1, k: 6, formatIndex: 6 }),
  Object.freeze({ name: 'V2CM', family: 'hex', version: 2, k: 8, formatIndex: 0 }),
  Object.freeze({ name: 'V3CM', family: 'hex', version: 3, k: 10, formatIndex: 1 }),
  Object.freeze({ name: 'A0CM', family: 'tri', version: 0, k: 6, formatIndex: 12 }),
  Object.freeze({ name: 'A1CM', family: 'tri', version: 1, k: 8, formatIndex: 13 }),
  Object.freeze({ name: 'A2CM', family: 'tri', version: 2, k: 10, formatIndex: 14 }),
]);

/**
 * G 항목 조회 — 인코더 측. family('hex'|'tri') + version. 없으면 RangeError —
 * 조용한 레거시 폴백은 «와이어에 신호가 없다» 는 원래 결함의 재생산이다.
 */
export function markerGSpec(family, version) {
  const spec = MARKER_G_FORMAT_INDEX.find(
    (entry) => entry.family === family && entry.version === version,
  );
  if (!spec) {
    throw new RangeError('알 수 없는 내부 타입 G 항목: ' + family + ' version ' + version);
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
    if (CUBE_AXIS_FORMAT_INDEXES.includes(entry.formatIndex)) {
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
  // (family, version) 커버리지 — 기저 버전마다 정확히 한 항목 (빠지면 인코더가 던진다).
  for (const spec of VERSIONS) markerGSpec('hex', spec.version);
  for (const spec of VERSIONS_A) markerGSpec('tri', spec.version);
}
