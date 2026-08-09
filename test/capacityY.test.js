// capacityY.test.js — SPEC §14 Type Y 용량표 스냅샷 (ADR 0003 D7·U3·U9·v3.1§4b)
//
// **이 테스트의 목적은 통과가 아니라 깨지는 것이다** (capacity.test.js 와 같은 자세).
//
// [U3 잠정 경고] NSYM_TABLE_Y 는 아직 사용자 확정 전 잠정표다(capacityY.js 모듈 헤더
// 주석 참조). 이 스냅샷이 깨졌다면 먼저 NSYM_TABLE_Y 가 왜 바뀌었는지 확인해라 — U3
// 확정으로 바뀐 것이라면 스냅샷을 그 확정값으로 갱신하는 것이 맞다.
//
// [검산] ADR 0003 D7 은 Y1/ECC-M 순 페이로드를 95 B(레퍼런스 개수 규칙 5% 가정)로
// 추정했다. 이 구현은 레퍼런스 12셀(U9 확정: 4조×3셀) 실계산을 쓰므로 값이 다르다 —
// 아래 스냅샷은 **98 B** 로 고정한다(조용히 95 로 맞추지 않는다). Y2 도 마찬가지로
// ADR 137 B 추정과 달리 **141 B** 로 고정한다. 차이는 오버헤드 실계산(27, ADR 의 5%
// 가정과 다름)과 NSYM_TABLE_Y 잠정표(U3 미확정)에서 온다 — U3 확정 후 재검증 필요.
//
// [v3.1 §4b 2톤 메인 전환] VERSIONS_Y 가 4항목(Y1·Y2·Y1T·Y2T)으로 늘었다. Y1T/Y2T 는
// tones=3·formatIndex 만 다르고 나머지 용량 수치는 Y1/Y2 와 완전히 같아야 한다
// ("용량 회계는 tones 무관 동일" — ADR 근거 수치). 스냅샷이 그 항등을 고정한다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERSIONS_Y, NSYM_TABLE_Y, overheadBreakdownY, capacityForY, capacityTableY, renderMarkdownTableY,
  versionSpecY,
} from '../src/capacityY.js';
import { maxBytesForSymbols } from '../src/capacity.js';
import { errorCapacity } from '../src/rs211.js';
import { maxPayloadFor } from '../src/header.js';

const SNAPSHOT_M = [
  {
    name: 'Y1', version: 1, n: 21, tones: 2, formatIndex: 8, totalCells: 441, overhead: 27, dataCells: 414,
    usedSymbols: 138, residualCells: 0, nsym: 35, errorCapacity: 17, dataSymbols: 103, dataBytes: 99, maxPayloadBytes: 98,
  },
  {
    name: 'Y2', version: 2, n: 25, tones: 2, formatIndex: 9, totalCells: 625, overhead: 27, dataCells: 598,
    usedSymbols: 199, residualCells: 1, nsym: 51, errorCapacity: 25, dataSymbols: 148, dataBytes: 142, maxPayloadBytes: 141,
  },
  {
    name: 'Y1T', version: 1, n: 21, tones: 3, formatIndex: 10, totalCells: 441, overhead: 27, dataCells: 414,
    usedSymbols: 138, residualCells: 0, nsym: 35, errorCapacity: 17, dataSymbols: 103, dataBytes: 99, maxPayloadBytes: 98,
  },
  {
    name: 'Y2T', version: 2, n: 25, tones: 3, formatIndex: 11, totalCells: 625, overhead: 27, dataCells: 598,
    usedSymbols: 199, residualCells: 1, nsym: 51, errorCapacity: 25, dataSymbols: 148, dataBytes: 142, maxPayloadBytes: 141,
  },
];

