/**
 * probe-false-accept.mjs — 가이드-사전 경로의 **오수용 확률 회계**.
 *
 * 왜 이 프로브가 필요한가 (2026-08-16 적대 검증 ⑤):
 *
 *   사전 경로는 탐색을 건너뛰므로 트리거 **한 번에 540\~744개 기하**가 곧장 포맷 CRC 를
 *   두드린다(탐색 경로는 수 개). 그리고 틀린 기하가 포맷 CRC 를 통과하는 일이 실제로
 *   있다. 즉 오독을 막는 **마지막 벽은 「본문 RS + payload 검증」 단독**이다.
 *   「게이트가 보전됐다」 는 말로는 부족하고, 그 벽이 실제로 얼마나 두꺼운지를 재야 한다.
 *
 * 세 갈래로 잰다.
 *
 *   A. **마지막 벽 직접 측정** — 균일 난수 셀 digit(=틀린 기하가 실제로 뽑아 오는 것)을
 *      `decodeCells()` 에 그대로 넣어 (버전 × ECC) 별로 «RS + payload 통과» 비율을 센다.
 *      기하를 안 거치므로 수백만 시행이 가능하다. 이게 가장 강한 수다.
 *   B. **구조 논증 대조** — RS 잔여 패리티로 계산한 이론 상계
 *      P ≈ V_t(n,q)/q^nsym (반지름 t 해밍 구의 부피 / 패리티 공간)와 A 를 나란히 둔다.
 *      A 가 B 보다 훨씬 작으면 그 차이가 payload 검증(base211·헤더·UTF-8)의 몫이다.
 *   C. **엔드투엔드 트리거 스윕** — 코드 없는 프레임(균일·난수·체커·줄무늬·블러) ·
 *      **QR 프레임** · 오정렬 실물 코드로 수천 트리거를 돌려, 실제로 몇 개 기하가
 *      포맷 CRC 를 통과했고(=마지막 벽을 두드렸고) 그중 몇 개가 뚫렸는지 센다.
 *
 * 실행: `node tools/probes/probe-false-accept.mjs [--triggers N] [--wall N]`
 * (스위트에 포함되지 않는다 — 프로브다. 회귀 단언은 test/scan-guide-prior.test.js.)
 */

import { decodeCells } from '../../src/decode.js';
import { dataCellsInScanOrder } from '../../src/layout.js';
import { dataCellsInScanOrderA } from '../../src/layoutA.js';
import { NSYM_TABLE, errorCapacity } from '../../src/rs211.js';
import { encode } from '../../src/encode.js';
import { encodeA } from '../../src/encodeA.js';
import { encodeY } from '../../src/encodeY.js';
import { buildScene } from '../../src/scene.js';
import { buildSceneY } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { qrMatrix } from '../../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../src/luminance.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import {
  guidePriorPoses, layoutCellPx, PRIOR_LAYOUTS, refineSeedsFrom,
} from '../../src/scan-guide-prior.js';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
};
const TRIGGERS = argOf('--triggers', 2400);
const WALL_TRIALS = argOf('--wall', 200000);

const FRAME_SIDE = 960;
const TEXT = 'tlcube guide prior';
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = { ...PRESET.background, a: 255 };

/** 결정적 PRNG (mulberry32) — 같은 시드면 같은 프레임 열이 나온다. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── A. 마지막 벽 직접 측정 ──────────────────────────────────────────────────

/**
 * 균일 난수 digit 을 `decodeCells` 에 넣는다. 이것이 「틀린 기하가 뽑아 오는 것」 의
 * 가장 정직한 모형이다 — 격자가 코드와 안 맞으면 각 셀의 3면 휘도 순위는 사실상 난수다.
 */
function measureLastWall(spec, trials, random) {
  const digits = new Uint8Array(spec.cellCount);
  let accepted = 0;
  const reasons = new Map();
  for (let trial = 0; trial < trials; trial += 1) {
    for (let index = 0; index < digits.length; index += 1) {
      digits[index] = Math.floor(random() * 6);
    }
    const result = decodeCells(Array.from(digits), spec.format);
    if (result.ok) {
      accepted += 1;
    } else {
      const key = String(result.reason).split(':')[0];
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }
  }
  return { accepted, trials, reasons: Object.fromEntries(reasons) };
}

