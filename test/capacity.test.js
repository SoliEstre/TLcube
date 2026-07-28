// capacity.test.js — SPEC §5.5 용량표 스냅샷
//
// **이 테스트의 목적은 통과가 아니라 깨지는 것이다.**
//
// V1 은 필러 여유가 3, V2·V3 는 1 뿐이다. 불스아이(§5.1)나 레퍼런스(§5.3)가 한 셀만
// 늘어도 용량표가 조용히 틀려진다. 여기 박아둔 스냅샷이 그 순간 깨지고, 깨진 값을 확인해
// SPEC §5.5 를 갱신하는 것이 절차다. **깨졌다고 스냅샷부터 고치지 마라** — 무엇이 왜
// 바뀌었는지 먼저 확인해라.
//
// layout.js 가 오버헤드를 실계산하게 되는 T8 에서 이 스냅샷은 **깨질 예정**이다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERSIONS, fitCodeword, capacityFor, capacityTable, renderMarkdownTable,
} from '../src/capacity.js';
import { digitCountForByteLength } from '../src/base6.js';
import { cellCount } from '../src/hexgrid.js';
import { nsymForLevel } from '../src/rs.js';
import { maxPayloadFor } from '../src/header.js';

// SPEC §5.5 (2026-07-29 판) 과 1:1 대응. 사용자 검산 완료.
const SNAPSHOT_M = [
  { version: 1, k: 6, totalCells: 127, overhead: 45, dataSymbols: 82,
    dataBytes: 19, nsym: 6, codewordBytes: 25, codewordDigits: 79, filler: 3, maxPayloadBytes: 18 },
  { version: 2, k: 8, totalCells: 217, overhead: 50, dataSymbols: 167,
    dataBytes: 39, nsym: 14, codewordBytes: 53, codewordDigits: 166, filler: 1, maxPayloadBytes: 38 },
  { version: 3, k: 10, totalCells: 331, overhead: 55, dataSymbols: 276,
    dataBytes: 66, nsym: 22, codewordBytes: 88, codewordDigits: 275, filler: 1, maxPayloadBytes: 65 },
];

describe('용량표 스냅샷 (SPEC §5.5, ECC-M)', () => {
  test('전 버전 튜플이 SPEC 과 일치', () => {
    const actual = capacityTable('M');
    assert.equal(actual.length, SNAPSHOT_M.length);
    for (let i = 0; i < SNAPSHOT_M.length; i += 1) {
      for (const [key, expected] of Object.entries(SNAPSHOT_M[i])) {
        assert.equal(actual[i][key], expected,
          `V${SNAPSHOT_M[i].version}.${key}: ${actual[i][key]} !== ${expected} (SPEC §5.5 를 확인하라)`);
      }
    }
  });

  test('마크다운 표가 렌더된다 (SPEC 에 붙일 형태)', () => {
    const md = renderMarkdownTable('M');
    assert.match(md, /\| V1 \| 6 \| 127 \| 45 \| 82 \| 25 B \| 79 \| 3 \| \*\*18 B\*\* \|/);
    assert.match(md, /\| V3 \| 10 \| 331 \| 55 \| 276 \| 88 B \| 275 \| 1 \| \*\*65 B\*\* \|/);
    assert.ok(!md.includes('~'), '단일 물결표는 GFM 취소선 트랩이다 (규약 §6.11)');
  });
});

describe('용량 산술이 다른 모듈과 정합', () => {
  test('총 셀 = 3k²+3k+1 (hexgrid 와 일치)', () => {
    for (const r of capacityTable('M')) assert.equal(r.totalCells, cellCount(r.k));
  });

  test('데이터 심볼 = 총 셀 − 오버헤드', () => {
    for (const r of capacityTable('M')) assert.equal(r.dataSymbols, r.totalCells - r.overhead);
  });

  test('코드워드 digit = base6 가 계산한 값', () => {
    for (const r of capacityTable('M')) {
      assert.equal(r.codewordDigits, digitCountForByteLength(r.codewordBytes));
    }
  });

  test('코드워드 = 데이터 + 패리티, 패리티는 rs 가 정한 값', () => {
    for (const r of capacityTable('M')) {
      assert.equal(r.nsym, nsymForLevel(r.dataBytes, 'M'));
      assert.equal(r.codewordBytes, r.dataBytes + r.nsym);
    }
  });

  test('순 페이로드 = 데이터 − 헤더 1 B', () => {
    for (const r of capacityTable('M')) {
      assert.equal(r.maxPayloadBytes, maxPayloadFor(r.dataBytes));
      assert.equal(r.maxPayloadBytes, r.dataBytes - 1);
    }
  });

  test('필러는 음수가 아니다 — 코드워드가 용량을 넘으면 안 된다', () => {
    for (const level of ['L', 'M', 'H']) {
      for (const r of capacityTable(level)) {
        assert.ok(r.filler >= 0, `V${r.version}/${level}: 필러 ${r.filler} < 0`);
        assert.ok(r.codewordDigits <= r.dataSymbols);
      }
    }
  });
});

describe('fitCodeword 는 진짜 최대인가', () => {
  test('한 바이트 더 키우면 용량을 넘는다 (최대성)', () => {
    for (const level of ['L', 'M', 'H']) {
      for (const v of VERSIONS) {
        const r = capacityFor(v, level);
        const bigger = r.dataBytes + 1;
        const biggerCw = bigger + nsymForLevel(bigger, level);
        assert.ok(
          biggerCw > 255 || digitCountForByteLength(biggerCw) > r.dataSymbols,
          `V${v.version}/${level}: dataBytes ${bigger} 도 들어가는데 ${r.dataBytes} 에서 멈췄다`);
      }
    }
  });

  test('ECC 레벨이 높을수록 순 페이로드가 줄지 않는 일은 없다', () => {
    for (const v of VERSIONS) {
      const L = capacityFor(v, 'L'), M = capacityFor(v, 'M'), H = capacityFor(v, 'H');
      assert.ok(L.maxPayloadBytes >= M.maxPayloadBytes, `V${v.version}: L < M`);
      assert.ok(M.maxPayloadBytes >= H.maxPayloadBytes, `V${v.version}: M < H`);
      assert.ok(L.errorCapacity <= M.errorCapacity);
      assert.ok(M.errorCapacity <= H.errorCapacity);
    }
  });
});

describe('오버헤드가 잠정임을 잊지 않기', () => {
  test('전 버전이 provisional 로 표시돼 있다', () => {
    // T8 에서 layout.js 가 실계산하면 이 플래그를 내리고 스냅샷을 갱신한다.
    for (const v of VERSIONS) {
      assert.equal(v.provisional, true,
        `V${v.version} 의 provisional 이 내려갔다 — 스냅샷과 SPEC §5.5 의 † 주석도 같이 갱신했는가?`);
    }
  });

  test('오버헤드가 1셀만 늘어도 결과가 바뀐다 (스냅샷이 민감하다는 증거)', () => {
    const v1 = VERSIONS[0];
    const base = capacityFor(v1, 'M');
    const nudged = capacityFor({ ...v1, overhead: v1.overhead + 4 }, 'M');
    assert.notEqual(nudged.codewordBytes, base.codewordBytes,
      'V1 필러 여유가 3 이므로 오버헤드 +4 는 반드시 코드워드를 줄여야 한다');
  });
});
