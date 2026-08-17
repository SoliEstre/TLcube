/**
 * claude-dot-seed-feasibility.mjs — 운영자 제안 「고립점 보조 앵커」의 **타당성** 계측.
 *
 * 배경 (`claude-isolated-dot-census.out.txt`): v0T·v0TY 에는 8이웃이 전부 파인더 셀인
 * 고립점이 **정확히 하나** 있다 — A 블록 정중앙 `(5,4)`, 3면 복제라 실물에선 120° 3점.
 * v0(n=13)에는 **0개**라, 이 삼중점은 «v0T 는 만들 수 있고 v0 은 못 만드는» 양성 증거다.
 *
 * 그런데 이 링의 반경은 √21 ≈ 4.58셀로 NE 링(16.70셀)의 1/3.6 이다. **짧은 베이스라인
 * 시드로 refinePose 가 참 포즈로 수렴하는가** — 여기가 이 안의 성패다. 수렴하면
 * 검출기 추가만으로 끝나고(설계 무변경), 아니면 파인더에 점을 더 심어야 한다.
 *
 * 여기서는 **검출 품질을 빼고** 순수 타당성만 잰다: 점의 위치는 **참값**을 쓴다.
 * (검출 가능성은 별건 — 참값 시드가 수렴 못 하면 검출을 아무리 잘해도 소용없다.)
 *
 * 대조군: 같은 프레임·같은 중앙에서 **NE 코너 앵커**로 시드한 refinePose.
 *
 * 자 검증: 참 점 3개가 프레임 중심에서 등반경·120° 여야 한다. 아니면 매핑이 틀린
 * 것이므로 그 칸의 숫자는 읽지 않는다.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, UNVERIFIED_CS_BLOCK_LOCATOR,
} from '../../../src/decoder/cellsurface-block-detect.js';
import { projectPoint } from '../../../src/decoder/homography.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { faceBasis } from '../../../src/ygrid.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { embed960 } from './claude-v0w2-leak.mjs';

const {
  scanConcentricCores, clusterCores, verifyV2r2Cluster, verifyV0Cluster,
  patchesFor, anchoredSimilaritySeedTo, refinePose, localCellPx,
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
const N = 21;
const FACES = ['T', 'L', 'R'];
const DOT = { i: 5, j: 4 }; // A 블록 정중앙 — census 가 찾은 유일한 고립점.

function build(ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0t', version: 1, tones: 2, eccLevel: 'H',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
  const framed = embed960(raster);
  const ox = Math.floor((framed.width - raster.width) / 2);
  const oy = Math.floor((framed.height - raster.height) / 2);
  // 셀 → 이미지 픽셀. scene 좌표는 **unit** 이므로 ppu 를 곱한다 (1차 계측에서
  // 이 곱셈을 빠뜨려 거리가 200셀로 나왔던 자리 — 아래 자 검증이 다시 잡는다).
  const cellToPx = (face, i, j) => {
    const { ei, ej } = faceBasis(face);
    return {
      x: ox + (scene.layout.originX + (i * ei.x + j * ej.x) * scene.layout.size) * ppu,
      y: oy + (scene.layout.originY + (i * ei.y + j * ej.y) * scene.layout.size) * ppu,
    };
  };
  return { framed, cellToPx, cellPx: scene.layout.size * ppu, centre: { x: 480, y: 480 } };
}

/** 진입점과 같은 순서로 검증 히트를 만든다. */
function verifiedHits(luma, cfg) {
  const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
  const cut = otsuThreshold(reduced.luma);
  const clusters = clusterCores(scanConcentricCores(reduced.luma, cut, cfg), cfg);
  const verified = [];
  const occupied = [];
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
  return { verified, factor: reduced.factor };
}

const patches = patchesFor(N, 'v0t');
// subPatches = [중앙×3, 코너×3, A×3, ARM×3, W×3, SE×3] — A 는 인덱스 6..8.
const aPatches = patches.subPatches.slice(6, 9);
console.log('A 서브패치 점 수: ' + aPatches.map((p) => p.points.length).join(',')
  + '  (9,9,9 이어야 A 블록이다)');
