/**
 * cellSurface-soft-probe.test.js — 톤 커브 왜곡(실사 재현 조건)에서 셀 표면 «수용 체인» 회귀.
 *
 * 2026-08-15 실기기 207프레임: cs_reason='no-geometry' 142건은
 *   ① 실루엣 하드체크(diagonal-concurrency·y-junction) 전멸로 CS 평가가 실행조차 안 됐고,
 *   ② 파인더 우선 경로가 실행한 CS 평가 기록은 실패 리턴에서 통째로 버려져 오보됐다.
 * 합성 S-커브/감마가 같은 시그니처를 재현한다 (배포 커밋 6db55dc 기준
 * `frontend:no-format-candidate · cs_reason=no-geometry`).
 *
 * 이 테스트가 고정하는 것:
 *   1. 평가 도달 — 톤 커브 왜곡 프레임에서 cs probe 가 no-geometry 로 남지 않는다
 *      (소프트 CS 탐침 + 파인더 reports 보존).
 *   2. 수용·복호 — v2r2 S-커브는 복호까지, v0 S-커브는 CS 수용까지 간다.
 *   3. 무왜곡 수용은 그대로다 (소프트 탐침은 CS 시도 0회일 때만 돈다).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { extractCellSurfaceProbe } from '../src/lab-telemetry.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';

function renderFinal(text, {
  layout, version, tones = 2, pixelsPerUnit = 10, margin = 4,
} = {}) {
  const encoded = encodeY(text, {
    cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

/** 실기기 프레임 근사 — raster 를 960×960 프레임 중앙에 배경색으로 붙인다. */
function embed960(raster) {
  const W = 960;
  const H = 960;
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let index = 0; index < W * H; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

/**
 * **드랍 복원 스위치** (운영자 확정 2026-08-16 «v2r2 · v1r2 실험판 드랍»).
 * 이 파일이 재는 것은 «소프트 CS 탐침» 축이라 v2r2 픽스처를 스위치로 되살린다
 * (차단·비삭제). 게이트는 한 값도 안 건드렸다.
 */
const RESTORE_DROPPED = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  calibration: { csBlockLocator: { v2r2Family: true, v1r2Family: true } },
});

function decodeLab(frame, extra = undefined) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: {
          enableLocatorY: true,
          enableCellSurfaceY: true,
          ...(extra === undefined ? {} : extra),
        },
      },
    },
  });
}

test('S-커브 왜곡 v2r2@21 — 소프트 CS 탐침으로 수용·복호까지 간다 (드랍 복원)', {
  timeout: 300_000,
}, () => {
  const frame = distortImage(
    embed960(renderFinal(PAYLOAD, { layout: 'v2r2', version: 1, pixelsPerUnit: 15 })),
    { sCurve: 0.6, fill: FILL },
  );
  const result = decodeLab(frame, RESTORE_DROPPED);
  assert.equal(result.ok, true, 'v2r2 S-커브 복호: ' + result.reason);
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurface, true);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v2r2');
});

test('S-커브 왜곡 v0@13 — CS 평가가 도달하고 수용된다', { timeout: 300_000 }, () => {
  const frame = distortImage(
    embed960(renderFinal(PAYLOAD, { layout: 'v0', version: 0, pixelsPerUnit: 17 })),
    { sCurve: 0.6, fill: FILL },
  );
  const result = decodeLab(frame);
  const probe = extractCellSurfaceProbe(result);
  assert.equal(probe.attempted, true);
  // 수용 체인의 핵심 회귀 — 평가가 실행되고 v0 레이아웃으로 수용된다.
  // (body RS 복호까지의 단언은 cellSurface-block-locator.test.js 가 고정한다.)
  assert.equal(probe.accepted, true, 'cs probe: ' + JSON.stringify(probe));
  assert.equal(probe.layoutId, 'v0');
});

test('감마 0.7 v0@13 — no-geometry 오보가 사라지고 실제 거절 사유가 남는다', {
  timeout: 300_000,
}, () => {
  const frame = distortImage(
    embed960(renderFinal(PAYLOAD, { layout: 'v0', version: 0, pixelsPerUnit: 17 })),
    { gamma: 0.7, fill: FILL },
  );
  const result = decodeLab(frame);
  const probe = extractCellSurfaceProbe(result);
  assert.equal(probe.attempted, true);
  // 평가는 실행됐다 — «평가 미도달» 로 위장하지 않는다.
  assert.notEqual(probe.reason, 'no-geometry', JSON.stringify(probe));
});

test('무왜곡 v0/v2r2 수용은 소프트 탐침 도입 후에도 그대로다 (v2r2 는 드랍 복원)', {
  timeout: 300_000,
}, () => {
  for (const cfg of [
    { layout: 'v0', version: 0, pixelsPerUnit: 17 },
    { layout: 'v2r2', version: 1, pixelsPerUnit: 15 },
  ]) {
    const result = decodeLab(
      embed960(renderFinal(PAYLOAD, cfg)),
      cfg.layout === 'v2r2' ? RESTORE_DROPPED : undefined,
    );
    assert.equal(result.ok, true, cfg.layout + ': ' + result.reason);
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, cfg.layout);
  }
});
