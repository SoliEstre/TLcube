/** 누적 확정 여부와 무관한 직전/현재 원시 3면 순위 연속성 게이트예요. */
export const DEFAULT_CUBE_Y_CONTINUITY = Object.freeze({
  minTrackedNcc: 0.96,
  minImmediateMargin: 8,
  minReliableCells: 48,
  minReliableFraction: 0.15,
  maxContradictionRate: 0.08,
});

function immediateThreeTone(faceLuma, offset) {
  const values = [faceLuma[offset], faceLuma[offset + 1], faceLuma[offset + 2]];
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a] || a - b);
  const digit = order[0] === 0 ? (order[1] === 1 ? 0 : 1)
    : order[0] === 1 ? (order[1] === 0 ? 2 : 3) : (order[1] === 0 ? 4 : 5);
  return { digit, margin: Math.min(values[order[0]] - values[order[1]], values[order[1]] - values[order[2]]) };
}

function immediateTwoTone(faceLuma, offset) {
  const values = [faceLuma[offset], faceLuma[offset + 1], faceLuma[offset + 2]];
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a] || a - b);
  const highGap = values[order[0]] - values[order[1]];
  const lowGap = values[order[1]] - values[order[2]];
  // tonemap.TONE_PATTERNS 정본: d0..2는 단독 밝음 T/L/R, d3..5는 단독 어두움 T/L/R.
  return highGap >= lowGap
    ? { digit: order[0], margin: highGap }
    : { digit: order[2] + 3, margin: lowGap };
}

export function snapshotCubeYObservation(faceLuma, visibleCells, tones = 3) {
  if (!faceLuma || !visibleCells || faceLuma.length < visibleCells.length * 3) {
    throw new TypeError('3면 휘도와 가시 셀 버퍼가 필요해요');
  }
  if (tones !== 2 && tones !== 3) throw new TypeError('관측 tones는 2 또는 3이어야 해요');
  const digits = new Uint8Array(visibleCells.length);
  const margins = new Uint8Array(visibleCells.length);
  const visible = new Uint8Array(visibleCells);
  for (let cell = 0; cell < visible.length; cell++) {
    const value = tones === 2
      ? immediateTwoTone(faceLuma, cell * 3)
      : immediateThreeTone(faceLuma, cell * 3);
    digits[cell] = value.digit;
    margins[cell] = value.margin;
  }
  return { tones, digits, margins, visible };
}

export function compareCubeYObservations(previous, current, override = undefined) {
  const policy = { ...DEFAULT_CUBE_Y_CONTINUITY, ...(override ?? {}) };
  if (!previous?.digits || !current?.digits || previous.digits.length !== current.digits.length
    || previous.tones !== current.tones) {
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
