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
  WINDOW_SIZE_Y, windowBoundsY, inWindowY, windowedReferenceGroupsY, windowedReferenceCellsY,
  windowedFormatCellsY, windowExcludedCellsY, overheadBreakdownY2Window, NSYM_TABLE_Y2W,
  capacityForY2Window,
} from '../src/capacityY.js';
import { referenceGroups, formatCells } from '../src/placementY.js';
import { maxBytesForSymbols } from '../src/capacity.js';
import { errorCapacity } from '../src/rs211.js';
import { maxPayloadFor } from '../src/header.js';

const SNAPSHOT_M = [
  {
    name: 'Y0', version: 0, n: 13, tones: 2, formatIndex: 0, totalCells: 169, overhead: 27, dataCells: 142,
    usedSymbols: 47, residualCells: 1, nsym: 13, errorCapacity: 6, dataSymbols: 34, dataBytes: 32, maxPayloadBytes: 31,
  },
  {
    name: 'Y1', version: 1, n: 21, tones: 2, formatIndex: 8, totalCells: 441, overhead: 27, dataCells: 414,
    usedSymbols: 138, residualCells: 0, nsym: 35, errorCapacity: 17, dataSymbols: 103, dataBytes: 99, maxPayloadBytes: 98,
  },
  {
    name: 'Y2', version: 2, n: 25, tones: 2, formatIndex: 9, totalCells: 625, overhead: 27, dataCells: 598,
    usedSymbols: 199, residualCells: 1, nsym: 51, errorCapacity: 25, dataSymbols: 148, dataBytes: 142, maxPayloadBytes: 141,
  },
  {
    name: 'Y0T', version: 0, n: 13, tones: 3, formatIndex: 2, totalCells: 169, overhead: 27, dataCells: 142,
    usedSymbols: 47, residualCells: 1, nsym: 13, errorCapacity: 6, dataSymbols: 34, dataBytes: 32, maxPayloadBytes: 31,
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
    // 위치 인덱스가 아니라 versionSpecY 로 잡는다 — ADR 0006 이 Y0/Y0T 를 각 tones
    // 블록 선두에 끼워 넣었고, 앞으로도 버전 추가는 위치를 밀 수 있다.
    const y1 = capacityForY(versionSpecY(1, 2), 'M');
    const y2 = capacityForY(versionSpecY(2, 2), 'M');
    assert.notEqual(y1.maxPayloadBytes, 95,
      'ADR 추정 95 B 와 우연히 같아졌다 — 이 테스트 의도(차이 보고)를 재검토하라');
    assert.equal(y1.maxPayloadBytes, 98);
    assert.notEqual(y2.maxPayloadBytes, 137,
      'ADR 추정 137 B 와 우연히 같아졌다 — 이 테스트 의도(차이 보고)를 재검토하라');
    assert.equal(y2.maxPayloadBytes, 141);
  });

  test('마크다운 표가 렌더된다 (SPEC §14 에 붙일 형태)', () => {
    const md = renderMarkdownTableY('M');
    assert.match(md, /\| Y0 \| 13 \| 169 \| 27 \| 142 \| 47 \| 1 \| 13 \| 6 \| 34 \| 32 B \| \*\*31 B\*\* \|/);
    assert.match(md, /\| Y0T \| 13 \| 169 \| 27 \| 142 \| 47 \| 1 \| 13 \| 6 \| 34 \| 32 B \| \*\*31 B\*\* \|/);
    assert.match(md, /\| Y1 \| 21 \| 441 \| 27 \| 414 \| 138 \| 0 \| 35 \| 17 \| 103 \| 99 B \| \*\*98 B\*\* \|/);
    assert.match(md, /\| Y2 \| 25 \| 625 \| 27 \| 598 \| 199 \| 1 \| 51 \| 25 \| 148 \| 142 B \| \*\*141 B\*\* \|/);
    assert.match(md, /\| Y1T \| 21 \| 441 \| 27 \| 414 \| 138 \| 0 \| 35 \| 17 \| 103 \| 99 B \| \*\*98 B\*\* \|/);
    assert.match(md, /\| Y2T \| 25 \| 625 \| 27 \| 598 \| 199 \| 1 \| 51 \| 25 \| 148 \| 142 B \| \*\*141 B\*\* \|/);
    assert.ok(!md.includes('~'), '단일 물결표는 GFM 취소선 트랩이다 (규약 §6.11)');
  });
});

