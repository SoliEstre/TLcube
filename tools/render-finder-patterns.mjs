#!/usr/bin/env node

// 고정된 실험 파인더 8개를 데이터 필드가 둘러싼 Type O 전체 코드 PNG로 렌더한다.
// 파인더만 잘라낸 채점 그림이 아니라 생성기와 같은 scene/raster/png 경로를 통과한다.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { encode } from '../src/encode.js';
import { FINDER_PATTERNS } from '../src/finder-patterns.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { rasterToPng } from '../src/png.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { verifyRaster } from '../src/verify.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'test', 'output', 'finder-patterns');
const PAYLOAD = 'https://tl.estre.so/finder-lab';
const VERSION = 3;
const ECC_LEVEL = 'M';
const PIXELS_PER_UNIT = 18;
const SUPERSAMPLE = 2;

function outputFromArgs(args) {
  const at = args.indexOf('--output');
  if (at < 0) return DEFAULT_OUTPUT;
  if (!args[at + 1]) throw new RangeError('--output 뒤에 경로가 필요하다');
  return path.resolve(args[at + 1]);
}

export async function renderFinderPatternPngs(outputDir = DEFAULT_OUTPUT) {
  const preset = getPreset(DEFAULT_PRESET);
  const palette = Object.freeze({
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  });
  const encoded = encode(PAYLOAD, { version: VERSION, eccLevel: ECC_LEVEL });
  await fs.mkdir(outputDir, { recursive: true });

  const files = [];
  for (let index = 0; index < FINDER_PATTERNS.length; index += 1) {
    const pattern = FINDER_PATTERNS[index];
    const scene = buildScene(encoded, {
      palette,
      finderPatternId: pattern.id,
      cellSize: 1,
      margin: 2,
    });
    const raster = rasterize(scene, {
      pixelsPerUnit: PIXELS_PER_UNIT,
      supersample: SUPERSAMPLE,
    });
    const check = verifyRaster(raster, scene, encoded);
    if (!check.ok) {
      throw new Error(`${pattern.id}: 전체 코드 자체검증 실패 ${JSON.stringify(check.mismatches)}`);
    }
    const png = rasterToPng(raster);
    const fileName = `${String(index + 1).padStart(2, '0')}-${pattern.id}.png`;
    await fs.writeFile(path.join(outputDir, fileName), png);
    files.push({
      id: pattern.id,
      file: fileName,
      width: raster.width,
      height: raster.height,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      selfCheck: { total: check.total, minDelta: check.minDelta },
    });
  }

  const manifest = {
    purpose: 'full Type O codes with data surrounding each experimental finder',
    payload: PAYLOAD,
    version: VERSION,
    eccLevel: ECC_LEVEL,
    preset: DEFAULT_PRESET,
    pixelsPerUnit: PIXELS_PER_UNIT,
    supersample: SUPERSAMPLE,
    files,
  };
  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
  return manifest;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const outputDir = outputFromArgs(process.argv.slice(2));
    const manifest = await renderFinderPatternPngs(outputDir);
    console.log(`실험 파인더 전체 코드 PNG ${manifest.files.length}개: ${outputDir}`);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
