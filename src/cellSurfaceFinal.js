/**
 * cellSurfaceFinal.js — Type Y 셀 표면 **최종 라인업** (v0 · v2r2 · v1r2 · v0X).
 *
 * 운영자 확정 라인업 (2026-08-15, 중앙 개정 2026-08-16, v0X 추가 2026-08-16):
 *   Y0 (n=13) → v0   — 네 코너 소형 블록 파인더 30셀 (정본: cellsurface-v0-editor.json)
 *   Y1 (n=21) → v2r2 — 중앙 블록 A(v1r2 NW 5×5 공유) + 먼 꼭짓점 앵커 블록 B(7×7) = 74셀
 *   Y2 (n=25) → v2r2 — 같은 앵커식 (블록 B 가 (n−7..n−1)² 로 평행이동)
 *   Y1 (n=21) → v1r2 — 네 코너 블록 80셀 (v0 의 확장형). **A/B 후보**로 병행 등록
 *                      (운영자 지시 2026-08-15 밤, 정본: cellsurface-v1r2-editor.json)
 *   Y1 (n=21) → v0X  — QR 파인더 문법 차용 v0 확장 65셀. **n21 3파전 후보**
 *                      (운영자 지시 2026-08-16, 정본: cellsurface-v0x-editor.json)
 *
 * n=21 은 후보가 셋이다 — 기본(default)은 v2r2 로 두고, 디코더 CS 평가가 세 레이아웃을
 * 모두 채점해 기존 게이트(agreement · orientation margin)로 고른다. formatIndex 는
 * 신설하지 않는다 — 레이아웃 판별은 «평가 게이트 + 로케이터 패밀리» 가 맡는다.
 *
 * **중앙 블록 in-place 개정 (운영자 지시 2026-08-16)**: v2r2 의 구 중앙 블록 A
 * ((0..3)² 16셀, 동심 육각 링 K5)는 v0·v1r2 의 불스아이형 중앙(K3)과 일관성이 맞지
 * 않아 **v1r2 중앙 블록(NW 5×5 25셀, cellsurface-v1r2-editor.json 정본 그대로)으로
 * 교체**했다. id 'v2r2' 는 유지한다(in-place). 구 디자인(16셀 링) 인쇄물은 실사 성공
 * 이력이 없어 **소각** — 코드 어디에서도 구 블록 A 를 렌더·검출하지 않으며, 로케이터의
 * 구 중앙 서명(닫힌 K5 링 스택)은 legacy 분류로만 남아 포즈를 만들지 않는다
 * (cellsurface-block-detect.js 참조). 세 레이아웃의 중앙이 같은 K3 서명을 공유하므로
 * 패밀리·n 판별은 2차 앵커(원거리 블록 B · 코너/엣지)의 존재/부재가 맡는다.
 *
 * v2r2 의 정본은 이제 두 파일에 걸친다: 중앙 블록 A = cellsurface-v1r2-editor.json 의
 * NW 5×5(v1r2 와 **동일 배열을 공유**한다 — 전사 사본이 아니라 같은 상수) ·
 * 블록 B = cellsurface-v2r2-editor.json 의 (4..10)² 49셀 (n=11 편집 캔버스).
 * **n 종속이 아니다**: 블록 A 는 (0..4)² 원점 고정, 블록 B 는 (n−7..n−1)² 먼 꼭짓점
 * 고정 — n=11 에서 (4..10)² 였던 블록 B 를 (n−11) 만큼 평행이동해 일반 n 에
 * 인스턴스화한다. n=13 은 autoplace REF_QUADRANT 거부(블록이 사분면을 잠식) —
 * 그래서 v0 가 있다.
 *
 * reference(12) · format(**18**) 는 **autoplaceY.placeReservedCells 로만 유도**한다 —
 * 손 좌표표 금지(c0e7321 계약: 편집기·인코더·디코더가 같은 함수를 쓴다).
 *
 * **포맷 v2 일괄 전환 (2026-08-16, 운영자 승인 개정)**: 마스크 선택 index 2bit 를
 * 실으려고 포맷이 6 digit 이 됐다(`formatinfo.js` 헤더 «포맷 v2»). 이 모듈의 네
 * 레이아웃(v0 · v0x · v1r2 · v2r2)은 **전부** v2 다 — 포맷 셀 15 → 18, 데이터 셀 −3,
 * payload −1 B. 초안·소각 와이어(cellSurfaceLayouts.js v1r2d · v2)와 레거시 Y 는 v1
 * 그대로다. 구 디코더는 포맷 셀 좌표 자체가 달라져 CRC 에서 떨어진다(깨끗한 거부).
 *
 * formatIndex 는 «신세대 셀 표면» **한 쌍만** 쓴다 — 2톤 1 · 3톤 3 (3T = 2T + 2,
 * ADR 0006 D3-5 쌍 불변식). 레이아웃은 와이어가 아니라 **n 으로 정해진다** — 디코더는
 * 기하에서 n 을 이미 알므로 format 읽기 전에 레이아웃이 확정된다(부트스트랩 순환 없음).
 * tri 축 A0(1)·A0Q(3) 과 숫자가 겹치지만 cube 축(finder=null)이라 분리된다
 * (Y0=0 vs hex V1=0 전례, ADR 0006 D3-1).
 *
 * 구 v1 CS(12/14)·v1r2(4/6)·v2(5/7) 초안은 **배포된 와이어 의미**라 슬롯을 소각 기록으로
 * 남긴다(모듈 로드 시점 충돌 검증의 대조군) — 이 모듈은 그 슬롯을 재사용하지 않는다.
 *
 * **v0X (2026-08-16 추가)** — QR 파인더 문법을 차용한 v0 확장. 코드 안의 id 는
 * 소문자 `'v0x'` 다 (형제 id v0/v1r2/v2r2 · 프로파일 문자열 `cell-surface-v0x` 와
 * 같은 표기 규약). 운영자 정본의 표시 이름은 `v0X` 이며 UI 라벨·문서는 그쪽을 쓴다 —
 * `nameCellSurfaceFinal` 은 어느 쪽이든 `Y1-CS-V0X` 를 낸다.
 * 이 레이아웃은 **최종 라인업에서 처음으로 mid(tone 1) 면을 갖는다** — 편집기 정본
 * `toneOverrides` 는 `tone !== DEFAULT_TONE(=1)` 인 항목만 실으므로(cell-editor-core.js
 * §serializeUniversalEditor), 도색 셀에서 빠진 면은 «미지» 가 아니라 **mid 확정**이다.
 * 그래서 buildLocatorCells 의 톤 가드는 v0X 에 한해 0/1/2 를 받는다 (v0·v1r2·v2r2 는
 * 여전히 0/2 만 — 로드 시점 자기검증 ④ 가 강제한다).
 *
 * 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).
 */

import { maxBytesForSymbols } from './capacity.js';
import { symbolCountForByteLength } from './base211.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { VERSIONS_Y } from './capacityY.js';
import {
  CELL_SURFACE_FORMAT_INDEX_2T as LEGACY_CS_INDEX_2T,
  CELL_SURFACE_FORMAT_INDEX_3T as LEGACY_CS_INDEX_3T,
} from './cellSurfaceY.js';
import {
  CELL_SURFACE_LAYOUT_FORMAT_INDEX as DRAFT_LAYOUT_FORMAT_INDEX,
  CELL_SURFACE_LAYOUT_IDS as DRAFT_LAYOUT_IDS,
} from './cellSurfaceLayouts.js';
import {
  placeReservedCells, FORMAT_BLOCK_LENGTH_V1, FORMAT_BLOCK_LENGTH_V2,
} from './autoplaceY.js';
import { FORMAT_CELLS_V2 } from './formatinfo.js';

