/**
 * cellSurfaceFinal.test.js — 최종 라인업 (v0 n=13 · v2r2 n=21/25 · v1r2·v0X n=21)
 * 회계·배정·왕복.
 *
 * 라인업 (운영자 확정 2026-08-15): Y0→v0 · Y1/Y2→v2r2. formatIndex 는 신세대
 * 셀 표면 한 쌍(2T=1 · 3T=3)뿐이다.
 * 2026-08-15 밤 추가: v1r2(n=21, 네 코너 블록 80셀)가 **A/B 후보**로 부활 — 같은
 * formatIndex 쌍을 쓰고, n=21 의 기본은 그대로 v2r2 다. 레이아웃 판별은 로케이터
 * 패밀리 + CS 평가 게이트가 한다.
 * 2026-08-16 추가: v0X(id 'v0x', n=21, QR 파인더 문법 65셀)가 **3파전 후보**로 편입 —
 * 같은 formatIndex 쌍을 쓰고 n=21 기본은 그대로 v2r2 다.
 * 2026-08-16 정규화(운영자 승인): 편입 당시 v0X 에만 있던 mid(1) 면 4개
 * ((0,3).L · (14,20).L/R · (19,19).R)를 정본이 도색 다수 톤으로 확정했다
 * ((0,3)L=0 · (14,20)L/R=2 · (19,19)R=2). **이제 최종 라인업 전 정본에 mid 면이 없다** —
 * 톤 가드가 «전 정본 0/2» 로 단순해졌고 v0X 정방향 일치율이 195/195 가 됐다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

import {
  CELL_SURFACE_FINAL_FORMAT_INDEX,
  CELL_SURFACE_FINAL_IDS,
  CELL_SURFACE_FINAL_NS,
  CELL_SURFACE_FINAL_PROFILE,
  CENTER_QR_FINDER_MODULES,
  CENTER_QR_QUIET_MODULES,
  CENTER_QR_SLOT_CELLS,
  V0W_BLOCKS,
  V0W2_BLOCKS,
  V0WQ_BLOCKS,
  V0XQ_BLOCKS,
  V0X_BLOCKS,
  capacityForCellSurfaceFinal,
  centerQrModulePitchCells,
  centerQrQuietFrameCells,
  centerQrFinderCoreCells,
  centerQrSlotCellsFor,
  centerQrSlotOriginFor,
  centerQrSlotPlacementFor,
  hasCenterQrSlot,
  hasLegacyFormatWire,
  occupiedCellsCellSurfaceFinal,
  slotCellsCellSurfaceFinal,
  cellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  fillerCellsCellSurfaceFinal,
  allFinalLayoutIdsForN,
  finalLayoutIdForN,
  finalLayoutIdsForN,
  hasFinalLayoutWireForN,
  wirePreferredFinalLayoutIdForN,
  CELL_SURFACE_FINAL_ACTIVE_IDS,
  CELL_SURFACE_FINAL_DROPPED_IDS,
  formatIndexCellSurfaceFinal,
  isCellSurfaceFinalFormatIndex,
  isCellSurfaceFinalId,
  layoutMapCellSurfaceFinal,
  locatorCellsCellSurfaceFinal,
  locatorToneCellSurfaceFinal,
  nameCellSurfaceFinal,
  tonesFromCellSurfaceFinalFormatIndex,
  versionForFinalN,
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
} from '../src/cellSurfaceFinal.js';
import { VERSIONS_Y } from '../src/capacityY.js';
import {
  CELL_SURFACE_FORMAT_INDEX_2T,
  CELL_SURFACE_FORMAT_INDEX_3T,
} from '../src/cellSurfaceY.js';
import {
  CELL_SURFACE_LAYOUT_FORMAT_INDEX,
  CELL_SURFACE_LAYOUT_IDS,
} from '../src/cellSurfaceLayouts.js';
import { AutoplaceError, placeReservedCells } from '../src/autoplaceY.js';
import { rsDecode, rsEncode } from '../src/rs211.js';
import { encodeY } from '../src/encodeY.js';
import { TL_READER_URL } from '../src/qr.js';
import { symbolCountForByteLength } from '../src/base211.js';
import { decodeCells } from '../src/decode.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { faceBasis, layoutForCube, moduleCenter } from '../src/ygrid.js';
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { digitToPattern } from '../src/tonemap.js';
import { verifyRasterY } from '../src/verifyY.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import {
  UNVERIFIED_CELL_SURFACE_Y,
  evaluateCellSurfaceGeometry,
} from '../src/decoder/cellSurfaceY-detect.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const LINEUP = Object.freeze([
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v2r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 2, n: 25 },
]);

test('formatIndex 배정 — 한 쌍 (2T=1 · 3T=3), cube 축 기사용 슬롯과 무충돌', () => {
  assert.deepEqual(CELL_SURFACE_FINAL_FORMAT_INDEX, { 2: 1, 3: 3 });
  assert.equal(formatIndexCellSurfaceFinal(2), 1);
  assert.equal(formatIndexCellSurfaceFinal(3), 3);
  assert.equal(CELL_SURFACE_FINAL_FORMAT_INDEX[3], CELL_SURFACE_FINAL_FORMAT_INDEX[2] + 2);
  assert.equal(tonesFromCellSurfaceFinalFormatIndex(1), 2);
  assert.equal(tonesFromCellSurfaceFinalFormatIndex(3), 3);
  assert.throws(() => tonesFromCellSurfaceFinalFormatIndex(5), RangeError);

  const used = new Set(VERSIONS_Y.map((spec) => spec.formatIndex));
  used.add(CELL_SURFACE_FORMAT_INDEX_2T);
  used.add(CELL_SURFACE_FORMAT_INDEX_3T);
  for (const id of CELL_SURFACE_LAYOUT_IDS) {
    used.add(CELL_SURFACE_LAYOUT_FORMAT_INDEX[id][2]);
    used.add(CELL_SURFACE_LAYOUT_FORMAT_INDEX[id][3]);
  }
  // 감사 결과 고정: cube 축 기사용 = {0,2,4,5,6,7,8,9,10,11,12,14} → 빈 슬롯 {1,3,13,15}.
  assert.deepEqual([...used].sort((a, b) => a - b), [0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);
  for (const index of [1, 3]) {
    assert.equal(used.has(index), false, 'formatIndex ' + index + ' 가 이미 사용 중이다');
    assert.equal(isCellSurfaceFinalFormatIndex(index), true);
  }
});

test('n → 라인업 기본·버전 (13→v0/Y0 · 21→**v0t**/Y1 · 25→**공백**), 와이어는 보존', () => {
  // ── 갱신 이력 (아래 단언이 정본이고, 이 줄들은 «어떻게 여기까지 왔나» 다) ──
  //   2026-08-15 밤: v1r2 가 n=21 A/B 후보로 부활 — 기본은 v2r2 유지.
  //   2026-08-16:    v0X 편입으로 n=21 후보 셋 — 기본은 v2r2 유지.
  //   2026-08-17:    v0XQ 편입으로 넷 — 기본은 v2r2 유지.
  //   2026-08-16(드랍): **v2r2·v1r2 를 라인업에서 내림 — 기본이 v0x 로 바뀌었다.**
  //   2026-08-16(v0W):  v0W 편입 — n=21 후보가 셋. **기본은 v0x 그대로**다 (v0W 는 맨 뒤).
  //
  // **의도적 갱신 «드랍 정본화» (운영자 확정 2026-08-16)** — v2r2 · v1r2 를 검출
  // 라인업과 생성기 카드에서 내렸다 (차단·비삭제). 그래서
  //   · `finalLayoutIdsForN(21)` = [v0x, v0xq] · `finalLayoutIdForN(21)` = v0x
  //   · `finalLayoutIdsForN(25)` = [] · `finalLayoutIdForN(25)` = null  ← **Y2 공백**
  //
  // **의도적 갱신 «v0W 편입» (운영자 신설 설계 2026-08-16)** — `CELL_SURFACE_FINAL_IDS`
  // 맨 뒤에 v0w 를 더했다. 선언 순서가 곧 후보 순서라 n=21 목록이
  // [v0x, v0xq, **v0w**] 가 되고 **기본은 v0x 그대로**다 — 기본 전환은 조건부 드랍
  // («v0W > v0X» 실기기 판정)의 몫이지 편입의 몫이 아니다.
  // 와이어는 한 줄도 안 지웠다 — `CELL_SURFACE_FINAL_IDS` · `_NS` · `_PROFILE` ·
  // `hasFinalLayoutWireForN` · `wirePreferredFinalLayoutIdForN` 이 아래에서 그것을
  // 고정한다. 근거·측정: `test/output/claude-v0w-program.md`.
  //
  // **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)** — 맨 뒤에 `v0wq` 를 더했다.
  // n=21 후보가 넷이 되고 **기본은 여전히 v0x** 다. 파생 둘 중 **v0WY 는 여기 없다** —
  // 셀 집합이 v0W 와 비트 동일한 렌더 선택이라 와이어 id 가 아니기 때문이고,
  // 그 사실 자체를 아래 «v0WY 는 와이어 id 가 아니다» 회귀가 따로 고정한다.
  //
  // **의도적 갱신 «v0XQ 드랍» (운영자 실기기 확정 2026-08-17)** — v0W 편입 때 걸어 둔
  // 조건부 드랍 규칙 «v0WQ > v0XQ» 가 실기기 순위(v0WQ ≫ v0XQ > v0X ≈ v0W)로
  // 성립했다. 그래서 `CELL_SURFACE_FINAL_DROPPED_IDS` 에 `v0xq` 가 붙고
  //   · `finalLayoutIdsForN(21)` = **[v0x, v0w, v0wq]** (넷 → 셋)
  //   · `finalLayoutIdForN(21)` = v0x  ← **기본은 안 바뀐다** (드랍은 순위 재산정이 아니다)
  // 가 된다. 선언 배열 `CELL_SURFACE_FINAL_IDS` 는 **와이어**라 그대로 일곱이다.
  //
  // **의도적 갱신 «v0W2 편입» (운영자 신설 설계 2026-08-17)** — 맨 뒤에 `v0w2` 를
  // 더했다. n=21 후보가 넷이 되고 **기본은 여전히 v0x** 다 (편입은 순위를 안 정한다).
  // v0W2 는 v0W 의 실기기 약점 둘(부 파인더 미검출 · 위상 누수)을 고친 파생이고,
  // 정본은 K3 중앙의 3면 대칭화 + v0xq CORNER 공유 + v0X SE 톤에서 **유도**된다
  // (손 표는 SE 의 R 면 36값 하나뿐 — `cellSurfaceFinal.js` §V0W2_CELLS).
  // 근거·측정: `test/output/claude-v0w2-program.md` ·
  // `test/output/lanes/claude-v0w2-{derive,render,probe}.mjs`.
  //
  // **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드)** —
  // 관측 「파인더 인식 다 해놓고도 잘 못 읽음」 + 「v0 과 혼선 자주」. 2라운드의
  // «v0W ≈ v0X» 는 v0W2 가 없던 판정이었고, v0W2 편입(margin 0.1512 = 활성 최고)
  // 으로 그 자리가 채워졌다. 그래서 `CELL_SURFACE_FINAL_DROPPED_IDS` 에 `v0x` 가
  // 붙고 — **이 드랍만 기본을 바꾼다**:
  //   · `finalLayoutIdsForN(21)` = **[v0w, v0wq, v0w2]** (넷 → 셋)
  //   · `finalLayoutIdForN(21)` = **v0w**  ← 앞선 세 드랍과 달리 «기본 자체» 가
  //     빠져서, 선언 순서의 다음(v0w)이 승계한다. 순위 재산정이 아니라 승계다.
  // 와이어(`CELL_SURFACE_FINAL_IDS` 여덟 · `wirePreferredFinalLayoutIdForN(21)`
  // = v2r2)는 한 줄도 안 바뀐다. 정본 배열도 그대로다 — `V0X_CELLS` 는 활성
  // 레이아웃 **v0W2 의 SE(T/L) 유도 원천**이라 지우면 v0W2 가 무너진다.
  // 근거·측정: `test/output/claude-v0wy-program.md`.
  //
  // **의도적 갱신 «v0WY 편입» (운영자 재설계 2026-08-17)** — 맨 뒤에 `v0wy` 를 더했다.
  // n=21 후보가 넷이 되고 **기본은 여전히 v0w** 다 (편입은 순위를 안 정한다 — v0W2
  // 편입과 같은 규약). 위 «v0W 파생 2종» 문단이 「v0WY 는 여기 없다 — 셀 집합이
  // v0W 와 비트 동일한 렌더 선택이라 와이어 id 가 아니다」 라고 적었던 것은
  // **허공 마름모 설계**의 서술이고, QR 이 실루엣 안쪽 먼 코너로 들어오면서 뒤집혔다:
  // 슬롯 64셀 + 위상 마커 SE→SW 이동으로 셀 집합이 실제로 달라졌고, v0W 와
  // **양방향으로** 갈린다 (내 SW 6 ↔ 상대 SE 9). 아래 «v0WY 는 진짜 와이어 id 다»
  // 회귀가 그 등식들을 값으로 고정한다.
  //
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
  // v0T 가 **Type Y 최종 파인더**로 확정됐다. 맨 뒤에 `v0t` · `v0ty` 를 더하고
  // (정본 = 운영자 편집기 export `cellsurface-v0t-editor.json` — 유도 61 + 전사 43,
  // `test/output/lanes/claude-v0t-derive.mjs` 가 팩 ↔ 모듈 104/104 완전 대조),
  // v0W 계열 넷(v0w·v0wq·v0w2·v0wy)을 `CELL_SURFACE_FINAL_DROPPED_IDS` 에 붙였다
  // (차단·비삭제 — v2r2·v1r2·v0xq·v0x 와 같은 규약). 그래서
  //   · `finalLayoutIdsForN(21)` = **[v0t, v0ty]**
  //   · `finalLayoutIdForN(21)` = **v0t**  ← n=21 기본 승계 **v0w → v0t** (v0X 드랍과
  //     같은 «기본 자체가 빠지는» 드랍 — 선언 순서의 다음 활성 항목이 승계한다).
  // **v0TQ 는 없다** — 중앙 [0,m−1]² 슬롯이 m=5..9 에서 autoplace(포맷 복제 이격)에
  // 거부되고, 유일 수용 m=4 는 콰이어트 프레임 0셀이라 슬롯 QR 확증 게이트가
  // 구조적으로 거절한다. 게이트를 내리지 않았고 와이어를 만들지 않았다
  // (실측: `test/output/lanes/claude-v0tqty-probe.mjs`).
  //
  // **의도적 갱신 «v0TR 계열 편입» (운영자 2026-08-17)** — 맨 뒤에 `v0tr` · `v0trq` 를
  // 더했다. **드랩은 하나도 없다** — v0t·v0ty 는 그대로 활성이고 n=21 기본도
  // **v0t 그대로**다 (편입은 순위를 안 정한다 — v0W2·v0WY 편입과 같은 규약.
  // 드랩 판정은 실기기 재스캔 뒤 운영자 몴이다). 정본 = 운영자 편집기 export
  // `cellsurface-v0trq-editor.json` — 이번엔 **유도 77 · 전사 0** 이다
  // (바깥 동심 사각 = `V0XQ_CORNER_CELLS` 같은 배열 · 안쪽 = 그것의 (i+2, j−5)
  //  평행이동 · SE = `V0W_PHASE_CELLS` 같은 배열 · 중앙 = `V0T_CENTRE_CELLS` 같은 배열).
  // **v0TRQ 는 있다** — v0TQ 를 막던 포맷 복제 이격이 v0TR 에서 풀린다
  // **병합 주석 (2026-08-19)** — 이 자리의 충돌은 «둘 중 하나» 가 아니라 **두 축**이었다:
  //   · 운영자 실기기 판정(2026-08-18)의 순서 «v0tr 우선»
  //   · v0TRY 편입 (그 레인은 재정렬 **이전** HEAD 에서 출발했다)
  // 합치면 «판정된 순서 + 맨 뒤 v0try» 다. n=21 기본은 **v0tr 그대로** —
  // v0try 는 라인업 끝에 붙을 뿐 기본을 가져가지 않는다.
  // (S_fmt 340 ≥ 289 · 실측 `claude-v0tr-measure.mjs` ⓓ). **v0TRY 는 안 만들었다** —
  // 먼 코너 슬롯 자리는 실기기에서 잘 동작하는 v0TY 가 지킨다 (운영자 옵션).
  // **의도적 갱신 «n=21 기본 v0t → v0tr» (운영자 실기기 판정 2026-08-18)** — 바로 위
  // 편입 문단이 «드랍 판정은 실기기 재스캔 뒤 운영자 몫» 이라고 미뤄 둔 그 판정이
  // 왔다 (운영자: 「v0T/v0TR 계열 인식 괜찮고, v0TR 우선순위를 가장 높여달라」).
  // **드랍은 여전히 하나도 없다** — v0t·v0ty 는 활성 그대로고, 바뀐 것은 선언
  // 순서뿐이다: `v0tr` 이 `v0t` **앞으로** 옮겨졌다. 그래서
  //   · `CELL_SURFACE_FINAL_IDS` 의 꼬리 = [… v0wy, **v0tr, v0t**, v0ty, v0trq]
  //   · `finalLayoutIdForN(21)` = **v0tr**
  // 이 순서가 관여하는 곳은 `pickBetterLayout` 의 **마지막 동점 처리 한 자리뿐**이다
  // (accepted → agreement → 선언 순서). agreement 가 다르면 순서와 무관하게 높은
  // 쪽이 이기므로, 이 변경은 «v0tr 을 더 잘 잡게» 만드는 것이 아니라 «비겼을 때
  // v0tr 로 부른다» 는 뜻이다 — 인식률 주장으로 읽으면 안 된다.
  assert.deepEqual([...CELL_SURFACE_FINAL_IDS],
    ['v0', 'v2r2', 'v1r2', 'v0x', 'v0xq', 'v0w', 'v0wq', 'v0w2', 'v0wy', 'v0t', 'v0tr',
      'v0try', 'v0trq', 'v0ty']);
  assert.deepEqual([...CELL_SURFACE_FINAL_DROPPED_IDS],
    ['v2r2', 'v1r2', 'v0xq', 'v0x', 'v0w', 'v0wq', 'v0w2', 'v0wy']);
  assert.deepEqual([...CELL_SURFACE_FINAL_ACTIVE_IDS],
    ['v0', 'v0t', 'v0tr', 'v0try', 'v0trq', 'v0ty']);
  assert.equal(finalLayoutIdForN(13), 'v0');
  // **의도적 갱신 (운영자 실기기 판정 2026-08-18)** — n=21 기본이 v0t → **v0tr**.
  // 편입 때 «기본을 바꾸는 것은 실기기 판정의 몫» 이라고 규약에 적어 뒀고 지금이
  // 그 시점이다 (운영자: 「v0T/v0TR 계열 인식 괜찮고, v0TR 우선순위를 가장 높여달라」).
  // 순서는 pickBetterLayout 의 **동점 처리**에만 관여한다 — agreement 가 다르면
  // 순서와 무관하게 높은 쪽이 이긴다.
  // 기본이 v0tr → **v0t** (실기기 순위 3차, 2026-08-19 밤). 첫 원소가 곧 기본이다.
  assert.equal(finalLayoutIdForN(21), 'v0t');
  assert.equal(finalLayoutIdForN(25), null);
  assert.equal(finalLayoutIdForN(11), null);
  assert.deepEqual([...finalLayoutIdsForN(13)], ['v0']);
  // **병합 주석 (2026-08-19)** — 이 자리의 충돌은 «둘 중 하나» 가 아니라 **두 축**이었다:
  //   · 운영자 실기기 판정(2026-08-18)의 순서 «v0tr 우선»
  //   · v0TRY 편입 (그 레인은 재정렬 **이전** HEAD 에서 출발했다)
  // 합치면 «판정된 순서 + 맨 뒤 v0try» 다. n=21 기본은 **v0tr 그대로** —
  // v0try 는 라인업 끝에 붙을 뿐 기본을 가져가지 않는다.
  assert.deepEqual([...finalLayoutIdsForN(21)], ['v0t', 'v0tr', 'v0try', 'v0trq', 'v0ty']);
  assert.deepEqual([...finalLayoutIdsForN(25)], []);
  assert.deepEqual([...finalLayoutIdsForN(11)], []);
  // 와이어 질의는 드랍을 보지 않는다 — 발행된 v2r2@21/@25 · v0xq@21 · v0x@21 ·
  // **v0w 계열@21** 프레임의 판독 경로다.
  assert.equal(cellSurfaceFinal(21, 'v0xq').id, 'v0xq');
  assert.equal(cellSurfaceFinal(21, 'v0x').id, 'v0x');
  assert.equal(cellSurfaceFinal(21, 'v0w').id, 'v0w');
  assert.equal(cellSurfaceFinal(21, 'v0wq').id, 'v0wq');
  assert.equal(cellSurfaceFinal(21, 'v0w2').id, 'v0w2');
  assert.equal(cellSurfaceFinal(21, 'v0wy').id, 'v0wy');
  // 와이어 질의도 **선언 순서**를 그대로 따른다 — 2026-08-18 v0tr 우선순위 변경이
  // 여기까지 비친다 (드랍 포함 전수라는 사실은 그대로다).
  assert.deepEqual([...allFinalLayoutIdsForN(21)],
  // **병합 주석 (2026-08-19)** — 이 자리의 충돌은 «둘 중 하나» 가 아니라 **두 축**이었다:
  //   · 운영자 실기기 판정(2026-08-18)의 순서 «v0tr 우선»
  //   · v0TRY 편입 (그 레인은 재정렬 **이전** HEAD 에서 출발했다)
  // 합치면 «판정된 순서 + 맨 뒤 v0try» 다. n=21 기본은 **v0tr 그대로** —
  // v0try 는 라인업 끝에 붙을 뿐 기본을 가져가지 않는다.
    ['v2r2', 'v1r2', 'v0x', 'v0xq', 'v0w', 'v0wq', 'v0w2', 'v0wy', 'v0t', 'v0tr',
      'v0try', 'v0trq', 'v0ty']);
  assert.equal(hasFinalLayoutWireForN(13), true);
  assert.equal(hasFinalLayoutWireForN(21), true);
  assert.equal(hasFinalLayoutWireForN(25), true);
  assert.equal(hasFinalLayoutWireForN(11), false);
  assert.equal(wirePreferredFinalLayoutIdForN(13), 'v0');
  assert.equal(wirePreferredFinalLayoutIdForN(21), 'v2r2');
  assert.equal(wirePreferredFinalLayoutIdForN(25), 'v2r2');
  assert.equal(wirePreferredFinalLayoutIdForN(11), null);
  // 드랍된 레이아웃도 **여전히 만들어진다** (정본·회계·픽스처 보존).
  assert.equal(cellSurfaceFinal(25, 'v2r2').id, 'v2r2');
  assert.equal(cellSurfaceFinal(21, 'v1r2').id, 'v1r2');
  assert.equal(versionForFinalN(13), 0);
  assert.equal(versionForFinalN(21), 1);
  assert.equal(versionForFinalN(25), 2);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0], [13]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v2r2], [21, 25]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v1r2], [21]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0x], [21]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0xq], [21]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0w], [21]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0wy], [21]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0t], [21]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0ty], [21]);
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0, 'cell-surface-v0');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v2r2, 'cell-surface-v2r2');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v1r2, 'cell-surface-v1r2');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0x, 'cell-surface-v0x');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0xq, 'cell-surface-v0xq');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0w, 'cell-surface-v0w');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0wy, 'cell-surface-v0wy');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0t, 'cell-surface-v0t');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0ty, 'cell-surface-v0ty');
  // formatIndex 신설 금지 — 네 레이아웃이 한 쌍(2T=1 · 3T=3)을 함께 쓴다.
  assert.equal(formatIndexCellSurfaceFinal(2), 1);
  assert.equal(formatIndexCellSurfaceFinal(3), 3);
});

