import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  CONCRETE_COLORS, nearestConcrete, voxelizeCube, encodeSchematicNbt, gzipSchematic,
} from '../src/minecraft-schematic.js';

function parseNbt(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = 0;
  const readU8 = () => u8[o++];
  const readI16 = () => { const v = view.getInt16(o); o += 2; return v; };
  const readU16 = () => { const v = view.getUint16(o); o += 2; return v; };
  const readI32 = () => { const v = view.getInt32(o); o += 4; return v; };
  const readStr = () => {
    const n = readU16();
    const s = new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(o, o + n));
    o += n;
    return s;
  };
  const readVarInt = () => {
    let r = 0;
    let s = 0;
    let b;
    do {
      b = u8[o++];
      r |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    return r >>> 0;
  };
  const readPayload = (type) => {
    if (type === 1) return readU8();
    if (type === 2) return readI16();
    if (type === 3) return readI32();
    if (type === 8) return readStr();
    if (type === 7) {
      const n = readI32();
      const a = u8.subarray(o, o + n);
      o += n;
      return a;
    }
    if (type === 11) {
      const n = readI32();
      const a = [];
      for (let i = 0; i < n; i += 1) a.push(readI32());
      return a;
    }
    if (type === 10) {
      const obj = {};
      const order = [];
      for (;;) {
        const t = readU8();
        if (t === 0) break;
        const name = readStr();
        order.push(name);
        obj[name] = readPayload(t);
      }
      obj.__order = order;
      return obj;
    }
    throw new Error(`지원하지 않는 tag ${type}`);
  };
  const t = readU8();
  if (t !== 10) throw new Error('root compound');
  const name = readStr();
  const value = readPayload(10);
  return { name, value, end: o, length: u8.length };
}

function decodeVarints(bytes, count) {
  const out = [];
  let o = 0;
  while (out.length < count) {
    let r = 0;
    let s = 0;
    let b;
    do {
      b = bytes[o++];
      r |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    out.push(r >>> 0);
  }
  return { values: out, consumed: o };
}

const ZM = {
  face: 'ZM', kind: 'module', color: { r: 255, g: 255, b: 255 },
  corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
};

test('CONCRETE_COLORS 16개와 동률·대표색', () => {
  assert.equal(CONCRETE_COLORS.length, 16);
  assert.equal(nearestConcrete({ r: 255, g: 255, b: 255 }), 'minecraft:white_concrete');
  assert.equal(nearestConcrete({ r: 0, g: 0, b: 0 }), 'minecraft:black_concrete');
  assert.equal(nearestConcrete({ r: 54, g: 57, b: 61 }), 'minecraft:gray_concrete');
  const a = CONCRETE_COLORS[0];
  const b = CONCRETE_COLORS[1];
  const mid = { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2 };
  const pick = nearestConcrete(mid);
  assert.match(pick, /^minecraft:[a-z_]+_concrete$/);
  const first = nearestConcrete(a);
  const again = nearestConcrete(a);
  assert.equal(first, again);
});

test('voxelizeCube 가드', () => {
  assert.throws(() => voxelizeCube({ n: 0, quads: [] }), RangeError);
  assert.throws(() => voxelizeCube({ n: 65, quads: [] }), RangeError);
  assert.throws(() => voxelizeCube({ n: 1, quads: [] }, { scale: 9 }), RangeError);
  assert.throws(() => voxelizeCube({ n: 64, quads: [] }, { scale: 8 }), RangeError);
  assert.throws(() => voxelizeCube({
    n: 1,
    quads: [{ face: 'ZM', kind: 'module', color: { r: 1, g: 1, b: 1 }, corners: [[0, 0, 0.5], [1, 0, 0], [1, 1, 0], [0, 1, 0]] }],
  }), RangeError);
});

test('정사각 facet·위가 ZM·모서리는 회색·내부 air', () => {
  const voxels = voxelizeCube({ n: 1, quads: [ZM] });
  assert.equal(voxels.width, 3);
  assert.equal(voxels.height, 3);
  assert.equal(voxels.length, 3);
  assert.equal(voxels.palette[0], 'minecraft:air');
  assert.ok(voxels.palette.includes('minecraft:gray_concrete'));
  assert.ok(voxels.palette.includes('minecraft:white_concrete'));
  const air = 0;
  const gray = voxels.palette.indexOf('minecraft:gray_concrete');
  const white = voxels.palette.indexOf('minecraft:white_concrete');
  const at = (x, y, z) => voxels.blocks[x + z * 3 + y * 9];
  assert.equal(at(1, 2, 1), white);
  assert.equal(at(0, 2, 0), gray);
  assert.equal(at(1, 2, 0), gray);
  assert.equal(at(1, 1, 1), air);
  const rim = [];
  for (let x = 0; x < 3; x += 1) {
    for (let z = 0; z < 3; z += 1) {
      if (x === 1 && z === 1) continue;
      rim.push(at(x, 2, z));
    }
  }
  assert.ok(rim.every((v) => v === gray));
});

test('overlay 가 module 위를 덮고 가장자리는 코드로 덮지 않아요', () => {
  const voxels = voxelizeCube({
    n: 2,
    quads: [
      {
        face: 'ZM', kind: 'module', color: { r: 255, g: 255, b: 255 },
        corners: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]],
      },
      {
        face: 'ZM', kind: 'overlay', color: { r: 142, g: 32, b: 33 },
        corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      },
    ],
  });
  const S = 4;
  const at = (x, y, z) => voxels.blocks[x + z * S + y * S * S];
  const gray = voxels.palette.indexOf('minecraft:gray_concrete');
  const red = voxels.palette.indexOf('minecraft:red_concrete');
  const white = voxels.palette.indexOf('minecraft:white_concrete');
  assert.equal(at(0, S - 1, 0), gray);
  assert.equal(at(1, S - 1, 1), red);
  assert.equal(at(S - 2, S - 1, S - 2), white);
});

