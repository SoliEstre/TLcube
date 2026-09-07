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
  centralBeaconEncoderOptions, detectorEmphasisApplicability,
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

test('ⓔ 바깥 코드: locator 는 검출 셀만, all 은 페이로드 셀까지 — 면 단위 전수', () => {
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
      assert.equal(rgbKey(all.shapes[at].color), EMPHASIZED_KEYS[level],
        `${host.label}: ${label} 의 all 색이 계약과 다르다`);

      const changedLocator = rgbKey(locator.shapes[at].color) !== rgbKey(base.shapes[at].color);
      const changedAll = rgbKey(all.shapes[at].color) !== rgbKey(base.shapes[at].color);
      const shouldChange = faceShouldChange(entry, face, canon.get(cellKey));
      // locator 팔: 검출 셀의 «밝지 않은» 면만.
      assert.equal(changedLocator, detector && shouldChange,
        `${host.label}: ${label} 의 locator 결과가 계약과 다르다`);
      // all 팔: 모든 셀의 «밝지 않은» 면.
      assert.equal(changedAll, shouldChange,
        `${host.label}: ${label} 의 all 결과가 계약과 다르다`);
      if (changedLocator) detectorFacesChanged += 1;
      if (changedAll && !detector) payloadFacesChanged += 1;
    }
    assert.ok(payloadFacesChanged > 0,
      `${host.label}: all 팔이 바깥 페이로드 면을 하나도 안 바꿨다`);
    assert.equal(detectorFacesChanged > 0, toneCells > 0,
      `${host.label}: locator 팔의 바깥 변화와 검출 셀 유무가 어긋난다`);
  }
});

test('ⓔ C 노치 림 — 브리프가 이름 붙인 집합이 실제로 치환된다', () => {
  // 「노치 림」은 정본 함수가 없고 **파생이 계약**이다 (028A §4 — notchCellsC 의
  // 이웃 ∩ cellDigits). 이름을 부른 집합이 위 격자 안에서 진짜로 걸리는지 따로 잰다 —
  // 안 그러면 «전부 바뀐다» 라는 넓은 단언 뒤에 숨어 이 집합만 빠져도 안 보인다.
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
  let rimFacesChanged = 0;
  for (const key of rim) {
    for (const face of FACES) {
      const { at, entry } = faces.get(`${key}|${face}`);
      const changedAll = rgbKey(all.shapes[at].color) !== rgbKey(base.shapes[at].color);
      assert.equal(changedAll, faceShouldChange(entry, face),
        `노치 림 ${key} 면 ${face}: all 팔 결과가 계약과 다르다`);
      assert.equal(rgbKey(locator.shapes[at].color), rgbKey(base.shapes[at].color),
        `노치 림 ${key} 면 ${face}: 림은 digit 알파벳이라 locator 팔에서 안 바뀌어야 한다`);
      if (changedAll) rimFacesChanged += 1;
    }
  }
  assert.ok(rimFacesChanged >= 2 * rim.size,
    `노치 림에서 바뀐 면이 너무 적다 (${rimFacesChanged}) — 순열 셀은 셀당 2면이 바뀐다`);
});

// ── ⓗ 화면 라벨이 «주장하는 범위» 를 행동으로 잰다 ────────────────────────
//
// PM/028 §5.1 ③ — 「UI 라벨은 실제 대상 범위와 일치할 때만」. 문구 자체는 철자라
// 자로 굳히지 않는다(문구가 바뀌면 자가 정답을 거부한다). 대신 **문구가 주장하는
// 사실**을 행동으로 재 둔다: 사실이 바뀌면 여기가 빨개지고, 그때 사람이 문구를 다시
// 읽게 된다 (2026-09-07 검토 F1·F2 — 라벨 스윕이 절반만 됐던 이유가 이 자의 부재다).

