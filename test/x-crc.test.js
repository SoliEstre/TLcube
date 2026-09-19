import assert from 'node:assert/strict';
import test from 'node:test';
import { X_CRC_ID, X_CRC_BYTES, xCrcDomain, xCrcDomainBytes, xCrcMaxPayload, frameX, unframeX } from '../src/x-crc.js';
import { xCapacity, encodeX, decodeX, xCodecSchema } from '../src/x-codec.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from '../src/base211.js';
import { rsEncode } from '../src/rs211.js';
import { crc32c } from '../src/h-codec.js';

const hex = u8 => Buffer.from(u8).toString('hex');
const CRC = { crc: X_CRC_ID };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('도메인 문자열 — 필드 순서·구분자·실제 scanOrderId·rev, 누락/구분자 포함 거절', () => {
  const cap = xCapacity('X0', CRC);
  assert.equal(Buffer.from(cap.crcDomain).toString('utf8'), 'TLcube:X:crc:v0|X0|lee-fo-v1|N8c0|cell-order-v0|tl-binary|identity-v0|M|rev0|');
  const mor = xCapacity('X0', { ...CRC, scanOrderId: 'morton-v0' });
  assert.ok(Buffer.from(mor.crcDomain).toString('utf8').includes('|morton-v0|'));
  assert.notDeepEqual(Array.from(mor.crcDomain), Array.from(cap.crcDomain));
  assert.throws(() => xCrcDomain({ profileId: 'X0', layoutId: 'lee-fo-v1', N: 8, c: 0, scanOrderId: 'a|b', toneCodebookId: 'tl-binary', maskId: 'identity-v0', ecc: 'M' }), /'\|' 금지/);
  assert.throws(() => xCrcDomain({ profileId: 'X0', layoutId: 'lee-fo-v1', N: 8, c: 0, toneCodebookId: 'tl-binary', maskId: 'identity-v0', ecc: 'M' }), /scanOrderId/);
});

test('용량 — CRC 옵션은 payload 를 4 B 줄여요(X0 30→26 · X0g 30→26 · X1 63→59), 미지 crc 값 거절', () => {
  for (const [id, plain, withCrc] of [['X0', 30, 26], ['X0g', 30, 26], ['X1', 63, 59]]) {
    assert.equal(xCapacity(id).payloadBytes, plain, `${id} 현행`);
    assert.equal(xCapacity(id, CRC).payloadBytes, withCrc, `${id} CRC`);
    assert.equal(xCapacity(id, CRC).dataBytes, xCapacity(id).dataBytes, 'RS 데이터 바이트는 같아요');
  }
  assert.equal(xCapacity('X0').crc, null);
  assert.throws(() => xCapacity('X0', { crc: 'crc32' }), RangeError);
  assert.throws(() => xCapacity('X0', { crc: true }), RangeError);
  assert.equal(xCrcMaxPayload(4), 0); assert.equal(xCrcMaxPayload(31), 26); assert.equal(xCrcMaxPayload(300), 255);
});

