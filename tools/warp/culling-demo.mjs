// 뷰어 컬링 결함을 눈으로 보여 주는 대조판 — 컬링을 넣을지 판단하기 위한 대조판.
//
// 위줄 = 현행 (등 돌린 면도 그린다) · 아래줄 = 컬링 적용 (facing ≥ 0 면 안 그린다)
// 같은 원근값에서 나란히 놓아야 «무엇이 달라지는가» 가 보인다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { rasterToPng } from '../../src/png.js';

const OUT = 'test/output/pose-6dof';
const PPU = 9;
const MARGIN = 3;
const GAP = 10;
const D = Math.PI / 180;
// 실기에 가까운 손각도. yaw=pitch=0 이면 세 면이 대칭이라 «어느 면이 먼저 등을 돌리나» 가 안 보인다.
const VIEW = { yaw: 15 * D, pitch: 10 * D, roll: 0, faces: 3 };
const STEPS = [0, 0.5, 0.7, 0.8, 0.9, 1.0];

const P = getPreset(DEFAULT_PRESET);
const encoded = encodeY('https://tl.estre.so', { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M' });
const n = encoded.n;
const layout = layoutForCube(n, { size: 1, margin: MARGIN });
const digitAt = (i, j) => { const c = encoded.cellDigits.get(`${i},${j}`); return c ? c.digit : null; };
const levelAt = (i, j, face) => {
  const c = encoded.cellDigits.get(`${i},${j}`);
  if (!c || !c.tones) return null;
  const lv = c.tones[face];
  return Number.isInteger(lv) ? lv : null;
};

function render(perspective, cull) {
  const mesh = buildOrbitMesh({
    n, tones: encoded.tones, levels: P.levels, layout, digitAt, levelAt, ...VIEW, perspective,
  });
  // 컬링 = facing < 0 («카메라를 마주 본다») 만 남긴다. quads 는 이미 정렬돼 있다.
  const quads = cull ? mesh.quads.filter((q) => q.facing < 0) : mesh.quads;
  const scene = {
    width: layout.width, height: layout.height, background: P.background,
    shapes: quads.map((q) => ({ kind: 'polygon', points: q.points2d, color: q.color })),
  };
  const faces = new Set(mesh.quads.filter((q) => q.face && q.facing < 0).map((q) => q.face));
  return {
    raster: rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 }),
    visible: [...faces].sort(),
    total: mesh.quads.length, kept: quads.length,
  };
}

