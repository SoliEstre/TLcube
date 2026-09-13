import assert from 'node:assert/strict';
import test from 'node:test';
import { hCapacity, encodeH, decodeH, crc32c } from '../src/h-codec.js';
import { H_FACE_IDS, H_ECC, normalizeHProfile } from '../src/h-profile.js';
import { hLayout } from '../src/h-layout.js';

const M_CHUNK = Object.freeze([3, 21, 45, 78, 119, 165, 220, 286, 355]);

function profileOf(encoded) {
  return {
    version: encoded.version,
    mode: encoded.mode,
    tones: encoded.tones,
    ecc: encoded.ecc,
    mask: encoded.mask,
    routeId: encoded.routeId,
  };
}

function roundtrip(input, options) {
  const encoded = encodeH(input, options);
  const decoded = decodeH(encoded.faces, profileOf(encoded));
  assert.equal(decoded.ok, true);
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  assert.deepEqual(decoded.bytes, bytes);
  return { encoded, decoded };
}

test('CRC32C Castagnoli KAT', () => {
  assert.equal(crc32c(new Uint8Array()), 0);
  const vec = new TextEncoder().encode('123456789');
  assert.equal(crc32c(vec), 0xe3069283);
});

test('모든 프로파일 capacity 864회와 M 3면 fixture', () => {
  let n = 0;
  for (let version = 0; version <= 8; version += 1) {
    for (const mode of [3, 6]) {
      for (const tones of [2, 3]) {
        for (const ecc of H_ECC) {
          let first = null;
          for (let mask = 0; mask <= 7; mask += 1) {
            const cap = hCapacity(version, mode, { tones, ecc, mask });
            n += 1;
            assert.equal(cap.version, version);
            assert.equal(cap.n, 13 + 4 * version);
            assert.equal(cap.mode, mode);
            assert.equal(cap.tones, tones);
            assert.equal(cap.ecc, ecc);
            assert.equal(cap.eccLevel, ecc);
            assert.equal(cap.mask, mask);
            assert.equal(cap.cellCount, hLayout(version).scan.length);
            assert.equal(cap.symbolCount * 3, cap.cellCount);
            assert.ok(cap.chunkBytes > 0);
            assert.equal(cap.dataBytes, cap.chunkBytes + 6);
            assert.equal(cap.maxPayloadBytes, cap.chunkBytes * (mode / 3));
            const dataSymbols = cap.blocks.reduce((s, b) => s + b.dataSymbols, 0);
            assert.equal(dataSymbols, cap.dataSymbols);
            if (first) {
              assert.equal(cap.chunkBytes, first.chunkBytes);
              assert.equal(cap.dataSymbols, first.dataSymbols);
            } else first = cap;
          }
        }
      }
    }
  }
  assert.equal(n, 9 * 2 * 2 * 3 * 8);
  for (let version = 0; version <= 8; version += 1) {
    const cap = hCapacity(version, 3, { tones: 3, ecc: 'M', mask: 0 });
    assert.equal(cap.chunkBytes, M_CHUNK[version]);
    assert.equal(cap.maxPayloadBytes, M_CHUNK[version]);
  }
});

test('H0 최대 용량이 양수이고 empty/text/binary 왕복', () => {
  const cap = hCapacity(0, 3, { tones: 3, ecc: 'M', mask: 0 });
  assert.ok(cap.maxPayloadBytes > 0);
  roundtrip(new Uint8Array(), { version: 0, mode: 3, mask: 0 });
  roundtrip('hi', { version: 0, mode: 3, mask: 0 });
  const bin = Uint8Array.from({ length: cap.maxPayloadBytes }, (_, i) => 255-i);
  const { decoded } = roundtrip(bin, { version: 0, mode: 3, mask: 0 });
  assert.equal(decoded.text, null);
});

test('대표 mask 0/7 왕복 — 전 version×mode×tones×ecc', () => {
  for (let version = 0; version <= 8; version += 1) {
    for (const mode of [3, 6]) {
      for (const tones of [2, 3]) {
        for (const ecc of H_ECC) {
          for (const mask of [0, 7]) {
            const cap = hCapacity(version, mode, { tones, ecc, mask });
            const payload = Uint8Array.from(
              { length: cap.maxPayloadBytes },
              (_, i) => (i * 71 + 19) & 255,
            );
            roundtrip(payload, { version, mode, tones, ecc, mask });
          }
        }
      }
    }
  }
});

test('용량 초과와 알 수 없는 option, 잘못된 프로파일', () => {
  const cap = hCapacity(0, 3, { tones: 3, ecc: 'M', mask: 0 });
  assert.throws(
    () => encodeH(new Uint8Array(cap.maxPayloadBytes + 1), { version: 0, mode: 3, mask: 0 }),
    (err) => err instanceof RangeError && String(err.message).includes('용량 초과'),
  );
  assert.throws(() => encodeH('a', { foo: 1 }), RangeError);
  assert.throws(() => encodeH('a', { ecc: 'M', eccLevel: 'H' }), RangeError);
  assert.throws(() => hCapacity(0, 3, { tones: 4 }), RangeError);
  assert.throws(() => hCapacity(0, 3, { ecc: 'Q' }), RangeError);
  assert.throws(() => encodeH('a', { mask: 8 }), RangeError);
});

