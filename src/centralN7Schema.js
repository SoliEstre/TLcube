/**
 * centralN7Schema.js — 중앙 n=7 payload 파인더의 정본 기하와 scan order.
 *
 * 좌표를 손으로 옮긴 표는 두지 않는다. v0 정본 30셀을 양쪽 3셀 edge band 기준으로
 * n=7에 재앵커하고, 데이터 셀은 7×7에서 그 좌표의 여집합으로 유도한다. 18개 payload
 * 셀은 복제본 단위 합의에 맞춰 국소 오염이 한 복제본 안에 머무는 경우를 최대화하도록
 * 전수 탐색하며, 유일한 중앙 셀은 체크섬에 쓴다.
 */

import { CENTRAL_V0_SOURCE_N, centralV0FinderCells } from './cellSurfaceFinal.js';

export const CENTRAL_N7_SIZE = 7;
export const CENTRAL_N7_FINDER_PATTERN_ID = 'central-n7-payload';
export const CENTRAL_N7_PATTERN_FAMILY_ID = 'central-n7-coded';
export const CENTRAL_N7_SCHEMA_ID = 'central-n7-rep3-check1-v1';

/** payload의 첫 digit이 직접 표현하는 렌더 계열. 배열 순서가 wire 값이다. */
export const CENTRAL_N7_FAMILIES = Object.freeze(['hex', 'tri', 'star']);

export const CENTRAL_N7_SEMANTIC_DIGITS = 6;
export const CENTRAL_N7_REPETITIONS = 3;
export const CENTRAL_N7_CHECKSUM_SCAN_INDEX = 18;

const EDGE_BAND = 3;

/**
 * v0 n=13 좌표의 낮은 변/높은 변 inset을 보존해 n=7 좌표로 옮긴다.
 * v0 로케이터는 두 edge band에만 있어야 하며, 가운데 좌표가 들어오면 조용히
 * 접지 않고 거부한다.
 */
export function centralN7ReanchorCoordinate(value) {
  if (!Number.isInteger(value) || value < 0 || value >= CENTRAL_V0_SOURCE_N) {
    throw new RangeError('v0 재앵커 좌표가 범위를 벗어났다: ' + value);
  }
  if (value < EDGE_BAND) return value;
  const farBandStart = CENTRAL_V0_SOURCE_N - EDGE_BAND;
  if (value >= farBandStart) {
    const farInset = CENTRAL_V0_SOURCE_N - 1 - value;
    return CENTRAL_N7_SIZE - 1 - farInset;
  }
  throw new RangeError('v0 로케이터가 edge band 밖에 있다: ' + value);
}

function cellKey(i, j) {
  return i + ',' + j;
}

function freezeCoordinate(cell) {
  return Object.freeze({ ...cell });
}

function deriveLocatorCells() {
  const seen = new Set();
  const cells = centralV0FinderCells().map((cell) => {
    const derived = freezeCoordinate({
      ...cell,
      i: centralN7ReanchorCoordinate(cell.i),
      j: centralN7ReanchorCoordinate(cell.j),
    });
    const key = cellKey(derived.i, derived.j);
    if (seen.has(key)) throw new Error('n=7 재앵커 로케이터 좌표가 겹쳤다: ' + key);
    seen.add(key);
    return derived;
  });
  if (cells.length !== 30) {
    throw new Error('n=7 재앵커 로케이터가 30셀이 아니다: ' + cells.length);
  }
  return Object.freeze(cells);
}

/** v0 정본에서 유도한 n=7 로케이터 30셀. T/L/R 톤도 원본 행에서 승계한다. */
export const CENTRAL_N7_LOCATOR_CELLS = deriveLocatorCells();

function deriveDataCells() {
  const locatorKeys = new Set(CENTRAL_N7_LOCATOR_CELLS.map(({ i, j }) => cellKey(i, j)));
  const cells = [];
  for (let j = 0; j < CENTRAL_N7_SIZE; j += 1) {
    for (let i = 0; i < CENTRAL_N7_SIZE; i += 1) {
      if (!locatorKeys.has(cellKey(i, j))) cells.push(freezeCoordinate({ i, j }));
    }
  }
  if (cells.length !== 19) {
    throw new Error('n=7 데이터 여집합이 19셀이 아니다: ' + cells.length);
  }
  return Object.freeze(cells);
}

const DATA_CELLS_ROW_MAJOR = deriveDataCells();

