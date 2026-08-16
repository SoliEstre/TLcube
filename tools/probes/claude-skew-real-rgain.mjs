/**
 * claude-skew-real-rgain.mjs — **R면 게인 절제 실험** (인과 후보 좁히기).
 *
 * 관찰 ①(«R면이 가장 어두워 파인더 인식이 떨어진다») 은 상관 진술이다. 여기서는
 * R 게인만 바꾸고(당시 기본 0.52 → 0.62 → 0.72 = L 과 동률 — 이 실험의 결과로 화면용
 * 기본이 0.62 가 됐다) **다른 모든 것을 고정**해
 * 검출 통과율과 CS 면별 agreement 를 비교한다. 게이트는 건드리지 않는다.
 *
 * 열화 조건은 «가장자리» 여야 신호가 보인다 — 무열화면 전부 통과해서 차이가 안 난다.
 * 그래서 낮은 cell_px + S커브 + 노이즈 + JPEG 근사를 겹친다.
 *
 * 사용: node tools/probes/claude-skew-real-rgain.mjs [--out json]
 */

import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeY } from '../../src/encodeY.js';
import { buildSceneY } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../src/luminance.js';
import { distortImage } from '../../test/harness/distort.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PRESET = getPreset(DEFAULT_PRESET);
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';

function palette(rGain) {
  return Object.freeze({
    background: PRESET.background,
    levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: Object.freeze({ T: 1, L: 0.72, R: rGain }),
  });
}

const cache = new Map();
function baseRaster(rGain, tones, ppu) {
  const key = `${rGain}/${tones}/${ppu}`;
  if (!cache.has(key)) {
    const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', version: 0, tones, eccLevel: 'M' });
    const scene = buildSceneY(encoded, { palette: palette(rGain), margin: 20 });
    cache.set(key, rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
  }
  return cache.get(key);
}

function probe(rGain, tones, ppu, theta, axis, sigma, jpeg) {
  const image = distortImage(baseRaster(rGain, tones, ppu), {
    tilt: { degrees: theta, axis, distanceRatio: 4 },
    sCurve: 0.6,
    noise: { sigma, seed: 'rgain' },
    jpegQuality: jpeg,
    fill: FILL,
  });
  let result;
  try {
    result = decodeFrontend(image, {
      bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
    });
  } catch (error) {
    return { ok: false, reason: 'threw:' + error.message };
  }
  const detail = result.detail || {};
  const geo = detail.geometryDiagnostics;
  const probeInfo = geo && geo.cube && geo.cube.diagnostics
    && (geo.cube.diagnostics.cellSurfaceProbe
      || (geo.cube.diagnostics.diagnostics && geo.cube.diagnostics.diagnostics.cellSurfaceProbe));
  return {
    ok: result.ok === true && result.text === PAYLOAD,
    reason: result.ok ? null : result.reason,
    csScore: result.ok
      ? (result.diagnostics.bootstrap.geometry.cube.diagnostics.cellSurfaceProbe || {}).score
      : (probeInfo || {}).score ?? null,
    csReason: result.ok ? null : ((probeInfo || {}).reason ?? null),
  };
}

if (basename(process.argv[1]) === 'claude-skew-real-rgain.mjs') {
  const rows = [];
  for (const ppu of [10, 12]) {
    for (const tones of [3, 2]) {
      for (const sigma of [0.02, 0.04]) {
        // 2026-08-16 (과업 #16): 스윕 값을 env 로 열었다. 원 실험은 0.52/0.62/0.72 3수준
        // 이었는데, 그 사이(0.57\~0.60)가 다른 축에서 더 나아 보여 **같은 격자**로 확인해야
        // 했다. 미지정 시 원래 3수준 그대로라 기존 재현은 안 깨진다.
        for (const rGain of (process.env.RGAINS
          ? process.env.RGAINS.split(',').map(Number)
          : [0.52, 0.62, 0.72])) {
          for (const theta of [0, 20, 29, 40, 45, 51]) {
            for (const axis of ['horizontal', 'vertical']) {
              if (theta === 0 && axis !== 'horizontal') continue;
              const out = probe(rGain, tones, ppu, theta, axis, sigma, 45);
              rows.push({ ppu, tones, sigma, rGain, theta, axis, ...out });
            }
          }
        }
      }
    }
  }
  const agg = new Map();
  for (const r of rows) {
    const key = `ppu${r.ppu} t${r.tones} σ${r.sigma}`;
    if (!agg.has(key)) agg.set(key, {});
    const bucket = agg.get(key);
    const g = 'R' + r.rGain;
    bucket[g] = bucket[g] || { pass: 0, total: 0 };
    bucket[g].total += 1;
    if (r.ok) bucket[g].pass += 1;
  }
  for (const [key, bucket] of agg) {
    console.log(key, Object.entries(bucket).map(([g, v]) => `${g}: ${v.pass}/${v.total}`).join('  '));
  }
  const total = {};
  for (const r of rows) {
    const g = 'R' + r.rGain;
    total[g] = total[g] || { pass: 0, total: 0 };
    total[g].total += 1;
    if (r.ok) total[g].pass += 1;
  }
  console.log('TOTAL', Object.entries(total).map(([g, v]) => `${g}: ${v.pass}/${v.total} (${(100 * v.pass / v.total).toFixed(0)}%)`).join('  '));
  const outIndex = process.argv.indexOf('--out');
  writeFileSync(
    outIndex >= 0 ? process.argv[outIndex + 1] : join(ROOT, 'test', 'output', 'lanes', 'claude-skew-real-rgain.json'),
    JSON.stringify(rows, null, 1),
  );
}
