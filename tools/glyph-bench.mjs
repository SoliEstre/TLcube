/**
 * glyph-bench.mjs — R2 글리프 검출기 성능·정확도 자.
 *
 * 한 설정은 반드시 별도 프로세스에서 잰다. 부모는 glyph.js 를 로드하지 않고
 * 워커만 띄운다. 워커는 warmup 1회 뒤 반복의 중앙값을 기록한다.
 *
 * 프레임은 실사진 휘도 덤프를 lumaToRaster 로 복원한 뒤 8비트 선형 휘도로 내리고,
 * 중앙 크롭 + 박스 평균으로 640×384 에 맞춘다. 균일 회색은 같은 크기 합성 프레임이다.
 *
 * 0건 처리하고 0 실패로 초록을 내지 않는다. 정션이 비면 추정으로 채우지 않고 죽는다.
 *
 *   node tools/glyph-bench.mjs --out test/output/glyphperf/before.json
 *   node tools/glyph-bench.mjs --out test/output/glyphperf/after.json
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF), '..');

const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 384;
const DEFAULT_WARMUP = 1;
const DEFAULT_REPS = 3;
const MIN_DUMPS = 125;
const MIN_PHOTO_FRAMES = 3;
const UNIFORM_LUMA = 128;
const MATCH_MAX_DIST_PX = 8;
const MATCH_MAX_SCALE_REL = 0.12;

/** 벤치가 재는 실사진. 이름은 LUMA_DIR 기준 줄기(해상도 접미사 없음). */
const PHOTO_FRAMES = Object.freeze([
  'centerqr-080805616',
  'k26-cube-K0-near',
  'KakaoTalk_20260811_014930219',
  'k26-qr-K0-near',
  'k26-tl-K0-near',
]);

/**
 * 640×384 프레임에서 잠근 지상검증.
 * rank 는 검출기 출력 순서(점수 내림차순)의 0-based 인덱스.
 */
const GROUND_TRUTH = Object.freeze({
  'k26-cube-K0-near': Object.freeze({
    kind: 'bullseye',
    cx: 315.5,
    cy: 224.5,
    scale: 16.86,
    score: 0.651126,
    rank: 20,
  }),
  'centerqr-080805616': Object.freeze({
    kind: 'qr',
    cx: 320.0,
    cy: 205.5,
    scale: 17.53,
    score: 0.855479,
    rank: 16,
  }),
  'k26-qr-K0-near': Object.freeze({
    kind: 'qr',
    cx: 334.0,
    cy: 209.5,
    scale: 16.8556,
    score: 0.712943,
    rank: 16,
  }),
});

