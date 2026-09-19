import assert from 'node:assert/strict';
import test from 'node:test';
import { symbolCountForByteLength } from '../src/base211.js';
import { H_BINARY } from '../src/h-profile.js';
import { X_PROFILES, X_PROFILE_IDS, xProfile, assertXProfile, xProfileLayout, xLevelsTemplate, xProfileDto } from '../src/x-profile.js';
import { xCapacity, xNsymFor, encodeX, decodeX, xDigitFromLevels, X_ERASED } from '../src/x-codec.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('x-profile — 유한 registry 와 거절', () => {
  assert.deepEqual([...X_PROFILE_IDS], ['X0', 'X0g', 'X1']);
  assert.equal(xProfile('X0').layoutId, 'lee-fo-v1');
  assert.equal(xProfile('X0g').layoutId, 'x8-gpt-v1');
  assert.throws(() => xProfile('X9'), RangeError);
  assert.throws(() => assertXProfile({ ...X_PROFILES.X0, N: 9 }), RangeError);
  assert.throws(() => assertXProfile({ ...X_PROFILES.X0, ecc: 'Z' }), RangeError);
  const l0 = xProfileLayout('X0'), lg = xProfileLayout('X0g'), l1 = xProfileLayout('X1');
  assert.equal(l0.digits, 140); assert.equal(lg.digits, 134); assert.equal(l1.digits, 271);
  assert.equal(l0.reservations.length, 0);
  const levels = xLevelsTemplate(l0);
  assert.equal(levels.length, 512);
  assert.equal([...levels].filter(v => v === 1).length, 74); // 중심만 on
});

test('x-profile — 상속 키·비문자열·필드 누락은 미지로 거절(codex 2233)', () => {
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 0, null, undefined, {}]) {
    assert.throws(() => xProfile(bad), RangeError, `xProfile(${String(bad)})`);
    assert.throws(() => assertXProfile({ profileId: bad, ecc: 'M' }), RangeError, `assertXProfile(${String(bad)})`);
  }
  // 필드가 빠진 객체(undefined === undefined 로 통과하던 회귀)
  assert.throws(() => assertXProfile({ profileId: 'X0', ecc: 'M' }), /strict/);
  const { layoutId, ...missingLayout } = { ...X_PROFILES.X0 };
  assert.throws(() => assertXProfile(missingLayout), /layoutId/);
  assert.throws(() => assertXProfile({ ...X_PROFILES.X0, schemaVersion: 'TLcube:X:profile:v9' }), /schemaVersion/);
  // 정상: registry 원본 + 입력 ecc
  assert.deepEqual(assertXProfile({ ...X_PROFILES.X0, ecc: 'H' }), { ...X_PROFILES.X0, ecc: 'H' });
  assert.equal(typeof xProfile('X0').label, 'string');
});

test('x-profile — blind DTO 는 다섯 키 allowlist 만', () => {
  assert.deepEqual(xProfileDto('X0g'), { profileId: 'X0g', layoutId: 'x8-gpt-v1', N: 8, c: 0, tones: 2 });
  assert.deepEqual(Object.keys(xProfileDto({ ...X_PROFILES.X1, ecc: 'L' })), ['profileId', 'layoutId', 'N', 'c', 'tones']);
  assert.throws(() => xProfileDto('__proto__'), RangeError);
});

test('x-profile — 구조 지문은 ECC 무관, 프로파일 지문은 ECC 별로 달라요', () => {
  const m = xProfileLayout({ ...X_PROFILES.X0, ecc: 'M' });
  const h = xProfileLayout({ ...X_PROFILES.X0, ecc: 'H' });
  assert.equal(m.structureCanonical, h.structureCanonical);
  assert.equal(m.rawCanonical, h.rawCanonical);
  assert.notEqual(m.profileCanonical, h.profileCanonical);
  assert.ok(m.profileCanonical.includes('"ecc":"M"') && m.profileCanonical.includes('"toneCodebookId":"tl-binary"'));
  // 문자열 경로 = registry 기본 ecc(M)
  assert.equal(xProfileLayout('X0').profileCanonical, m.profileCanonical);
  // 다른 레이아웃은 구조부터 달라요
  assert.notEqual(xProfileLayout('X0').structureCanonical, xProfileLayout('X0g').structureCanonical);
});

test('xNsymFor — H 절차(M 홀수화)', () => {
  assert.equal(xNsymFor(46, 'M') % 2, 1);
  assert.equal(xNsymFor(44, 'L'), 5);
  assert.equal(xNsymFor(44, 'H'), 18);
  assert.throws(() => xNsymFor(1, 'M'), RangeError);
});

