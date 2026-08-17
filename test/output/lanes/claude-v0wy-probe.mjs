/**
 * claude-v0wy-probe.mjs — v0WY 편입 실측 (표를 만드는 쪽. 회귀는 테스트가 건다).
 *
 * 재는 것:
 *   ① 방향 margin 전수 (활성 5 + 드랍 5) — v0WY 0.0796 이 게이트 위인가가 본론
 *   ② 자기 복호 (톤 4 × 회전 3)
 *   ③ **슬롯 QR 확증 분포** — 문턱 `v0wySlotQrMinContrast` 의 근거 실측
 *      (진짜 v0WY 코너 슬롯 vs v0W·v0W2 프레임의 같은 자리)
 *   ④ 교차 오수용 양방향 전수 (v0 · v0W · v0WQ · v0W2 · v0WY + 드랍 v0X/v0XQ) + O/A
 *   ⑤ 포즈 회계 (패밀리 격리 · 비침습성 · 슬롯 확증 거절 수)
 *
 * 실행: node test/output/lanes/claude-v0wy-probe.mjs [--only-margin]
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
import {
  CELL_SURFACE_FINAL_ACTIVE_IDS, CELL_SURFACE_FINAL_DROPPED_IDS,
  locatorCellsCellSurfaceFinal,
} from '../../../src/cellSurfaceFinal.js';
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
const NEEDS_QR = new Set(['v0xq', 'v0wq', 'v0wy']);

const RESTORE = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  calibration: {
    csBlockLocator: {
      v2r2Family: true, v1r2Family: true, v0xqFamily: true, v0xFamily: true,
    },
  },
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

/**
 * ⚠ **calibration 은 `bootstrap.family.cube.calibration` 중첩 경로만 먹는다.**
 * 최상위 `options.calibration` 은 조용히 버려진다 — 그러면 모든 팔이 같은 값을 내고
 * «스위치가 아무 효과도 없다» 는 **거짓 결론**이 나온다 (이 레인이 첫 실행에서
 * 정확히 그 함정을 밟았다: 문턱 −2 부터 1.2 까지 전부 같은 수치였다).
 * 그래서 cube 노드에 **통째로 스프레드**한다.
 */
function decodeLab(frame, cube = {}) {
  return decodeFrontend({ width: frame.width, height: frame.height, pixels: frame.pixels }, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube } } },
  });
}


/**
 * 진단 추출 — `csBlockLocator` 는 bootstrap 트리 안쪽에 묻혀 있고 성공/실패에서
 * 경로가 다르다. 바로 `result.diagnostics.cellSurfaceBlockLocator` 를 읽으면
 * **무조건 undefined 가 나와 «포즈 0» 으로 보이는 함정**이다
 * (직전 레인도 같은 자리에서 이 helper 를 만들었다).
 */
function diagnosticsOf(result) {
  if (result.ok) {
    const boot = result.diagnostics && result.diagnostics.bootstrap;
    return boot && boot.cube ? boot.cube : boot;
  }
  const detail = result.detail || {};
  return detail.diagnostics || (detail.cause && detail.cause.diagnostics) || null;
}

