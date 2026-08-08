// capacity.test.js — SPEC §5.5 용량표 스냅샷 (GF(211) 심볼 회계 — ADR 0001)
//
// **이 테스트의 목적은 통과가 아니라 깨지는 것이다.**
//
// 잔여 셀: V1 = 1, V2 = 0 (168 = 56·3 정확), V3 = 2 (dataCells mod 3, T8 대사 후). 불스아이(§5.1)나
// 레퍼런스(§5.3)가 한 셀만 늘어도 usedSymbols 가 바뀌고, capacityFor 는 조용히 넘어가지
// 않고 `NSYM_TABLE` 과의 불일치로 던진다(과제 지침 절대 규칙 6). 여기 박아둔 스냅샷은
// 그 앞단에서 값 자체가 ADR §3.3 표와 일치하는지 잡는다.
//
// **깨졌다고 스냅샷부터 고치지 마라** — 무엇이 왜 바뀌었는지 먼저 확인해라.
// M0 T8 에서 layout(placement.js `overheadBreakdown`) 이 오버헤드를 실계산하게 되며
// 이 스냅샷은 확정 표로 갱신됐다 — V2 만 값이 바뀐다(overhead 50→49, dataCells 167→168,
// usedSymbols 55→56, residual 2→0, dataSymbols 41→42, 순 페이로드 38→39). V1/V3 는
// 실계산이 잠정치와 산술적으로 같은 usedSymbols 를 내 스냅샷이 그대로 유지된다
// (V3 는 overhead 55→53 으로 내려가지만 dataCells 276→278 이 되어도 ⌊278/3⌋=92 로 불변).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERSIONS, maxBytesForSymbols, capacityFor, capacityTable, renderMarkdownTable,
} from '../src/capacity.js';
import { cellCount } from '../src/hexgrid.js';
import { NSYM_TABLE, errorCapacity } from '../src/rs211.js';
import { maxPayloadFor } from '../src/header.js';
import { overheadBreakdown } from '../src/placement.js';

// ADR 0001 §3.3.2/§3.3.3 + .agent/PM/005_ecc_redesign.md P3 절 + M0 T8 오버헤드 대사
// (통합자 사전 검산, placement.overheadBreakdown(k) 실계산 반영). 사용자 검산 완료.
const SNAPSHOT_M = [
  {
    version: 1, k: 6, totalCells: 127, overhead: 45, dataCells: 82, usedSymbols: 27,
    residualCells: 1, nsym: 7, errorCapacity: 3, dataSymbols: 20, dataBytes: 19, maxPayloadBytes: 18,
  },
  {
    version: 2, k: 8, totalCells: 217, overhead: 49, dataCells: 168, usedSymbols: 56,
    residualCells: 0, nsym: 14, errorCapacity: 7, dataSymbols: 42, dataBytes: 40, maxPayloadBytes: 39,
  },
  {
    version: 3, k: 10, totalCells: 331, overhead: 53, dataCells: 278, usedSymbols: 92,
    residualCells: 2, nsym: 23, errorCapacity: 11, dataSymbols: 69, dataBytes: 66, maxPayloadBytes: 65,
  },
];

describe('용량표 스냅샷 (ADR 0001 §3.3, ECC-M)', () => {
  test('전 버전 튜플이 ADR 표와 일치', () => {
    const actual = capacityTable('M');
    assert.equal(actual.length, SNAPSHOT_M.length);
    for (let i = 0; i < SNAPSHOT_M.length; i += 1) {
      for (const [key, expected] of Object.entries(SNAPSHOT_M[i])) {
        assert.equal(actual[i][key], expected,
          `V${SNAPSHOT_M[i].version}.${key}: ${actual[i][key]} !== ${expected} (ADR §3.3 을 확인하라)`);
      }
    }
  });

  test('마크다운 표가 렌더된다 (SPEC 에 붙일 형태)', () => {
    const md = renderMarkdownTable('M');
    assert.match(md, /\| V1 \| 6 \| 127 \| 45 \| 82 \| 27 \| 1 \| 7 \| 3 \| 20 \| 19 B \| \*\*18 B\*\* \|/);
    assert.match(md, /\| V3 \| 10 \| 331 \| 53 \| 278 \| 92 \| 2 \| 23 \| 11 \| 69 \| 66 B \| \*\*65 B\*\* \|/);
    assert.ok(!md.includes('~'), '단일 물결표는 GFM 취소선 트랩이다 (규약 §6.11)');
  });
});