/**
 * 이 라인업이 **생성**하는 포맷 세대. 신세대 셀 표면은 전부 v2(6 digit · 18셀).
 * autoplace 에 넘기는 유일한 스위치다 — 손 좌표표 금지 계약은 그대로다.
 */
export const CELL_SURFACE_FINAL_FORMAT_BLOCK_LENGTH = FORMAT_BLOCK_LENGTH_V2;

/** 이 라인업의 포맷 셀 수 (3복제 × 6). */
export const CELL_SURFACE_FINAL_FORMAT_CELLS = FORMAT_CELLS_V2;

/** 현행(생성) 포맷 와이어 세대. */
export const CELL_SURFACE_FINAL_FORMAT_WIRE = 2;

/** 레거시(판독 전용) 포맷 와이어 세대 — 개정 전에 발행된 프레임. */
export const CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY = 1;

/**
 * 디코더가 시도하는 세대 순서 — **v2 우선, v1 폴백**.
 *
 * ── 왜 두 세대를 다 읽나 (2026-08-16 통합자 결정 A) ─────────────────────────
 * 포맷 v2 는 포맷 셀을 15 → 18 로 늘리므로 **데이터 셀 좌표까지** 달라진다. 세대
 * 비트는 와이어에 없고(§7.2) 레이아웃이 세대를 정하는 구조라, 개정 전에 발행된
 * v0 · v0x · v1r2 · v2r2 프레임은 신 디코더에서 영구히 안 읽히게 된다(적대 검증 F3).
 * 두 세대의 예약 셀 위치는 **같은 autoplace 함수의 세대 파라미터**로 계산되므로
 * (손 좌표표 없음) 디코더가 v2 로 먼저 읽고, 포맷 CRC 후보가 **전멸**했을 때만
 * v1(15셀 · 데이터 마스크 index 0 고정)로 한 번 더 읽는다.
 *
 * 오독 방어는 «순서» 가 아니라 **CRC + 버전 필드 + 본문 RS** 3중이다 — 폴백은
 * v2 후보가 0개일 때만 돌고, v1 워드에는 마스크 필드가 없으므로 index 는 0 으로
 * 고정된다. 실측(§r2 오독 스윕)이 이 계약을 회귀로 고정한다.
 */
export const CELL_SURFACE_FINAL_FORMAT_WIRES = Object.freeze([
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
]);

/** 세대 → autoplace 복제 길이. 다른 값은 없다. */
export function formatBlockLengthForWire(formatWire) {
  if (formatWire === CELL_SURFACE_FINAL_FORMAT_WIRE) return FORMAT_BLOCK_LENGTH_V2;
  if (formatWire === CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY) return FORMAT_BLOCK_LENGTH_V1;
  throw new RangeError('포맷 와이어 세대는 2(현행) 또는 1(레거시): ' + formatWire);
}

export const CELL_SURFACE_FINAL_V0 = 'v0';
export const CELL_SURFACE_FINAL_V2R2 = 'v2r2';
export const CELL_SURFACE_FINAL_V1R2 = 'v1r2';
/** 표시 이름은 «v0X» — id 는 형제와 같은 소문자 표기다 (모듈 헤더 참조). */
export const CELL_SURFACE_FINAL_V0X = 'v0x';
export const CELL_SURFACE_FINAL_IDS = Object.freeze([
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V2R2,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V0X,
]);

export const CELL_SURFACE_FINAL_PROFILE = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: 'cell-surface-v0',
  [CELL_SURFACE_FINAL_V2R2]: 'cell-surface-v2r2',
  [CELL_SURFACE_FINAL_V1R2]: 'cell-surface-v1r2',
  [CELL_SURFACE_FINAL_V0X]: 'cell-surface-v0x',
});

/** 신세대 셀 표면 formatIndex — 한 쌍뿐. 세 레이아웃이 같이 쓴다(신설 금지). */
export const CELL_SURFACE_FINAL_FORMAT_INDEX = Object.freeze({ 2: 1, 3: 3 });

/** 레이아웃별 허용 n. v2r2·v1r2 는 n=13 을 autoplace 가 거부한다(REF_QUADRANT). */
export const CELL_SURFACE_FINAL_NS = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: Object.freeze([13]),
  [CELL_SURFACE_FINAL_V2R2]: Object.freeze([21, 25]),
  [CELL_SURFACE_FINAL_V1R2]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0X]: Object.freeze([21]),
});

/**
 * n → 그 n 의 **기본** 레이아웃 id. 라인업 밖 n 은 null.
 * n=21 은 후보가 셋(v2r2·v1r2·v0x)이며 기본은 v2r2 — 기존 경로의 동작을 바꾸지 않는다.
 */
export function finalLayoutIdForN(n) {
  if (n === 13) return CELL_SURFACE_FINAL_V0;
  if (n === 21 || n === 25) return CELL_SURFACE_FINAL_V2R2;
  return null;
}

/**
 * n → 그 n 에서 실재하는 레이아웃 **후보 전부** (기본이 맨 앞). 라인업 밖 n 은 [].
 * 디코더 CS 평가의 병행 채점 입력이다 — 수용은 기존 게이트가 판정한다.
 */
export function finalLayoutIdsForN(n) {
  const ids = [];
  const preferred = finalLayoutIdForN(n);
  if (preferred === null) return Object.freeze(ids);
  ids.push(preferred);
  for (const id of CELL_SURFACE_FINAL_IDS) {
    if (id !== preferred && CELL_SURFACE_FINAL_NS[id].includes(n)) ids.push(id);
  }
  return Object.freeze(ids);
}

/** n → VERSIONS_Y 논리 버전 (Y0/Y1/Y2). */
export function versionForFinalN(n) {
  if (n === 13) return 0;
  if (n === 21) return 1;
  if (n === 25) return 2;
  throw new RangeError('셀 표면 최종 라인업의 n 은 13 | 21 | 25 다: ' + n);
}

/**
 * 회계 선언값 — n² − painted − 12(reference) − **18**(format v2). 어긋나면 로드 시 throw.
 * v1r2 는 편집기 정본이 counts.data 352 를 적지만 그것은 **편집기 자신의 고정 배치**
 * (format/reference 27 중 18 이 칠한 블록 안) 기준이다. autoplace 계약에서는 30 이
 * 파인더 밖으로 재유도되므로 441 − 80 − 30 = 331 이 맞다.
 *
 * **포맷 v2 전환 전후** (data −3 전파, payload −1 B):
 *   v0@13   112 → 109 · v0x@21 349 → 346 · v1r2@21 334 → 331
 *   v2r2@21 340 → 337 · v2r2@25 524 → 521
 */
