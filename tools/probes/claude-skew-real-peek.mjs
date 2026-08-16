/** claude-skew-real-peek.mjs — 결과 객체의 임의 경로를 JSON 으로 찍는다 (진단 보조). */
import { readRgba } from './claude-skew-real-frontend.mjs';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const stable = process.argv.includes('--stable');
const raster = readRgba(process.argv[2]);
const r = decodeFrontend(raster, {
  bootstrap: { family: { cube: { enableLocatorY: !stable, enableCellSurfaceY: !stable } } },
});
const path = process.argv[3];
let node = r;
for (const key of path.split('.')) {
  if (key === '') continue;
  node = node?.[key];
}
const depth = Number(process.argv.find((a) => a.startsWith('--depth='))?.slice(8) ?? 6);
console.log(JSON.stringify(node, (k, v) => (v instanceof Float32Array || v instanceof Uint8Array ? `<${v.length}>` : v), 1).split('\n').slice(0, Number(process.argv.find((a) => a.startsWith('--lines='))?.slice(8) ?? 400)).join('\n'));
void depth;
