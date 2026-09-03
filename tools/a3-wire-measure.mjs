/**
 * a3-wire-measure.mjs — y0/y1/y2/y2-p9rot 실물 휘도 덤프에서
 * 로케이터 shape · H · F · aimError · align ms 를 잰다.
 * 대조군으로 네 시퀀스 전부 단발 decodeFrontend.
 *
 * 사용:
 *   node tools/a3-wire-measure.mjs
 *   node tools/a3-wire-measure.mjs y0 y1 --out test/output/a3-wire-measure-y0-y1.json
 *   node tools/a3-wire-measure.mjs --label fix --out test/output/a3-wire-measure-fix.json
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataCellsInScanOrderCellSurfaceFinal } from '../src/cellSurfaceFinal.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  GRID_LOCK_PEAK_F,
  createA3Adapters,
} from '../src/r2/adapter-locator.js';
import { lumaToRaster, readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LABELS_PATH = join(ROOT, 'tools', 'a3-wire-labels.json');
const LABELS = JSON.parse(readFileSync(LABELS_PATH, 'utf8'));

const SEQUENCES = Object.freeze(
  Object.entries(LABELS.sequences).map(([name, spec]) => Object.freeze({
    name,
    n: spec.n,
    layoutId: spec.layoutId,
    cx: spec.cx,
    cy: spec.cy,
    R: spec.R,
    dir: spec.dir,
    framesExpected: spec.framesExpected,
    control: true,
  })),
);

const AIM_ERROR_MAX = Number(LABELS.aimErrorMax) > 0 ? Number(LABELS.aimErrorMax) : 0.25;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = (sorted.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return (sorted[lo] + sorted[hi]) / 2;
}

function listFrames(relDir) {
  const dir = join(ROOT, 'test', 'output', 'photos', 'luma', relDir);
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.luma'))
    .sort();
  return names.map((name) => join(dir, name));
}

function summarize(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: median(sorted),
    p90: percentile(sorted, 0.9),
    max: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

function centerOfH(H) {
  const w = H[6] * 0 + H[7] * 0 + H[8];
  if (!Number.isFinite(w) || w === 0) return { x: NaN, y: NaN };
  return { x: H[2] / w, y: H[5] / w };
}

function measureSequence(seq) {
  const paths = listFrames(seq.dir);
  const adapters = createA3Adapters({
    n: seq.n,
    relocateEveryFrame: true,
  });
  const cellCount = dataCellsInScanOrderCellSurfaceFinal(seq.n, seq.layoutId).length;
  const detection = { found: 0, family: 0 };
  const alignment = {
    gatePassed: 0,
    weightQ15: 0,
    mismatchCount: 0,
    matchCount: 0,
    visibleCount: 0,
  };
  const faceLuma = new Uint16Array(cellCount * 3);
  const visibleCells = new Uint8Array(cellCount);
  const frames = [];
  const hasTruth = Number.isFinite(seq.cx) && Number.isFinite(seq.cy) && Number.isFinite(seq.R) && seq.R > 0;

  for (let i = 0; i < paths.length; i += 1) {
    const luma = readLumaDump(paths[i]);
    detection.found = 0;
    detection.family = 0;
    adapters.detectInto(
      luma.data, luma.width, luma.height, i, null, detection,
    );
    const shapeOk = adapters.stats.shapeCount > 0 ? 1 : 0;
    const hOk = detection.found ? 1 : 0;
    let f = 0;
    let alignMs = 0;
    let visibleCount = 0;
    let scanMapped = 0;
    let cx = NaN;
    let cy = NaN;
    let aimError = null;
    if (hOk) {
      adapters.alignInto(
        luma.data, luma.width, luma.height, i, null,
        detection, alignment, faceLuma, visibleCells,
      );
      f = adapters.stats.gridLockF;
      alignMs = adapters.stats.lastAlignMs;
      visibleCount = alignment.visibleCount;
      scanMapped = adapters.stats.scanMapped;
      const c = centerOfH(adapters.H);
      cx = c.x;
      cy = c.y;
      if (hasTruth && Number.isFinite(cx) && Number.isFinite(cy)) {
        aimError = Math.hypot(cx - seq.cx, cy - seq.cy) / seq.R;
      }
    }
    const nMatch = hOk && adapters.stats.n === seq.n ? 1 : 0;
    const aimed = (
      hOk
      && nMatch
      && aimError !== null
      && aimError <= AIM_ERROR_MAX
    ) ? 1 : 0;
    frames.push({
      name: basename(paths[i]),
      shapeOk,
      hOk,
      F: f,
      alignMs,
      detectMs: adapters.stats.lastDetectMs,
      n: adapters.stats.n,
      layoutId: adapters.stats.layoutId,
      visibleCount: hOk ? visibleCount : 0,
      scanMapped,
      cx,
      cy,
      aimError,
      nMatch,
      aimed,
    });
    if ((i + 1) % 20 === 0 || i + 1 === paths.length) {
      console.error(`[${seq.name}] ${i + 1}/${paths.length}`);
    }
  }

  const shapeOk = frames.reduce((s, fr) => s + fr.shapeOk, 0);
  const hOk = frames.reduce((s, fr) => s + fr.hOk, 0);
  const fVals = frames.filter((fr) => fr.hOk).map((fr) => fr.F);
  const msVals = frames.filter((fr) => fr.hOk).map((fr) => fr.alignMs);
  const aimVals = frames.map((fr) => fr.aimError).filter((v) => Number.isFinite(v));
  const cxVals = frames.map((fr) => fr.cx).filter((v) => Number.isFinite(v));
  const cyVals = frames.map((fr) => fr.cy).filter((v) => Number.isFinite(v));
  const fSum = summarize(fVals);
  const msSum = summarize(msVals);
  const aimSum = summarize(aimVals);
  const peaks = fVals.filter((v) => v >= GRID_LOCK_PEAK_F).length;
  const nMatch = frames.reduce((s, fr) => s + fr.nMatch, 0);
  const aimed = frames.reduce((s, fr) => s + fr.aimed, 0);
  const scanMapped = frames.reduce((s, fr) => s + (fr.scanMapped ? 1 : 0), 0);

  return {
    name: seq.name,
    n: seq.n,
    layoutId: seq.layoutId,
    truth: { cx: seq.cx, cy: seq.cy, R: seq.R, n: seq.n },
    cellCount,
    frameCount: paths.length,
    framesExpected: seq.framesExpected,
    shapeOk,
    hOk,
    F: fSum,
    alignMs: msSum,
    aimError: aimSum,
    pickCenter: {
      cxMedian: median([...cxVals].sort((a, b) => a - b)),
      cyMedian: median([...cyVals].sort((a, b) => a - b)),
    },
    peaks,
    nMatch,
    nMatchRate: paths.length ? nMatch / paths.length : 0,
    aimed,
    aimedRate: paths.length ? aimed / paths.length : 0,
    scanMapped,
    frames,
    control: seq.control,
  };
}

function controlFrontend(seqResult, limit) {
  const hits = [];
  const dir = SEQUENCES.find((s) => s.name === seqResult.name).dir;
  const paths = listFrames(dir);
  const cap = limit === undefined ? paths.length : Math.min(limit, paths.length);
  for (let i = 0; i < cap; i += 1) {
    const luma = readLumaDump(paths[i]);
    let ok = 0;
    let family = '';
    let text = '';
    try {
      const decoded = decodeFrontend(lumaToRaster(luma));
      if (decoded && decoded.ok) {
        ok = 1;
        family = decoded.family || '';
        text = typeof decoded.text === 'string' ? decoded.text.slice(0, 80) : '';
      }
    } catch (error) {
      family = 'throw:' + (error && error.message ? error.message : String(error));
    }
    if (ok) {
      hits.push({
        index: i,
        name: seqResult.frames[i].name,
        family,
        text,
        F: seqResult.frames[i].F,
        hOk: seqResult.frames[i].hOk,
        shapeOk: seqResult.frames[i].shapeOk,
        aimError: seqResult.frames[i].aimError,
        n: seqResult.frames[i].n,
        aimed: seqResult.frames[i].aimed,
      });
    }
    if ((i + 1) % 10 === 0 || i + 1 === cap) {
      console.error(`[${seqResult.name} frontend] ${i + 1}/${cap} hits=${hits.length}`);
    }
  }
  return hits;
}

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const skipControl = argv.includes('--no-control');
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--out' || argv[i] === '--label') {
    i += 1;
    continue;
  }
  if (argv[i].startsWith('--')) continue;
  positional.push(argv[i]);
}
const selected = positional.length
  ? SEQUENCES.filter((seq) => positional.includes(seq.name))
  : SEQUENCES;

const label = flag('label', selected.length === SEQUENCES.length ? 'all' : selected.map((s) => s.name).join('-'));
const defaultOut = join(ROOT, 'test', 'output', 'a3-wire-measure-' + label + '.json');
const outFlag = flag('out', defaultOut);
const jsonPath = isAbsolute(outFlag) ? outFlag : resolve(ROOT, outFlag);

const out = {
  peakF: GRID_LOCK_PEAK_F,
  aimErrorMax: AIM_ERROR_MAX,
  labels: LABELS_PATH,
  sequences: [],
  control: {},
};
for (const seq of selected) {
  if (!Number.isFinite(seq.cx) || !Number.isFinite(seq.cy) || !Number.isFinite(seq.R)) {
    throw new Error(seq.name + ' 참 중심·반경 라벨이 비어 있다 — tools/a3-wire-labels.json 을 채워라');
  }
  console.error('sequence ' + seq.name);
  out.sequences.push(measureSequence(seq));
}

if (!skipControl) {
  for (const seq of out.sequences) {
    console.error('control ' + seq.name);
    out.control[seq.name] = controlFrontend(seq);
  }
}

mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  peakF: out.peakF,
  aimErrorMax: out.aimErrorMax,
  out: jsonPath,
  sequences: out.sequences.map((seq) => ({
    name: seq.name,
    frameCount: seq.frameCount,
    cellCount: seq.cellCount,
    shapeOk: seq.shapeOk,
    hOk: seq.hOk,
    Fmedian: seq.F.median,
    Fp90: seq.F.p90,
    Fmax: seq.F.max,
    peaks: seq.peaks,
    alignMsMedian: seq.alignMs.median,
    aimErrorMedian: seq.aimError.median,
    pickCx: seq.pickCenter.cxMedian,
    pickCy: seq.pickCenter.cyMedian,
    nMatchRate: seq.nMatchRate,
    aimed: seq.aimed,
    aimedRate: seq.aimedRate,
    scanMapped: seq.scanMapped,
    truth: seq.truth,
  })),
  control: Object.fromEntries(
    Object.entries(out.control).map(([name, hits]) => [name, {
      count: hits.length,
      F: hits.map((h) => ({
        name: h.name, family: h.family, F: h.F, hOk: h.hOk, aimError: h.aimError, aimed: h.aimed,
      })),
    }]),
  ),
}, null, 2));
console.error('wrote ' + jsonPath);