const DECLARED_DATA = Object.freeze({
  // 현행 세대 (포맷 v2 · 18셀).
  [CELL_SURFACE_FINAL_FORMAT_WIRE]: Object.freeze({
    [CELL_SURFACE_FINAL_V0]: Object.freeze({ 13: 109 }),
    // 2026-08-16 중앙 개정: painted 65→74 (+9) → data −9셀. 이어서 포맷 v2 −3.
    [CELL_SURFACE_FINAL_V2R2]: Object.freeze({ 21: 337, 25: 521 }),
    [CELL_SURFACE_FINAL_V1R2]: Object.freeze({ 21: 331 }),
    // v0X 는 편집기 정본의 counts.data(349) 가 포맷 v1 기준이었다 — v2 에서 346.
    [CELL_SURFACE_FINAL_V0X]: Object.freeze({ 21: 346 }),
  }),
  // 레거시 세대 (포맷 v1 · 15셀) — **판독 전용**. 개정 전 발행 프레임의 회계다.
  [CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY]: Object.freeze({
    [CELL_SURFACE_FINAL_V0]: Object.freeze({ 13: 112 }),
    [CELL_SURFACE_FINAL_V2R2]: Object.freeze({ 21: 340, 25: 524 }),
    [CELL_SURFACE_FINAL_V1R2]: Object.freeze({ 21: 334 }),
    [CELL_SURFACE_FINAL_V0X]: Object.freeze({ 21: 349 }),
  }),
});

const FACES = Object.freeze(['T', 'L', 'R']);

/**
 * v0 정본 30셀 [i, j, T, L, R] — cellsurface-v0-editor.json (사용자 제공 2026-08-15)
 * 컴팩트 전사. 네 코너 블록: NW 3×3 · NE 2×3 · SW 3×2 · SE 3×3 + 팔 (n=13 고정).
 */
const V0_CELLS = Object.freeze([
  [0, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 2, 2, 2, 2], [0, 10, 2, 2, 2], [0, 11, 0, 2, 0], [0, 12, 0, 0, 0],
  [1, 0, 0, 0, 0], [1, 1, 0, 0, 0], [1, 2, 2, 2, 2], [1, 10, 2, 0, 2], [1, 11, 2, 0, 2], [1, 12, 2, 0, 2],
  [2, 0, 2, 2, 2], [2, 1, 2, 2, 2], [2, 2, 2, 2, 2], [10, 0, 2, 2, 2], [10, 1, 2, 2, 0], [10, 10, 2, 2, 0],
  [10, 11, 2, 2, 0], [10, 12, 2, 2, 0], [11, 0, 0, 0, 2], [11, 1, 2, 2, 0], [11, 10, 2, 2, 0], [11, 11, 0, 0, 2],
  [11, 12, 0, 0, 0], [12, 0, 0, 0, 0], [12, 1, 2, 2, 0], [12, 10, 2, 2, 0], [12, 11, 0, 0, 0], [12, 12, 0, 0, 0],
]);

/** v2r2 기준 캔버스 크기 — 블록 B 평행이동의 원점. */
const V2R2_BASE_N = 11;

/**
 * v2r2 원거리 블록 B 정본 49셀 [i, j, T, L, R] — cellsurface-v2r2-editor.json
 * (사용자 제공 2026-08-15) 의 (4..10)² 부분 컴팩트 전사, n=11 캔버스 좌표.
 * 일반 n 인스턴스화: (i,j) → (i+n−11, j+n−11).
 *
 * 같은 JSON 의 구 블록 A((0..3)² 16셀, 동심 육각 링)는 **소각** — 2026-08-16 운영자
 * 지시로 중앙 블록이 v1r2 NW 5×5 로 교체되면서 전사하지 않는다 (모듈 헤더 참조).
 */
const V2R2_FAR_BASE_CELLS = Object.freeze([
  [4, 4, 2, 2, 2], [4, 5, 2, 2, 2],
  [4, 6, 2, 2, 2], [4, 7, 2, 2, 2], [4, 8, 2, 2, 2], [4, 9, 2, 2, 2], [4, 10, 2, 2, 2], [5, 4, 2, 2, 2],
  [5, 5, 0, 0, 0], [5, 6, 0, 0, 0], [5, 7, 0, 0, 2], [5, 8, 0, 2, 2], [5, 9, 0, 0, 0], [5, 10, 0, 0, 0],
  [6, 4, 2, 2, 2], [6, 5, 0, 0, 0], [6, 6, 2, 0, 0], [6, 7, 2, 0, 2], [6, 8, 2, 2, 2], [6, 9, 2, 2, 2],
  [6, 10, 0, 2, 0], [7, 4, 2, 2, 2], [7, 5, 0, 0, 2], [7, 6, 2, 0, 2], [7, 7, 0, 0, 2], [7, 8, 0, 2, 2],
  [7, 9, 2, 0, 2], [7, 10, 0, 0, 2], [8, 4, 2, 2, 2], [8, 5, 0, 2, 2], [8, 6, 2, 2, 2], [8, 7, 0, 2, 2],
  [8, 8, 0, 2, 0], [8, 9, 2, 2, 0], [8, 10, 0, 2, 0], [9, 4, 2, 2, 2], [9, 5, 0, 0, 0], [9, 6, 2, 2, 2],
  [9, 7, 2, 0, 2], [9, 8, 2, 2, 0], [9, 9, 2, 0, 0], [9, 10, 0, 0, 0], [10, 4, 2, 2, 2], [10, 5, 0, 0, 0],
  [10, 6, 0, 2, 0], [10, 7, 0, 0, 2], [10, 8, 0, 2, 0], [10, 9, 0, 0, 0], [10, 10, 0, 0, 0],
]);

/**
 * v1r2 정본 80셀 [i, j, T, L, R] — cellsurface-v1r2-editor.json (사용자 제공 2026-08-15)
 * 컴팩트 전사, n=21 고정. 파인더 점유 = **toneOverrides 가 닿는 (i,j) 전체**다
 * (userNonData 62 만 세면 편집기 고정 배치 위에 칠한 18 셀이 빠진다 — c0e7321 계약).
 * 네 코너 블록: NW 5×5(25) · SE 5×5(25) · NE 계단(15) · SW 계단(15) — 코너별 비대칭.
 * NW 는 세 면의 원점이 모여 렌더 **중심**이 되고, SE 는 면별 먼 꼭짓점이다.
 */
