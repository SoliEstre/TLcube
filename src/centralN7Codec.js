/**
 * centralN7Codec.js — 중앙 n=7의 19-digit payload codec.
 *
 * wire: (family 1 + 기존 바깥 포맷 5) digit을 세 번 복제한 18셀 + 합 체크섬 1셀.
 * 세 복제본 중 둘이 6digit 전체에서 같을 때만 후보를 만들며, 바깥 포맷의 기존
 * CRC-6과 합 체크섬을 모두 통과해야 한다. 단 체크섬 셀 하나만 틀린 경우는 세
 * 복제본이 모두 같다는 더 강한 증거가 있을 때에만 복원한다.
 */

import { decodeSingle as decodeOuterFormat } from './formatinfo.js';
import {
  CENTRAL_N7_CHECKSUM_SCAN_INDEX,
  CENTRAL_N7_FAMILIES,
  CENTRAL_N7_REPETITIONS,
  CENTRAL_N7_SEMANTIC_DIGITS,
  centralN7ScanIndex,
} from './centralN7Schema.js';

export const CENTRAL_N7_DIGIT_BASE = 6;
export const CENTRAL_N7_OUTER_FORMAT_DIGITS = 5;
export const CENTRAL_N7_WIRE_DIGITS = 19;

function isDigit(value) {
  return Number.isInteger(value) && value >= 0 && value < CENTRAL_N7_DIGIT_BASE;
}

function assertOuterFormat(outerFormat) {
  if (!Array.isArray(outerFormat)
    || outerFormat.length !== CENTRAL_N7_OUTER_FORMAT_DIGITS) {
    throw new TypeError('outerFormat은 길이 5인 base-6 digit 배열이어야 한다');
  }
  for (let index = 0; index < outerFormat.length; index += 1) {
    if (!isDigit(outerFormat[index])) {
      throw new RangeError('outerFormat digit 범위 위반 (' + index + '): ' + outerFormat[index]);
    }
  }
  if (!decodeOuterFormat(outerFormat).ok) {
    throw new RangeError('outerFormat이 현행 5-digit CRC-6 포맷 코드워드가 아니다');
  }
  return outerFormat;
}

function semanticChecksum(semantic) {
  return semantic.reduce((sum, digit) => (sum + digit) % CENTRAL_N7_DIGIT_BASE, 0);
}

function sameDigits(a, b) {
  return a.every((digit, index) => digit === b[index]);
}

function semanticFromInput(family, outerFormat) {
  const familyDigit = CENTRAL_N7_FAMILIES.indexOf(family);
  if (familyDigit < 0) throw new RangeError('알 수 없는 중앙 n=7 family: ' + family);
  assertOuterFormat(outerFormat);
  return [familyDigit, ...outerFormat];
}

/**
 * @param {{family:'hex'|'tri'|'star', outerFormat:number[]}} info
 * @returns {number[]} scan order와 같은 길이 19의 base-6 digit 배열
 */
export function encodeCentralN7(info) {
  if (info === null || typeof info !== 'object') {
    throw new TypeError('중앙 n=7 payload 객체가 필요하다');
  }
  const semantic = semanticFromInput(info.family, info.outerFormat);
  const digits = new Array(CENTRAL_N7_WIRE_DIGITS);
  for (let semanticIndex = 0;
    semanticIndex < CENTRAL_N7_SEMANTIC_DIGITS;
    semanticIndex += 1) {
    for (let replica = 0; replica < CENTRAL_N7_REPETITIONS; replica += 1) {
      digits[centralN7ScanIndex(semanticIndex, replica)] = semantic[semanticIndex];
    }
  }
  digits[CENTRAL_N7_CHECKSUM_SCAN_INDEX] = semanticChecksum(semantic);
  return digits;
}

function readReplicas(digits) {
  return Array.from({ length: CENTRAL_N7_REPETITIONS }, (unused, replica) =>
    Array.from(
      { length: CENTRAL_N7_SEMANTIC_DIGITS },
      (alsoUnused, semantic) => digits[centralN7ScanIndex(semantic, replica)],
    ));
}

function decodeSemantic(semantic) {
  const family = CENTRAL_N7_FAMILIES[semantic[0]];
  if (family === undefined) return null;
  const outerFormat = semantic.slice(1);
  let formatResult;
  try {
    formatResult = decodeOuterFormat(outerFormat);
  } catch {
    return null;
  }
  if (!formatResult.ok) return null;
  return { family, outerFormat };
}

/**
 * 형식·CRC·합의·체크섬 중 하나라도 실패하면 항상 null을 반환한다.
 * @param {number[]} digits 길이 19의 base-6 digit 배열
 * @returns {{family:'hex'|'tri'|'star', outerFormat:number[]}|null}
 */
export function decodeCentralN7(digits) {
  if (!Array.isArray(digits) || digits.length !== CENTRAL_N7_WIRE_DIGITS) return null;
  if (digits.some((digit) => !isDigit(digit))) return null;

  const replicas = readReplicas(digits);
  const candidateSemantics = [];
  for (let a = 0; a < replicas.length; a += 1) {
    for (let b = a + 1; b < replicas.length; b += 1) {
      if (!sameDigits(replicas[a], replicas[b])) continue;
      if (!candidateSemantics.some((candidate) => sameDigits(candidate, replicas[a]))) {
        candidateSemantics.push(replicas[a]);
      }
    }
  }
  if (candidateSemantics.length !== 1) return null;

  const semantic = candidateSemantics[0];
  const decoded = decodeSemantic(semantic);
  if (decoded === null) return null;

  const expectedChecksum = semanticChecksum(semantic);
  const checksumMatches = digits[CENTRAL_N7_CHECKSUM_SCAN_INDEX] === expectedChecksum;
  const allReplicasAgree = replicas.every((replica) => sameDigits(replica, semantic));

  // 체크섬이 맞으면 한 복제본 전체 오염까지 복원한다. 체크섬이 틀리면 오직 세
  // 복제본이 전부 같은 경우(즉 체크섬 셀 하나만 오류)만 복원한다.
  if (!checksumMatches && !allReplicasAgree) return null;
  return decoded;
}