test('프레임 배치 — u8 L ‖ payload ‖ CRC_LE4 ‖ zero pad, L ≤ B−5, 골든 3 종(domain hex + frame hex)', () => {
  const capX0 = xCapacity('X0', CRC), capM = xCapacity('X0', { ...CRC, scanOrderId: 'morton-v0' }), capX1 = xCapacity('X1', CRC);
  const f = frameX('x', capX0.dataBytes, capX0.crcDomain);
  assert.equal(f.length, 31); assert.equal(f[0], 1); assert.equal(f[1], 0x78);
  for (let i = 6; i < 31; i += 1) assert.equal(f[i], 0, '패딩 0');
  // 골든(계약 후보 — 값이 바뀌면 배치·도메인·CRC 파라미터 중 하나가 바뀐 것)
  const GOLDEN = {
    x0: { domain: hex(capX0.crcDomain), frame: hex(f) },
    x0m: { domain: hex(capM.crcDomain), frame: hex(frameX('x', capM.dataBytes, capM.crcDomain)) },
    x1: { domain: hex(capX1.crcDomain), frame: hex(frameX('x', capX1.dataBytes, capX1.crcDomain)) },
  };
  assert.equal(GOLDEN.x0.domain, '544c637562653a583a6372633a76307c58307c6c65652d666f2d76317c4e3863307c63656c6c2d6f726465722d76307c746c2d62696e6172797c6964656e746974792d76307c4d7c726576307c');
  assert.notEqual(GOLDEN.x0.frame, GOLDEN.x0m.frame, '같은 본문도 순서가 다르면 CRC 가 달라요');
  assert.notEqual(GOLDEN.x0.frame.slice(4, 12), GOLDEN.x1.frame.slice(4, 12));
  assert.equal(GOLDEN.x0.frame.slice(0, 12), GOLDEN_X0_FRAME_PREFIX, 'X0 골든(u8 1 · "x" · CRC LE 4)');
  assert.equal(GOLDEN.x0m.frame.slice(0, 12), GOLDEN_X0M_FRAME_PREFIX, 'X0 morton 골든');
  assert.equal(GOLDEN.x1.frame.slice(0, 12), GOLDEN_X1_FRAME_PREFIX, 'X1 골든');
  assert.throws(() => frameX('a'.repeat(27), 31, capX0.crcDomain), /용량 26/);
  assert.throws(() => frameX('x', 4, capX0.crcDomain), /5 이상/);
});
// 골든 값(hex 12 자리 = L 1 B + 'x' 1 B + CRC 4 B) — 첫 실행에서 계산해 고정(아래 값이 틀리면 테스트가 실제 값을 보여줘요)
const GOLDEN_X0_FRAME_PREFIX = '0178' + 'f1a63da8';
const GOLDEN_X0M_FRAME_PREFIX = '0178' + 'bfac112f';
const GOLDEN_X1_FRAME_PREFIX = '0178' + 'c5d4d9b6';

test('unframeX — 검증 순서(길이 → 패딩 → CRC → UTF-8), 각 경계 거절, domain 만 바꿔도 불일치', () => {
  const cap = xCapacity('X0', CRC);
  const good = frameX('héllo', cap.dataBytes, cap.crcDomain);
  const u = unframeX(good, cap.crcDomain);
  assert.equal(u.text, 'héllo'); assert.equal(u.payloadLength, 6); assert.equal(u.padding, 31 - 5 - 6);
  const other = xCrcDomainBytes({ profileId: 'X0g', layoutId: 'x8-gpt-v1', N: 8, c: 0, scanOrderId: 'cell-order-v0', toneCodebookId: 'tl-binary', maskId: 'identity-v0', ecc: 'M' });
  assert.throws(() => unframeX(good, other), e => e.stage === 'crc');
  const tooShort = new Uint8Array(4); assert.throws(() => unframeX(tooShort, cap.crcDomain), e => e.stage === 'length');
  const badL = Uint8Array.from(good); badL[0] = 27; assert.throws(() => unframeX(badL, cap.crcDomain), e => e.stage === 'length');
  const badPad = Uint8Array.from(good); badPad[30] = 1; assert.throws(() => unframeX(badPad, cap.crcDomain), e => e.stage === 'padding');
  const badCrc = Uint8Array.from(good); badCrc[1 + 6] ^= 0x01; assert.throws(() => unframeX(badCrc, cap.crcDomain), e => e.stage === 'crc');
  const badPayload = Uint8Array.from(good); badPayload[2] ^= 0x40; assert.throws(() => unframeX(badPayload, cap.crcDomain), e => e.stage === 'crc', '본문 변조는 CRC 단계에서');
  // UTF-8 단계: frameX 는 텍스트만 받으므로, 'crc' 앞 단계가 모두 통과하고 utf8 만 실패하는 프레임을 손으로 조립(유효한 CRC 를 직접 계산)
  const raw = new Uint8Array(cap.dataBytes); raw[0] = 2; raw[1] = 0xff; raw[2] = 0xfe;
  const head = raw.subarray(0, 3);
  const buf = new Uint8Array(cap.crcDomain.length + 3); buf.set(cap.crcDomain, 0); buf.set(head, cap.crcDomain.length);
  const c = crc32c(buf) >>> 0;
  raw[3] = c & 0xff; raw[4] = (c >>> 8) & 0xff; raw[5] = (c >>> 16) & 0xff; raw[6] = (c >>> 24) & 0xff;
  assert.throws(() => unframeX(raw, cap.crcDomain), e => e.stage === 'utf8');
});

