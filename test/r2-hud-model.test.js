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
  HUD_DISTRUST_STATE_KEY,
  HUD_STATE_KEYS_BEYOND_INDICATOR,
  HUD_TONE_NONE,
  HUD_H_LENGTH,
  HUD_PROJECTION_SCALARS,
  bucketKey,
  buildRoleGrids,
  hudCaptureProjection,
  hudDistrusted,
  hudPhase,
  hudProjectionChanged,
  hudToneSlot,
  countObserved,
  fadeAlpha,
  flashAlpha,
  r2HudDebugLine,
} from '../src/r2-hud-model.js';
import {
  layoutMapCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
  locatorCellsCellSurfaceFinal,
  referenceCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
// 톤·인덱스 규약은 «원본에서 다시 유도해» 대조한다 — 사본 표를 들면 인코더가 바뀌는 날 HUD 만 옛 무늬를 그린다.
import { REFERENCE_GROUP_DIGITS_2T } from '../src/placementY.js';
import { digitToRanks } from '../src/lehmer.js';
import { HUD_FACES, faceQuadSlot } from '../src/r2/hud-geometry.js';
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

/*
 * ── toneGrid (H2 · 운영자 요구 ⑧) ────────────────────────────────────────────────────────
 * 「로케이터 초록 + 디자인(휘도)」 은 «면마다 설계 톤이 다르다» 는 뜻이다. 톤 표를 손으로 다시 적으면
 * 인코더가 바뀌는 날 HUD 만 옛 무늬를 그린다 — 그래서 여기서는 **원본에서 다시 유도해** 대조한다.
 */
test('toneGrid: 라인업 전수에서 로케이터 톤이 원본 {T,L,R} 과 같다', () => {
  for (const { n, id } of lineupPairs()) {
    const grids = buildRoleGrids(n, id);
    assert.equal(grids.toneGrid.length, n * n * HUD_FACES.length, n + '@' + id + ': toneGrid 길이');
    const cells = locatorCellsCellSurfaceFinal(n, id);
    assert.ok(cells.length > 0, n + '@' + id + ': 로케이터가 0개면 전수가 공허하다');
    for (const cell of cells) {
      for (let f = 0; f < HUD_FACES.length; f += 1) {
        assert.equal(grids.toneGrid[hudToneSlot(n, f, cell.i, cell.j)], cell[HUD_FACES[f]],
          n + '@' + id + ': 로케이터 (' + cell.i + ',' + cell.j + ') 면 ' + HUD_FACES[f]);
      }
    }
  }
});

test('toneGrid: 레퍼런스 톤이 REFERENCE_GROUP_DIGITS_2T → digitToRanks 와 같다 (인코더와 같은 식)', () => {
  for (const { n, id } of lineupPairs()) {
    const grids = buildRoleGrids(n, id);
    const cells = referenceCellsCellSurfaceFinal(n, id);
    assert.ok(cells.length > 0, n + '@' + id + ': 레퍼런스가 0개면 전수가 공허하다');
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const ranks = digitToRanks(REFERENCE_GROUP_DIGITS_2T[index % REFERENCE_GROUP_DIGITS_2T.length]);
      for (let f = 0; f < HUD_FACES.length; f += 1) {
        assert.equal(grids.toneGrid[hudToneSlot(n, f, cell.i, cell.j)], ranks[HUD_FACES[f]],
          n + '@' + id + ': 레퍼런스 #' + index + ' 면 ' + HUD_FACES[f]);
      }
    }
  }
});

