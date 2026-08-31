// 자세 허용치를 **1° 눈금**으로 다시 잰다 — 10° 격자는 상한만 묶고 참값을 못 준다.
//
// 왜: 축 사다리가 10° 간격이라 「±10° 부터 실패」밖에 못 말한다. 그건 「허용치가
// [0°, 10°) 안에 있다」는 뜻이지 「10° 까지 된다」가 아니다. 한 점은 계약이 아니다 —
// 눈금이 굵으면 참값을 5배까지 부풀려 보고하게 된다.
//
// 같이 재는 것: **면별 조명 이득**. 뷰어는 톤 색을 음영 없이 칠하는데 실물 큐브(그리고
// 마인크래프트)는 면마다 밝기가 다르다. 디코더는 세 면의 raw 휘도를 정규화 없이 정렬
// 하므로, 이득 차가 순위를 뒤집으면 **원근보다 조명이 먼저 깨진다** — 그러면 원근
// 상한 논쟁 자체가 엉뚱한 축이다.
import { encodeY } from '../../src/encodeY.js';
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const PAYLOAD = 'https://tl.estre.so';
const PPU = 17;
const MARGIN = 4;
const DEG = Math.PI / 180;
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

// 면별 이득을 quad 색에 곱해 «조명» 을 흉내 낸다. 뷰어를 고치지 않고 mesh 를 후처리한다.
function shade(mesh, gains) {
  if (!gains) return mesh.quads;
  return mesh.quads.map((q) => {
    const g = q.face ? (gains[q.face] === undefined ? 1 : gains[q.face]) : 1;
    if (g === 1 || !q.color) return q;
    const c = q.color;
    return { ...q, color: { r: Math.round(c.r * g), g: Math.round(c.g * g), b: Math.round(c.b * g) } };
  });
}

function judge(view, gains) {
  const mesh = buildOrbitMesh({ n, tones: encoded.tones, levels: P.levels, layout, digitAt, levelAt, ...view });
  const raster = rasterize({
    width: layout.width, height: layout.height, background: P.background,
    shapes: shade(mesh, gains).map((q) => ({ kind: 'polygon', points: q.points2d, color: q.color })),
  }, { pixelsPerUnit: PPU, supersample: 2 });
  try {
    const d = decodeFrontend({ width: raster.width, height: raster.height, pixels: raster.pixels }, {});
    if (d && d.ok) return String(d.text) === PAYLOAD ? 'ok' : 'wrong';
    return String((d && (d.reason || d.code)) || 'fail');
  } catch (e) { return `throw:${e.message.slice(0, 20)}`; }
}

const base = judge({ perspective: 0, yaw: 0, pitch: 0, roll: 0, faces: 3 });
console.log(`기준선 (전부 중립): ${base}`);
if (base !== 'ok') { console.log('❌ 기준선 실패 — 멈춘다.'); process.exit(1); }

// ── ① 자세 허용치, 1° 눈금 ──
console.log('\n── ① 자세 허용치 (1° 눈금) ──');
for (const t of [0, 0.05, 0.1]) {
  for (const axis of ['yaw', 'pitch']) {
    const okAt = [];
    for (let d = -6; d <= 6; d += 1) {
      const view = { perspective: t, yaw: 0, pitch: 0, roll: 0, faces: 3, [axis]: d * DEG };
      if (judge(view) === 'ok') okAt.push(d);
    }
    const lo = okAt.length ? Math.min(...okAt) : null;
    const hi = okAt.length ? Math.max(...okAt) : null;
    const contiguous = okAt.length === (hi - lo + 1);
    console.log(`  원근 ${String(t).padEnd(5)} ${axis.padEnd(6)} 성공 ${okAt.length ? `${lo}° ~ ${hi}°` : '없음'}`
      + `  (성공한 값: ${okAt.join(',') || '—'})${okAt.length && !contiguous ? '  ⚠ 구간이 안 이어짐' : ''}`);
  }
}

// ── ② 면별 조명 이득 ──
console.log('\n── ② 면별 조명 이득 (자세·원근 전부 중립) ──');
const CASES = [
  ['음영 없음 (현행 사다리)', null],
  ['마인크래프트 바닐라 1.0/0.8/0.6', { T: 1.0, L: 0.8, R: 0.6 }],
  ['같은 비율, 순서 바꿈', { T: 0.6, L: 1.0, R: 0.8 }],
  ['약한 음영 1.0/0.92/0.85', { T: 1.0, L: 0.92, R: 0.85 }],
  ['아주 약한 1.0/0.97/0.94', { T: 1.0, L: 0.97, R: 0.94 }],
];
for (const [label, gains] of CASES) {
  console.log(`  ${label.padEnd(34)} → ${judge({ perspective: 0, yaw: 0, pitch: 0, roll: 0, faces: 3 }, gains)}`);
}
// 어디서 깨지나 — 이득 차를 서서히 키운다
console.log('\n  음영 세기 훑기 (T=1 고정, L·R 을 함께 낮춤):');
for (const g of [1.0, 0.98, 0.96, 0.94, 0.92, 0.9, 0.85, 0.8, 0.7, 0.6]) {
  const v = judge({ perspective: 0, yaw: 0, pitch: 0, roll: 0, faces: 3 }, { T: 1, L: g, R: g * g });
  console.log(`    L=${g.toFixed(2)} R=${(g * g).toFixed(2)} → ${v}`);
}

// ── ③ 대조군: 음영이 실제로 상을 바꿨나 ──
// 🔴 「전부 ok」는 «조명이 안전하다» 와 «내 음영이 아무 일도 안 했다» 가 똑같이 생겼다.
//    바뀐 화소를 세지 않으면 ② 는 아무것도 말하지 않는다.
console.log('\n── ③ 대조군 — 음영이 상을 실제로 바꿨나 ──');
function renderPixels(gains) {
  const mesh = buildOrbitMesh({
    n, tones: encoded.tones, levels: P.levels, layout, digitAt, levelAt,
    perspective: 0, yaw: 0, pitch: 0, roll: 0, faces: 3,
  });
  const shaded = shade(mesh, gains);
  const changedQuads = gains
    ? shaded.filter((q, i) => q.color && mesh.quads[i].color
      && (q.color.r !== mesh.quads[i].color.r || q.color.g !== mesh.quads[i].color.g)).length
    : 0;
  const raster = rasterize({
    width: layout.width, height: layout.height, background: P.background,
    shapes: shaded.map((q) => ({ kind: 'polygon', points: q.points2d, color: q.color })),
  }, { pixelsPerUnit: PPU, supersample: 2 });
  return { pixels: raster.pixels, changedQuads, total: mesh.quads.length };
}
const plain = renderPixels(null);
for (const [label, gains] of CASES.slice(1)) {
  const r = renderPixels(gains);
  let diff = 0;
  for (let i = 0; i < plain.pixels.length; i += 4) {
    if (plain.pixels[i] !== r.pixels[i] || plain.pixels[i + 1] !== r.pixels[i + 1]) diff += 1;
  }
  console.log(`  ${label.padEnd(34)} 색이 바뀐 quad ${String(r.changedQuads).padStart(4)}/${r.total}`
    + ` · 다른 화소 ${String(diff).padStart(7)}`);
}