/** B. RS 잔여 패리티 구조 논증 — 반지름 t 해밍 구 / 패리티 공간. */
function rsResidualBound(n, nsym) {
  const t = errorCapacity(nsym);
  const q = 211n;
  let volume = 0n;
  let binomial = 1n;
  for (let i = 0; i <= t; i += 1) {
    if (i > 0) binomial = (binomial * BigInt(n - i + 1)) / BigInt(i);
    volume += binomial * ((q - 1n) ** BigInt(i));
  }
  const parity = q ** BigInt(nsym);
  return { t, ratio: Number(volume) / Number(parity), volume: volume.toString() };
}

// ── C. 엔드투엔드 트리거 스윕 ───────────────────────────────────────────────

function blankFrame() {
  const pixels = new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4);
  for (let index = 0; index < FRAME_SIDE * FRAME_SIDE; index += 1) {
    pixels[index * 4] = FILL.r;
    pixels[index * 4 + 1] = FILL.g;
    pixels[index * 4 + 2] = FILL.b;
    pixels[index * 4 + 3] = 255;
  }
  return { width: FRAME_SIDE, height: FRAME_SIDE, pixels };
}

function paint(frame, fn) {
  const { pixels } = frame;
  for (let y = 0; y < FRAME_SIDE; y += 1) {
    for (let x = 0; x < FRAME_SIDE; x += 1) {
      const value = fn(x, y);
      const offset = (y * FRAME_SIDE + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return frame;
}

function noiseFrame(random, low, high) {
  return paint(blankFrame(), () => low + Math.floor(random() * (high - low + 1)));
}

function blurredNoiseFrame(random, radius) {
  const raw = noiseFrame(random, 20, 235);
  const out = blankFrame();
  const read = (x, y) => raw.pixels[(y * FRAME_SIDE + x) * 4];
  return paint(out, (x, y) => {
    let sum = 0;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy += radius || 1) {
      for (let dx = -radius; dx <= radius; dx += radius || 1) {
        const sx = Math.min(FRAME_SIDE - 1, Math.max(0, x + dx));
        const sy = Math.min(FRAME_SIDE - 1, Math.max(0, y + dy));
        sum += read(sx, sy);
        count += 1;
      }
    }
    return Math.round(sum / count);
  });
}

function checkerFrame(cellPx, phaseX, phaseY, dark, light) {
  return paint(blankFrame(), (x, y) => (
    (Math.floor((x + phaseX) / cellPx) + Math.floor((y + phaseY) / cellPx)) % 2 === 0
      ? dark : light));
}

function stripeFrame(periodPx, angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  return paint(blankFrame(), (x, y) => (
    Math.floor((x * ux + y * uy) / periodPx) % 2 === 0 ? 45 : 215));
}

/** QR 프레임 — 「다른 코드가 화면에 있다」 는 현실적인 오수용 자극. */
function qrFrame(text, modulePx, offsetX, offsetY) {
  // qrMatrix 는 `{ size, modules }` (평탄 배열) 를 돌려준다 — 2차원 배열이 아니다.
  const { size, modules } = qrMatrix(text);
  const originX = Math.round((FRAME_SIDE - size * modulePx) / 2) + offsetX;
  const originY = Math.round((FRAME_SIDE - size * modulePx) / 2) + offsetY;
  return paint(blankFrame(), (x, y) => {
    const column = Math.floor((x - originX) / modulePx);
    const row = Math.floor((y - originY) / modulePx);
    if (row < 0 || column < 0 || row >= size || column >= size) return 240;
    return modules[row * size + column] ? 25 : 235;
  });
}

function renderLayout(layoutId, cellPx) {
  if (layoutId.startsWith('O-')) {
    const version = { 'O-k6': 1, 'O-k8': 2, 'O-k10': 3 }[layoutId];
    const encoded = encode(TEXT, { version, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 1 });
    return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
  }
  if (layoutId.startsWith('A-')) {
    const version = { 'A-k6': 0, 'A-k8': 1, 'A-k10': 2 }[layoutId];
    const encoded = encodeA(TEXT, { version, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 26 });
    return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
  }
  const version = { 'Y-n21': 1, 'Y-n25': 2 }[layoutId];
  const encoded = encodeY(TEXT, { version, eccLevel: 'M', tones: 3 });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 1 });
  return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
}

