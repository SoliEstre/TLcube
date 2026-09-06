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
  locatorCellsCellSurfaceFinal,
  referenceCellsCellSurfaceFinal,
} from './cellSurfaceFinal.js';
import { REFERENCE_GROUP_DIGITS_2T } from './placementY.js';
import { digitToRanks } from './lehmer.js';
import { HUD_FACES } from './r2/hud-geometry.js';
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
 * 「이 면엔 톤이 없다」 — `toneGrid` 의 부재 값. 0·1·2 는 **실제 톤 값**이라 «없음» 을 0 으로 쓸 수 없다
 * (어두운 면 0 과 «모름» 이 같은 값이면 HUD 가 모르는 면을 어둡게 칠한다).
 */
export const HUD_TONE_NONE = 255;

/**
 * `toneGrid` 의 인덱스 규약 — **`faceQuadSlot(n, face, i, j) / 8` 과 같은 수**여야 한다
 * (사영 버퍼와 톤 배열이 같은 칸을 가리켜야 렌더가 둘을 짝지을 수 있다).
 * `test/r2-hud-model.test.js` 가 두 식을 라인업 전수에서 대조한다.
 */
export function hudToneSlot(n, face, i, j) {
  return (j * n + i) * HUD_FACES.length + face;
}

/**
 * 셀 하나의 {T, L, R} 톤을 `toneGrid` 에 쓴다. 면 순서는 `HUD_FACES`(= ygrid YFACES)에서
 * **유도**한다 — ['T','L','R'] 사본을 적으면 면 인덱스가 바뀌는 날 조용히 90° 돌아간다.
 */
function writeTones(toneGrid, n, i, j, tones) {
  for (let f = 0; f < HUD_FACES.length; f += 1) {
    const value = tones[HUD_FACES[f]];
    if (!Number.isInteger(value)) continue;
    toneGrid[hudToneSlot(n, f, i, j)] = value;
  }
}

/**
 * (n, layoutId) → HUD 가 그릴 역할 격자. 라인업 밖 n · 그 n 에 없는 id 는 **null** (예외 없음).
 *
 * - `roleGrid` : Uint8Array(n*n), 인덱스 `j*n + i`, 값 = HUD_ROLE.
 * - `scanGrid` : Int16Array(n*n), 데이터 셀이면 `dataCellsInScanOrderCellSurfaceFinal` 순번
 *   (= R2 `cellMap` 인덱스 k), 아니면 −1.
 * - `toneGrid` : Uint8Array(n*n*3), 인덱스 `hudToneSlot`, 값 = 그 면의 **설계 톤**
 *   (로케이터 0/2 · 레퍼런스 0/1/2), 톤이 없는 면은 `HUD_TONE_NONE`.
 *   로케이터는 `locatorCellsCellSurfaceFinal` 의 {T,L,R} 을 그대로, 레퍼런스는
 *   `REFERENCE_GROUP_DIGITS_2T` → `digitToRanks` 로 **유도**한다 (사본 표 금지).
 *   format 은 ecc·mask 를 알아야 정해지므로 지금은 톤 없음이다 (Format (a) 뒤 후속).
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
  let locator;
  let reference;
  try {
    map = layoutMapCellSurfaceFinal(size, layoutId);
    scan = dataCellsInScanOrderCellSurfaceFinal(size, layoutId);
    locator = locatorCellsCellSurfaceFinal(size, layoutId);
    reference = referenceCellsCellSurfaceFinal(size, layoutId);
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

  const toneGrid = new Uint8Array(size * size * HUD_FACES.length).fill(HUD_TONE_NONE);
  for (const cell of locator) writeTones(toneGrid, size, cell.i, cell.j, cell);
  for (let index = 0; index < reference.length; index += 1) {
    const cell = reference[index];
    // 조 내 3셀에 digit 이 순서대로 배정된다 (`encodeY` 와 **같은 식**: index % 3). tones=2 가 R2 의 메인이다.
    const digit = REFERENCE_GROUP_DIGITS_2T[index % REFERENCE_GROUP_DIGITS_2T.length];
    writeTones(toneGrid, size, cell.i, cell.j, digitToRanks(digit));
  }

  return { n: size, layoutId, roleGrid, scanGrid, toneGrid, counts };
}

/** 호모그래피 원소 수 (row-major 3×3). */
export const HUD_H_LENGTH = 9;

