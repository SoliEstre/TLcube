/**
 * claude-guardring-exp.mjs — 009 §5 가드 링 반증 실험 A~F (src 무수정, 공개 API만).
 *
 * 결정적: RNG 없음. 렌더 = 손 scene(disc/polygon) → rasterize(9 px/cell, ss2).
 * 검출 = detectBullseyes(luma, { ringLayouts: [0, 2] }) — bootstrap.js 스캐너와 동일.
 * 성공을 기대하지 않는다(009 §2.3) — 실패 객체의 evaluatedRaw · bestCandidate 를 본다.
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
import { regionCells, facePolygon, FACES } from '../../../src/hexgrid.js';

const PPU = 9; // px per cell (cellSize = 1 unit)
const R = maxSafeRadius(1); // sqrt(13) = 3.605551...
const GUARD_JOINT = (5 / 6) * R; // 3.004626... — 투표 경계 5
const CANVAS = 24; // unit — 고립 실험 캔버스 한 변
const CENTER = CANVAS / 2; // unit

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

function detect(luma) {
  return detectBullseyes(luma, { ringLayouts: [0, 2] });
}

function summarize(name, result, trueCenterPx, trueCellPx) {
  const out = { name, trueCenterPx, trueCellPx };
  const judge = (center, cellSize) => {
    if (!center) return { centerErrPx: null, centerErrCell: null, cellSizeRelErrPct: null };
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
    out.candidateCount = result.candidates.length;
    out.top = {
      center: { x: top.center.x, y: top.center.y },
      cellSize: top.cellSize,
      innerBandsReplaced: top.innerBandsReplaced,
      score: top.score,
    };
    Object.assign(out, judge(top.center, top.cellSize));
    return out;
  }
  out.ok = false;
  out.reason = result.reason;
  const d = result.detail || {};
  out.message = d.message ?? null;
  out.evaluatedRaw = d.evaluatedRaw ?? null;
  out.evaluatedRefined = d.evaluatedRefined ?? null;
  out.bestScore = d.bestScore ?? null;
  out.bestCandidate = d.bestCandidate
    ? {
      center: { x: d.bestCandidate.center.x, y: d.bestCandidate.center.y },
      cellSize: d.bestCandidate.cellSize,
    }
    : null;
  Object.assign(out, judge(d.bestCandidate?.center, d.bestCandidate?.cellSize));
  return out;
}

function disc(cx, cy, r, color) {
  return { kind: 'disc', cx, cy, r, color };
}

// ---- 자 검증: 순수 불스아이 V1 (기본 파인더 'bullseye') --------------------------
function rulerFixture() {
  const encoded = encode('gt', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: palette() });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  return {
    luma: rasterToLuma(raster),
    trueCenter: {
      x: scene.layout.originX * PPU,
      y: scene.layout.originY * PPU,
    },
    trueCell: PPU * scene.layout.size,
  };
}

// ---- A~C: 고립 2-disc (명 r=R_max, 암 r=5/6 R_max, 내부 단색 암) ------------------
function isolatedGuardScene() {
  return {
    width: CANVAS,
    height: CANVAS,
    background: getPreset(DEFAULT_PRESET).background,
    shapes: [
      disc(CENTER, CENTER, R, BULLSEYE_LIGHT),
      disc(CENTER, CENTER, GUARD_JOINT, BULLSEYE_DARK),
    ],
  };
}

// ---- D: Type O V1 데이터 필드 + disc 2장 오버레이 --------------------------------
function overlayFixture() {
  const encoded = encode('gt', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: palette() });
  const size = scene.layout.size;
  const cx = scene.layout.originX;
  const cy = scene.layout.originY;
  scene.shapes.push(disc(cx, cy, R * size, BULLSEYE_LIGHT));
  scene.shapes.push(disc(cx, cy, GUARD_JOINT * size, BULLSEYE_DARK));
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  return {
    luma: rasterToLuma(raster),
    trueCenter: { x: cx * PPU, y: cy * PPU },
    trueCell: PPU * size,
  };
}

// ---- E: disc 없이 셀만 암으로 칠한 육각 가드 대조 --------------------------------
// 잘린 12셀(ring-2) + 내부 7셀 전부 암 — A 의 «내부 단색 암» 과 평행한 셀-칠 판.
// 안전(명)은 disc 없이 배경 전체를 명으로 둔다. 윤곽은 19셀 합집합의 육각 경계.
function hexGuardScene() {
  const layout = { size: 1, originX: CENTER, originY: CENTER };
  const shapes = [];
  for (const cell of regionCells(2)) {
    for (const face of FACES) {
      shapes.push({
        kind: 'polygon',
        points: facePolygon(cell.q, cell.r, face, layout),
        color: BULLSEYE_DARK,
      });
    }
  }
  return { width: CANVAS, height: CANVAS, background: BULLSEYE_LIGHT, shapes };
}

// ---- F: 명암 반전 disc + 기본 부호 ------------------------------------------------
function invertedGuardScene() {
  return {
    width: CANVAS,
    height: CANVAS,
    background: getPreset(DEFAULT_PRESET).background,
    shapes: [
      disc(CENTER, CENTER, R, BULLSEYE_DARK),
      disc(CENTER, CENTER, GUARD_JOINT, BULLSEYE_LIGHT),
    ],
  };
}

function runIsolated(name, scene) {
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  const luma = rasterToLuma(raster);
  const trueCenter = { x: CENTER * PPU, y: CENTER * PPU };
  return summarize(name, detect(luma), trueCenter, PPU);
}

const results = [];

// 자 검증
{
  const f = rulerFixture();
  results.push(summarize('ruler(pure-bullseye-V1)', detect(f.luma), f.trueCenter, f.trueCell));
}
// A~C
results.push(runIsolated('A-C(isolated-2disc)', isolatedGuardScene()));
// D
{
  const f = overlayFixture();
  results.push(summarize('D(V1-field+2disc-overlay)', detect(f.luma), f.trueCenter, f.trueCell));
}
// E
results.push(runIsolated('E(hex-cell-guard-no-disc)', hexGuardScene()));
// F
results.push(runIsolated('F(inverted-2disc-default-sign)', invertedGuardScene()));

console.log(JSON.stringify({
  constants: {
    PPU,
    R_max_unit: R,
    R_max_px: R * PPU,
    guardJoint_unit: GUARD_JOINT,
    guardJoint_px: GUARD_JOINT * PPU,
    canvasUnit: CANVAS,
  },
  results,
}, null, 2));