test('encodeX/decodeX CRC — 정상 왕복 verified:true, 정정 범위 안 비트 반전도 verified:true, 스키마 crc=', () => {
  for (const id of ['X0', 'X0g', 'X1']) {
    const cap = xCapacity(id, CRC);
    const text = 'crc-' + id;
    const enc = encodeX(text, id, CRC);
    assert.equal(enc.crc, X_CRC_ID); assert.ok(enc.schema.endsWith('crc=x-crc32c-v0'));
    const dec = decodeX({ levels: enc.levels }, id, CRC);
    assert.ok(dec.ok, dec.reason); assert.equal(dec.text, text); assert.equal(dec.verified, true); assert.equal(dec.crc, X_CRC_ID);
    // RS 정정 범위 안 오류 t = ⌊nsym/2⌋ → 복구되면 verified:true 가 정상(codex REPORT_012)
    const r = rng(7);
    const digits = Array.from(enc.digits);
    const t = Math.floor(cap.nsym / 2);
    const flipped = new Set();
    while (flipped.size < t) { const s = Math.floor(r() * cap.symbols); if (flipped.has(s)) continue; flipped.add(s); digits[s * 3] = (digits[s * 3] + 1 + Math.floor(r() * 5)) % 6; }
    const fixed = decodeX({ digits }, id, CRC);
    assert.ok(fixed.ok && fixed.text === text && fixed.verified === true, `${id} 정정 범위 안 → verified`);
    assert.equal(fixed.corrected, t);
    // 현행(CRC 없음)은 그대로 verified:false
    const plain = decodeX({ levels: encodeX(text, id).levels }, id);
    assert.equal(plain.verified, false); assert.equal(plain.crc, null);
  }
  assert.equal(xCodecSchema('cell-order-v0', X_CRC_ID), 'TLcube:X:codec:v0;header=1B;base211;rs211-single;tone2=H_BINARY;scan=cell-order-v0;mask=identity-v0;crc=x-crc32c-v0');
});

test('교차 읽기(morton 산출 → cell-order 복호) 는 CRC 모드에서 verified 성공 불가(어느 단계 거절도 허용)', () => {
  for (const id of ['X0', 'X1']) {
    const encM = encodeX('cross-' + id, id, { ...CRC, scanOrderId: 'morton-v0' });
    const cross = decodeX({ levels: encM.levels }, id, CRC);
    assert.ok(!(cross.ok && cross.verified), `${id} 교차 읽기가 verified 로 통과했어요`);
    // 코드워드는 순서별로 달라요(도메인에 scanOrderId) — CRC 없는 모드의 «순서 무관» 단언과 별개
    const encC = encodeX('cross-' + id, id, CRC);
    assert.notDeepEqual(Array.from(encM.codeword), Array.from(encC.codeword));
  }
});

test('CRC 단계 자체 — 유효 길이·UTF-8·패딩을 유지한 payload 변조 + RS 재인코딩 → reason frameX crc', () => {
  const id = 'X0';
  const cap = xCapacity(id, CRC);
  const text = 'abcdefghij';
  const good = frameX(text, cap.dataBytes, cap.crcDomain);
  const tampered = Uint8Array.from(good); tampered[3] = tampered[3] === 0x41 ? 0x42 : 0x41; // 'c' → 다른 ASCII (길이·UTF-8 유지)
  const message = new Uint8Array(cap.dataSymbols); message.set(bytesToSymbols(tampered));
  const codeword = rsEncode(message, cap.nsym);
  // 코드워드를 digit 으로 풀어 decodeX 에 넣어요(RS 는 정상 → CRC 단계에서 거절)
  const digits = new Uint8Array(cap.digits); digits.set(unpackSymbolsToCellDigits(codeword));
  const dec = decodeX({ digits }, id, CRC);
  assert.equal(dec.ok, false); assert.equal(dec.stage, 'crc'); assert.match(dec.reason, /frameX crc/);
  // 대조: 변조 없는 같은 경로는 verified
  const ok = decodeX({ digits: encodeX(text, id, CRC).digits }, id, CRC);
  assert.ok(ok.ok && ok.verified);
});