/** `hudProjectionChanged` 가 비교하는 스칼라 이름 — 캡처와 비교가 **같은 목록**을 쓴다 (사본 금지). */
export const HUD_PROJECTION_SCALARS = Object.freeze(['lockRevision', 'bindRevision', 'n', 'frameW', 'frameH']);

/**
 * HUD 재사영이 **필요한가**. 사영 결과가 달라질 수 있는 입력 여섯 가지를 비교한다:
 * 락 세대(lockRevision) · bind 세대(bindRevision) · n · 프레임 폭·높이 · H 9값.
 *
 * 왜 여섯인가 (운영자 실기 3차 ①): lockRevision 만 보면 «후보 폐기 → 같은 락으로 재bind»
 * (`disposeCandidates` 는 lockRevision 을 안 건드린다)에서 HUD 가 옛 사영을 그대로 들고 있다.
 * 반대로 매 프레임 다시 풀면 n=25 에서 마름모 1875개를 헛사영한다 — 그래서 «바뀐 것이
 * 있을 때만» 이다.
 *
 * NaN 은 `Object.is` 로 비교한다 — `!==` 로 재면 H 에 NaN 이 하나만 있어도 «항상 바뀜» 이 되어
 * 매 프레임 전체 재사영이 된다 (자기 자신과 다른 값).
 *
 * @param {object} snapshot 마지막 사영의 기록 ({lockRevision, bindRevision, n, frameW, frameH, H})
 * @param {object} next 이번 프레임의 같은 모양
 * @returns {boolean}
 */
export function hudProjectionChanged(snapshot, next) {
  if (snapshot === null || typeof snapshot !== 'object') return true;
  if (next === null || typeof next !== 'object') return true;
  for (const key of HUD_PROJECTION_SCALARS) {
    if (!Object.is(snapshot[key], next[key])) return true;
  }
  const a = snapshot.H;
  const b = next.H;
  if (!a || !b) return Boolean(a) !== Boolean(b);
  for (let k = 0; k < HUD_H_LENGTH; k += 1) {
    if (!Object.is(a[k], b[k])) return true;
  }
  return false;
}

/**
 * 이번 사영의 입력을 `snapshot` 에 적어 넣는다. H 는 어댑터 내부 버퍼의 **읽기 전용 참조**라
 * (r2-scan-runtime `view.H`) 참조를 들고 있으면 다음 프레임에 값이 바뀌어 비교가 항상 «같음» 이
 * 된다 — 그래서 9값을 **복사**한다. 반환은 snapshot 자신(연쇄용).
 */