describe('용량 산술이 다른 모듈과 정합', () => {
  test('총 셀 = 3k²+3k+1 (hexgrid 와 일치)', () => {
    for (const r of capacityTable('M')) assert.equal(r.totalCells, cellCount(r.k));
  });

  test('데이터 셀 = 총 셀 − 오버헤드', () => {
    for (const r of capacityTable('M')) assert.equal(r.dataCells, r.totalCells - r.overhead);
  });

  test('사용 심볼/잔여 셀 = 데이터 셀을 3으로 나눈 몫/나머지', () => {
    for (const r of capacityTable('M')) {
      assert.equal(r.usedSymbols, Math.floor(r.dataCells / 3));
      assert.equal(r.residualCells, r.dataCells - r.usedSymbols * 3);
      assert.ok(r.residualCells >= 0 && r.residualCells < 3);
    }
  });

  test('nsym·t 는 rs211.js NSYM_TABLE 표 값과 정확히 같다 (공식 유도 아님)', () => {
    for (const v of VERSIONS) {
      for (const level of ['L', 'M', 'H']) {
        const r = capacityFor(v, level);
        assert.equal(r.nsym, NSYM_TABLE[v.symbolKey][level]);
        assert.equal(r.errorCapacity, errorCapacity(r.nsym));
      }
    }
  });

  test('데이터 심볼 = 사용 심볼 − nsym', () => {
    for (const r of capacityTable('M')) assert.equal(r.dataSymbols, r.usedSymbols - r.nsym);
  });

  test('K = maxBytesForSymbols(데이터 심볼) — 211^S >= 2^(8K) 를 만족하는 최댓값', () => {
    for (const r of capacityTable('M')) {
      assert.equal(r.dataBytes, maxBytesForSymbols(r.dataSymbols));
      const cap = 211n ** BigInt(r.dataSymbols);
      assert.ok((1n << BigInt(8 * r.dataBytes)) <= cap, 'K 바이트는 실제로 들어가야 한다');
      assert.ok((1n << BigInt(8 * (r.dataBytes + 1))) > cap, 'K+1 바이트는 들어가면 안 된다(최대성)');
    }
  });

  test('순 페이로드 = 데이터 바이트 K − 헤더 1 B', () => {
    for (const r of capacityTable('M')) {
      assert.equal(r.maxPayloadBytes, maxPayloadFor(r.dataBytes));
      assert.equal(r.maxPayloadBytes, r.dataBytes - 1);
    }
  });
});

describe('maxBytesForSymbols 는 진짜 최대인가 (경계값)', () => {
  test('S=0 이면 K=0', () => {
    assert.equal(maxBytesForSymbols(0), 0);
  });

  test('임의 S 에서 K 는 유일하고 최대다', () => {
    for (const S of [1, 5, 20, 27, 28, 41, 69, 92]) {
      const K = maxBytesForSymbols(S);
      const cap = 211n ** BigInt(S);
      assert.ok((1n << BigInt(8 * K)) <= cap);
      assert.ok((1n << BigInt(8 * (K + 1))) > cap);
    }
  });
});

