/**
 * claude-v0wy-crossreal.mjs — **실물 래스터** 교차 오수용 전수 (v0X 드랍 후).
 *
 * 왜 이게 따로 필요한가: `cellSurfaceFinal.test.js` 의 이상 표본기는 슬롯 셀을
 * «관측 없음» 으로 돌려서 v0W ↔ v0WQ 를 구조적으로 별칭으로 만든다
 * (`claude-v0wy-crossmatrix.mjs` 가 그 사실을 잰다). 그래서 «라인업이 서로 새는가» 의
 * **판정기는 실물 래스터**여야 한다 — 슬롯 자리에 진짜 QR 모듈·필러 픽셀이 있어야
 * v0W 의 NW 기대가 실제로 어긋나기 때문이다.
 *
 * 그리고 이 표는 운영자 관측 「v0 과 혼선 자주」의 **유일한 계측기**다: v0(n=13) 과
 * n=21 후보들이 같은 표에 있고 각각 자기 레이아웃으로 풀려야 한다.
 *
 * 팔:
 *   · after  — 지금 출고되는 라인업 (v0x 드랍). 스위치 없음.
 *   · before — 드랍 전 (v0x 후보 + v0xFamily on). 같은 프레임·같은 칸.
 * 게이트(0.78 · 0.035 · CRC · RS)는 한 값도 안 건드린다 — 읽기만 한다.
 *
 * 실행: node test/output/lanes/claude-v0wy-crossreal.mjs
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
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

/** 프레임 = (레이아웃, 버전, ppu). v0 만 n=13 이라 ppu 를 올려 셀 크기를 맞춘다. */
const FRAMES = Object.freeze([
  ['v0', 0, 17],
  ['v0w', 1, 15],
  ['v0wq', 1, 15],
  ['v0w2', 1, 15],
  ['v0x', 1, 15],
]);

const TONES = Object.freeze([
  ['clean', {}],
  ['gamma0.7', { gamma: 0.7 }],
  ['sCurve0.6', { sCurve: 0.6 }],
]);
const ROTATIONS = Object.freeze([0, 120, 240]);

/** 드랍 복원 — v0x 만 되돌린다 (v2r2·v1r2·v0xq 는 그대로 내려 둔다). */
const RESTORE_V0X = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  calibration: { csBlockLocator: { v0xFamily: true } },
});

function render(layout, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  return rasterize(buildSceneY(encoded, opts), { pixelsPerUnit, supersample: 2 });
}

function embed960(raster) {
  const W = 960;
  const H = 960;
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let index = 0; index < W * H; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

/** ⚠ calibration 은 여기서만 만든다 — 중첩 경로 고정. */
function decodeLab(frame, cube = {}) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: { cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube } },
    },
  });
}

function outcome(result) {
  if (!result.ok) return 'FAIL:' + (result.reason || 'unknown');
  const layout = result.hypothesis && result.hypothesis.cellSurfaceLayout;
  const n = result.hypothesis && result.hypothesis.n;
  return layout + '@' + n + (result.text === PAYLOAD ? '' : ':WRONGTEXT');
}

const rows = [];
for (const [layout, version, ppu] of FRAMES) {
  const base = embed960(render(layout, version, ppu));
  for (const [toneName, tone] of TONES) {
    for (const rotation of ROTATIONS) {
      const frame = distortImage(base, { ...tone, rotation, fill: FILL });
      rows.push({
        layout,
        cell: `${toneName}/rot${rotation}`,
        after: outcome(decodeLab(frame)),
        before: outcome(decodeLab(frame, RESTORE_V0X)),
      });
    }
  }
}

const pad = (s, n) => String(s).padEnd(n);
process.stdout.write('# 실물 래스터 교차 오수용 전수 — v0X 드랍 전/후 (2톤 · 같은 프레임)\n');
process.stdout.write('# after = 출고 라인업 [v0]/[v0w,v0wq,v0w2] · before = + v0x 복원\n\n');
process.stdout.write(pad('frame', 7) + pad('cell', 20) + pad('after', 36) + 'before\n');
for (const row of rows) {
  const flag = row.after === row.before ? '' : '   ← 갈림';
  process.stdout.write(pad(row.layout, 7) + pad(row.cell, 20)
    + pad(row.after, 36) + row.before + flag + '\n');
}

process.stdout.write('\n# 판정\n');
let wrongAfter = 0;
let wrongBefore = 0;
for (const row of rows) {
  const want = row.layout + '@' + (row.layout === 'v0' ? 13 : 21);
  if (row.after !== want) wrongAfter += 1;
  if (row.before !== want) wrongBefore += 1;
}
process.stdout.write(`  after  — 자기 레이아웃이 아닌 칸 ${wrongAfter}/${rows.length}\n`);
process.stdout.write(`  before — 자기 레이아웃이 아닌 칸 ${wrongBefore}/${rows.length}\n`);
const v0Rows = rows.filter((row) => row.layout === 'v0');
process.stdout.write('\n# v0(n=13) 축만 — 운영자 「v0 과 혼선」 관측의 계측기\n');
for (const row of v0Rows) {
  process.stdout.write(`  ${pad(row.cell, 20)} after ${pad(row.after, 16)} before ${row.before}\n`);
}

// ── 부록: «v0 과 혼선» 의 로케이터 층 기질 ───────────────────────────────────
//
// 합성 프레임에서 복호 결과가 안 갈렸다고 «기질이 없다» 고 말하면 안 된다 —
// 복호는 CS 게이트를 통과한 뒤의 결과이고, 혼선은 그 **앞 단계**(포즈가 서느냐)
// 에서 시작한다. 그래서 포즈 수를 따로 찍는다: v0 프레임에서 v0x 포즈가 서는가,
// v0X 프레임에서 v0 포즈가 서는가.
const { detectCellSurfaceBlockShapes } = await import(
  '../../../src/decoder/cellsurface-block-detect.js');
const { toRelativeLuminance } = await import('../../../src/decoder/luma.js');

process.stdout.write('\n# 로케이터 층 — 포즈 수 (v0x 패밀리 복원 팔)\n');
for (const [layout, version, ppu] of [['v0', 0, 17], ['v0x', 1, 15]]) {
  const base = embed960(render(layout, version, ppu));
  for (const [toneName, tone] of TONES) {
    const luma = toRelativeLuminance(distortImage(base, { ...tone, rotation: 0, fill: FILL }));
    const off = detectCellSurfaceBlockShapes(luma);
    const on = detectCellSurfaceBlockShapes(luma, RESTORE_V0X.calibration
      ? { calibration: RESTORE_V0X.calibration } : {});
    process.stdout.write(
      `  ${pad(layout + ' ' + toneName, 22)}`
      + ` after {v0:${off.diagnostics.poseCount.v0}, v0x:${off.diagnostics.poseCount.v0x},`
      + ` v0w:${off.diagnostics.poseCount.v0w}, v0w2:${off.diagnostics.poseCount.v0w2}}`
      + `  before {v0:${on.diagnostics.poseCount.v0}, v0x:${on.diagnostics.poseCount.v0x},`
      + ` v0w:${on.diagnostics.poseCount.v0w}, v0w2:${on.diagnostics.poseCount.v0w2}}\n`,
    );
  }
}