describe('용량표 스냅샷 (Type Y, ECC-M)', () => {
  test('전 버전 튜플이 스냅샷과 일치', () => {
    const actual = capacityTableY('M');
    assert.equal(actual.length, SNAPSHOT_M.length);
    for (let i = 0; i < SNAPSHOT_M.length; i += 1) {
      for (const [key, expected] of Object.entries(SNAPSHOT_M[i])) {
        assert.equal(actual[i][key], expected,
          `Y${SNAPSHOT_M[i].version}.${key}: ${actual[i][key]} !== ${expected}`);
      }
    }
  });

  test('ADR 0003 D7 의 95 B(Y1)·137 B(Y2) 추정과 실계산이 다르다는 것을 명시 확인', () => {
    const y1 = capacityForY(VERSIONS_Y[0], 'M');
    const y2 = capacityForY(VERSIONS_Y[1], 'M');
    assert.notEqual(y1.maxPayloadBytes, 95,
      'ADR 추정 95 B 와 우연히 같아졌다 — 이 테스트 의도(차이 보고)를 재검토하라');
    assert.equal(y1.maxPayloadBytes, 98);
    assert.notEqual(y2.maxPayloadBytes, 137,
      'ADR 추정 137 B 와 우연히 같아졌다 — 이 테스트 의도(차이 보고)를 재검토하라');
    assert.equal(y2.maxPayloadBytes, 141);
  });

  test('마크다운 표가 렌더된다 (SPEC §14 에 붙일 형태)', () => {
    const md = renderMarkdownTableY('M');
    assert.match(md, /\| Y1 \| 21 \| 441 \| 27 \| 414 \| 138 \| 0 \| 35 \| 17 \| 103 \| 99 B \| \*\*98 B\*\* \|/);
    assert.match(md, /\| Y2 \| 25 \| 625 \| 27 \| 598 \| 199 \| 1 \| 51 \| 25 \| 148 \| 142 B \| \*\*141 B\*\* \|/);
    assert.match(md, /\| Y1T \| 21 \| 441 \| 27 \| 414 \| 138 \| 0 \| 35 \| 17 \| 103 \| 99 B \| \*\*98 B\*\* \|/);
    assert.match(md, /\| Y2T \| 25 \| 625 \| 27 \| 598 \| 199 \| 1 \| 51 \| 25 \| 148 \| 142 B \| \*\*141 B\*\* \|/);
    assert.ok(!md.includes('~'), '단일 물결표는 GFM 취소선 트랩이다 (규약 §6.11)');
  });
});

describe('versionSpecY — (version, tones) 단일 조회 (v3.1 §4b)', () => {
  test('Y1/Y2(tones=2, 기본값) 는 VERSIONS_Y[0]/[1] 과 정확히 같다', () => {
    assert.equal(versionSpecY(1), VERSIONS_Y[0]);
    assert.equal(versionSpecY(1, 2), VERSIONS_Y[0]);
    assert.equal(versionSpecY(2, 2), VERSIONS_Y[1]);
  });

  test('Y1T/Y2T(tones=3) 는 VERSIONS_Y[2]/[3] 과 정확히 같다', () => {
    assert.equal(versionSpecY(1, 3), VERSIONS_Y[2]);
    assert.equal(versionSpecY(2, 3), VERSIONS_Y[3]);
  });

  test('알 수 없는 (version, tones) 조합은 RangeError', () => {
    assert.throws(() => versionSpecY(99, 2), RangeError);
    assert.throws(() => versionSpecY(1, 4), RangeError);
    assert.throws(() => versionSpecY(0, 2), RangeError);
  });
});

describe('용량 회계는 tones 무관 동일 (v3.1 §4b 근거 수치)', () => {
  test('Y1 과 Y1T — formatIndex·tones 만 다르고 나머지 용량 수치는 완전히 같다', () => {
    const y1 = capacityForY(VERSIONS_Y[0], 'M');
    const y1t = capacityForY(VERSIONS_Y[2], 'M');
    for (const key of [
      'n', 'totalCells', 'overhead', 'dataCells', 'usedSymbols', 'residualCells',
      'nsym', 'errorCapacity', 'dataSymbols', 'dataBytes', 'maxPayloadBytes',
    ]) {
      assert.equal(y1[key], y1t[key], `Y1.${key} !== Y1T.${key}`);
    }
    assert.notEqual(y1.tones, y1t.tones);
    assert.notEqual(y1.formatIndex, y1t.formatIndex);
  });

  test('Y2 와 Y2T — 동일 항등', () => {
    const y2 = capacityForY(VERSIONS_Y[1], 'M');
    const y2t = capacityForY(VERSIONS_Y[3], 'M');
    for (const key of [
      'n', 'totalCells', 'overhead', 'dataCells', 'usedSymbols', 'residualCells',
      'nsym', 'errorCapacity', 'dataSymbols', 'dataBytes', 'maxPayloadBytes',
    ]) {
      assert.equal(y2[key], y2t[key], `Y2.${key} !== Y2T.${key}`);
    }
  });
});