describe('ECC 레벨이 높을수록 순 페이로드가 줄지 않는 일은 없다', () => {
  test('L >= M >= H (페이로드), L <= M <= H (정정 능력)', () => {
    for (const v of VERSIONS) {
      const L = capacityFor(v, 'L');
      const M = capacityFor(v, 'M');
      const H = capacityFor(v, 'H');
      assert.ok(L.maxPayloadBytes >= M.maxPayloadBytes, `V${v.version}: L < M`);
      assert.ok(M.maxPayloadBytes >= H.maxPayloadBytes, `V${v.version}: M < H`);
      assert.ok(L.errorCapacity <= M.errorCapacity);
      assert.ok(M.errorCapacity <= H.errorCapacity);
    }
  });
});

describe('NSYM_TABLE 불일치는 조용히 넘어가지 않는다', () => {
  test('symbolKey 가 표에 없으면 던진다', () => {
    const bogus = {
      version: 99, k: 6, overhead: 45, symbolKey: 'V99',
    };
    assert.throws(() => capacityFor(bogus, 'M'), /NSYM_TABLE/);
  });

  test('오버헤드가 어긋나 usedSymbols 가 표와 안 맞으면 던진다', () => {
    const v1 = VERSIONS[0];
    // dataCells=82, usedSymbols=27. overhead+4 → dataCells=78 → usedSymbols=26 로 어긋난다.
    const nudged = { ...v1, overhead: v1.overhead + 4 };
    assert.throws(() => capacityFor(nudged, 'M'), /NSYM_TABLE\.V1\.symbols/);
  });
});

describe('오버헤드는 이제 잠정이 아니다 (T8 완료)', () => {
  test('VERSIONS 에 provisional 플래그가 더 이상 없다 — [P1] 잠정 상수 이력이 내려갔다', () => {
    for (const v of VERSIONS) {
      assert.equal('provisional' in v, false,
        `V${v.version} 에 provisional 플래그가 남아있다 — T8 완료 후엔 있으면 안 된다`);
    }
  });

  test('overhead 는 placement.overheadBreakdown(k).total 실계산과 정확히 같다 (상수 아님을 단언)', () => {
    for (const v of VERSIONS) {
      assert.equal(v.overhead, overheadBreakdown(v.k).total,
        `V${v.version}.overhead(${v.overhead}) 가 placement 실계산과 어긋난다`);
    }
  });

  test('오버헤드가 3셀 늘어도 잔여 셀 계산이 흔들린다 (스냅샷이 민감하다는 증거)', () => {
    // V1 dataCells=82, residual=1. overhead+3 → dataCells=79, residual=1 이지만
    // usedSymbols 는 27 → 26 으로 줄어 NSYM_TABLE.V1.symbols(27) 과 어긋나 던진다.
    const v1 = VERSIONS[0];
    assert.throws(() => capacityFor({ ...v1, overhead: v1.overhead + 3 }, 'M'), /NSYM_TABLE/);
  });

  test('오버헤드가 최소 편차만큼 어긋나도(민감도) NSYM_TABLE 가드가 발화한다 — placement 기반이 된 후에도 성립', () => {
    // usedSymbols = floor(dataCells/3) 이므로 잔여 셀(dataCells mod 3)에 따라 가드를
    // 흔드는 최소 델타가 다르다: 잔여 0 이면 overhead+1(=dataCells-1)만으로 floor 가
    // 즉시 줄고, 잔여 2 면 overhead-1(=dataCells+1)만으로 floor 가 즉시 는다, 잔여 1 은
    // 양쪽으로 완충 1칸씩 있어 ±2 가 필요하다 — residualCells 로 방향·크기를 유도한다.
    for (const v of VERSIONS) {
      const r = capacityFor(v, 'M');
      const delta = r.residualCells === 1 ? 2 : 1;
      const sign = r.residualCells === 2 ? -1 : 1; // 잔여2: overhead 를 줄여 dataCells+1
      assert.throws(
        () => capacityFor({ ...v, overhead: v.overhead + sign * delta }, 'M'),
        /NSYM_TABLE/,
        `V${v.version}: overhead${sign > 0 ? '+' : '-'}${delta} 가 가드를 발화시키지 못했다 (residual=${r.residualCells})`,
      );
    }
  });
});
