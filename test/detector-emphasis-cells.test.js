/**
 * detector-emphasis-cells.test.js — 「검출기 강조」 **실체 확장**의 계약
 * (운영자 결정 ⑭ (B) · 2026-09-07 · PM/029B §27.14.1).
 *
 * (A) 는 UI 만 정직하게 만들었다. (B) 는 강조에 실체를 준다 — 대상 검출기를 고르면
 * 중앙 슬롯뿐 아니라 **바깥 코드 셀 전부**가 같은 팔레트 치환을 받는다:
 *   · 검출 셀(`entry.tones` — H · H2O · CO2 · H2CO3, 마커 발자국 안의 앵커)은
 *     `locator` 부터,
 *   · 페이로드 셀(앵커 · 레퍼런스 · 포맷 · 데이터 · 필러 · C 노치 림)은 `all` 에서.
 *
 * ⚠ **이 자는 «개선» 을 주장하지 않는다.** T-EMPH(028A)가 어느 집합에서도 개선을 못
 *   봤고 이 라운드도 못 봤다. 여기서 재는 것은 **무회귀**와 **정직함**뿐이다.
 *
 * 재는 것:
 *   ⓐ 전수 3자 대조 — **독립 프로브**(`palette.levels` 만 바꾼 두 팔레트에서 검출기
 *     자신의 그림이 움직이는가) ↔ 분류(applicability) ↔ 강조 렌더의 차이. 셋이 서로
 *     다른 출처라 «집합에 잘못 넣었다» 와 «분류와 배선이 갈렸다» 를 각각 잡는다.
 *     비대상 전수 × 3택은 셰이프 동일, 화법별 대표는 **래스터 바이트 동일**로 잠근다.
 *     옵션 부재 ≡ `'default'` 도 전수로 잰다.
 *     (2026-09-07 검토 F3·F4 수리 — 종전 ⓐ 는 양변이 한 상수에서 나오는 항진명제라
 *      비대상 renderKind 를 몰래 넣어도 5/5 초록이었다.)
 *   ⓑ 치환은 **팔레트 레벨 자리에서만** 일어나고 순위(레벨 인덱스)가 보존된다 —
 *     기하(셰이프 수·좌표)도 불변. = 포맷·용량·digit 순열 불변의 렌더 쪽 증거.
 *   ⓒ R1 왕복(`decodeFrontend`) — 대상 호스트 × 3택이 기준선과 같은 원문을 낸다.
 *   ⓓ `'default'` 는 옵션 부재와 **래스터 바이트 동일**(무회귀의 바닥).
 *   ⓔ `locator` 팔의 의미 — 바뀌는 바깥 셀이 정확히 `entry.tones` 셀이다. 브리프가
 *     이름 붙인 **C 노치 림**은 따로 한 번 더 잰다 (정본 함수가 없는 파생 집합이라
 *     넓은 단언 뒤에 숨기 쉽다).
 *   ⓕ 중앙 M7 — 페이로드가 없어 `locator ≡ all`(«해당 없음»)이고, 강조가 복호
 *     **답**을 안 바꾼다 (ppu 4점. 실패 «사유» 는 안 잰다 — 그 자리의 주석 참조).
 *   ⓖ `DETECTOR_EMPHASIS_RENDER_KINDS` 에 죽은 원소가 없고, 분류 네 갈래가 전수를 덮는다.
 *   ⓗ **화면 라벨이 주장하는 범위**를 행동으로 — 비대상 검출기를 고르면 마커가 있어도
 *     코드 전체가 안 바뀐다(g1026·g1027·g1028) · `locator` 는 검출기 밖 코너 심볼까지
 *     바꾼다(g1006) · `all` 은 데이터 셀까지 바꾼다(g1008). PM/028 §5.1 ③.
 *   ⓘ 중앙 v0 비컨 블록에서 두 팔이 갈린다 — 검토 F5(변이 N3)가 연 자리.
 *
 * 자가 **못 덮는 축**(정직성): 화면 픽셀의 인상 · 실사진(H/CO2/H2O 강조 실물 0장 —
 * 코퍼스 emph-20260829 는 A2/K2 × TL·y0 뿐) · 프리셋 3종 × ppu 격자(여기는 기본
 * 프리셋 · ppu 12 한 점. 격자 실측은 레인 보고서의 표).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK, h2co3IncludeVertexK } from '../src/encodeK.js';
import { FACES, facePolygon, neighbors } from '../src/hexgrid.js';
import { digitToRanks } from '../src/lehmer.js';
import { TYPE_C_MIN_RADIUS, notchCellsC } from '../src/notchC.js';
import { buildScene } from '../src/scene.js';
import { encodeY } from '../src/encodeY.js';
import { DEFAULT_FACE_GAINS, applyFaceGain, buildSceneY } from '../src/sceneY.js';
import { YFACES, moduleQuad } from '../src/ygrid.js';
import {
  hasCenterQrSlot, locatorCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import {
  LOCATOR_PROFILES_Y, isCellSurfaceLocatorProfileY,
} from '../src/locatorY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  CENTRAL_N7_EMPHASIS_MODES,
  DEFAULT_CENTRAL_N7_EMPHASIS,
  DETECTOR_EMPHASIS_RENDER_KINDS,
  centralN7EmphasisLevels,
  isDetectorToneCell,
} from '../src/centralN7Emphasis.js';
import {
  centralBeaconEncoderOptions, detectorEmphasisApplicability, sceneOptionsForOA,
} from '../src/generator-render-config.js';
import { FINDER_PATTERN_IDS } from '../src/finder-patterns.js';
import { OAK_ALL_FINDER_PATTERNS } from '../src/finder-oak-patterns.js';
import {
  DAEHAN_FINDER_PATTERN_IDS, daehanPatternId, isDaehanFinderPatternId,
} from '../src/finder-daehan.js';
import {
  OUT_OF_TABLE_FINDER_RENDER_KINDS, finderRenderKindOf,
} from '../src/finder-render-kind.js';
import { CENTER_QR_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { cornerMarkerSeatActive } from '../src/finder-zone-ui.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import { CENTRAL_MARKER_N7_FINDER_PATTERN_ID } from '../src/centralMarkerN7.js';
import { hTonesByKeyO } from '../src/finder-H.js';
import { h2oTonesByKeyA } from '../src/markerA.js';
import { h2co3TonesByKeyK } from '../src/markerK.js';
import { CO2_CELL_COUNT, co2TonesByKeyA } from '../src/finder-CO2.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const EMPHASIZED = centralN7EmphasisLevels(PRESET.levels);
const TEXT = 'TEMPH';

/** 판정이 답해야 하는 전수 — 손 목록이 아니라 렌더 표들의 합집합 (detector-emphasis-ui 와 같은 유도). */
const RENDER_REACHABLE_IDS = Object.freeze([...new Set([
  ...FINDER_PATTERN_IDS,
  ...OAK_ALL_FINDER_PATTERNS.map((pattern) => pattern.id),
  ...DAEHAN_FINDER_PATTERN_IDS,
  ...Object.keys(OUT_OF_TABLE_FINDER_RENDER_KINDS),
])]);

const rgbKey = (color) => `${color.r},${color.g},${color.b}`;
const LEVEL_KEYS = PRESET.levels.map(rgbKey);
const EMPHASIZED_KEYS = EMPHASIZED.map(rgbKey);

/**
 * **독립 출처 프로브용 팔레트** — `levels` 세 색만 다르고 배경·파인더 축 상수
 * (`bullseyeDark`·`bullseyeLight`·`background`)는 PALETTE 와 **같다**. 값 자체에는
 * 의미가 없다: 프리셋 어느 레벨과도 안 겹치기만 하면 된다.
 */
const PROBE_LEVELS = Object.freeze([
  Object.freeze({ r: 7, g: 11, b: 13 }),
  Object.freeze({ r: 101, g: 103, b: 107 }),
  Object.freeze({ r: 197, g: 199, b: 211 }),
]);
const PROBE_PALETTE = Object.freeze({ ...PALETTE, levels: PROBE_LEVELS });

/**
 * 이 검출기를 그리려면 인코더에 무엇이 필요한가 — **정본 술어에서 유도**한다.
 * 중앙 비컨 점유자는 `centralBeaconEncoderOptions`(정본), daehan 은
 * `isDaehanFinderPatternId`, 중앙 QR 은 id 하나. 손 표를 두지 않는다.
 */
function encodedFor(id) {
  if (isDaehanFinderPatternId(id)) {
    for (const version of [1, 2, 3]) {
      const encoded = encode(TEXT, { version, eccLevel: 'M', daehanFinder: true });
      if (daehanPatternId(encoded.k) === id) return encoded;
    }
    throw new Error('daehan 반경에 맞는 버전을 못 찾았다: ' + id);
  }
  if (id === CENTER_QR_FINDER_PATTERN_ID) {
    return encode(TEXT, { version: 2, eccLevel: 'M', centerQr: true });
  }
  return encode(TEXT, { version: 1, eccLevel: 'M', ...centralBeaconEncoderOptions(id, false) });
}

/** 그 검출기가 요구하는 scene 옵션(family 등)도 같은 자리에서 유도한다. */
function sceneOptionsFor(id, palette = PALETTE) {
  const opts = { palette, margin: 20, finderPatternId: id };
  if (id === CENTRAL_N7_FINDER_PATTERN_ID) opts.centralN7Family = 'hex';
  if (id === CENTRAL_MARKER_N7_FINDER_PATTERN_ID) opts.centralMarkerN7Family = 'hex';
  if (id === CENTER_QR_FINDER_PATTERN_ID) {
    opts.centerQr = true;
    opts.qrText = TEXT;
  }
  return opts;
}

function sceneOf(encoded, opts, emphasis) {
  return buildScene(encoded, emphasis === undefined
    ? opts : { ...opts, centralN7Emphasis: emphasis });
}

const colorsOf = (scene) => scene.shapes.map((shape) => rgbKey(shape.color));

/**
 * **독립 출처** — 이 검출기 «자신의 그림» 이 셀 팔레트(`palette.levels`) 축인가.
 *
 * 강조 상수(`DETECTOR_EMPHASIS_RENDER_KINDS`)도 판정 함수도 **한 번도 안 읽는다**:
 * `levels` 세 색만 바꾼 두 팔레트로 같은 코드를 그려, 셀 루프 몫을 좌표로 뺀 나머지
 * (= 검출기 자신의 셰이프)가 움직이는지만 본다. 배경·`bullseyeDark`·`bullseyeLight`
 * 는 두 팔레트가 같으므로, 파인더 축(BWG)이나 고정 큐브 톤으로 그리는 화법은 안
 * 움직이고 셀 팔레트로 그리는 화법만 움직인다.
 *
 * ⚠ **왜 이 프로브가 필요한가 (2026-09-07 검토 F3)**: 종전 ⓐ 는 «집합에 있다 ⟺ 'all'
 *   렌더가 다르다» 였는데 양변이 `DETECTOR_EMPHASIS_RENDER_KINDS` 하나에서 나오는
 *   **항진명제**였다 — 렌더 게이트도 판정도 같은 상수를 보므로, 비대상 renderKind 를
 *   몰래 넣으면 두 변이 같이 움직여 어긋남이 0 이었다 (실측 5/5 kind 초록). 강조가
 *   무엇을 바꿀 수 있는가는 «그 화법이 levels 를 읽는가» 이고, 그것은 강조를 한 번도
 *   안 켜고 잴 수 있다.
 */
