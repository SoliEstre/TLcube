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
 * **정규화 (정본 2026-08-16 운영자 승인)** — 최초 편입본의 v0X 는 편집기 정본이
 * `tone !== DEFAULT_TONE(=1)` 항목만 직렬화하는 탓에(cell-editor-core.js
 * §serializeUniversalEditor) 항목이 빠진 면 4개가 **mid(1) 확정**으로 유도됐다
 * ((0,3).L · (14,20).L/R · (19,19).R). 운영자가 그 4면을 «도색 다수 톤» 으로 정규화해
 * 정본이 갱신됐고((0,3)L=0 · (14,20)L/R=2 · (19,19)R=2), **이제 최종 라인업 전 정본에
 * mid 면이 없다**. 그래서 buildLocatorCells 의 톤 가드는 레이아웃 구분 없이 0/2 만
 * 받는다. 강제 주체는 buildLocatorCells 자신이다 — SURFACES 초기화가 전 정본을 이
 * 함수로 만들므로 mid 는 모듈 로드에서 먼저 죽는다. 자기검증 ④(다섯 정본 배열 전수)는
 * 그 뒤의 이중 방벽이다.
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
/** 표시 이름은 «v0XQ» — 중앙 QR 변형. id 는 소문자 (형제 표기 규약). */
export const CELL_SURFACE_FINAL_V0XQ = 'v0xq';
export const CELL_SURFACE_FINAL_IDS = Object.freeze([
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V2R2,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V0X,
  CELL_SURFACE_FINAL_V0XQ,
]);

export const CELL_SURFACE_FINAL_PROFILE = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: 'cell-surface-v0',
  [CELL_SURFACE_FINAL_V2R2]: 'cell-surface-v2r2',
  [CELL_SURFACE_FINAL_V1R2]: 'cell-surface-v1r2',
  [CELL_SURFACE_FINAL_V0X]: 'cell-surface-v0x',
  [CELL_SURFACE_FINAL_V0XQ]: 'cell-surface-v0xq',
});

/** 신세대 셀 표면 formatIndex — 한 쌍뿐. 세 레이아웃이 같이 쓴다(신설 금지). */
export const CELL_SURFACE_FINAL_FORMAT_INDEX = Object.freeze({ 2: 1, 3: 3 });

/** 레이아웃별 허용 n. v2r2·v1r2 는 n=13 을 autoplace 가 거부한다(REF_QUADRANT). */
export const CELL_SURFACE_FINAL_NS = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: Object.freeze([13]),
  [CELL_SURFACE_FINAL_V2R2]: Object.freeze([21, 25]),
  [CELL_SURFACE_FINAL_V1R2]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0X]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0XQ]: Object.freeze([21]),
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
    // v0xq: 441 − 42(파인더) − 81(중앙 QR 슬롯) − 12 − 18 = 288.
    [CELL_SURFACE_FINAL_V0XQ]: Object.freeze({ 21: 288 }),
  }),
  // 레거시 세대 (포맷 v1 · 15셀) — **판독 전용**. 개정 전 발행 프레임의 회계다.
  [CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY]: Object.freeze({
    [CELL_SURFACE_FINAL_V0]: Object.freeze({ 13: 112 }),
    [CELL_SURFACE_FINAL_V2R2]: Object.freeze({ 21: 340, 25: 524 }),
    [CELL_SURFACE_FINAL_V1R2]: Object.freeze({ 21: 334 }),
    [CELL_SURFACE_FINAL_V0X]: Object.freeze({ 21: 349 }),
    // v0xq 는 여기 **없다** — §CELL_SURFACE_FINAL_LEGACY_IDS 참조.
  }),
});

/**
 * 포맷 v1 로 **발행된 적이 있는** 레이아웃. 레거시 판독 세대를 만드는 것은 이 넷뿐이다.
 *
 * v0xq 는 포맷 v2 전환 **이후** 신설이라 v1 와이어가 존재하지 않는다. 억지로 v1
 * 인스턴스를 만들면 (a) 읽을 프레임이 세상에 없는 코드를 유지하게 되고 (b) 실제로
 * 자기검증 ⑤ 가 터진다 — S=97 · ECC-L 예산 85심볼에 **정확히** 맞는 바이트 수가
 * 없다(81 B → 84심볼 · 82 B → 86심볼). 그 불일치를 넘기려면 «인코더가 못 만드는
 * 용량 선언» 을 허용해야 하는데 그것이 바로 ⑤ 가 막는 것이다. 그래서 v0xq 에
 * `cellSurfaceFinal(n, 'v0xq', 1)` 은 **없는 조합**으로 거부된다.
 */
export const CELL_SURFACE_FINAL_LEGACY_IDS = Object.freeze([
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V2R2,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V0X,
]);

