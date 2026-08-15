/**
 * claude-cellpx12-anomaly.mjs — v2r2@21 cell_px 12 × gamma0.7 비단조 0/6 규명 프로브.
 *
 * 재현 조건은 claude-cellpx-sweep.mjs 와 동일 산술(렌더 → embedSquare → 회전 → 톤 커브).
 * 각 프레임에서 decodeFrontend 의 깊은 진단(detectPath · cellSurfaceProbe ·
 * geometryReports · csBlockLocator · formatFailures)을 추출해 어느 단계에서
 * 12px 만 뒤집히는지 짚는다. 읽기 전용 진단 — 소스 수정 없음.
 *
 * 실행: node test/output/claude-cellpx12-anomaly.mjs
 * 축 재정의: CELLPX=9,10,11,12,13,14,15 CHANNELS=clean,gamma0.7 env 로 덮을 수 있다.
 */
import { writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { distortImage, applyGamma, applySCurve } from '../harness/distort.mjs';
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
const MARGIN_CELLS = 4;

const CELL_PX = process.env.CELLPX
  ? process.env.CELLPX.split(',').map(Number)
  : [9, 10, 11, 12, 13, 14, 15];
const CHANNEL_IDS = process.env.CHANNELS
  ? process.env.CHANNELS.split(',')
  : ['clean', 'gamma0.7'];
const TONES = [2, 3];
const ROTATIONS = [0, 105, 240];
// 주축은 v2r2. v1r2 는 cellPx 12 대조군만 (스윕에서 12 gamma 6/6 성공).
const TARGETS = [
  { layout: 'v2r2', version: 1, n: 21, cellPx: CELL_PX },
  { layout: 'v1r2', version: 1, n: 21, cellPx: [12] },
];
const CHANNELS = {
  clean: (image) => image,
  'sCurve0.6': (image) => applySCurve(image, 0.6),
  'gamma0.7': (image) => applyGamma(image, 0.7),
};

function embedSquare(raster) {
  const side = 2 * Math.ceil(Math.hypot(raster.width, raster.height) / 2);
  const out = {
    width: side,
    height: side,
    pixelsPerUnit: raster.pixelsPerUnit,
    supersample: raster.supersample,
    pixels: new Uint8ClampedArray(side * side * 4),
  };
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

function render(target, tones, cellPx) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: target.layout,
    version: target.version,
    tones,
    eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: MARGIN_CELLS });
  const raster = rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 });
  return embedSquare(raster);
}

// ── 진단 추출 ───────────────────────────────────────────────────────────────

function csReports(reports) {
  if (!Array.isArray(reports)) return [];
  return reports.filter((entry) => entry.attempted === true);
}

function summarizeReports(reports) {
  const attempts = csReports(reports);
  const byReason = {};
  let best = null;
  for (const entry of attempts) {
    const key = entry.accepted ? 'accepted' : (entry.reason || 'rejected');
    byReason[key] = (byReason[key] || 0) + 1;
    if (best === null
      || (entry.accepted && !best.accepted)
      || (entry.accepted === best.accepted
        && Number.isFinite(entry.score) && (!Number.isFinite(best.score) || entry.score > best.score))) {
      best = entry;
    }
  }
  const top = attempts
    .slice()
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, 6)
    .map((entry) => ({
      n: entry.n,
      o: entry.orientation,
      seed: entry.geometrySeed,
      layout: entry.layoutId,
      score: Number.isFinite(entry.score) ? Number(entry.score.toFixed(4)) : null,
      margin: Number.isFinite(entry.orientationMargin)
        ? Number(entry.orientationMargin.toFixed(4)) : null,
      accepted: entry.accepted,
      reason: entry.reason,
    }));
  return { attempts: attempts.length, byReason, top };
}

function cubeDiagOf(result) {
  const geometry = result.ok
    ? result.diagnostics?.bootstrap?.geometry
    : ((result.detail?.cause || result.detail)?.geometryDiagnostics
      || result.detail?.geometryDiagnostics);
  const box = geometry?.cube?.diagnostics || null;
  // 큐브 검출 실패 시 box 는 fail detail({stage,cause,...,diagnostics})이고
  // 실질 진단은 한 겹 아래에 있다 — 성공 시에는 box 가 곧 진단이다.
  if (box && box.diagnostics && typeof box.diagnostics === 'object') {
    return { ...box.diagnostics, failStage: box.stage, failCause: box.cause };
  }
  return box;
}