const drawsFromLevelsMemo = new Map();
function detectorDrawsFromLevels(id) {
  if (drawsFromLevelsMemo.has(id)) return drawsFromLevelsMemo.get(id);
  const answer = measureDrawsFromLevels(id);
  drawsFromLevelsMemo.set(id, answer);
  return answer;
}

function measureDrawsFromLevels(id) {
  const encoded = encodedFor(id);
  const withPreset = buildScene(encoded, sceneOptionsFor(id, PALETTE));
  const withProbe = buildScene(encoded, sceneOptionsFor(id, PROBE_PALETTE));
  assert.equal(withProbe.shapes.length, withPreset.shapes.length,
    `${id}: 팔레트만 바꿨는데 셰이프 수가 달라졌다 — 프로브 전제가 깨졌다`);
  const outer = new Set([...outerCellFaceIndex(encoded, withPreset).values()]
    .map((hit) => hit.at));
  let detectorShapes = 0;
  let moved = 0;
  for (let i = 0; i < withPreset.shapes.length; i += 1) {
    if (outer.has(i)) continue;
    detectorShapes += 1;
    if (rgbKey(withPreset.shapes[i].color) !== rgbKey(withProbe.shapes[i].color)) moved += 1;
  }
  assert.ok(detectorShapes > 0,
    `${id}: 셀 루프를 빼니 셰이프가 하나도 안 남았다 — 프로브가 빈 비교다`);
  return moved > 0;
}

// ── ⓐ 분류와 렌더가 같은 답을 낸다 (전수 성질 · 독립 출처) ────────────────

test('ⓐ 셀 팔레트 축이다 ⟺ applies ⟺ 강조 렌더가 다르다 — 전수 3자 대조', { timeout: 300_000 }, () => {
  // 세 값이 **서로 다른 출처**에서 온다:
  //   ① `drawsFromLevels` — 강조를 한 번도 안 켜고 잰 팔레트 반응 (독립 프로브)
  //   ② `applies` — generator-render-config 의 분류 (상수 소비자 A)
  //   ③ `changed` — 실제 강조 렌더의 차이 (상수 소비자 B)
  // ①≠② 면 «집합에 잘못 넣었다/뺐다», ②≠③ 면 «분류와 배선이 갈렸다» 다.
  // 종전판은 ②·③ 둘만 봤고 그 둘은 같은 상수에서 나와 항진이었다 (검토 F3).
  let appliesSeen = 0;
  let inertSeen = 0;
  for (const id of RENDER_REACHABLE_IDS) {
    const encoded = encodedFor(id);
    const opts = sceneOptionsFor(id);
    /*
     * ⚠ **이 등식이 «검출기 자신» 을 재는 이유를 값으로 잠근다** (2026-09-07
     *   emph-centerqr). `changed` 는 **장면 전체**의 차분이라, 이 호스트 코드가 바깥
     *   마커 검출 셀을 싣고 있으면 비대상 검출기에서도 참이 된다 — 그러면 이 자는
     *   «검출기 자신» 이 아니라 «코드 어딘가» 를 재게 되고, 위 세 값의 등식이 우연히
     *   성립하던 것이 우연히 깨진다. 지금 성립하는 근거는 «이 호스트가 마커를 안
     *   싣는다» 이고, 그건 주석이 아니라 여기서 재야 하는 사실이다.
     */
    assert.equal([...encoded.cellDigits].filter(([, e]) => isDetectorToneCell(e)).length, 0,
      `${id}: 판정 호스트가 마커 검출 셀을 싣는다 — 이 자의 «검출기 자신» 전제가 깨졌다 `
      + '(마커 축은 ⓗ 가 따로 잰다)');
    const base = colorsOf(sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS));
    const all = colorsOf(sceneOf(encoded, opts, 'all'));
    const changed = all.join('|') !== base.join('|');
    const applies = detectorEmphasisApplicability(id).applies;
    const drawsFromLevels = detectorDrawsFromLevels(id);
    assert.equal(applies, drawsFromLevels,
      `${id}: 분류는 applies=${applies} 인데 이 화법의 검출기 그림은 `
      + `palette.levels 에 ${drawsFromLevels ? '반응한다' : '안 반응한다'} — 집합이 실제와 어긋난다`);
    assert.equal(changed, applies,
      `${id}: 분류는 applies=${applies} 인데 렌더 변화는 ${changed}`);
    if (changed) appliesSeen += 1; else inertSeen += 1;
  }
  assert.ok(appliesSeen >= 3, '대상 표본이 사라졌다 — 자가 빈 루프로 초록이 됐다');
  assert.ok(inertSeen >= 10, '비대상 표본이 사라졌다 — 한쪽만 재는 자가 됐다');
});

test('ⓐ 비대상 검출기는 3택 전부에서 **그림이 한 점도 안 바뀐다** — 전수 행동 앵커', { timeout: 300_000 }, () => {
  // ⚠ 이 자의 «비대상» 목록은 강조 상수가 아니라 **독립 프로브**에서 나온다
  //   (검토 F3·F4 — 목록을 상수에서 뽑으면 집합을 넓히는 순간 표본에서 빠져 나가
  //   자가 조용히 초록이 된다. N9b 가 그렇게 전 자를 통과했다).
  //   그래서 「집합에 bullseye 를 몰래 넣는다」 같은 잘못된 확장이 여기서 죽는다:
  //   프로브는 여전히 bullseye 를 비대상으로 세는데 렌더는 바뀌기 때문이다.
  let checked = 0;
  const kindsSeen = new Set();
  for (const id of RENDER_REACHABLE_IDS) {
    if (detectorDrawsFromLevels(id)) continue;
    const encoded = encodedFor(id);
    const opts = sceneOptionsFor(id);
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      const withMode = sceneOf(encoded, opts, mode);
      assert.deepEqual(withMode.shapes, base.shapes,
        `${id}/${mode}: 비대상 검출기인데 그림이 바뀐다 — 화면은 «강조를 안 건다» 고 말한다`);
    }
    checked += 1;
    kindsSeen.add(finderRenderKindOf(id));
  }
  assert.ok(checked >= 20, `비대상 표본이 ${checked} 로 줄었다 — 앵커가 빈 루프다`);
  assert.ok(kindsSeen.size >= 4,
    `비대상 renderKind 표본이 ${kindsSeen.size} 뿐이다 — 한 화법만 재고 있다`);
});

test('ⓐ 비대상 화법마다 **래스터 바이트**까지 동일 — 색 밖의 축', { timeout: 300_000 }, () => {
  // 위 자는 셰이프 배열을 재고, 여기는 화법마다 대표 1 id 를 실제로 래스터해서
  // «색이 아닌 것»(좌표·순서·덮임)까지 잰다. 종전엔 이 성질이 3톤 큐브 하나에만
  // 있었다 (`test/central-emphasis-roundtrip.test.js:42` — 검토 N10 이 그 사실을 실측).
  const byKind = new Map();
  for (const id of RENDER_REACHABLE_IDS) {
    if (detectorDrawsFromLevels(id)) continue;
    const kind = finderRenderKindOf(id);
    if (!byKind.has(kind)) byKind.set(kind, id);
  }
  assert.ok(byKind.size >= 4, `비대상 화법이 ${byKind.size} 뿐이다 — 대표 표본이 줄었다`);
  for (const id of byKind.values()) {
    const encoded = encodedFor(id);
    const opts = sceneOptionsFor(id);
    const base = rasterize(sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS),
      { pixelsPerUnit: 8, supersample: 1 });
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      const withMode = rasterize(sceneOf(encoded, opts, mode),
        { pixelsPerUnit: 8, supersample: 1 });
      assert.deepEqual(Buffer.from(withMode.pixels), Buffer.from(base.pixels),
        `${id}/${mode}: 비대상 검출기인데 래스터가 달라졌다`);
    }
  }
});

test('ⓐ 옵션 부재는 default 와 셰이프까지 동일 — 임베더 계약 (전수)', { timeout: 120_000 }, () => {
  for (const id of RENDER_REACHABLE_IDS) {
    const encoded = encodedFor(id);
    const opts = sceneOptionsFor(id);
    assert.deepEqual(
      colorsOf(sceneOf(encoded, opts, undefined)),
      colorsOf(sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS)),
      `${id}: 라이브러리 기본(옵션 부재)이 'default' 와 달라졌다`,
    );
  }
});

// ── 검출 셀 호스트 (마커 심볼) ───────────────────────────────────────────

/**
 * 검출 셀(`entry.tones`)을 실제로 싣는 호스트들.
 *
 * 인코더 옵션 조합은 자 쪽 재료라 여기 표로 둔다 — 다만 **공허하게 통과할 수 없도록**,
 * 각 행이 심볼 정본의 톤 표와 같은 셀 수를 내는지 아래 ⓔ 가 먼저 확인한다 (표가
 * 늙어 `cornerMarker` 를 잃으면 톤 셀 0 이 되고, 그러면 이 파일의 절반이 «아무것도
 * 안 바뀐다» 를 초록으로 통과시킬 것이다).
 */
const MARKER_HOSTS = Object.freeze([
  {
    label: 'O V1 + H (o-cm)',
    encoded: () => encode(TEXT, {
      version: 1, eccLevel: 'M', centralN7: true, cornerMarker: true, markerTones: true,
    }),
    // 중앙 슬롯을 **비운** 같은 코드 — 중앙 점유자는 하나뿐이라, 다른 검출기를 고른
    // 코드에 마커를 태우려면 이 판이 필요하다 (자 ⓗ 의 g1026·g1027·g1028 앵커).
    bareEncoded: () => encode(TEXT, {
      version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true,
    }),
    // ⭐ **중앙 QR × 마커 (2026-09-07 emph-centerqr)** — 운영자가 신고한 바로 그
    //   조합이다. 옛 주석은 「못 태운다」였는데 실측은 검출 톤 셀 12 였다.
    centerQrEncoded: () => encode(TEXT, {
      version: 2, eccLevel: 'M', centerQr: true, cornerMarker: true, markerTones: true,
    }),
    toneCount: (encoded) => hTonesByKeyO(encoded.k).size,
    toneCanon: (encoded) => hTonesByKeyO(encoded.k),
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    family: 'hex',
  },
  {
    label: 'A A1 + H2O (a-cm)',
    encoded: () => encodeA(TEXT, {
      version: 1, eccLevel: 'M', centralN7: true, cornerMarker: true,
    }),
    bareEncoded: () => encodeA(TEXT, { version: 1, eccLevel: 'M', cornerMarker: true }),
    centerQrEncoded: () => encodeA(TEXT, {
      version: 1, eccLevel: 'M', centerQr: true, cornerMarker: true,
    }),
    toneCount: (encoded) => h2oTonesByKeyA(encoded.k).size,
    toneCanon: (encoded) => h2oTonesByKeyA(encoded.k),
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    family: 'tri',
  },
  {
    label: 'V A1 턴A + CO2 (v-cm)',
    encoded: () => encodeA(TEXT, {
      version: 1, eccLevel: 'M', centralN7: true, turnA: true, cornerMarker: true,
    }),
    // ⚠ 중앙을 비우면 CO2 는 **꼭짓점 앵커 톤이 빠져** 9 → 6 이 된다 (검토 §2.3 경계).
    //   ⓗ 는 «0 이 아니다» 만 요구하므로 상관없다.
    bareEncoded: () => encodeA(TEXT, {
      version: 1, eccLevel: 'M', turnA: true, cornerMarker: true,
    }),
    centerQrEncoded: () => encodeA(TEXT, {
      version: 1, eccLevel: 'M', centerQr: true, turnA: true, cornerMarker: true,
    }),
    toneCount: () => CO2_CELL_COUNT,
    // ⚠ CO2 정본은 **canonical 좌표** 표다 (`co2TonesByKeyTurnA` 는 이미지 좌표라
    //   cellDigits 키와 안 맞는다 — 실측 확인). 렌더가 turnA 사상을 하고 인코더
    //   산출물은 canonical 이므로 여기서는 canonical 쪽을 쓴다.
    toneCanon: (encoded) => co2TonesByKeyA(encoded.k),
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    family: 'tri',
  },
  {
    label: 'K K1 + H2CO3 (k-cm)',
    encoded: () => encodeK(TEXT, {
      version: 1, eccLevel: 'M', centralN7: true, cornerMarker: true,
    }),
    bareEncoded: () => encodeK(TEXT, { version: 1, eccLevel: 'M', cornerMarker: true }),
    centerQrEncoded: () => encodeK(TEXT, {
      version: 1, eccLevel: 'M', centerQr: true, cornerMarker: true,
    }),
    toneCount: (encoded) => h2co3TonesByKeyK(encoded.k, {
      includeVertex: h2co3IncludeVertexK({ cornerMarker: true, centralV0: false }),
    }).size,
    toneCanon: (encoded) => h2co3TonesByKeyK(encoded.k, {
      includeVertex: h2co3IncludeVertexK({ cornerMarker: true, centralV0: false }),
    }),
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    family: 'star',
  },
]);

