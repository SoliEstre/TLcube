/**
 * claude-v0t-centre-rank.mjs — 「진짜 중앙이 상위 3 슬라이스에 드는가」 를 직접 잰다.
 *
 * §funnel 관측: v0T 프레임에서 검증된 v0-center 코어가 14\~21개 뜨는데
 * `detectCellSurfaceBlockShapes` 는 그중 **점수 상위 3개만** 앵커드 조립에 넘긴다
 * (`verified.filter(kind === 'v0-center').slice(0, 3)`). 사다리에서 `anchored` 가
 * 0 ↔ 2 로 비단조하게 튀는 것이 «진짜 중앙이 상위 3 밖으로 밀린 칸» 의 증상으로 보인다.
 *
 * 여기서 재는 것 (추정 금지 — 순위를 숫자로):
 *   trueRank   진짜 큐브 중앙에 가장 가까운 v0-center 히트의 **점수 순위** (1-based)
 *   trueDist   그 히트와 진짜 중앙의 거리 (셀 단위)
 *   inTop3     그 순위가 3 이하인가
 *   k3         v0-center 히트 총수 (= 경쟁자 수)
 *   topScores  상위 5개 점수 (진짜 중앙 것에 ★)
 *
 * 반증 조건: `inTop3` 가 항상 참인데도 v0T 포즈가 0 이면 이 가설은 틀린 것이고,
 * 원인은 상위 3 슬라이스가 아니라 코너 쪽이다. 그 경우도 그대로 보고한다.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { CS_BLOCK_LOCATOR_INTERNALS } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { TL_READER_URL } from '../../../src/qr.js';
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
const NEEDS_QR = new Set(['v0wq', 'v0wy', 'v0ty']);
const RUNGS = [15, 13, 11, 9, 8, 7, 6, 5];
const LAYOUTS = [
  { id: 'v0t', version: 1 },
  { id: 'v0ty', version: 1 },
  { id: 'v0', version: 0 },
];

// `detectCellSurfaceBlockShapes` 의 앞부분을 **그대로** 되풀이한다 (내부 노출 사용).
// 값이 다르면 이 재현이 틀린 것이므로, k3 총수를 §funnel 과 대조해 검산한다.
const DEFAULTS = (() => {
  // calibration() 은 비공개라 기본표를 그대로 쓴다.
  const mod = CS_BLOCK_LOCATOR_INTERNALS;
  return mod;
})();

function build(layout, version, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  const scene = buildSceneY(encoded, opts);
  const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
  const framed = embed960(raster);
  // ⚠ 자 교정 (1차 시도 폐기): scene.layout 좌표는 **unit** 이고 검출 히트는 **픽셀**이다.
  // 둘을 그냥 빼서 200셀 짜리 거리가 나왔다. 여기서는 곱셈을 되살리는 대신 **더 튼튼한
  // 기준**을 쓴다 — 육각형은 scene 안에 균일 margin 으로 가운데 놓이고 embed960 은
  // 그 raster 를 프레임 가운데 심으므로, **큐브 중심 = 프레임 중심**이다 (±0.5 px).
  // 이 가정은 아래 §자 검증이 매 칸 확인한다 (틀리면 표를 읽지 않는다).
  return {
    framed,
    trueCentre: { x: framed.width / 2, y: framed.height / 2 },
  };
}

console.log('layout\tppu\tk3\trank\tinTop3\td(cell)\t자\t상위5 점수');
const rows = [];
for (const { id, version } of LAYOUTS) {
  for (const ppu of RUNGS) {
    let out;
    try {
      const { framed, trueCentre } = build(id, version, ppu);
      const luma = toRelativeLuminance(framed, {});
      // UNVERIFIED_CS_BLOCK_LOCATOR 의 기본값으로 돌린다 — 로케이터 진입점과 같은 경로.
      const cfg = { ...(await import('../../../src/decoder/cellsurface-block-detect.js'))
        .UNVERIFIED_CS_BLOCK_LOCATOR };
      const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
      const cut = otsuThreshold(reduced.luma);
      const clusters = clusterCores(scanConcentricCores(reduced.luma, cut, cfg), cfg);
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
      const centres = verified.filter((h) => h.kind === 'v0-center');
      // 진짜 중앙과의 거리 — 히트는 축소 좌표라 factor 를 곱해 원본 픽셀로 되돌린다.
      // 셀 환산은 검출기 **자신의** 자를 쓴다: v0-center 의 u 는 1셀이다 (t1 = 2셀).
      let best = -1; let bestDist = Infinity; let bestU = NaN;
      centres.forEach((h, index) => {
        const d = Math.hypot(h.x * reduced.factor - trueCentre.x,
          h.y * reduced.factor - trueCentre.y);
        if (d < bestDist) { bestDist = d; best = index; bestU = h.u * reduced.factor; }
      });
      // ── 자 검증 ──────────────────────────────────────────────────────────
      // «프레임 중심 = 큐브 중심» 이 참이면, 가장 가까운 중앙 히트는 **2셀 안**에
      // 있어야 한다. 아니면 이 칸의 순위는 무의미하다 — 읽지 말고 표시한다.
      const rulerOk = best >= 0 && Number.isFinite(bestU) && bestDist <= 2 * bestU;
      out = {
        layout: id,
        ppu,
        k3: centres.length,
        trueRank: best < 0 ? null : best + 1,
        inTop3: best >= 0 && best < 3,
        trueDistCell: bestDist === Infinity ? null : bestDist / bestU,
        rulerOk,
        topScores: centres.slice(0, 5).map((h, index) =>
          (index === best ? '★' : '') + h.score.toFixed(3)),
      };
    } catch (error) {
      out = { layout: id, ppu, error: error instanceof Error ? error.message : String(error) };
    }
    rows.push(out);
    if (out.error) console.log(`${id}\t${ppu}\t★ERROR ${out.error}`);
    else {
      console.log(`${id}\t${out.ppu}\t${out.k3}\t${out.trueRank}\t${out.inTop3 ? 'Y' : '**N**'}`
        + `\t${out.trueDistCell === null ? '-' : out.trueDistCell.toFixed(2)}`
        + `\t${out.rulerOk ? 'ok' : '★무효'}`
        + `\t${out.topScores.join(' ')}`);
    }
  }
}

console.log('\n=== 요약 ===');
const invalid = rows.filter((r) => !r.error && !r.rulerOk);
if (invalid.length === rows.filter((r) => !r.error).length) {
  console.log('★★ 전 칸 자 무효 — 표를 읽지 마라. 기준점 가정이 틀렸다.');
} else if (invalid.length) {
  console.log(`⚠ 자 무효 ${invalid.length}칸 — `
    + invalid.map((r) => `${r.layout}/ppu${r.ppu}`).join(' ') + ' (이 칸은 제외하고 읽는다)');
}
for (const { id } of LAYOUTS) {
  const mine = rows.filter((r) => r.layout === id && !r.error && r.rulerOk);
  if (!mine.length) { console.log(`${id}: 유효 칸 없음`); continue; }
  const out3 = mine.filter((r) => !r.inTop3);
  console.log(`${id}: 유효 ${mine.length}칸 · 진짜 중앙이 상위3 밖 ${out3.length}칸`
    + (out3.length ? ` (ppu=${out3.map((r) => r.ppu).join(',')})` : '')
    + ` · k3 경쟁자 중앙값 ${median(mine.map((r) => r.k3))}`
    + ` · 순위 ${mine.map((r) => r.trueRank).join(',')}`);
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}
