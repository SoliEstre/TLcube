/**
 * claude-cellpx12-anomaly-deep.mjs — 실패 프레임의 큐브 검출 내부 진단 심층 덤프.
 *
 * phase 1(claude-cellpx12-anomaly.mjs)이 확인한 것: 12px×gamma0.7 실패는 큐브
 * 검출이 «가설 0개» 로 죽고(hex/tri 폴백이 no-format-candidate 를 만든다),
 * 실질 진단은 cube.diagnostics.diagnostics 한 겹 아래에 있다. 이 스크립트는
 * 그 겹을 열어 shapes 거절 히스토그램 · csBlockLocator 전체 진단 ·
 * geometryReports(CS 평가 시도) · cellSurfaceProbe 를 프레임별로 남긴다.
 *
 * 실행: node test/output/claude-cellpx12-anomaly-deep.mjs
 */
import { writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { distortImage, applyGamma } from '../harness/distort.mjs';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../src/luminance.js';

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

// 실패 6 + 대조 4 (11·13·15 gamma 성공, 12 clean 성공)
const FRAMES = [
  { cellPx: 12, tones: 2, deg: 0, channel: 'gamma0.7' },
  { cellPx: 12, tones: 2, deg: 105, channel: 'gamma0.7' },
  { cellPx: 12, tones: 2, deg: 240, channel: 'gamma0.7' },
  { cellPx: 12, tones: 3, deg: 0, channel: 'gamma0.7' },
  { cellPx: 12, tones: 3, deg: 105, channel: 'gamma0.7' },
  { cellPx: 12, tones: 3, deg: 240, channel: 'gamma0.7' },
  { cellPx: 12, tones: 3, deg: 0, channel: 'clean' },
  { cellPx: 11, tones: 3, deg: 0, channel: 'gamma0.7' },
  { cellPx: 13, tones: 3, deg: 0, channel: 'gamma0.7' },
  { cellPx: 15, tones: 3, deg: 0, channel: 'gamma0.7' },
];

function embedSquare(raster) {
  const side = 2 * Math.ceil(Math.hypot(raster.width, raster.height) / 2);
  const out = { width: side, height: side, pixels: new Uint8ClampedArray(side * side * 4) };
  for (let k = 0; k < side * side; k += 1) {
    out.pixels[k * 4] = FILL.r;
    out.pixels[k * 4 + 1] = FILL.g;
    out.pixels[k * 4 + 2] = FILL.b;
    out.pixels[k * 4 + 3] = 255;
  }
  const ox = Math.floor((side - raster.width) / 2);
  const oy = Math.floor((side - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * side + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

function render(tones, cellPx) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v2r2', version: 1, tones, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return embedSquare(rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }));
}

/** cube 진단 — ok 면 diagnostics, fail 이면 detail.diagnostics 한 겹 아래. */
function cubeInner(result) {
  const geometry = result.ok
    ? result.diagnostics?.bootstrap?.geometry
    : (result.detail?.cause?.geometryDiagnostics || result.detail?.geometryDiagnostics);
  const cube = geometry?.cube;
  if (!cube) return { cube: null, inner: null };
  const box = cube.diagnostics || null;
  const inner = box && box.diagnostics && typeof box.diagnostics === 'object'
    ? box.diagnostics       // fail detail: {stage, cause, ..., diagnostics:{...}}
    : box;                  // ok: 바로 그 층
  return { cube, box, inner };
}

function rejectionHist(shapesDiag) {
  const rejections = shapesDiag && Array.isArray(shapesDiag.rejections)
    ? shapesDiag.rejections : [];
  const hist = {};
  for (const entry of rejections) hist[entry.stage] = (hist[entry.stage] || 0) + 1;
  return { total: rejections.length, hist };
}

function csAttemptSummary(reports) {
  const attempts = (Array.isArray(reports) ? reports : []).filter((e) => e.attempted === true);
  const byReason = {};
  for (const entry of attempts) {
    const key = entry.accepted ? 'accepted' : (entry.reason || 'rejected');
    byReason[key] = (byReason[key] || 0) + 1;
  }
  const top = attempts.slice()
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, 8)
    .map((e) => ({
      n: e.n, o: e.orientation, seed: e.geometrySeed, layout: e.layoutId,
      score: Number.isFinite(e.score) ? Number(e.score.toFixed(4)) : null,
      margin: Number.isFinite(e.orientationMargin) ? Number(e.orientationMargin.toFixed(4)) : null,
      accepted: e.accepted, reason: e.reason,
    }));
  return { attempts: attempts.length, byReason, top };
}

const out = [];
for (const frame of FRAMES) {
  const embedded = render(frame.tones, frame.cellPx);
  const rotated = frame.deg === 0 ? embedded : distortImage(embedded, { rotation: frame.deg, fill: FILL });
  const image = frame.channel === 'gamma0.7' ? applyGamma(rotated, 0.7) : rotated;
  const result = decodeFrontend(
    { width: image.width, height: image.height, pixels: image.pixels },
    { bootstrap: { family: { cube: { enableCellSurfaceY: true, enableLocatorY: true } } } },
  );
  const ok = result.ok === true && result.text === PAYLOAD;
  const { cube, box, inner } = cubeInner(result);
  const record = {
    frame,
    canvas: image.width,
    ok,
    reason: ok ? null : result.reason,
    cube: cube ? {
      ok: cube.ok, reason: cube.reason ?? null, hypothesisCount: cube.hypothesisCount ?? null,
      failStage: box && box.stage ? box.stage : null,
      failCause: box && typeof box.cause === 'string' ? box.cause : null,
      geometryStage: box ? box.geometryStage ?? null : null,
    } : null,
    downsampleFactor: inner?.downsampleFactor ?? null,
    shapes: inner?.shapes ? {
      candidateCount: Array.isArray(inner.shapeCandidates) ? inner.shapeCandidates.length : null,
      rejections: rejectionHist(inner.shapes),
    } : null,
    locatorHexFrame: inner?.locator ? {
      enabled: inner.locator.enabled, accepted: inner.locator.accepted,
      profile: inner.locator.profile,
    } : null,
    csBlockLocator: inner?.csBlockLocator ?? null,
    cellSurfaceProbe: inner?.cellSurfaceProbe ?? null,
    csAttempts: csAttemptSummary(inner?.geometryReports),
    blockReferenceRecovery: inner?.blockReferenceRecovery
      ? { present: true, keys: Object.keys(inner.blockReferenceRecovery) }
      : null,
  };
  out.push(record);
  process.stderr.write(
    `c=${frame.cellPx} t=${frame.tones} ${frame.deg}° ${frame.channel} ok=${ok ? 'Y' : 'N'} `
    + `cube=${record.cube ? (record.cube.ok ? 'OK(' + record.cube.hypothesisCount + ')' : 'FAIL:' + record.cube.failCause) : '-'} `
    + `blkShapes=${record.csBlockLocator ? record.csBlockLocator.shapeCount : '-'} `
    + `csAtt=${record.csAttempts.attempts} probe=${record.cellSurfaceProbe ? (record.cellSurfaceProbe.accepted ? 'ACC' : 'REJ:' + record.cellSurfaceProbe.reason) : '-'}\n`,
  );
}

writeFileSync(
  new URL('./claude-cellpx12-anomaly-deep.json', import.meta.url),
  JSON.stringify({ payload: PAYLOAD, frames: out }, null, 2) + '\n',
);
process.stdout.write('written claude-cellpx12-anomaly-deep.json\n');
