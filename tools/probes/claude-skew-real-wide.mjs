/**
 * claude-skew-real-wide.mjs — **초광각 3장**에 표준 6장과 **같은 깔때기 회계**를 건다.
 *
 * 표준 세트(`claude-skew-real-sweep.mjs` + `-crops.mjs`)와 동일한 조건 격자:
 *   스윕  : {live960, live1440, whole} × {lab, stable}
 *   크롭  : zoom 1.2 @{960,1440,2160} · 1.5 @{640,960,1440} · 2.0 @{960,1440,2160} × lab
 * 즉 사진당 lab 조건 10개(whole 1 + 크롭 9) — §1.5 표와 셀이 1:1 대응한다.
 *
 * 크롭 창은 `claude-skew-real-wide-locate.py` 산출(= 디코더 독립 국소화기)의 bbox 다.
 * 진단 전용 · src 무수정 · 결정적(난수 없음).
 *
 * 사용: node tools/probes/claude-skew-real-wide.mjs --out <json> [--filter box]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeOnce } from './claude-skew-real-sweep.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PHOTO_DIR = join(ROOT, 'test', 'output', 'photos', 'skew-wide-20260816');
const FRAME_DIR = join(PHOTO_DIR, '_frames');
const LANES = join(ROOT, 'test', 'output', 'lanes');
const PY = join(ROOT, 'tools', 'probes', 'claude-skew-real-jpeg.py');

export const WIDE_PHOTOS = [
  { id: 'w00', file: 'KakaoTalk_20260816_133329976.jpg' },
  { id: 'w01', file: 'KakaoTalk_20260816_133329976_01.jpg' },
  { id: 'w02', file: 'KakaoTalk_20260816_133329976_02.jpg' },
];

/** 국소화기 JSON 에서 크롭 창을 읽는다 (손으로 박지 않는다 — 재현 가능해야 한다). */
export function wideBox(id) {
  const path = join(LANES, `claude-skew-real-loc_${id}.json`);
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const [x0, y0, x1, y1] = d.bbox;
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    side: Math.max(x1 - x0, y1 - y0),
  };
}

export function wideFrame(photo, mode, filter = 'box') {
  mkdirSync(FRAME_DIR, { recursive: true });
  const safe = mode.replace(/[^A-Za-z0-9]/g, '_');
  const out = join(FRAME_DIR, `${photo.id}.${safe}.${filter}.rgba`);
  if (!existsSync(out)) {
    execFileSync('python', [PY, join(PHOTO_DIR, photo.file), out, mode, '--filter', filter],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return out;
}

const CROP_GRID = [
  { zoom: 1.2, targets: [960, 1440, 2160] },
  { zoom: 1.5, targets: [640, 960, 1440] },
  { zoom: 2.0, targets: [960, 1440, 2160] },
];

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (basename(process.argv[1]) === 'claude-skew-real-wide.mjs') {
  const filter = arg('--filter', 'box');
  const outPath = arg('--out', join(LANES, 'claude-skew-real-wide.json'));
  const rows = [];
  const log = (row, head) => {
    rows.push(row);
    console.log(`${head} → ${row.ok ? 'OK ' + JSON.stringify(row.text) : row.reason}`
      + ` | cubeHyp=${row.cube?.hypothesisCount} hyp=${row.geometryHypothesisCount}`
      + ` fmtProp=${row.format?.formatProposalCount} fmtCand=${row.format?.formatCandidateCount}`
      + ` | pose=${JSON.stringify(row.csBlockLocator?.poseCount ?? null)}`
      + ` | v0=${JSON.stringify((row.layouts || []).find((l) => l.layoutId === 'v0') ?? null)}`
      + ` | ${row.ms}ms`);
    writeFileSync(outPath, JSON.stringify(rows, null, 1));
  };

  for (const photo of WIDE_PHOTOS) {
    for (const mode of ['live960', 'live1440', 'whole']) {
      const framePath = wideFrame(photo, mode, filter);
      for (const opt of ['lab', 'stable']) {
        const row = { photo: photo.id, kind: 'sweep', mode, filter, opt,
          ...decodeOnce(framePath, { stable: opt === 'stable' }) };
        log(row, `${photo.id} ${mode} ${opt} ${row.width}x${row.height}`);
      }
    }
    const box = wideBox(photo.id);
    for (const { zoom, targets } of CROP_GRID) {
      const side = box.side * zoom;
      const x = box.cx - side / 2;
      const y = box.cy - side / 2;
      for (const target of targets) {
        const mode = `box${target}@${x.toFixed(1)},${y.toFixed(1)},${side.toFixed(1)}`;
        const framePath = wideFrame(photo, mode, filter);
        const row = { photo: photo.id, kind: 'crop', zoom, target, mode, filter, opt: 'lab',
          box: { ...box }, ...decodeOnce(framePath, { stable: false }) };
        log(row, `${photo.id} zoom${zoom} @${target} lab`);
      }
    }
  }
  console.log(`\n${rows.length} rows → ${outPath}`);
}