test('v2r2 파인더는 n=13 에서 autoplace REF_QUADRANT 거부다 — 그래서 v0 가 있다', () => {
  const cells = [];
  for (let i = 0; i <= 3; i += 1) for (let j = 0; j <= 3; j += 1) cells.push({ i, j });
  for (let i = 6; i <= 12; i += 1) for (let j = 6; j <= 12; j += 1) cells.push({ i, j });
  assert.throws(
    () => placeReservedCells(13, cells),
    (error) => error instanceof AutoplaceError && error.code === 'AUTOPLACE_REF_QUADRANT',
  );
});

// 의도적 갱신 (2026-08-16, 운영자 지시): v2r2 중앙 블록 A 가 구 4×4 링(16셀)에서
// v1r2 NW 5×5(25셀) 공유로 교체됐다 — painted 65→74, data 349→340 · 533→524.
// 의도적 갱신 (2026-08-16, 포맷 v2 일괄 전환): 포맷 셀 15→18 (마스크 index 2bit 를
// 싣는 6번째 digit). 예약 27→30, data −3 — v0 112→109 · v2r2@21 340→337 · @25 524→521.
test('회계 — v0 169−30−30=109 · v2r2@21 441−74−30=337 · v2r2@25 625−74−30=521', () => {
  const want = {
    13: { locator: 30, data: 109, S: 36, residual: 1 },
    21: { locator: 74, data: 337, S: 112, residual: 1 },
    25: { locator: 74, data: 521, S: 173, residual: 2 },
  };
  for (const [n, w] of Object.entries(want).map(([k, v]) => [Number(k), v])) {
    const surface = cellSurfaceFinal(n);
    assert.equal(surface.locatorCount, w.locator, 'n=' + n + ' locator');
    assert.equal(surface.declaredDataCells, w.data, 'n=' + n + ' data');
    assert.equal(surface.usedSymbols, w.S, 'n=' + n + ' S');
    assert.equal(surface.residualCells, w.residual, 'n=' + n + ' 잔여');
    assert.equal(surface.formatCells.length, 18);
    assert.equal(surface.referenceCells.length, 12);
    assert.equal(dataCellsInScanOrderCellSurfaceFinal(n).length, w.data);
    assert.equal(fillerCellsCellSurfaceFinal(n).length, w.residual);
    assert.equal(
      n * n,
      surface.locatorCount + 30 + w.data,
      'n=' + n + ' 총합 회계',
    );
    // autoplace 하한 충족 (placeReservedCells 가 로드 시 throw 로 이미 강제하지만
    // 수치를 회귀로 고정한다).
    assert.ok(surface.autoplace.dRef >= surface.autoplace.dRefMin);
    assert.ok(surface.autoplace.sFmtMax >= surface.autoplace.sFmtMinRequired);
  }
  for (const tones of [2, 3]) {
    assert.equal(capacityForCellSurfaceFinal(13, 'M', tones).name, tones === 3 ? 'Y0T-CS-V0' : 'Y0-CS-V0');
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones).name, tones === 3 ? 'Y1T-CS-V2R2' : 'Y1-CS-V2R2');
    assert.equal(capacityForCellSurfaceFinal(25, 'M', tones).name, tones === 3 ? 'Y2T-CS-V2R2' : 'Y2-CS-V2R2');
  }
  assert.equal(nameCellSurfaceFinal(13, 2), 'Y0-CS-V0');
});

test('회귀 — 칠한 셀 전체가 cellDigits 에서 role=locator 이고 레이아웃 톤을 갖는다', () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const encoded = encodeY(PAYLOAD, {
        cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
      });
      assert.equal(encoded.n, n);
      const painted = locatorCellsCellSurfaceFinal(n);
      for (const cell of painted) {
        const entry = encoded.cellDigits.get(cell.i + ',' + cell.j);
        assert.ok(entry, layout + '@n=' + n + ': 칠한 셀 (' + cell.i + ',' + cell.j + ') 이 cellDigits 에 없다');
        assert.equal(entry.role, 'locator', layout + '@n=' + n + ' (' + cell.i + ',' + cell.j + ')');
        assert.deepEqual(
          entry.tones,
          { T: cell.T, L: cell.L, R: cell.R },
          layout + '@n=' + n + ' (' + cell.i + ',' + cell.j + ') 레이아웃 톤',
        );
        assert.equal(
          locatorToneCellSurfaceFinal(n, 'T', cell.i, cell.j),
          cell.T,
        );
      }
      // 역방향 — cellDigits 의 locator 역할 수 = 칠한 셀 수 (초과·누락 0).
      let locatorCount = 0;
      for (const [, entry] of encoded.cellDigits) {
        if (entry.role === 'locator') locatorCount += 1;
      }
      assert.equal(locatorCount, painted.length, layout + '@n=' + n + ' locator 수');
      assert.equal(encoded.cellDigits.size, n * n, layout + '@n=' + n + ' 전 셀 배정');
      // 역할 맵과도 일치.
      const map = layoutMapCellSurfaceFinal(n);
      for (const cell of painted) {
        assert.equal(map.get(cell.i + ',' + cell.j).role, 'locator');
      }
    }
  }
});

test('인코더 왕복 — digit 레벨 decodeCells (2톤·3톤 × n=13/21/25)', () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const encoded = encodeY(PAYLOAD, {
        cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
      });
      assert.equal(encoded.formatIndex, tones === 3 ? 3 : 1);
      assert.equal(encoded.version, versionForFinalN(n));
      const digits = dataCellsInScanOrderCellSurfaceFinal(n)
        .map(({ i, j }) => encoded.cellDigits.get(i + ',' + j).digit);
      const decoded = decodeCells(digits, {
        type: 'Y',
        n,
        formatIndex: encoded.formatIndex,
        eccLevel: 'M',
        cellSurfaceLayout: layout,
      });
      assert.equal(decoded.ok, true, layout + '@n=' + n + ' t' + tones + ': ' + decoded.reason);
      assert.equal(decoded.text, PAYLOAD);
      // formatIndex 단독(레이아웃 id 없이 n 만) 경로도 같은 결과 — n-결정 안의 계약.
      const byIndexOnly = decodeCells(digits, {
        type: 'Y', n, formatIndex: encoded.formatIndex, eccLevel: 'M',
      });
      assert.equal(byIndexOnly.ok, true, layout + '@n=' + n + ' t' + tones + ' (index-only): ' + byIndexOnly.reason);
      assert.equal(byIndexOnly.text, PAYLOAD);
    }
  }
});

test('렌더 자체 검증 — verifyRasterY 전 셀 일치 (2톤·3톤 × n=13/21/25)', () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const encoded = encodeY(PAYLOAD, {
        cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
      });
      const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
      const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
      const report = verifyRasterY(raster, scene, encoded, { palette: PALETTE });
      assert.equal(report.mismatches.length, 0, layout + '@n=' + n + ' t' + tones);
      assert.equal(report.erasures.length, 0, layout + '@n=' + n + ' t' + tones);
      assert.ok(report.matched > 0);
      assert.equal(scene.locatorProfile, 'cell-surface-' + layout);
    }
  }
});

function idealSampleCellFor(n, cycle = ['T', 'L', 'R'], id = undefined) {
  const table = locatorCellsCellSurfaceFinal(n, id);
  const byKey = new Map(table.map((cell) => [cell.i + ',' + cell.j, cell]));
  return (i, j) => {
    const cell = byKey.get(i + ',' + j);
    if (!cell) return { i, j, ok: false };
    return {
      i,
      j,
      ok: true,
      T: { median: cell[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: cell[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: cell[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

test('방향 margin — 활성 3종 + 드랍 9행 전수 (활성 v0 0.311 · v0t 0.096 · v0ty 0.063)', () => {
  // margin = 1 − (오방향 최대 일치율). v0 오방향 68.9% → margin 0.311.
  // 의도적 갱신 (2026-08-16): v2r2 중앙이 v1r2 NW 5×5 공유로 교체되며 margin 이
  // 0.2462 → 0.2342 로 재검산됐다 (공유 불스아이 중앙은 회전 대칭성이 높지만 블록 B
  // 가 비대칭을 유지 — 게이트 0.035 의 6.7배로 여전히 여유). 게이트 완화 아님.
  //
  // **의도적 갱신 «드랍 정본화» (2026-08-16)** — 예전엔 `finalLayoutIdForN(n)` 에
  // 기대 레이아웃을 맡겼는데, 드랍으로 n=21 기본이 v0x 로 바뀌고 n=25 는 null 이
  // 됐다. margin 은 **레이아웃 고유의 기하 성질**이지 라인업 소속이 아니므로
  // 레이아웃을 **명시**해서 잰다 — 드랍된 둘의 값도 그대로 남는다(차단·비삭제).
  // 새로 핀한 값: v1r2 0.1500 · v0x 0.1231 · v0xq 0.0635 (전부 게이트 0.035 위).
  // v0xq 가 가장 얇다 (0.0635 = 게이트의 1.8배) — 3코너 대칭 때문이고, 이것이
  // 「v0xq 는 방향 여유가 가장 적은 후보」라는 사실의 정본이다.
  //
  // **의도적 갱신 «v0W 프로그램 retire» (2026-08-17, 검증 렌즈 F7)** — 신설 v0w ·
  // v0wq 가 이 전수 핀에서 빠져 있었다. 하필 v0W 의 유일한 정확도 손실 (rot0 ×
  // 감마 열화 2칸) 의 원인으로 지목된 값들이다. 렌즈 실측 (해석 계산과 클린 프레임
  // 복호가 같은 값): v0w 0.0952 · v0wq 0.0889 — 위상 판별력 = 면 비대칭 셀
  // (v0w 10/70 · v0wq 6/45) 에서 나온다.
  //
  // **의도적 갱신 «v0W2 편입» (2026-08-17)** — v0W2 는 위상 판별을 SE 대형 마커
  // **하나**에 몰아 주고 NW·NE 를 3면 대칭으로 눕힌 설계다. 그 설계가 실제로 듣는지를
  // 재는 자리가 여기다: 실측 **0.1512 = 44/291 면**으로, v0W(0.0952 = 20/210) 보다
  // **58.8 % 두껍다** (면 비대칭 22/97 = 22.7 % 대 10/70 = 14.3 %). 활성 n=21 넷 중
  // 가장 두껍고 게이트 0.035 의 4.3배다. 게이트는 한 값도 안 건드렸다 —
  // 두꺼워진 것은 문턱이 아니라 **정본의 비대칭 셀 수**다.
  // 측정: `test/output/lanes/claude-v0w2-probe.mjs` §①.
  //
  // **의도적 갱신 «v0X 드랍» (2026-08-17, 판정 3라운드)** — **값은 한 자리도 안
  // 바뀐다.** 바뀐 것은 소속뿐이라 v0x 행을 «드랍 보존» 팔로 옮긴다 (margin 은
  // 레이아웃 고유의 기하 성질이지 라인업 소속이 아니라는 위 2026-08-16 판단의
  // 연장이다). 두 팔을 나눠 두면 «활성 최소 margin» 을 사람이 눈으로 읽을 수
  // 있다 — 지금 활성 최소는 v0wq 0.0889 (게이트 0.035 의 2.54배)이고,
  // v0X 가 있던 시절 활성 최고였던 0.1231 은 이제 v0W2 의 0.1512 로 대체됐다.
  //
  // **의도적 갱신 «v0WY 편입» (2026-08-17 재설계)** — 기존 네 행은 **한 자리도
  // 안 바뀐다**. 새 행 v0wy 의 값 **0.0796 = 16/201** 은 퍼인더 67셀 중 면 비대칭
  // 8셀에서 나온다 (K3 중앙 4 + SW 마커 4). 이제 **활성 최소가 v0wq 0.0889 에서
  // v0wy 0.0796 으로 내려간다** — 그래도 게이트 0.035 의 **2.27배**이고, 편입 이력이
  // 있는 v0XQ(0.0635 = 1.81배) 보다 두꾸다. 게이트는 한 값도 안 건드렸다.
  //
  // 그리고 이 값이 **겹침 해소 선택의 영수증**이다 — 후보 (a)(SE 마커를
  // 슬롯에 내주고 NW 비대칭에만 의존) 는 0.0437(1.25배) 이었고, 그 후보는
  // 인코더 정합 ⑤ 에서 독립적으로 또 죽었다 (`claude-v0wy-design.mjs`).
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (2026-08-17)** — 기존 아홉 값은
  // **한 자리도 안 바뀐다.** v0w 계열 네 행이 «드랍 보존» 팔로 옮겨 가고 (margin 은
  // 레이아웃 고유의 기하 성질이지 라인업 소속이 아니다 — 2026-08-16 판단의 연장),
  // 새 행 둘이 활성 팔에 선다:
  //   · v0t 0.0962 = 30/312 — 비대칭 15/104 (A 블록 L 반전 9 + SE R 반전 6).
  //     게이트 0.035 의 2.75배. 정본 팩 검산 `claude-v0t-probe.mjs` 와 같은 값.
  //   · v0ty 0.0632 = 18/285 — 슬롯이 SE 를 삼켜 **A 블록 9셀만** 남은 값. 게이트의
  //     1.80배로 활성 최소가 된다. ⚠ 이 자는 슬롯 QR 자체 파인더 패턴이 주는 방향
  //     정보를 **못 세므로** v0TY 의 실제 강건성을 과소평가한다 (운영자 확정 —
  //     margin 을 이 변형의 판정 근거로 쓰지 말 것. «낮으니 보강» 은 기각됐다.
  //     비대칭 이중화가 의도된 설계라 보충 블록·마커 이전도 금지다).
  // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — 기존 12행은 **한 자리도 안
  // 바뀐다.** 새 행 둘이 활성 팔에 선다:
  //   · v0tr **0.0980** = 비대칭 15/102 (A 9 L반전 + SE 6 R반전).
  //     ⚠ **의도적 갱신 «A 블록 편입» (2026-08-18, 운영자 지적)**: 직전 값은
  //     0.0430 이었고 «현행·드랍 통틀어 최저 · A 블록이 통째로 없다» 였다.
  //     그 부재는 레인의 실수가 아니라 **내 브리프의 «보충 블록 신설 금지» 지시가
  //     만든 결과**다 — 레인은 규약을 지켰고 부재를 자기검증으로 잠가 뒀다.
  //     그러나 그 상태로는 **v0TRY 가 성립하지 않는다**: 먼 코너 슬롯이 SE 를
  //     삼키면 방향 판별자가 0 이 된다 (v0TY 가 SE 를 잃고도 서는 이유가 정확히
  //     A 블록이다). A 는 «신설» 이 아니라 `V0T_A_CELLS` **행 참조 재사용**이라
  //     금지 규약과도 맞는다. 편입 후 v0tr 은 v0t(0.0962)보다도 높다.
  //     이 숫자가 바로 «실기기에서 회전 오분류가 나면 먼저 의심할 자리» 의 정본이다.
  //   · v0trq 0.0519 = 12/231 — 같은 비대칭 6셀이고 분모(파인더 77)만 작다.
  //     이 자는 슬롯 QR 파인더 패턴이 주는 방향 정보를 **못 세므로** v0TY 와 같은
  //     이유로 과소평가값이다 (판정 근거로 쓰지 말 것 — 운영자 확정).
  // 실측: `test/output/lanes/claude-v0tr-measure.mjs` ⓒ.
  // **의도적 갱신 «v0TRY 편입» (2026-08-18)** — 기존 14행은 **한 자리도 안 바뀐다.**
  // 새 행 하나가 활성 팔에 선다:
  //   · v0try **0.0645** = 18/279 — 슬롯이 SE 9셀을 삼켜 **A 블록 9셀만** 남은 값이다.
  //     분자가 v0TY 와 같고(A 9셀 × 2 = 18 miss) 분모만 작다 (279 vs 285) — 그래서
  //     v0ty 0.0632 보다 근소하게 높다. 게이트 0.035 의 **1.84배**.
  //     ⚠ v0TY·v0TRQ 와 같은 이유로 이 자는 슬롯 QR 자체 파인더 패턴의 방향
  //     정보를 **못 세므로** 과소평가값이다 (판정 근거로 쓰지 말 것 — 운영자 확정).
  //     실측: `test/output/lanes/claude-v0try-measure.mjs` ⓒ (통합자 예측 0.0645 와 일치).
  const WANT_MARGIN_ACTIVE = [
    { n: 13, id: 'v0', margin: 0.3111 },
    { n: 21, id: 'v0t', margin: 0.0962 },
    { n: 21, id: 'v0ty', margin: 0.0632 },
    { n: 21, id: 'v0tr', margin: 0.0980 },
    { n: 21, id: 'v0trq', margin: 0.0519 },
    { n: 21, id: 'v0try', margin: 0.0645 },
  ];
  // 드랍 보존 팔 — 차단이지 삭제가 아니므로 값이 그대로 살아 있어야 한다.
  const WANT_MARGIN_DROPPED = [
    { n: 21, id: 'v2r2', margin: 0.2342 },
    { n: 25, id: 'v2r2', margin: 0.2342 },
    { n: 21, id: 'v1r2', margin: 0.1500 },
    { n: 21, id: 'v0x', margin: 0.1231 },
    { n: 21, id: 'v0xq', margin: 0.0635 },
    { n: 21, id: 'v0w', margin: 0.0952 },
    { n: 21, id: 'v0wq', margin: 0.0889 },
    { n: 21, id: 'v0w2', margin: 0.1512 },
    { n: 21, id: 'v0wy', margin: 0.0796 },
  ];
  // 두 팔의 id 집합이 실제 라인업과 어긋나면 이 표가 조용히 낡는다 — 함께 잰다.
  assert.deepEqual(
    [...new Set(WANT_MARGIN_ACTIVE.map((row) => row.id))].sort(),
    [...CELL_SURFACE_FINAL_ACTIVE_IDS].sort(),
    '활성 팔이 CELL_SURFACE_FINAL_ACTIVE_IDS 와 어긋난다',
  );
  assert.deepEqual(
    [...new Set(WANT_MARGIN_DROPPED.map((row) => row.id))].sort(),
    [...CELL_SURFACE_FINAL_DROPPED_IDS].sort(),
    '드랍 팔이 CELL_SURFACE_FINAL_DROPPED_IDS 와 어긋난다',
  );
  const wantMargin = [...WANT_MARGIN_ACTIVE, ...WANT_MARGIN_DROPPED];
  for (const { n, id, margin: want } of wantMargin) {
    const label = id + '@' + n;
    const canon = evaluateCellSurfaceGeometry(
      { n }, idealSampleCellFor(n, undefined, id), { cellSurfaceLayout: id },
    );
    assert.equal(canon.ok, true, label);
    assert.equal(canon.accepted, true, label + ' 정방향 수용: ' + JSON.stringify(canon.diagnostics));
    assert.equal(canon.scored.layoutId, id);
    assert.equal(canon.diagnostics.agreement, 1, label + ' 정방향 완전 일치');
    const margin = canon.scored.orientationMargin;
    assert.ok(
      Math.abs(margin - want) < 0.0016,
      label + ' margin ' + margin.toFixed(4) + ' 이 예측 ' + want + ' 과 다르다',
    );
    assert.ok(margin >= UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin);
    for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
      const wrong = evaluateCellSurfaceGeometry(
        { n }, idealSampleCellFor(n, cycle, id), { cellSurfaceLayout: id },
      );
      assert.equal(wrong.accepted, false, label + ' 오방향 거부');
    }
  }
});

test('encodeY 버전·레이아웃 정합 가드 — v0 는 Y0 만, v2r2 는 Y1/Y2 만', () => {
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', version: 1, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v2r2', version: 0, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v2r2', version: 2, tones: 4 }), RangeError);
  // 자동 선택: 작은 페이로드 → n=21, Y1 초과 → n=25.
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v2r2', tones: 2 }).n, 21);
  assert.equal(encodeY('x'.repeat(100), { cellSurfaceLayout: 'v2r2', tones: 2 }).n, 25);
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v0', tones: 2 }).n, 13);
});

// ─────────────────────────────────────────────────────────────────────────
// v1r2 (n=21 A/B 후보) — 2026-08-15 밤 부활. 기하는 v2r2 와 같은 계약으로 세웠다.
// ─────────────────────────────────────────────────────────────────────────

// 의도적 갱신 (2026-08-16, 포맷 v2): 포맷 15→18 → data 334→331 · S 111→110.
test('v1r2 회계 — 441 − 80 − 12 − 18 = 331 · S 110 · 잔여 1 (autoplace 유도)', () => {
  const surface = cellSurfaceFinal(21, 'v1r2');
  assert.equal(surface.id, 'v1r2');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 80);
  assert.equal(surface.declaredDataCells, 331);
  assert.equal(surface.usedSymbols, 110);
  assert.equal(surface.residualCells, 1);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(21 * 21, surface.locatorCount + 30 + surface.declaredDataCells);
  assert.equal(dataCellsInScanOrderCellSurfaceFinal(21, 'v1r2').length, 331);
  assert.equal(fillerCellsCellSurfaceFinal(21, 'v1r2').length, 1);
  // autoplace 하한 — 손 좌표표가 아니라 유도값이다.
  assert.ok(surface.autoplace.dRef >= surface.autoplace.dRefMin);
  assert.ok(surface.autoplace.sFmtMax >= surface.autoplace.sFmtMinRequired);
  assert.equal(surface.autoplace.occupied, 80);
  // 파인더 ∩ (format ∪ reference) = 0.
  const painted = new Set(surface.locatorCells.map((c) => c.i + ',' + c.j));
  for (const cell of [...surface.formatCells, ...surface.referenceCells]) {
    assert.equal(painted.has(cell.i + ',' + cell.j), false, '겹침 ' + cell.i + ',' + cell.j);
  }
  // 네 코너 블록 — NW 25 · NE 15 · SW 15 · SE 25 (코너별 비대칭).
  const counts = { NW: 0, NE: 0, SW: 0, SE: 0 };
  for (const cell of surface.locatorCells) {
    counts[(cell.i <= 4 ? 'N' : 'S') + (cell.j <= 4 ? 'W' : 'E')] += 1;
  }
  assert.deepEqual(counts, { NW: 25, NE: 15, SW: 15, SE: 25 });
  for (const tones of [2, 3]) {
    assert.equal(
      capacityForCellSurfaceFinal(21, 'M', tones, 'v1r2').name,
      tones === 3 ? 'Y1T-CS-V1R2' : 'Y1-CS-V1R2',
    );
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v1r2').formatIndex, tones === 3 ? 3 : 1);
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v1r2').dataCells, 331);
  }
  // 기본 경로는 건드리지 않았다 — id 를 안 주면 여전히 v2r2.
  assert.equal(cellSurfaceFinal(21).id, 'v2r2');
  assert.equal(capacityForCellSurfaceFinal(21, 'M', 2).cellSurfaceLayout, 'v2r2');
});

test('v1r2 인코더 왕복 — digit 레벨 decodeCells (2톤·3톤)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v1r2', version: 1, tones, eccLevel: 'M',
    });
    assert.equal(encoded.n, 21);
    assert.equal(encoded.version, 1);
    assert.equal(encoded.cellSurfaceLayout, 'v1r2');
    assert.equal(encoded.locatorProfile, 'cell-surface-v1r2');
    assert.equal(encoded.formatIndex, tones === 3 ? 3 : 1);
    assert.equal(encoded.capacity.dataCells, 331);
    assert.equal(encoded.cellDigits.size, 441);
    // 칠한 80셀 전부 role=locator + 레이아웃 톤.
    let locatorCount = 0;
    for (const [, entry] of encoded.cellDigits) {
      if (entry.role === 'locator') locatorCount += 1;
    }
    assert.equal(locatorCount, 80);
    const digits = dataCellsInScanOrderCellSurfaceFinal(21, 'v1r2')
      .map(({ i, j }) => encoded.cellDigits.get(i + ',' + j).digit);
    const decoded = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      cellSurfaceLayout: 'v1r2',
    });
    assert.equal(decoded.ok, true, 'v1r2 t' + tones + ': ' + decoded.reason);
    assert.equal(decoded.text, PAYLOAD);
    // locatorProfile 힌트만으로도 같은 결과 (와이어 formatIndex 는 v2r2 와 같다).
    const byProfile = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      locatorProfile: 'cell-surface-v1r2',
    });
    assert.equal(byProfile.ok, true, 'v1r2 t' + tones + ' (profile): ' + byProfile.reason);
    assert.equal(byProfile.text, PAYLOAD);
    // n+formatIndex 만으로는 **기본** 레이아웃(v2r2)이 되므로 같은 digits 가 풀리지
    // 않아야 한다 — 「레이아웃 판별은 로케이터·평가 게이트가 한다」는 계약의 반증면.
    const byIndexOnly = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
    });
    assert.notEqual(
      byIndexOnly.ok === true && byIndexOnly.text === PAYLOAD,
      true,
      'n+formatIndex 만으로 v1r2 가 풀렸다 — 기본 레이아웃 계약이 깨졌다',
    );
  }
});