/** 이 레이아웃이 레거시(포맷 v1) 판독 세대를 갖는가. */
export function hasLegacyFormatWire(id) {
  return CELL_SURFACE_FINAL_LEGACY_IDS.includes(id);
}

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
 * v0X 정본 65셀 [i, j, T, L, R] — cellsurface-v0x-editor.json
 * (운영자 제공 2026-08-16 · **정규화 2026-08-16 승인**) 컴팩트 전사, n=21 고정.
 * 정본 painted 는 **toneOverrides 가 닿는 (i,j) 전체**다
 * (userNonData 62 + 레거시 고정 위치 위 도색 3: (0,3)·(14,20)·(19,19)).
 * 정규화본은 `toneOverrides` 195 항목 = 65셀 × 3면을 **전부** 실으므로 DEFAULT_TONE
 * 보충이 한 번도 일어나지 않는다 — **mid(1) 면 0개**. 유도는
 * `test/output/lanes/claude-v0xnorm-derive.mjs` (정본 → 이 배열, 손 좌표 없음).
 *
 * 구조 (정본 실측):
 *   · NW (0..3)² 16셀 — v1r2 NW 5×5 의 (0..3)² 부분과 **셀·톤이 완전히 같다**
 *     (정규화로 (0,3).L 예외가 사라졌다). 즉 v0·v1r2·v2r2 가 공유하는
 *     **K3 불스아이 중앙과 같은 계보**다.
 *   · SE (15..20)² 36셀 — QR 동심 사각. **3면 동일 톤 36/36** ((19,19).R 복원):
 *     암 테두리(15·20) → 명 링(16..19) → 암 2×2 코어(17..18)². 중앙 라인 런
 *     1:1:2:1:1 = K5 회문 → 기존 코어 스캐너 재사용 대상. 세 면 각각 행 6/6 · 열 6/6
 *     · 대각 · 반대각 전부 회문이다 (정규화 전에는 R 면이 19행·19열·주대각에서 깨졌다).
 *   · NE (0..1)×(18..20) 6셀 · SW (18..20)×(0..1) 6셀 — 소형 마커(서브앵커).
 *   · (14,20) 1셀 — 분류 밖 단독 점. 정규화로 **3면 동일 (2,2,2)** 이 됐다 —
 *     면 위상(120°) 판별력은 0 이 됐고 단면 큐가 아니라 «점화 점» 이다.
 */
