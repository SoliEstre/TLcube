/**
 * v0W2 정본 재검산 — 운영자 팩(JSON) → 계수 → 다수 톤 정규화 → 기존 정본에서의
 * 유도 가능성 판정.
 *
 * 이 스크립트는 **손 좌표표를 만들지 않는다**. 팩을 읽고, 기존 정본 배열
 * (K3_CENTRE = v1r2 NW 5×5 · V0XQ_CORNER = v0X SE 평행이동 · V0X SE) 에서
 * 유도한 값과 셀 단위로 대조해 «표가 필요한 최소 잔여» 만 뽑아낸다.
 *
 *   node test/output/lanes/claude-v0w2-derive.mjs
 *
 * src 무수정 · RNG 없음 · test/output/ 밖에 쓰지 않는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(readFileSync(path.join(here, 'claude-v0w2-pack.json'), 'utf8'));

const FACES = ['T', 'L', 'R'];
const N = pack.n;

// ── ① 계수 ────────────────────────────────────────────────────────────────
const userNonData = pack.userNonData_packed.map(([i, j]) => [i, j]);
const overrides = pack.toneOverrides_packed;
const perFace = Object.fromEntries(FACES.map((f) => [f, new Map()]));
for (const [face, i, j, tone] of overrides) perFace[face].set(i + ',' + j, tone);

const paintedKeys = new Set();
for (const [i, j] of userNonData) paintedKeys.add(i + ',' + j);
for (const [face, i, j] of overrides) paintedKeys.add(i + ',' + j);

console.log('── ① 계수 ──');
console.log('userNonData          :', userNonData.length, '(팩 _note 96)');
console.log('toneOverrides        :', overrides.length, '(팩 _note 290)');
for (const f of FACES) console.log('  face ' + f + '            :', perFace[f].size);
console.log('painted (override ∪ nonData):', paintedKeys.size, '(팩 _note 97)');
console.log('counts.detector 선언 :', pack.counts.detector);
console.log('counts.data 선언     :', pack.counts.data,
  '= ' + pack.counts.total + ' − ' + pack.counts.detector + ' − ' + pack.counts.fixed);

// 미도색(=override 가 없는 면) 찾기
const missing = [];
for (const key of paintedKeys) {
  for (const f of FACES) if (!perFace[f].has(key)) missing.push([key, f]);
}
console.log('override 누락 (편집기 함정):', JSON.stringify(missing));

// ── ② 다수 톤 정규화 ──────────────────────────────────────────────────────
// 세 면 중 둘 이상이 같은 톤이면 그 톤을 결측 면에 채운다. v0X 정규화(2026-08-16
// 승인) 와 같은 규칙이고, mid(1) 면을 만들지 않는다.
const cells = [];
for (const key of [...paintedKeys].sort((a, b) => {
  const [ai, aj] = a.split(',').map(Number);
  const [bi, bj] = b.split(',').map(Number);
  return ai - bi || aj - bj;
})) {
  const [i, j] = key.split(',').map(Number);
  const tones = FACES.map((f) => perFace[f].get(key));
  const known = tones.filter((t) => t !== undefined);
  const counts = new Map();
  for (const t of known) counts.set(t, (counts.get(t) || 0) + 1);
  let majority = null; let best = -1;
  for (const [t, c] of counts) if (c > best) { best = c; majority = t; }
  const filled = tones.map((t) => (t === undefined ? majority : t));
  if (filled.some((t) => t === undefined)) throw new Error('정규화 실패 ' + key);
  cells.push([i, j, ...filled]);
}
console.log('\n── ② 정규화 후 ──');
console.log('정본 셀            :', cells.length);
console.log('mid(1) 면          :', cells.filter((c) => c.slice(2).includes(1)).length);
const asym = cells.filter(([, , T, L, R]) => !(T === L && L === R));
console.log('면 비대칭 셀       :', asym.length,
  '(' + (asym.length / cells.length * 100).toFixed(1) + ' %)');

// ── ③ 블록 분해 ───────────────────────────────────────────────────────────
const inNW = ([i, j]) => i <= 4 && j <= 4;
const inNE = ([i, j]) => i <= 5 && j >= 15;
const inSE = ([i, j]) => i >= 15 && j >= 15;
const NW = cells.filter(inNW);
const NE = cells.filter(inNE);
const SE = cells.filter(inSE);
console.log('\n── ③ 블록 ──');
console.log('NW (0..4)²          :', NW.length);
console.log('NE (0..5)×(15..20)  :', NE.length);
console.log('SE (15..20)²        :', SE.length);
console.log('분류 밖             :', cells.length - NW.length - NE.length - SE.length);

// ── ④ 기존 정본에서의 유도 대조 ───────────────────────────────────────────
const src = readFileSync(path.join(here, '..', '..', '..', 'src', 'cellSurfaceFinal.js'), 'utf8');
function extractArray(name) {
  const at = src.indexOf('const ' + name + ' = Object.freeze([');
  if (at < 0) throw new Error('못 찾음 ' + name);
  const open = src.indexOf('[', at + ('const ' + name + ' = Object.freeze(').length);
  let depth = 0; let end = -1;
  for (let k = open; k < src.length; k += 1) {
    if (src[k] === '[') depth += 1;
    else if (src[k] === ']') { depth -= 1; if (depth === 0) { end = k; break; } }
  }
  // eslint-disable-next-line no-new-func
  return Function('return ' + src.slice(open, end + 1))();
}
const V1R2_CELLS = extractArray('V1R2_CELLS');
const V0X_CELLS = extractArray('V0X_CELLS');
const V0_CELLS = extractArray('V0_CELLS');

const K3 = V1R2_CELLS.filter(([i, j]) => i <= 4 && j <= 4);
const V0X_SE = V0X_CELLS.filter(([i, j]) => i >= 15 && j >= 15);
const V0XQ_CORNER = V0X_SE.map(([i, j, T, L, R]) => [i - 15, j, T, L, R]);

function keyMap(rows) {
  return new Map(rows.map(([i, j, T, L, R]) => [i + ',' + j, [T, L, R]]));
}
function diff(label, want, got) {
  const a = keyMap(want); const b = keyMap(got);
  const bad = [];
  for (const [k, v] of b) {
    const w = a.get(k);
    if (!w) { bad.push([k, 'want-없음', v]); continue; }
    if (w[0] !== v[0] || w[1] !== v[1] || w[2] !== v[2]) bad.push([k, w, v]);
  }
  for (const k of a.keys()) if (!b.has(k)) bad.push([k, 'got-없음', null]);
  console.log(label + ' : ' + (bad.length === 0 ? '완전 일치 ✓' : bad.length + ' 불일치'));
  if (bad.length) for (const row of bad) console.log('    ', JSON.stringify(row));
  return bad;
}

console.log('\n── ④ 유도 대조 ──');
// NE ?= V0XQ_CORNER_CELLS (같은 배열)
diff('NE ?= V0XQ_CORNER_CELLS (v0X SE 를 (i−15,j) 이동)', V0XQ_CORNER, NE);

// NW ?= K3 (v1r2 NW 5×5) 원본
const nwRaw = diff('NW ?= K3_CENTRE_CELLS (v1r2 NW 5×5) 원본', K3, NW);
// NW ?= K3 의 3면 다수결 대칭화
const K3sym = K3.map(([i, j, T, L, R]) => {
  const c = new Map(); for (const t of [T, L, R]) c.set(t, (c.get(t) || 0) + 1);
  let m = null; let b = -1; for (const [t, n2] of c) if (n2 > b) { b = n2; m = t; }
  return [i, j, m, m, m];
});
diff('NW ?= K3 의 **3면 다수결 대칭화**', K3sym, NW);

// SE T/L ?= v0X SE 톤 (같은 좌표)
const seTL = SE.map(([i, j, T, L]) => [i, j, T, L]);
let tlBad = 0;
const v0xSeMap = keyMap(V0X_SE);
for (const [i, j, T, L] of seTL) {
  const w = v0xSeMap.get(i + ',' + j);
  if (!w || w[0] !== T || w[0] !== L) { tlBad += 1; console.log('   SE(T/L) 불일치', i, j, T, L, w); }
}
console.log('SE(T,L) ?= v0X SE 동심 사각 톤 (같은 좌표) : '
  + (tlBad === 0 ? '완전 일치 ✓ (T=L=v0X SE)' : tlBad + ' 불일치'));

// SE R ?= 무엇인가
const seR = SE.map(([i, j, , , R]) => [i, j, R]);
let rEqTl = 0; let rEqInv = 0;
for (const [i, j, R] of seR) {
  const w = v0xSeMap.get(i + ',' + j);
  if (w[0] === R) rEqTl += 1;
  if (2 - w[0] === R) rEqInv += 1;
}
console.log('SE(R) 가 T/L 과 같은 셀 : ' + rEqTl + '/36 · T/L 의 반전인 셀 : ' + rEqInv + '/36');
console.log('  → SE(R) 는 독자 무늬 (표 필요). 36값:');
for (let i = 15; i <= 20; i += 1) {
  const row = [];
  for (let j = 15; j <= 20; j += 1) row.push(keyMap(SE).get(i + ',' + j)[2]);
  console.log('    i=' + i + ' : ' + row.join(' '));
}
console.log('  참고 — SE(T=L) 36값:');
for (let i = 15; i <= 20; i += 1) {
  const row = [];
  for (let j = 15; j <= 20; j += 1) row.push(keyMap(SE).get(i + ',' + j)[0]);
  console.log('    i=' + i + ' : ' + row.join(' '));
}

// v0 SE 3×3 (v0W 위상 마커) 와의 관계 — 2× 스케일 가설
const v0se = keyMap(V0_CELLS.filter(([i, j]) => i >= 10 && j >= 10));
let scaleHit = 0;
for (let i = 15; i <= 20; i += 1) {
  for (let j = 15; j <= 20; j += 1) {
    const src3 = v0se.get((10 + Math.floor((i - 15) / 2)) + ',' + (10 + Math.floor((j - 15) / 2)));
    const got = keyMap(SE).get(i + ',' + j);
    if (src3[2] === got[2]) scaleHit += 1;
  }
}
console.log('  가설 «SE(R) = v0 SE 3×3 R 을 2× 확대» 일치 : ' + scaleHit + '/36');

// ── ⑤ 비대칭 셀 분포 (위상 판별력의 원천) ─────────────────────────────────
console.log('\n── ⑤ 면 비대칭 셀 분포 ──');
const byBlock = { NW: 0, NE: 0, SE: 0 };
for (const c of asym) {
  if (inNW(c)) byBlock.NW += 1;
  else if (inNE(c)) byBlock.NE += 1;
  else if (inSE(c)) byBlock.SE += 1;
}
console.log(JSON.stringify(byBlock), '합계', asym.length, '/', cells.length);

// ── ⑥ 회계 ────────────────────────────────────────────────────────────────
console.log('\n── ⑥ 회계 (편집기 산술) ──');
console.log(N + '² = ' + (N * N) + ' − painted(' + cells.length + ') − reference(12) − format(18) = '
  + (N * N - cells.length - 12 - 18));
