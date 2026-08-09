// capacityA.test.js — Type A 용량표 스냅샷 (ADR 0005 D5·D6)
//
// **이 테스트의 목적은 통과가 아니라 깨지는 것이다** (capacity.test.js/capacityY.test.js
// 와 같은 자세).
//
// [A-U1 ✅ 확정] NSYM_TABLE_A 는 사용자 비준 완료표다 (2026-08-09,
// hb-20260809-tlrat1 — A2/H 는 절차값 57 대신 정렬되는 59 로 확정). 이 스냅샷이
// 깨졌다면 먼저 NSYM_TABLE_A 가 왜 바뀌었는지 확인해라.
//
// [발견 — base211 청킹 정렬 불일치] capacity.js 의 K=maxBytesForSymbols(S)
// 는 S 심볼 전체를 **하나의 큰 base-211 숫자**로 보는 공식이고, 실제 인코더
// (base211.js)는 **27B↔28심볼 청크** 단위로 변환한다 — 두 방식의 "심볼당 효율"이
// 항상 일치하지는 않는다(청크 경계에서 반올림 손실이 다르게 쌓인다). Type O(V1~V3)
// 의 기존 9개 (버전,레벨) 조합은 전부 우연히 정렬되어 있었지만, 구 절차값
// A2/H=57(dataSymbols=86)은 정렬이 깨졌다(청크 인코더가 87개 심볼을 요구) —
// A-U1 비준이 이 불일치를 근거로 H 를 59 로 확정했다 (정렬·홀수·절차 최근접).
// 아래 청킹 정렬 절이 구 57 비정렬 사실과 현행 전 조합 정렬을 함께 고정한다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERSIONS_A,
  NSYM_TABLE_A,
  overheadBreakdownA,
  capacityForA,
  capacityTableA,
  renderMarkdownTableA,
  versionSpecA,
  hexCellCount,
} from '../src/capacityA.js';
import { maxBytesForSymbols } from '../src/capacity.js';
import { errorCapacity } from '../src/rs211.js';
import { maxPayloadFor } from '../src/header.js';
import { symbolCountForByteLength } from '../src/base211.js';

const SNAPSHOT_M = [
  {
    name: 'A0', version: 0, k: 6, formatIndex: 1, totalCells: 190, overhead: 54, dataCells: 136,
    usedSymbols: 45, residualCells: 1, nsym: 11, errorCapacity: 5, dataSymbols: 34, dataBytes: 32, maxPayloadBytes: 31,
  },
  {
    name: 'A1', version: 1, k: 8, formatIndex: 12, totalCells: 325, overhead: 58, dataCells: 267,
    usedSymbols: 89, residualCells: 0, nsym: 23, errorCapacity: 11, dataSymbols: 66, dataBytes: 63, maxPayloadBytes: 62,
  },
  {
    name: 'A2', version: 2, k: 10, formatIndex: 13, totalCells: 496, overhead: 65, dataCells: 431,
    usedSymbols: 143, residualCells: 2, nsym: 37, errorCapacity: 18, dataSymbols: 106, dataBytes: 102, maxPayloadBytes: 101,
  },
];

describe('용량표 스냅샷 (Type A, ECC-M)', () => {
  test('전 버전 튜플이 스냅샷과 일치', () => {
    const actual = capacityTableA('M');
    assert.equal(actual.length, SNAPSHOT_M.length);
    for (let i = 0; i < SNAPSHOT_M.length; i += 1) {
      for (const [k, expected] of Object.entries(SNAPSHOT_M[i])) {
        assert.equal(actual[i][k], expected, `${SNAPSHOT_M[i].name}.${k}: ${actual[i][k]} !== ${expected}`);
      }
    }
  });

  test('ADR 0005 D5 순 페이로드 KAT — A1-M 62 B · A2-M 101 B (다르면 throw+보고, 조용히 맞추지 않는다)', () => {
    // 위치 인덱스가 아니라 versionSpecA 로 잡는다 — ADR 0006 이 A0 를 배열 선두에
    // 끼워 넣었고, 앞으로도 버전 추가는 위치를 밀 수 있다.
    const a1 = capacityForA(versionSpecA(1), 'M');
    const a2 = capacityForA(versionSpecA(2), 'M');
    assert.equal(a1.maxPayloadBytes, 62, 'A1-M KAT 불일치');
    assert.equal(a2.maxPayloadBytes, 101, 'A2-M KAT 불일치');
  });

  test('L/H 참고값 — A0 L=37B/H=25B · A1 L=74B/H=50B · A2 L=120B/H=80B (H=59, A-U1 비준 확정)', () => {
    const a0L = capacityForA(versionSpecA(0), 'L');
    const a0H = capacityForA(versionSpecA(0), 'H');
    const a1L = capacityForA(versionSpecA(1), 'L');
    const a1H = capacityForA(versionSpecA(1), 'H');
    const a2L = capacityForA(versionSpecA(2), 'L');
    const a2H = capacityForA(versionSpecA(2), 'H');
    assert.equal(a0L.maxPayloadBytes, 37); // ADR 0006 D6
    assert.equal(a0H.maxPayloadBytes, 25);
    assert.equal(a1L.maxPayloadBytes, 74);
    assert.equal(a1H.maxPayloadBytes, 50);
    assert.equal(a2L.maxPayloadBytes, 120);
    assert.equal(a2H.maxPayloadBytes, 80);
    assert.equal(a2H.nsym, 59);
    assert.equal(a2H.dataSymbols, 84);
    assert.equal(a2H.errorCapacity, 29);
  });

  test('마크다운 표가 렌더된다', () => {
    const md = renderMarkdownTableA('M');
    assert.match(md, /\| A1 \| 8 \| 325 \| 58 \| 267 \| 89 \| 0 \| 23 \| 11 \| 66 \| 63 B \| \*\*62 B\*\* \|/);
    assert.match(md, /\| A2 \| 10 \| 496 \| 65 \| 431 \| 143 \| 2 \| 37 \| 18 \| 106 \| 102 B \| \*\*101 B\*\* \|/);
    assert.ok(!md.includes('~'), '단일 물결표는 GFM 취소선 트랩이다 (규약 §6.11)');
  });
});