function distanceSquared(a, b) {
  const di = a.i - b.i;
  const dj = a.j - b.j;
  return di * di + dj * dj;
}

function firstSetBit(mask, count) {
  for (let index = 0; index < count; index += 1) {
    if ((mask & (1 << index)) !== 0) return index;
  }
  return -1;
}

function visitCombinations(availableMask, needed, start, chosenMask, count, visit) {
  if (needed === 0) {
    visit(chosenMask);
    return;
  }
  for (let bit = start; bit < count; bit += 1) {
    const flag = 1 << bit;
    if ((availableMask & flag) === 0) continue;
    visitCombinations(
      availableMask ^ flag,
      needed - 1,
      bit + 1,
      chosenMask | flag,
      count,
      visit,
    );
  }
}

/**
 * 가운데 체크섬 셀을 제외한 18셀을 6셀짜리 복제본 3개로 나눈다.
 *
 * 1차 목적은 데이터 셀을 중심으로 제곱거리 1/2/4 안을 가리는 57개 국소 오염 중
 * 복제본 단위 합의로 확실히 복원되는 패턴 수다. 체크섬과 payload가 함께 오염되지 않고,
 * 오염된 payload가 한 복제본 안에만 있으면 digit 치환값과 무관하게 나머지 두 복제본이
 * 합의한다. 2차 목적은 복제본 내부 제곱거리 합 최소화, 마지막 동률은 row-major
 * bitmask 순으로 깨서 실행 환경이나 객체 열거 순서에 의존하지 않는다.
 */
function derivePayloadLayout() {
  const center = (CENTRAL_N7_SIZE - 1) / 2;
  const checksumCandidates = DATA_CELLS_ROW_MAJOR
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.i === center && cell.j === center);
  if (checksumCandidates.length !== 1) {
    throw new Error('n=7 체크섬 중앙 셀이 유일하지 않다: ' + checksumCandidates.length);
  }

  const checksumCell = checksumCandidates[0].cell;
  const payloadCells = DATA_CELLS_ROW_MAJOR.filter((cell) => cell !== checksumCell);
  if (payloadCells.length !== CENTRAL_N7_SEMANTIC_DIGITS * CENTRAL_N7_REPETITIONS) {
    throw new Error('n=7 복제 payload 셀이 18개가 아니다: ' + payloadCells.length);
  }

  const payloadCount = payloadCells.length;
  const fullMask = (1 << payloadCount) - 1;
  const radiusSquaredValues = [1, 2, 4];
  const recoverablePayloadMasks = [];
  let checksumOnlyPatterns = 0;

  for (const radiusSquared of radiusSquaredValues) {
    for (const contaminationCenter of DATA_CELLS_ROW_MAJOR) {
      let payloadMask = 0;
      for (let index = 0; index < payloadCount; index += 1) {
        if (distanceSquared(payloadCells[index], contaminationCenter) <= radiusSquared) {
          payloadMask |= 1 << index;
        }
      }
      const checksumHit = distanceSquared(checksumCell, contaminationCenter) <= radiusSquared;
      if (checksumHit) {
        if (payloadMask === 0) checksumOnlyPatterns += 1;
      } else if (payloadMask !== 0) {
        recoverablePayloadMasks.push(payloadMask);
      }
    }
  }

  const groupScores = new Uint8Array(1 << payloadCount);
  const groupDistanceCosts = new Uint16Array(1 << payloadCount);
  function prepareGroup(groupMask) {
    let score = 0;
    for (const patternMask of recoverablePayloadMasks) {
      if ((patternMask & groupMask) === patternMask) score += 1;
    }
    groupScores[groupMask] = score;

    const members = [];
    for (let index = 0; index < payloadCount; index += 1) {
      if ((groupMask & (1 << index)) !== 0) members.push(index);
    }
    let distanceCost = 0;
    for (let a = 0; a < members.length; a += 1) {
      for (let b = a + 1; b < members.length; b += 1) {
        distanceCost += distanceSquared(payloadCells[members[a]], payloadCells[members[b]]);
      }
    }
    groupDistanceCosts[groupMask] = distanceCost;
  }
  visitCombinations(fullMask, CENTRAL_N7_SEMANTIC_DIGITS, 0, 0, payloadCount, prepareGroup);

  let best = null;
  let partitionCount = 0;
  // 무라벨 6·6·6 분할을 정확히 한 번씩 센다. 첫 그룹은 bit 0, 둘째 그룹은
  // 첫 그룹을 뺀 뒤 가장 낮은 bit를 포함하게 해 복제본 라벨까지 결정한다.
  visitCombinations(fullMask ^ 1, 5, 1, 1, payloadCount, (first) => {
    const afterFirst = fullMask ^ first;
    const secondAnchor = firstSetBit(afterFirst, payloadCount);
    const secondAnchorFlag = 1 << secondAnchor;
    visitCombinations(
      afterFirst ^ secondAnchorFlag,
      5,
      secondAnchor + 1,
      secondAnchorFlag,
      payloadCount,
      (second) => {
        const third = afterFirst ^ second;
        const groups = [first, second, third];
        const recoverablePatterns = checksumOnlyPatterns
          + groupScores[first] + groupScores[second] + groupScores[third];
        const distanceCost = groupDistanceCosts[first]
          + groupDistanceCosts[second] + groupDistanceCosts[third];
        partitionCount += 1;
        if (best === null
          || recoverablePatterns > best.recoverablePatterns
          || (recoverablePatterns === best.recoverablePatterns
            && distanceCost < best.distanceCost)
          || (recoverablePatterns === best.recoverablePatterns
            && distanceCost === best.distanceCost
            && (first < best.groups[0]
              || (first === best.groups[0] && second < best.groups[1])))) {
          best = { groups, recoverablePatterns, distanceCost };
        }
      },
    );
  });

  if (partitionCount !== 2_858_856 || best === null) {
    throw new Error('n=7 payload 6·6·6 전수 분할 수가 어긋났다: ' + partitionCount);
  }

  const replicaCells = best.groups.map((groupMask) => {
    const cells = [];
    for (let index = 0; index < payloadCount; index += 1) {
      if ((groupMask & (1 << index)) !== 0) cells.push(payloadCells[index]);
    }
    return cells;
  });
  const scanOrder = [];
  for (let semantic = 0; semantic < CENTRAL_N7_SEMANTIC_DIGITS; semantic += 1) {
    for (let replica = 0; replica < CENTRAL_N7_REPETITIONS; replica += 1) {
      scanOrder.push(replicaCells[replica][semantic]);
    }
  }
  scanOrder.push(checksumCell);
  return Object.freeze({
    scanOrder: Object.freeze(scanOrder),
    checksumCell,
    localBurstPatternCount: radiusSquaredValues.length * DATA_CELLS_ROW_MAJOR.length,
    localBurstRecoverablePatterns: best.recoverablePatterns,
  });
}

