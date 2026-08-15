// probe-square-timing.mjs — r3 «target ≤ 960 사전 축소 유지 여부» 결정용 실측.
//
// 질문: 정사각 grab 을 센서 네이티브(1440²)로 올리면 복호 시간이 얼마나 커지는가.
// 스위트 밖 프로브다(타이밍은 환경 의존이라 결정성 요건과 상충) — 결과 JSON 은
// test/output/claude-square-view-timing.json 에 남기고 보고서가 인용한다.
//
// 실행: node test/output/probe-square-timing.mjs (cwd: 워크트리 루트)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encode } from '../../src/encode.js';
import { buildScene } from '../../src/scene.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../src/luminance.js';
import { cropWindow } from '../../src/scanner-zoom.js';

const OUT = fileURLToPath(new URL('./claude-square-view-timing.json', import.meta.url));
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function padRaster(raster, width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = PRESET.background.r;
    pixels[i + 1] = PRESET.background.g;
    pixels[i + 2] = PRESET.background.b;
    pixels[i + 3] = 255;
  }
  const ox = Math.floor((width - raster.width) / 2);
  const oy = Math.floor((height - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const si = (y * raster.width + x) * 4;
      const di = ((y + oy) * width + (x + ox)) * 4;
      pixels[di] = raster.pixels[si];
      pixels[di + 1] = raster.pixels[si + 1];
      pixels[di + 2] = raster.pixels[si + 2];
      pixels[di + 3] = raster.pixels[si + 3];
    }
  }
  return { width, height, pixels };
}

function applyCrop(raster, crop) {
  const pixels = new Uint8ClampedArray(crop.target * crop.target * 4);
  const scale = crop.sourceSide / crop.target;
  for (let y = 0; y < crop.target; y += 1) {
    const sy = Math.min(raster.height - 1, Math.floor(crop.sourceY + (y + 0.5) * scale));
    for (let x = 0; x < crop.target; x += 1) {
      const sx = Math.min(raster.width - 1, Math.floor(crop.sourceX + (x + 0.5) * scale));
      const si = (sy * raster.width + sx) * 4;
      const di = (y * crop.target + x) * 4;
      pixels[di] = raster.pixels[si];
      pixels[di + 1] = raster.pixels[si + 1];
      pixels[di + 2] = raster.pixels[si + 2];
      pixels[di + 3] = raster.pixels[si + 3];
    }
  }
  return { width: crop.target, height: crop.target, pixels };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// 코드가 프레임의 절반쯤 차는 전형 구도 (셀 픽셀이 하한 위인 정상 시나리오).
const encoded = encode('square-view-timing', { version: 3, eccLevel: 'M' });
const scene = buildScene(encoded, { palette: PALETTE, margin: 2 });
const raster = rasterize(scene, { pixelsPerUnit: 14, supersample: 1 });
const sensor = padRaster(raster, 2560, 1440); // r3 요청 스트림(2560×1440) 가정

const frames = {
  grab960: applyCrop(sensor, cropWindow(2560, 1440, 1, 960)),
  grab1440: applyCrop(sensor, cropWindow(2560, 1440, 1, 1440)),
};

// 웜업 (JIT) — 두 크기 모두.
decodeFrontend(frames.grab960);
decodeFrontend(frames.grab1440);

const report = { note: 'decodeFrontend median ms — square grab 960² vs native 1440² (Node, synthetic)', };
for (const [name, frame] of Object.entries(frames)) {
  const samples = [];
  let ok = null;
  for (let i = 0; i < 7; i += 1) {
    const t0 = performance.now();
    const result = decodeFrontend(frame);
    samples.push(performance.now() - t0);
    ok = result.ok;
  }
  report[name] = {
    side: frame.width,
    ok,
    medianMs: Number(median(samples).toFixed(1)),
    samples: samples.map((n) => Number(n.toFixed(1))),
  };
}
report.ratio1440over960 = Number((report.grab1440.medianMs / report.grab960.medianMs).toFixed(2));

writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
