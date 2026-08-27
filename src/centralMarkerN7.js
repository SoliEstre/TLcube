/**
 * centralMarkerN7.js — 중앙 TL n=7 후보 B 마커의 단일 코드북.
 *
 * 이 마커는 데이터를 싣지 않는다. 7×7 전 셀은 고정된 pose/family 표식이며,
 * 인코더의 용량·formatIndex·셀 회계에는 관여하지 않는다. 프로브와 생성기는 이
 * 모듈을 함께 소비해야 한다 — 좌표나 코드워드의 사본을 다른 파일에 두지 않는다.
 */

export const CENTRAL_MARKER_N7_FINDER_PATTERN_ID = 'central-marker-n7';
export const CENTRAL_MARKER_N7_SIZE = 7;
export const CENTRAL_MARKER_N7_FAMILIES = Object.freeze(['hex', 'tri', 'star']);
export const CENTRAL_MARKER_N7_TURNS = Object.freeze([0, 1, 2]);
export const CENTRAL_MARKER_N7_PARITIES = Object.freeze([0, 1]);

/** 바깥 실루엣/내부 타입 → 중앙 TL family. */
export const CENTRAL_MARKER_N7_FAMILY_BY_TYPE = Object.freeze({
  O: 'hex',
  G: 'hex',
  A: 'tri',
  V: 'tri',
  K: 'star',
});

const FACES = Object.freeze(['T', 'L', 'R']);

// BCN7 §6에서 동결된 후보 B. 세 번째 값은 turn=0에서 밝은 pose 면(T/L/R=0/1/2).
const POSE_SPEC = Object.freeze([
  Object.freeze([0, 0, 0]), Object.freeze([6, 0, 0]),
  Object.freeze([0, 6, 0]), Object.freeze([6, 6, 1]),
  Object.freeze([1, 0, 1]), Object.freeze([0, 5, 2]),
  Object.freeze([5, 4, 2]), Object.freeze([4, 6, 2]),
  Object.freeze([5, 0, 1]), Object.freeze([0, 1, 2]),
  Object.freeze([6, 4, 1]), Object.freeze([2, 6, 0]),
]);

const FAMILY_GROUPS = Object.freeze([
  Object.freeze([
    Object.freeze([6, 2]), Object.freeze([0, 2]), Object.freeze([6, 5]),
    Object.freeze([5, 5]), Object.freeze([1, 1]), Object.freeze([2, 0]),
    Object.freeze([2, 5]), Object.freeze([4, 1]), Object.freeze([2, 2]),
    Object.freeze([6, 3]), Object.freeze([3, 1]), Object.freeze([1, 3]),
    Object.freeze([2, 4]),
  ]),
  Object.freeze([
    Object.freeze([6, 1]), Object.freeze([5, 1]), Object.freeze([3, 3]),
    Object.freeze([4, 3]), Object.freeze([5, 3]), Object.freeze([4, 4]),
    Object.freeze([5, 6]), Object.freeze([1, 6]), Object.freeze([2, 3]),
    Object.freeze([0, 3]), Object.freeze([4, 5]), Object.freeze([4, 0]),
  ]),
  Object.freeze([
    Object.freeze([1, 5]), Object.freeze([3, 0]), Object.freeze([1, 2]),
    Object.freeze([3, 5]), Object.freeze([2, 1]), Object.freeze([1, 4]),
    Object.freeze([3, 6]), Object.freeze([3, 2]), Object.freeze([3, 4]),
    Object.freeze([4, 2]), Object.freeze([5, 2]), Object.freeze([0, 4]),
  ]),
]);

const key = (i, j) => `${i},${j}`;
const POSE_BY_KEY = new Map(POSE_SPEC.map((entry) => [key(entry[0], entry[1]), entry[2]]));
const FAMILY_GROUP_BY_KEY = new Map();
for (let group = 0; group < FAMILY_GROUPS.length; group += 1) {
  for (const [i, j] of FAMILY_GROUPS[group]) {
    const cellKey = key(i, j);
    if (POSE_BY_KEY.has(cellKey) || FAMILY_GROUP_BY_KEY.has(cellKey)) {
      throw new Error('중앙 TL 후보 B 좌표가 중복됐다: ' + cellKey);
    }
    FAMILY_GROUP_BY_KEY.set(cellKey, group);
  }
}
if (POSE_BY_KEY.size !== 12 || FAMILY_GROUP_BY_KEY.size !== 37
  || POSE_BY_KEY.size + FAMILY_GROUP_BY_KEY.size !== CENTRAL_MARKER_N7_SIZE ** 2) {
  throw new Error('중앙 TL 후보 B 회계가 pose 12 + family 37 = 49가 아니다');
}

