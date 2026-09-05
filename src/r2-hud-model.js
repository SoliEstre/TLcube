/**
 * r2-hud-model.js — **R2 HUD 의 순수 역할·위상 모델** (순수 함수 · DOM 없음 · 디코더 import 없음).
 *
 * 스캐너 HUD 층(실제 사영 위치에 그리는 오버레이 · 우측 미니 HUD)이 쓸 «무엇을 어떤
 * 묶음으로 그리는가» 를 셀 표면 레이아웃과 R2 런타임 상태에서 **유도**한다. 좌표·색·캔버스는
 * 전부 렌더 층의 몫이고, 여기에는 규칙만 있다.
 *
 * ## 운영자 결정 (PM/029B §27 · 2026-09-05 · 잠긴 결론)
 *   ⑧ 확정 = 락 시점(타입·n). **레이아웃 변종은 DONE 까지 변동** — 선두가 바뀌면 역할색이
 *      통째로 바뀌므로, 역할 묶음은 «변동(tentative) / 확정(confirmed)» 두 벌로 갈린다
 *      (`bucketKey` 의 `layoutTentative`). 어느 쪽인지는 호출자(좌 패널과 공유하는
 *      히스테리시스 선두 · 래치)가 정하고 이 모델은 묶음 키만 준다.
 *   ⑨ HUD 는 가이드가 아니라 실제 사영 위치(락 H)에 그린다 — 그 사영은 렌더 층이 하고,
 *      여기서는 canonical 격자 인덱스 `(i, j)` 까지만 다룬다.
 *
 * ## 사본 목록 금지
 * 역할 이름·묶음 키·셀 상태는 전부 원본 객체(`HUD_ROLE` · `CELL_MAP_STATE`)에서 유도한다.
 * `CELL_MAP_STATE` 에 상태가 하나 늘면 `HUD_BUCKETS` 도 따라 늘어난다
 * (`test/r2-hud-model.test.js` 의 «HUD_BUCKETS» 묶음이 그 유도를 잰다).
 *
 * 순수 — 입력을 바꾸지 않고, 어떤 입력에도 예외를 내지 않는다 (잘못된 입력 → null 또는 기본값).
 */