test('ⓗ g1026·g1027·g1028: 비대상 검출기를 고르면 마커가 있어도 코드 전체가 안 바뀐다', () => {
  // 사유 문구가 「이 검출기를 고르면 **코드 전체 강조까지 함께 꺼져요**」라고 말한다.
  // 그 말이 참인지는 «마커 검출 셀이 실재하는 코드» 에서만 물을 수 있다 — 셀이 0 이면
  // 안 바뀌는 게 당연해서 공허 통과다.
  const inertIds = RENDER_REACHABLE_IDS
    // ⚠ 중앙 QR 은 자기 전용 인코더 옵션(centerQr)이 필요해 마커 호스트에 못 태운다.
    .filter((id) => id !== CENTER_QR_FINDER_PATTERN_ID && !detectorDrawsFromLevels(id));
  const byKind = new Map();
  for (const id of inertIds) {
    const kind = finderRenderKindOf(id);
    if (!byKind.has(kind)) byKind.set(kind, id);
  }
  assert.ok(byKind.size >= 3, `비대상 화법 표본이 ${byKind.size} 뿐이다`);
  for (const host of MARKER_HOSTS) {
    // 중앙 슬롯을 비운 판을 쓴다 — 중앙 점유자는 하나뿐이라 centralN7 을 켠 채로는
    // 다른 검출기를 못 고른다 (buildScene 이 RangeError 로 거절한다).
    const encoded = host.bareEncoded();
    const canon = new Set(host.toneCanon(encoded).keys());
    const toneKeys = [...encoded.cellDigits]
      .filter(([, entry]) => isDetectorToneCell(entry)).map(([key]) => key);
    assert.ok(toneKeys.length > 0,
      `${host.label}: 중앙을 비우니 마커 검출 셀이 0 이 됐다 — 공허 통과다`);
    for (const key of toneKeys) {
      assert.ok(canon.has(key),
        `${host.label}: 검출 셀 ${key} 가 심볼 정본 표 밖이다`);
    }
    for (const id of byKind.values()) {
      const opts = { palette: PALETTE, margin: 20, finderPatternId: id };
      const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
      for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
        assert.deepEqual(sceneOf(encoded, opts, mode).shapes, base.shapes,
          `${host.label} × ${id}: 화면은 «이 검출기엔 강조를 안 건다» 고 말하는데 `
          + `${mode} 렌더가 달라졌다 — 사유 문구가 거짓이 된다`);
      }
    }
  }
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

test('ⓗ g1008: all 팔은 데이터 셀까지 «코드 전체» 를 바꾼다', () => {
  // 「검출기 셀과 데이터 셀까지 코드 전체를」이라는 문구의 뒷부분.
  for (const host of ALL_HOSTS) {
    const encoded = host.encoded();
    const canon = host.toneCanon ? host.toneCanon(encoded) : new Map();
    const opts = hostSceneOptions(host);
    const base = sceneOf(encoded, opts, DEFAULT_CENTRAL_N7_EMPHASIS);
    const all = sceneOf(encoded, opts, 'all');
    let payloadChanged = 0;
    for (const [label, { at }] of outerCellFaceIndex(encoded, base)) {
      if (canon.has(label.slice(0, label.indexOf('|')))) continue;
      if (rgbKey(all.shapes[at].color) !== rgbKey(base.shapes[at].color)) payloadChanged += 1;
    }
    assert.ok(payloadChanged > 0,
      `${host.label}: all 팔이 데이터 셀을 한 면도 안 바꿨다 — g1008 이 거짓이 된다`);
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

// ── ⓖ 판정 집합의 총함수성 ──────────────────────────────────────────────

test('ⓖ DETECTOR_EMPHASIS_RENDER_KINDS 에 죽은 원소가 없다', () => {
  const reachableKinds = new Set(RENDER_REACHABLE_IDS.map(finderRenderKindOf));
  for (const kind of DETECTOR_EMPHASIS_RENDER_KINDS) {
    assert.ok(reachableKinds.has(kind),
      `${kind}: 렌더 전수 어디에서도 안 나오는 renderKind 다 — 죽은 원소`);
  }
  assert.equal(new Set(DETECTOR_EMPHASIS_RENDER_KINDS).size,
    DETECTOR_EMPHASIS_RENDER_KINDS.length, '집합에 중복이 있다');
});

test('ⓖ 분류 네 갈래가 전수를 덮고, 적용은 정확히 이 집합이다', () => {
  for (const id of RENDER_REACHABLE_IDS) {
    const verdict = detectorEmphasisApplicability(id);
    const kind = finderRenderKindOf(id);
    assert.equal(verdict.applies, DETECTOR_EMPHASIS_RENDER_KINDS.includes(kind),
      `${id}: 적용 판정이 renderKind 집합과 어긋난다 (${kind})`);
  }
});
