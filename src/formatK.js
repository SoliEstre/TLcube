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
 * [값 선택 — 평 K 는 7, K-CM 은 8. 각각 전 버전이 공유하고 k 로 가른다]
 * star 축 안에서는 어떤 값이든 쓸 수 있지만, **한 값을 전 버전이 공유**하고 (값,k)
 * 로 가른다 — hex 축의 정본 전례(O V2=1(k8) 과 A0=1(k6), decode.js «두 해석 만들고
 * k 로 가른다») 그대로다. 값을 그 둘로 고른 이유는 이중 안전이다:
 *   ① K/K-CM 프레임이 tri/hex 로 오분류돼도 그 값이 hex·tri 축의
 *      validVersionIndices 에 없어 **포맷 단계에서** 죽는다. **스코프는 (값, k)
 *      다** (2026-08-30 정정 — 종전 «영구히» 는 k 무한정으로 읽혔다): star 가
 *      사는 k ∈ {6,8,10} 에서 hex·tri 는 7 도 (K 예약) 8..11 도 (cube 축 예약)
 *      안 쓴다 — turnA.js 로드 자기검증이 두 침범을 다 던진다. 그 세 k 의
 *      실계산 점유는 k 마다 11/16 이고 빈 값이 정확히 {7,8,9,10,11} 이다 (아래
 *      자기검증이 매 로드 확인). **k=12 의 7 은 V4Q(hex) 다** — star 는 k=12 에
 *      없으므로(§4.4 신설 배정 규칙: 같은 값은 격자 파라미터가 갈라야 한다 —
 *      k 6/8/10 vs 12) 안전 논거 ①은 그대로 선다.
 *   ② 역방향(O/A 프레임이 star 로 오분류)도 그 프레임의 값(0..6·12..15)이 star 축
 *      ({7,8}) 에 없어 같은 단계에서 죽는다.
 *   ③ cube 축 실점유는 **14값**이고 평 K의 7까지 이미 포함한다(F-90). 그래도 cube의
 *      크기 축은 n(13/21/25), star는 k(6/8/10)라 (값,크기) 쌍이 겹치지 않는다.
 *      값 재사용 자체는 ADR 0006 D3-1이 허용한다. 조기 로드 가능한 `formatY.js`가
 *      실점유 claim을 유도하고, 아래 로드 가드가 전 claim과 star를 대조한다.
 *
 * ⚠ 값을 이 두 개 밖으로 옮기려면 위 논거가 통째로 무너진다 — hex·tri 는
 * star 가 사는 세 k 에서 {0..6, 12..15} × k 를 **48/48 다 쓴다**(2026-08-24
 * 실계산). 아래 자기검증이 «K 축 값은 hex·tri 가 그 세 k 에서 회피하는 밴드 안»
 * 을 강제하는 이유다 (k=12 는 star 밖이라 이 밴드 계약의 대상이 아니다).
 *
 * 배정은 **반드시 표 주도**다 (turnA.js/markerG.js 문법) — 아래 표가 배정의
 * 전부이며, 인코더(encodeK.js)·디코더(decoder/decode-k.js·bootstrap.js)는 이 표를
 * 읽는다. 로드 시점 자기검증이 표의 주장을 잰다.
 *
 * [K-CM 행 — 예약에서 실체로 (2026-08-24, 레인 C)] 종전 이 자리는 «마커 발자국·회계가
 * 확정되면 표 말미에 행을 추가한다 · 이 레인은 점유하지 않았다» 였다. 계약 K-8.1 이
 * 운영자 확정 (다)안 «앵커 위 마커» 로 해소됐으므로(회계 = overhead + 27 — markerK.js
 * 헤더 §3) 아래 K*CM 3행이 실체다. **평 K 와 다른 값**이어야 하는 이유는 markerG.js
 * 가 실기에서 배운 것이다 — 같은 값을 실으면 디코더가 마커 회계(27셀)를 와이어에서
 * 구분할 수 없다.
 */

