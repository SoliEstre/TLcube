// finder-patterns.js — 중앙 19셀 슬롯 파인더 후보 12개
//
// ⚠ tools/extract-finder-patterns.mjs 생성물. 직접 마스크를 고치지 말고 생성기를 갱신한 뒤
// 이 도구를 다시 실행한다. 좌표 순서는 hexgrid.regionCells(2), 면 비트는 T=1/L=2/R=4다.
// 이진 11개는 마스크 공용 디코더가, 3톤 중앙 큐브 1개는 Type Y 검출 경로가 읽는다.

import { FACES, regionCells } from './hexgrid.js';

export const LEGACY_FINDER_PATTERN_ID = 'bullseye';
export const DEFAULT_FINDER_PATTERN_ID = 'bullseye';
export const FINDER_FACE_BITS = Object.freeze({ T: 1, L: 2, R: 4 });
export const THREE_TONE_CUBE_FINDER_PATTERN_ID = "central-cube-3tone";
export const CUBE_BULLSEYE_FINDER_PATTERN_ID = "cube-bullseye";
export const FINDER_CUBE_RADIUS_CELLS = 3.5;
export const FINDER_CUBE_SLOT_RADIUS_CELLS = 4;
export const FINDER_CUBE_FACE_RANKS = Object.freeze(
  {"T":2,"L":1,"R":0},
);
export const FINDER_CELL_ORDER = Object.freeze(
  regionCells(2).map(({ q, r }) => Object.freeze({ q, r })),
);

if (FINDER_CELL_ORDER.length !== 19) {
  throw new Error(`파인더 셀 수 불일치: ${FINDER_CELL_ORDER.length} !== 19`);
}
if (FACES.join(',') !== 'T,L,R') {
  throw new Error(`파인더 면 순서 불일치: ${FACES.join(',')} !== T,L,R`);
}

function defineScoreRecord(record) {
  return Object.freeze({
    ...record,
    scores: Object.freeze({ ...record.scores }),
  });
}

export const FINDER_BASELINE_SCORES = Object.freeze({
  "bullseye": defineScoreRecord({
    id: "bullseye",
    centerBalanceGatePassed: true,
    centerOffsetCells: 0.049771574930140124,
    scores: { rotation: 0, lowResolution: 55.504960185798204, localization: 32.22404593197675, dataDistinction: 100, structuralSimplicity: 59.79246730623948, defectConcentration: 0 },
  }),
  "center-qr": defineScoreRecord({
    id: "center-qr",
    centerBalanceGatePassed: true,
    centerOffsetCells: 0.1022033350678163,
    scores: { rotation: 64.88856845230502, lowResolution: 44.354818376683234, localization: 23.89512046344338, dataDistinction: 100, structuralSimplicity: 65.77636818983622, defectConcentration: 42.7374753470321 },
  })
});
function definePattern(pattern) {
  const renderKind = pattern.renderKind || 'cell-mask';
  const common = {
    ...pattern,
    renderKind,
    params: Object.freeze({ ...pattern.params }),
    scores: Object.freeze({ ...pattern.scores }),
  };
  if (renderKind === 'cell-mask') {
    if (!Array.isArray(pattern.cellMasks) || pattern.cellMasks.length !== FINDER_CELL_ORDER.length) {
      throw new RangeError(pattern.id + ': cellMasks 는 19개여야 한다');
    }
    for (const mask of pattern.cellMasks) {
      if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
        throw new RangeError(pattern.id + ': 면 마스크 범위 오류 ' + mask);
      }
    }
    return Object.freeze({
      ...common,
      cellMasks: Object.freeze([...pattern.cellMasks]),
    });
  }
  if (renderKind !== 'three-tone-cube' && renderKind !== 'cube-bullseye') {
    throw new RangeError(pattern.id + ': 알 수 없는 renderKind ' + renderKind);
  }
  const ranks = FACES.map((face) => pattern.toneRanks && pattern.toneRanks[face]);
  if (ranks.slice().sort().join(',') !== '0,1,2') {
    throw new RangeError(pattern.id + ': toneRanks 는 0/1/2 순열이어야 한다');
  }
  // 하이브리드의 반지름은 bullseye.js 의 밴드 격자에서 유도된다 — 여기 상수를 두면
  // 두 곳이 갈라질 수 있으므로 radiusCells 를 요구하지 않는다.
  if (renderKind === 'three-tone-cube'
    && (!Number.isFinite(pattern.radiusCells) || pattern.radiusCells <= 0)) {
    throw new RangeError(pattern.id + ': radiusCells 는 양수여야 한다');
  }
  return Object.freeze({
    ...common,
    toneRanks: Object.freeze({ ...pattern.toneRanks }),
  });
}