const V1R2_CELLS = Object.freeze([
  [0, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 2, 2, 2, 2], [0, 3, 0, 0, 0], [0, 4, 2, 2, 2], [0, 16, 2, 2, 2],
  [0, 17, 0, 0, 0], [0, 18, 0, 0, 0], [0, 19, 0, 0, 0], [0, 20, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 0, 0, 0],
  [1, 2, 2, 2, 2], [1, 3, 0, 0, 2], [1, 4, 2, 2, 2], [1, 16, 2, 2, 2], [1, 17, 2, 2, 2], [1, 18, 2, 2, 2],
  [1, 19, 2, 2, 2], [1, 20, 0, 0, 0], [2, 0, 2, 2, 2], [2, 1, 2, 2, 2], [2, 2, 2, 2, 2], [2, 3, 0, 0, 2],
  [2, 4, 2, 2, 2], [2, 18, 2, 2, 2], [2, 19, 2, 2, 2], [2, 20, 0, 0, 0], [3, 0, 0, 0, 0], [3, 1, 2, 0, 0],
  [3, 2, 2, 0, 0], [3, 3, 0, 0, 0], [3, 4, 2, 2, 2], [3, 19, 2, 2, 2], [3, 20, 2, 2, 2], [4, 0, 2, 2, 2],
  [4, 1, 2, 2, 2], [4, 2, 2, 2, 2], [4, 3, 2, 2, 2], [4, 4, 2, 2, 2], [16, 0, 2, 2, 2], [16, 1, 2, 2, 2],
  [16, 16, 2, 0, 0], [16, 17, 2, 0, 0], [16, 18, 2, 0, 0], [16, 19, 2, 0, 0], [16, 20, 2, 0, 0], [17, 0, 0, 0, 0],
  [17, 1, 2, 2, 2], [17, 16, 2, 0, 0], [17, 17, 0, 2, 2], [17, 18, 0, 2, 2], [17, 19, 2, 2, 2], [17, 20, 0, 2, 2],
  [18, 0, 0, 0, 0], [18, 1, 2, 2, 2], [18, 2, 2, 2, 2], [18, 16, 2, 0, 0], [18, 17, 0, 2, 2], [18, 18, 0, 0, 0],
  [18, 19, 2, 2, 2], [18, 20, 0, 0, 0], [19, 0, 0, 0, 0], [19, 1, 2, 2, 2], [19, 2, 2, 2, 2], [19, 3, 2, 2, 2],
  [19, 16, 2, 0, 0], [19, 17, 2, 2, 2], [19, 18, 2, 2, 2], [19, 19, 2, 2, 2], [19, 20, 0, 0, 0], [20, 0, 0, 0, 0],
  [20, 1, 0, 0, 0], [20, 2, 0, 0, 0], [20, 3, 2, 2, 2], [20, 16, 2, 0, 0], [20, 17, 0, 2, 2], [20, 18, 0, 0, 0],
  [20, 19, 0, 0, 0], [20, 20, 0, 0, 0],
]);

/**
 * v0X 정본 65셀 [i, j, T, L, R] — cellsurface-v0x-editor.json (운영자 제공 2026-08-16)
 * 컴팩트 전사, n=21 고정. 정본 painted 는 **toneOverrides 가 닿는 (i,j) 전체**다
 * (userNonData 62 + 레거시 고정 위치 위 도색 3: (0,3)·(14,20)·(19,19)).
 * 빠진 면은 **mid(1)** 로 채운다 — 편집기가 DEFAULT_TONE 을 직렬화에서 생략하기 때문
 * (모듈 헤더 참조). 그래서 v0X 에만 mid 면이 4개 있다:
 * (0,3).L · (14,20).L · (14,20).R · (19,19).R.
 *
 * 구조 (정본 실측, `_v0x-probe.mjs` 유도):
 *   · NW (0..3)² 16셀 — v1r2 NW 5×5 의 (0..3)² 부분과 셀·톤이 같다((0,3).L 만 mid).
 *     즉 v0·v1r2·v2r2 가 공유하는 **K3 불스아이 중앙과 같은 계보**다.
 *   · SE (15..20)² 36셀 — QR 동심 사각. **3면 동일 톤 35/36** ((19,19).R 만 mid):
 *     암 테두리(15·20) → 명 링(16..19) → 암 2×2 코어(17..18)². 중앙 라인 런
 *     1:1:2:1:1 = K5 회문 → 기존 코어 스캐너 재사용 대상.
 *   · NE (0..1)×(18..20) 6셀 · SW (18..20)×(0..1) 6셀 — 소형 마커(서브앵커).
 *   · (14,20) 1셀 — 분류 밖 단독 «단면 점» (T=2 · L=R=mid).
 */
const V0X_CELLS = Object.freeze([
  [0, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 2, 2, 2, 2], [0, 3, 0, 1, 0], [0, 18, 2, 2, 2],
  [0, 19, 0, 2, 0], [0, 20, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 0, 0, 0], [1, 2, 2, 2, 2],
  [1, 3, 0, 0, 2], [1, 18, 2, 0, 2], [1, 19, 2, 0, 2], [1, 20, 2, 0, 2], [2, 0, 2, 2, 2],
  [2, 1, 2, 2, 2], [2, 2, 2, 2, 2], [2, 3, 0, 0, 2], [3, 0, 0, 0, 0], [3, 1, 2, 0, 0],
  [3, 2, 2, 0, 0], [3, 3, 0, 0, 0], [14, 20, 2, 1, 1], [15, 15, 0, 0, 0], [15, 16, 0, 0, 0],
  [15, 17, 0, 0, 0], [15, 18, 0, 0, 0], [15, 19, 0, 0, 0], [15, 20, 0, 0, 0], [16, 15, 0, 0, 0],
  [16, 16, 2, 2, 2], [16, 17, 2, 2, 2], [16, 18, 2, 2, 2], [16, 19, 2, 2, 2], [16, 20, 0, 0, 0],
  [17, 15, 0, 0, 0], [17, 16, 2, 2, 2], [17, 17, 0, 0, 0], [17, 18, 0, 0, 0], [17, 19, 2, 2, 2],
  [17, 20, 0, 0, 0], [18, 0, 2, 2, 2], [18, 1, 2, 2, 0], [18, 15, 0, 0, 0], [18, 16, 2, 2, 2],
  [18, 17, 0, 0, 0], [18, 18, 0, 0, 0], [18, 19, 2, 2, 2], [18, 20, 0, 0, 0], [19, 0, 0, 0, 2],
  [19, 1, 2, 2, 0], [19, 15, 0, 0, 0], [19, 16, 2, 2, 2], [19, 17, 2, 2, 2], [19, 18, 2, 2, 2],
  [19, 19, 2, 2, 1], [19, 20, 0, 0, 0], [20, 0, 0, 0, 0], [20, 1, 2, 2, 0], [20, 15, 0, 0, 0],
  [20, 16, 0, 0, 0], [20, 17, 0, 0, 0], [20, 18, 0, 0, 0], [20, 19, 0, 0, 0], [20, 20, 0, 0, 0],
]);

/**
 * v0X 블록 범위 — 로케이터 패치·검출기가 같은 정의를 쓴다.
 * SINGLE 은 (14,20) 단독 셀이라 블록이 아니다 (패치로 쓸 수 없다 — Pearson 최소 6점).
 */
export const V0X_BLOCKS = Object.freeze({
  NW: Object.freeze({ iMax: 3, jMax: 3 }),
  NE: Object.freeze({ iMax: 1, jMin: 18 }),
  SW: Object.freeze({ iMin: 18, jMax: 1 }),
  SE: Object.freeze({ iMin: 15, jMin: 15 }),
  SINGLE: Object.freeze({ i: 14, j: 20 }),
});

/** v1r2 네 코너 블록의 셀 범위 — 로케이터 패치·검출기가 같은 정의를 쓴다. */
export const V1R2_BLOCKS = Object.freeze({
  NW: Object.freeze({ iMax: 4, jMax: 4 }),
  NE: Object.freeze({ iMax: 3, jMin: 16 }),
  SW: Object.freeze({ iMin: 16, jMax: 3 }),
  SE: Object.freeze({ iMin: 16, jMin: 16 }),
});

/**
 * v2r2 중앙 블록 A = **v1r2 NW 5×5 와 같은 정본 공유** (2026-08-16 in-place 개정).
 * 전사 사본이 아니라 V1R2_CELLS 에서 필터로 유도한다 — 두 레이아웃의 중앙이
 * 문자 그대로 같은 배열에서 나오므로 어긋날 수 없다 (v0/v1r2/v2r2 K3 중앙 통일).
 */
