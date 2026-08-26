/**
 * turnA.js — 내부 타입 **V** (턴A · 타입 A 역삼각) formatIndex 배정 «표» — 유일한 진실.
 *
 * 운영자 확정 (2026-08-24): **턴A = 내부 타입 V** — 내부 타입 G(코너 자리 예약,
 * `markerG.js`)와 동형이다: UI·분류상은 타입 A 그대로, formatIndex 만 전용 표.
 * ⚠ 015 §16 의 초판 문구 «별도 타입이 아니라 A 의 옵션, 배정은 tri 표 안에서 소요»
 * 는 이 확정으로 **대체**됐다 (G 도 «신설 안 함» 초판이 8/20 에 반증·대체된 전례 —
 * 배타 개설 정형). 와이어 값은 **동결**: 기존 6칸의 값·k·centerQr 은 발행분이라
 * 한 자리도 안 움직였고, **이름만** V 체계(V0/V0Q/V1/V1Q/V2/V2Q)로 재명명했다.
 * 배정은 **반드시 표 주도**다 — A1=12 · A2=13 에 균일 오프셋을 주면 4bit(0..15) 를
 * 넘치므로 (12+4=16 — `test/turnA.test.js` 가 실측 고정) 산술 유도는 금지된다.
 * 이 표가 배정의 전부이며, 인코더·디코더 배선은 이 표를 읽는다.
 *
 * 배정 원리 (실측 회계 — `test/output/lanes/claude-oak-turna-probe.out.txt`):
 *   · hex(O)·tri(A) 는 **한 4bit 공간을 k 로 갈라 쓰는 축**이다 — 정본 전례:
 *     O V2=1(k8) 과 A0=1(k6) 이 같은 값을 쓴다 (decode.js «두 해석 만들고 k 로
 *     가른다»). 턴A 도 같은 기제만 쓴다 — **같은 (값, k) 쌍은 절대 겹치지 않는다.**
 *   · 7 은 쓰지 않는다 — K1 배정 잠정 확정 (015 §16).
 *   · 8·9·10·11 은 쓰지 않는다 — hex·tri의 cube 기저 예약 정책 밴드다. cube 실점유
 *     전체는 이 넷이 아니라 `formatY.js`가 유도한 14값이다(F-90).
 *   · 현행 tri 실점유 = {1(A0·k6), 3(A0Q·k6), 12(A1·k8), 14(A1Q·k8),
 *     13(A2·k10), 15(A2Q·k10)} — A0Q 는 실재한다 (encodeA(version 0, centerQr)
 *     실호출 확인). 따라서 턴A 최악 소요는 T×Q 전조합 = **6값**이다
 *     (015 §16 의 «최악 5값 ≤ 빈 값 11» 은 양쪽 수치가 실측과 다르다 — 무경합
 *     결론 자체는 유지된다. 정정 회계는 oak 프로그램 문서 ⑦).
 *   · {7, 8..11} 밖에서 hex·tri 가 전혀 안 쓰는 값은 {0,2,4,5,6} 5개뿐이라
 *     6번째 항목 하나는 tri 내부 값 재사용이 불가피하다 — V2Q=3 이 유일한
 *     tri 내부 공유이고 A0Q(k6) 와 k 로 갈린다.
 *
 * 결과 표 (k6 행이 0..5 를 빈틈없이 채운다):
 *   k6 : 0=O V1 · 1=A0 · 2=**V0** · 3=A0Q · 4=O V1Q · 5=**V0Q**
 *   k8 : 1=O V2 · 4=**V1** · 5=O V2Q · 6=**V1Q** · 12=A1 · 14=A1Q
 *   k10: 0=**V2** · 2=O V3 · 3=**V2Q** · 6=O V3Q · 13=A2 · 15=A2Q
 */

import { VERSIONS_A } from './capacityA.js';
import { VERSIONS } from './capacity.js';
import {
  CUBE_AXIS_FORMAT_INDEXES,
  HEX_TRI_CUBE_RESERVED_FORMAT_INDEXES,
} from './formatY.js';

export { CUBE_AXIS_FORMAT_INDEXES } from './formatY.js';