test('v1r2 렌더 자체 검증 — verifyRasterY 전 셀 일치 (2톤·3톤)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v1r2', version: 1, tones, eccLevel: 'M',
    });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    const report = verifyRasterY(raster, scene, encoded, { palette: PALETTE });
    assert.equal(report.mismatches.length, 0, 'v1r2 t' + tones);
    assert.equal(report.erasures.length, 0, 'v1r2 t' + tones);
    assert.ok(report.matched > 0);
    assert.equal(scene.locatorProfile, 'cell-surface-v1r2');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// v0X — 2026-08-16 편입(당시 n=21 3파전 후보) · **2026-08-17 드랍**(판정 3라운드).
// 아래 회계·구조·왕복 회귀는 드랍 뒤에도 그대로다 — 차단이지 삭제가 아니다.
// 정본은 toneOverrides 셀 집합(65)에서 유도했다 — 손 좌표표 사본이 아니다.
// ─────────────────────────────────────────────────────────────────────────

// 의도적 갱신 (2026-08-16, 포맷 v2): 포맷 15→18 → data 349→346 · S 116→115.
test('v0X 회계 — 441 − 65 − 12 − 18 = 346 · S 115 · 잔여 1 (autoplace 유도)', () => {
  const surface = cellSurfaceFinal(21, 'v0x');
  assert.equal(surface.id, 'v0x');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 65);
  assert.equal(surface.declaredDataCells, 346);
  assert.equal(surface.usedSymbols, 115);
  assert.equal(surface.residualCells, 1);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(21 * 21, surface.locatorCount + 30 + surface.declaredDataCells);
  assert.equal(dataCellsInScanOrderCellSurfaceFinal(21, 'v0x').length, 346);
  assert.equal(fillerCellsCellSurfaceFinal(21, 'v0x').length, 1);
  assert.deepEqual(surface.nsym, { symbols: 115, L: 14, M: 29, H: 46 });
  // autoplace 하한 — 손 좌표표가 아니라 유도값이다.
  assert.ok(surface.autoplace.dRef >= surface.autoplace.dRefMin);
  assert.ok(surface.autoplace.sFmtMax >= surface.autoplace.sFmtMinRequired);
  assert.equal(surface.autoplace.occupied, 65);
  // 파인더 ∩ (format ∪ reference) = 0.
  const painted = new Set(surface.locatorCells.map((c) => c.i + ',' + c.j));
  for (const cell of [...surface.formatCells, ...surface.referenceCells]) {
    assert.equal(painted.has(cell.i + ',' + cell.j), false, '겹침 ' + cell.i + ',' + cell.j);
  }
  // 편집기 정본의 counts.data(349) 는 **포맷 v1 기준**이었다 — v0X 파인더가 편집기
  // 고정 배치를 잠식하지 않아 v1 에서는 일치했고, v2 로 3셀이 더 빠져 346 이 된다.
  for (const tones of [2, 3]) {
    assert.equal(
      capacityForCellSurfaceFinal(21, 'M', tones, 'v0x').name,
      tones === 3 ? 'Y1T-CS-V0X' : 'Y1-CS-V0X',
    );
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v0x').formatIndex, tones === 3 ? 3 : 1);
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v0x').dataCells, 346);
  }
  // 기본 경로는 건드리지 않았다 — id 를 안 주면 여전히 v2r2.
  assert.equal(cellSurfaceFinal(21).id, 'v2r2');
});

// 의도적 갱신 (정본 정규화 2026-08-16): SE 3면 동일이 35/36 → **36/36**,
// NW 는 v1r2 와 예외 없이 동일, (14,20) 은 (2,1,1) → (2,2,2). 전부 «넓힌» 단언이다
// (SE 면 격자 대조는 T 하나에서 T·L·R 세 면 전부로 확대).
test('v0X 구조 — NW16 · SE36 · NE6 · SW6 + 단독 (14,20), SE 는 3면 동일 36/36', () => {
  const cells = locatorCellsCellSurfaceFinal(21, 'v0x');
  assert.equal(cells.length, 65);
  const inBox = (c, box) => (box.iMax === undefined || c.i <= box.iMax)
    && (box.iMin === undefined || c.i >= box.iMin)
    && (box.jMax === undefined || c.j <= box.jMax)
    && (box.jMin === undefined || c.j >= box.jMin);
  const counts = { NW: 0, NE: 0, SW: 0, SE: 0, SINGLE: 0 };
  for (const cell of cells) {
    let home = null;
    for (const name of ['NW', 'NE', 'SW', 'SE']) if (inBox(cell, V0X_BLOCKS[name])) home = name;
    if (home === null && cell.i === V0X_BLOCKS.SINGLE.i && cell.j === V0X_BLOCKS.SINGLE.j) {
      home = 'SINGLE';
    }
    assert.ok(home !== null, '블록 밖 셀 ' + cell.i + ',' + cell.j);
    counts[home] += 1;
  }
  assert.deepEqual(counts, { NW: 16, NE: 6, SW: 6, SE: 36, SINGLE: 1 });

  // SE 6×6 은 QR 동심 사각 — 암 테두리 / 명 링 / 암 2×2 코어. 정규화로 **36/36**
  // 전부 3면 동일이 됐다. 이 «3면 동일» 이 로케이터 사각 링 서명(120° 3코어)의 근거다.
  const se = cells.filter((c) => inBox(c, V0X_BLOCKS.SE));
  assert.equal(se.filter((c) => c.T === c.L && c.L === c.R).length, 36);
  const wantSE = ['000000', '022220', '020020', '020020', '022220', '000000'];
  // T 면만 보던 것을 **세 면 전부**로 넓힌다 — (19,19).R 복원으로 R 면도 완전해졌다.
  for (const face of ['T', 'L', 'R']) {
    const grid = new Map(se.map((c) => [c.i + ',' + c.j, c[face]]));
    for (let i = 15; i <= 20; i += 1) {
      const row = [];
      for (let j = 15; j <= 20; j += 1) row.push(String(grid.get(i + ',' + j)));
      assert.equal(row.join(''), wantSE[i - 15], 'SE ' + face + ' 면 행 i=' + i);
    }
    // 중심 통과 런 D1 B1 D2 B1 D1 = 1:1:2:1:1 (K5 회문) — 행·열 양쪽에서 성립한다.
    for (let j = 15; j <= 20; j += 1) {
      const col = [];
      for (let i = 15; i <= 20; i += 1) col.push(String(grid.get(i + ',' + j)));
      assert.equal(col.join(''), wantSE[j - 15], 'SE ' + face + ' 면 열 j=' + j);
    }
    // 대각·반대각도 회문이다 (정규화 전에는 R 면 주대각이 (19,19) 에서 깨졌다).
    const diag = [];
    const anti = [];
    for (let k = 0; k <= 5; k += 1) {
      diag.push(String(grid.get((15 + k) + ',' + (15 + k))));
      anti.push(String(grid.get((15 + k) + ',' + (20 - k))));
    }
    for (const [name, line] of [['대각', diag.join('')], ['반대각', anti.join('')]]) {
      assert.equal(line, [...line].reverse().join(''), 'SE ' + face + ' 면 ' + name + ' 회문');
    }
  }

  // NW (0..3)² 는 v1r2 NW 의 같은 범위와 **예외 없이** 같다 — 공유 K3 중앙 계보.
  // (정규화로 (0,3).L 예외가 사라져 mid 건너뛰기 없이 전 면을 대조한다.)
  const nw = new Map(locatorCellsCellSurfaceFinal(21, 'v1r2')
    .filter((c) => c.i <= 3 && c.j <= 3).map((c) => [c.i + ',' + c.j, c]));
  assert.equal(nw.size, 16);
  for (const cell of cells.filter((c) => inBox(c, V0X_BLOCKS.NW))) {
    const want = nw.get(cell.i + ',' + cell.j);
    assert.ok(want, 'v1r2 NW 에 없는 v0X NW 셀 ' + cell.i + ',' + cell.j);
    for (const face of ['T', 'L', 'R']) {
      assert.equal(cell[face], want[face], 'NW ' + cell.i + ',' + cell.j + '.' + face);
    }
  }
});

// 의도적 갱신 (정본 정규화 2026-08-16): 이 테스트는 원래 «v0X 에만 mid 4면이 있다» 를
// 고정했다. 정본이 그 4면을 도색 다수 톤으로 확정하면서 주장이 **뒤집혔다** —
// 이제 «전 정본에 mid 가 없다» 가 불변식이다. 약화가 아니라 강화다: 예외 목록이
// 사라지고 다섯 인스턴스 전부가 같은 규칙(0/2)에 걸린다. 정규화된 4면의 새 값도
// 좌표·면 단위로 못 박아, 정본이 다시 흔들리면 여기서 잡히게 한다.
// 의도적 갱신 «v0W 편입» (2026-08-16): 인스턴스가 여섯 → **일곱**이 됐다.
// v0W 정본은 v1r2 NW 5×5 · v0X SE(=v0xq CORNER) · v0 SE 3×3 에서 유도되므로
// 셋 중 하나에 mid 가 되살아나면 v0W 도 함께 여기서 터진다 (묶어 두는 게 목적이다).
// 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): 인스턴스가 여덟이 됐다 (v0wq@21 추가).
// 의도적 갱신 «v0W2 편입» (2026-08-17): **아홉**이 됐다 (v0w2@21 추가). v0W2 는
// 팩의 (0,4).L 미도색을 **다수 톤 정규화**로 메워 mid 를 만들지 않는다 — v0X 정규화와
// 같은 규칙이고, 그 사실이 여기서 매 실행 확인된다
// (`test/output/lanes/claude-v0w2-derive.mjs` §② 가 «mid 0» 을 실측한 그 값).
// 의도적 갱신 «v0TR 계열 편입» (2026-08-17): **열네**가 됐다 (v0tr@21 · v0trq@21).
// 둘 다 유도만으로 만들어졌으므로 유도 원천(V0XQ_CORNER_CELLS · V0W_PHASE_CELLS ·
// V0T_CENTRE_CELLS) 중 하나에 mid 가 되살아나면 여기서 함께 터진다 (묶어 두는 것이 목적이다).
// 의도적 갱신 «v0TRY 편입» (2026-08-18): **열다섯**이 됐다 (v0try@21). v0TRY 는
// `V0TR_CELLS` 의 먼 코너 슬롯 박스 필터라 유도 원천이 v0TR 과 **같다** — 같은 이유로 묶는다.
test('전 정본 mid(1) 금지 — 열다섯 인스턴스 어디에도 mid 면이 없다 (v0X 정규화 4면 고정)', () => {
  // ⚠ 이 목록은 `CELL_SURFACE_FINAL_IDS × NS` 전수여야 한다 — 하나라도 빠지면
  // 그 레이아웃만 규칙 밖으로 샌다 (v0xq 편입 때 실제로 빠져 있었다).
  const instances = [
    ['v0', 13], ['v2r2', 21], ['v2r2', 25], ['v1r2', 21], ['v0x', 21], ['v0xq', 21],
    ['v0w', 21], ['v0wq', 21], ['v0w2', 21], ['v0wy', 21], ['v0t', 21], ['v0ty', 21],
    ['v0tr', 21], ['v0trq', 21], ['v0try', 21],
  ];
  const enumerated = CELL_SURFACE_FINAL_IDS
    .flatMap((id) => CELL_SURFACE_FINAL_NS[id].map((n) => id + '@' + n)).sort();
  assert.deepEqual(instances.map(([id, n]) => id + '@' + n).sort(), enumerated,
    '이 테스트의 인스턴스 목록이 최종 라인업 전수와 다르다');
  let faces = 0;
  for (const [id, n] of instances) {
    for (const cell of locatorCellsCellSurfaceFinal(n, id)) {
      for (const face of ['T', 'L', 'R']) {
        assert.notEqual(cell[face], 1, id + '@' + n + ' 에 mid 면이 생겼다 ' + cell.i + ',' + cell.j);
        faces += 1;
      }
    }
  }
  // 의도적 갱신 «v0WY 편입» — 항 하나(67)가 늘었다. 값 자체는 파인더 셀 수의 합이라
  // 새 레이아웃이 붙으면 반드시 움직인다 (게이트가 아니라 회계다).
  // 의도적 갱신 «v0T 편입» (2026-08-17) — 항 둘(104 · 95)이 늘었다 (같은 회계).
  // 의도적 갱신 «v0TR 계열 편입» (2026-08-17) — 항 둘(93 · 77)이 늘었다 (같은 회계).
  // 의도적 갱신 «v0TR A 블록 편입» (2026-08-18) — 93 → 102 (+9×3면=27). v0trq(77)는
  //   불변이다: A 가 중앙 QR 슬롯 밑에 깔려 로케이터에서 빠진다.
  // 의도적 갱신 «v0TRY 편입» (2026-08-18) — 항 하나(**93** = 102 − SE 9)가 늘었다.
  assert.equal(faces,
    (30 + 74 + 74 + 80 + 65 + 42 + 70 + 45 + 97 + 67 + 104 + 95 + 102 + 77 + 93) * 3,
    '훑은 면 수가 파인더 총계와 다르다');

  // 정규화된 네 자리의 새 값 — (0,3)L=0 · (14,20)L/R=2 · (19,19)R=2.
  const v0x = new Map(locatorCellsCellSurfaceFinal(21, 'v0x').map((c) => [c.i + ',' + c.j, c]));
  assert.equal(v0x.get('0,3').L, 0, '(0,3).L 은 정규화로 0');
  assert.deepEqual(
    { T: v0x.get('14,20').T, L: v0x.get('14,20').L, R: v0x.get('14,20').R },
    { T: 2, L: 2, R: 2 },
    '(14,20) 은 정규화로 3면 동일 밝음 — 면 위상 큐가 아니라 점화 점이다',
  );
  assert.equal(v0x.get('19,19').R, 2, '(19,19).R 은 정규화로 2 — SE R 면 회문 복원');

  // 톤 가드 자체도 확인 — locatorTone 은 0/2 만 낸다.
  for (const [id, n] of instances) {
    for (const cell of locatorCellsCellSurfaceFinal(n, id)) {
      for (const face of ['T', 'L', 'R']) {
        assert.ok(cell[face] === 0 || cell[face] === 2, id + '@' + n + ' 톤이 0/2 가 아니다');
      }
    }
  }
});

test('v0X 인코더 왕복 — digit 레벨 decodeCells (2톤·3톤)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v0x', version: 1, tones, eccLevel: 'M',
    });
    assert.equal(encoded.n, 21);
    assert.equal(encoded.cellSurfaceLayout, 'v0x');
    assert.equal(encoded.locatorProfile, 'cell-surface-v0x');
    assert.equal(encoded.formatIndex, tones === 3 ? 3 : 1);
    const digits = dataCellsInScanOrderCellSurfaceFinal(21, 'v0x')
      .map(({ i, j }) => encoded.cellDigits.get(i + ',' + j).digit);
    const decoded = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      cellSurfaceLayout: 'v0x',
    });
    assert.equal(decoded.ok, true, 'v0x t' + tones + ': ' + decoded.reason);
    assert.equal(decoded.text, PAYLOAD);
    // 프로파일 힌트 경로 — 'cell-surface-v0x' 는 초안 슬롯이 없어 충돌하지 않는다.
    const byProfile = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      locatorProfile: 'cell-surface-v0x',
    });
    assert.equal(byProfile.ok, true, 'v0x t' + tones + ' (profile): ' + byProfile.reason);
    assert.equal(byProfile.text, PAYLOAD);
    // n+formatIndex 만으론 기본(v2r2)으로 풀린다 — 기본 레이아웃 계약 불변.
    const byIndexOnly = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
    });
    assert.notEqual(
      byIndexOnly.ok && byIndexOnly.text, PAYLOAD,
      'n+formatIndex 만으로 v0X 가 풀렸다 — 기본 레이아웃 계약이 깨졌다',
    );
  }
});

test('v0X 렌더 자체 검증 — verifyRasterY 전 셀 일치 (2톤·3톤, 정규화 정본)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v0x', version: 1, tones, eccLevel: 'M',
    });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    const report = verifyRasterY(raster, scene, encoded, { palette: PALETTE });
    assert.equal(report.mismatches.length, 0, 'v0x t' + tones);
    assert.equal(report.erasures.length, 0, 'v0x t' + tones);
    assert.equal(scene.locatorProfile, 'cell-surface-v0x');
  }
});

