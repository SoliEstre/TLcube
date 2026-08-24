/**
 * decoder-corner-marker.test.js — O-CM 코너 마커 검출·방향·보강 (합성)
 *
 * 인코더 → scene → 결정적 rasterizer → 상대휘도 필드의 실제 경로를 거친다.
 * `decoder-anchor.test.js` 의 하네스 규약을 그대로 따른다 (같은 프리셋·같은 회전).
 *
 * 고정하는 것:
 *   ① 회전 3방향에서 정답 가설이 **정확히 하나**
 *   ② 60°/180°/300° 와 거울 프레임은 수용 0 — margin 이 커버하지 않던 클래스
 *      (claude-oak-review.md §1.3) 를 실제로 죽인다
 *   ③ 레거시 O · Type A 프레임 교차 오수용 0
 *   ④ 원근 왜곡에서 코너 이미지 점 오차가 기저 H 대비 실제로 줄어든다
 *   ⑤ 결정성 (같은 입력 두 번 → deepEqual)
 *   ⑥ **얇은 축** — 레거시 O V3 를 rot120 한 프레임의 k=6/방향1 가설은
 *      agreement 게이트(0.78)와 반경 게이트를 **둘 다 통과**하고 오직 코너
 *      alive 게이트만이 막는다. alive 가 `accepted` 에서 빠지면 여기서 터진다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset, relativeLuminance,
} from '../src/luminance.js';
import {
  findOCornerMarkerHypotheses,
  verifyCornerMarkers,
  DEFAULT_MARKER_AGREEMENT,
  DEFAULT_CORNER_AGREEMENT,
  DEFAULT_MEAN_RADIUS_TOLERANCE,
} from '../src/decoder/corner-marker-detect.js';
import { findOAnchorHypotheses } from '../src/decoder/anchor-detect.js';
import { FRONTEND_FAILURE, HOMOGRAPHY_CANONICAL_SPACE } from '../src/decoder/contracts.js';
import { markerCells, markerTetrads } from '../src/markerO.js';
import { axialToPixel } from '../src/hexgrid.js';

const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};
const BACKGROUND = relativeLuminance(PRESET.background);

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const offset = (y * raster.width + x) * 4;
      data[y * raster.width + x] = relativeLuminance({
        r: raster.pixels[offset],
        g: raster.pixels[offset + 1],
        b: raster.pixels[offset + 2],
      });
    }
  }
  return {
    width: raster.width, height: raster.height, data, alpha: null,
  };
}

function renderFrame(encoded, cellSize = 20, margin) {
  const scene = buildScene(encoded, { palette: PALETTE, cellSize, margin });
  const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: 4 });
  return {
    luma: rasterToLuma(raster),
    bullseye: {
      center: { x: scene.layout.originX, y: scene.layout.originY },
      cellSize,
      score: 1,
      hardChecksPassed: true,
    },
  };
}

function rotateLuma(source, center, radians) {
  const data = new Float32Array(source.data.length);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      const sx = Math.round(c * dx + s * dy + center.x);
      const sy = Math.round(-s * dx + c * dy + center.y);
      data[y * source.width + x] = sx >= 0 && sy >= 0
        && sx < source.width && sy < source.height
        ? source.data[sy * source.width + sx]
        : BACKGROUND;
    }
  }
  return {
    width: source.width, height: source.height, data, alpha: null,
  };
}

function mirrorLuma(source) {
  const data = new Float32Array(source.data.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      data[y * source.width + x] = source.data[y * source.width + (source.width - 1 - x)];
    }
  }
  return {
    width: source.width, height: source.height, data, alpha: null,
  };
}

/** 중심 고정 원근 왜곡 — p' = center + (p−center)/(1 + g·dx + h·dy) */
function warpLuma(source, center, g, h) {
  const data = new Float32Array(source.data.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      const den = 1 - (g * dx + h * dy);
      let value = BACKGROUND;
      if (Math.abs(den) > 1e-6) {
        const sx = Math.round(center.x + dx / den);
        const sy = Math.round(center.y + dy / den);
        if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) {
          value = source.data[sy * source.width + sx];
        }
      }
      data[y * source.width + x] = value;
    }
  }
  return {
    width: source.width, height: source.height, data, alpha: null,
  };
}

function warpPoint(center, g, h, p) {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const den = 1 + (g * dx + h * dy);
  return { x: center.x + dx / den, y: center.y + dy / den };
}