function placeInFrame(raster, scene, { dx = 0, dy = 0, factor = 1, rotation = 0 } = {}) {
  const pixels = new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4);
  const ppu = raster.pixelsPerUnit;
  const originX = scene.layout.originX * ppu;
  const originY = scene.layout.originY * ppu;
  const cx = FRAME_SIDE / 2 + dx;
  const cy = FRAME_SIDE / 2 + dy;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  for (let y = 0; y < FRAME_SIDE; y += 1) {
    for (let x = 0; x < FRAME_SIDE; x += 1) {
      const rx = (x - cx) / factor;
      const ry = (y - cy) / factor;
      const sx = rx * cos + ry * sin + originX;
      const sy = -rx * sin + ry * cos + originY;
      const offset = (y * FRAME_SIDE + x) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= raster.width || y0 + 1 >= raster.height) {
        pixels[offset] = FILL.r;
        pixels[offset + 1] = FILL.g;
        pixels[offset + 2] = FILL.b;
        pixels[offset + 3] = 255;
        continue;
      }
      const tx = sx - x0;
      const ty = sy - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const p00 = raster.pixels[(y0 * raster.width + x0) * 4 + channel];
        const p10 = raster.pixels[(y0 * raster.width + x0 + 1) * 4 + channel];
        const p01 = raster.pixels[((y0 + 1) * raster.width + x0) * 4 + channel];
        const p11 = raster.pixels[((y0 + 1) * raster.width + x0 + 1) * 4 + channel];
        pixels[offset + channel] = Math.round(
          p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty)
          + p01 * (1 - tx) * ty + p11 * tx * ty,
        );
      }
      pixels[offset + 3] = 255;
    }
  }
  return { width: FRAME_SIDE, height: FRAME_SIDE, pixels };
}

const COARSE = guidePriorPoses({ frameSide: FRAME_SIDE });

function priorOf(result) {
  if (result.ok) {
    return result.diagnostics && result.diagnostics.bootstrap
      && result.diagnostics.bootstrap.prior;
  }
  const detail = result.detail || {};
  return detail.prior || (detail.cause && detail.cause.prior) || null;
}

/** 트리거 한 번 = scanner.js `attemptGuidePriorScan` 과 같은 2단계. */
function runTrigger(frame) {
  const raster = { width: frame.width, height: frame.height, pixels: frame.pixels };
  const first = decodeFrontend(raster, { priorPoses: COARSE });
  const firstPrior = priorOf(first) || {};
  const stats = {
    poses: firstPrior.posesEvaluated || 0,
    hypotheses: firstPrior.hypothesisCount || 0,
    admitted: (firstPrior.admittedPoses || []).length,
    decoded: first.ok ? 1 : 0,
    text: first.ok ? first.text : null,
  };
  if (first.ok) return stats;

  const refine = refineSeedsFrom(COARSE, firstPrior.admittedPoses || [], {
    frameSide: FRAME_SIDE,
  });
  if (refine.length === 0) return stats;
  const second = decodeFrontend(raster, { priorPoses: refine });
  const secondPrior = priorOf(second) || {};
  stats.poses += secondPrior.posesEvaluated || 0;
  stats.hypotheses += secondPrior.hypothesisCount || 0;
  stats.admitted += (secondPrior.admittedPoses || []).length;
  if (second.ok) {
    stats.decoded = 1;
    stats.text = second.text;
  }
  return stats;
}

// ── 실행 ────────────────────────────────────────────────────────────────────

const report = { lastWall: [], rsBound: [], sweep: [] };

console.log('# A. 마지막 벽 (본문 RS + payload) 직접 측정 — 균일 난수 digit');
const wallSpecs = [
  { name: 'O-V1', cellCount: dataCellsInScanOrder(6).length, formatIndex: 0 },
  { name: 'O-V2', cellCount: dataCellsInScanOrder(8).length, formatIndex: 1 },
  { name: 'O-V3', cellCount: dataCellsInScanOrder(10).length, formatIndex: 2 },
  { name: 'A-A0', cellCount: dataCellsInScanOrderA(6).length, formatIndex: 1, type: 'A' },
  { name: 'A-A1', cellCount: dataCellsInScanOrderA(8).length, formatIndex: 12, type: 'A' },
  { name: 'A-A2', cellCount: dataCellsInScanOrderA(10).length, formatIndex: 13, type: 'A' },
];
const random = makeRandom(20260816);
for (const spec of wallSpecs) {
  for (const eccLevel of ['L', 'M', 'H']) {
    const format = { type: spec.type || 'O', formatIndex: spec.formatIndex, eccLevel };
    let row;
    try {
      row = measureLastWall({ cellCount: spec.cellCount, format }, WALL_TRIALS, random);
    } catch (error) {
      console.log('  ' + spec.name + '/' + eccLevel + ' — 건너뜀: ' + error.message);
      continue;
    }
    const rate = row.accepted / row.trials;
    report.lastWall.push({ spec: spec.name, eccLevel, ...row, rate });
    console.log('  ' + spec.name + '/' + eccLevel
      + ' cells=' + spec.cellCount
      + ' trials=' + row.trials
      + ' accepted=' + row.accepted
      + ' rate=' + rate.toExponential(3)
      + ' · 실패 사유 ' + JSON.stringify(row.reasons));
  }
}

