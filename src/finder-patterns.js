// finder-patterns.js — 실물 비교용 중앙 19셀 파인더 후보 8개
//
// ⚠ tools/extract-finder-patterns.mjs 생성물. 직접 마스크를 고치지 말고 생성기를 갱신한 뒤
// 이 도구를 다시 실행한다. 좌표 순서는 hexgrid.regionCells(2), 면 비트는 T=1/L=2/R=4다.
// 이 후보들은 렌더 실험용이며 현행 동심원 디코더로 스캔되지 않는다.

import { FACES, regionCells } from './hexgrid.js';

export const DEFAULT_FINDER_PATTERN_ID = 'bullseye';
export const FINDER_FACE_BITS = Object.freeze({ T: 1, L: 2, R: 4 });
export const FINDER_CELL_ORDER = Object.freeze(
  regionCells(2).map(({ q, r }) => Object.freeze({ q, r })),
);

if (FINDER_CELL_ORDER.length !== 19) {
  throw new Error(`파인더 셀 수 불일치: ${FINDER_CELL_ORDER.length} !== 19`);
}
if (FACES.join(',') !== 'T,L,R') {
  throw new Error(`파인더 면 순서 불일치: ${FACES.join(',')} !== T,L,R`);
}

function definePattern(pattern) {
  if (!Array.isArray(pattern.cellMasks) || pattern.cellMasks.length !== FINDER_CELL_ORDER.length) {
    throw new RangeError(`${pattern.id}: cellMasks 는 19개여야 한다`);
  }
  for (const mask of pattern.cellMasks) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
      throw new RangeError(`${pattern.id}: 면 마스크 범위 오류 ${mask}`);
    }
  }
  return Object.freeze({
    ...pattern,
    params: Object.freeze({ ...pattern.params }),
    scores: Object.freeze({ ...pattern.scores }),
    cellMasks: Object.freeze([...pattern.cellMasks]),
  });
}