const ENCODED_CM = encode('TLcube-O-CM-rot', { version: 2, eccLevel: 'M', cornerMarker: true });
const FRAME_CM = renderFrame(ENCODED_CM, 20);

test('O-CM: 회전 3방향 — 정답 (k, 방향) 가설이 정확히 하나', () => {
  for (let turn = 0; turn < 3; turn += 1) {
    const luma = turn === 0
      ? FRAME_CM.luma
      : rotateLuma(FRAME_CM.luma, FRAME_CM.bullseye.center, turn * (2 * Math.PI / 3));
    const result = findOCornerMarkerHypotheses(luma, FRAME_CM.bullseye, [6, 8, 10]);
    assert.equal(result.ok, true, `turn=${turn} 에서 마커 가설이 없다`);
    assert.equal(result.hypotheses.length, 1);
    const hypothesis = result.hypotheses[0];
    assert.equal(hypothesis.k, ENCODED_CM.k);
    assert.equal(hypothesis.orientation, turn);
    assert.equal(hypothesis.agreement, 1);
    assert.equal(hypothesis.confirmAgreement, 1);
    assert.equal(hypothesis.canonicalSpace, HOMOGRAPHY_CANONICAL_SPACE);
    assert.notEqual(hypothesis.refinedH, null);
    assert.equal(hypothesis.corners.length, 3);
  }
});

test('O-CM: 60°·180°·300° 오가설과 거울 프레임은 수용 0', () => {
  for (const degrees of [60, 180, 300]) {
    const luma = rotateLuma(FRAME_CM.luma, FRAME_CM.bullseye.center, degrees * (Math.PI / 180));
    const result = findOCornerMarkerHypotheses(luma, FRAME_CM.bullseye, [6, 8, 10]);
    assert.equal(result.ok, false, `${degrees}° 오가설이 수용됐다`);
    assert.equal(result.reason, FRONTEND_FAILURE.NO_ANCHORS);
    const best = result.detail.rejected
      .filter((entry) => entry.agreement !== undefined)
      .reduce((acc, entry) => Math.max(acc, entry.agreement), 0);
    assert.ok(best < 1, `${degrees}°: 오가설 agreement 가 1 이다`);
  }
  const mirrored = mirrorLuma(FRAME_CM.luma);
  const center = {
    x: FRAME_CM.luma.width - 1 - FRAME_CM.bullseye.center.x,
    y: FRAME_CM.bullseye.center.y,
  };
  const result = findOCornerMarkerHypotheses(mirrored, { ...FRAME_CM.bullseye, center }, [6, 8, 10]);
  assert.equal(result.ok, false, '거울 프레임이 수용됐다');
});

test('O-CM: 교차 오수용 0 — 레거시 O · Type A 프레임', () => {
  const frames = [];
  for (const version of [1, 2, 3]) {
    frames.push([`O V${version}`, renderFrame(encode('legacy-o-frame', { version, eccLevel: 'M' }), 20)]);
  }
  for (const version of [0, 1, 2]) {
    frames.push([`A V${version}`, renderFrame(encodeA('legacy-a-frame', { version, eccLevel: 'M' }), 10, 240)]);
  }
  for (const [name, frame] of frames) {
    const result = findOCornerMarkerHypotheses(frame.luma, frame.bullseye, [6, 8, 10]);
    assert.equal(result.ok, false, `${name}: 마커 가설이 섰다`);
    // 게이트가 실제로 «무엇 때문에» 죽였는지도 고정한다.
    // ⚠ 게이트는 셋이 아니라 **넷**이다 — agreement · 코너 alive · 평균 반경비 ·
    // confirm. 처음엔 alive 를 빼고 적었는데, 그러면 alive 로만 죽는 케이스가
    // confirmAgreement=0(=계산조차 안 됨) 덕에 우연히 통과해 버린다.
    for (const entry of result.detail.rejected) {
      if (entry.agreement === undefined) continue;
      const gated = entry.agreement < DEFAULT_MARKER_AGREEMENT
        || entry.aliveCorners < 3
        || entry.radiusOk === false
        || entry.confirmAgreement < DEFAULT_MARKER_AGREEMENT;
      assert.equal(gated, true, `${name} ${entry.hypothesisId}: 어떤 게이트도 안 걸렸는데 기각됐다`);
    }
  }
});

