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
  CODEWORD_BITS_V2,
  DIGIT_COUNT_V2,
  MASK_BITS_V2,
  RESERVED_BITS_V2,
  MASK_INDEX_RESERVED,
  crc6v2,
  fromDigits6,
  removeMaskV2,
} from './formatinfo.js';

const REPLICA_COUNT = 3;
const FORMAT_DIGIT_COUNT = 5;

/**
 * `null` 은 "이 자리는 프레임 밖이라 관측이 없다"는 **소거** 표시다. 0..5 정수와
 * 구분된다 — 0을 대신 넣으면 잘린 복제가 멀쩡한 관측인 척 다수결에 참여해서
 * 나머지 두 복제를 이긴다. 이 구분이 no-format-candidate 구제의 전부다.
 *
 * **세대 무관**이다. v1(5 digit) · v2(6 digit) 어느 쪽 워드를 읽든 잘린 자리는
 * 같은 `null` 로 표시되고, 아래 함수들은 전부 `digitCount` 를 받아 두 세대에서
 * 같은 소거 규칙을 돌린다. 세대별로 소거 규칙이 갈리면 폴백 경로(v2 → v1)에서
 * 한쪽만 구제되는 비대칭이 생긴다.
 */
function isErasedDigit(digit) {
  return digit === null;
}

/** 한 자리라도 소거가 있는 복제 수. 그 복제는 개별 proposal 이 될 수 없다. */
function countErasedReplicas(reads, digitCount) {
  let erasedReplicas = 0;
  for (let replicaIndex = 0; replicaIndex < REPLICA_COUNT; replicaIndex += 1) {
    for (let digitIndex = 0; digitIndex < digitCount; digitIndex += 1) {
      if (isErasedDigit(reads[replicaIndex][digitIndex])) {
        erasedReplicas += 1;
        break;
      }
    }
  }
  return erasedReplicas;
}