/*
 * 최악 조합 심화 — 표에서 RS 통과율이 가장 높은 (버전 × ECC) 하나를 크게 돌린다.
 * 왜 V1/L 이 최악인가: nsym=3 이라 **소거 3개면 RS 가 항상 «성공»** 한다(패리티가
 * 소거를 메우는 데 전부 쓰인다). 난수 digit 3개를 묶은 심볼이 211..215(체 밖)일 확률이
 * 5/216 이므로 27 심볼 중 1\~3개가 소거로 잡히는 일이 흔하고, 그때 RS 는 벽이 아니다.
 * → **이 조합에서는 마지막 벽이 사실상 payload 검증 단독**이다. 그 두께를 직접 잰다.
 */
const DEEP = argOf('--deep', 1000000);
if (DEEP > 0) {
  const spec = { cellCount: dataCellsInScanOrder(6).length, format: { type: 'O', formatIndex: 0, eccLevel: 'L' } };
  const deep = measureLastWall(spec, DEEP, makeRandom(777));
  const rsFailed = deep.reasons.rs || 0;
  const rsPassed = deep.trials - rsFailed;
  report.deep = { ...deep, rsPassed };
  console.log('\n  [심화] O-V1/L trials=' + deep.trials
    + ' · RS 통과 ' + rsPassed + ' (' + (rsPassed / deep.trials).toExponential(3) + ')'
    + ' · 최종 수용 ' + deep.accepted
    + ' · payload 단독 통과율 상계 ' + (3 / Math.max(1, rsPassed)).toExponential(3)
    + ' · 마지막 벽 전체 상계 ' + (3 / deep.trials).toExponential(3));
  console.log('           실패 사유 ' + JSON.stringify(deep.reasons));
}

console.log('\n# B. RS 잔여 패리티 구조 상계 — V_t(n,211)/211^nsym');
for (const [key, entry] of Object.entries(NSYM_TABLE)) {
  for (const eccLevel of ['L', 'M', 'H']) {
    const bound = rsResidualBound(entry.symbols, entry[eccLevel]);
    report.rsBound.push({ version: key, eccLevel, n: entry.symbols, nsym: entry[eccLevel], ...bound });
    console.log('  ' + key + '/' + eccLevel
      + ' n=' + entry.symbols + ' nsym=' + entry[eccLevel] + ' t=' + bound.t
      + ' → P(RS 단독 수용) ≈ ' + bound.ratio.toExponential(3));
  }
}

console.log('\n# C. 엔드투엔드 트리거 스윕');
const classes = [];
{
  const rng = makeRandom(argOf('--seed', 4242));
  const perClass = Math.max(1, Math.round(TRIGGERS / 8));
  classes.push({ name: 'flat', frames: () => Array.from({ length: perClass }, () => blankFrame()) });
  classes.push({
    name: 'noise',
    frames: () => Array.from({ length: perClass }, (unused, index) => (
      noiseFrame(rng, index % 3 === 0 ? 0 : 60, index % 3 === 0 ? 255 : 190))),
  });
  classes.push({
    name: 'blur-noise',
    frames: () => Array.from({ length: Math.max(1, Math.round(perClass / 4)) },
      (unused, index) => blurredNoiseFrame(rng, 2 + (index % 4))),
  });
  classes.push({
    name: 'checker',
    frames: () => Array.from({ length: perClass }, (unused, index) => checkerFrame(
      6 + (index % 9), index % 7, (index * 3) % 11, 30 + (index % 40), 200 + (index % 50))),
  });
  classes.push({
    name: 'stripes',
    frames: () => Array.from({ length: perClass }, (unused, index) => stripeFrame(
      5 + (index % 12), (index * 13) % 180)),
  });
  classes.push({
    name: 'qr',
    frames: () => Array.from({ length: Math.max(1, Math.round(perClass / 2)) },
      // QR v1 알파뉴메릭 문자셋(0-9 A-Z 공백 $%*+-./:) 안에서만.
      // modulePx 는 QR(21 모듈)이 프레임을 의미 있게 채우도록 크게 잡는다 — 작으면
      // 프레임 대부분이 배경이라 프런트엔드가 조기 거부해 벽을 두드리지도 못한다.
      (unused, index) => qrFrame(
        'TL.ESTRE.SO/' + index,
        12 + (index % 26),
        ((index * 17) % 61) - 30,
        ((index * 29) % 61) - 30,
      )),
  });
}

