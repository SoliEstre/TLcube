/**
 * formatK.js — Type K(육각별) formatIndex 배정 «표» — 유일한 진실.
 *
 * [축] K 는 **패밀리별 독립 표** 원칙(ADR 0006 D3 — 4bit 는 격자 수립 경로별 독립
 * 표)의 자체 공간(star 축)이다. 육각별 실루엣 + 별 꼭짓점 6앵커(5/0/0·1/1/1)가
 * hex/tri/cube 와 다른 격자 수립 경로를 이루므로 값 재사용이 원리적으로 안전하다 —
 * cube 축이 같은 논거로 분리됐다. hex·tri 축의 «7 = K1 예약»(turnA.js
 * K1_RESERVED_FORMAT_INDEX)은 **침범 방지용 예약이지 이 표가 아니다** (통합자
 * 확정 2026-08-24 — 015 §16 의 hex·tri 공유축 가정을 대체).
 *
 * [값 선택 — 전 버전 7, k 로 가른다] star 축 안에서는 어떤 값이든 쓸 수 있지만,
 * **7 하나를 전 버전이 공유**하고 (값,k) 로 가른다 — hex 축의 정본 전례(O V2=1(k8)
 * 과 A0=1(k6), decode.js «두 해석 만들고 k 로 가른다») 그대로다. 7 을 고른 이유는
 * 이중 안전이다: hex·tri 축은 7 을 영구 예약으로 비워 두므로(turnA.js 로드
 * 자기검증이 지킨다) ① K 프레임이 tri/hex 로 오분류돼도 포맷 값 7 이 그 축들의
 * validVersionIndices 에 없어 **포맷 단계에서** 죽고, ② 역방향(O/A 프레임이 star
 * 로 오분류)도 그 프레임의 값(0..6·12..15)이 star 축(=7)에 없어 같은 단계에서
 * 죽는다. 축 분리 논거가 실측 전이어도 (값,k) 충돌이 아예 없는 배치다.
 *
 * 배정은 **반드시 표 주도**다 (turnA.js/markerG.js 문법) — 아래 표가 배정의
 * 전부이며, 인코더(encodeK.js)·디코더(decoder/decode-k.js·bootstrap.js)는 이 표를
 * 읽는다. 로드 시점 자기검증이 표의 주장을 잰다.
 *
 * [K-CM 예약] 코너 마커(K-CM) 변형은 이 star 축 안에서 별도 (값,k) 를 배정한다 —
 * 마커 발자국·회계가 확정되면(계약 K-8.1 fixed 회계 미해소) 표 말미에 행을 추가
 * 한다. 이 레인은 K-CM 행을 점유하지 않았다 (레인 보고서 §보류).
 */

import { hexTriAxisOccupancy, K1_RESERVED_FORMAT_INDEX, TURN_A_FORMAT_INDEX } from './turnA.js';
import { MARKER_G_FORMAT_INDEX } from './markerG.js';

/** Type K formatIndex 배정 표 (star 축) — 항목마다 값이 «표에 직접» 적혀 있다. */
export const K_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'K0', version: 0, k: 6, formatIndex: 7 }),
  Object.freeze({ name: 'K1', version: 1, k: 8, formatIndex: 7 }),
  Object.freeze({ name: 'K2', version: 2, k: 10, formatIndex: 7 }),
]);

/** version → K 표 항목. 없으면 RangeError. */
export function kFormatSpec(version) {
  const spec = K_FORMAT_INDEX.find((entry) => entry.version === version);
  if (!spec) {
    throw new RangeError('알 수 없는 Type K 버전: ' + version
      + ' (허용 ' + K_FORMAT_INDEX.map((entry) => `${entry.name}(v${entry.version})`).join(', ') + ')');
  }
  return spec;
}

/** formatIndex + k → K 표 항목 (디코더 측 역해석용). 없으면 null. */
export function kSpecFromFormatIndex(formatIndex, k) {
  return K_FORMAT_INDEX.find(
    (entry) => entry.formatIndex === formatIndex && entry.k === k,
  ) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 (turnA/markerG 전례) — 표의 주장이 거짓이면 즉시 throw
// ─────────────────────────────────────────────────────────────────────────────
{
  const seen = new Map(); // "formatIndex|k" → name (star 축 내부 유일성)
  for (const entry of K_FORMAT_INDEX) {
    if (!Number.isInteger(entry.formatIndex) || entry.formatIndex < 0 || entry.formatIndex > 15) {
      throw new Error('formatK: formatIndex 4bit 범위 위반 — ' + entry.name + '=' + entry.formatIndex);
    }
    const pairKey = entry.formatIndex + '|' + entry.k;
    if (seen.has(pairKey)) {
      throw new Error('formatK: star 축 (값,k) 경합 — ' + entry.name + ' 와 ' + seen.get(pairKey));
    }
    seen.set(pairKey, entry.name);
  }
  // 이중 안전의 전제 검증 ① — 이 표의 값은 hex·tri 축의 K 예약값 그대로여야 하고
  // (예약이 아닌 값을 쓰면 «포맷 단계 조기 사멸» 논거의 절반이 사라진다),
  const offReserve = K_FORMAT_INDEX.filter((entry) => entry.formatIndex !== K1_RESERVED_FORMAT_INDEX);
  if (offReserve.length > 0) {
    throw new Error('formatK: 예약값 ' + K1_RESERVED_FORMAT_INDEX + ' 밖의 값을 쓴다 — '
      + offReserve.map((entry) => entry.name + '=' + entry.formatIndex).join(', ')
      + ' (의도한 확장이면 헤더 §값 선택 논거와 이 검증을 함께 갱신하라)');
  }
  // ② — hex·tri 축(기본표 + 턴A V 표 + G 표 전체)이 실제로 그 (값,k) 를 비워 두고
  // 있는가 (코드 정본에서 실계산 — turnA/markerG 의 «7 침범 금지» 자기검증과 겹으로).
  const hexTriAll = [
    ...hexTriAxisOccupancy(),
    ...TURN_A_FORMAT_INDEX.map((entry) => ({ owner: entry.name, formatIndex: entry.formatIndex, k: entry.k })),
    ...MARKER_G_FORMAT_INDEX.map((entry) => ({ owner: entry.name, formatIndex: entry.formatIndex, k: entry.k })),
  ];
  for (const occ of hexTriAll) {
    for (const entry of K_FORMAT_INDEX) {
      if (occ.formatIndex === entry.formatIndex && occ.k === entry.k) {
        throw new Error('formatK: hex·tri 축 ' + occ.owner + ' 가 (' + occ.formatIndex
          + ', k' + occ.k + ') 를 점유한다 — K 예약 침범');
      }
    }
  }
}
