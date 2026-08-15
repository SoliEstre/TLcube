/**
 * claude-guardring-exp-b5.mjs — 부가 진단: §2.2 «가드 고리 전용 제안 패스» 대조.
 *
 * A·D 와 같은 luma 에 proposalBoundaries: [5] 만 추가 (공개 옵션, src 무수정).
 * 기본 [1..5] 에서 C(cellSize) 가 죽은 원인이 «경계 5를 다른 k 로 해석» 인지 직접 확인.
 * 판정 문턱표(009 §5)의 정본 실험이 아니라 원인 규명용 — 보고서에 부가로만 적는다.
 */

import { maxSafeRadius } from '../../../src/bullseye.js';
import { detectBullseyes } from '../../../src/decoder/bullseye-detect.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance,
} from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';
import { encode } from '../../../src/encode.js';

const PPU = 9;
const R = maxSafeRadius(1);
const GUARD_JOINT = (5 / 6) * R;
const CANVAS = 24;
const CENTER = CANVAS / 2;

function palette() {
  const preset = getPreset(DEFAULT_PRESET);
  return {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  const alpha = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const offset = i * 4;
    data[i] = relativeLuminance({
      r: raster.pixels[offset],
      g: raster.pixels[offset + 1],
      b: raster.pixels[offset + 2],
    });
    alpha[i] = raster.pixels[offset + 3];
  }
  return { width: raster.width, height: raster.height, data, alpha };
}

function summarize(name, result, trueCenterPx, trueCellPx) {
  const out = { name };
  const judge = (center, cellSize) => {
    if (!center) return {};
    const dx = center.x - trueCenterPx.x;
    const dy = center.y - trueCenterPx.y;
    const errPx = Math.sqrt(dx * dx + dy * dy);
    return {
      centerErrPx: errPx,
      centerErrCell: errPx / trueCellPx,
      cellSizeRelErrPct: Number.isFinite(cellSize)
        ? (Math.abs(cellSize - trueCellPx) / trueCellPx) * 100
        : null,
    };
  };
  if (result.ok) {
    const top = result.candidates[0];
    out.ok = true;
    out.top = { center: top.center, cellSize: top.cellSize };
    Object.assign(out, judge(top.center, top.cellSize));
    return out;
  }
  const d = result.detail || {};
  out.ok = false;
  out.evaluatedRaw = d.evaluatedRaw ?? null;
  out.evaluatedRefined = d.evaluatedRefined ?? null;
  out.bestScore = d.bestScore ?? null;
  out.bestCandidate = d.bestCandidate ?? null;
  out.message = d.message ?? null;
  Object.assign(out, judge(d.bestCandidate?.center, d.bestCandidate?.cellSize));
  return out;
}

function isolatedLuma() {
  const scene = {
    width: CANVAS,
    height: CANVAS,
    background: getPreset(DEFAULT_PRESET).background,
    shapes: [
      { kind: 'disc', cx: CENTER, cy: CENTER, r: R, color: BULLSEYE_LIGHT },
      { kind: 'disc', cx: CENTER, cy: CENTER, r: GUARD_JOINT, color: BULLSEYE_DARK },
    ],
  };
  return rasterToLuma(rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 }));
}

function overlay() {
  const encoded = encode('gt', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: palette() });
  const size = scene.layout.size;
  const cx = scene.layout.originX;
  const cy = scene.layout.originY;
  scene.shapes.push({ kind: 'disc', cx, cy, r: R * size, color: BULLSEYE_LIGHT });
  scene.shapes.push({ kind: 'disc', cx, cy, r: GUARD_JOINT * size, color: BULLSEYE_DARK });
  return {
    luma: rasterToLuma(rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 })),
    trueCenter: { x: cx * PPU, y: cy * PPU },
    trueCell: PPU * size,
  };
}

const results = [];
{
  const luma = isolatedLuma();
  const trueCenter = { x: CENTER * PPU, y: CENTER * PPU };
  results.push(summarize(
    'A-b5(isolated, proposalBoundaries [5])',
    detectBullseyes(luma, { ringLayouts: [0, 2], proposalBoundaries: [5] }),
    trueCenter, PPU,
  ));
}
{
  const f = overlay();
  results.push(summarize(
    'D-b5(V1-overlay, proposalBoundaries [5])',
    detectBullseyes(f.luma, { ringLayouts: [0, 2], proposalBoundaries: [5] }),
    f.trueCenter, f.trueCell,
  ));
}
console.log(JSON.stringify(results, null, 2));
