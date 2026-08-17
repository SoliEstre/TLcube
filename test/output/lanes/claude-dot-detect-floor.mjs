/**
 * claude-dot-detect-floor.mjs — 고립점의 **검출 바닥**을 NE 링과 나란히 잰다.
 *
 * 앞선 계측이 남긴 것:
 *   · 고립점은 v0T·v0TY 에 정확히 하나 (A 블록 중앙 (5,4), 3면 복제). v0 은 0개.
 *   · **참값 시드로는 수렴한다** — 점R 은 ppu 12\~6 전부 meanCorr 1.0000.
 *     (claude-dot-seed-feasibility.out.txt)
 * 아직 안 잰 것: **검출기가 실제로 그 점을 찾는가.** 여기가 「사거리가 는다」는
 * 주장을 사실로 바꾸거나 반증하는 자리다.
 *
 * 탐색 방식 — 실제 쓰임과 같게 **조건부**로 한다:
 *   중앙 불스아이가 먼저 서고(전 칸 순위 1\~2위로 신뢰할 만하다), 그 히트의 u 가
 *   곧 1셀이다. 그 스케일로 반경 4.58셀 고리를 훑는다. 스케일을 모른 채 전역을
 *   훑는 것이 아니라, **이미 있는 정보를 쓴다.**
 *
 * 점 판정 (극성 무관·회전 무관):
 *   중심값 c = 반경 0.3u 원반 평균 · 고리값 = 반경 1.0u 의 12방향 표본.
 *   분리폭 = |c − 가장 가까운 고리 표본| / (프레임 휘도 범위). 12표본이 전부
 *   c 반대편이어야 «깨끗한 고립점» 이다 (하나라도 같은 편이면 clean=false).
 *
 * 대조군: 같은 칸의 NE 링 — 엄격 코너(k5) 중 반경 16.70±3.2셀 에 있는 것의 수.
 *
 * 자 검증: 높은 ppu 에서 탐색 상위 3점이 참 점 근처(<1셀)여야 한다. 아니면
 * 검출기가 고장난 것이므로 낮은 ppu 숫자를 읽지 않는다.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, UNVERIFIED_CS_BLOCK_LOCATOR,
} from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { faceBasis } from '../../../src/ygrid.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { embed960 } from './claude-v0w2-leak.mjs';

const {
  scanConcentricCores, clusterCores, verifyV2r2Cluster, verifyV0Cluster,
} = CS_BLOCK_LOCATOR_INTERNALS;

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const FACES = ['T', 'L', 'R'];
const DOT = { i: 5, j: 4 };
const DOT_RADIUS_CELLS = Math.sqrt(21);   // 4.5826
const NE_RADIUS_CELLS = Math.sqrt(279);   // 16.7033
const SNAP = 3.2;

function build(layout, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: layout === 'v0' ? 0 : 1, tones: 2, eccLevel: 'H',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
  const framed = embed960(raster);
  const ox = Math.floor((framed.width - raster.width) / 2);
  const oy = Math.floor((framed.height - raster.height) / 2);
  const cellToPx = (face, i, j) => {
    const { ei, ej } = faceBasis(face);
    return {
      x: ox + (scene.layout.originX + (i * ei.x + j * ej.x) * scene.layout.size) * ppu,
      y: oy + (scene.layout.originY + (i * ei.y + j * ej.y) * scene.layout.size) * ppu,
    };
  };
  return { framed, cellToPx };
}

function bilinear(luma, x, y) {
  const { width, height, data } = luma;
  if (!(x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1)) return NaN;
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1); const y1 = Math.min(y0 + 1, height - 1);
  const tx = x - x0; const ty = y - y0;
  const p00 = data[y0 * width + x0]; const p10 = data[y0 * width + x1];
  const p01 = data[y1 * width + x0]; const p11 = data[y1 * width + x1];
  return p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty)
    + p01 * (1 - tx) * ty + p11 * tx * ty;
}

/** 한 점의 «고립점다움» — 분리폭과 깨끗함. */
function dotScore(luma, x, y, u, span) {
  let sum = 0; let count = 0;
  for (let dy = -0.3 * u; dy <= 0.3 * u; dy += Math.max(0.15 * u, 0.5)) {
    for (let dx = -0.3 * u; dx <= 0.3 * u; dx += Math.max(0.15 * u, 0.5)) {
      const v = bilinear(luma, x + dx, y + dy);
      if (Number.isFinite(v)) { sum += v; count += 1; }
    }
  }
  if (!count) return null;
  const c = sum / count;
  const ring = [];
  for (let k = 0; k < 12; k += 1) {
    const a = (k * Math.PI) / 6;
    const v = bilinear(luma, x + u * Math.cos(a), y + u * Math.sin(a));
    if (!Number.isFinite(v)) return null;
    ring.push(v);
  }
  const mean = ring.reduce((s, v) => s + v, 0) / ring.length;
  const sign = Math.sign(c - mean);
  if (sign === 0) return null;
  // 12표본이 전부 c 반대편인가 (중간값 기준).
  const mid = (c + mean) / 2;
  const clean = ring.every((v) => Math.sign(mid - v) === sign);
  const nearest = sign > 0 ? Math.max(...ring) : Math.min(...ring);
  return { separation: Math.abs(c - nearest) / span, clean, polarity: sign };
}

