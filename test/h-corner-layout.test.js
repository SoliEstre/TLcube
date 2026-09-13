import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hCornerLayout, hCornerCodebook, hCornerMarkerLevel, transformCornerBits,
} from '../src/h-corner-layout.js';

const DATA = { 5: 537, 6: 801, 7: 1095, 8: 1425 };
const COUNTS = {
  5: { marker: 400, boundary: 52, data: 537, format: 32, route: 32, reference: 36 },
  6: { marker: 400, boundary: 68, data: 801, format: 32, route: 32, reference: 36 },
  7: { marker: 400, boundary: 84, data: 1095, format: 32, route: 32, reference: 36, filler: 2 },
  8: { marker: 400, boundary: 100, data: 1425, format: 32, route: 32, reference: 36 },
};

function hamming(a, b) {
  let d = 0;
  for (let k = 0; k < a.length; k += 1) d += a[k] !== b[k];
  return d;
}

function countRoles(layout) {
  const c = {};
  for (const cell of layout.roles.values()) c[cell.role] = (c[cell.role] ?? 0) + 1;
  return c;
}

test('버전·n·scan 회계와 격자 구멍 없음', () => {
  for (const version of [5, 6, 7, 8]) {
    const layout = hCornerLayout(version);
    assert.equal(layout.n, 13 + 4 * version);
    assert.equal(layout.finder, 'corners');
    assert.equal(layout.tagCells.length, 0);
    assert.equal(layout.roles.size, layout.n * layout.n);
    assert.equal(layout.scan.length, DATA[version]);
    assert.equal(layout.scan.length % 3, 0);
    const counts = countRoles(layout);
    for (const [role, n] of Object.entries(COUNTS[version])) assert.equal(counts[role], n);
    const keys = new Set();
    for (const cell of layout.roles.values()) {
      const k = `${cell.i},${cell.j}`;
      assert.equal(keys.has(k), false);
      keys.add(k);
      assert.ok(cell.i >= 0 && cell.j >= 0 && cell.i < layout.n && cell.j < layout.n);
    }
    assert.equal(keys.size, layout.n * layout.n);
    assert.equal(Object.isFrozen(layout.scan), true);
    assert.equal(hCornerLayout(version), layout);
  }
});

test('format/route 각 bit 4셀, reference 톤 표본', () => {
  const layout = hCornerLayout(7);
  assert.equal(layout.formatCells.length, 32);
  assert.equal(layout.routeCells.length, 32);
  assert.equal(layout.reference.length, 36);
  for (let bit = 0; bit < 8; bit += 1) {
    assert.equal(layout.formatCells.filter((c) => c.bit === bit).length, 4);
    assert.equal(layout.routeCells.filter((c) => c.bit === bit).length, 4);
  }
  const r3 = [0, 0, 0];
  const r2 = [0, 0];
  for (const c of layout.reference) {
    r3[c.rank] += 1;
    r2[c.tone2Rank] += 1;
    assert.equal(c.tone2Rank, c.rank === 2 ? 1 : c.rank);
  }
  assert.deepEqual(r3, [12, 12, 12]);
  assert.deepEqual(r2, [12, 24]);
});

test('marker bit 좌표는 i=row, j=col, index=(i-mi-2)*6+(j-mj-2)', () => {
  for (const version of [5, 6, 7, 8]) {
    const layout = hCornerLayout(version);
    for (const m of layout.markers) {
      const bits = [];
      for (const cell of layout.roles.values()) {
        if (cell.role !== 'marker' || cell.slot !== m.slot) continue;
        if (cell.kind === 'bit') {
          const expect = (cell.i - m.i - 2) * 6 + (cell.j - m.j - 2);
          assert.equal(cell.bit, expect);
          bits.push(cell.bit);
        }
      }
      bits.sort((a, b) => a - b);
      assert.deepEqual(bits, [...Array(36).keys()]);
    }
  }
});

test('legacy corner36 prefix·append corner48·방어복사·D8 최소거리 8', () => {
  const book = hCornerCodebook();
  assert.equal(book.length, 84);
  assert.deepEqual(book.slice(0, 12).map((r) => `${r.mode}:${r.face}:${r.slot}`), [
    '3:ZM:0', '3:ZM:1', '3:ZM:2', '3:ZM:3',
    '3:XM:0', '3:XM:1', '3:XM:2', '3:XM:3',
    '3:YM:0', '3:YM:1', '3:YM:2', '3:YM:3',
  ]);
  assert.equal(book[12].mode, 6);
  assert.equal(book[12].face, 'ZM');
  assert.equal(book[12].slot, 0);
  assert.equal(book[35].face, 'YP');
  assert.equal(book[35].slot, 3);
  assert.deepEqual(book.slice(36).map((r) => `${r.mode}:${r.face}:${r.slot}`), [
    ...['XM','YM'].flatMap(face => [0,1,2,3].map(slot => `2:${face}:${slot}`)),
    ...['XM','YM','XP','YP'].flatMap(face => [0,1,2,3].map(slot => `4:${face}:${slot}`)),
    ...['ZM','XM','YM','XP','YP'].flatMap(face => [0,1,2,3].map(slot => `5:${face}:${slot}`)),
    ...[0,1,2,3].map(slot => `1:XM:${slot}`),
  ]);
  book[0].bits[0] = 1 - book[0].bits[0];
  assert.notEqual(hCornerCodebook()[0].bits[0], book[0].bits[0]);
  const orbits = [];
  for (const row of hCornerCodebook()) {
    for (let rot = 0; rot < 4; rot += 1) {
      for (const mirror of [false, true]) orbits.push(transformCornerBits(row.bits, rot, mirror));
    }
  }
  assert.equal(orbits.length, 84 * 8);
  for (let a = 0; a < orbits.length; a += 1) {
    for (let b = a + 1; b < orbits.length; b += 1) {
      assert.ok(hamming(orbits[a], orbits[b]) >= 8, `${a},${b}`);
    }
  }
});

test('hCornerMarkerLevel과 잘못된 입력 거부', () => {
  const layout = hCornerLayout(5);
  const quiet = [...layout.roles.values()].find((c) => c.role === 'marker' && c.kind === 'quiet');
  const border = [...layout.roles.values()].find((c) => c.role === 'marker' && c.kind === 'border');
  const bit = [...layout.roles.values()].find((c) => c.role === 'marker' && c.kind === 'bit' && c.slot === 0 && c.bit === 0);
  assert.equal(hCornerMarkerLevel(quiet, 3, 'ZM'), 4);
  assert.equal(hCornerMarkerLevel(border, 3, 'ZM'), 3);
  const level = hCornerMarkerLevel(bit, 3, 'ZM');
  assert.ok(level === 3 || level === 4);
  assert.equal(level, hCornerCodebook()[0].bits[0] ? 3 : 4);
  assert.throws(() => hCornerLayout(4), RangeError);
  assert.throws(() => hCornerLayout(9), RangeError);
  assert.throws(() => hCornerMarkerLevel(bit, 3, 'ZP'), RangeError);
  assert.throws(() => hCornerMarkerLevel(bit, 2, 'ZM'), RangeError);
  assert.throws(() => transformCornerBits(new Uint8Array(35), 0, false), TypeError);
});