const V2R2_CENTER_CELLS = Object.freeze(V1R2_CELLS.filter(
  ([i, j]) => i <= V1R2_BLOCKS.NW.iMax && j <= V1R2_BLOCKS.NW.jMax,
));

function cellKey(i, j) {
  return i + ',' + j;
}

export function assertCellSurfaceFinalId(id) {
  if (!CELL_SURFACE_FINAL_IDS.includes(id)) {
    throw new RangeError(
      '셀 표면 최종 레이아웃은 ' + CELL_SURFACE_FINAL_IDS.join(' | ') + ' 여야 한다: ' + id,
    );
  }
  return id;
}

export function assertCellSurfaceFinalTones(tones) {
  if (tones !== 2 && tones !== 3) {
    throw new RangeError('셀 표면 최종 라인업 tones 는 2 또는 3 이어야 한다: ' + tones);
  }
  return tones;
}

export function isCellSurfaceFinalId(id) {
  return CELL_SURFACE_FINAL_IDS.includes(id);
}

export function formatIndexCellSurfaceFinal(tones) {
  return CELL_SURFACE_FINAL_FORMAT_INDEX[assertCellSurfaceFinalTones(tones)];
}

export function isCellSurfaceFinalFormatIndex(index) {
  return index === CELL_SURFACE_FINAL_FORMAT_INDEX[2]
    || index === CELL_SURFACE_FINAL_FORMAT_INDEX[3];
}

export function tonesFromCellSurfaceFinalFormatIndex(index) {
  if (index === CELL_SURFACE_FINAL_FORMAT_INDEX[2]) return 2;
  if (index === CELL_SURFACE_FINAL_FORMAT_INDEX[3]) return 3;
  throw new RangeError(
    '신세대 셀 표면 formatIndex 는 ' + CELL_SURFACE_FINAL_FORMAT_INDEX[2]
    + ' 또는 ' + CELL_SURFACE_FINAL_FORMAT_INDEX[3] + ' 이어야 한다: ' + index,
  );
}

/** 최종 라인업이 지원하는 n 인지. */
export function isCellSurfaceFinalN(n) {
  return finalLayoutIdForN(n) !== null;
}

/** id + n 정합 검사 — v0 는 13 만, v2r2 는 21|25 만. */
export function assertCellSurfaceFinalN(id, n) {
  assertCellSurfaceFinalId(id);
  if (!CELL_SURFACE_FINAL_NS[id].includes(n)) {
    throw new RangeError(
      '셀 표면 ' + id + ' 는 n=' + CELL_SURFACE_FINAL_NS[id].join('|') + ' 전용이다: n=' + n,
    );
  }
  return n;
}

/** v2r2 파인더 74셀을 일반 n 좌표로 인스턴스화 (A 원점 고정 · B 먼 꼭짓점 고정). */
function v2r2CellsForN(n) {
  const shift = n - V2R2_BASE_N;
  const far = V2R2_FAR_BASE_CELLS.map(([i, j, T, L, R]) => {
    if (i < 4 || j < 4) {
      throw new Error('v2r2 원거리 정본 셀 (' + i + ',' + j + ') 이 블록 B 밖이다');
    }
    return [i + shift, j + shift, T, L, R];
  });
  // 중앙 A(0..4)² 와 이동한 B(n−7..n−1)² 는 n ≥ 12 에서 분리된다 — 겹침은
  // buildLocatorCells 의 좌표 중복 검사가 로드 시 throw 로 잡는다.
  return [...V2R2_CENTER_CELLS, ...far];
}

/**
 * mid(1) 면을 허용하는 레이아웃 — v0X 뿐이다. 나머지는 0/2 만 받는다(정의 불변).
 * 편집기 정본이 DEFAULT_TONE 을 직렬화에서 생략하므로 mid 는 «미지» 가 아니라 확정값이다.
 */
const MID_TONE_LAYOUTS = Object.freeze([CELL_SURFACE_FINAL_V0X]);

function buildLocatorCells(rows, allowMid = false) {
  const seen = new Set();
  const cells = rows.map(([i, j, T, L, R]) => {
    const key = cellKey(i, j);
    if (seen.has(key)) throw new Error('locator 좌표 중복: ' + key);
    seen.add(key);
    for (const tone of [T, L, R]) {
      if (tone === 1) {
        if (allowMid) continue;
        throw new Error('locator 톤이 0/2 가 아니다: ' + key);
      }
      if (tone !== 0 && tone !== 2) {
        throw new Error('locator 톤이 0/1/2 가 아니다: ' + key);
      }
    }
    return Object.freeze({ i, j, T, L, R });
  });
  cells.sort((a, b) => a.i - b.i || a.j - b.j);
  return Object.freeze(cells);
}

function nsymTable(symbols) {
  const L = Math.round(0.12 * symbols);
  let M = Math.round(0.25 * symbols);
  if (M % 2 === 0) M += 1;
  const H = Math.round(0.40 * symbols);
  return Object.freeze({ symbols, L, M, H });
}

/**
 * 심볼 예산으로 **실제 패킹 가능한** 최대 바이트.
 *
 * `capacity.maxBytesForSymbols` 는 211^S 를 통째로 보고 floor(S·log2 211 / 8) 을 낸다.
 * 그런데 실제 인코더(`base211.bytesToSymbols`)는 **27B ↔ 28심볼 청크**로 나눠 담으므로
 * 꼬리 청크에서 손실이 나 어떤 S 에서는 그 값이 1 B 과대 선언이 된다(S=1..400 중 64개).
 * 그런 조합은 `decode.finishProfile` 이 «이 포맷은 현행 인코더가 생성할 수 없다» 로
 * 이미 거부하고 있었다 — 즉 **선언이 틀린 것이지 게이트가 느슨한 것이 아니다.**
 *
 * 포맷 v2 전환으로 v0X@21 의 S 가 116 → 115 가 되면서 ECC-M 의 dataSymbols 가
 * 하필 그 86 에 떨어졌다(dataBytes 83 을 선언하는데 인코더는 87심볼을 요구). 여기서
 * 청크 정합 값으로 **낮춰** 선언한다 — 절대 올리지 않으므로 어떤 게이트도 완화하지 않고,
 * 나머지 14개 (레이아웃 × 레벨) 조합의 값은 개정 전과 **바이트 동일**하다.
 */
function packableBytesForSymbols(dataSymbols) {
  let bytes = maxBytesForSymbols(dataSymbols);
  while (bytes > 0 && symbolCountForByteLength(bytes) > dataSymbols) bytes -= 1;
  return bytes;
}

function canonicalRowsFor(id, n) {
  if (id === CELL_SURFACE_FINAL_V0) return V0_CELLS;
  if (id === CELL_SURFACE_FINAL_V1R2) return V1R2_CELLS;
  if (id === CELL_SURFACE_FINAL_V0X) return V0X_CELLS;
  return v2r2CellsForN(n);
}