/** 검출 셀이 **없는** 호스트 — 앵커·레퍼런스·노치 림은 digit 알파벳이라 `all` 팔에서만 바뀐다. */
const PAYLOAD_ONLY_HOSTS = Object.freeze([
  {
    label: 'O V1 (앵커·레퍼런스만)',
    encoded: () => encode(TEXT, { version: 1, eccLevel: 'M', centralN7: true }),
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    family: 'hex',
  },
  {
    label: 'C0 노치 (림 = 데이터 셀)',
    encoded: () => encode(TEXT, { version: 0, eccLevel: 'M', notchC: true, centralN7: true }),
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    family: 'hex',
  },
  {
    label: 'O V1 중앙 v0 비컨',
    encoded: () => encode(TEXT, { version: 1, eccLevel: 'M', centralV0: true }),
    finderPatternId: 'central-v0',
    family: null,
  },
]);

const ALL_HOSTS = Object.freeze([...MARKER_HOSTS, ...PAYLOAD_ONLY_HOSTS]);

function hostSceneOptions(host) {
  const opts = { palette: PALETTE, margin: 20, finderPatternId: host.finderPatternId };
  if (host.family !== null && host.finderPatternId === CENTRAL_N7_FINDER_PATTERN_ID) {
    opts.centralN7Family = host.family;
  }
  return opts;
}

// ── ⓑ 치환 위치·순위·기하 ───────────────────────────────────────────────

test('ⓑ 치환은 팔레트 레벨 자리에서만 · 레벨 인덱스(순위) 보존 · 기하 불변', () => {
  for (const host of ALL_HOSTS) {
    const encoded = host.encoded();
    const opts = hostSceneOptions(host);
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      const withMode = sceneOf(encoded, opts, mode);
      // 기하 불변 — 셰이프 수·좌표가 같아야 «색만 바뀌었다» 가 성립한다.
      assert.equal(withMode.shapes.length, base.shapes.length, `${host.label}/${mode}: 셰이프 수`);
      assert.equal(withMode.width, base.width, `${host.label}/${mode}: 폭`);
      assert.equal(withMode.height, base.height, `${host.label}/${mode}: 높이`);
      assert.equal(withMode.k, base.k, `${host.label}/${mode}: k`);
      for (let i = 0; i < base.shapes.length; i += 1) {
        const from = rgbKey(base.shapes[i].color);
        const to = rgbKey(withMode.shapes[i].color);
        assert.deepEqual(withMode.shapes[i].points, base.shapes[i].points,
          `${host.label}/${mode}: 셰이프 ${i} 의 좌표가 움직였다`);
        if (from === to) continue;
        const level = LEVEL_KEYS.indexOf(from);
        assert.ok(level >= 0,
          `${host.label}/${mode}: 셰이프 ${i} 가 팔레트 레벨이 아닌 자리에서 바뀌었다 (${from} → ${to})`);
        // 같은 **인덱스**의 강조 색이어야 한다 = 순위 0<1<2 가 그대로다.
        assert.equal(to, EMPHASIZED_KEYS[level],
          `${host.label}/${mode}: 레벨 ${level} 이 다른 순위 색으로 갔다`);
      }
    }
  }
});

test('ⓑ 강조는 인코더 산출물을 안 건드린다 — 포맷·용량·digit 은 같은 객체다', () => {
  // 「순위 불변」의 상류 증거: 세 렌더가 **하나의 encoded** 를 공유하므로 digit·role·
  // 포맷 비트가 렌더 모드와 무관하다는 것이 구조적으로 성립한다. 그래도 buildScene 이
  // 입력을 변형하지 않는다는 것은 재야 한다 (조용한 변형은 다음 렌더에서만 보인다).
  for (const host of ALL_HOSTS) {
    const encoded = host.encoded();
    const before = JSON.stringify([...encoded.cellDigits]);
    const opts = hostSceneOptions(host);
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) sceneOf(encoded, opts, mode);
    assert.equal(JSON.stringify([...encoded.cellDigits]), before,
      `${host.label}: buildScene 이 cellDigits 를 변형했다`);
  }
});

// ── ⓒ R1 왕복 ───────────────────────────────────────────────────────────

test('ⓒ 대상 호스트 × 3택이 기준선과 같은 원문을 낸다 (합성 왕복)', { timeout: 300_000 }, () => {
  for (const host of ALL_HOSTS) {
    const encoded = host.encoded();
    const opts = hostSceneOptions(host);
    const base = decodeFrontend(rasterize(
      sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS), { pixelsPerUnit: 12, supersample: 1 },
    ));
    assert.equal(base.ok, true, `${host.label}: 기준선이 깨졌다 — ${base.reason}`);
    assert.equal(base.text, TEXT, `${host.label}: 기준선 원문이 다르다`);
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      const result = decodeFrontend(rasterize(
        sceneOf(encoded, opts, mode), { pixelsPerUnit: 12, supersample: 1 },
      ));
      assert.equal(result.ok, true, `${host.label}/${mode}: 왕복 실패 — ${result.reason}`);
      assert.equal(result.text, TEXT, `${host.label}/${mode}: 원문이 다르다`);
    }
  }
});

// ── ⓓ 무회귀 바닥 (래스터 바이트) ───────────────────────────────────────

test("ⓓ 'default' 는 옵션 부재와 래스터 바이트 동일", () => {
  for (const host of ALL_HOSTS) {
    const encoded = host.encoded();
    const opts = hostSceneOptions(host);
    const plain = rasterize(sceneOf(encoded, opts, undefined),
      { pixelsPerUnit: 8, supersample: 1 });
    const asDefault = rasterize(sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS),
      { pixelsPerUnit: 8, supersample: 1 });
    assert.deepEqual(Buffer.from(asDefault.pixels), Buffer.from(plain.pixels),
      `${host.label}: 'default' 가 옵션 부재와 다른 픽셀을 냈다`);
  }
});

// ── ⓔ locator 팔의 의미 ─────────────────────────────────────────────────

/**
 * 바깥 코드 셀의 면 → 셰이프 인덱스. **삽입 순서를 가정하지 않고 좌표로 찾는다** —
 * 셀 루프가 미는 폴리곤을 `facePolygon` 으로 다시 계산해 맞춘다 (`scene.layout` 이
 * 렌더가 쓴 바로 그 레이아웃이다). 그래서 이 자는 «중앙 슬롯의 몫» 과 «셀 루프의 몫»
 * 을 섞지 않는다.
 */
function outerCellFaceIndex(encoded, scene) {
  const pointsKey = (points) => points
    .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).join(';');
  const byPoints = new Map();
  scene.shapes.forEach((shape, index) => {
    // 폴리곤이 아닌 셰이프(원·사각 슬롯 덮개 등)는 points 가 없다 — 셀 면은 전부
    // 폴리곤이므로 건너뛴다.
    if (!Array.isArray(shape.points)) return;
    const key = pointsKey(shape.points);
    if (!byPoints.has(key)) byPoints.set(key, index);
  });
  const turnA = Boolean(encoded.turnA);
  const index = new Map();
  for (const [key, entry] of encoded.cellDigits) {
    const commaAt = key.indexOf(',');
    const q = Number(key.slice(0, commaAt));
    const r = Number(key.slice(commaAt + 1));
    for (const face of FACES) {
      const at = byPoints.get(pointsKey(
        facePolygon(turnA ? -q : q, turnA ? -r : r, face, scene.layout),
      ));
      assert.ok(at !== undefined, `셀 ${key} 면 ${face} 의 셰이프를 못 찾았다`);
      index.set(`${key}|${face}`, { at, entry });
    }
  }
  return index;
}

/**
 * 이 면이 소비해야 하는 **레벨 인덱스** — 렌더를 안 믿고 정본에서 직접 뽑는다.
 * 검출 셀이면 **심볼 정본의 절대 톤**, 아니면 `digitToRanks(digit)`
 * (= `scene.faceColor` 의 계약). 이 유도가 있어야 «기본 렌더가 이미 틀렸는데 차분만
 * 맞는» 상태를 잡을 수 있다.
 *
 * ⚠ `tones` 인자는 **심볼 정본 표**(hTonesByKeyO 등)에서 온다 — `entry.tones` 를
 *   그대로 받으면 인코더 산출물을 인코더 산출물로 재는 셈이다 (검토 F9).
 */
function faceLevel(entry, face, tones) {
  return tones ? tones[face] : digitToRanks(entry.digit)[face];
}

/** 밝은 레벨(2)은 강조가 보존한다 — 그래서 그 면은 색이 안 바뀐다. */
const faceShouldChange = (entry, face, tones) => faceLevel(entry, face, tones) !== 2;

