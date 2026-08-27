import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { encode as encodeOuterFormat } from '../src/formatinfo.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { CENTRAL_MARKER_N7_FINDER_PATTERN_ID } from '../src/centralMarkerN7.js';
import {
  CENTRAL_N7_CHECKSUM_SCAN_INDEX,
  CENTRAL_N7_DATA_SCAN_ORDER,
  CENTRAL_N7_FAMILIES,
  CENTRAL_N7_FINDER_PATTERN_ID,
  CENTRAL_N7_LOCAL_BURST_PATTERN_COUNT,
  CENTRAL_N7_LOCAL_BURST_RECOVERABLE_PATTERNS,
  CENTRAL_N7_LOCATOR_CELLS,
  CENTRAL_N7_PATTERN_FAMILY_ID,
  CENTRAL_N7_REPLICA_SCAN_INDEXES,
  CENTRAL_N7_REPETITIONS,
  CENTRAL_N7_SCHEMA_ID,
  CENTRAL_N7_SEMANTIC_DIGITS,
  CENTRAL_N7_SIZE,
  centralN7ReanchorCoordinate,
  centralN7ScanIndex,
} from '../src/centralN7Schema.js';
import {
  CENTRAL_N7_DIGIT_BASE,
  CENTRAL_N7_WIRE_DIGITS,
  decodeCentralN7,
  encodeCentralN7,
} from '../src/centralN7Codec.js';
import { centralV0FinderCells } from '../src/cellSurfaceFinal.js';

const OUTER_FORMATS = Object.freeze([
  Object.freeze(encodeOuterFormat({ version: 0, eccLevel: 0 })),
  Object.freeze(encodeOuterFormat({ version: 7, eccLevel: 2 })),
  Object.freeze(encodeOuterFormat({ version: 15, eccLevel: 1 })),
]);

const BURST_OUTER_FORMATS = Object.freeze([
  ...OUTER_FORMATS,
  Object.freeze(encodeOuterFormat({ version: 3, eccLevel: 2 })),
]);

function key({ i, j }) {
  return i + ',' + j;
}

function mutate(digits, index, delta = 1) {
  const copy = digits.slice();
  copy[index] = (copy[index] + delta) % CENTRAL_N7_DIGIT_BASE;
  return copy;
}

function assertDecoded(result, family, outerFormat) {
  assert.notEqual(result, null);
  assert.equal(result.family, family);
  assert.deepEqual(result.outerFormat, outerFormat);
}

