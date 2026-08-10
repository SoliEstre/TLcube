// format-proposals.js — 3중 복제 포맷 읽기의 전체 proposal 열거 (디코더 앞단 계약)
//
// decode.js는 이미 확정된 format을 받아 본문만 복호하는 후단 경계다. 포맷 후보를
// 첫 CRC 성공으로 축소하면 그 경계보다 앞에서 순서 의존성이 굳으므로, 기하 앞단은
// 이 모듈로 모든 proposal을 얻어 본문·기하 점수까지 평가한 뒤 하나를 선택한다.

import {
  CODEWORD_BITS,
  CRC_BITS,
  ECC_BITS,
  ECC_LEVEL,
  VERSION_BITS,
  crc6,
  fromDigits5,
  removeMask,
} from './formatinfo.js';

const REPLICA_COUNT = 3;
const FORMAT_DIGIT_COUNT = 5;

function assertReads(reads) {
  if (!Array.isArray(reads) || reads.length !== REPLICA_COUNT) {
    throw new TypeError('reads는 길이 3 배열이어야 한다');
  }
  for (let replicaIndex = 0; replicaIndex < REPLICA_COUNT; replicaIndex += 1) {
    const digits = reads[replicaIndex];
    if (!digits || typeof digits.length !== 'number' || typeof digits === 'string'
      || digits.length !== FORMAT_DIGIT_COUNT) {
      throw new TypeError('각 복제는 길이 5 digit 배열이어야 한다: replica ' + replicaIndex);
    }
    for (let digitIndex = 0; digitIndex < FORMAT_DIGIT_COUNT; digitIndex += 1) {
      const digit = digits[digitIndex];
      if (!Number.isInteger(digit) || digit < 0 || digit > 5) {
        throw new RangeError(
          'digit 범위 위반 (replica ' + replicaIndex + ', 위치 ' + digitIndex + '): ' + digit,
        );
      }
    }
  }
}

function normalizeVersionIndices(validVersionIndices) {
  if (validVersionIndices === undefined || validVersionIndices === null
    || typeof validVersionIndices[Symbol.iterator] !== 'function') {
    throw new TypeError('validVersionIndices는 기하 가설의 유효 version-index iterable이어야 한다');
  }

  const allowed = new Set();
  for (const versionIndex of validVersionIndices) {
    if (!Number.isInteger(versionIndex) || versionIndex < 0 || versionIndex >= (1 << VERSION_BITS)) {
      throw new RangeError('validVersionIndices의 값은 0..15 정수여야 한다: ' + versionIndex);
    }
    allowed.add(versionIndex);
  }
  return allowed;
}

function summarizeConsensus(reads) {
  const states = [];
  const majorityDigits = new Array(FORMAT_DIGIT_COUNT).fill(0);
  let threeOfThree = 0;
  let twoOfThree = 0;
  let noConsensus = 0;

  for (let digitIndex = 0; digitIndex < FORMAT_DIGIT_COUNT; digitIndex += 1) {
    const counts = new Map();
    for (const digits of reads) counts.set(digits[digitIndex], (counts.get(digits[digitIndex]) ?? 0) + 1);

    let bestDigit = reads[0][digitIndex];
    let bestCount = 0;
    for (const [digit, count] of counts) {
      if (count > bestCount) {
        bestDigit = digit;
        bestCount = count;
      }
    }
    majorityDigits[digitIndex] = bestDigit;

    if (bestCount === REPLICA_COUNT) {
      states.push('3/3');
      threeOfThree += 1;
    } else if (bestCount === REPLICA_COUNT - 1) {
      states.push('2/3');
      twoOfThree += 1;
    } else {
      states.push('none');
      noConsensus += 1;
    }
  }

  return {
    states,
    threeOfThree,
    twoOfThree,
    noConsensus,
    majorityDigits,
  };
}

function copyConsensus(consensus) {
  return {
    states: consensus.states.slice(),
    threeOfThree: consensus.threeOfThree,
    twoOfThree: consensus.twoOfThree,
    noConsensus: consensus.noConsensus,
  };
}