test('ⓔ 바깥 코드: 세 모드 전부 검출 셀만 바꾸고 페이로드는 안 바꾼다 — 면 단위 전수', () => {
  for (const host of ALL_HOSTS) {
    const encoded = host.encoded();
    /*
     * **독립 출처** — «어느 셀이 검출 셀이고 그 절대 톤이 무엇인가» 를 구현 술어
     * (`isDetectorToneCell`)가 아니라 **심볼 정본 표**에서 받는다
     * (hTonesByKeyO · h2oTonesByKeyA · co2TonesByKeyA · h2co3TonesByKeyK).
     *
     * ⚠ 2026-09-07 검토 F9: 종전판은 팔 선택 축(«이 셀은 로케이터인가»)이 구현과
     *   같은 술어를 써서 자기참조였고, 실효 방어는 셀 **수** 대조 하나였다 — 수가
     *   우연히 보존되는 확장은 안 걸렸다. 지금은 **키 집합과 톤 값**까지 정본이 준다.
     */
    const canon = host.toneCanon ? host.toneCanon(encoded) : new Map();
    const carried = [...encoded.cellDigits]
      .filter(([, entry]) => isDetectorToneCell(entry)).map(([key]) => key);
    assert.deepEqual([...carried].sort(), [...canon.keys()].sort(),
      `${host.label}: 인코더가 실은 검출 셀 집합이 심볼 정본 표와 다르다`);
    const toneCells = canon.size;
    if (host.toneCount) {
      // 공허 통과 방지 — 호스트 표가 늙어 마커를 잃으면 여기서 먼저 죽는다.
      assert.ok(toneCells > 0, `${host.label}: 검출 톤 셀이 0 이다 — 호스트 표가 늙었다`);
      assert.equal(toneCells, host.toneCount(encoded),
        `${host.label}: 실린 톤 셀 수가 심볼 정본 표와 다르다`);
    } else {
      assert.equal(toneCells, 0,
        `${host.label}: 검출 톤 셀이 생겼다 — 호스트를 마커 표로 옮겨라`);
    }

    const opts = hostSceneOptions(host);
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    const locator = sceneOf(encoded, opts, 'locator');
    const all = sceneOf(encoded, opts, 'all');
    const faces = outerCellFaceIndex(encoded, base);

    let detectorFacesChanged = 0;
    let payloadFacesChanged = 0;
    let payloadFacesAtRisk = 0;
    for (const [label, { at, entry }] of faces) {
      const cut = label.indexOf('|');
      const cellKey = label.slice(0, cut);
      const face = label.slice(cut + 1);
      // 팔 선택도 기대 색도 **정본 표**에서 나온다 (구현 술어를 안 읽는다).
      const detector = canon.has(cellKey);
      const level = faceLevel(entry, face, canon.get(cellKey));
      // **절대 대조** — 차분이 아니라 값으로 잰다. 차분만 재면 세 모드가 **같이**
      // 틀린 경우(예: 레벨 표가 통째로 뒤집힌 렌더)가 조용히 통과한다.
      assert.equal(rgbKey(base.shapes[at].color), LEVEL_KEYS[level],
        `${host.label}: ${label} 의 기본 색이 palette.levels[${level}] 가 아니다`);
      assert.equal(rgbKey(locator.shapes[at].color),
        detector ? EMPHASIZED_KEYS[level] : LEVEL_KEYS[level],
        `${host.label}: ${label} 의 locator 색이 계약과 다르다`);
      // **`all` 도 검출 셀만** — 바깥 코드 표면에는 강조할 데이터 팔이 없다
      // (`detectorCellLevelPalettes`, 운영자 카드 `d-emph-b-default`).
      assert.equal(rgbKey(all.shapes[at].color),
        detector ? EMPHASIZED_KEYS[level] : LEVEL_KEYS[level],
        `${host.label}: ${label} 의 all 색이 계약과 다르다`);
      // 두 팔이 **바깥에서** 면 단위로 같다 — 두 모드의 차이는 중앙 슬롯에만 있다.
      assert.equal(rgbKey(all.shapes[at].color), rgbKey(locator.shapes[at].color),
        `${host.label}: ${label} 에서 locator 와 all 이 갈렸다 — 바깥은 같아야 한다`);

      const changedLocator = rgbKey(locator.shapes[at].color) !== rgbKey(base.shapes[at].color);
      const changedAll = rgbKey(all.shapes[at].color) !== rgbKey(base.shapes[at].color);
      const shouldChange = faceShouldChange(entry, face, canon.get(cellKey));
      // locator 팔: 검출 셀의 «밝지 않은» 면만.
      assert.equal(changedLocator, detector && shouldChange,
        `${host.label}: ${label} 의 locator 결과가 계약과 다르다`);
      // all 팔: **같다** (바깥에는 데이터 팔이 없다).
      assert.equal(changedAll, detector && shouldChange,
        `${host.label}: ${label} 의 all 결과가 계약과 다르다`);
      if (changedLocator) detectorFacesChanged += 1;
      if (changedAll && !detector) payloadFacesChanged += 1;
      // **공허 방지** — 「안 바뀐다」를 세려면 «바뀔 수 있었던» 면이 있어야 한다.
      // 강조가 보존하는 밝은 면(level 2)만 남은 코드에서는 0 == 0 이 무의미하다.
      if (!detector && shouldChange) payloadFacesAtRisk += 1;
    }
    // ⭐ **정정된 계약** (운영자 카드 `d-emph-b-default`, 2026-09-07): 종전 이 줄은
    //   `payloadFacesChanged > 0` 이었고, 그것이 «많이 열었지 맞게 열지 않았다» 를
    //   자로 굳히고 있었다. 자를 지우지 않고 **주장을 새 정책으로 바꾼다**.
    assert.equal(payloadFacesChanged, 0,
      `${host.label}: 바깥 페이로드 면이 ${payloadFacesChanged} 장 바뀌었다 — `
      + '강조는 검출기 셀만 바꿔야 한다');
    assert.ok(payloadFacesAtRisk > 0,
      `${host.label}: 강조가 바꿀 수 있었던 페이로드 면이 0 이다 — 위 단언이 공허하다`);
    assert.equal(detectorFacesChanged > 0, toneCells > 0,
      `${host.label}: locator 팔의 바깥 변화와 검출 셀 유무가 어긋난다`);
  }
});

test('ⓔ C 노치 림 — 이름 붙인 집합이 어떤 모드에서도 안 바뀐다', () => {
  // 「노치 림」은 정본 함수가 없고 **파생이 계약**이다 (028A §4 — notchCellsC 의
  // 이웃 ∩ cellDigits). 이름을 부른 집합이 위 격자 안에서 진짜로 걸리는지 따로 잰다 —
  // 안 그러면 «전부 안 바뀐다» 라는 넓은 단언 뒤에 숨어 이 집합만 새도 안 보인다.
  //
  // ⭐ **주장이 뒤집혔다 (2026-09-07, 운영자 카드 `d-emph-b-default`)**: (B) 판은
  //   「`all` 팔이 림을 치환한다」를 잠갔다. 림은 digit 알파벳으로 그려지는 **코드
  //   페이로드**이고, 운영자 판정은 「파인더만 강조」다. 그래서 이 자가 재는 성질이
  //   «치환된다» → «어떤 모드에서도 안 치환된다» 로 바뀌었다 (자를 지우지 않는다 —
  //   브리프 §8). 이 집합이 C 코드 면의 최대 덩어리라(실측 1184면) 새면 여기서 잡힌다.
  const encoded = encode(TEXT, { version: 0, eccLevel: 'M', notchC: true, centralN7: true });
  assert.ok(encoded.k >= TYPE_C_MIN_RADIUS, '노치 호스트의 k 가 최소 반경 미만이다');
  const notch = new Set(notchCellsC(encoded.k).map((cell) => `${cell.q},${cell.r}`));
  assert.ok(notch.size > 0, '노치 셀이 0 이다 — 호스트가 평 C 가 아니다');
  const rim = new Set();
  for (const key of notch) {
    const [q, r] = key.split(',').map(Number);
    for (const near of neighbors(q, r)) {
      const nearKey = `${near.q},${near.r}`;
      if (encoded.cellDigits.has(nearKey)) rim.add(nearKey);
    }
  }
  assert.ok(rim.size > 0, '노치 림이 비었다 — 파생이 깨졌다');

  const opts = { palette: PALETTE, margin: 20, finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID, centralN7Family: 'hex' };
  const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
  const all = sceneOf(encoded, opts, 'all');
  const locator = sceneOf(encoded, opts, 'locator');
  const faces = outerCellFaceIndex(encoded, base);
  let rimFacesAtRisk = 0;
  for (const key of rim) {
    for (const face of FACES) {
      const { at, entry } = faces.get(`${key}|${face}`);
      assert.equal(rgbKey(all.shapes[at].color), rgbKey(base.shapes[at].color),
        `노치 림 ${key} 면 ${face}: 림은 코드 페이로드인데 all 팔이 바꿨다`);
      assert.equal(rgbKey(locator.shapes[at].color), rgbKey(base.shapes[at].color),
        `노치 림 ${key} 면 ${face}: 림은 digit 알파벳이라 locator 팔에서 안 바뀌어야 한다`);
      // 공허 방지 — 강조가 «바꿀 수 있었던» 면(밝지 않은 면)이 실제로 있어야 한다.
      if (faceShouldChange(entry, face)) rimFacesAtRisk += 1;
    }
  }
  assert.ok(rimFacesAtRisk >= 2 * rim.size,
    `노치 림에서 강조가 바꿀 수 있었던 면이 너무 적다 (${rimFacesAtRisk}) — `
    + '순열 셀은 셀당 2면이 위험 면이다. 이 수가 0 이면 위 단언이 공허하다');
});

// ── ⓗ 화면 라벨이 «주장하는 범위» 를 행동으로 잰다 ────────────────────────
//
// PM/028 §5.1 ③ — 「UI 라벨은 실제 대상 범위와 일치할 때만」. 문구 자체는 철자라
// 자로 굳히지 않는다(문구가 바뀌면 자가 정답을 거부한다). 대신 **문구가 주장하는
// 사실**을 행동으로 재 둔다: 사실이 바뀌면 여기가 빨개지고, 그때 사람이 문구를 다시
// 읽게 된다 (2026-09-07 검토 F1·F2 — 라벨 스윕이 절반만 됐던 이유가 이 자의 부재다).