describe('중앙 n=7 스키마 정본', () => {
  test('새 ID 셋은 서로 다르고 기존 v0·후보 B와 겹치지 않는다', () => {
    const ids = [
      CENTRAL_N7_FINDER_PATTERN_ID,
      CENTRAL_N7_PATTERN_FAMILY_ID,
      CENTRAL_N7_SCHEMA_ID,
      CENTRAL_V0_FINDER_PATTERN_ID,
      CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    ];
    assert.equal(new Set(ids).size, ids.length);
  });

  test('v0의 양 edge inset을 보존해 30셀을 n=7로 재앵커한다', () => {
    const source = centralV0FinderCells();
    assert.equal(source.length, 30);
    assert.equal(CENTRAL_N7_LOCATOR_CELLS.length, source.length);
    for (let index = 0; index < source.length; index += 1) {
      const before = source[index];
      const after = CENTRAL_N7_LOCATOR_CELLS[index];
      assert.equal(after.i, centralN7ReanchorCoordinate(before.i));
      assert.equal(after.j, centralN7ReanchorCoordinate(before.j));
      assert.deepEqual([after.T, after.L, after.R], [before.T, before.L, before.R]);
    }
  });

  test('로케이터 30 + 데이터 19 = 7×7이며 중복·누락이 없다', () => {
    assert.equal(CENTRAL_N7_LOCATOR_CELLS.length, 30);
    assert.equal(CENTRAL_N7_DATA_SCAN_ORDER.length, 19);
    const all = [...CENTRAL_N7_LOCATOR_CELLS, ...CENTRAL_N7_DATA_SCAN_ORDER];
    assert.equal(all.length, CENTRAL_N7_SIZE ** 2);
    assert.equal(new Set(all.map(key)).size, CENTRAL_N7_SIZE ** 2);
    for (const { i, j } of all) {
      assert.ok(i >= 0 && i < CENTRAL_N7_SIZE);
      assert.ok(j >= 0 && j < CENTRAL_N7_SIZE);
    }

    // 비대칭 계단형이라는 기하 성질만 잰다. 좌표 배열 전체를 스냅샷하지 않는다.
    const dataByRow = Array.from({ length: CENTRAL_N7_SIZE }, () => 0);
    for (const { j } of CENTRAL_N7_DATA_SCAN_ORDER) dataByRow[j] += 1;
    assert.deepEqual(dataByRow, [1, 1, 4, 7, 2, 2, 2]);
  });

  test('체크섬은 중앙이고 같은 복제본 여섯 셀은 국소적으로 뭉친다', () => {
    assert.deepEqual(CENTRAL_N7_DATA_SCAN_ORDER[CENTRAL_N7_CHECKSUM_SCAN_INDEX], { i: 3, j: 3 });
    let withinReplicaDistanceCost = 0;
    for (const scanIndexes of CENTRAL_N7_REPLICA_SCAN_INDEXES) {
      assert.equal(scanIndexes.length, CENTRAL_N7_SEMANTIC_DIGITS);
      const cells = scanIndexes.map((scanIndex) => CENTRAL_N7_DATA_SCAN_ORDER[scanIndex]);
      for (let a = 0; a < cells.length; a += 1) {
        for (let b = a + 1; b < cells.length; b += 1) {
          const di = cells[a].i - cells[b].i;
          const dj = cells[a].j - cells[b].j;
          withinReplicaDistanceCost += di * di + dj * dj;
        }
      }
    }
    assert.ok(withinReplicaDistanceCost <= 162);
    assert.equal(CENTRAL_N7_LOCAL_BURST_PATTERN_COUNT, 57);
    assert.equal(CENTRAL_N7_LOCAL_BURST_RECOVERABLE_PATTERNS, 28);
  });
});

