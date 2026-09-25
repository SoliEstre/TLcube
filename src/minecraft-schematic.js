/** Minecraft Java 1.20.4 Sponge Schematic v3 출력. 완성 월드/지도 파일이 아니에요. */
import {cubeImageVoxelQuads} from './cube-image-export.js';

/** sRGB 대표값은 근사치예요. 블록 id만 계약이고 텍스처 픽셀과 비트 동일하지 않아요. */
export const CONCRETE_COLORS = Object.freeze([
  Object.freeze({ name: 'white', r: 207, g: 213, b: 214 }),
  Object.freeze({ name: 'orange', r: 224, g: 97, b: 1 }),
  Object.freeze({ name: 'magenta', r: 169, g: 48, b: 159 }),
  Object.freeze({ name: 'light_blue', r: 36, g: 137, b: 199 }),
  Object.freeze({ name: 'yellow', r: 241, g: 175, b: 21 }),
  Object.freeze({ name: 'lime', r: 94, g: 169, b: 24 }),
  Object.freeze({ name: 'pink', r: 214, g: 101, b: 143 }),
  Object.freeze({ name: 'gray', r: 54, g: 57, b: 61 }),
  Object.freeze({ name: 'light_gray', r: 125, g: 125, b: 115 }),
  Object.freeze({ name: 'cyan', r: 21, g: 119, b: 136 }),
  Object.freeze({ name: 'purple', r: 100, g: 32, b: 156 }),
  Object.freeze({ name: 'blue', r: 45, g: 47, b: 143 }),
  Object.freeze({ name: 'brown', r: 96, g: 60, b: 32 }),
  Object.freeze({ name: 'green', r: 73, g: 91, b: 36 }),
  Object.freeze({ name: 'red', r: 142, g: 32, b: 33 }),
  Object.freeze({ name: 'black', r: 8, g: 10, b: 15 }),
]);

const FACES = Object.freeze({
  ZM: Object.freeze({ axis: 2, at: 0, u: 0, v: 1 }),
  ZP: Object.freeze({ axis: 2, at: 1, u: 0, v: 1 }),
  XM: Object.freeze({ axis: 0, at: 0, u: 1, v: 2 }),
  XP: Object.freeze({ axis: 0, at: 1, u: 1, v: 2 }),
  YM: Object.freeze({ axis: 1, at: 0, u: 0, v: 2 }),
  YP: Object.freeze({ axis: 1, at: 1, u: 0, v: 2 }),
});

function srgbChannelToLinear(v8) {
  const c = v8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearOf(color) {
  return [
    srgbChannelToLinear(color.r),
    srgbChannelToLinear(color.g),
    srgbChannelToLinear(color.b),
  ];
}

const LINEAR_CONCRETE = CONCRETE_COLORS.map((row) => linearOf(row));

/** 선형 RGB에 BT.709 가중 제곱거리. 동률은 CONCRETE_COLORS 앞선 항목. */
export function nearestConcrete(color) {
  if (!color || ![color.r, color.g, color.b].every((v) => Number.isFinite(v))) {
    throw new TypeError('color 는 {r,g,b} 여야 해요');
  }
  const r = Math.min(255, Math.max(0, color.r));
  const g = Math.min(255, Math.max(0, color.g));
  const b = Math.min(255, Math.max(0, color.b));
  const lin = linearOf({ r, g, b });
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < LINEAR_CONCRETE.length; i += 1) {
    const c = LINEAR_CONCRETE[i];
    const dr = lin[0] - c[0];
    const dg = lin[1] - c[1];
    const db = lin[2] - c[2];
    const d = 0.2126 * dr * dr + 0.7152 * dg * dg + 0.0722 * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return `minecraft:${CONCRETE_COLORS[best].name}_concrete`;
}

function pointOf(p) {
  if (Array.isArray(p) && p.length >= 3 && p.every((v) => Number.isFinite(v))) {
    return { x: p[0], y: p[1], z: p[2] };
  }
  throw new TypeError('corners 는 [x,y,z] 4개여야 해요');
}

function xyz(p) {
  return [p.x, p.y, p.z];
}

function assertAxisQuad(face, n, corners) {
  const spec = FACES[face];
  if (!spec) throw new RangeError(`알 수 없는 face: ${face}`);
  const pts = corners.map(pointOf);
  if (pts.length !== 4) throw new RangeError('quad 는 꼭짓점 4개여야 해요');
  const plane = spec.at === 0 ? 0 : n;
  const eps = 1e-9;
  for (const p of pts) {
    const v = xyz(p);
    if (v.some((c) => c < -eps || c > n + eps)) throw new RangeError('quad 가 [0,n]^3 밖이에요');
    if (Math.abs(v[spec.axis] - plane) > eps) throw new RangeError('축정렬 면 quad 만 허용해요');
  }
  const us = pts.map((p) => xyz(p)[spec.u]);
  const vs = pts.map((p) => xyz(p)[spec.v]);
  const u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs);
  if(u1-u0<=eps||v1-v0<=eps||new Set(us.map((u,i)=>`${u},${vs[i]}`)).size!==4
    ||us.some(u=>Math.abs(u-u0)>eps&&Math.abs(u-u1)>eps)
    ||vs.some(v=>Math.abs(v-v0)>eps&&Math.abs(v-v1)>eps))throw new RangeError('직사각형 quad만 허용해요');
  return {
    spec,
    plane,
    u0: Math.min(...us),
    u1: Math.max(...us),
    v0: Math.min(...vs),
    v1: Math.max(...vs),
  };
}

