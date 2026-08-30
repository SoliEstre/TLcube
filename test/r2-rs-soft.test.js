import test from 'node:test';
import assert from 'node:assert/strict';

import { P } from '../src/gfp.js';
import { rsEncode } from '../src/rs211.js';
import {
  RS_SOFT_STATUS,
  acceptDecode,
  createRsSoftOut,
  decodeErrorsAndErasures,
  decodeGmdLadder,
  selectErasures,
} from '../src/r2/rs-soft.js';

/** Numerical Recipes LCG, fixed to uint32 for reproducible property tests. */
function createLcg(seed) {
  let state = seed >>> 0;
  return {
    next() {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state;
    },
    int(limit) {
      assert.ok(Number.isInteger(limit) && limit > 0);
      return this.next() % limit;
    },
  };
}

function randomMessage(rng, length) {
  return Uint8Array.from({ length }, () => rng.int(P));
}

function pickDistinct(length, count, rng) {
  assert.ok(count <= length, `count=${count}, length=${length}`);
  const pool = Uint16Array.from({ length }, (_, index) => index);
  for (let index = 0; index < count; index += 1) {
    const other = index + rng.int(length - index);
    const saved = pool[index];
    pool[index] = pool[other];
    pool[other] = saved;
  }
  return Array.from(pool.subarray(0, count)).sort((left, right) => left - right);
}

function corruptAt(codeword, positions, rng) {
  const received = codeword.slice();
  for (const position of positions) {
    const delta = 1 + rng.int(P - 1);
    received[position] = (received[position] + delta) % P;
  }
  return received;
}

function assertCodewordEqual(actual, expected, message = undefined) {
  assert.deepEqual(actual.subarray(0, expected.length), expected, message);
}

function decodeGuaranteedCase(rng, nsym, unknownErrorCount, erasureCount, label) {
  assert.ok(2 * unknownErrorCount + erasureCount <= nsym, label);
  const message = randomMessage(rng, 12 + rng.int(37));
  const codeword = rsEncode(message, nsym);
  const damaged = pickDistinct(
    codeword.length,
    unknownErrorCount + erasureCount,
    rng,
  );
  const declared = Uint16Array.from(damaged.slice(0, erasureCount));
  const received = corruptAt(codeword, damaged, rng);
  const out = createRsSoftOut(codeword.length);

  const status = decodeErrorsAndErasures(received, nsym, declared, out);
  assert.equal(status, RS_SOFT_STATUS.OK, `${label}: status`);
  assert.equal(out.ok, 1, `${label}: ${out.reason ?? 'decode failed'}`);
  assertCodewordEqual(out.codeword, codeword, `${label}: codeword`);
  assert.equal(out.erasureCount, erasureCount, `${label}: erasureCount`);
  assert.equal(out.errorCount, unknownErrorCount, `${label}: errorCount`);
  assert.equal(
    out.correctedCount,
    unknownErrorCount + erasureCount,
    `${label}: correctedCount`,
  );
  assert.equal(
    out.tResidual,
    Math.floor((nsym - erasureCount) / 2),
    `${label}: tResidual`,
  );
}

test('E&E 왕복: 2t+e <= nsym 임의 조합과 등호 경계에서 원 코드워드를 항상 복원한다', () => {
  const rng = createLcg(0x52_32_ee_01);
  const nsymValues = [7, 11, 14, 22, 23];

  for (let trial = 0; trial < 90; trial += 1) {
    const nsym = nsymValues[rng.int(nsymValues.length)];
    const erasureCount = rng.int(nsym + 1);
    const maximumErrors = Math.floor((nsym - erasureCount) / 2);
    const unknownErrorCount = rng.int(maximumErrors + 1);
    decodeGuaranteedCase(
      rng,
      nsym,
      unknownErrorCount,
      erasureCount,
      `random trial=${trial} nsym=${nsym} t=${unknownErrorCount} e=${erasureCount}`,
    );
  }

  let boundaryCases = 0;
  for (const nsym of nsymValues) {
    // The parity of e must match nsym for 2t+e=nsym.
    for (let erasureCount = nsym % 2; erasureCount <= nsym; erasureCount += 2) {
      const unknownErrorCount = (nsym - erasureCount) / 2;
      decodeGuaranteedCase(
        rng,
        nsym,
        unknownErrorCount,
        erasureCount,
        `boundary nsym=${nsym} t=${unknownErrorCount} e=${erasureCount}`,
      );
      boundaryCases += 1;
    }
  }
  assert.ok(boundaryCases >= 35, `경계 표본이 너무 적다: ${boundaryCases}`);
});