describe('중앙 n=7 codec', () => {
  test('모든 family × 대표 outerFormat이 왕복하고 출력이 결정적이다', () => {
    for (const family of CENTRAL_N7_FAMILIES) {
      for (const outerFormat of OUTER_FORMATS) {
        const first = encodeCentralN7({ family, outerFormat: [...outerFormat] });
        const second = encodeCentralN7({ family, outerFormat: [...outerFormat] });
        assert.deepEqual(first, second);
        assert.equal(first.length, CENTRAL_N7_WIRE_DIGITS);
        assert.ok(first.every((digit) => Number.isInteger(digit)
          && digit >= 0 && digit < CENTRAL_N7_DIGIT_BASE));
        assertDecoded(decodeCentralN7(first), family, outerFormat);
      }
    }
  });

  test('family를 첫 의미 digit에 직접 싣는다', () => {
    const outerFormat = OUTER_FORMATS[0];
    const familyDigits = CENTRAL_N7_FAMILIES.map((family) => {
      const digits = encodeCentralN7({ family, outerFormat: [...outerFormat] });
      return Array.from({ length: CENTRAL_N7_REPETITIONS }, (unused, replica) =>
        digits[centralN7ScanIndex(0, replica)]);
    });
    assert.deepEqual(familyDigits, [[0, 0, 0], [1, 1, 1], [2, 2, 2]]);
  });

  test('19셀 어느 한 곳의 단일 digit 오류도 복원한다', () => {
    let correct = 0;
    for (const family of CENTRAL_N7_FAMILIES) {
      for (const outerFormat of OUTER_FORMATS) {
        const good = encodeCentralN7({ family, outerFormat: [...outerFormat] });
        for (let index = 0; index < good.length; index += 1) {
          for (let delta = 1; delta < CENTRAL_N7_DIGIT_BASE; delta += 1) {
            assertDecoded(decodeCentralN7(mutate(good, index, delta)), family, outerFormat);
            correct += 1;
          }
        }
      }
    }
    assert.equal(correct, 855);
  });

  test('국소 원판 오염 복원율은 336/684 이상이고 오복원은 없다', () => {
    const countsByRadius = [];
    const totals = { correct: 0, rejected: 0, wrong: 0 };
    for (const radiusSquared of [1, 2, 4]) {
      const counts = { correct: 0, rejected: 0, wrong: 0 };
      for (const centre of CENTRAL_N7_DATA_SCAN_ORDER) {
        for (const family of CENTRAL_N7_FAMILIES) {
          for (const outerFormat of BURST_OUTER_FORMATS) {
            const bad = encodeCentralN7({ family, outerFormat: [...outerFormat] });
            for (let index = 0; index < CENTRAL_N7_DATA_SCAN_ORDER.length; index += 1) {
              const cell = CENTRAL_N7_DATA_SCAN_ORDER[index];
              const di = cell.i - centre.i;
              const dj = cell.j - centre.j;
              if (di * di + dj * dj <= radiusSquared) {
                bad[index] = (bad[index] + 1) % CENTRAL_N7_DIGIT_BASE;
              }
            }
            const result = decodeCentralN7(bad);
            if (result === null) counts.rejected += 1;
            else if (result.family === family
              && result.outerFormat.every((digit, index) => digit === outerFormat[index])) {
              counts.correct += 1;
            } else counts.wrong += 1;
          }
        }
      }
      countsByRadius.push(counts.correct);
      totals.correct += counts.correct;
      totals.rejected += counts.rejected;
      totals.wrong += counts.wrong;
    }
    assert.deepEqual(countsByRadius, [144, 120, 72]);
    assert.ok(totals.correct >= 336);
    assert.equal(totals.correct + totals.rejected + totals.wrong, 684);
    assert.equal(totals.wrong, 0);
  });

  test('한 복제본의 가능한 6^6 상태 × 세 위치를 전수해 모두 복원한다', () => {
    const family = 'star';
    const outerFormat = OUTER_FORMATS[1];
    const good = encodeCentralN7({ family, outerFormat: [...outerFormat] });
    let correct = 0;
    let rejected = 0;
    let wrong = 0;
    for (let replica = 0; replica < CENTRAL_N7_REPETITIONS; replica += 1) {
      for (let value = 0;
        value < CENTRAL_N7_DIGIT_BASE ** CENTRAL_N7_SEMANTIC_DIGITS;
        value += 1) {
        let rest = value;
        const corrupted = good.slice();
        for (let semantic = CENTRAL_N7_SEMANTIC_DIGITS - 1; semantic >= 0; semantic -= 1) {
          corrupted[centralN7ScanIndex(semantic, replica)] = rest % CENTRAL_N7_DIGIT_BASE;
          rest = Math.floor(rest / CENTRAL_N7_DIGIT_BASE);
        }
        const result = decodeCentralN7(corrupted);
        if (result === null) rejected += 1;
        else if (result.family === family
          && result.outerFormat.every((digit, index) => digit === outerFormat[index])) correct += 1;
        else wrong += 1;
      }
    }
    assert.deepEqual(
      { correct, rejected, wrong },
      { correct: 139_968, rejected: 0, wrong: 0 },
    );
  });

  test('서로 다른 두 셀 오류 4,275종은 1,125 정복원 · 3,150 거부 · 오복원 0이다', () => {
    const family = 'tri';
    const outerFormat = OUTER_FORMATS[2];
    const good = encodeCentralN7({ family, outerFormat: [...outerFormat] });
    const counts = { correct: 0, rejected: 0, wrong: 0 };
    for (let first = 0; first < CENTRAL_N7_WIRE_DIGITS; first += 1) {
      for (let second = first + 1; second < CENTRAL_N7_WIRE_DIGITS; second += 1) {
        for (let firstDelta = 1; firstDelta < CENTRAL_N7_DIGIT_BASE; firstDelta += 1) {
          for (let secondDelta = 1; secondDelta < CENTRAL_N7_DIGIT_BASE; secondDelta += 1) {
            let corrupted = mutate(good, first, firstDelta);
            corrupted = mutate(corrupted, second, secondDelta);
            const result = decodeCentralN7(corrupted);
            if (result === null) counts.rejected += 1;
            else if (result.family === family
              && result.outerFormat.every((digit, index) => digit === outerFormat[index])) {
              counts.correct += 1;
            } else counts.wrong += 1;
          }
        }
      }
    }
    assert.deepEqual(counts, { correct: 1_125, rejected: 3_150, wrong: 0 });
  });

  test('같은 의미 digit의 두 복제본이 같은 오답이어도 체크섬으로 거부한다', () => {
    const good = encodeCentralN7({ family: 'hex', outerFormat: [...OUTER_FORMATS[0]] });
    const first = centralN7ScanIndex(0, 0);
    const second = centralN7ScanIndex(0, 1);
    let corrupted = mutate(good, first);
    corrupted[second] = corrupted[first];
    assert.equal(decodeCentralN7(corrupted), null);
  });

  test('잘못된 입력과 유효하지 않은 바깥 CRC는 일관되게 null로 거부한다', () => {
    assert.equal(decodeCentralN7([]), null);
    assert.equal(decodeCentralN7(new Array(CENTRAL_N7_WIRE_DIGITS).fill(6)), null);

    const good = encodeCentralN7({ family: 'hex', outerFormat: [...OUTER_FORMATS[0]] });
    // 세 복제본의 같은 outerFormat 자리를 함께 바꾸고 체크섬까지 맞춰도 outer CRC가 막는다.
    for (let replica = 0; replica < CENTRAL_N7_REPETITIONS; replica += 1) {
      const index = centralN7ScanIndex(1, replica);
      good[index] = (good[index] + 1) % CENTRAL_N7_DIGIT_BASE;
    }
    good[CENTRAL_N7_CHECKSUM_SCAN_INDEX] =
      (good[CENTRAL_N7_CHECKSUM_SCAN_INDEX] + 1) % CENTRAL_N7_DIGIT_BASE;
    assert.equal(decodeCentralN7(good), null);
  });

  test('균등 임의 19-digit 열의 정확 수용률을 조합적으로 센다', () => {
    // 6^6 의미 열을 전수해 family 3 × 유효 outer format 48 = 144를 독립 계수한다.
    let validSemantics = 0;
    for (let value = 0; value < CENTRAL_N7_DIGIT_BASE ** CENTRAL_N7_SEMANTIC_DIGITS; value += 1) {
      let rest = value;
      const semantic = new Array(CENTRAL_N7_SEMANTIC_DIGITS).fill(0);
      for (let index = semantic.length - 1; index >= 0; index -= 1) {
        semantic[index] = rest % CENTRAL_N7_DIGIT_BASE;
        rest = Math.floor(rest / CENTRAL_N7_DIGIT_BASE);
      }
      const digits = new Array(CENTRAL_N7_WIRE_DIGITS);
      for (let semanticIndex = 0;
        semanticIndex < CENTRAL_N7_SEMANTIC_DIGITS;
        semanticIndex += 1) {
        for (let replica = 0; replica < CENTRAL_N7_REPETITIONS; replica += 1) {
          digits[centralN7ScanIndex(semanticIndex, replica)] = semantic[semanticIndex];
        }
      }
      digits[CENTRAL_N7_CHECKSUM_SCAN_INDEX] =
        semantic.reduce((sum, digit) => (sum + digit) % CENTRAL_N7_DIGIT_BASE, 0);
      if (decodeCentralN7(digits) !== null) validSemantics += 1;
    }
    assert.equal(validSemantics, CENTRAL_N7_FAMILIES.length * 48);

    // 의미 S마다 checksum 일치 수용 열은 세 copy 쌍의 합집합
    // 3·6^6 − 2개이고, checksum 단독 오류 5개를 더 받는다.
    const acceptedWords = validSemantics
      * (3 * CENTRAL_N7_DIGIT_BASE ** CENTRAL_N7_SEMANTIC_DIGITS + 3);
    const allWords = CENTRAL_N7_DIGIT_BASE ** CENTRAL_N7_WIRE_DIGITS;
    assert.equal(acceptedWords, 20_155_824);
    assert.equal(allWords, 609_359_740_010_496);
    assert.ok(acceptedWords / allWords < 3.31e-8);
  });
});
