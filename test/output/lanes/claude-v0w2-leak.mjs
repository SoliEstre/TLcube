// ⚠ (retire 정정 2026-08-17) findGeometryReports 는 전 행에서 빈 배열을 돌려주는
// **죽은 계기**다 — 요약의 «CS 수용 누수 0» 은 아무것도 재지 않는다 (검증 렌즈 F4).
// 기전 결론은 최종 레이아웃 열이 지지한다. 계기 수리 전까지 그 줄을 믿지 말 것.
/**
 * claude-v0w2-leak.mjs — **교차 누수 재현 하네스** (과업 3 ①, 처방 전 기전 규명).
 *
 * 재는 것: v0X·v0W·v0W2 프레임에서 **v0wq(중앙 QR 계열) 포즈가 실제로 서는가**,
 * 서면 어느 단계(시드 → 포즈 → CS 평가 → RS)까지 올라오는가.
 *
 * 열화 사다리는 «실사진 근사» 다 — 블러(초점·손떨림) → 노이즈(센서) → JPEG(압축)
 * → 기울기(카메라 포즈). 이 파일이 blur 를 스스로 구현한다: `test/harness/distort.mjs`
 * 는 공유 하네스라 **한 줄도 안 건드린다**(배제 목록).
 *
 * ⚠ P0 — calibration 은 `bootstrap.family.cube.calibration` 중첩 경로로만 넘긴다.
 *
 * 실행: node test/output/lanes/claude-v0w2-leak.mjs [--json]
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
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

export function render(layout, pixelsPerUnit = 15, tones = 2) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  return rasterize(buildSceneY(encoded, opts), { pixelsPerUnit, supersample: 2 });
}

export function embed960(raster, W = 960, H = 960) {
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

/** 분리 가능 가우시안 블러 — 실사진의 초점·손떨림 근사. 공유 하네스 무접촉. */
export function blurImage(image, sigma) {
  if (!(sigma > 0)) return image;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const value = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = value;
    sum += value;
  }
  for (let k = 0; k < kernel.length; k += 1) kernel[k] /= sum;
  const { width, height, pixels } = image;
  const mid = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        const s = (y * width + sx) * 4;
        const w = kernel[k + radius];
        r += pixels[s] * w; g += pixels[s + 1] * w;
        b += pixels[s + 2] * w; a += pixels[s + 3] * w;
      }
      const d = (y * width + x) * 4;
      mid[d] = r; mid[d + 1] = g; mid[d + 2] = b; mid[d + 3] = a;
    }
  }
  const out = { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        const s = (sy * width + x) * 4;
        const w = kernel[k + radius];
        r += mid[s] * w; g += mid[s + 1] * w;
        b += mid[s + 2] * w; a += mid[s + 3] * w;
      }
      const d = (y * width + x) * 4;
      out.pixels[d] = r; out.pixels[d + 1] = g;
      out.pixels[d + 2] = b; out.pixels[d + 3] = a;
    }
  }
  return out;
}

/** 실사진 근사 파이프라인 — 기하 → 블러 → 톤 → 노이즈 → JPEG (촬영 물리 순서). */
export function photoLike(base, spec) {
  let frame = distortImage(base, {
    rotation: spec.rotation || 0,
    tilt: spec.tilt ? { degrees: spec.tilt, axis: spec.tiltAxis || 'horizontal' } : undefined,
    fill: FILL,
  });
  if (spec.blur) frame = blurImage(frame, spec.blur);
  frame = distortImage(frame, {
    gamma: spec.gamma,
    sCurve: spec.sCurve,
    noise: spec.noise === undefined ? undefined : { sigma: spec.noise, seed: spec.seed || 7 },
    jpegQuality: spec.jpeg,
    fill: FILL,
  });
  return frame;
}

/** ⚠ P0 — calibration 중첩 경로. */
export function decodeLab(frame, cube = {}) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube } } },
  });
}

/** 성공·실패 양쪽에서 진단 트리를 같은 자리에서 꺼낸다. */
export function diagnosticsOf(result) {
  if (result.ok) {
    const boot = result.diagnostics && result.diagnostics.bootstrap;
    return boot && boot.cube ? boot.cube : boot;
  }
  const detail = result.detail || {};
  return detail.diagnostics || (detail.cause && detail.cause.diagnostics) || null;
}

