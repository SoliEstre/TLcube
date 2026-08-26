/**
 * cellSurfaceFinal.js — Type Y 셀 표면 **최종 라인업** (v0 · v2r2 · v1r2 · v0X).
 *
 * 운영자 확정 라인업 (2026-08-15, 중앙 개정 2026-08-16, v0X 추가 2026-08-16):
 *   Y0 (n=13) → v0   — 네 코너 소형 블록 파인더 30셀 (정본: cellsurface-v0-editor.json)
 *   Y1 (n=21) → v2r2 — 중앙 블록 A(v1r2 NW 5×5 공유) + 먼 꼭짓점 앵커 블록 B(7×7) = 74셀
 *   Y2 (n=25) → v2r2 — 같은 앵커식 (블록 B 가 (n−7..n−1)² 로 평행이동)
 *   Y1 (n=21) → v1r2 — 네 코너 블록 80셀 (v0 의 확장형). **A/B 후보**로 병행 등록
 *                      (운영자 지시 2026-08-15 밤, 정본: cellsurface-v1r2-editor.json)
 *   Y1 (n=21) → v0X  — QR 파인더 문법 차용 v0 확장 65셀. 편입 당시 n21 3파전 후보
 *                      (운영자 지시 2026-08-16, 정본: cellsurface-v0x-editor.json).
 *                      **2026-08-17 드랍** — 라인업에서 내려갔고 정본은 그대로다
 *                      (§CELL_SURFACE_FINAL_DROPPED_IDS).
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
 * **v0W (2026-08-16 추가, 운영자 신설 설계)** — 코드 안의 id 는 소문자 `'v0w'`,
 * 표시 이름은 `v0W`. 정본은 `cellsurface-v0w-editor.json`(컴팩트 팩)이지만 이 모듈은
 * **그 팩을 전사하지 않는다** — 재검산 결과 세 블록이 전부 기존 정본에서 유도되기
 * 때문이다 (`test/output/lanes/claude-v0w-derive.mjs`, 70/70 셀 완전 일치):
 *   · NW (0..4)² 25셀 = **v1r2 NW 5×5 와 같은 배열**(= v2r2 중앙 블록 A). K3 불스아이.
 *   · NE (0..5)×(15..20) 36셀 = **V0XQ_CORNER_CELLS 와 같은 배열**
 *     (= v0X SE 동심 사각을 (i−15, j) 로 평행이동한 것). 3면 동일 톤 36/36.
 *   · SE (18..20)² 9셀 = **v0 정본의 SE 3×3 먼 코너 블록**을 (+8, +8) 평행이동.
 *     T=L 이고 R 만 다른 비대칭(위상 마커) — 120° 판별력을 혼자 짊어진다.
 *
 * 팩의 `_note` 는 「R면 SE 3×3 반전」이라 적었지만 실측은 «비트 반전» 이 아니다:
 * T·L 은 상단행+좌열 L자(밝음 5), R 은 중앙 1점(밝음 1)이다. 그 무늬의 출처는
 * **v0 의 SE 코너 블록 그대로**이고, 이 모듈은 측정한 쪽을 적는다.
 *
 * 팩의 `toneOverrides` 는 209항(T 70 · L 69 · R 70)이라 (0,4).L 한 면이 빠져
 * DEFAULT_TONE(=1) 로 유도된다 — v0X 최초 편입본과 **같은 직렬화 함정**이다.
 * 나머지 두 면이 (2,2) 로 일치하므로 `normalizeMidFaces` 가 결정적으로 2 를 채우고,
 * 유도된 배열은 v1r2 NW 의 (0,4) = (2,2,2) 와 셀 하나까지 같다. 즉 **v0W 정본에도
 * mid 면이 0개**이고, 손이 고른 값은 하나도 없다.
 *
 * 회계: 441 − 70 − 12 − 18 = **341** (편집기 팩 `counts.data` 와 일치하지만, 이 모듈이
 * 쓰는 값은 팩의 회계가 아니라 autoplace 재산출이다 — v0X 전례, 손 좌표 금지).
 * 레거시(포맷 v1) 세대는 **없다** — v0xq 와 같이 포맷 v2 전환 이후 신설이라
 * v1 로 발행된 프레임이 세상에 없다 (§CELL_SURFACE_FINAL_LEGACY_IDS).
 *
 * **v0W 파생 2종 (2026-08-16, 운영자 지시)** — 「v0W 에 QR 채널을 어떻게 붙이나」의
 * 두 답이고, **한쪽만 와이어에 새 id 를 만든다.**
 *
 *   · **v0WQ** (`'v0wq'`) — v0XQ 식 **중앙 QR 슬롯**. 중앙 K3 를 슬롯이 가져가므로
 *     셀 집합이 실제로 달라진다 → 새 레이아웃 id. 정본은 또 유도다(손 좌표 0):
 *     NE 동심 사각 36 = `V0XQ_CORNER_CELLS` **같은 배열** · SE 위상 마커 9 =
 *     `V0W_PHASE_CELLS` **같은 배열**. 즉 **v0XQ 와 위상 마커 블록 하나만 다르다**
 *     (v0xq = v0X SW 6셀 · v0wq = v0 SE 3×3 9셀) — 대조 실험이 설계로 붙어 있다.
 *     회계: 441 − 45 − 64(슬롯 8²) − 12 − 18 = **302** · S=100 · 잔여 2.
 *     슬롯은 **두 번 물어서** 정해졌다 — autoplace 상한 9 (`claude-v0wq-probe.mjs`:
 *     m ≥ 10 은 `AUTOPLACE_REF_QUADRANT` 거부) · 그 안에서 **인코더 정합 ⑤ 가 9 를
 *     거부**해 8 로 내려앉았다 (§CENTER_QR_SLOT_CELLS_V0WQ). 결과적으로 v0XQ 보다
 *     data 가 **14셀 많고**(302 대 288) QR 모듈은 **더 잘다**(0.2759 대 0.3103셀).
 *
 *   · **v0WY** — **2026-08-17 재설계로 진짜 와이어 id 가 됐다** (§CELL_SURFACE_FINAL_V0WY).
 *     최초 편입(2026-08-16)의 v0WY 는 큐브 **바깥** 면-평면 QR («허공 마름모») 이라
 *     셀을 한 칸도 안 먹었고, 그래서 셀 집합·회계·와이어가 v0W 와 **비트 동일**한
 *     «렌더 선택» 이었다. 실기기 3라운드 뒤 운영자가 그 설계를 **폐기**하고
 *     «윈도 β 식 안쪽 배치 + v0WQ 와 같은 크기의 슬롯» 으로 재설계했다 —
 *     QR 이 실루엣 **안**으로 들어와 64셀을 먹으므로 이제 셀 집합이 실제로 다르다.
 *
 * **v0W 파생 ③ — v0W2 (2026-08-17, 운영자 신설 설계)** — 실기기 판정 라운드에서
 * v0W 가 진 두 자리를 정면으로 고친 물건이다. QR 채널이 아니라 **파인더 자체의 개정**
 * 이라 위 두 파생과 성격이 다르다.
 *
 *   · **v0W2** (`'v0w2'`) — ① SE 부 파인더 3×3 → **6×6**(실기기 미검출 해소)
 *     ② NW·NE 를 **3면 완전 대칭**으로 통일해 검출 전용으로 돌리고, 120° 위상은
 *     SE 대형 마커 하나가 전담. 그래서 면 비대칭 셀 22개가 **전부 SE 안**에 있다
 *     (v0W 은 10개가 NW 4 + SE 6 으로 흩어져 있었다).
 *     정본은 또 유도다 — NW = `K3_CENTRE_CELLS` 의 **3면 다수결 대칭화**(4셀만 눕는다) ·
 *     NE = `V0XQ_CORNER_CELLS` **같은 배열** · SE 의 T·L = **v0X SE 톤(같은 좌표)**.
 *     손 표는 **SE 의 R 면 36값 하나뿐**이다 (§V0W2_MARKER_R).
 *     회계: 441 − 97 − 12 − 18 = **314** · S=104 · 잔여 2. 슬롯 없음.
 *     설계가 실제로 들었는지의 지표는 **방향 margin** 이다 — 0.0952 → **0.1512**
 *     (+58.8 %, 실측 44/291 면). 재검산: `test/output/lanes/claude-v0w2-derive.mjs`
 *     (팩 → 계수 → 정규화 → 유도 대조) · `claude-v0w2-render.mjs`(실제 래스터 291면
 *     분류, 불일치 0) · `claude-v0w2-probe.mjs`(margin·교차·슬롯 위반).
 *     팩의 (0,4).L 미도색은 v0W·v0X 와 **같은 편집기 함정**이고, 나머지 두 면이 (2,2)
 *     라 다수 톤 정규화가 결정적으로 2 를 준다 — mid 면 0.
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
import { CELL_SURFACE_FINAL_FORMAT_INDEX as FORMAT_INDEX_Y_FINAL } from './formatY.js';

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
/** 표시 이름은 «v0W» — 운영자 신설(2026-08-16). id 는 소문자 (형제 표기 규약). */
export const CELL_SURFACE_FINAL_V0W = 'v0w';
/** 표시 이름은 «v0WQ» — v0W 파생, 중앙 QR 슬롯 (2026-08-16). */
export const CELL_SURFACE_FINAL_V0WQ = 'v0wq';
/**
 * 표시 이름은 «v0W2» — v0W 파생 ② (운영자 신설 2026-08-17, 실기기 판정 라운드).
 * v0W 의 실기기 약점 둘을 정면으로 고친다 — ① SE 부 파인더 3×3 → **6×6** (실기기
 * 미검출 해소) ② NW·NE 를 **3면 완전 대칭**으로 통일해 검출 전용으로 돌리고 위상
 * 판별은 SE 대형 마커 하나가 전담한다 (§V0W2_CELLS).
 */
export const CELL_SURFACE_FINAL_V0W2 = 'v0w2';
/**
 * 표시 이름은 «v0WY» — v0W 파생 ③ (운영자 **재설계** 2026-08-17, 실기기 판정 3라운드).
 *
 * **최초 편입본(2026-08-16)과 다른 물건이다.** 그때의 v0WY 는 큐브 바깥 허공에 뜬
 * 면-평면 QR («마름모») 이라 셀을 한 칸도 안 먹었고 — 그래서 와이어 id 가 없는
 * «렌더 선택» 이었다. 운영자가 그 설계를 폐기하고 다음으로 확정했다:
 *
 *   · QR 을 실루엣 **안**으로 — «윈도 β 식 안쪽 배치» = 초기 타입 Y 안쪽 QR 과 같은
 *     자리, **T 면 먼 코너 C0** (L 면 좌하 C4 · R 면 우하 C2) 에 묻힌다.
 *   · 슬롯 크기는 **v0WQ 와 동일** — 8×8 = 64셀 (§CENTER_QR_SLOT_CELLS_V0WY).
 *
 * 그래서 셀 집합이 실제로 달라졌고 (슬롯 64셀 + 위상 마커 이전), **이제 진짜 와이어
 * id 다**. 「v0WY 는 와이어 id 가 아니다」 는 옛 설계의 서술이고 이 개정으로 뒤집혔다.
 *
 * ── 겹침 해소 (이 편입의 1차 설계 결정) ──────────────────────────────────
 * 먼 코너 슬롯 [13,20]² 는 v0W 의 SE 위상 마커 (18..20)² 와 **9셀 전부 겹친다**.
 * 세 후보를 실측 비교했다 (`test/output/lanes/claude-v0wy-design.mjs`):
 *
 * | 후보 | 파인더 | 슬롯 | data | 방향 margin | 인코더 정합 ⑤ | 먼 코너 C0 |
 * |---|---|---|---|---|---|---|
 * | (a) SE 를 슬롯에 내주고 NW 비대칭에 의존 | 61 | [13,20]² | 286 | 0.0437 | **거부** | 닿음 |
 * | (b) 슬롯을 안쪽으로 밀어 SE 유지 | 70 | [10,17]² | 277 | 0.0952 | ok | **안 닿음** |
 * | **(c) SE 마커를 SW 로 이전** | **67** | **[13,20]²** | **280** | **0.0796** | **ok** | **닿음** |
 *
 * (a) 는 **손대지 않은 게이트가 죽인다** — data 286 → S=95 → ECC-H 예산 57심볼에
 * 정확히 맞는 바이트 수가 없다 (54 B → 56심볼). v0WQ 슬롯을 9 → 8 로 내린 그
 * 자기검증 ⑤ 와 **같은 자, 같은 S 값**이다. 게다가 파인더가 v0W 의 **진부분집합**이라
 * (내 셀 중 v0W 에 없는 것 0 · 톤 충돌 0) 교차 별칭이 설계로 100 % 가 된다.
 *
 * (b) 는 브리프 문안(«[12,19]² 로 한 칸 안쪽»)으로는 **겹침이 안 풀린다** (4셀 잔존:
 * (18,18)·(18,19)·(19,18)·(19,19)). 실제로 푸는 최소 후퇴는 [10,17]² 인데 그러면
 * 슬롯이 먼 코너 C0 에 안 닿아 **운영자 스펙을 어긴다**. 그리고 파인더가 v0W 와
 * **셀·톤까지 완전히 같아져** («내 셀 중 상대에 없음 0 · 상대 셀 중 내게 없음 0»)
 * 브리프가 경고한 «최대 지뢰» 가 문자 그대로 실현된다.
 *
 * (c) 만이 세 조건을 다 만족한다 — 스펙(먼 코너 C0 · 64셀) · ⑤ · **셀 수준 판별력**.
 * 대가는 margin 0.0952 → 0.0796 (−16.4 %, 마커가 9셀 → 6셀) 인데 게이트 0.035 의
 * **2.27배**이고 편입 이력이 있는 v0XQ(0.0635)보다 두껍다. 게이트는 무접촉이다.
 *
 * 구성 (전부 유도 — 손 좌표표 0):
 *   · NW (0..4)²          25 = `K3_CENTRE_CELLS` **같은 배열** (v0W 와 동일한 중앙)
 *   · NE (0..5)×(15..20)  36 = `V0XQ_CORNER_CELLS` **같은 배열**
 *   · SW (18..20)×(0..1)   6 = `V0XQ_MARKER_CELLS` **같은 배열**
 *        (= v0X SW = **v0 정본 SW 3×2 블록의 (+8, 0) 평행이동** — 실측 6/6 완전 일치.
 *         v0W 의 SE 마커가 v0 SE 3×3 의 (+8,+8) 인 것과 **같은 계보의 형제 블록**이다.
 *         즉 «마커를 SW 로 옮긴다» 는 새 무늬를 그리는 일이 아니라 v0 의 이웃 코너
 *         블록을 같은 규칙으로 쓰는 일이다.)
 *   · SLOT [13,20]²       64 = 먼 코너 QR (§CENTER_QR_SLOT_CELLS_V0WY)
 *
 * 회계: 441 − 67 − 64 − 12 − 18 = **280** · S=93 · 잔여 1.
 */
export const CELL_SURFACE_FINAL_V0WY = 'v0wy';
/**
 * 표시 이름은 «v0T» — **Type Y 최종 파인더** (운영자 확정 2026-08-17, 재논의 금지).
 *
 * v0W 계열 전체(v0w · v0w2 · v0wq · v0wy)를 대체한다 — 넷은 같은 날 드랍됐다
 * (§CELL_SURFACE_FINAL_DROPPED_IDS). 정본은 운영자 편집기 export
 * `cellsurface-v0t-editor.json` (2026-08-17) 이 **유일한 진실**이고, 이 모듈은
 * 유도 61셀 + 전사 43셀로 만든다 (`test/output/lanes/claude-v0t-derive.mjs` 가
 * 팩 ↔ 모듈 104/104 완전 대조를 돌린다. 셀 변경 금지 — 운영자 확정).
 *
 * 구조 (팩 `structure` 필드 + 유도 실측):
 *   · NW (0..3)²          16 = v1r2 NW (0..3)² 의 **3면 다수결 대칭화** (v0W2 중앙과
 *     같은 규칙 — `K3_CENTRE_SYMMETRIC_CELLS` 의 부분 필터. 대칭화로 바뀌는 4셀이
 *     정확히 그 (0..3)² 안에 있다). **(0,0) 3면 dark 편입 반영** — 큐브 중심점은
 *     세 면이 픽셀 한둘 안에 겹쳐 표본이 구조적으로 분리 불가능하므로 데이터를 두지
 *     않는다 (팩 resolvedDecision, data 308 → 307 · S=102 불변 · payload 불변).
 *   · A  (4..6)×(3..5)     9 = **L 반전 비대칭 블록** (전사) — L 만 T·R 의 톤 반전.
 *   · N팔 (0..1)×(10..14) 10 = 전사 (신규 도안).
 *   · NE (0..5)×(15..20)  36 = `V0XQ_CORNER_CELLS` **같은 배열** (v0X SE 평행이동).
 *   · W  (10..15)×(0..3)  24 = 전사 (신규 도안 — 톤 수준에서 NW 행 [3,2,1,0,2,3]
 *     회문 스택이 관찰되지만 참조 유도가 아니라 행 재배열이라 전사한다).
 *   · SE (18..20)²         9 = `V0W_PHASE_CELLS` **같은 배열** (v0 SE 3×3 의 (+8,+8)).
 *     **R 반전 비대칭 블록** — R 만 T·L 의 톤 반전 (모서리 3셀은 3면 동일 dark).
 *
 * ⚠ **비대칭 이중화는 의도된 설계다** (운영자 확정 2026-08-17). 방향 판별 블록을
 * **일부러 둘** 넣었다 — 안쪽 A(L 반전 9) 하나, 먼 코너 SE(R 반전 6/9) 하나.
 * 파생 변형의 슬롯이 어느 쪽을 삼켜도 **나머지 하나가 방향을 준다** (v0TY 가 SE 를
 * 삼키면 A 가 남는다). 먹힌 비대칭을 «되찾는» 보충 블록을 만들지 말 것 — 마커 이전도
 * 금지다. 회계: 441 − 104 − 12 − 18 = **307** · S=102 · 잔여 1 · 방향 margin 0.0962
 * (게이트 0.035 의 2.75배) · payload L/M/H = 86/72/58 B (`claude-v0t-probe.mjs` 검산).
 */
export const CELL_SURFACE_FINAL_V0T = 'v0t';
/**
 * 표시 이름은 «v0TY» — v0T 파생, **먼 코너 QR 슬롯** (운영자 확정 2026-08-17).
 * v0WY 와 같은 역할·같은 슬롯 (8×8 = 64셀, far 앵커 · 윈도 β 식 뒤집기).
 *
 * 슬롯 [13,20]² 가 v0T 의 SE 비대칭 블록 (18..20)² 를 9/9 전부 삼킨다 →
 * **안쪽 A 블록 (L 반전 9셀) 이 남아 방향을 준다.** 이것이 위 «비대칭 이중화» 설계의
 * 실증이다 — 보충 블록을 만들지 않았고 마커도 옮기지 않았다 (운영자 확정 준수).
 *
 * 회계 (`claude-v0tqty-probe.mjs` 실측): 파인더 95 · 슬롯 64 · data 252 · S=84 ·
 * 잔여 0 · 인코더 정합 ⑤ 통과 (L/M/H = 71/60/48 B) · autoplace 수용 m=4..8 (상한 8).
 * 방향 margin 0.0632 (게이트의 1.80배) — 단 이 자는 **슬롯 QR 자체 파인더 패턴이
 * 주는 방향 정보를 못 세므로** 이 변형의 실제 강건성을 과소평가한다 (운영자 근거 —
 * margin 을 판정 근거로 쓰지 말 것. «낮으니 보강하자» 는 운영자가 기각했다).
 *
 * ⚠ **v0TQ (중앙 슬롯 파생) 는 여기 없다 — 편입 불가 실측** (2026-08-17,
 * `claude-v0tqty-probe.mjs`): 중앙 [0,m−1]² 슬롯은 m=5..9 를 autoplace 가 거부하고
 * (포맷 복제 이격 S_fmt < 289 — v0T 의 N팔·W 블록이 포맷 후보 자리를 먹는다),
 * 유일 수용 m=4 는 콰이어트 프레임이 **0셀**이라 슬롯 QR 확증 게이트
 * (`centreQrFinderContrast`, 콰이어트 표본 ≥ 6)가 구조적으로 거절한다. 게이트를
 * 내려야만 통과한다면 그것이 곧 답이다 — 내리지 않았고, 와이어를 만들지 않았다
 * («읽을 프레임이 세상에 없는 코드를 유지하지 않는다» — v0xq 레거시 부재와 같은 규약).
 */
export const CELL_SURFACE_FINAL_V0TY = 'v0ty';
/**
 * 표시 이름은 «v0TR» — v0T 재설계 (운영자 2026-08-17, v0T 실기기 거리 약점 대응).
 *
 * 실기기 관측 (운영자, 2026-08-17): v0TY 는 근접에서 잘 잡히는데 **v0T 는 거리를 조금만
 * 빼면 파인더를 다 잡고도 다수가 `v0`(n=13)로 분류되며 실패**한다. 그 오분류 기전의
 * 규명은 이 레이아웃의 몫이 아니다 (별도 축) — v0TR 은 **기하 쪽 답**이다.
 *
 * 구조 (정본 팩 `cellsurface-v0trq-editor.json` 유도 실측 — 손 좌표표 **0줄**):
 *   · NW (0..3)²           16 = `V0T_CENTRE_CELLS` **같은 배열** (v0tr 만 — v0trq 는 슬롯)
 *   · NE 바깥 (0..5)×(15..20) 36 = `V0XQ_CORNER_CELLS` **같은 배열** (v0T NE 와 톤까지 36/36)
 *   · NE 안쪽 (2..7)×(10..15) 36 = 바깥 사각의 **(i+2, j−5) 평행이동** (톤까지 36/36)
 *   · SE (18..20)²          9 = `V0W_PHASE_CELLS` **같은 배열** — R 반전 비대칭 6/9
 *   두 동심 사각이 j=15 열 4셀을 공유하므로 NE 합집합은 36+36−4 = **68** 이다.
 *
 * v0T 에서 **빠진 것**: A 블록(L 반전 9셀) · N팔 10 · W 블록 24. 즉 v0T 의 «의도된
 * 비대칭 이중화 2개» 중 **안쪽 판별자 A 가 통째로 없다** — 방향은 SE 6셀이 혼자 진다.
 * 그것이 그대로 수치에 나온다: **방향 margin 0.0430** (12/279 · 게이트 0.035 의 1.23배)
 * 로 현행·드랍 통틀어 **최저**다 (v0ty 0.0632 · v0xq 0.0635 보다도 얇다).
 * 게이트 위이므로 편입하되, 실기기에서 회전 오분류가 나면 **가장 먼저 의심할 자리**가
 * 여기다. 보충 블록·마커 이전은 만들지 않았다 (v0T 편입 때 확정된 금지 규약 그대로).
 *
 * ⚠ **NE 안쪽 사각이 이 계열의 핵심이다.** 그 블록 무게중심 (5,13) 까지의 반경은
 * √129 = **11.3578셀**로, v0X·v0W·v0W2·v0WY·v0T·v0TY 가 전부 공유하던 √279 =
 * 16.7033 과 **5.35셀** 떨어져 있다 — `ANCHOR_SNAP_CELLS`(3.2) **밖**이다.
 * 최종 라인업에서 **코어 반경으로 갈라지는 첫 계열**이고, 그래서 순수 v0T·v0TY
 * 프레임에는 v0TR 브랜치가 아예 안 뜬다 (기존 라인업의 쌍당 비용 증가 0).
 *
 * 회계 (A 블록 편입 후, 2026-08-18): 441 − 102 − 12 − 18 = **309** · S=103 ·
 * 잔여 0 · payload L/M/H = 89/76/61 B · ⑤ 인코더 정합 전 레벨 통과 ·
 * autoplace 수용 (S_fmt 388 ≥ 289).
 */