function collectRawProposals(reads, consensus) {
  const byDigits = new Map();

  const add = (maskedDigits, source, replicaIndex) => {
    const digits = Array.from(maskedDigits);
    const key = digits.join(',');
    let candidate = byDigits.get(key);
    if (!candidate) {
      candidate = { maskedDigits: digits, sources: [], replicaIndices: [] };
      byDigits.set(key, candidate);
    }
    candidate.sources.push(source);
    if (replicaIndex !== undefined) candidate.replicaIndices.push(replicaIndex);
  };

  // §5.1: 다섯 위치 모두에 2/3 이상 합의가 있을 때만 다수결 proposal을 만든다.
  if (consensus.noConsensus === 0) add(consensus.majorityDigits, 'majority');

  // 다수결 성공 여부와 무관하게 개별 복제를 보존한다. formatinfo.decode()의 fallback을
  // 잃지 않으면서도, 첫 CRC 성공이 아닌 후보 전체 평가를 가능하게 한다.
  for (let replicaIndex = 0; replicaIndex < REPLICA_COUNT; replicaIndex += 1) {
    add(reads[replicaIndex], 'replica-' + replicaIndex, replicaIndex);
  }

  return Array.from(byDigits.values());
}

/**
 * 3중 복제 포맷 digit에서 기하 가설에 가능한 proposal을 전부 만든다.
 *
 * 같은 5-digit 값은 하나로 병합하며 sources와 replicaIndices에 지지 근거를 보존한다.
 * source는 결정적 대표값(majority 우선, 아니면 가장 낮은 replica)을 제공한다.
 * 의미론에서 기각된 값은 proposal로 누설하지 않고 diagnostics에만 센다. CRC 불일치는
 * proposal에 남겨 crcOk:false로 표시한다. 이것이 후보 전체를 평가할 수 있게 하며,
 * 호출자가 첫 CRC 성공에서 반환하는 것을 금지한다.
 *
 * @param {number[][]} reads 마스크 적용된 3복제 × 5 digit 읽기값
 * @param {{validVersionIndices: Iterable<number>}} options
 *   기하로 확정한 현재 패밀리의 유효 version-index 집합
 * @returns {{
 *   proposals: Array<{
 *     versionIndex:number,
 *     eccLevel:number,
 *     crcOk:boolean,
 *     consensus:{states:string[], threeOfThree:number, twoOfThree:number, noConsensus:number},
 *     source:string,
 *     sources:string[],
 *     replicaIndices:number[],
 *     maskedDigits:number[],
 *   }>,
 *   diagnostics:{
 *     generated:{majority:number, replicas:number, unique:number},
 *     semanticRejected:{codewordOutOfRange:number, reservedEcc:number, versionOutsideFamily:number},
 *     crcChecked:number,
 *     crcOk:number,
 *     crcFailed:number,
 *   },
 * }}
 */
export function enumerateFormatProposals(reads, { validVersionIndices } = {}) {
  assertReads(reads);
  const allowedVersions = normalizeVersionIndices(validVersionIndices);
  const consensus = summarizeConsensus(reads);
  const candidates = collectRawProposals(reads, consensus);
  const diagnostics = {
    generated: {
      majority: consensus.noConsensus === 0 ? 1 : 0,
      replicas: REPLICA_COUNT,
      unique: candidates.length,
    },
    semanticRejected: {
      codewordOutOfRange: 0,
      reservedEcc: 0,
      versionOutsideFamily: 0,
    },
    crcChecked: 0,
    crcOk: 0,
    crcFailed: 0,
  };
  const proposals = [];

  for (const candidate of candidates) {
    const codeword = fromDigits5(removeMask(candidate.maskedDigits));
    if (codeword >= (1 << CODEWORD_BITS)) {
      diagnostics.semanticRejected.codewordOutOfRange += 1;
      continue;
    }

    const payload = codeword >> CRC_BITS;
    const crcField = codeword & ((1 << CRC_BITS) - 1);
    const versionIndex = payload >> ECC_BITS;
    const eccLevel = payload & ((1 << ECC_BITS) - 1);

    // §5.2: 값싼 의미론 reject는 CRC보다 먼저다. 예약 ECC/다른 패밀리의 버전은
    // CRC가 우연히 맞아도 현재 기하 가설의 후보가 될 수 없다.
    if (eccLevel === ECC_LEVEL.RESERVED) {
      diagnostics.semanticRejected.reservedEcc += 1;
      continue;
    }
    if (!allowedVersions.has(versionIndex)) {
      diagnostics.semanticRejected.versionOutsideFamily += 1;
      continue;
    }

    diagnostics.crcChecked += 1;
    const crcOk = crc6(payload) === crcField;
    if (crcOk) diagnostics.crcOk += 1;
    else diagnostics.crcFailed += 1;

    proposals.push({
      versionIndex,
      eccLevel,
      crcOk,
      consensus: copyConsensus(consensus),
      source: candidate.sources.includes('majority') ? 'majority' : candidate.sources[0],
      sources: candidate.sources.slice(),
      replicaIndices: candidate.replicaIndices.slice(),
      maskedDigits: candidate.maskedDigits.slice(),
    });
  }

  return { proposals, diagnostics };
}