function assertReads(reads, digitCount = FORMAT_DIGIT_COUNT) {
  if (!Array.isArray(reads) || reads.length !== REPLICA_COUNT) {
    throw new TypeError('reads는 길이 3 배열이어야 한다');
  }
  for (let replicaIndex = 0; replicaIndex < REPLICA_COUNT; replicaIndex += 1) {
    const digits = reads[replicaIndex];
    if (!digits || typeof digits.length !== 'number' || typeof digits === 'string'
      || digits.length !== digitCount) {
      throw new TypeError(
        '각 복제는 길이 ' + digitCount + ' digit 배열이어야 한다: replica ' + replicaIndex,
      );
    }
    for (let digitIndex = 0; digitIndex < digitCount; digitIndex += 1) {
      const digit = digits[digitIndex];
      if (isErasedDigit(digit)) continue;
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

/**
 * ### 신규 수용 표면 — 「**생존자 키메라**(survivor chimera)」
 *
 * 소거를 도입하면서 **이전에는 도달할 수 없던 후보 한 종류가 새로 생겼다.** 이름을
 * 붙여 둔다 — 이름이 없으면 방어선도 없다.
 *
 * 자리마다 «살아남은 복제» 가 다를 수 있다. 위치 0 은 복제 0·1 이, 위치 1 은 복제
 * 2 만 살아 있을 수 있다. 그러면 `majorityDigits` 는 **어느 한 복제에서도 통째로
 * 관측된 적이 없는 digitCount-digit 조합**이 된다 — 자리별 관측을 이어 붙인 키메라다.
 * 변경 전에는 `readFormatForHypothesis` 가 첫 미표본 셀에서 죽었으므로 이 조합은
 * 만들어질 수조차 없었다. **퇴행이 아니라 신규 표면이다.**
 *
 * 같은 파일이 «빈자리를 0 으로 메운 복제» 를 날조라며 개별 proposal 에서 빼는데,
 * 키메라는 만든다. 그 비대칭이 정당한 근거는 하나뿐이다:
 *
 * 1. **자리별로는 전부 실관측이다.** 어떤 digit 도 지어내지 않는다 — 각 자리의 값은
 *    그 자리에서 실제로 읽힌 값 중 하나이며, 유일 최다일 때만 채택된다
 *    (`bestCount > runnerUpCount`). 0 으로 메우는 것과 여기서 갈린다.
 * 2. **한 자리라도 관측이 0 이면 키메라를 만들지 않는다** (`known === 0` →
 *    `noConsensus += 1` → 다수결 proposal 자체가 안 선다).
 *
 * 그 대가로 **키메라의 방어선은 ECC 가 아니라 CRC-6 하나다** — v1 은 5-digit 공간
 * 7776 중 CRC 유효 64 개(약 0.82 %), v2 는 6-digit 공간 46656 중 CRC 유효 512 개
 * (약 1.10 %)만 통과한다. v2 는 예약 필드 3종(ECC 3 · 마스크 index 3 · 예약 bit)을
 * CRC 보다 **먼저** 거부하므로 실제로 남는 것은 144 개(약 0.31 %)다. 소비자
 * (`bootstrap.js`)는 두 세대 모두 `crcOk` 를 하드 게이트로 쓴다. 그 뒤는 본문 RS 가
 * 받는다. 잘림·가림·skew 전 축(1331 ok 행)에서 오수용 실측 0 이지만 **«0 을 쟀다»
 * 이지 «0 임을 증명했다» 가 아니다.** 이 표면을 넓히는 변경(예: 정족수 완화,
 * `crcOk:false` 후보 승격)은 그 두 근거를 다시 세워야 한다. 계약은
 * `test/format-proposals.test.js` (v1) 와 `test/format-erasure-generations.test.js`
 * (v2 + 폴백) 의 생존자 키메라 테스트가 고정한다.
 *
 * **세대 무관**: v2(6 digit)도 같은 함수를 `digitCount = 6` 으로 돈다. 키메라의
 * 자릿수만 늘 뿐 ①②의 근거는 그대로다.
 */
function summarizeConsensus(reads, digitCount = FORMAT_DIGIT_COUNT) {
  const states = [];
  const majorityDigits = new Array(digitCount).fill(0);
  let threeOfThree = 0;
  let twoOfThree = 0;
  let noConsensus = 0;
  let erasedPositions = 0;
  let survivorDecided = 0;

  for (let digitIndex = 0; digitIndex < digitCount; digitIndex += 1) {
    const counts = new Map();
    let known = 0;
    for (const digits of reads) {
      const digit = digits[digitIndex];
      if (isErasedDigit(digit)) continue;
      known += 1;
      counts.set(digit, (counts.get(digit) ?? 0) + 1);
    }

    // 소거된 복제는 표에서 빠진다. 정족수는 «남은 관측» 기준으로 다시 센다.
    let bestDigit = null;
    let bestCount = 0;
    let runnerUpCount = 0;
    for (const [digit, count] of counts) {
      if (count > bestCount) {
        runnerUpCount = bestCount;
        bestDigit = digit;
        bestCount = count;
      } else if (count > runnerUpCount) {
        runnerUpCount = count;
      }
    }
    majorityDigits[digitIndex] = bestDigit === null ? 0 : bestDigit;

    if (known === 0) {
      // 세 복제 모두 프레임 밖 — 이 자리는 어떤 값도 주장할 수 없다.
      states.push('erased');
      erasedPositions += 1;
      noConsensus += 1;
      continue;
    }
    if (known === REPLICA_COUNT && bestCount === REPLICA_COUNT) {
      states.push('3/3');
      threeOfThree += 1;
    } else if (known === REPLICA_COUNT && bestCount === REPLICA_COUNT - 1) {
      states.push('2/3');
      twoOfThree += 1;
    } else if (bestCount > runnerUpCount) {
      // 소거 뒤 남은 관측이 1~2개고 그중 최다가 유일 — 잘린 복제를 뺀 다수결이다.
      states.push(bestCount + '/' + known);
      survivorDecided += 1;
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
    erasedPositions,
    survivorDecided,
    majorityDigits,
  };
}

function copyConsensus(consensus) {
  return {
    states: consensus.states.slice(),
    threeOfThree: consensus.threeOfThree,
    twoOfThree: consensus.twoOfThree,
    noConsensus: consensus.noConsensus,
    erasedPositions: consensus.erasedPositions,
    survivorDecided: consensus.survivorDecided,
  };
}

function collectRawProposals(reads, consensus, digitCount = FORMAT_DIGIT_COUNT) {
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

  // §5.1: 모든 위치에 합의가 있을 때만 다수결 proposal을 만든다 (v1 다섯 · v2 여섯).
  // 소거된 복제를 뺀 뒤의 정족수도 여기에 포함된다 (noConsensus가 그 판정을 담는다).
  if (consensus.noConsensus === 0) add(consensus.majorityDigits, 'majority');

  // 다수결 성공 여부와 무관하게 개별 복제를 보존한다. formatinfo.decode()의 fallback을
  // 잃지 않으면서도, 첫 CRC 성공이 아닌 후보 전체 평가를 가능하게 한다.
  // 단 **소거 digit이 하나라도 있는 복제는 제외한다** — 그 복제는 온전한 코드워드를
  // 이룰 수 없고, 빈자리를 0으로 메운 값은 관측이 아니라 날조다.
  // `digitCount` 를 반드시 세대에 맞춰 받아야 한다. 5 로 고정하면 v2 의 6번째 자리만
  // 소거된 복제가 «온전» 으로 통과해 `null` 이 `fromDigits6` 에 흘러든다.
  for (let replicaIndex = 0; replicaIndex < REPLICA_COUNT; replicaIndex += 1) {
    const digits = reads[replicaIndex];
    let complete = true;
    for (let digitIndex = 0; digitIndex < digitCount; digitIndex += 1) {
      if (isErasedDigit(digits[digitIndex])) {
        complete = false;
        break;
      }
    }
    if (complete) add(digits, 'replica-' + replicaIndex, replicaIndex);
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
  const consensus = summarizeConsensus(reads, FORMAT_DIGIT_COUNT);
  const candidates = collectRawProposals(reads, consensus, FORMAT_DIGIT_COUNT);
  const erasedReplicas = countErasedReplicas(reads, FORMAT_DIGIT_COUNT);
  const diagnostics = {
    generated: {
      majority: consensus.noConsensus === 0 ? 1 : 0,
      replicas: REPLICA_COUNT - erasedReplicas,
      erasedReplicas,
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

/**
 * 포맷 **v2**(6 digit) 판. 구조·순서·진단 필드는 v1 과 같고 바뀐 것은 셋뿐이다:
 * digit 수 6 · 코드워드 15bit · proposal 에 `maskIndex` 가 붙는다.
 *
 * **소거 인지 다수결은 v1 과 같은 코드다** — `assertReads` · `summarizeConsensus` ·
 * `collectRawProposals` 를 `digitCount = 6` 으로 공유한다. 즉 `null`(프레임 밖) digit
 * 은 v2 에서도 다수결 표에서 빠지고, 소거가 있는 복제는 개별 proposal 이 되지 않으며,
 * 생존자 키메라의 방어선(①자리별 실관측 ②동수면 포기 ③CRC 하드 게이트 ④관측 0 이면
 * 포기)도 그대로 승계된다. 세대별로 갈리면 폴백 경로(v2 → v1)에서 한쪽만 구제된다.
 *
 * @param {Array<Array<number|null>>} reads 마스크 적용된 3복제 × 6 digit 읽기값
 *   (`null` = 소거)
 * @param {{validVersionIndices: Iterable<number>}} options
 * @returns {{proposals:Array<object>, diagnostics:object}} v1 과 같은 모양 +
 *   `proposals[].maskIndex` · `diagnostics.semanticRejected.reservedMask` ·
 *   `diagnostics.semanticRejected.reservedBitSet`
 */
export function enumerateFormatProposalsV2(reads, { validVersionIndices } = {}) {
  assertReads(reads, DIGIT_COUNT_V2);
  const allowedVersions = normalizeVersionIndices(validVersionIndices);
  const consensus = summarizeConsensus(reads, DIGIT_COUNT_V2);
  const candidates = collectRawProposals(reads, consensus, DIGIT_COUNT_V2);
  const erasedReplicas = countErasedReplicas(reads, DIGIT_COUNT_V2);
  const diagnostics = {
    generated: {
      majority: consensus.noConsensus === 0 ? 1 : 0,
      replicas: REPLICA_COUNT - erasedReplicas,
      erasedReplicas,
      unique: candidates.length,
    },
    semanticRejected: {
      codewordOutOfRange: 0,
      reservedEcc: 0,
      versionOutsideFamily: 0,
      reservedMask: 0,
      reservedBitSet: 0,
    },
    crcChecked: 0,
    crcOk: 0,
    crcFailed: 0,
  };
  const proposals = [];

  for (const candidate of candidates) {
    const codeword = fromDigits6(removeMaskV2(candidate.maskedDigits));
    if (codeword >= (1 << CODEWORD_BITS_V2)) {
      diagnostics.semanticRejected.codewordOutOfRange += 1;
      continue;
    }

    const payload = codeword >> CRC_BITS;
    const crcField = codeword & ((1 << CRC_BITS) - 1);
    const reserved = payload & ((1 << RESERVED_BITS_V2) - 1);
    const maskIndex = (payload >> RESERVED_BITS_V2) & ((1 << MASK_BITS_V2) - 1);
    const eccLevel = (payload >> (RESERVED_BITS_V2 + MASK_BITS_V2)) & ((1 << ECC_BITS) - 1);
    const versionIndex = payload >> (RESERVED_BITS_V2 + MASK_BITS_V2 + ECC_BITS);

    // 값싼 의미론 reject 는 CRC 보다 먼저 (v1 §5.2 규약 승계).
    if (eccLevel === ECC_LEVEL.RESERVED) {
      diagnostics.semanticRejected.reservedEcc += 1;
      continue;
    }
    if (maskIndex === MASK_INDEX_RESERVED) {
      diagnostics.semanticRejected.reservedMask += 1;
      continue;
    }
    if (reserved !== 0) {
      diagnostics.semanticRejected.reservedBitSet += 1;
      continue;
    }
    if (!allowedVersions.has(versionIndex)) {
      diagnostics.semanticRejected.versionOutsideFamily += 1;
      continue;
    }

    diagnostics.crcChecked += 1;
    const crcOk = crc6v2(payload) === crcField;
    if (crcOk) diagnostics.crcOk += 1;
    else diagnostics.crcFailed += 1;

    proposals.push({
      versionIndex,
      eccLevel,
      maskIndex,
      reserved,
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