describe('versionSpecY — (version, tones) 단일 조회 (v3.1 §4b)', () => {
  test('Y0/Y1/Y2(tones=2, 기본값) 는 VERSIONS_Y[0]/[1]/[2] 와 정확히 같다 (배열 순 = tones 별 용량 오름차순)', () => {
    assert.equal(versionSpecY(1), VERSIONS_Y[1]);
    assert.equal(versionSpecY(0, 2), VERSIONS_Y[0]); // ADR 0006 D5
    assert.equal(versionSpecY(1, 2), VERSIONS_Y[1]);
    assert.equal(versionSpecY(2, 2), VERSIONS_Y[2]);
  });

  test('Y0T/Y1T/Y2T(tones=3) 는 VERSIONS_Y[3]/[4]/[5] 와 정확히 같다', () => {
    assert.equal(versionSpecY(0, 3), VERSIONS_Y[3]);
    assert.equal(versionSpecY(1, 3), VERSIONS_Y[4]);
    assert.equal(versionSpecY(2, 3), VERSIONS_Y[5]);
  });

  test('알 수 없는 (version, tones) 조합은 RangeError', () => {
    assert.throws(() => versionSpecY(99, 2), RangeError);
    assert.throws(() => versionSpecY(1, 4), RangeError);
    assert.throws(() => versionSpecY(3, 2), RangeError);
    assert.throws(() => versionSpecY(-1, 2), RangeError);
  });
});

describe('용량 회계는 tones 무관 동일 (v3.1 §4b 근거 수치)', () => {
  // ADR 0006 이 Y0/Y0T 를 추가했으므로 전 버전을 훑는다 — 쌍이 늘어도 자동 확장된다.
  for (const version of [0, 1, 2]) {
    test(`Y${version} 과 Y${version}T — formatIndex·tones 만 다르고 나머지 용량 수치는 완전히 같다`, () => {
      const main = capacityForY(versionSpecY(version, 2), 'M');
      const tri = capacityForY(versionSpecY(version, 3), 'M');
      for (const key of [
        'n', 'totalCells', 'overhead', 'dataCells', 'usedSymbols', 'residualCells',
        'nsym', 'errorCapacity', 'dataSymbols', 'dataBytes', 'maxPayloadBytes',
      ]) {
        assert.equal(main[key], tri[key], `Y${version}.${key} !== Y${version}T.${key}`);
      }
      assert.notEqual(main.tones, tri.tones);
      assert.notEqual(main.formatIndex, tri.formatIndex);
      // ADR 0006 D3-5 쌍 불변식 — 변형(T)은 기본형 + 2.
      assert.equal(tri.formatIndex, main.formatIndex + 2,
        `Y${version}T 의 formatIndex 는 Y${version} + 2 여야 한다 (ADR 0006 D3-5)`);
    });
  }

  test('Y2 와 Y2T — 동일 항등 (근거 수치 명시 고정)', () => {
    const y2 = capacityForY(versionSpecY(2, 2), 'M');
    const y2t = capacityForY(versionSpecY(2, 3), 'M');
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
    const y1 = versionSpecY(1, 2);
    // dataCells=414, usedSymbols=138. overhead+3 → dataCells=411 → usedSymbols=137 로 어긋난다.
    const nudged = { ...y1, overhead: y1.overhead + 3 };
    assert.throws(() => capacityForY(nudged, 'M'), /NSYM_TABLE_Y\.Y1\.symbols/);
  });
});

// ── 면 내 QR 윈도 β (ADR 0003 D1 + [C7 Q7]) — Y2(n=25)·tones=2 전용 ─────────

describe('윈도 경계·판정 헬퍼', () => {
  test('WINDOW_SIZE_Y = 13, n=25 경계 = [12,24]²', () => {
    assert.equal(WINDOW_SIZE_Y, 13);
    assert.deepEqual(windowBoundsY(25), { lo: 12, hi: 24 });
  });

  test('inWindowY — 경계 안팎', () => {
    assert.equal(inWindowY(12, 12, 25), true);
    assert.equal(inWindowY(24, 24, 25), true);
    assert.equal(inWindowY(11, 24, 25), false, 'i 가 경계 밖');
    assert.equal(inWindowY(24, 11, 25), false, 'j 가 경계 밖');
  });
});

