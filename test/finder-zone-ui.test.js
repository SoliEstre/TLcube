/**
 * finder-zone-ui.test.js — 3구역 유도가 **분류 정본과 일치하는가** (W2 C4).
 *
 * finder-zone-ui 는 브라우저 번들 제약(finder-taxonomy 의 node:url import ·
 * taxonomy→generator-state 순환)으로 분류 정본을 직접 import 하지 못한다 —
 * 런타임 유도는 와이어 정본(markerG)에서 오고, **분류 정본과의 일치는 이 파일이
 * Node 쪽에서 전수 대조한다** (모듈 헤더의 «검증되는 사본» 규칙의 자(尺)).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADVANCED_ONLY_CENTRAL_IDS, INNER_SEAT_OPTIONS, OFFICIAL_NORMAL_CENTRAL_IDS,
  OUTER_SEAT_OPTIONS, SEAT_NONE, cmqWireExists, zoneCards,
} from '../src/finder-zone-ui.js';
import {
  FINDER_TAXONOMY, KIND_ABSENT, KIND_SEAT, SEAT_DEFAULT_FINDER, taxonomyByClass,
} from '../src/finder-taxonomy.js';
import { TAEGUK_ID, DAEHAN_FINDER_PATTERN_IDS } from '../src/finder-daehan.js';
import { GENERATOR_STATE_SCHEMA } from '../src/generator-state.js';

test('내곽/외곽 seat 유도가 분류 정본(분류 2·3 + KIND_ABSENT)과 1:1 이다', () => {
  const zones = zoneCards();
  // 내곽 = 없음 + 분류 2 − **자리 기본 심볼** (H 는 o-cm 선택에 흡수 — 외곽의
  // H2O 와 같은 규칙. 정본 매핑 = SEAT_DEFAULT_FINDER, 2026-08-24 운영자 확정).
  const seatSymbols = Object.values(SEAT_DEFAULT_FINDER);
  const class2Ids = taxonomyByClass(2).map((row) => row.id)
    .filter((id) => !seatSymbols.includes(id)).sort();
  assert.deepEqual(
    zones.inner.filter((card) => card.id !== SEAT_NONE).map((card) => card.id).sort(),
    class2Ids,
    '내곽 유도가 분류 2(자리 심볼 제외)와 어긋났다 — 분류 정본이 늘었으면 zone 유도도 따라와야 한다');
  // 외곽 = 없음 + 분류 3 의 seat 행 + KIND_ABSENT 행.
  const class3Seats = taxonomyByClass(3)
    .filter((row) => row.kind === KIND_SEAT).map((row) => row.id);
  const absents = FINDER_TAXONOMY
    .filter((row) => row.kind === KIND_ABSENT).map((row) => row.id);
  assert.deepEqual(
    zones.outer.filter((card) => card.id !== SEAT_NONE).map((card) => card.id).sort(),
    [...class3Seats, ...absents].sort(),
    '외곽 유도가 분류 3 seat + 부재 행과 어긋났다');
  // 부재 카드는 정확히 KIND_ABSENT 행이다 (자리만 — 클릭 불가).
  for (const card of zones.outer.filter((c) => c.absent)) {
    assert.ok(absents.includes(card.id), card.id + ' 는 분류 정본에 부재 행이 없다');
    assert.equal(card.ready, false, card.id + ' 부재 카드가 클릭 가능하다');
  }
});

test('중앙 = 분류 1 — 카드 목록과 분류 정본의 차이는 taegeuk·daehan 합성뿐이다', () => {
  // 분류 1 에는 taegeuk(표시층 id — 단독 카드는 통합자 C2b 게이트 보류)이 있고,
  // 카드에는 daehan 합성(클래스 W 와이어 — 분류 1 이 아니다)이 있다. 그 둘을 빼면
  // 두 집합은 같아야 한다 — 어긋나면 «세 면 같은 원천» 이 깨진 것이다.
  const central = new Set(zoneCards().central.map((card) => card.id));
  const class1 = new Set(taxonomyByClass(1).map((row) => row.id));
  const onlyClass1 = [...class1].filter((id) => !central.has(id) && id !== TAEGUK_ID);
  const onlyCards = [...central].filter(
    (id) => !class1.has(id) && !DAEHAN_FINDER_PATTERN_IDS.includes(id),
  );
  assert.deepEqual(onlyClass1, [], '분류 1 에만 있는 카드 (taegeuk 제외): 유도 누락');
  assert.deepEqual(onlyCards, [], '카드에만 있는 항목 (daehan 합성 제외): 분류 누락');
});

test('상태 스키마 seat options 는 zone 유도와 같다 (검증되는 사본)', () => {
  assert.deepEqual([...GENERATOR_STATE_SCHEMA.innerSeat.options], [...INNER_SEAT_OPTIONS]);
  assert.deepEqual([...GENERATOR_STATE_SCHEMA.outerSeat.options], [...OUTER_SEAT_OPTIONS]);
});

test('C5 고급 게이팅 — advancedOnly 는 formal 여집합 유도이고 정식 normal 3장이 확정값이다', () => {
  // 운영자 확정 (2026-08-23·24): 정식 normal 중앙 3장 = cube-bullseye·central-v0·center-qr.
  assert.deepEqual([...OFFICIAL_NORMAL_CENTRAL_IDS],
    ['cube-bullseye', 'central-v0', 'center-qr']);
  assert.deepEqual([...ADVANCED_ONLY_CENTRAL_IDS].sort(),
    ['bullseye', 'central-cube-3tone']);
  // central 서술자의 advancedOnly 플래그가 그 유도와 일치한다.
  for (const card of zoneCards().central) {
    assert.equal(card.advancedOnly, ADVANCED_ONLY_CENTRAL_IDS.includes(card.id),
      card.id + ' 의 advancedOnly 플래그가 유도와 어긋났다');
  }
});

test('CM+Q 와이어 술어 — C2a 착지 상태에서 hex·tri 모두 병용 합법이다', () => {
  assert.equal(cmqWireExists('hex'), true);
  assert.equal(cmqWireExists('tri'), true);
  assert.equal(cmqWireExists('없는-family'), false, '없는 family 가 true 를 낸다 — 자가 깨졌다');
});