/** 내부 타입 V 배정 표 — 항목마다 값이 «표에 직접» 적혀 있다. 산술 유도 금지.
 *  값·k·centerQr 은 발행 와이어라 **동결**이다 (2026-08-24 재명명 — 구명
 *  A0T/A0TQ/A1T/A1TQ/A2T/A2TQ 에서 이름 층만 V 체계로. 값 이동 0). */
export const TURN_A_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'V0', version: 0, k: 6, centerQr: false, formatIndex: 2 }),
  Object.freeze({ name: 'V0Q', version: 0, k: 6, centerQr: true, formatIndex: 5 }),
  Object.freeze({ name: 'V1', version: 1, k: 8, centerQr: false, formatIndex: 4 }),
  Object.freeze({ name: 'V1Q', version: 1, k: 8, centerQr: true, formatIndex: 6 }),
  Object.freeze({ name: 'V2', version: 2, k: 10, centerQr: false, formatIndex: 0 }),
  Object.freeze({ name: 'V2Q', version: 2, k: 10, centerQr: true, formatIndex: 3 }),
  /*
   * ── V-CM (턴A + 코너 자리 예약, 2026-08-24 말미 추가) ──────────────────────
   *
   * A-CM(markerG family=tri)의 턴A 대응 — 회계는 A-CM 과 동일(21셀 마커, VERSIONS_ACM)
   * 이고 기하만 턴A 사상(배치 180° 반전)이다 (markerA.markerCellsTurnA 대칭 유도).
   *
   * 값 배정 — markerG 반영 후 잔여 3칸이 정확히 이 셋이다 (markerG.js 헤더 §결과
   * 점유: k6 {14} · k8 {3} · k10 {5}). 아래 자기검증이 «이 배정 뒤 잔여 0» 을 잰다.
   *
   * ⚠ **V-CMQ 는 보류다** — 잔여 0 이라 앉힐 칸이 없다 (K1=7·cube 8..11 예약 침범
   *   금지). 그래서 turnA × cornerMarker × centerQr 조합은 인코더가 막는다
   *   (encodeA — G 의 CMQ 이전(pre-C2a) 상태와 같은 문법). 개설하려면 예약 축
   *   해제 또는 포맷 공간 확장이 선행돼야 한다 — 레인 T 보고서 §V-CMQ 회계.
   */
  Object.freeze({ name: 'V0CM', version: 0, k: 6, centerQr: false, cornerMarker: true, formatIndex: 14 }),
  Object.freeze({ name: 'V1CM', version: 1, k: 8, centerQr: false, cornerMarker: true, formatIndex: 3 }),
  Object.freeze({ name: 'V2CM', version: 2, k: 10, centerQr: false, cornerMarker: true, formatIndex: 5 }),
]);

/** K1 예약 (015 §16 잠정 확정) — 턴A 가 침범하면 안 되는 값. */
export const K1_RESERVED_FORMAT_INDEX = 7;
/** hex·tri가 비워 두는 cube 기저 정책 밴드. cube 실점유 전체는 formatY.js가 유도한다. */
export const CUBE_RESERVED_FORMAT_INDEXES = HEX_TRI_CUBE_RESERVED_FORMAT_INDEXES;

/**
 * 현행 hex·tri 축 점유를 (formatIndex, k) 쌍으로 전수 열거한다 — 코드 정본에서
 * 실계산 (capacity.VERSIONS 의 version−1/+4Q · capacityA.VERSIONS_A 의 기본/+2Q).
 */
export function hexTriAxisOccupancy() {
  const out = [];
  for (const spec of VERSIONS) {
    out.push({ owner: 'O V' + spec.version, formatIndex: spec.version - 1, k: spec.k });
    out.push({ owner: 'O V' + spec.version + 'Q', formatIndex: spec.version - 1 + 4, k: spec.k });
  }
  for (const spec of VERSIONS_A) {
    out.push({ owner: spec.name, formatIndex: spec.formatIndex, k: spec.k });
    out.push({ owner: spec.name + 'Q', formatIndex: spec.formatIndex + 2, k: spec.k });
  }
  return out;
}

/** 턴A 항목 조회 — version + centerQr (+cornerMarker) 로. 없으면 RangeError.
 *  cornerMarker=true + centerQr=true (V-CMQ) 는 잔여 칸 0 으로 **보류**라 항목이
 *  없다 — 조용한 폴백 없이 던진다 (표 헤더 §V-CM 회계). */
