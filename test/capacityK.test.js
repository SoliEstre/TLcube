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
import {
  K_FORMAT_INDEX, K_MARKER_FORMAT_INDEX, kFormatSpec, kMarkerFormatSpec, kSpecFromFormatIndex,
} from '../src/formatK.js';
import {
  hexTriAxisOccupancy, TURN_A_FORMAT_INDEX, K1_RESERVED_FORMAT_INDEX, CUBE_RESERVED_FORMAT_INDEXES,
} from '../src/turnA.js';
import { MARKER_G_FORMAT_INDEX } from '../src/markerG.js';
import { CUBE_AXIS_FORMAT_CLAIMS, CUBE_AXIS_FORMAT_INDEXES } from '../src/formatY.js';
import { VERSIONS_Y } from '../src/capacityY.js';
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

// 구 락 «표는 3행이고 전부 7» 은 2026-08-24 K-CM 개설로 **양성 단언으로 전환**됐다
// (배타 개설 정형 3단 ③). 평 K 3행(7) + K-CM 3행(8) 이고, 두 값 다 hex·tri 가
// 영구 회피하는 밴드 안이다 — 그 밴드 유지는 아래 테스트가 잰다.
test('star 축 formatIndex 표 — 평 K 는 7 · K-CM 은 8, 각각 k 로 가른다 (계약 K-7 안 1)', () => {
  assert.equal(K_FORMAT_INDEX.length, 6);
  const plain = K_FORMAT_INDEX.filter((entry) => entry.cornerMarker === false);
  const marker = K_FORMAT_INDEX.filter((entry) => entry.cornerMarker === true);
  assert.equal(plain.length, 3);
  assert.equal(marker.length, 3);
  for (const entry of plain) {
    assert.equal(entry.formatIndex, K1_RESERVED_FORMAT_INDEX, entry.name);
    assert.equal(kFormatSpec(entry.version), entry);
    assert.equal(kSpecFromFormatIndex(7, entry.k), entry);
  }
  for (const entry of marker) {
    assert.equal(entry.formatIndex, K_MARKER_FORMAT_INDEX, entry.name);
    assert.equal(kMarkerFormatSpec(entry.version), entry);
    assert.equal(kSpecFromFormatIndex(K_MARKER_FORMAT_INDEX, entry.k), entry);
    // K-CM 은 «옵션» 이라 기저 평 K 와 격자 크기가 같고 이름만 CM 접미다.
    const base = kFormatSpec(entry.version);
    assert.equal(entry.k, base.k);
    assert.equal(entry.name, base.name + 'CM');
    assert.notEqual(entry.formatIndex, base.formatIndex,
      'K-CM 이 평 K 와 같은 값이면 디코더가 마커 회계를 못 가른다');
  }
  assert.equal(kSpecFromFormatIndex(7, 4), null);
  assert.equal(kSpecFromFormatIndex(0, 6), null);
  assert.throws(() => kFormatSpec(3), RangeError);
  assert.throws(() => kMarkerFormatSpec(3), RangeError);
  // VERSIONS_K 가 표의 **평 K 행**을 그대로 승계한다 (이름·k·인덱스).
  for (const spec of VERSIONS_K) {
    const format = kFormatSpec(spec.version);
    assert.equal(spec.name, format.name);
    assert.equal(spec.k, format.k);
    assert.equal(spec.formatIndex, format.formatIndex);
  }
});

test('hex·tri 축 전체가 예약 밴드(7 + cube 8..11)를 비워 둔다 — 이중 안전의 전제', () => {
  const claims = [
    ...hexTriAxisOccupancy(),
    ...TURN_A_FORMAT_INDEX.map((entry) => ({ owner: entry.name, formatIndex: entry.formatIndex, k: entry.k })),
    ...MARKER_G_FORMAT_INDEX.map((entry) => ({ owner: entry.name, formatIndex: entry.formatIndex, k: entry.k })),
  ];
  const band = [K1_RESERVED_FORMAT_INDEX, ...CUBE_RESERVED_FORMAT_INDEXES];
  assert.ok(band.includes(K_MARKER_FORMAT_INDEX), 'K-CM 값이 예약 밴드 안이어야 한다');
  for (const claim of claims) {
    assert.ok(!band.includes(claim.formatIndex),
      claim.owner + ' 가 예약 밴드 값 ' + claim.formatIndex + ' 을 점유한다');
  }
  // 역방향 — hex·tri 의 «빈 칸» 이 정확히 그 밴드여야 한다 (밴드 밖 빈 칸이 생기면
  // «K 값은 hex·tri 에 없다» 논거가 아니라 «아직 안 썼을 뿐» 이 된다).
  const byK = new Map();
  for (const claim of claims) {
    if (!byK.has(claim.k)) byK.set(claim.k, new Set());
    byK.get(claim.k).add(claim.formatIndex);
  }
  for (const [k, used] of byK) {
    const free = [];
    for (let v = 0; v < 16; v += 1) if (!used.has(v)) free.push(v);
    assert.deepEqual(free, band.slice().sort((a, b) => a - b), `k=${k} 의 빈 값`);
  }
});

test('cube 축과 star 축은 값이 겹쳐도 크기 축이 안 겹친다 (K-CM 이 8 을 쓰는 근거)', () => {
  assert.deepEqual(CUBE_AXIS_FORMAT_INDEXES, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);
  assert.ok(CUBE_AXIS_FORMAT_INDEXES.includes(K1_RESERVED_FORMAT_INDEX),
    'F-90: K 값 7은 cube 초안 와이어가 이미 점유한다');
  for (const y of CUBE_AXIS_FORMAT_CLAIMS) {
    for (const entry of K_FORMAT_INDEX) {
      if (y.formatIndex !== entry.formatIndex) continue;
      assert.notEqual(y.n, entry.k,
        `cube ${y.owner}(값 ${y.formatIndex}, n${y.n}) 과 star ${entry.name}(k${entry.k}) 이 크기까지 겹친다`);
    }
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