if (!aPatches.every((p) => p.points.length === 9)) {
  console.log('★ A 패치 인덱스 추정이 틀렸다 — 표를 읽지 마라.');
}

const cfg = { ...UNVERIFIED_CS_BLOCK_LOCATOR };
console.log('\nppu | 자 | 시드원  refine  meanCorr  중심오차(셀)  셀크기비  판정');
for (const ppu of [12, 10, 9, 8, 7, 6]) {
  const { framed, cellToPx, cellPx, centre } = build(ppu);
  const luma = toRelativeLuminance(framed, {});
  const { verified, factor } = verifiedHits(luma, cfg);
  const centres = verified.filter((h) => h.kind === 'v0-center').slice(0, 3);
  if (!centres.length) { console.log(`${ppu} | 중앙 히트 0 — 건너뜀`); continue; }
  const anchor = centres[0];

  // ── 자 검증: 참 점 3개가 등반경·120° 인가 ────────────────────────────────
  const truth = FACES.map((f) => cellToPx(f, DOT.i, DOT.j));
  const polar = truth.map((p) => ({
    r: Math.hypot(p.x - centre.x, p.y - centre.y) / cellPx,
    a: (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI,
  }));
  const rSpread = Math.max(...polar.map((p) => p.r)) - Math.min(...polar.map((p) => p.r));
  const rulerOk = rSpread / Math.max(...polar.map((p) => p.r)) < 0.05;
  const rulerTag = rulerOk
    ? `ok r≈${polar[0].r.toFixed(2)}`
    : `★무효 r=${polar.map((p) => p.r.toFixed(1)).join('/')}`;

  const rows = [];
  // ① 고립점 시드 (참 위치) — 면마다 하나씩
  for (let k = 0; k < FACES.length; k += 1) {
    const dot = { x: truth[k].x / factor, y: truth[k].y / factor, u: anchor.u };
    const H0 = anchoredSimilaritySeedTo(anchor, dot, factor, aPatches[k].anchor);
    const refined = H0 === null ? null : refinePose(luma, H0, patches, cfg);
    rows.push([`점${FACES[k]}`, refined]);
  }
  // ② 대조군 — NE 코너 앵커 시드 (참 위치로 같은 조건)
  const neTruth = cellToPx('T', 3, 18); // NE 바깥 동심 사각 무게중심 (레인 실측 (3,18))
  const neDot = { x: neTruth.x / factor, y: neTruth.y / factor, u: anchor.u };
  const H0ne = anchoredSimilaritySeedTo(anchor, neDot, factor, patches.corners[0].anchor);
  rows.push(['NE대조', H0ne === null ? null : refinePose(luma, H0ne, patches, cfg)]);

  for (const [label, refined] of rows) {
    if (!refined) {
      console.log(`${String(ppu).padEnd(3)} | ${rulerTag.padEnd(10)} | ${label.padEnd(7)}`
        + ' 실패    -         -             -         정련 거부');
      continue;
    }
    const org = projectPoint(refined.H, { x: 0, y: 0 });
    const err = org ? Math.hypot(org.x - centre.x, org.y - centre.y) / cellPx : NaN;
    const cpx = localCellPx(refined.H);
    const ratio = cpx / cellPx;
    const good = err < 1 && Math.abs(ratio - 1) < 0.1;
    console.log(`${String(ppu).padEnd(3)} | ${rulerTag.padEnd(10)} | ${label.padEnd(7)}`
      + ` 성공    ${refined.meanCorrelation.toFixed(4)}    ${err.toFixed(3).padEnd(13)}`
      + ` ${ratio.toFixed(3).padEnd(9)} ${good ? '수렴' : '★엉뚱한 포즈'}`);
  }
  console.log('');
}
console.log('판독: 「점T/L/R」 행이 NE대조와 같은 meanCorr·중심오차<1셀·셀크기비≈1 이면'
  + ' 짧은 베이스라인 시드로도 수렴한다 = 검출기 추가만으로 가능.');