export function turnASpec(version, options = {}) {
  const centerQr = options.centerQr === true;
  const cornerMarker = options.cornerMarker === true;
  // **V-CMQ 는 V*CM 인덱스를 공유한다** (운영자 요구 2026-08-24 «중앙 QR 일 때
  // V-CM 선택 가능해야 됨», 실측 개설). 왜 새 칸을 안 만드나 — 못 만든다:
  // hex·tri (값,k) 공간은 48/48 로 **정확히 꽉 찼고**, 남은 것은 K1=7 과 cube 8..11
  // 예약뿐인데 그 둘은 formatK(star 축)·cube 축의 **교차 패밀리 가드**가 기대는
  // 자리다 (formatK.js 헤더 ①②). 그리고 **공유가 무해하다**: centerQr 는 셀 회계를
  // 바꾸지 않으므로(중앙 슬롯은 셀 밖) CM 해석과 CMQ 해석이 **같은 데이터 셀**을
  // 낸다 — 모호성이 원리적으로 없다. 실측: V0/V1/V2 × centerQr 왕복 원문 일치
  // (test/turnA-roundtrip.test.js §V-CMQ).
  let spec = TURN_A_FORMAT_INDEX.find(
    (entry) => entry.version === version && entry.centerQr === centerQr
      && (entry.cornerMarker === true) === cornerMarker,
  );
  if (!spec && cornerMarker && centerQr) {
    spec = TURN_A_FORMAT_INDEX.find(
      (entry) => entry.version === version && entry.cornerMarker === true,
    );
  }
  if (!spec) {
    throw new RangeError('알 수 없는 턴A 버전: ' + version
      + (centerQr ? '+centerQr' : '') + (cornerMarker ? '+cornerMarker' : ''));
  }
  return spec;
}

/** formatIndex + k → 턴A 항목 (디코더 측 역해석용). 없으면 null. */
export function turnASpecFromFormatIndex(formatIndex, k) {
  return TURN_A_FORMAT_INDEX.find(
    (entry) => entry.formatIndex === formatIndex && entry.k === k,
  ) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 (markerO 전례) — 표의 무경합 주장이 거짓이면 즉시 throw
// ─────────────────────────────────────────────────────────────────────────────
{
  const seen = new Map(); // "formatIndex|k" → owner
  const claim = (owner, formatIndex, k) => {
    if (!Number.isInteger(formatIndex) || formatIndex < 0 || formatIndex > 15) {
      throw new Error('turnA: formatIndex 4bit 범위 위반 — ' + owner + '=' + formatIndex);
    }
    const key = formatIndex + '|' + k;
    if (seen.has(key)) {
      throw new Error('turnA: (값,k) 경합 — ' + owner + ' 와 ' + seen.get(key)
        + ' 이 (' + formatIndex + ', k' + k + ') 를 겹쳐 쓴다');
    }
    seen.set(key, owner);
  };
  for (const occ of hexTriAxisOccupancy()) claim(occ.owner, occ.formatIndex, occ.k);
  for (const entry of TURN_A_FORMAT_INDEX) {
    if (entry.formatIndex === K1_RESERVED_FORMAT_INDEX) {
      throw new Error('turnA: K1 예약값 7 침범 — ' + entry.name);
    }
    if (CUBE_RESERVED_FORMAT_INDEXES.includes(entry.formatIndex)) {
      throw new Error('turnA: cube 축 값 침범 — ' + entry.name + '=' + entry.formatIndex);
    }
    claim(entry.name, entry.formatIndex, entry.k);
  }
  // 표의 k 는 기저 A 버전의 k 와 같아야 한다 (턴A 는 «옵션» — 격자 크기 동일)
  for (const entry of TURN_A_FORMAT_INDEX) {
    const base = VERSIONS_A.find((v) => v.version === entry.version);
    if (!base || base.k !== entry.k) {
      throw new Error('turnA: ' + entry.name + ' 의 k=' + entry.k
        + ' 가 기저 ' + (base ? base.name + ' k=' + base.k : '없음') + ' 과 다르다');
    }
  }
}
