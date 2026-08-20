import fs from 'node:fs';
const DIR = new URL('./preview/', import.meta.url);
const b64 = (n) => 'data:image/png;base64,' + fs.readFileSync(new URL(n, DIR)).toString('base64');
const rows = [
  { id: 'O-CM', k: [6, 8, 10] },
  { id: 'A-CM', k: [6, 8, 10] },
  { id: 'H2O', k: [6, 8, 10] },
];
const out = {};
for (const r of rows) for (const k of r.k) {
  out[r.id + '-hl-k' + k] = b64(r.id + '-hl-k' + k + '.png');
  out[r.id + '-k' + k] = b64(r.id + '-k' + k + '.png');
}
fs.writeFileSync(new URL('./images.json', DIR), JSON.stringify(out));
console.log('이미지 ' + Object.keys(out).length + '개 · ' + (JSON.stringify(out).length / 1024 / 1024).toFixed(2) + ' MB');