import {
  layoutMapCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from './cellSurfaceFinal.js';
import { R2_INDICATOR } from './r2/session.js';
import { CELL_MAP_STATE } from './r2/progress.js';

/** HUD 격자 한 칸의 역할. EMPTY(0) 는 «레이아웃 맵에 없는 (i,j)» — 그리지 않는다. */
export const HUD_ROLE = Object.freeze({
  EMPTY: 0,
  DATA: 1,
  LOCATOR: 2,
  REFERENCE: 3,
  FORMAT: 4,
  SLOT: 5,
});

/**
 * `layoutMapCellSurfaceFinal` 의 role 문자열 → HUD_ROLE. `HUD_ROLE` 에서 **유도**한다
 * (키 소문자 = 표면의 role 문자열). 사전에 없는 role 은 EMPTY 로 떨어진다.
 */
const HUD_ROLE_BY_NAME = Object.freeze(Object.fromEntries(
  Object.entries(HUD_ROLE).map(([name, value]) => [name.toLowerCase(), value]),
));

/** HUD_ROLE 값 → 소문자 이름 (묶음 키·counts 키의 원천). */
const HUD_ROLE_NAME_BY_VALUE = new Map(
  Object.entries(HUD_ROLE).map(([name, value]) => [value, name.toLowerCase()]),
);

/** counts 의 키 = HUD_ROLE 선언 순서에서 유도 (사본 목록 금지). */
const COUNT_KEYS = Object.freeze(Object.keys(HUD_ROLE).map((name) => name.toLowerCase()));

/** 역할 묶음이 갈리는 두 벌 — 레이아웃 변동(t) / 확정(c). */
const LAYOUT_SUFFIX = Object.freeze({ tentative: 't', confirmed: 'c' });

/** 데이터 셀 묶음 키의 접두사 (`'data:'`). */
const DATA_BUCKET_PREFIX = HUD_ROLE_NAME_BY_VALUE.get(HUD_ROLE.DATA) + ':';

/** 묶음을 갖는 역할 = EMPTY(안 그림) · DATA(상태색으로 따로) 를 뺀 나머지. */
const BUCKETED_ROLES = Object.freeze(
  Object.values(HUD_ROLE).filter((value) => value !== HUD_ROLE.EMPTY && value !== HUD_ROLE.DATA),
);

/** 유효한 셀 상태 값 — CELL_MAP_STATE 에서 유도. */
const CELL_STATE_VALUES = Object.freeze(Object.values(CELL_MAP_STATE));
const CELL_STATE_SET = new Set(CELL_STATE_VALUES);

/**
 * 그리기 묶음 키의 **고정 순서** 배열: 역할(EMPTY·DATA 제외) × {변동, 확정} 다음
 * 데이터 셀 상태별 묶음. 전부 유도이므로 `HUD_ROLE` / `CELL_MAP_STATE` 가 늘면 같이 는다.
 */
export const HUD_BUCKETS = Object.freeze([
  ...BUCKETED_ROLES.flatMap((role) => Object.values(LAYOUT_SUFFIX)
    .map((suffix) => HUD_ROLE_NAME_BY_VALUE.get(role) + ':' + suffix)),
  ...CELL_STATE_VALUES.map((state) => DATA_BUCKET_PREFIX + state),
]);

const HUD_BUCKET_SET = new Set(HUD_BUCKETS);

/**
 * (역할, 셀 상태, 레이아웃 변동 여부) → `HUD_BUCKETS` 의 원소. EMPTY 이거나 모르는 역할이면
 * null (그리지 않는다). DATA 는 상태색이라 `layoutTentative` 를 무시하고, 모르는 상태는
 * UNOBSERVED 묶음으로 떨어진다.
 */
export function bucketKey(role, cellState, layoutTentative) {
  const name = HUD_ROLE_NAME_BY_VALUE.get(role);
  if (name === undefined || role === HUD_ROLE.EMPTY) return null;
  if (role === HUD_ROLE.DATA) {
    const state = CELL_STATE_SET.has(cellState) ? cellState : CELL_MAP_STATE.UNOBSERVED;
    return DATA_BUCKET_PREFIX + state;
  }
  const key = name + ':' + (layoutTentative ? LAYOUT_SUFFIX.tentative : LAYOUT_SUFFIX.confirmed);
  return HUD_BUCKET_SET.has(key) ? key : null;
}

/**
 * (n, layoutId) → HUD 가 그릴 역할 격자. 라인업 밖 n · 그 n 에 없는 id 는 **null** (예외 없음).
 *
 * - `roleGrid` : Uint8Array(n*n), 인덱스 `j*n + i`, 값 = HUD_ROLE.
 * - `scanGrid` : Int16Array(n*n), 데이터 셀이면 `dataCellsInScanOrderCellSurfaceFinal` 순번
 *   (= R2 `cellMap` 인덱스 k), 아니면 −1.
 * - `counts`   : 역할별 칸 수 (합 = n²).
 */
export function buildRoleGrids(n, layoutId) {
  const size = Number(n);
  if (!Number.isInteger(size) || size <= 0) return null;
  let ids;
  try {
    ids = finalLayoutIdsForN(size);
  } catch {
    return null;
  }
  if (!Array.isArray(ids) || !ids.includes(layoutId)) return null;

  let map;
  let scan;
  try {
    map = layoutMapCellSurfaceFinal(size, layoutId);
    scan = dataCellsInScanOrderCellSurfaceFinal(size, layoutId);
  } catch {
    return null;
  }

  const roleGrid = new Uint8Array(size * size);
  const scanGrid = new Int16Array(size * size).fill(-1);
  const counts = {};
  for (const key of COUNT_KEYS) counts[key] = 0;

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const entry = map.get(i + ',' + j);
      const role = (entry === undefined || entry === null)
        ? HUD_ROLE.EMPTY
        : (HUD_ROLE_BY_NAME[entry.role] ?? HUD_ROLE.EMPTY);
      roleGrid[j * size + i] = role;
      const name = HUD_ROLE_NAME_BY_VALUE.get(role);
      if (name !== undefined) counts[name] += 1;
    }
  }
  scan.forEach((cell, k) => {
    const idx = cell.j * size + cell.i;
    if (idx >= 0 && idx < scanGrid.length) scanGrid[idx] = k;
  });

  return { n: size, layoutId, roleGrid, scanGrid, counts };
}

