/** H5–H8 귀퉁이 10×10 파인더 역할 맵. 공개 링 H-v2 레이아웃과 독립이에요. */
import {CORNER_EXTRA_BOOK} from './h-mode-codebook.js';
const FACE3 = Object.freeze(['ZM', 'XM', 'YM']);
const FACE6 = Object.freeze(['ZM', 'XM', 'YM', 'ZP', 'XP', 'YP']);
const VERSIONS = Object.freeze([5, 6, 7, 8]);
const EXPECTED_DATA = Object.freeze({ 5: 537, 6: 801, 7: 1095, 8: 1425 });
const WORD_HEX = Object.freeze([
  '1177ecaed', 'f8ed3f90b', '7232ec926', '31c6134bf',
  'e802761a2', '022e24695', 'c26bae66c', '691d5abf6',
  '3718d2877', '276badb91', '3b902b4b7', '9a9e0ee2d',
  'fb0232ad0', '929ed1ef1', '394081814', 'fa3d9646c',
  'd8470f581', '6bb73f80f', 'ae9bb826f', '5d67e1f68',
  '8652655c6', '1a9cca7b8', 'b279f0d4c', '17e569157',
  'ef478f37f', 'b4f5f819e', 'b670fb36b', 'cd4f12c9a',
  '9c150dc01', '1c5744e4d', '08e66f806', 'ea892ec0e',
  'd8eea00af', '73e908efb', 'b2e9be45c', '7f48f9362',
]);

function key(i, j) {
  return `${i},${j}`;
}

function bitsFromHex(hex) {
  const word = BigInt(`0x${hex}`);
  const bits = new Uint8Array(36);
  for (let k = 0; k < 36; k += 1) bits[k] = Number((word >> BigInt(k)) & 1n);
  return bits;
}

function buildBook() {
  const entries = [];
  let w = 0;
  for (const face of FACE3) {
    for (let slot = 0; slot < 4; slot += 1) {
      entries.push(Object.freeze({
        mode: 3, face, slot, bits: Object.freeze(Array.from(bitsFromHex(WORD_HEX[w]))),
      }));
      w += 1;
    }
  }
  for (const face of FACE6) {
    for (let slot = 0; slot < 4; slot += 1) {
      entries.push(Object.freeze({
        mode: 6, face, slot, bits: Object.freeze(Array.from(bitsFromHex(WORD_HEX[w]))),
      }));
      w += 1;
    }
  }
  if (w !== 36) throw new Error('corner codebook 36');
  for (const row of CORNER_EXTRA_BOOK) entries.push(Object.freeze({
    ...row, bits: Object.freeze(Array.from(row.bits)),
  }));
  if (entries.length !== 84) throw new Error('corner codebook 84');
  return Object.freeze(entries);
}

const BOOK = buildBook();

function findCode(mode, face, slot) {
  return BOOK.find((row) => row.mode === mode && row.face === face && row.slot === slot) ?? null;
}

function markerKind(u, v) {
  if (u < 0 || v < 0 || u > 9 || v > 9) return null;
  if (u === 0 || v === 0 || u === 9 || v === 9) return { kind: 'quiet' };
  if (u === 1 || v === 1 || u === 8 || v === 8) return { kind: 'border' };
  const row = u - 2;
  const col = v - 2;
  return { kind: 'bit', bit: row * 6 + col };
}

function claim(roles, i, j, cell) {
  const k = key(i, j);
  const old = roles.get(k);
  if (!old) throw new Error(`격자 밖 ${i},${j}`);
  const whiteQuiet = cell.role === 'marker' && cell.kind === 'quiet' && old.role === 'boundary';
  if (old.role !== 'free' && !whiteQuiet) throw new Error(`예약 겹침 ${old.role}/${cell.role}/${i}/${j}`);
  roles.set(k, Object.freeze(cell));
}

function expandTile(roles, cells, role, i0, j0, extra) {
  for (let u = 0; u < 2; u += 1) {
    for (let v = 0; v < 2; v += 1) {
      const cell = Object.freeze({ role, i: i0 + u, j: j0 + v, ...extra });
      claim(roles, cell.i, cell.j, cell);
      cells.push(cell);
    }
  }
}

const cache = new Map();