/**
 * 얇은 축 회귀 — «레거시 O 는 agreement 하한이 자른다» 는 서술이 틀렸다는 것을 고정한다.
 *
 * 실측 (2026-08-16, `test/output/_oak-bench-r2.mjs`): 레거시 O V3 프레임을 rot120 한
 * 뒤 k=6 / 방향1 가설은 agreement 29/36 = 0.8056 으로 **0.78 하한을 넘고**, 평균
 * 반경비도 1.0844 라 |1−ratio| = 0.0844 ≤ 0.12 로 **반경 게이트도 통과**한다.
 * 실제로 죽이는 것은 코너별 alive 게이트다 — 코너 2 가 8/12 = 0.6667 < 0.75.
 *
 * 이 프레임은 전체 18프레임(교차 6 × 회전 3) 중 **agreement 축 여유가 음수(−0.0256)인
 * 유일한 O 계열 케이스**라, alive 게이트가 사라지면 여기가 가장 먼저 뚫린다.
 * (뒤에 confirm 0.5833 이 한 겹 더 있지만, 그건 방어 깊이지 이 게이트의 대체재가 아니다.)
 */
test('O-CM: 얇은 축 — 레거시 O V3 rot120/k6 은 alive 게이트만이 막는다', () => {
  const cellSize = 20;
  const frame = renderFrame(encode('legacy-o-frame', { version: 3, eccLevel: 'M' }), cellSize);
  const luma = rotateLuma(frame.luma, frame.bullseye.center, 2 * Math.PI / 3);

  // ① 종단 — 이 프레임에서 마커 가설은 서지 않는다.
  const result = findOCornerMarkerHypotheses(luma, frame.bullseye, [6, 8, 10]);
  assert.equal(result.ok, false, '레거시 O V3 rot120 에서 마커 가설이 섰다');
  const entry = result.detail.rejected.find((e) => e.hypothesisId === 'hex-marker-6-1');
  assert.notEqual(entry, undefined, 'k=6/방향1 기각 레코드가 없다');
  assert.ok(
    entry.agreement >= DEFAULT_MARKER_AGREEMENT,
    `k=6/방향1 이 agreement 하한 아래로 내려갔다 (${entry.agreement}) — 이 케이스가 더는 얇은 축이 아니다`,
  );
  assert.equal(entry.aliveCorners, 2, 'alive 코너 수가 2 가 아니다');
  assert.equal(entry.radiusOk, true, '반경 게이트가 대신 잘랐다 — alive 가 유일 방벽이 아니게 됐다');

  // ② 게이트 자체 — `accepted` 의 alive 연언이 살아 있는가.
  //    (앞 두 게이트가 통과하는데 accepted 가 false 인 유일한 이유가 alive 다.)
  const base = new Float64Array([
    cellSize, 0, frame.bullseye.center.x,
    0, cellSize, frame.bullseye.center.y,
    0, 0, 1,
  ]);
  const angle = 2 * Math.PI / 3;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const H = new Float64Array([
    base[0] * cos + base[1] * sin, -base[0] * sin + base[1] * cos, base[2],
    base[3] * cos + base[4] * sin, -base[3] * sin + base[4] * cos, base[5],
    0, 0, 1,
  ]);
  const verified = verifyCornerMarkers(
    luma,
    { H, k: 6, cellSize },
    { center: frame.bullseye.center, groups: markerTetrads(6) },
  );
  assert.equal(verified.agree, 29, 'agreement 분자가 29/36 가 아니다');
  assert.equal(verified.slots, 36);
  assert.ok(verified.agreement >= DEFAULT_MARKER_AGREEMENT, 'agreement 게이트를 더는 통과하지 않는다');
  assert.ok(
    Math.abs(verified.meanRadiusRatio - 1) <= DEFAULT_MEAN_RADIUS_TOLERANCE,
    '반경 게이트를 더는 통과하지 않는다',
  );
  assert.equal(verified.radiusOk, true);
  assert.equal(verified.aliveCorners, 2);
  const worst = Math.min(...verified.corners.map((c) => c.agree / c.slots));
  assert.ok(worst < DEFAULT_CORNER_AGREEMENT, `최악 코너 ${worst} 가 alive 하한 이상이다`);
  // ← alive 연언이 `accepted` 에서 빠지면 여기서 터진다.
  assert.equal(
    verified.accepted, false,
    'agreement·반경을 통과했는데 accepted 가 true — 코너 alive 게이트가 죽었다',
  );
});