/** HUD 위상 — 우측 미니 HUD 의 점진 표시(실루엣 → 격자 → 역할색 → 데이터)가 이 순서를 탄다. */
export const HUD_PHASE = Object.freeze({
  SEARCHING: 'searching',
  TYPE: 'type',
  GRID: 'grid',
  DATA: 'data',
  FINALIZING: 'finalizing',
  DONE: 'done',
  DROPPED: 'dropped',
});

/**
 * cellMap 에서 UNOBSERVED 가 아닌 셀 수. cellMap 이 없거나 길이가 모자라면 있는 만큼만 센다.
 */
export function countObserved(cellMap, cellCount) {
  if (cellMap === null || cellMap === undefined || typeof cellMap.length !== 'number') return 0;
  const declared = Number(cellCount);
  const limit = Number.isFinite(declared)
    ? Math.min(cellMap.length, Math.max(0, Math.trunc(declared)))
    : cellMap.length;
  let observed = 0;
  for (let k = 0; k < limit; k += 1) {
    if (cellMap[k] !== CELL_MAP_STATE.UNOBSERVED) observed += 1;
  }
  return observed;
}

/** 유한한 양수만 통과 — NaN·undefined·음수는 «없음»(0). */
function positive(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * HUD 위상 판정. **우선순위 고정**:
 * latched → DONE ; DROPPED/FAILED → DROPPED ; 락 없음 또는 후보 0 → SEARCHING ;
 * FINALIZING → FINALIZING ; 관측 셀 있음 → DATA ; cellCount > 0 → GRID ; 그 외 → TYPE.
 * 입력 누락·NaN 은 «없음» 으로 읽히므로 SEARCHING 으로 떨어진다.
 */
export function hudPhase(input) {
  const src = (input !== null && typeof input === 'object') ? input : {};
  if (src.latched) return HUD_PHASE.DONE;
  const indicator = src.indicator;
  if (indicator === R2_INDICATOR.DROPPED || indicator === R2_INDICATOR.FAILED) {
    return HUD_PHASE.DROPPED;
  }
  if (!src.locked || positive(src.candidateCount) <= 0) return HUD_PHASE.SEARCHING;
  if (indicator === R2_INDICATOR.FINALIZING) return HUD_PHASE.FINALIZING;
  if (positive(src.observedCells) > 0) return HUD_PHASE.DATA;
  if (positive(src.cellCount) > 0) return HUD_PHASE.GRID;
  return HUD_PHASE.TYPE;
}

/** 경과 비율 0..1. 입력이 하나라도 비유한이면 null (호출자가 «시각 미상» 을 해석한다). */
function ratio(nowMs, startedMs, durationMs) {
  const now = Number(nowMs);
  const started = Number(startedMs);
  const duration = Number(durationMs);
  if (!Number.isFinite(now) || !Number.isFinite(started) || !Number.isFinite(duration)) return null;
  if (duration <= 0) return 1;
  const t = (now - started) / duration;
  if (t <= 0) return 0;
  return t >= 1 ? 1 : t;
}

/** 페이드인 α — 0 → 1 단조 증가. 비유한 입력(시각 미상)은 «이미 다 떴다» 로 1. */
export function fadeAlpha(nowMs, startedMs, durationMs = 300) {
  const t = ratio(nowMs, startedMs, durationMs);
  return t === null ? 1 : t;
}

/** 플래시 α — 1 → 0 단조 감소, duration 이후 0. 비유한 입력(시각 미상)은 «안 그림» 으로 0. */
export function flashAlpha(nowMs, startedMs, durationMs = 600) {
  const t = ratio(nowMs, startedMs, durationMs);
  return t === null ? 0 : 1 - t;
}