test('ⓗ g1026·g1027·g1028: 비대상 검출기는 **자신만** 안 바뀌고, 마커 검출 셀은 강조된다', () => {
  /*
   * ⭐ **주장이 뒤집혔다 (2026-09-07 emph-centerqr · 운영자 실기 20:1x)** — 자를
   *   지우지 않고 **성질**을 바꾼다 (emph-c 전례).
   *
   *   옛 주장: 「비대상 검출기를 고르면 마커가 있어도 **코드 전체**가 안 바뀐다」.
   *   그것이 운영자가 신고한 결함 자체였다 — 「O/A/K에서 중앙 QR일 때는 적용이
   *   안되던데」. 이 자는 그 결함을 **게이트로 굳히고** 있었다 (교훈 «레인은 내
   *   잘못된 지시를 자로 굳힌다»).
   *
   *   새 주장 (두 갈래를 따로 잰다):
   *     ① 검출기 **자신의 셰이프**는 3택 전부에서 한 점도 안 바뀐다 — 사유 문구
   *        (g1026·g1027·g1028 «이 검출기 자신에는 강조를 안 걸어요»)가 여전히 참이다.
   *     ② 그 코드의 **바깥 마커 검출 셀**은 강조된다 — 범위 문구(g1038)가 참이다.
   *   ①만 재면 옛 결함이 돌아와도 초록이고, ②만 재면 사유 문구가 거짓이 돼도 초록이다.
   *
   * ⚠ **중앙 QR 이 표본에 들어왔다.** 옛 주석은 「중앙 QR 은 자기 전용 인코더
   *   옵션(centerQr)이 필요해 마커 호스트에 못 태운다」였는데, 실측하니 «못 한다» 가
   *   아니라 «그때 안 했다» 였다 (O/A/V/K 전부 centerQr × cornerMarker 가 인코드·렌더
   *   된다 — 검출 톤 셀 12·21·6·30). 운영자가 본 자리가 바로 그 조합이라, 그 조합이
   *   표본에서 빠져 있던 것이 이 결함이 안 보인 이유의 절반이다.
   */
  const inertIds = RENDER_REACHABLE_IDS.filter((id) => !detectorDrawsFromLevels(id));
  const byKind = new Map();
  for (const id of inertIds) {
    const kind = finderRenderKindOf(id);
    if (!byKind.has(kind)) byKind.set(kind, id);
  }
  assert.ok(byKind.size >= 3, `비대상 화법 표본이 ${byKind.size} 뿐이다`);
  assert.ok([...byKind.values()].includes(CENTER_QR_FINDER_PATTERN_ID)
    || byKind.has('center-qr'),
  '중앙 QR 이 비대상 표본에서 빠졌다 — 운영자가 신고한 바로 그 자리다');
  let centralAnchors = 0;
  let markerAnchors = 0;
  for (const host of MARKER_HOSTS) {
    for (const id of byKind.values()) {
      // 중앙 점유자는 하나뿐이라, 다른 검출기를 고르려면 중앙 슬롯을 비운 판이
      // 필요하다 (buildScene 이 RangeError 로 거절한다). 중앙 QR 은 자기 옵션을
      // 켠 판이 따로 있다.
      const centerQr = id === CENTER_QR_FINDER_PATTERN_ID;
      const encoded = centerQr ? host.centerQrEncoded() : host.bareEncoded();
      const canon = host.toneCanon(encoded);
      const toneKeys = [...encoded.cellDigits]
        .filter(([, entry]) => isDetectorToneCell(entry)).map(([key]) => key);
      assert.ok(toneKeys.length > 0,
        `${host.label} × ${id}: 마커 검출 셀이 0 이 됐다 — 공허 통과다`);
      for (const key of toneKeys) {
        assert.ok(canon.has(key), `${host.label}: 검출 셀 ${key} 가 심볼 정본 표 밖이다`);
      }
      const opts = { palette: PALETTE, margin: 20, finderPatternId: id };
      if (centerQr) {
        opts.centerQr = true;
        opts.qrText = TEXT;
      }
      const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
      const faces = outerCellFaceIndex(encoded, base);
      const outerAt = new Set([...faces.values()].map((hit) => hit.at));
      for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
        const withMode = sceneOf(encoded, opts, mode);
        // ① 검출기 자신 — 셀 루프 몫을 좌표로 뺀 나머지가 한 점도 안 바뀐다.
        for (let i = 0; i < base.shapes.length; i += 1) {
          if (outerAt.has(i)) continue;
          assert.deepEqual(withMode.shapes[i], base.shapes[i],
            `${host.label} × ${id}/${mode}: 화면은 «이 검출기 자신에는 강조를 안 건다» 고 `
            + '말하는데 검출기 셰이프가 달라졌다 — 사유 문구가 거짓이 된다');
        }
        centralAnchors += 1;
        if (mode === DEFAULT_CENTRAL_N7_EMPHASIS) continue;
        // ② 바깥 마커 검출 셀 — 실제로 강조된다. 「바뀔 수 있었던 면」(밝은 레벨이
        //    아닌 면)이 실재해야 이 단언이 공허하지 않다.
        //    ⚠ 톤 **값**은 심볼 정본 표(canon)가 주고, «이 판이 실제로 실은 셀» 은
        //      위에서 canon 의 부분집합임을 확인한 `toneKeys` 다. 둘을 가르는 이유는
        //      CO2 다 — 중앙을 비우면 꼭짓점 앵커 톤이 빠져 정본 9 셀 중 6 만 실린다
        //      (MARKER_HOSTS 의 그 주석). canon 전수로 세면 안 실린 3 셀이 «안
        //      바뀌었다» 로 잡혀 자가 정답을 거부한다.
        const carriedTones = new Map(toneKeys.map((key) => [key, canon.get(key)]));
        let detectorFacesChanged = 0;
        let detectorFacesAtRisk = 0;
        for (const [label, { at, entry }] of faces) {
          const cellKey = label.slice(0, label.indexOf('|'));
          if (!carriedTones.has(cellKey)) continue;
          const face = label.slice(label.indexOf('|') + 1);
          if (faceShouldChange(entry, face, carriedTones.get(cellKey))) {
            detectorFacesAtRisk += 1;
          }
          if (rgbKey(withMode.shapes[at].color) !== rgbKey(base.shapes[at].color)) {
            detectorFacesChanged += 1;
          }
        }
        assert.ok(detectorFacesAtRisk > 0,
          `${host.label} × ${id}/${mode}: 강조가 바꿀 수 있었던 검출 면이 0 이다 — 공허하다`);
        assert.equal(detectorFacesChanged, detectorFacesAtRisk,
          `${host.label} × ${id}/${mode}: 마커 검출 면 ${detectorFacesAtRisk} 중 `
          + `${detectorFacesChanged} 만 강조됐다 — 범위 문구(g1038)가 거짓이 된다`);
        markerAnchors += 1;
      }
    }
  }
  assert.ok(centralAnchors >= 12 && markerAnchors >= 8,
    `앵커 표본이 줄었다 (중앙 ${centralAnchors} · 마커 ${markerAnchors})`);
});

test('ⓗ g1006: locator 팔은 **검출기 밖**(코너 심볼) 셀도 바꾼다', () => {
  // 「검출기 안 로케이터 셀만」이라는 옛 문구가 (B) 뒤 거짓이 된 자리다 — 지금 문구는
  // 자리를 안 말하고 «레이아웃이 톤을 고정한 검출 셀» 이라는 성질로 말한다.
  // 그 성질이 실제로 바깥까지 닿는지를 여기서 잰다 (닿지 않게 되면 문구를 되돌려야 한다).
  for (const host of MARKER_HOSTS) {
    const encoded = host.encoded();
    const canon = host.toneCanon(encoded);
    const opts = hostSceneOptions(host);
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    const locator = sceneOf(encoded, opts, 'locator');
    const faces = outerCellFaceIndex(encoded, base);
    let outerDetectorChanged = 0;
    for (const [label, { at }] of faces) {
      if (!canon.has(label.slice(0, label.indexOf('|')))) continue;
      if (rgbKey(locator.shapes[at].color) !== rgbKey(base.shapes[at].color)) {
        outerDetectorChanged += 1;
      }
    }
    assert.ok(outerDetectorChanged > 0,
      `${host.label}: locator 팔이 바깥 검출 셀을 한 면도 안 바꿨다 — `
      + 'g1006 을 «검출기 안» 으로 되돌려야 하는 상태다');
  }
});

test('ⓗ g1008: all 팔은 **검출기 안 데이터 셀까지** 바꾸고 코드는 안 바꾼다', () => {
  /*
   * 「검출기 셀과 **검출기 안** 데이터 셀까지」라는 문구의 뒷부분 — 그리고
   * `locator` 와 `all` 을 가르는 **유일한** 자리다.
   *
   * ⭐ **주장이 좁아졌다 (2026-09-07, 운영자 카드 `d-emph-b-default`)**: (B) 판은
   *   「all 이 바깥 코드 데이터 셀을 바꾼다」를 잠갔고, 그게 곧 «모든 코드 영역이
   *   강조됨» 이었다. 지금 재는 성질은 두 개다 —
   *     ① 바깥 코드 페이로드는 `all` 에서도 **한 면도** 안 바뀐다(= 자 ①, ⓔ 와 이중),
   *     ② 그래도 `all` 은 `locator` 보다 **더** 바꾼다 — 그 차이는 전부 검출기 자신의
   *        슬롯 안이다(중앙 TL 데이터 19셀 · 중앙 v0 비컨 데이터 셀). 이 ②가 없으면
   *        두 모드가 완전히 같아져 모드 집합을 줄여야 한다는 뜻이 된다.
   */
  for (const host of ALL_HOSTS) {
    const encoded = host.encoded();
    const canon = host.toneCanon ? host.toneCanon(encoded) : new Map();
    const opts = hostSceneOptions(host);
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    const all = sceneOf(encoded, opts, 'all');
    const locator = sceneOf(encoded, opts, 'locator');
    const outer = outerCellFaceIndex(encoded, base);
    let payloadChanged = 0;
    for (const [label, { at }] of outer) {
      if (canon.has(label.slice(0, label.indexOf('|')))) continue;
      if (rgbKey(all.shapes[at].color) !== rgbKey(base.shapes[at].color)) payloadChanged += 1;
    }
    assert.equal(payloadChanged, 0,
      `${host.label}: all 팔이 바깥 코드 데이터 셀을 ${payloadChanged} 면 바꿨다 — `
      + 'g1008 이 «코드 전체» 로 되돌아간 상태다');

    // ② 검출기 자신(슬롯) 안에서는 all 이 locator 를 **진짜로** 넘어선다.
    const outerAt = new Set([...outer.values()].map((hit) => hit.at));
    let slotOnlyInAll = 0;
    for (let i = 0; i < base.shapes.length; i += 1) {
      if (outerAt.has(i)) continue;
      if (rgbKey(all.shapes[i].color) !== rgbKey(locator.shapes[i].color)) slotOnlyInAll += 1;
    }
    assert.ok(slotOnlyInAll > 0,
      `${host.label}: all 과 locator 가 검출기 안에서도 같아졌다 — `
      + '두 모드의 차이가 사라졌다(모드 집합 재검토가 필요한 상태다)');
  }
});

// ── ⓕ 중앙 M7 — 로케이터/데이터 구분이 없는 검출기 ──────────────────────

test('ⓕ 중앙 M7: 검출기 자신의 그림은 locator ≡ all («해당 없음»)', () => {
  // ⚠ 장면 전체를 비교하면 **바깥 코드 셀** 때문에 두 팔이 당연히 갈린다 (all 이
  //   페이로드까지 먹으므로). 재려는 것은 «이 검출기 자신» 이므로 셀 루프의 몫을
  //   좌표로 빼고 본다 — 그 나머지가 중앙 슬롯(마커 49셀 · 슬롯 덮개 · 심)이다.
  const encoded = encode(TEXT, { version: 1, eccLevel: 'M' });
  const opts = sceneOptionsFor(CENTRAL_MARKER_N7_FINDER_PATTERN_ID);
  const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
  const cellShapes = new Set([...outerCellFaceIndex(encoded, base).values()]
    .map((entry) => entry.at));
  const detectorColors = (scene) => scene.shapes
    .filter((shape, index) => !cellShapes.has(index)).map((shape) => rgbKey(shape.color));
  const baseColors = detectorColors(base);
  const locatorColors = detectorColors(sceneOf(encoded, opts, 'locator'));
  const allColors = detectorColors(sceneOf(encoded, opts, 'all'));
  assert.ok(baseColors.length > 0, '중앙 슬롯 셰이프가 하나도 안 남았다 — 자가 빈 비교다');
  assert.notDeepEqual(locatorColors, baseColors,
    '중앙 M7 이 강조를 안 소비한다 — 배선이 빠졌다');
  assert.deepEqual(locatorColors, allColors,
    '중앙 M7 의 두 팔이 갈렸다 — 이 검출기엔 페이로드 셀이 없어 같은 그림이어야 한다');
});

test('ⓕ 중앙 M7: 강조가 복호 **답**을 바꾸지 않는다 — ppu 4점 (무회귀)', { timeout: 300_000 }, () => {
  // ⚠ 여기서 «왕복이 성공한다» 를 단언하지 않는다. 중앙 M7 은 실사진 0/30 으로
  //   2026-08-28 드랍된 후보이고, **합성 기준선부터** R1 이 못 읽는다 (실측
  //   2026-09-07: ppu 10/12/16/24 전부 `frontend:no-format-candidate`). 그 결함을
  //   자로 굳히지 않으려고, 재는 것은 «강조가 그 답을 바꾸는가» 하나다 —
  //   M7 검출이 언젠가 서면 이 자는 그대로 초록으로 남는다.
  //
  // ⚠ **이 자가 안 재는 축을 이름 붙여 둔다 (2026-09-07 검토 F8)**: «답» 은
  //   `ok` + 원문이고, **실패 «사유» 는 안 본다.** 실측상 사유는 한 칸에서 갈린다 —
  //   ppu 24 의 `all` 만 `frontend:no-format-candidate` → `frontend:no-finder` 로
  //   바뀐다(= 순검정 dark 가 실루엣을 먹는 그 기전). 그 축의 방어는 여기가 아니라
  //   `test/central-n7-dark-ground.test.js` 다 — 어두운/순검정/흰 지면 × ppu 4점 ×
  //   `centralN7Emphasis:'all'` 을 끝단 복호로 잰다. 사유를 여기서 단언하면 지금의
  //   결함 배치를 자로 굳히게 되므로 안 한다.
  //   종전판은 **ppu 12 한 점**만 봤다 — 점 하나는 계약이 아니라서 4점으로 넓혔다.
  const encoded = encode(TEXT, { version: 1, eccLevel: 'M' });
  const opts = sceneOptionsFor(CENTRAL_MARKER_N7_FINDER_PATTERN_ID);
  const answerOf = (mode, pixelsPerUnit) => {
    const result = decodeFrontend(rasterize(
      sceneOf(encoded, opts, mode), { pixelsPerUnit, supersample: 1 },
    ));
    return result.ok ? 'ok:' + result.text : 'fail';
  };
  for (const pixelsPerUnit of [10, 12, 16, 24]) {
    const base = answerOf(DEFAULT_CENTRAL_N7_EMPHASIS, pixelsPerUnit);
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      assert.equal(answerOf(mode, pixelsPerUnit), base,
        `중앙 M7/${mode}/ppu ${pixelsPerUnit}: 강조가 복호 답을 바꿨다`);
    }
  }
});

