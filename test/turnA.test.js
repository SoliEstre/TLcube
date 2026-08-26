// turnA.test.js — 턴A 배정 표 회귀 (oak ⑦ · 015 §16 운영자 확정의 코드 고정)
//
// 고정하는 것: ① 표 값 그 자체 (표가 유일한 진실 — 조용한 재배정을 막는다),
// ② (값,k) 무경합 — hex(O)·tri(A) 공유축 전점유 대비, ③ 균일 오프셋 4bit 넘침
// (표 주도 배정이 «필수»인 이유의 실측), ④ 회계 — 최악 소요 6값이 사용 가능
// 공간 안에 든다, ⑤ K1 예약(7)·cube 축(8..11) 무침범.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUBE_RESERVED_FORMAT_INDEXES,
  K1_RESERVED_FORMAT_INDEX,
  TURN_A_FORMAT_INDEX,
  hexTriAxisOccupancy,
  turnASpec,
  turnASpecFromFormatIndex,
} from '../src/turnA.js';
import { VERSIONS_A } from '../src/capacityA.js';
import { VERSION_BITS } from '../src/formatinfo.js';
import { encodeA } from '../src/encodeA.js';

test('표 값 고정 — 배정은 표 그 자체다', () => {
  // 2026-08-24 재명명 (내부 타입 V 확정): 이름 층만 A0T… → V0… 로 갱신됐고
  // **값·k·centerQr 열은 동결 그대로**다 — 이 벡터가 그 동결을 잰다.
  const table = TURN_A_FORMAT_INDEX.map((e) => [e.name, e.formatIndex, e.k, e.centerQr]);
  assert.deepEqual(table.slice(0, 6), [
    ['V0', 2, 6, false],
    ['V0Q', 5, 6, true],
    ['V1', 4, 8, false],
    ['V1Q', 6, 8, true],
    ['V2', 0, 10, false],
    ['V2Q', 3, 10, true],
  ]);
  // 말미 V-CM 3칸 (2026-08-24 — markerG 반영 후 잔여 3칸을 정확히 소진).
  // V-CMQ 는 잔여 0 으로 **보류** — 행이 늘면(개설되면) 이 벡터를 갱신하라.
  assert.deepEqual(table.slice(6), [
    ['V0CM', 14, 6, false],
    ['V1CM', 3, 8, false],
    ['V2CM', 5, 10, false],
  ]);
  assert.ok(TURN_A_FORMAT_INDEX.slice(6).every((e) => e.cornerMarker === true),
    '말미 행이 cornerMarker 표기가 아니다');
});

test('(값,k) 무경합 — hex·tri 공유축 전점유 + 턴A 6항목 전수', () => {
  const seen = new Map();
  const claim = (owner, formatIndex, k) => {
    const key = formatIndex + '|' + k;
    assert.ok(!seen.has(key),
      owner + ' 와 ' + seen.get(key) + ' 이 (' + formatIndex + ', k' + k + ') 경합');
    seen.set(key, owner);
  };
  for (const occ of hexTriAxisOccupancy()) claim(occ.owner, occ.formatIndex, occ.k);
  for (const entry of TURN_A_FORMAT_INDEX) claim(entry.name, entry.formatIndex, entry.k);
  // 현행 점유가 실제 인코더와 같은지 — encodeA 실호출 교차 검증 (A0Q 실재 포함)
  for (const spec of VERSIONS_A) {
    for (const centerQr of [false, true]) {
      const enc = encodeA('x', { version: spec.version, eccLevel: 'M', centerQr });
      const expected = spec.formatIndex + (centerQr ? 2 : 0);
      assert.equal(enc.formatIndex, expected,
        spec.name + (centerQr ? 'Q' : '') + ' 실점유가 표와 다르다');
    }
  }
});