test('toneGrid: 톤을 갖는 칸은 로케이터·레퍼런스뿐 — 나머지는 전부 HUD_TONE_NONE', () => {
  for (const { n, id } of lineupPairs()) {
    const grids = buildRoleGrids(n, id);
    const toned = new Set();
    for (const cell of locatorCellsCellSurfaceFinal(n, id)) toned.add(cell.j * n + cell.i);
    for (const cell of referenceCellsCellSurfaceFinal(n, id)) toned.add(cell.j * n + cell.i);
    let counted = 0;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const isToned = toned.has(j * n + i);
        for (let f = 0; f < HUD_FACES.length; f += 1) {
          const value = grids.toneGrid[hudToneSlot(n, f, i, j)];
          if (isToned) {
            assert.notEqual(value, HUD_TONE_NONE, n + '@' + id + ': (' + i + ',' + j + ') 에 톤이 없다');
            assert.ok(value >= 0 && value <= 2, n + '@' + id + ': 톤 값이 0..2 밖이다 (' + value + ')');
            counted += 1;
          } else {
            assert.equal(value, HUD_TONE_NONE,
              n + '@' + id + ': 톤이 없어야 할 (' + i + ',' + j + ') 면 ' + f + ' 에 값 ' + value);
          }
        }
      }
    }
    // 공허 방지 — 톤 칸이 0 이면 위의 「나머지는 255」 가 공짜로 참이 된다.
    assert.equal(counted, (grids.counts.locator + grids.counts.reference) * HUD_FACES.length,
      n + '@' + id + ': 톤 칸 수가 역할 수와 안 맞는다');
  }
});

test('hudToneSlot ≡ faceQuadSlot / 8 — 톤 배열과 사영 버퍼가 같은 칸을 가리킨다', () => {
  for (const { n } of lineupPairs()) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        for (let f = 0; f < HUD_FACES.length; f += 1) {
          assert.equal(hudToneSlot(n, f, i, j), faceQuadSlot(n, f, i, j) / 8,
            'n' + n + ' (' + i + ',' + j + ') 면 ' + f);
        }
      }
    }
  }
});

/*
 * ── 재사영 판정 (H5 · 운영자 실기 3차 ①) ────────────────────────────────────────────────
 * 「줌/드랍/재락 뒤에 실루엣이 안 움직인다」 의 자다. 여섯 요소 **각각**을 흔들어 반응하는지 보고,
 * 기록(hudCaptureProjection) 뒤에는 조용해지는지도 본다 — 조용해지지 않으면 매 프레임 전체 재사영이다.
 */
function projectionSample() {
  return {
    lockRevision: 3,
    bindRevision: 7,
    n: 21,
    frameW: 960,
    frameH: 960,
    H: new Float64Array([1, 0, 10, 0, 1, 20, 0, 0, 1]),
  };
}

test('hudProjectionChanged: 여섯 요소 각각이 재사영을 부른다 (하나라도 빠지면 그 축은 영원히 안 보인다)', () => {
  const snapshot = hudCaptureProjection({}, projectionSample());
  assert.equal(hudProjectionChanged(snapshot, projectionSample()), false,
    '같은 입력인데 재사영을 요구한다 — 매 프레임 전체를 다시 사영하게 된다');

  // 스칼라 다섯 — 이름 목록은 모듈에서 유도한다 (손으로 적으면 요소가 늘 때 자가 안 자란다).
  assert.equal(HUD_PROJECTION_SCALARS.length, 5, '비교하는 스칼라가 다섯이 아니다');
  for (const key of HUD_PROJECTION_SCALARS) {
    const next = projectionSample();
    next[key] += 1;
    assert.equal(hudProjectionChanged(snapshot, next), true, key + ' 가 바뀌었는데 재사영을 안 한다');
  }
  // H 9값 — 원소마다.
  for (let k = 0; k < HUD_H_LENGTH; k += 1) {
    const next = projectionSample();
    next.H[k] += 0.5;
    assert.equal(hudProjectionChanged(snapshot, next), true, 'H[' + k + '] 이 바뀌었는데 재사영을 안 한다');
  }
});

test('hudProjectionChanged: 기록 뒤에는 조용하다 · H 는 참조가 아니라 복사다', () => {
  const live = projectionSample();
  const snapshot = hudCaptureProjection({}, live);
  assert.equal(hudProjectionChanged(snapshot, live), false);
  // 어댑터의 H 는 **내부 버퍼 참조**다 (r2-scan-runtime view.H). 참조를 들고 있으면 다음 프레임에 값이
  // 같이 바뀌어 «안 바뀜» 으로 읽힌다 — 실기 3차 ①의 「재락해도 안 움직인다」 가 정확히 그 모양이다.
  assert.notEqual(snapshot.H, live.H, 'H 를 참조로 들고 있다 — 어댑터가 덧쓰면 비교가 항상 «같음» 이 된다');
  live.H[2] = 999;
  assert.equal(hudProjectionChanged(snapshot, live), true, '어댑터 버퍼가 바뀌었는데 못 본다');
  hudCaptureProjection(snapshot, live);
  assert.equal(hudProjectionChanged(snapshot, live), false, '기록했는데도 계속 재사영을 요구한다');
});