function buildFinalSurface(id, n, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE) {
  assertCellSurfaceFinalN(id, n);
  const blockLength = formatBlockLengthForWire(formatWire);
  const rows = canonicalRowsFor(id, n);
  const locatorCells = buildLocatorCells(rows, MID_TONE_LAYOUTS.includes(id));
  const painted = locatorCells.map((cell) => ({ i: cell.i, j: cell.j }));

  // format 18(v2) | 15(v1 레거시 판독) · reference 12 는 autoplace 유도 —
  // 손 좌표표 금지 (c0e7321 계약). 세대는 blockLength 하나로만 갈린다.
  const placed = placeReservedCells(n, painted, { formatBlockLength: blockLength });
  const format = placed.formatCells;
  const reference = placed.referenceCells;
  if (format.length !== blockLength * 3) {
    throw new Error(
      id + '@n=' + n + ': format 셀이 ' + (blockLength * 3)
      + ' 가 아니다: ' + format.length,
    );
  }

  const locatorKeys = new Set(painted.map((cell) => cellKey(cell.i, cell.j)));
  for (const cell of [...format, ...reference]) {
    if (locatorKeys.has(cellKey(cell.i, cell.j))) {
      throw new Error(id + '@n=' + n + ': autoplace 산출이 파인더와 겹친다: ' + cellKey(cell.i, cell.j));
    }
  }

  const declared = DECLARED_DATA[formatWire][id][n];
  const dataCells = n * n - locatorCells.length - reference.length - format.length;
  if (dataCells !== declared) {
    throw new Error(
      id + '@n=' + n + ': ' + n + '² − painted(' + locatorCells.length + ') − '
      + reference.length + ' − ' + format.length + ' = '
      + dataCells + ' 이 선언 data ' + declared + ' 와 다르다',
    );
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  return Object.freeze({
    id,
    profile: CELL_SURFACE_FINAL_PROFILE[id],
    n,
    version: versionForFinalN(n),
    locatorCells,
    locatorCount: locatorCells.length,
    paintedCells: Object.freeze(painted.map((cell) => Object.freeze({ i: cell.i, j: cell.j }))),
    formatCells: format,
    referenceCells: reference,
    referenceGroups: placed.referenceGroups,
    autoplace: placed.metrics,
    declaredDataCells: declared,
    usedSymbols,
    residualCells,
    nsym: nsymTable(usedSymbols),
    formatIndex: CELL_SURFACE_FINAL_FORMAT_INDEX,
    formatWire,
  });
}

function surfaceKey(id, n) {
  return id + '@' + n;
}

const SURFACES = Object.freeze(Object.fromEntries(
  CELL_SURFACE_FINAL_IDS.flatMap((id) =>
    CELL_SURFACE_FINAL_NS[id].map((n) => [surfaceKey(id, n), buildFinalSurface(id, n)])),
));

/**
 * 레거시(포맷 v1 · 15셀) 세대 캐시 — **판독 전용**. 생성 경로는 절대 여기를 안 본다.
 * autoplace 를 세대 파라미터만 바꿔 다시 돌린 것이라 개정 전 좌표와 바이트 동일하다
 * (테스트가 §3.1 v1 좌표표로 단언).
 */
const SURFACES_LEGACY = Object.freeze(Object.fromEntries(
  CELL_SURFACE_FINAL_IDS.flatMap((id) =>
    CELL_SURFACE_FINAL_NS[id].map((n) => [
      surfaceKey(id, n),
      buildFinalSurface(id, n, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY),
    ])),
));

function surfaceCacheForWire(formatWire) {
  if (formatWire === CELL_SURFACE_FINAL_FORMAT_WIRE) return SURFACES;
  if (formatWire === CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY) return SURFACES_LEGACY;
  throw new RangeError('포맷 와이어 세대는 2(현행) 또는 1(레거시): ' + formatWire);
}

/**
 * (n, id) → 최종 셀 표면 인스턴스 (동결 캐시 — autoplace 는 로드 시 1회).
 * id 를 생략하면 그 n 의 **기본** 레이아웃 (13→v0 · 21|25→v2r2).
 * `formatWire` 를 생략하면 현행 세대(2) — 생성 경로는 이 기본값만 쓴다.
 * 1 을 주면 레거시 판독 세대(포맷 v1 · 15셀)를 돌려준다.
 */
export function cellSurfaceFinal(
  n, id = finalLayoutIdForN(n), formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  const cache = surfaceCacheForWire(formatWire);
  const surface = id === null ? undefined : cache[surfaceKey(id, n)];
  if (!surface) {
    throw new RangeError(
      '셀 표면 최종 라인업에 없는 (레이아웃, n) 이다: ' + id + '@' + n,
    );
  }
  return surface;
}

export function nameCellSurfaceFinal(n, tones, id = undefined) {
  const surface = cellSurfaceFinal(n, id === undefined ? finalLayoutIdForN(n) : id);
  const suffix = assertCellSurfaceFinalTones(tones) === 3 ? 'T' : '';
  return 'Y' + surface.version + suffix + '-CS-' + surface.id.toUpperCase();
}

export function locatorCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? finalLayoutIdForN(n) : id).locatorCells;
}

export function paintedCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? finalLayoutIdForN(n) : id).paintedCells;
}

/**
 * 포맷 셀 좌표. `formatWire` 1 을 주면 레거시(15셀) 좌표 — 디코더 폴백 전용이다.
 */
export function formatCellsCellSurfaceFinal(
  n, id = undefined, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  return cellSurfaceFinal(
    n, id === undefined ? finalLayoutIdForN(n) : id, formatWire,
  ).formatCells;
}

export function referenceCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? finalLayoutIdForN(n) : id).referenceCells;
}

export function locatorToneCellSurfaceFinal(n, face, i, j, id = undefined) {
  if (!FACES.includes(face)) throw new RangeError('면 라벨은 T | L | R 이어야 한다: ' + face);
  const surface = cellSurfaceFinal(n, id === undefined ? finalLayoutIdForN(n) : id);
  for (const cell of surface.locatorCells) {
    if (cell.i === i && cell.j === j) return cell[face];
  }
  return 1;
}

export function dataCellsInScanOrderCellSurfaceFinal(
  n, id = undefined, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  const surface = cellSurfaceFinal(
    n, id === undefined ? finalLayoutIdForN(n) : id, formatWire,
  );
  const blocked = new Set([
    ...surface.locatorCells.map((cell) => cellKey(cell.i, cell.j)),
    ...surface.formatCells.map((cell) => cellKey(cell.i, cell.j)),
    ...surface.referenceCells.map((cell) => cellKey(cell.i, cell.j)),
  ]);
  const out = [];
  for (let j = 0; j < surface.n; j += 1) {
    for (let i = 0; i < surface.n; i += 1) {
      if (!blocked.has(cellKey(i, j))) out.push({ i, j });
    }
  }
  if (out.length !== surface.declaredDataCells) {
    throw new Error(
      surface.id + '@n=' + n + ': scan data ' + out.length
      + ' !== 선언 ' + surface.declaredDataCells,
    );
  }
  return out;
}

export function fillerCellsCellSurfaceFinal(
  n, id = undefined, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, id, formatWire);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

export function layoutMapCellSurfaceFinal(
  n, id = undefined, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  const surface = cellSurfaceFinal(
    n, id === undefined ? finalLayoutIdForN(n) : id, formatWire,
  );
  const map = new Map();
  surface.locatorCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'locator', index });
  });
  surface.referenceCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'reference', index });
  });
  surface.formatCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'format', index });
  });
  dataCellsInScanOrderCellSurfaceFinal(n, surface.id, formatWire).forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'data', index });
  });
  return map;
}

function nsymForLevel(surface, level) {
  const nsym = surface.nsym[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(surface.id + '@n=' + surface.n + ' 에 없는 ECC 레벨: ' + level);
  }
  return nsym;
}