const V0X_CELLS = Object.freeze([
  [0, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 2, 2, 2, 2], [0, 3, 0, 0, 0], [0, 18, 2, 2, 2],
  [0, 19, 0, 2, 0], [0, 20, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 0, 0, 0], [1, 2, 2, 2, 2],
  [1, 3, 0, 0, 2], [1, 18, 2, 0, 2], [1, 19, 2, 0, 2], [1, 20, 2, 0, 2], [2, 0, 2, 2, 2],
  [2, 1, 2, 2, 2], [2, 2, 2, 2, 2], [2, 3, 0, 0, 2], [3, 0, 0, 0, 0], [3, 1, 2, 0, 0],
  [3, 2, 2, 0, 0], [3, 3, 0, 0, 0], [14, 20, 2, 2, 2], [15, 15, 0, 0, 0], [15, 16, 0, 0, 0],
  [15, 17, 0, 0, 0], [15, 18, 0, 0, 0], [15, 19, 0, 0, 0], [15, 20, 0, 0, 0], [16, 15, 0, 0, 0],
  [16, 16, 2, 2, 2], [16, 17, 2, 2, 2], [16, 18, 2, 2, 2], [16, 19, 2, 2, 2], [16, 20, 0, 0, 0],
  [17, 15, 0, 0, 0], [17, 16, 2, 2, 2], [17, 17, 0, 0, 0], [17, 18, 0, 0, 0], [17, 19, 2, 2, 2],
  [17, 20, 0, 0, 0], [18, 0, 2, 2, 2], [18, 1, 2, 2, 0], [18, 15, 0, 0, 0], [18, 16, 2, 2, 2],
  [18, 17, 0, 0, 0], [18, 18, 0, 0, 0], [18, 19, 2, 2, 2], [18, 20, 0, 0, 0], [19, 0, 0, 0, 2],
  [19, 1, 2, 2, 0], [19, 15, 0, 0, 0], [19, 16, 2, 2, 2], [19, 17, 2, 2, 2], [19, 18, 2, 2, 2],
  [19, 19, 2, 2, 2], [19, 20, 0, 0, 0], [20, 0, 0, 0, 0], [20, 1, 2, 2, 0], [20, 15, 0, 0, 0],
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

/**
 * ── v0xq (중앙 QR 변형 × v0X 문법, 2026-08-17 운영자 분기 확정) ─────────────
 *
 * **좌표 규약 (2026-08-17 산술 자기검산 — `test/output/_v0xq-coords.mjs` 는
 * `ygrid.moduleCenter` 실측 경로, `_v0xq-coords2.mjs` 는 같은 기저를 손으로 전개한
 * 닫힌 형태 경로다. 3 × 21² = 1323 셀 전수에서 |Δ| < 1e−9 로 일치. 두 경로 모두
 * 기저를 `src/ygrid.js` 헤더 주석 · `FACE_BASIS` 에서 가져오므로 이것은 **독립 유도가
 * 아니라 산술 검산**이다 — SPEC.md 는 §12 까지이고 §14 는 없다)**.
 * 편집기 캔버스의 NW/NE/SW/SE 는
 * **인덱스 사분면 이름**이지 화면 방위가 아니다. (블록 × 면) → 실루엣 꼭짓점 사상:
 *
 * | 인덱스 블록 (극단 셀) | T 면 | L 면 | R 면 | 중심 거리 |
 * |---|---|---|---|---|
 * | NW (i,j 작음) | **중앙** | **중앙** | **중앙** | 2.0셀 |
 * | NE (i 작음·j 큼) | **좌상 C5** | 하단 C3 | 우상 C1 | 19.0셀 |
 * | SW (i 큼·j 작음) | 우상 C1 | **좌상 C5** | 하단 C3 | 19.0셀 |
 * | SE (i,j 큼) | 상단 C0 | 좌하 C4 | 우하 C2 | 18.0셀 |
 *
 * (거리는 v0X 의 소형 블록 기준. v0xq 의 6×6 CORNER 는 무게중심이 안쪽이라 16.70셀.)
 *
 * 유도의 뼈대: 면 평행사변형의 네 꼭짓점은 (a,b) = (0,0) Y-심 · (n,0) e_i 쪽 ·
 * (0,n) e_j 쪽 · (n,n) 그 면의 «먼» 꼭짓점이다. `ygrid.js` 의 `FACE_BASIS`
 * (T: e_i=C1,e_j=C5 · R: e_i=C3,e_j=C1 · L: e_i=C5,e_j=C3)를 넣으면 위 표가 바로
 * 떨어진다. 그래서
 * **C1·C3·C5 만 심(seam) 꼭짓점**(두 면이 만난다)이고 C0·C2·C4 는 면 하나가
 * 독점하는 원거리 꼭짓점이다.
 *
 * 즉 «좌상·우상·하단» 3코너 = **심 꼭짓점 셋 = NE 사분면(면마다 다른 꼭짓점)** 이고,
 * v0X 의 SE 동심 사각이 앉은 «상단·좌하·우하» 와는 다른 삼중점이다. 운영자 문장
 * 「좌상 = T면 왼쪽 + L면 위쪽」도 실측과 일치한다 — 좌상 꼭짓점에 가장 가까운
 * 셀은 T (0,20)@0.87 과 L (20,0)@0.87 이다 (각각 NE·SW 사분면 극단이고, R 면은
 * 가장 가까워도 21.50 — 반대편이다).
 *
 * **구성** (v0X 정본 블록에서 유도 — 손 좌표표 없음):
 *   · 3코너 마커 = V0X_CELLS 의 SE 6×6 동심 사각을 (i−15, j) 로 평행이동 →
 *     (0..5)×(15..20). 36셀, 3면 동일 톤. T→좌상 · R→우상 · L→하단.
 *     **톤 변경 0 — 좌표만 옮긴 완전 사본이다.** (v0xq 설계 당시에는 v0X SE 에
 *     mid 면 (19,19).R 이 하나 남아 있어 사본 쪽에서 다수 톤 정규화를 했지만,
 *     v0X 정본 정규화 2026-08-16 `45d3505` 로 그 면이 정본에서 2 가 되면서
 *     `normalizeMidFaces` 는 이 계보에서 무동작이 됐다. 함수는 fail-closed
 *     방어로 남긴다 — 자기검증 ①-c 가 «정규화 0건» 을 못 박는다.)
 *   · 위상 마커 = V0X_CELLS 의 SW (18..20)×(0..1) 6셀 **그대로**. T=L·R 만 다른
 *     비대칭이라 120° 위상 판별력을 혼자 짊어진다 (동심 사각은 3면 동일이라 0).
 *     T→우상 · L→좌상 · R→하단 — 각 코너가 «큰 사각 + 작은 마커» 한 쌍이 된다.
 *   · v0X 의 NW 16(K3 중앙)·(14,20) 단독 셀은 **뺀다**. 중앙은 QR 슬롯이 가져가고,
 *     (14,20) 은 블록 분류 밖 단독 점이라 코너 쌍을 이루지 못한다.
 *
 * 그래서 v0xq 정본에는 **mid 면이 0개**다 — v0X 를 포함한 전 정본과 같은 규칙이고,
 * 톤 가드 0/2 를 그대로 쓴다 (`buildLocatorCells` + 자기검증 ④ 이중 방벽).
 */
const V0XQ_CORNER_SHIFT = 15;

/** mid(1) 면을 나머지 두 면의 공통 톤으로 정규화한다. 두 면이 다르면 throw. */
function normalizeMidFaces(i, j, T, L, R) {
  const faces = [T, L, R];
  const out = faces.slice();
  for (let index = 0; index < 3; index += 1) {
    if (faces[index] !== 1) continue;
    const others = faces.filter((_, k) => k !== index);
    if (others[0] !== others[1]) {
      throw new Error(
        'v0xq mid 정규화 불가 — (' + i + ',' + j + ') 의 나머지 두 면이 다르다: '
        + others.join('/'),
      );
    }
    out[index] = others[0];
  }
  return out;
}

/** v0X SE 동심 사각 → v0xq 3코너 마커 (평행이동 + mid 정규화). */
const V0XQ_CORNER_CELLS = Object.freeze(V0X_CELLS
  .filter(([i, j]) => i >= V0X_BLOCKS.SE.iMin && j >= V0X_BLOCKS.SE.jMin)
  .map(([i, j, T, L, R]) => {
    const [nT, nL, nR] = normalizeMidFaces(i, j, T, L, R);
    return Object.freeze([i - V0XQ_CORNER_SHIFT, j, nT, nL, nR]);
  }));

/** v0X SW 위상 마커 — 좌표·톤 **그대로** 재사용 (같은 정본 배열에서 필터). */
const V0XQ_MARKER_CELLS = Object.freeze(V0X_CELLS
  .filter(([i, j]) => i >= V0X_BLOCKS.SW.iMin && j <= V0X_BLOCKS.SW.jMax)
  .map((row) => Object.freeze(row.slice())));

const V0XQ_CELLS = Object.freeze([...V0XQ_CORNER_CELLS, ...V0XQ_MARKER_CELLS]);

/**
 * 중앙 QR 슬롯 한 변(셀). **autoplace 가 정한 상한이다** — (0..m−1)² 를 점유하면
 * n=21 의 NW 사분면(i,j ≤ 9)에 레퍼런스 L자 3셀 자리가 남아야 하는데, m ≥ 10 이면
 * 앵커 후보가 전멸해 `AUTOPLACE_REF_QUADRANT` 로 거부된다 (실측: 5~9 수용 · 10·11·13
 * 거부). 그래서 **최대 슬롯 = 9**. QR 모듈 피치는 sceneY.js 가 이 값에서 유도한다.
 *
 * 조정 여지 (운영자 «인식률 봐서 조정»): 이 값을 줄이면 데이터 셀이 늘고 QR 모듈이
 * 작아진다 (m=8 → data 305 · 모듈 0.276셀 · payload 72 B, m=9 → data 288 ·
 * 0.310셀 · 67 B). 늘리려면 autoplace 의 사분면 규칙부터 바꿔야 한다.
 */
export const CENTER_QR_SLOT_CELLS = 9;

/**
 * 중앙 QR 모듈 기하 — **렌더러와 디코더가 같은 상수를 쓴다.** sceneY(그리는 쪽)와
 * cellsurface-block-detect(중앙 앵커를 읽는 쪽)가 각자 상수를 들면 조용히 어긋난다.
 * QR v1 고정(21×21, qr.js) · 콰이어트 4모듈(표준).
 */
export const CENTER_QR_MODULE_GRID = 21;
export const CENTER_QR_QUIET_MODULES = 4;

/** 슬롯 m 셀 안 QR 모듈 피치(셀). 닫힌 형태 — m / (21 + 2·4). */
export function centerQrModulePitchCells(slotCells = CENTER_QR_SLOT_CELLS) {
  return slotCells / (CENTER_QR_MODULE_GRID + 2 * CENTER_QR_QUIET_MODULES);
}

/**
 * QR v1 파인더 3개의 **모듈 좌표 중심** (qr.js FINDER_CENTERS 와 같은 값).
 * 내용에 무관한 고정 구조라 «중앙 앵커» 로 쓸 수 있다 — 게다가 정삼각형이 아니라
 * 직각 이등변이라 **120° 위상까지 깬다** (동심 사각 3코너는 3중 대칭이라 못 깬다).
 */
export const CENTER_QR_FINDER_MODULES = Object.freeze([
  Object.freeze({ qx: 3, qy: 3 }),
  Object.freeze({ qx: CENTER_QR_MODULE_GRID - 4, qy: 3 }),
  Object.freeze({ qx: 3, qy: CENTER_QR_MODULE_GRID - 4 }),
]);

/**
 * 슬롯 안에서 QR 심볼이 **닿지 않는** 셀 (콰이어트 프레임). T 면의 이 셀들은
 * 언제나 밝다(콰이어트 패치) — 내용 무관 앵커의 밝은 쪽 표본이다.
 * 심볼은 a,b ∈ [4·pitch, 25·pitch] 를 차지하므로 그 밖의 정수 셀이 프레임이다.
 */
export function centerQrQuietFrameCells(slotCells = CENTER_QR_SLOT_CELLS) {
  const pitch = centerQrModulePitchCells(slotCells);
  const lo = CENTER_QR_QUIET_MODULES * pitch;
  const hi = (CENTER_QR_QUIET_MODULES + CENTER_QR_MODULE_GRID) * pitch;
  const quiet = (index) => index + 1 <= lo || index >= hi;
  const cells = [];
  for (let i = 0; i < slotCells; i += 1) {
    for (let j = 0; j < slotCells; j += 1) {
      if (quiet(i) || quiet(j)) cells.push(Object.freeze({ i, j }));
    }
  }
  return Object.freeze(cells);
}

/** 중앙 QR 슬롯 셀 (레이아웃별) — v0xq 뿐이다. 데이터도 파인더도 아닌 제3 역할. */
function slotCellsFor(id) {
  if (id !== CELL_SURFACE_FINAL_V0XQ) return Object.freeze([]);
  const cells = [];
  for (let i = 0; i < CENTER_QR_SLOT_CELLS; i += 1) {
    for (let j = 0; j < CENTER_QR_SLOT_CELLS; j += 1) {
      cells.push(Object.freeze({ i, j }));
    }
  }
  return Object.freeze(cells);
}

/** v0xq 블록 범위 — 로케이터 패치·검출기가 같은 정의를 쓴다. */
export const V0XQ_BLOCKS = Object.freeze({
  /** 3코너 동심 사각 (NE 사분면) — T 좌상 · R 우상 · L 하단. */
  CORNER: Object.freeze({ iMax: 5, jMin: 15 }),
  /** 위상 마커 (SW 사분면) — T 우상 · L 좌상 · R 하단. */
  MARKER: Object.freeze({ iMin: 18, jMax: 1 }),
  /** 중앙 QR 슬롯 (NW 사분면). */
  SLOT: Object.freeze({ iMax: CENTER_QR_SLOT_CELLS - 1, jMax: CENTER_QR_SLOT_CELLS - 1 }),
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
 * 파인더 면 톤은 **전 정본에서 0/2 뿐**이다 (v0X 정규화 2026-08-16 이후).
 * 예전에는 v0X 에 한해 mid(1) 를 받았는데, 그건 편집기가 DEFAULT_TONE 을 직렬화에서
 * 생략해 4면이 mid 로 유도됐기 때문이다 — 정본이 그 4면을 도색 다수 톤으로 확정하면서
 * 레이아웃별 예외가 사라졌다. 예외를 되살리지 말 것: mid 면은 이진 기대값이 없어
 * 로케이터 패치·CS 채점 양쪽에서 특수 처리를 강요한다.
 */
function buildLocatorCells(rows) {
  const seen = new Set();
  const cells = rows.map(([i, j, T, L, R]) => {
    const key = cellKey(i, j);
    if (seen.has(key)) throw new Error('locator 좌표 중복: ' + key);
    seen.add(key);
    for (const tone of [T, L, R]) {
      if (tone !== 0 && tone !== 2) {
        throw new Error('locator 톤이 0/2 가 아니다: ' + key);
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
  if (id === CELL_SURFACE_FINAL_V0XQ) return V0XQ_CELLS;
  return v2r2CellsForN(n);
}

function buildFinalSurface(id, n, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE) {
  assertCellSurfaceFinalN(id, n);
  const blockLength = formatBlockLengthForWire(formatWire);
  const rows = canonicalRowsFor(id, n);
  const locatorCells = buildLocatorCells(rows);
  const painted = locatorCells.map((cell) => ({ i: cell.i, j: cell.j }));

  // 중앙 QR 슬롯 — 데이터도 파인더도 아니다. autoplace 에는 **점유**로 넘기고
  // (예약 셀이 QR 위로 올라오면 안 된다) 회계에서는 별도 항으로 뺀다.
  const slot = slotCellsFor(id);
  const paintedKeys0 = new Set(painted.map((cell) => cellKey(cell.i, cell.j)));
  for (const cell of slot) {
    if (paintedKeys0.has(cellKey(cell.i, cell.j))) {
      throw new Error(id + '@n=' + n + ': 중앙 QR 슬롯이 파인더와 겹친다: '
        + cellKey(cell.i, cell.j));
    }
  }
  const occupied = [...painted, ...slot.map((cell) => ({ i: cell.i, j: cell.j }))];

  // format 18(v2) | 15(v1 레거시 판독) · reference 12 는 autoplace 유도 —
  // 손 좌표표 금지 (c0e7321 계약). 세대는 blockLength 하나로만 갈린다.
  const placed = placeReservedCells(n, occupied, { formatBlockLength: blockLength });
  const format = placed.formatCells;
  const reference = placed.referenceCells;
  if (format.length !== blockLength * 3) {
    throw new Error(
      id + '@n=' + n + ': format 셀이 ' + (blockLength * 3)
      + ' 가 아니다: ' + format.length,
    );
  }

  const locatorKeys = new Set(occupied.map((cell) => cellKey(cell.i, cell.j)));
  for (const cell of [...format, ...reference]) {
    if (locatorKeys.has(cellKey(cell.i, cell.j))) {
      throw new Error(id + '@n=' + n + ': autoplace 산출이 파인더·슬롯과 겹친다: ' + cellKey(cell.i, cell.j));
    }
  }

  const declared = DECLARED_DATA[formatWire][id][n];
  const dataCells = n * n - locatorCells.length - slot.length
    - reference.length - format.length;
  if (dataCells !== declared) {
    throw new Error(
      id + '@n=' + n + ': ' + n + '² − painted(' + locatorCells.length + ') − slot('
      + slot.length + ') − ' + reference.length + ' − ' + format.length + ' = '
      + dataCells + ' 이 선언 data ' + declared + ' 와 다르다',
    );
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;
  const paintedFrozen = Object.freeze(
    painted.map((cell) => Object.freeze({ i: cell.i, j: cell.j })),
  );

  return Object.freeze({
    id,
    profile: CELL_SURFACE_FINAL_PROFILE[id],
    n,
    version: versionForFinalN(n),
    locatorCells,
    locatorCount: locatorCells.length,
    paintedCells: paintedFrozen,
    /** 중앙 QR 슬롯 (v0xq 만 비어 있지 않다). 데이터·파인더 어느 쪽도 아니다. */
    slotCells: slot,
    slotCount: slot.length,
    /**
     * autoplace 에 실제로 넘긴 **점유** = 파인더 ∪ 슬롯. v0xq 전에는 paintedCells 와
     * 같아서 소비자들이 painted 를 점유로 써 왔다 — 슬롯이 생기며 그 등식이 깨졌다.
     * (§occupiedCellsCellSurfaceFinal 주석 참조.)
     *
     * 슬롯이 없는 네 레이아웃은 `paintedCells` 와 **같은 배열 참조**다 — 편입 전
     * 동작이 바이트 불변임을 참조 동일성으로 못 박는다 (`cellSurfaceFinal.test.js`).
     */
    occupiedCells: slot.length === 0
      ? paintedFrozen
      : Object.freeze([...paintedFrozen, ...slot]),
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
  CELL_SURFACE_FINAL_LEGACY_IDS.flatMap((id) =>
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
 * autoplace 에 넘기는 **점유** 셀 = 파인더 ∪ 중앙 QR 슬롯.
 *
 * v0xq 전에는 «점유 = painted» 가 항상 참이라 소비자들이 `paintedCells` 를 그대로
 * 점유 입력으로 썼다. 슬롯이 생기면서 그 등식이 깨진다 — 슬롯 셀 위에 format 이
 * 앉으면 QR 이 포맷을 덮어 버린다. 셀 편집기·유도 검증은 **이 함수**를 써야 한다.
 * v0xq 외에는 paintedCells 와 셀 하나까지 같다 (기존 소비자 동작 불변).
 */
export function occupiedCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? finalLayoutIdForN(n) : id).occupiedCells;
}

/** 중앙 QR 슬롯 셀. v0xq 외에는 빈 배열이다. */
export function slotCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? finalLayoutIdForN(n) : id).slotCells;
}

/** 이 레이아웃이 중앙 QR 슬롯을 갖는가 (= 렌더러가 중앙 QR 을 그려야 하는가). */
export function hasCenterQrSlot(id) {
  return id === CELL_SURFACE_FINAL_V0XQ;
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
    ...surface.slotCells.map((cell) => cellKey(cell.i, cell.j)),
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
  // 'slot' 은 신설 역할이다 — 소비자(bootstrap layoutForFamily)는 format/reference/data
  // 만 조회하므로 조용히 무시된다. 명시로 실어야 디버그 오버레이가 구멍을 안 만든다.
  surface.slotCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'slot', index });
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
    overhead: surface.locatorCount + surface.slotCount
      + surface.formatCells.length + surface.referenceCells.length,
    locator: surface.locatorCount,
    centerQrSlot: surface.slotCount,
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

  // ①-b v0X 정본 — 65셀 · 블록 분할 16/6/6/36 + 단독 1 · SE 3면 동일 36/36.
  if (V0X_CELLS.length !== 65) {
    throw new Error('v0X 정본이 65셀이 아니다: ' + V0X_CELLS.length);
  }
  {
    const inBox = (i, j, box) => (box.iMax === undefined || i <= box.iMax)
      && (box.iMin === undefined || i >= box.iMin)
      && (box.jMax === undefined || j <= box.jMax)
      && (box.jMin === undefined || j >= box.jMin);
    const counts = { NW: 0, NE: 0, SW: 0, SE: 0, SINGLE: 0 };
    let seUniform = 0;
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
      if (home === 'SE' && T === L && L === R) seUniform += 1;
    }
    if (counts.NW !== 16 || counts.NE !== 6 || counts.SW !== 6
      || counts.SE !== 36 || counts.SINGLE !== 1) {
      throw new Error(
        'v0X 블록 분할이 16/6/6/36+1 이 아니다: '
        + [counts.NW, counts.NE, counts.SW, counts.SE, counts.SINGLE].join('/'),
      );
    }
    // 정규화 이후 SE 는 **36/36 전부 3면 동일**이다 — 사각 링 동반자(120° 3코어)
    // 서명의 근거이므로 여기서 못 박는다 (정규화 전에는 (19,19).R 이 mid 라 35/36).
    if (seUniform !== 36) throw new Error('v0X SE 3면 동일이 36/36 이 아니다: ' + seUniform);
  }
  {
    // v0X NW (0..3)² 는 v1r2 NW 의 같은 범위와 **셀·톤이 완전히 같다** (예외 없음 —
    // 정규화로 (0,3).L 이 0 이 되면서 마지막 예외가 사라졌다).
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
        if (faces[index] !== want[index]) {
          throw new Error('v0X NW 셀 (' + i + ',' + j + ') 톤이 v1r2 NW 와 다르다');
        }
      }
    }
  }

  // ①-c v0xq 정본 — 42셀 (동심 사각 36 + 위상 마커 6) · mid 면 0 · 슬롯 81.
  if (V0XQ_CORNER_CELLS.length !== 36) {
    throw new Error('v0xq 3코너 동심 사각이 36셀이 아니다: ' + V0XQ_CORNER_CELLS.length);
  }
  if (V0XQ_MARKER_CELLS.length !== 6) {
    throw new Error('v0xq 위상 마커가 6셀이 아니다: ' + V0XQ_MARKER_CELLS.length);
  }
  {
    // 평행이동 계보 — v0X SE 와 (i+15, j) 로 1:1 대응하고, 톤은 mid 정규화 외에 동일.
    const se = new Map(V0X_CELLS
      .filter(([i, j]) => i >= V0X_BLOCKS.SE.iMin && j >= V0X_BLOCKS.SE.jMin)
      .map(([i, j, T, L, R]) => [i + ',' + j, [T, L, R]]));
    if (se.size !== 36) throw new Error('v0X SE 가 36셀이 아니다: ' + se.size);
    let normalized = 0;
    for (const [i, j, T, L, R] of V0XQ_CORNER_CELLS) {
      const want = se.get((i + V0XQ_CORNER_SHIFT) + ',' + j);
      if (!want) throw new Error('v0xq 코너 셀 (' + i + ',' + j + ') 이 v0X SE 에 없다');
      const faces = [T, L, R];
      for (let index = 0; index < 3; index += 1) {
        if (want[index] === 1) { normalized += 1; continue; }
        if (faces[index] !== want[index]) {
          throw new Error('v0xq 코너 셀 (' + i + ',' + j + ') 톤이 v0X SE 와 다르다');
        }
      }
      // 3면 동일 — 동심 사각은 세 면에 같은 K5 서명을 낸다 (로케이터 전제).
      if (!(T === L && L === R)) {
        throw new Error('v0xq 코너 셀 (' + i + ',' + j + ') 이 3면 동일이 아니다');
      }
    }
    // v0X 정본 정규화(2026-08-16, 45d3505)로 SE 의 mid 면은 **0개**가 됐다. 따라서
    // `normalizeMidFaces` 는 이 계보에서 **무동작**이어야 하고, 위 108 면 비교는
    // 한 면도 건너뛰지 않는 «완전 일치» 대조다. v0X SE 에 mid 가 되살아나면
    // (정규화 되돌림·새 톤 편집) 여기서 즉시 터진다 — v0xq 가 v0X 를 따라 깨지도록
    // 묶어 두는 게이트다. 완화 금지: 0 이 아닌 값을 허용하면 «완전 일치» 가 아니라
    // «mid 를 눈감아 주는 부분 일치» 로 조용히 내려앉는다.
    if (normalized !== 0) {
      throw new Error(
        'v0X SE 에 mid 면이 되살아났다 — v0xq 는 정규화된 SE 의 평행이동본이어야 한다: '
        + normalized,
      );
    }
    // 위상 마커는 v0X SW 와 **완전히 같아야** 한다 (좌표·톤 전부).
    const sw = V0X_CELLS.filter(([i, j]) =>
      i >= V0X_BLOCKS.SW.iMin && j <= V0X_BLOCKS.SW.jMax);
    if (sw.length !== 6) throw new Error('v0X SW 가 6셀이 아니다: ' + sw.length);
    for (let index = 0; index < 6; index += 1) {
      if (sw[index].join(',') !== V0XQ_MARKER_CELLS[index].join(',')) {
        throw new Error('v0xq 위상 마커가 v0X SW 정본과 다르다: ' + index);
      }
    }
    // 위상 판별력의 유일한 원천 — T=L 이고 R 이 다른 셀이 실재해야 한다.
    if (!V0XQ_MARKER_CELLS.some(([, , T, L, R]) => T === L && R !== T)) {
      throw new Error('v0xq 위상 마커에 면 비대칭이 없다 — 120° 판별력 0');
    }
  }
  for (const [i, j, T, L, R] of V0XQ_CELLS) {
    for (const tone of [T, L, R]) {
      if (tone === 1) throw new Error('v0xq 정본에 mid 면이 생겼다: ' + i + ',' + j);
    }
  }
  {
    const slot = slotCellsFor(CELL_SURFACE_FINAL_V0XQ);
    if (slot.length !== CENTER_QR_SLOT_CELLS * CENTER_QR_SLOT_CELLS) {
      throw new Error('중앙 QR 슬롯 셀 수가 m² 가 아니다: ' + slot.length);
    }
    for (const id of CELL_SURFACE_FINAL_IDS) {
      if (id === CELL_SURFACE_FINAL_V0XQ) continue;
      if (slotCellsFor(id).length !== 0) {
        throw new Error(id + ' 에 중앙 QR 슬롯이 생겼다 — v0xq 전용이다');
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

  // ④ **전 정본 mid 금지** — 어느 레이아웃 정의든 조용히 mid 를 얻으면 여기서 throw.
  // (v0X 정규화 2026-08-16 로 레이아웃별 예외가 사라졌다. buildLocatorCells 도 같은
  // 규칙이지만 그쪽은 인스턴스화된 rows 만 보므로, 여기서 원시 배열도 명시로 훑는다.
  // v2r2 중앙은 V1R2_CELLS 필터 유도, v0xq 는 V0X_CELLS 유도라 중복이지만 —
  // **이 표가 «전 정본» 의 목록이다.** 새 레이아웃이 여기 빠지면 규칙 밖으로 샌다.)
  for (const [id, rows] of [
    [CELL_SURFACE_FINAL_V0, V0_CELLS],
    [CELL_SURFACE_FINAL_V1R2, V1R2_CELLS],
    [CELL_SURFACE_FINAL_V0X, V0X_CELLS],
    [CELL_SURFACE_FINAL_V0XQ, V0XQ_CELLS],
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
    //   v0xq@21 441 − 42 − 81(슬롯) − 12 − 18 = 288 · S=96 · 잔여 0 (v1: 291 · 97 · 0)
    'v0xq@21': { symbols: 96, residual: 0, locator: 42, legacy: null },
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
    if (want.legacy === null) {
      // 레거시 세대가 없는 레이아웃 — «없는 조합» 으로 거부되는지까지 확인한다.
      if (hasLegacyFormatWire(id)) {
        throw new Error(key + ': legacy null 인데 레거시 목록에 들어 있다');
      }
      let rejected = false;
      try {
        cellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      } catch (error) {
        rejected = error instanceof RangeError;
      }
      if (!rejected) throw new Error(key + ': 레거시 세대가 조용히 생겼다');
      continue;
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
  const legacyExpected = Object.values(expected).filter((want) => want.legacy !== null).length;
  if (Object.keys(SURFACES).length !== Object.keys(expected).length
    || Object.keys(SURFACES_LEGACY).length !== legacyExpected) {
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
        if (wire === CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY && !hasLegacyFormatWire(id)) continue;
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