// ── ⓘ 중앙 v0 비컨 — 두 팔이 여기서도 갈린다 ────────────────────────────

test('ⓘ 중앙 v0 비컨 블록: locator 는 tones 블록만, all 은 비컨 데이터까지', () => {
  /*
   * ⚠ **왜 이 자가 있나 (2026-09-07 검토 F5, 변이 N3)**: 비컨 분기는 셀 루프와 별개로
   *   `entry.tones` 삼항의 **사본**을 들고 있었고, 그 사본의 로케이터 팔을 데이터 팔로
   *   갈아치워도(= «로케이터만» 이 비컨 블록에서 아무것도 안 하게 됨) 형제 7파일까지
   *   전부 초록이었다. 사본은 이 라운드에서 걷었고(scene.js 가 `emphasisLevelsForCell`
   *   을 부른다), 그 배선이 다시 끊기는 것을 여기서 잡는다.
   *
   *   ⓔ 는 **바깥 셀**만 보고, ⓕ 는 페이로드가 없는 검출기(M7)를 본다 — 중앙 슬롯
   *   **안**에서 두 팔이 갈리는 검출기는 중앙 v0 하나뿐이라 자리가 비어 있었다.
   */
  const encoded = encode(TEXT, { version: 1, eccLevel: 'M', centralV0: true });
  const opts = { palette: PALETTE, margin: 20, finderPatternId: 'central-v0' };
  const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
  const cellShapes = new Set([...outerCellFaceIndex(encoded, base).values()]
    .map((hit) => hit.at));
  const detectorColors = (scene) => scene.shapes
    .filter((shape, index) => !cellShapes.has(index)).map((shape) => rgbKey(shape.color));
  const baseColors = detectorColors(base);
  const locatorColors = detectorColors(sceneOf(encoded, opts, 'locator'));
  const allColors = detectorColors(sceneOf(encoded, opts, 'all'));
  assert.ok(baseColors.length > 0, '중앙 슬롯 셰이프가 하나도 안 남았다 — 자가 빈 비교다');
  assert.notDeepEqual(locatorColors, baseColors,
    'locator 팔이 비컨 로케이터 블록을 안 바꾼다 — 팔 선택 배선이 끊겼다');
  assert.notDeepEqual(allColors, locatorColors,
    'all 팔이 비컨 **데이터** 셀을 안 바꾼다 — 두 팔이 여기선 같아졌다');
  // 방향까지: locator 가 바꾼 면은 all 도 전부 바꿔야 한다 (팔은 포함 관계다).
  for (let i = 0; i < baseColors.length; i += 1) {
    if (locatorColors[i] === baseColors[i]) continue;
    assert.equal(allColors[i], locatorColors[i],
      `비컨 셰이프 ${i}: locator 가 바꾼 면을 all 이 다르게 칠했다`);
  }
});

// ── ⓙ Type Y 셀 표면 로케이터 — (C) 가 새로 배선한 화법 ──────────────────
//
// 운영자 원문 (2026-09-07): 「Y 의 경우는 v0 이나 v0T, v0TR 같은 로케이터 강조가
// 되어야 하는데 이쪽은 미지원 상태인 것 같고」. (B) 까지 `sceneY.js` 에는
// `centralN7Emphasis` 소비자가 **0 건**이었다.
//
// Y 에는 «검출기 안 페이로드» 가 없다 — 로케이터 셀은 레이아웃이 톤을 고정하고,
// 나머지(데이터·레퍼런스·포맷·필러)는 전부 digit 알파벳 = 코드 그 자체다. 그래서
// `locator` 와 `all` 이 **같은 그림**이고(중앙 M7 과 같은 «해당 없음»), 코드 셀은
// 어떤 모드에서도 안 바뀐다.

const Y_TEXT = 'HTTPS://TL.ESTRE.SO';
const Y_PALETTE = Object.freeze({ ...PALETTE, faceGains: DEFAULT_FACE_GAINS });
const Y_PROBE_PALETTE = Object.freeze({ ...Y_PALETTE, levels: PROBE_LEVELS });

/** 레이아웃 × n 격자 — 한 점만 재면 표본 운이다 (교훈 「한 점은 계약이 아니다」). */
const Y_HOSTS = Object.freeze([
  { label: 'Y n13 v0', layout: 'v0', version: 0 },
  { label: 'Y n21 v0T', layout: 'v0t', version: 1 },
  { label: 'Y n21 v0TR', layout: 'v0tr', version: 1 },
  { label: 'Y n25 v0T', layout: 'v0t', version: 2 },
  { label: 'Y n25 v0TR', layout: 'v0tr', version: 2 },
  { label: 'Y n25 v0TRQ', layout: 'v0trq', version: 2 },
  { label: 'Y n25 v0TRY', layout: 'v0try', version: 2 },
]);

const encodeYHost = (host) => encodeY(Y_TEXT, {
  cellSurfaceLayout: host.layout, version: host.version, tones: 2, eccLevel: 'M',
});

function sceneYOf(encoded, emphasis, palette = Y_PALETTE) {
  const opts = { palette, margin: 4 };
  // QR 슬롯 레이아웃은 슬롯이 **레이아웃 정의**라 텍스트가 선택 사항이 아니다.
  if (hasCenterQrSlot(encoded.cellSurfaceLayout)) opts.qrText = Y_TEXT;
  return buildSceneY(encoded, emphasis === undefined
    ? opts : { ...opts, centralN7Emphasis: emphasis });
}

/** Y 셀 (i,j)|face → 셰이프 인덱스. 그리는 **순서**가 아니라 좌표로 찾는다. */
function yFaceIndex(encoded, scene) {
  const pointsKey = (points) => points
    .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).join(';');
  const byPoints = new Map();
  scene.shapes.forEach((shape, index) => {
    if (!Array.isArray(shape.points)) return;
    const key = pointsKey(shape.points);
    if (!byPoints.has(key)) byPoints.set(key, index);
  });
  const index = new Map();
  for (const [key, entry] of encoded.cellDigits) {
    if (entry.role === 'slot') continue;
    const commaAt = key.indexOf(',');
    const i = Number(key.slice(0, commaAt));
    const j = Number(key.slice(commaAt + 1));
    for (const face of YFACES) {
      const at = byPoints.get(pointsKey(moduleQuad(face, i, j, scene.layout)));
      assert.ok(at !== undefined, `Y 셀 ${key} 면 ${face} 의 셰이프를 못 찾았다`);
      index.set(`${key}|${face}`, { at, entry });
    }
  }
  return index;
}

/** 게인까지 얹은 기대 색 — 렌더를 안 믿고 팔레트·게인 정본에서 직접 만든다. */
const yExpected = (levels, face, levelIndex) => rgbKey(
  applyFaceGain(levels[levelIndex], DEFAULT_FACE_GAINS[face]),
);

test('ⓙ Y: 로케이터 톤 셀만 바뀌고 코드 셀은 3택 전부 그대로 — 면 단위 전수', () => {
  for (const host of Y_HOSTS) {
    const encoded = encodeYHost(host);
    /*
     * **독립 출처** — «어느 셀이 로케이터이고 그 절대 톤이 무엇인가» 를 인코더 산출물이
     * 아니라 **레이아웃 정본**(`locatorCellsCellSurfaceFinal`)에서 받는다. 인코더가 실은
     * role 로만 재면 인코더를 인코더로 재는 셈이다 (검토 F9 와 같은 함정).
     */
    const canon = new Map(locatorCellsCellSurfaceFinal(encoded.n, host.layout)
      .map((cell) => [`${cell.i},${cell.j}`, cell]));
    assert.ok(canon.size > 0, `${host.label}: 레이아웃 정본의 로케이터 셀이 0 이다`);
    const carried = [...encoded.cellDigits]
      .filter(([, entry]) => entry.role === 'locator').map(([key]) => key);
    assert.deepEqual([...carried].sort(), [...canon.keys()].sort(),
      `${host.label}: 인코더의 로케이터 셀 집합이 레이아웃 정본과 다르다`);

    const base = sceneYOf(encoded, DEFAULT_CENTRAL_N7_EMPHASIS);
    const locator = sceneYOf(encoded, 'locator');
    const all = sceneYOf(encoded, 'all');
    const faces = yFaceIndex(encoded, base);

    let locatorFacesChanged = 0;
    let codeFacesChanged = 0;
    let codeFacesAtRisk = 0;
    for (const [label, { at, entry }] of faces) {
      const cut = label.indexOf('|');
      const cell = canon.get(label.slice(0, cut));
      const face = label.slice(cut + 1);
      const baseKey = rgbKey(base.shapes[at].color);
      if (cell) {
        // **절대 대조** — 차분이 아니라 값으로. 세 모드가 같이 틀린 경우를 잡는다.
        const level = cell[face];
        assert.equal(baseKey, yExpected(PRESET.levels, face, level),
          `${host.label}: ${label} 의 기본 색이 레이아웃 톤과 다르다`);
        const want = yExpected(EMPHASIZED, face, level);
        assert.equal(rgbKey(locator.shapes[at].color), want,
          `${host.label}: ${label} 의 locator 색이 계약과 다르다`);
        assert.equal(rgbKey(all.shapes[at].color), want,
          `${host.label}: ${label} 의 all 색이 계약과 다르다`);
        if (want !== baseKey) locatorFacesChanged += 1;
      } else {
        assert.equal(rgbKey(locator.shapes[at].color), baseKey,
          `${host.label}: ${label} 은 코드 셀인데 locator 팔이 바꿨다`);
        assert.equal(rgbKey(all.shapes[at].color), baseKey,
          `${host.label}: ${label} 은 코드 셀인데 all 팔이 바꿨다`);
        if (baseKey !== rgbKey(applyFaceGain(PRESET.levels[2], DEFAULT_FACE_GAINS[face]))) {
          // 밝은 레벨(2)은 강조가 보존한다 — 그 밖의 면이 «바뀔 수 있었던» 면이다.
          codeFacesAtRisk += 1;
        }
        if (rgbKey(all.shapes[at].color) !== baseKey) codeFacesChanged += 1;
      }
    }
    assert.ok(locatorFacesChanged > 0,
      `${host.label}: 로케이터 면이 한 장도 안 바뀌었다 — (C) 배선이 끊겼다`);
    assert.equal(codeFacesChanged, 0, `${host.label}: 코드 면이 바뀌었다`);
    assert.ok(codeFacesAtRisk > 0,
      `${host.label}: 강조가 바꿀 수 있었던 코드 면이 0 이다 — 위 단언이 공허하다`);
  }
});