export function capacityForCellSurfaceFinal(
  n, level = 'M', tones = 2, id = undefined,
  formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  const surface = cellSurfaceFinal(
    n, id === undefined ? finalLayoutIdForN(n) : id, formatWire,
  );
  const resolvedTones = assertCellSurfaceFinalTones(tones);
  const nsym = nsymForLevel(surface, level);
  const dataSymbols = surface.usedSymbols - nsym;
  const dataBytes = packableBytesForSymbols(dataSymbols);
  return {
    name: nameCellSurfaceFinal(n, resolvedTones, surface.id),
    version: surface.version,
    n: surface.n,
    tones: resolvedTones,
    formatIndex: CELL_SURFACE_FINAL_FORMAT_INDEX[resolvedTones],
    cellSurface: true,
    cellSurfaceLayout: surface.id,
    locatorProfile: surface.profile,
    totalCells: surface.n * surface.n,
    overhead: surface.locatorCount + surface.formatCells.length + surface.referenceCells.length,
    locator: surface.locatorCount,
    format: surface.formatCells.length,
    reference: surface.referenceCells.length,
    dataCells: surface.declaredDataCells,
    usedSymbols: surface.usedSymbols,
    residualCells: surface.residualCells,
    level,
    nsym,
    errorCapacity: errorCapacity(nsym),
    dataSymbols,
    dataBytes,
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
    formatWire: surface.formatWire,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 — 조용히 시프트하지 않는다.
// ─────────────────────────────────────────────────────────────────────────
{
  // ① 정본 셀 수 — v0 30 · v2r2 74 (중앙 A 25 = v1r2 NW 공유 + B 49) · v1r2 80 (25/15/15/25).
  if (V0_CELLS.length !== 30) throw new Error('v0 정본이 30셀이 아니다: ' + V0_CELLS.length);
  if (V2R2_CENTER_CELLS.length !== 25) {
    throw new Error('v2r2 중앙 블록(v1r2 NW 공유)이 25셀이 아니다: ' + V2R2_CENTER_CELLS.length);
  }
  if (V2R2_FAR_BASE_CELLS.length !== 49) {
    throw new Error('v2r2 원거리 정본이 49셀이 아니다: ' + V2R2_FAR_BASE_CELLS.length);
  }
  {
    // 중앙 개정(2026-08-16) 불변식 — v2r2 중앙은 v1r2 NW 5×5 와 **셀·톤이 전부 동일**해야
    // 한다 (필터 유도라 구조적으로 같지만, 정본 배열이 조용히 시프트하면 여기서 잡는다).
    const nwKeys = new Set(V1R2_CELLS
      .filter(([i, j]) => i <= 4 && j <= 4)
      .map(([i, j, T, L, R]) => i + ',' + j + ':' + T + L + R));
    if (nwKeys.size !== 25) throw new Error('v1r2 NW 블록이 25셀이 아니다: ' + nwKeys.size);
    for (const [i, j, T, L, R] of V2R2_CENTER_CELLS) {
      if (!nwKeys.has(i + ',' + j + ':' + T + L + R)) {
        throw new Error('v2r2 중앙 셀 (' + i + ',' + j + ') 이 v1r2 NW 정본과 다르다');
      }
    }
  }
  if (V1R2_CELLS.length !== 80) {
    throw new Error('v1r2 정본이 80셀이 아니다: ' + V1R2_CELLS.length);
  }
  {
    const counts = { NW: 0, NE: 0, SW: 0, SE: 0 };
    for (const [i, j] of V1R2_CELLS) {
      const quadrant = (i <= 4 ? 'N' : 'S') + (j <= 4 ? 'W' : 'E');
      if (!(quadrant in counts)) throw new Error('v1r2 셀이 코너 밖이다: ' + i + ',' + j);
      counts[quadrant] += 1;
    }
    if (counts.NW !== 25 || counts.NE !== 15 || counts.SW !== 15 || counts.SE !== 25) {
      throw new Error(
        'v1r2 코너 분할이 25/15/15/25 가 아니다: '
        + [counts.NW, counts.NE, counts.SW, counts.SE].join('/'),
      );
    }
  }

  // ①-b v0X 정본 — 65셀 · 블록 분할 16/6/6/36 + 단독 1 · mid 면 정확히 4개.
  if (V0X_CELLS.length !== 65) {
    throw new Error('v0X 정본이 65셀이 아니다: ' + V0X_CELLS.length);
  }
  {
    const inBox = (i, j, box) => (box.iMax === undefined || i <= box.iMax)
      && (box.iMin === undefined || i >= box.iMin)
      && (box.jMax === undefined || j <= box.jMax)
      && (box.jMin === undefined || j >= box.jMin);
    const counts = { NW: 0, NE: 0, SW: 0, SE: 0, SINGLE: 0 };
    let midFaces = 0;
    for (const [i, j, T, L, R] of V0X_CELLS) {
      let home = null;
      for (const name of ['NW', 'NE', 'SW', 'SE']) {
        if (inBox(i, j, V0X_BLOCKS[name])) home = name;
      }
      if (home === null && i === V0X_BLOCKS.SINGLE.i && j === V0X_BLOCKS.SINGLE.j) {
        home = 'SINGLE';
      }
      if (home === null) throw new Error('v0X 셀이 어느 블록에도 없다: ' + i + ',' + j);
      counts[home] += 1;
      for (const tone of [T, L, R]) if (tone === 1) midFaces += 1;
    }
    if (counts.NW !== 16 || counts.NE !== 6 || counts.SW !== 6
      || counts.SE !== 36 || counts.SINGLE !== 1) {
      throw new Error(
        'v0X 블록 분할이 16/6/6/36+1 이 아니다: '
        + [counts.NW, counts.NE, counts.SW, counts.SE, counts.SINGLE].join('/'),
      );
    }
    if (midFaces !== 4) throw new Error('v0X mid 면이 4개가 아니다: ' + midFaces);
  }
  {
    // v0X NW (0..3)² 는 v1r2 NW 의 같은 범위와 **셀·톤이 같다** ((0,3).L mid 만 예외).
    // 셋(넷)의 중앙이 같은 K3 서명을 공유한다는 로케이터 전제를 여기서 못 박는다.
    const nw = new Map(V1R2_CELLS
      .filter(([i, j]) => i <= 3 && j <= 3)
      .map(([i, j, T, L, R]) => [i + ',' + j, [T, L, R]]));
    if (nw.size !== 16) throw new Error('v1r2 NW (0..3)² 가 16셀이 아니다: ' + nw.size);
    for (const [i, j, T, L, R] of V0X_CELLS) {
      if (i > 3 || j > 3) continue;
      const want = nw.get(i + ',' + j);
      if (!want) throw new Error('v0X NW 셀 (' + i + ',' + j + ') 이 v1r2 NW 에 없다');
      const faces = [T, L, R];
      for (let index = 0; index < 3; index += 1) {
        if (faces[index] === 1) continue; // mid 는 정본이 v1r2 와 갈라지는 유일한 자리.
        if (faces[index] !== want[index]) {
          throw new Error('v0X NW 셀 (' + i + ',' + j + ') 톤이 v1r2 NW 와 다르다');
        }
      }
    }
  }

  // ② formatIndex 쌍 불변식 + cube 축 기사용 슬롯 전수 대조 (겹치면 로드 시 throw).
  if (CELL_SURFACE_FINAL_FORMAT_INDEX[3] !== CELL_SURFACE_FINAL_FORMAT_INDEX[2] + 2) {
    throw new Error('신세대 셀 표면 3톤 formatIndex 는 2톤 + 2 이어야 한다');
  }
  {
    const used = new Set(VERSIONS_Y.map((spec) => spec.formatIndex));
    used.add(LEGACY_CS_INDEX_2T);
    used.add(LEGACY_CS_INDEX_3T);
    for (const draftId of DRAFT_LAYOUT_IDS) {
      const table = DRAFT_LAYOUT_FORMAT_INDEX[draftId];
      used.add(table[2]);
      used.add(table[3]);
    }
    for (const index of [CELL_SURFACE_FINAL_FORMAT_INDEX[2], CELL_SURFACE_FINAL_FORMAT_INDEX[3]]) {
      if (used.has(index)) {
        throw new Error(
          '신세대 셀 표면 formatIndex ' + index + ' 가 cube 축 기사용 슬롯과 겹친다: '
          + [...used].sort((a, b) => a - b).join(','),
        );
      }
      if (!Number.isInteger(index) || index < 0 || index > 15) {
        throw new Error('formatIndex ' + index + ' 가 4bit 범위를 벗어난다');
      }
    }
  }

  // ④ mid 면은 v0X 전용 — v0·v1r2·v2r2 정의가 조용히 mid 를 얻으면 여기서 throw.
  // (v2r2 중앙은 V1R2_CELLS 필터 유도라 V1R2_CELLS 행이 커버하지만, 명시로도 훑는다.)
  for (const [id, rows] of [
    [CELL_SURFACE_FINAL_V0, V0_CELLS],
    [CELL_SURFACE_FINAL_V1R2, V1R2_CELLS],
    [CELL_SURFACE_FINAL_V2R2, V2R2_FAR_BASE_CELLS],
    [CELL_SURFACE_FINAL_V2R2, V2R2_CENTER_CELLS],
  ]) {
    for (const [i, j, T, L, R] of rows) {
      for (const tone of [T, L, R]) {
        if (tone === 1) throw new Error(id + ' 정본에 mid 면이 생겼다: ' + i + ',' + j);
      }
    }
  }

  // ③ 다섯 인스턴스 회계 — 사용 심볼·잔여 셀이 확정 수치와 일치해야 한다.
  // (v2r2 는 2026-08-16 중앙 개정 수치 — painted 74. 포맷 v2 전환으로 data −3 전파.)
  //   v0@13   169 − 30 − 12 − 18 = 109 · S=36  · 잔여 1  (v1: 112 · 37 · 1)
  //   v2r2@21 441 − 74 − 12 − 18 = 337 · S=112 · 잔여 1  (v1: 340 · 113 · 1)
  //   v2r2@25 625 − 74 − 12 − 18 = 521 · S=173 · 잔여 2  (v1: 524 · 174 · 2)
  //   v1r2@21 441 − 80 − 12 − 18 = 331 · S=110 · 잔여 1  (v1: 334 · 111 · 1)
  //   v0x@21  441 − 65 − 12 − 18 = 346 · S=115 · 잔여 1  (v1: 349 · 116 · 1)
  // 레거시 세대(포맷 v1 · 15셀)는 **판독 전용**이지만 회계는 같은 자로 잰다 —
  // 폴백이 조용히 다른 좌표를 쓰면 여기서 잡는다.
  const expected = {
    'v0@13': { symbols: 36, residual: 1, locator: 30, legacy: { symbols: 37, residual: 1 } },
    'v2r2@21': { symbols: 112, residual: 1, locator: 74, legacy: { symbols: 113, residual: 1 } },
    'v2r2@25': { symbols: 173, residual: 2, locator: 74, legacy: { symbols: 174, residual: 2 } },
    'v1r2@21': { symbols: 110, residual: 1, locator: 80, legacy: { symbols: 111, residual: 1 } },
    'v0x@21': { symbols: 115, residual: 1, locator: 65, legacy: { symbols: 116, residual: 1 } },
  };
  for (const [key, want] of Object.entries(expected)) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    const surface = cellSurfaceFinal(n, id);
    if (surface.locatorCount !== want.locator) {
      throw new Error(key + ' locator ' + surface.locatorCount + ' !== ' + want.locator);
    }
    if (surface.usedSymbols !== want.symbols || surface.residualCells !== want.residual) {
      throw new Error(
        key + ' 회계 불일치: S=' + surface.usedSymbols + '/' + want.symbols
        + ' 잔여=' + surface.residualCells + '/' + want.residual,
      );
    }
    const scan = dataCellsInScanOrderCellSurfaceFinal(n, id);
    if (scan.length !== surface.declaredDataCells) {
      throw new Error(key + ': data 선언과 scan 이 어긋난다');
    }
    const legacy = cellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
    if (legacy.formatCells.length !== 15) {
      throw new Error(key + ' 레거시 포맷 셀이 15 가 아니다: ' + legacy.formatCells.length);
    }
    if (legacy.usedSymbols !== want.legacy.symbols
      || legacy.residualCells !== want.legacy.residual) {
      throw new Error(
        key + ' 레거시 회계 불일치: S=' + legacy.usedSymbols + '/' + want.legacy.symbols
        + ' 잔여=' + legacy.residualCells + '/' + want.legacy.residual,
      );
    }
    // 두 세대는 파인더·reference 가 **같아야** 한다 — 달라지면 폴백이 다른 프레임을 읽는다.
    if (legacy.locatorCount !== surface.locatorCount) {
      throw new Error(key + ': 세대 간 파인더 셀 수가 다르다');
    }
    const refKey = (cells) => cells.map((cell) => cell.i + ',' + cell.j).join(' ');
    if (refKey(legacy.referenceCells) !== refKey(surface.referenceCells)) {
      throw new Error(key + ': 세대 간 reference 좌표가 다르다');
    }
  }
  if (Object.keys(SURFACES).length !== Object.keys(expected).length
    || Object.keys(SURFACES_LEGACY).length !== Object.keys(expected).length) {
    throw new Error('최종 라인업 인스턴스 수가 회계 표와 다르다');
  }

  // ⑤ 인코더 정합 — (레이아웃 × ECC 레벨) 15조합 전부가 실제로 인코딩 가능해야 한다.
  // 선언 dataBytes 를 base-211 청크 패커에 되물어 dataSymbols 와 정확히 맞는지 본다.
  // (포맷 v2 전환에서 v0X@21 ECC-M 이 여기 걸렸고 packableBytesForSymbols 로 고쳤다.)
  // 레거시 세대도 같이 훑는다 — 폴백 복호가 RS 파라미터를 스스로 유도하기 때문이다.
  for (const key of Object.keys(SURFACES)) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    for (const level of ['L', 'M', 'H']) {
      for (const wire of CELL_SURFACE_FINAL_FORMAT_WIRES) {
        const capacity = capacityForCellSurfaceFinal(n, level, 2, id, wire);
        const need = symbolCountForByteLength(capacity.dataBytes);
        if (need !== capacity.dataSymbols) {
          throw new Error(
            key + ' ECC-' + level + ' (포맷 v' + wire + '): dataBytes ' + capacity.dataBytes
            + ' 는 ' + need + ' 심볼을 요구하는데 예산은 ' + capacity.dataSymbols + ' 다',
          );
        }
      }
    }
  }
}