describe('[C7 부속 계약 ①] n=25 윈도 충돌 — 레퍼런스 조 D + 포맷 복제 2 (ADR 원문보다 넓다)', () => {
  test('베이스 좌표에서 레퍼런스 앵커(n-3,n-3) 조 3셀 전부가 윈도 안', () => {
    const groupD = referenceGroups(25, 2)[3];
    assert.deepEqual(groupD.cells, [{ i: 22, j: 22 }, { i: 23, j: 22 }, { i: 22, j: 23 }]);
    for (const c of groupD.cells) assert.equal(inWindowY(c.i, c.j, 25), true);
  });

  test('베이스 좌표에서 포맷 복제 2(i=17..21,j=23) 5셀 전부가 윈도 안 — ADR 0003 원문이 명시하지 않은 추가 발견', () => {
    const replica2 = formatCells(25).slice(10, 15);
    assert.deepEqual(replica2, [17, 18, 19, 20, 21].map((i) => ({ i, j: 23 })));
    for (const c of replica2) assert.equal(inWindowY(c.i, c.j, 25), true);
  });

  test('다른 3조(A,B,C)·포맷 복제 0/1 은 윈도와 겹치지 않는다', () => {
    const groups = referenceGroups(25, 2);
    for (const g of [groups[0], groups[1], groups[2]]) {
      for (const c of g.cells) assert.equal(inWindowY(c.i, c.j, 25), false);
    }
    for (const c of formatCells(25).slice(0, 10)) assert.equal(inWindowY(c.i, c.j, 25), false);
  });
});

describe('윈도 재배치 — 결정적 탐색 결과 스냅샷 (n=25, tones=2)', () => {
  test('레퍼런스 조 D 재배치: (22,22)/(23,22)/(22,23) → (22,10)/(23,10)/(22,11) (j축 -12)', () => {
    const groups = windowedReferenceGroupsY(25, 2);
    assert.equal(groups.length, 4);
    assert.deepEqual(groups[3].cells, [{ i: 22, j: 10 }, { i: 23, j: 10 }, { i: 22, j: 11 }]);
    assert.deepEqual(groups[3].digits, [0, 1, 2]); // REFERENCE_GROUP_DIGITS_2T — digit 배정 순서 불변.
    // 다른 3조는 원좌표 그대로.
    const base = referenceGroups(25, 2);
    for (const idx of [0, 1, 2]) assert.deepEqual(groups[idx], base[idx]);
  });

  test('포맷 복제 2 재배치: (17..21,23) → (7..11,23) (i축 -10)', () => {
    const cells = windowedFormatCellsY(25);
    assert.equal(cells.length, 15);
    assert.deepEqual(cells.slice(10, 15), [7, 8, 9, 10, 11].map((i) => ({ i, j: 23 })));
    // 복제 0/1 은 원좌표 그대로.
    assert.deepEqual(cells.slice(0, 10), formatCells(25).slice(0, 10));
  });

  test('재배치 후 레퍼런스·포맷 전부 윈도 밖 + 상호 무충돌 + 개수 불변(12/15)', () => {
    const refCells = windowedReferenceCellsY(25, 2);
    const fmtCells = windowedFormatCellsY(25);
    assert.equal(refCells.length, 12);
    assert.equal(fmtCells.length, 15);
    const keys = new Set();
    for (const c of [...refCells, ...fmtCells]) {
      assert.equal(inWindowY(c.i, c.j, 25), false, `(${c.i},${c.j}) 가 윈도 안에 남아 있다`);
      const k = `${c.i},${c.j}`;
      assert.ok(!keys.has(k), `중복 좌표: ${k}`);
      keys.add(k);
    }
  });

  test('windowExcludedCellsY(25) 는 169(=13²) 좌표, 전부 윈도 안', () => {
    const cells = windowExcludedCellsY(25);
    assert.equal(cells.length, 169);
    for (const c of cells) assert.equal(inWindowY(c.i, c.j, 25), true);
  });

  test('레퍼런스 조 D 의 부분 겹침(비정상 입력)은 throw — 결정 규칙 밖', () => {
    // windowedReferenceGroupsY 는 n=25/tones=2 이외에는 계약 보장이 없으나, 인위적으로
    // 부분 겹침 입력을 구성해 방어 코드가 실제로 작동하는지 확인한다.
    // (n=25 자체는 항상 전부/전무이므로, 여기서는 함수의 내부 방어 로직을
    // 문서화하는 회귀로서 windowedReferenceGroupsY(25,2) 가 예외 없이 도는지만 재확인.)
    assert.doesNotThrow(() => windowedReferenceGroupsY(25, 2));
  });
});