test('xCapacity — 실호출 회계 불변식(3 프로파일 × 3 ECC)', () => {
  for (const id of X_PROFILE_IDS) {
    for (const ecc of ['L', 'M', 'H']) {
      const cap = xCapacity(id, { ecc });
      assert.equal(cap.symbols, Math.floor(cap.digits / 3));
      assert.equal(cap.fillerDigits, cap.digits - cap.symbols * 3);
      assert.equal(cap.dataSymbols, cap.symbols - cap.nsym);
      assert.ok(symbolCountForByteLength(cap.dataBytes) <= cap.dataSymbols);
      assert.ok(symbolCountForByteLength(cap.dataBytes + 1) > cap.dataSymbols);
      assert.equal(cap.payloadBytes, cap.dataBytes - 1);
      assert.ok(cap.payloadBytes > 0);
    }
  }
  const x0 = xCapacity('X0'), x1 = xCapacity('X1');
  assert.equal(x0.digits, 140); assert.equal(x0.symbols, 46); assert.equal(x0.fillerDigits, 2);
  assert.equal(x1.digits, 271); assert.equal(x1.symbols, 90); assert.equal(x1.fillerDigits, 1);
  assert.ok(x1.payloadBytes > x0.payloadBytes);
});

test('xDigitFromLevels — H_BINARY 6패턴, 000/111/미관측 소거', () => {
  H_BINARY.forEach((p, d) => assert.equal(xDigitFromLevels(p), d));
  assert.equal(xDigitFromLevels([0, 0, 0]), X_ERASED);
  assert.equal(xDigitFromLevels([1, 1, 1]), X_ERASED);
  assert.equal(xDigitFromLevels([1, null, 0]), X_ERASED);
});

test('encodeX/decodeX — 완전 관측 왕복(레벨 경로·digit 경로, 3 프로파일)', () => {
  for (const id of X_PROFILE_IDS) {
    const cap = xCapacity(id);
    const text = 'https://tl.estre.so/x?'.slice(0, cap.payloadBytes);
    const enc = encodeX(text, id);
    assert.equal(enc.levels.length, cap.layout.raw.N ** 3);
    assert.equal(enc.digits.length, cap.digits);
    // 중심은 항상 on, 데이터 트리플은 합법 6패턴
    for (const cell of cap.layout.raw.cells) assert.equal(enc.levels[cell.centre], 1);
    cap.layout.triples.forEach((triple, i) => assert.equal(xDigitFromLevels(triple.map(s => enc.levels[s])), enc.digits[i]));
    const viaLevels = decodeX({ levels: enc.levels }, id);
    assert.ok(viaLevels.ok, viaLevels.reason);
    assert.equal(viaLevels.text, text);
    assert.equal(viaLevels.verified, false);
    const viaDigits = decodeX({ digits: enc.digits }, id);
    assert.ok(viaDigits.ok && viaDigits.text === text);
  }
});

test('decodeX — 소거 nsym 개까지 복원, nsym+1 은 거부, 오류 t 개 정정', () => {
  const id = 'X0';
  const cap = xCapacity(id);
  const text = 'X0-erasure';
  const enc = encodeX(text, id);
  const r = rng(20260919);
  // 소거 nsym 개(서로 다른 심볼 자리의 트리플 하나씩 미관측)
  const levels = Array.from(enc.levels);
  const picked = new Set();
  while (picked.size < cap.nsym) picked.add(Math.floor(r() * cap.symbols));
  for (const symbolIndex of picked) {
    const triple = cap.layout.triples[symbolIndex * 3];
    levels[triple[0]] = null;
  }
  const ok = decodeX({ levels }, id);
  assert.ok(ok.ok, ok.reason);
  assert.equal(ok.text, text);
  assert.equal(ok.erasures, cap.nsym);
  // nsym+1 소거 → 거부(조용한 오답 금지)
  const extra = [...Array(cap.symbols).keys()].find(i => !picked.has(i));
  levels[cap.layout.triples[extra * 3][1]] = null;
  const bad = decodeX({ levels }, id);
  assert.equal(bad.ok, false);
  // 오류 t = ⌊nsym/2⌋ 개(합법이지만 틀린 digit)
  const digits = Array.from(enc.digits);
  const t = Math.floor(cap.nsym / 2);
  const flipped = new Set();
  while (flipped.size < t) {
    const symbolIndex = Math.floor(r() * cap.symbols);
    if (flipped.has(symbolIndex)) continue;
    flipped.add(symbolIndex);
    const i = symbolIndex * 3;
    digits[i] = (digits[i] + 1 + Math.floor(r() * 5)) % 6;
  }
  const fixed = decodeX({ digits }, id);
  assert.ok(fixed.ok, fixed.reason);
  assert.equal(fixed.text, text);
  assert.equal(fixed.corrected, t);
});

test('encodeX — 프로파일·용량 거절', () => {
  assert.throws(() => encodeX('x', 'X9'), RangeError);
  const cap = xCapacity('X0');
  assert.throws(() => encodeX('a'.repeat(cap.payloadBytes + 1), 'X0'), RangeError);
  assert.throws(() => decodeX({ digits: new Array(10).fill(0) }, 'X0'), RangeError);
});
