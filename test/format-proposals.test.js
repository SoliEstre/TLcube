// format-proposals.test.js — 디코더 앞단의 전체 포맷 proposal 계약

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CRC_BITS,
  ECC_BITS,
  ECC_LEVEL,
  applyMask,
  crc6,
  decode as decodeFirstSuccess,
  encode,
  toDigits5,
} from '../src/formatinfo.js';
import { enumerateFormatProposals } from '../src/format-proposals.js';

function crcValidDigits(versionIndex, eccLevel) {
  const payload = (versionIndex << ECC_BITS) | eccLevel;
  return applyMask(toDigits5((payload << CRC_BITS) | crc6(payload)));
}

function replicated(digits) {
  return [digits.slice(), digits.slice(), digits.slice()];
}

describe('포맷 proposal 전체 평가 계약', () => {
  test('서로 다른 CRC 통과 proposal 둘을 모두 보존하고 기존 decode의 첫 성공과 대조한다', () => {
    const majority = encode({ version: 0, eccLevel: 0 });
    const fallback = encode({ version: 1, eccLevel: 1 });
    const reads = [majority.slice(), majority.slice(), fallback.slice()];

    // 기존 API는 다수결의 첫 성공 하나만 준다. 이 차이가 wrapper를 따로 두는 이유다.
    assert.deepEqual(decodeFirstSuccess(reads), { version: 0, eccLevel: 0, ok: true });

    const result = enumerateFormatProposals(reads, { validVersionIndices: [0, 1] });
    assert.deepEqual(
      result.proposals.map((proposal) => ({
        versionIndex: proposal.versionIndex,
        eccLevel: proposal.eccLevel,
        crcOk: proposal.crcOk,
        source: proposal.source,
      })),
      [
        { versionIndex: 0, eccLevel: 0, crcOk: true, source: 'majority' },
        { versionIndex: 1, eccLevel: 1, crcOk: true, source: 'replica-2' },
      ],
    );
    assert.deepEqual(result.proposals[0].sources, ['majority', 'replica-0', 'replica-1']);
    assert.deepEqual(result.proposals[0].replicaIndices, [0, 1]);
    assert.deepEqual(result.proposals[0].consensus, {
      states: ['3/3', '2/3', '2/3', '2/3', '2/3'],
      threeOfThree: 1,
      twoOfThree: 4,
      noConsensus: 0,
    });
    assert.deepEqual(result.diagnostics, {
      generated: { majority: 1, replicas: 3, unique: 2 },
      semanticRejected: { codewordOutOfRange: 0, reservedEcc: 0, versionOutsideFamily: 0 },
      crcChecked: 2,
      crcOk: 2,
      crcFailed: 0,
    });
  });

  test('예약 ECC와 패밀리 밖 version-index는 CRC 계산 전에 의미론으로 제외한다', () => {
    // encode()는 예약 ECC를 막으므로, CRC는 유효하게 조립해 prefilter 순서만 검증한다.
    const reserved = crcValidDigits(0, ECC_LEVEL.RESERVED);
    const reservedResult = enumerateFormatProposals(replicated(reserved), {
      validVersionIndices: [0],
    });
    assert.deepEqual(reservedResult.proposals, []);
    assert.deepEqual(reservedResult.diagnostics.semanticRejected, {
      codewordOutOfRange: 0,
      reservedEcc: 1,
      versionOutsideFamily: 0,
    });
    assert.equal(reservedResult.diagnostics.crcChecked, 0);

    const outsideFamily = crcValidDigits(15, 0);
    const outsideResult = enumerateFormatProposals(replicated(outsideFamily), {
      validVersionIndices: [0, 1, 2],
    });
    assert.deepEqual(outsideResult.proposals, []);
    assert.deepEqual(outsideResult.diagnostics.semanticRejected, {
      codewordOutOfRange: 0,
      reservedEcc: 0,
      versionOutsideFamily: 1,
    });
    assert.equal(outsideResult.diagnostics.crcChecked, 0);
  });

  test('CRC 불일치는 의미론 통과 proposal에 crcOk:false로 보존한다', () => {
    const payload = 0;
    const invalidCrc = (crc6(payload) + 1) % (1 << CRC_BITS);
    const invalidDigits = applyMask(toDigits5((payload << CRC_BITS) | invalidCrc));

    const result = enumerateFormatProposals(replicated(invalidDigits), {
      validVersionIndices: [0],
    });
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0].versionIndex, 0);
    assert.equal(result.proposals[0].eccLevel, 0);
    assert.equal(result.proposals[0].crcOk, false);
    assert.equal(result.diagnostics.crcChecked, 1);
    assert.equal(result.diagnostics.crcFailed, 1);
  });

  test('다수결 실패에서도 개별 복제 fallback proposal을 잃지 않는다', () => {
    const good = encode({ version: 1, eccLevel: 2 });
    const replica0 = good.slice();
    const replica1 = good.slice();
    const replica2 = good.slice();
    replica0[0] = (good[0] + 1) % 6;
    replica1[0] = (good[0] + 2) % 6;

    const result = enumerateFormatProposals([replica0, replica1, replica2], {
      validVersionIndices: [1],
    });
    const fallback = result.proposals.find((proposal) => proposal.crcOk);
    assert.ok(fallback, 'CRC를 통과한 개별 복제 fallback이 있어야 한다');
    assert.equal(fallback.source, 'replica-2');
    assert.deepEqual(fallback.sources, ['replica-2']);
    assert.equal(fallback.consensus.states[0], 'none');
    assert.equal(fallback.consensus.noConsensus, 1);
    assert.equal(result.diagnostics.generated.majority, 0);
    assert.equal(result.proposals.some((proposal) => proposal.source === 'majority'), false);
  });

  test('동일 입력의 proposal 순서와 진단은 결정적이다', () => {
    const a = encode({ version: 0, eccLevel: 2 });
    const b = encode({ version: 2, eccLevel: 0 });
    const reads = [a.slice(), b.slice(), a.slice()];

    const once = enumerateFormatProposals(reads, { validVersionIndices: [0, 2] });
    const twice = enumerateFormatProposals(reads, { validVersionIndices: [0, 2] });
    assert.deepEqual(once, twice);
  });
});
