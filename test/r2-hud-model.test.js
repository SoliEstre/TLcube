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
  clearHudRoleGrids,
  hudRoleGridsInto,
  hudCorrectionGridOk,
  hudCorrectionLatch,
  hudCaptureProjection,
  hudDistrusted,
  hudPhase,
  hudProjectionChanged,
  hudSurfaceVisibility,
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
  // 빚 3 — 와이어 세대. 「격자가 세대를 받는가」를 값으로 재려면 세대 상수·선언 용량·포맷 셀이 필요하다.
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
  CELL_SURFACE_FINAL_FORMAT_WIRES,
  capacityForCellSurfaceFinal,
  formatCellsCellSurfaceFinal,
  hasLegacyFormatWire,
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

/** 레거시(포맷 v1) 판독 세대를 갖는 (n, id) 쌍 — 손 목록이 아니라 원본에서 거른다. */
function legacyWirePairs() {
  return lineupPairs().filter(({ id }) => hasLegacyFormatWire(id));
}

/*
 * ── 빚 3 (3b) — **와이어 세대는 역할 격자의 입력이다** ────────────────────────────────────
 *
 * 3a 유산의 결함: `buildRoleGrids` 가 세대를 모른 채 **현행 세대(2)로만** 격자를 만들었다.
 * 레거시 와이어(1) 로 발행된 프레임은 포맷 셀이 15칸(18 아님)이라 데이터 스캔 순서가 앞쪽부터
 * 밀리는데, HUD 는 세대 2 의 순서로 칠했다 — 정정 강조도 소거 색칠도 **다른 칸**을 지목한다.
 * (런타임은 이미 세대를 안다: `r2-scan-runtime.buildLayout` 이 `formatWire` 를 넘긴다.)
 *
 * 재는 성질 — 전부 **값**이고, 기대값의 출처는 스캔 순서 함수가 **아닌** 표다:
 *   ① 두 세대의 격자가 실제로 **다르다** (세대 인자를 무시하면 같아져 즉시 빨개진다).
 *   ② 데이터 칸 수 = 그 세대의 **선언 용량**(`capacityForCellSurfaceFinal(...).dataCells`,
 *      정본은 `DECLARED_DATA` 표) — 스캔 순서를 다시 세는 동어반복이 아니다.
 *   ③ FORMAT 역할 칸 = 그 세대의 `formatCellsCellSurfaceFinal` 집합과 **정확히** 같다.
 *   ④ 생략하면 현행 세대 — 옛 호출자(인자 둘)가 오늘과 같은 격자를 받는다.
 */
