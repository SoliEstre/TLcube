/**
 * claude-v0t-corner-side.mjs — 깔때기의 **코너 쪽**을 찍는다.
 *
 * 앞선 두 계측이 남긴 것:
 *   · 중앙은 무죄 — 진짜 중앙의 점수 순위는 전 칸 1\~2위, 상위 3 슬라이스에 늘 든다.
 *   · 그런데 `anchored` 가 0 인 칸이 있고 (ppu=15·11), 그 칸에서 v0T 포즈가 0 이다.
 *   · **불스아이 확증 구제 경로의 tripleCount 가 전 칸 0** 이다 — 엄격 코너가 모자란
 *     바로 그 경우를 구제하라고 만든 경로인데 한 번도 발동하지 않았다.
 *
 * 그래서 여기서는 «참값을 모른 채로» 코너의 기하만 잰다 (ground truth 재구성이
 * 필요 없다 — 진짜 NE 블록이면 중앙에서 √279 ≈ 16.70셀 에 3개가 120° 로 서 있어야 한다):
 *
 *   strict[]  엄격 코너 (v2r2-corner) 의 (반경 셀, 각도°) — 상위 4개 슬라이스 표시
 *   loose[]   느슨한 코너 (v0xq 코너) 의 (반경 셀, 각도°) — 상위 4개 슬라이스 표시
 *   triples   상위 4 느슨 코너의 C(4,3)=4 조합이 각 게이트에서 어떻게 죽는지 사인
 *             (rad = 반경 허용폭, ang = 120° 간격, eye = 중심 불스아이 없음, ok)
 *
 * 반경은 중앙 히트의 u (= 1셀) 로 나눠 셀 단위로 읽는다. 기대값 16.70 에서 크게
 * 벗어난 코너는 «진짜 NE 블록이 아니다» 는 뜻이다.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, UNVERIFIED_CS_BLOCK_LOCATOR,
} from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { TL_READER_URL } from '../../../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { embed960 } from './claude-v0w2-leak.mjs';

const {
  scanConcentricCores, clusterCores, verifyV2r2Cluster, verifyV0Cluster,
  verifyV0xqCornerCluster,
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
const NEEDS_QR = new Set(['v0ty']);
const EXPECTED_RADIUS = Math.sqrt(279); // 16.7033셀 — v0W 계열·v0T 공유 코어 반경.
const RUNGS = [15, 13, 11, 9, 8, 7];
const LAYOUTS = [{ id: 'v0t', version: 1 }, { id: 'v0ty', version: 1 }];

function frameOf(layout, version, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  return embed960(rasterize(buildSceneY(encoded, opts), {
    pixelsPerUnit: ppu, supersample: 2,
  }));
}

function probe(layout, version, ppu) {
  const framed = frameOf(layout, version, ppu);
  const luma = toRelativeLuminance(framed, {});
  const cfg = { ...UNVERIFIED_CS_BLOCK_LOCATOR };
  const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
  const cut = otsuThreshold(reduced.luma);
  const clusters = clusterCores(scanConcentricCores(reduced.luma, cut, cfg), cfg);

  // ── 엄격 경로 재현 (진입점과 같은 순서) ──────────────────────────────────
  const verified = [];
  const occupied = [];
  let k5seen = 0; let k3seen = 0;
  for (const cluster of clusters) {
    if (cluster.kind === 'k5') {
      if (k5seen >= cfg.maximumVerifiedPerKind) continue;
      k5seen += 1;
    } else {
      if (k3seen >= cfg.maximumVerifiedPerKind) continue;
      k3seen += 1;
    }
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
  const centres = verified.filter((h) => h.kind === 'v0-center').slice(0, 3);
  const strict = verified.filter((h) => h.kind === 'v2r2-corner');

  // ── 느슨한 코너 재현 ─────────────────────────────────────────────────────
  const loose = [];
  const looseOccupied = [];
  let inspected = 0;
  for (const cluster of clusters) {
    if (cluster.kind !== 'k5') continue;
    if (inspected >= cfg.v0xqMaxInspectedClusters) break;
    inspected += 1;
    if (looseOccupied.some((h) => Math.hypot(h.x - cluster.x, h.y - cluster.y)
      <= 2.2 * Math.max(h.u, cluster.u))) continue;
    const hit = verifyV0xqCornerCluster(reduced.luma, cut, cluster, cfg);
    if (!hit) continue;
    loose.push(hit);
    looseOccupied.push(hit);
  }
  loose.sort((l, r) => r.score - l.score || r.count - l.count || l.y - r.y || l.x - r.x);

  // ── 기하 읽기 — 기준은 «가장 점수 높은 중앙» (앵커드 경로가 쓰는 것과 같다) ──
  const anchor = centres[0];
  const cell = anchor ? anchor.u : NaN;
  const polar = (h) => ({
    r: Math.hypot(h.x - anchor.x, h.y - anchor.y) / cell,
    a: (Math.atan2(h.y - anchor.y, h.x - anchor.x) * 180) / Math.PI,
  });
  const fmt = (list, cap) => list.slice(0, 6).map((h, index) => {
    const p = polar(h);
    return (index < cap ? '' : '·') + `r${p.r.toFixed(1)}@${p.a.toFixed(0)}`;
  }).join(' ');

  // ── 삼중점 게이트 사인 (구제 경로가 보는 상위 4 느슨 코너) ────────────────
  const top4 = loose.slice(0, 4);
  const angleTolerance = (cfg.v0xqTripleAngleToleranceDeg * Math.PI) / 180;
  const verdicts = [];
  for (let a = 0; a < top4.length; a += 1) {
    for (let b = a + 1; b < top4.length; b += 1) {
      for (let c = b + 1; c < top4.length; c += 1) {
        const triple = [top4[a], top4[b], top4[c]];
        const cx = (triple[0].x + triple[1].x + triple[2].x) / 3;
        const cy = (triple[0].y + triple[1].y + triple[2].y) / 3;
        const radii = triple.map((h) => Math.hypot(h.x - cx, h.y - cy));
        const rMin = Math.min(...radii); const rMax = Math.max(...radii);
        if (!(rMin > 1e-9)) { verdicts.push('deg'); continue; }
        if (rMax - rMin > cfg.v0xqTripleRadiusTolerance * rMax) {
          verdicts.push(`rad(${((rMax - rMin) / rMax).toFixed(2)}>${cfg.v0xqTripleRadiusTolerance})`);
          continue;
        }
        const angles = triple.map((h) => Math.atan2(h.y - cy, h.x - cx))
          .sort((l, r) => l - r);
        let worst = 0;
        for (let k = 0; k < 3; k += 1) {
          let delta = angles[(k + 1) % 3] - angles[k];
          if (delta < 0) delta += 2 * Math.PI;
          worst = Math.max(worst, Math.abs(delta - (2 * Math.PI) / 3));
        }
        if (worst > angleTolerance) {
          verdicts.push(`ang(${((worst * 180) / Math.PI).toFixed(0)}°>${cfg.v0xqTripleAngleToleranceDeg}°)`);
          continue;
        }
        const snap = cfg.centreQrBullseyeVetoRadiusRatio * ((rMin + rMax) / 2);
        const found = centres.findIndex((h) => Math.hypot(h.x - cx, h.y - cy) <= snap);
        verdicts.push(found < 0 ? 'eye' : 'ok');
      }
    }
  }

  // ── 확증 실험: 슬라이스를 **치우면** 통과하는 삼중점이 있는가 ────────────────
  // 상위 4 가 아니라 **느슨 코너 전체**에서 같은 게이트를 돌린다. 여기서 ok 가 나오면
  // 「정보는 있었는데 점수순 자르기가 버렸다」 가 확증된다. 하나도 없으면 반증이다.
  let bestAll = null;
  for (let a = 0; a < loose.length; a += 1) {
    for (let b = a + 1; b < loose.length; b += 1) {
      for (let c = b + 1; c < loose.length; c += 1) {
        const triple = [loose[a], loose[b], loose[c]];
        const cx = (triple[0].x + triple[1].x + triple[2].x) / 3;
        const cy = (triple[0].y + triple[1].y + triple[2].y) / 3;
        const radii = triple.map((h) => Math.hypot(h.x - cx, h.y - cy));
        const rMin = Math.min(...radii); const rMax = Math.max(...radii);
        if (!(rMin > 1e-9)) continue;
        if (rMax - rMin > cfg.v0xqTripleRadiusTolerance * rMax) continue;
        const angles = triple.map((h) => Math.atan2(h.y - cy, h.x - cx)).sort((l, r) => l - r);
        let worst = 0;
        for (let k = 0; k < 3; k += 1) {
          let delta = angles[(k + 1) % 3] - angles[k];
          if (delta < 0) delta += 2 * Math.PI;
          worst = Math.max(worst, Math.abs(delta - (2 * Math.PI) / 3));
        }
        if (worst > angleTolerance) continue;
        const snap = cfg.centreQrBullseyeVetoRadiusRatio * ((rMin + rMax) / 2);
        if (!centres.some((h) => Math.hypot(h.x - cx, h.y - cy) <= snap)) continue;
        const ranks = [a, b, c].map((k) => k + 1);
        const meanR = ((rMin + rMax) / 2) / cell;
        if (bestAll === null || Math.max(...ranks) < Math.max(...bestAll.ranks)) {
          bestAll = { ranks, meanR };
        }
      }
    }
  }

  return {
    layout, ppu,
    strictCount: strict.length,
    looseCount: loose.length,
    strict: anchor ? fmt(strict, 4) : '-',
    loose: anchor ? fmt(loose, 4) : '-',
    verdicts: verdicts.length ? verdicts.join(' ') : '(조합 없음)',
    rescue: bestAll
      ? `통과 삼중점 있음 — 순위 ${bestAll.ranks.join('/')} · r≈${bestAll.meanR.toFixed(1)}셀`
        + (Math.max(...bestAll.ranks) > 4 ? '  ★상위4 밖' : '')
      : '전체에서도 통과 삼중점 없음 (반증)',
  };
}

console.log(`기대 코어 반경 = ${EXPECTED_RADIUS.toFixed(2)}셀 · 스냅 허용 ±3.2셀`
  + ` → 수용 구간 [${(EXPECTED_RADIUS - 3.2).toFixed(1)}, ${(EXPECTED_RADIUS + 3.2).toFixed(1)}]`);
console.log('\nlayout ppu | strict(상위4 무표시, 그 뒤 ·) | loose(상위4) | 삼중점 게이트');
for (const { id, version } of LAYOUTS) {
  for (const ppu of RUNGS) {
    try {
      const r = probe(id, version, ppu);
      console.log(`${r.layout} ${String(r.ppu).padStart(2)} | s=${r.strictCount} ${r.strict}`
        + ` | l=${r.looseCount} ${r.loose} | ${r.verdicts}`);
      console.log(`         └─ 슬라이스 치우면: ${r.rescue}`);
    } catch (error) {
      console.log(`${id} ${ppu} | ★ERROR ${error instanceof Error ? error.message : error}`);
    }
  }
}
