/**
 * claude-skew-real-sweep.mjs — 실사진 6장 × 프레임 모드 × 옵션셋 깔때기 스윕.
 *
 * 진단 전용 · src 무수정 · 결정적(난수 없음). JPEG 디코드는 Pillow(파이썬 보조
 * 스크립트)가 하고, 휘도 변환부터는 프로덕션과 같은 모듈이 한다.
 *
 * 사용:
 *   node tools/probes/claude-skew-real-sweep.mjs --out <results.json> [--modes a,b] [--photos 0,3]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRgba, funnel } from './claude-skew-real-frontend.mjs';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PHOTO_DIR = join(ROOT, 'test', 'output', 'photos', 'skew-20260816');
const FRAME_DIR = join(ROOT, 'test', 'output', 'photos', 'skew-20260816', '_frames');
const PY = join(ROOT, 'tools', 'probes', 'claude-skew-real-jpeg.py');

export const PHOTOS = [
  { id: 'p00', file: 'KakaoTalk_20260816_110225527.jpg' },
  { id: 'p01', file: 'KakaoTalk_20260816_110225527_01.jpg' },
  { id: 'p02', file: 'KakaoTalk_20260816_110225527_02.jpg' },
  { id: 'p03', file: 'KakaoTalk_20260816_110225527_03.jpg' },
  { id: 'p04', file: 'KakaoTalk_20260816_110225527_04.jpg' },
  { id: 'p05', file: 'KakaoTalk_20260816_110225527_05.jpg' },
];

export function frameFor(photo, mode, filter = 'box') {
  mkdirSync(FRAME_DIR, { recursive: true });
  const safe = mode.replace(/[^A-Za-z0-9]/g, '_');
  const out = join(FRAME_DIR, `${photo.id}.${safe}.${filter}.rgba`);
  if (!existsSync(out)) {
    execFileSync('python', [PY, join(PHOTO_DIR, photo.file), out, mode, '--filter', filter],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return out;
}

export function decodeOnce(framePath, { stable = false } = {}) {
  const raster = readRgba(framePath);
  const t0 = Date.now();
  let result;
  try {
    result = decodeFrontend(raster, {
      bootstrap: { family: { cube: { enableLocatorY: !stable, enableCellSurfaceY: !stable } } },
    });
  } catch (error) {
    return { width: raster.width, height: raster.height, ms: Date.now() - t0, threw: String(error && error.message) };
  }
  return { width: raster.width, height: raster.height, ms: Date.now() - t0, ...funnel(result) };
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (basename(process.argv[1]) === 'claude-skew-real-sweep.mjs') {
  const modes = arg('--modes', 'live960,live1440,whole').split(',');
  const only = arg('--photos', '').split(',').filter(Boolean);
  const optionSets = arg('--opts', 'lab,stable').split(',');
  const filter = arg('--filter', 'box');
  const outPath = arg('--out', join(ROOT, 'test', 'output', 'lanes', 'claude-skew-real-results.json'));
  const rows = [];
  for (const photo of PHOTOS) {
    if (only.length > 0 && !only.includes(photo.id)) continue;
    for (const mode of modes) {
      const framePath = frameFor(photo, mode, filter);
      for (const opt of optionSets) {
        const row = { photo: photo.id, mode, filter, opt, ...decodeOnce(framePath, { stable: opt === 'stable' }) };
        rows.push(row);
        const layouts = (row.layouts || []).map((l) => `${l.layoutId}:${l.accepted}/${l.attempted}`).join(' ');
        console.log(
          `${photo.id} ${mode} ${opt} ${row.width}x${row.height} → ${row.ok ? 'OK ' + JSON.stringify(row.text) : row.reason}`
          + ` | hyp=${row.geometryHypothesisCount} fmtProp=${row.format?.formatProposalCount} fmtCand=${row.format?.formatCandidateCount}`
          + ` | pose=${JSON.stringify(row.csBlockLocator?.poseCount ?? null)} | ${layouts} | ${row.ms}ms`,
        );
        writeFileSync(outPath, JSON.stringify(rows, null, 1));
      }
    }
  }
  console.log(`\n${rows.length} rows → ${outPath}`);
}
