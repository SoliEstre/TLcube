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
      erasedPositions: 0,
      survivorDecided: 0,
    });
    assert.deepEqual(result.diagnostics, {
      generated: { majority: 1, replicas: 3, erasedReplicas: 0, unique: 2 },
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

describe('프레임 밖으로 잘린 복제는 소거로 표에서 제외한다 (no-format-candidate 구제)', () => {
  test('복제 1개가 통째로 잘려도 남은 2개의 3/3 합의로 다수결이 선다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    const erased = [null, null, null, null, null];

    const result = enumerateFormatProposals([good.slice(), good.slice(), erased], {
      validVersionIndices: [1],
    });
    const majority = result.proposals.find((proposal) => proposal.source === 'majority');
    assert.ok(majority, '살아남은 2복제가 일치하면 다수결 proposal 이 서야 한다');
    assert.equal(majority.crcOk, true);
    assert.equal(majority.versionIndex, 1);
    assert.equal(majority.eccLevel, 1);
    assert.deepEqual(majority.consensus.states, ['2/2', '2/2', '2/2', '2/2', '2/2']);
    assert.equal(majority.consensus.noConsensus, 0);
    assert.equal(majority.consensus.erasedPositions, 0);
    assert.equal(result.diagnostics.generated.erasedReplicas, 1);
    // 잘린 복제는 개별 proposal 로도 새지 않는다 — 0 으로 메운 값은 관측이 아니다.
    assert.equal(
      result.proposals.some((proposal) => proposal.sources.includes('replica-2')),
      false,
    );
  });

  test('잘린 자리를 0 으로 메우면(구 동작) 멀쩡한 두 복제를 이겨 오답이 선다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    // 같은 자리를 0 으로 «관측한 척» 하는 복제 두 개 — 2/3 다수결을 훔쳐간다.
    const faked = good.slice();
    faked[0] = 0;
    const stolen = enumerateFormatProposals([good.slice(), faked.slice(), faked.slice()], {
      validVersionIndices: [1],
    });
    const stolenMajority = stolen.proposals.find((proposal) => proposal.source === 'majority');
    assert.equal(stolenMajority.maskedDigits[0], 0, '0 위장이 다수결을 가져간다');

    // 같은 상황을 소거로 표시하면 살아 있는 관측이 이긴다.
    const marked = good.slice();
    marked[0] = null;
    const honest = enumerateFormatProposals([good.slice(), marked.slice(), marked.slice()], {
      validVersionIndices: [1],
    });
    const honestMajority = honest.proposals.find((proposal) => proposal.source === 'majority');
    assert.ok(honestMajority, '한 자리만 소거면 남은 관측으로 다수결이 선다');
    assert.deepEqual(Array.from(honestMajority.maskedDigits), Array.from(good));
    assert.equal(honestMajority.crcOk, true);
    assert.equal(honestMajority.consensus.states[0], '1/1');
    assert.equal(honestMajority.consensus.survivorDecided, 1);
  });

  test('세 복제가 같은 자리에서 전부 잘리면 그 자리는 어떤 값도 주장하지 않는다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    const holed = good.slice();
    holed[2] = null;
    const result = enumerateFormatProposals([holed.slice(), holed.slice(), holed.slice()], {
      validVersionIndices: [1],
    });
    assert.equal(result.proposals.length, 0, '전부 소거된 자리는 후보를 만들 수 없다');
    assert.equal(result.diagnostics.generated.majority, 0);
    assert.equal(result.diagnostics.generated.erasedReplicas, 3);
  });

  test('소거가 섞여도 digit 범위 검사는 그대로다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    const bad = good.slice();
    bad[1] = 9;
    assert.throws(
      () => enumerateFormatProposals([good.slice(), bad, good.slice()], { validVersionIndices: [1] }),
      RangeError,
    );
  });

  test('소거 입력도 결정적이다 — 2회 호출 deepEqual (키메라 포함)', () => {
    const good = encode({ version: 0, eccLevel: 2 });
    const holed = good.slice();
    holed[3] = null;
    const reads = [good.slice(), holed.slice(), [null, null, null, null, null]];
    const once = enumerateFormatProposals(reads, { validVersionIndices: [0] });
    const twice = enumerateFormatProposals(reads, { validVersionIndices: [0] });
    assert.deepEqual(once, twice);

    // 자리별 생존자가 전부 다른 «키메라» 입력도 결정적이어야 한다.
    const chimera = splitAcrossReplicas(encode({ version: 0, eccLevel: 2 }));
    assert.deepEqual(
      enumerateFormatProposals(chimera, { validVersionIndices: [0] }),
      enumerateFormatProposals(chimera, { validVersionIndices: [0] }),
    );
  });
});

/**
 * 5-digit 을 세 복제에 **겹치지 않게** 흩뿌린다 — 각 자리의 생존자가 정확히 1개이고
 * 자리마다 다른 복제가 살아남는다. 어느 복제도 5-digit 을 통째로 관측하지 못한다.
 */
function splitAcrossReplicas(digits) {
  const owner = [0, 0, 1, 1, 2]; // 자리 → 살아남는 복제
  return [0, 1, 2].map((replicaIndex) => digits.map(
    (digit, position) => (owner[position] === replicaIndex ? digit : null),
  ));
}