export const CELL_SURFACE_FINAL_V0TR = 'v0tr';
/**
 * 표시 이름은 «v0TRQ» — v0TR 파생, **중앙 QR 슬롯** (운영자 정본 2026-08-17).
 * 정본 팩이 이 변형으로 왔고, `v0tr` 은 그 팩에서 슬롯을 걷고 v0T 중앙을 넣은 기반이다.
 *
 * 슬롯 (0..7)² 가 v0TR 의 NW 중앙 16셀을 삼킨다 — 정의가 곧 유도다
 * (`V0TR_CELLS` 의 슬롯 박스 필터 · 행 참조 유지 · 손 좌표 0). 남은 방향 판별자는
 * SE 마커 6셀 하나이고, 그 위에 **슬롯 QR 자신의 파인더 패턴**이 얹힌다.
 *
 * ⚠ **v0TQ 를 막던 것이 여기서 풀렸다.** v0T 의 중앙 슬롯 파생(v0TQ)은 m=5..9 를
 * autoplace 가 «포맷 복제 이격 S_fmt < 289» 로 거부했다 — v0T 의 N팔·W 블록이 포맷
 * 후보 자리를 먹었기 때문이다. v0TR 은 그 둘이 없어(SW·W 가 비었다) 같은 m=8 에서
 * **S_fmt = 340 ≥ 289** 로 통과한다 (실측 `claude-v0tr-measure.mjs` ⓓ). 게이트를
 * 내린 것이 아니라 **점유 집합이 달라져 하한을 실제로 넘긴 것**이다.
 *
 * 회계 (실측): 파인더 77 · 슬롯 64 · detector **141** · 441 − 77 − 64 − 12 − 18 =
 * **270** · S=90 · 잔여 0 · payload L/M/H = 76/64/52 B · ⑤ 전 레벨 통과 ·
 * 방향 margin **0.0519** (12/231 · 게이트의 1.48배 — 슬롯 QR 의 방향 정보는 이 자가
 * 못 세므로 v0TY 와 같은 이유로 과소평가값이다).
 *
 * 슬롯 한 변 8 은 **v0WQ 값의 참조**다 (v0WY·v0TY 와 같은 참조 사슬 — 숫자 8 을 다시
 * 적지 않는다). 앵커는 `seam` — v0xq·v0wq 와 같은 Y-심 중앙 배치이고 뒤집기는 없다.
 *
 * ⚠ **의도적 갱신 (2026-08-18)** — 여기에 「`v0try`(먼 코너 슬롯 파생) 는 만들지
 * 않았다」 가 적혀 있었다. v0TR 에 A 블록이 편입되며(`00936ce`) 그 파생이 원리적으로
 * 성립하게 됐고, 운영자 지시로 편입했다 — §CELL_SURFACE_FINAL_V0TRY.
 */
export const CELL_SURFACE_FINAL_V0TRQ = 'v0trq';
/**
 * 표시 이름은 «v0TRY» — v0TR 파생, **먼 코너 QR 슬롯** (운영자 2026-08-18).
 * v0TY 가 v0T 에서 만들어진 것과 **정확히 같은 방식**의 유도다:
 *
 * ```
 * v0try = V0TR_CELLS − [n−m, n−1]²   (n=21 · m = CENTER_QR_SLOT_CELLS_V0TY = 8 → [13,20]²)
 * ```
 *
 * 슬롯 [13,20]² 가 v0TR 의 SE 블록 (18..20)² 를 **9/9 전부** 삼킨다 (계측
 * `claude-v0try-measure.mjs` ⓐ — 삼킨 9셀 중 비대칭 6). 남는 방향 판별자는
 * **A 블록의 L 반전 9셀**이고, 그것은 v0TY 가 SE 를 잃고도 세 방향이 서는 이유와
 * 문자 그대로 같은 구조다 — «의도된 비대칭 이중화» 의 두 번째 실증이다.
 *
 * ⚠ **이 파생은 A 블록 편입(`00936ce`) 없이는 성립하지 않았다.** A 가 없던 v0TR
 * (93셀 · 비대칭 SE 6) 에서는 슬롯이 SE 를 삼키는 순간 비대칭이 **0** 이 되어
 * 방향 판별자가 사라진다. 순서가 그래서 중요했다.
 *
 * 회계 (실측 `claude-v0try-measure.mjs` ⓓ): 파인더 **93** · 슬롯 64 · detector **157** ·
 * 441 − 93 − 64 − 12 − 18 = **254** · S=84 · **잔여 2** · payload L/M/H = 71/60/48 B ·
 * ⑤ 인코더 정합 전 레벨 통과 · autoplace 수용 (S_fmt 333 ≥ 289 · dRef 72 ≥ 64).
 * 방향 margin **0.0645** (18/279 · 게이트 0.035 의 **1.84배**) — v0TY(0.0632)와 분자가
 * 같고(A 9셀 × 2 = 18 miss) 분모만 작다. v0TY·v0TRQ 와 같은 이유로 이 자는 **슬롯 QR
 * 자신의 파인더 패턴이 주는 방향 정보를 못 세므로** 과소평가값이다.
 *
 * ⚠ **잔여 2 는 라인업에서 두 번째 사례다** (v0t@21 잔여 1). 254 = 3×84 + 2 라
 * 심볼로 못 쓰는 셀이 2개 남는다 — 게이트가 아니라 회계 사실이라 그대로 선언한다.
 * payload 는 S 가 v0TY 와 같아 한 바이트도 다르지 않다.
 *
 * 슬롯 한 변·앵커·뒤집기는 **v0TY 의 값을 그대로 재사용**한다 (새 상수 신설 0 —
 * `centerQrSlotCellsFor` 가 `CENTER_QR_SLOT_CELLS_V0TY` 를 가리키고 배치는
 * `far` / `flip: true`). 코어 반경은 v0TR 과 **같다** (√279 = 16.7033, Δ = 0.000000) —
 * 슬롯이 SE 쪽이라 NE 코너 앵커가 한 셀도 안 움직인다.
 */
export const CELL_SURFACE_FINAL_V0TRY = 'v0try';
/**
 * 선언 순서가 곧 «n 별 후보 순서» 다 (`finalLayoutIdsForN`). v0W·v0WQ 를 **맨 뒤**에
 * 둔 것은 편입 시점의 규약이었다 — 당시 n=21 의 기본은 v0X 였고, 둘은 세·네 번째
 * 후보로 병행 채점됐다. 기본을 바꾸는 것은 조건부 드랍(«v0W > v0X» · «v0WQ > v0XQ»
 * 실기기 판정)의 몫이지 편입의 몫이 아니다.
 *
 * **지금(2026-08-17 3라운드 이후) n=21 의 기본은 v0W 다** — v0X 가 드랍되면서 이
 * 선언 순서의 다음 항목이 그대로 승계했다. 규약이 바뀐 것이 아니라 규약대로 된 것이다.
 *
 * **2026-08-17 실기기 판정 (2라운드)** — 순위 v0WQ ≫ v0XQ > v0X ≈ v0W. 「v0WQ > v0XQ」 는
 * 성립해 v0xq 가 드랍됐고(§CELL_SURFACE_FINAL_DROPPED_IDS), 「v0W > v0X」 는
 * **성립하지 않아**(≈) v0X 가 남았다. 이 배열은 **와이어 선언**이라 드랍이 여기서
 * 항목을 빼지 않는다 — 빼는 것은 `CELL_SURFACE_FINAL_ACTIVE_IDS` 쪽이다.
 *
 * **2026-08-17 실기기 판정 (3라운드) — v0X 드랍 확정.** 2라운드의 «≈» 는 v0W2 가
 * 없던 판정이었다. 3라운드 관측은 v0X 를 **단독 결함**으로 지목한다:
 * 「파인더 인식 다 해놓고도 잘 못 읽음」 + 「v0 과 혼선 자주」. 앞은 «포즈는 서는데
 * 하류 CS/RS 가 못 넘긴다», 뒤는 «n=13 v0 와 n=21 v0X 가 서로로 잡힌다» 는 말이다.
 * 그래서 v0x 도 §CELL_SURFACE_FINAL_DROPPED_IDS 에 든다 — 같은 «차단·비삭제» 규약.
 *
 * ⚠ **의도적 갱신 (2026-08-17 재설계) — v0WY 가 여기 들어왔다.** 이 자리에는
 * 「v0WY 는 셀 집합이 v0W 와 비트 동일한 «렌더 선택» 이라 와이어 id 가 아니다」 가
 * 적혀 있었다. 그 문장은 **허공 마름모 설계**의 서술이었고, 운영자가 QR 을 실루엣
 * 안쪽 먼 코너로 옮기면서 셀 집합이 실제로 달라졌다 (슬롯 64 + 마커 SE→SW).
 * 지금은 v0W 와 파인더 셀이 **양방향으로** 다르다 (내 SW 6 ↔ 상대 SE 9) — 그 문장이
 * 걱정하던 «구분할 근거 0» 이 해소됐다. 근거·후보 비교는 §CELL_SURFACE_FINAL_V0WY.
 * 맨 뒤에 두는 것은 편입 규약 그대로다 — n=21 기본(v0w)은 안 바뀐다.
 */
export const CELL_SURFACE_FINAL_IDS = Object.freeze([
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V2R2,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V0X,
  CELL_SURFACE_FINAL_V0XQ,
  CELL_SURFACE_FINAL_V0W,
  CELL_SURFACE_FINAL_V0WQ,
  CELL_SURFACE_FINAL_V0W2,
  CELL_SURFACE_FINAL_V0WY,
  // ⭐ **v0TR 이 n=21 기본이다 (운영자 실기기 판정 2026-08-18)** — 편입 때 맨 뒤에
  // 두면서 «기본을 바꾸는 것은 실기기 판정의 몫이지 편입의 몫이 아니다» 라고 적어
  // 뒀고, 지금이 그 시점이다. 운영자 관측: 「v0T/v0TR 계열 인식은 괜찮고, v0TR
  // 우선순위를 가장 높여주면 도움이 될 것 같다」. 규약대로 한 것이다.
  //
  // 근거 보강 — A 블록 편입(00936ce) 후 v0tr 의 방향 margin 은 **0.0980** 으로
  // v0t(0.0962)보다 높다. 동점에서 선호되는 쪽이 더 두꺼운 여유를 갖는 편이 낫다.
  // 그리고 순서는 pickBetterLayout 의 **동점 처리**에만 관여한다 — agreement 가
  // 다르면 순서와 무관하게 높은 쪽이 이긴다. 즉 이 변경은 «틀린 답을 고르게»
  // 만들 수 없다. 바꾸는 것은 «둘 다 똑같이 맞을 때 누구 이름으로 부르나» 뿐이다.
  // **의도적 갱신 — 실기기 순위 (운영자 2026-08-19 밤, v0TRY 배포 후 재측정)**
  //
  // 관측 부분순서: `v0 > v0TR > v0TRY > v0TRQ` · `v0T > v0TY` · `v0T > v0TR` ·
  // `v0TRY > v0TRQ > v0TY`. 위상정렬하면 n=21 계열은
  //   **v0T > v0TR > v0TRY > v0TRQ > v0TY**
  //
  // ⚠ **이것이 세 번째 순서다.** 앞의 둘을 뒤집는다:
  //   · 08-18 「v0TR 우선순위를 가장 높여달라」 → v0tr 맨 앞
  //   · 08-19 낮 「v0TRQ 를 v0T 앞으로」      → v0trq 를 v0t 앞
  // 운영자 자신이 「전체적으로 **오락가락** 하지만 원거리 인식률을 높게 쳤을 때 기준」
  // 이라고 단서를 달았다. **그러니 이 표를 «확정된 서열» 로 읽지 마라** — 가장 최근
  // 관측일 뿐이고 다음 측정에서 또 바뀔 수 있다.
  //
  // 그래도 갱신하는 이유: 순서는 `pickBetterLayout` 의 **동점 처리 한 자리**에만
  // 관여한다 (accepted → agreement → 선언 순서). agreement 가 다르면 순서와 무관하게
  // 높은 쪽이 이기므로 «틀린 답을 고르게» 만들 수 없다. 즉 **틀려도 복호가 안 망가진다** —
  // 되돌리기도 싸다. n=21 기본은 첫 원소가 되는 **v0t** 로 바뀐다.
  CELL_SURFACE_FINAL_V0T,
  CELL_SURFACE_FINAL_V0TR,
  CELL_SURFACE_FINAL_V0TRY,
  CELL_SURFACE_FINAL_V0TRQ,
  CELL_SURFACE_FINAL_V0TY,
]);

export const CELL_SURFACE_FINAL_PROFILE = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: 'cell-surface-v0',
  [CELL_SURFACE_FINAL_V2R2]: 'cell-surface-v2r2',
  [CELL_SURFACE_FINAL_V1R2]: 'cell-surface-v1r2',
  [CELL_SURFACE_FINAL_V0X]: 'cell-surface-v0x',
  [CELL_SURFACE_FINAL_V0XQ]: 'cell-surface-v0xq',
  [CELL_SURFACE_FINAL_V0W]: 'cell-surface-v0w',
  [CELL_SURFACE_FINAL_V0WQ]: 'cell-surface-v0wq',
  [CELL_SURFACE_FINAL_V0W2]: 'cell-surface-v0w2',
  [CELL_SURFACE_FINAL_V0WY]: 'cell-surface-v0wy',
  [CELL_SURFACE_FINAL_V0T]: 'cell-surface-v0t',
  [CELL_SURFACE_FINAL_V0TY]: 'cell-surface-v0ty',
  [CELL_SURFACE_FINAL_V0TR]: 'cell-surface-v0tr',
  [CELL_SURFACE_FINAL_V0TRQ]: 'cell-surface-v0trq',
  [CELL_SURFACE_FINAL_V0TRY]: 'cell-surface-v0try',
});

/** 신세대 셀 표면 formatIndex — 한 쌍뿐. 세 레이아웃이 같이 쓴다(신설 금지). */
export const CELL_SURFACE_FINAL_FORMAT_INDEX = FORMAT_INDEX_Y_FINAL;

/** 레이아웃별 허용 n. v2r2·v1r2 는 n=13 을 autoplace 가 거부한다(REF_QUADRANT). */
export const CELL_SURFACE_FINAL_NS = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: Object.freeze([13]),
  [CELL_SURFACE_FINAL_V2R2]: Object.freeze([21, 25]),
  [CELL_SURFACE_FINAL_V1R2]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0X]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0XQ]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0W]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0WQ]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0W2]: Object.freeze([21]),
  [CELL_SURFACE_FINAL_V0WY]: Object.freeze([21]),
  // **n=25 편입 (2026-08-25)** — 「면 모서리 기준 배치」(SPEC §4.11) 가 낸 길이다.
  // 블록 크기·변 inset 은 그대로고 **블록 사이 데이터 영역만** 늘어난다:
  // 파인더 셀 수가 21 과 25 에서 **같다**(v0t 104 · v0tr 102) — 그것이 이 편입의 근거다.
  //
  // **슬롯 계열 n=25 편입 (2026-08-25, 레인 QR25)** — 「QR 슬롯은 n 마다 위치 규범이
  // 없다」는 서술은 **이미 거짓이었다.** `centerQrSlotOriginFor(id, n)` 이 n 을 받고,
  // `seam` 은 (0,0) · `far` 는 (n−m, n−m) 이다. n=25 에서 세 레이아웃 모두
  // 슬롯 ⊂ [0, n−1]² · 슬롯 ∩ 파인더 = 0 · 슬롯 ∩ 레퍼런스/포맷 = 0
  // (실측 `lane-out/qr25-measure.mjs`). 파인더 셀 수도 21 과 **같다**
  // (v0ty 95 · v0trq 77 · v0try 93).
  [CELL_SURFACE_FINAL_V0T]: Object.freeze([21, 25]),
  [CELL_SURFACE_FINAL_V0TY]: Object.freeze([21, 25]),
  [CELL_SURFACE_FINAL_V0TR]: Object.freeze([21, 25]),
  [CELL_SURFACE_FINAL_V0TRQ]: Object.freeze([21, 25]),
  [CELL_SURFACE_FINAL_V0TRY]: Object.freeze([21, 25]),
});

/**
 * O/G 중앙 슬롯에 옮기는 v0의 원본 한 변. 숫자를 다시 적지 않고 최종 라인업의
 * 허용 n에서 유도한다 — v0 정본 크기가 바뀌면 중앙 렌더 피치도 함께 바뀌어야 한다.
 */
export const CENTRAL_V0_SOURCE_N = CELL_SURFACE_FINAL_NS[CELL_SURFACE_FINAL_V0][0];

/**
 * **실험판 드랍 (운영자 확정 2026-08-16) — 차단이지 삭제가 아니다.**
 *
 * 운영자 관측: 실기기 인식이 1\~5초 텀. v2r2 는 §P6(`test/output/claude-skew-real.md`)
 * 에서 **평가 예산 47.4 % 를 먹고 수용 0회**였고, v1r2 는 같은 n=21 에서 v0X 와
 * 반경이 같아 매 (중앙,코너) 쌍마다 refinePose 를 한 번 더 태우기만 했다.
 * 둘을 **검출 라인업(블록 로케이터 패밀리 · CS 평가 후보)과 생성기 카드**에서 내린다.
 *
 * 내리지 **않는** 것 (hex-frame-v1 전례 — 카드만 내리고 값은 보존):
 *   · 와이어 정의 — `CELL_SURFACE_FINAL_IDS` · `CELL_SURFACE_FINAL_NS` ·
 *     `CELL_SURFACE_FINAL_PROFILE` · `DECLARED_DATA`(현행·레거시 둘 다) 는 그대로다.
 *     `cellSurfaceFinal(21, 'v2r2')` 는 **여전히 만들어진다** — 발행된 프레임의
 *     판독·법의학·테스트 픽스처가 거기 걸려 있다.
 *   · 정본 배열(`V2R2_FAR_BASE_CELLS` · `V1R2_CELLS`) 과 자기검증.
 *   · 로케이터 패밀리 코드 — `csBlockLocator` 캘리브레이션의 `v2r2Family` ·
 *     `v1r2Family`(그리고 뒤이어 `v0xqFamily` · `v0xFamily`)를 **false 기본**으로
 *     내렸을 뿐이라, 교차 오수용 대조군은 옵션 한 줄로 되살아난다.
 *
 * **n=25 (Y2) 는 공백이 된다** — 그 슬롯을 채우던 것이 v2r2@25 뿐이었다.
 * `finalLayoutIdsForN(25) === []` 이고 `finalLayoutIdForN(25) === null` 이다.
 * 와이어 질의는 `hasFinalLayoutWireForN(25) === true` 로 계속 참이다.
 *
 * ── **v0XQ 드랍 (운영자 실기기 확정 2026-08-17)** ────────────────────────────
 *
 * v0W 편입 때 걸어 둔 **조건부 드랍 규칙**(«v0WQ > v0XQ» 이면 v0XQ 를 내린다)이
 * 실기기 판정으로 성립했다 — 관측 인식 순위 **v0WQ ≫ v0XQ > v0X ≈ v0W**.
 * 두 레이아웃은 «중앙 QR 슬롯 × 3코너 동심 사각» 이라는 같은 문법의 대조 실험이고
 * (위상 마커 블록 하나만 다르다 — §V0WQ_CELLS), 이긴 쪽이 정해졌으므로 진 쪽을
 * 검출 라인업·생성기 카드·스캐너 lab 패널에서 내린다. **차단이지 삭제가 아니다** —
 * 위 v2r2·v1r2 와 **같은 규약**이다.
 *
 * 내리지 **않는** 것 (v0xq 에만 있는 추가 항목):
 *   · `V0XQ_CORNER_CELLS` — v0W · v0WQ 의 NE 동심 사각이 **이 배열 자체**다
 *     (전사 사본이 아니라 같은 참조 — 자기검증 ①-d/①-e 가 참조 동일성으로 못 박는다).
 *     드랍은 «라인업에서 내린다» 이지 «정본을 지운다» 가 아니므로 이 배열은 물론이고
 *     그 원천인 `V0X_CELLS`·`V0X_BLOCKS`·`V0XQ_BLOCKS` 도 한 줄도 안 건드린다.
 *   · `CENTER_QR_SLOT_CELLS`(=9) · `centerQrSlotCellsFor` — v0xq 와이어 회계의 근거다.
 *   · `CELL_SURFACE_FINAL_LEGACY_IDS` 는 애초에 v0xq 를 안 갖는다 (포맷 v2 이후 신설).
 *
 * **(당시) n=21 의 기본은 v0X 그대로였다.** 드랍은 후보 목록에서 한 항목을 빼는
 * 것이지 순위를 다시 매기는 것이 아니다 — `finalLayoutIdsForN(21)` 이
 * `[v0x, v0xq, v0w, v0wq]` 에서 `[v0x, v0w, v0wq]` 로 줄고 `finalLayoutIdForN(21)` 은
 * `v0x` 로 불변이었다. (그 v0x 도 같은 날 3라운드에서 드랍된다 — 아래 §v0X 드랍.)
 *
 * ⚠ **v0WQ 는 v0XQ 의 코너 삼중점 경로를 공유한다.** 로케이터에서 v0xq 패밀리를
 * 내려도 v0wq 검출은 온전해야 한다 — 코너 수집 게이트가
 * `(cfg.v0xqFamily !== false || cfg.v0wqFamily !== false)` 라 한쪽만 꺼도 돈다
 * (`cellsurface-block-detect.js` §v0xqCorners). 그 성질을 회귀로 고정한 것이
 * `cellSurface-block-locator-v0xq.test.js` §v0XQ 드랍이다.
 *
 * ── **v0X 드랍 (운영자 실기기 확정 2026-08-17, 판정 3라운드)** ────────────────
 *
 * 관측 두 줄이 근거다 — 「파인더 인식 다 해놓고도 잘 못 읽음」 · 「v0 과 혼선 자주」.
 * 2라운드에서 «v0W > v0X» 가 «≈» 로 미결이었던 것은 **v0W2 가 없던 판정**이기
 * 때문이고, v0W2 편입(방향 margin 0.1512 = 활성 최고, v0X 0.1231 의 1.23배)으로
 * n=21 자리는 채워졌다. 진 후보를 검출 라인업·생성기 카드·스캐너 lab 패널에서
 * 내린다 — **차단이지 삭제가 아니다** (v2r2·v1r2·v0xq 와 **같은 규약**).
 *
 * 내리지 **않는** 것 (v0x 에만 있는 추가 항목 — 여기가 이 드랍의 함정이다):
 *   · `V0X_CELLS` · `V0X_BLOCKS` — **v0W2 SE(T/L) 유도의 원천 배열**이다.
 *     v0W2 의 SE 6×6 은 T·L 두 면에서 v0X SE 톤을 **같은 좌표로** 쓴다
 *     (§V0W2_CELLS · 자기검증 ①-h). 즉 v0x 정본을 한 줄이라도 지우면 **활성
 *     레이아웃 v0W2 가 무너진다.** 드랍은 «라인업에서 내린다» 이지 «정본을
 *     지운다» 가 아니다 — 상수·유도·참조 동일성 자기검증 전부 그대로 산다.
 *   · `V0XQ_CORNER_CELLS` — v0X SE 를 평행이동한 배열이고 v0W·v0WQ·v0W2 의 NE 가
 *     **그 배열 자체**다. v0xq 드랍에서 이미 같은 이유로 보존했다.
 *   · `DECLARED_DATA` 의 v0x 행(현행·레거시 둘 다) · `CELL_SURFACE_FINAL_NS` ·
 *     `CELL_SURFACE_FINAL_PROFILE` · `encodeOptionsForY` 의 v0X 분기 —
 *     `cellSurfaceFinal(21, 'v0x')` 는 **여전히 만들어진다**.
 *
 * **n=21 의 기본이 바뀐다 — 이 드랍만 그렇다.** 앞선 세 드랍은 기본이 아닌 후보를
 * 뺐지만 v0x 는 n=21 의 **기본**이었다. `finalLayoutIdsForN(21)` 이
 * `[v0x, v0w, v0wq, v0w2]` → `[v0w, v0wq, v0w2]` 로 줄고 `finalLayoutIdForN(21)` 은
 * **v0w** 로 승계된다 (선언 순서가 곧 후보 순서라 자동으로 그렇게 된다).
 * 운영자 순위·생성기 #22 연동의 «중 = v0W» 와 이 승계가 같은 값을 가리킨다.
 * `wirePreferredFinalLayoutIdForN(21)` 은 **v2r2 그대로** — 와이어는 발행 이력의
 * 기록이라 드랍을 보지 않는다.
 *
 * ⚠ **v0X 를 끄는 것은 v0W·v0W2 를 끄는 것이 아니다.** 셋은 앵커드 순회에서 서로
 * 독립한 `if` 로 시드된다 (`cfg.v0xFamily` 실패가 뒤 브랜치를 안 자르도록 2026-08-16
 * 에 `continue` 를 걷어낸 그 자리다 — §assembleAnchoredPoses). 그 독립성을 회귀로
 * 고정한 것이 `cellSurface-block-locator-v0x.test.js` §v0X 드랍이다.
 *
 * ── **v0W 계열 전체 드랍 (운영자 확정 2026-08-17, v0T 편입 라운드)** ──────────
 *
 * v0T 가 **Type Y 최종 파인더**로 확정되면서 v0W 계열 넷(v0w · v0wq · v0w2 · v0wy)을
 * 한꺼번에 내린다 — 검출 라인업·생성기 카드·스캐너 lab 기대 버튼에서만.
 * **차단이지 삭제가 아니다** (v2r2·v1r2·v0xq·v0x 와 **같은 규약** — 정본·와이어·
 * 복원 스위치 보존).
 *
 * 내리지 **않는** 것 — **정본 의존 실측이 근거다** (`claude-v0t-derive.mjs`):
 *   · `V0W_PHASE_CELLS` (= v0 SE 3×3 의 (+8,+8)) — **v0T 의 SE 비대칭 블록이
 *     이 배열 자체다** (참조 동일성 자기검증 ①-h). v0X 드랍 때 V0X_CELLS 가 활성
 *     v0W2 를 받치던 것과 같은 구조 — 지우면 새 기본 v0T 가 무너진다.
 *   · `V0XQ_CORNER_CELLS` — v0T 의 NE 동심 사각이 **그 배열 자체**다. v0xq·v0x
 *     드랍에서 이미 두 번 보존한 배열이고, 이제 소비자가 하나 더 늘었다.
 *   · `K3_CENTRE_CELLS`·`K3_CENTRE_SYMMETRIC_CELLS` — v0T 중앙 16셀의 유도 원천
 *     (v0W2 중앙과 같은 대칭화 규칙의 (0..3)² 부분).
 *   · `CENTER_QR_SLOT_CELLS_V0WQ` — **v0TY 슬롯 크기가 이 값의 참조**다 (운영자
 *     스펙 «v0WQ 슬롯과 동일 크기» — v0WY 와 같은 참조 사슬).
 *   · 넷의 정본 배열·자기검증·`DECLARED_DATA` 행·`CELL_SURFACE_FINAL_NS`·
 *     `CELL_SURFACE_FINAL_PROFILE`·`encodeOptionsForY` 분기 —
 *     `cellSurfaceFinal(21, 'v0w')` 등은 **여전히 만들어진다** (발행분 판독·법의학).
 *
 * **n=21 의 기본이 승계된다: v0w → v0t** (v0X 드랍과 같은 «기본 자체가 빠지는»
 * 드랍이다). `finalLayoutIdsForN(21)` 이 `[v0w, v0wq, v0w2, v0wy]` 에서
 * **`[v0t, v0ty]`** 로 바뀌고 `finalLayoutIdForN(21)` 은 **v0t** 다 (선언 순서
 * 승계 — v0T 가 v0WY 뒤, 활성 첫 항목). `wirePreferredFinalLayoutIdForN(21)` 은
 * **v2r2 그대로** — 와이어는 발행 이력의 기록이라 드랍을 보지 않는다.
 *
 * ⚠ **넷은 로케이터에서 서로 독립한 스위치로 내려간다** (`v0wFamily` ·
 * `v0wqFamily` · `v0w2Family` · `v0wyFamily` 기본 false) — 하나만 켜면 그 패밀리의
 * 드랍 전 동작이 그대로 돌아온다 (교차 오수용 대조군·법의학). v0wq 를 꺼도 코너
 * 수집은 `centreBullseyeConfirmedPoses` 가 살아 있는 한 돈다 (§v0xqCorners 게이트).
 */