test('E&E 경계+1: 틀린 후보가 수용 검사를 거쳐 조용히 accepted 되지 않는다', () => {
  const rng = createLcg(0x52_32_ee_02);
  const cases = [
    { nsym: 7, errors: 4, erasures: 0 },
    { nsym: 11, errors: 6, erasures: 0 },
    { nsym: 14, errors: 7, erasures: 1 },
    { nsym: 22, errors: 11, erasures: 1 },
    { nsym: 23, errors: 12, erasures: 0 },
  ];
  let honestFailures = 0;
  let rejectedCandidates = 0;

  for (const spec of cases) {
    assert.equal(2 * spec.errors + spec.erasures, spec.nsym + 1);
    for (let trial = 0; trial < 16; trial += 1) {
      const message = randomMessage(rng, 36);
      const codeword = rsEncode(message, spec.nsym);
      const damaged = pickDistinct(codeword.length, spec.errors + spec.erasures, rng);
      const declared = Uint16Array.from(damaged.slice(0, spec.erasures));
      const received = corruptAt(codeword, damaged, rng);
      const confidence = new Int16Array(codeword.length).fill(24_000);
      for (let index = 0; index < damaged.length; index += 1) {
        confidence[damaged[index]] = index;
      }
      const out = createRsSoftOut(codeword.length);
      const status = decodeErrorsAndErasures(received, spec.nsym, declared, out);
      assert.ok(
        status === RS_SOFT_STATUS.OK || status === RS_SOFT_STATUS.DECODE_FAILED,
        `nsym=${spec.nsym} trial=${trial}: 예상 밖 status=${status}`,
      );

      if (!out.ok) {
        assert.equal(out.status, RS_SOFT_STATUS.DECODE_FAILED);
        honestFailures += 1;
        continue;
      }

      const isOriginal = out.codeword.subarray(0, codeword.length)
        .every((value, index) => value === codeword[index]);
      const accepted = acceptDecode(out, confidence, out.tResidual);
      assert.equal(typeof accepted, 'boolean');
      if (!isOriginal) {
        assert.equal(
          accepted,
          false,
          `nsym=${spec.nsym} trial=${trial}: 원문 불일치 후보가 accepted`,
        );
        rejectedCandidates += 1;
      }
    }
  }

  assert.ok(
    honestFailures + rejectedCandidates > 0,
    '경계+1 표본이 실패도 기각 후보도 만들지 않아 자가 공허하다',
  );
});

test('소거 선택 정책: 어떤 신뢰 분포에서도 !eligible 또는 tResidual >= 3 이다', () => {
  const rng = createLcg(0x52_32_ee_03);
  const out = createRsSoftOut(96);

  for (let trial = 0; trial < 500; trial += 1) {
    const symbolCount = 8 + rng.int(80);
    const confidence = new Int16Array(symbolCount);
    const erasures = new Uint8Array(symbolCount);
    for (let index = 0; index < symbolCount; index += 1) {
      confidence[index] = rng.int(32_768);
      erasures[index] = rng.int(5) === 0 ? 1 : 0;
    }
    const nsym = 1 + rng.int(55);
    const status = selectErasures(confidence, erasures, nsym, out);
    assert.equal(typeof status, 'number');

    if (!out.eligible) {
      assert.equal(out.erasureCount, 0, `trial=${trial}: ineligible인데 소거를 냈다`);
      continue;
    }

    assert.equal(status, RS_SOFT_STATUS.OK, `trial=${trial}: eligible status`);
    assert.equal(
      out.tResidual,
      Math.floor((nsym - out.erasureCount) / 2),
      `trial=${trial}: tResidual 회계`,
    );
    assert.ok(out.tResidual >= 3, `trial=${trial}: tResidual=${out.tResidual}`);
    assert.ok(out.erasureCount <= Math.max(0, nsym - 6), `trial=${trial}: cap 위반`);

    const seen = new Set();
    for (let index = 0; index < out.erasureCount; index += 1) {
      const position = out.erasurePositions[index];
      assert.ok(position >= 0 && position < symbolCount, `trial=${trial}: position=${position}`);
      assert.equal(seen.has(position), false, `trial=${trial}: 중복 position=${position}`);
      seen.add(position);
    }
  }
});