export function findCsBlockLocator(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (node.csBlockLocator) return node.csBlockLocator;
  for (const key of Object.keys(node)) {
    const found = findCsBlockLocator(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

export function findGeometryReports(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node.geometryReports)) return node.geometryReports;
  for (const key of Object.keys(node)) {
    const found = findGeometryReports(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

export const LADDER = Object.freeze([
  ['L0 clean', {}],
  ['L1 blur1.0', { blur: 1.0 }],
  ['L2 blur1.6', { blur: 1.6 }],
  ['L3 blur1.6+noise6', { blur: 1.6, noise: 6 }],
  ['L4 blur1.6+noise6+jpeg55', { blur: 1.6, noise: 6, jpeg: 55 }],
  ['L5 L4+tilt18', { blur: 1.6, noise: 6, jpeg: 55, tilt: 18 }],
  ['L6 L4+tilt28', { blur: 1.6, noise: 6, jpeg: 55, tilt: 28 }],
  ['L7 L4+gamma0.7', { blur: 1.6, noise: 6, jpeg: 55, gamma: 0.7 }],
  ['L8 L4+gamma0.7+tilt18', { blur: 1.6, noise: 6, jpeg: 55, gamma: 0.7, tilt: 18 }],
  ['L9 blur2.4+noise9+jpeg45', { blur: 2.4, noise: 9, jpeg: 45 }],
]);

export const ROTATIONS = Object.freeze([0, 17, 120, 240]);

function main() {
  const targets = ['v0x', 'v0w', 'v0w2', 'v0wq'];
  const rows = [];
  for (const target of targets) {
    for (const tones of [2, 3]) {
      const base = embed960(render(target, 15, tones));
      for (const [ladderName, spec] of LADDER) {
        for (const rotation of ROTATIONS) {
          const frame = photoLike(base, { ...spec, rotation });
          const luma = toRelativeLuminance(frame);
          const loc = detectCellSurfaceBlockShapes(luma, {});
          const result = decodeLab(frame);
          const diag = diagnosticsOf(result);
          const geo = findGeometryReports(diag) || [];
          // CS 평가에서 «어느 레이아웃이 수용됐나» — seed report 안 layouts 표.
          const acceptedLayouts = new Set();
          const scoredLayouts = new Set();
          for (const entry of geo) {
            const layouts = entry && entry.layouts;
            if (!layouts) continue;
            for (const [id, info] of Object.entries(layouts)) {
              scoredLayouts.add(id);
              if (info && info.accepted) acceptedLayouts.add(id);
            }
          }
          rows.push({
            target,
            tones,
            ladder: ladderName,
            rotation,
            poses: loc.diagnostics.poseCount,
            centerQr: loc.diagnostics.centerQr,
            ok: result.ok,
            layout: result.ok ? result.hypothesis.cellSurfaceLayout : null,
            orientation: result.ok ? result.hypothesis.orientation : null,
            text: result.ok ? (result.text === PAYLOAD ? 'payload' : 'WRONG') : null,
            reason: result.ok ? null : result.reason,
            pipelineCode: result.ok ? null : (result.detail && result.detail.pipelineCode),
            accepted: [...acceptedLayouts].sort(),
            scored: [...scoredLayouts].sort(),
          });
        }
      }
    }
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 1));
    return;
  }
  // 요약 — 프레임별 «v0wq 포즈가 섰나 / 수용됐나 / 최종은 무엇인가»
  console.log('target tones ladder                    rot  poses(v0x/v0w/v0w2/v0wq)  triples/rej  csAccepted        result');
  for (const row of rows) {
    const p = row.poses;
    console.log(
      [
        row.target.padEnd(5),
        String(row.tones).padEnd(3),
        row.ladder.padEnd(26),
        String(row.rotation).padStart(3),
        `${p.v0x}/${p.v0w}/${p.v0w2}/${p.v0wq}`.padEnd(12),
        `${row.centerQr.v0wqTripleCount}/${row.centerQr.v0wqCentreRejected}`.padEnd(10),
        row.accepted.join(',').padEnd(18),
        row.ok ? `OK:${row.layout}:o${row.orientation}:${row.text}` : `FAIL:${row.reason}/${row.pipelineCode}`,
      ].join(' '),
    );
  }
  const leaks = rows.filter((row) => row.target !== 'v0wq' && row.accepted.includes('v0wq'));
  const wrongWin = rows.filter((row) => row.ok && row.layout !== row.target);
  const fails = rows.filter((row) => !row.ok);
  console.log('\n--- 요약 ---');
  console.log('총 프레임', rows.length, '· 실패', fails.length, '· 승자 불일치', wrongWin.length);
  console.log('v0wq CS 수용 누수 (타깃≠v0wq)', leaks.length);
  console.log('v0wq 포즈가 선 비-v0wq 프레임',
    rows.filter((row) => row.target !== 'v0wq' && row.poses.v0wq > 0).length);
}

if (process.argv[1] && process.argv[1].endsWith('claude-v0w2-leak.mjs')) main();