import {
  hexTriAxisOccupancy,
  K1_RESERVED_FORMAT_INDEX,
  TURN_A_FORMAT_INDEX,
  CUBE_RESERVED_FORMAT_INDEXES,
} from './turnA.js';
import { MARKER_G_FORMAT_INDEX } from './markerG.js';
import { CUBE_AXIS_FORMAT_CLAIMS, CUBE_AXIS_FORMAT_INDEXES } from './formatY.js';

/** K-CM 이 쓰는 star 축 값. hex·tri 가 영구 회피하는 cube 예약 밴드 안이라
 *  «포맷 단계 조기 사멸» 논거가 평 K(7)와 똑같이 선다 (헤더 §값 선택 ①). */
export const K_MARKER_FORMAT_INDEX = 8;

/** Type K formatIndex 배정 표 (star 축) — 항목마다 값이 «표에 직접» 적혀 있다.
 *  `cornerMarker` 가 평 K 행과 K-CM 행을 가르는 축이다 (markerG 의 centerQr 문법). */
export const K_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'K0', version: 0, k: 6, formatIndex: 7, cornerMarker: false }),
  Object.freeze({ name: 'K1', version: 1, k: 8, formatIndex: 7, cornerMarker: false }),
  Object.freeze({ name: 'K2', version: 2, k: 10, formatIndex: 7, cornerMarker: false }),
  // K-CM (2026-08-24) — 코너 마커 자리 예약. 회계만 다르고 격자·앵커는 평 K 와 같다.
  Object.freeze({ name: 'K0CM', version: 0, k: 6, formatIndex: 8, cornerMarker: true }),
  Object.freeze({ name: 'K1CM', version: 1, k: 8, formatIndex: 8, cornerMarker: true }),
  Object.freeze({ name: 'K2CM', version: 2, k: 10, formatIndex: 8, cornerMarker: true }),
]);

function lookup(version, cornerMarker) {
  const spec = K_FORMAT_INDEX.find(
    (entry) => entry.version === version && entry.cornerMarker === cornerMarker,
  );
  if (!spec) {
    throw new RangeError('알 수 없는 Type K 버전: ' + version + (cornerMarker ? ' (+CM)' : '')
      + ' (허용 ' + K_FORMAT_INDEX.filter((entry) => entry.cornerMarker === cornerMarker)
        .map((entry) => `${entry.name}(v${entry.version})`).join(', ') + ')');
  }
  return spec;
}

/** version → 평 K 표 항목 (cornerMarker=false). 없으면 RangeError. */
export function kFormatSpec(version) {
  return lookup(version, false);
}

/** version → K-CM 표 항목 (cornerMarker=true). 없으면 RangeError —
 *  조용한 평 K 폴백은 «와이어에 신호가 없다» 던 원래 결함의 재생산이다 (markerG 전례). */