let sweepTriggers = 0;
let sweepPoses = 0;
let sweepHypotheses = 0;
let sweepAdmitted = 0;
let sweepDecoded = 0;
const startedAt = Date.now();
for (const entry of classes) {
  let admitted = 0;
  let decoded = 0;
  let hypotheses = 0;
  let poses = 0;
  let count = 0;
  for (const frame of entry.frames()) {
    const stats = runTrigger(frame);
    count += 1;
    poses += stats.poses;
    hypotheses += stats.hypotheses;
    admitted += stats.admitted;
    if (stats.decoded) {
      decoded += 1;
      console.log('  ⚠ 오수용! class=' + entry.name + ' text=' + JSON.stringify(stats.text));
    }
  }
  sweepTriggers += count;
  sweepPoses += poses;
  sweepHypotheses += hypotheses;
  sweepAdmitted += admitted;
  sweepDecoded += decoded;
  report.sweep.push({ name: entry.name, triggers: count, poses, hypotheses, admitted, decoded });
  console.log('  ' + entry.name.padEnd(11)
    + ' triggers=' + String(count).padStart(4)
    + ' 기하=' + String(hypotheses).padStart(7)
    + ' 포맷CRC통과=' + String(admitted).padStart(5)
    + ' 오독=' + decoded);
}

// 오정렬 실물 코드 — 「내용은 진짜인데 기하가 틀린」 가장 위험한 자극.
{
  let admitted = 0;
  let decoded = 0;
  let misread = 0;
  let hypotheses = 0;
  let count = 0;
  const conditions = [];
  for (const rotation of [7, 17, 23, 41]) conditions.push({ rotation });
  for (const factor of [0.6, 0.72, 1.35, 1.6]) conditions.push({ factor });
  for (const dx of [60, 90, 130]) conditions.push({ dx, dy: -40 });
  for (const layoutId of ['O-k6', 'O-k10', 'A-k8', 'Y-n21']) {
    const layout = PRIOR_LAYOUTS.find((item) => item.id === layoutId);
    const cellPx = layoutCellPx(layout, FRAME_SIDE);
    const { scene, raster } = renderLayout(layoutId, cellPx);
    for (const condition of conditions) {
      const stats = runTrigger(placeInFrame(raster, scene, condition));
      count += 1;
      hypotheses += stats.hypotheses;
      admitted += stats.admitted;
      if (stats.decoded) {
        decoded += 1;
        if (stats.text !== TEXT) {
          misread += 1;
          console.log('  ⚠ 오독! ' + layoutId + ' ' + JSON.stringify(condition)
            + ' → ' + JSON.stringify(stats.text));
        }
      }
    }
  }
  sweepTriggers += count;
  sweepHypotheses += hypotheses;
  sweepAdmitted += admitted;
  report.sweep.push({
    name: 'tlcube-misaligned', triggers: count, hypotheses, admitted, decoded, misread,
  });
  console.log('  ' + 'misaligned'.padEnd(11)
    + ' triggers=' + String(count).padStart(4)
    + ' 기하=' + String(hypotheses).padStart(7)
    + ' 포맷CRC통과=' + String(admitted).padStart(5)
    + ' 복호=' + decoded + ' (그중 오독=' + misread + ')');
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('\n# 합계');
console.log('  트리거 ' + sweepTriggers
  + ' · 기하 ' + sweepHypotheses
  + ' · 포맷 CRC 통과(=마지막 벽 타격) ' + sweepAdmitted
  + ' · 코드 없는 프레임 오독 ' + sweepDecoded
  + ' · ' + elapsed + 's');
console.log('  포맷 CRC 오통과율 = ' + (sweepAdmitted / Math.max(1, sweepHypotheses)).toExponential(3));
console.log('  마지막 벽 관측 오수용 0/' + sweepAdmitted
  + ' → 95% 상계(rule of three) ' + (3 / Math.max(1, sweepAdmitted)).toExponential(3));

report.totals = {
  triggers: sweepTriggers,
  poses: sweepPoses,
  hypotheses: sweepHypotheses,
  admitted: sweepAdmitted,
  decodedFromCodeless: sweepDecoded,
  seconds: Number(elapsed),
};
console.log('\n' + JSON.stringify(report));