export const CELL_SURFACE_FINAL_DROPPED_IDS = Object.freeze([
  CELL_SURFACE_FINAL_V2R2,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V0XQ,
  CELL_SURFACE_FINAL_V0X,
  CELL_SURFACE_FINAL_V0W,
  CELL_SURFACE_FINAL_V0WQ,
  CELL_SURFACE_FINAL_V0W2,
  CELL_SURFACE_FINAL_V0WY,
]);

/** 이 레이아웃이 검출 라인업·생성기 카드에서 내려갔는가 (와이어는 살아 있다). */
export function isDroppedFinalLayout(id) {
  return CELL_SURFACE_FINAL_DROPPED_IDS.includes(id);
}

/** 라인업에 살아 있는 id — 선언 순서 그대로. */
export const CELL_SURFACE_FINAL_ACTIVE_IDS = Object.freeze(
  CELL_SURFACE_FINAL_IDS.filter((id) => !CELL_SURFACE_FINAL_DROPPED_IDS.includes(id)),
);

/**
 * n → **와이어** 선호 레이아웃 (드랍을 보지 않는다). 발행 이력의 기록이다 —
 * 드랍 전 `finalLayoutIdForN` 이 돌려주던 값과 같다.
 */
const WIRE_PREFERRED_BY_N = Object.freeze({
  13: CELL_SURFACE_FINAL_V0,
  21: CELL_SURFACE_FINAL_V2R2,
  25: CELL_SURFACE_FINAL_V2R2,
});

/**
 * 와이어 수준으로 이 n 을 갖는 레이아웃이 하나라도 있는가 — **드랍 포함**.
 * 「이 n 을 읽을 수 있나」 를 묻는 자리에 쓴다(`finalLayoutIdForN !== null` 은
 * 「이 n 이 라인업에 있나」 라서 드랍 뒤 n=25 에서 갈라진다).
 */
export function hasFinalLayoutWireForN(n) {
  return WIRE_PREFERRED_BY_N[n] !== undefined;
}

/** n → 와이어 선호 레이아웃 id (드랍 포함). 와이어 밖 n 은 null. */
export function wirePreferredFinalLayoutIdForN(n) {
  const id = WIRE_PREFERRED_BY_N[n];
  return id === undefined ? null : id;
}

/**
 * n → 그 n 에서 **라인업에 살아 있는** 레이아웃 후보 전부 (기본이 맨 앞).
 * 라인업 밖 n 은 []. 디코더 CS 평가의 병행 채점 입력이다 — 수용은 기존 게이트가 판정한다.
 *
 * 드랍 후(2026-08-17 v0XQ·**v0X** 포함): n=13 → [v0] · n=21 → **[v0w, v0wq, v0w2]** ·
 * n=25 → **[]**.
 */
export function finalLayoutIdsForN(n) {
  const ids = [];
  const preferred = WIRE_PREFERRED_BY_N[n];
  if (preferred === undefined) return Object.freeze(ids);
  if (!isDroppedFinalLayout(preferred)) ids.push(preferred);
  for (const id of CELL_SURFACE_FINAL_IDS) {
    if (id === preferred || isDroppedFinalLayout(id)) continue;
    if (CELL_SURFACE_FINAL_NS[id].includes(n)) ids.push(id);
  }
  return Object.freeze(ids);
}

/**
 * n → 그 n 의 **기본**(라인업에 살아 있는 첫) 레이아웃 id. 라인업 밖 n 은 null.
 *
 * **v0X 드랍(2026-08-17 3라운드) 후 n=21 의 기본은 v0W 다** — 드랍은 순위를 다시
 * 매기지 않지만 이번엔 **기본 자체가 빠져** 선언 순서의 다음(v0w)이 승계했다.
 * 앞선 세 드랍과 다른 점이 그것 하나다. n=25 는 계속 null 이다 (Y2 공백).
 */
export function finalLayoutIdForN(n) {
  const ids = finalLayoutIdsForN(n);
  return ids.length > 0 ? ids[0] : null;
}

/**
 * n → 그 n 의 **와이어** 레이아웃 후보 전부 — **드랍 포함** (와이어 선호가 맨 앞).
 * 드랍 전 `finalLayoutIdsForN` 이 돌려주던 목록과 같다.
 * 법의학·대조군 경로 전용이다 (`cellSurfaceY-detect.js` 의
 * `includeDroppedCellSurfaceLayouts` 옵션 · 「차단·비삭제」의 증명).
 */
export function allFinalLayoutIdsForN(n) {
  const ids = [];
  const preferred = WIRE_PREFERRED_BY_N[n];
  if (preferred === undefined) return Object.freeze(ids);
  ids.push(preferred);
  for (const id of CELL_SURFACE_FINAL_IDS) {
    if (id === preferred) continue;
    if (CELL_SURFACE_FINAL_NS[id].includes(n)) ids.push(id);
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
    // v0w: 441 − 70(파인더 25+36+9) − 12 − 18 = 341. 편집기 팩 counts.data 와 같지만
    // 이 값의 근거는 팩이 아니라 autoplace 재산출이다 (claude-v0w-derive.mjs §④).
    [CELL_SURFACE_FINAL_V0W]: Object.freeze({ 21: 341 }),
    // v0wq: 441 − 45(파인더 36+9) − 64(중앙 QR 슬롯 8²) − 12 − 18 = 302.
    // 슬롯 8 은 v0xq 에서 베낀 값이 아니다 — autoplace 상한은 9 인데
    // (`claude-v0wq-probe.mjs`) **인코더 정합 ⑤ 가 9 를 거부해** 8 로 내려앉았다
    // (§CENTER_QR_SLOT_CELLS_V0WQ).
    [CELL_SURFACE_FINAL_V0WQ]: Object.freeze({ 21: 302 }),
    // v0w2: 441 − 97(파인더 25+36+36) − 12 − 18 = 314. 편집기 팩 counts.data 와 같은
    // 값이지만 이 값의 근거는 팩이 아니라 autoplace 재산출이다
    // (`test/output/lanes/claude-v0w2-derive.mjs` §⑥ · 자기검증 ①-f).
    [CELL_SURFACE_FINAL_V0W2]: Object.freeze({ 21: 314 }),
    // v0wy: 441 − 67(파인더 25+36+6) − 64(먼 코너 QR 슬롯 8²) − 12 − 18 = 280.
    // 슬롯 8 은 운영자 스펙(«v0WQ 슬롯과 동일 크기»)이 정한 값이고, 그 값에서
    // 파인더 구성을 고른 것이 §CELL_SURFACE_FINAL_V0WY 의 후보 (c) 다.
    [CELL_SURFACE_FINAL_V0WY]: Object.freeze({ 21: 280 }),
    // v0t: 441 − 104(파인더 16+9+10+36+24+9) − 12 − 18 = 307. 편집기 팩 counts.data 와
    // 같은 값이지만 근거는 팩이 아니라 autoplace 재산출이다 (`claude-v0t-probe.mjs`).
    // v0t@25: 625 − 104(파인더 — 21 과 **같다**) − 12 − 18 = 491.
    [CELL_SURFACE_FINAL_V0T]: Object.freeze({ 21: 307, 25: 491 }),
    // v0ty: 441 − 95(파인더 104−SE 9) − 64(먼 코너 QR 슬롯 8²) − 12 − 18 = 252.
    // 슬롯 8 은 운영자 스펙(«v0WQ·v0WY 와 동일 크기») — autoplace 수용 상한도 8 이라
    // 두 자가 같은 값을 가리킨다 (`claude-v0tqty-probe.mjs` §①).
    // v0ty@25: 625 − 95(파인더 — 21 과 **같다**) − 64 − 12 − 18 = 436.
    [CELL_SURFACE_FINAL_V0TY]: Object.freeze({ 21: 252, 25: 436 }),
    // v0tr: 441 − 102(파인더 16 + A 9 + NE 68 + SE 9) − 12 − 18 = 309. 근거는 팩이 아니라
    // autoplace 재산출이다 (`claude-v0tr-measure.mjs` ⓓ — S=106 · 잔여 0).
    // v0tr@25: 625 − 102(파인더 — 21 과 **같다**) − 12 − 18 = 493.
    [CELL_SURFACE_FINAL_V0TR]: Object.freeze({ 21: 309, 25: 493 }),
    // v0trq: 441 − 77(파인더 102 − 중앙 16 − A 9) − 64(중앙 QR 슬롯 8²) − 12 − 18 = 270.
    // 팩 counts.data 와 같은 값이지만 근거는 팩이 아니라 autoplace 재산출이다.
    // v0trq@25: 625 − 77(파인더 — 21 과 **같다**) − 64 − 12 − 18 = 454.
    [CELL_SURFACE_FINAL_V0TRQ]: Object.freeze({ 21: 270, 25: 454 }),
    // v0try: 441 − 93(파인더 102 − SE 9) − 64(먼 코너 슬롯 8²) − 12 − 18 = 254.
    // **잔여 2** (254 = 3×84 + 2) — v0t@21 잔여 1 에 이은 두 번째 사례다.
    // 근거는 autoplace 재산출 (`claude-v0try-measure.mjs` ⓓ — S=84 · S_fmt 333 ≥ 289).
    // v0try@25: 625 − 93(파인더 — 21 과 **같다**) − 64 − 12 − 18 = 438 · S=146 · 잔여 0.
    [CELL_SURFACE_FINAL_V0TRY]: Object.freeze({ 21: 254, 25: 438 }),
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
 *
 * v0W · v0WQ 도 같다 — 2026-08-16 신설이라 포맷 v1 로 발행된 프레임이 존재하지 않는다.
 * (v0W 는 ⑤ 예산에는 걸리지 않지만, 「읽을 프레임이 세상에 없는 코드를 유지하지
 * 않는다」 는 같은 이유로 빠진다. 신설 레이아웃의 기본값은 «레거시 없음» 이다.)
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
 * v1r2 이후 셀 표면 파인더 정본을 처음 계측한 면 한 변. 이 값은 지원 버전이 아니라
 * **inset 원본 좌표계**다. 실제 좌표는 아래 `farEdgeCell` 로 매 n 에서 다시 낸다.
 * v0(n=13)은 운영자 지정 예외라 이 기준을 쓰지 않는다.
 */
export const CELL_SURFACE_EDGE_ANCHOR_BASE_N = 21;

function assertEdgeAnchorN(n) {
  if (!Number.isSafeInteger(n) || n < CELL_SURFACE_EDGE_ANCHOR_BASE_N) {
    throw new RangeError(
      '면 모서리 기준 파인더 n 은 '
      + CELL_SURFACE_EDGE_ANCHOR_BASE_N + ' 이상의 안전한 정수여야 한다: ' + n,
    );
  }
  return n;
}

/** 높은 쪽 변의 마지막 셀(n−1)에서 `inset`칸 안쪽인 좌표. */
function farEdgeCell(n, inset) {
  return assertEdgeAnchorN(n) - 1 - inset;
}

/** n=21 원본 좌표를 높은 쪽 변에서 같은 inset인 좌표로 옮긴다. */
function moveFarEdgeCoordinate(value, n) {
  return farEdgeCell(n, CELL_SURFACE_EDGE_ANCHOR_BASE_N - 1 - value);
}

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
 * 컴팩트 전사. 이 배열은 n=21 **톤 원본**이고 실제 좌표는 면 모서리 inset으로 인스턴스화한다.
 * 파인더 점유 = **toneOverrides 가 닿는 (i,j) 전체**다
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
 * (운영자 제공 2026-08-16 · **정규화 2026-08-16 승인**) 컴팩트 전사. 이 배열은
 * n=21 **톤 원본**이고 실제 좌표는 면 모서리 inset으로 인스턴스화한다.
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
 * v0X 블록 범위 — 낮은 변은 절대 inset, 높은 변은 n−1에서의 inset으로 정의한다.
 * SINGLE 은 단독 셀이라 블록이 아니다 (패치로 쓸 수 없다 — Pearson 최소 6점).
 */
function v0xBlocksForN(n) {
  assertEdgeAnchorN(n);
  return Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    NE: Object.freeze({ iMax: 1, jMin: farEdgeCell(n, 2) }),
    SW: Object.freeze({ iMin: farEdgeCell(n, 2), jMax: 1 }),
    SE: Object.freeze({ iMin: farEdgeCell(n, 5), jMin: farEdgeCell(n, 5) }),
    SINGLE: Object.freeze({ i: farEdgeCell(n, 6), j: farEdgeCell(n, 0) }),
  });
}

/** n=21 발행 와이어 호환 별칭. 새 배치는 `blocksCellSurfaceFinalForN` 을 쓴다. */
export const V0X_BLOCKS = v0xBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

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
/** n=21 톤 원본에서 v0X SE를 NE로 옮기는 거리. 일반 n 좌표는 edge-anchor가 다시 낸다. */
const V0XQ_BASE_CORNER_SHIFT = 15;

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
    return Object.freeze([i - V0XQ_BASE_CORNER_SHIFT, j, nT, nL, nR]);
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
 * v0WQ 의 슬롯 한 변 — **8 이다. 9 가 아니다.**
 *
 * autoplace 상한은 v0xq 와 같은 9 로 나왔다 (`claude-v0wq-probe.mjs`: m ≤ 9 수용 ·
 * m ≥ 10 `AUTOPLACE_REF_QUADRANT`). 그런데 m=9 는 **자기검증 ⑤(인코더 정합)에서
 * 죽는다**: data 285 → S=95 → ECC-H 예산 57심볼인데, base-211 청크 패커에는
 * 57심볼에 **정확히** 맞는 바이트 수가 없다 (54 B → 56심볼 · 55 B → 58심볼).
 * `decode.finishProfile` 이 그 불일치를 «이 포맷은 현행 인코더가 생성할 수 없다» 로
 * 거부하므로 — 그 게이트는 **손대지 않는다** — 슬롯을 한 칸 내려 예산을 옮긴다.
 *
 * m=8: data 302 · S=100 · 잔여 2 · ECC L/M/H 예산 88/75/60 전부 정합.
 * 부수 효과 둘 (대조표에 그대로 실린다):
 *   · payload 가 **늘어난다** — 84/72/57 B 대 v0XQ 의 80/67/54 B (data 302 vs 288).
 *   · QR 모듈이 **작아진다** — 피치 8/29 = 0.2759셀 대 v0XQ 의 9/29 = 0.3103셀.
 *     즉 «데이터를 더 싣고 중앙 QR 은 더 잘게» 가 v0WQ 의 자리다.
 *
 * 그래서 슬롯 상한은 여전히 autoplace 가 정하고(9), 그 안에서 **인코더 정합이
 * 실제 값을 정한다**(8). 둘 중 어느 것도 이 레인이 고른 값이 아니다.
 */
export const CENTER_QR_SLOT_CELLS_V0WQ = 8;

/**
 * v0WY 의 슬롯 한 변 — **운영자 스펙이 «v0WQ 와 동일 크기» 로 못 박았다** (8×8 = 64셀).
 * 그래서 이 값은 유도가 아니라 **v0WQ 값의 참조**다 (숫자 8 을 다시 적으면 v0WQ 가
 * 바뀔 때 조용히 갈린다). 자기검증 ①-g 가 두 값의 동일성을 못 박는다.
 *
 * autoplace 를 다시 물을 필요는 있었다 — 점유 집합이 v0WQ 와 다르기 때문이다
 * (슬롯이 NW 사분면이 아니라 **먼 코너**라 레퍼런스 L자 규칙에 걸리는 자리가 다르고,
 * 파인더도 25+36+6 으로 다르다). 실측 수용 (`claude-v0wy-design.mjs`).
 */
export const CENTER_QR_SLOT_CELLS_V0WY = CENTER_QR_SLOT_CELLS_V0WQ;

/**
 * v0TY 의 슬롯 한 변 — **운영자 스펙이 «v0WQ·v0WY 와 동일 크기» 로 못 박았다**
 * (8×8 = 64셀). v0WY 와 같은 참조 사슬이다 (숫자 8 을 다시 적지 않는다).
 *
 * autoplace 는 다시 물었다 — 점유 집합이 v0WY 와 다르기 때문이다 (파인더 95 =
 * v0T − SE 9). 실측 수용 m=4..8 · 상한 8 (`claude-v0tqty-probe.mjs` §① — m=9 는
 * 포맷 복제 이격 S_fmt=260 < 289 로 거부). 인코더 정합 ⑤ 도 m=8 에서 통과라
 * 운영자 스펙·autoplace 상한·⑤ 세 자가 같은 값 8 을 가리킨다.
 */
export const CENTER_QR_SLOT_CELLS_V0TY = CENTER_QR_SLOT_CELLS_V0WQ;

/**
 * v0TRQ 의 슬롯 한 변 — **v0WQ·v0WY·v0TY 와 같은 8** (같은 참조 사슬 · 숫자 8 재기입 금지).
 *
 * 이 값은 정본 팩이 준 값이고(운영자 편집기 export 의 슬롯 8×8 = 64셀), autoplace 와
 * 인코더 정합 ⑤ 가 **둘 다 그 값을 수용**한다 (`claude-v0tr-measure.mjs` ⓓ:
 * S_fmt 340 ≥ 289 · L/M/H = 76/64/52 B 전부 정합). v0WQ 에서 m=9 를 ⑤ 가 거부해
 * 8 로 내려앉은 것과 달리, 여기서는 세 자(팩·autoplace·⑤)가 처음부터 같은 8 을 가리킨다.
 *
 * 중앙 슬롯인데도 서는 것이 **v0TQ 와 갈리는 지점**이다 — §CELL_SURFACE_FINAL_V0TRQ.
 */
export const CENTER_QR_SLOT_CELLS_V0TRQ = CENTER_QR_SLOT_CELLS_V0WQ;

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

/**
 * QR 슬롯을 갖는 레이아웃 — v0xq · v0wq · v0wy · **v0ty** · **v0trq** · **v0try**.
 * 데이터도 파인더도 아닌 제3 역할.
 */
const CENTER_QR_SLOT_IDS = Object.freeze([
  CELL_SURFACE_FINAL_V0XQ,
  CELL_SURFACE_FINAL_V0WQ,
  CELL_SURFACE_FINAL_V0WY,
  CELL_SURFACE_FINAL_V0TY,
  CELL_SURFACE_FINAL_V0TRQ,
  CELL_SURFACE_FINAL_V0TRY,
]);

/**
 * 레이아웃 → QR 슬롯 한 변(셀). 슬롯이 없으면 0.
 * **렌더러(sceneY)·로케이터(block-detect)·회계가 전부 이 함수 하나를 본다** —
 * 세 레이아웃이 서로 다른 m 을 쓸 수 있으므로 상수 하나로는 못 버틴다.
 */
