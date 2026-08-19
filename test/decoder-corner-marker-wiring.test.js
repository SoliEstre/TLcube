/**
 * decoder-corner-marker-wiring.test.js — O-CM 이 **파이프라인에서 실제로 열리는가**.
 *
 * `decoder-corner-marker.test.js` 는 모듈을 직접 부른다. 그 테스트가 전부 초록인
 * 채로 `corner-marker-detect.js` 는 **프로덕션 소비자가 0** 이었다 (2026-08-19 실측:
 * src/ 102 모듈 중 소비자 0 인 5개 중 하나). 도입 커밋이 스스로 «배선은 통합자 몫»
 * 이라 적어 두고 그대로 남아 있었다.
 *
 * 그래서 이 파일은 **모듈이 아니라 배선**을 잰다 — `directAnchorHypotheses` 가
 * 앵커 실패 시 코너 마커로 넘어가는가.
 *
 * 고정하는 것:
 *   ① 앵커가 사는 프레임에서는 **경로가 안 바뀐다** (source 는 여전히 anchor-detector).
 *      이 배선의 안전 조건이다 — 지금 통과하는 프레임의 선택을 못 바꾼다.
 *   ② 앵커가 죽는 원근에서 **코너 마커가 구조한다** (source: corner-marker).
 *   ③ 마커 **없이** 인코드한 심볼은 같은 원근에서 코너 마커를 만들지 않는다
 *      (배선이 마커를 «발명» 하면 안 된다).
 *   ④ 코너 마커에도 **한계가 있다** — 더 센 원근에서는 0. 「항상 된다」고 적지 않는다.
 *
 * ⚠ 이 회귀는 변이 검증을 했다: `directAnchorHypotheses` 의 코너 마커 분기를
 *   지우면 ②가 빨개진다. 그걸 눈으로 보고 커밋했다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset, relativeLuminance,
} from '../src/luminance.js';
import { findOAnchorHypotheses } from '../src/decoder/anchor-detect.js';
import { directAnchorHypotheses } from '../src/decoder/bootstrap.js';
import { FRONTEND_FAILURE } from '../src/decoder/contracts.js';

const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};
const BACKGROUND = relativeLuminance(PRESET.background);

// 원근 세기 — probe-warp-split 실측에서 고른 값이다 (아래 표가 근거).
//   g <= 0.0001 앵커 생존 · 0.0002~0.0008 코너 마커가 구조 · 0.0012 둘 다 사망
const WARP_ANCHOR_SURVIVES = 0.0001;
const WARP_MARKER_RESCUES = 0.0004;
const WARP_BEYOND_MARKER = 0.0012;

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let i = 0; i < raster.width * raster.height; i += 1) {
    const offset = i * 4;
    data[i] = relativeLuminance({
      r: raster.pixels[offset],
      g: raster.pixels[offset + 1],
      b: raster.pixels[offset + 2],
    });
  }
  return { width: raster.width, height: raster.height, data, alpha: null };
}

function renderFrame(encoded, cellSize = 20) {
  const scene = buildScene(encoded, { palette: PALETTE, cellSize });
  const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: 4 });
  return {
    luma: rasterToLuma(raster),
    center: { x: scene.layout.originX, y: scene.layout.originY },
    finder: {
      center: { x: scene.layout.originX, y: scene.layout.originY },
      cellSize,
      score: 1,
      hardChecksPassed: true,
    },
  };
}

/** 중심 고정 원근 왜곡 — `decoder-corner-marker.test.js` 의 warpLuma 와 같은 식. */
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
  return { width: source.width, height: source.height, data, alpha: null };
}

const MARKED = renderFrame(encode('TLcube-O-CM-wiring', {
  version: 2, eccLevel: 'M', cornerMarker: true,
}));
const PLAIN = renderFrame(encode('TLcube-O-plain-wiring', {
  version: 2, eccLevel: 'M',
}));