function validationDiagOf(result) {
  if (result.ok) return result.diagnostics?.bootstrap?.validation || null;
  const cause = result.detail?.cause || result.detail;
  return cause?.diagnostics || null;
}

function formatFailureHist(validation) {
  if (!validation || !Array.isArray(validation.formatFailures)) return null;
  const hist = {};
  for (const entry of validation.formatFailures) {
    const cause = entry.detail?.cause || entry.reason || 'unknown';
    hist[cause] = (hist[cause] || 0) + 1;
  }
  return { count: validation.formatFailures.length, hist };
}

const rows = [];
for (const target of TARGETS) {
  for (const cellPx of target.cellPx) {
    for (const tones of TONES) {
      const embedded = render(target, tones, cellPx);
      for (const deg of ROTATIONS) {
        const rotated = deg === 0 ? embedded : distortImage(embedded, { rotation: deg, fill: FILL });
        for (const channelId of CHANNEL_IDS) {
          const image = CHANNELS[channelId](rotated);
          const result = decodeFrontend(
            { width: image.width, height: image.height, pixels: image.pixels },
            { bootstrap: { family: { cube: { enableCellSurfaceY: true, enableLocatorY: true } } } },
          );
          const ok = result.ok === true && result.text === PAYLOAD;
          const cube = cubeDiagOf(result);
          const validation = validationDiagOf(result);
          const probe = cube?.cellSurfaceProbe || null;
          const reports = summarizeReports(cube?.geometryReports);
          const row = {
            layout: target.layout,
            cellPx,
            tones,
            deg,
            channel: channelId,
            canvas: image.width,
            ok,
            reason: ok ? null : (result.reason || null),
            pipelineCode: ok ? null : (result.detail?.cause?.pipelineCode
              || result.detail?.pipelineCode || null),
            detectPath: cube?.detectPath || cube?.source || null,
            hypothesisCount: cube?.hypothesisCount ?? null,
            probe: probe && {
              attempted: probe.attempted,
              accepted: probe.accepted,
              score: Number.isFinite(probe.score) ? Number(probe.score.toFixed(4)) : null,
              reason: probe.reason,
              layoutId: probe.layoutId ?? null,
            },
            csAttempts: reports.attempts,
            csByReason: reports.byReason,
            csTop: reports.top,
            blockLocatorRan: cube ? (cube.csBlockLocator !== undefined && cube.csBlockLocator !== null) : null,
            blockLocatorShapes: cube?.csBlockLocator?.shapeCount ?? null,
            formatFailures: formatFailureHist(validation),
            winner: ok ? {
              source: result.hypothesis?.source,
              layout: result.hypothesis?.cellSurfaceLayout,
              score: result.hypothesis?.cellSurfaceScore,
              margin: result.hypothesis?.orientationMargin,
            } : null,
          };
          rows.push(row);
          process.stderr.write(
            `${target.layout} c=${cellPx} t=${tones} ${deg}° ${channelId} `
            + `ok=${ok ? 'Y' : 'N'} path=${row.detectPath} `
            + `probe=${probe ? (probe.accepted ? 'ACC' : 'REJ:' + probe.reason) : '-'} `
            + `csAtt=${row.csAttempts} blkLoc=${row.blockLocatorRan === null ? '-' : (row.blockLocatorRan ? 'ran(' + row.blockLocatorShapes + ')' : 'NOT-RUN')}\n`,
          );
        }
      }
    }
  }
}

writeFileSync(
  new URL('./claude-cellpx12-anomaly.json', import.meta.url),
  JSON.stringify({ payload: PAYLOAD, marginCells: MARGIN_CELLS, rows }, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(rows.map((r) => ({
  layout: r.layout, cellPx: r.cellPx, tones: r.tones, deg: r.deg, channel: r.channel,
  ok: r.ok, reason: r.reason, detectPath: r.detectPath,
  probe: r.probe && (r.probe.accepted ? 'ACC:' + (r.probe.score ?? '') : 'REJ:' + r.probe.reason),
  blockLocatorRan: r.blockLocatorRan,
})), null, 1) + '\n');
