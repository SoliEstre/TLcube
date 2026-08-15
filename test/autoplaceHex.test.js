/**
 * autoplaceHex.test.js — 육각 autoplace 계약 (결정적 · 제약=목적함수 · AutoplaceError)
 *
 * 핵심 단언은 «레거시 무영향» 이다: 검출기 점유가 불스아이+앵커뿐이면 산출이
 * `placement.js` 의 formatCells/referenceCellsAll 와 **좌표까지 같아야** 한다.
 * 이 단언이 깨지면 autoplace 가 레거시의 일반화가 아니라 대체가 된 것이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  placeReservedCellsHex,
  placementKeyHex,
  legacyOccupiedHex,
  normalizeOccupiedHex,
  minFormatSeparationHex,
  minReferenceArcHex,
  idealFormatSlotsHex,
  AutoplaceError,
  AUTOPLACE_HEX_FORMAT_SLOT,
  AUTOPLACE_HEX_REF_RING,
  AUTOPLACE_HEX_COLLISION,
} from '../src/autoplaceHex.js';
import { formatCells, referenceCellsAll, ringWalk } from '../src/placement.js';
import { markerCells, reservedOccupiedOMarker } from '../src/markerO.js';

const KS = [6, 8, 10];
const key = (c) => `${c.q},${c.r}`;

test('autoplaceHex: 레거시 점유에서는 placement.js 좌표와 바이트 동일', () => {
  for (const k of KS) {
    const placed = placeReservedCellsHex(k, legacyOccupiedHex(k));
    assert.deepEqual(
      placed.formatCells.map(key),
      formatCells(k).map(key),
      `k=${k} format 좌표가 레거시와 다르다`,
    );
    assert.deepEqual(
      placed.referenceCells.map(key),
      referenceCellsAll(k).map(key),
      `k=${k} reference 좌표가 레거시와 다르다`,
    );
  }
});

test('autoplaceHex: 결정적 — 같은 입력은 같은 배치, 입력 순서에 불변', () => {
  for (const k of KS) {
    const occupied = reservedOccupiedOMarker(k);
    const a = placeReservedCellsHex(k, occupied);
    const b = placeReservedCellsHex(k, occupied);
    assert.deepEqual(a, b);
    // 순서를 뒤집어도 같은 배치 — normalizeOccupiedHex 가 결정성의 입구다.
    const reversed = placeReservedCellsHex(k, occupied.slice().reverse());
    assert.equal(placementKeyHex(reversed), placementKeyHex(a));
  }
});

test('autoplaceHex: 마커 점유에서 레퍼런스가 실제로 재배치된다 (충돌 0)', () => {
  for (const k of KS) {
    const placed = placeReservedCellsHex(k, reservedOccupiedOMarker(k));
    const markerKeys = new Set(markerCells(k).map(key));
    for (const c of [...placed.formatCells, ...placed.referenceCells]) {
      assert.equal(markerKeys.has(key(c)), false, `k=${k}: 배치가 마커와 겹친다 ${key(c)}`);
    }
    // 레거시 레퍼런스 중 마커와 겹치던 셀은 실제로 옮겨졌어야 한다.
    const legacyClash = referenceCellsAll(k).filter((c) => markerKeys.has(key(c)));
    assert.ok(legacyClash.length > 0, `k=${k}: 이 테스트의 전제(레거시 충돌 존재)가 깨졌다`);
    const placedKeys = new Set(placed.referenceCells.map(key));
    for (const c of legacyClash) assert.equal(placedKeys.has(key(c)), false);
    // 개수는 불변.
    assert.equal(placed.formatCells.length, 15);
    assert.equal(placed.referenceCells.length, 2 * (k - 2));
  }
});

test('autoplaceHex: 하한은 레거시 실계산에서 유도된다 (하드코딩 아님)', () => {
  // 포맷 3복제 이격 하한 = 레거시 링3 블록 시작 셀 사이 최소 hexDistance.
  const slots = idealFormatSlotsHex(6);
  assert.deepEqual(slots.map((s) => s.start), [0, 6, 12]);
  assert.equal(minFormatSeparationHex(6), minFormatSeparationHex(10));
  for (const k of KS) {
    const placed = placeReservedCellsHex(k, reservedOccupiedOMarker(k));
    assert.ok(placed.metrics.sFmtMin >= placed.metrics.sFmtMinRequired);
    for (const ring of placed.referenceRings) {
      assert.equal(ring.requiredArc, minReferenceArcHex(ring.ring));
      assert.ok(ring.arc >= ring.requiredArc, `k=${k} 링 ${ring.ring} 각분리 미달`);
    }
  }
});

test('autoplaceHex: 자리가 없으면 조용히 타협하지 않고 AutoplaceError', () => {
  // 링 3..k 를 전부 막으면 포맷 5셀 연속 자리가 없다.
  const k = 6;
  const all = [];
  for (let r = 3; r <= k; r += 1) for (const c of ringWalk(r)) all.push(c);
  assert.throws(() => placeReservedCellsHex(k, all), (error) => {
    assert.ok(error instanceof AutoplaceError);
    assert.equal(error.code, AUTOPLACE_HEX_FORMAT_SLOT);
    return true;
  });

  // 포맷은 살리고 링 5 만 통째로 막으면 그 링 레퍼런스가 갈 곳이 없다.
  const blockRing5 = ringWalk(5).map((c) => ({ q: c.q, r: c.r }));
  assert.throws(() => placeReservedCellsHex(k, [...legacyOccupiedHex(k), ...blockRing5]), (error) => {
    assert.ok(error instanceof AutoplaceError);
    assert.equal(error.code, AUTOPLACE_HEX_REF_RING);
    return true;
  });
});

test('autoplaceHex: 점유 입력 검증 — 영역 밖·형식 위반은 throw', () => {
  assert.throws(() => normalizeOccupiedHex(6, [{ q: 99, r: 0 }]), RangeError);
  assert.throws(() => normalizeOccupiedHex(6, [{ x: 1 }]), RangeError);
  assert.throws(() => normalizeOccupiedHex(6, 5), TypeError);
  // 중복 입력은 조용히 접힌다(집합 의미) — 그러나 개수 회계는 고유 기준.
  const placed = placeReservedCellsHex(6, [...legacyOccupiedHex(6), ...legacyOccupiedHex(6)]);
  assert.equal(placed.metrics.occupied, 22);
  assert.equal(AUTOPLACE_HEX_COLLISION, 'AUTOPLACE_HEX_COLLISION');
});
