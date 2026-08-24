/**
 * capacityK.test.js — Type K 용량 회계 + star 축 formatIndex 표 (계약 K-6·K-7).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERSIONS_K,
  NSYM_TABLE_K,
  overheadBreakdownK,
  capacityForK,
  capacityTableK,
  versionSpecK,
  renderMarkdownTableK,
} from '../src/capacityK.js';
import { K_FORMAT_INDEX, kFormatSpec, kSpecFromFormatIndex } from '../src/formatK.js';
import { hexTriAxisOccupancy, TURN_A_FORMAT_INDEX, K1_RESERVED_FORMAT_INDEX } from '../src/turnA.js';
import { MARKER_G_FORMAT_INDEX } from '../src/markerG.js';
import { regionCellsK } from '../src/placementK.js';
import { cellCount } from '../src/hexgrid.js';
import { maxBytesForSymbols } from '../src/capacity.js';
import { symbolCountForByteLength } from '../src/base211.js';

test('총 셀 항등 — 6k²+6k+1 = 코어 cellCount(k) + 6·k(k+1)/2 = regionCellsK 길이', () => {
  for (const spec of VERSIONS_K) {
    const cap = capacityForK(spec, 'M');
    assert.equal(cap.totalCells, cellCount(spec.k) + 6 * (spec.k * (spec.k + 1)) / 2);
    assert.equal(cap.totalCells, regionCellsK(spec.k).length);
  }
});

test('오버헤드 분해 — 실계산 합이 검산값과 같다 (2026-08-25 실측)', () => {
  const EXPECT = {
    6: { bullseye: 19, anchor: 9, format: 15, hexReference: 8, patchReference: 12, total: 63 },
    8: { bullseye: 19, anchor: 9, format: 15, hexReference: 12, patchReference: 12, total: 67 },
    10: { bullseye: 19, anchor: 9, format: 15, hexReference: 16, patchReference: 18, total: 77 },
  };
  for (const [k, want] of Object.entries(EXPECT)) {
    const got = overheadBreakdownK(Number(k));
    for (const [field, value] of Object.entries(want)) {
      assert.equal(got[field], value, `k=${k} ${field}`);
    }
  }
});

test('용량표 확정값 — 전 버전 × 전 레벨 청크 정렬 + 순 페이로드 (계약 K-6 회계 절차)', () => {
  const EXPECT = {
    K0: { C: 190, S: 63, resid: 1, payload: { L: 52, M: 43, H: 35 } },
    K1: { C: 366, S: 122, resid: 0, payload: { L: 102, M: 86, H: 69 } },
    K2: { C: 584, S: 194, resid: 2, payload: { L: 161, M: 138, H: 110 } },
  };
  for (const spec of VERSIONS_K) {
    const want = EXPECT[spec.name];
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForK(spec, level);
      assert.equal(cap.dataCells, want.C, `${spec.name} C`);
      assert.equal(cap.usedSymbols, want.S, `${spec.name} S`);
      assert.equal(cap.residualCells, want.resid, `${spec.name} 잔여`);
      assert.equal(cap.maxPayloadBytes, want.payload[level], `${spec.name}/${level} 순 페이로드`);
      assert.equal(cap.chunkAligned, true, `${spec.name}/${level} 청크 정렬`);
      assert.equal(cap.nsym, NSYM_TABLE_K[spec.name][level]);
    }
  }
});

test('NSYM 절차 재검산 — M/L/H 공식 + K2/L 만 정렬 대체 (A2/H 57→59 전례)', () => {
  for (const spec of VERSIONS_K) {
    const S = NSYM_TABLE_K[spec.name].symbols;
    let m = Math.round(0.25 * S);
    if (m % 2 === 0) m += 1;
    assert.equal(NSYM_TABLE_K[spec.name].M, m, `${spec.name} M 절차값`);
    assert.equal(NSYM_TABLE_K[spec.name].H, Math.round(0.40 * S), `${spec.name} H 절차값`);
    const procL = Math.round(0.12 * S);
    if (spec.name === 'K2') {
      // 절차값 23 은 비정렬 — 26 이 정렬·t 불감소·최근접 (모듈 헤더 §근거).
      assert.equal(procL, 23);
      const misaligned = symbolCountForByteLength(maxBytesForSymbols(S - 23)) !== S - 23;
      assert.equal(misaligned, true, 'K2/L 절차값 23 이 정렬된다면 대체 근거가 사라졌다 — 표를 절차값으로 되돌려라');
      for (const between of [24, 25]) {
        const ds = S - between;
        assert.notEqual(symbolCountForByteLength(maxBytesForSymbols(ds)), ds,
          `K2/L: ${between} 이 정렬된다면 26 이 최근접이 아니다`);
      }
      assert.equal(NSYM_TABLE_K.K2.L, 26);
    } else {
      assert.equal(NSYM_TABLE_K[spec.name].L, procL, `${spec.name} L 절차값`);
    }
  }
});

test('star 축 formatIndex 표 — 전 버전 7, (값,k) 로 가른다 (계약 K-7 안 1 승계)', () => {
  assert.equal(K_FORMAT_INDEX.length, 3);
  for (const entry of K_FORMAT_INDEX) {
    assert.equal(entry.formatIndex, K1_RESERVED_FORMAT_INDEX, entry.name);
    assert.equal(kFormatSpec(entry.version), entry);
    assert.equal(kSpecFromFormatIndex(7, entry.k), entry);
  }
  assert.equal(kSpecFromFormatIndex(7, 4), null);
  assert.equal(kSpecFromFormatIndex(0, 6), null);
  assert.throws(() => kFormatSpec(3), RangeError);
  // VERSIONS_K 가 표를 그대로 승계한다 (이름·k·인덱스).
  for (const spec of VERSIONS_K) {
    const format = kFormatSpec(spec.version);
    assert.equal(spec.name, format.name);
    assert.equal(spec.k, format.k);
    assert.equal(spec.formatIndex, format.formatIndex);
  }
});

test('hex·tri 축 전체가 (7,k) 를 비워 둔다 — 이중 안전의 전제 (코드 정본 실계산)', () => {
  const claims = [
    ...hexTriAxisOccupancy(),
    ...TURN_A_FORMAT_INDEX.map((entry) => ({ owner: entry.name, formatIndex: entry.formatIndex, k: entry.k })),
    ...MARKER_G_FORMAT_INDEX.map((entry) => ({ owner: entry.name, formatIndex: entry.formatIndex, k: entry.k })),
  ];
  for (const claim of claims) {
    assert.notEqual(claim.formatIndex, 7,
      claim.owner + ' 가 K 예약값 7 을 점유한다');
  }
});

test('versionSpecK / capacityTableK / 마크다운 표', () => {
  assert.equal(versionSpecK(1).name, 'K1');
  assert.throws(() => versionSpecK(9), RangeError);
  assert.equal(capacityTableK('M').length, 3);
  const md = renderMarkdownTableK('M');
  assert.match(md, /\| K0 \| 6 \| 253 \| 63 \|/);
  assert.match(md, /\| K2 \| 10 \| 661 \| 77 \|/);
  assert.doesNotMatch(md, /[^\\|]~[^~]/, '단일 물결표 금지 (규약 §6.11)');
});