function referenceErasureSelection(confidence, erasures, nsym) {
  const order = Array.from({ length: confidence.length }, (_, index) => index)
    .sort((left, right) => {
      const forcedDifference = Number(erasures[right] !== 0) - Number(erasures[left] !== 0);
      if (forcedDifference !== 0) return forcedDifference;
      return (confidence[left] - confidence[right]) || (left - right);
    });
  const maximum = Math.min(confidence.length, nsym - 6);
  const forcedCount = erasures.reduce((sum, value) => sum + Number(value !== 0), 0);
  if (maximum < 0 || forcedCount > maximum) return { status: 'policy', order, best: -1 };

  let best = -1;
  for (let erasureCount = 0; erasureCount <= maximum; erasureCount += 1) {
    let expectedErrorsQ15 = 0;
    for (let rank = erasureCount; rank < order.length; rank += 1) {
      const position = order[rank];
      expectedErrorsQ15 += erasures[position]
        ? 32768
        : Math.round(32768 / (1 + Math.exp(confidence[position] / 256)));
    }
    if ((2 * expectedErrorsQ15) + (erasureCount * 32768) <= (nsym - 2) * 32768) {
      best = erasureCount;
    }
  }
  return best < forcedCount
    ? { status: 'not-ready', order, best: -1 }
    : { status: 'ok', order, best };
}

test('소거 선택은 강제 플래그를 보존하고 2E[t]+e 경계의 최대 저신뢰 prefix를 고른다', () => {
  const rng = createLcg(0x52_32_ee_33);
  for (let trial = 0; trial < 180; trial += 1) {
    const symbolCount = 12 + rng.int(70);
    const nsym = 6 + rng.int(Math.min(49, symbolCount - 6));
    const confidence = new Int16Array(symbolCount);
    const erasures = new Uint8Array(symbolCount);
    for (let index = 0; index < symbolCount; index += 1) {
      confidence[index] = rng.int(32_768);
      erasures[index] = rng.int(13) === 0 ? 1 : 0;
    }

    const expected = referenceErasureSelection(confidence, erasures, nsym);
    const out = createRsSoftOut(symbolCount);
    const status = selectErasures(confidence, erasures, nsym, out);
    if (expected.status === 'policy') {
      assert.equal(status, RS_SOFT_STATUS.POLICY_INELIGIBLE, `trial=${trial}`);
      assert.equal(out.erasureCount, 0, `trial=${trial}`);
      continue;
    }
    if (expected.status === 'not-ready') {
      assert.equal(status, RS_SOFT_STATUS.NOT_READY, `trial=${trial}`);
      assert.equal(out.erasureCount, 0, `trial=${trial}`);
      continue;
    }

    assert.equal(status, RS_SOFT_STATUS.OK, `trial=${trial}`);
    assert.equal(out.erasureCount, expected.best, `trial=${trial}: maximum e`);
    assert.deepEqual(
      Array.from(out.erasurePositions.subarray(0, out.erasureCount)),
      expected.order.slice(0, expected.best),
      `trial=${trial}: low-confidence stable prefix`,
    );
  }
});

