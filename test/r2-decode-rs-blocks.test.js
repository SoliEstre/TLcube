import test from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '../src/encode.js';
import { VERSIONS_C, VERSIONS_C_DAEHAN, VERSIONS_C_Q, capacityForC } from '../src/capacityC.js';
import { bytesToSymbols } from '../src/base211.js';
import { frame, unframe, maxPayloadFor } from '../src/header.js';
import { rsEncodeBlocks, rsBlockInterleaveMap } from '../src/rs211.js';
import { R2_TYPE_C_PROFILE as profile } from '../src/r2/profiles/c.js';
import { createRsBlockDecodeInto, createRsBlockStats } from '../src/r2/decode-rs-blocks.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { correctedCellsFromPositions } from '../src/r2/corrections.js';
import { createR2Session, R2_SESSION_STATUS, R2_INDICATOR } from '../src/r2/session.js';
import { digitToRanks } from '../src/lehmer.js';
import { Q15_ONE } from '../src/r2/params.js';

const specs = [...VERSIONS_C, ...VERSIONS_C_DAEHAN, ...VERSIONS_C_Q];
function bind(spec = VERSIONS_C[1], ecc = 'M') {
  return profile.bind({ layoutId: spec.name, dimension: spec.k, ecc, wire: 1, tones: 3,
    maskIndex: 0, orientation: 0, sourceIdentity: `${spec.name}/${ecc}/print` });
}
function fixture(spec = VERSIONS_C[1], ecc = 'M') {
  const bound = bind(spec, ecc);
  assert.ok(bound);
  const count = maxPayloadFor(bound.dataBytes);
  // 블록 경계 뒤까지 데이터가 있고 모두 같지도 않다. 패딩만 있는 두 번째 블록으로 성공을 꾸미지 않는다.
  const text = Array.from({ length: count }, (_, i) => String.fromCharCode(33 + (i * 37) % 90)).join('');
  const encoded = encode(text, { notchC: true, version: spec.version, eccLevel: ecc,
    daehanFinder: spec.daehanFinder, centerQr: spec.centerQr });
  return { bound, encoded, text, values: encoded.codewordSymbols.slice(),
    confidence: new Int16Array(bound.symbolCount).fill(30000), erasures: new Uint8Array(bound.symbolCount) };
}
function harness(f) {
  const stats = createRsBlockStats(f.bound);
  const decode = createRsBlockDecodeInto(f.bound, { stats });
  const output = { accepted: 0, payloadLength: 0, correctedCount: 0, tResidual: 0,
    correctedPositions: new Uint16Array(f.bound.symbolCount) };
  const payload = new Uint8Array(f.bound.dataBytes);
  return { stats, decode, output, payload,
    run() { return decode(f.values, f.confidence, f.erasures, f.bound.symbolCount, f.bound, output, payload); } };
}
function corruption(f, positions, confidence = 40) {
  for (const g of positions) {
    f.values[g] = (f.values[g] + 1 + (g * 17) % 210) % 211;
    f.confidence[g] = confidence;
  }
}
function sorted(positions) { return [...positions].sort((a, b) => a - b); }
function assertRejected(h) {
  assert.equal(h.output.accepted, 0);
  assert.equal(h.output.payloadLength, 0);
  assert.equal(h.output.correctedCount, 0);
  assert.equal(h.output.tResidual, 0);
}

test('C 12행×L/M/H 원문·블록 메시지 순서·패딩 버퍼 왕복', () => {
  let passed = 0;
  for (const spec of specs) for (const ecc of ['L', 'M', 'H']) {
    const f = fixture(spec, ecc), h = harness(f);
    assert.equal(h.run(), R2_SESSION_STATUS.OK, `${spec.name}/${ecc}`);
    assert.equal(h.output.accepted, 1, `${spec.name}/${ecc}`);
    assert.equal(h.output.payloadLength, f.bound.dataBytes);
    assert.deepEqual(h.payload, frame(f.text, f.bound.dataBytes));
    assert.equal(unframe(h.payload).text, f.text);
    assert.equal(h.stats.blocksAttempted, f.bound.blocks.length);
    assert.equal(h.stats.blocksOk, f.bound.blocks.length);
    assert.equal(h.output.tResidual, Math.min(...h.stats.tResidual));
    assert.equal(h.output.correctedCount, 0);
    passed += 1;
  }
  assert.equal(passed, 36);
});