test('균일 오프셋은 4bit 를 넘친다 — 표 주도가 필수인 이유 (실측)', () => {
  assert.equal(VERSION_BITS, 4);
  const a1 = VERSIONS_A.find((v) => v.name === 'A1');
  const a2 = VERSIONS_A.find((v) => v.name === 'A2');
  // 어떤 균일 오프셋 off ≥ 1 도 A2Q(=15) 를 넘친다. «+2 짝» 관례를 턴A 에
  // 이으려 해도 A1Q=14 → 16 이라 즉시 넘친다.
  assert.ok(a1.formatIndex + 2 + 2 > 15, 'A1Q + 2 = ' + (a1.formatIndex + 4));
  assert.ok(a2.formatIndex + 2 + 1 > 15, 'A2Q + 1 = ' + (a2.formatIndex + 3));
});

test('회계 — 소요 ≤ 사용 가능 공간 (7·8..11 제외, k 공유 포함)', () => {
  // 기본 6 (V×Q 전조합) + V-CM 3 (2026-08-24 말미) = 9. V-CMQ 는 잔여 0 보류 —
  // markerG 로드 자기검증의 «잔여 0» 단언이 산술 근거다.
  assert.equal(TURN_A_FORMAT_INDEX.length, 9);
  // 사용 가능 공간: k 별로 «(값,k) 미점유 ∧ 값 ∉ {7, 8..11}» 를 센다
  const occupied = new Set(hexTriAxisOccupancy().map((o) => o.formatIndex + '|' + o.k));
  const banned = new Set([K1_RESERVED_FORMAT_INDEX, ...CUBE_RESERVED_FORMAT_INDEXES]);
  for (const k of [6, 8, 10]) {
    let free = 0;
    for (let v = 0; v <= 15; v += 1) {
      if (banned.has(v)) continue;
      if (occupied.has(v + '|' + k)) continue;
      free += 1;
    }
    const need = TURN_A_FORMAT_INDEX.filter((e) => e.k === k).length;
    assert.ok(need <= free, 'k' + k + ': 소요 ' + need + ' > 여유 ' + free);
  }
});

test('K1 예약·cube 축 무침범 + 기저 k 일치', () => {
  for (const entry of TURN_A_FORMAT_INDEX) {
    assert.notEqual(entry.formatIndex, K1_RESERVED_FORMAT_INDEX, entry.name);
    assert.ok(!CUBE_RESERVED_FORMAT_INDEXES.includes(entry.formatIndex), entry.name);
    const base = VERSIONS_A.find((v) => v.version === entry.version);
    assert.equal(entry.k, base.k, entry.name + ' k 불일치');
  }
});

test('조회 함수 — 정방향·역방향 왕복', () => {
  for (const entry of TURN_A_FORMAT_INDEX) {
    assert.equal(turnASpec(entry.version, {
      centerQr: entry.centerQr, cornerMarker: entry.cornerMarker === true,
    }), entry);
    assert.equal(turnASpecFromFormatIndex(entry.formatIndex, entry.k), entry);
  }
  assert.equal(turnASpecFromFormatIndex(7, 6), null);
  assert.throws(() => turnASpec(3), RangeError);
  // **의도적 갱신 (2026-08-24 검수 4차)** — 구 락의 «개설되면 이 단언을 갱신하라»
  // 를 이행한다. V-CMQ 는 V*CM 인덱스를 공유한다 (turnA.js §turnASpec 의 근거).
  for (const version of [0, 1, 2]) {
    assert.equal(
      turnASpec(version, { centerQr: true, cornerMarker: true }).formatIndex,
      turnASpec(version, { cornerMarker: true }).formatIndex,
      'V' + version + 'CMQ 가 V' + version + 'CM 과 다른 칸을 잡았다',
    );
  }
  // 공유는 **cornerMarker 가 있을 때만**이다 — 순수 V*Q 는 자기 칸이 있다.
  assert.notEqual(
    turnASpec(0, { centerQr: true }).formatIndex,
    turnASpec(0, { cornerMarker: true }).formatIndex,
  );
});