export function kMarkerFormatSpec(version) {
  return lookup(version, true);
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
  // 평 K 행과 K-CM 행이 **다른 값**인가 — 같으면 디코더가 마커 회계를 못 가른다
  // (markerG.js 헤더가 실기 「코너 마커 코드 스캔 불가」에서 배운 것).
  for (const plain of K_FORMAT_INDEX.filter((e) => !e.cornerMarker)) {
    const cm = K_FORMAT_INDEX.find((e) => e.cornerMarker && e.version === plain.version);
    if (!cm) throw new Error('formatK: ' + plain.name + ' 의 K-CM 짝 행이 없다');
    if (cm.formatIndex === plain.formatIndex) {
      throw new Error('formatK: ' + cm.name + ' 이 평 K 와 같은 값 ' + cm.formatIndex
        + ' 을 쓴다 — 마커 회계가 와이어에서 안 갈린다');
    }
    if (cm.k !== plain.k) {
      throw new Error('formatK: ' + cm.name + ' 의 k=' + cm.k + ' 가 기저 ' + plain.name
        + ' k=' + plain.k + ' 과 다르다 — K-CM 은 «옵션» 이라 격자 크기가 같다');
    }
  }
  // 이중 안전의 전제 검증 ① — 이 표의 값은 hex·tri 축이 **영구 회피하는 정책 밴드**
  // (K 예약 7 + cube 기저 예약 8..11) 안이어야 한다. 밖의 값을 쓰면 «포맷 단계 조기
  // 사멸» 논거의 절반이 사라진다 — hex·tri 는 나머지 {0..6,12..15}×k 를 다 쓴다.
  const RESERVED_BAND = Object.freeze([K1_RESERVED_FORMAT_INDEX, ...CUBE_RESERVED_FORMAT_INDEXES]);
  const offReserve = K_FORMAT_INDEX.filter((entry) => !RESERVED_BAND.includes(entry.formatIndex));
  if (offReserve.length > 0) {
    throw new Error('formatK: hex·tri 영구 회피 밴드 [' + RESERVED_BAND.join(',') + '] 밖의 값을 쓴다 — '
      + offReserve.map((entry) => entry.name + '=' + entry.formatIndex).join(', ')
      + ' (의도한 확장이면 헤더 §값 선택 논거와 이 검증을 함께 갱신하라)');
  }
  if (K_MARKER_FORMAT_INDEX === K1_RESERVED_FORMAT_INDEX
    || !CUBE_RESERVED_FORMAT_INDEXES.includes(K_MARKER_FORMAT_INDEX)) {
    throw new Error('formatK: K_MARKER_FORMAT_INDEX ' + K_MARKER_FORMAT_INDEX
      + ' 이 cube 예약 밴드 [' + CUBE_RESERVED_FORMAT_INDEXES.join(',') + '] 안이 아니다');
  }
  // ①b — hex·tri 축이 그 밴드를 **실제로** 비워 두는가 (k 마다 빈 값 = 밴드 그대로).
  // 코드 정본에서 실계산한다: 손으로 «48/48 꽉 찼다» 를 적어 두면 그 사본이 썩는다.
  {
    const occupancy = new Map(); // k → Set<formatIndex>
    const all = [
      ...hexTriAxisOccupancy(),
      ...TURN_A_FORMAT_INDEX.map((e) => ({ owner: e.name, formatIndex: e.formatIndex, k: e.k })),
      ...MARKER_G_FORMAT_INDEX.map((e) => ({ owner: e.name, formatIndex: e.formatIndex, k: e.k })),
    ];
    for (const occ of all) {
      if (!occupancy.has(occ.k)) occupancy.set(occ.k, new Set());
      occupancy.get(occ.k).add(occ.formatIndex);
    }
    for (const entry of K_FORMAT_INDEX) {
      const used = occupancy.get(entry.k);
      if (!used) continue; // 그 k 를 쓰는 hex·tri 버전이 없다 — 충돌 자체가 불가
      const free = [];
      for (let v = 0; v < 16; v += 1) if (!used.has(v)) free.push(v);
      for (const v of free) {
        if (!RESERVED_BAND.includes(v)) {
          throw new Error('formatK: hex·tri 축 k=' + entry.k + ' 에 예약 밴드 밖 빈 값 ' + v
            + ' 이 생겼다 — «hex·tri 가 밴드만 비운다» 전제가 깨졌다');
        }
      }
    }
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
  // F-90: cube 실점유 전부(현행 14값)와 star를 (값,크기)로 대조한다. 값 7의
  // 중복은 실제이며 축 분리상 합법이지만, 크기까지 같아지면 오판 가설이 생기므로 죽는다.
  for (const cube of CUBE_AXIS_FORMAT_CLAIMS) {
    for (const entry of K_FORMAT_INDEX) {
      if (cube.formatIndex === entry.formatIndex && cube.n === entry.k) {
        throw new Error('formatK: cube ' + cube.owner + ' 와 star ' + entry.name
          + ' 이 (값=' + cube.formatIndex + ', 크기=' + cube.n + ')까지 겹친다');
      }
    }
  }
  if (!CUBE_AXIS_FORMAT_INDEXES.includes(K1_RESERVED_FORMAT_INDEX)) {
    throw new Error('formatK: F-90 전제 변화 — cube 실점유에서 K 값 7이 사라졌다; 축 분리 근거를 재검토하라');
  }
}