export function centerQrSlotCellsFor(id) {
  if (id === CELL_SURFACE_FINAL_V0XQ) return CENTER_QR_SLOT_CELLS;
  if (id === CELL_SURFACE_FINAL_V0WQ) return CENTER_QR_SLOT_CELLS_V0WQ;
  if (id === CELL_SURFACE_FINAL_V0WY) return CENTER_QR_SLOT_CELLS_V0WY;
  if (id === CELL_SURFACE_FINAL_V0TY) return CENTER_QR_SLOT_CELLS_V0TY;
  if (id === CELL_SURFACE_FINAL_V0TRQ) return CENTER_QR_SLOT_CELLS_V0TRQ;
  // v0TRY 는 **v0TY 의 값을 그대로 재사용**한다 — 새 상수를 만들지 않는다
  // (운영자 지시 «슬롯 크기·뒤집기 규약은 v0TY 와 동일하게 재사용, 새 상수 신설 금지»).
  // 같은 먼 코너 슬롯 8×8 이므로 참조가 곧 규약이다.
  if (id === CELL_SURFACE_FINAL_V0TRY) return CENTER_QR_SLOT_CELLS_V0TY;
  return 0;
}

/**
 * QR 슬롯의 **앵커와 방향 규약** — v0WY 편입(2026-08-17)으로 «중앙 QR» 이 더 이상
 * 유일한 배치가 아니게 됐다. 렌더러와 디코더가 이 표 하나를 본다 (둘이 각자 적으면
 * 조용히 어긋난다 — v0WQ 슬롯 8 을 상수 하나로 쓰다 깨진 그 자리와 같은 함정).
 *
 * | 앵커 | 슬롯 원점 | 실루엣 위치 (T·L·R) | 뒤집기 |
 * |---|---|---|---|
 * | `seam` (v0xq·v0wq) | (0,0) | 전부 **중앙**(Y-심) | 없음 — 파인더 셋이 중앙에 모인다 |
 * | `far` (v0wy) | (n−m, n−m) | T 상단 C0 · L 좌하 C4 · R 우하 C2 | **있음** — 윈도 β 규약 |
 *
 * 뒤집기 규약의 근거는 서로 다르다:
 *   · `seam` 은 «파인더 셋이 중앙에 모이는 편이 낫다» — 그 직각 삼중점이 그대로
 *     중앙 앵커가 되기 때문이다 (`sceneY.js` §renderCenterQr).
 *   · `far` 는 **윈도 β 와 같은 뒤집기** (정렬 패턴 코너가 큐브 안쪽 = Y-심 쪽).
 *     운영자 스펙이 «윈도 β 식» 이라고 지정했고, 한 코드 안에서 두 QR 이 다른 방향으로
 *     눕는 것을 막는다 (ADR 0003 D1 방향 확정의 연장).
 */
const CENTER_QR_SLOT_PLACEMENT = Object.freeze({
  [CELL_SURFACE_FINAL_V0XQ]: Object.freeze({ anchor: 'seam', flip: false }),
  [CELL_SURFACE_FINAL_V0WQ]: Object.freeze({ anchor: 'seam', flip: false }),
  [CELL_SURFACE_FINAL_V0WY]: Object.freeze({ anchor: 'far', flip: true }),
  // v0TY — v0WY 와 같은 먼 코너 배치·같은 뒤집기 규약 (윈도 β 식 방향).
  [CELL_SURFACE_FINAL_V0TY]: Object.freeze({ anchor: 'far', flip: true }),
  // v0TRQ — v0xq·v0wq 와 같은 Y-심 중앙 배치. 정본 팩의 슬롯 origin 이 (0,0) 이다.
  [CELL_SURFACE_FINAL_V0TRQ]: Object.freeze({ anchor: 'seam', flip: false }),
  // v0TRY — v0WY·v0TY 와 **같은 행**이다 (먼 코너 · 윈도 β 뒤집기). 값을 새로 고르지
  // 않고 v0TY 규약을 그대로 재사용한 것이다 (한 코드 안에서 두 QR 이 다른 방향으로
  // 눕는 것을 막는 ADR 0003 D1 의 연장).
  [CELL_SURFACE_FINAL_V0TRY]: Object.freeze({ anchor: 'far', flip: true }),
});

/** 레이아웃 → 슬롯 배치 규약. 슬롯 없는 레이아웃은 null. */
export function centerQrSlotPlacementFor(id) {
  const placement = CENTER_QR_SLOT_PLACEMENT[id];
  return placement === undefined ? null : placement;
}

/**
 * 레이아웃 → 슬롯 원점 (셀 인덱스). 슬롯 없는 레이아웃은 null.
 * `far` 앵커는 **n 종속**이다 — 먼 코너 고정이라 (n−m, n−m) 이다.
 */
export function centerQrSlotOriginFor(id, n) {
  const placement = centerQrSlotPlacementFor(id);
  if (placement === null) return null;
  if (placement.anchor === 'seam') return Object.freeze({ i: 0, j: 0 });
  const side = centerQrSlotCellsFor(id);
  return Object.freeze({ i: n - side, j: n - side });
}

/**
 * QR 파인더 3개의 **암 코어** 슬롯-로컬 (a,b) 파라메트릭 좌표 (셀 단위).
 * 렌더러가 그리는 자리와 디코더가 재는 자리를 **같은 함수**에서 낸다 — 뒤집기 규약이
 * 한쪽에만 반영되면 «QR 다움» 판별이 조용히 엉뚱한 3점을 보게 된다.
 */
export function centerQrFinderCoreCells(slotCells, flip = false) {
  const pitch = centerQrModulePitchCells(slotCells);
  return Object.freeze(CENTER_QR_FINDER_MODULES.map(({ qx, qy }) => {
    const u = flip ? (CENTER_QR_MODULE_GRID - 1 - qx) : qx;
    const v = flip ? (CENTER_QR_MODULE_GRID - 1 - qy) : qy;
    return Object.freeze({
      a: (CENTER_QR_QUIET_MODULES + u + 0.5) * pitch,
      b: (CENTER_QR_QUIET_MODULES + v + 0.5) * pitch,
    });
  }));
}

/** QR 슬롯 셀 (레이아웃별 · 절대 셀 인덱스). 슬롯 없는 레이아웃은 빈 배열. */
function slotCellsFor(id, n) {
  const side = centerQrSlotCellsFor(id);
  if (side === 0) return Object.freeze([]);
  const origin = centerQrSlotOriginFor(id, n);
  const cells = [];
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      cells.push(Object.freeze({ i: origin.i + i, j: origin.j + j }));
    }
  }
  return Object.freeze(cells);
}

/** v0xq 블록 범위 — 로케이터 패치·검출기가 같은 n 종속 정의를 쓴다. */
function v0xqBlocksForN(n) {
  assertEdgeAnchorN(n);
  return Object.freeze({
    /** 3코너 동심 사각 (NE 사분면) — T 좌상 · R 우상 · L 하단. */
    CORNER: Object.freeze({ iMax: 5, jMin: farEdgeCell(n, 5) }),
    /** 위상 마커 (SW 사분면) — T 우상 · L 좌상 · R 하단. */
    MARKER: Object.freeze({ iMin: farEdgeCell(n, 2), jMax: 1 }),
    /** 중앙 QR 슬롯 (NW 사분면). */
    SLOT: Object.freeze({ iMax: CENTER_QR_SLOT_CELLS - 1, jMax: CENTER_QR_SLOT_CELLS - 1 }),
  });
}

/** v1r2 네 코너 블록의 셀 범위 — 네 변에서의 inset으로만 정의한다. */
function v1r2BlocksForN(n) {
  assertEdgeAnchorN(n);
  return Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 3, jMin: farEdgeCell(n, 4) }),
    SW: Object.freeze({ iMin: farEdgeCell(n, 4), jMax: 3 }),
    SE: Object.freeze({ iMin: farEdgeCell(n, 4), jMin: farEdgeCell(n, 4) }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0XQ_BLOCKS = v0xqBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);
export const V1R2_BLOCKS = v1r2BlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * v2r2 중앙 블록 A = **v1r2 NW 5×5 와 같은 정본 공유** (2026-08-16 in-place 개정).
 * 전사 사본이 아니라 V1R2_CELLS 에서 필터로 유도한다 — 두 레이아웃의 중앙이
 * 문자 그대로 같은 배열에서 나오므로 어긋날 수 없다 (v0/v1r2/v2r2 K3 중앙 통일).
 */
const V2R2_CENTER_CELLS = Object.freeze(V1R2_CELLS.filter(
  ([i, j]) => i <= V1R2_BLOCKS.NW.iMax && j <= V1R2_BLOCKS.NW.jMax,
));

/**
 * ── v0W (운영자 신설 설계 2026-08-16) ─────────────────────────────────────
 *
 * 세 블록이 **전부 기존 정본에서 유도**된다 (모듈 헤더 §v0W · 재검산 스크립트
 * `test/output/lanes/claude-v0w-derive.mjs`). 손 좌표표가 한 줄도 없다:
 *
 * | 블록 | 셀 | 출처 (같은 배열/평행이동) | canonical 반경·방향 (면 T) |
 * |---|---|---|---|
 * | NW (0..4)²        | 25 | `V2R2_CENTER_CELLS` = v1r2 NW 5×5 **같은 배열** | 2.0셀 (중앙) |
 * | NE (0..5)×(15..20)| 36 | `V0XQ_CORNER_CELLS` = v0X SE 를 (i−15, j) 평행이동 | 16.7033셀 · −141.1° |
 * | SE (18..20)²      |  9 | v0 SE 3×3 을 (+8, +8) 평행이동 (n 차 21−13) | 19.0셀 · −90.0° |
 *
 * **역할 분담** (v0xq 와 정확히 뒤집힌 구성이다):
 *   · 중앙 = K3 불스아이 → v0·v0X·v1r2·v2r2 와 **같은 중앙 서명**을 공유한다.
 *     그래서 v0W 는 v0xq 와 달리 앵커드(중앙×원거리) 시딩 경로를 그대로 탄다.
 *   · NE 동심 사각 = 3면 동일 톤이라 세 면이 같은 K5 회문 코어를 낸다 → **120°
 *     쌍둥이 코어 3개**(v0X 의 «사각 링 동반자» 와 같은 신호). 위상 판별력은 0.
 *   · SE 3×3 = T·L 이 상단행+좌열 L자, R 이 중앙 1점. **면 비대칭이라 120° 위상의
 *     유일한 원천**이다. v0 의 코너 블록을 그대로 가져왔으므로 «작아도 읽히는»
 *     이력이 붙어 있다.
 *
 * v0X 와의 차이는 **동심 사각이 어느 삼중점에 앉느냐**다. v0X 는 먼 꼭짓점
 * (C0·C2·C4, r=18.0), v0W 는 심(seam) 꼭짓점 (C1·C3·C5, r=16.7033) 이다.
 * 두 반경 차 1.30셀은 `ANCHOR_SNAP_CELLS`(3.2) 안이라 **거리로는 못 가른다** —
 * 가르는 것은 패치 Pearson 과 CS 게이트다 (`cellsurface-block-detect.js` §v0W).
 */
/** v0 정본의 먼 코너 블록 하한 (n=13 캔버스) — `blockLimitsFor(13).farLimit` 와 같은 값. */
const V0_FAR_MIN = 10;
const V0_BASE_N = 13;
/** n=21 톤 원본을 만들 때만 쓰는 이동량. 일반 n 좌표는 edge-anchor 인스턴스가 낸다. */
const V0W_BASE_FAR_SHIFT = CELL_SURFACE_EDGE_ANCHOR_BASE_N - V0_BASE_N;

/**
 * K3 불스아이 중앙 정본. `V2R2_CENTER_CELLS` 와 **같은 참조**다 — 이름을 하나 더 두는
 * 이유는 v2r2 가 드랍됐기 때문이다. v0W 중앙을 `V2R2_CENTER_CELLS` 로 부르면
 * «드랍된 것에 기대는 것처럼» 읽히는데, 실제로는 v1r2 NW 5×5 라는 공유 정본이다.
 */
const K3_CENTRE_CELLS = V2R2_CENTER_CELLS;

/** v0 SE 3×3 → v0W 위상 마커 (평행이동만 · 톤 변경 0). */
const V0W_PHASE_CELLS = Object.freeze(V0_CELLS
  .filter(([i, j]) => i >= V0_FAR_MIN && j >= V0_FAR_MIN)
  .map(([i, j, T, L, R]) =>
    Object.freeze([i + V0W_BASE_FAR_SHIFT, j + V0W_BASE_FAR_SHIFT, T, L, R])));

const V0W_CELLS = Object.freeze([
  ...K3_CENTRE_CELLS,
  ...V0XQ_CORNER_CELLS,
  ...V0W_PHASE_CELLS,
]);