test('각 블록의 데이터·패리티 손상은 원 와이어 위치와 셀 위치로 돌아온다', () => {
  for (const spec of specs) for (const ecc of ['L', 'M', 'H']) {
    const f = fixture(spec, ecc), h = harness(f);
    // 프로필 역표를 기대값 생성에 쓰지 않는다. 인코더의 독립 인터리브 정본을 사용한다.
    const map = rsBlockInterleaveMap(capacityForC(spec, ecc).rsBlockConfig);
    const positions = [];
    for (let b = 0; b < f.bound.blocks.length; b += 1) {
      positions.push(map.findIndex((entry) => entry.blockIndex === b && entry.codewordIndex === 0));
      positions.push(map.findIndex((entry) => entry.blockIndex === b
        && entry.codewordIndex === f.bound.blocks[b].symbolCount - 1));
    }
    corruption(f, positions);
    assert.equal(h.run(), R2_SESSION_STATUS.OK);
    assert.equal(h.output.accepted, 1, `${spec.name}/${ecc}`);
    assert.equal(unframe(h.payload).text, f.text);
    const corrected = h.output.correctedPositions.subarray(0, h.output.correctedCount);
    assert.deepEqual(sorted(corrected), sorted(positions));
    const cells = new Uint16Array(positions.length * 3);
    assert.equal(correctedCellsFromPositions(corrected, corrected.length, f.bound, cells), cells.length);
    assert.deepEqual(sorted(cells), sorted(positions.flatMap((g) => [3 * g, 3 * g + 1, 3 * g + 2])));
    assert.equal(h.output.tResidual, Math.min(...h.stats.tResidual));
  }
});

test('C3의 서로 다른 블록 길이와 메시지 경계를 넘는 손상을 복구한다', () => {
  const f = fixture(VERSIONS_C[3], 'L'), h = harness(f);
  assert.equal(f.bound.dataBytes, 321);
  assert.notEqual(f.bound.blocks[0].dataSymbols, f.bound.blocks[1].dataSymbols);
  const map = rsBlockInterleaveMap(capacityForC(VERSIONS_C[3], 'L').rsBlockConfig);
  const positions = map.flatMap((entry, g) => {
    const block = f.bound.blocks[entry.blockIndex];
    return [0, block.dataSymbols - 1, block.dataSymbols, block.symbolCount - 1].includes(entry.codewordIndex) ? [g] : [];
  });
  corruption(f, positions);
  assert.equal(h.run(), R2_SESSION_STATUS.OK);
  assert.equal(h.output.accepted, 1);
  assert.deepEqual(h.payload, frame(f.text, f.bound.dataBytes));
  assert.deepEqual(sorted(h.output.correctedPositions.subarray(0, h.output.correctedCount)), sorted(positions));
});

test('잔여가 다른 두 블록의 순서를 바꿔도 tResidual은 최소다', () => {
  for (const damagedBlock of [0, 1]) {
    const f = fixture(VERSIONS_C[2], 'M'), h = harness(f);
    for (let p = 0; p < 26; p += 1) {
      const g = f.bound.blockToSymbol[damagedBlock][p * 5 + 1];
      assert.ok(Number.isInteger(g));
      f.values[g] = (f.values[g] + 7 + p) % 211;
      f.confidence[g] = 30;
    }
    assert.equal(h.run(), R2_SESSION_STATUS.OK);
    assert.equal(h.output.accepted, 1);
    assert.equal(unframe(h.payload).text, f.text);
    const [a, b] = h.stats.tResidual;
    assert.notEqual(a, b, '같은 잔여로 min/max/first/last가 모두 같아지는 공허한 자 금지');
    assert.equal(h.output.tResidual, Math.min(a, b));
    assert.notEqual(h.output.tResidual, Math.max(a, b));
    assert.notEqual(h.output.tResidual, a + b);
    assert.equal(h.output.tResidual, h.stats.tResidual[damagedBlock]);
  }
});