test('Sponge v3 NBT 필드·UTF8·varint·순서', () => {
  const voxels = voxelizeCube({ n: 1, quads: [ZM] });
  const raw = encodeSchematicNbt(voxels, { dataVersion: 3700, name: 'TLcube' });
  assert.notEqual(raw[0], 0x1f);
  assert.equal(raw[0], 10);
  assert.equal(raw[1], 0);
  assert.equal(raw[2], 0);
  const parsed = parseNbt(raw);
  assert.equal(parsed.name, '');
  assert.equal(parsed.end, parsed.length);
  const sch = parsed.value.Schematic;
  assert.deepEqual(sch.__order.slice(0, 5), ['Version', 'DataVersion', 'Width', 'Height', 'Length']);
  assert.equal(sch.Version, 3);
  assert.equal(sch.DataVersion, 3700);
  assert.equal(sch.Width, 3);
  assert.equal(sch.Height, 3);
  assert.equal(sch.Length, 3);
  assert.deepEqual(sch.Offset, [0, 0, 0]);
  assert.equal(sch.Metadata.Name, 'TLcube');
  assert.equal(sch.Blocks.Palette['minecraft:air'], 0);
  const count = 27;
  const decoded = decodeVarints(sch.Blocks.Data, count);
  assert.equal(decoded.values.length, count);
  assert.equal(decoded.consumed, sch.Blocks.Data.length);
  assert.deepEqual(decoded.values, [...voxels.blocks]);
  assert.throws(() => encodeSchematicNbt(voxels, { dataVersion: 0 }), RangeError);
});

test('gzipSchematic 은 gunzip 하면 raw NBT 와 같아요', async () => {
  const voxels = voxelizeCube({ n: 1, quads: [ZM] });
  const raw = encodeSchematicNbt(voxels);
  const gz = await gzipSchematic(voxels);
  assert.equal(gz[0], 0x1f);
  assert.equal(gz[1], 0x8b);
  const unzipped = Uint8Array.from(zlib.gunzipSync(gz));
  assert.deepEqual(unzipped, raw);
});