test('encodeY 버전 가드 — v0X 는 Y1(n=21) 전용', () => {
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0x', version: 0, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0x', version: 2, tones: 2 }), RangeError);
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v0x', tones: 2 }).n, 21);
  // v0X 는 n=25 가 없으므로 Y1 용량을 넘으면 바로 거부다 (조용히 v2r2 로 넘어가지 않는다).
  assert.throws(() => encodeY('x'.repeat(200), { cellSurfaceLayout: 'v0x', tones: 2 }), RangeError);
});

test('encodeY 버전 가드 — v1r2 는 Y1(n=21) 전용', () => {
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v1r2', version: 0, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v1r2', version: 2, tones: 2 }), RangeError);
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v1r2', tones: 2 }).n, 21);
  // v1r2 는 n=25 가 없으므로 Y1 용량을 넘으면 바로 거부다 (조용히 v2r2 로 넘어가지 않는다).
  assert.throws(() => encodeY('x'.repeat(200), { cellSurfaceLayout: 'v1r2', tones: 2 }), RangeError);
});

/**
 * 완전한 심볼 하나를 표본기로 바꾼다 — 파인더 셀은 레이아웃 톤, 나머지는 실제
 * data/format/reference digit 의 2톤 패턴. n² 전 셀을 답하므로 **두 후보 레이아웃이
 * 모두 표본을 얻는다** (교차 오수용을 실제로 시험할 수 있는 유일한 조건).
 */
function idealSampleCellForEncoded(encoded, cycle = ['T', 'L', 'R']) {
  const map = encoded.cellDigits;
  return (i, j) => {
    const entry = map.get(i + ',' + j);
    if (!entry) return { i, j, ok: false };
    // 중앙 QR 슬롯 (v0xq) — digit 이 없다. 실물 프레임에는 픽셀이 있지만(T=QR 모듈,
    // L/R=필러) **셀 median 이라는 모델에 정직한 값이 없다** (QR 모듈은 셀보다 작다).
    // 그래서 «관측 없음» 으로 돌린다. 이 선택은 교차 오수용 검사를 **더 엄격하게**
    // 만든다 — 경쟁 레이아웃(v0X·v1r2·v2r2)의 파인더 셀 중 슬롯 안에 든 것들이
    // 분모에서 빠져 그쪽 agreement 가 **올라가기만** 하기 때문이다. 그런데도 거부되면
    // 그 거부는 더 강한 주장이 된다.
    if (entry.role === 'slot') return { i, j, ok: false };
    const level = {};
    if (entry.role === 'locator' && entry.tones) {
      for (const face of ['T', 'L', 'R']) level[face] = entry.tones[face];
    } else {
      const pattern = digitToPattern(entry.digit);
      for (const face of ['T', 'L', 'R']) level[face] = pattern[face] ? 2 : 0;
    }
    return {
      i,
      j,
      ok: true,
      T: { median: level[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: level[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: level[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

// 의도적 갱신 (2026-08-16): v0X 편입으로 n=21 후보가 셋 — 채점 대상·교차 오수용
// 검사가 3-way 로 넓어진다. 게이트(0.78 / 0.035)는 그대로다.
// 의도적 갱신 (2026-08-17): v0XQ 편입으로 **4-way**. v0XQ 는 파인더 42셀뿐이라
// 표본이 가장 적은 후보다 — 교차 오수용 검사가 특히 중요하다.
test('n=21 병행 평가 — 드랍 4후보를 다 채점하고 게이트가 고른다 (교차 오수용 없음)', () => {
  // **의도적 갱신 «드랍 정본화» (2026-08-16)** — v2r2·v1r2 가 라인업에서 내려가
  // 기본 후보는 [v0x, v0xq] 둘이다. 이 테스트의 값은 «네 레이아웃이 서로를
  // 오수용하지 않는다» 는 **교차 오수용 대조군**이라 넷을 그대로 유지한다 —
  // 라인업 대신 `cellSurfaceLayouts` **명시 옵션**으로 넷을 채점시킨다
  // (법의학·대조군 경로. 게이트 0.78 · margin 0.035 는 한 값도 안 건드렸다).
  //
  // **의도적 갱신 «v0X 드랍» (2026-08-17, 판정 3라운드)** — 이제 이 네 후보가
  // **전부 드랍 상태**다. 그래도 한 줄도 안 지운다 (대조군 폐기 금지): 발행된
  // 프레임의 법의학 경로이고, «드랍된 것들끼리도 서로 안 새는가» 는 여전히
  // 참이어야 하는 명제다. 활성 라인업(v0w·v0wq·v0w2)의 같은 검사는 **아래
  // 별도 테스트**가 맡는다 — 둘을 한 테스트에 합치면 어느 쪽이 깨졌는지
  // 이름으로 못 읽는다.
  const outcome = {};
  const N21 = ['v2r2', 'v1r2', 'v0x', 'v0xq'];
  const scoreAll = { cellSurfaceLayouts: N21 };
  for (const layout of N21) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
    });
    const scored = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded), scoreAll,
    );
    assert.equal(scored.ok, true, layout + ' 평가 실패');
    // 후보 둘 다 실제로 채점됐다.
    assert.deepEqual(
      Object.keys(scored.diagnostics.layouts).sort(), ['v0x', 'v0xq', 'v1r2', 'v2r2'],
    );
    assert.equal(scored.accepted, true, layout + ' 정답 레이아웃이 수용되지 않았다');
    assert.equal(scored.scored.layoutId, layout, layout + ' 이 아닌 레이아웃이 뽑혔다');
    assert.equal(scored.scored.profile, 'cell-surface-' + layout);
    // 의도적 갱신 (정본 정규화 2026-08-16): v0X 상한이 **191/195 → 195/195** 가 됐다.
    // 예전 상수는 mid 면 4개가 이 테스트의 이진 표본기(:625 median 0.08/0.82 — mid 를
    // bright 로 보냄)에서 어긋난 값이었다. 정본이 그 4면을 0/2 로 확정하면서 세 후보
    // 전부 정방향 1.0000 이 됐고 레이아웃 분기가 사라졌다 — **상수 완화가 아니라
    // 예외 소멸**이다(느슨해진 쪽은 없다). 게이트 0.78 은 그대로.
    assert.equal(
      scored.diagnostics.layouts[layout].agreement, 1, layout + ' 정방향 일치율',
    );
    // **교차 오수용 금지** — 나머지 후보는 같은 프레임에서 게이트를 통과하면 안 된다.
    for (const rival of N21) {
      if (rival === layout) continue;
      assert.equal(
        scored.diagnostics.layouts[rival].accepted,
        false,
        layout + ' 프레임이 ' + rival + ' 로도 수용됐다 (교차 오수용): '
        + JSON.stringify(scored.diagnostics.layouts[rival]),
      );
    }
    assert.equal(scored.diagnostics.ambiguous, false);
    outcome[layout] = { margin: scored.scored.orientationMargin };
    // 회전 오방향(±120°)도 거부한다.
    for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
      const wrong = evaluateCellSurfaceGeometry(
        { n: 21 }, idealSampleCellForEncoded(encoded, cycle), scoreAll,
      );
      assert.equal(wrong.accepted, false, layout + ' 오방향 수용');
    }
  }
  // 방향 margin 은 게이트(0.035) 위여야 한다 — 수치는 회귀로 고정하지 않고 하한만 건다
  // (데이터 셀 패턴이 페이로드에 따라 달라지므로).
  for (const layout of N21) {
    assert.ok(
      outcome[layout].margin >= UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin,
      layout + ' margin ' + outcome[layout].margin,
    );
  }
});

/**
 * **v0X 드랍 후 남은 라인업의 교차 수용 전수 재확인** (2026-08-17, 판정 3라운드).
 *
 * 왜 위 4-way 로 안 되나: 위 표는 **드랍된 넷**끼리의 대조군이라, 오늘 실제로
 * 스캐너가 채점하는 조합을 한 칸도 안 잰다. 운영자 관측 「v0 과 혼선 자주」 는
 * «라인업 안에서 서로 샌다» 는 신고이므로, 드랍 뒤 남은 조합을 **라인업에서 직접
 * 유도해** 다시 건다 (목록을 손으로 적으면 다음 편입에서 조용히 낡는다).
 *
 * ⚠ **이 테스트는 «교차 0» 이라고 주장하지 않는다 — 그러면 거짓말이 된다.**
 * 이 파일의 표본기(`idealSampleCellForEncoded`)는 슬롯 셀을 «관측 없음» 으로
 * 돌리는데, v0WQ 의 슬롯 64셀 안에 **v0W 로케이터 25셀(NW K3)이 통째로 들어간다**.
 * 그래서 이 모델에서는 v0W ↔ v0WQ 가 **서로 agreement 1.0 으로 수용된다** —
 * 실측 (`test/output/lanes/claude-v0wy-crossmatrix.mjs`):
 *   · locator(v0wq) 45셀은 locator(v0w) 70셀의 **부분집합이고 톤까지 45/45 일치**
 *   · 남는 25셀은 전부 v0wq 슬롯 안 → 분모에서 빠짐 → 양쪽 다 1.0
 * 이것은 **드랍이 만든 것이 아니다** (드랍 전 7후보 전수에서도 같은 두 칸이고,
 * 그 두 칸이 전부다). 모델의 성질이지 포맷의 성질이 아니므로, 실물 판정은 실제
 * 래스터를 쓰는 `cellSurface-block-locator-v0wy-w2.test.js` §«v0W2 교차 오수용 0 — 양방향
 * 전수» 가 한다 — 거기서는 슬롯 자리에 진짜 픽셀(QR 모듈·필러)이 있어 v0W 의
 * NW 기대가 실제로 어긋난다.
 *
 * 그래서 여기서 잠그는 것은 **«별칭 쌍이 정확히 그 하나뿐이고 원인이 구조적으로
 * 고정돼 있다»** 이다. 새 레이아웃이 또 하나의 부분집합 별칭을 만들면 여기서 빨개진다.
 *
 * n=13 의 v0 는 여기 못 들어온다 — 격자 크기가 달라 같은 프레임에서 경쟁하지
 * 않는다. v0 ↔ n=21 축(운영자 «v0 과 혼선»)은 **기하 가설 단계**라 같은 래스터
 * 테스트가 맡는다. 게이트(0.78 · 0.035)는 한 값도 안 건드렸다.
 */
test('n=21 활성 라인업 교차 수용 — 별칭 두 방향의 원인이 구조적이다 (v0t ⊃ v0ty)', () => {
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (2026-08-17)** — 활성이
  // [v0t, v0ty] 둘이 됐다. 옛 4후보의 별칭 셋(v0w|v0wq · v0wq|v0w · v0wy|v0w)과
  // 회전 별칭 핀(v0wq|LRT|v0w2)은 드랍 대조군으로 내려갔다 — 복원 스위치로
  // 되살리면 같은 칸이 나온다 (`claude-v0t-crossmatrix.mjs --only v0w,v0wq,v0w2,v0wy`).
  // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — 활성이 **넷**이 됐다.
  // 드랩은 없다 (v0t·v0ty 그대로). 새 쌍 v0tr↔v0trq 는 v0t↔v0ty 와 **같은 기전의
  // 구조적 별칭**이고, 그 밖에 **새 종류의 쌍 둘**이 더 생겼다 (v0t↔v0tr ·
  // v0t↔v0trq). 아래 ② 가 넷 쌍을 전부 실측값으로 핀하고 기전을 적는다.
  // **병합 주석 (2026-08-19)** — 이 자리의 충돌은 «둘 중 하나» 가 아니라 **두 축**이었다:
  //   · 운영자 실기기 판정(2026-08-18)의 순서 «v0tr 우선»
  //   · v0TRY 편입 (그 레인은 재정렬 **이전** HEAD 에서 출발했다)
  // 합치면 «판정된 순서 + 맨 뒤 v0try» 다. n=21 기본은 **v0tr 그대로** —
  // v0try 는 라인업 끝에 붙을 뿐 기본을 가져가지 않는다.
  // **의도적 갱신 (2026-08-18)** — 순서만 바뀌었다 (v0tr 이 맨 앞). **집합은 그대로**
  // 이므로 아래 ①②의 별칭 기전·실측값은 재산정 대상이 아니다 — 별칭은 레이아웃
  // **쌍**의 기하에서 나오지 라인업 순서에서 나오지 않는다.
  const ACTIVE21 = [...finalLayoutIdsForN(21)];
    // **의도적 갱신 «v0TRQ 를 v0T 앞으로» (운영자 실기기 판정 2026-08-19)** —
  // 정식 스캐너 관측 v0 > v0TR > v0TRQ > v0T > v0TY. 집합은 그대로고 순서만 바뀐다.
  // v0try 는 그 관측에 **없었으므로**(당시 미배포) 맨 뒤 그대로 — «가장 낮다» 가
  // 아니라 «아직 안 재봤다» 다.
    // **의도적 갱신 — 실기기 순위 3차 (운영자 2026-08-19 밤)**. 위상정렬 결과
  // n=21 은 v0T > v0TR > v0TRY > v0TRQ > v0TY. 앞선 두 순서를 뒤집는다.
  // 운영자 단서: 「전체적으로 **오락가락** 하지만 원거리 인식률을 높게 쳤을 때 기준」 —
  // **확정 서열이 아니라 가장 최근 관측**이다. 순서는 동점 처리에만 관여하므로
  // 틀려도 복호가 안 망가지고 되돌리기도 싸다.
  assert.deepEqual(ACTIVE21, ['v0t', 'v0tr', 'v0try', 'v0trq', 'v0ty'],
    '활성 n=21 라인업이 바뀌었다 — 이 표를 재산정하라');

  // ① 별칭의 **원인**을 먼저 못 박는다 (증상보다 기전을 잠근다).
  //   · v0ty 로케이터 95셀은 v0t 로케이터의 «톤까지 같은» **진부분집합**이다
  //     (필터 유도가 정의라 구조적이다 — §CELL_SURFACE_FINAL_V0TY).
  //   · v0t 의 나머지 9셀(SE 마커)은 **전부 v0ty 슬롯 안**이다.
  //   그래서 이상 표본기(슬롯 표본 없음)에서는 **양방향 전부** agreement 1.0 이
  //   된다 — v0w ↔ v0wq 가 그랬던 것과 같은 기전이다. 실물 래스터·실사진에서
  //   가르는 것은 슬롯 자리의 실제 픽셀(QR 모듈 유무)과 블록 로케이터의 슬롯 QR
  //   확증(`v0tyRequireSlotQr` — v0wy 확증 재사용·문턱 공유)이다.
  const cellKey = (c) => c.i + ',' + c.j;
  const toneKey = (c) => cellKey(c) + ':' + c.T + c.L + c.R;
  const v0tLoc = locatorCellsCellSurfaceFinal(21, 'v0t');
  const v0tyLoc = locatorCellsCellSurfaceFinal(21, 'v0ty');
  const v0tByKey = new Map(v0tLoc.map((c) => [cellKey(c), c]));
  assert.equal(
    v0tyLoc.filter((c) => {
      const twin = v0tByKey.get(cellKey(c));
      return twin !== undefined && toneKey(twin) === toneKey(c);
    }).length,
    v0tyLoc.length,
    'v0ty 로케이터가 v0t 로케이터의 «톤까지 같은» 부분집합이 아니다 — 별칭 기전이 바뀌었다',
  );
  const v0tySlot = new Set(slotCellsCellSurfaceFinal(21, 'v0ty').map(cellKey));
  const v0tyByKey = new Map(v0tyLoc.map((c) => [cellKey(c), c]));
  const v0tOnly = v0tLoc.filter((c) => !v0tyByKey.has(cellKey(c)));
  assert.equal(v0tOnly.length, 9, 'v0T 에만 있는 파인더 셀이 9(SE 마커)가 아니다');
  assert.ok(v0tOnly.every((c) => v0tySlot.has(cellKey(c))),
    'v0T 의 SE 마커가 v0TY 슬롯 안에 다 들어 있지 않다 — 별칭 기전의 전제가 깨졌다');
  // 남은 방향 판별자 — v0ty 의 비대칭은 A 블록 9셀 **뿐**이어야 한다 (의도된
  // 이중화의 실증: 슬롯이 SE 를 삼켜도 A 가 방향을 준다 — 보충 블록 신설 0).
  const v0tyAsym = v0tyLoc.filter((c) => !(c.T === c.L && c.L === c.R));
  assert.equal(v0tyAsym.length, 9, 'v0TY 의 비대칭 셀이 A 블록 9가 아니다');
  assert.ok(v0tyAsym.every((c) => c.i >= 4 && c.i <= 6 && c.j >= 3 && c.j <= 5),
    'v0TY 비대칭 셀이 A 블록 (4..6)×(3..5) 밖이다');

  // ② 별칭 목록 자체 — 실측한 값을 그대로 핀한다 («0» 이라고 적으면 거짓말이 된다).
  //    측정: `test/output/lanes/claude-v0t-crossmatrix.mjs` — 정방향 두 칸 전부
  //    agreement 1.0000 (구조적 — 위 ①). 회전 별칭은 **0** 이다: 남은 비대칭
  //    블록(A 9셀 또는 A+SE 15셀)이 세 방향을 전부 가른다 (margin 자 값과 별개로
  //    실측 확인 — 브리프 «남은 블록 하나로 회전 3방향이 잡히는가» 의 이상 표본기
  //    쪽 답이다).
  // ①-b **같은 기전의 두 번째 쌍** (v0TR 계열 편입 2026-08-17) — v0trq 로케이터
  //    77셀은 v0tr 로케이터 93셀의 «톤까지 같은» 진부분집합이고, 나머지 16셀
  //    (K3 계보 중앙)은 전부 v0trq 슬롯 안이다. 다른 점은 **슬롯이 먼 코너가 아니라
  //    중앙(Y-심)** 이라는 것뿐이다 — 기전은 문자 그대로 같다.
  const v0trLoc = locatorCellsCellSurfaceFinal(21, 'v0tr');
  const v0trqLoc = locatorCellsCellSurfaceFinal(21, 'v0trq');
  const v0trByKey = new Map(v0trLoc.map((c) => [cellKey(c), c]));
  assert.equal(
    v0trqLoc.filter((c) => {
      const twin = v0trByKey.get(cellKey(c));
      return twin !== undefined && toneKey(twin) === toneKey(c);
    }).length,
    v0trqLoc.length,
    'v0trq 로케이터가 v0tr 로케이터의 부분집합이 아니다 — 별칭 기전이 바뀜다',
  );
  const v0trqSlot = new Set(slotCellsCellSurfaceFinal(21, 'v0trq').map(cellKey));
  const v0trqByKey = new Map(v0trqLoc.map((c) => [cellKey(c), c]));
  const v0trOnly = v0trLoc.filter((c) => !v0trqByKey.has(cellKey(c)));
  // **의도적 갱신 (2026-08-18 A 블록 편입)**: 16 → 25 = 중앙 16 + A 9.
  // A 블록 (4..6)×(3..5) 이 중앙 슬롯 상자 (0..7)² 안에 **완전히** 들어가기 때문이다
  // — 즉 v0TRQ 에서는 A 가 QR 밑에 깔리고, 셀 수·비대칭이 편입 전과 같다.
  assert.equal(v0trOnly.length, 25, 'v0TR 에만 있는 파인더 셀이 25(중앙 16 + A 9)가 아니다');
  assert.ok(v0trOnly.every((c) => v0trqSlot.has(cellKey(c))),
    'v0TR 중앙 16 + A 9 가 v0TRQ 슬롯 안에 다 들어 있지 않다');
  // 남은 방향 판별자 — 계열마다 다르다. 이것이 운영자 이중화 설계의 정본이다:
  //   v0tr  : A 9 (L 반전) + SE 6 (R 반전) = 15 — 둘 다 산다
  //   v0trq : SE 6 만 — A 는 중앙 QR 밑에 깔린다 («안쪽을 가려도 면 코너가 준다»)
  //   v0try : A 9 만 — 먼 코너 슬롯이 SE 를 삼킨다 (반대 방향, v0TY 와 같은 꼴)
  // ①-c **같은 기전의 세 번째 쌍** (v0TRY 편입 2026-08-18) — v0try 로케이터 93셀은
  //    v0tr 로케이터 102셀의 «톤까지 같은» 진부분집합이고, 나머지 9셀(SE 마커)은
  //    전부 v0try 슬롯 안이다. **v0t → v0ty 와 문자 그대로 같은 꼴**이다
  //    (같은 먼 코너 상자 [13,20]² · 같은 삼키는 블록 SE 9 · 같은 남는 판별자 A 9).
  const v0tryLoc = locatorCellsCellSurfaceFinal(21, 'v0try');
  assert.equal(
    v0tryLoc.filter((c) => {
      const twin = v0trByKey.get(cellKey(c));
      return twin !== undefined && toneKey(twin) === toneKey(c);
    }).length,
    v0tryLoc.length,
    'v0try 로케이터가 v0tr 로케이터의 부분집합이 아니다 — 별칭 기전이 바뀌었다',
  );
  const v0trySlot = new Set(slotCellsCellSurfaceFinal(21, 'v0try').map(cellKey));
  const v0tryByKey = new Map(v0tryLoc.map((c) => [cellKey(c), c]));
  const v0trOnlyY = v0trLoc.filter((c) => !v0tryByKey.has(cellKey(c)));
  assert.equal(v0trOnlyY.length, 9, 'v0TR 에만 있는 파인더 셀이 9(SE 마커)가 아니다');
  assert.ok(v0trOnlyY.every((c) => v0trySlot.has(cellKey(c))),
    'v0TR 의 SE 마커가 v0TRY 슬롯 안에 다 들어 있지 않다');
  // ⚠ **v0TRY 는 슬롯 규약을 v0TY 에서 그대로 재사용한다** (새 상수 신설 0).
  //    두 슬롯이 문자 그대로 같은 상자임을 좌표로 잠근다.
  assert.deepEqual([...v0trySlot].sort(), [...v0tySlot].sort(),
    'v0TRY 슬롯이 v0TY 슬롯과 같은 상자가 아니다 — 규약 재사용이 깨졌다');
  const expectedAsym = { v0tr: 15, v0trq: 6, v0try: 9 };
  for (const [id, loc] of [['v0tr', v0trLoc], ['v0trq', v0trqLoc], ['v0try', v0tryLoc]]) {
    const asym = loc.filter((c) => !(c.T === c.L && c.L === c.R));
    assert.equal(asym.length, expectedAsym[id], id + ' 의 비대칭 셀 수가 다르다');
    const se = asym.filter((c) => c.i >= 18 && c.j >= 18);
    const a = asym.filter((c) => c.i >= 4 && c.i <= 6 && c.j >= 3 && c.j <= 5);
    assert.equal(se.length + a.length, asym.length,
      id + ' 비대칭 셀이 A(4..6)×(3..5) 도 SE(18..20)² 도 아니다');
  }

  //    **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — 실측
  //    (`test/output/lanes/claude-v0tr-crossmatrix.mjs`) 으로 다시 재다. 정방향 별칭이
  //    **둘 → 여덟**으로 늘었고, 세 가지로 갈린다:
  //      ⓐ v0t↔v0ty (agreement 1.0000 / 1.0000) — 기존 구조적 별칭, 부분집합.
  //      ⓑ v0tr↔v0trq (1.0000 / 1.0000) — **같은 기전의 새 쌍** (위 ①-b 가 증명).
  //      ⓒ v0t↔v0tr (0.8280 / 0.8077) · v0t↔v0trq (0.7922 / 0.7975) — **새 종류**다.
  //         부분집합이 아니고 (톤까지 같은 셀은 61/104 · 45/104 뿐), agreement 가
  //         게이트 0.78 을 **간발의 차로** 넘어서 생긴다. 원인은 v0TR 이 v0T 의
  //         세 블록(NW 중앙 16 + NE 바깥 사각 36 + SE 9 = 61셀)을 **같은 자리에
  //         그대로 가진다**는 설계 사실이다 (정본 의존 규약의 대가이기도 하다).
  //         ⚠ 그래도 **넷 프레임 전부 자기 계열이 뽑힌다** — agreement 1.0 이
  //         0.79～0.83 을 이기므로 (`pickBetterLayout`), 별칭은 «같이 수용됨» 일 뿐
  //         «오분류» 가 아니다. 그 사실을 아래 ④-c 가 넷 프레임으로 몸박는다.
  //         실물 래스터·실사진 판정은 블록 로케이터 쪽이 따로 한다 — 그곳에서는
  //         코어 반경이 √129 대 √279 로 갈려 시드부터 안 섞인다.
  //      ⓓ **v0tr↔v0ty 신설 (2026-08-18 A 블록 편입의 대가)** — A 를 v0TR 에 넣자
  //         v0ty 와의 공유가 «중앙 16 + NE 바깥 36» 에서 «+ A 9 = 61셀» 로 늘어
  //         양방향 별칭이 새로 생겼다. **의도한 거래다**: A 가 없으면 v0TRY 가
  //         원리적으로 성립하지 않는다(슬롯이 SE 를 삼키면 판별자 0). 대신 v0TR 이
  //         v0TY 를 닮는다.
  //         ⚠ 이것도 ⓒ 와 같은 «같이 수용됨» 이지 «오분류» 가 아니다 — 아래 ④-c 가
  //         자기 계열 승리를 프레임마다 못 박는다. 실물 판정은 블록 로케이터가
  //         코어 반경(√129 대 √279)으로 먼저 가른다.
  //         ⚠ **관찰 대상**: 운영자가 겪는 증상이 «레이아웃 혼동» 이라 같은 축이다.
  //         실기기에서 v0TR 프레임이 v0TY 로(또는 그 반대로) 읽히면 여기를 먼저 본다.
  //    회전 별칭은 **여전히 0** 이다 — 세 방향이 전부 갈린다
  //    (margin 자가 얇다고 말하는 것과 별개의 실측이다).
  //      ⓔ **v0TRY 편입 (2026-08-18) — 정방향 별칭이 열 → 열여섯.** 새로 선 여섯 중
  //         · v0tr↔v0try 는 ⓑ 와 같은 **부분집합 별칭** (1.0000 / 1.0000 — 위 ①-c).
  //         · v0t↔v0try (0.8280 / 0.8351) · v0ty↔v0try (0.8280 / 0.8351) 는 ⓒⓓ 와 같은
  //           «같은 자리의 공유 블록» 기전이다 (v0TRY 는 v0T·v0TY 와 61셀을 공유한다).
  //         ⚠ **v0trq ↔ v0try 는 별칭이 아니다** — agreement 는 양방향 1.0000 인데
  //         **방향 margin 이 0 이라 거부된다**: 서로의 유일한 비대칭 블록이 상대
  //         슬롯 안에 통째로 들어간다 (v0trq 의 SE 6 ⊂ v0try 슬롯 · v0try 의 A 9 ⊂
  //         v0trq 슬롯). **이중화 설계가 반대 방향으로 동작한 결과**라 두 파생이
  //         서로를 안 먹는다 — 이번 편입에서 가장 좋은 성질이다.
  //         실측: `test/output/lanes/claude-v0try-crossmatrix.mjs`.
  const ALIASED_UPRIGHT = [
    'v0t|v0ty', 'v0ty|v0t',
    'v0tr|v0trq', 'v0trq|v0tr',
    'v0t|v0tr', 'v0tr|v0t',
    'v0t|v0trq', 'v0trq|v0t',
    // A 블록 편입(2026-08-18)이 만든 신설 — 위 ⓓ 참조.
    'v0tr|v0ty', 'v0ty|v0tr',
    // v0TRY 편입(2026-08-18) — 위 ⓔ 참조. v0trq ↔ v0try 는 **없다** (margin 0 거부).
    'v0tr|v0try', 'v0try|v0tr',
    'v0t|v0try', 'v0try|v0t',
    'v0ty|v0try', 'v0try|v0ty',
  ];
  const ALIASED_ROTATED = [];
  const scoreAll = { cellSurfaceLayouts: ACTIVE21 };
  const seenUpright = [];
  const seenRotated = [];
  for (const layout of ACTIVE21) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
    });
    const scored = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded), scoreAll,
    );
    assert.equal(scored.ok, true, layout + ' 평가 실패');
    assert.deepEqual(Object.keys(scored.diagnostics.layouts).sort(), [...ACTIVE21].sort());
    assert.equal(scored.accepted, true, layout + ' 정답 레이아웃이 수용되지 않았다');
    assert.equal(scored.diagnostics.layouts[layout].agreement, 1, layout + ' 정방향 일치율');
    for (const rival of ACTIVE21) {
      if (rival === layout) continue;
      if (scored.diagnostics.layouts[rival].accepted) seenUpright.push(layout + '|' + rival);
    }
    for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
      const wrong = evaluateCellSurfaceGeometry(
        { n: 21 }, idealSampleCellForEncoded(encoded, cycle), scoreAll,
      );
      for (const rival of ACTIVE21) {
        if (wrong.diagnostics.layouts[rival].accepted) {
          seenRotated.push(layout + '|' + cycle.join('') + '|' + rival);
        }
      }
    }
    // ③ 드랍된 v0X 가 «채점 대상» 으로 조용히 돌아오지 않았는가 — 기본 라인업 경로.
    const lineup = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded), {},
    );
    assert.deepEqual(Object.keys(lineup.diagnostics.layouts).sort(), [...ACTIVE21].sort(),
      layout + ': 기본 라인업 채점 대상이 활성 3후보가 아니다');
  }
  assert.deepEqual(seenUpright.sort(), [...ALIASED_UPRIGHT].sort(),
    '정방향 별칭이 v0t↔v0ty 두 방향이 아니다 — 새 별칭이 생겼거나 옛 별칭이 사라졌다');
  assert.deepEqual(seenRotated.sort(), [...ALIASED_ROTATED].sort(),
    '회전 별칭 집합이 바뀌었다 (기대 0) — 실측으로 갱신하라');

  // ④ 타이브레이크 — `pickBetterLayout` 의 동률 해소는 **두 단계**다 (모듈 실독):
  //      accepted → agreement → **기본 id(그 n 의 preferred)** → 그래도 동률이면 left.
  //    즉 ⓐ 기본이 후보에 끼면 **순서 무관**하게 기본이 이기고, ⓑ 안 끼면 **앞선
  //    후보**가 이긴다.
  //
  //    **의도적 갱신 (2026-08-18, n=21 기본 v0t → v0tr)** — 예전 이 핀은 두 규칙을
  //    «기본을 따른다» 한 문장으로 뭉쳐 놨다. 기본(v0t)이 **마침 선언 순서 1위**라
  //    ⓐ와 ⓑ가 같은 답을 내서 구분이 안 됐던 것이다 — 기본을 옮기자 그 융합이
  //    깨졌다. 이제 v0t·v0ty 쌍에는 기본이 없으므로 **ⓑ(앞선 후보)** 가 가른다.
  //    거동을 고친 게 아니라 **핀이 덜 재고 있던 축을 드러낸 것**이므로, 두 순서를
  //    각각 다른 기대값으로 잠근다 (한 값으로 묶으면 그 축이 다시 숨는다).
  //
  //    이상 표본기에서 v0ty 프레임이 v0t 로도 뽑히는 것은 결함이 아니라 좌표다:
  //    실물 래스터에서는 슬롯 자리 픽셀이 v0t 채점을 어긋내 agreement 가 갈리고,
  //    블록 로케이터의 슬롯 QR 확증이 층 하나를 더 댄다 (실사진 검증은 이
  //    체크아웃에서 불가 — 통합자 확인 항목).
  const v0tyFrame = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0ty', version: 1, tones: 2, eccLevel: 'M',
  });
  // **의도적 갱신 (실기기 순위 3차, 2026-08-19 밤)** — 이 쌍이 잠그던 명제가 바뀌었다.
  //
  // 종전: n=21 기본이 `v0tr` 이라 이 쌍(v0t·v0ty)에 **없었다** → 타이브레이크가
  //       «선호 id» 단계를 그냥 지나쳐 **left 가 이기는** 것을 보여 주는 쌍이었다.
  // 지금: 기본이 **`v0t`** 로 바뀌어 **쌍 안에 있다** → 순서와 무관하게 «선호 id» 가
  //       이긴다. 즉 이 쌍은 «left 승» 예시에서 **«기본 승» 예시로 계급이 바뀌었다.**
  //
  // ⚠ 테스트를 «통과하게» 고친 것이 아니라, **무엇을 보여주는 쌍인지가 바뀐 것**이다.
  //    그래서 기대값을 순서와 무관하게 기본으로 두고, 그 사실 자체를 단언한다.
  //    (기본이 안 낀 쌍의 «left 승» 은 바로 아래 ④-a 문단이 다룬다.)
  /**
   * 동률 쌍의 기대 승자 — **규칙에서 유도한다.**
   *
   * `pickBetterLayout`: accepted → agreement → **선호 id(그 n 의 기본)** → left.
   * 즉 동률이면 «기본이 쌍에 있으면 기본, 없으면 left» 다.
   *
   * ⚠ 이걸 손으로 적어 두면 **기본이 바뀔 때마다 깨진다.** 실제로 2026-08-19 하루에
   *   순위가 세 번 바뀌면서 이 문단이 두 번 깨졌고, 그때마다 «어느 쌍이 어느 계급인가» 를
   *   사람이 다시 판정해야 했다. 규칙을 적어 두면 계급이 바뀌어도 테스트는 그대로 맞다.
   */
  const tieWinner = (pair) => (pair.includes(finalLayoutIdForN(21)) ? finalLayoutIdForN(21) : pair[0]);

  for (const order of [['v0t', 'v0ty'], ['v0ty', 'v0t']]) {
    const picked = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(v0tyFrame), { cellSurfaceLayouts: order },
    ).scored.layoutId;
    assert.equal(picked, tieWinner(order),
      '동률 쌍 [' + order.join(',') + '] 의 승자가 규칙과 다르다'
      + ' (기본=' + finalLayoutIdForN(21) + ')');
  }
  // ④-a **기본이 낀 쌍은 순서가 안 통한다** — 2026-08-18 변경의 «실제로 달라지는
  //    자리»가 여기다. 다만 이상 표본기에서 v0tr↔v0t 는 애초에 동률이 아니라
  //    (v0tr 프레임: v0tr 1.000 vs v0t 0.827) agreement 단계에서 갈린다. 그래서
  //    **전체 라인업 판정은 변경 전후가 같다** — 이 변경은 «실물 래스터에서 둘이
  //    정확히 동률로 붙는 순간»에만 보인다. 인식률 개선으로 읽으면 안 된다.
  //    (실측: `test/output/lanes/claude-tiebreak-v0tr.mjs` — 네 프레임 × 일곱 후보조합)
  const v0trFrame = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0tr', version: 1, tones: 2, eccLevel: 'M',
  });
  for (const order of [['v0tr', 'v0trq'], ['v0trq', 'v0tr']]) {
    const picked = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(v0trFrame), { cellSurfaceLayouts: order },
    ).scored.layoutId;
    assert.equal(picked, tieWinner(order),
      '동률 쌍 [' + order.join(',') + '] 의 승자가 규칙과 다르다'
      + ' (기본=' + finalLayoutIdForN(21) + ')');
  }
  // ④-b **우선 id 는 여전히 하나뿐이다** — `pickBetterLayout` 이 보는 것은 «그 n 의
  //    기본» 단 하나이고, 2026-08-17 판에서는 그것이 v0t 였기에 v0tr↔v0trq 동률은
  //    후보 순서가 갈랐다. **2026-08-18 로 기본이 v0tr 이 되면서 그 쌍은 순서를
  //    잃었다** — 이제 v0trq 프레임도 두 순서 모두 v0tr 로 뽑힌다.
  //    두 가지를 분명히 해 둔다:
  //      · 잃은 것은 «순서가 가른다» 는 **관측 축**이지 거동의 정확도가 아니다.
  //        그 축은 위 ④(v0t↔v0ty, 기본이 안 낀 쌍)가 이어받아 계속 잰다.
  //      · 우선 id 를 계열별로 늘리는 것은 공유 선택기를 고치는 일이라 여전히
  //        이 레인의 몫이 아니다 — 순서 변경만으로 원하는 결과가 나왔다.
  const v0trqFrame = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0trq', version: 1, tones: 2, eccLevel: 'M',
  });
  for (const order of [['v0tr', 'v0trq'], ['v0trq', 'v0tr']]) {
    const picked = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(v0trqFrame), { cellSurfaceLayouts: order },
    ).scored.layoutId;
    assert.equal(picked, tieWinner(order),
      '동률 쌍 [' + order.join(',') + '] 의 승자가 규칙과 다르다'
      + ' (기본=' + finalLayoutIdForN(21) + ')');
  }
  // ④-c **넷 프레임 전부 자기 계열이 뽑힌다** — ②ⓒ 의 새 별칭(v0t↔v0tr)이
  //    «같이 수용됨» 일 뿐 «오분류» 가 아니라는 것의 증거다. 슬롯 변형은
  //    기반(v0t · v0tr)으로 동률 타이브레이크되므로 **계열**로 재다.
  // v0TRY 도 v0TR 계열이다 (2026-08-18) — 슬롯 변형이라 기반으로 동률 타이브레이크된다.
  const FAMILY_OF = {
    v0t: 'v0t', v0ty: 'v0t', v0tr: 'v0tr', v0trq: 'v0tr', v0try: 'v0tr',
  };
  for (const layout of ACTIVE21) {
    const frame = encodeY(PAYLOAD, {
      cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
    });
    const picked = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(frame), { cellSurfaceLayouts: ACTIVE21 },
    ).scored.layoutId;
    assert.equal(picked, FAMILY_OF[layout],
      layout + ' 프레임이 다른 계열(' + picked + ')로 뽑혔다 — 별칭이 오분류가 됐다');
  }
});