function findCsBlockLocator(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (node.csBlockLocator) return node.csBlockLocator;
  for (const key of Object.keys(node)) {
    const found = findCsBlockLocator(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function locatorDiag(result) {
  return findCsBlockLocator(diagnosticsOf(result));
}

// ── ① 방향 margin 전수 ────────────────────────────────────────────────────
function idealSampleCellFor(n, cycle = ['T', 'L', 'R'], id = undefined) {
  const table = locatorCellsCellSurfaceFinal(n, id);
  const byKey = new Map(table.map((cell) => [cell.i + ',' + cell.j, cell]));
  return (i, j) => {
    const cell = byKey.get(i + ',' + j);
    if (!cell) return { i, j, ok: false };
    return {
      i,
      j,
      ok: true,
      T: { median: cell[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: cell[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: cell[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

console.log('── ① 방향 margin (활성 / 드랍) ──');
console.log('| 레이아웃 | n | 파인더 셀 | 면 비대칭 | margin | 게이트 0.035 배수 |');
console.log('|---|---|---|---|---|---|');
const NS = { v0: 13, v2r2: 21, v1r2: 21, v0x: 21, v0xq: 21, v0w: 21, v0wq: 21, v0w2: 21, v0wy: 21 };
for (const arm of [CELL_SURFACE_FINAL_ACTIVE_IDS, CELL_SURFACE_FINAL_DROPPED_IDS]) {
  for (const id of arm) {
    const n = NS[id];
    const cells = locatorCellsCellSurfaceFinal(n, id);
    const asym = cells.filter((c) => !(c.T === c.L && c.L === c.R)).length;
    const canon = evaluateCellSurfaceGeometry(
      { n }, idealSampleCellFor(n, undefined, id), { cellSurfaceLayout: id },
    );
    const margin = canon.scored.orientationMargin;
    console.log('| ' + id + (arm === CELL_SURFACE_FINAL_DROPPED_IDS ? ' (드랍)' : '')
      + ' | ' + n + ' | ' + cells.length + ' | ' + asym
      + ' | **' + margin.toFixed(4) + '** | ' + (margin / 0.035).toFixed(2) + '× |');
    // 오방향 두 순환은 반드시 거부돼야 한다 (자 검증).
    for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
      const wrong = evaluateCellSurfaceGeometry(
        { n }, idealSampleCellFor(n, cycle, id), { cellSurfaceLayout: id },
      );
      if (wrong.accepted) console.log('   ★ ' + id + ' 오방향 수용 — 회귀 위반');
    }
  }
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
  v0wy: embed960(renderFinal('v0wy', 1, 15)),
};

const TONES = [
  ['clean', {}], ['sCurve0.6', { sCurve: 0.6 }],
  ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
];

// ── ② 자기 복호 ───────────────────────────────────────────────────────────
console.log('\n── ② 자기 복호 (톤 4 × 회전 3 = 12칸) ──');
console.log('| 레이아웃 | ' + TONES.map(([n2]) => n2).join(' | ') + ' | 합 |');
console.log('|---|---|---|---|---|---|');
for (const id of ['v0wy', 'v0w', 'v0wq', 'v0w2']) {
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

// ── ③ 슬롯 QR 확증 — 문턱의 근거 ──────────────────────────────────────────
//
// 문턱을 직접 재려면 조립 안쪽을 봐야 하는데, 그 대신 **관측 가능한 대리 지표**로
// 잰다: 문턱을 0(=사실상 무력화)부터 1.2(=진짜도 자름)까지 쓸어 v0WY 포즈 수와
// v0W·v0W2 프레임의 가짜 v0WY 포즈 수가 어디서 갈리는지 본다. 이 방식은 실제
// 파이프라인(`decodeFrontend`)을 그대로 타므로 «판별기만 따로 잰» 값이 아니다.
console.log('\n── ③ 슬롯 QR 확증 문턱 스윕 (v0wySlotQrMinContrast) ──');
console.log('| 문턱 | v0WY 프레임 자기 포즈 | v0W 프레임 가짜 v0wy | v0W2 프레임 가짜 v0wy | v0WQ 프레임 가짜 v0wy |');
console.log('|---|---|---|---|---|');
function posesFor(frame, threshold, tone = {}) {
  let self = 0;
  for (const rotation of [0, 120, 240]) {
    const decoded = decodeLab(distortImage(frame, { ...tone, rotation, fill: FILL }), {
      calibration: { csBlockLocator: { v0wySlotQrMinContrast: threshold } },
    });
    const diag = locatorDiag(decoded);
    self += diag && diag.poseCount ? diag.poseCount.v0wy : 0;
  }
  return self;
}
const sweepRows = [];
for (const threshold of [-2, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.05, 1.1, 1.15, 1.2]) {
  const row = ['v0wy', 'v0w', 'v0w2', 'v0wq'].map((id) => posesFor(FRAMES[id], threshold));
  sweepRows.push(row);
  console.log('| ' + threshold + ' | ' + row.join(' | ') + ' |');
}
// 자 검증 — 스윙이 **무언가를 움직여야** 한다. 전부 같으면 calibration 경로가
// 안 먹힌 것이지 «문턴이 무의미» 가 아니다 (이 레인이 밟은 함정).
{
  const flat = sweepRows.map((row) => row.join(','));
  if (new Set(flat).size === 1) {
    console.log('  ★ 스윙이 한 자리도 안 움직였다 — calibration 경로를 의심하라 '
      + '(bootstrap.family.cube.calibration 중첩 경로만 먹는다)');
  }
}
// 열화 축에서도 (진짜가 먼저 죽지 않는가)
console.log('\n  열화 축 — 진짜 v0WY 포즈 수 (톤 × 문턱)');
const DEG_THRESHOLDS = [-2, 0.4, 0.6, 0.9, 1.0, 1.05];
console.log('| 톤 | ' + DEG_THRESHOLDS.map((t) => '문턱 ' + t).join(' | ') + ' |');
console.log('|---' + '|---'.repeat(DEG_THRESHOLDS.length) + '|');
for (const [label, tone] of TONES) {
  console.log('| ' + label + ' | '
    + DEG_THRESHOLDS.map((t) => posesFor(FRAMES.v0wy, t, tone)).join(' | ') + ' |');
}

// ── ④ 교차 오수용 양방향 전수 ─────────────────────────────────────────────
console.log('\n── ④ 교차 오수용 — 프레임 × 회전 3방향, 복호 레이아웃 ──');
let crossClean = true;
for (const [name, extra] of [
  ['v0', {}], ['v0w', {}], ['v0wq', {}], ['v0w2', {}], ['v0wy', {}],
  ['v0x', RESTORE], ['v0xq', RESTORE],
]) {
  const seen = [];
  for (const rotation of [0, 120, 240]) {
    const decoded = decodeLab(distortImage(FRAMES[name], { rotation, fill: FILL }), extra);
    seen.push(decoded.ok
      ? (decoded.hypothesis.cellSurfaceLayout + (decoded.text === PAYLOAD ? '' : '!TEXT'))
      : 'FAIL:' + decoded.reason);
  }
  const clean = seen.every((s) => s === name);
  if (!clean) crossClean = false;
  console.log('  ' + name.padEnd(5) + ' → ' + seen.join(' · ') + (clean ? '  ✓' : '  ✖'));
}
console.log('  전수 판정: ' + (crossClean ? '교차 오수용 0' : '★ 누수 있음'));

// Type O · A 프레임에서 v0wy shape 가 서지 않는가
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
      const ids = detected.shapes.map((s) => s.blockLocator.layoutId || s.blockLocator.family);
      console.log('  Type ' + name + ' rot' + rotation + ' shapes: '
        + (ids.length ? ids.join(',') : '(없음)')
        + (ids.includes('v0wy') ? '  ✖ v0wy shape' : '  ✓'));
    }
  }
}

// ── ⑤ 포즈 회계 — 패밀리 격리·비침습성 ────────────────────────────────────
console.log('\n── ⑤ 포즈 회계 (rot0 clean) ──');
console.log('| 프레임 | 팔 | poseCount | slotQr 거절 |');
console.log('|---|---|---|---|');
for (const id of ['v0w', 'v0wq', 'v0w2', 'v0wy']) {
  for (const [armName, cube] of [
    ['편입 후', {}],
    ['v0wy off', { calibration: { csBlockLocator: { v0wyFamily: false } } }],
    ['슬롯확증 off', { calibration: { csBlockLocator: { v0wyRequireSlotQr: false } } }],
  ]) {
    const decoded = decodeLab(distortImage(FRAMES[id], { rotation: 0, fill: FILL }), cube);
    const diag = locatorDiag(decoded);
    const pc = diag && diag.poseCount ? diag.poseCount : {};
    const compact = Object.entries(pc).filter(([, v]) => v > 0)
      .map(([k, v]) => k + ':' + v).join(' ') || '(0)';
    console.log('| ' + id + ' | ' + armName + ' | ' + compact + ' | '
      + ((diag && diag.slotQr) ? diag.slotQr.rejected : '-') + ' |');
  }
}