test('O-CM: 원근 왜곡에서 코너 이미지 점 오차가 기저 H 대비 줄어든다', () => {
  const cellSize = 20;
  const center = FRAME_CM.bullseye.center;
  const anchors = markerCells(ENCODED_CM.k).filter((cell) => cell.label === 'A');
  for (const [g, h] of [[0.0004, 0], [0.0008, 0.0003]]) {
    const luma = warpLuma(FRAME_CM.luma, center, g, h);
    const result = findOCornerMarkerHypotheses(luma, FRAME_CM.bullseye, [8]);
    assert.equal(result.ok, true, `g=${g}: 마커 가설이 없다`);
    const hypothesis = result.hypotheses[0];
    assert.equal(hypothesis.orientation, 0);
    let baseError = 0;
    let markerError = 0;
    for (let i = 0; i < anchors.length; i += 1) {
      const canonical = axialToPixel(anchors[i].q, anchors[i].r);
      const basePoint = {
        x: center.x + canonical.x * cellSize,
        y: center.y + canonical.y * cellSize,
      };
      const truePoint = warpPoint(center, g, h, basePoint);
      const got = hypothesis.corners[i].imagePoint;
      baseError += Math.hypot(basePoint.x - truePoint.x, basePoint.y - truePoint.y);
      markerError += Math.hypot(got.x - truePoint.x, got.y - truePoint.y);
    }
    // 실측(2026-08-16): g=0.0004 20.1px → 3.3px · g=0.0008 41.2px → 3.8px.
    // 하한을 3배로 잡아 잡음 여유를 둔다.
    assert.ok(markerError * 3 < baseError, `g=${g}: 보강 이득이 3배 미만 (${markerError} vs ${baseError})`);
    assert.ok(markerError / anchors.length < cellSize / 2, `g=${g}: 코너 오차가 0.5셀 이상`);
  }
});

test('O-CM: 결정적 — 같은 입력 두 번은 같은 결과', () => {
  const first = findOCornerMarkerHypotheses(FRAME_CM.luma, FRAME_CM.bullseye, [6, 8, 10]);
  const second = findOCornerMarkerHypotheses(FRAME_CM.luma, FRAME_CM.bullseye, [6, 8, 10]);
  assert.deepEqual(first, second);
});

test('O-CM: 레거시 앵커 3점 경로가 O-CM 프레임에서도 그대로 성립', () => {
  for (let turn = 0; turn < 3; turn += 1) {
    const luma = turn === 0
      ? FRAME_CM.luma
      : rotateLuma(FRAME_CM.luma, FRAME_CM.bullseye.center, turn * (2 * Math.PI / 3));
    const result = findOAnchorHypotheses(luma, FRAME_CM.bullseye, [6, 8, 10], { minSeparation: 0.04 });
    assert.equal(result.ok, true);
    assert.equal(result.hypotheses.length, 1);
    assert.equal(result.hypotheses[0].k, ENCODED_CM.k);
    assert.equal(result.hypotheses[0].orientation, turn);
  }
});

test('O-CM: 실패 경로는 예외가 아니라 fail 결과', () => {
  assert.equal(findOCornerMarkerHypotheses(null, FRAME_CM.bullseye, [8]).reason, FRONTEND_FAILURE.EMPTY_INPUT);
  assert.equal(findOCornerMarkerHypotheses(FRAME_CM.luma, null, [8]).reason, FRONTEND_FAILURE.NO_FINDER);
  assert.equal(findOCornerMarkerHypotheses(FRAME_CM.luma, FRAME_CM.bullseye, []).reason, FRONTEND_FAILURE.NO_ANCHORS);
});

test('O-CM: verifyCornerMarkers 는 탐색 없이도 정답 H 에서 1.0', () => {
  const H = new Float64Array([
    FRAME_CM.bullseye.cellSize, 0, FRAME_CM.bullseye.center.x,
    0, FRAME_CM.bullseye.cellSize, FRAME_CM.bullseye.center.y,
    0, 0, 1,
  ]);
  const verified = verifyCornerMarkers(
    FRAME_CM.luma,
    { H, k: ENCODED_CM.k, cellSize: FRAME_CM.bullseye.cellSize },
    { searchCells: 0, scaleSearch: 0, center: FRAME_CM.bullseye.center },
  );
  assert.equal(verified.agreement, 1);
  assert.equal(verified.slots, 36);
  assert.equal(verified.aliveCorners, 3);
  assert.equal(verified.accepted, true);
});

