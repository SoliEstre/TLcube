// capacityA.test.js — Type A 용량표 스냅샷 (ADR 0005 D5·D6)
//
// **이 테스트의 목적은 통과가 아니라 깨지는 것이다** (capacity.test.js/capacityY.test.js
// 와 같은 자세).
//
// [A-U1 잠정 경고] NSYM_TABLE_A 는 아직 사용자 비준 전 잠정표다(capacityA.js 모듈
// 헤더 주석 참조). 이 스냅샷이 깨졌다면 먼저 NSYM_TABLE_A 가 왜 바뀌었는지
// 확인해라 — A-U1 비준으로 바뀐 것이라면 스냅샷을 그 확정값으로 갱신하는 것이 맞다.
//
// [발견 — base211 청킹 정렬 불일치, A2/H] capacity.js 의 K=maxBytesForSymbols(S)
// 는 S 심볼 전체를 **하나의 큰 base-211 숫자**로 보는 공식이고, 실제 인코더
// (base211.js)는 **27B↔28심볼 청크** 단위로 변환한다 — 두 방식의 "심볼당 효율"이
// 항상 일치하지는 않는다(청크 경계에서 반올림 손실이 다르게 쌓인다). Type O(V1~V3)
// 의 기존 9개 (버전,레벨) 조합은 전부 우연히 정렬되어 있었지만, Type A 의
// NSYM_TABLE_A.A2.H=57(dataSymbols=86)은 **정렬이 깨진다**(청크 인코더가 86개가
// 아니라 87개 심볼을 요구) — encodeA.js 의 자기검증이 이를 그 자리에서 던진다
// (조용히 넘어가지 않는다, 과제 지침 절대 규칙 6). 이 테스트가 그 사실 자체를
// 회귀로 고정한다 — "언젠가 우연히 맞아떨어지면" 재검토가 필요하다는 신호다.
// A-U1 비준 시 이 불일치를 근거로 A2/H nsym 재검토를 권고한다.

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
    const a1 = capacityForA(VERSIONS_A[0], 'M');
    const a2 = capacityForA(VERSIONS_A[1], 'M');
    assert.equal(a1.maxPayloadBytes, 62, 'A1-M KAT 불일치');
    assert.equal(a2.maxPayloadBytes, 101, 'A2-M KAT 불일치');
  });

  test('ADR 0005 D5 L/H 참고값 — A1 L=74B/H=50B · A2 L=120B/H=82B', () => {
    const a1L = capacityForA(VERSIONS_A[0], 'L');
    const a1H = capacityForA(VERSIONS_A[0], 'H');
    const a2L = capacityForA(VERSIONS_A[1], 'L');
    const a2H = capacityForA(VERSIONS_A[1], 'H');
    assert.equal(a1L.maxPayloadBytes, 74);
    assert.equal(a1H.maxPayloadBytes, 50);
    assert.equal(a2L.maxPayloadBytes, 120);
    assert.equal(a2H.maxPayloadBytes, 82);
  });

  test('마크다운 표가 렌더된다', () => {
    const md = renderMarkdownTableA('M');
    assert.match(md, /\| A1 \| 8 \| 325 \| 58 \| 267 \| 89 \| 0 \| 23 \| 11 \| 66 \| 63 B \| \*\*62 B\*\* \|/);
    assert.match(md, /\| A2 \| 10 \| 496 \| 65 \| 431 \| 143 \| 2 \| 37 \| 18 \| 106 \| 102 B \| \*\*101 B\*\* \|/);
    assert.ok(!md.includes('~'), '단일 물결표는 GFM 취소선 트랩이다 (규약 §6.11)');
  });
});

describe('versionSpecA — 버전 단일 조회', () => {
  test('A1/A2 는 VERSIONS_A[0]/[1] 과 정확히 같다', () => {
    assert.equal(versionSpecA(1), VERSIONS_A[0]);
    assert.equal(versionSpecA(2), VERSIONS_A[1]);
  });

  test('알 수 없는 version 은 RangeError', () => {
    assert.throws(() => versionSpecA(99), RangeError);
    assert.throws(() => versionSpecA(0), RangeError);
  });
});

describe('오버헤드 실계산 = 19(불스아이) + 15(포맷) + 6(앵커) + 육각레퍼런스 + 패치레퍼런스 (D5 검산 58/65)', () => {
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
    const a1 = VERSIONS_A[0];
    // dataCells=267, usedSymbols=89. overhead+3 → dataCells=264 → usedSymbols=88 로 어긋난다.
    const nudged = { ...a1, overhead: a1.overhead + 3 };
    assert.throws(() => capacityForA(nudged, 'M'), /NSYM_TABLE_A\.A1\.symbols/);
  });
});

describe('base211 청킹 정렬 — dataBytes 를 실제로 dataSymbols 개로 되돌릴 수 있는가', () => {
  test('A1(L/M/H)·A2(L/M) 은 정렬된다 — symbolCountForByteLength(dataBytes) === dataSymbols', () => {
    for (const [spec, level] of [
      [VERSIONS_A[0], 'L'], [VERSIONS_A[0], 'M'], [VERSIONS_A[0], 'H'],
      [VERSIONS_A[1], 'L'], [VERSIONS_A[1], 'M'],
    ]) {
      const r = capacityForA(spec, level);
      assert.equal(
        symbolCountForByteLength(r.dataBytes), r.dataSymbols,
        `${r.name}/${level}: dataBytes=${r.dataBytes} 를 청크 인코더로 되돌리면 dataSymbols 와 어긋난다`,
      );
    }
  });

  test('A2/H 는 정렬이 깨진다(발견 — 위 모듈 헤더 주석 참조) — 우연히 맞아떨어지면 이 테스트를 재검토하라', () => {
    const r = capacityForA(VERSIONS_A[1], 'H');
    assert.equal(r.dataSymbols, 86);
    assert.equal(r.dataBytes, 83);
    assert.notEqual(
      symbolCountForByteLength(r.dataBytes), r.dataSymbols,
      'A2/H 청킹 정렬 불일치가 해소됐다 — NSYM_TABLE_A.A2.H 가 바뀌었는지 확인하고 이 테스트를 갱신하라',
    );
    assert.equal(symbolCountForByteLength(r.dataBytes), 87);
  });

  test('chunkAligned 플래그가 정렬 여부를 그대로 노출한다 (표 소비자 계약)', () => {
    for (const [spec, level, expected] of [
      [VERSIONS_A[0], 'L', true], [VERSIONS_A[0], 'M', true], [VERSIONS_A[0], 'H', true],
      [VERSIONS_A[1], 'L', true], [VERSIONS_A[1], 'M', true], [VERSIONS_A[1], 'H', false],
    ]) {
      const r = capacityForA(spec, level);
      assert.equal(r.chunkAligned, expected, `${r.name}/${level} chunkAligned`);
    }
  });

  test('renderMarkdownTableA: 비정렬 행(A2/H)에만 인코딩 불가 마킹이 붙는다', () => {
    const tableH = renderMarkdownTableA('H');
    const a2Row = tableH.split('\n').find((line) => line.startsWith('| A2 '));
    assert.ok(a2Row.includes('청킹 비정렬'), 'A2/H 행에 인코딩 불가 마킹이 없다');
    const a1Row = tableH.split('\n').find((line) => line.startsWith('| A1 '));
    assert.ok(!a1Row.includes('청킹 비정렬'), 'A1/H 행에 마킹이 잘못 붙었다');
    assert.ok(!renderMarkdownTableA('M').includes('청킹 비정렬'), 'M 표에 마킹이 잘못 붙었다');
  });
});
