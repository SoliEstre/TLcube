/**
 * turnA.js — 턴A (타입 A 역삼각 옵션) formatIndex 배정 «표» — 유일한 진실.
 *
 * 운영자 확정 (015 §16, 2026-08-16 · oak 브리프 2026-08-17): 턴A 는 별도 타입이
 * 아니라 **타입 A 의 옵션**이고, 배정은 tri 표 안에서 소요하되 **반드시 표 주도**다.
 * A1=12 · A2=13 에 균일 오프셋을 주면 4bit(0..15) 를 넘치므로 (12+4=16 —
 * `test/turnA.test.js` 가 실측 고정) 산술 유도는 금지된다. 이 표가 배정의 전부이며,
 * 인코더·디코더 배선은 이 표를 읽는다 (배선은 통합자 몫 — 이 모듈은 아직 어디에도
 * 배선되지 않았고 MODULE_ORDER 미등재라 번들 바이트 영향이 없다).
 *
 * 배정 원리 (실측 회계 — `test/output/lanes/claude-oak-turna-probe.out.txt`):
 *   · hex(O)·tri(A) 는 **한 4bit 공간을 k 로 갈라 쓰는 축**이다 — 정본 전례:
 *     O V2=1(k8) 과 A0=1(k6) 이 같은 값을 쓴다 (decode.js «두 해석 만들고 k 로
 *     가른다»). 턴A 도 같은 기제만 쓴다 — **같은 (값, k) 쌍은 절대 겹치지 않는다.**
 *   · 7 은 쓰지 않는다 — K1 배정 잠정 확정 (015 §16).
 *   · 8·9·10·11 은 쓰지 않는다 — cube 축 값과 겹치고, tri↔cube 격자 수립 경로
 *     분리는 아직 실측 전 가설이다 (claude-k-contract.md §K-7).
 *   · 현행 tri 실점유 = {1(A0·k6), 3(A0Q·k6), 12(A1·k8), 14(A1Q·k8),
 *     13(A2·k10), 15(A2Q·k10)} — A0Q 는 실재한다 (encodeA(version 0, centerQr)
 *     실호출 확인). 따라서 턴A 최악 소요는 T×Q 전조합 = **6값**이다
 *     (015 §16 의 «최악 5값 ≤ 빈 값 11» 은 양쪽 수치가 실측과 다르다 — 무경합
 *     결론 자체는 유지된다. 정정 회계는 oak 프로그램 문서 ⑦).
 *   · {7, 8..11} 밖에서 hex·tri 가 전혀 안 쓰는 값은 {0,2,4,5,6} 5개뿐이라
 *     6번째 항목 하나는 tri 내부 값 재사용이 불가피하다 — A2TQ=3 이 유일한
 *     tri 내부 공유이고 A0Q(k6) 와 k 로 갈린다.
 *
 * 결과 표 (k6 행이 0..5 를 빈틈없이 채운다):
 *   k6 : 0=O V1 · 1=A0 · 2=**A0T** · 3=A0Q · 4=O V1Q · 5=**A0TQ**
 *   k8 : 1=O V2 · 4=**A1T** · 5=O V2Q · 6=**A1TQ** · 12=A1 · 14=A1Q
 *   k10: 0=**A2T** · 2=O V3 · 3=**A2TQ** · 6=O V3Q · 13=A2 · 15=A2Q
 */

import { VERSIONS_A } from './capacityA.js';
import { VERSIONS } from './capacity.js';

/** 턴A 배정 표 — 항목마다 값이 «표에 직접» 적혀 있다. 산술 유도 금지. */
export const TURN_A_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'A0T', version: 0, k: 6, centerQr: false, formatIndex: 2 }),
  Object.freeze({ name: 'A0TQ', version: 0, k: 6, centerQr: true, formatIndex: 5 }),
  Object.freeze({ name: 'A1T', version: 1, k: 8, centerQr: false, formatIndex: 4 }),
  Object.freeze({ name: 'A1TQ', version: 1, k: 8, centerQr: true, formatIndex: 6 }),
  Object.freeze({ name: 'A2T', version: 2, k: 10, centerQr: false, formatIndex: 0 }),
  Object.freeze({ name: 'A2TQ', version: 2, k: 10, centerQr: true, formatIndex: 3 }),
]);

/** K1 예약 (015 §16 잠정 확정) — 턴A 가 침범하면 안 되는 값. */
export const K1_RESERVED_FORMAT_INDEX = 7;
/** cube 축 점유 값 — tri↔cube 분리 실측 전이라 턴A 는 피한다. */
export const CUBE_AXIS_FORMAT_INDEXES = Object.freeze([8, 9, 10, 11]);

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

/** 턴A 항목 조회 — version + centerQr 로. 없으면 RangeError. */
export function turnASpec(version, options = {}) {
  const centerQr = options.centerQr === true;
  const spec = TURN_A_FORMAT_INDEX.find(
    (entry) => entry.version === version && entry.centerQr === centerQr,
  );
  if (!spec) {
    throw new RangeError('알 수 없는 턴A 버전: ' + version + (centerQr ? '+centerQr' : ''));
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
    if (CUBE_AXIS_FORMAT_INDEXES.includes(entry.formatIndex)) {
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