test('GMD 깊이를 늘려도 같은 입력의 정확 복호 성공 집합은 축소되지 않는다', () => {
  const rng = createLcg(0x52_32_ee_04);
  const nsym = 14;
  let successfulTrials = 0;

  for (let trial = 0; trial < 24; trial += 1) {
    const message = randomMessage(rng, 40);
    const codeword = rsEncode(message, nsym);
    // Hard radius is seven. The eight lowest-confidence damaged positions become
    // decodable as soon as a rung erases at least two of them.
    const damaged = pickDistinct(codeword.length, 8, rng);
    const received = corruptAt(codeword, damaged, rng);
    const confidence = new Int16Array(codeword.length).fill(20_000);
    for (let index = 0; index < damaged.length; index += 1) {
      confidence[damaged[index]] = 8 + index;
    }

    let succeededAtShallowerDepth = false;
    for (let depth = 1; depth <= 5; depth += 1) {
      const out = createRsSoftOut(codeword.length, { gmdDepth: depth });
      const status = decodeGmdLadder(received, confidence, nsym, out);
      assert.ok(
        status === RS_SOFT_STATUS.OK || status === RS_SOFT_STATUS.REJECTED,
        `trial=${trial} depth=${depth}: 예상 밖 status=${status}`,
      );
      assert.equal(
        out.syndromeComputations,
        1,
        `trial=${trial} depth=${depth}: GMD 입력 신드롬은 한 번만 계산해야 한다`,
      );
      const exactSuccess = status === RS_SOFT_STATUS.OK
        && Boolean(out.ok && out.accepted)
        && out.codeword.subarray(0, codeword.length)
          .every((value, index) => value === codeword[index]);
      if (succeededAtShallowerDepth) {
        assert.equal(
          exactSuccess,
          true,
          `trial=${trial}: 더 깊은 GMD(${depth})가 기존 성공을 잃었다`,
        );
      }
      if (exactSuccess) succeededAtShallowerDepth = true;
    }
    if (succeededAtShallowerDepth) successfulTrials += 1;
  }

  assert.ok(successfulTrials > 0, '어느 깊이에서도 성공하지 않아 단조성 자가 공허하다');
});

test('수용 검사: 잔여 반경 안이어도 고신뢰 심볼을 다수 뒤집은 후보는 기각한다', () => {
  const candidate = createRsSoftOut(12);
  candidate.ok = 1;
  candidate.eligible = 1;
  candidate.codewordLength = 12;
  candidate.nsym = 10;
  candidate.erasureCount = 0;
  candidate.errorCount = 4;
  candidate.correctedCount = 4;
  candidate.tResidual = 5;
  candidate.correctedPositions.set([0, 1, 2, 3]);

  const confidence = Int16Array.from([
    30_000, 29_000, 28_000, 27_000,
    16_000, 15_000, 14_000, 13_000,
    40, 30, 20, 10,
  ]);
  assert.equal(
    acceptDecode(candidate, confidence, candidate.tResidual),
    false,
    'correctedCount <= tResidual만 보고 통과시키면 신뢰도 정합 검사가 무효다',
  );

  candidate.correctedPositions.set([8, 9, 10, 11]);
  assert.equal(
    acceptDecode(candidate, confidence, candidate.tResidual),
    true,
    '동일한 RS 마진에서 실제 저신뢰 위치만 고친 후보는 신뢰도 검사로 기각하면 안 된다',
  );

  candidate.erasureCount = 6;
  candidate.tResidual = 2;
  assert.equal(
    acceptDecode(candidate, confidence, 3),
    false,
    '호출자가 부풀린 tResidual로 실제 잔여 반경 2를 3으로 위장할 수 없어야 한다',
  );
});