test('hudProjectionChanged: NaN 은 «바뀜» 이 아니다 (Object.is) · 없는 스냅샷·H 유무는 «바뀜»', () => {
  const nanSample = () => ({
    lockRevision: 1, bindRevision: 1, n: 13, frameW: NaN, frameH: 960,
    H: new Float64Array([NaN, 0, 0, 0, 1, 0, 0, 0, 1]),
  });
  const snapshot = hudCaptureProjection({}, nanSample());
  assert.equal(hudProjectionChanged(snapshot, nanSample()), false,
    'NaN 을 !== 로 비교한다 — 한 번 NaN 이 끼면 매 프레임 전체 재사영이 된다');
  // 스냅샷이 없거나 H 유무가 갈리면 다시 푼다 — «모름» 은 «같음» 이 아니다.
  assert.equal(hudProjectionChanged(null, projectionSample()), true);
  assert.equal(hudProjectionChanged(projectionSample(), null), true);
  const noH = projectionSample();
  noH.H = null;
  assert.equal(hudProjectionChanged(snapshot, noH), true, 'H 가 사라졌는데 못 본다');
  assert.equal(hudProjectionChanged(hudCaptureProjection({}, noH), projectionSample()), true,
    'H 가 생겼는데 못 본다');
  // 순수 — 입력을 안 바꾼다.
  const frozen = Object.freeze(projectionSample());
  assert.doesNotThrow(() => hudProjectionChanged(frozen, frozen));
});

/*
 * ── 3d «격자 불신» ────────────────────────────────────────────────────────────
 * 마진 게이트 미달을 화면에 올리는 두 조각: 위상과 곱하는 판정 하나(`hudDistrusted`)와
 * 상태 단어의 원본 하나(`HUD_DISTRUST_STATE_KEY`). 둘 다 순수라 **값으로** 잰다.
 */
test('3d hudDistrusted — 그릴 격자가 있는 위상에서만 참이다 (SEARCHING·DROPPED·DONE 은 항상 거짓)', () => {
  // 그릴 것이 있는 위상 — 락 + 후보 + 셀. 여기서만 «불신» 이 뜻을 갖는다.
  const drawing = {
    locked: 1, candidateCount: 2, cellCount: 300, observedCells: 40, distrusted: true,
  };
  assert.equal(hudPhase(drawing), HUD_PHASE.DATA, '전제: 그릴 것이 있는 위상');
  assert.equal(hudDistrusted(drawing), true, '그릴 격자가 있는데 불신을 안 그린다');
  assert.equal(hudDistrusted({ ...drawing, distrusted: false }), false, '불신이 아닌데 참이다');

  /*
   * 🔴 세 위상은 **항상 거짓**이다. 분홍 점선은 「지금 저 격자를 다시 확인하는 중」이라는 말인데,
   * 격자가 없는 화면(SEARCHING·DROPPED)이나 이미 끝난 화면(DONE)에서 그 말은 「무언가 잘못됐다」로만
   * 읽힌다 — 사용자가 고칠 것이 없는 상태에서 경보를 켜는 것이다.
   */
  assert.equal(hudPhase({ ...drawing, locked: 0 }), HUD_PHASE.SEARCHING, '전제: 락이 없으면 SEARCHING');
  assert.equal(hudDistrusted({ ...drawing, locked: 0 }), false, 'SEARCHING 에 불신을 그린다');
  assert.equal(hudDistrusted({ ...drawing, candidateCount: 0 }), false, '후보 0(SEARCHING)에 불신을 그린다');
  assert.equal(hudDistrusted({ ...drawing, indicator: R2_INDICATOR.DROPPED }), false, 'DROPPED 에 불신을 그린다');
  assert.equal(hudDistrusted({ ...drawing, latched: true }), false, 'DONE 에 불신을 그린다');

  // 남은 위상(TYPE·GRID·FINALIZING)은 참이다 — 「격자를 그리는 중」이 곧 「불신을 말할 자리」다.
  assert.equal(hudDistrusted({ ...drawing, observedCells: 0 }), true, 'GRID 에 불신이 안 뜬다');
  assert.equal(hudDistrusted({ ...drawing, cellCount: 0, observedCells: 0 }), true, 'TYPE 에 불신이 안 뜬다');
  assert.equal(hudDistrusted({ ...drawing, indicator: R2_INDICATOR.FINALIZING }), true, 'FINALIZING 에 불신이 안 뜬다');

  // 잘못된 입력은 예외 없이 거짓 (모델 전체의 규약).
  assert.equal(hudDistrusted(null), false);
  assert.equal(hudDistrusted(undefined), false);
  assert.equal(hudDistrusted({}), false);
});

