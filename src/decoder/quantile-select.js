/**
 * 세 분위수만 필요한 호출자를 위한 bounded in-place selection.
 *
 * 지원 입력은 dense number[], Float32Array, Float64Array다. 호출자가 넘기는 값은
 * 독립 작업 버퍼여야 하며 순서는 보존되지 않는다. NaN, 무한대, -0은 컨테이너별
 * native sort 의미가 미묘하게 다르므로 기존 정렬과 exact 일치를 위해 전체 fallback한다.
 */

function validate(values) {
  const supported = Array.isArray(values)
    || values instanceof Float32Array
    || values instanceof Float64Array;
  if (!supported) {
    throw new TypeError('dense number[], Float32Array 또는 Float64Array가 필요하다');
  }
  if (Array.isArray(values)) {
    for (let index = 0; index < values.length; index += 1) {
      if (!(index in values) || typeof values[index] !== 'number') {
        throw new TypeError('number[]는 hole 없이 숫자만 포함해야 한다');
      }
    }
  }
}

function indices(length) {
  const at = fraction => Math.floor(fraction * (length - 1));
  return { p1: at(0.01), p50: at(0.5), p99: at(0.99) };
}

function nativeSort(values) {
  if (Array.isArray(values)) values.sort((left, right) => left - right);
  else values.sort();
}

function nativeSortRange(values, low, high) {
  if (Array.isArray(values)) {
    const sorted = values.slice(low, high + 1).sort((left, right) => left - right);
    for (let offset = 0; offset < sorted.length; offset += 1) values[low + offset] = sorted[offset];
  } else {
    values.subarray(low, high + 1).sort();
  }
}

function swap(values, left, right) {
  if (left === right) return;
  const held = values[left];
  values[left] = values[right];
  values[right] = held;
}

function medianOfThreeIndex(values, left, middle, right) {
  const a = values[left], b = values[middle], c = values[right];
  if (a < b) {
    if (b < c) return middle;
    return a < c ? right : left;
  }
  if (a < c) return left;
  return b < c ? right : middle;
}

function partitionThreeWay(values, low, high, pivot) {
  let lower = low, cursor = low, upper = high;
  while (cursor <= upper) {
    if (values[cursor] < pivot) {
      swap(values, lower, cursor);
      lower += 1;
      cursor += 1;
    } else if (values[cursor] > pivot) {
      swap(values, cursor, upper);
      upper -= 1;
    } else {
      cursor += 1;
    }
  }
  return { lower, upper };
}

function sortedEqualBand(values, target, low, high) {
  let lower = target, upper = target;
  while (lower > low && values[lower - 1] === values[target]) lower -= 1;
  while (upper < high && values[upper + 1] === values[target]) upper += 1;
  return { value: values[target], lower, upper };
}

function selectIndex(values, target, initialLow, initialHigh, budget) {
  let low = initialLow, high = initialHigh;
  while (low < high) {
    if (budget.remaining === 0) {
      nativeSortRange(values, low, high);
      return sortedEqualBand(values, target, low, high);
    }
    budget.remaining -= 1;
    const middle = low + Math.floor((high - low) / 2);
    const pivot = values[medianOfThreeIndex(values, low, middle, high)];
    const { lower, upper } = partitionThreeWay(values, low, high, pivot);
    if (target < lower) high = lower - 1;
    else if (target > upper) low = upper + 1;
    else return { value: values[target], lower, upper };
  }
  return { value: values[target], lower: target, upper: target };
}

export function selectThreeQuantilesInPlace(values) {
  validate(values);
  const count = values.length;
  if (count === 0) return { p1: undefined, p50: undefined, p99: undefined, count: 0 };

  let requiresLegacySort = false;
  for (let index = 0; index < count; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      requiresLegacySort = true;
      break;
    }
  }
  const targets = indices(count);
  if (requiresLegacySort) {
    nativeSort(values);
    return { p1: values[targets.p1], p50: values[targets.p50],
      p99: values[targets.p99], count };
  }

  // 세 selection 전체의 partition 수를 고정 상한으로 묶는다. 소진 시 현재 부분범위만 정렬한다.
  const budget = { remaining: Math.max(1, 2 * Math.ceil(Math.log2(count + 1))) };
  const median = selectIndex(values, targets.p50, 0, count - 1, budget);
  const p1 = targets.p1 >= median.lower
    ? median.value
    : selectIndex(values, targets.p1, 0, median.lower - 1, budget).value;
  const p99 = targets.p99 <= median.upper
    ? median.value
    : selectIndex(values, targets.p99, median.upper + 1, count - 1, budget).value;
  return { p1, p50: median.value, p99, count };
}