export function hudCaptureProjection(snapshot, next) {
  if (snapshot === null || typeof snapshot !== 'object') return snapshot;
  if (next === null || typeof next !== 'object') return snapshot;
  for (const key of HUD_PROJECTION_SCALARS) snapshot[key] = next[key];
  const source = next.H;
  if (!source) {
    snapshot.H = null;
    return snapshot;
  }
  let target = snapshot.H;
  if (!target || target.length !== HUD_H_LENGTH) {
    target = new Float64Array(HUD_H_LENGTH);
    snapshot.H = target;
  }
  for (let k = 0; k < HUD_H_LENGTH; k += 1) target[k] = source[k];
  return snapshot;
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

/**
 * 🔴 **«격자 불신» 의 상태 단어** (3d). progress 행의 상태 라벨은 보통 `R2_INDICATOR` 이름에서
 * 오지만(`r2-confirmation-model.indicatorStateKey`), 이것은 인디케이터가 아니다 — 인디케이터는
 * «후보가 어디까지 왔나» 이고 불신은 «락을 믿을 수 있나» 라 **다른 축**이다. 같은 축에 우겨넣으면
 * COLLECTING 과 배타가 되어 「모으는 중인데 격자를 못 믿는다」를 표현할 수 없다.
 *
 * 사전 키는 `r2.state.<이 값>` 이다. 여기 한 곳이 원본이고 스캐너·사전 자가 여기서 유도한다.
 */
export const HUD_DISTRUST_STATE_KEY = 'distrust';

/**
 * 인디케이터 이름 **밖**의 `r2.state.*` 키 전부. `test/scanner-i18n.test.js` 의 「죽은 문구」
 * 판정이 이 목록을 인디케이터 이름에 더해 «있어야 하는 키» 를 만든다 — 사전에 손 목록을
 * 두지 않기 위한 원본이다. 늘리면 여덟 언어를 채우라고 그 자가 빨개진다.
 */
export const HUD_STATE_KEYS_BEYOND_INDICATOR = Object.freeze([HUD_DISTRUST_STATE_KEY]);

/**
 * **«격자 불신» 을 그릴 프레임인가** (3d · 요구 3).
 *
 * 어댑터의 `lockDistrusted`(마진 게이트 미달)를 위상과 곱한다: 그릴 격자가 없는 위상
 * (SEARCHING · DROPPED)과 이미 끝난 위상(DONE)에는 «불신» 이라는 말이 뜻이 없다 —
 * 그 셋에서 분홍 점선을 켜면 사용자는 「무언가 잘못됐다」를 코드가 없는 화면에서 읽는다.
 *
 * 입력은 `hudPhase` 와 **같은 모양**이고 `distrusted` 한 칸만 더 본다 — 두 판정이 같은
 * 프레임 상태에서 나와야 화면의 두 그림(위상 · 불신)이 안 어긋난다.
 */
export function hudDistrusted(input) {
  const src = (input !== null && typeof input === 'object') ? input : {};
  if (!src.distrusted) return false;
  const phase = hudPhase(src);
  return phase !== HUD_PHASE.SEARCHING
    && phase !== HUD_PHASE.DROPPED
    && phase !== HUD_PHASE.DONE;
}

/**
 * **같은 색, 알파만 배율** (3d 검토 결함 6). «불신» 을 그리는 표면이 셋인데(캔버스 선 ·
 * 미니 상자 CSS 테두리 · 그 테두리의 바깥 번짐) 색상은 셀맵의 «정정»(ERASURE) 하나여야 한다.
 * 세기만 다른 자리를 rgba 리터럴로 다시 적으면 셀맵 색을 바꾸는 날 그 자리만 옛 색으로 남는다
 * (memory: 사본 목록은 썩는다).
 *
 * 파싱을 못 하는 형식(hex·색 이름·`color-mix`)은 **원본을 그대로** 돌려준다 — 색을 잃는 것보다
 * 세기를 잃는 것이 낫다. 알파가 없으면 1 로 읽는다.
 *
 * @param {string} color `rgb()` 또는 `rgba()` 문자열.
 * @param {number} ratio 알파에 곱할 배율 (0..1 로 물린다).
 * @returns {string} 같은 rgb 의 `rgba(...)`.
 */
export function scaleColorAlpha(color, ratio) {
  if (typeof color !== 'string') return color;
  const match = /^rgba?\(([^)]*)\)$/i.exec(color.trim());
  if (!match) return color;
  const parts = match[1].split(',');
  if (parts.length < 3) return color;
  const r = parts[0].trim();
  const g = parts[1].trim();
  const b = parts[2].trim();
  const alpha = parts.length > 3 ? Number(parts[3]) : 1;
  const scale = Number(ratio);
  if (!Number.isFinite(alpha) || !Number.isFinite(scale)) return color;
  let out = alpha * scale;
  if (!(out > 0)) out = 0;
  if (out > 1) out = 1;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + String(Number(out.toFixed(4))) + ')';
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

/**
 * 🔴 **시험판 하단 패널의 hud 줄 — 순수 빌더** (2026-09-06 검토 R3c, 결함 16).
 *
 * 옛 자리는 `scanner.js` 안이었고 길이 자는 `
` 개수(논리 줄)뿐이라 **한 줄 188자**가 초록이었다.
 * 패널은 `white-space: pre-wrap` · 10px 모노라 287px 스테이지에서 **≈45자/시각 줄**이다
 * (index.html `.lab-debug-panel`) — 188자면 한 줄이 시각 4\~5줄이 되어 기본 4줄 + steady + qr 과
 * 합쳐 스테이지의 절반을 먹었다. 그래서 두 가지를 같이 고친다:
 *   ① 줄을 **여기서** 만든다 — 그러면 자가 철자가 아니라 **값**(실제 길이)을 잰다.
 *   ② 예산을 선언한다 (`R2_HUD_DEBUG_LINE_BUDGET`).
 *
 * 규약:
 *   · 카운터 이름은 **유도한 약어**다 (`counterAbbrev`) — 손 목록이 아니므로 카운터가 늘어도 따라온다.
 *   · **0 인 카운터는 안 적는다.** 「안 보이면 0」이 규약이고, 전부 0 이면 `·0` 하나를 적어
 *     「없다」와 「전부 0」을 가른다.
 *   · 없는 값은 «—» 다 (거짓 0 금지).
 */
/**
 * ⚠ **예산의 유도** — 패널은 287px 스테이지에서 ≈45자/시각 줄이다(10px 모노 · `overflow-wrap:anywhere`).
 *   · 옛 줄: 대표값 **188자 ≈ 4.2 시각 줄** (기본 4줄 + steady + qr 과 합쳐 스테이지의 55%).
 *   · 지금:  대표값 **68자 ≈ 1.5줄** · **최악 111자 ≈ 2.5줄** (카운터 7개가 전부 두 자리인 경우).
 * 120 은 그 최악에 세 자리 카운터 하나 분량의 여유를 둔 수다. 자(`test/r2-hud.test.js`)는 이 숫자를
 * 철자가 아니라 **런타임의 진짜 카운터 집합으로 만든 줄의 길이**로 잰다 — 카운터가 늘면 빨개진다.
 */
export const R2_HUD_DEBUG_LINE_BUDGET = 120;

/**
 * 카운터 이름 → 2\~3글자 약어. camelCase 를 단어로 갈라 머리글자를, 한 단어면 앞 두 글자를.
 * ⚠ 충돌하면 **전체 이름**으로 돌아간다 — 짧게 만드는 것보다 안 섞이는 것이 먼저다.
 */
export function counterAbbrev(name) {
  const text = String(name);
  const words = text.split(/(?=[A-Z])/).filter((w) => w !== '');
  if (words.length >= 2) return words.map((w) => w[0].toLowerCase()).join('');
  return text.slice(0, 2).toLowerCase();
}

function hudMs(value) {
  return Number.isFinite(value) ? Number(value).toFixed(1) : '—';
}

/**
 * 락 마진 — 가르는 구간이 1.1\~3 이라 **한 자리 소수**가 필요하다 (반올림하면 1.3 도 1.6 도 «1»
 * 이 되어 「게이트에 얼마나 못 미치나」가 사라진다). 큰 값은 정수로, 미측정·무한은 «—».
 */
function hudMargin(value) {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) >= 10 ? String(Math.round(value)) : Number(value).toFixed(1);
}

