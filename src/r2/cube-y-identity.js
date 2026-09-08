/** 누적 확정 여부와 무관한 직전/현재 원시 3면 순위 연속성 게이트예요. */
export const DEFAULT_CUBE_Y_CONTINUITY = Object.freeze({
  minTrackedNcc: 0.96,
  minImmediateMargin: 8,
  minReliableCells: 48,
  minReliableFraction: 0.15,
  maxContradictionRate: 0.08,
});

function immediate(faceLuma, offset) {
  const values = [faceLuma[offset], faceLuma[offset + 1], faceLuma[offset + 2]];
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a] || a - b);
  const digit = order[0] === 0 ? (order[1] === 1 ? 0 : 1)
    : order[0] === 1 ? (order[1] === 0 ? 2 : 3) : (order[1] === 0 ? 4 : 5);
  return { digit, margin: Math.min(values[order[0]] - values[order[1]], values[order[1]] - values[order[2]]) };
}

export function snapshotCubeYObservation(faceLuma, visibleCells) {
  if (!faceLuma || !visibleCells || faceLuma.length < visibleCells.length * 3) {
    throw new TypeError('3면 휘도와 가시 셀 버퍼가 필요해요');
  }
  const digits = new Uint8Array(visibleCells.length);
  const margins = new Uint8Array(visibleCells.length);
  const visible = new Uint8Array(visibleCells);
  for (let cell = 0; cell < visible.length; cell++) {
    const value = immediate(faceLuma, cell * 3);
    digits[cell] = value.digit;
    margins[cell] = value.margin;
  }
  return { digits, margins, visible };
}

export function compareCubeYObservations(previous, current, override = undefined) {
  const policy = { ...DEFAULT_CUBE_Y_CONTINUITY, ...(override ?? {}) };
  if (!previous?.digits || !current?.digits || previous.digits.length !== current.digits.length) {
    throw new TypeError('같은 scan의 관측 스냅샷 두 개가 필요해요');
  }
  let overlap = 0, reliable = 0, matches = 0, contradictions = 0;
  for (let cell = 0; cell < current.digits.length; cell++) {
    if (!previous.visible[cell] || !current.visible[cell]) continue;
    overlap++;
    if (previous.margins[cell] < policy.minImmediateMargin || current.margins[cell] < policy.minImmediateMargin) continue;
    reliable++;
    if (previous.digits[cell] === current.digits[cell]) matches++; else contradictions++;
  }
  const requiredReliable = Math.max(policy.minReliableCells,
    Math.ceil(current.digits.length * policy.minReliableFraction));
  const contradictionRate = reliable === 0 ? null : contradictions / reliable;
  const reason = reliable < requiredReliable ? 'insufficient-reliable-overlap'
    : contradictionRate > policy.maxContradictionRate ? 'raw-rank-contradiction' : null;
  return { ok: reason === null, reason, overlap, reliable, requiredReliable, matches, contradictions,
    contradictionRate, policy };
}