describe('versionSpecA — 버전 단일 조회', () => {
  test('A0/A1/A2 는 VERSIONS_A[0]/[1]/[2] 과 정확히 같다 (배열 순 = 용량 오름차순)', () => {
    assert.equal(versionSpecA(0), VERSIONS_A[0]);
    assert.equal(versionSpecA(1), VERSIONS_A[1]);
    assert.equal(versionSpecA(2), VERSIONS_A[2]);
  });

  test('알 수 없는 version 은 RangeError', () => {
    assert.throws(() => versionSpecA(99), RangeError);
    assert.throws(() => versionSpecA(3), RangeError);
    assert.throws(() => versionSpecA(-1), RangeError);
  });
});

describe('오버헤드 실계산 = 19(불스아이) + 15(포맷) + 6(앵커) + 육각레퍼런스 + 패치레퍼런스 (검산 54/58/65)', () => {
  test('overheadBreakdownA(6) = 54 — ADR 0006 D6 검산값 (A0)', () => {
    const ob6 = overheadBreakdownA(6);
    assert.equal(ob6.bullseye, 19);
    assert.equal(ob6.anchor, 6);
    assert.equal(ob6.format, 15);
    assert.equal(ob6.hexReference, 8); // 2*(6-2)
    assert.equal(ob6.patchReference, 6); // 규칙 R 링 {8,11}
    assert.equal(ob6.total, 54);
  });

  test('overheadBreakdownA(k) 는 k=8 에서 58, k=10 에서 65 (하드코딩 아님, 실계산 합)', () => {
    const ob8 = overheadBreakdownA(8);
    assert.equal(ob8.bullseye, 19);
    assert.equal(ob8.anchor, 6);
    assert.equal(ob8.format, 15);
    assert.equal(ob8.hexReference, 12); // 2*(8-2)
    assert.equal(ob8.patchReference, 6);
    assert.equal(ob8.total, 58);

    const ob10 = overheadBreakdownA(10);
    assert.equal(ob10.bullseye, 19);
    assert.equal(ob10.anchor, 6);
    assert.equal(ob10.format, 15);
    assert.equal(ob10.hexReference, 16); // 2*(10-2)
    assert.equal(ob10.patchReference, 9);
    assert.equal(ob10.total, 65);
  });

  test('VERSIONS_A.overhead 는 overheadBreakdownA 실계산과 정확히 같다 (상수 아님을 단언)', () => {
    for (const v of VERSIONS_A) {
      assert.equal(v.overhead, overheadBreakdownA(v.k).total, `${v.name}.overhead(${v.overhead}) 가 실계산과 어긋난다`);
    }
  });
});

describe('D1 셀 수 항등 — 총 셀 = 육각부(hexCellCount) + 패치 3·k(k+1)/2', () => {
  test('k=8·10 전수 확인', () => {
    for (const v of VERSIONS_A) {
      const total = (3 * v.k + 1) * (3 * v.k + 2) / 2;
      const patch = 3 * v.k * (v.k + 1) / 2;
      assert.equal(total, hexCellCount(v.k) + patch, `${v.name}`);
      assert.equal(total, capacityForA(v, 'M').totalCells, `${v.name}`);
    }
  });
});