// ═════════════════════════════════════════════════════════════════════════
// RS 파라미터 전수 회귀 (2026-08-16 r2 · 통합자 결정 C)
//
// 왜 생겼나 — **조용히 지나간 사고가 있었다.** 포맷 v2 전환(S 가 1 줄어듦)이
// `nsymTable` 의 **비율 기반** 반올림 문턱을 넘겨 세 조합에서 정정능력을 1심볼
// 깎았는데(v2r2@21-L 7→6 · v2r2@25-M 22→21 · v2r2@25-H 35→34), 스위트 전체에서
// `nsym` 을 단언하는 곳이 `v0x@21` 한 줄뿐이라 아무도 못 봤다(적대 검증 F2).
// 왜곡 강건성을 노린 개정이 정정능력을 깎았는데 테스트는 초록이었다.
//
// 그래서 **(레이아웃 × ECC) 15조합 × {nsym, errorCapacity, dataSymbols, dataBytes,
// maxPayloadBytes}** 를 전수 단언한다. 값은 «맞아야 할 값» 이 아니라 **실측값**이다 —
// 여기가 빨개지면 그것은 버그 신호가 아니라 «공표 수치를 다시 재라» 는 신호다
// (SPEC §5.5 용량표 · §6 ECC 파라미터가 이 표를 승계한다).
//
// 두 세대를 다 건다: 현행(포맷 v2)과 레거시(포맷 v1, 판독 전용). 레거시 열은
// 개정 전 트리(04fdff4)에서 뜬 값 그대로이므로 폴백 복호의 RS 파라미터가
// 조용히 어긋나는 것도 여기서 잡힌다.
// ═════════════════════════════════════════════════════════════════════════

/** 15조합 실측표 — [nsym, errorCapacity, dataSymbols, dataBytes, maxPayloadBytes]. */
const RS_TABLE = Object.freeze({
  2: Object.freeze({ // 현행 세대 (포맷 v2 · 18셀)
    'v0@13': { S: 36, L: [4, 2, 32, 30, 29], M: [9, 4, 27, 26, 25], H: [14, 7, 22, 21, 20] },
    'v2r2@21': { S: 112, L: [13, 6, 99, 95, 94], M: [29, 14, 83, 80, 79], H: [45, 22, 67, 64, 63] },
    'v2r2@25': { S: 173, L: [21, 10, 152, 146, 145], M: [43, 21, 130, 125, 124], H: [69, 34, 104, 100, 99] },
    'v1r2@21': { S: 110, L: [13, 6, 97, 93, 92], M: [29, 14, 81, 78, 77], H: [44, 22, 66, 63, 62] },
    'v0x@21': { S: 115, L: [14, 7, 101, 97, 96], M: [29, 14, 86, 82, 81], H: [46, 23, 69, 66, 65] },
  }),
  1: Object.freeze({ // 레거시 세대 (포맷 v1 · 15셀) — 개정 전 트리와 동일
    'v0@13': { S: 37, L: [4, 2, 33, 31, 30], M: [9, 4, 28, 27, 26], H: [15, 7, 22, 21, 20] },
    'v2r2@21': { S: 113, L: [14, 7, 99, 95, 94], M: [29, 14, 84, 81, 80], H: [45, 22, 68, 65, 64] },
    'v2r2@25': { S: 174, L: [21, 10, 153, 147, 146], M: [45, 22, 129, 124, 123], H: [70, 35, 104, 100, 99] },
    'v1r2@21': { S: 111, L: [13, 6, 98, 94, 93], M: [29, 14, 82, 79, 78], H: [44, 22, 67, 64, 63] },
    'v0x@21': { S: 116, L: [14, 7, 102, 98, 97], M: [29, 14, 87, 83, 82], H: [46, 23, 70, 67, 66] },
  }),
});

test('RS 파라미터 전수 — 15조합 × {nsym, errorCapacity, dataSymbols, dataBytes, payload} (현행 세대)', () => {
  let combos = 0;
  for (const [key, want] of Object.entries(RS_TABLE[CELL_SURFACE_FINAL_FORMAT_WIRE])) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    const surface = cellSurfaceFinal(n, id);
    assert.equal(surface.usedSymbols, want.S, key + ' S');
    assert.deepEqual(surface.nsym, {
      symbols: want.S, L: want.L[0], M: want.M[0], H: want.H[0],
    }, key + ' nsym 표');
    for (const level of ['L', 'M', 'H']) {
      const [nsym, ec, dataSymbols, dataBytes, payload] = want[level];
      const capacity = capacityForCellSurfaceFinal(n, level, 2, id);
      assert.equal(capacity.nsym, nsym, key + '-' + level + ' nsym');
      assert.equal(capacity.errorCapacity, ec, key + '-' + level + ' errorCapacity');
      assert.equal(capacity.dataSymbols, dataSymbols, key + '-' + level + ' dataSymbols');
      assert.equal(capacity.dataBytes, dataBytes, key + '-' + level + ' dataBytes');
      assert.equal(capacity.maxPayloadBytes, payload, key + '-' + level + ' maxPayloadBytes');
      // nsym 은 «데이터 + 패리티 = S» 회계와 항상 맞아야 한다.
      assert.equal(capacity.dataSymbols + capacity.nsym, want.S, key + '-' + level + ' 합계');
      combos += 1;
    }
  }
  assert.equal(combos, 15, '조합 수가 15 가 아니다 — 라인업이 늘었으면 표를 갱신하라');
});

