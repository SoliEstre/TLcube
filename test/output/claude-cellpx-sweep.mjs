/**
 * claude-cellpx-sweep.mjs — cell_px 통제 합성 스윕 (읽기 전용 벤치, 커밋 대상 아님).
 *
 * 목적: 실기기에서 관측된 v0 우위가 «저해상도(n=13 이라 셀이 크다)» 효과인지
 * «검출기 디자인(4코너 블록 vs 앵커 A/B)» 효과인지 축을 분리한다.
 *
 * 통제 변수 = cell_px (= rasterize 의 pixelsPerUnit = 육각 셀 외접원 반지름 px).
 *   셀 가로 폭(flat-to-flat) = √3 · cell_px, 세로(point-to-point) = 2 · cell_px.
 *   같은 cell_px 에서 n=21 캔버스는 n=13 보다 크다 — 그게 통제의 요점이다.
 *
 * 결정적: RNG 없음(노이즈 단계 미사용), 고정 페이로드, 고정 회전/톤 파라미터.
 */
import { writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { extractCellSurfaceProbe } from '../../src/lab-telemetry.js';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../../src/decoder/cellsurface-block-detect.js';
import { distortImage, applyGamma, applySCurve } from '../harness/distort.mjs';
import { TL_READER_URL } from '../../src/qr.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
/** 회전 채움은 반드시 불투명 — a 누락은 normalizeFill 이 던진다(의도된 가드). */
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

const PAYLOAD = 'https://tl.estre.so';
const MARGIN_CELLS = 4; // 콰이어트 존을 셀 단위로 고정 → 레이아웃 간 비례 동일
const CELL_PX = process.env.CELLPX
  ? process.env.CELLPX.split(',').map(Number)
  : [7, 8, 9, 10, 12, 15];
const TONES = [2, 3];
const ROTATIONS = [0, 105, 240];
const ALL_TARGETS = [
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v1r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 1, n: 21 },
  // 2026-08-16 v0X 편입 — 같은 n=21 이라 cell_px 통제 축이 v1r2 와 동일하다.
  { layout: 'v0x', version: 1, n: 21 },
  // 2026-08-17 v0xq 편입 — 같은 n=21. **중앙 QR 모듈은 셀보다 작다**(피치 9/29 셀)
  // 이라 이 축에서 가장 먼저 죽을 후보다. 그 문턱을 재는 것이 이 열의 목적이다.
  { layout: 'v0xq', version: 1, n: 21 },
];
const TARGETS = process.env.SWEEP_LAYOUTS
  ? ALL_TARGETS.filter((t) => process.env.SWEEP_LAYOUTS.split(',').includes(t.layout))
  : ALL_TARGETS;
const CHANNELS = [
  { id: 'clean', kind: 'none' },
  { id: 'sCurve0.6', kind: 'sCurve', amount: 0.6 },
  { id: 'gamma0.7', kind: 'gamma', value: 0.7 },
  { id: 'blur0.5', kind: 'blur', sigma: 0.5 },
  { id: 'blur1.0', kind: 'blur', sigma: 1.0 },
];

// ── Gaussian blur (test/cellSurfaceY-decode.test.js 의 헬퍼와 같은 산술) ─────
function gaussianBlur(raster, sigma) {
  const radius = Math.ceil(3 * sigma);
  const weights = new Float64Array(radius * 2 + 1);
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    weightSum += weight;
  }
  for (let i = 0; i < weights.length; i += 1) weights[i] /= weightSum;
  const { width, height } = raster;
  const horizontal = new Float32Array(width * height * 3);
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let o = -radius; o <= radius; o += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + o));
          sum += raster.pixels[(y * width + sx) * 4 + ch] * weights[o + radius];
        }
        horizontal[(y * width + x) * 3 + ch] = sum;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let o = -radius; o <= radius; o += 1) {
          const sy = Math.max(0, Math.min(height - 1, y + o));
          sum += horizontal[(sy * width + x) * 3 + ch] * weights[o + radius];
        }
        const v = Math.round(sum);
        pixels[(y * width + x) * 4 + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return { ...raster, pixels };
}