/** v0W 블록 범위 — 로케이터 패치·검출기가 같은 n 종속 정의를 쓴다. */
function v0wBlocksForN(n) {
  const v1r2 = v1r2BlocksForN(n);
  const v0xq = v0xqBlocksForN(n);
  return Object.freeze({
    /** K3 불스아이 중앙 (NW 사분면). */
    NW: Object.freeze({ iMax: v1r2.NW.iMax, jMax: v1r2.NW.jMax }),
    /** 3면 동일 동심 사각 (NE 사분면) — 심 꼭짓점 셋. */
    NE: Object.freeze({ iMax: v0xq.CORNER.iMax, jMin: v0xq.CORNER.jMin }),
    /** 위상 마커 (SE 사분면) — v0 코너 블록. T=L·R≠ 비대칭. */
    SE: Object.freeze({ iMin: farEdgeCell(n, 2), jMin: farEdgeCell(n, 2) }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0W_BLOCKS = v0wBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0WQ (v0W 파생 ① — 중앙 QR 슬롯, 2026-08-16 운영자 지시) ────────────────
 *
 * **v0XQ 와 위상 마커 블록 하나만 다르다.** 셋을 나란히 놓으면 설계가 보인다:
 *
 * | | 중앙 | 동심 사각 (NE) | 위상 마커 | 파인더 | 슬롯 | data |
 * |---|---|---|---|---|---|---|
 * | v0W  | K3 불스아이 25 | 36 | **SE 3×3 (v0) 9** | 70 | 0 | 341 |
 * | v0XQ | **QR 슬롯 9²** | 36 | SW (v0X) 6 | 42 | 81 | 288 |
 * | v0WQ | **QR 슬롯 8²** | 36 | **SE 3×3 (v0) 9** | 45 | 64 | **302** |
 *
 * 즉 v0WQ = «v0W 의 위상 마커 × v0XQ 의 중앙». 중앙 K3 를 슬롯이 가져가므로
 * v0W 의 앵커드(중앙 × 원거리) 시딩이 성립하지 않고, **v0xq 와 같은 코너 삼중점
 * 경로**를 탄다 (`cellsurface-block-detect.js` §v0wq). 동심 사각이 같은 배열·같은
 * 자리라 코어 반경도 √279 로 v0xq 와 **같다** — 두 패밀리를 가르는 것은 거리가
 * 아니라 위상 마커 패치와 CS 게이트다 (v0X ↔ v0W 와 같은 구조).
 *
 * 정본은 또 **유도**다 (손 좌표표 0):
 *   · NE 동심 사각 36 = `V0XQ_CORNER_CELLS` **같은 배열**
 *   · SE 위상 마커 9 = `V0W_PHASE_CELLS` **같은 배열** (v0 SE 3×3 의 (+8,+8) 이동)
 * 그래서 v0X SE 나 v0 SE 가 조용히 바뀌면 v0WQ 도 같이 터진다 (자기검증 ①-e).
 *
 * 회계: 441 − 45 − 64 − 12 − 18 = 302 · S=100 · 잔여 2.
 * 슬롯은 **묻는 쪽이 둘**이다. ① autoplace 상한 — 점유 집합이 v0xq 와 다르므로 다시
 * 물었고 m=4..9 수용 · m≥10 `AUTOPLACE_REF_QUADRANT` 거부였다
 * (`test/output/lanes/claude-v0wq-probe.mjs`). 상한이 v0xq 와 같은 9 로 나온 것은
 * 결과지 전제가 아니다 — 묶는 것이 NW 사분면 레퍼런스 L자 규칙이라 파인더 집합에
 * 둔감하기 때문이다. ② **인코더 정합**(자기검증 ⑤) — m=9 의 S=95 는 ECC-H 예산
 * 57심볼에 맞는 바이트 수가 없어 거부된다. 그래서 실제 값은 **8** 이다
 * (§CENTER_QR_SLOT_CELLS_V0WQ).
 */
const V0WQ_CELLS = Object.freeze([
  ...V0XQ_CORNER_CELLS,
  ...V0W_PHASE_CELLS,
]);

/** v0WQ 블록 범위 — 로케이터 패치·검출기가 같은 n 종속 정의를 쓴다. */
function v0wqBlocksForN(n) {
  const v0xq = v0xqBlocksForN(n);
  const v0w = v0wBlocksForN(n);
  return Object.freeze({
    /** 3면 동일 동심 사각 (NE 사분면) — v0xq 와 같은 블록. */
    CORNER: Object.freeze({ iMax: v0xq.CORNER.iMax, jMin: v0xq.CORNER.jMin }),
    /** 위상 마커 (SE 사분면) — v0W 와 같은 블록. */
    MARKER: Object.freeze({ iMin: v0w.SE.iMin, jMin: v0w.SE.jMin }),
    /** 중앙 QR 슬롯 (NW 사분면) — v0xq 보다 한 칸 작다 (§CENTER_QR_SLOT_CELLS_V0WQ). */
    SLOT: Object.freeze({
      iMax: CENTER_QR_SLOT_CELLS_V0WQ - 1, jMax: CENTER_QR_SLOT_CELLS_V0WQ - 1,
    }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0WQ_BLOCKS = v0wqBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0W2 (v0W 파생 ② — 운영자 신설 2026-08-17, 실기기 판정 라운드) ──────────
 *
 * **왜 생겼나.** 실기기 판정에서 v0W 는 ① SE **부 파인더 3×3 이 아예 안 잡히고**
 * ② 주 파인더(중앙 + NE 동심 사각)가 다 잡힌 프레임에서도 인식이 다른 후보로
 * 새서 실패했다. v0W2 는 그 둘을 정면으로 고친 설계다:
 *
 *   ① **SE 3×3 → 6×6** — 부 파인더가 v0W 의 9셀에서 36셀이 된다. 면당 36점이라
 *      Pearson 서브앵커로도, 독립 블록 검출로도 훨씬 두껍다.
 *   ② **NW·NE 를 3면 완전 대칭으로 통일** — v0W 의 NW(K3 불스아이)는 4셀이 면마다
 *      달라서 «검출 블록인데 위상도 조금 안다» 는 어중간한 물건이었다. v0W2 는 그
 *      4셀을 3면 다수결로 눕혀 **NW·NE 를 순수 검출 전용**으로 만들고, 120° 위상
 *      판별을 **SE 대형 마커 하나에 몰아 준다**. 그래서 v0W2 의 면 비대칭 셀은
 *      **22개가 전부 SE 안**에 있다 (v0W 은 10개가 NW 4 + SE 6 으로 흩어져 있었다).
 *
 * | 블록 | 셀 | 출처 | 3면 |
 * |---|---|---|---|
 * | NW (0..4)²         | 25 | `K3_CENTRE_CELLS` 의 **3면 다수결 대칭화** (4셀만 바뀐다) | 동일 |
 * | NE (0..5)×(15..20) | 36 | `V0XQ_CORNER_CELLS` **같은 배열** (v0X SE 를 (i−15,j) 이동) | 동일 |
 * | SE (15..20)²       | 36 | T·L = **v0X SE 동심 사각 톤 (같은 좌표)** · R = 독자 무늬 | **비대칭 22** |
 *
 * 즉 손 좌표표는 **SE 의 R 면 36값 하나뿐**이다 (`V0W2_MARKER_R`). 나머지 61셀 ·
 * 그리고 SE 의 T·L 면까지 전부 기존 정본에서 유도된다. 재검산은
 * `test/output/lanes/claude-v0w2-derive.mjs` (팩 → 계수 → 정규화 → 유도 대조)와
 * `claude-v0w2-render.mjs` (실제 래스터 → 면별 휘도 분류 → 불일치 0).
 *
 * **로케이터 관점** — NE 동심 사각이 v0W·v0WQ 와 같은 배열·같은 자리라 코어 반경도
 * √279 로 같다. 중앙에 K3 불스아이가 있으므로 v0W 와 **같은 앵커드(중앙×원거리)
 * 경로**를 탄다 (`cellsurface-block-detect.js` §v0w2). 세 패밀리를 가르는 것은
 * 거리가 아니라 패치 Pearson 과 손대지 않은 CS 게이트다.
 *
 * ⚠ **SE 블록의 T·L 면은 v0X SE 와 좌표·톤이 완전히 같다.** 그래서 v0W2 프레임은
 * v0X 의 «먼 꼭짓점 동심 사각»(r=18.0) 을 T·L 두 면에서 그대로 보여 준다 —
 * v0X 패밀리가 v0W2 프레임에서 시드되는 것은 **정상**이고, 가르는 것은 하류 CS
 * 게이트다. 교차 오수용 0 은 거기서 나온다 (`cellSurface-block-locator-v0wy-w2.test.js`).
 *
 * 회계: 441 − 97 − 12 − 18 = **314** (v0W 341 보다 27 적다 — SE 가 27셀 커진 값 그대로).
 */
/** 세 면 중 다수 톤. 톤이 0|2 뿐이라 «둘 이상» 은 항상 존재한다 (mid 를 만들지 않는다). */
function majorityTone(T, L, R) {
  if (T === L || T === R) return T;
  if (L === R) return L;
  throw new Error('세 면이 전부 다르다 — 다수 톤이 없다: ' + [T, L, R].join(','));
}

/**
 * K3 불스아이 중앙의 **3면 다수결 대칭화**. v0W 의 NW 는 (1,3)·(2,3)·(3,1)·(3,2)
 * 네 셀이 면마다 달랐다 — v0W2 는 그 4셀을 다수 톤(전부 0)으로 눕혀 NW 를 순수
 * 검출 블록으로 만든다. 나머지 21셀은 원본과 **바이트 동일**하다.
 */
const K3_CENTRE_SYMMETRIC_CELLS = Object.freeze(K3_CENTRE_CELLS.map(([i, j, T, L, R]) => {
  const tone = majorityTone(T, L, R);
  return Object.freeze([i, j, tone, tone, tone]);
}));

/**
 * v0W2 SE 대형 마커의 **R 면 36값** — 이 레이아웃의 유일한 손 표다 (운영자 도안).
 * 행 i = 15..20 · 열 j = 15..20. T·L 은 v0X SE 동심 사각(같은 좌표)에서 유도하므로
 * 여기 없다. R 이 T·L 과 다른 셀이 22개이고, 그 22개가 v0W2 의 **120° 위상 판별력
 * 전부**다.
 *
 * 무늬 자체는 «밝은 6×6 − 어두운 3×3 창(16..18)² − 먼 코너 계단
 * {(19,20),(20,19),(20,20)}» 이다. 동심 사각(T·L)과 링 위상이 어긋나 있어야 위상
 * margin 이 서는데, 그 어긋남이 이 표의 전부다.
 */
const V0W2_MARKER_R = Object.freeze([
  Object.freeze([2, 2, 2, 2, 2, 2]),
  Object.freeze([2, 0, 0, 0, 2, 2]),
  Object.freeze([2, 0, 0, 0, 2, 2]),
  Object.freeze([2, 0, 0, 0, 2, 2]),
  Object.freeze([2, 2, 2, 2, 2, 0]),
  Object.freeze([2, 2, 2, 2, 0, 0]),
]);

/** v0W2 SE 대형 마커 — T·L 은 v0X SE 톤(같은 좌표), R 은 위 표. */
const V0W2_MARKER_CELLS = Object.freeze(V0X_CELLS
  .filter(([i, j]) => i >= V0X_BLOCKS.SE.iMin && j >= V0X_BLOCKS.SE.jMin)
  .map(([i, j, T, L, R]) => {
    if (!(T === L && L === R)) {
      throw new Error('v0W2 마커 유도 실패 — v0X SE (' + i + ',' + j + ') 이 3면 동일이 아니다');
    }
    return Object.freeze([i, j, T, T, V0W2_MARKER_R[i - V0X_BLOCKS.SE.iMin][j - V0X_BLOCKS.SE.jMin]]);
  }));

const V0W2_CELLS = Object.freeze([
  ...K3_CENTRE_SYMMETRIC_CELLS,
  ...V0XQ_CORNER_CELLS,
  ...V0W2_MARKER_CELLS,
]);

/** v0W2 블록 범위 — 로케이터 패치·검출기가 같은 n 종속 정의를 쓴다. */
function v0w2BlocksForN(n) {
  const v1r2 = v1r2BlocksForN(n);
  const v0xq = v0xqBlocksForN(n);
  const v0x = v0xBlocksForN(n);
  return Object.freeze({
    /** K3 불스아이 중앙 (NW 사분면) — 3면 대칭화본. */
    NW: Object.freeze({ iMax: v1r2.NW.iMax, jMax: v1r2.NW.jMax }),
    /** 3면 동일 동심 사각 (NE 사분면) — v0W·v0WQ 와 같은 블록. */
    NE: Object.freeze({ iMax: v0xq.CORNER.iMax, jMin: v0xq.CORNER.jMin }),
    /** 대형 위상 마커 (SE 사분면) — v0X SE 와 같은 자리의 6×6. */
    SE: Object.freeze({ iMin: v0x.SE.iMin, jMin: v0x.SE.jMin }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0W2_BLOCKS = v0w2BlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0WY (v0W 파생 ③ — 먼 코너 QR, 운영자 **재설계** 2026-08-17) ────────────
 *
 * 셋을 나란히 놓으면 이 파생의 자리가 보인다 (v0WQ 표의 연장):
 *
 * | | 중앙 | 동심 사각 (NE) | 위상 마커 | 파인더 | 슬롯 | 슬롯 자리 | data |
 * |---|---|---|---|---|---|---|---|
 * | v0W  | K3 불스아이 25 | 36 | SE 3×3 (v0 SE) 9 | 70 | 0 | — | 341 |
 * | v0WQ | **QR 슬롯 8²** | 36 | SE 3×3 (v0 SE) 9 | 45 | 64 | **Y-심(중앙)** | 302 |
 * | **v0WY** | **K3 불스아이 25** | 36 | **SW 3×2 (v0 SW) 6** | **67** | **64** | **먼 코너 C0** | **280** |
 *
 * 즉 v0WY 는 «v0W 의 중앙을 지키면서 QR 을 먼 코너에 묻은 것» 이고, v0WQ 와 정확히
 * **반대 교환**을 한다 — v0WQ 는 중앙을 QR 에 내주고 위상 마커를 지켰고, v0WY 는
 * 중앙(= 앵커드 시딩의 근거)을 지키고 위상 마커를 SW 로 옮겼다.
 *
 * **로케이터 관점** — 중앙 K3 + NE 동심 사각이 v0W 와 **같은 배열·같은 자리**라
 * 코어 반경도 같고 **앵커드(중앙×원거리) 경로를 그대로 탄다**. 새 시드 기하가 없다.
 * 가르는 것은 (a) refinePose 패치 — SW 마커 3개와 **먼 코너 QR 패치**가 v0W 프레임에서
 * 어긋난다 (b) 하류 CS 수용 게이트 (c) 코너 슬롯의 **QR 다움 판별** (봉합 ② 재사용,
 * `cellsurface-block-detect.js` §v0wy). 게이트 값은 한 자리도 안 건드렸다.
 *
 * ⚠ **v0XQ 와의 관계** — v0WY 파인더 67 은 v0XQ 파인더 42 (CORNER 36 + MARKER 6) 를
 * **통째로 포함**한다 (같은 배열 참조). 그래서 이상 표본기에서는 v0XQ ↔ v0WY 가
 * v0W ↔ v0WQ 와 **같은 부분집합 별칭**을 만든다. v0XQ 는 드랍 상태라 라인업 밖이고,
 * 실물 래스터에서는 슬롯 자리 픽셀이 갈라 준다 (교차 전수가 그 판정기다).
 */
const V0WY_CELLS = Object.freeze([
  ...K3_CENTRE_CELLS,
  ...V0XQ_CORNER_CELLS,
  ...V0XQ_MARKER_CELLS,
]);

/** v0WY 블록 범위 — 로케이터 패치·검출기가 같은 n 종속 정의를 쓴다. */
function v0wyBlocksForN(n) {
  const v1r2 = v1r2BlocksForN(n);
  const v0xq = v0xqBlocksForN(n);
  return Object.freeze({
    /** K3 불스아이 중앙 (NW 사분면) — v0W 와 같은 블록. */
    NW: Object.freeze({ iMax: v1r2.NW.iMax, jMax: v1r2.NW.jMax }),
    /** 3면 동일 동심 사각 (NE 사분면) — v0W·v0WQ·v0W2 와 같은 블록. */
    NE: Object.freeze({ iMax: v0xq.CORNER.iMax, jMin: v0xq.CORNER.jMin }),
    /** 위상 마커 (SW 사분면) — v0XQ 와 같은 블록 (= v0 SW 3×2 의 (+8,0)). */
    SW: Object.freeze({ iMin: v0xq.MARKER.iMin, jMax: v0xq.MARKER.jMax }),
    /** 먼 코너 QR 슬롯 (SE 사분면) — [n−m, n−1]². */
    SLOT: Object.freeze({
      iMin: farEdgeCell(n, CENTER_QR_SLOT_CELLS_V0WY - 1),
      jMin: farEdgeCell(n, CENTER_QR_SLOT_CELLS_V0WY - 1),
    }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0WY_BLOCKS = v0wyBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0T (Type Y 최종 파인더 — 운영자 확정 2026-08-17) ────────────────────────
 *
 * 정본 팩 `cellsurface-v0t-editor.json` 의 104셀. 유도 61 + 전사 43:
 *
 * | 블록 | 셀 | 출처 | 비대칭 |
 * |---|---|---|---|
 * | NW (0..3)²          | 16 | `K3_CENTRE_SYMMETRIC_CELLS` 의 (0..3)² 필터 (유도) | 0 |
 * | A  (4..6)×(3..5)    |  9 | 전사 — **L 반전** (L 만 T·R 의 톤 반전)            | 9 |
 * | N팔 (0..1)×(10..14) | 10 | 전사 (신규 도안)                                   | 0 |
 * | NE (0..5)×(15..20)  | 36 | `V0XQ_CORNER_CELLS` **같은 배열**                  | 0 |
 * | W  (10..15)×(0..3)  | 24 | 전사 (신규 도안)                                   | 0 |
 * | SE (18..20)²        |  9 | `V0W_PHASE_CELLS` **같은 배열** — **R 반전**       | 6 |
 *
 * 비대칭 15셀 (A 9 + SE 6) 이 방향 판별의 전부다 — **의도된 이중화**
 * (§CELL_SURFACE_FINAL_V0T). 유도·전사 분해의 실측은 `claude-v0t-derive.mjs`
 * (NW 16/16 · NE 36/36 · SE 9/9 완전 일치 · A/N팔/W 는 기존 정본에 없음).
 */
/** v0T 중앙 — K3 대칭화본(v0W2 중앙)의 (0..3)² 부분. 대칭화 4셀이 전부 이 안이다. */
const V0T_CENTRE_CELLS = Object.freeze(K3_CENTRE_SYMMETRIC_CELLS
  .filter(([i, j]) => i <= 3 && j <= 3));

/** v0T A 블록 — L 반전 비대칭 9셀 (전사, 팩 2026-08-17). */
const V0T_A_CELLS = Object.freeze([
  [4, 3, 2, 0, 2], [4, 4, 2, 0, 2], [4, 5, 2, 0, 2],
  [5, 3, 2, 0, 2], [5, 4, 0, 2, 0], [5, 5, 2, 0, 2],
  [6, 3, 2, 0, 2], [6, 4, 2, 0, 2], [6, 5, 2, 0, 2],
].map((row) => Object.freeze(row)));

/** v0T N팔 — (0..1)×(10..14) 10셀 (전사, 팩 2026-08-17). */
const V0T_ARM_CELLS = Object.freeze([
  [0, 10, 0, 0, 0], [0, 11, 2, 2, 2], [0, 12, 2, 2, 2], [0, 13, 2, 2, 2], [0, 14, 2, 2, 2],
  [1, 10, 0, 0, 0], [1, 11, 0, 0, 0], [1, 12, 0, 0, 0], [1, 13, 0, 0, 0], [1, 14, 0, 0, 0],
].map((row) => Object.freeze(row)));

/**
 * v0T W 블록 — (10..15)×(0..3) 24셀 (전사, 팩 2026-08-17).
 * 톤 수준에서 NW 행 [3,2,1,0,2,3] 회문 스택이 관찰되나 (i-미러 대칭) 참조 유도가
 * 아니라 행 재배열이므로 전사한다 — 유도인 척하면 NW 가 바뀔 때 조용히 갈린다.
 */
const V0T_W_CELLS = Object.freeze([
  [10, 0, 0, 0, 0], [10, 1, 0, 0, 0], [10, 2, 0, 0, 0], [10, 3, 0, 0, 0],
  [11, 0, 2, 2, 2], [11, 1, 2, 2, 2], [11, 2, 2, 2, 2], [11, 3, 0, 0, 0],
  [12, 0, 0, 0, 0], [12, 1, 0, 0, 0], [12, 2, 2, 2, 2], [12, 3, 0, 0, 0],
  [13, 0, 0, 0, 0], [13, 1, 0, 0, 0], [13, 2, 2, 2, 2], [13, 3, 0, 0, 0],
  [14, 0, 2, 2, 2], [14, 1, 2, 2, 2], [14, 2, 2, 2, 2], [14, 3, 0, 0, 0],
  [15, 0, 0, 0, 0], [15, 1, 0, 0, 0], [15, 2, 0, 0, 0], [15, 3, 0, 0, 0],
].map((row) => Object.freeze(row)));

const V0T_CELLS = Object.freeze([
  ...V0T_CENTRE_CELLS,
  ...V0T_A_CELLS,
  ...V0T_ARM_CELLS,
  ...V0XQ_CORNER_CELLS,
  ...V0T_W_CELLS,
  ...V0W_PHASE_CELLS,
]);

/** v0T 블록 범위 — 각 팔도 맞닿은 변에서의 inset으로 정의한다. */
function v0tBlocksForN(n) {
  const v0xq = v0xqBlocksForN(n);
  const v0w = v0wBlocksForN(n);
  return Object.freeze({
    /** K3 계보 중앙 (0..3)² — 3면 대칭화본이라 위상 판별력 0 (검출 전용). */
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    /** A 블록 — **L 반전 비대칭** 9셀. 안쪽 방향 판별자 (이중화 ①). */
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    /** N팔 — i 낮은 변·j 높은 변 기준. */
    ARM: Object.freeze({ iMax: 1, jMin: farEdgeCell(n, 10), jMax: farEdgeCell(n, 6) }),
    /** 3면 동일 동심 사각 (NE 사분면) — v0W 계열과 같은 블록. */
    NE: Object.freeze({ iMax: v0xq.CORNER.iMax, jMin: v0xq.CORNER.jMin }),
    /** W 블록 — i 높은 변·j 낮은 변 기준. */
    W: Object.freeze({ iMin: farEdgeCell(n, 10), iMax: farEdgeCell(n, 5), jMax: 3 }),
    /** SE 위상 마커 — **R 반전 비대칭** 6/9셀. 먼 코너 방향 판별자 (이중화 ②). */
    SE: Object.freeze({ iMin: v0w.SE.iMin, jMin: v0w.SE.jMin }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0T_BLOCKS = v0tBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0TY (v0T 파생 — 먼 코너 QR 슬롯, 운영자 확정 2026-08-17) ────────────────
 *
 * 슬롯 [13,20]² 가 v0T 의 SE 블록 (18..20)² 를 9/9 삼킨다 — 정의가 곧 유도다:
 * **V0T_CELLS 에서 슬롯 박스 필터로 만든다** (행 참조 유지 · 손 좌표 0).
 * 남은 방향 판별자는 A 블록 (L 반전 9셀) 하나 — 의도된 이중화의 실증
 * (§CELL_SURFACE_FINAL_V0TY — 보충 블록 신설·마커 이전 금지, 운영자 확정).
 */
/** n=21 톤 원본에서 SE를 걷어내기 위한 슬롯 하한. 일반 n 슬롯은 함수로 다시 낸다. */
const V0TY_BASE_SLOT_MIN = farEdgeCell(
  CELL_SURFACE_EDGE_ANCHOR_BASE_N, CENTER_QR_SLOT_CELLS_V0TY - 1,
);

const V0TY_CELLS = Object.freeze(V0T_CELLS
  .filter(([i, j]) => !(i >= V0TY_BASE_SLOT_MIN && j >= V0TY_BASE_SLOT_MIN)));

/** v0TY 블록 범위 — v0T 에서 SE 가 n 종속 슬롯으로 바뀐 것. */
function v0tyBlocksForN(n) {
  const v0t = v0tBlocksForN(n);
  const slotMin = farEdgeCell(n, CENTER_QR_SLOT_CELLS_V0TY - 1);
  return Object.freeze({
    NW: v0t.NW,
    A: v0t.A,
    ARM: v0t.ARM,
    NE: v0t.NE,
    W: v0t.W,
    /** 먼 코너 QR 슬롯 — [n−m, n−1]². */
    SLOT: Object.freeze({ iMin: slotMin, jMin: slotMin }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0TY_BLOCKS = v0tyBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0TR (v0T 재설계 — 운영자 2026-08-17) ────────────────────────────────────
 *
 * 정본 팩 `cellsurface-v0trq-editor.json` 의 파인더 77셀(+슬롯 64). 이 모듈은
 * **유도 77 · 전사 0** 으로 만든다 (`claude-v0tr-measure.mjs` ⓐ 가 팩 ↔ 참조 대조를
 * 돌린다 — 바깥 36/36 · 안쪽 36/36 · SE 9/9 완전 일치):
 *
 * | 블록 | 셀 | 출처 | 비대칭 |
 * |---|---|---|---|
 * | NW (0..3)²            | 16 | `V0T_CENTRE_CELLS` **같은 배열** (v0tr 만)      | 0 |
 * | NE 바깥 (0..5)×(15..20)| 36 | `V0XQ_CORNER_CELLS` **같은 배열** (= v0T NE)   | 0 |
 * | NE 안쪽 (2..7)×(10..15)| 36 | 바깥 사각의 **(i+2, j−5) 평행이동**             | 0 |
 * | SE (18..20)²          |  9 | `V0W_PHASE_CELLS` **같은 배열** — R 반전        | 6 |
 *
 * 두 동심 사각은 j=15 열의 4셀 (i=2..5) 을 공유한다 — 겹치는 행은 톤까지 같으므로
 * 안쪽 사본에서 빼고 바깥 것을 남긴다 (36 + 32 = **68**). 손 좌표표는 한 줄도 없다.
 *
 * ⚠ **v0T 의 A 블록·N팔·W 블록이 없다.** 방향 판별은 SE 6셀 하나가 전부라
 * margin 이 0.0430 까지 내려간다 (§CELL_SURFACE_FINAL_V0TR — 숫자와 함께 적어 둔다).
 */
/** 안쪽 동심 사각의 평행이동 — 바깥 사각을 «안쪽으로» 옮긴 양 (팩 유도 실측). */
const V0TR_INNER_SHIFT_I = 2;
const V0TR_INNER_SHIFT_J = -5;

/** v0TR NE 안쪽 동심 사각 36셀 — 바깥 사각(= v0T NE)의 평행이동. 톤 변경 0. */
const V0TR_INNER_CELLS = Object.freeze(V0XQ_CORNER_CELLS
  .map(([i, j, T, L, R]) => Object.freeze([
    i + V0TR_INNER_SHIFT_I, j + V0TR_INNER_SHIFT_J, T, L, R,
  ])));

/**
 * NE 합집합 68셀 — 바깥 36 + 안쪽 36 − 겹침 4. 겹치는 4셀은 두 사본의 톤이 같으므로
 * (자기검증 ①-j 가 못 박는다) **바깥 행 참조를 남기고** 안쪽 사본을 뺀다.
 */
const V0TR_NE_CELLS = Object.freeze([
  ...V0XQ_CORNER_CELLS,
  ...V0TR_INNER_CELLS.filter(([i, j]) =>
    !(i <= V0XQ_BLOCKS.CORNER.iMax && j >= V0XQ_BLOCKS.CORNER.jMin)),
]);

/**
 * ⚠ **A 블록 편입 (운영자 지적 2026-08-18)** — 최초 v0TR 정본에는 «불스아이 주변
 * 보조 파인더»(A 블록)가 빠져 있었다. 그러면 비대칭이 SE 6셀뿐이고, **v0TRY 는
 * 슬롯이 그 SE 를 삼키므로 방향 판별자가 0 이 된다.**
 *
 * v0TY 가 SE 를 잃고도 세 방향이 서는 이유가 정확히 A 블록의 L-반전 9셀이다
 * (§CELL_SURFACE_FINAL_V0TY «의도된 비대칭 이중화»). v0TR 계열도 같은 이중화를
 * 가져야 파생(v0TRY)이 성립한다. 덤으로 A 블록 중앙 `(5,4)` 는 파인더 전체에서
 * **유일한 고립점**이다 (8이웃이 전부 파인더 셀 — `claude-isolated-dot-census.out.txt`).
 *
 * **`V0T_A_CELLS` 를 그대로 참조한다** — 새 배열을 만들지 않는다. v0T 와 문자 그대로
 * 같은 셀·같은 톤이라 손 좌표가 0 이고 전사 오류가 원리적으로 불가능하다
 * (이 파일의 «정본 의존» 규약 그대로).
 */
const V0TR_CELLS = Object.freeze([
  ...V0T_CENTRE_CELLS,
  ...V0T_A_CELLS,
  ...V0TR_NE_CELLS,
  ...V0W_PHASE_CELLS,
]);

/** v0TR 블록 범위 — 바깥·안쪽 사각 모두 높은 j 변의 inset으로 이동한다. */
function v0trBlocksForN(n) {
  const v0t = v0tBlocksForN(n);
  const outer = v0xqBlocksForN(n).CORNER;
  const phase = v0wBlocksForN(n).SE;
  return Object.freeze({
    /** K3 계보 중앙 (0..3)² — v0T 와 같은 배열이라 서명도 같다 (v0tr 만). */
    NW: v0t.NW,
    /**
     * A 블록 — **L 반전 비대칭 9셀**. v0T 와 같은 범위·같은 배열 (2026-08-18 편입).
     * v0TRY 에서 슬롯이 SE 를 삼킨 뒤 **남는 유일한 방향 판별자**다. 중앙 (5,4) 는
     * 파인더 전체의 유일한 고립점이기도 하다.
     */
    A: v0t.A,
    /** NE **바깥** 동심 사각 — v0T·v0W 계열과 문자 그대로 같은 자리 (반경 √279). */
    NE_OUTER: Object.freeze({ iMax: outer.iMax, jMin: outer.jMin }),
    /**
     * NE **안쪽** 동심 사각 — 바깥 사각의 (i+2,j−5) 평행이동.
     */
    NE_INNER: Object.freeze({
      iMin: V0TR_INNER_SHIFT_I,
      iMax: outer.iMax + V0TR_INNER_SHIFT_I,
      jMin: outer.jMin + V0TR_INNER_SHIFT_J,
      jMax: farEdgeCell(n, 0) + V0TR_INNER_SHIFT_J,
    }),
    /** SE 위상 마커 — **R 반전 비대칭** 6/9셀. */
    SE: Object.freeze({ iMin: phase.iMin, jMin: phase.jMin }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0TR_BLOCKS = v0trBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0TRQ (v0TR 파생 — 중앙 QR 슬롯, 운영자 정본 2026-08-17) ─────────────────
 *
 * 슬롯 (0..7)² 가 v0TR 의 NW 중앙 16셀을 16/16 삼킨다 — 정의가 곧 유도다:
 * **V0TR_CELLS 에서 슬롯 박스 필터로 만든다** (행 참조 유지 · 손 좌표 0).
 * v0TY 가 V0T_CELLS 를 필터해서 나온 것과 **같은 규약**이다.
 */
const V0TRQ_SLOT_MAX = CENTER_QR_SLOT_CELLS_V0TRQ - 1;

const V0TRQ_CELLS = Object.freeze(V0TR_CELLS
  .filter(([i, j]) => !(i <= V0TRQ_SLOT_MAX && j <= V0TRQ_SLOT_MAX)));

/** v0TRQ 블록 범위 — v0TR 에서 NW 중앙이 슬롯으로 바뀐 것. */
function v0trqBlocksForN(n) {
  const v0tr = v0trBlocksForN(n);
  return Object.freeze({
    NE_OUTER: v0tr.NE_OUTER,
    NE_INNER: v0tr.NE_INNER,
    SE: v0tr.SE,
    /** 중앙 QR 슬롯 (Y-심 앵커) — [0, m−1]². */
    SLOT: Object.freeze({ iMax: V0TRQ_SLOT_MAX, jMax: V0TRQ_SLOT_MAX }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0TRQ_BLOCKS = v0trqBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/**
 * ── v0TRY (v0TR 파생 — **먼 코너** QR 슬롯, 운영자 2026-08-18) ────────────────
 *
 * 슬롯 [13,20]² 가 v0TR 의 SE 블록 (18..20)² 를 9/9 삼킨다 — 정의가 곧 유도다:
 * **V0TR_CELLS 에서 슬롯 박스 필터로 만든다** (행 참조 유지 · 손 좌표 0).
 * `V0TY_CELLS = V0T_CELLS.filter(...)` 와 **문자 그대로 같은 꼴**이고, 슬롯 상자도
 * v0TY 의 것을 그대로 쓴다 (`V0TY_BASE_SLOT_MIN` 참조 — 숫자 13 을 다시 적지 않는다).
 *
 * 남은 방향 판별자는 A 블록 (L 반전 9셀) 하나 — v0TY 와 같은 «의도된 이중화» 실증이다
 * (§CELL_SURFACE_FINAL_V0TRY — 보충 블록 신설·마커 이전 없음).
 */
/** v0TY 와 **같은 상자**를 쓴다 — 슬롯 규약 재사용 (새 상수 신설 금지, 운영자 지시). */
const V0TRY_BASE_SLOT_MIN = V0TY_BASE_SLOT_MIN;

const V0TRY_CELLS = Object.freeze(V0TR_CELLS
  .filter(([i, j]) => !(i >= V0TRY_BASE_SLOT_MIN && j >= V0TRY_BASE_SLOT_MIN)));

/** v0TRY 블록 범위 — v0TR 에서 SE 가 n 종속 슬롯으로 바뀐 것. */
function v0tryBlocksForN(n) {
  const v0tr = v0trBlocksForN(n);
  const slotMin = farEdgeCell(n, CENTER_QR_SLOT_CELLS_V0TY - 1);
  return Object.freeze({
    NW: v0tr.NW,
    A: v0tr.A,
    NE_OUTER: v0tr.NE_OUTER,
    NE_INNER: v0tr.NE_INNER,
    /** 먼 코너 QR 슬롯 — [n−m, n−1]² (v0TY 와 같은 상자). */
    SLOT: Object.freeze({ iMin: slotMin, jMin: slotMin }),
  });
}

/** n=21 발행 와이어 호환 별칭. */
export const V0TRY_BLOCKS = v0tryBlocksForN(CELL_SURFACE_EDGE_ANCHOR_BASE_N);

/** v2r2도 같은 공개 블록 질의에 포함한다. 이 레이아웃의 행 인스턴스는 원래부터 n 종속이다. */
function v2r2BlocksForN(n) {
  assertEdgeAnchorN(n);
  return Object.freeze({
    CENTER: Object.freeze({ iMax: 4, jMax: 4 }),
    FAR: Object.freeze({ iMin: farEdgeCell(n, 6), jMin: farEdgeCell(n, 6) }),
  });
}

/**
 * 비-v0 셀 표면 파인더의 블록 범위. `CELL_SURFACE_FINAL_NS`와 독립한 **순수 기하
 * 질의**라 n=25 이상도 계산하지만 라인업·용량·와이어를 추가하지 않는다.
 */
export function blocksCellSurfaceFinalForN(n, id) {
  assertCellSurfaceFinalId(id);
  if (id === CELL_SURFACE_FINAL_V0) {
    throw new RangeError('v0 는 n=13 고정 기하 예외라 면 모서리 기준 블록 질의를 쓰지 않는다');
  }
  assertEdgeAnchorN(n);
  if (id === CELL_SURFACE_FINAL_V2R2) return v2r2BlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V1R2) return v1r2BlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0X) return v0xBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0XQ) return v0xqBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0W) return v0wBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0WQ) return v0wqBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0W2) return v0w2BlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0WY) return v0wyBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0T) return v0tBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0TY) return v0tyBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0TR) return v0trBlocksForN(n);
  if (id === CELL_SURFACE_FINAL_V0TRQ) return v0trqBlocksForN(n);
  return v0tryBlocksForN(n);
}

function blockContainsRow(block, i, j) {
  if (block.i !== undefined && i !== block.i) return false;
  if (block.j !== undefined && j !== block.j) return false;
  if (block.iMin !== undefined && i < block.iMin) return false;
  if (block.iMax !== undefined && i > block.iMax) return false;
  if (block.jMin !== undefined && j < block.jMin) return false;
  if (block.jMax !== undefined && j > block.jMax) return false;
  return true;
}

function anchorGroup(block, iFar, jFar) {
  return Object.freeze({ block, iFar, jFar });
}

/**
 * n=21 톤 원본의 각 블록이 어느 변 쌍에 붙는지. `false`는 낮은(0) 변, `true`는
 * 높은(n−1) 변이다. v0T ARM과 W도 각각 NE·SW 띠와 함께 움직여 접속·간격을 지킨다.
 */
const EDGE_ANCHOR_GROUPS = Object.freeze({
  [CELL_SURFACE_FINAL_V1R2]: Object.freeze([
    anchorGroup(V1R2_BLOCKS.NW, false, false),
    anchorGroup(V1R2_BLOCKS.NE, false, true),
    anchorGroup(V1R2_BLOCKS.SW, true, false),
    anchorGroup(V1R2_BLOCKS.SE, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0X]: Object.freeze([
    anchorGroup(V0X_BLOCKS.NW, false, false),
    anchorGroup(V0X_BLOCKS.NE, false, true),
    anchorGroup(V0X_BLOCKS.SW, true, false),
    anchorGroup(V0X_BLOCKS.SE, true, true),
    anchorGroup(V0X_BLOCKS.SINGLE, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0XQ]: Object.freeze([
    anchorGroup(V0XQ_BLOCKS.CORNER, false, true),
    anchorGroup(V0XQ_BLOCKS.MARKER, true, false),
  ]),
  [CELL_SURFACE_FINAL_V0W]: Object.freeze([
    anchorGroup(V0W_BLOCKS.NW, false, false),
    anchorGroup(V0W_BLOCKS.NE, false, true),
    anchorGroup(V0W_BLOCKS.SE, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0WQ]: Object.freeze([
    anchorGroup(V0WQ_BLOCKS.CORNER, false, true),
    anchorGroup(V0WQ_BLOCKS.MARKER, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0W2]: Object.freeze([
    anchorGroup(V0W2_BLOCKS.NW, false, false),
    anchorGroup(V0W2_BLOCKS.NE, false, true),
    anchorGroup(V0W2_BLOCKS.SE, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0WY]: Object.freeze([
    anchorGroup(V0WY_BLOCKS.NW, false, false),
    anchorGroup(V0WY_BLOCKS.NE, false, true),
    anchorGroup(V0WY_BLOCKS.SW, true, false),
  ]),
  [CELL_SURFACE_FINAL_V0T]: Object.freeze([
    anchorGroup(V0T_BLOCKS.NW, false, false),
    anchorGroup(V0T_BLOCKS.A, false, false),
    anchorGroup(V0T_BLOCKS.ARM, false, true),
    anchorGroup(V0T_BLOCKS.NE, false, true),
    anchorGroup(V0T_BLOCKS.W, true, false),
    anchorGroup(V0T_BLOCKS.SE, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0TY]: Object.freeze([
    anchorGroup(V0TY_BLOCKS.NW, false, false),
    anchorGroup(V0TY_BLOCKS.A, false, false),
    anchorGroup(V0TY_BLOCKS.ARM, false, true),
    anchorGroup(V0TY_BLOCKS.NE, false, true),
    anchorGroup(V0TY_BLOCKS.W, true, false),
  ]),
  [CELL_SURFACE_FINAL_V0TR]: Object.freeze([
    anchorGroup(V0TR_BLOCKS.NW, false, false),
    anchorGroup(V0TR_BLOCKS.A, false, false),
    anchorGroup(V0TR_BLOCKS.NE_OUTER, false, true),
    anchorGroup(V0TR_BLOCKS.NE_INNER, false, true),
    anchorGroup(V0TR_BLOCKS.SE, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0TRQ]: Object.freeze([
    anchorGroup(V0TRQ_BLOCKS.NE_OUTER, false, true),
    anchorGroup(V0TRQ_BLOCKS.NE_INNER, false, true),
    anchorGroup(V0TRQ_BLOCKS.SE, true, true),
  ]),
  [CELL_SURFACE_FINAL_V0TRY]: Object.freeze([
    anchorGroup(V0TRY_BLOCKS.NW, false, false),
    anchorGroup(V0TRY_BLOCKS.A, false, false),
    anchorGroup(V0TRY_BLOCKS.NE_OUTER, false, true),
    anchorGroup(V0TRY_BLOCKS.NE_INNER, false, true),
  ]),
});

function edgeAnchoredRowsForN(rows, n, id) {
  assertEdgeAnchorN(n);
  if (n === CELL_SURFACE_EDGE_ANCHOR_BASE_N) return rows;
  const groups = EDGE_ANCHOR_GROUPS[id];
  if (!groups) throw new Error(id + ': 면 모서리 앵커 그룹이 없다');
  return Object.freeze(rows.map(([i, j, T, L, R]) => {
    const matched = groups.filter(({ block }) => blockContainsRow(block, i, j));
    if (matched.length === 0) {
      throw new Error(id + ': n=21 원본 셀이 블록 범위 밖이다: ' + i + ',' + j);
    }
    const { iFar, jFar } = matched[0];
    for (const group of matched) {
      if (group.iFar !== iFar || group.jFar !== jFar) {
        throw new Error(id + ': 겹친 블록의 변 앵커가 충돌한다: ' + i + ',' + j);
      }
    }
    return Object.freeze([
      iFar ? moveFarEdgeCoordinate(i, n) : i,
      jFar ? moveFarEdgeCoordinate(j, n) : j,
      T, L, R,
    ]);
  }));
}

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

/** 최종 셀 표면 **와이어**가 지원하는 n 인지 (13|21|25 — 드랍 포함). */
export function isCellSurfaceFinalN(n) {
  return hasFinalLayoutWireForN(n);
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
  if (id === CELL_SURFACE_FINAL_V2R2) return v2r2CellsForN(n);
  let rows;
  if (id === CELL_SURFACE_FINAL_V1R2) rows = V1R2_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0X) rows = V0X_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0XQ) rows = V0XQ_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0W) rows = V0W_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0WQ) rows = V0WQ_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0W2) rows = V0W2_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0WY) rows = V0WY_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0T) rows = V0T_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0TY) rows = V0TY_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0TR) rows = V0TR_CELLS;
  else if (id === CELL_SURFACE_FINAL_V0TRQ) rows = V0TRQ_CELLS;
  else rows = V0TRY_CELLS;
  return edgeAnchoredRowsForN(rows, n, id);
}

/**
 * 순수 파인더 기하 질의. 비-v0는 n>=21이면 계산하지만 `CELL_SURFACE_FINAL_NS`·SURFACES
 * 캐시를 바꾸지 않으므로 해당 n의 인코딩·검출 라인업을 활성화하지 않는다.
 */
export function locatorCellsCellSurfaceFinalForEdgeN(n, id) {
  assertCellSurfaceFinalId(id);
  if (id === CELL_SURFACE_FINAL_V0) {
    if (n !== 13) throw new RangeError('v0 는 n=13 고정 기하다: n=' + n);
  } else {
    assertEdgeAnchorN(n);
  }
  return buildLocatorCells(canonicalRowsFor(id, n));
}

function buildFinalSurface(id, n, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE) {
  assertCellSurfaceFinalN(id, n);
  const blockLength = formatBlockLengthForWire(formatWire);
  const locatorCells = locatorCellsCellSurfaceFinalForEdgeN(n, id);
  const painted = locatorCells.map((cell) => ({ i: cell.i, j: cell.j }));

  // QR 슬롯 — 데이터도 파인더도 아니다. autoplace 에는 **점유**로 넘기고
  // (예약 셀이 QR 위로 올라오면 안 된다) 회계에서는 별도 항으로 뺀다.
  // 슬롯 원점은 레이아웃마다 다르다 (v0xq·v0wq Y-심 · v0wy 먼 코너) — §centerQrSlotOriginFor.
  const slot = slotCellsFor(id, n);
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
    /** QR 슬롯 (v0xq · v0wq · v0wy 만 비어 있지 않다). 데이터·파인더 어느 쪽도 아니다. */
    slotCells: slot,
    slotCount: slot.length,
    /**
     * autoplace 에 실제로 넘긴 **점유** = 파인더 ∪ 슬롯. v0xq 전에는 paintedCells 와
     * 같아서 소비자들이 painted 를 점유로 써 왔다 — 슬롯이 생기며 그 등식이 깨졌다.
     * (§occupiedCellsCellSurfaceFinal 주석 참조.)
     *
     * 슬롯이 없는 레이아웃들은 `paintedCells` 와 **같은 배열 참조**다 — 편입 전
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
 * id 를 생략하면 그 n 의 **와이어 선호** 레이아웃 (13→v0 · 21|25→v2r2).
 *
 * ⚠ 여기(와 아래 id 생략 헬퍼들)의 기본값은 **라인업이 아니라 와이어**다.
 * v2r2·v1r2 드랍(2026-08-16)은 검출 라인업·생성기 카드에만 걸린다 — 용량 회계·
 * 좌표표 헬퍼의 «id 생략» 의미까지 바꾸면 발행된 프레임의 숫자가 조용히 달라진다.
 * 라인업 기본이 필요한 자리는 `finalLayoutIdForN` 을 **명시적으로** 부른다.
 * `formatWire` 를 생략하면 현행 세대(2) — 생성 경로는 이 기본값만 쓴다.
 * 1 을 주면 레거시 판독 세대(포맷 v1 · 15셀)를 돌려준다.
 */
export function cellSurfaceFinal(
  n, id = wirePreferredFinalLayoutIdForN(n), formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
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
  const surface = cellSurfaceFinal(n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id);
  const suffix = assertCellSurfaceFinalTones(tones) === 3 ? 'T' : '';
  return 'Y' + surface.version + suffix + '-CS-' + surface.id.toUpperCase();
}

export function locatorCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id).locatorCells;
}

/**
 * O/G 중앙 슬롯용 순수 v0 파인더 셀. 좌표·T/L/R 톤을 별도 표로 복사하지 않고
 * `CELL_SURFACE_FINAL_V0` 정본 배열의 동결된 locatorCells 참조를 그대로 돌려준다.
 */
export function centralV0FinderCells() {
  return locatorCellsCellSurfaceFinal(CENTRAL_V0_SOURCE_N, CELL_SURFACE_FINAL_V0);
}

export function paintedCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id).paintedCells;
}

/**
 * autoplace 에 넘기는 **점유** 셀 = 파인더 ∪ 중앙 QR 슬롯.
 *
 * v0xq 전에는 «점유 = painted» 가 항상 참이라 소비자들이 `paintedCells` 를 그대로
 * 점유 입력으로 썼다. 슬롯이 생기면서 그 등식이 깨진다 — 슬롯 셀 위에 format 이
 * 앉으면 QR 이 포맷을 덮어 버린다. 셀 편집기·유도 검증은 **이 함수**를 써야 한다.
 * 슬롯 없는 레이아웃에서는 paintedCells 와 셀 하나까지 같다 (기존 소비자 동작 불변).
 */
export function occupiedCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id).occupiedCells;
}

/** QR 슬롯 셀 (절대 좌표). v0xq · v0wq · v0wy 외에는 빈 배열이다. */
export function slotCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id).slotCells;
}

/** 이 레이아웃이 QR 슬롯을 갖는가 (= 렌더러가 슬롯 QR 을 그려야 하는가). */
export function hasCenterQrSlot(id) {
  return CENTER_QR_SLOT_IDS.includes(id);
}

/**
 * 포맷 셀 좌표. `formatWire` 1 을 주면 레거시(15셀) 좌표 — 디코더 폴백 전용이다.
 */
export function formatCellsCellSurfaceFinal(
  n, id = undefined, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  return cellSurfaceFinal(
    n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id, formatWire,
  ).formatCells;
}

export function referenceCellsCellSurfaceFinal(n, id = undefined) {
  return cellSurfaceFinal(n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id).referenceCells;
}

export function locatorToneCellSurfaceFinal(n, face, i, j, id = undefined) {
  if (!FACES.includes(face)) throw new RangeError('면 라벨은 T | L | R 이어야 한다: ' + face);
  const surface = cellSurfaceFinal(n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id);
  for (const cell of surface.locatorCells) {
    if (cell.i === i && cell.j === j) return cell[face];
  }
  return 1;
}

export function dataCellsInScanOrderCellSurfaceFinal(
  n, id = undefined, formatWire = CELL_SURFACE_FINAL_FORMAT_WIRE,
) {
  const surface = cellSurfaceFinal(
    n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id, formatWire,
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
    n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id, formatWire,
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
    n, id === undefined ? wirePreferredFinalLayoutIdForN(n) : id, formatWire,
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
      const want = se.get((i + V0XQ_BASE_CORNER_SHIFT) + ',' + j);
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
    for (const id of CENTER_QR_SLOT_IDS) {
      const side = centerQrSlotCellsFor(id);
      if (side <= 0) throw new Error(id + ' 이 슬롯 목록에 있는데 한 변이 0 이다');
      for (const n of CELL_SURFACE_FINAL_NS[id]) {
        if (slotCellsFor(id, n).length !== side * side) {
          throw new Error(id + ' QR 슬롯 셀 수가 m² 가 아니다: ' + slotCellsFor(id, n).length);
        }
      }
      // 배치 규약이 없는 슬롯 레이아웃은 렌더러·디코더가 원점을 못 정한다.
      const placement = centerQrSlotPlacementFor(id);
      if (placement === null) throw new Error(id + ' 에 슬롯 배치 규약이 없다');
      if (placement.anchor !== 'seam' && placement.anchor !== 'far') {
        throw new Error(id + ' 슬롯 앵커가 seam|far 가 아니다: ' + placement.anchor);
      }
    }
    // 슬롯 없는 레이아웃은 한 변도 0 이어야 한다 (두 질의가 갈리면 렌더러가 헛돈다).
    for (const id of CELL_SURFACE_FINAL_IDS) {
      if (CENTER_QR_SLOT_IDS.includes(id)) continue;
      if (centerQrSlotCellsFor(id) !== 0) {
        throw new Error(id + ' 이 슬롯 없는데 한 변이 0 이 아니다');
      }
      if (centerQrSlotPlacementFor(id) !== null) {
        throw new Error(id + ' 이 슬롯 없는데 배치 규약이 있다');
      }
    }
    for (const id of CELL_SURFACE_FINAL_IDS) {
      if (CENTER_QR_SLOT_IDS.includes(id)) continue;
      for (const n of CELL_SURFACE_FINAL_NS[id]) {
        if (slotCellsFor(id, n).length !== 0) {
          throw new Error(id + ' 에 QR 슬롯이 생겼다 — v0xq · v0wq · v0wy 전용이다');
        }
      }
    }
    // 파인더 코어 3점은 뒤집기에 따라 **실제로 달라야** 한다 — 두 규약이 같은 값을
    // 내면 v0WY 의 «윈도 β 식 방향» 이 이름뿐이고 QR 다움 판별이 엉뚱한 자리를 잰다.
    {
      const key = (cores) => cores.map((c) => c.a.toFixed(6) + ':' + c.b.toFixed(6)).join(' ');
      const straight = centerQrFinderCoreCells(CENTER_QR_SLOT_CELLS_V0WY, false);
      const flipped = centerQrFinderCoreCells(CENTER_QR_SLOT_CELLS_V0WY, true);
      if (key(straight) === key(flipped)) {
        throw new Error('QR 파인더 코어가 뒤집기에 무반응이다 — 방향 규약이 무의미해진다');
      }
      if (straight.length !== 3 || flipped.length !== 3) {
        throw new Error('QR 파인더 코어가 3점이 아니다');
      }
    }
  }

  // ①-d v0W 정본 — 70셀 (K3 중앙 25 + 동심 사각 36 + 위상 마커 9) · mid 면 0 · 슬롯 0.
  //
  // 이 블록이 «손 전사가 아니다» 의 증명이다. 세 출처 배열과 **참조/평행이동**으로
  // 묶여 있으므로, 출처가 조용히 시프트하면 여기서 즉시 터진다.
  if (V0W_CELLS.length !== 70) {
    throw new Error('v0W 정본이 70셀이 아니다: ' + V0W_CELLS.length);
  }
  {
    // 중앙은 v1r2 NW 5×5 **같은 배열**이어야 한다 (사본이면 참조가 갈린다).
    if (K3_CENTRE_CELLS !== V2R2_CENTER_CELLS) {
      throw new Error('v0W 중앙이 v1r2 NW 공유 배열이 아니다');
    }
    if (K3_CENTRE_CELLS.length !== 25) {
      throw new Error('v0W 중앙이 25셀이 아니다: ' + K3_CENTRE_CELLS.length);
    }
    // 동심 사각도 v0xq CORNER **같은 배열**이어야 한다 (v0X SE 의 평행이동본).
    if (V0W_CELLS.slice(25, 61).some((row, index) => row !== V0XQ_CORNER_CELLS[index])) {
      throw new Error('v0W 동심 사각이 v0xq CORNER 공유 배열이 아니다');
    }
    // 위상 마커는 v0 SE 3×3 의 (+8,+8) 평행이동 — 좌표만 옮긴 완전 사본이다.
    const v0Far = V0_CELLS.filter(([i, j]) => i >= V0_FAR_MIN && j >= V0_FAR_MIN);
    if (v0Far.length !== 9) throw new Error('v0 SE 3×3 이 9셀이 아니다: ' + v0Far.length);
    if (V0W_PHASE_CELLS.length !== 9) {
      throw new Error('v0W 위상 마커가 9셀이 아니다: ' + V0W_PHASE_CELLS.length);
    }
    for (let index = 0; index < 9; index += 1) {
      const [i, j, T, L, R] = v0Far[index];
      const want = [i + V0W_BASE_FAR_SHIFT, j + V0W_BASE_FAR_SHIFT, T, L, R].join(',');
      if (V0W_PHASE_CELLS[index].join(',') !== want) {
        throw new Error('v0W 위상 마커가 v0 SE 정본의 평행이동본이 아니다: ' + index);
      }
    }
    // 위상 판별력의 유일한 원천 — T=L 이고 R 이 다른 셀이 실재해야 한다.
    // (동심 사각은 3면 동일이라 0, K3 중앙은 세 레이아웃이 공유하므로 패밀리 판별 0.)
    if (!V0W_PHASE_CELLS.some(([, , T, L, R]) => T === L && R !== T)) {
      throw new Error('v0W 위상 마커에 면 비대칭이 없다 — 120° 판별력 0');
    }
    // 블록 분할 25/36/9 — 세 블록 밖 셀이 없고, 서로 겹치지도 않는다.
    const counts = { NW: 0, NE: 0, SE: 0 };
    for (const [i, j] of V0W_CELLS) {
      const homes = [];
      if (i <= V0W_BLOCKS.NW.iMax && j <= V0W_BLOCKS.NW.jMax) homes.push('NW');
      if (i <= V0W_BLOCKS.NE.iMax && j >= V0W_BLOCKS.NE.jMin) homes.push('NE');
      if (i >= V0W_BLOCKS.SE.iMin && j >= V0W_BLOCKS.SE.jMin) homes.push('SE');
      if (homes.length !== 1) {
        throw new Error('v0W 셀 (' + i + ',' + j + ') 의 블록 소속이 ' + homes.length + '개다');
      }
      counts[homes[0]] += 1;
    }
    if (counts.NW !== 25 || counts.NE !== 36 || counts.SE !== 9) {
      throw new Error(
        'v0W 블록 분할이 25/36/9 가 아니다: '
        + [counts.NW, counts.NE, counts.SE].join('/'),
      );
    }
    // 동심 사각은 3면 동일 36/36 (120° 쌍둥이 코어 서명의 근거).
    let neUniform = 0;
    for (const [i, j, T, L, R] of V0W_CELLS) {
      if (!(i <= V0W_BLOCKS.NE.iMax && j >= V0W_BLOCKS.NE.jMin)) continue;
      if (T === L && L === R) neUniform += 1;
    }
    if (neUniform !== 36) throw new Error('v0W NE 3면 동일이 36/36 이 아니다: ' + neUniform);
  }

  // ①-e v0WQ 정본 — 45셀 (동심 사각 36 + 위상 마커 9) · mid 면 0 · 슬롯 81.
  //
  // v0WQ 는 «새 무늬» 가 아니라 **두 정본의 조합**이다. 그래서 여기서 재는 것은
  // 톤 표가 아니라 **참조 동일성**이다 — 사본이면 출처가 시프트해도 안 터진다.
  if (V0WQ_CELLS.length !== 45) {
    throw new Error('v0WQ 정본이 45셀이 아니다: ' + V0WQ_CELLS.length);
  }
  {
    if (V0WQ_CELLS.slice(0, 36).some((row, index) => row !== V0XQ_CORNER_CELLS[index])) {
      throw new Error('v0WQ 동심 사각이 v0xq CORNER 공유 배열이 아니다');
    }
    if (V0WQ_CELLS.slice(36).some((row, index) => row !== V0W_PHASE_CELLS[index])) {
      throw new Error('v0WQ 위상 마커가 v0W PHASE 공유 배열이 아니다');
    }
    // v0WQ 와 v0W 의 위상 마커는 **같은 배열**이어야 한다 — 그것이 이 파생의 정의다
    // («v0W 의 위상 마커 × v0XQ 의 중앙»). 그리고 v0XQ 의 마커와는 **달라야** 한다,
    // 그 차이가 두 레이아웃을 가르는 유일한 셀 축이기 때문이다.
    const markerKey = (rows) => rows.map((row) => row.join(',')).join(' ');
    if (markerKey(V0WQ_CELLS.slice(36)) !== markerKey([...V0W_PHASE_CELLS])) {
      throw new Error('v0WQ 위상 마커가 v0W 와 다르다');
    }
    if (markerKey(V0WQ_CELLS.slice(36)) === markerKey([...V0XQ_MARKER_CELLS])) {
      throw new Error('v0WQ 위상 마커가 v0XQ 와 같아졌다 — 두 레이아웃을 가를 축이 없다');
    }
    // 블록 분할 36/9 — 두 블록 밖 셀이 없고 서로 겹치지도 않는다. 그리고 슬롯과도.
    const counts = { CORNER: 0, MARKER: 0 };
    for (const [i, j] of V0WQ_CELLS) {
      const homes = [];
      if (i <= V0WQ_BLOCKS.CORNER.iMax && j >= V0WQ_BLOCKS.CORNER.jMin) homes.push('CORNER');
      if (i >= V0WQ_BLOCKS.MARKER.iMin && j >= V0WQ_BLOCKS.MARKER.jMin) homes.push('MARKER');
      if (homes.length !== 1) {
        throw new Error('v0WQ 셀 (' + i + ',' + j + ') 의 블록 소속이 ' + homes.length + '개다');
      }
      counts[homes[0]] += 1;
      if (i <= V0WQ_BLOCKS.SLOT.iMax && j <= V0WQ_BLOCKS.SLOT.jMax) {
        throw new Error('v0WQ 파인더 셀 (' + i + ',' + j + ') 이 중앙 QR 슬롯 안이다');
      }
    }
    if (counts.CORNER !== 36 || counts.MARKER !== 9) {
      throw new Error('v0WQ 블록 분할이 36/9 가 아니다: '
        + [counts.CORNER, counts.MARKER].join('/'));
    }
    // 위상 판별력의 유일한 원천 — 동심 사각은 3면 동일이라 0 이다.
    if (!V0WQ_CELLS.slice(36).some(([, , T, L, R]) => T === L && R !== T)) {
      throw new Error('v0WQ 위상 마커에 면 비대칭이 없다 — 120° 판별력 0');
    }
  }

  // ①-f v0W2 정본 — 97셀 (K3 대칭 중앙 25 + 동심 사각 36 + 대형 마커 36) · mid 0 · 슬롯 0.
  //
  // v0W2 도 «새 무늬» 가 아니다 — 손 표는 SE 의 **R 면 36값 하나뿐**이고 나머지는
  // 전부 유도다. 여기서 재는 것은 ⓐ 참조/유도의 무결성 ⓑ 설계 의도 두 개
  // («NW·NE 는 검출 전용 = 3면 대칭» · «위상 비대칭은 전부 SE 안») 이다.
  if (V0W2_CELLS.length !== 97) {
    throw new Error('v0W2 정본이 97셀이 아니다: ' + V0W2_CELLS.length);
  }
  {
    // 중앙 25 = K3 의 3면 다수결 대칭화. 좌표는 원본과 같고, 톤이 갈리는 셀은
    // 정확히 «면마다 달랐던» 셀뿐이며 그 값은 다수 톤이다.
    if (K3_CENTRE_SYMMETRIC_CELLS.length !== 25) {
      throw new Error('v0W2 중앙이 25셀이 아니다: ' + K3_CENTRE_SYMMETRIC_CELLS.length);
    }
    let flattened = 0;
    for (let index = 0; index < 25; index += 1) {
      const [i, j, T, L, R] = K3_CENTRE_CELLS[index];
      const [i2, j2, T2, L2, R2] = K3_CENTRE_SYMMETRIC_CELLS[index];
      if (i !== i2 || j !== j2) throw new Error('v0W2 중앙 좌표가 K3 와 다르다: ' + index);
      if (!(T2 === L2 && L2 === R2)) {
        throw new Error('v0W2 중앙 (' + i + ',' + j + ') 이 3면 동일이 아니다');
      }
      if (T2 !== majorityTone(T, L, R)) {
        throw new Error('v0W2 중앙 (' + i + ',' + j + ') 이 다수 톤이 아니다');
      }
      if (!(T === L && L === R)) flattened += 1;
    }
    if (flattened !== 4) {
      throw new Error('v0W2 중앙 대칭화가 4셀이 아니다 (K3 비대칭 셀 수): ' + flattened);
    }
    // 동심 사각 36 = v0xq CORNER **같은 배열** (v0W·v0WQ 와 공유하는 그 배열).
    if (V0W2_CELLS.slice(25, 61).some((row, index) => row !== V0XQ_CORNER_CELLS[index])) {
      throw new Error('v0W2 동심 사각이 v0xq CORNER 공유 배열이 아니다');
    }
    // 대형 마커 36 — 좌표·T·L 은 v0X SE 에서 유도, R 은 손 표.
    const v0xSe = V0X_CELLS.filter(([i, j]) =>
      i >= V0X_BLOCKS.SE.iMin && j >= V0X_BLOCKS.SE.jMin);
    if (v0xSe.length !== 36) throw new Error('v0X SE 가 36셀이 아니다: ' + v0xSe.length);
    if (V0W2_MARKER_CELLS.length !== 36) {
      throw new Error('v0W2 대형 마커가 36셀이 아니다: ' + V0W2_MARKER_CELLS.length);
    }
    let asymmetric = 0;
    for (let index = 0; index < 36; index += 1) {
      const [i, j, T] = v0xSe[index];
      const [i2, j2, T2, L2, R2] = V0W2_MARKER_CELLS[index];
      if (i !== i2 || j !== j2) throw new Error('v0W2 마커 좌표가 v0X SE 와 다르다: ' + index);
      if (T2 !== T || L2 !== T) {
        throw new Error('v0W2 마커 (' + i + ',' + j + ') 의 T·L 이 v0X SE 톤이 아니다');
      }
      if (R2 !== 0 && R2 !== 2) {
        throw new Error('v0W2 마커 (' + i + ',' + j + ') 의 R 이 0|2 가 아니다: ' + R2);
      }
      if (R2 !== T2) asymmetric += 1;
    }
    // 설계 의도 ② — 면 비대칭은 **전부 SE 안**이고, v0W(10) 보다 두껍다.
    if (asymmetric !== 22) {
      throw new Error('v0W2 마커의 면 비대칭 셀이 22가 아니다: ' + asymmetric);
    }
    // 블록 분할 25/36/36 — 세 블록 밖 셀 0, 겹침 0.
    const counts = { NW: 0, NE: 0, SE: 0 };
    let asymOutsideSe = 0;
    for (const [i, j, T, L, R] of V0W2_CELLS) {
      const homes = [];
      if (i <= V0W2_BLOCKS.NW.iMax && j <= V0W2_BLOCKS.NW.jMax) homes.push('NW');
      if (i <= V0W2_BLOCKS.NE.iMax && j >= V0W2_BLOCKS.NE.jMin) homes.push('NE');
      if (i >= V0W2_BLOCKS.SE.iMin && j >= V0W2_BLOCKS.SE.jMin) homes.push('SE');
      if (homes.length !== 1) {
        throw new Error('v0W2 셀 (' + i + ',' + j + ') 의 블록 소속이 ' + homes.length + '개다');
      }
      counts[homes[0]] += 1;
      if (T === 1 || L === 1 || R === 1) {
        throw new Error('v0W2 정본에 mid 면이 있다: (' + i + ',' + j + ')');
      }
      if (!(T === L && L === R) && homes[0] !== 'SE') asymOutsideSe += 1;
    }
    if (counts.NW !== 25 || counts.NE !== 36 || counts.SE !== 36) {
      throw new Error('v0W2 블록 분할이 25/36/36 이 아니다: '
        + [counts.NW, counts.NE, counts.SE].join('/'));
    }
    // 설계 의도 ① — NW·NE 는 **검출 전용**이다 (면 비대칭 0).
    if (asymOutsideSe !== 0) {
      throw new Error('v0W2 의 SE 밖에 면 비대칭 셀이 있다: ' + asymOutsideSe);
    }
    if (slotCellsFor(CELL_SURFACE_FINAL_V0W2, CELL_SURFACE_EDGE_ANCHOR_BASE_N).length !== 0) {
      throw new Error('v0W2 에 QR 슬롯이 생겼다 — v0xq · v0wq · v0wy 전용이다');
    }
  }

  // ①-g v0WY 정본 — 67셀 (K3 중앙 25 + 동심 사각 36 + SW 위상 마커 6) · mid 0 · 슬롯 64.
  //
  // v0WY 도 «새 무늬» 가 0 이다 — 세 블록이 전부 **기존 배열 참조**이고 슬롯 크기는
  // v0WQ 값의 참조다. 그래서 여기서 재는 것은 톤 표가 아니라 ⓐ 참조 동일성
  // ⓑ 겹침 해소가 실제로 됐는가 ⓒ **v0W 와 셀 수준으로 갈라지는가** (양방향) 다.
  // ⓒ 가 이 편입의 존재 이유다 — 브리프의 «최대 지뢰» 를 회귀로 못 박는 자리.
  if (V0WY_CELLS.length !== 67) {
    throw new Error('v0WY 정본이 67셀이 아니다: ' + V0WY_CELLS.length);
  }
  {
    if (V0WY_CELLS.slice(0, 25).some((row, index) => row !== K3_CENTRE_CELLS[index])) {
      throw new Error('v0WY 중앙이 K3 공유 배열이 아니다');
    }
    if (V0WY_CELLS.slice(25, 61).some((row, index) => row !== V0XQ_CORNER_CELLS[index])) {
      throw new Error('v0WY 동심 사각이 v0xq CORNER 공유 배열이 아니다');
    }
    if (V0WY_CELLS.slice(61).some((row, index) => row !== V0XQ_MARKER_CELLS[index])) {
      throw new Error('v0WY 위상 마커가 v0xq MARKER(=v0X SW) 공유 배열이 아니다');
    }
    // 마커 계보 — v0X SW 는 **v0 정본 SW 3×2 의 (+8, 0) 평행이동**이다. v0W 의 SE 가
    // v0 SE 의 (+8,+8) 인 것과 같은 규칙이라, «마커를 SW 로 옮긴다» 가 새 도안이
    // 아니라 **형제 블록 선택**임을 값으로 못 박는다.
    const v0Sw = V0_CELLS.filter(([i, j]) => i >= V0_FAR_MIN && j <= 1);
    if (v0Sw.length !== 6) throw new Error('v0 SW 3×2 가 6셀이 아니다: ' + v0Sw.length);
    for (let index = 0; index < 6; index += 1) {
      const [i, j, T, L, R] = v0Sw[index];
      const want = [i + V0W_BASE_FAR_SHIFT, j, T, L, R].join(',');
      if (V0XQ_MARKER_CELLS[index].join(',') !== want) {
        throw new Error('v0WY 마커가 v0 SW 정본의 (+8,0) 평행이동본이 아니다: ' + index);
      }
    }
    // 슬롯 규약 — 크기는 v0WQ 와 **같아야** 한다 (운영자 스펙) 이고 자리는 **달라야**
    // 한다 (같으면 v0WQ 와 셀 집합이 겹쳐 버린다).
    if (CENTER_QR_SLOT_CELLS_V0WY !== CENTER_QR_SLOT_CELLS_V0WQ) {
      throw new Error('v0WY 슬롯 한 변이 v0WQ 와 다르다 — 운영자 스펙은 «동일 크기» 다');
    }
    const wyOrigin = centerQrSlotOriginFor(
      CELL_SURFACE_FINAL_V0WY, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    );
    const wqOrigin = centerQrSlotOriginFor(
      CELL_SURFACE_FINAL_V0WQ, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    );
    if (wyOrigin.i === wqOrigin.i && wyOrigin.j === wqOrigin.j) {
      throw new Error('v0WY 슬롯이 v0WQ 와 같은 자리다 — 먼 코너 배치가 아니다');
    }
    if (wyOrigin.i !== V0WY_BLOCKS.SLOT.iMin) {
      throw new Error('v0WY 슬롯이 먼 코너에 앵커되지 않았다: ' + wyOrigin.i);
    }
    // 블록 분할 25/36/6 — 세 블록 밖 셀 0 · 겹침 0 · **슬롯과의 겹침 0**
    // (이 마지막 항이 겹침 해소 결정의 회귀다: SE 마커를 그대로 뒀다면 여기서 터진다).
    const counts = { NW: 0, NE: 0, SW: 0 };
    for (const [i, j, T, L, R] of V0WY_CELLS) {
      const homes = [];
      if (i <= V0WY_BLOCKS.NW.iMax && j <= V0WY_BLOCKS.NW.jMax) homes.push('NW');
      if (i <= V0WY_BLOCKS.NE.iMax && j >= V0WY_BLOCKS.NE.jMin) homes.push('NE');
      if (i >= V0WY_BLOCKS.SW.iMin && j <= V0WY_BLOCKS.SW.jMax) homes.push('SW');
      if (homes.length !== 1) {
        throw new Error('v0WY 셀 (' + i + ',' + j + ') 의 블록 소속이 ' + homes.length + '개다');
      }
      counts[homes[0]] += 1;
      if (T === 1 || L === 1 || R === 1) {
        throw new Error('v0WY 정본에 mid 면이 있다: (' + i + ',' + j + ')');
      }
      if (i >= V0WY_BLOCKS.SLOT.iMin && j >= V0WY_BLOCKS.SLOT.jMin) {
        throw new Error('v0WY 파인더 셀 (' + i + ',' + j + ') 이 먼 코너 QR 슬롯 안이다');
      }
    }
    if (counts.NW !== 25 || counts.NE !== 36 || counts.SW !== 6) {
      throw new Error('v0WY 블록 분할이 25/36/6 이 아니다: '
        + [counts.NW, counts.NE, counts.SW].join('/'));
    }
    // 위상 판별력의 유일한 원천 — 중앙 K3 도 4셀 비대칭이지만 그것만으로는
    // margin 0.0437 (게이트의 1.25배) 이라 후보 (a) 가 탈락했다. SW 마커가 있어야 한다.
    if (!V0XQ_MARKER_CELLS.some(([, , T, L, R]) => T === L && R !== T)) {
      throw new Error('v0WY 위상 마커에 면 비대칭이 없다 — 120° 판별력이 K3 4셀뿐이 된다');
    }
    // ⓒ **v0W 와 양방향으로 갈라진다** — 이것이 편입의 존재 이유다. 어느 한쪽이라도
    // 0 이 되면 «파인더가 같은 두 레이아웃» 이 돼 교차 오수용이 설계로 들어온다.
    const wyKeys = new Set(V0WY_CELLS.map(([i, j]) => cellKey(i, j)));
    const wKeys = new Set(V0W_CELLS.map(([i, j]) => cellKey(i, j)));
    const mineOnly = [...wyKeys].filter((key) => !wKeys.has(key));
    const theirsOnly = [...wKeys].filter((key) => !wyKeys.has(key));
    if (mineOnly.length !== 6 || theirsOnly.length !== 9) {
      throw new Error(
        'v0WY ↔ v0W 파인더 차이가 6/9 가 아니다: '
        + mineOnly.length + '/' + theirsOnly.length,
      );
    }
    // 그리고 v0W 의 SE 마커 9셀은 **전부 v0WY 슬롯 안**이어야 한다 — 그 포함이
    // «먼 코너를 QR 이 가져갔다» 의 정의다.
    const slotKeys = new Set(slotCellsFor(
      CELL_SURFACE_FINAL_V0WY, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    )
      .map((cell) => cellKey(cell.i, cell.j)));
    if (!theirsOnly.every((key) => slotKeys.has(key))) {
      throw new Error('v0W SE 마커가 v0WY 슬롯 안에 다 들어 있지 않다');
    }
  }

  // ①-h v0T 정본 — 104셀 (NW 16 + A 9 + N팔 10 + NE 36 + W 24 + SE 9) · mid 0 ·
  // 슬롯 0 · 비대칭 15 (A 9 + SE 6).
  //
  // 유도 61 + 전사 43 의 경계를 참조/값으로 못 박는다 — 팩과의 완전 대조는
  // `claude-v0t-derive.mjs` §④ 가 돌린다 (팩은 repo 밖 정본이라 로드 시점엔 없다).
  if (V0T_CELLS.length !== 104) {
    throw new Error('v0T 정본이 104셀이 아니다: ' + V0T_CELLS.length);
  }
  {
    // 중앙 16 = K3 대칭화본의 (0..3)² 부분 **같은 행 참조** (필터 유도).
    if (V0T_CENTRE_CELLS.length !== 16) {
      throw new Error('v0T 중앙이 16셀이 아니다: ' + V0T_CENTRE_CELLS.length);
    }
    for (const row of V0T_CENTRE_CELLS) {
      if (!K3_CENTRE_SYMMETRIC_CELLS.includes(row)) {
        throw new Error('v0T 중앙이 K3 대칭화본의 행 참조가 아니다');
      }
    }
    // NE 36 = v0xq CORNER **같은 배열 조각** · SE 9 = v0W PHASE **같은 배열 조각**.
    // (드랍된 v0W 계열의 정본 의존이 실재한다는 증명 — 지우면 여기서 터진다.)
    if (V0T_CELLS.slice(35, 71).some((row, index) => row !== V0XQ_CORNER_CELLS[index])) {
      throw new Error('v0T 동심 사각이 v0xq CORNER 공유 배열이 아니다');
    }
    if (V0T_CELLS.slice(95).some((row, index) => row !== V0W_PHASE_CELLS[index])) {
      throw new Error('v0T SE 가 v0W PHASE 공유 배열이 아니다');
    }
    // 블록 분할 16/9/10/36/24/9 — 여섯 블록 밖 셀 0 · 겹침 0 · mid 0.
    const counts = { NW: 0, A: 0, ARM: 0, NE: 0, W: 0, SE: 0 };
    let asymA = 0;
    let asymSe = 0;
    let asymElsewhere = 0;
    for (const [i, j, T, L, R] of V0T_CELLS) {
      const homes = [];
      if (i <= V0T_BLOCKS.NW.iMax && j <= V0T_BLOCKS.NW.jMax) homes.push('NW');
      if (i >= V0T_BLOCKS.A.iMin && i <= V0T_BLOCKS.A.iMax
        && j >= V0T_BLOCKS.A.jMin && j <= V0T_BLOCKS.A.jMax) homes.push('A');
      if (i <= V0T_BLOCKS.ARM.iMax && j >= V0T_BLOCKS.ARM.jMin
        && j <= V0T_BLOCKS.ARM.jMax) homes.push('ARM');
      if (i <= V0T_BLOCKS.NE.iMax && j >= V0T_BLOCKS.NE.jMin) homes.push('NE');
      if (i >= V0T_BLOCKS.W.iMin && i <= V0T_BLOCKS.W.iMax && j <= V0T_BLOCKS.W.jMax) {
        homes.push('W');
      }
      if (i >= V0T_BLOCKS.SE.iMin && j >= V0T_BLOCKS.SE.jMin) homes.push('SE');
      if (homes.length !== 1) {
        throw new Error('v0T 셀 (' + i + ',' + j + ') 의 블록 소속이 ' + homes.length + '개다');
      }
      counts[homes[0]] += 1;
      if (T === 1 || L === 1 || R === 1) {
        throw new Error('v0T 정본에 mid 면이 있다: (' + i + ',' + j + ')');
      }
      if (!(T === L && L === R)) {
        if (homes[0] === 'A') asymA += 1;
        else if (homes[0] === 'SE') asymSe += 1;
        else asymElsewhere += 1;
      }
    }
    if (counts.NW !== 16 || counts.A !== 9 || counts.ARM !== 10
      || counts.NE !== 36 || counts.W !== 24 || counts.SE !== 9) {
      throw new Error('v0T 블록 분할이 16/9/10/36/24/9 가 아니다: '
        + [counts.NW, counts.A, counts.ARM, counts.NE, counts.W, counts.SE].join('/'));
    }
    // **의도된 비대칭 이중화** (운영자 확정 2026-08-17) — A 9 (L 반전) + SE 6 (R 반전),
    // 그 밖 0. A 는 L 만 달라야 하고 SE 는 R 만 달라야 한다 (팩 structure 주장).
    if (asymA !== 9 || asymSe !== 6 || asymElsewhere !== 0) {
      throw new Error('v0T 비대칭 분포가 A 9 · SE 6 · 그 밖 0 이 아니다: '
        + [asymA, asymSe, asymElsewhere].join('/'));
    }
    for (const [i, j, T, L, R] of V0T_A_CELLS) {
      if (T !== R || L === T) {
        throw new Error('v0T A 블록 (' + i + ',' + j + ') 이 «L 만 반전» 이 아니다');
      }
    }
    if (slotCellsFor(CELL_SURFACE_FINAL_V0T, CELL_SURFACE_EDGE_ANCHOR_BASE_N).length !== 0) {
      throw new Error('v0T 에 QR 슬롯이 생겼다 — v0xq · v0wq · v0wy · v0ty 전용이다');
    }
  }

  // ①-i v0TY 정본 — 95셀 (v0T − SE 9) · mid 0 · 슬롯 64.
  //
  // 정의가 곧 유도다 — V0T_CELLS 의 슬롯 박스 필터. 여기서 재는 것은
  // ⓐ 필터가 정확히 SE 9 만 걷어냈는가 ⓑ 행 참조가 유지되는가 ⓒ 남은 비대칭이
  // **A 블록 하나**인가 (의도된 이중화의 실증 — 보충 블록 0 · 마커 이전 0) 다.
  if (V0TY_CELLS.length !== 95) {
    throw new Error('v0TY 정본이 95셀이 아니다: ' + V0TY_CELLS.length);
  }
  {
    for (const row of V0TY_CELLS) {
      if (!V0T_CELLS.includes(row)) {
        throw new Error('v0TY 에 v0T 밖 행이 있다 — 필터 유도가 아니다');
      }
    }
    // 걷어낸 것 = 정확히 V0W_PHASE_CELLS (v0T SE) 9행이고, 전부 슬롯 안이다.
    const removed = V0T_CELLS.filter((row) => !V0TY_CELLS.includes(row));
    if (removed.length !== 9 || removed.some((row, index) => row !== V0W_PHASE_CELLS[index])) {
      throw new Error('v0TY 필터가 걷어낸 것이 v0T SE (v0W PHASE) 9행이 아니다');
    }
    const slotKeys = new Set(slotCellsFor(
      CELL_SURFACE_FINAL_V0TY, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    )
      .map((cell) => cellKey(cell.i, cell.j)));
    if (!removed.every(([i, j]) => slotKeys.has(cellKey(i, j)))) {
      throw new Error('v0T SE 블록이 v0TY 슬롯 안에 다 들어 있지 않다');
    }
    for (const [i, j] of V0TY_CELLS) {
      if (i >= V0TY_BLOCKS.SLOT.iMin && j >= V0TY_BLOCKS.SLOT.jMin) {
        throw new Error('v0TY 파인더 셀 (' + i + ',' + j + ') 이 먼 코너 QR 슬롯 안이다');
      }
    }
    // 남은 방향 판별자 = A 블록 (L 반전 9셀) **하나** — 보충 블록 신설 금지의 회귀.
    const asym = V0TY_CELLS.filter(([, , T, L, R]) => !(T === L && L === R));
    if (asym.length !== 9 || asym.some((row) => !V0T_A_CELLS.includes(row))) {
      throw new Error('v0TY 의 비대칭이 A 블록 9셀만이 아니다: ' + asym.length);
    }
    // 슬롯 규약 — 크기는 v0WQ·v0WY 와 같아야 (운영자 스펙) 하고 자리는 far 앵커다.
    if (CENTER_QR_SLOT_CELLS_V0TY !== CENTER_QR_SLOT_CELLS_V0WQ) {
      throw new Error('v0TY 슬롯 한 변이 v0WQ 와 다르다 — 운영자 스펙은 «동일 크기» 다');
    }
    const tyOrigin = centerQrSlotOriginFor(
      CELL_SURFACE_FINAL_V0TY, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    );
    if (tyOrigin.i !== V0TY_BLOCKS.SLOT.iMin || tyOrigin.i !== tyOrigin.j) {
      throw new Error('v0TY 슬롯이 먼 코너에 앵커되지 않았다: ' + tyOrigin.i + ',' + tyOrigin.j);
    }
  }

  // ①-j v0TR 정본 — 102셀 (중앙 16 + **A 9** + NE 68 + SE 9) · mid 0 · 비대칭 15 · 슬롯 0.
  //
  // A 블록은 2026-08-18 운영자 지적으로 편입됐다 (최초 정본에 빠져 있었다).
  // 없으면 v0TRY 에서 슬롯이 SE 를 삼킨 뒤 방향 판별자가 0 이 된다 (§V0TR_CELLS).
  //
  // 전사가 한 줄도 없는 구조라 여기서 재는 것은 «유도가 실제로 정본 배열을 물고
  // 있는가» 다: 중앙·바깥 사각·SE 는 **행 참조 동일성**으로, 안쪽 사각은
  // **평행이동 사상**으로 못 박는다. 물린 배열이 조용히 바뀌면 여기서 터진다.
  if (V0TR_CELLS.length !== 102) {
    throw new Error('v0TR 정본이 102셀이 아니다: ' + V0TR_CELLS.length);
  }
  {
    // ⓐ 중앙 16 = V0T_CENTRE_CELLS 행 참조 그대로 (새 배열 신설 금지 규약).
    if (V0TR_CELLS.slice(0, V0T_CENTRE_CELLS.length)
      .some((row, index) => row !== V0T_CENTRE_CELLS[index])) {
      throw new Error('v0TR 중앙이 V0T_CENTRE_CELLS 행 참조가 아니다');
    }
    // ⓐ' A 9 = V0T_A_CELLS 행 참조 그대로 (v0T 와 문자 그대로 같은 셀·같은 톤).
    const aStart = V0T_CENTRE_CELLS.length;
    if (V0TR_CELLS.slice(aStart, aStart + V0T_A_CELLS.length)
      .some((row, index) => row !== V0T_A_CELLS[index])) {
      throw new Error('v0TR A 블록이 V0T_A_CELLS 행 참조가 아니다');
    }
    // ⓑ NE 바깥 36 = V0XQ_CORNER_CELLS 행 참조 그대로 (= v0T NE 와 같은 배열).
    const outerStart = V0T_CENTRE_CELLS.length + V0T_A_CELLS.length;
    if (V0TR_CELLS.slice(outerStart, outerStart + V0XQ_CORNER_CELLS.length)
      .some((row, index) => row !== V0XQ_CORNER_CELLS[index])) {
      throw new Error('v0TR NE 바깥 사각이 V0XQ_CORNER_CELLS 행 참조가 아니다');
    }
    // ⓒ SE 9 = V0W_PHASE_CELLS 행 참조 그대로.
    if (V0TR_CELLS.slice(V0TR_CELLS.length - V0W_PHASE_CELLS.length)
      .some((row, index) => row !== V0W_PHASE_CELLS[index])) {
      throw new Error('v0TR SE 가 V0W_PHASE_CELLS 행 참조가 아니다');
    }
    // ⓓ NE 합집합 68 = 36 + 36 − 겹침 4, 그리고 겹치는 4셀은 **톤까지 같다**
    //    (같지 않으면 «안쪽 사본을 빼고 바깥을 남긴다» 는 선택이 정보를 죽인다).
    if (V0TR_NE_CELLS.length !== 68) {
      throw new Error('v0TR NE 합집합이 68셀이 아니다: ' + V0TR_NE_CELLS.length);
    }
    const outerByKey = new Map(V0XQ_CORNER_CELLS.map((row) => [cellKey(row[0], row[1]), row]));
    let shared = 0;
    for (const [i, j, T, L, R] of V0TR_INNER_CELLS) {
      const twin = outerByKey.get(cellKey(i, j));
      if (!twin) continue;
      shared += 1;
      if (twin[2] !== T || twin[3] !== L || twin[4] !== R) {
        throw new Error('v0TR 두 동심 사각의 겹침 셀 톤이 다르다: ' + cellKey(i, j));
      }
    }
    if (shared !== 4) {
      throw new Error('v0TR 두 동심 사각의 겹침이 4셀이 아니다: ' + shared);
    }
    // ⓔ 안쪽 사각이 정말 바깥 사각의 평행이동인가 (사상 전수 — 톤 변경 0).
    if (V0TR_INNER_CELLS.length !== V0XQ_CORNER_CELLS.length) {
      throw new Error('v0TR 안쪽 사각 셀 수가 바깥과 다르다');
    }
    for (let index = 0; index < V0TR_INNER_CELLS.length; index += 1) {
      const [i, j, T, L, R] = V0TR_INNER_CELLS[index];
      const [oi, oj, oT, oL, oR] = V0XQ_CORNER_CELLS[index];
      if (i !== oi + V0TR_INNER_SHIFT_I || j !== oj + V0TR_INNER_SHIFT_J
        || T !== oT || L !== oL || R !== oR) {
        throw new Error('v0TR 안쪽 사각이 바깥 사각의 평행이동이 아니다: ' + cellKey(i, j));
      }
    }
    // ⓕ 블록 상자 전수 — 102셀이 정확히 다섯 상자(NW·A·NE 바깥·NE 안쪽·SE) 안에
    //    있고, 상자마다 기대 셀 수를 갖는가. 상자 밖 셀이 하나라도 있으면 터진다.
    const box = { NW: 0, A: 0, NE_OUTER: 0, NE_INNER: 0, SE: 0 };
    for (const [i, j] of V0TR_CELLS) {
      const homes = [];
      if (i <= V0TR_BLOCKS.NW.iMax && j <= V0TR_BLOCKS.NW.jMax) homes.push('NW');
      if (i >= V0TR_BLOCKS.A.iMin && i <= V0TR_BLOCKS.A.iMax
        && j >= V0TR_BLOCKS.A.jMin && j <= V0TR_BLOCKS.A.jMax) homes.push('A');
      if (i <= V0TR_BLOCKS.NE_OUTER.iMax && j >= V0TR_BLOCKS.NE_OUTER.jMin) homes.push('NE_OUTER');
      if (i >= V0TR_BLOCKS.NE_INNER.iMin && i <= V0TR_BLOCKS.NE_INNER.iMax
        && j >= V0TR_BLOCKS.NE_INNER.jMin && j <= V0TR_BLOCKS.NE_INNER.jMax) {
        homes.push('NE_INNER');
      }
      if (i >= V0TR_BLOCKS.SE.iMin && j >= V0TR_BLOCKS.SE.jMin) homes.push('SE');
      if (homes.length === 0) {
        throw new Error('v0TR 셀이 어느 블록에도 없다: ' + cellKey(i, j));
      }
      for (const home of homes) box[home] += 1;
    }
    if (box.NW !== 16 || box.A !== 9 || box.NE_OUTER !== 36
      || box.NE_INNER !== 36 || box.SE !== 9) {
      throw new Error('v0TR 블록 분할이 16/9/36/36/9 가 아니다: ' + JSON.stringify(box));
    }
    // ⓖ 비대칭 15 = A 9 (L 반전) + SE 6 (R 반전) — **의도된 이중화**를 못 박는다.
    //
    // ⚠ **정정 (2026-08-18)**: 여기에는 «비대칭은 SE 6셀뿐 — A 블록이 없다는 사실을
    // 회귀로 못 박는다» 가 있었다. 그건 레인이 규약을 어긴 게 아니라 **내 브리프가
    // «보충 블록 신설 금지» 를 지시한 결과**였다 — 레인은 그대로 지켰고 부재를
    // 정직하게 잠가 뒀다. 그러나 그 상태로는 v0TRY 가 성립하지 않는다(슬롯이 SE 를
    // 삼키면 판별자 0). 운영자 지적으로 A 를 편입하며 이 회귀도 뒤집는다.
    // A 는 «신설» 이 아니라 v0T 정본의 **행 참조 재사용**이라 금지 규약과도 맞는다.
    const asym = V0TR_CELLS.filter(([, , T, L, R]) => !(T === L && L === R));
    const asymA = asym.filter((row) => V0T_A_CELLS.includes(row));
    const asymSe = asym.filter((row) => V0W_PHASE_CELLS.includes(row));
    if (asym.length !== 15 || asymA.length !== 9 || asymSe.length !== 6) {
      throw new Error('v0TR 비대칭이 A 9 + SE 6 이 아니다: '
        + JSON.stringify({ total: asym.length, A: asymA.length, SE: asymSe.length }));
    }
    if (slotCellsFor(CELL_SURFACE_FINAL_V0TR, CELL_SURFACE_EDGE_ANCHOR_BASE_N).length !== 0) {
      throw new Error('v0TR 에 QR 슬롯이 생겼다 — 슬롯은 v0trq 쪽이다');
    }
  }

  // ①-k v0TRQ 정본 — 77셀 (v0TR − 중앙 16 − A 9) · 슬롯 64 · 비대칭 6.
  // v0TY 와 같은 규약: 정의가 곧 유도(슬롯 박스 필터)이므로 여기서 재는 것은
  // ⓐ 필터가 정확히 중앙 16 + A 9 를 걷어냈는가 ⓑ 행 참조 유지 ⓒ 슬롯 규약이다.
  //
  // ⚠ A 블록 (4..6)×(3..5) 은 중앙 슬롯 상자 (0..7)² **안에 완전히 들어간다** —
  // 즉 v0TRQ 에서는 A 가 QR 밑에 깔려 셀 수·비대칭이 A 편입 전과 **같다**.
  // 방향은 SE 6 이 준다 (중앙이 QR 이므로 «안쪽이든 면 코너든 하나는 가려도 된다»
  // 는 운영자 이중화 설계 그대로다). v0TRY 는 반대로 SE 를 잃고 A 가 남는다.
  if (V0TRQ_CELLS.length !== 77) {
    throw new Error('v0TRQ 정본이 77셀이 아니다: ' + V0TRQ_CELLS.length);
  }
  {
    for (const row of V0TRQ_CELLS) {
      if (!V0TR_CELLS.includes(row)) {
        throw new Error('v0TRQ 에 v0TR 밖 행이 있다 — 필터 유도가 아니다');
      }
    }
    const removed = V0TR_CELLS.filter((row) => !V0TRQ_CELLS.includes(row));
    const expectedRemoved = [...V0T_CENTRE_CELLS, ...V0T_A_CELLS];
    if (removed.length !== expectedRemoved.length
      || removed.some((row, index) => row !== expectedRemoved[index])) {
      throw new Error('v0TRQ 필터가 걷어낸 것이 v0T 중앙 16 + A 9 행이 아니다: '
        + removed.length);
    }
    const slotKeys = new Set(slotCellsFor(
      CELL_SURFACE_FINAL_V0TRQ, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    )
      .map((cell) => cellKey(cell.i, cell.j)));
    if (slotKeys.size !== 64) {
      throw new Error('v0TRQ 슬롯이 64셀이 아니다: ' + slotKeys.size);
    }
    if (!removed.every(([i, j]) => slotKeys.has(cellKey(i, j)))) {
      throw new Error('v0TR 중앙 16셀이 v0TRQ 슬롯 안에 다 들어 있지 않다');
    }
    for (const [i, j] of V0TRQ_CELLS) {
      if (i <= V0TRQ_BLOCKS.SLOT.iMax && j <= V0TRQ_BLOCKS.SLOT.jMax) {
        throw new Error('v0TRQ 파인더 셀 (' + i + ',' + j + ') 이 중앙 QR 슬롯 안이다');
      }
    }
    // 남은 방향 판별자 = SE 마커뿐 (v0TR 과 같은 6셀 — 슬롯이 삼킨 것은 대칭 중앙이다).
    const asym = V0TRQ_CELLS.filter(([, , T, L, R]) => !(T === L && L === R));
    if (asym.length !== 6 || asym.some((row) => !V0W_PHASE_CELLS.includes(row))) {
      throw new Error('v0TRQ 의 비대칭이 SE 6셀만이 아니다: ' + asym.length);
    }
    // 슬롯 규약 — 크기는 v0WQ 참조 사슬, 자리는 seam 앵커 (0,0).
    if (CENTER_QR_SLOT_CELLS_V0TRQ !== CENTER_QR_SLOT_CELLS_V0WQ) {
      throw new Error('v0TRQ 슬롯 한 변이 v0WQ 와 다르다 — 같은 참조 사슬이어야 한다');
    }
    const trqOrigin = centerQrSlotOriginFor(
      CELL_SURFACE_FINAL_V0TRQ, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    );
    if (trqOrigin.i !== 0 || trqOrigin.j !== 0) {
      throw new Error('v0TRQ 슬롯이 Y-심(0,0) 에 앵커되지 않았다: '
        + trqOrigin.i + ',' + trqOrigin.j);
    }
    if (centerQrSlotPlacementFor(CELL_SURFACE_FINAL_V0TRQ).flip !== false) {
      throw new Error('v0TRQ 슬롯은 seam 앵커라 뒤집기가 없어야 한다');
    }
  }

  // ①-l v0TRY 정본 — 93셀 (v0TR − SE 9) · 슬롯 64 · **비대칭 9 = A 블록**.
  //
  // v0TY 와 같은 규약: 정의가 곧 유도(슬롯 박스 필터)이므로 여기서 재는 것은
  // ⓐ 필터가 정확히 SE 9 를 걷어냈는가 ⓑ 행 참조 유지 ⓒ 슬롯 규약 ⓓ **판별자 잔존**.
  //
  // ⚠ ⓓ 가 이 블록의 존재 이유다. A 블록 편입(`00936ce`) 전 v0TR 이었다면 여기서
  // 비대칭 0 이 나와 터졌을 것이다 — «슬롯이 SE 를 삼키면 방향 판별자가 사라진다» 를
  // 회귀가 아니라 **로드 시**에 잠근다. 나중에 누가 A 를 다시 빼면 여기서 즉사한다.
  if (V0TRY_CELLS.length !== 93) {
    throw new Error('v0TRY 정본이 93셀이 아니다: ' + V0TRY_CELLS.length);
  }
  {
    for (const row of V0TRY_CELLS) {
      if (!V0TR_CELLS.includes(row)) {
        throw new Error('v0TRY 에 v0TR 밖 행이 있다 — 필터 유도가 아니다');
      }
    }
    const removed = V0TR_CELLS.filter((row) => !V0TRY_CELLS.includes(row));
    if (removed.length !== V0W_PHASE_CELLS.length
      || removed.some((row, index) => row !== V0W_PHASE_CELLS[index])) {
      throw new Error('v0TRY 필터가 걷어낸 것이 SE 9행(V0W_PHASE_CELLS)이 아니다: '
        + removed.length);
    }
    const slotKeys = new Set(slotCellsFor(
      CELL_SURFACE_FINAL_V0TRY, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    )
      .map((cell) => cellKey(cell.i, cell.j)));
    if (slotKeys.size !== 64) {
      throw new Error('v0TRY 슬롯이 64셀이 아니다: ' + slotKeys.size);
    }
    if (!removed.every(([i, j]) => slotKeys.has(cellKey(i, j)))) {
      throw new Error('v0TR SE 9셀이 v0TRY 슬롯 안에 다 들어 있지 않다');
    }
    for (const [i, j] of V0TRY_CELLS) {
      if (i >= V0TRY_BLOCKS.SLOT.iMin && j >= V0TRY_BLOCKS.SLOT.jMin) {
        throw new Error('v0TRY 파인더 셀 (' + i + ',' + j + ') 이 먼 코너 QR 슬롯 안이다');
      }
    }
    // ⓓ 남은 방향 판별자 = A 블록 9셀뿐. **0 이면 이 파생 자체가 성립하지 않는다.**
    const asym = V0TRY_CELLS.filter(([, , T, L, R]) => !(T === L && L === R));
    if (asym.length !== 9 || asym.some((row) => !V0T_A_CELLS.includes(row))) {
      throw new Error('v0TRY 의 비대칭이 A 블록 9셀만이 아니다: ' + asym.length);
    }
    // 슬롯 규약 — 크기·앵커·뒤집기 **전부 v0TY 재사용** (새 상수 신설 0).
    if (centerQrSlotCellsFor(CELL_SURFACE_FINAL_V0TRY)
      !== centerQrSlotCellsFor(CELL_SURFACE_FINAL_V0TY)) {
      throw new Error('v0TRY 슬롯 한 변이 v0TY 와 다르다 — 같은 값을 재사용해야 한다');
    }
    const tryOrigin = centerQrSlotOriginFor(
      CELL_SURFACE_FINAL_V0TRY, CELL_SURFACE_EDGE_ANCHOR_BASE_N,
    );
    if (tryOrigin.i !== V0TRY_BASE_SLOT_MIN || tryOrigin.i !== tryOrigin.j) {
      throw new Error('v0TRY 슬롯이 먼 코너 (13,13) 에 앵커되지 않았다: '
        + tryOrigin.i + ',' + tryOrigin.j);
    }
    const tryPlacement = centerQrSlotPlacementFor(CELL_SURFACE_FINAL_V0TRY);
    const tyPlacement = centerQrSlotPlacementFor(CELL_SURFACE_FINAL_V0TY);
    if (tryPlacement.anchor !== tyPlacement.anchor || tryPlacement.flip !== tyPlacement.flip) {
      throw new Error('v0TRY 슬롯 배치 규약이 v0TY 와 다르다 — 재사용이어야 한다');
    }
    // 코어 반경 불변 — 슬롯은 SE 쪽이라 NE 바깥 사각이 한 셀도 안 줄어야 한다.
    const outerBefore = V0TR_CELLS.filter(([i, j]) => i <= V0TR_BLOCKS.NE_OUTER.iMax
      && j >= V0TR_BLOCKS.NE_OUTER.jMin).length;
    const outerAfter = V0TRY_CELLS.filter(([i, j]) => i <= V0TR_BLOCKS.NE_OUTER.iMax
      && j >= V0TR_BLOCKS.NE_OUTER.jMin).length;
    if (outerBefore !== outerAfter) {
      throw new Error('v0TRY 슬롯이 NE 바깥 사각을 건드렸다 — 코어 반경이 갈린다: '
        + outerBefore + ' → ' + outerAfter);
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
    [CELL_SURFACE_FINAL_V0W, V0W_CELLS],
    [CELL_SURFACE_FINAL_V0WQ, V0WQ_CELLS],
    [CELL_SURFACE_FINAL_V0W2, V0W2_CELLS],
    [CELL_SURFACE_FINAL_V0WY, V0WY_CELLS],
    [CELL_SURFACE_FINAL_V0T, V0T_CELLS],
    [CELL_SURFACE_FINAL_V0TY, V0TY_CELLS],
    [CELL_SURFACE_FINAL_V0TR, V0TR_CELLS],
    [CELL_SURFACE_FINAL_V0TRQ, V0TRQ_CELLS],
    [CELL_SURFACE_FINAL_V0TRY, V0TRY_CELLS],
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
    //   v0w@21  441 − 70 − 12 − 18 = 341 · S=113 · 잔여 2 (레거시 없음 — 신설)
    'v0w@21': { symbols: 113, residual: 2, locator: 70, legacy: null },
    //   v0wq@21 441 − 45 − 64(슬롯 8²) − 12 − 18 = 302 · S=100 · 잔여 2 (레거시 없음)
    'v0wq@21': { symbols: 100, residual: 2, locator: 45, legacy: null },
    //   v0w2@21 441 − 97 − 12 − 18 = 314 · S=104 · 잔여 2 (레거시 없음 — 신설)
    'v0w2@21': { symbols: 104, residual: 2, locator: 97, legacy: null },
    //   v0wy@21 441 − 67 − 64(먼 코너 슬롯 8²) − 12 − 18 = 280 · S=93 · 잔여 1 (레거시 없음)
    'v0wy@21': { symbols: 93, residual: 1, locator: 67, legacy: null },
    //   v0t@21  441 − 104 − 12 − 18 = 307 · S=102 · 잔여 1 (레거시 없음 — 신설)
    'v0t@21': { symbols: 102, residual: 1, locator: 104, legacy: null },
    //   v0t@25  625 − 104 − 12 − 18 = 491 · S=163 · **잔여 2** (n=25 편입 2026-08-25).
    //   ⚠ locator 가 21 과 **같다**(104) — 「면 모서리 기준 배치」의 직접 귀결이다:
    //   블록은 변에서 잰 고정 inset 이라 크기가 안 변하고 데이터 영역만 늘어난다.
    'v0t@25': { symbols: 163, residual: 2, locator: 104, legacy: null },
    //   v0ty@21 441 − 95 − 64(먼 코너 슬롯 8²) − 12 − 18 = 252 · S=84 · 잔여 0 (레거시 없음)
    'v0ty@21': { symbols: 84, residual: 0, locator: 95, legacy: null },
    //   v0ty@25 625 − 95 − 64 − 12 − 18 = 436 · S=145 · 잔여 1 (n=25 편입 2026-08-25).
    //   ⚠ locator 가 21 과 **같다**(95) — 슬롯은 (n−m, n−m) 로 평행이동할 뿐
    //   파인더 셀 수는 안 변한다 (`centerQrSlotOriginFor`).
    'v0ty@25': { symbols: 145, residual: 1, locator: 95, legacy: null },
    //   v0tr@21  441 − 102 − 12 − 18 = 309 · S=103 · 잔여 0 (레거시 없음 — 신설)
    'v0tr@21': { symbols: 103, residual: 0, locator: 102, legacy: null },
    //   v0tr@25 625 − 102 − 12 − 18 = 493 · S=164 · 잔여 1 (n=25 편입 2026-08-25).
    'v0tr@25': { symbols: 164, residual: 1, locator: 102, legacy: null },
    //   v0trq@21 441 − 77 − 64(중앙 슬롯 8²) − 12 − 18 = 270 · S=90 · 잔여 0 (레거시 없음)
    'v0trq@21': { symbols: 90, residual: 0, locator: 77, legacy: null },
    //   v0trq@25 625 − 77 − 64 − 12 − 18 = 454 · S=151 · 잔여 1 (n=25 편입 2026-08-25).
    //   슬롯 원점은 seam (0,0) 이라 n 과 무관하고, locator 도 21 과 **같다**(77).
    'v0trq@25': { symbols: 151, residual: 1, locator: 77, legacy: null },
    //   v0try@21 441 − 93 − 64(먼 코너 슬롯 8²) − 12 − 18 = 254 · S=84 · **잔여 2**
    //   (레거시 없음 — 신설). 잔여 2 는 v0w·v0wq·v0w2 와 같은 값이고 라인업에 전례가 있다.
    'v0try@21': { symbols: 84, residual: 2, locator: 93, legacy: null },
    //   v0try@25 625 − 93 − 64 − 12 − 18 = 438 · S=146 · 잔여 0 (n=25 편입 2026-08-25).
    'v0try@25': { symbols: 146, residual: 0, locator: 93, legacy: null },
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