test('수용 검사는 delta 정확 경계·음수 회계·CRC 훅을 분리해 판정한다', () => {
  const candidate = createRsSoftOut(20);
  const confidence = new Int16Array(20);
  candidate.ok = 1;
  candidate.codewordLength = 20;
  candidate.nsym = 14;
  candidate.erasureCount = 4;
  candidate.errorCount = 4;
  candidate.correctedCount = 0;
  candidate.tResidual = 5;

  assert.equal(acceptDecode(candidate, confidence, 5), true, 'parity margin=delta=2');
  candidate.errorCount = 5;
  assert.equal(acceptDecode(candidate, confidence, 5), false, 'parity margin=0');

  candidate.errorCount = 4;
  candidate.crcStatus = 0;
  assert.equal(acceptDecode(candidate, confidence, 5), false, '외부 CRC veto');
  candidate.crcStatus = 1;
  assert.equal(acceptDecode(candidate, confidence, 5), true, '외부 CRC pass');
  candidate.crcStatus = -1;
  assert.equal(acceptDecode(candidate, confidence, 5), true, 'CRC 미검사는 이 레인에서 중립');

  candidate.erasureCount = -1;
  assert.equal(acceptDecode(candidate, confidence, 5), false, '음수 소거 회계');
});

function captureViewReferences(out) {
  return Object.fromEntries(
    Object.entries(out).filter(([, value]) => ArrayBuffer.isView(value)),
  );
}

function assertViewReferencesUnchanged(out, references) {
  for (const [name, reference] of Object.entries(references)) {
    assert.equal(out[name], reference, `${name} 버퍼 참조가 호출 중 교체됐다`);
  }
}

function snapshotOut(out, codewordLength) {
  return {
    ok: out.ok,
    accepted: out.accepted,
    eligible: out.eligible,
    erasureCount: out.erasureCount,
    errorCount: out.errorCount,
    correctedCount: out.correctedCount,
    tResidual: out.tResidual,
    attemptCount: out.attemptCount,
    syndromeComputations: out.syndromeComputations,
    codeword: Array.from(out.codeword.subarray(0, codewordLength)),
    erasurePositions: Array.from(out.erasurePositions.subarray(0, out.erasureCount)),
    correctedPositions: Array.from(out.correctedPositions.subarray(0, out.correctedCount)),
  };
}

test('결정성·caller-owned out: 반복 E&E/GMD 호출은 결과와 모든 typed buffer identity를 보존한다', () => {
  const rng = createLcg(0x52_32_ee_05);
  const nsym = 14;
  const codeword = rsEncode(randomMessage(rng, 42), nsym);
  const damaged = pickDistinct(codeword.length, 8, rng);
  const received = corruptAt(codeword, damaged, rng);
  const declared = Uint16Array.from(damaged.slice(0, 4));
  const confidence = new Int16Array(codeword.length).fill(20_000);
  for (let index = 0; index < damaged.length; index += 1) {
    confidence[damaged[index]] = index;
  }

  const directOut = createRsSoftOut(codeword.length);
  const directReferences = captureViewReferences(directOut);
  assert.ok(directReferences.codeword);
  assert.ok(directReferences.erasurePositions);
  assert.ok(directReferences.correctedPositions);
  assert.equal(
    decodeErrorsAndErasures(received, nsym, declared, directOut),
    RS_SOFT_STATUS.OK,
  );
  const directFirst = snapshotOut(directOut, codeword.length);
  assert.equal(
    decodeErrorsAndErasures(received, nsym, declared, directOut),
    RS_SOFT_STATUS.OK,
  );
  assert.deepEqual(snapshotOut(directOut, codeword.length), directFirst);
  assertViewReferencesUnchanged(directOut, directReferences);

  const gmdOut = createRsSoftOut(codeword.length, { gmdDepth: 5 });
  const gmdReferences = captureViewReferences(gmdOut);
  assert.equal(
    decodeGmdLadder(received, confidence, nsym, gmdOut),
    RS_SOFT_STATUS.OK,
  );
  const gmdFirst = snapshotOut(gmdOut, codeword.length);
  assert.equal(
    decodeGmdLadder(received, confidence, nsym, gmdOut),
    RS_SOFT_STATUS.OK,
  );
  assert.deepEqual(snapshotOut(gmdOut, codeword.length), gmdFirst);
  assertViewReferencesUnchanged(gmdOut, gmdReferences);
});