const cells = STEPS.map((p) => ({ p, cur: render(p, false), cull: render(p, true) }));
const W = cells[0].cur.raster.width;
const H = cells[0].cur.raster.height;
const outW = STEPS.length * W + (STEPS.length + 1) * GAP;
const outH = 2 * H + 3 * GAP;
const px = new Uint8Array(outW * outH * 4);
// 배경 — 두 줄을 가르는 옅은 회색
for (let i = 0; i < outW * outH; i += 1) {
  px[i * 4] = 108; px[i * 4 + 1] = 112; px[i * 4 + 2] = 120; px[i * 4 + 3] = 255;
}
function blit(src, dx, dy) {
  for (let y = 0; y < src.height; y += 1) {
    const s = y * src.width * 4;
    const d = ((dy + y) * outW + dx) * 4;
    px.set(src.pixels.subarray(s, s + src.width * 4), d);
  }
}
cells.forEach((c, i) => {
  const x = GAP + i * (W + GAP);
  blit(c.cur.raster, x, GAP);
  blit(c.cull.raster, x, GAP * 2 + H);
});

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/culling-demo.png`, rasterToPng({ width: outW, height: outH, pixels: px }));
console.log(`원근 축 (yaw 15° · pitch 10°) — 왼쪽부터 ${STEPS.join(' / ')}`);
console.log('위줄 = 현행 · 아래줄 = 컬링 적용\n');
// 눈짐작 금지 — 두 렌더가 실제로 몇 픽셀이나 다른지 센다.
// 화가 알고리즘이 등진 면을 먼저 칠하고 앞면이 덮으므로 «대부분 가려진다» 가 기본 가설이다.
for (const c of cells) {
  const a = c.cur.raster.pixels;
  const b = c.cull.raster.pixels;
  let diff = 0;
  let ink = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff += 1;
    // 배경이 아닌 화소 = 큐브가 차지한 면적
    if (a[i] !== P.background.r || a[i + 1] !== P.background.g || a[i + 2] !== P.background.b) ink += 1;
  }
  const pct = ink > 0 ? (diff / ink) * 100 : 0;
  // 🔴 대조군 — 컬링이 실제로 몇 개를 걸렀나. 0 개를 걸렀다면 «차이 0%» 는 아무 뜻이 없다.
  const removed = c.cull.total - c.cull.kept;
  console.log(`  원근 ${String(c.p).padEnd(4)} 보이는 면 ${(c.cur.visible.join('') || '없음').padEnd(4)}(${c.cur.visible.length}면)  컬링 제거 ${String(removed).padStart(4)}/${String(c.cull.total).padStart(4)} quad  다른 화소 ${String(diff).padStart(6)} / 큐브 ${String(ink).padStart(6)} = ${pct.toFixed(2)}%`);
}
console.log(`\n→ ${OUT}/culling-demo.png  (${outW}×${outH})`);

// ── 일반화 검사 — 한 자세만 보고 「항상 덮인다」고 적으면 그게 다음 사람을 속인다 ──
// 3면 모드에서 등진 면을 걸러도 상이 안 바뀌는 것이 **자세 전반에서** 참인가.
console.log('\n── 자세 훑기 (등진 면을 걸렀을 때 상이 바뀌는 자세가 있나) ──');
let worst = { pct: -1 };
let posesWithCulling = 0;
let scanned = 0;
for (let yd = -40; yd <= 40; yd += 10) {
  for (let pd = -40; pd <= 40; pd += 10) {
    for (const persp of [0, 0.4, 0.7, 0.85, 1.0]) {
      const mesh = buildOrbitMesh({
        n, tones: encoded.tones, levels: P.levels, layout, digitAt, levelAt,
        yaw: yd * D, pitch: pd * D, roll: 0, faces: 3, perspective: persp,
      });
      const kept = mesh.quads.filter((q) => q.facing < 0);
      scanned += 1;
      if (kept.length === mesh.quads.length) continue;   // 거른 게 없으면 비교할 것도 없다
      posesWithCulling += 1;
      const mk = (qs) => rasterize({
        width: layout.width, height: layout.height, background: P.background,
        shapes: qs.map((q) => ({ kind: 'polygon', points: q.points2d, color: q.color })),
      }, { pixelsPerUnit: PPU, supersample: 2 });
      const a = mk(mesh.quads).pixels;
      const b = mk(kept).pixels;
      let diff = 0;
      let ink = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff += 1;
        if (a[i] !== P.background.r || a[i + 1] !== P.background.g || a[i + 2] !== P.background.b) ink += 1;
      }
      const pct = ink > 0 ? (diff / ink) * 100 : 0;
      if (pct > worst.pct) worst = { pct, yd, pd, persp, diff, removed: mesh.quads.length - kept.length };
    }
  }
}
console.log(`자세 ${scanned}개 중 등진 면이 생긴 자세 ${posesWithCulling}개.`);
console.log(`상이 가장 많이 바뀐 자세: yaw ${worst.yd}° · pitch ${worst.pd}° · 원근 ${worst.persp}`);
console.log(`  → ${worst.removed} quad 제거, 다른 화소 ${worst.diff} (${worst.pct.toFixed(3)}%)`);
console.log(worst.pct === 0
  ? '⇒ 훑은 범위 전체에서 **상이 바뀌지 않는다** — 화가 알고리즘이 이미 옳게 덮고 있다.'
  : '⇒ 상이 바뀌는 자세가 있다 — 컬링이 실제 수리다.');