test('auto version과 auto mask가 결정적', () => {
  const a = encodeH('auto-mask', { version: 'auto', mask: 'auto' });
  const b = encodeH('auto-mask', { version: 'auto', mask: 'auto' });
  assert.equal(a.version, 1);
  assert.equal(a.mask, b.mask);
  assert.equal(a.routeId, b.routeId);
  assert.deepEqual(a.faces.ZM, b.faces.ZM);
  const huge = encodeH(new Uint8Array(M_CHUNK[2]), { version: 'auto', mode: 3, mask: 0 });
  assert.ok(huge.version >= 2);
});

test('출력 변이 분리', () => {
  const encoded = encodeH('mut', { version: 0, mask: 0 });
  encoded.faces.ZM[0] ^= 1;
  encoded.triadDigits[0][0] = (encoded.triadDigits[0][0] + 1) % 6;
  const again = encodeH('mut', { version: 0, mask: 0 });
  const decoded = decodeH(again.faces, profileOf(again));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.text, 'mut');
  const copy = decoded.bytes;
  copy[0] = 9;
  const decoded2 = decodeH(again.faces, profileOf(again));
  assert.equal(decoded2.bytes[0], new TextEncoder().encode('mut')[0]);
});

test('잘못된 tones/ecc/mask와 route8 불일치는 본문 없이 거절', () => {
  const encoded = encodeH('secret', { version: 1, tones: 3, ecc: 'M', mask: 0 });
  const wrongTone = decodeH(encoded.faces, { ...profileOf(encoded), tones: 2 });
  assert.equal(wrongTone.ok, false);
  assert.equal('bytes' in wrongTone, false);
  const wrongEcc = decodeH(encoded.faces, { ...profileOf(encoded), ecc: 'H' });
  assert.equal(wrongEcc.ok, false);
  const wrongMask = decodeH(encoded.faces, { ...profileOf(encoded), mask: 1 });
  assert.equal(wrongMask.ok, false);
  const wrongRoute = decodeH(encoded.faces, { ...profileOf(encoded), routeId: (encoded.routeId + 1) & 255 });
  assert.equal(wrongRoute.ok, false);
  assert.equal(wrongRoute.reason, 'face-format');
});

test('6F에서 3면·5면은 거절하고 본문을 노출하지 않아요', () => {
  const encoded = encodeH('six', { version: 0, mode: 6, mask: 0 });
  const three = { ZM: encoded.faces.ZM, XM: encoded.faces.XM, YM: encoded.faces.YM };
  const d3 = decodeH(three, profileOf(encoded));
  assert.equal(d3.ok, false);
  assert.equal('bytes' in d3, false);
  const five = { ...encoded.faces };
  delete five.YP;
  const d5 = decodeH(five, profileOf(encoded));
  assert.equal(d5.ok, false);
});

test('마커·포맷 변조는 validateHFace에서 거절', () => {
  const encoded = encodeH('tag', { version: 0, mask: 0 });
  const layout = hLayout(0);
  const tampered = Uint8Array.from(encoded.faces.ZM);
  const reserved = [...layout.roles.values()].find((c) => c.role === 'tag' || c.role === 'format');
  tampered[reserved.i * encoded.n + reserved.j] ^= 7;
  const faces = { ...encoded.faces, ZM: tampered };
  const decoded = decodeH(faces, profileOf(encoded));
  assert.equal(decoded.ok, false);
});

test('3tone 중복 rank와 2tone 000/111은 심볼 소거로 처리', () => {
  const t3 = encodeH('abc', { version: 2, tones: 3, mask: 0 });
  const layout = hLayout(2);
  const cell = layout.scan[0];
  const dup = Uint8Array.from(t3.faces.ZM);
  const at = cell.i * t3.n + cell.j;
  dup[at] = t3.faces.XM[at];
  const d3 = decodeH({ ...t3.faces, ZM: dup }, profileOf(t3));
  assert.equal(d3.ok, true);assert.equal(d3.text,'abc');assert.ok(d3.corrected>=1);

  const t2 = encodeH('xy', { version: 2, tones: 2, mask: 0 });
  const c2 = layout.scan[3];
  const zero = {
    ZM: Uint8Array.from(t2.faces.ZM),
    XM: Uint8Array.from(t2.faces.XM),
    YM: Uint8Array.from(t2.faces.YM),
  };
  const p = c2.i * t2.n + c2.j;
  zero.ZM[p] = 0;
  zero.XM[p] = 0;
  zero.YM[p] = 0;
  const dZero = decodeH(zero, profileOf(t2));
  assert.equal(dZero.ok, true);assert.equal(dZero.text,'xy');
  const one = {
    ZM: Uint8Array.from(t2.faces.ZM),
    XM: Uint8Array.from(t2.faces.XM),
    YM: Uint8Array.from(t2.faces.YM),
  };
  one.ZM[p] = 1;
  one.XM[p] = 1;
  one.YM[p] = 1;
  const dOne = decodeH(one, profileOf(t2));
  assert.equal(dOne.ok, true);assert.equal(dOne.text,'xy');
});

test('eccLevel 별칭과 normalize 프로파일', () => {
  const a = encodeH('api', { version: 0, eccLevel: 'M', mask: 0 });
  assert.equal(a.ecc, 'M');
  assert.equal(a.eccLevel, 'M');
  const p = normalizeHProfile({ version: 0, mode: 3, tones: 3, ecc: 'M', mask: 0 });
  assert.equal(p.n, 13);
});