describe('오버헤드 실계산 = 15(포맷) + 12(레퍼런스) = 27 (하드코딩 아님)', () => {
  test('overheadBreakdownY(n) 은 n=21·25 에서 항상 27', () => {
    for (const n of [21, 25]) {
      const ob = overheadBreakdownY(n);
      assert.equal(ob.reference, 12, `n=${n}`);
      assert.equal(ob.format, 15, `n=${n}`);
      assert.equal(ob.total, 27, `n=${n}`);
    }
  });

  test('VERSIONS_Y.overhead 는 overheadBreakdownY 실계산과 정확히 같다 (상수 아님을 단언)', () => {
    for (const v of VERSIONS_Y) {
      assert.equal(v.overhead, overheadBreakdownY(v.n).total,
        `Y${v.version}.overhead(${v.overhead}) 가 실계산과 어긋난다`);
    }
  });
});

describe('용량 산술이 다른 모듈과 정합', () => {
  test('총 셀 = n² (인덱스 격자, 기하 없음)', () => {
    for (const r of capacityTableY('M')) assert.equal(r.totalCells, r.n * r.n);
  });

  test('데이터 셀 = 총 셀 − 오버헤드', () => {
    for (const r of capacityTableY('M')) assert.equal(r.dataCells, r.totalCells - r.overhead);
  });

  test('사용 심볼/잔여 셀 = 데이터 셀을 3으로 나눈 몫/나머지', () => {
    for (const r of capacityTableY('M')) {
      assert.equal(r.usedSymbols, Math.floor(r.dataCells / 3));
      assert.equal(r.residualCells, r.dataCells - r.usedSymbols * 3);
      assert.ok(r.residualCells >= 0 && r.residualCells < 3);
    }
  });

  test('nsym·t 는 NSYM_TABLE_Y 표 값과 정확히 같다 (공식 유도 아님, [U3] 잠정)', () => {
    for (const v of VERSIONS_Y) {
      for (const level of ['L', 'M', 'H']) {
        const r = capacityForY(v, level);
        assert.equal(r.nsym, NSYM_TABLE_Y[v.symbolKey][level]);
        assert.equal(r.errorCapacity, errorCapacity(r.nsym));
      }
    }
  });

  test('데이터 심볼 = 사용 심볼 − nsym', () => {
    for (const r of capacityTableY('M')) assert.equal(r.dataSymbols, r.usedSymbols - r.nsym);
  });

  test('K = maxBytesForSymbols(데이터 심볼) — capacity.js 회계 재사용 (전용 재구현 아님)', () => {
    for (const r of capacityTableY('M')) {
      assert.equal(r.dataBytes, maxBytesForSymbols(r.dataSymbols));
      const cap = 211n ** BigInt(r.dataSymbols);
      assert.ok((1n << BigInt(8 * r.dataBytes)) <= cap, 'K 바이트는 실제로 들어가야 한다');
      assert.ok((1n << BigInt(8 * (r.dataBytes + 1))) > cap, 'K+1 바이트는 들어가면 안 된다(최대성)');
    }
  });

  test('순 페이로드 = 데이터 바이트 K − 헤더 1 B', () => {
    for (const r of capacityTableY('M')) {
      assert.equal(r.maxPayloadBytes, maxPayloadFor(r.dataBytes));
      assert.equal(r.maxPayloadBytes, r.dataBytes - 1);
    }
  });
});

describe('ECC 레벨이 높을수록 순 페이로드가 줄지 않는 일은 없다', () => {
  test('L >= M >= H (페이로드), L <= M <= H (정정 능력)', () => {
    for (const v of VERSIONS_Y) {
      const L = capacityForY(v, 'L');
      const M = capacityForY(v, 'M');
      const H = capacityForY(v, 'H');
      assert.ok(L.maxPayloadBytes >= M.maxPayloadBytes, `Y${v.version}: L < M`);
      assert.ok(M.maxPayloadBytes >= H.maxPayloadBytes, `Y${v.version}: M < H`);
      assert.ok(L.errorCapacity <= M.errorCapacity);
      assert.ok(M.errorCapacity <= H.errorCapacity);
    }
  });
});

describe('NSYM_TABLE_Y 불일치는 조용히 넘어가지 않는다', () => {
  test('symbolKey 가 표에 없으면 던진다', () => {
    const bogus = {
      version: 99, n: 21, overhead: 27, symbolKey: 'Y99',
    };
    assert.throws(() => capacityForY(bogus, 'M'), /NSYM_TABLE_Y/);
  });

  test('오버헤드가 어긋나 usedSymbols 가 표와 안 맞으면 던진다', () => {
    const y1 = VERSIONS_Y[0];
    // dataCells=414, usedSymbols=138. overhead+3 → dataCells=411 → usedSymbols=137 로 어긋난다.
    const nudged = { ...y1, overhead: y1.overhead + 3 };
    assert.throws(() => capacityForY(nudged, 'M'), /NSYM_TABLE_Y\.Y1\.symbols/);
  });
});
