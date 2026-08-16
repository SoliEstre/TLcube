/** claude-skew-real-shape.mjs — decodeFrontend 결과의 **구조**를 찍는다 (진단 보조). */
import { readRgba } from './claude-skew-real-frontend.mjs';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const stable = process.argv.includes('--stable');
const raster = readRgba(process.argv[2]);
const r = decodeFrontend(raster, {
  bootstrap: { family: { cube: { enableLocatorY: !stable, enableCellSurfaceY: !stable } } },
});
const maxDepth = Number(process.argv.find((a) => a.startsWith('--depth='))?.slice(8) ?? 6);
function shape(v, depth = 0) {
  if (depth > maxDepth) return '…';
  if (Array.isArray(v)) return `[${v.length}]` + (v.length ? shape(v[0], depth + 1) : '');
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).map((k) => `${k}:${shape(v[k], depth + 1)}`).join(', ') + '}';
  }
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}
console.log(shape(r));
