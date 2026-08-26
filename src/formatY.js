/**
 * formatY.js — cube 축 formatIndex 배정의 조기 로드 가능한 단일 진실.
 *
 * cube 생산자는 capacityY · 구 셀 표면 · 초안 셀 표면 · 신세대 셀 표면 네 곳이지만,
 * 값 정의를 각 파일에 흩어 두면 점유 집합 사본이 썩는다(F-90). 이 표를 생산자들이
 * 직접 소비하고, `CUBE_AXIS_FORMAT_INDEXES`와 점유 claim도 같은 값에서 유도한다.
 */

export const Y_FORMAT_INDEX = Object.freeze({
  Y0: 0,
  Y1: 8,
  Y2: 9,
  Y0T: 2,
  Y1T: 10,
  Y2T: 11,
});

export const CELL_SURFACE_LEGACY_FORMAT_INDEX = Object.freeze({ 2: 12, 3: 14 });

export const CELL_SURFACE_LAYOUT_FORMAT_INDEX = Object.freeze({
  v1r2d: Object.freeze({ 2: 4, 3: 6 }),
  v2: Object.freeze({ 2: 5, 3: 7 }),
});

export const CELL_SURFACE_FINAL_FORMAT_INDEX = Object.freeze({ 2: 1, 3: 3 });

const claims = [
  { owner: 'Y0', n: 13, formatIndex: Y_FORMAT_INDEX.Y0 },
  { owner: 'Y0T', n: 13, formatIndex: Y_FORMAT_INDEX.Y0T },
  { owner: 'Y1', n: 21, formatIndex: Y_FORMAT_INDEX.Y1 },
  { owner: 'Y1T', n: 21, formatIndex: Y_FORMAT_INDEX.Y1T },
  { owner: 'Y2', n: 25, formatIndex: Y_FORMAT_INDEX.Y2 },
  { owner: 'Y2T', n: 25, formatIndex: Y_FORMAT_INDEX.Y2T },
  { owner: 'cell-surface-v1-2T', n: 21, formatIndex: CELL_SURFACE_LEGACY_FORMAT_INDEX[2] },
  { owner: 'cell-surface-v1-3T', n: 21, formatIndex: CELL_SURFACE_LEGACY_FORMAT_INDEX[3] },
  { owner: 'cell-surface-v1r2d-2T', n: 21, formatIndex: CELL_SURFACE_LAYOUT_FORMAT_INDEX.v1r2d[2] },
  { owner: 'cell-surface-v1r2d-3T', n: 21, formatIndex: CELL_SURFACE_LAYOUT_FORMAT_INDEX.v1r2d[3] },
  { owner: 'cell-surface-v2-draft-2T', n: 21, formatIndex: CELL_SURFACE_LAYOUT_FORMAT_INDEX.v2[2] },
  { owner: 'cell-surface-v2-draft-3T', n: 21, formatIndex: CELL_SURFACE_LAYOUT_FORMAT_INDEX.v2[3] },
];
for (const n of [13, 21, 25]) {
  claims.push({ owner: 'cell-surface-final-2T', n, formatIndex: CELL_SURFACE_FINAL_FORMAT_INDEX[2] });
  claims.push({ owner: 'cell-surface-final-3T', n, formatIndex: CELL_SURFACE_FINAL_FORMAT_INDEX[3] });
}

/** cube 축의 실제 (값,n) 점유. 같은 값이어도 n이 다르면 별도 claim이다. */
export const CUBE_AXIS_FORMAT_CLAIMS = Object.freeze(
  claims.map((claim) => Object.freeze({ ...claim })),
);

/** cube 축 실점유 값 — 생산자 표에서 유도한다. 현행 14값이며 7도 포함한다. */
export const CUBE_AXIS_FORMAT_INDEXES = Object.freeze(
  [...new Set(CUBE_AXIS_FORMAT_CLAIMS.map((claim) => claim.formatIndex))]
    .sort((left, right) => left - right),
);

/**
 * hex·tri가 정책상 비워 둔 cube 기저 밴드. cube 실점유 전체가 아니다.
 * 이름 목록을 Y 정본에 사상하므로 생산자가 값을 옮기면 이 밴드도 함께 움직인다.
 */
export const HEX_TRI_CUBE_RESERVED_FORMAT_INDEXES = Object.freeze(
  ['Y1', 'Y2', 'Y1T', 'Y2T'].map((name) => Y_FORMAT_INDEX[name])
    .sort((left, right) => left - right),
);

// 로드 가드 — 생산자 표가 4bit·톤쌍·정책 부분집합 계약에서 벗어나면 즉시 죽는다.
for (const claim of CUBE_AXIS_FORMAT_CLAIMS) {
  if (!Number.isInteger(claim.formatIndex) || claim.formatIndex < 0 || claim.formatIndex > 15) {
    throw new Error('formatY: 4bit 범위 위반 — ' + claim.owner + '=' + claim.formatIndex);
  }
}
for (const [owner, pair] of [
  ['legacy', CELL_SURFACE_LEGACY_FORMAT_INDEX],
  ['draft-v1r2', CELL_SURFACE_LAYOUT_FORMAT_INDEX.v1r2d],
  ['draft-v2', CELL_SURFACE_LAYOUT_FORMAT_INDEX.v2],
  ['final', CELL_SURFACE_FINAL_FORMAT_INDEX],
]) {
  if (pair[3] !== pair[2] + 2) {
    throw new Error('formatY: ' + owner + ' 3톤 formatIndex가 2톤 + 2가 아니다');
  }
}
for (const index of HEX_TRI_CUBE_RESERVED_FORMAT_INDEXES) {
  if (!CUBE_AXIS_FORMAT_INDEXES.includes(index)) {
    throw new Error('formatY: hex·tri cube 예약값 ' + index + '가 cube 실점유에 없다');
  }
}