// ── V-CM(턴A) 턴 변형 — **측정한 현실을 잠근다** ─────────────────────────────
//
// 왜 이 테스트가 생겼나 (2026-08-25, codex 검수 적발): 턴 변형을 검출기에 넣고
// 배포까지 했는데 **그 동작을 고정하는 테스트가 하나도 없었다.** 이 파일의 기존
// 테스트는 `findOCornerMarkerHypotheses`(O 경로)만 가져오고, markerA 의 180° 테스트는
// «거부된다» 는 반대편 주장이다. 지정 테스트 17개가 전부 통과하는데 검출기를 직접
// 부르면 `accepted:false · 49/63` 이었다 — 초록이 이 코드에 대해 아무 말도 안 했다.
//
// ⚠ 이 테스트는 «되기를 바라는 값» 이 아니라 **지금 실제로 나오는 값** 을 적는다.
//    턴 변형이 후보로 **생성되는지**(=구조가 열렸는지)는 양성으로 잠그고,
//    아직 게이트를 못 넘는다는 사실은 **알려진 공백(F-111)** 으로 잠근다.
//    풀링 수리가 들어가면 이 테스트가 **터진다 — 그게 목적이다.** 조용히 지나가면
//    누구도 «언제 고쳐졌는지» 를 모른다. 터지면 작성자가 값을 의도적으로 갱신한다.
test('V-CM 턴 변형은 후보로 서고, 톤 앵커 고갈로 아직 게이트를 못 넘는다 (F-111)', async () => {
  const { findACornerMarkerHypotheses } = await import('../src/decoder/corner-marker-detect.js');
  const { toRelativeLuminance } = await import('../src/decoder/luma.js');
  const { detectBullseyes } = await import('../src/decoder/bullseye-detect.js');

  const encoded = encodeA('gate1', {
    version: 1, eccLevel: 'M', cornerMarker: true, turnA: true,
  });
  const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
  const luma = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 24, supersample: 1 }), {});
  const bs = detectBullseyes(luma, {});
  assert.equal(bs.ok, true, '불스아이가 안 섰다 — 이 테스트의 전제가 깨졌다');
  const finder = bs.candidates[0];

  const res = findACornerMarkerHypotheses(luma, finder, [encoded.k], {});
  const rejected = (res.detail || res.diagnostics || {}).rejected || [];
  const ids = rejected.map((r) => r.hypothesisId).concat(
    (res.ok ? res.hypotheses : []).map((h) => h.hypothesisId),
  );

  // ① 구조 — 턴 변형이 실제로 평가된다. 이게 없으면 180° 배치는 원리적으로 안 보인다.
  assert.ok(ids.some((id) => typeof id === 'string' && id.endsWith('-turn')),
    '턴 변형 후보가 아예 생성되지 않았다 — 검출기가 다시 0°/120°/240° 만 본다');

  // ② 방향 — 턴 쪽이 정립 쪽보다 확실히 높다 (사상이 맞다는 값의 증거).
  const best = (id) => {
    const hit = rejected.filter((r) => r.hypothesisId === id && Number.isFinite(r.agreement));
    return hit.length ? hit[0].agreement : null;
  };
  const turnScore = best(`tri-marker-${encoded.k}-0-turn`);
  const uprightScore = best(`tri-marker-${encoded.k}-0`);
  assert.ok(turnScore !== null, '턴 후보의 agreement 가 진단에 없다');
  assert.ok(turnScore > (uprightScore ?? 0),
    `턴(${turnScore}) 이 정립(${uprightScore}) 보다 높아야 한다 — 좌표 사상이 맞는 방향인지의 자다`);

  // ③ 알려진 공백 — 아직 통과하지 못한다. 값은 실측(49/63 ≈ 0.7778)이다.
  //    톤 분류가 코너 묶음별(NO2 는 묶음당 2셀 = 6슬롯)이라 dark/bright 앵커가 못 선다.
  //    전체 6셀(18슬롯)로 풀링하면 18/18 → 63/63 이 된다 (F-111 · agy·grok·codex 3중 확인).
  assert.equal(res.ok, false,
    'V-CM 턴이 게이트를 넘었다 — F-111 이 해소됐다면 이 테스트를 의도적으로 갱신하라');
  assert.ok(turnScore > 0.77 && turnScore < 0.78,
    `턴 agreement 실측 이탈: ${turnScore} (기대 0.7778 부근 · 게이트 0.78)`);
});