/** 회전이 모서리를 자르지 않도록 대각선 이상의 정사각 캔버스에 배경색으로 심는다. */
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
  // v0xq 는 중앙 QR 이 레이아웃의 일부라 qrText 가 필수다 (코너 QR 은 자동 억제).
  const scene = buildSceneY(encoded, {
    palette: PALETTE,
    margin: MARGIN_CELLS,
    ...(target.layout === 'v0xq' ? { qrText: TL_READER_URL } : {}),
  });
  const raster = rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 });
  return { raster, embedded: embedSquare(raster) };
}

function applyChannel(image, channel) {
  if (channel.kind === 'none') return image;
  if (channel.kind === 'sCurve') return applySCurve(image, channel.amount);
  if (channel.kind === 'gamma') return applyGamma(image, channel.value);
  if (channel.kind === 'blur') return gaussianBlur(image, channel.sigma);
  throw new Error('unknown channel: ' + channel.kind);
}

function decode(image) {
  const t0 = process.hrtime.bigint();
  const result = decodeFrontend(
    { width: image.width, height: image.height, pixels: image.pixels },
    { bootstrap: { family: { cube: { enableCellSurfaceY: true, enableLocatorY: true } } } },
  );
  return { result, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

function locatorProbe(image) {
  const t0 = process.hrtime.bigint();
  const luma = toRelativeLuminance(image);
  const det = detectCellSurfaceBlockShapes(luma);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const top = det.shapes && det.shapes.length ? det.shapes[0] : null;
  return {
    shapeCount: det.diagnostics.shapeCount,
    poseCount: det.diagnostics.poseCount,
    verified: det.diagnostics.verified.length,
    downsampleFactor: Number(det.diagnostics.downsampleFactor.toFixed(4)),
    topLayoutId: top && top.blockLocator ? (top.blockLocator.layoutId || null) : null,
    topFamily: top && top.blockLocator ? (top.blockLocator.family || null) : null,
    ms: Number(ms.toFixed(1)),
  };
}

const rows = [];
const started = Date.now();
let done = 0;
const total = CELL_PX.length * TARGETS.length * TONES.length * ROTATIONS.length * CHANNELS.length;

for (const cellPx of CELL_PX) {
  for (const target of TARGETS) {
    for (const tones of TONES) {
      const { raster, embedded } = render(target, tones, cellPx);
      for (const deg of ROTATIONS) {
        const rotated = deg === 0
          ? embedded
          : distortImage(embedded, { rotation: deg, fill: FILL });
        for (const channel of CHANNELS) {
          const image = applyChannel(rotated, channel);
          const { result, ms } = decode(image);
          const probe = extractCellSurfaceProbe(result);
          const loc = locatorProbe(image);
          const ok = result.ok === true && result.text === PAYLOAD;
          const row = {
            cellPx,
            layout: target.layout,
            n: target.n,
            tones,
            deg,
            channel: channel.id,
            canvas: embedded.width,
            rasterW: raster.width,
            rasterH: raster.height,
            ok,
            reason: ok ? null : (result.reason || (result.ok ? 'text-mismatch' : '(empty)')),
            observedLayout: (result.hypothesis && result.hypothesis.cellSurfaceLayout) || null,
            rotationDeg: (result.hypothesis
              && Number.isFinite(result.hypothesis.rotationDegrees))
              ? result.hypothesis.rotationDegrees : null,
            probeAccepted: probe.accepted,
            probeReason: probe.reason,
            probeLayout: probe.layoutId,
            locShapes: loc.shapeCount,
            locVerified: loc.verified,
            locPose: loc.poseCount,
            locTopLayout: loc.topLayoutId,
            locDownsample: loc.downsampleFactor,
            effectiveCellPx: Number((cellPx / loc.downsampleFactor).toFixed(2)),
            locMs: loc.ms,
            ms: Number(ms.toFixed(1)),
          };
          rows.push(row);
          done += 1;
          process.stderr.write(
            `[${done}/${total}] c=${cellPx} ${target.layout}@${target.n} t=${tones} ${deg}° `
            + `${channel.id} ok=${ok ? 'Y' : 'N'} ${row.reason || ''} `
            + `loc=${row.locShapes}/${row.locTopLayout} ds=${row.locDownsample} `
            + `eff=${row.effectiveCellPx} ${row.ms}ms\n`,
          );
        }
      }
    }
  }
  writeFileSync(
    new URL('./claude-cellpx-sweep.json', import.meta.url),
    JSON.stringify({ partial: true, cellPxDone: cellPx, rows }, null, 2) + '\n',
  );
}

// ── 집계 ───────────────────────────────────────────────────────────────────
function pick(filter) {
  return rows.filter((row) => Object.entries(filter)
    .every(([key, value]) => value === undefined || row[key] === value));
}
function rate(slice) {
  if (!slice.length) return null;
  return { ok: slice.filter((r) => r.ok).length, n: slice.length };
}
function reasonHist(slice) {
  const hist = {};
  for (const row of slice) {
    if (row.ok) continue;
    const key = row.reason || row.probeReason || '(empty)';
    hist[key] = (hist[key] || 0) + 1;
  }
  return hist;
}

const byCellPxLayout = {};
for (const cellPx of CELL_PX) {
  byCellPxLayout[cellPx] = {};
  for (const target of TARGETS) {
    const all = pick({ cellPx, layout: target.layout });
    byCellPxLayout[cellPx][target.layout] = {
      all: rate(all),
      byTones: Object.fromEntries(TONES.map((t) => [t, rate(pick({ cellPx, layout: target.layout, tones: t }))])),
      byChannel: Object.fromEntries(CHANNELS.map((c) =>
        [c.id, rate(pick({ cellPx, layout: target.layout, channel: c.id }))])),
      byRotation: Object.fromEntries(ROTATIONS.map((d) =>
        [d, rate(pick({ cellPx, layout: target.layout, deg: d }))])),
      locatorHit: (() => {
        const hit = all.filter((r) => r.locShapes > 0).length;
        return { hit, n: all.length };
      })(),
      locatorLayoutHit: (() => {
        const hit = all.filter((r) => r.locTopLayout === target.layout
          || (target.layout === 'v0' && r.locTopLayout === null && r.locShapes > 0)).length;
        return { hit, n: all.length };
      })(),
      probeAccepted: (() => {
        const hit = all.filter((r) => r.probeAccepted).length;
        return { hit, n: all.length };
      })(),
      meanMs: Number((all.reduce((s, r) => s + r.ms, 0) / all.length).toFixed(1)),
      meanLocMs: Number((all.reduce((s, r) => s + r.locMs, 0) / all.length).toFixed(1)),
      effectiveCellPx: [...new Set(all.map((r) => r.effectiveCellPx))],
      canvas: [...new Set(all.map((r) => r.canvas))],
      reasons: reasonHist(all),
    };
  }
}

const out = {
  note: 'cell_px 통제 합성 스윕. 결정적(RNG 없음). 실기기 결론 아님 — 합성 렌더+합성 왜곡.',
  cellPxDefinition: 'cell_px = rasterize pixelsPerUnit = 육각 셀 외접원 반지름(px). 셀 가로폭 = √3·cell_px, 세로 = 2·cell_px.',
  payload: PAYLOAD,
  marginCells: MARGIN_CELLS,
  fill: FILL,
  grid: { cellPx: CELL_PX, tones: TONES, rotations: ROTATIONS, channels: CHANNELS.map((c) => c.id) },
  elapsedMs: Date.now() - started,
  byCellPxLayout,
  rows,
};
writeFileSync(
  new URL('./claude-cellpx-sweep.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
process.stdout.write(JSON.stringify({ elapsedMs: out.elapsedMs, byCellPxLayout }, null, 2) + '\n');