test('ⓙ Y: locator ≡ all («검출기 안 페이로드» 가 없다) · 옵션 부재 ≡ default', () => {
  for (const host of Y_HOSTS) {
    const encoded = encodeYHost(host);
    const base = sceneYOf(encoded, DEFAULT_CENTRAL_N7_EMPHASIS);
    assert.deepEqual(sceneYOf(encoded, 'all').shapes, sceneYOf(encoded, 'locator').shapes,
      `${host.label}: Y 에서 두 팔이 갈렸다 — Y 에는 검출기 안 페이로드가 없다`);
    // 임베더 계약 — 옵션을 안 준 호출은 이전 출력과 **바이트 동일**이어야 한다.
    assert.deepEqual(sceneYOf(encoded, undefined).shapes, base.shapes,
      `${host.label}: 옵션 부재가 default 와 다르다 — 기존 발행물 재생성이 달라진다`);
  }
});

test('ⓙ Y: 강조는 인코더 산출물·기하를 안 건드린다 (순위 보존)', () => {
  for (const host of Y_HOSTS) {
    const encoded = encodeYHost(host);
    const before = JSON.stringify([...encoded.cellDigits]);
    const base = sceneYOf(encoded, DEFAULT_CENTRAL_N7_EMPHASIS);
    const all = sceneYOf(encoded, 'all');
    assert.equal(JSON.stringify([...encoded.cellDigits]), before,
      `${host.label}: 렌더가 인코더 산출물을 건드렸다`);
    assert.equal(all.shapes.length, base.shapes.length, `${host.label}: 셰이프 수가 달라졌다`);
    for (let i = 0; i < base.shapes.length; i += 1) {
      assert.deepEqual(all.shapes[i].points, base.shapes[i].points,
        `${host.label}: 셰이프 ${i} 의 기하가 움직였다 — 강조는 색 축이다`);
    }
    // 치환은 **레벨 자리에서만** — 강조본의 색은 강조 팔레트 3색(게인 얹은) 안에 있다.
    const allowed = new Set();
    for (const face of YFACES) {
      for (let level = 0; level < 3; level += 1) {
        allowed.add(yExpected(EMPHASIZED, face, level));
        allowed.add(yExpected(PRESET.levels, face, level));
      }
    }
    const faces = yFaceIndex(encoded, base);
    for (const [label, { at }] of faces) {
      assert.ok(allowed.has(rgbKey(all.shapes[at].color)),
        `${host.label}: ${label} 이 팔레트 밖 색이다 — 순위 보존이 깨졌다`);
    }
  }
});

test('ⓙ Y: 독립 출처 — 로케이터가 palette.levels 축이다 ⟺ applies (전수)', () => {
  /*
   * ⓐ 의 Y 판이다. 강조 상수도 판정 함수도 **한 번도 안 읽고**, `levels` 세 색만 바꾼
   * 두 팔레트로 같은 코드를 그려 로케이터 셀이 움직이는지만 본다. 그 답을 분류
   * (`detectorEmphasisApplicability`)와 대조한다 — 양변이 한 상수에서 나오는
   * 항진명제를 피하는 것이 이 자의 존재 이유다 (검토 F3).
   */
  let moved = 0;
  for (const host of Y_HOSTS) {
    const encoded = encodeYHost(host);
    const withPreset = sceneYOf(encoded, DEFAULT_CENTRAL_N7_EMPHASIS);
    const withProbe = sceneYOf(encoded, DEFAULT_CENTRAL_N7_EMPHASIS, Y_PROBE_PALETTE);
    const faces = yFaceIndex(encoded, withPreset);
    const canon = new Set(locatorCellsCellSurfaceFinal(encoded.n, host.layout)
      .map((cell) => `${cell.i},${cell.j}`));
    let locatorMoved = 0;
    for (const [label, { at }] of faces) {
      if (!canon.has(label.slice(0, label.indexOf('|')))) continue;
      if (rgbKey(withPreset.shapes[at].color) !== rgbKey(withProbe.shapes[at].color)) {
        locatorMoved += 1;
      }
    }
    assert.ok(locatorMoved > 0,
      `${host.label}: 로케이터가 palette.levels 축이 아니다 — 프로브 전제가 깨졌다`);
    moved += 1;
  }
  assert.equal(moved, Y_HOSTS.length);
  // 분류가 같은 답을 낸다 — 프로파일 전수로 (id 축은 locatorProfileY 다).
  for (const profile of LOCATOR_PROFILES_Y) {
    assert.equal(detectorEmphasisApplicability(profile).applies,
      isCellSurfaceLocatorProfileY(profile),
      `${profile}: 분류가 셀 표면 로케이터 여부와 어긋난다`);
  }
});

// ── ⓚ 관문 입도: «중앙 파인더 선택» 과 «검출 셀» 은 다른 축이다 ──────────
//
// 2026-09-07 emph-centerqr · 운영자 실기 20:1x 「O/A/K에서 중앙 QR일 때는 적용이
// 안되던데 적용되게 해야 할 듯」. 종전 관문은 `renderKind` 하나로 **코드 전체**를
// 껐고, 그래서 중앙 QR 을 고르면 바깥 마커 검출 셀까지 평 팔레트로 갔다.
// 아래 넷은 그 정정이 «맞게 열렸는가» 를 네 축으로 따로 잰다.

/** 중앙 QR × 마커 4종 — 운영자가 본 바로 그 조합. */
const CENTER_QR_HOSTS = Object.freeze(MARKER_HOSTS.map((host) => ({
  label: `${host.label} × 중앙 QR`,
  encoded: host.centerQrEncoded,
  toneCanon: host.toneCanon,
})));

const centerQrSceneOptions = () => ({
  palette: PALETTE, margin: 20,
  finderPatternId: CENTER_QR_FINDER_PATTERN_ID, centerQr: true, qrText: TEXT,
});

test('ⓚ① 중앙 QR 코드에서 마커 검출 셀이 강조된다 — 면 단위 절대 대조', () => {
  // 「검출 셀만, 그리고 전부」를 **차분이 아니라 값**으로 잰다 (ⓔ 와 같은 규약):
  // 기본은 palette.levels[level], locator/all 은 EMPHASIZED[level] 이어야 한다.
  let hostsSeen = 0;
  for (const host of CENTER_QR_HOSTS) {
    const encoded = host.encoded();
    const canon = host.toneCanon(encoded);
    const carried = [...encoded.cellDigits]
      .filter(([, entry]) => isDetectorToneCell(entry)).map(([key]) => key);
    assert.ok(carried.length > 0, `${host.label}: 검출 톤 셀이 0 이다 — 공허 통과다`);
    for (const key of carried) {
      assert.ok(canon.has(key), `${host.label}: 검출 셀 ${key} 가 심볼 정본 표 밖이다`);
    }
    const tones = new Map(carried.map((key) => [key, canon.get(key)]));
    const opts = centerQrSceneOptions();
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    const faces = outerCellFaceIndex(encoded, base);
    let changedFaces = 0;
    for (const mode of ['locator', 'all']) {
      const withMode = sceneOf(encoded, opts, mode);
      for (const [label, { at, entry }] of faces) {
        const cellKey = label.slice(0, label.indexOf('|'));
        if (!tones.has(cellKey)) continue;
        const face = label.slice(label.indexOf('|') + 1);
        const level = faceLevel(entry, face, tones.get(cellKey));
        assert.equal(rgbKey(base.shapes[at].color), LEVEL_KEYS[level],
          `${host.label}: ${label} 의 기본 색이 palette.levels[${level}] 가 아니다`);
        assert.equal(rgbKey(withMode.shapes[at].color), EMPHASIZED_KEYS[level],
          `${host.label}/${mode}: ${label} 의 강조 색이 계약과 다르다 — `
          + '중앙 QR 을 고르면 마커 강조가 꺼지던 그 결함이다');
        if (mode === 'locator' && level !== 2) changedFaces += 1;
      }
    }
    assert.ok(changedFaces > 0, `${host.label}: 강조가 바꾼 검출 면이 0 이다`);
    hostsSeen += 1;
  }
  assert.equal(hostsSeen, 4, '중앙 QR 마커 호스트가 4 종(H·H2O·CO2·H2CO3)이 아니다');
});

test('ⓚ② 중앙 QR **자신**은 3택 전부에서 안 바뀐다 — 그리고 levels 축이 아니다', () => {
  // 제외 사유(bwg)는 **중앙 QR 자신**에 대해서는 사실이다. 그 사실을 두 출처로 잰다:
  //   ㉠ 강조 3택에서 중앙 슬롯 셰이프가 한 점도 안 바뀐다 (행동).
  //   ㉡ 강조를 한 번도 안 켜고 `palette.levels` 만 바꿔도 안 움직인다 (독립 프로브).
  assert.equal(detectorDrawsFromLevels(CENTER_QR_FINDER_PATTERN_ID), false,
    '중앙 QR 이 palette.levels 축이 됐다 — 사유 bwg 를 다시 실측해야 한다');
  for (const host of CENTER_QR_HOSTS) {
    const encoded = host.encoded();
    const opts = centerQrSceneOptions();
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    const outerAt = new Set([...outerCellFaceIndex(encoded, base).values()]
      .map((hit) => hit.at));
    let slotShapes = 0;
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      const withMode = sceneOf(encoded, opts, mode);
      for (let i = 0; i < base.shapes.length; i += 1) {
        if (outerAt.has(i)) continue;
        slotShapes += 1;
        assert.deepEqual(withMode.shapes[i], base.shapes[i],
          `${host.label}/${mode}: 중앙 QR 슬롯 셰이프 ${i} 가 바뀌었다`);
      }
    }
    assert.ok(slotShapes > 0, `${host.label}: 중앙 슬롯 셰이프가 0 이다 — 빈 비교다`);
  }
});

test('ⓚ③ 중앙 QR 코드의 페이로드 면은 어떤 모드에서도 0면 (emph-c 규약)', () => {
  for (const host of CENTER_QR_HOSTS) {
    const encoded = host.encoded();
    const canon = host.toneCanon(encoded);
    const opts = centerQrSceneOptions();
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    const faces = outerCellFaceIndex(encoded, base);
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      const withMode = sceneOf(encoded, opts, mode);
      let payloadChanged = 0;
      let payloadAtRisk = 0;
      for (const [label, { at, entry }] of faces) {
        if (canon.has(label.slice(0, label.indexOf('|')))) continue;
        if (faceShouldChange(entry, label.slice(label.indexOf('|') + 1))) payloadAtRisk += 1;
        if (rgbKey(withMode.shapes[at].color) !== rgbKey(base.shapes[at].color)) {
          payloadChanged += 1;
        }
      }
      assert.ok(payloadAtRisk > 0,
        `${host.label}/${mode}: 강조가 바꿀 수 있었던 페이로드 면이 0 이다 — 공허하다`);
      assert.equal(payloadChanged, 0,
        `${host.label}/${mode}: 페이로드 면이 ${payloadChanged} 장 바뀌었다 — `
        + '관문 입도를 낮추면서 «코드 전체 강조» 로 되돌아갔다');
    }
  }
});