test('한 블록의 고신뢰 오정정 또는 과부하를 다른 블록의 성공으로 덮지 않는다', () => {
  for (const rejectedBlock of [0, 1]) for (const mode of ['high-confidence', 'overload']) {
    const f = fixture(VERSIONS_C[1], 'M'), h = harness(f);
    const good = [f.bound.blockToSymbol[0][0], f.bound.blockToSymbol[1][0]];
    corruption(f, good);
    assert.equal(h.run(), R2_SESSION_STATUS.OK);
    assert.equal(h.output.accepted, 1, '선행 성공이 있어야 잔재 초기화를 검증한다');
    f.values.set(f.encoded.codewordSymbols);
    f.confidence.fill(30000);
    const worker = f.bound.blocks[rejectedBlock];
    const n = mode === 'high-confidence' ? 1 : worker.nsym + 4;
    const positions = Array.from({ length: n }, (_, p) => f.bound.blockToSymbol[rejectedBlock][p]);
    corruption(f, positions, mode === 'high-confidence' ? 30000 : 40);
    assert.equal(h.run(), R2_SESSION_STATUS.OK, '증거 부족은 세션 치명 오류가 아니다');
    assertRejected(h);
    assert.equal(h.stats.blocksAttempted, 2);
    assert.equal(h.stats.blocksOk, 1);
    assert.equal(h.stats.correctedCount[rejectedBlock], 0);
    f.values.set(f.encoded.codewordSymbols);
    f.confidence.fill(30000);
    assert.equal(h.run(), R2_SESSION_STATUS.OK);
    assert.equal(h.output.accepted, 1);
    assert.equal(h.output.correctedCount, 0);
    assert.equal(unframe(h.payload).text, f.text);
  }
});

test('전부-0·잘못된 UTF-8·길이 초과는 모든 RS 블록이 정상이어도 거부한다', () => {
  const f = fixture(VERSIONS_C[1], 'M'), h = harness(f);
  const config = capacityForC(VERSIONS_C[1], 'M').rsBlockConfig;
  const cases = [new Uint8Array(f.bound.dataBytes), new Uint8Array(f.bound.dataBytes), new Uint8Array(f.bound.dataBytes)];
  cases[1][0] = 1; cases[1][1] = 0xff;
  cases[2][0] = 255; cases[2][1] = 65;
  for (const bytes of cases) {
    f.values.set(rsEncodeBlocks(bytesToSymbols(bytes), config));
    assert.equal(h.run(), R2_SESSION_STATUS.OK);
    assert.equal(h.stats.blocksOk, 2);
    assertRejected(h);
  }
});

test('셀맵 소거 플래그는 GMD 결과를 바꾸지 않는다', () => {
  const f = fixture(), h = harness(f);
  corruption(f, [0, f.bound.symbolCount - 1]);
  h.run();
  const first = { payload: h.payload.slice(), count: h.output.correctedCount,
    positions: h.output.correctedPositions.slice(0, h.output.correctedCount), residual: h.output.tResidual };
  f.erasures.fill(1);
  assert.equal(h.run(), R2_SESSION_STATUS.OK);
  assert.equal(h.output.accepted, 1);
  assert.deepEqual(h.payload, first.payload);
  assert.equal(h.output.correctedCount, first.count);
  assert.deepEqual(h.output.correctedPositions.slice(0, h.output.correctedCount), first.positions);
  assert.equal(h.output.tResidual, first.residual);
});

test('C0 단일 블록은 기존 decodeInto의 바이트·정정·잔여 반경과 동일하다', () => {
  for (const spec of [VERSIONS_C[0], VERSIONS_C_DAEHAN[0]]) for (const ecc of ['L', 'M', 'H']) {
    const f = fixture(spec, ecc), h = harness(f);
    corruption(f, [0, f.bound.symbolCount - 1]);
    const old = createRsDecodeInto({ codewordCapacity: f.bound.symbolCount });
    const oldOut = { correctedPositions: new Uint16Array(f.bound.symbolCount) }, oldPayload = new Uint8Array(f.bound.dataBytes);
    assert.equal(old(f.values, f.confidence, f.erasures, f.bound.symbolCount, f.bound, oldOut, oldPayload), h.run());
    assert.deepEqual(h.output, oldOut);
    assert.deepEqual(h.payload, oldPayload);
  }
});

test('잘못된 맵·회계·버퍼·입력 값은 예외 없이 INVALID_CONFIG로 닫는다', () => {
  const f = fixture(), h = harness(f);
  const corruptMap = f.bound.symbolToBlock.slice(); corruptMap[0] = 1;
  for (const bound of [null, {}, { ...f.bound, symbolToBlock: corruptMap },
    { ...f.bound, dataBytes: 256 }, { ...f.bound, messageOrder: 'wire' },
    { ...f.bound, workOffsets: new Int32Array(2) }]) {
    const d = createRsBlockDecodeInto(bound), out = { accepted: 1, payloadLength: 5, correctedCount: 2, tResidual: 7 };
    assert.doesNotThrow(() => assert.equal(d(f.values, f.confidence, f.erasures, f.bound.symbolCount, bound, out, h.payload), R2_SESSION_STATUS.INVALID_CONFIG));
    assertRejected({ output: out });
  }
  for (const value of [211, 256, -1, 0.5, NaN]) {
    const values = Array.from(f.values); values[0] = value;
    assert.equal(h.decode(values, f.confidence, f.erasures, f.bound.symbolCount, f.bound, h.output, h.payload), R2_SESSION_STATUS.INVALID_CONFIG);
    assertRejected(h);
  }
  assert.equal(h.decode(f.values, f.confidence, f.erasures, f.bound.symbolCount, f.bound, h.output, new Uint8Array(8)), R2_SESSION_STATUS.INVALID_CONFIG);
  assert.equal(h.decode(f.values, f.confidence, f.erasures, f.bound.symbolCount, { ...f.bound }, h.output, h.payload), R2_SESSION_STATUS.INVALID_CONFIG);
});