describe('생존자 키메라(survivor chimera) — 소거가 새로 연 수용 표면과 그 방어선', () => {
  // 이름을 붙이는 이유: 이 후보는 «퇴행» 이 아니라 **신규 표면**이다. 변경 전에는
  // readFormatForHypothesis 가 첫 미표본 셀에서 죽어 도달할 수 없었다. 이름 없는
  // 표면은 다음 사람이 방어선을 지울 때 아무도 못 알아챈다.

  test('표면의 존재 — 어느 복제도 통째로 보지 못한 5-digit 이 다수결로 선다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    const reads = splitAcrossReplicas(good);

    // 전제 확인: 어느 복제도 5-digit 을 완성하지 못한다.
    for (const replica of reads) {
      assert.ok(replica.some((digit) => digit === null), '전제가 깨졌다 — 완전한 복제가 있다');
    }

    const result = enumerateFormatProposals(reads, { validVersionIndices: [1] });
    const majority = result.proposals.find((proposal) => proposal.source === 'majority');
    assert.ok(majority, '자리별 생존자가 유일하면 키메라 다수결이 선다 — 이것이 신규 표면이다');
    assert.deepEqual(Array.from(majority.maskedDigits), Array.from(good));
    assert.equal(majority.crcOk, true, 'CRC 를 통과하는 키메라가 실제로 만들어진다');
    assert.equal(majority.consensus.survivorDecided, 5, '다섯 자리 전부 생존자 판정이다');
    assert.equal(majority.consensus.noConsensus, 0);
    assert.deepEqual(majority.consensus.states, ['1/1', '1/1', '1/1', '1/1', '1/1']);
    assert.equal(result.diagnostics.generated.erasedReplicas, 3);
    // 개별 복제 proposal 은 하나도 없다 — 후보 전체가 키메라 하나다.
    assert.equal(result.proposals.length, 1);
    assert.deepEqual(majority.replicaIndices, []);
  });

  test('방어선 ① 자리별로는 전부 실관측 — 어떤 digit 도 지어내지 않는다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    const reads = splitAcrossReplicas(good);
    const result = enumerateFormatProposals(reads, { validVersionIndices: [1] });
    const majority = result.proposals.find((proposal) => proposal.source === 'majority');

    for (let position = 0; position < 5; position += 1) {
      const observed = reads
        .map((replica) => replica[position])
        .filter((digit) => digit !== null);
      assert.ok(
        observed.includes(majority.maskedDigits[position]),
        `자리 ${position} 의 값이 실관측 집합 밖이다 — 날조다`,
      );
    }
  });

  test('방어선 ② 관측이 갈리면(동수) 키메라를 만들지 않는다 — 지어내는 대신 포기한다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    const reads = splitAcrossReplicas(good);
    // 자리 0 에 «다른 값» 을 하나 더 살려 동수(1:1)를 만든다.
    reads[2][0] = (good[0] + 3) % 6;
    assert.notEqual(reads[2][0], good[0]);

    const result = enumerateFormatProposals(reads, { validVersionIndices: [1] });
    assert.equal(
      result.proposals.some((proposal) => proposal.source === 'majority'), false,
      '동수 자리에서 임의로 하나를 고르면 그것이야말로 날조다',
    );
    assert.equal(result.diagnostics.generated.majority, 0);
  });

  test('방어선 ③ 키메라의 유일한 관문은 CRC-6 — 틀리면 crcOk:false 로 나가고 게이트가 받는다', () => {
    // 소비자(bootstrap.js)는 proposal.crcOk 를 하드 게이트로 쓴다. 키메라에는 «몇
    // 복제가 지지했는가» 같은 추가 방어가 없다 — 그래서 CRC 가 실제로 거르는지를
    // 여기서 직접 못 박는다.
    const payload = (1 << ECC_BITS) | 1;
    const invalidCrc = (crc6(payload) + 1) % (1 << CRC_BITS);
    const invalidDigits = applyMask(toDigits5((payload << CRC_BITS) | invalidCrc));

    const result = enumerateFormatProposals(splitAcrossReplicas(invalidDigits), {
      validVersionIndices: [1],
    });
    const majority = result.proposals.find((proposal) => proposal.source === 'majority');
    assert.ok(majority, '키메라 자체는 만들어진다 — 거르는 것은 CRC 다');
    assert.equal(majority.crcOk, false);
    assert.equal(result.diagnostics.crcFailed, 1);
    assert.equal(
      result.proposals.filter((proposal) => proposal.crcOk).length, 0,
      'CRC 를 통과하는 후보가 하나도 새지 않아야 한다',
    );
  });

  test('방어선 ④ 한 자리라도 관측이 0 이면 키메라를 만들지 않는다', () => {
    const good = encode({ version: 1, eccLevel: 1 });
    const reads = splitAcrossReplicas(good);
    reads[2][4] = null; // 자리 4 의 유일한 생존자를 지운다 → known 0
    const result = enumerateFormatProposals(reads, { validVersionIndices: [1] });
    assert.deepEqual(result.proposals, []);
    assert.equal(result.diagnostics.generated.majority, 0);
    assert.equal(
      enumerateFormatProposals(reads, { validVersionIndices: [1] })
        .proposals.length, 0,
    );
  });
});