/** F 는 합성 프레임에서 1e30 까지 간다 — 자릿수로 줄을 터뜨리지 않게 큰 값은 지수로. */
function hudF(value) {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) >= 9999 ? Number(value).toExponential(1) : String(Math.round(value));
}

/**
 * @param {{phase:string, lastMs:number, maxMs:number, n:number, layoutId:string}} hud
 *   `layoutId` 는 **표시용으로 이미 다듬은** 문자열이다 (스캐너의 `layoutDisplayId`).
 * @param {object} stats R2 런타임 stats (`phaseMs` · `lockF` · `counters` · `format`).
 * @returns {string} 위상이 없으면 빈 문자열 — 패널의 «있을 때만» 규약.
 */
export function r2HudDebugLine(hud, stats) {
  if (!hud || typeof hud.phase !== 'string' || hud.phase === '') return '';
  const st = stats || {};
  let line = 'hud ' + hud.phase + ' ' + hudMs(hud.lastMs) + '/' + hudMs(hud.maxMs) + 'ms'
    + ' n' + (Number(hud.n) || 0) + ' ' + (hud.layoutId || '-');
  const phaseMs = st.phaseMs;
  if (phaseMs) {
    line += ' · d' + hudMs(phaseMs.detect) + ' a' + hudMs(phaseMs.align) + ' c' + hudMs(phaseMs.decode);
  }
  if (st.lockF !== undefined) line += ' · F' + hudF(st.lockF);
  /*
   * 3d — 마진은 **불신일 때만** 적는다 (패널의 «있을 때만» 규약). 믿는 프레임에 매번 적으면
   * 예산의 5자를 상수로 먹는데, 이 수가 답하는 질문은 「F 는 넘었는데 왜 안 모으나」 하나다.
   */
  if (st.lockDistrusted) line += '!M' + hudMargin(st.lockMargin);
  const counters = st.counters;
  if (counters) {
    const used = new Set();
    const parts = [];
    for (const [name, value] of Object.entries(counters)) {
      let key = counterAbbrev(name);
      if (used.has(key)) key = name;
      used.add(key);
      if (!value) continue;
      parts.push(key + value);
    }
    line += ' · ' + (parts.length > 0 ? parts.join('') : '·0');
  }
  const format = st.format;
  if (format) {
    // 출처는 «코드가 말했나» 하나가 관심사다 — locator 면 값만, default 면 «=» 로 표시한다.
    const said = format.source === 'locator';
    line += ' · fmt ' + (said ? '' : '=') + format.eccName + '/' + format.maskIndex
      + (said ? '×' + format.candidateCount : '');
  }
  return line;
}
