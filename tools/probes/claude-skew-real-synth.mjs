/**
 * claude-skew-real-synth.mjs — 실사진에서 **실측한 기울기 각**을 합성 하네스에 그대로
 * 넣어 통과율을 대조한다 (실사-합성 간극 귀속용). src 무수정 · 결정적.
 *
 * 실사와 맞춘 조건: 레이아웃 v0(n=13) · **3톤** (p04 성공 가설의 tones=3) ·
 * ECC M · payload 'https://tl.estre.so' (p04·p03 이 실제로 복호한 문자열) ·
 * cell_px 는 사진에서 잰 값 근처(22·30) · lab 옵션(enableLocatorY+enableCellSurfaceY).
 *
 * 사용: node tools/probes/claude-skew-real-synth.mjs [--out json]
 */

import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../src/luminance.js';
import { applySCurve, cameraTiltImage, applyJpegApproximation } from '../../test/harness/distort.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
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
const MARGIN = 20;

const cache = new Map();
function baseRaster(tones, ppu) {
  const key = `${tones}/${ppu}`;
  if (!cache.has(key)) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v0', version: 0, tones, eccLevel: 'M',
    });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: MARGIN });
    cache.set(key, rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
  }
  return cache.get(key);
}

function run(tones, ppu, theta, axis, toneMode, jpegQuality) {
  let image = baseRaster(tones, ppu);
  if (theta !== 0) {
    image = cameraTiltImage(image, theta, { axis, distanceRatio: 4, fill: FILL });
  }
  if (toneMode !== 'none') image = applySCurve(image, Number(toneMode.slice(1)));
  if (jpegQuality) image = applyJpegApproximation(image, jpegQuality);
  const t0 = Date.now();
  let result;
  try {
    result = decodeFrontend(image, {
      bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
    });
  } catch (error) {
    return { ok: false, reason: 'threw:' + error.message, ms: Date.now() - t0 };
  }
  return {
    ok: result.ok === true && result.text === PAYLOAD,
    reason: result.ok ? null : result.reason,
    pipelineCode: result.detail && result.detail.pipelineCode,
    width: image.width,
    ms: Date.now() - t0,
  };
}

if (basename(process.argv[1]) === 'claude-skew-real-synth.mjs') {
  // 사진에서 실측한 각 (claude-skew-real-tilt.py) + 격자 보간용 몇 점
  const thetas = [0, 11, 15, 20, 23, 25, 29, 35, 40, 45, 51, 53, 55];
  const axes = ['horizontal', 'vertical', 'diagonal'];
  const rows = [];
  for (const tones of [3, 2]) {
    for (const ppu of [22, 30]) {
      for (const toneMode of ['none', 's0.6']) {
        for (const axis of axes) {
          for (const theta of thetas) {
            if (theta === 0 && axis !== 'horizontal') continue;
            const out = run(tones, ppu, theta, axis, toneMode, 0);
            rows.push({ tones, ppu, toneMode, axis, theta, ...out });
            console.log(`t${tones} ppu${ppu} ${toneMode} ${axis} θ${theta} → ${out.ok ? 'OK' : out.reason} (${out.ms}ms)`);
          }
        }
      }
    }
  }
  const outPath = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : join(ROOT, 'test', 'output', 'lanes', 'claude-skew-real-synth.json');
  writeFileSync(outPath, JSON.stringify(rows, null, 1));
  console.log(`\n${rows.length} rows → ${outPath}`);
}