function assertFamily(family) {
  if (!CENTRAL_MARKER_N7_FAMILIES.includes(family)) {
    throw new RangeError('알 수 없는 중앙 TL family: ' + family);
  }
  return family;
}

function assertTurn(turn) {
  if (!CENTRAL_MARKER_N7_TURNS.includes(turn)) {
    throw new RangeError('중앙 TL turn은 0 | 1 | 2여야 한다: ' + turn);
  }
  return turn;
}

function assertParity(parity) {
  if (!CENTRAL_MARKER_N7_PARITIES.includes(parity)) {
    throw new RangeError('중앙 TL Y-parity는 0 | 1이어야 한다: ' + parity);
  }
  return parity;
}

function rotateVector(vector, turn) {
  return Object.freeze(FACES.map((unused, face) => vector[(face - turn + 3) % 3]));
}

function cellsFor(family, turn) {
  const familyIndex = CENTRAL_MARKER_N7_FAMILIES.indexOf(family);
  const cells = [];
  for (let j = 0; j < CENTRAL_MARKER_N7_SIZE; j += 1) {
    for (let i = 0; i < CENTRAL_MARKER_N7_SIZE; i += 1) {
      const cellKey = key(i, j);
      const poseFace = POSE_BY_KEY.get(cellKey);
      let bits;
      let role;
      if (poseFace !== undefined) {
        bits = [0, 0, 0];
        bits[poseFace] = 1;
        bits = rotateVector(bits, turn);
        role = 'pose';
      } else {
        const group = FAMILY_GROUP_BY_KEY.get(cellKey);
        const bit = group === familyIndex ? 0 : 1;
        bits = Object.freeze([bit, bit, bit]);
        role = 'family';
      }
      // 후보 B는 중간톤을 쓰지 않는다. bit 0/1을 팔레트 tone 0/2로 명시 승격한다.
      cells.push(Object.freeze({
        i,
        j,
        role,
        T: bits[0] * 2,
        L: bits[1] * 2,
        R: bits[2] * 2,
      }));
    }
  }
  return Object.freeze(cells);
}

const PATTERN_CELLS = new Map();
for (const family of CENTRAL_MARKER_N7_FAMILIES) {
  for (const turn of CENTRAL_MARKER_N7_TURNS) {
    PATTERN_CELLS.set(`${family}|${turn}`, cellsFor(family, turn));
  }
}

/**
 * 후보 B의 18상태(3 family × 3 turn × 2 Y-parity).
 *
 * parity는 Y-심이 정하는 기하 반사 축이다. face 코드워드는 같은 정규 좌표계에서
 * 읽으므로 두 parity가 같은 cells 참조를 공유하고, 렌더러/프로브가 mirrored를 기하에
 * 적용한다. 이 구분을 없애면 9상태 코드북으로 축소되어 60° parity가 조용히 사라진다.
 */
export const CENTRAL_MARKER_N7_CODEBOOK = Object.freeze(
  CENTRAL_MARKER_N7_FAMILIES.flatMap((family) =>
    CENTRAL_MARKER_N7_TURNS.flatMap((turn) =>
      CENTRAL_MARKER_N7_PARITIES.map((parity) => Object.freeze({
        family,
        turn,
        parity,
        mirrored: parity === 1,
        cells: PATTERN_CELLS.get(`${family}|${turn}`),
      })))),
);

/** family/turn/parity 한 상태를 반환한다. 강제 최근접 분류 함수는 의도적으로 없다. */
export function centralMarkerN7State(family, turn = 0, parity = 0) {
  assertFamily(family);
  assertTurn(turn);
  assertParity(parity);
  return CENTRAL_MARKER_N7_CODEBOOK.find((state) => state.family === family
    && state.turn === turn && state.parity === parity);
}

export function centralMarkerN7FamilyForType(type) {
  const family = CENTRAL_MARKER_N7_FAMILY_BY_TYPE[type];
  if (family === undefined) throw new RangeError('중앙 TL을 지원하지 않는 타입: ' + type);
  return family;
}

/** n×n 썸네일의 셀 공급을 한 번씩만 평가해 좌표와 함께 고정한다. */
export function mapCentralMarkerGrid(n, cellSupplier) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError('중앙 마커 썸네일 n은 양의 정수여야 한다: ' + n);
  }
  if (typeof cellSupplier !== 'function') {
    throw new TypeError('중앙 마커 썸네일 셀 공급자가 필요하다');
  }
  const cells = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const cell = cellSupplier(i, j);
      if (cell === null || typeof cell !== 'object') {
        throw new Error(`중앙 마커 썸네일 셀 (${i},${j})이 없다`);
      }
      cells.push(Object.freeze({ i, j, cell }));
    }
  }
  return Object.freeze(cells);
}

