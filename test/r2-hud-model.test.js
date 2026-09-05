/**
 * test/r2-hud-model.test.js — R2 HUD 순수 모델(`src/r2-hud-model.js`)의 자.
 *
 * 재는 것은 «배치·철자» 가 아니라 **성질**이다: 역할 격자는 원본
 * (`layoutMapCellSurfaceFinal` · `dataCellsInScanOrderCellSurfaceFinal`)에서 다시 유도해
 * 대조하고, 묶음 키 수는 손 목록이 아니라 `HUD_ROLE`·`CELL_MAP_STATE` 의 값 수에서 센다.
 * 위상은 우선순위 «누가 누구를 이기는가» 로만 재고, 문자열 자체는 `HUD_PHASE` 에서 읽는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HUD_ROLE,
  HUD_PHASE,
  HUD_BUCKETS,
  bucketKey,
  buildRoleGrids,
  hudPhase,
  countObserved,
  fadeAlpha,
  flashAlpha,
} from '../src/r2-hud-model.js';
import {
  layoutMapCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../src/cellSurfaceFinal.js';
import { R2_INDICATOR } from '../src/r2/session.js';
import { CELL_MAP_STATE } from '../src/r2/progress.js';

const LINEUP_NS = [13, 21, 25];

/** 라인업 전수 = (n, id) 쌍을 원본에서 유도 (사본 목록 금지). */
function lineupPairs() {
  const pairs = [];
  for (const n of LINEUP_NS) {
    for (const id of finalLayoutIdsForN(n)) pairs.push({ n, id });
  }
  return pairs;
}

test('라인업이 비어 있지 않다 — 전수 자가 0건을 돌면 초록이 거짓이 된다', () => {
  assert.ok(lineupPairs().length >= 3);
});

test('buildRoleGrids: 라인업 전수에서 역할 격자가 원본과 일치한다', () => {
  for (const { n, id } of lineupPairs()) {
    const grids = buildRoleGrids(n, id);
    assert.ok(grids !== null, n + '@' + id + ': null 이면 안 된다');
    assert.equal(grids.n, n);
    assert.equal(grids.layoutId, id);
    assert.equal(grids.roleGrid.length, n * n);
    assert.equal(grids.scanGrid.length, n * n);

    // counts 합 == n²
    const total = Object.values(grids.counts).reduce((a, b) => a + b, 0);
    assert.equal(total, n * n, n + '@' + id + ': counts 합');

    // 역할별 수를 원본 맵에서 다시 세어 대조 (locator 포함 전 역할).
    const map = layoutMapCellSurfaceFinal(n, id);
    const fromSource = {};
    for (const key of Object.keys(HUD_ROLE)) fromSource[key.toLowerCase()] = 0;
    let mapped = 0;
    for (const entry of map.values()) {
      if (fromSource[entry.role] === undefined) continue;
      fromSource[entry.role] += 1;
      mapped += 1;
    }
    fromSource.empty = n * n - mapped;
    assert.deepEqual(grids.counts, fromSource, n + '@' + id + ': 역할별 수');

    // 데이터 수 == 스캔 순서 길이
    const scan = dataCellsInScanOrderCellSurfaceFinal(n, id);
    assert.equal(grids.counts.data, scan.length, n + '@' + id + ': data 수');

    // scanGrid 의 −1 아닌 값 집합 == {0..data−1} 전단사
    const seen = new Set();
    for (let k = 0; k < grids.scanGrid.length; k += 1) {
      const v = grids.scanGrid[k];
      if (v === -1) continue;
      assert.equal(seen.has(v), false, n + '@' + id + ': 순번 중복 ' + v);
      seen.add(v);
      // 데이터 셀만 순번을 갖는다
      assert.equal(grids.roleGrid[k], HUD_ROLE.DATA);
    }
    assert.equal(seen.size, scan.length);
    for (let k = 0; k < scan.length; k += 1) {
      assert.equal(seen.has(k), true, n + '@' + id + ': 빠진 순번 ' + k);
    }

    // scanGrid[j*n+i] == k  ⇔  scan[k] = (i, j)
    scan.forEach((cell, k) => {
      assert.equal(grids.scanGrid[cell.j * n + cell.i], k);
    });
  }
});

test('buildRoleGrids: 라인업 밖 입력은 throw 없이 null', () => {
  assert.equal(buildRoleGrids(99, 'v0'), null);
  assert.equal(buildRoleGrids(13, 'nope'), null);
  assert.equal(buildRoleGrids(21, 'v0'), null); // v0 는 n=13 전용 — n 불일치
  assert.equal(buildRoleGrids(0, 'v0'), null);
  assert.equal(buildRoleGrids(-13, 'v0'), null);
  assert.equal(buildRoleGrids(13.5, 'v0'), null);
  assert.equal(buildRoleGrids(NaN, 'v0'), null);
  assert.equal(buildRoleGrids(undefined, undefined), null);
  assert.equal(buildRoleGrids(13, null), null);
});

