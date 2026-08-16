/**
 * claude-skew-real-verifiedrank.mjs — CS 블록 로케이터의 `verified` 후보가 **진짜 큐브
 * 위인가**를 프레임마다 센다 (표준 6장 · 초광각 3장 공통).
 *
 * 참값 중심은 디코더와 독립인 국소화기 산출(`claude-skew-real-loc_*.json`)의 육각
 * bbox 중심이다. 프레임 좌표로의 사상은 `claude-skew-real-jpeg.py` 의 모드 정의를
 * 그대로 되짚는다 (whole = 등비축소 · live = 중앙 정사각 후 축소 · box = 창 크롭).
 *
 * 보고: 최고점 후보의 큐브까지 거리(반경 배수) · «큐브 위(≤0.35 R)» 후보의 최고 순위
 * 와 점수 · 큐브 위가 아닌 최고점 후보의 점수. §4.1 의 «순위가 뒤집혔다» 를 코퍼스
 * 전체로 일반화한 자다. 결정적(난수 없음).
 *
 * 사용: node tools/probes/claude-skew-real-verifiedrank.mjs [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LANES = join(ROOT, 'test', 'output', 'lanes');
const read = (f) => JSON.parse(readFileSync(join(LANES, f), 'utf8'));

function truthOf(id) {
  const d = read(`claude-skew-real-loc_${id === 'p02' ? 'p02_par0' : id}.json`);
  const [x0, y0, x1, y1] = d.bbox;
  return {
    center: [(x0 + x1) / 2, (y0 + y1) / 2],
    radius: Math.max(x1 - x0, y1 - y0) / 2,
    size: d.size,
  };
}

/** 원본 좌표 → 프레임 좌표. jpeg.py 의 모드 정의(클램프 포함)를 그대로 되짚는다. */
function mapper(mode, truth, frameW, frameH) {
  const [w0, h0] = truth.size;
  if (mode.startsWith('live')) {
    const side = Math.min(w0, h0);
    const x = (w0 - side) / 2;
    const y = (h0 - side) / 2;
    const s = frameW / side;
    return { map: (p) => [(p[0] - x) * s, (p[1] - y) * s], scale: s };
  }
  if (mode.startsWith('whole')) {
    const s = frameW / w0;
    return { map: (p) => [p[0] * s, p[1] * s], scale: s };
  }
  if (mode.startsWith('box')) {
    const [head, rest] = mode.slice(3).split('@');
    const target = Number(head);
    let [cx, cy, sSide] = rest.split(',').map(Number);
    sSide = Math.min(sSide, w0, h0);
    cx = Math.min(Math.max(0, cx), w0 - sSide);
    cy = Math.min(Math.max(0, cy), h0 - sSide);
    const s = target / sSide;
    return { map: (p) => [(p[0] - cx) * s, (p[1] - cy) * s], scale: s };
  }
  throw new Error('mode 미지원: ' + mode);
}

function analyse(rows, ids, label) {
  const truths = Object.fromEntries(ids.map((id) => [id, truthOf(id)]));
  const out = [];
  for (const r of rows) {
    if (r.opt !== 'lab') continue;
    const verified = r.csBlockLocator && r.csBlockLocator.verified;
    if (!Array.isArray(verified) || verified.length === 0) continue;
    const truth = truths[r.photo];
    const { map, scale } = mapper(r.mode, truth, r.width, r.height);
    const c = map(truth.center);
    const rad = truth.radius * scale;
    const ranked = [...verified].map((v, i) => ({
      i, score: v.score, x: v.x, y: v.y,
      rel: Math.hypot(v.x - c[0], v.y - c[1]) / rad,
    }));
    const onCube = ranked.filter((v) => v.rel <= 0.35);
    const offCube = ranked.filter((v) => v.rel > 0.35);
    out.push({
      photo: r.photo, mode: r.mode, kind: r.kind ?? (r.zoom ? 'crop' : 'sweep'),
      frame: [r.width, r.height],
      cubeRadiusPx: Number(rad.toFixed(1)),
      verifiedCount: verified.length,
      topScore: ranked[0].score,
      topRelToCube: Number(ranked[0].rel.toFixed(2)),
      topIsCube: ranked[0].rel <= 0.35,
      bestOnCubeRank: onCube.length ? onCube[0].i : null,
      bestOnCubeScore: onCube.length ? onCube[0].score : null,
      bestOffCubeScore: offCube.length ? offCube[0].score : null,
      rankInverted: onCube.length > 0 && offCube.length > 0 && offCube[0].score > onCube[0].score,
      cubeFound: onCube.length > 0,
    });
  }
  const n = out.length;
  const pct = (k) => `${out.filter(k).length}/${n}`;
  console.log(`\n=== ${label} (verified 있는 lab 프레임 ${n}) ===`);
  console.log(`최고점 후보가 큐브 위      : ${pct((r) => r.topIsCube)}`);
  console.log(`큐브가 verified 안에 있음   : ${pct((r) => r.cubeFound)}`);
  console.log(`순위 뒤집힘(가짜 > 진짜)    : ${pct((r) => r.rankInverted)}`);
  const ranks = out.filter((r) => r.cubeFound).map((r) => r.bestOnCubeRank).sort((a, b) => a - b);
  console.log(`큐브 후보의 최고 순위 중앙값: ${ranks.length ? ranks[Math.floor(ranks.length / 2)] : null}`
    + ` (최선 ${ranks[0] ?? null} · 최악 ${ranks[ranks.length - 1] ?? null})`);
  return out;
}

const stdRows = [...read('claude-skew-real-results.json'),
  ...read('claude-skew-real-crops.json'), ...read('claude-skew-real-crops2.json')];
const wideRows = read('claude-skew-real-wide.json');
const res = {
  standard: analyse(stdRows, ['p00', 'p01', 'p02', 'p03', 'p04', 'p05'], 'standard(6장)'),
  wide: analyse(wideRows, ['w00', 'w01', 'w02'], 'wide(3장)'),
};
const idx = process.argv.indexOf('--json');
if (idx >= 0 && process.argv[idx + 1]) {
  writeFileSync(process.argv[idx + 1], JSON.stringify(res, null, 1));
  console.log(`\n→ ${process.argv[idx + 1]}`);
}