test('반복 호출에서 caller-owned 진단/출력 버퍼와 프로필 표의 참조를 보존한다', () => {
  const f = fixture(), h = harness(f);
  const refs = [h.stats.status, h.stats.correctedCount, h.stats.tResidual,
    ...h.stats.correctedPositions, h.output.correctedPositions, h.payload,
    f.bound.cellCoord, f.bound.symbolToBlock, ...f.bound.blockToSymbol];
  for (let i = 0; i < 10; i += 1) { assert.equal(h.run(), R2_SESSION_STATUS.OK); assert.equal(h.output.accepted, 1); }
  const after = [h.stats.status, h.stats.correctedCount, h.stats.tResidual,
    ...h.stats.correctedPositions, h.output.correctedPositions, h.payload,
    f.bound.cellCoord, f.bound.symbolToBlock, ...f.bound.blockToSymbol];
  for (let i = 0; i < refs.length; i += 1) assert.equal(after[i], refs[i]);
});

test('C 12행×L/M/H의 마스크된 셀 휘도 → 세션 누적 → 다중 블록 → UTF-8 본문', () => {
  let passed = 0, largerThanDefaultBuffer = 0, maxDataBytes = 0;
  for (const spec of specs) for (const ecc of ['L', 'M', 'H']) {
    const bound = bind(spec, ecc);
    const text = `C 세션 ${spec.name}/${ecc}: 0123456789`;
    const encoded = encode(text, { notchC: true, version: spec.version, eccLevel: ecc,
      daehanFinder: spec.daehanFinder, centerQr: spec.centerQr });
    const luma = new Uint16Array(bound.cellCount * 3);
    for (let i = 0; i < encoded.dataDigits.length; i += 1) {
      const ranks = digitToRanks(encoded.dataDigits[i]);
      for (let face = 0; face < 3; face += 1) luma[i * 3 + face] = [25, 128, 230][ranks[['T', 'L', 'R'][face]]];
    }
    const options = {
      layout: bound,
      detectInto(_l, _w, _h, _t, _p, out) { out.found = 1; out.family = 5; return R2_SESSION_STATUS.OK; },
      alignInto(_l, _w, _h, _t, _p, _d, out, faceLuma, visibleCells) {
        out.gatePassed = 1; out.weightQ15 = Q15_ONE; out.matchCount = 0; out.mismatchCount = 0;
        out.visibleCount = bound.cellCount; faceLuma.set(luma); visibleCells.fill(1);
        return R2_SESSION_STATUS.OK;
      },
    };
    const session = createR2Session({ ...options, decodeInto: createRsBlockDecodeInto(bound) });
    const stub = createR2Session(options);
    const pixel = new Uint8Array([128]);
    for (let i = 0; i < 20; i += 1) { session.pushFrame(pixel, 1, 1, i * 100, {}); stub.pushFrame(pixel, 1, 1, i * 100, {}); }
    assert.equal(session.result.status, R2_SESSION_STATUS.OK);
    assert.equal(session.result.indicator, R2_INDICATOR.DONE, spec.name);
    assert.equal(session.result.payload.length, bound.dataBytes);
    assert.equal(session.result.payloadLength, bound.dataBytes);
    assert.equal(unframe(session.result.payload.subarray(0, session.result.payloadLength)).text, text);
    assert.notEqual(stub.result.indicator, R2_INDICATOR.DONE, 'RS 스텁 대조군은 완료되면 안 된다');
    passed += 1;
    if (bound.dataBytes > 256) largerThanDefaultBuffer += 1;
    maxDataBytes = Math.max(maxDataBytes, bound.dataBytes);
  }
  assert.equal(passed, 36);
  assert.equal(largerThanDefaultBuffer, 8, '기본 256B를 넘는 8조합이 모두 세션 끝단을 지나야 한다');
  assert.equal(maxDataBytes, 321, '321B 프레이밍 버퍼 끝단을 세션에서 검증해야 한다');
});
