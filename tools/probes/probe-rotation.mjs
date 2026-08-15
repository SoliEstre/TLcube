/**
 * probe-rotation.mjs — σ(면 순환) 실측 프로브 (KAT 작성 전 1회용, 트리 밖 산출 없음)
 *
 * 렌더 → 정확히 120° CW 회전(distort.mjs) → (a) decodeFrontend 전 구간 복호,
 * (b) scene 기하로 원본/회전본 면 median 을 재서 σ 를 판독한다.
 */
import { encode } from '../../src/encode.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../src/luminance.js';
import { buildScene } from '../../src/scene.js';
import { rasterize } from '../../src/raster.js';
import { measureCellFaceMedians } from '../../src/verify.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { rotateImage } from '../harness/distort.mjs';
import { rotate120 } from '../../src/placement.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

const TEXT = 'rotation-kat';
const encoded = encode(TEXT, { version: 1, eccLevel: 'M' });
const scene = buildScene(encoded, { palette: PALETTE });
const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });

// 1. 자 검증: 무회전 복호
const base = decodeFrontend(raster);
console.log('[base] ok=%s text=%j orientation=%s rotationDegrees=%s', base.ok, base.text,
  base.ok ? base.hypothesis.orientation : null, base.ok ? base.hypothesis.rotationDegrees : null);
if (!base.ok) {
  console.log('[base] FAIL detail:', JSON.stringify(base.detail, null, 2).slice(0, 2000));
  process.exit(1);
}

// 2. 정확히 120° CW 회전 (불투명 배경 fill)
const rotated = rotateImage(raster, 120, { fill: FILL });

// 3a. 회전본 전 구간 복호
const rot = decodeFrontend(rotated);
console.log('[rot120] ok=%s text=%j orientation=%s rotationDegrees=%s', rot.ok, rot.text,
  rot.ok ? rot.hypothesis.orientation : null, rot.ok ? rot.hypothesis.rotationDegrees : null);
if (!rot.ok) {
  console.log('[rot120] FAIL detail:', JSON.stringify(rot.detail, null, 2).slice(0, 2000));
}

// 3b. σ 실측: digit 0..5 각 1셀 (전 순위 순열 커버, 표본 6셀)
const FACES = ['T', 'L', 'R'];
function ranksOf(medians) {
  const order = [0, 1, 2];
  const values = FACES.map((f) => medians[f]);
  order.sort((a, b) => values[a] - values[b] || a - b);
  const ranks = {};
  order.forEach((faceIdx, rankPos) => { ranks[FACES[faceIdx]] = rankPos; });
  return ranks;
}

const samplesByDigit = new Map();
for (const [cellKey, { digit, role }] of encoded.cellDigits) {
  if (role !== 'data') continue;
  if (!samplesByDigit.has(digit)) {
    const [q, r] = cellKey.split(',').map(Number);
    samplesByDigit.set(digit, { q, r, digit });
  }
  if (samplesByDigit.size === 6) break;
}

console.log('\n| 원본 (q,r) | digit | 원본 ranks T/L/R | 회전본 (q\',r\') | 회전본 ranks T/L/R | 면 대응 f→f\' | median 최소 격차 |');
const sigmaPerCell = [];
for (const { q, r, digit } of [...samplesByDigit.values()].sort((a, b) => a.digit - b.digit)) {
  const orig = measureCellFaceMedians(raster, scene, q, r);
  const dst = rotate120(q, r);
  const meas = measureCellFaceMedians(rotated, scene, dst.q, dst.r);
  const origRanks = ranksOf(orig);
  const rotRanks = ranksOf(meas);
  // σ: 원본 면 f 의 내용(순위) 이 회전본 면 f' 로 갔다 ⇔ rotRanks[f'] == origRanks[f]
  const sigma = {};
  for (const f of FACES) {
    sigma[f] = FACES.find((f2) => rotRanks[f2] === origRanks[f]);
  }
  // median 근접 검증(순위가 아니라 원시값으로도 성립하는가) — 최소 격차 기록
  let minGap = Infinity;
  for (const f of FACES) {
    const diffs = FACES.map((f2) => Math.abs(orig[f] - meas[f2])).sort((a, b) => a - b);
    minGap = Math.min(minGap, diffs[1] - diffs[0]);
  }
  sigmaPerCell.push({ q, r, digit, sigma });
  console.log(`| (${q},${r}) | ${digit} | ${origRanks.T}/${origRanks.L}/${origRanks.R} | (${dst.q},${dst.r}) | ${rotRanks.T}/${rotRanks.L}/${rotRanks.R} | T→${sigma.T} L→${sigma.L} R→${sigma.R} | ${minGap.toFixed(1)} |`);
}

const uniq = new Set(sigmaPerCell.map(({ sigma }) => `T${sigma.T}L${sigma.L}R${sigma.R}`));
console.log('\nσ 합의:', [...uniq]);
console.log('판정:', uniq.size === 1
  ? ([...uniq][0] === 'TRLTRL' ? '정 (T→R, R→L, L→T)' : [...uniq][0])
  : '표본 간 불일치 — 멈춤');
