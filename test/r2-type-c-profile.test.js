import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { R2_TYPE_C_PROFILE as profile } from '../src/r2/profiles/c.js';
import { createR2CandidateKey, sameR2CandidateKey, r2FormatAllowsCandidate, R2_IDENTITY_FIELDS } from '../src/r2/candidate-key.js';
import { VERSIONS_C, VERSIONS_C_DAEHAN, VERSIONS_C_Q, capacityForC } from '../src/capacityC.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { typeCReservedCells } from '../src/notchC.js';
import { daehanReservedCells } from '../src/finder-daehan.js';
import { rsBlockInterleaveMap } from '../src/rs211.js';
import { packCellDigitsToSymbols, DIGITS_PER_SYMBOL } from '../src/base211.js';
import { maskSub } from '../src/mask.js';
import { encode } from '../src/encode.js';
import { createR2Session, R2_SESSION_STATUS } from '../src/r2/session.js';

const specs = [...VERSIONS_C, ...VERSIONS_C_DAEHAN, ...VERSIONS_C_Q];
const context = (spec, ecc = 'M', overrides = {}) => ({
  layoutId: spec.name, dimension: spec.k, ecc, maskIndex: 0, wire: 1,
  tones: 3, orientation: 0, sourceIdentity: 'print:A', ...overrides,
});

test('C 프로필은 정본 12행을 열고 영상 능력을 거짓으로 선언하지 않는다', () => {
  assert.deepEqual(profile.layoutIds, specs.map((spec) => spec.name));
  assert.deepEqual(profile.capabilities, { bind: true, detector: false, readFormat: false, sampler: false });
  assert.equal(profile.readFormat, undefined);
  assert.equal(profile.dimensionKind, 'radius-k');
  for (const spec of specs) assert.deepEqual(profile.dimensionsOf(spec.name), [spec.k]);
  assert.deepEqual(profile.dimensionsOf('K3'), []);
});

test('C 12행×L/M/H 바인딩은 예약·필러를 제외한 인코더 셀/블록/양방향 맵과 같다', () => {
  let checked = 0;
  for (const spec of specs) for (const ecc of ['L', 'M', 'H']) {
    const bound = profile.bind(context(spec, ecc));
    assert.ok(bound, `${spec.name}/${ecc}`);
    const cap = capacityForC(spec, ecc);
    const encoded = encode('바인딩|0123456789', {
      notchC: true, version: spec.version, eccLevel: ecc,
      daehanFinder: spec.daehanFinder, centerQr: spec.centerQr,
    });
    const reserved = typeCReservedCells(spec.k, spec.daehanFinder ? daehanReservedCells(spec.k) : undefined);
    const scan = dataCellsInScanOrder(spec.k, reserved);
    assert.equal(bound.cellCount, cap.usedSymbols * DIGITS_PER_SYMBOL);
    assert.equal(bound.symbolCount, cap.usedSymbols);
    assert.equal(bound.dataBytes, cap.dataBytes);
    assert.equal(bound.maxPayloadBytes, cap.dataBytes);
    assert.equal(bound.payloadBytes, cap.dataBytes);
    assert.equal(bound.requiredSymbolCount, cap.dataSymbols);
    assert.equal(bound.cellCoord.length, bound.cellCount * 2);
    assert.equal(bound.maskDigit, bound.maskDigits);
    assert.equal(bound.framed, true);
    assert.equal(bound.messageOrder, 'block-concat');
    assert.equal(bound.cellCount + bound.residualCells, scan.length);
    const unmasked = new Uint8Array(bound.cellCount);
    for (let i = 0; i < bound.cellCount; i += 1) {
      const q = bound.cellCoord[2 * i], r = bound.cellCoord[2 * i + 1];
      assert.equal(q, scan[i].q);
      assert.equal(r, scan[i].r);
      const digit = encoded.cellDigits.get(`${q},${r}`).digit;
      assert.equal(digit, encoded.dataDigits[i]);
      unmasked[i] = (digit + 6 - bound.maskDigit[i]) % 6;
      assert.equal(unmasked[i], maskSub(digit, q, r));
    }
    assert.deepEqual(packCellDigitsToSymbols(unmasked).symbols, encoded.codewordSymbols);
    const wireMap = rsBlockInterleaveMap(cap.rsBlockConfig);
    let offset = 0;
    for (let b = 0; b < bound.blocks.length; b += 1) {
      assert.equal(bound.workOffsets[b], offset);
      assert.equal(bound.blocks[b].dataSymbols, cap.rsDataSymbolsPerBlock[b]);
      assert.equal(bound.blocks[b].nsym, cap.rsParitySymbolsPerBlock);
      offset += bound.blocks[b].symbolCount;
    }
    assert.equal(offset, bound.symbolCount);
    for (let g = 0; g < bound.symbolCount; g += 1) {
      const b = bound.symbolToBlock[2 * g], p = bound.symbolToBlock[2 * g + 1];
      assert.equal(b, wireMap[g].blockIndex);
      assert.equal(p, wireMap[g].codewordIndex);
      assert.equal(bound.blockToSymbol[b][p], g);
    }
    checked += 1;
  }
  assert.equal(checked, 36);
});