function mcIndex(mx, my, mz, S) {
  const x = mx;
  const y = (S - 1) - mz;
  const z = my;
  return x + z * S + y * S * S;
}

/**
 * 모델 공간에서 면을 칠한 뒤 [x,y,z]→[x,S-1-z,y] 로 MC(Y-up)에 올려요. 이 사상은 회전(det=+1)이라 거울을 더하지 않아요.
 * 다만 모델 좌표 자체가 오른손 공간에서는 정본 면 시트의 거울상이라(src/cube-physical.js), MC 안에서 바깥에서 보면
 * 코드 면·면 이미지·면 QR 이 모두 좌우 거울로 보여요(test/h-face-qr.test.js 가 «기존 거울» 로 잠가요).
 * @param {{n:number,quads:object[]}} model
 */
export function voxelizeCube(model, { scale = 1 } = {}) {
  if (!model || typeof model !== 'object') throw new TypeError('model 이 필요해요');
  const n = model.n;
  if (!Number.isInteger(n) || n < 1 || n > 64) throw new RangeError('n 은 1..64 정수여야 해요');
  if (!Number.isInteger(scale) || scale < 1 || scale > 8) throw new RangeError('scale 은 1..8 정수여야 해요');
  const S = n * scale + 2;
  const volume = S * S * S;
  if (volume > 10_000_000) throw new RangeError('총 블록 수가 10,000,000 을 넘어요');
  if (!Array.isArray(model.quads)) throw new TypeError('quads 배열이 필요해요');
  const gray = nearestConcrete({ r: 54, g: 57, b: 61 });
  const palette = ['minecraft:air', gray];
  const indexOf = new Map([['minecraft:air', 0], [gray, 1]]);
  function pal(id) {
    let i = indexOf.get(id);
    if (i !== undefined) return i;
    if (palette.length > 255) throw new RangeError('palette 가 255 를 넘어요');
    i = palette.length;
    palette.push(id);
    indexOf.set(id, i);
    return i;
  }
  const blocks = new Uint8Array(volume);
  const ns = n * scale;
  const GRAY = pal(gray);
  for (const face of Object.keys(FACES)) {
    const spec = FACES[face];
    const nrm = spec.at === 0 ? 0 : S - 1;
    for (let a = 0; a < S; a += 1) {
      for (let b = 0; b < S; b += 1) {
        const v = [0, 0, 0];
        v[spec.axis] = nrm;
        v[spec.u] = a;
        v[spec.v] = b;
        if (a === 0 || b === 0 || a === S - 1 || b === S - 1) {
          blocks[mcIndex(v[0], v[1], v[2], S)] = GRAY;
        }
      }
    }
  }
  const base = [];
  const overlay = [];
  for (const quad of model.quads) {
    if (!quad || (quad.kind !== 'module' && quad.kind !== 'back' && quad.kind !== 'overlay')) {
      throw new RangeError('kind 는 module|back|overlay 여야 해요');
    }
    (quad.kind === 'overlay' ? overlay : base).push(quad);
  }
  function paint(quad) {
    const box = assertAxisQuad(quad.face, n, quad.corners);
    const id = pal(nearestConcrete(quad.color));
    const nrm = box.spec.at === 0 ? 0 : S - 1;
    const uStart=Math.max(1,Math.ceil(box.u0*scale+.5)),uEnd=Math.min(ns,Math.ceil(box.u1*scale+.5)-1);
    const vStart=Math.max(1,Math.ceil(box.v0*scale+.5)),vEnd=Math.min(ns,Math.ceil(box.v1*scale+.5)-1);
    for (let iu = uStart; iu <= uEnd; iu += 1) {
      for (let iv = vStart; iv <= vEnd; iv += 1) {
        const u = (iu - 0.5) / scale;
        const v = (iv - 0.5) / scale;
        if (u < box.u0 || u > box.u1 || v < box.v0 || v > box.v1) continue;
        const p = [0, 0, 0];
        p[box.spec.axis] = nrm;
        p[box.spec.u] = iu;
        p[box.spec.v] = iv;
        blocks[mcIndex(p[0], p[1], p[2], S)] = id;
      }
    }
  }
  for (const quad of base) paint(quad);
  for (const quad of overlay) paint(quad);
  for (const quad of cubeImageVoxelQuads(model,scale)) paint(quad);
  return {
    width: S,
    height: S,
    length: S,
    palette: palette.slice(),
    blocks,
    scale,
  };
}