test('빚3 buildRoleGrids: 와이어 세대가 격자를 가른다 — 데이터 수는 선언 용량, 포맷 칸은 그 세대의 포맷 셀', () => {
  const pairs = legacyWirePairs();
  assert.ok(pairs.length >= 1,
    '레거시 와이어를 가진 라인업이 0개다 — 이 자가 공허해진다 (CELL_SURFACE_FINAL_LEGACY_IDS 확인)');
  for (const { n, id } of pairs) {
    const byWire = new Map();
    for (const wire of CELL_SURFACE_FINAL_FORMAT_WIRES) {
      const grids = buildRoleGrids(n, id, wire);
      assert.ok(grids !== null, n + '@' + id + ' wire' + wire + ': null 이면 안 된다');
      assert.equal(grids.formatWire, wire, n + '@' + id + ': 격자가 자기 세대를 안 싣는다');

      // ② 데이터 칸 수 — 선언 용량 표에서 온다.
      const declared = capacityForCellSurfaceFinal(n, 'H', 2, id, wire).dataCells;
      assert.equal(grids.counts.data, declared,
        n + '@' + id + ' wire' + wire + ': 데이터 칸 수가 선언 용량(' + declared + ')과 다르다');

      // ③ FORMAT 역할 칸 = 그 세대의 포맷 셀 집합.
      const wantFormat = new Set(
        formatCellsCellSurfaceFinal(n, id, wire).map((cell) => cell.j * n + cell.i),
      );
      const gotFormat = new Set();
      for (let idx = 0; idx < grids.roleGrid.length; idx += 1) {
        if (grids.roleGrid[idx] === HUD_ROLE.FORMAT) gotFormat.add(idx);
      }
      assert.deepEqual([...gotFormat].sort((a, b) => a - b), [...wantFormat].sort((a, b) => a - b),
        n + '@' + id + ' wire' + wire + ': FORMAT 칸 집합이 그 세대의 포맷 셀과 다르다');
      byWire.set(wire, grids);
    }

    // ① 두 세대가 실제로 다르다 — 첫 어긋남 순번을 값으로 낸다.
    const now = byWire.get(CELL_SURFACE_FINAL_FORMAT_WIRE);
    const legacy = byWire.get(CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
    assert.notEqual(now.counts.data, legacy.counts.data,
      n + '@' + id + ': 두 세대의 데이터 칸 수가 같다 — 세대 인자가 무시되고 있다');
    const inverseOf = (grids) => {
      const out = new Int32Array(grids.counts.data).fill(-1);
      for (let idx = 0; idx < grids.scanGrid.length; idx += 1) {
        const k = grids.scanGrid[idx];
        if (k >= 0 && k < out.length && out[k] < 0) out[k] = idx;
      }
      return out;
    };
    const invNow = inverseOf(now);
    const invLegacy = inverseOf(legacy);
    let firstDiff = -1;
    for (let k = 0; k < Math.min(invNow.length, invLegacy.length); k += 1) {
      if (invNow[k] !== invLegacy[k]) { firstDiff = k; break; }
    }
    assert.ok(firstDiff >= 0,
      n + '@' + id + ': 두 세대의 역표가 완전히 같다 — 세대 인자가 격자에 안 닿았다');
    /*
     * 그 어긋남은 **포맷 셀이 갈리는 자리부터** 시작한다: 세대 2 가 더 쓰는 포맷 칸을 세대 1 은
     * 데이터로 쓰므로, 그 칸이 스캔 순서에 처음 나오는 순번이 곧 첫 어긋남이다.
     * 값 자체(v0@13 = 7)는 배치라 안 못 박고, 「0 보다 크고 둘 다의 길이 안」만 잰다.
     */
    assert.ok(firstDiff > 0 && firstDiff < invNow.length,
      n + '@' + id + ': 첫 어긋남 순번이 ' + firstDiff + ' 이다 — 격자 앞부분까지 갈리면 파인더가 바뀐 것');
  }
});

test('빚3 buildRoleGrids: 세대를 생략하면 현행 세대 — 옛 호출자(인자 둘)가 같은 격자를 받는다', () => {
  for (const { n, id } of lineupPairs()) {
    assert.deepEqual(buildRoleGrids(n, id), buildRoleGrids(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE),
      n + '@' + id + ': 생략 기본값이 현행 세대가 아니다');
  }
  // 세대가 아닌 값은 «모른다» → 현행 세대로 떨어진다 (예외 없음 · 그림을 잃지 않는다).
  const { n, id } = lineupPairs()[0];
  for (const bad of [0, 3, -1, 1.5, NaN, 'x', null, {}]) {
    assert.deepEqual(buildRoleGrids(n, id, bad), buildRoleGrids(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE),
      '세대 ' + String(bad) + ' 가 현행 세대로 안 떨어진다');
  }
  // 레거시 세대가 **없는** 레이아웃에 1 을 주면 null (예외 없음) — 런타임도 그 후보를 안 만든다.
  const noLegacy = lineupPairs().find((p) => !hasLegacyFormatWire(p.id));
  assert.ok(noLegacy, '레거시 없는 레이아웃이 라인업에 0개다 — 이 단언이 공허해진다');
  assert.equal(buildRoleGrids(noLegacy.n, noLegacy.id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY), null,
    noLegacy.n + '@' + noLegacy.id + ': 없는 세대 조합이 null 이 아니다');
});

/*
 * ── 빚 3 (3b) — **파생값에는 무효화 트리거도 필요하다** ──────────────────────────────────
 *
 * 격자와 역표는 매 프레임 만들 수 없어(핫 경로 할당 금지) 캐시된다. 그 캐시의 키가
 * (n · layoutId) 뿐이면 **세대만 바뀐 재bind** 가 옛 격자를 그대로 쓴다 — 유도식을 고쳐도
 * 사용자에게는 «안 고쳐진 것» 이다 (memory: 파생값은 트리거도 필요하다).
 * 그래서 캐시 규칙 자체를 순수 함수로 두고 **값으로** 잰다: 세대 한 축만 흔들어 다시 만드는지.
 */
test('빚3 hudRoleGridsInto: 캐시 키는 (n · layoutId · 세대) 셋 — 세대만 바뀌어도 다시 만든다', () => {
  const pair = legacyWirePairs()[0];
  assert.ok(pair, '레거시 세대를 가진 라인업이 없다 — 이 자가 공허해진다');
  const { n, id } = pair;
  const cache = {
    roleGrids: null, scanInverse: null, layoutId: '', gridN: 0, gridWire: 0,
  };

  // ① 첫 호출 — 만든다.
  assert.equal(hudRoleGridsInto(cache, { n, layoutId: id, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE }), true);
  assert.ok(cache.roleGrids, '격자를 안 만들었다');
  assert.ok(cache.scanInverse, '역표를 안 만들었다');
  assert.equal(cache.roleGrids.formatWire, CELL_SURFACE_FINAL_FORMAT_WIRE);
  const first = cache.roleGrids;
  const firstInverse = cache.scanInverse;

  // ② 같은 셋 — 다시 만들지 않는다 (핫 경로 할당 금지).
  assert.equal(hudRoleGridsInto(cache, { n, layoutId: id, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE }), false);
  assert.equal(cache.roleGrids, first, '같은 키인데 격자를 다시 만들었다');
  assert.equal(cache.scanInverse, firstInverse, '같은 키인데 역표를 다시 만들었다');

  // ③ 🔴 **세대 한 축만** 바꾼다 — 여기가 이 자의 존재 이유다.
  assert.equal(hudRoleGridsInto(cache, { n, layoutId: id, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY }), true,
    '세대가 바뀌었는데 캐시를 그대로 쓴다 — 레거시 프레임의 강조가 옛 세대의 칸을 지목한다');
  assert.equal(cache.gridWire, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
  assert.notEqual(cache.roleGrids, first);
  assert.notEqual(cache.roleGrids.counts.data, first.counts.data,
    '세대를 바꿨는데 데이터 칸 수가 같다 — 캐시가 세대를 안 넘겼다');
  // 역표도 그 세대의 것이다 (한쪽만 갱신하면 셀 번호와 칸이 어긋난다).
  assert.equal(cache.scanInverse.length, cache.roleGrids.counts.data);
  for (let k = 0; k < cache.scanInverse.length; k += 1) {
    assert.equal(cache.roleGrids.scanGrid[cache.scanInverse[k]], k, 'k=' + k + ' 역표가 격자의 역함수가 아니다');
  }

  // ④ 선두가 없으면(빈 문자열) 캐시를 **비운다** — 옛 선두의 색으로 칠하면 두 표면이 다른 말을 한다.
  assert.equal(hudRoleGridsInto(cache, { n, layoutId: '', formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE }), true);
  assert.equal(cache.roleGrids, null);
  assert.equal(cache.scanInverse, null);
  assert.equal(cache.layoutId, '');
  assert.equal(cache.gridN, 0);
  assert.equal(cache.gridWire, 0);

  // ⑤ n 을 모르면(락 전·코스팅) **아무것도 안 한다** — 옛 격자를 지우지도 새로 만들지도 않는다.
  hudRoleGridsInto(cache, { n, layoutId: id, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE });
  const kept = cache.roleGrids;
  assert.equal(hudRoleGridsInto(cache, { n: 0, layoutId: id, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE }), false);
  assert.equal(cache.roleGrids, kept, 'n 을 모르는 프레임이 캐시를 건드렸다');

  // ⑥ 잘못된 입력은 예외 없이 false. 캐시가 아니면 아무 일도 없다.
  assert.equal(hudRoleGridsInto(null, { n, layoutId: id }), false);
  assert.equal(hudRoleGridsInto(cache, null), false);
  // 없는 세대 조합(레거시 없는 레이아웃 × 1)은 캐시를 **비운다** — 그릴 수 없는 격자를 남기지 않는다.
  const noLegacy = lineupPairs().find((p) => !hasLegacyFormatWire(p.id));
  assert.equal(hudRoleGridsInto(cache, { n: noLegacy.n, layoutId: noLegacy.id, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY }), true);
  assert.equal(cache.roleGrids, null, '만들 수 없는 조합인데 옛 격자가 남았다');
});

test('빚3 clearHudRoleGrids: 캐시 다섯 칸을 한 자리에서 비운다 (hideR2Hud 와 같은 규칙)', () => {
  const pair = legacyWirePairs()[0];
  const cache = {
    roleGrids: null, scanInverse: null, layoutId: '', gridN: 0, gridWire: 0,
  };
  hudRoleGridsInto(cache, { n: pair.n, layoutId: pair.id, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY });
  assert.ok(cache.roleGrids && cache.gridWire === CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
  assert.equal(clearHudRoleGrids(cache), true, '비울 것이 있는데 «안 바뀌었다» 고 답했다');
  assert.deepEqual(cache, {
    roleGrids: null, scanInverse: null, layoutId: '', gridN: 0, gridWire: 0,
  });
  // 이미 비어 있으면 «안 바뀌었다» — 호출자가 헛렌더를 안 해도 된다.
  assert.equal(clearHudRoleGrids(cache), false);
  assert.equal(clearHudRoleGrids(null), false);
});

/*
 * ── 빚 3 (3b) — **끝단 소비 사슬: 적중 → 래치 → 소비** ────────────────────────────────────
 *
 * 3b 검토 F2 / rulers F2 가 잡은 구멍: 상류(`buildRoleGrids` · `hudRoleGridsInto`)는 값으로
 * 잠겼는데 **그 세대를 확인하는 쪽**이 전부 렌더러 지역 코드라 무자였다. 실측으로:
 *   · 래치에서 `formatWire` 한 줄을 지우면 → 소비 판정이 영원히 거짓 → **정정 강조가 한
 *     픽셀도 안 그려지는데** 표적 87/87 초록.
 *   · 8항 논리곱의 세대 항을 지워도 → 초록 (레거시 프레임에서 다른 칸을 칠하게 된다).
 * 두 규칙이 순수 함수로 올라왔으므로 아래 둘이 **값으로** 잰다 — 그리고 둘을 사슬로 잇는다:
 * 래치가 안 붙잡은 칸은 소비자가 구조적으로 못 본다.
 */

/** 세대 w 를 묶은 격자 캐시 하나 — 소비 판정의 «이쪽» 입력. */
function gridCacheFor(pair, wire) {
  const cache = {
    roleGrids: null, scanInverse: null, layoutId: '', gridN: 0, gridWire: 0,
  };
  hudRoleGridsInto(cache, { n: pair.n, layoutId: pair.id, formatWire: wire });
  assert.ok(cache.roleGrids !== null,
    '자 자신의 준비가 실패했다 (' + pair.id + '@' + pair.n + ' wire ' + wire + ')');
  return cache;
}

/** DONE 적중 하나 — 정정 셀 3칸 (`buildR2Hit` 이 내는 모양). */
function hitFor(pair, wire, count = 3) {
  return {
    text: 'x',
    layoutId: pair.id,
    n: pair.n,
    frame: 6,
    correctedCount: count,
    correctedCells: Int32Array.from([1, 2, 3]),
    formatWire: wire,
  };
}

test('빚3 hudCorrectionLatch: 셀 번호의 «좌표계» 셋을 통째로 붙잡는다 — 소비자가 비교하는 목록과 같다', () => {
  const pair = legacyWirePairs()[0];
  const hit = hitFor(pair, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
  const latch = hudCorrectionLatch(hit, 1234);
  assert.ok(latch !== null, '그릴 셀이 있는 적중인데 래치가 안 섰다');
  assert.equal(latch.at, 1234, '시각이 주입값이 아니다 — 그것이 강조 수명의 유일한 원천이다');
  assert.equal(latch.count, 3);
  assert.equal(latch.cells, hit.correctedCells, '셀 목록을 복사했다 (핫 경로 할당)');
  /*
   * 🔴 붙잡는 좌표계 셋 — **소비자가 비교하는 축**과 같은 목록이어야 한다. 하나라도 빠지면
   * 그 축의 어긋남을 `hudCorrectionGridOk` 가 구조적으로 못 본다 (그리고 «세대» 가 빠지면
   * 비교가 `undefined` 와의 대조가 되어 강조가 **통째로** 꺼진다 — 아래 사슬 단언).
   */
  for (const key of ['layoutId', 'n', 'formatWire']) {
    assert.equal(latch[key], hit[key], '래치가 ' + key + ' 를 안 붙잡는다 — 셀 번호의 좌표계를 잃는다');
  }
  // 「그릴 게 있을 때만」 — 빈 래치는 「그릴 게 있다」로 읽혀 그 프레임의 렌더가 헛돈다.
  assert.equal(hudCorrectionLatch({ ...hit, correctedCount: 0 }, 0), null, '정정 0 인데 래치가 섰다');
  assert.equal(hudCorrectionLatch({ ...hit, correctedCells: Int32Array.of() }, 0), null, '셀 0칸인데 래치가 섰다');
  assert.equal(hudCorrectionLatch({ ...hit, correctedCells: null }, 0), null);
  assert.equal(hudCorrectionLatch({ ...hit, correctedCount: 1.5 }, 0), null, '정수가 아닌 수를 세었다');
  for (const bad of [null, undefined, 0, 'x']) assert.equal(hudCorrectionLatch(bad, 0), null, String(bad));
});

test('빚3 hudCorrectionGridOk: 축 하나만 틀려도 거짓 — 세대만 달라도 (3b 검토 F2 · 강조를 통째로 끄는 스위치)', () => {
  const pair = legacyWirePairs()[0];
  const legacy = CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY;
  const cache = gridCacheFor(pair, legacy);
  const latch = hudCorrectionLatch(hitFor(pair, legacy), 0);
  assert.equal(hudCorrectionGridOk(cache, latch, pair.n), true, '같은 격자·같은 세대인데 강조를 막는다');

  /*
   * 🔴 **한 축씩** — 「이 셀 번호를 이 격자에 찍어도 되는가」의 축을 따로 흔든다. 어느 항을
   * 지우든(= 실측된 변이 X3) 여기서 빨개진다.
   */
  const worse = [
    ['격자 없음', { ...cache, roleGrids: null }, latch, pair.n],
    ['역표 없음', { ...cache, scanInverse: null }, latch, pair.n],
    ['캐시 n 어긋남', { ...cache, gridN: pair.n + 1 }, latch, pair.n],
    ['래치 n 어긋남', cache, { ...latch, n: pair.n + 1 }, pair.n],
    ['변종 어긋남', cache, { ...latch, layoutId: latch.layoutId + 'x' }, pair.n],
    ['세대 어긋남', cache, { ...latch, formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE }, pair.n],
    ['래치 없음', cache, null, pair.n],
    ['n 미상', cache, latch, 0],
  ];
  for (const [name, c, corr, n] of worse) {
    assert.equal(hudCorrectionGridOk(c, corr, n), false, name + ': 어긋난 격자에 강조를 찍는다');
  }
  /*
   * 🔴 **사슬** — 래치가 세대를 안 붙잡으면(그 한 줄을 지우면) 소비자가 «같은 격자» 를 절대
   * 인정하지 않는다: 화면에서는 「정정 강조가 통째로 안 뜬다」로 보이고 상류 자는 전부 초록이다.
   */
  const latchWithoutWire = { at: latch.at, count: latch.count, cells: latch.cells, layoutId: latch.layoutId, n: latch.n };
  assert.equal(hudCorrectionGridOk(cache, latchWithoutWire, pair.n), false,
    '세대를 안 붙잡은 래치를 소비자가 «같은 격자» 로 인정한다');
  // 그리고 **다른 세대의 격자**로 그리면 거짓 — 이것이 빚 3 이 막는 그림이다.
  assert.equal(hudCorrectionGridOk(gridCacheFor(pair, CELL_SURFACE_FINAL_FORMAT_WIRE), latch, pair.n), false,
    '레거시 셀 번호를 현행 세대 격자에 찍는다 — 순번 7 부터 다른 칸이다');
  // 잘못된 입력에 안 던진다.
  for (const bad of [null, undefined, 0, 'x']) {
    assert.equal(hudCorrectionGridOk(bad, latch, pair.n), false, String(bad));
    assert.equal(hudCorrectionGridOk(cache, bad, pair.n), false, String(bad));
    assert.equal(hudCorrectionGridOk(cache, latch, bad), false, String(bad));
  }
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

/*
 * ⑯(i) (2026-09-06 승격) — **HUD 세 표면의 표시 판정**. 옛 자리는 렌더러 안의 세 대입이었고, 그래서
 * 「유예 창에서 오버레이가 열려 있는가」를 재는 방법이 철자밖에 없었다 — 결정 (i) 가 여는 표면이
 * 정확히 그 프레임이라, 그 축은 값으로 재야 한다 (memory: 철자를 재는 자는 썩는다).
 */

test('⑯(i) hudSurfaceVisibility — 그릴 근거가 없으면 셋 다 숨김 (hideR2Hud 와 같은 규칙)', () => {
  const all = { overlayHidden: true, miniHidden: true, cellMapHidden: true };
  // 스트림·런타임·뷰 중 **하나라도** 없으면 닫힌다 — 세 축을 각각 흔들어 본다(하나라도 안 보면 그 축이 영원히 안 보인다).
  assert.deepEqual(hudSurfaceVisibility({ hasStream: false, runtimeEnabled: true, hasView: true, phase: HUD_PHASE.DATA }), all);
  assert.deepEqual(hudSurfaceVisibility({ hasStream: true, runtimeEnabled: false, hasView: true, phase: HUD_PHASE.DATA }), all);
  assert.deepEqual(hudSurfaceVisibility({ hasStream: true, runtimeEnabled: true, hasView: false, phase: HUD_PHASE.DATA }), all);
  // 정정 강조가 살아 있어도 카메라가 없으면 그릴 곳이 없다 — 결과 시트 위에 유령 캔버스가 뜨면 안 된다.
  assert.deepEqual(hudSurfaceVisibility({ hasStream: false, runtimeEnabled: true, hasView: true, phase: HUD_PHASE.DONE, corrFresh: true }), all);
  // 모름·비객체는 닫힘 쪽 (부팅 순간의 undefined 가 캔버스를 열면 안 된다).
  for (const bad of [undefined, null, 0, 'x', {}, []]) assert.deepEqual(hudSurfaceVisibility(bad), all, String(bad));
  // 비불리언 참값도 «참» 이 아니다 — 명시적 true 만 산다.
  assert.deepEqual(hudSurfaceVisibility({ hasStream: 1, runtimeEnabled: 1, hasView: 1, phase: HUD_PHASE.DATA }), all);
});

test('⑯(i) hudSurfaceVisibility — 살아 있으면 미니·셀맵은 항상 열리고, 오버레이는 위상 ∨ 정정 강조', () => {
  const live = { hasStream: true, runtimeEnabled: true, hasView: true };
  // 미니·셀맵은 **모든 위상에서** 열린다 (점진 표시가 SEARCHING 부터 시작한다).
  for (const phase of Object.values(HUD_PHASE)) {
    const v = hudSurfaceVisibility({ ...live, phase });
    assert.equal(v.miniHidden, false, phase + ' 에서 미니 HUD 가 닫힌다 — 점진 표시가 사라진다');
    assert.equal(v.cellMapHidden, false, phase + ' 에서 셀맵이 닫힌다');
  }
  // 오버레이 — «그릴 H 가 있는 위상» 셋만 연다.
  const closedPhases = [HUD_PHASE.SEARCHING, HUD_PHASE.DROPPED, HUD_PHASE.DONE];
  for (const phase of Object.values(HUD_PHASE)) {
    const expected = closedPhases.includes(phase);
    assert.equal(hudSurfaceVisibility({ ...live, phase }).overlayHidden, expected,
      phase + ' 위상의 오버레이 표시가 뒤집혔다');
  }
  /*
   * 🔴 **⑯(i) 의 표면** — 정정 강조는 위상 밖의 층이라 DONE 에서도 오버레이를 연다. 그 프레임이
   * 실제로 합성되도록 수용 경로가 stopCamera 를 R2_HUD_CORRECTION_MS 만큼 미룬다
   * (규칙·불변식은 test/scanner-accept-delay.test.js).
   */
  assert.equal(hudSurfaceVisibility({ ...live, phase: HUD_PHASE.DONE, corrFresh: true }).overlayHidden, false,
    '정정 강조가 DONE 오버레이를 못 연다 — ⑯(i) 가 산 시간이 빈 화면이 된다');
  // 그리고 «열려 있는» 위상에서는 corrFresh 가 아무것도 안 바꾼다 (덧셈이지 대체가 아니다).
  for (const phase of Object.values(HUD_PHASE)) {
    const withCorr = hudSurfaceVisibility({ ...live, phase, corrFresh: true });
    assert.equal(withCorr.overlayHidden, false, phase + ' 에서 정정 강조가 오버레이를 못 연다');
  }
  // 알 수 없는 위상은 «그릴 H 가 있는 위상» 쪽으로 떨어진다 — 위상이 늘어도 그림이 사라지지 않는다.
  assert.equal(hudSurfaceVisibility({ ...live, phase: 'zzz-new-phase' }).overlayHidden, false);
});