test('3d 상태 단어의 원본 — 인디케이터 이름과 **안 겹치고**, 그 목록 밖 키가 여기 하나로 모인다', () => {
  /*
   * 겹치면 사전 자(`test/scanner-i18n.test.js`)의 「죽은 문구」 판정이 둘을 못 가른다.
   * 그리고 겹칠 이유도 없다 — 불신은 «후보가 어디까지 왔나»(인디케이터)와 **다른 축**이라,
   * COLLECTING 이면서 동시에 불신일 수 있다.
   */
  const indicatorKeys = new Set(Object.keys(R2_INDICATOR).map((name) => name.toLowerCase()));
  assert.ok(!indicatorKeys.has(HUD_DISTRUST_STATE_KEY),
    '불신 상태 단어가 인디케이터 이름과 겹친다 — 사전 자가 두 축을 못 가른다');
  assert.ok(HUD_STATE_KEYS_BEYOND_INDICATOR.includes(HUD_DISTRUST_STATE_KEY),
    '인디케이터 밖 키 목록에 불신이 없다 — 사전 자가 그 키를 «죽은 문구» 로 지운다');
  for (const key of HUD_STATE_KEYS_BEYOND_INDICATOR) {
    assert.equal(typeof key, 'string');
    assert.ok(key.length > 0 && !indicatorKeys.has(key), key + ' 가 인디케이터 이름과 겹친다');
  }
});

test('3d hud 줄 — 마진은 **불신일 때만** 실리고, 가르는 구간에서 한 자리 소수를 지킨다', () => {
  const hud = {
    phase: 'data', lastMs: 1, maxMs: 2, n: 21, layoutId: 'v0TR',
  };
  const quiet = r2HudDebugLine(hud, { lockF: 500, lockMargin: 71, lockDistrusted: false });
  assert.ok(!quiet.includes('M'), '믿는 프레임에 마진이 실렸다 — 예산을 상수로 먹는다: ' + quiet);

  const noisy = r2HudDebugLine(hud, { lockF: 18, lockMargin: 1.36, lockDistrusted: true });
  assert.ok(noisy.includes('!M1.4'), '불신 프레임에 마진이 한 자리 소수로 안 실린다: ' + noisy);
  /*
   * 🔴 소수 한 자리가 계약인 이유: 가르는 구간이 1.1\~3 이다. 정수로 반올림하면 1.36 도 1.60 도
   * «1» 이 되어 「하한에 얼마나 못 미치나」가 화면에서 사라진다 (그 수를 보려고 적는 것인데).
   */
  const near = r2HudDebugLine(hud, { lockF: 18, lockMargin: 1.6, lockDistrusted: true });
  assert.notEqual(near, noisy, '마진 1.36 과 1.60 이 줄에서 같아 보인다 — 자릿수가 그 구간을 못 가른다');
  // 미측정은 «—» 다 (거짓 0 금지).
  assert.ok(r2HudDebugLine(hud, { lockF: 18, lockMargin: NaN, lockDistrusted: true }).includes('!M—'),
    '미측정 마진이 숫자로 보인다');
});