test('hudPhase: 우선순위 진리표', () => {
  const locked = { locked: true, candidateCount: 2, cellCount: 100, observedCells: 0 };

  // latched 가 전부를 이긴다 (DROPPED 포함)
  assert.equal(
    hudPhase({ ...locked, latched: true, indicator: R2_INDICATOR.DROPPED }),
    HUD_PHASE.DONE,
  );
  // DROPPED/FAILED 는 후보가 있어도 이긴다
  assert.equal(hudPhase({ ...locked, indicator: R2_INDICATOR.DROPPED }), HUD_PHASE.DROPPED);
  assert.equal(hudPhase({ ...locked, indicator: R2_INDICATOR.FAILED }), HUD_PHASE.DROPPED);
  // 락이어도 후보 0 이면 SEARCHING
  assert.equal(hudPhase({ ...locked, candidateCount: 0 }), HUD_PHASE.SEARCHING);
  assert.equal(hudPhase({ ...locked, locked: false }), HUD_PHASE.SEARCHING);
  // FINALIZING 은 관측·격자보다 앞선다
  assert.equal(
    hudPhase({ ...locked, observedCells: 40, indicator: R2_INDICATOR.FINALIZING }),
    HUD_PHASE.FINALIZING,
  );
  // 관측 셀이 있으면 DATA
  assert.equal(hudPhase({ ...locked, observedCells: 1 }), HUD_PHASE.DATA);
  // 관측 0 · 셀 수 있음 → GRID
  assert.equal(hudPhase(locked), HUD_PHASE.GRID);
  // 락만 (셀 수 아직 0) → TYPE
  assert.equal(hudPhase({ locked: true, candidateCount: 1 }), HUD_PHASE.TYPE);
});

test('hudPhase: 입력 누락·NaN·비객체는 SEARCHING', () => {
  assert.equal(hudPhase({}), HUD_PHASE.SEARCHING);
  assert.equal(hudPhase(undefined), HUD_PHASE.SEARCHING);
  assert.equal(hudPhase(null), HUD_PHASE.SEARCHING);
  assert.equal(hudPhase(42), HUD_PHASE.SEARCHING);
  assert.equal(hudPhase({ locked: true, candidateCount: NaN }), HUD_PHASE.SEARCHING);
  assert.equal(
    hudPhase({ locked: true, candidateCount: 1, cellCount: NaN, observedCells: NaN }),
    HUD_PHASE.TYPE,
  );
});

test('countObserved: UNOBSERVED 만 세지 않는다', () => {
  const other = Object.values(CELL_MAP_STATE).filter((v) => v !== CELL_MAP_STATE.UNOBSERVED);
  const allUnobserved = new Uint8Array(8).fill(CELL_MAP_STATE.UNOBSERVED);
  assert.equal(countObserved(allUnobserved, 8), 0);

  // 상태 하나씩 넣으면 그 수만큼 센다 — 상태 목록은 CELL_MAP_STATE 에서 유도
  const mixed = new Uint8Array(8).fill(CELL_MAP_STATE.UNOBSERVED);
  other.forEach((state, k) => { mixed[k] = state; });
  assert.equal(countObserved(mixed, 8), other.length);

  // cellCount 로 자른 범위만 센다
  assert.equal(countObserved(mixed, 1), 1);
  assert.equal(countObserved(mixed, 0), 0);
  // 선언 길이가 실제보다 커도 안전
  assert.equal(countObserved(mixed, 999), other.length);
  assert.equal(countObserved(mixed, undefined), other.length);

  assert.equal(countObserved(null, 8), 0);
  assert.equal(countObserved(undefined, 8), 0);
  assert.equal(countObserved(123, 8), 0);
});

test('fadeAlpha: 0 → 1 단조 증가, 경계·비유한 입력', () => {
  assert.equal(fadeAlpha(1000, 1000), 0);
  assert.equal(fadeAlpha(1150, 1000, 300), 0.5);
  assert.equal(fadeAlpha(1300, 1000, 300), 1);
  assert.equal(fadeAlpha(9999, 1000, 300), 1);
  assert.equal(fadeAlpha(900, 1000, 300), 0); // 시작 전
  let prev = -1;
  for (let t = 0; t <= 400; t += 25) {
    const a = fadeAlpha(1000 + t, 1000, 300);
    assert.ok(a >= prev, '단조 증가 t=' + t);
    assert.ok(a >= 0 && a <= 1);
    prev = a;
  }
  assert.equal(fadeAlpha(NaN, 1000, 300), 1);
  assert.equal(fadeAlpha(1000, undefined, 300), 1);
  assert.equal(fadeAlpha(1000, 1000, Infinity), 1);
  assert.equal(fadeAlpha(1000, 1000, 0), 1); // 길이 0 = 즉시 완료
});