const PAYLOAD_LAYOUT = derivePayloadLayout();

/**
 * 결정적 19셀 scan order. 의미 digit 0의 복제 3개, digit 1의 복제 3개, ...,
 * digit 5의 복제 3개, 마지막 체크섬 순이다.
 */
export const CENTRAL_N7_DATA_SCAN_ORDER = PAYLOAD_LAYOUT.scanOrder;

/** 배치 목적함수의 데이터 셀 중심 원판 패턴 수와 그중 확실히 복원되는 수. */
export const CENTRAL_N7_LOCAL_BURST_PATTERN_COUNT = PAYLOAD_LAYOUT.localBurstPatternCount;
export const CENTRAL_N7_LOCAL_BURST_RECOVERABLE_PATTERNS =
  PAYLOAD_LAYOUT.localBurstRecoverablePatterns;

/** replica별 여섯 scan index. 좌표 사본이 아니라 scan 규칙에서 유도한다. */
export const CENTRAL_N7_REPLICA_SCAN_INDEXES = Object.freeze(
  Array.from({ length: CENTRAL_N7_REPETITIONS }, (unused, replica) => Object.freeze(
    Array.from(
      { length: CENTRAL_N7_SEMANTIC_DIGITS },
      (alsoUnused, semantic) => semantic * CENTRAL_N7_REPETITIONS + replica,
    ),
  )),
);

export function centralN7ScanIndex(semanticIndex, replicaIndex) {
  if (!Number.isInteger(semanticIndex)
    || semanticIndex < 0 || semanticIndex >= CENTRAL_N7_SEMANTIC_DIGITS) {
    throw new RangeError('중앙 n=7 의미 digit index 범위 위반: ' + semanticIndex);
  }
  if (!Number.isInteger(replicaIndex)
    || replicaIndex < 0 || replicaIndex >= CENTRAL_N7_REPETITIONS) {
    throw new RangeError('중앙 n=7 복제 index 범위 위반: ' + replicaIndex);
  }
  return semanticIndex * CENTRAL_N7_REPETITIONS + replicaIndex;
}
