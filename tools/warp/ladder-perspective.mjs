// 왜곡 사다리 생성 + 현행 디코더 한계 측정 — 3D 왜곡 강건성 트랙.
//
// 재료 규약 (실측으로 확정):
//  · 코드는 **cellSurfaceLayout:'v0'** 로 만든다. 그래야 로케이터 칸이 tones 를 들고
//    (30/169), 뷰어 mesh 가 levelAt 으로 그것을 그릴 수 있다. cellSurface:true 나
//    v1r2·v2r2 는 **정본 렌더로도 복호가 안 된다** — 재료로 못 쓴다.
//  · 뷰어 mesh 는 «보기 층» 이라 disc(불스아이)를 안 그린다. v0 은 그것 없이도
//    읽히는지 이 스크립트의 baseline 이 매번 확인한다 (아니면 즉시 멈춘다).
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { rasterToPng } from '../../src/png.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const OUT = 'test/output/warp-ladder';
const PAYLOAD = 'https://tl.estre.so';
const PPU = 17;
const MARGIN = 4;

const P = getPreset(DEFAULT_PRESET);
const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M' });
const n = encoded.n;
const layout = layoutForCube(n, { size: 1, margin: MARGIN });
const digitAt = (i, j) => { const c = encoded.cellDigits.get(`${i},${j}`); return c ? c.digit : null; };
const levelAt = (i, j, face) => {
  const c = encoded.cellDigits.get(`${i},${j}`);
  if (!c || !c.tones) return null;
  const lv = c.tones[face];
  return Number.isInteger(lv) ? lv : null;
};

const meshToScene = (mesh) => ({
  width: layout.width, height: layout.height, background: P.background,
  shapes: mesh.quads.map((q) => ({ kind: 'polygon', points: q.points2d, color: q.color })),
});

function render(view) {
  const mesh = buildOrbitMesh({
    n, tones: encoded.tones, levels: P.levels, layout, digitAt, levelAt, ...view,
  });
  const raster = rasterize(meshToScene(mesh), { pixelsPerUnit: PPU, supersample: 2 });
  return { mesh, raster };
}

function judge(raster) {
  try {
    const d = decodeFrontend({ width: raster.width, height: raster.height, pixels: raster.pixels }, {});
    if (d && d.ok) return String(d.text) === PAYLOAD ? 'ok' : `wrong(${String(d.text).length})`;
    return String((d && (d.reason || d.code)) || 'fail');
  } catch (e) { return 'throw:' + e.message.slice(0, 30); }
}

mkdirSync(OUT, { recursive: true });

// 🔴 기준선 먼저 — perspective 0 이 안 읽히면 사다리 전체가 무의미하다.
const base = render({ perspective: 0, yaw: 0, pitch: 0, roll: 0, faces: 3 });
const baseVerdict = judge(base.raster);
console.log(`기준선 (perspective 0): ${baseVerdict}`);
if (baseVerdict !== 'ok') {
  console.log('❌ 기준선이 안 읽힌다 — 재료가 오염이므로 사다리를 만들지 않는다.');
  process.exit(1);
}

const rows = [];
// 🔴 **설계 상한 = 0.5** (2026-08-31 확정). 노브 t 는 `α = t × 60°` 이고 α 는
//    외접구가 카메라에 대하는 반각이다. 실측으로 이 값이 시나리오를 가른다:
//    땅에 놓인 1 m 블록을 서서 볼 때 pitch ±10° 와 원근 ≤0.5 를 **동시에** 만족하는
//    구간이 1.32~2.37 m 로 생긴다 (0.1 상한에서는 어떤 거리에서도 성립 안 함).
//
// ⚠ 상한 위를 **지우지는 않는다.** 두 칸(0.7 · 0.9)을 «참고» 로 남긴다 — 잘라 내면
//    「스코프 밖이라 안 잰다」와 「재 봤더니 안 된다」가 구분되지 않는다.
const TARGET_MAX = 0.5;
const STEPS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.7, 0.9];

for (const perspective of STEPS) {
  const view = { perspective, yaw: 0, pitch: 0, roll: 0, faces: 3 };
  const { mesh, raster } = render(view);
  const verdict = judge(raster);
  // 보이는 면 수 — 없으면 「디코더가 못 읽는다」와 「그런 사진은 존재할 수 없다」가
  // 구분되지 않는다 (측정 규율). 투영 사각형의 부호넓이로 판정하며, 뷰어의 `facing`
  // 부호와 원근 9점 × 3면 전부에서 일치함을 확인했다.
  const visible = [...new Set(mesh.quads.filter((q) => q.face && q.facing < 0).map((q) => q.face))].sort();
  const inScope = perspective <= TARGET_MAX;
  const tag = `p${String(perspective).replace('.', '')}_y0_p0_r0_f3`;
  writeFileSync(`${OUT}/${tag}.png`, Buffer.from(rasterToPng(raster)));
  writeFileSync(`${OUT}/${tag}.json`, JSON.stringify({
    view, n, ppu: PPU, payload: PAYLOAD, verdict,
    alphaDeg: perspective * 60, visibleFaces: visible, inScope,
    size: { w: raster.width, h: raster.height },
    cells: mesh.quads.filter((q) => q.kind === 'module')
      .map((q) => ({ face: q.face, i: q.i, j: q.j, digit: q.digit })),
  }, null, 1));
  rows.push({ perspective, verdict, visibleFaces: visible, inScope });
  console.log(`${inScope ? '  ' : '· '}perspective ${String(perspective).padEnd(5)} (α ${String(perspective * 60).padStart(2)}°) `
    + `면 ${visible.join('') || '없음'} → ${verdict}${inScope ? '' : '   [스코프 밖 · 참고]'}`);
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  _note: '왜곡 사다리 (원근 축). 재료 = cellSurfaceLayout v0 · tones 3 · ECC M.',
  _scope: `설계 상한 perspective <= ${TARGET_MAX} (alpha = t*60). 그 위 칸은 참고용이며 목표가 아니다.`,
  targetMax: TARGET_MAX,
  payload: PAYLOAD, n, ppu: PPU, margin: MARGIN, rows,
}, null, 1));
// 한계선은 **스코프 안에서 3면이 보이는 칸만** 센다. 3면이 아닌 칸은 애초에 읽을
// 정보가 없으므로 「디코더가 실패했다」로 세면 한계선을 과소평가한다.
const scoped = rows.filter((r) => r.inScope);
const readable = scoped.filter((r) => r.visibleFaces.length === 3);
const ok = readable.filter((r) => r.verdict === 'ok');
const last = ok.length ? ok[ok.length - 1].perspective : null;
console.log(`
설계 상한 ${TARGET_MAX} (α ${TARGET_MAX * 60}°) 안에서:`);
console.log(`  3면이 보이는 칸 ${readable.length}/${scoped.length} · 그중 성공 ${ok.length} · 마지막 성공 = ${last}`);
if (last !== null && last < TARGET_MAX) {
  console.log(`  ⇒ 남은 격차: ${last} → ${TARGET_MAX} (${(TARGET_MAX / Math.max(last, 0.05)).toFixed(1)}배)`);
}
const outside = rows.filter((r) => !r.inScope);
if (outside.length) {
  console.log(`
참고 (스코프 밖): ${outside.map((r) => `${r.perspective}→${r.verdict}(${r.visibleFaces.length}면)`).join(' · ')}`);
}