function utf8(str) {
  const bytes = new TextEncoder().encode(str);
  if (bytes.length > 65535) throw new RangeError('UTF-8 문자열이 65535 바이트를 넘어요');
  return bytes;
}

function pushU16(out, n) {
  out.push((n >>> 8) & 255, n & 255);
}

function pushU32(out, n) {
  out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

function pushI16(out, n) {
  if (n < -32768 || n > 32767) throw new RangeError('NBT short 범위');
  pushU16(out, n & 65535);
}

function pushI32(out, n) {
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) throw new RangeError('NBT int 범위');
  pushU32(out, n >>> 0);
}

function pushName(out, name) {
  const b = utf8(name);
  pushU16(out, b.length);
  for (let i = 0; i < b.length; i += 1) out.push(b[i]);
}

function pushVarInt(out, n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xfffffff) throw new RangeError('varint 범위');
  do {
    let b = n & 127;
    n >>>= 7;
    if (n) b |= 128;
    out.push(b);
  } while (n);
}

/**
 * Sponge Schematic v3 raw NBT. gzip 이 아니에요.
 * @param {{width:number,height:number,length:number,palette:string[],blocks:Uint8Array}} voxels
 */
export function encodeSchematicNbt(voxels, { dataVersion = 3700, name = 'TLcube' } = {}) {
  if (!voxels || !Number.isInteger(voxels.width) || !Number.isInteger(voxels.height) || !Number.isInteger(voxels.length)) {
    throw new TypeError('voxels 크기 필드가 필요해요');
  }
  const { width, height, length, palette, blocks } = voxels;
  if (width < 1 || height < 1 || length < 1 || width > 32767 || height > 32767 || length > 32767) {
    throw new RangeError('Width/Height/Length 가 unsigned short 범위를 넘어요');
  }
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > 256) {
    throw new RangeError('palette 가 비었거나 256 을 넘어요');
  }
  if (palette[0] !== 'minecraft:air') throw new RangeError('palette[0] 은 minecraft:air 여야 해요');
  const count = width * height * length;
  if(count>10_000_000)throw new RangeError('총 블록 수가 10,000,000 을 넘어요');
  if(new Set(palette).size!==palette.length)throw new RangeError('palette 중복');
  if (!(blocks instanceof Uint8Array) || blocks.length !== count) {
    throw new RangeError('blocks 길이가 width*height*length 와 달라요');
  }
  for (let i = 0; i < count; i += 1) {
    if (blocks[i] >= palette.length) throw new RangeError('블록 인덱스가 palette 밖이에요');
  }
  if (!Number.isInteger(dataVersion) || dataVersion <= 0) {
    throw new RangeError('DataVersion 은 양의 정수여야 해요');
  }
  if (typeof name !== 'string') throw new TypeError('Name 은 문자열이어야 해요');
  const packed = [];
  for (let i = 0; i < count; i += 1) pushVarInt(packed, blocks[i]);
  if (packed.length > 2147483647) throw new RangeError('NBT byte array 가 너무 커요');
  const out = [];
  out.push(10);
  pushName(out, '');
  out.push(10);
  pushName(out, 'Schematic');
  out.push(3);
  pushName(out, 'Version');
  pushI32(out, 3);
  out.push(3);
  pushName(out, 'DataVersion');
  pushI32(out, dataVersion);
  out.push(2);
  pushName(out, 'Width');
  pushI16(out, width);
  out.push(2);
  pushName(out, 'Height');
  pushI16(out, height);
  out.push(2);
  pushName(out, 'Length');
  pushI16(out, length);
  out.push(11);
  pushName(out, 'Offset');
  pushI32(out, 3);
  pushI32(out, 0);
  pushI32(out, 0);
  pushI32(out, 0);
  out.push(10);
  pushName(out, 'Metadata');
  out.push(8);
  pushName(out, 'Name');
  const nameBytes = utf8(name);
  pushU16(out, nameBytes.length);
  for (let i = 0; i < nameBytes.length; i += 1) out.push(nameBytes[i]);
  out.push(0);
  out.push(10);
  pushName(out, 'Blocks');
  out.push(10);
  pushName(out, 'Palette');
  for (let i = 0; i < palette.length; i += 1) {
    if (typeof palette[i] !== 'string') throw new TypeError('palette 항목은 문자열');
    out.push(3);
    pushName(out, palette[i]);
    pushI32(out, i);
  }
  out.push(0);
  out.push(7);
  pushName(out, 'Data');
  pushI32(out, packed.length);
  for (let i = 0; i < packed.length; i += 1) out.push(packed[i]);
  out.push(0);
  out.push(0);
  out.push(0);
  return Uint8Array.from(out);
}

/** gzip 압축 schematic. 미지원 런타임에서는 명시적으로 실패해요. raw NBT 를 .schem 으로 위장하지 않아요. */
export async function gzipSchematic(voxels, options) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('CompressionStream gzip is not supported in this runtime');
  }
  const raw = encodeSchematicNbt(voxels, options);
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const writing = writer.write(raw).then(() => writer.close());
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writing;
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}