test('ⓚ④ 무회귀: 검출 셀이 없는 코드는 전 화법 × 3택에서 **래스터 바이트 동일**', () => {
  /*
   * 관문을 지운 정정의 무회귀 조건은 하나다 — «검출 셀이 0 인 코드에서는 아무것도
   * 안 바뀐다». 그 성질이 성립하면 종전 `cellPalettes === null` 갈래와 결과가 같다.
   * 위 ⓐ 형제들은 색(셰이프)까지만 보므로, 여기서는 화법 대표마다 **래스터**로
   * 좌표·순서·덮임까지 잰다.
   */
  const byKind = new Map();
  for (const id of RENDER_REACHABLE_IDS) {
    const kind = finderRenderKindOf(id);
    if (!byKind.has(kind)) byKind.set(kind, id);
  }
  assert.ok(byKind.size >= 5, `화법 대표가 ${byKind.size} 뿐이다`);
  for (const id of byKind.values()) {
    const encoded = encodedFor(id);
    assert.equal([...encoded.cellDigits].filter(([, e]) => isDetectorToneCell(e)).length, 0,
      `${id}: 무회귀 호스트가 검출 셀을 싣는다 — 이 자의 전제가 깨졌다`);
    const opts = sceneOptionsFor(id);
    const applies = detectorEmphasisApplicability(id).applies;
    const base = rasterize(sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS),
      { pixelsPerUnit: 8, supersample: 1 });
    for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
      const withMode = rasterize(sceneOf(encoded, opts, mode),
        { pixelsPerUnit: 8, supersample: 1 });
      const same = Buffer.from(withMode.pixels).equals(Buffer.from(base.pixels));
      // 대상 검출기는 **자기 슬롯**이 바뀌므로 동일할 이유가 없다 — 그쪽은 «안
      // 바뀌면» 배선이 빠진 것이다. 비대상은 반대로 «바뀌면» 회귀다.
      if (applies) {
        assert.equal(same, mode === DEFAULT_CENTRAL_N7_EMPHASIS,
          `${id}/${mode}: 대상 검출기의 슬롯 강조가 사라졌다(또는 default 가 움직였다)`);
      } else {
        assert.ok(same, `${id}/${mode}: 검출 셀이 없는 코드인데 래스터가 달라졌다 — 무회귀 위반`);
      }
    }
  }
});

test('ⓚ⑤ 화면의 마커 술어가 참이면 **와이어에 검출 셀이 실린다** — 두 층을 잇는다', () => {
  /*
   * 화면(`emphasisSectionModel`)은 `cornerMarkerSeatActive` 하나로 «강조할 검출 셀이
   * 있다» 고 판단해 카드를 연다. 그 판단이 인코더 산출물과 어긋나면 «켰는데 안 먹는»
   * 이 된다 — 화면 쪽 자(값 격자)로는 절대 안 보이는 종류의 어긋남이다.
   *
   * 그래서 술어가 참인 seat 조합마다 **실제로 인코드해서** 검출 톤 셀 수를 센다.
   * 인코더 옵션 사슬(buildConfig → encodeOptsFor)은 index.html 에 있어 여기서 못
   * 부르므로, 같은 옵션을 손으로 만들되 **술어의 참/거짓을 축으로** 돈다.
   */
  const cases = [
    { seat: { type: 'O', innerSeat: 'o-cm' },
      enc: () => encode(TEXT, { version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true }) },
    { seat: { type: 'A', outerSeat: 'a-cm', turnA: false },
      enc: () => encodeA(TEXT, { version: 1, eccLevel: 'M', cornerMarker: true }) },
    { seat: { type: 'A', outerSeat: 'v-cm', turnA: true },
      enc: () => encodeA(TEXT, { version: 1, eccLevel: 'M', turnA: true, cornerMarker: true }) },
    { seat: { type: 'K', outerSeat: 'k-cm' },
      enc: () => encodeK(TEXT, { version: 1, eccLevel: 'M', cornerMarker: true }) },
  ];
  for (const { seat, enc } of cases) {
    assert.equal(cornerMarkerSeatActive(seat), true,
      `${JSON.stringify(seat)}: 술어가 거짓이다 — 자리 철자가 늙었다`);
    const toneCells = [...enc().cellDigits].filter(([, e]) => isDetectorToneCell(e)).length;
    assert.ok(toneCells > 0,
      `${JSON.stringify(seat)}: 화면은 «강조할 검출 셀이 있다» 는데 와이어의 톤 셀이 0 이다`);
  }
  // 반대 방향 — 술어가 거짓인 자리에서는 마커 옵션 자체가 안 실린다(= 톤 셀 0).
  assert.equal(cornerMarkerSeatActive({ type: 'O', innerSeat: 'none' }), false);
  const bare = encode(TEXT, { version: 1, eccLevel: 'M' });
  assert.equal([...bare.cellDigits].filter(([, e]) => isDetectorToneCell(e)).length, 0,
    '마커를 안 켠 코드에 검출 톤 셀이 있다 — 이 자의 대조군이 깨졌다');
});

test('ⓚ⑥ 화면 좌석이 **조립한 옵션**으로 그려도 마커가 강조된다 — 게이트가 내 축을 지나는가', () => {
  /*
   * ⚠ **이 자가 없으면 위 ⓚ①\~⑤ 는 «엉뚱한 축에서 초록» 이다** (2026-09-07
   *   emph-centerqr 실측). 렌더 관문을 낮춘 뒤에도 화면은 그대로였다 — 조립 좌석
   *   (`sceneOptionsForOA`)이 `centralN7EmphasisAppliesTo(finderPatternId)` 로
   *   **옵션 전달 자체**를 막고 있었기 때문이다. 그 자리의 주석은 결과까지 정확히
   *   적고 있었다: 「centerQr 이면 finderPatternId 가 center-qr 로 이미 양보돼 있어
   *   여기서 걸리지 않는다」.
   *
   *   원자료 `.agent/lanes/emph-centerqr/cqr-consumer-sweep-before.jsonl`:
   *     QR «중앙» → emphasisPassed=false · 마커 검출 면 **0/24**
   *     QR «없음» → emphasisPassed=true  · 마커 검출 면 **24/24**
   *
   *   그래서 여기서는 buildScene 옵션을 손으로 만들지 않고 **화면이 쓰는 그 함수**를
   *   불러 그 결과로 그린다 (교훈 `opening-an-exclusion-needs-a-consumer-sweep` ·
   *   `gates-can-be-green-on-the-wrong-axis`).
   */
  const hosts = [
    {
      label: 'O × QR 중앙 (운영자가 본 자리)',
      encoded: () => encode(TEXT, {
        version: 2, eccLevel: 'M', centerQr: true, cornerMarker: true, markerTones: true,
      }),
      fallback: { mode: 'center', cornerToo: false },
      finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
      expectRendered: CENTER_QR_FINDER_PATTERN_ID,
    },
    {
      label: 'O × 불스아이 (대조군 — 다른 비대상 검출기)',
      encoded: () => encode(TEXT, {
        version: 2, eccLevel: 'M', cornerMarker: true, markerTones: true,
      }),
      fallback: { mode: 'none' },
      finderPatternId: 'bullseye',
      expectRendered: 'bullseye',
    },
    {
      label: 'O × 중앙 TL (대조군 — 종전에도 걸리던 자리)',
      encoded: () => encode(TEXT, {
        version: 2, eccLevel: 'M', centralN7: true, cornerMarker: true, markerTones: true,
      }),
      fallback: { mode: 'none' },
      finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
      expectRendered: CENTRAL_N7_FINDER_PATTERN_ID,
    },
  ];
  for (const host of hosts) {
    const encoded = host.encoded();
    const canon = hTonesByKeyO(encoded.k);
    const carried = new Set([...encoded.cellDigits]
      .filter(([, entry]) => isDetectorToneCell(entry)).map(([key]) => key));
    assert.ok(carried.size > 0, `${host.label}: 마커 검출 셀이 0 이다 — 공허 통과다`);
    const optsFor = (emphasis) => sceneOptionsForOA({
      centralN7Emphasis: emphasis,
      fallback: { ...host.fallback },
      finderPatternId: host.finderPatternId,
      palette: PALETTE,
      qrText: TEXT,
      type: 'O',
    });
    const optsAll = optsFor('all');
    assert.equal(optsAll.finderPatternId, host.expectRendered,
      `${host.label}: 조립이 고른 렌더 검출기가 다르다 — 이 자의 전제가 깨졌다`);
    // ① 조립 층 — 옵션이 실제로 실린다.
    assert.equal(optsAll.centralN7Emphasis, 'all',
      `${host.label}: 조립 좌석이 강조 옵션을 안 실었다 — 렌더를 고쳐도 화면은 그대로다`);
    // ② 렌더 층 — 그 옵션으로 그린 장면에서 마커 검출 면이 **전부** 바뀐다.
    const base = buildScene(encoded, optsFor(DEFAULT_CENTRAL_N7_EMPHASIS));
    const all = buildScene(encoded, optsAll);
    let changed = 0;
    let atRisk = 0;
    let payloadChanged = 0;
    for (const [label, { at, entry }] of outerCellFaceIndex(encoded, base)) {
      const cellKey = label.slice(0, label.indexOf('|'));
      const face = label.slice(label.indexOf('|') + 1);
      const same = rgbKey(base.shapes[at].color) === rgbKey(all.shapes[at].color);
      if (!carried.has(cellKey)) {
        if (!same) payloadChanged += 1;
        continue;
      }
      if (faceShouldChange(entry, face, canon.get(cellKey))) atRisk += 1;
      if (!same) changed += 1;
    }
    assert.ok(atRisk > 0, `${host.label}: 바꿀 수 있었던 검출 면이 0 이다`);
    assert.equal(changed, atRisk,
      `${host.label}: 화면 좌석 경로에서 마커 검출 면 ${atRisk} 중 ${changed} 만 강조됐다`);
    assert.equal(payloadChanged, 0,
      `${host.label}: 화면 좌석 경로에서 페이로드 면이 ${payloadChanged} 장 바뀌었다`);
  }
});

// ── ⓖ 판정 집합의 총함수성 ──────────────────────────────────────────────

test('ⓖ DETECTOR_EMPHASIS_RENDER_KINDS 에 죽은 원소가 없다', () => {
  // ⭐ 전수에 **Y 로케이터 프로파일**을 더한다 (2026-09-07 (C)) — Y 의 검출기 id 축은
  //   `finderPatternId` 가 아니라 `locatorProfileY` 라, 안 더하면 새 화법
  //   `cell-surface-locator` 가 «죽은 원소» 로 잘못 보인다. 그리고 이 합집합이
  //   판정(`detectorEmphasisApplicability`)이 실제로 받는 id 의 전수다.
  const reachableKinds = new Set(
    [...RENDER_REACHABLE_IDS, ...LOCATOR_PROFILES_Y].map(finderRenderKindOf),
  );
  for (const kind of DETECTOR_EMPHASIS_RENDER_KINDS) {
    assert.ok(reachableKinds.has(kind),
      `${kind}: 렌더 전수 어디에서도 안 나오는 renderKind 다 — 죽은 원소`);
  }
  assert.equal(new Set(DETECTOR_EMPHASIS_RENDER_KINDS).size,
    DETECTOR_EMPHASIS_RENDER_KINDS.length, '집합에 중복이 있다');
});

test('ⓖ 분류 네 갈래가 전수를 덮고, 적용은 정확히 이 집합이다', () => {
  for (const id of [...RENDER_REACHABLE_IDS, ...LOCATOR_PROFILES_Y]) {
    const verdict = detectorEmphasisApplicability(id);
    const kind = finderRenderKindOf(id);
    assert.equal(verdict.applies, DETECTOR_EMPHASIS_RENDER_KINDS.includes(kind),
      `${id}: 적용 판정이 renderKind 집합과 어긋난다 (${kind})`);
  }
});