export const FINDER_PATTERNS = Object.freeze([
  // 2차 실행 · face-swirl {"phase":2,"center":2,"cycle":0,"invertOuter":false}
  // 중심 균형 게이트 통과 · [미검증] 회전 79.47 / 단순성 55.58
  definePattern({
    id: "swirl-2-200",
    name: "Face swirl",
    family: "face-swirl",
    sourceRun: 2,
    params:
    {
      "phase": 2,
      "center": 2,
      "cycle": 0,
      "invertOuter": false
    },
    centerBalanceGatePassed: true,
    scores: { rotation: 79.47194142390262, structuralSimplicity: 55.579256952027684 },
    cellMasks: [4, 4, 1, 2, 4, 1, 1, 2, 2, 2, 2, 2, 1, 1, 4, 4, 1, 4, 4],
  }),

  // 2차 실행 · gap-ring {"innerRadius":1,"outerRadius":3.7,"gapDirection":2,"gapWidthFraction":1,"centerTreatment":"solid"}
  // 중심 균형 게이트 통과 · [미검증] 회전 52.98 / 단순성 86.68
  definePattern({
    id: "gap-ring-01-2-1-solid",
    name: "Solid gap ring",
    family: "gap-ring",
    sourceRun: 2,
    params:
    {
      "innerRadius": 1,
      "outerRadius": 3.7,
      "gapDirection": 2,
      "gapWidthFraction": 1,
      "centerTreatment": "solid"
    },
    centerBalanceGatePassed: true,
    scores: { rotation: 52.98129428260175, structuralSimplicity: 86.6828394595597 },
    cellMasks: [5, 3, 0, 7, 7, 0, 4, 6, 7, 7, 7, 3, 7, 7, 7, 7, 6, 7, 3],
  }),

  // 2차 실행 · pinwheel {"blades":3,"length":2.8,"widthFraction":0.64,"twistFraction":0.35,"phase":0.5,"winding":1,"centerTreatment":"solid","breakMode":"missing"}
  // 중심 균형 게이트 탈락 · [미검증] 회전 41.89 / 단순성 90.91
  definePattern({
    id: "pinwheel-3-0101-cw-missing-solid",
    name: "Three-blade pinwheel",
    family: "pinwheel",
    sourceRun: 2,
    params:
    {
      "blades": 3,
      "length": 2.8,
      "widthFraction": 0.64,
      "twistFraction": 0.35,
      "phase": 0.5,
      "winding": 1,
      "centerTreatment": "solid",
      "breakMode": "missing"
    },
    centerBalanceGatePassed: false,
    scores: { rotation: 41.88539082916955, structuralSimplicity: 90.91372900969897 },
    cellMasks: [0, 0, 0, 4, 7, 0, 0, 0, 2, 7, 0, 0, 0, 7, 1, 0, 0, 2, 0],
  }),

  // 2차 실행 · flower {"petals":7,"length":2.8,"widthFraction":0.42,"layers":2,"phase":0,"centerTreatment":"offset","breakMode":"coprime"}
  // 중심 균형 게이트 탈락 · [미검증] 회전 45.88 / 단순성 91.19
  definePattern({
    id: "flower-7-0020-coprime-offset",
    name: "Seven-petal flower (compact)",
    family: "flower",
    sourceRun: 2,
    params:
    {
      "petals": 7,
      "length": 2.8,
      "widthFraction": 0.42,
      "layers": 2,
      "phase": 0,
      "centerTreatment": "offset",
      "breakMode": "coprime"
    },
    centerBalanceGatePassed: false,
    scores: { rotation: 45.883146774112355, structuralSimplicity: 91.18880899993957 },
    cellMasks: [0, 0, 0, 0, 0, 5, 0, 0, 4, 4, 7, 0, 0, 0, 0, 0, 0, 0, 0],
  }),

  // 3차 실행 · pinwheel {"blades":2,"length":3.7,"widthFraction":0.64,"twistFraction":0.35,"phase":0,"winding":1,"centerTreatment":"solid","symmetryClass":"C2"}
  // 중심 균형 게이트 통과 · [미검증] 회전 79.47 / 단순성 92.28
  definePattern({
    id: "pinwheel-c2-2-1100-cw",
    name: "C2 twin pinwheel",
    family: "pinwheel",
    sourceRun: 3,
    params:
    {
      "blades": 2,
      "length": 3.7,
      "widthFraction": 0.64,
      "twistFraction": 0.35,
      "phase": 0,
      "winding": 1,
      "centerTreatment": "solid",
      "symmetryClass": "C2"
    },
    centerBalanceGatePassed: true,
    scores: { rotation: 79.47194142390262, structuralSimplicity: 92.28092947267801 },
    cellMasks: [7, 0, 0, 7, 7, 0, 7, 7, 7, 7, 7, 7, 7, 0, 7, 7, 0, 0, 7],
  }),

  // 3차 실행 · gap-ring {"innerRadius":1,"outerRadius":3.7,"gapDirection":2,"gapWidthFraction":1,"centerTreatment":"open"}
  // 중심 균형 게이트 통과 · [미검증] 회전 52.98 / 단순성 84.52
  definePattern({
    id: "gap-ring-01-2-1-open",
    name: "Open gap ring",
    family: "gap-ring",
    sourceRun: 3,
    params:
    {
      "innerRadius": 1,
      "outerRadius": 3.7,
      "gapDirection": 2,
      "gapWidthFraction": 1,
      "centerTreatment": "open"
    },
    centerBalanceGatePassed: true,
    scores: { rotation: 52.98129428260175, structuralSimplicity: 84.51542547285166 },
    cellMasks: [5, 3, 0, 7, 7, 0, 4, 6, 7, 0, 7, 3, 7, 7, 7, 7, 6, 7, 3],
  }),

  // 3차 실행 · flower {"petals":7,"length":3.7,"widthFraction":0.42,"layers":2,"phase":0,"centerTreatment":"offset","breakMode":"coprime"}
  // 중심 균형 게이트 통과 · [미검증] 회전 59.23 / 단순성 82.54
  definePattern({
    id: "flower-7-1020-coprime-offset",
    name: "Seven-petal flower (wide)",
    family: "flower",
    sourceRun: 3,
    params:
    {
      "petals": 7,
      "length": 3.7,
      "widthFraction": 0.42,
      "layers": 2,
      "phase": 0,
      "centerTreatment": "offset",
      "breakMode": "coprime"
    },
    centerBalanceGatePassed: true,
    scores: { rotation: 59.23488777590924, structuralSimplicity: 82.53857253110874 },
    cellMasks: [0, 0, 0, 4, 0, 7, 0, 0, 4, 4, 7, 0, 2, 0, 0, 0, 4, 0, 0],
  }),

  // 3차 실행 · face-swirl {"innerSequence":5,"outerSequence":5,"innerCycle":1,"outerCycle":1,"ringMode":"both","centerTreatment":"solid","symmetryClass":"C2"}
  // 중심 균형 게이트 통과 · [미검증] 회전 79.47 / 단순성 56.33
  definePattern({
    id: "swirl-c2-5-5-11-both",
    name: "C2 face swirl",
    family: "face-swirl",
    sourceRun: 3,
    params:
    {
      "innerSequence": 5,
      "outerSequence": 5,
      "innerCycle": 1,
      "outerCycle": 1,
      "ringMode": "both",
      "centerTreatment": "solid",
      "symmetryClass": "C2"
    },
    centerBalanceGatePassed: true,
    scores: { rotation: 79.47194142390262, structuralSimplicity: 56.325320629094655 },
    cellMasks: [3, 3, 6, 5, 5, 3, 6, 5, 6, 7, 6, 5, 6, 3, 5, 5, 6, 3, 3],
  })
]);

export const FINDER_PATTERN_IDS = Object.freeze(FINDER_PATTERNS.map((pattern) => pattern.id));
const PATTERN_BY_ID = new Map(FINDER_PATTERNS.map((pattern) => [pattern.id, pattern]));

export function getFinderPattern(id) {
  if (typeof id !== 'string') {
    throw new TypeError(`finderPatternId 는 문자열이어야 한다: ${typeof id}`);
  }
  const pattern = PATTERN_BY_ID.get(id);
  if (!pattern) throw new RangeError(`알 수 없는 finderPatternId: ${id}`);
  return pattern;
}

export function isExperimentalFinderPattern(id) {
  return PATTERN_BY_ID.has(id);
}
