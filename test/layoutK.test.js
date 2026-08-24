/**
 * layoutK.test.js — scan order-K (계약 K-4) + 레이아웃 맵.
 *
 * K-4 의 세 규칙(코어 ring-major → 패치 top→BR→BL→TL→bottom→TR → data 만)이
 * 「전부 A 에 이미 있는 규칙」임을 A 실규칙과의 대조로 잠근다:
 *   · 코어 접두 = layout.dataCellsInScanOrder(k) 바이트 동일
 *   · A 계열 패치 구간 = layoutA.dataCellsInScanOrderA(k) 의 패치 꼬리와 동일
 *     (K 의 A 계열 고정 셀 = A 의 고정 셀이라 필터 결과까지 같다)
 *   · 반전 계열 구간 = A 계열 구간의 180° 상 (집합)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  dataCellsInScanOrderK,
  symbolCellGroupsK,
  fillerCellsK,
  layoutMapK,
} from '../src/layoutK.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { dataCellsInScanOrderA } from '../src/layoutA.js';
import { capacityForK, VERSIONS_K } from '../src/capacityK.js';
import { patchOfK, regionCellsK } from '../src/placementK.js';
import { hexDistance } from '../src/hexgrid.js';

const key = (c) => c.q + ',' + c.r;

test('scan order-K — 길이 = 데이터 셀 수, 중복 없음, 전부 영역 안 data 셀', () => {
  for (const spec of VERSIONS_K) {
    const cap = capacityForK(spec, 'M');
    const scan = dataCellsInScanOrderK(spec.k);
    assert.equal(scan.length, cap.dataCells, `${spec.name} 길이`);
    assert.equal(new Set(scan.map(key)).size, scan.length, `${spec.name} 중복`);
    const map = layoutMapK(spec.k);
    for (const c of scan) {
      const entry = map.get(key(c));
      assert.equal(entry && entry.role, 'data', `${spec.name} ${key(c)} 역할`);
    }
  }
});

test('코어 접두 = Type O scan order 바이트 동일 (계약 K-4 ①)', () => {
  for (const spec of VERSIONS_K) {
    const hexScan = dataCellsInScanOrder(spec.k);
    const scan = dataCellsInScanOrderK(spec.k);
    assert.deepEqual(scan.slice(0, hexScan.length), hexScan, `${spec.name} 접두`);
    // 접두 이후는 전부 패치 셀이다.
    for (const c of scan.slice(hexScan.length)) {
      assert.ok(hexDistance(c.q, c.r) > spec.k, `${spec.name} 꼬리에 코어 셀 ${key(c)}`);
    }
  }
});

test('A 계열 패치 구간 = Type A scan 의 패치 꼬리와 동일 (계약 K-4 ② 전반)', () => {
  for (const spec of VERSIONS_K) {
    const k = spec.k;
    const hexLen = dataCellsInScanOrder(k).length;
    const aTail = dataCellsInScanOrderA(k).slice(hexLen);
    const kTail = dataCellsInScanOrderK(k).slice(hexLen);
    assert.deepEqual(kTail.slice(0, aTail.length), aTail,
      `${spec.name} A 계열 패치 구간이 dataCellsInScanOrderA 꼬리와 다르다`);
    // 반전 계열 구간 = A 계열 구간의 180° 상 (집합) — 패치 소속은 반전 계열만.
    const invTail = kTail.slice(aTail.length);
    assert.equal(invTail.length, kTail.length - aTail.length);
    const aSet = new Set(aTail.map(key));
    for (const c of invTail) {
      assert.ok(aSet.has(`${-c.q},${-c.r}`),
        `${spec.name} 반전 구간 ${key(c)} 의 180° 상이 A 계열 구간에 없다`);
      assert.ok(['TL', 'bottom', 'TR'].includes(patchOfK(c.q, c.r, k)),
        `${spec.name} 반전 구간 ${key(c)} 패치 소속`);
    }
  }
});

test('패치 구간 순서 — top→BR→BL→TL→bottom→TR (계약 K-4 ② 순서)', () => {
  const ORDER = ['top', 'BR', 'BL', 'TL', 'bottom', 'TR'];
  for (const spec of VERSIONS_K) {
    const k = spec.k;
    const hexLen = dataCellsInScanOrder(k).length;
    const tail = dataCellsInScanOrderK(k).slice(hexLen);
    const seen = [];
    for (const c of tail) {
      const p = patchOfK(c.q, c.r, k);
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    assert.deepEqual(seen, ORDER, `${spec.name} 패치 순서`);
  }
});

test('심볼 그룹·필러 — 3셀 그룹 + 잔여 (K0 1 · K1 0 · K2 2)', () => {
  const RESID = { K0: 1, K1: 0, K2: 2 };
  for (const spec of VERSIONS_K) {
    const cap = capacityForK(spec, 'M');
    const groups = symbolCellGroupsK(spec.k);
    const filler = fillerCellsK(spec.k);
    assert.equal(groups.length, cap.usedSymbols, `${spec.name} 그룹 수`);
    assert.equal(filler.length, RESID[spec.name], `${spec.name} 필러 수`);
    const scan = dataCellsInScanOrderK(spec.k);
    assert.deepEqual(filler, scan.slice(scan.length - filler.length), `${spec.name} 필러 = scan 꼬리`);
    // 필러는 실루엣 가장자리(마지막 패치 TR)에 있다 (§5.6 취지).
    for (const c of filler) {
      assert.equal(patchOfK(c.q, c.r, spec.k), 'TR', `${spec.name} 필러 위치`);
    }
  }
});

test('layoutMapK — 전 셀이 정확히 한 역할, 회계 합 일치', () => {
  for (const spec of VERSIONS_K) {
    const map = layoutMapK(spec.k);
    const region = regionCellsK(spec.k);
    assert.equal(map.size, region.length, `${spec.name} 맵 크기 = 총 셀`);
    const counts = {};
    for (const { role } of map.values()) counts[role] = (counts[role] || 0) + 1;
    const cap = capacityForK(spec, 'M');
    assert.equal(counts.bullseye, 19);
    assert.equal(counts.anchor, 9);
    assert.equal(counts.format, 15);
    assert.equal(counts.data, cap.dataCells);
    assert.equal(counts.reference, cap.overhead - 19 - 9 - 15);
  }
});

test('scan order-K 회귀 스냅샷 — 와이어 계약 고정 (layoutA sha256 전례)', () => {
  // 계약이 확정되기 전의 우발적 재배열을 잡는 자물쇠다. 의도적 변경이면
  // 아래 해시를 갱신하고 커밋 메시지에 근거를 적어라.
  const SNAPSHOT = {
    K0: '28660512ae623f99e889a1d96dc763d976763e97ccb932bc0887c5c63be440c5',
    K1: 'b28f9f2dccd83fa63125ed3fd13704484d6a8ee76fa88661e71dadeeee05c3a1',
    K2: 'ad39b3575cf6724182e66d783c6372fd8cf094cf9e44109e44574946ea53746e',
  };
  for (const spec of VERSIONS_K) {
    const digest = createHash('sha256')
      .update(dataCellsInScanOrderK(spec.k).map(key).join(';'))
      .digest('hex');
    assert.equal(digest, SNAPSHOT[spec.name], `${spec.name} scan 스냅샷`);
  }
});