export const FINDER_PATTERNS = Object.freeze([
  // 첫 8개는 기존 4계열×2행, 다음 3개는 사용자 손그림 개선안,
  // 그 다음이 3톤 큐브, 마지막이 하이브리드(링+큐브)다.
  // 2차 실행 · pinwheel {"blades":3,"length":2.8,"widthFraction":0.64,"twistFraction":0.35,"phase":0.5,"winding":1,"centerTreatment":"solid","breakMode":"missing"}
  // 중심 균형 게이트 탈락 · 중심 오프셋 0.40c · 축별 모형 점수
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
    centerOffsetCells: 0.4003203845127178,
    scores: { rotation: 41.88539082916955, lowResolution: 96.76318469627645, localization: 13.956257981685615, dataDistinction: 100, structuralSimplicity: 90.91372900969897, defectConcentration: 42.51092259923948 },
    cellMasks: [0, 0, 0, 4, 7, 0, 0, 0, 2, 7, 0, 0, 0, 7, 1, 0, 0, 2, 0],
  }),

  // 2차 실행 · gap-ring {"innerRadius":1,"outerRadius":3.7,"gapDirection":2,"gapWidthFraction":1,"centerTreatment":"solid"}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.26c · 축별 모형 점수
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
    centerOffsetCells: 0.26268091278848715,
    scores: { rotation: 52.98129428260175, lowResolution: 95.31975482327525, localization: 13.693929273351637, dataDistinction: 100, structuralSimplicity: 86.6828394595597, defectConcentration: 30.22998940390363 },
    cellMasks: [5, 3, 0, 7, 7, 0, 4, 6, 7, 7, 7, 3, 7, 7, 7, 7, 6, 7, 3],
  }),

  // 2차 실행 · flower {"petals":7,"length":2.8,"widthFraction":0.42,"layers":2,"phase":0,"centerTreatment":"offset","breakMode":"coprime"}
  // 중심 균형 게이트 탈락 · 중심 오프셋 0.53c · 축별 모형 점수
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
    centerOffsetCells: 0.5265081997022854,
    scores: { rotation: 45.883146774112355, lowResolution: 95.24771635431023, localization: 16.094778612701756, dataDistinction: 100, structuralSimplicity: 91.18880899993957, defectConcentration: 51.01310711908737 },
    cellMasks: [0, 0, 0, 0, 0, 5, 0, 0, 4, 4, 7, 0, 0, 0, 0, 0, 0, 0, 0],
  }),

  // 2차 실행 · face-swirl {"phase":2,"center":2,"cycle":0,"invertOuter":false}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.02c · 축별 모형 점수
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
    centerOffsetCells: 0.015193428136569088,
    scores: { rotation: 79.47194142390262, lowResolution: 91.34433401090291, localization: 22.81112784741712, dataDistinction: 100, structuralSimplicity: 55.579256952027684, defectConcentration: 11.624045166840785 },
    cellMasks: [4, 4, 1, 2, 4, 1, 1, 2, 2, 2, 2, 2, 1, 1, 4, 4, 1, 4, 4],
  }),

  // 3차 실행 · pinwheel {"blades":2,"length":3.7,"widthFraction":0.64,"twistFraction":0.35,"phase":0,"winding":1,"centerTreatment":"solid","symmetryClass":"C2"}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.00c · 축별 모형 점수
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
    centerOffsetCells: 5.0923777502508197e-17,
    scores: { rotation: 79.47194142390262, lowResolution: 97.07728924112143, localization: 11.17193090966036, dataDistinction: 100, structuralSimplicity: 92.28092947267801, defectConcentration: 30.229989403903623 },
    cellMasks: [7, 0, 0, 7, 7, 0, 7, 7, 7, 7, 7, 7, 7, 0, 7, 7, 0, 0, 7],
  }),

  // 3차 실행 · gap-ring {"innerRadius":1,"outerRadius":3.7,"gapDirection":2,"gapWidthFraction":1,"centerTreatment":"open"}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.28c · 축별 모형 점수
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
    centerOffsetCells: 0.28238198124762376,
    scores: { rotation: 52.98129428260175, lowResolution: 95.43798666192357, localization: 13.80747895581605, dataDistinction: 100, structuralSimplicity: 84.51542547285166, defectConcentration: 30.22998940390363 },
    cellMasks: [5, 3, 0, 7, 7, 0, 4, 6, 7, 0, 7, 3, 7, 7, 7, 7, 6, 7, 3],
  }),

  // 3차 실행 · flower {"petals":7,"length":3.7,"widthFraction":0.42,"layers":2,"phase":0,"centerTreatment":"offset","breakMode":"coprime"}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.07c · 축별 모형 점수
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
    centerOffsetCells: 0.06943296507508846,
    scores: { rotation: 59.23488777590924, lowResolution: 94.16580922822094, localization: 17.492914686282145, dataDistinction: 100, structuralSimplicity: 82.53857253110874, defectConcentration: 31.478487966284845 },
    cellMasks: [0, 0, 0, 4, 0, 7, 0, 0, 4, 4, 7, 0, 2, 0, 0, 0, 4, 0, 0],
  }),

  // 3차 실행 · face-swirl {"innerSequence":5,"outerSequence":5,"innerCycle":1,"outerCycle":1,"ringMode":"both","centerTreatment":"solid","symmetryClass":"C2"}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.00c · 축별 모형 점수
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
    centerOffsetCells: 5.611412357367492e-17,
    scores: { rotation: 79.47194142390262, lowResolution: 91.17102980798893, localization: 23.55161544174186, dataDistinction: 100, structuralSimplicity: 56.325320629094655, defectConcentration: 12.065908777314663 },
    cellMasks: [3, 3, 6, 5, 5, 3, 6, 5, 6, 7, 6, 5, 6, 3, 5, 5, 6, 3, 3],
  }),

  // 국소 탐색 · tristar h3 · user-refined {"sourceSeed":"tristar","hammingDistance":3,"flippedFaces":[25,48,52]}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.25c · 축별 모형 점수
  definePattern({
    id: "tristar-refined-h3",
    name: "Refined tristar",
    family: "user-refined",
    sourceRun: 4,
    params:
    {
      "sourceSeed": "tristar",
      "hammingDistance": 3,
      "flippedFaces": [
        25,
        48,
        52
      ]
    },
    centerBalanceGatePassed: true,
    centerOffsetCells: 0.2508488988774462,
    scores: { rotation: 77.2328445721233, lowResolution: 92.71851740803673, localization: 20.86677705125009, dataDistinction: 100, structuralSimplicity: 61.05139414683933, defectConcentration: 12.74765297802717 },
    cellMasks: [0, 0, 1, 5, 2, 5, 0, 6, 1, 6, 3, 2, 0, 4, 0, 1, 3, 3, 4],
  }),

  // 국소 탐색 · tree h3 · user-refined {"sourceSeed":"tree","hammingDistance":3,"flippedFaces":[4,26,38]}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.20c · 축별 모형 점수
  definePattern({
    id: "tree-refined-h3",
    name: "Refined tree",
    family: "user-refined",
    sourceRun: 4,
    params:
    {
      "sourceSeed": "tree",
      "hammingDistance": 3,
      "flippedFaces": [
        4,
        26,
        38
      ]
    },
    centerBalanceGatePassed: true,
    centerOffsetCells: 0.19736928613257246,
    scores: { rotation: 77.2328445721233, lowResolution: 93.1591076237279, localization: 20.200631706634137, dataDistinction: 100, structuralSimplicity: 62.28488025177328, defectConcentration: 12.600900066186604 },
    cellMasks: [6, 5, 0, 3, 7, 4, 0, 5, 5, 0, 4, 1, 1, 2, 4, 7, 4, 6, 4],
  }),

  // 국소 탐색 · cats h3 · user-refined {"sourceSeed":"cats","hammingDistance":3,"flippedFaces":[20,25,34]}
  // 중심 균형 게이트 통과 · 중심 오프셋 0.14c · 축별 모형 점수
  definePattern({
    id: "cats-refined-h3",
    name: "Refined cats",
    family: "user-refined",
    sourceRun: 4,
    params:
    {
      "sourceSeed": "cats",
      "hammingDistance": 3,
      "flippedFaces": [
        20,
        25,
        34
      ]
    },
    centerBalanceGatePassed: true,
    centerOffsetCells: 0.14309504001254023,
    scores: { rotation: 74.92686492653552, lowResolution: 93.81394930841353, localization: 18.614131155703078, dataDistinction: 100, structuralSimplicity: 70.9594987568394, defectConcentration: 14.144181028565711 },
    cellMasks: [5, 5, 7, 7, 2, 0, 1, 7, 7, 1, 7, 5, 1, 0, 6, 1, 7, 5, 6],
  }),

  // Type Y 실루엣/Y 심/투영기하 재사용 · T/L/R = 밝음/중간/어두움
  // 회전 점수 42.3019 · 19셀 슬롯 안 최대 반지름 3.5c
  definePattern({
    id: "central-cube-3tone",
    name: "Maximum three-tone cube",
    family: "three-tone-cube",
    sourceRun: 5,
    renderKind: "three-tone-cube",
    params: {
      detector: 'cube-silhouette-y-junction',
      palette: "data-levels",
      faceOrder: 'T-bright-L-mid-R-dark',
    },
    centerBalanceGatePassed: true,
    centerOffsetCells: 0,
    scores: { rotation: 42.30185603408032, lowResolution: 86.47166246267717, localization: 10.188350875030123, dataDistinction: 100, structuralSimplicity: 88.3994979795851, defectConcentration: 54.41398092702653 },
    radiusCells: 3.5,
    slotRadiusCells: 4,
    toneRanks: {"T":2,"L":1,"R":0},
  }),

  // 하이브리드 · 링에서 위치·스케일, 큐브에서 방향 · 기하는 bullseye.js 에서 유도
  // 회전 점수 8.4965 · 큐브 반지름 = 안쪽 2밴드 폭
  definePattern({
    id: "cube-bullseye",
    name: "Cube in bullseye",
    family: "cube-bullseye",
    sourceRun: 6,
    renderKind: "cube-bullseye",
    params: {
      detector: 'bullseye-ring-plus-three-tone-rank',
      palette: 'finder-cube-tones',
      faceOrder: 'T-bright-L-mid-R-dark',
      innerCubeBands: 2,
    },
    centerBalanceGatePassed: true,
    centerOffsetCells: 0.05773502691896258,
    scores: { rotation: 8.496527462282083, lowResolution: 56.86305472329061, localization: 31.206263986495248, dataDistinction: 100, structuralSimplicity: 55.779182982313365, defectConcentration: 90.68996821171089 },
    toneRanks: {"T":2,"L":1,"R":0},
  })
]);

export const FINDER_CELL_MASK_PATTERNS = Object.freeze(
  FINDER_PATTERNS.filter((pattern) => pattern.renderKind === 'cell-mask'),
);
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