describe('용량 산술이 다른 모듈과 정합', () => {
  test('데이터 셀 = 총 셀 − 오버헤드', () => {
    for (const r of capacityTableA('M')) assert.equal(r.dataCells, r.totalCells - r.overhead);
  });

  test('사용 심볼/잔여 셀 = 데이터 셀을 3으로 나눈 몫/나머지', () => {
    for (const r of capacityTableA('M')) {
      assert.equal(r.usedSymbols, Math.floor(r.dataCells / 3));
      assert.equal(r.residualCells, r.dataCells - r.usedSymbols * 3);
      assert.ok(r.residualCells >= 0 && r.residualCells < 3);
    }
  });

  test('nsym·t 는 NSYM_TABLE_A 표 값과 정확히 같다 (공식 유도 아님, [A-U1] 잠정)', () => {
    for (const v of VERSIONS_A) {
      for (const level of ['L', 'M', 'H']) {
        const r = capacityForA(v, level);
        assert.equal(r.nsym, NSYM_TABLE_A[v.symbolKey][level]);
        assert.equal(r.errorCapacity, errorCapacity(r.nsym));
      }
    }
  });

  test('데이터 심볼 = 사용 심볼 − nsym', () => {
    for (const r of capacityTableA('M')) assert.equal(r.dataSymbols, r.usedSymbols - r.nsym);
  });

  test('K = maxBytesForSymbols(데이터 심볼) — capacity.js 회계 재사용(전용 재구현 아님)', () => {
    for (const r of capacityTableA('M')) {
      assert.equal(r.dataBytes, maxBytesForSymbols(r.dataSymbols));
      const cap = 211n ** BigInt(r.dataSymbols);
      assert.ok((1n << BigInt(8 * r.dataBytes)) <= cap, 'K 바이트는 실제로 들어가야 한다');
      assert.ok((1n << BigInt(8 * (r.dataBytes + 1))) > cap, 'K+1 바이트는 들어가면 안 된다(최대성)');
    }
  });

  test('순 페이로드 = 데이터 바이트 K − 헤더 1B', () => {
    for (const r of capacityTableA('M')) {
      assert.equal(r.maxPayloadBytes, maxPayloadFor(r.dataBytes));
      assert.equal(r.maxPayloadBytes, r.dataBytes - 1);
    }
  });
});

describe('ECC 레벨이 높을수록 순 페이로드가 줄지 않는 일은 없다', () => {
  test('L >= M >= H (페이로드), L <= M <= H (정정 능력)', () => {
    for (const v of VERSIONS_A) {
      const L = capacityForA(v, 'L');
      const M = capacityForA(v, 'M');
      const H = capacityForA(v, 'H');
      assert.ok(L.maxPayloadBytes >= M.maxPayloadBytes, `${v.name}: L < M`);
      assert.ok(M.maxPayloadBytes >= H.maxPayloadBytes, `${v.name}: M < H`);
      assert.ok(L.errorCapacity <= M.errorCapacity);
      assert.ok(M.errorCapacity <= H.errorCapacity);
    }
  });
});

describe('NSYM_TABLE_A 불일치는 조용히 넘어가지 않는다', () => {
  test('symbolKey 가 표에 없으면 던진다', () => {
    const bogus = {
      name: 'A99', version: 99, k: 8, overhead: 58, symbolKey: 'A99',
    };
    assert.throws(() => capacityForA(bogus, 'M'), /NSYM_TABLE_A/);
  });

  test('오버헤드가 어긋나 usedSymbols 가 표와 안 맞으면 던진다', () => {
    const a1 = versionSpecA(1);
    // dataCells=267, usedSymbols=89. overhead+3 → dataCells=264 → usedSymbols=88 로 어긋난다.
    const nudged = { ...a1, overhead: a1.overhead + 3 };
    assert.throws(() => capacityForA(nudged, 'M'), /NSYM_TABLE_A\.A1\.symbols/);
  });
});

describe('base211 청킹 정렬 — dataBytes 를 실제로 dataSymbols 개로 되돌릴 수 있는가', () => {
  test('전 9조합(A0·A1·A2 × L/M/H)이 정렬된다 — symbolCountForByteLength(dataBytes) === dataSymbols (A-U1 확정 후)', () => {
    for (const spec of VERSIONS_A) {
      for (const level of ['L', 'M', 'H']) {
        const r = capacityForA(spec, level);
        assert.equal(
          symbolCountForByteLength(r.dataBytes), r.dataSymbols,
          `${r.name}/${level}: dataBytes=${r.dataBytes} 를 청크 인코더로 되돌리면 dataSymbols 와 어긋난다`,
        );
        assert.equal(r.chunkAligned, true, `${r.name}/${level} chunkAligned`);
      }
    }
  });

  test('구 절차값 A2/H=57 은 비정렬이었다 — 발견 사실의 회귀 기록 (표 무관 직접 계산)', () => {
    // dataSymbols=143-57=86 → K 공식 83B, 그러나 청크 인코더는 83B 에 87심볼 요구.
    const oldDataSymbols = 143 - 57;
    const oldK = maxBytesForSymbols(oldDataSymbols);
    assert.equal(oldK, 83);
    assert.equal(symbolCountForByteLength(oldK), 87);
    assert.notEqual(symbolCountForByteLength(oldK), oldDataSymbols);
  });

  test('renderMarkdownTableA: 현행 표에는 어느 레벨에도 인코딩 불가 마킹이 없다', () => {
    for (const level of ['L', 'M', 'H']) {
      assert.ok(
        !renderMarkdownTableA(level).includes('청킹 비정렬'),
        `${level} 표에 비정렬 마킹이 남아 있다 — NSYM_TABLE_A 재확인 필요`,
      );
    }
  });
});
