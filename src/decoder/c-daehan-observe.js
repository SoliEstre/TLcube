/**
 * Type C×daehan 관찰용 후보 이터레이터.
 *
 * 제품의 bootstrap/선택기에는 연결하지 않는다. 이 모듈은 R1과 같은 순수
 * cell-finder → 모든 C 반경 → (통과한 경우만) C anchor 보강 순서를 재현해
 * R2 관찰자가 실제 광학 후보를 측정할 수 있게만 한다.
 */
import { TYPE_C_RADII } from '../formatC.js';
import { DAEHAN_FINDER_PATTERNS } from '../finder-daehan.js';
import { findCAnchorHypotheses } from './anchor-detect.js';
import { detectCellFinders } from './cell-finder-detect.js';

function copyH(H) {
  return H instanceof Float64Array && H.length === 9 ? new Float64Array(H) : null;
}

function snapshot(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (ArrayBuffer.isView(value)) return Object.freeze(Array.from(value));
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const item of value) out.push(snapshot(item, seen));
    return Object.freeze(out);
  }
  const out = {};
  seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = snapshot(value[key], seen);
  return Object.freeze(out);
}

function finderH(finder) {
  return copyH(finder?.H || finder?.transform || finder?.B);
}

function observedSeed(finder, finderIndex, k) {
  const H = finderH(finder);
  if (H === null) return null;
  return {
    family: 'hex',
    k,
    orientation: finder.orientation,
    rotationDegrees: finder.rotationDegrees,
    centerQr: false,
    H,
    canonicalSpace: 'hex-euclidean-unit-cell',
    sourceKind: 'c-daehan',
    stage: 'seed',
    finderIndex,
    finder: snapshot(finder),
  };
}

function observedAnchor(raw, finder, finderIndex) {
  const H = copyH(raw?.H);
  if (H === null) return null;
  return {
    ...raw,
    H,
    sourceKind: 'c-daehan',
    stage: 'anchor',
    finderIndex,
    finder: snapshot(finder),
    anchor: snapshot(raw),
  };
}

/**
 * 실제 daehan 광학 검출 후보를 결정적으로 열거한다.
 *
 * `patternId`가 반경을 뜻하지 않는다는 R1 계약(작은 daehan 템플릿은 큰 프레임의
 * 부분집합에도 정당하게 맞음)을 지켜 각 finder마다 TYPE_C_RADII 전부를 seed로 낸다.
 * anchor는 순수 C anchor가 hard check를 통과한 보강 후보만 뒤에 추가한다.
 */
export function* observeCDaehanGeometry(luma, options = {}) {
  const detected = detectCellFinders(luma, DAEHAN_FINDER_PATTERNS, options.finder || {});
  if (!detected.ok) return;
  for (let finderIndex = 0; finderIndex < detected.candidates.length; finderIndex += 1) {
    const finder = detected.candidates[finderIndex];
    for (const k of TYPE_C_RADII) {
      const seed = observedSeed(finder, finderIndex, k);
      if (seed !== null) yield seed;
    }
    const anchored = findCAnchorHypotheses(luma, finder, TYPE_C_RADII, options.anchor || {});
    if (!anchored.ok) continue;
    for (const raw of anchored.hypotheses) {
      const entry = observedAnchor(raw, finder, finderIndex);
      if (entry !== null) yield entry;
    }
  }
}