/** @param {5|6|7|8} version H5 n33 · H6 n37 · H7 n41 · H8 n45 */
export function hCornerLayout(version) {
  if (!VERSIONS.includes(version)) throw new RangeError('hCornerLayout version 은 5|6|7|8');
  if (cache.has(version)) return cache.get(version);
  const n = 13 + 4 * version;
  const roles = new Map();
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) roles.set(key(i, j), { role: 'free', i, j });
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        roles.set(key(i, j), Object.freeze({ role: 'boundary', i, j, level: 4 }));
      }
    }
  }
  const markers = Object.freeze([
    Object.freeze({ slot: 0, i: 0, j: 0, footprint: 10 }),
    Object.freeze({ slot: 1, i: 0, j: n - 10, footprint: 10 }),
    Object.freeze({ slot: 2, i: n - 10, j: n - 10, footprint: 10 }),
    Object.freeze({ slot: 3, i: n - 10, j: 0, footprint: 10 }),
  ]);
  for (const m of markers) {
    for (let u = 0; u < 10; u += 1) {
      for (let v = 0; v < 10; v += 1) {
        const kind = markerKind(u, v);
        const cell = { role: 'marker', i: m.i + u, j: m.j + v, slot: m.slot, kind: kind.kind };
        if (kind.kind === 'bit') cell.bit = kind.bit;
        claim(roles, cell.i, cell.j, cell);
      }
    }
  }
  const j0 = 10;
  const j1 = n - 12;
  if (!(j1 >= j0 + 2)) throw new Error('format 간격 부족');
  const formatTiles = [];
  const routeTiles = [];
  const formatCells = [];
  const routeCells = [];
  const edges = [
    [{ i: 2, j: j0 }, { i: 2, j: j1 }],
    [{ i: j0, j: n - 4 }, { i: j1, j: n - 4 }],
    [{ i: n - 4, j: j0 }, { i: n - 4, j: j1 }],
    [{ i: j0, j: 2 }, { i: j1, j: 2 }],
  ];
  const routeEdges = [
    [{ i: 4, j: j0 }, { i: 4, j: j1 }],
    [{ i: j0, j: n - 6 }, { i: j1, j: n - 6 }],
    [{ i: n - 6, j: j0 }, { i: n - 6, j: j1 }],
    [{ i: j0, j: 4 }, { i: j1, j: 4 }],
  ];
  for (let s = 0; s < 4; s += 1) {
    for (let k = 0; k < 2; k += 1) {
      const bit = s * 2 + k;
      const f = edges[s][k];
      const r = routeEdges[s][k];
      formatTiles.push(Object.freeze({ role: 'format', i: f.i, j: f.j, size: 2, bit }));
      routeTiles.push(Object.freeze({ role: 'route', i: r.i, j: r.j, size: 2, bit }));
      expandTile(roles, formatCells, 'format', f.i, f.j, { bit });
      expandTile(roles, routeCells, 'route', r.i, r.j, { bit });
    }
  }
  const referenceTiles = [];
  const reference = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const rank = (r + c) % 3;
      const tone2Rank = rank === 2 ? 1 : rank;
      const i = 12 + 2 * r;
      const j = 12 + 2 * c;
      referenceTiles.push(Object.freeze({ role: 'reference', i, j, size: 2, row: r, column: c, rank, tone2Rank }));
      expandTile(roles, reference, 'reference', i, j, { rank, tone2Rank });
    }
  }
  const scan = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const cell = roles.get(key(i, j));
      if (cell.role === 'free') scan.push(Object.freeze({ i, j }));
    }
  }
  while (scan.length % 3) {
    const c = scan.pop();
    roles.set(key(c.i, c.j), Object.freeze({ role: 'filler', i: c.i, j: c.j, level: 5 }));
  }
  for (const c of scan) roles.set(key(c.i, c.j), Object.freeze({ role: 'data', i: c.i, j: c.j }));
  if (roles.size !== n * n) throw new Error('role 격자 구멍');
  if (scan.length !== EXPECTED_DATA[version]) {
    throw new Error(`scan ${scan.length} !== ${EXPECTED_DATA[version]} (n=${n})`);
  }
  if (formatCells.length !== 32 || routeCells.length !== 32 || reference.length !== 36) {
    throw new Error('2x2 예약 칸 수');
  }
  const result = Object.freeze({
    version,
    n,
    roles,
    scan: Object.freeze(scan),
    tagCells: Object.freeze([]),
    formatCells: Object.freeze(formatCells),
    routeCells: Object.freeze(routeCells),
    reference: Object.freeze(reference),
    markers,
    formatTiles: Object.freeze(formatTiles),
    routeTiles: Object.freeze(routeTiles),
    referenceTiles: Object.freeze(referenceTiles),
    finder: 'corners',
  });
  cache.set(version, result);
  return result;
}

export function hCornerCodebook() {
  return BOOK.map((row) => ({
    mode: row.mode,
    face: row.face,
    slot: row.slot,
    bits: Uint8Array.from(row.bits),
  }));
}

export function hCornerMarkerLevel(cell, mode, face) {
  if (!cell || cell.role !== 'marker') throw new RangeError('hCornerMarkerLevel cell');
  const entry = findCode(mode, face, cell.slot);
  if (!entry) throw new RangeError('hCornerMarkerLevel mode/face/slot');
  if (cell.kind === 'quiet') return 4;
  if (cell.kind === 'border') return 3;
  if (cell.kind !== 'bit' || !Number.isInteger(cell.bit) || cell.bit < 0 || cell.bit > 35) {
    throw new RangeError('hCornerMarkerLevel bit');
  }
  return entry.bits[cell.bit] ? 3 : 4;
}

export function transformCornerBits(bits, rotation = 0, mirror = false) {
  if (!(bits instanceof Uint8Array) || bits.length !== 36) throw new TypeError('36bit');
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw new RangeError('rotation 0..3');
  if (mirror !== true && mirror !== false) throw new TypeError('mirror boolean');
  const out = new Uint8Array(36);
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      let ii = i;
      let jj = j;
      if (mirror) jj = 5 - jj;
      for (let r = 0; r < rotation; r += 1) [ii, jj] = [jj, 5 - ii];
      out[ii * 6 + jj] = bits[i * 6 + j];
    }
  }
  return out;
}