export function isCentralMarkerN7FinderPatternId(id) {
  return id === CENTRAL_MARKER_N7_FINDER_PATTERN_ID;
}

/** 중앙 TL은 디코더 배선 전까지 /lab/에서만 보이고 선택할 수 있다. */
export function centralMarkerN7VisibleOnSurface(lab) {
  return lab === true;
}

export function centralMarkerN7SelectionAllowed(id, lab) {
  return !isCentralMarkerN7FinderPatternId(id) || lab === true;
}

function safeFinderId(id, lab, fallbackId) {
  return centralMarkerN7SelectionAllowed(id, lab) ? id : fallbackId;
}

/**
 * 저장 상태/확장 주입으로 정식 화면에 lab 전용 선택이 살아난 경우 안전한 기본값으로
 * 되돌린다. 현재 선택뿐 아니라 직전 선택과 타입군 스냅샷도 함께 닫아 재유입을 막는다.
 */
export function sanitizeCentralMarkerN7FinderState(state, lab, fallbackId) {
  if (state === null || typeof state !== 'object') throw new TypeError('생성기 상태가 필요하다');
  if (typeof fallbackId !== 'string' || fallbackId === '') {
    throw new TypeError('중앙 TL 정식 화면 폴백 id가 필요하다');
  }
  if (lab === true) return state;

  let changed = false;
  const sanitizeProfile = (profile) => {
    if (profile === null || typeof profile !== 'object') return profile;
    const finderPatternId = safeFinderId(profile.finderPatternId, false, fallbackId);
    const previousFinderPatternId = safeFinderId(
      profile.previousFinderPatternId, false, fallbackId,
    );
    if (finderPatternId === profile.finderPatternId
      && previousFinderPatternId === profile.previousFinderPatternId) return profile;
    changed = true;
    return Object.freeze({ ...profile, finderPatternId, previousFinderPatternId });
  };

  let finderQrProfiles = state.finderQrProfiles;
  if (finderQrProfiles && typeof finderQrProfiles === 'object') {
    const sanitized = {};
    for (const [name, profile] of Object.entries(finderQrProfiles)) {
      sanitized[name] = sanitizeProfile(profile);
    }
    if (Object.keys(sanitized).some((name) => sanitized[name] !== finderQrProfiles[name])) {
      finderQrProfiles = Object.freeze(sanitized);
    }
  }

  const finderPatternId = safeFinderId(state.finderPatternId, false, fallbackId);
  const previousFinderPatternId = safeFinderId(
    state.previousFinderPatternId, false, fallbackId,
  );
  if (finderPatternId !== state.finderPatternId
    || previousFinderPatternId !== state.previousFinderPatternId
    || finderQrProfiles !== state.finderQrProfiles) changed = true;

  return changed ? {
    ...state,
    finderPatternId,
    previousFinderPatternId,
    finderQrProfiles,
  } : state;
}

// 코드북 자체의 핵심 거리와 49셀 3톤 계약을 로드 시점에 잠근다.
function logicalCellDistance(left, right, role) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].role !== role) continue;
    if (FACES.some((face) => left[index][face] !== right[index][face])) distance += 1;
  }
  return distance;
}

{
  if (CENTRAL_MARKER_N7_CODEBOOK.length !== 18) {
    throw new Error('중앙 TL 코드북이 18상태가 아니다');
  }
  for (const state of CENTRAL_MARKER_N7_CODEBOOK) {
    if (state.cells.length !== 49
      || state.cells.some((cell) => FACES.some((face) => ![0, 2].includes(cell[face])))) {
      throw new Error('중앙 TL 상태가 49셀 dark/light 3톤 배정이 아니다');
    }
  }
  const base = (family, turn) => PATTERN_CELLS.get(`${family}|${turn}`);
  const familyMinimum = Math.min(
    logicalCellDistance(base('hex', 0), base('tri', 0), 'family'),
    logicalCellDistance(base('hex', 0), base('star', 0), 'family'),
    logicalCellDistance(base('tri', 0), base('star', 0), 'family'),
  );
  const poseMinimum = Math.min(
    logicalCellDistance(base('hex', 0), base('hex', 1), 'pose'),
    logicalCellDistance(base('hex', 0), base('hex', 2), 'pose'),
    logicalCellDistance(base('hex', 1), base('hex', 2), 'pose'),
  );
  if (familyMinimum !== 24 || poseMinimum !== 12) {
    throw new Error(`중앙 TL 동결 거리 불일치: family=${familyMinimum}, pose=${poseMinimum}`);
  }
}