test('불가능한 C 조합·누락된 대상 정체성은 추측 없이 null로 거부한다', () => {
  const valid = context(VERSIONS_C[0]);
  const bad = [null, {}, { ...valid, layoutId: 'O0' }, { ...valid, dimension: 16 },
    { ...valid, ecc: 'Q' }, { ...valid, wire: 2 }, { ...valid, tones: 2 },
    { ...valid, maskIndex: 1 }, { ...valid, orientation: undefined },
    { ...valid, sourceIdentity: '' }, { ...valid, sourceIdentity: undefined }];
  for (const input of bad) {
    const diagnostic = {};
    assert.doesNotThrow(() => assert.equal(profile.bind(input, diagnostic), null));
    assert.equal(diagnostic.status, 'UNSUPPORTED');
    assert.ok(diagnostic.reason.length > 0);
  }
});

test('C bind는 미지원과 정본 유도 실패를 caller-owned 진단으로 구별한다', async () => {
  const file = new URL('../src/r2/profiles/c.js', import.meta.url);
  const capacityUrl = new URL('../../capacityC.js', file).href;
  const diagnostic = {};
  for (const [body, reason] of [
    ["throw new Error('injected capacity invariant');", 'injected capacity invariant'],
    ['return { ...realCapacity(...args), dataCells: -1 };', 'C 스캔 셀 수와 정본 용량 회계가 다르다'],
    ['return { ...realCapacity(...args), usedSymbols: 1 };', 'C 인터리브 맵과 정본 심볼 수가 다르다'],
  ]) {
    // 정본 파일과 생산 API를 바꾸지 않고, 모듈 인스턴스의 용량 제공자만 교체한다.
    const replacement = `export { VERSIONS_C, VERSIONS_C_DAEHAN, VERSIONS_C_Q } from '${capacityUrl}';
      import { capacityForC as realCapacity } from '${capacityUrl}';
      export function capacityForC(...args) { ${body} }`;
    const injectedUrl = `data:text/javascript;base64,${Buffer.from(replacement).toString('base64')}`;
    const source = readFileSync(file, 'utf8').replace(/from\s+(['"])(\.[^'"]+)\1/g,
      (_match, _quote, specifier) => `from '${specifier === '../../capacityC.js'
        ? injectedUrl : new URL(specifier, file).href}'`);
    const injected = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).R2_TYPE_C_PROFILE;
    assert.equal(injected.bind(context(VERSIONS_C[0]), diagnostic), null);
    assert.deepEqual(diagnostic, { status: 'DERIVATION_ERROR', reason });
    assert.doesNotThrow(() => assert.equal(injected.bind(context(VERSIONS_C[0])), null));
    assert.equal(injected.bind(context(VERSIONS_C[0], 'Q'), diagnostic), null);
    assert.equal(diagnostic.status, 'UNSUPPORTED');
  }
  assert.ok(profile.bind(context(VERSIONS_C[0]), diagnostic));
  assert.deepEqual(diagnostic, { status: 'OK', reason: '' });
  assert.doesNotThrow(() => assert.ok(profile.bind(context(VERSIONS_C[0]), Object.freeze({}))));
});

test('C bind는 정본 RS 행·블록표 부재를 미지원 입력과 구별한다', async () => {
  const file = new URL('../src/r2/profiles/c.js', import.meta.url);
  const rsUrl = new URL('../../rs211.js', file).href;
  for (const [body, reason] of [
    ['const { C1, ...rest } = original; export const NSYM_TABLE_C = rest;', 'NSYM_TABLE_C 에 키 C1 가 없다'],
    ['export const NSYM_TABLE_C = { ...original, C1: null };', 'NSYM_TABLE_C 에 키 C1 가 없다'],
    ['export const NSYM_TABLE_C = { ...original, C1: { ...original.C1, blocks: undefined } };', 'NSYM_TABLE_C.C1.blocks 가 없다'],
    ['export const NSYM_TABLE_C = { ...original, C1: { ...original.C1, blocks: null } };', 'NSYM_TABLE_C.C1.blocks 가 없다'],
  ]) {
    const replacement = `export { rsBlockInterleaveMap } from '${rsUrl}';
      import { NSYM_TABLE_C as original } from '${rsUrl}'; ${body}`;
    const injectedUrl = `data:text/javascript;base64,${Buffer.from(replacement).toString('base64')}`;
    const source = readFileSync(file, 'utf8').replace(/from\s+(['"])(\.[^'"]+)\1/g,
      (_match, _quote, specifier) => `from '${specifier === '../../rs211.js'
        ? injectedUrl : new URL(specifier, file).href}'`);
    const injected = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).R2_TYPE_C_PROFILE;
    const diagnostic = {};
    assert.ok(injected.bind(context(VERSIONS_C[0]), diagnostic), '정상 행 대조군은 바인딩돼야 한다');
    assert.deepEqual(diagnostic, { status: 'OK', reason: '' });
    assert.equal(injected.bind(context(VERSIONS_C[1]), diagnostic), null);
    assert.deepEqual(diagnostic, { status: 'DERIVATION_ERROR', reason });
    assert.doesNotThrow(() => assert.equal(injected.bind(context(VERSIONS_C[1])), null));
    assert.equal(injected.bind(null, diagnostic), null);
    assert.equal(diagnostic.status, 'UNSUPPORTED');
  }
});

test('키 한 필드만 달라도 분리하며, H 변화는 키와 무관하다', () => {
  const bound = profile.bind(context(VERSIONS_C[0]));
  const base = bound.key;
  assert.ok(sameR2CandidateKey(base, createR2CandidateKey({ ...base, H: [1, 2, 3] })));
  for (const field of R2_IDENTITY_FIELDS) {
    const changed = { ...base, [field]: typeof base[field] === 'number' ? base[field] + 1 : `${base[field]}:other` };
    assert.equal(sameR2CandidateKey(base, createR2CandidateKey(changed)), false, field);
  }
  assert.equal(sameR2CandidateKey({}, {}), false);
  assert.equal(sameR2CandidateKey(null, base), false);
  assert.equal(r2FormatAllowsCandidate(base, { kind: 'unknown' }), true);
  assert.equal(r2FormatAllowsCandidate(base, { kind: 'contradiction', reason: 'notch' }), false);
  const read = { kind: 'read', layoutId: base.layoutId, ecc: base.ecc, maskIndex: base.maskIndex, wire: base.wire };
  assert.equal(r2FormatAllowsCandidate(base, read), true);
  assert.equal(r2FormatAllowsCandidate(base, { ...read, ecc: 'H' }), false);
  assert.equal(r2FormatAllowsCandidate(base, { kind: 'read' }), false);
});

test('다른 인쇄물/방향의 후보 세션은 누적 버퍼를 공유하지 않는다', () => {
  const a = profile.bind(context(VERSIONS_C[1]));
  for (const extra of [{ sourceIdentity: 'print:B' }, { orientation: 1 }, { ecc: 'H' }]) {
    const b = profile.bind(context(VERSIONS_C[1], 'M', extra));
    assert.equal(sameR2CandidateKey(a.key, b.key), false);
    const sa = createR2Session({ layout: a }), sb = createR2Session({ layout: b });
    assert.equal(sa.result.status, R2_SESSION_STATUS.OK);
    assert.equal(sb.result.status, R2_SESSION_STATUS.OK);
    assert.notEqual(sa.buffers.accumulator, sb.buffers.accumulator);
    const before = sb.buffers.accumulator.slice();
    sa.buffers.accumulator[0] = 312;
    assert.deepEqual(sb.buffers.accumulator, before);
    sa.reset();
    assert.deepEqual(sb.buffers.accumulator, before);
  }
});
