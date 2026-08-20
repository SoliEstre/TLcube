import { readLumaDump, lumaToRaster } from '../../../tools/read-luma.mjs';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
const [a, b] = process.argv.slice(2);
const A = readLumaDump(a), B = readLumaDump(b);
console.log('브라우저 덤프 : ' + A.width + 'x' + A.height + ' ' + A.bitDepth + 'bit');
console.log('내 변환기     : ' + B.width + 'x' + B.height + ' ' + B.bitDepth + 'bit');
if (A.width !== B.width || A.height !== B.height) { console.log('⚠ 크기가 다르다'); process.exit(0); }
let sum = 0, max = 0;
for (let i = 0; i < A.data.length; i += 1) {
  const d = Math.abs(A.data[i] - B.data[i]); sum += d; if (d > max) max = d;
}
console.log('평균 |Δ휘도| = ' + (sum / A.data.length).toFixed(5) + ' · 최대 = ' + max.toFixed(5));
for (const [name, F] of [['브라우저', A], ['내 변환', B]]) {
  const r = decodeFrontend(lumaToRaster(F), {});
  console.log(name.padEnd(9) + ' → ok=' + r.ok + ' reason=' + (r.reason ?? '—') + ' text=' + JSON.stringify(r.text ?? null));
}