test('RS 파라미터 전수 — 레거시(포맷 v1) 세대도 개정 전 값 그대로다', () => {
  let combos = 0;
  for (const [key, want] of Object.entries(RS_TABLE[CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY])) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    const surface = cellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
    assert.equal(surface.usedSymbols, want.S, key + ' S(v1)');
    for (const level of ['L', 'M', 'H']) {
      const [nsym, ec, dataSymbols, dataBytes, payload] = want[level];
      const capacity = capacityForCellSurfaceFinal(
        n, level, 2, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
      );
      assert.equal(capacity.nsym, nsym, key + '-' + level + ' nsym(v1)');
      assert.equal(capacity.errorCapacity, ec, key + '-' + level + ' errorCapacity(v1)');
      assert.equal(capacity.dataSymbols, dataSymbols, key + '-' + level + ' dataSymbols(v1)');
      assert.equal(capacity.dataBytes, dataBytes, key + '-' + level + ' dataBytes(v1)');
      assert.equal(capacity.maxPayloadBytes, payload, key + '-' + level + ' payload(v1)');
      combos += 1;
    }
  }
  assert.equal(combos, 15);
});

test('세대 전환의 대가 — 정정능력 −1 이 세 조합, payload 는 «전부 −1 B» 가 아니다', () => {
  // ⚠ **운영자 재가 대기 항목**. 이 테스트는 «좋다» 고 말하지 않는다 —
  // 포맷 v2 가 무엇을 얼마나 깎았는지를 **수치로 고정**해 다음 사람이 모르고
  // 지나가지 못하게 한다. 재가 전까지 이 표는 SPEC §7.5 «불변» 행을 대체한다.
  const eccLoss = [];
  const payloadDelta = {};
  for (const key of Object.keys(RS_TABLE[2])) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    for (const level of ['L', 'M', 'H']) {
      const now = capacityForCellSurfaceFinal(n, level, 2, id);
      const legacy = capacityForCellSurfaceFinal(
        n, level, 2, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
      );
      if (now.errorCapacity !== legacy.errorCapacity) {
        eccLoss.push(key + '-' + level + ' ' + legacy.errorCapacity + '→' + now.errorCapacity);
      }
      payloadDelta[key + '-' + level] = now.maxPayloadBytes - legacy.maxPayloadBytes;
    }
  }
  // 정정능력이 움직인 조합은 정확히 셋이고 전부 v2r2 (n=21·25 기본 레이아웃)다.
  assert.deepEqual(eccLoss, [
    'v2r2@21-L 7→6',
    'v2r2@25-M 22→21',
    'v2r2@25-H 35→34',
  ], '정정능력 변동 집합이 달라졌다 — 운영자 재가 표(§7.5)를 갱신하라');
  // «전 레이아웃 payload −1 B» 는 거짓이다 — 15조합 중 4개가 반례(0 셋 · +1 하나).
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const delta of Object.values(payloadDelta)) counts[String(delta)] += 1;
  assert.deepEqual(counts, { '-1': 11, 0: 3, 1: 1 }, 'payload 델타 분포');
  assert.equal(payloadDelta['v2r2@25-M'], 1,
    'v2r2@25-M 은 payload 가 **늘어난다**(123→124) — nsym 45→43 이 −1심볼을 덮는다');
});

test('errorCapacity 는 실제 정정 한계와 일치한다 — RS 훼손 실험 (v2r2@25-M)', () => {
  // 장부상 수치가 아니라 실제라는 것을 한 조합에서 실측으로 못 박는다
  // (적대 검증 F2 가 쓴 방법 그대로: nsym/2 개까지 복구, 그 위는 실패).
  const capacity = capacityForCellSurfaceFinal(25, 'M', 2, 'v2r2');
  assert.equal(capacity.errorCapacity, 21);
  const data = new Uint8Array(capacity.dataSymbols);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 7 + 3) % 211;
  const codeword = rsEncode(data, capacity.nsym);
  const corrupt = (count) => {
    const copy = Uint8Array.from(codeword);
    for (let i = 0; i < count; i += 1) copy[i] = (copy[i] + 1) % 211;
    return rsDecode(copy, capacity.nsym);
  };
  const atLimit = corrupt(21);
  assert.equal(atLimit.ok, true, '정정 한계 21 에서 복구 실패: ' + (atLimit.reason || ''));
  assert.deepEqual(Array.from(atLimit.message), Array.from(data), '21 훼손 복구값이 다르다');
  const overLimit = corrupt(22);
  const recovered = overLimit.ok
    && Array.from(overLimit.message).every((v, i) => v === data[i]);
  assert.equal(recovered, false, '한계 초과(22)에서 복구됐다 — errorCapacity 선언이 낮다');
});

// ═════════════════════════════════════════════════════════════════════════
// v0XQ — 중앙 QR 변형 (2026-08-17 운영자 분기 확정)
//
// 신설 블록이다 (기존 단언 무변경). 여기서 못 박는 것:
//   ① 회계 — 441 − 42 − 81(슬롯) − 12 − 18 = 288 · S=96 · 잔여 0.
//   ② 계보 — 3코너는 v0X SE 6×6 의 평행이동, 위상 마커는 v0X SW 6셀 **그대로**.
//   ③ 좌표 사상 — 3코너가 실제로 «좌상·우상·하단»(심 꼭짓점 셋)에 앉는다.
//   ④ 슬롯 상한 9 는 autoplace 가 정한다 (m ≥ 10 은 REF_QUADRANT 거부).
//   ⑤ 왕복 (2·3톤) · 렌더 자체검증 · 중앙 QR 렌더 계약.
//   ⑥ 레거시(포맷 v1) 세대 부재.
// ═════════════════════════════════════════════════════════════════════════

test('v0XQ 회계 — 441 − 42 − 81(슬롯) − 12 − 18 = 288 · S 96 · 잔여 0', () => {
  const surface = cellSurfaceFinal(21, 'v0xq');
  assert.equal(surface.id, 'v0xq');
  assert.equal(surface.profile, 'cell-surface-v0xq');
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 42);
  assert.equal(surface.slotCount, 81);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(surface.declaredDataCells, 288);
  assert.equal(surface.usedSymbols, 96);
  // **잔여 0 은 최종 라인업에서 v0xq 뿐이다** — 필러 셀이 아예 없다.
  assert.equal(surface.residualCells, 0);
  assert.equal(fillerCellsCellSurfaceFinal(21, 'v0xq').length, 0);
  assert.equal(dataCellsInScanOrderCellSurfaceFinal(21, 'v0xq').length, 288);
  assert.equal(nameCellSurfaceFinal(21, 2, 'v0xq'), 'Y1-CS-V0XQ');
  assert.equal(nameCellSurfaceFinal(21, 3, 'v0xq'), 'Y1T-CS-V0XQ');
  for (const tones of [2, 3]) {
    const capacity = capacityForCellSurfaceFinal(21, 'M', tones, 'v0xq');
    assert.equal(capacity.dataCells, 288);
    assert.equal(capacity.centerQrSlot, 81);
    assert.equal(capacity.overhead, 42 + 81 + 18 + 12);
    assert.equal(capacity.formatIndex, tones === 3 ? 3 : 1);
  }
  // 슬롯·파인더·예약이 서로 겹치지 않고 n² 를 정확히 나눈다.
  const seen = new Set();
  for (const cell of [
    ...surface.locatorCells, ...surface.slotCells,
    ...surface.formatCells, ...surface.referenceCells,
    ...dataCellsInScanOrderCellSurfaceFinal(21, 'v0xq'),
  ]) {
    const key = cell.i + ',' + cell.j;
    assert.equal(seen.has(key), false, '역할 중복: ' + key);
    seen.add(key);
  }
  assert.equal(seen.size, 441);
  const map = layoutMapCellSurfaceFinal(21, 'v0xq');
  assert.equal([...map.values()].filter((e) => e.role === 'slot').length, 81);
});

test('v0XQ 계보 — 3코너 = v0X SE 평행이동 · 위상 마커 = v0X SW 그대로 · mid 0', () => {
  const cells = locatorCellsCellSurfaceFinal(21, 'v0xq');
  const corner = cells.filter((c) => c.i <= V0XQ_BLOCKS.CORNER.iMax
    && c.j >= V0XQ_BLOCKS.CORNER.jMin);
  const marker = cells.filter((c) => c.i >= V0XQ_BLOCKS.MARKER.iMin
    && c.j <= V0XQ_BLOCKS.MARKER.jMax);
  assert.equal(corner.length, 36);
  assert.equal(marker.length, 6);
  assert.equal(corner.length + marker.length, cells.length, '분류 밖 셀이 있다');

  const v0xSe = new Map(locatorCellsCellSurfaceFinal(21, 'v0x')
    .filter((c) => c.i >= V0X_BLOCKS.SE.iMin && c.j >= V0X_BLOCKS.SE.jMin)
    .map((c) => [c.i + ',' + c.j, c]));
  assert.equal(v0xSe.size, 36);
  let normalized = 0;
  for (const cell of corner) {
    const src = v0xSe.get((cell.i + 15) + ',' + cell.j);
    assert.ok(src, 'v0X SE 에 대응 셀이 없다: ' + cell.i + ',' + cell.j);
    for (const face of ['T', 'L', 'R']) {
      if (src[face] === 1) { normalized += 1; continue; }
      assert.equal(cell[face], src[face], '톤이 갈렸다: ' + cell.i + ',' + cell.j);
    }
    // 3면 동일 — 세 면이 같은 K5 서명을 내야 로케이터 삼중점이 성립한다.
    assert.equal(cell.T, cell.L);
    assert.equal(cell.L, cell.R);
  }
  // v0X 정본 정규화(45d3505)로 SE 의 mid 면은 0 개다 → 위 108 면 비교에서 **한 면도
  // 건너뛰지 않았다**. 즉 CORNER 는 정규화된 SE 의 «톤 변경 0» 평행이동본이다.
  // 이 0 이 1 로 돌아가면 = v0X 정규화가 되돌려졌다는 뜻이고, v0xq 는 따라 깨져야 한다.
  assert.equal(normalized, 0,
    'v0X SE 에 mid 면이 되살아났다 — v0xq 는 정규화된 SE 의 평행이동본이어야 한다');

  const v0xSw = locatorCellsCellSurfaceFinal(21, 'v0x')
    .filter((c) => c.i >= V0X_BLOCKS.SW.iMin && c.j <= V0X_BLOCKS.SW.jMax);
  assert.deepEqual(
    marker.map((c) => [c.i, c.j, c.T, c.L, c.R]),
    v0xSw.map((c) => [c.i, c.j, c.T, c.L, c.R]),
    '위상 마커가 v0X SW 정본과 다르다',
  );
  // 위상 판별력의 유일한 원천 — 동심 사각은 3면 동일이라 0 이다.
  assert.ok(marker.some((c) => c.T === c.L && c.R !== c.T), '면 비대칭이 없다');

  // v0xq 정본에는 mid 면이 0 개다 — v0X 를 포함한 전 정본과 **같은** 규칙이다
  // (정규화 이전에는 v0X 만 예외였고 v0xq 가 그 예외를 사본에서 없앴다).
  for (const cell of cells) {
    for (const face of ['T', 'L', 'R']) {
      assert.notEqual(cell[face], 1, 'mid 면이 생겼다: ' + cell.i + ',' + cell.j);
    }
  }
});

test('v0XQ 좌표 사상 — 3코너가 좌상·우상·하단(심 꼭짓점 셋)에 앉는다', () => {
  // 편집기 캔버스의 «NE 사분면» 이 화면에서는 세 심 꼭짓점으로 흩어진다.
  // 이 단언이 운영자 분기 ①(「좌상 = T면 왼쪽 + L면 위쪽」)의 코드 측 고정이다.
  const n = 21;
  const layout = layoutForCube(n, { size: 1, margin: 0 });
  const origin = { x: layout.originX, y: layout.originY };
  const cornerAt = (index) => ({
    x: origin.x + CORNER_UNIT_OFFSETS[index].x * n,
    y: origin.y + CORNER_UNIT_OFFSETS[index].y * n,
  });
  const SEAM = { C1: 1, C3: 3, C5: 5 }; // 우상 · 하단 · 좌상
  const cells = locatorCellsCellSurfaceFinal(n, 'v0xq');
  const corner = cells.filter((c) => c.i <= V0XQ_BLOCKS.CORNER.iMax
    && c.j >= V0XQ_BLOCKS.CORNER.jMin);
  const marker = cells.filter((c) => c.i >= V0XQ_BLOCKS.MARKER.iMin
    && c.j <= V0XQ_BLOCKS.MARKER.jMax);
  const centroid = (list, face) => {
    let sx = 0; let sy = 0;
    for (const cell of list) {
      const point = moduleCenter(face, cell.i, cell.j, layout);
      sx += point.x; sy += point.y;
    }
    return { x: sx / list.length, y: sy / list.length };
  };
  const nearest = (point) => {
    let best = -1; let bestDistance = Infinity;
    for (let k = 0; k < 6; k += 1) {
      const c = cornerAt(k);
      const d = Math.hypot(point.x - c.x, point.y - c.y);
      if (d < bestDistance) { bestDistance = d; best = k; }
    }
    return best;
  };
  // 동심 사각: T→좌상 · R→우상 · L→하단.
  assert.equal(nearest(centroid(corner, 'T')), SEAM.C5);
  assert.equal(nearest(centroid(corner, 'R')), SEAM.C1);
  assert.equal(nearest(centroid(corner, 'L')), SEAM.C3);
  // 위상 마커: 같은 세 꼭짓점을 **다른 면**으로 채운다 (코너마다 사각+마커 한 쌍).
  assert.equal(nearest(centroid(marker, 'T')), SEAM.C1);
  assert.equal(nearest(centroid(marker, 'L')), SEAM.C5);
  assert.equal(nearest(centroid(marker, 'R')), SEAM.C3);
  // 슬롯은 세 면 모두 중앙이다 (원거리 꼭짓점이 아니다).
  const slot = slotCellsCellSurfaceFinal(21, 'v0xq');
  for (const face of ['T', 'L', 'R']) {
    const c = centroid(slot, face);
    assert.ok(Math.hypot(c.x - origin.x, c.y - origin.y) < 5, face + ' 슬롯이 중앙이 아니다');
  }
  // 코어 반경은 닫힌 형태 √279 = 16.7033셀. 암 2×2 코어의 중심은 셀 (2,17)·(3,18) 의
  // **공유 꼭짓점** (a,b) = (3,18) 이고, 두 기저의 사잇각이 120° 라
  //   r² = a² + b² − a·b = 9 + 324 − 54 = 279.
  const { ei, ej } = faceBasis('T');
  const coreR = Math.hypot(3 * ei.x + 18 * ej.x, 3 * ei.y + 18 * ej.y);
  assert.ok(Math.abs(coreR - Math.sqrt(279)) < 1e-9, '코어 반경 ' + coreR);
});

test('v0XQ 슬롯 상한 9 는 autoplace 가 정한다 (m ≥ 10 → REF_QUADRANT)', () => {
  assert.equal(CENTER_QR_SLOT_CELLS, 9);
  assert.equal(hasCenterQrSlot('v0xq'), true);
  for (const id of ['v0', 'v1r2', 'v2r2', 'v0x']) {
    assert.equal(hasCenterQrSlot(id), false);
    const n = CELL_SURFACE_FINAL_NS[id][0];
    assert.equal(slotCellsCellSurfaceFinal(n, id).length, 0);
    // 슬롯이 없는 레이아웃은 점유 == painted — 기존 소비자 동작 불변.
    assert.equal(
      occupiedCellsCellSurfaceFinal(n, id).length,
      cellSurfaceFinal(n, id).paintedCells.length,
    );
  }
  assert.equal(occupiedCellsCellSurfaceFinal(21, 'v0xq').length, 42 + 81);

  // 파인더 42 를 고정하고 슬롯만 키운다 — 9 는 수용, 10 부터 거부.
  const finder = locatorCellsCellSurfaceFinal(21, 'v0xq').map((c) => ({ i: c.i, j: c.j }));
  const slotOf = (m) => {
    const out = [];
    for (let i = 0; i < m; i += 1) for (let j = 0; j < m; j += 1) out.push({ i, j });
    return out;
  };
  const place = (m) => placeReservedCells(21, [...finder, ...slotOf(m)], {
    formatBlockLength: 6,
  });
  assert.ok(place(9), 'm=9 가 수용돼야 한다');
  for (const m of [10, 11, 13]) {
    assert.throws(() => place(m), (error) => error instanceof AutoplaceError
      && error.code === 'AUTOPLACE_REF_QUADRANT', 'm=' + m + ' 이 거부되지 않았다');
  }
});

test('v0XQ 중앙 QR 기하 — 피치 9/29 · 콰이어트 프레임 32셀 · 파인더 3개', () => {
  assert.equal(CENTER_QR_QUIET_MODULES, 4);
  const pitch = centerQrModulePitchCells();
  assert.ok(Math.abs(pitch - 9 / 29) < 1e-12, '피치 ' + pitch);
  // 심볼(21모듈) + 사방 콰이어트(4모듈)가 슬롯 9셀에 정확히 들어간다.
  assert.ok(Math.abs((21 + 8) * pitch - CENTER_QR_SLOT_CELLS) < 1e-12);
  const frame = centerQrQuietFrameCells();
  // 심볼은 a,b ∈ [4·pitch, 25·pitch] = [1.241, 7.759] — 셀 0 과 8 이 완전히 밖이다.
  assert.equal(frame.length, 81 - 49);
  for (const cell of frame) {
    assert.ok(cell.i === 0 || cell.i === 8 || cell.j === 0 || cell.j === 8,
      '콰이어트 프레임이 아닌 셀: ' + cell.i + ',' + cell.j);
  }
  assert.equal(CENTER_QR_FINDER_MODULES.length, 3);
  // 직각 이등변 — 이 비대칭이 120° 위상을 깨는 유일한 중앙 신호다.
  const [a, b, c] = CENTER_QR_FINDER_MODULES;
  assert.equal(a.qy, b.qy);
  assert.equal(a.qx, c.qx);
  assert.equal(b.qx - a.qx, c.qy - a.qy);
});

test('v0XQ 왕복 — 2·3톤 인코드→디코드 · 렌더 자체검증 mismatch 0', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v0xq', version: 1, tones, eccLevel: 'M',
    });
    assert.equal(encoded.n, 21);
    assert.equal(encoded.cellSurfaceLayout, 'v0xq');
    assert.equal(encoded.locatorProfile, 'cell-surface-v0xq');
    assert.equal(encoded.formatIndex, tones === 3 ? 3 : 1);
    assert.equal(encoded.cellDigits.size, 441);
    const roles = {};
    for (const [, entry] of encoded.cellDigits) {
      roles[entry.role] = (roles[entry.role] || 0) + 1;
    }
    assert.deepEqual(roles, {
      locator: 42, slot: 81, reference: 12, format: 18, data: 288,
    });

    // 셀 → 페이로드 왕복 (레이아웃 id 경로 · 프로파일 힌트 경로 둘 다).
    const digits = dataCellsInScanOrderCellSurfaceFinal(21, 'v0xq')
      .map((cell) => encoded.cellDigits.get(cell.i + ',' + cell.j).digit);
    for (const format of [
      {
        type: 'Y', n: 21, eccLevel: 'M',
        cellSurfaceLayout: 'v0xq', formatIndex: encoded.formatIndex,
      },
      {
        type: 'Y', n: 21, eccLevel: 'M',
        locatorProfile: 'cell-surface-v0xq', formatIndex: encoded.formatIndex,
      },
    ]) {
      const decoded = decodeCells(digits, format);
      assert.equal(decoded.ok, true, JSON.stringify(format) + ' 복호 실패');
      assert.equal(decoded.text, PAYLOAD);
    }

    // 렌더 자체검증 — 슬롯 셀은 digit 이 없어 verify 대상에서 빠진다 (441 − 42 − 81).
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText: TL_READER_URL });
    const raster = rasterize(scene, { pixelsPerUnit: 15, supersample: 2 });
    const report = verifyRasterY(raster, scene, encoded);
    assert.equal(report.mismatches.length, 0, tones + '톤 mismatch');
    assert.equal(report.erasures.length, 0, tones + '톤 erasure');
    assert.equal(report.total, 441 - 42 - 81);
  }
});

test('v0XQ 렌더 계약 — qrText 필수 · 코너 QR 자동 억제 · 슬롯 폴리곤 없음', () => {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0xq', version: 1, tones: 2, eccLevel: 'M',
  });
  // 중앙 슬롯 81셀이 레이아웃 정의라 QR 없이는 구멍이 난다 — 조용히 비우지 않는다.
  assert.throws(() => buildSceneY(encoded, { palette: PALETTE }), RangeError);

  const withQr = buildSceneY(encoded, { palette: PALETTE, qrText: TL_READER_URL });
  const withCorner = buildSceneY(encoded, {
    palette: PALETTE, qrText: TL_READER_URL, cornerQr: true,
  });
  // 코너 QR 은 기본 억제 — 명시 opt-in 이 도형을 늘린다(계측용 탈출구가 살아 있다).
  assert.ok(withCorner.shapes.length > withQr.shapes.length, '코너 QR opt-in 이 무효다');
  assert.equal(withQr.locatorProfile, 'cell-surface-v0xq');

  // 슬롯 셀은 폴리곤을 안 그린다 — 셀 폴리곤은 (441 − 81) × 3 면이다.
  // (그 위에 중앙 QR 콰이어트 1 + 다크 모듈 + L/R 필러 2 가 얹힌다.)
  const cellPolygons = (441 - 81) * 3;
  const v0x = buildSceneY(
    encodeY(PAYLOAD, { cellSurfaceLayout: 'v0x', version: 1, tones: 2, eccLevel: 'M' }),
    { palette: PALETTE },
  );
  assert.equal(v0x.shapes.filter((s) => s.kind === 'polygon').length >= 441 * 3, true);
  assert.ok(
    withQr.shapes.filter((s) => s.kind === 'polygon').length > cellPolygons,
    '중앙 QR 도형이 안 실렸다',
  );
  assert.ok(
    withQr.shapes.filter((s) => s.kind === 'polygon').length < 441 * 3,
    '슬롯 셀 폴리곤이 그대로 그려졌다',
  );
});