const cfg = { ...UNVERIFIED_CS_BLOCK_LOCATOR };
console.log('layout ppu | 참 점 분리폭(T/L/R, clean=+) | 탐색 상위3 오차(셀) | NE링 코너 | 판정');

for (const layout of ['v0t', 'v0ty']) {
  for (const ppu of [12, 10, 9, 8, 7, 6, 5]) {
    const { framed, cellToPx } = build(layout, ppu);
    const luma = toRelativeLuminance(framed, {});
    const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
    const cut = otsuThreshold(reduced.luma);
    const clusters = clusterCores(scanConcentricCores(reduced.luma, cut, cfg), cfg);
    const verified = []; const occupied = [];
    let k5 = 0; let k3 = 0;
    for (const cluster of clusters) {
      if (cluster.kind === 'k5') { if (k5 >= cfg.maximumVerifiedPerKind) continue; k5 += 1; }
      else { if (k3 >= cfg.maximumVerifiedPerKind) continue; k3 += 1; }
      if (occupied.some((h) => h.coreKind === cluster.kind
        && Math.hypot(h.x - cluster.x, h.y - cluster.y)
          <= 2.2 * Math.max(h.u, cluster.u))) continue;
      const native = cluster.kind === 'k5'
        ? verifyV2r2Cluster(reduced.luma, cut, cluster, cfg)
        : verifyV0Cluster(reduced.luma, cut, cluster, cfg);
      const hit = native || (cluster.kind === 'k5'
        ? verifyV0Cluster(reduced.luma, cut, cluster, cfg)
        : verifyV2r2Cluster(reduced.luma, cut, cluster, cfg));
      if (hit) { verified.push(hit); occupied.push({ ...hit, coreKind: cluster.kind }); }
    }
    verified.sort((l, r) => r.score - l.score || r.count - l.count || l.y - r.y || l.x - r.x);
    const centres = verified.filter((h) => h.kind === 'v0-center');
    if (!centres.length) {
      console.log(`${layout} ${String(ppu).padStart(2)} | 중앙 히트 0 — 점 탐색 불가`);
      continue;
    }
    const anchor = centres[0];
    const u = anchor.u;
    // 휘도 범위 — 분리폭의 분모.
    let lo = Infinity; let hi = -Infinity;
    for (const v of reduced.luma.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(hi - lo, 1e-6);

    // ── 참 점에서의 분리폭 ────────────────────────────────────────────────
    const truth = FACES.map((f) => {
      const p = cellToPx(f, DOT.i, DOT.j);
      return { x: p.x / reduced.factor, y: p.y / reduced.factor };
    });
    const truthScores = truth.map((p) => dotScore(reduced.luma, p.x, p.y, u, span));
    const truthText = truthScores.map((s) =>
      (s === null ? '-' : s.separation.toFixed(2) + (s.clean ? '+' : '-'))).join('/');

    // ── 조건부 탐색: 반경 4.58±0.8셀 고리를 각도 1° 로 훑는다 ────────────────
    const found = [];
    for (let deg = 0; deg < 360; deg += 1) {
      const a = (deg * Math.PI) / 180;
      for (let rc = DOT_RADIUS_CELLS - 0.8; rc <= DOT_RADIUS_CELLS + 0.8; rc += 0.2) {
        const x = anchor.x + rc * u * Math.cos(a);
        const y = anchor.y + rc * u * Math.sin(a);
        const s = dotScore(reduced.luma, x, y, u, span);
        if (s && s.clean) found.push({ x, y, s: s.separation });
      }
    }
    found.sort((l, r) => r.s - l.s);
    // 비최대 억제 — 1셀 안쪽 중복 제거.
    const peaks = [];
    for (const f of found) {
      if (peaks.some((p) => Math.hypot(p.x - f.x, p.y - f.y) < u)) continue;
      peaks.push(f);
      if (peaks.length >= 3) break;
    }
    const errs = peaks.map((p) => {
      const d = Math.min(...truth.map((t) => Math.hypot(t.x - p.x, t.y - p.y)));
      return (d / u).toFixed(2);
    });
    const hitCount = peaks.filter((p) =>
      truth.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < u)).length;

    // ── 대조군: NE 링에 있는 엄격 코너 수 ─────────────────────────────────
    const strict = verified.filter((h) => h.kind === 'v2r2-corner');
    const neRing = strict.filter((h) => {
      const r = Math.hypot(h.x - anchor.x, h.y - anchor.y) / u;
      return Math.abs(r - NE_RADIUS_CELLS) <= SNAP;
    }).length;

    const verdict = hitCount >= 1
      ? (neRing >= 2 ? '둘 다 산다' : '★점만 산다 (NE 링 부족)')
      : (neRing >= 2 ? '★NE 만 산다' : '둘 다 죽음');
    console.log(`${layout} ${String(ppu).padStart(2)} | ${truthText.padEnd(20)}`
      + ` | ${(errs.join(' ') || '없음').padEnd(18)} (적중 ${hitCount}/3)`
      + ` | ${neRing} | ${verdict}`);
  }
  console.log('');
}
console.log('판독: 점이 NE 링보다 낮은 ppu 까지 살아남으면 «사거리가 는다» 가 사실이다.');
console.log('      같은 지점에서 죽으면 구현할 이유가 없다 (반증).');
