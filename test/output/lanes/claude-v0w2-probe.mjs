/**
 * claude-v0w2-probe.mjs — v0W2 편입 실측 (표를 만드는 쪽. 회귀는 테스트가 건다).
 *
 * 재는 것:
 *   ① 방향 margin 전수 (활성 + 드랍) — v0W2 가 v0W(0.0952) 보다 두꺼워졌나가 본론
 *   ② 자기 복호 — 톤 커브 4종 × 회전 3방향
 *   ③ 교차 오수용 양방향 전수 (v0 · v0X · v0XQ · v0W · v0WQ · v0W2)
 *   ④ **rot0 슬롯 위반** (v0W 프로그램 §26 F6 지표) — 무회전 프레임에서 가설이
 *      120/240 슬롯을 주장하는 건수. v0W 과 v0W2 를 나란히 센다.
 *   ⑤ 포즈 회계 (패밀리 격리 · 비침습성)
 *
 * 실행: node test/output/lanes/claude-v0w2-probe.mjs [--skip cross]
 * src 무수정 · RNG 없음 · test/output/ 밖에 쓰지 않는다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { encode } from '../../../src/encode.js';
import { encodeA } from '../../../src/encodeA.js';
import { buildScene } from '../../../src/scene.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { evaluateCellSurfaceGeometry } from '../../../src/decoder/cellSurfaceY-detect.js';
import { locatorCellsCellSurfaceFinal } from '../../../src/cellSurfaceFinal.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { TL_READER_URL } from '../../../src/qr.js';
import { distortImage } from '../../harness/distort.mjs';

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
const NEEDS_QR = new Set(['v0xq', 'v0wq']);

const RESTORE = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  calibration: { csBlockLocator: { v2r2Family: true, v1r2Family: true, v0xqFamily: true } },
});

function renderFinal(layout, version, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  return rasterize(buildSceneY(encoded, opts), { pixelsPerUnit: ppu, supersample: 2 });
}

function embed960(raster) {
  const W = 960; const H = 960;
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let k = 0; k < W * H; k += 1) {
    out.pixels[k * 4] = FILL.r; out.pixels[k * 4 + 1] = FILL.g;
    out.pixels[k * 4 + 2] = FILL.b; out.pixels[k * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s]; out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2]; out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

function decodeLab(frame, cube = {}) {
  return decodeFrontend({ width: frame.width, height: frame.height, pixels: frame.pixels }, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube } } },
  });
}

// ── ① 방향 margin ─────────────────────────────────────────────────────────
function idealSampleCellFor(n, cycle, id) {
  const table = locatorCellsCellSurfaceFinal(n, id);
  const byKey = new Map(table.map((cell) => [cell.i + ',' + cell.j, cell]));
  return (i, j) => {
    const cell = byKey.get(i + ',' + j);
    if (!cell) return { i, j, ok: false };
    return {
      i, j, ok: true,
      T: { median: cell[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: cell[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: cell[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

console.log('── ① 방향 margin 전수 (ideal 표본기 · 게이트 하한 0.035) ──');
console.log('| 레이아웃 | 파인더 셀 | 면 | 면 비대칭 | margin | 게이트 배수 |');
console.log('|---|---|---|---|---|---|');
const MARGIN_ROWS = [
  [13, 'v0'], [21, 'v2r2'], [25, 'v2r2'], [21, 'v1r2'],
  [21, 'v0x'], [21, 'v0xq'], [21, 'v0w'], [21, 'v0wq'], [21, 'v0w2'],
];
for (const [n, id] of MARGIN_ROWS) {
  const cells = locatorCellsCellSurfaceFinal(n, id);
  const asym = cells.filter((c) => !(c.T === c.L && c.L === c.R)).length;
  const canon = evaluateCellSurfaceGeometry(
    { n }, idealSampleCellFor(n, ['T', 'L', 'R'], id), { cellSurfaceLayout: id },
  );
  const margin = canon.scored.orientationMargin;
  const wrong = [['L', 'R', 'T'], ['R', 'T', 'L']].map((cycle) => evaluateCellSurfaceGeometry(
    { n }, idealSampleCellFor(n, cycle, id), { cellSurfaceLayout: id },
  ).accepted);
  console.log('| ' + id + '@' + n + ' | ' + cells.length + ' | ' + (cells.length * 3)
    + ' | ' + asym + ' (' + (asym / cells.length * 100).toFixed(1) + ' %)'
    + ' | **' + margin.toFixed(4) + '** | ×' + (margin / 0.035).toFixed(1)
    + (wrong.some(Boolean) ? ' ⚠오방향수용' : '') + ' |');
}

if (process.argv.includes('--only-margin')) process.exit(0);

// ── 프레임 ────────────────────────────────────────────────────────────────
const FRAMES = {
  v0: embed960(renderFinal('v0', 0, 17)),
  v0x: embed960(renderFinal('v0x', 1, 15)),
  v0xq: embed960(renderFinal('v0xq', 1, 15)),
  v0w: embed960(renderFinal('v0w', 1, 15)),
  v0wq: embed960(renderFinal('v0wq', 1, 15)),
  v0w2: embed960(renderFinal('v0w2', 1, 15)),
};

// ── ② 자기 복호 (톤 4 × 회전 3) ───────────────────────────────────────────
const TONES = [
  ['clean', {}], ['sCurve0.6', { sCurve: 0.6 }],
  ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
];
console.log('\n── ② 자기 복호 (톤 4 × 회전 3 = 12칸) ──');
console.log('| 레이아웃 | ' + TONES.map(([n2]) => n2).join(' | ') + ' | 합 |');
console.log('|---|---|---|---|---|---|');
for (const id of ['v0w2', 'v0w', 'v0wq', 'v0x']) {
  const cells = [];
  let ok = 0;
  for (const [, tone] of TONES) {
    const marks = [];
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(FRAMES[id], { ...tone, rotation, fill: FILL }));
      const good = decoded.ok && decoded.text === PAYLOAD
        && decoded.hypothesis.cellSurfaceLayout === id;
      if (good) ok += 1;
      marks.push(good ? '○' : (decoded.ok ? '⇒' + decoded.hypothesis.cellSurfaceLayout : '✗'));
    }
    cells.push(marks.join(''));
  }
  console.log('| ' + id + ' | ' + cells.join(' | ') + ' | **' + ok + '/12** |');
}

// ── ③ 교차 오수용 양방향 전수 ─────────────────────────────────────────────
console.log('\n── ③ 교차 오수용 — 프레임 × 회전 3방향, 복호 레이아웃 ──');
for (const [name, extra] of [
  ['v0', {}], ['v0x', {}], ['v0xq', RESTORE], ['v0w', {}], ['v0wq', {}], ['v0w2', {}],
]) {
  const seen = [];
  for (const rotation of [0, 120, 240]) {
    const decoded = decodeLab(distortImage(FRAMES[name], { rotation, fill: FILL }), extra);
    seen.push(decoded.ok
      ? (decoded.hypothesis.cellSurfaceLayout + (decoded.text === PAYLOAD ? '' : '!TEXT'))
      : 'FAIL:' + decoded.reason);
  }
  const clean = seen.every((s) => s === name);
  console.log('  ' + name.padEnd(5) + ' → ' + seen.join(' · ') + (clean ? '  ✓' : '  ✖'));
}

// Type O · A 프레임
{
  const oFrame = embed960(rasterize(
    buildScene(encode(PAYLOAD, { version: 2, eccLevel: 'M' }), { palette: PALETTE, margin: 20 }),
    { pixelsPerUnit: 12, supersample: 2 },
  ));
  const aFrame = embed960(rasterize(
    buildScene(encodeA(PAYLOAD, { version: 1, eccLevel: 'M' }), { palette: PALETTE, margin: 20 }),
    { pixelsPerUnit: 12, supersample: 2 },
  ));
  for (const [name, frame] of [['O', oFrame], ['A', aFrame]]) {
    for (const rotation of [0, 120]) {
      const detected = detectCellSurfaceBlockShapes(
        toRelativeLuminance(distortImage(frame, { rotation, fill: FILL })),
      );
      const ids = detected.shapes.map((s) => s.blockLocator.layoutId);
      console.log('  Type ' + name + ' rot' + rotation + ' shapes: '
        + (ids.length ? ids.join(',') : '(없음)')
        + (ids.includes('v0w2') ? '  ✖ v0w2 shape' : '  ✓'));
    }
  }
}

// ── ④ rot0 슬롯 위반 (§26 F6 지표) ────────────────────────────────────────
console.log('\n── ④ rot0 슬롯 위반 — 무회전 프레임인데 가설이 120/240 을 주장 ──');
console.log('| 레이아웃 | 톤 | rotationDegrees | facePhase | 위반 |');
console.log('|---|---|---|---|---|');
let v0wViol = 0; let v0w2Viol = 0;
for (const id of ['v0w', 'v0w2']) {
  for (const [label, tone] of TONES) {
    const decoded = decodeLab(distortImage(FRAMES[id], { ...tone, rotation: 0, fill: FILL }));
    const deg = decoded.ok ? decoded.hypothesis.rotationDegrees : null;
    const phase = decoded.ok ? decoded.hypothesis.facePhase : null;
    const bad = decoded.ok && deg !== 0;
    if (bad && id === 'v0w') v0wViol += 1;
    if (bad && id === 'v0w2') v0w2Viol += 1;
    console.log('| ' + id + ' | ' + label + ' | ' + (decoded.ok ? deg : 'FAIL:' + decoded.reason)
      + ' | ' + phase + ' | ' + (bad ? '**위반**' : '—') + ' |');
  }
}
console.log('  ⇒ v0w 위반 ' + v0wViol + '/4 · v0w2 위반 ' + v0w2Viol + '/4');

// ── ⑤ 포즈 회계 ───────────────────────────────────────────────────────────
console.log('\n── ⑤ 포즈 회계 (rot0 · 무왜곡) ──');
const FAMILIES = ['v2r2', 'v1r2', 'v0x', 'v0xq', 'v0w', 'v0wq', 'v0w2', 'v0'];
console.log('| 프레임 | ' + FAMILIES.join(' | ') + ' |');
console.log('|---' + '|---'.repeat(FAMILIES.length) + '|');
for (const name of Object.keys(FRAMES)) {
  const luma = toRelativeLuminance(distortImage(FRAMES[name], { rotation: 0, fill: FILL }));
  const on = detectCellSurfaceBlockShapes(luma);
  console.log('| ' + name + ' | ' + FAMILIES.map((f) => on.diagnostics.poseCount[f]).join(' | ') + ' |');
}
console.log('\n── ⑤-b 비침습성 — v0w2Family on/off 로 기존 패밀리 poseCount 가 같은가 ──');
for (const name of Object.keys(FRAMES)) {
  const luma = toRelativeLuminance(distortImage(FRAMES[name], { rotation: 0, fill: FILL }));
  const on = detectCellSurfaceBlockShapes(luma);
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0w2Family: false } },
  });
  const drift = FAMILIES.filter((f) => f !== 'v0w2'
    && on.diagnostics.poseCount[f] !== off.diagnostics.poseCount[f]);
  const verifiedSame = JSON.stringify(on.diagnostics.verified) === JSON.stringify(off.diagnostics.verified);
  console.log('  ' + name.padEnd(5) + ' : 기존 패밀리 변동 ' + (drift.length ? drift.join(',') : '없음')
    + ' · verified 동일 ' + verifiedSame + ' · off 의 v0w2 포즈 ' + off.diagnostics.poseCount.v0w2);
}