test('v0XQ 는 레거시(포맷 v1) 세대가 없다 — 조용히 생기면 throw', () => {
  assert.equal(hasLegacyFormatWire('v0xq'), false);
  for (const id of ['v0', 'v1r2', 'v2r2', 'v0x']) {
    assert.equal(hasLegacyFormatWire(id), true);
  }
  assert.throws(
    () => cellSurfaceFinal(21, 'v0xq', CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY),
    RangeError,
  );
  assert.equal(
    cellSurfaceFinal(21, 'v0xq', CELL_SURFACE_FINAL_FORMAT_WIRE).declaredDataCells, 288,
  );
});

// ─────────────────────────────────────────────────────────────────────────
// 통합 합성 회귀 (2026-08-16, v0X 정규화 × v0xq 편입 3-way 통합)
//
// 두 레인이 **같은 층**을 만졌다: main 은 v0X 정본을 정규화했고(mid 4면 제거),
// v0xq 레인은 그 v0X 에서 사본을 유도했다. 텍스트 충돌은 없었지만 **의미 충돌**이
// 있었다 — v0xq 의 자기검증이 «SE 에 mid 가 정확히 1개» 를 전제해 병합 트리가
// 모듈 로드에서 터졌다. 아래 테스트들은 그 결합을 명시로 못 박아, 정규화가 SE 를
// 또 바꾸면 **v0xq 쪽이 반드시 따라 깨지도록** 한다.
// ─────────────────────────────────────────────────────────────────────────

test('통합 ① v0X 정본이 정규화본 그대로다 — 65셀 · 195면 전부 0/2 · SE 3면 동일 36/36', () => {
  const cells = locatorCellsCellSurfaceFinal(21, 'v0x');
  assert.equal(cells.length, 65, 'v0X 정본 셀 수');

  let faces = 0;
  let mid = 0;
  for (const cell of cells) {
    for (const face of ['T', 'L', 'R']) {
      faces += 1;
      if (cell[face] === 1) mid += 1;
      assert.ok(cell[face] === 0 || cell[face] === 2,
        'v0X 톤이 0/2 가 아니다: ' + cell.i + ',' + cell.j + '.' + face);
    }
  }
  assert.equal(faces, 195, 'v0X 면 수 = 65 × 3');
  assert.equal(mid, 0, 'v0X 정본에 mid 면이 되살아났다 — 정규화(45d3505)가 되돌려졌다');

  // 정규화가 만든 구조적 결과 — SE 36셀이 **전부** 3면 동일이다. v0xq CORNER 가
  // «톤 변경 0 사본» 일 수 있는 근거가 정확히 이것이라 여기서 함께 못 박는다.
  const se = cells.filter((c) => c.i >= V0X_BLOCKS.SE.iMin && c.j >= V0X_BLOCKS.SE.jMin);
  assert.equal(se.length, 36);
  assert.equal(se.filter((c) => c.T === c.L && c.L === c.R).length, 36,
    'v0X SE 3면 동일이 36/36 이 아니다 — v0xq 코너 K5 서명의 전제가 깨진다');
});

test('통합 ② v0xq = 정규화된 v0X 의 순수 사본 — CORNER 평행이동 · MARKER 그대로, 톤 변경 0', () => {
  const v0x = locatorCellsCellSurfaceFinal(21, 'v0x');
  const v0xq = locatorCellsCellSurfaceFinal(21, 'v0xq');
  const key = (cell) => cell.i + ',' + cell.j + ':' + cell.T + cell.L + cell.R;

  // 기대값을 **v0X 정본에서 직접 만든다** — v0xq 소스를 안 보고 관계만으로 재구성.
  // 예외 분기가 하나도 없다는 것이 이 테스트의 요점이다 (mid 를 눈감아 주는
  // `if (src === 1) continue` 같은 탈출구가 없다).
  const expectedCorner = v0x
    .filter((c) => c.i >= V0X_BLOCKS.SE.iMin && c.j >= V0X_BLOCKS.SE.jMin)
    .map((c) => ({ i: c.i - 15, j: c.j, T: c.T, L: c.L, R: c.R }));
  const expectedMarker = v0x
    .filter((c) => c.i >= V0X_BLOCKS.SW.iMin && c.j <= V0X_BLOCKS.SW.jMax)
    .map((c) => ({ i: c.i, j: c.j, T: c.T, L: c.L, R: c.R }));
  assert.equal(expectedCorner.length, 36);
  assert.equal(expectedMarker.length, 6);

  const expected = [...expectedCorner, ...expectedMarker]
    .map(key).sort();
  assert.deepEqual(v0xq.map(key).sort(), expected,
    'v0xq 정본이 «정규화된 v0X SE 평행이동 ∪ SW 그대로» 와 좌표·톤이 다르다');

  // 평행이동 사상이 1:1 인지도 따로 — 위 집합 비교는 중복을 못 잡는다.
  assert.equal(new Set(v0xq.map((c) => c.i + ',' + c.j)).size, 42);
});

test('통합 ③ occupiedCells — 슬롯 없는 넷은 paintedCells 와 같은 배열 참조, v0xq 만 painted ∪ slot', () => {
  for (const [id, n] of [['v0', 13], ['v2r2', 21], ['v2r2', 25], ['v1r2', 21], ['v0x', 21]]) {
    const surface = cellSurfaceFinal(n, id);
    assert.equal(surface.slotCells.length, 0, id + '@' + n + ' 에 슬롯이 생겼다');
    // 참조 동일성 — v0xq 편입이 기존 소비자에게 **바이트 불변**임을 이걸로 못 박는다.
    assert.equal(surface.occupiedCells, surface.paintedCells,
      id + '@' + n + ': occupiedCells 가 paintedCells 와 다른 배열이 됐다');
  }

  const v0xq = cellSurfaceFinal(21, 'v0xq');
  assert.notEqual(v0xq.occupiedCells, v0xq.paintedCells, 'v0xq 는 같은 참조면 안 된다');
  assert.equal(v0xq.paintedCells.length, 42);
  assert.equal(v0xq.slotCells.length, 81);
  assert.equal(v0xq.occupiedCells.length, 123);
  const paintedKeys = new Set(v0xq.paintedCells.map((c) => c.i + ',' + c.j));
  const slotKeys = new Set(v0xq.slotCells.map((c) => c.i + ',' + c.j));
  for (const k of slotKeys) assert.ok(!paintedKeys.has(k), '슬롯이 파인더와 겹친다: ' + k);
  assert.deepEqual(
    v0xq.occupiedCells.map((c) => c.i + ',' + c.j),
    [...v0xq.paintedCells, ...v0xq.slotCells].map((c) => c.i + ',' + c.j),
    'occupiedCells 가 painted ∪ slot 순서와 다르다',
  );
});

test('통합 ④ 레이아웃별 mid 예외는 소스에서 사라졌다 — MID_TONE_LAYOUTS 참조 0', () => {
  // 정규화가 한 일의 절반은 «예외 표를 지운 것» 이다. 표가 슬그머니 돌아오면
  // 전 정본 0/2 단일 규칙이 다시 갈라진다.
  const srcDir = path.join(ROOT_DIR, 'src');
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (readFileSync(full, 'utf8').includes('MID_TONE_LAYOUTS')) hits.push(full);
    }
  };
  walk(srcDir);
  assert.deepEqual(hits, [], 'MID_TONE_LAYOUTS 참조가 되살아났다');
});

// ── 통합자 핀 (2026-08-16, 합성 의미 렌즈 관찰 8) — 정규화 정본 톤의 전 방향 보호 ──
// «전 정본 mid 금지» 는 mid(1) 방향의 되돌림만 막는다. 0↔2 방향으로 톤이 조용히
// 바뀌는 것은 public repo 안 어떤 테스트도 못 잡았다 (private 정본 JSON 을 여기서
// 읽을 수 없기 때문). 직렬화 해시 핀이 그 구멍을 막는다 — v0X 톤이 한 면이라도
// 바뀌면 여기가 빨개진다. 의도적 정본 개정 시에만 해시를 갱신할 것 (개정 근거 병기).
test('v0X 정본 톤 직렬화 핀 — 정규화본 (2026-08-16, agreement 195/195 기준)', async () => {
  const { createHash } = await import('node:crypto');
  const cells = locatorCellsCellSurfaceFinal(21, 'v0x');
  assert.equal(cells.length, 65);
  const digest = createHash('sha256').update(JSON.stringify(cells)).digest('hex');
  assert.equal(digest,
    '6940c7c6b03b4b81f83ce002081066e96a88fa5ae7f54492ea591fd92bb6a787',
    'v0X 정본 톤 직렬화가 바뀌었다 — 의도적 정본 개정이 아니면 되돌려라');
});

// ─────────────────────────────────────────────────────────────────────────
// v0W (운영자 신설 설계 2026-08-16) — 편입 회귀.
//
// 이 블록의 본론은 «정본이 손 전사가 아니다» 다. 정본 팩
// (`.agent/decoder/data/cellsurface-v0w-editor.json`, private repo)은 통합자 손
// 전사라 믿지 않고, 재검산(`test/output/lanes/claude-v0w-derive.mjs`)에서 세 블록이
// 전부 기존 정본에서 유도된다는 것을 확인했다 — 70/70 셀 완전 일치. 그래서 모듈은
// 팩을 전사하지 않고 필터·평행이동만 쓴다. 아래가 그 계보의 회귀다.
// ─────────────────────────────────────────────────────────────────────────

test('v0W 정본 계보 — NW=v1r2 NW 5×5 · NE=v0X SE 평행이동 · SE=v0 SE 3×3 평행이동', () => {
  const v0w = locatorCellsCellSurfaceFinal(21, 'v0w');
  assert.equal(v0w.length, 70, 'v0W 파인더가 70셀이 아니다');
  const key = (c) => c.i + ',' + c.j;
  const tone = (c) => [c.T, c.L, c.R].join('');

  // ① NW (0..4)² = v1r2 NW 5×5 와 셀·톤 완전 일치.
  //    (정본 팩은 (0,4).L 항목이 빠져 mid(1) 로 유도되는데 — v0X 최초 편입본과 같은
  //     직렬화 함정 — 나머지 두 면이 (2,2) 라 다수 톤 정규화가 결정적으로 2 를 준다.
  //     그 값이 v1r2 NW 의 (0,4)=(2,2,2) 와 같다는 것이 아래 일치의 일부다.)
  const v1r2 = new Map(locatorCellsCellSurfaceFinal(21, 'v1r2')
    .filter((c) => c.i <= 4 && c.j <= 4).map((c) => [key(c), tone(c)]));
  assert.equal(v1r2.size, 25);
  const nw = v0w.filter((c) => c.i <= V0W_BLOCKS.NW.iMax && c.j <= V0W_BLOCKS.NW.jMax);
  assert.equal(nw.length, 25, 'v0W NW 가 25셀이 아니다');
  for (const cell of nw) {
    assert.equal(tone(cell), v1r2.get(key(cell)), 'v0W NW ' + key(cell) + ' 이 v1r2 와 다르다');
  }

  // ② NE (0..5)×(15..20) = v0X SE (15..20)² 를 (i−15, j) 평행이동한 것 = v0xq CORNER.
  const v0xSe = new Map(locatorCellsCellSurfaceFinal(21, 'v0x')
    .filter((c) => c.i >= V0X_BLOCKS.SE.iMin && c.j >= V0X_BLOCKS.SE.jMin)
    .map((c) => [(c.i - 15) + ',' + c.j, tone(c)]));
  assert.equal(v0xSe.size, 36);
  const ne = v0w.filter((c) => c.i <= V0W_BLOCKS.NE.iMax && c.j >= V0W_BLOCKS.NE.jMin);
  assert.equal(ne.length, 36, 'v0W NE 가 36셀이 아니다');
  for (const cell of ne) {
    assert.equal(tone(cell), v0xSe.get(key(cell)), 'v0W NE ' + key(cell) + ' 이 v0X SE 와 다르다');
    assert.ok(cell.T === cell.L && cell.L === cell.R,
      'v0W NE ' + key(cell) + ' 이 3면 동일이 아니다 — 120° 쌍둥이 코어 서명의 전제');
  }
  // v0xq CORNER 와도 셀 단위로 같아야 한다 (같은 배열에서 유도되므로).
  const v0xqCorner = new Map(locatorCellsCellSurfaceFinal(21, 'v0xq')
    .filter((c) => c.i <= V0XQ_BLOCKS.CORNER.iMax && c.j >= V0XQ_BLOCKS.CORNER.jMin)
    .map((c) => [key(c), tone(c)]));
  assert.equal(v0xqCorner.size, 36);
  for (const cell of ne) assert.equal(tone(cell), v0xqCorner.get(key(cell)));

  // ③ SE (18..20)² = v0 정본 SE 3×3 을 (+8, +8) 평행이동한 것 (n 차 21−13).
  const v0Se = new Map(locatorCellsCellSurfaceFinal(13, 'v0')
    .filter((c) => c.i >= 10 && c.j >= 10)
    .map((c) => [(c.i + 8) + ',' + (c.j + 8), tone(c)]));
  assert.equal(v0Se.size, 9);
  const se = v0w.filter((c) => c.i >= V0W_BLOCKS.SE.iMin && c.j >= V0W_BLOCKS.SE.jMin);
  assert.equal(se.length, 9, 'v0W SE 가 9셀이 아니다');
  for (const cell of se) {
    assert.equal(tone(cell), v0Se.get(key(cell)), 'v0W SE ' + key(cell) + ' 이 v0 코너와 다르다');
  }
  // 위상 판별력의 유일한 원천 — T=L 이고 R 이 다른 셀이 실재해야 한다.
  // (NE 는 3면 동일이라 0, NW 는 네 레이아웃이 공유하므로 패밀리 판별에 못 쓴다.)
  assert.ok(se.some((c) => c.T === c.L && c.R !== c.T),
    'v0W SE 에 면 비대칭이 없다 — 120° 판별력 0');
  // 팩의 `_note` 는 「R면 반전」이라 적었지만 실측은 비트 반전이 **아니다** —
  // T·L 은 상단행+좌열 L자(밝음 5), R 은 중앙 1점(밝음 1)이다. 잰 쪽을 고정한다.
  const bright = (face) => se.filter((c) => c[face] === 2).length;
  assert.deepEqual(
    { T: bright('T'), L: bright('L'), R: bright('R') }, { T: 5, L: 5, R: 1 },
    'v0W SE 면별 밝은 셀 수가 잰 값과 다르다 — 「반전」이라는 서술이 아니라 v0 코너 정본이다',
  );

  // ④ 세 블록이 겹치지 않고 그 밖의 셀도 없다.
  assert.equal(nw.length + ne.length + se.length, v0w.length);
});

test('v0W 회계 — 441 − 70 − 12 − 18 = 341 · S=113 · 잔여 2 · 레거시 없음', () => {
  const surface = cellSurfaceFinal(21, 'v0w');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 70);
  assert.equal(surface.slotCount, 0, 'v0W 에 중앙 QR 슬롯이 생겼다');
  assert.equal(hasCenterQrSlot('v0w'), false);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.declaredDataCells, 341);
  assert.equal(surface.usedSymbols, 113);
  assert.equal(surface.residualCells, 2);
  // 슬롯이 없는 레이아웃은 점유 = painted **같은 참조**다 (편입 전 동작 불변).
  assert.equal(surface.occupiedCells, surface.paintedCells);
  assert.equal(nameCellSurfaceFinal(21, 2, 'v0w'), 'Y1-CS-V0W');
  assert.equal(nameCellSurfaceFinal(21, 3, 'v0w'), 'Y1T-CS-V0W');

  // 레거시(포맷 v1) 세대는 **없다** — v0xq 와 같이 포맷 v2 전환 이후 신설이라
  // v1 로 발행된 v0W 프레임이 세상에 없다.
  assert.equal(hasLegacyFormatWire('v0w'), false);
  assert.throws(() => cellSurfaceFinal(21, 'v0w', 1), RangeError);

  // ECC 3레벨 전부 인코더 정합 — 선언 dataBytes 가 청크 패커와 정확히 맞아야 한다.
  assert.deepEqual(
    ['L', 'M', 'H'].map((level) => capacityForCellSurfaceFinal(21, level, 2, 'v0w').maxPayloadBytes),
    [94, 80, 64],
  );
});

// ── v0W 파생 2종 (2026-08-16) ─────────────────────────────────────────────

test('v0WQ 정본 — 두 정본의 조합이고 손 좌표가 0 이다 (참조 동일성)', () => {
  // v0WQ = «v0W 의 위상 마커 × v0XQ 의 중앙». 그래서 이 테스트가 재는 것은 톤 표가
  // 아니라 **출처와의 동일성**이다 — 사본이면 출처가 시프트해도 안 터진다.
  const cells = locatorCellsCellSurfaceFinal(21, 'v0wq');
  assert.equal(cells.length, 45, 'v0WQ 파인더는 36 + 9 = 45 셀');

  const key = (list) => list
    .map((c) => [c.i, c.j, c.T, c.L, c.R].join(','))
    .sort()
    .join(' ');
  // ① NE 동심 사각 36 = v0XQ 의 CORNER 블록과 셀·톤이 완전히 같다.
  const mineCorner = cells.filter((c) =>
    c.i <= V0WQ_BLOCKS.CORNER.iMax && c.j >= V0WQ_BLOCKS.CORNER.jMin);
  const theirsCorner = locatorCellsCellSurfaceFinal(21, 'v0xq').filter((c) =>
    c.i <= V0XQ_BLOCKS.CORNER.iMax && c.j >= V0XQ_BLOCKS.CORNER.jMin);
  assert.equal(mineCorner.length, 36);
  assert.equal(key(mineCorner), key(theirsCorner), 'v0WQ 동심 사각이 v0XQ 와 다르다');

  // ② SE 위상 마커 9 = v0W 의 SE 블록과 셀·톤이 완전히 같다.
  const mineMarker = cells.filter((c) =>
    c.i >= V0WQ_BLOCKS.MARKER.iMin && c.j >= V0WQ_BLOCKS.MARKER.jMin);
  const theirsMarker = locatorCellsCellSurfaceFinal(21, 'v0w').filter((c) =>
    c.i >= V0W_BLOCKS.SE.iMin && c.j >= V0W_BLOCKS.SE.jMin);
  assert.equal(mineMarker.length, 9);
  assert.equal(key(mineMarker), key(theirsMarker), 'v0WQ 위상 마커가 v0W 와 다르다');

  // ③ 그리고 v0XQ 의 위상 마커(SW 6셀)와는 **달라야** 한다 — 그 차이가 두 레이아웃을
  //    가르는 유일한 셀 축이다. 같아지면 대조 실험 자체가 사라진다.
  const theirsSw = locatorCellsCellSurfaceFinal(21, 'v0xq').filter((c) =>
    c.i >= V0XQ_BLOCKS.MARKER.iMin && c.j <= V0XQ_BLOCKS.MARKER.jMax);
  assert.equal(theirsSw.length, 6);
  assert.notEqual(key(mineMarker), key(theirsSw));

  // ④ 파인더 = 두 블록 전부 (분류 밖 셀 0) · 슬롯과 겹치지 않는다.
  assert.equal(mineCorner.length + mineMarker.length, cells.length);
  for (const cell of cells) {
    assert.ok(!(cell.i <= V0WQ_BLOCKS.SLOT.iMax && cell.j <= V0WQ_BLOCKS.SLOT.jMax),
      `v0WQ 파인더 (${cell.i},${cell.j}) 가 슬롯 안이다`);
  }
});

test('v0WQ 회계 — 441 − 45 − 64(슬롯 8²) − 12 − 18 = 302 · S=100 · 잔여 2', () => {
  const surface = cellSurfaceFinal(21, 'v0wq');
  assert.equal(surface.locatorCount, 45);
  assert.equal(surface.slotCount, 64);
  assert.equal(surface.declaredDataCells, 302);
  assert.equal(surface.usedSymbols, 100);
  assert.equal(surface.residualCells, 2);
  assert.equal(surface.version, 1);
  assert.equal(surface.profile, 'cell-surface-v0wq');
  // 점유 = 파인더 ∪ 슬롯 (autoplace 입력). paintedCells 와 **갈라져야** 한다.
  assert.equal(surface.occupiedCells.length, 45 + 64);
  assert.notEqual(surface.occupiedCells, surface.paintedCells);
  // 레거시(포맷 v1) 세대는 없다 — v0xq · v0w 와 같은 신설 규칙.
  assert.equal(hasLegacyFormatWire('v0wq'), false);
  assert.throws(() => cellSurfaceFinal(21, 'v0wq', 1), RangeError);
  // n 은 21 뿐이다.
  assert.throws(() => cellSurfaceFinal(13, 'v0wq'), RangeError);
});

test('v0WQ 슬롯 8 은 인코더 정합이 정한 값이다 (autoplace 상한 9 안쪽)', () => {
  // 상한을 재는 것은 probe 하네스이고, 여기서는 **왜 9 가 아닌가**를 못 박는다:
  //   m=9 → data 285 → S=95 → ECC-H 예산 57심볼. base-211 청크 패커에 57 에 정확히
  //   맞는 바이트 수가 없다 (54 B → 56심볼 · 55 B → 58심볼). decode.finishProfile 이
  //   그 조합을 «현행 인코더가 생성할 수 없다» 로 거부한다 — 게이트는 그대로 두고
  //   슬롯을 내렸다.
  assert.equal(centerQrSlotCellsFor('v0wq'), 8);
  assert.equal(centerQrSlotCellsFor('v0xq'), 9);
  assert.equal(centerQrSlotCellsFor('v0w'), 0);
  assert.equal(centerQrSlotCellsFor('v0x'), 0);
  assert.equal(symbolCountForByteLength(54), 56);
  assert.equal(symbolCountForByteLength(55), 58);
  // 그리고 실제 값(8)에서는 세 레벨 전부 정합이다 — 자기검증 ⑤ 와 같은 자.
  for (const level of ['L', 'M', 'H']) {
    const capacity = capacityForCellSurfaceFinal(21, level, 2, 'v0wq');
    assert.equal(symbolCountForByteLength(capacity.dataBytes), capacity.dataSymbols,
      `v0wq ECC-${level} 가 인코더 정합을 깬다`);
  }
});