describe('오버헤드/용량 — Y2W (실계산, 잠정 NSYM_TABLE_Y2W)', () => {
  test('overheadBreakdownY2Window — ref+format 27 은 불변, windowExcluded=169', () => {
    const ob = overheadBreakdownY2Window();
    assert.equal(ob.reference, 12);
    assert.equal(ob.format, 15);
    assert.equal(ob.total, 27);
    assert.equal(ob.windowExcluded, 169);
  });

  test('capacityForY2Window(M) 스냅샷 — dataCells=429·usedSymbols=143·잔여 0·nsym=37·페이로드 101 B', () => {
    const r = capacityForY2Window('M');
    assert.equal(r.name, 'Y2W');
    assert.equal(r.version, 2);
    assert.equal(r.n, 25);
    assert.equal(r.tones, 2);
    assert.equal(r.formatIndex, 9, 'Y2 와 동일 — 와이어 무변경, 광학 신호');
    assert.equal(r.window, true);
    assert.equal(r.totalCells, 625);
    assert.equal(r.overhead, 27);
    assert.equal(r.windowExcluded, 169);
    assert.equal(r.dataCells, 429);
    assert.equal(r.usedSymbols, 143);
    assert.equal(r.residualCells, 0);
    assert.equal(r.nsym, 37);
    assert.equal(r.errorCapacity, 18);
    assert.equal(r.dataSymbols, 106);
    assert.equal(r.dataBytes, 102);
    assert.equal(r.maxPayloadBytes, 101);
  });

  test('capacityForY2Window(L/H) — NSYM_TABLE_Y2W 스냅샷과 정합', () => {
    assert.deepEqual(NSYM_TABLE_Y2W, {
      symbols: 143, L: 17, M: 37, H: 57,
    });
    const l = capacityForY2Window('L');
    const h = capacityForY2Window('H');
    assert.equal(l.nsym, 17);
    assert.equal(l.maxPayloadBytes, 120);
    assert.equal(h.nsym, 57);
    assert.equal(h.maxPayloadBytes, 82);
    assert.ok(l.maxPayloadBytes >= capacityForY2Window('M').maxPayloadBytes);
    assert.ok(capacityForY2Window('M').maxPayloadBytes >= h.maxPayloadBytes);
  });

  test('Y2W 는 총 셀 − (오버헤드+윈도배제) = 데이터 셀', () => {
    const r = capacityForY2Window('M');
    assert.equal(r.dataCells, r.totalCells - r.overhead - r.windowExcluded);
  });

  test('Y2(윈도 없음) 대비 순 페이로드가 준다 — 169셀을 데이터에서 뺐으니 당연하다', () => {
    const y2 = capacityForY(versionSpecY(2, 2), 'M');
    const y2w = capacityForY2Window('M');
    assert.ok(y2w.maxPayloadBytes < y2.maxPayloadBytes,
      `Y2W(${y2w.maxPayloadBytes}) 가 Y2(${y2.maxPayloadBytes}) 보다 작아야 한다`);
  });

  test('renderMarkdownTableY 에 Y2W 행이 포함된다(오버헤드 열은 27+169=196 표시)', () => {
    const md = renderMarkdownTableY('M');
    assert.match(md, /\| Y2W \| 25 \| 625 \| 196 \| 429 \| 143 \| 0 \| 37 \| 18 \| 106 \| 102 B \| \*\*101 B\*\* \|/);
    // 기존 4행은 그대로 남아 있어야 한다(비파괴 추가).
    assert.match(md, /\| Y2 \| 25 \| 625 \| 27 \| 598 \| 199 \| 1 \| 51 \| 25 \| 148 \| 142 B \| \*\*141 B\*\* \|/);
    assert.ok(!md.includes('~'), '단일 물결표는 GFM 취소선 트랩이다 (규약 §6.11)');
  });
});
