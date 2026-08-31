// ① 평행투영 동치 — 재료를 만들기 **전에** 이것부터 (계획 §3-1).
// perspective 0 · roll 0 · 3면 mesh 의 2D 투영이 ygrid.moduleQuad(2.5D 정본)와
// 점 단위로 같아야 한다. 여기서 갈리면 사다리 전체가 오염이다.
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { moduleQuad, layoutForCube, YFACES } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';

const n = 9;
const layout = layoutForCube(n, { size: 1, margin: 0.5 });
const pal = getPreset(DEFAULT_PRESET);
const cellDigits = new Map();
for (let j = 0; j < n; j += 1) {
  for (let i = 0; i < n; i += 1) cellDigits.set(`${i},${j}`, { digit: (i + 2 * j) % 6 });
}

const mesh = buildOrbitMesh({
  n, tones: 3, levels: pal.levels, layout,
  digitAt: (i, j) => cellDigits.get(`${i},${j}`).digit,
  yaw: 0, pitch: 0, roll: 0, perspective: 0, faces: 3,
});

// 정본과 대조: 면·셀마다 moduleQuad 와 points2d 를 비교한다.
let worst = 0;
let compared = 0;
for (const q of mesh.quads) {
  if (q.kind !== 'module') continue;
  const truth = moduleQuad(q.face, q.i, q.j, layout);
  for (let c = 0; c < 4; c += 1) {
    worst = Math.max(worst, Math.abs(truth[c].x - q.points2d[c].x), Math.abs(truth[c].y - q.points2d[c].y));
  }
  compared += 1;
}
console.log(`대조 ${compared} quad · 최대 좌표 오차 ${worst}`);
console.log(worst === 0 ? '✅ 평행투영 동치 — 재료 생성 진행 가능' : '❌ 갈림 — 재료가 오염된다');
console.log('mesh: quads', mesh.quads.length, '· radius3d', mesh.radius3d, '· faces', YFACES.length);