test('v0WQ 용량 — v0XQ 보다 payload 가 크다 (슬롯이 한 칸 작아서)', () => {
  const rows = ['L', 'M', 'H'].map((level) => [
    level,
    capacityForCellSurfaceFinal(21, level, 2, 'v0wq').dataBytes,
    capacityForCellSurfaceFinal(21, level, 2, 'v0xq').dataBytes,
  ]);
  assert.deepEqual(rows, [['L', 84, 81], ['M', 72, 68], ['H', 57, 55]]);
  // payload(= dataBytes − 헤더 1 B) 로도 같은 부호다: 83/71/56 대 80/67/54.
  assert.deepEqual(
    ['L', 'M', 'H'].map((level) => capacityForCellSurfaceFinal(21, level, 2, 'v0wq').maxPayloadBytes),
    [83, 71, 56],
  );
  assert.deepEqual(
    ['L', 'M', 'H'].map((level) => capacityForCellSurfaceFinal(21, level, 2, 'v0xq').maxPayloadBytes),
    [80, 67, 54],
  );
  // 그리고 슬롯 없는 v0W 보다는 작다 — 중앙 QR 의 값이 여기서 보인다.
  assert.ok(capacityForCellSurfaceFinal(21, 'M', 2, 'v0wq').dataBytes
    < capacityForCellSurfaceFinal(21, 'M', 2, 'v0w').dataBytes);
});

test('v0WY 는 **진짜 와이어 id** 다 — 먼 코너 슬롯 64셀 · 데이터 280 (재설계)', () => {
  // ⚠ **의도적 갱신 (2026-08-17 운영자 재설계).** 이 회귀는 원래 «부재» 를 재고
  // 있었다 — 「v0WY 가 id 를 얻으면 셀 집합이 같아 디코더가 구분할 근거가 0 이다」.
  // 그 문장은 **허공 마름모 v0WY** 에 대해 참이었고, 지금은 거짓이다:
  // QR 이 실루엣 안쪽 먼 코너 [13,20]² 로 들어오면서 64셀을 먹고, 위상 마커가
  // SE → SW 로 옮겨 갔다. 그래서 «구분할 근거» 가 실재한다 — 아래가 그 값들이다.
  // 근거·후보 비교: `cellSurfaceFinal.js` §CELL_SURFACE_FINAL_V0WY ·
  // `test/output/lanes/claude-v0wy-design.mjs`.
  //
  // **의도적 갱신 «v0W 계열 전체 드랍» (2026-08-17 v0T 편입 라운드)** — v0wy 는
  // 이제 **라인업 밖**이다 (드랍 — 차단·비삭제). 와이어·정본·회계는 전부 그대로라
  // 이 회귀의 나머지 단언은 한 값도 안 바뀐다. 라인업 단언 하나만 뒤집힌다.
  assert.ok(CELL_SURFACE_FINAL_IDS.includes('v0wy'));
  assert.ok(!finalLayoutIdsForN(21).includes('v0wy'),
    'v0wy 가 라인업에 있다 — 2026-08-17 v0W 계열 드랍이 풀렸다');
  assert.ok(CELL_SURFACE_FINAL_DROPPED_IDS.includes('v0wy'));
  assert.equal(isCellSurfaceFinalId('v0wy'), true);
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0wy, 'cell-surface-v0wy');

  const v0wy = cellSurfaceFinal(21, 'v0wy');
  assert.equal(v0wy.locatorCount, 67, '파인더 = K3 25 + 동심 사각 36 + SW 마커 6');
  assert.equal(v0wy.slotCount, 64, '슬롯 = 8×8 (운영자 스펙: v0WQ 와 동일 크기)');
  assert.equal(v0wy.declaredDataCells, 280, '441 − 67 − 64 − 12 − 18');
  assert.equal(v0wy.usedSymbols, 93);
  assert.equal(v0wy.residualCells, 1);
  assert.equal(hasCenterQrSlot('v0wy'), true);
  assert.equal(centerQrSlotCellsFor('v0wy'), centerQrSlotCellsFor('v0wq'),
    '운영자 스펙은 «v0WQ 슬롯과 동일 크기» 다');

  // 슬롯 자리 — **먼 코너**여야 한다. v0WQ 와 크기는 같고 자리가 다르다는 것이
  // 이 파생의 전부이므로, 둘을 나란히 잰다.
  const wyOrigin = centerQrSlotOriginFor('v0wy', 21);
  const wqOrigin = centerQrSlotOriginFor('v0wq', 21);
  assert.deepEqual({ ...wyOrigin }, { i: 13, j: 13 }, 'v0WY 슬롯 원점이 (n−m, n−m) 이 아니다');
  assert.deepEqual({ ...wqOrigin }, { i: 0, j: 0 }, 'v0WQ 슬롯 원점이 Y-심이 아니다');
  const slot = v0wy.slotCells;
  assert.ok(slot.every((c) => c.i >= 13 && c.i <= 20 && c.j >= 13 && c.j <= 20));
  assert.ok(slot.some((c) => c.i === 20 && c.j === 20), '슬롯이 먼 코너 셀 (20,20) 을 안 덮는다');

  // 배치 규약 — 앵커와 뒤집기가 렌더러·디코더의 **공유 정본**이다.
  assert.deepEqual({ ...centerQrSlotPlacementFor('v0wy') }, { anchor: 'far', flip: true });
  assert.deepEqual({ ...centerQrSlotPlacementFor('v0wq') }, { anchor: 'seam', flip: false });
  assert.equal(centerQrSlotPlacementFor('v0w'), null, '슬롯 없는 레이아웃에 배치 규약이 있다');

  // 뒤집기가 실제로 다른 3점을 낸다 — 이름만 «윈도 β 식» 이면 QR 다움 판별이
  // 엉뚱한 자리를 잰다 (모듈 로드 자기검증과 같은 명제를 밖에서 한 번 더).
  const key = (cores) => cores.map((c) => c.a.toFixed(6) + ':' + c.b.toFixed(6)).join(' ');
  assert.notEqual(key(centerQrFinderCoreCells(8, true)), key(centerQrFinderCoreCells(8, false)));
  assert.equal(centerQrFinderCoreCells(8, true).length, 3);

  // v0W 는 **안 바뀐다** — 편입은 형제를 건드리지 않는다.
  const v0w = cellSurfaceFinal(21, 'v0w');
  assert.equal(v0w.declaredDataCells, 341);
  assert.equal(v0w.slotCount, 0);
  assert.equal(hasCenterQrSlot('v0w'), false);
  assert.equal(centerQrSlotCellsFor('v0w'), 0);
});

// ── v0W 파생 ② — v0W2 (2026-08-17, 운영자 신설 설계) ───────────────────────
//
// 실기기 판정 라운드에서 v0W 가 진 두 자리를 정면으로 고친 물건이다:
//   ① SE 부 파인더 3×3 이 **실기기에서 아예 안 잡혔다** → 6×6 으로 키운다
//   ② 주 파인더가 다 잡힌 프레임에서도 인식이 다른 후보로 샜다 → NW·NE 를 3면
//      대칭으로 눕혀 **검출 전용**으로 돌리고, 120° 위상은 SE 하나가 전담한다
//
// 그래서 이 두 테스트가 재는 것은 «무늬가 예쁜가» 가 아니라 **설계 의도가 정본에
// 실제로 들어 있는가** 다 — 비대칭 셀이 전부 SE 안에 있는가, 그 수가 v0W 보다
// 많은가, 나머지 61셀이 손 표가 아니라 유도인가.

test('v0W2 정본 계보 — NW=K3 3면 대칭화 · NE=v0xq CORNER 공유 · SE=v0X SE 톤 + 독자 R', () => {
  const v0w2 = locatorCellsCellSurfaceFinal(21, 'v0w2');
  assert.equal(v0w2.length, 97, 'v0W2 파인더가 97셀이 아니다 (25 + 36 + 36)');
  const key = (c) => c.i + ',' + c.j;
  const tone = (c) => [c.T, c.L, c.R].join('');

  // ① NW (0..4)² = v1r2 NW 5×5(=K3 불스아이) 의 **3면 다수결 대칭화**.
  //    좌표는 그대로이고, 톤이 갈리는 셀은 «면마다 달랐던» 넷뿐이다.
  const k3 = new Map(locatorCellsCellSurfaceFinal(21, 'v1r2')
    .filter((c) => c.i <= 4 && c.j <= 4).map((c) => [key(c), c]));
  assert.equal(k3.size, 25);
  const nw = v0w2.filter((c) => c.i <= V0W2_BLOCKS.NW.iMax && c.j <= V0W2_BLOCKS.NW.jMax);
  assert.equal(nw.length, 25, 'v0W2 NW 가 25셀이 아니다');
  const flattened = [];
  for (const cell of nw) {
    const src = k3.get(key(cell));
    assert.ok(src, 'K3 에 없는 v0W2 NW 셀 ' + key(cell));
    assert.ok(cell.T === cell.L && cell.L === cell.R,
      'v0W2 NW ' + key(cell) + ' 이 3면 동일이 아니다 — 검출 전용 전제가 깨졌다');
    // 다수 톤: 세 면 중 둘 이상이 가진 값.
    const counts = new Map();
    for (const face of ['T', 'L', 'R']) counts.set(src[face], (counts.get(src[face]) || 0) + 1);
    let majority = null; let best = -1;
    for (const [t, c] of counts) if (c > best) { best = c; majority = t; }
    assert.equal(cell.T, majority, 'v0W2 NW ' + key(cell) + ' 이 다수 톤이 아니다');
    if (!(src.T === src.L && src.L === src.R)) flattened.push(key(cell));
  }
  // K3 의 면 비대칭은 정확히 네 자리다 — 그 넷만 눕는다 (나머지 21셀은 바이트 동일).
  assert.deepEqual(flattened, ['1,3', '2,3', '3,1', '3,2'],
    'K3 의 면 비대칭 자리가 잰 값과 다르다 — v1r2 NW 정본이 움직였다');

  // ② NE (0..5)×(15..20) = v0xq CORNER = v0W NE. 세 레이아웃이 **같은 배열**을 본다.
  const ne = v0w2.filter((c) => c.i <= V0W2_BLOCKS.NE.iMax && c.j >= V0W2_BLOCKS.NE.jMin);
  assert.equal(ne.length, 36, 'v0W2 NE 가 36셀이 아니다');
  const v0xqCorner = new Map(locatorCellsCellSurfaceFinal(21, 'v0xq')
    .filter((c) => c.i <= V0XQ_BLOCKS.CORNER.iMax && c.j >= V0XQ_BLOCKS.CORNER.jMin)
    .map((c) => [key(c), tone(c)]));
  const v0wNe = new Map(locatorCellsCellSurfaceFinal(21, 'v0w')
    .filter((c) => c.i <= V0W_BLOCKS.NE.iMax && c.j >= V0W_BLOCKS.NE.jMin)
    .map((c) => [key(c), tone(c)]));
  for (const cell of ne) {
    assert.equal(tone(cell), v0xqCorner.get(key(cell)), 'v0W2 NE ' + key(cell) + ' 이 v0xq CORNER 와 다르다');
    assert.equal(tone(cell), v0wNe.get(key(cell)), 'v0W2 NE ' + key(cell) + ' 이 v0W NE 와 다르다');
    assert.ok(cell.T === cell.L && cell.L === cell.R, 'v0W2 NE ' + key(cell) + ' 3면 동일 아님');
  }

  // ③ SE (15..20)² — T·L 은 **v0X SE 와 같은 좌표·같은 톤**, R 만 독자 무늬.
  const v0xSe = new Map(locatorCellsCellSurfaceFinal(21, 'v0x')
    .filter((c) => c.i >= V0X_BLOCKS.SE.iMin && c.j >= V0X_BLOCKS.SE.jMin)
    .map((c) => [key(c), c]));
  assert.equal(v0xSe.size, 36);
  const se = v0w2.filter((c) => c.i >= V0W2_BLOCKS.SE.iMin && c.j >= V0W2_BLOCKS.SE.jMin);
  assert.equal(se.length, 36, 'v0W2 SE 가 36셀이 아니다');
  let asymmetric = 0;
  for (const cell of se) {
    const src = v0xSe.get(key(cell));
    assert.ok(src, 'v0X SE 에 대응 셀이 없다: ' + key(cell));
    assert.equal(cell.T, src.T, 'v0W2 SE ' + key(cell) + ' 의 T 가 v0X SE 와 다르다');
    assert.equal(cell.L, src.T, 'v0W2 SE ' + key(cell) + ' 의 L 이 v0X SE 와 다르다');
    assert.ok(cell.R === 0 || cell.R === 2);
    if (cell.R !== cell.T) asymmetric += 1;
  }
  // **이 레이아웃의 위상 판별력 전부** — 22셀이고, v0W 의 10셀보다 두껍다.
  assert.equal(asymmetric, 22, 'v0W2 SE 의 면 비대칭이 22가 아니다 — 위상 판별력이 움직였다');
  // R 면 36값 (유일한 손 표) 을 좌표째 고정한다 — «밝은 6×6 − 어두운 3×3 창 −
  // 먼 코너 계단» 이라는 서술이 실제 값과 같은지 여기서 확인된다.
  const rRows = [];
  for (let i = 15; i <= 20; i += 1) {
    const row = [];
    for (let j = 15; j <= 20; j += 1) row.push(se.find((c) => c.i === i && c.j === j).R);
    rRows.push(row.join(''));
  }
  assert.deepEqual(rRows, ['222222', '200022', '200022', '200022', '222220', '222200'],
    'v0W2 SE 의 R 면이 정본 표와 다르다');

  // ④ 설계 의도 — 면 비대칭은 **전부 SE 안**이다 (NW·NE 는 검출 전용).
  assert.equal(nw.filter((c) => !(c.T === c.L && c.L === c.R)).length, 0);
  assert.equal(ne.filter((c) => !(c.T === c.L && c.L === c.R)).length, 0);
  assert.equal(v0w2.filter((c) => !(c.T === c.L && c.L === c.R)).length, 22);
  // ⑤ 세 블록이 겹치지 않고 그 밖의 셀도 없다.
  assert.equal(nw.length + ne.length + se.length, v0w2.length);
});

test('v0W2 회계 — 441 − 97 − 12 − 18 = 314 · S=104 · 잔여 2 · 레거시 없음', () => {
  const surface = cellSurfaceFinal(21, 'v0w2');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 97);
  assert.equal(surface.slotCount, 0, 'v0W2 에 중앙 QR 슬롯이 생겼다');
  assert.equal(hasCenterQrSlot('v0w2'), false);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.declaredDataCells, 314);
  assert.equal(surface.usedSymbols, 104);
  assert.equal(surface.residualCells, 2);
  // ⚠ 편집기 팩의 counts.data 도 314 다 — **우연이 아니라 같은 산술**(441 − 97 − 30)
  // 이고, 이 값의 근거는 팩이 아니라 autoplace 재산출이다
  // (`test/output/lanes/claude-v0w2-derive.mjs` §⑥ 이 두 경로가 같은 값을 냄을 실측).
  assert.equal(21 * 21 - surface.locatorCount - 12 - 18, surface.declaredDataCells);
  assert.equal(surface.occupiedCells, surface.paintedCells);
  assert.equal(nameCellSurfaceFinal(21, 2, 'v0w2'), 'Y1-CS-V0W2');
  assert.equal(nameCellSurfaceFinal(21, 3, 'v0w2'), 'Y1T-CS-V0W2');

  // 레거시(포맷 v1) 세대는 없다 — 포맷 v2 전환 이후 신설.
  assert.equal(hasLegacyFormatWire('v0w2'), false);
  assert.throws(() => cellSurfaceFinal(21, 'v0w2', 1), RangeError);

  // 용량 — 파인더가 27셀 더 크므로 v0W 보다 payload 가 작다. 그 대가로 margin 이
  // 0.0952 → 0.1512 로 두꺼워진다 (위 «방향 margin» 회귀가 그 값을 건다).
  assert.deepEqual(
    ['L', 'M', 'H'].map((level) => capacityForCellSurfaceFinal(21, level, 2, 'v0w2').maxPayloadBytes),
    [87, 73, 58],
  );
  assert.ok(capacityForCellSurfaceFinal(21, 'M', 2, 'v0w2').dataBytes
    < capacityForCellSurfaceFinal(21, 'M', 2, 'v0w').dataBytes,
  'v0W2 가 v0W 보다 데이터가 커졌다 — 파인더 27셀 증가와 모순이다');
});

// ═════════════════════════════════════════════════════════════════════════
// v0TRY 편입 (운영자 2026-08-18) — v0TR 의 **먼 코너 QR 파생**.
//
// 정의가 곧 유도다: `V0TR_CELLS` 에서 먼 코너 슬롯 박스 [n−m, n−1]² 를 필터로 뺀 것
// (m 은 **v0TY 의 상수를 재사용** — 새 상수 신설 0). 그래서 여기서 재는 것은
// «유도가 실제로 정본 배열을 물고 있는가» 와 «회계가 autoplace 재산출과 맞는가» 다.
// 유도·별칭 기전 자체는 위 §«n=21 활성 라인업 교차 수용» ①-c 가 잠근다.
// ═════════════════════════════════════════════════════════════════════════

test('v0TRY 회계 — 441 − 93 − 64(먼 코너 슬롯 8²) − 12 − 18 = 254 · S=84 · 잔여 2', () => {
  const surface = cellSurfaceFinal(21, 'v0try');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 93, 'v0TRY 파인더가 93(= v0TR 102 − SE 9)이 아니다');
  assert.equal(surface.slotCount, 64);
  assert.equal(hasCenterQrSlot('v0try'), true);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.declaredDataCells, 254);
  assert.equal(surface.usedSymbols, 84);
  // ⚠ **잔여 2** — 254 = 3×84 + 2. v0TY(잔여 0)와 갈리는 유일한 회계 항목이다.
  // 게이트가 아니라 회계 사실이라 그대로 선언한다 (v0w·v0wq·v0w2 도 잔여 2 다).
  assert.equal(surface.residualCells, 2);
  assert.equal(21 * 21 - surface.locatorCount - 64 - 12 - 18, surface.declaredDataCells);
  // 슬롯이 있으므로 점유 ≠ painted (autoplace 입력이 갈린다 — v0TY 와 같은 규약).
  assert.notEqual(surface.occupiedCells, surface.paintedCells,
    'v0TRY 는 슬롯이 있으므로 occupiedCells 가 paintedCells 와 같은 배열이면 안 된다');
  assert.equal(surface.occupiedCells.length, 93 + 64);
  assert.equal(nameCellSurfaceFinal(21, 2, 'v0try'), 'Y1-CS-V0TRY');
  assert.equal(nameCellSurfaceFinal(21, 3, 'v0try'), 'Y1T-CS-V0TRY');

  // payload 는 S 가 같으므로 v0TY 와 **한 바이트도 다르지 않다** (잔여만 다르다).
  for (const ecc of ['L', 'M', 'H']) {
    assert.equal(
      capacityForCellSurfaceFinal(21, ecc, 2, 'v0try').dataBytes,
      capacityForCellSurfaceFinal(21, ecc, 2, 'v0ty').dataBytes,
      'v0TRY 의 ECC-' + ecc + ' payload 가 v0TY 와 다르다 — S 가 같은데 갈렸다',
    );
  }
  // 그리고 기반(v0TR)보다는 작아야 한다 — 슬롯 64셀을 데이터에서 뺐기 때문이다.
  assert.ok(capacityForCellSurfaceFinal(21, 'M', 2, 'v0try').dataBytes
    < capacityForCellSurfaceFinal(21, 'M', 2, 'v0tr').dataBytes,
  'v0TRY 가 v0TR 보다 데이터가 커졌다 — 슬롯 64셀과 모순이다');
});

test('v0TRY 슬롯 규약 — v0TY 의 상수·앵커·뒤집기를 그대로 재사용한다 (신설 0)', () => {
  // 크기·원점·뒤집기 셋 다 v0TY 와 **같은 값**이어야 한다. 하나라도 손으로 다시
  // 적으면 v0TY 가 바뀔 때 조용히 갈린다 (v0WQ 슬롯 8 을 상수로 박다 깨진 전례).
  assert.equal(centerQrSlotCellsFor('v0try'), centerQrSlotCellsFor('v0ty'));
  assert.deepEqual(
    { ...centerQrSlotOriginFor('v0try', 21) },
    { ...centerQrSlotOriginFor('v0ty', 21) },
    'v0TRY 슬롯 원점이 v0TY 와 다르다',
  );
  assert.deepEqual(
    { ...centerQrSlotPlacementFor('v0try') },
    { ...centerQrSlotPlacementFor('v0ty') },
    'v0TRY 슬롯 배치(앵커·뒤집기)가 v0TY 와 다르다',
  );
  // 먼 코너 앵커의 정의 — (n−m, n−m) = (13,13).
  assert.deepEqual({ ...centerQrSlotOriginFor('v0try', 21) }, { i: 13, j: 13 });
  assert.equal(centerQrSlotPlacementFor('v0try').anchor, 'far');
  assert.equal(centerQrSlotPlacementFor('v0try').flip, true);
});