test('flashAlpha: 1 → 0 단조 감소, 경계·비유한 입력', () => {
  assert.equal(flashAlpha(1000, 1000), 1);
  assert.equal(flashAlpha(1300, 1000, 600), 0.5);
  assert.equal(flashAlpha(1600, 1000, 600), 0);
  assert.equal(flashAlpha(9999, 1000, 600), 0);
  assert.equal(flashAlpha(900, 1000, 600), 1); // 시작 전
  let prev = 2;
  for (let t = 0; t <= 800; t += 50) {
    const a = flashAlpha(1000 + t, 1000, 600);
    assert.ok(a <= prev, '단조 감소 t=' + t);
    assert.ok(a >= 0 && a <= 1);
    prev = a;
  }
  assert.equal(flashAlpha(NaN, 1000, 600), 0);
  assert.equal(flashAlpha(1000, undefined, 600), 0);
  assert.equal(flashAlpha(1000, 1000, 0), 0);
});

test('HUD_BUCKETS: 중복 없고 수는 원본에서 유도된다', () => {
  assert.equal(new Set(HUD_BUCKETS).size, HUD_BUCKETS.length, '중복 0');

  const bucketedRoles = Object.values(HUD_ROLE)
    .filter((v) => v !== HUD_ROLE.EMPTY && v !== HUD_ROLE.DATA);
  const stateCount = Object.values(CELL_MAP_STATE).length;
  assert.equal(HUD_BUCKETS.length, bucketedRoles.length * 2 + stateCount);

  // CELL_MAP_STATE 값마다 데이터 묶음이 하나씩 (상태가 늘면 여기가 따라 는다)
  for (const state of Object.values(CELL_MAP_STATE)) {
    assert.ok(HUD_BUCKETS.includes('data:' + state), 'data:' + state);
  }
});

test('bucketKey: 모든 (역할, 상태, 변동) 조합이 HUD_BUCKETS 원소이거나 null', () => {
  const set = new Set(HUD_BUCKETS);
  const covered = new Set();
  for (const role of Object.values(HUD_ROLE)) {
    for (const state of Object.values(CELL_MAP_STATE)) {
      for (const tentative of [true, false]) {
        const key = bucketKey(role, state, tentative);
        if (role === HUD_ROLE.EMPTY) {
          assert.equal(key, null, 'EMPTY 는 묶음 없음');
          continue;
        }
        assert.ok(set.has(key), '알 수 없는 묶음 키: ' + key);
        covered.add(key);
      }
    }
  }
  // 모든 묶음이 어떤 조합에선가 나온다 — 죽은 묶음 금지
  assert.equal(covered.size, HUD_BUCKETS.length);

  // 모르는 역할·상태는 예외 없이 떨어진다
  assert.equal(bucketKey(999, CELL_MAP_STATE.CONFIRMED, true), null);
  assert.equal(bucketKey(undefined, undefined, undefined), null);
  assert.equal(
    bucketKey(HUD_ROLE.DATA, 999, false),
    'data:' + CELL_MAP_STATE.UNOBSERVED,
  );
  // DATA 는 레이아웃 변동 여부를 무시한다 (상태색이므로)
  assert.equal(
    bucketKey(HUD_ROLE.DATA, CELL_MAP_STATE.CANDIDATE, true),
    bucketKey(HUD_ROLE.DATA, CELL_MAP_STATE.CANDIDATE, false),
  );
  // 역할 묶음은 변동/확정이 갈린다
  assert.notEqual(
    bucketKey(HUD_ROLE.LOCATOR, CELL_MAP_STATE.UNOBSERVED, true),
    bucketKey(HUD_ROLE.LOCATOR, CELL_MAP_STATE.UNOBSERVED, false),
  );
});

test('순수성: freeze 한 입력에도 throw 없고 같은 입력은 같은 결과', () => {
  const frozen = Object.freeze({
    locked: true,
    candidateCount: 2,
    cellCount: 100,
    observedCells: 3,
    indicator: R2_INDICATOR.COLLECTING,
    latched: false,
  });
  assert.equal(hudPhase(frozen), hudPhase(frozen));
  assert.equal(hudPhase(frozen), HUD_PHASE.DATA);

  // TypedArray 는 freeze 가 안 되므로(요소 있는 뷰) 동결 가능한 배열로 «안 만진다» 를 잰다.
  const cellMap = Object.freeze([
    CELL_MAP_STATE.UNOBSERVED,
    CELL_MAP_STATE.CANDIDATE,
    CELL_MAP_STATE.CONFIRMED,
    CELL_MAP_STATE.ERASURE,
  ]);
  assert.equal(countObserved(cellMap, 4), 3);
  assert.equal(countObserved(cellMap, 4), countObserved(cellMap, 4));

  // 진짜 런타임 형태(Uint8Array)도 호출 뒤 내용이 그대로다.
  const live = new Uint8Array([0, 1, 2, 3]);
  countObserved(live, 4);
  assert.deepEqual(Array.from(live), [0, 1, 2, 3]);

  const { n, id } = lineupPairs()[0];
  const a = buildRoleGrids(n, id);
  const b = buildRoleGrids(n, id);
  assert.deepEqual(a, b);
  // 새 배열을 돌려준다 (렌더 층이 만져도 다음 호출이 오염되지 않는다)
  assert.notEqual(a.roleGrid, b.roleGrid);
  assert.notEqual(a.scanGrid, b.scanGrid);
});