function warped(frame, g) {
  return g === 0 ? frame.luma : warpLuma(frame.luma, frame.center, g, g * 0.6);
}
function sourcesOf(frame, g) {
  const result = directAnchorHypotheses(warped(frame, g), frame.finder, 'hex', {});
  return {
    sources: new Set(result.hypotheses.map((h) => h.source)),
    count: result.hypotheses.length,
    strictCount: result.strictCount,
    hypotheses: result.hypotheses,
  };
}

test('① 앵커가 사는 프레임에서는 경로가 안 바뀐다 — 코너 마커는 열리지 않는다', () => {
  for (const g of [0, WARP_ANCHOR_SURVIVES]) {
    const anchor = findOAnchorHypotheses(warped(MARKED, g), MARKED.finder, [6, 8, 10], {});
    assert.equal(anchor.ok, true, 'g=' + g + ': 앵커가 살아 있어야 이 검사가 의미를 갖는다');
    const { sources, count } = sourcesOf(MARKED, g);
    assert.ok(count > 0, 'g=' + g + ': 가설이 있어야 한다');
    assert.deepEqual([...sources], ['anchor-detector'],
      'g=' + g + ': 앵커가 사는데 다른 경로가 섞였다 — 이 배선은 순증이어야 한다');
  }
});

test('② 앵커가 죽는 원근에서 코너 마커가 구조한다', () => {
  const anchor = findOAnchorHypotheses(
    warped(MARKED, WARP_MARKER_RESCUES), MARKED.finder, [6, 8, 10], {},
  );
  assert.equal(anchor.ok, false, '이 원근에서는 앵커가 죽어야 전제가 성립한다');
  assert.equal(anchor.reason, FRONTEND_FAILURE.NO_ANCHORS);

  const { sources, count, strictCount, hypotheses } = sourcesOf(MARKED, WARP_MARKER_RESCUES);
  assert.ok(count > 0,
    '앵커가 죽은 자리에서 코너 마커가 아무것도 못 냈다 — 배선이 끊겼는지 보라');
  assert.deepEqual([...sources], ['corner-marker']);
  assert.equal(strictCount, count, '코너 마커는 확인(confirm)까지 통과한 것만 온다 — strict 로 센다');
  // 하류가 읽는 필드가 실제로 채워져 있는가 (모양만 맞고 값이 없으면 조용히 깨진다).
  for (const h of hypotheses) {
    assert.equal(h.family, 'hex', '계보는 파이프라인 값이어야 한다 (hex-marker 가 새면 안 된다)');
    assert.ok(Array.isArray(h.anchors) && h.anchors.length === 3, '앵커 3점이 투영돼 있어야 한다');
    assert.ok(h.anchors.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.equal(h.anchorEvidence.mode, 'corner-marker');
    assert.ok(h.anchorEvidence.confirmAgreement > 0, 'confirm 점수가 실려 있어야 한다');
  }
});

test('③ 마커 없이 인코드한 심볼은 코너 마커를 만들지 않는다', () => {
  const anchor = findOAnchorHypotheses(
    warped(PLAIN, WARP_MARKER_RESCUES), PLAIN.finder, [6, 8, 10], {},
  );
  assert.equal(anchor.ok, false, '같은 원근이면 평범한 O 도 앵커가 죽는다');
  const { sources } = sourcesOf(PLAIN, WARP_MARKER_RESCUES);
  assert.equal(sources.has('corner-marker'), false,
    '마커가 없는 심볼에서 코너 마커 가설이 나왔다 — 배선이 마커를 발명하고 있다');
});

test('④ 코너 마커에도 한계가 있다 — 더 센 원근에서는 0', () => {
  const { count } = sourcesOf(MARKED, WARP_BEYOND_MARKER);
  assert.equal(count, 0,
    'g=' + WARP_BEYOND_MARKER + ' 에서 가설이 나왔다 — 한계가 옮겨졌으면 상수를 다시 재고 적어라');
});