function parseArgs(argv) {
  const args = {
    worker: false,
    out: null,
    warmup: DEFAULT_WARMUP,
    reps: DEFAULT_REPS,
    label: null,
    ids: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--worker') {
      args.worker = true;
      continue;
    }
    if (token === '--out') {
      args.out = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--warmup') {
      args.warmup = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--reps') {
      args.reps = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--label') {
      args.label = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--ids') {
      args.ids = argv[i + 1].split(',').map((id) => id.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    throw new Error(`알 수 없는 인자: ${token}`);
  }
  if (!args.out) throw new Error('--out <경로> 가 필요하다');
  if (!Number.isInteger(args.warmup) || args.warmup < 0) {
    throw new Error(`--warmup 은 0 이상 정수여야 한다: ${args.warmup}`);
  }
  if (!Number.isInteger(args.reps) || args.reps < 1) {
    throw new Error(`--reps 는 1 이상 정수여야 한다: ${args.reps}`);
  }
  return args;
}

function inferLabel(outPath) {
  const base = outPath.replace(/\\/g, '/').split('/').pop() ?? '';
  if (base.startsWith('before')) return 'before';
  if (base.startsWith('after')) return 'after';
  return 'run';
}

function roundTo(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function rasterToLuma8(raster, relativeLuminance8) {
  const luma = new Uint8Array(raster.width * raster.height);
  const pixels = raster.pixels;
  for (let i = 0; i < luma.length; i += 1) {
    const offset = i * 4;
    luma[i] = Math.round(
      relativeLuminance8(pixels[offset], pixels[offset + 1], pixels[offset + 2]) * 255,
    );
  }
  return luma;
}

function centerCropBox(srcWidth, srcHeight, dstWidth, dstHeight) {
  const targetAspect = dstWidth / dstHeight;
  const srcAspect = srcWidth / srcHeight;
  if (srcAspect > targetAspect) {
    const cropHeight = srcHeight;
    const cropWidth = Math.round(srcHeight * targetAspect);
    return {
      cropX: Math.floor((srcWidth - cropWidth) / 2),
      cropY: 0,
      cropWidth,
      cropHeight,
    };
  }
  const cropWidth = srcWidth;
  const cropHeight = Math.round(srcWidth / targetAspect);
  return {
    cropX: 0,
    cropY: Math.floor((srcHeight - cropHeight) / 2),
    cropWidth,
    cropHeight,
  };
}

function boxAverageLuma(src, srcWidth, srcHeight, dstWidth, dstHeight) {
  const crop = centerCropBox(srcWidth, srcHeight, dstWidth, dstHeight);
  const dst = new Uint8Array(dstWidth * dstHeight);
  for (let y = 0; y < dstHeight; y += 1) {
    let y0 = crop.cropY + Math.floor((y * crop.cropHeight) / dstHeight);
    let y1 = crop.cropY + Math.floor(((y + 1) * crop.cropHeight) / dstHeight);
    if (y1 <= y0) y1 = y0 + 1;
    if (y1 > srcHeight) y1 = srcHeight;
    for (let x = 0; x < dstWidth; x += 1) {
      let x0 = crop.cropX + Math.floor((x * crop.cropWidth) / dstWidth);
      let x1 = crop.cropX + Math.floor(((x + 1) * crop.cropWidth) / dstWidth);
      if (x1 <= x0) x1 = x0 + 1;
      if (x1 > srcWidth) x1 = srcWidth;
      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        const row = sy * srcWidth;
        for (let sx = x0; sx < x1; sx += 1) {
          sum += src[row + sx];
          count += 1;
        }
      }
      dst[(y * dstWidth) + x] = count === 0 ? 0 : Math.round(sum / count);
    }
  }
  return { luma: dst, crop };
}

function createOutput(capacity) {
  return {
    count: 0,
    truncated: 0,
    candidates: Array.from({ length: capacity }, () => ({
      kind: '', cx: 0, cy: 0, scale: 0, score: 0,
    })),
  };
}

function snapshotCandidates(output) {
  const candidates = [];
  for (let index = 0; index < output.count; index += 1) {
    const candidate = output.candidates[index];
    candidates.push({
      kind: candidate.kind,
      cx: roundTo(candidate.cx, 4),
      cy: roundTo(candidate.cy, 4),
      scale: roundTo(candidate.scale, 4),
      score: roundTo(candidate.score, 6),
      rank: index,
    });
  }
  return candidates;
}

function matchTruth(candidates, truth) {
  if (!truth) {
    return {
      found: false,
      rank: null,
      kind: null,
      cx: null,
      cy: null,
      scale: null,
      score: null,
      distPx: null,
      scaleRel: null,
      scoreDelta: null,
      rankDelta: null,
    };
  }
  let best = null;
  for (const candidate of candidates) {
    if (candidate.kind !== truth.kind) continue;
    const dx = candidate.cx - truth.cx;
    const dy = candidate.cy - truth.cy;
    const distPx = Math.hypot(dx, dy);
    if (distPx > MATCH_MAX_DIST_PX) continue;
    const scaleRel = Math.abs(candidate.scale - truth.scale) / truth.scale;
    if (scaleRel > MATCH_MAX_SCALE_REL) continue;
    if (
      best === null
      || candidate.score > best.score
      || (candidate.score === best.score && candidate.rank < best.rank)
    ) {
      best = { ...candidate, distPx, scaleRel };
    }
  }
  if (!best) {
    return {
      found: false,
      rank: null,
      kind: truth.kind,
      cx: null,
      cy: null,
      scale: null,
      score: null,
      distPx: null,
      scaleRel: null,
      scoreDelta: null,
      rankDelta: null,
    };
  }
  return {
    found: true,
    rank: best.rank,
    kind: best.kind,
    cx: best.cx,
    cy: best.cy,
    scale: best.scale,
    score: best.score,
    distPx: roundTo(best.distPx, 4),
    scaleRel: roundTo(best.scaleRel, 6),
    scoreDelta: roundTo(best.score - truth.score, 6),
    rankDelta: best.rank - truth.rank,
  };
}

function topByKind(candidates) {
  const best = {};
  for (const candidate of candidates) {
    const current = best[candidate.kind];
    if (!current || candidate.score > current.score) best[candidate.kind] = candidate;
  }
  return best;
}

function findDump(dumps, id) {
  const preferred = [`${id}.960.luma`, `${id}.1440.luma`];
  for (const name of preferred) {
    const hit = dumps.find((entry) => entry.name === name);
    if (hit) return hit;
  }
  return null;
}

function snapshotParams(params, Q16_ONE) {
  const out = {};
  for (const key of Object.keys(params)) {
    if (key.startsWith('glyph')) out[key] = params[key];
  }
  out.glyphMinCellPitchPx = params.glyphMinCellPitchQ16 / Q16_ONE;
  out.glyphMaxCellPitchPx = params.glyphMaxCellPitchQ16 / Q16_ONE;
  return out;
}

function logLine(message) {
  process.stderr.write(`${message}\n`);
}

async function runWorker(args) {
  const [
    { listLumaDumps, readLumaDump, lumaToRaster },
    { createGlyphDetector, GLYPH_STATUS },
    { Q16_ONE },
    { relativeLuminance8 },
  ] = await Promise.all([
    import('./read-luma.mjs'),
    import('../src/r2/glyph.js'),
    import('../src/r2/params.js'),
    import('../src/luminance.js'),
  ]);

  const dumps = listLumaDumps();
  logLine(`glyph-bench dumps=${dumps.length} minRequired=${MIN_DUMPS}`);
  if (dumps.length === 0) {
    throw new Error('휘도 덤프가 0건이다. 정션이 안 보이면 추정으로 채우지 않는다.');
  }
  if (dumps.length < MIN_DUMPS) {
    throw new Error(
      `휘도 덤프가 ${dumps.length}건뿐이다. ${MIN_DUMPS}개 이상이 보여야 한다.`,
    );
  }

  logLine('glyph-bench createGlyphDetector (DEFAULT_R2_PARAMS)');
  const detectorStarted = process.hrtime.bigint();
  const detector = createGlyphDetector();
  const detectorMs = Number(process.hrtime.bigint() - detectorStarted) / 1e6;
  logLine(`glyph-bench detectorReady ${roundTo(detectorMs, 2)}ms minPitch=${
    detector.params.glyphMinCellPitchQ16 / Q16_ONE
  } maxPitch=${detector.params.glyphMaxCellPitchQ16 / Q16_ONE}`);

  const output = createOutput(detector.maxCandidates);
  const frames = [];
  let processed = 0;
  let skipped = 0;
  const skippedNames = [];

  const uniform = new Uint8Array(TARGET_WIDTH * TARGET_HEIGHT);
  uniform.fill(UNIFORM_LUMA);
  frames.push({
    id: 'uniform-gray',
    kind: 'synthetic',
    sourceName: null,
    sourcePath: null,
    sourceSize: { width: TARGET_WIDTH, height: TARGET_HEIGHT },
    crop: null,
    luma: uniform,
    truth: null,
  });
  processed += 1;

  const photoIds = args.ids ?? PHOTO_FRAMES;
  for (const id of photoIds) {
    const dump = findDump(dumps, id);
    if (!dump) {
      skipped += 1;
      skippedNames.push(id);
      logLine(`glyph-bench skip ${id} (dump missing)`);
      continue;
    }
    const field = readLumaDump(dump.path);
    const raster = lumaToRaster(field);
    const fullLuma = rasterToLuma8(raster, relativeLuminance8);
    const reduced = boxAverageLuma(
      fullLuma, raster.width, raster.height, TARGET_WIDTH, TARGET_HEIGHT,
    );
    frames.push({
      id,
      kind: 'photo',
      sourceName: dump.name,
      sourcePath: dump.path,
      sourceSize: { width: raster.width, height: raster.height },
      crop: reduced.crop,
      luma: reduced.luma,
      truth: GROUND_TRUTH[id] ?? null,
    });
    processed += 1;
    logLine(
      `glyph-bench load ${id} source=${raster.width}x${raster.height} `
      + `crop=${reduced.crop.cropWidth}x${reduced.crop.cropHeight}+${reduced.crop.cropX}+${reduced.crop.cropY}`,
    );
  }

  const photoProcessed = frames.filter((frame) => frame.kind === 'photo').length;
  logLine(`glyph-bench processed=${processed} skipped=${skipped} photos=${photoProcessed}`);
  if (processed === 0) {
    throw new Error('처리한 프레임이 0건이다. 거짓 초록을 내지 않는다.');
  }
  const minPhotos = args.ids ? 1 : MIN_PHOTO_FRAMES;
  if (photoProcessed < minPhotos) {
    throw new Error(
      `실사진 ${photoProcessed}장만 처리했다 (필요 ${minPhotos}). `
      + `skipped=${JSON.stringify(skippedNames)}`,
    );
  }

  const results = [];
  for (const frame of frames) {
    for (let warm = 0; warm < args.warmup; warm += 1) {
      logLine(`glyph-bench detect ${frame.id} warmup ${warm + 1}/${args.warmup}`);
      const statusWarm = detector.detectInto(
        frame.luma, TARGET_WIDTH, TARGET_HEIGHT, output,
      );
      if (statusWarm !== GLYPH_STATUS.OK) {
        throw new Error(`${frame.id}: warmup detectInto status=${statusWarm}`);
      }
    }

    const timesMs = [];
    let lastSnapshot = snapshotCandidates(output);
    let lastCount = output.count;
    let lastTruncated = output.truncated;
    for (let rep = 0; rep < args.reps; rep += 1) {
      logLine(`glyph-bench detect ${frame.id} rep ${rep + 1}/${args.reps}`);
      const started = process.hrtime.bigint();
      const status = detector.detectInto(
        frame.luma, TARGET_WIDTH, TARGET_HEIGHT, output,
      );
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (status !== GLYPH_STATUS.OK) {
        throw new Error(`${frame.id}: detectInto status=${status}`);
      }
      timesMs.push(roundTo(elapsedMs, 4));
      lastSnapshot = snapshotCandidates(output);
      lastCount = output.count;
      lastTruncated = output.truncated;
      logLine(
        `glyph-bench ${frame.id} rep ${rep + 1} ${roundTo(elapsedMs, 2)}ms `
        + `count=${output.count} truncated=${output.truncated}`,
      );
    }

    const match = matchTruth(lastSnapshot, frame.truth);
    const row = {
      id: frame.id,
      kind: frame.kind,
      sourceName: frame.sourceName,
      sourceSize: frame.sourceSize,
      crop: frame.crop,
      timesMs,
      medianMs: roundTo(median(timesMs), 4),
      minMs: roundTo(Math.min(...timesMs), 4),
      maxMs: roundTo(Math.max(...timesMs), 4),
      count: lastCount,
      truncated: lastTruncated,
      candidates: lastSnapshot,
      topByKind: topByKind(lastSnapshot),
      truth: frame.truth,
      match,
    };
    results.push(row);
    logLine(
      `glyph-bench ${frame.id} medianMs=${row.medianMs} count=${row.count} `
      + `truncated=${row.truncated} match=${
        match.found ? `${match.kind} rank=${match.rank} score=${match.score}` : 'NONE'
      }`,
    );
  }

  const outPath = resolve(REPO, args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const report = {
    schemaVersion: 1,
    label: args.label ?? inferLabel(args.out),
    capturedAt: new Date().toISOString(),
    frameSize: { width: TARGET_WIDTH, height: TARGET_HEIGHT },
    warmup: args.warmup,
    reps: args.reps,
    dumpCount: dumps.length,
    processed,
    skipped,
    skippedNames,
    detectorInitMs: roundTo(detectorMs, 4),
    params: snapshotParams(detector.params, Q16_ONE),
    frames: results,
  };
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  logLine(`glyph-bench wrote ${outPath}`);
  process.stdout.write(`PROCESSED=${processed} SKIPPED=${skipped}\n`);
}

function runParent(args) {
  const forwarded = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--worker') continue;
    forwarded.push(argv[i]);
  }
  const child = spawn(process.execPath, [SELF, '--worker', ...forwarded], {
    cwd: REPO,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.stderr.write(`glyph-bench worker signal ${signal}\n`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
  child.on('error', (error) => {
    process.stderr.write(`glyph-bench worker spawn failed: ${error.message}\n`);
    process.exit(1);
  });
}

const args = parseArgs(process.argv.slice(2));
if (!args.worker) {
  runParent(args);
} else {
  try {
    await runWorker(args);
  } catch (error) {
    process.stderr.write(`glyph-bench FAILED: ${error.stack ?? error.message}\n`);
    process.exit(1);
  }
}
