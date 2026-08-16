/**
 * autoplaceY.js — 셀 표면 경로의 format · reference 좌표를 파인더 점유에서 유도.
 *
 * 입력은 n 과 파인더가 점유한 셀 집합(toneOverrides 가 닿는 (i,j) 전체)이다.
 * 출력은 format **3복제 × formatBlockLength 셀** (v1=15 · v2=18) · reference 12셀
 * (4조×L자 3셀). 같은 입력은 바이트 동일 출력을 낸다 — 집합 순회 순서·부동소수·
 * 동률 자유도가 없다.
 *
 * **포맷 세대 (2026-08-16 마스크 선택 개정)**: 포맷 v2 는 6번째 digit 을 더해
 * 복제당 6셀 = **18셀**이 된다(`formatinfo.js` FORMAT_CELLS_V2). 어느 세대를 쓰는지는
 * 레이아웃이 정하므로 `placeReservedCells(n, occupied, { formatBlockLength })` 로 받는다 —
 * 기본값은 5(v1)라 **호출부를 안 고친 경로는 바이트 동일**하다. 신세대 셀 표면
 * (cellSurfaceFinal.js: v0 · v0x · v1r2 · v2r2)만 6 을 넘긴다. 초안·소각 와이어
 * (cellSurfaceLayouts.js: v1r2d · v2)와 레거시 Y 는 5 그대로다.
 * 디코더는 **두 세대를 다 유도한다** — v2 프레임과 개정 전 v1 프레임을 같은 함수로
 * 읽기 위해서다(레거시 판독 공존, cellSurfaceFinal.js CELL_SURFACE_FINAL_FORMAT_WIRES).
 *
 * ⚠ **반환 형태 변경 (같은 개정)**: 동결 반환 객체에 `formatBlockLength` 키가 **생겼다**.
 * v1 기본 호출의 `formatCells` · `referenceCells` · `metrics` 값은 개정 전과 바이트
 * 동일하지만 **객체 자체는 키가 하나 더 많다** — 반환값을 통째로 deep-equal 하는
 * 소비자가 있으면 거기서 깨진다(적대 검증 F5). 값 동일 ≠ 형태 동일.
 *
 * 셀 표면 경로 전용. 일반 Y·Y0·Y2 비 셀표면은 placementY.js 가 그대로 담당한다.
 *
 * 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).
 */

import {
  FORMAT_BLOCK_LENGTH,
  FORMAT_REPLICAS,
  formatCells as legacyFormatCells,
  referenceAnchors,
} from './placementY.js';
import { DIGIT_COUNT_V2 } from './formatinfo.js';

/** 포맷 v1 복제 길이 (5). 옵션을 안 주면 이것이 기본 — 기존 경로 불변. */
export const FORMAT_BLOCK_LENGTH_V1 = FORMAT_BLOCK_LENGTH;

/** 포맷 v2 복제 길이 (6). 신세대 셀 표면 전용. */
export const FORMAT_BLOCK_LENGTH_V2 = DIGIT_COUNT_V2;

export const AUTOPLACE_MIN_N = 11;
export const REFERENCE_GROUP_COUNT = 4;
export const L_SHAPE_OFFSETS = Object.freeze([
  Object.freeze({ di: 0, dj: 0 }),
  Object.freeze({ di: 1, dj: 0 }),
  Object.freeze({ di: 0, dj: 1 }),
]);

export const AUTOPLACE_REF_QUADRANT = 'AUTOPLACE_REF_QUADRANT';
export const AUTOPLACE_REF_DISPERSION = 'AUTOPLACE_REF_DISPERSION';
export const AUTOPLACE_REF_COLLINEAR = 'AUTOPLACE_REF_COLLINEAR';
export const AUTOPLACE_FORMAT_SLOT = 'AUTOPLACE_FORMAT_SLOT';
export const AUTOPLACE_FORMAT_SEPARATION = 'AUTOPLACE_FORMAT_SEPARATION';
export const AUTOPLACE_COLLISION = 'AUTOPLACE_COLLISION';

const QUADRANT_IDS = Object.freeze(['NW', 'NE', 'SW', 'SE']);

export class AutoplaceError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'AutoplaceError';
    this.code = code;
    this.detail = detail || null;
  }
}

function assertN(n) {
  if (!Number.isInteger(n) || n < AUTOPLACE_MIN_N) {
    throw new RangeError('n 은 ' + AUTOPLACE_MIN_N + ' 이상의 정수여야 한다: ' + n);
  }
  return n;
}

function cellKey(i, j) {
  return i + ',' + j;
}

function parseCell(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const parts = value.split(',');
    if (parts.length !== 2) return null;
    return { i: Number(parts[0]), j: Number(parts[1]) };
  }
  if (Array.isArray(value) && value.length >= 2) {
    return { i: value[0], j: value[1] };
  }
  if (Number.isInteger(value.i) && Number.isInteger(value.j)) {
    return { i: value.i, j: value.j };
  }
  return null;
}

function compareCell(a, b) {
  return a.i - b.i || a.j - b.j;
}

function dist2(a, b) {
  const di = a.i - b.i;
  const dj = a.j - b.j;
  return di * di + dj * dj;
}

function chebyshev(a, b) {
  const di = a.i < b.i ? b.i - a.i : a.i - b.i;
  const dj = a.j < b.j ? b.j - a.j : a.j - b.j;
  return di > dj ? di : dj;
}

function midIndex(n) {
  return n >> 1;
}

function quadrantOf(n, i, j) {
  const mid = midIndex(n);
  return (i >= mid ? 1 : 0) + (j >= mid ? 2 : 0);
}

function inBounds(n, i, j) {
  return i >= 0 && j >= 0 && i < n && j < n;
}

function lShapeCells(p, q) {
  return L_SHAPE_OFFSETS.map((off) => ({ i: p + off.di, j: q + off.dj }));
}

function lFits(n, p, q, inset) {
  const cells = lShapeCells(p, q);
  for (const cell of cells) {
    if (!inBounds(n, cell.i, cell.j)) return false;
    if (cell.i < inset || cell.j < inset) return false;
    if (cell.i > n - 1 - inset || cell.j > n - 1 - inset) return false;
  }
  return true;
}

function runCells(orient, startI, startJ, length) {
  const cells = [];
  for (let k = 0; k < length; k += 1) {
    cells.push(orient === 'h'
      ? { i: startI + k, j: startJ }
      : { i: startI, j: startJ + k });
  }
  return cells;
}

function runFits(n, orient, startI, startJ, length, inset) {
  const lastI = orient === 'h' ? startI + length - 1 : startI;
  const lastJ = orient === 'v' ? startJ + length - 1 : startJ;
  if (startI < inset || startJ < inset) return false;
  if (lastI > n - 1 - inset || lastJ > n - 1 - inset) return false;
  if (startI < 0 || startJ < 0 || lastI >= n || lastJ >= n) return false;
  return true;
}

function cellsBlocked(cells, blocked) {
  for (const cell of cells) {
    if (blocked.has(cellKey(cell.i, cell.j))) return true;
  }
  return false;
}

function addCells(blocked, cells) {
  for (const cell of cells) blocked.add(cellKey(cell.i, cell.j));
}

/**
 * 레퍼런스 4조 최소 분산: 인접 코너 간격 (n−5) 의 절반을 제곱.
 * n=21 → 64 (거리 ≥ 8), n=13 → 16, n=25 → 100, n=11 → 9.
 */
export function minReferenceDispersion(n) {
  const half = (assertN(n) - 5) >> 1;
  return half * half;
}

/**
 * 포맷 3복제 이격: 가장 먼 쌍의 중심 거리² 하한 (n−4)².
 * 레거시 배치에서 복제 0·1 은 가깝고 복제 2 가 멀리 있는 구조를 수치화한다.
 */
export function minFormatSeparation(n) {
  const span = assertN(n) - 4;
  return span * span;
}

export function idealReferenceAnchors(n) {
  return referenceAnchors(assertN(n)).map((anchor) => ({ i: anchor.p, j: anchor.q }));
}

export function idealFormatSlots(n) {
  assertN(n);
  const legacy = legacyFormatCells(n);
  return Object.freeze([
    Object.freeze({
      id: 0,
      orient: 'h',
      start: Object.freeze({ i: legacy[0].i, j: legacy[0].j }),
    }),
    Object.freeze({
      id: 1,
      orient: 'v',
      start: Object.freeze({ i: legacy[FORMAT_BLOCK_LENGTH].i, j: legacy[FORMAT_BLOCK_LENGTH].j }),
    }),
    Object.freeze({
      id: 2,
      orient: 'h',
      start: Object.freeze({
        i: legacy[FORMAT_BLOCK_LENGTH * 2].i,
        j: legacy[FORMAT_BLOCK_LENGTH * 2].j,
      }),
    }),
  ]);
}

/**
 * 점유 입력을 정렬된 고유 (i,j) 목록과 Set 으로 정규화한다.
 * 호출자가 넘긴 순서는 버린다 — 결정성의 입구.
 */
export function normalizeOccupied(n, occupied) {
  assertN(n);
  const seen = new Set();
  const cells = [];
  const list = occupied == null ? [] : occupied;
  if (typeof list[Symbol.iterator] !== 'function') {
    throw new TypeError('occupied 는 이터러블이어야 한다');
  }
  for (const raw of list) {
    const cell = parseCell(raw);
    if (!cell || !Number.isInteger(cell.i) || !Number.isInteger(cell.j)) {
      throw new RangeError('occupied 항목이 {i,j} 가 아니다');
    }
    if (!inBounds(n, cell.i, cell.j)) {
      throw new RangeError(
        'occupied 셀 (' + cell.i + ',' + cell.j + ') 이 n=' + n + ' 밖이다',
      );
    }
    const key = cellKey(cell.i, cell.j);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ i: cell.i, j: cell.j });
  }
  cells.sort(compareCell);
  return { cells: Object.freeze(cells), keys: seen };
}

function pickBestL(n, blocked, ideal, quadrant, inset) {
  let best = null;
  for (let p = 0; p <= n - 2; p += 1) {
    for (let q = 0; q <= n - 2; q += 1) {
      if (quadrantOf(n, p, q) !== quadrant) continue;
      if (!lFits(n, p, q, inset)) continue;
      const cells = lShapeCells(p, q);
      if (cellsBlocked(cells, blocked)) continue;
      const anchor = { i: p, j: q };
      const cheb = chebyshev(anchor, ideal);
      const d2 = dist2(anchor, ideal);
      if (
        !best
        || cheb < best.cheb
        || (cheb === best.cheb && d2 < best.d2)
        || (cheb === best.cheb && d2 === best.d2 && (p - best.p || q - best.q) < 0)
      ) {
        best = { p, q, cells, cheb, d2 };
      }
    }
  }
  return best;
}

function placeReferenceGroups(n, blocked) {
  const ideals = idealReferenceAnchors(n);
  const groups = [];
  for (let qid = 0; qid < REFERENCE_GROUP_COUNT; qid += 1) {
    const ideal = ideals[qid];
    let picked = pickBestL(n, blocked, ideal, qid, 1);
    if (!picked) picked = pickBestL(n, blocked, ideal, qid, 0);
    if (!picked) {
      throw new AutoplaceError(
        AUTOPLACE_REF_QUADRANT,
        '사분면 ' + QUADRANT_IDS[qid]
          + ' 에 레퍼런스 L자 3셀을 둘 자리가 없다 (이상 앵커 '
          + ideal.i + ',' + ideal.j + ')',
        { quadrant: QUADRANT_IDS[qid], ideal },
      );
    }
    groups.push({
      anchor: { i: picked.p, j: picked.q },
      cells: picked.cells.map((cell) => ({ i: cell.i, j: cell.j })),
    });
    addCells(blocked, picked.cells);
  }

  let dRef = Infinity;
  for (let a = 0; a < groups.length; a += 1) {
    for (let b = a + 1; b < groups.length; b += 1) {
      const d2 = dist2(groups[a].anchor, groups[b].anchor);
      if (d2 < dRef) dRef = d2;
    }
  }
  const required = minReferenceDispersion(n);
  if (dRef < required) {
    throw new AutoplaceError(
      AUTOPLACE_REF_DISPERSION,
      '레퍼런스 분산 D_ref=' + dRef + ' 이 하한 ' + required + ' 미만이다',
      { dRef, required, anchors: groups.map((g) => g.anchor) },
    );
  }

  const i0 = groups[0].anchor.i;
  const j0 = groups[0].anchor.j;
  const sameI = groups.every((g) => g.anchor.i === i0);
  const sameJ = groups.every((g) => g.anchor.j === j0);
  const diagMinus = groups[0].anchor.i - groups[0].anchor.j;
  const sameDiagMinus = groups.every((g) => g.anchor.i - g.anchor.j === diagMinus);
  const diagPlus = groups[0].anchor.i + groups[0].anchor.j;
  const sameDiagPlus = groups.every((g) => g.anchor.i + g.anchor.j === diagPlus);
  if (sameI || sameJ || sameDiagMinus || sameDiagPlus) {
    throw new AutoplaceError(
      AUTOPLACE_REF_COLLINEAR,
      '레퍼런스 4조 앵커가 한 직선 위에 있다',
      { anchors: groups.map((g) => g.anchor) },
    );
  }

  return { groups, dRef };
}

function runCentroidDoubled(orient, startI, startJ, length) {
  if (orient === 'h') {
    return { x: 2 * startI + (length - 1), y: 2 * startJ };
  }
  return { x: 2 * startI, y: 2 * startJ + (length - 1) };
}

function pickBestRun(n, blocked, slot, length) {
  let best = null;
  const orients = ['h', 'v'];
  for (const orient of orients) {
    const maxI = orient === 'h' ? n - length : n - 1;
    const maxJ = orient === 'v' ? n - length : n - 1;
    for (let i = 0; i <= maxI; i += 1) {
      for (let j = 0; j <= maxJ; j += 1) {
        if (!runFits(n, orient, i, j, length, 1)) continue;
        const cells = runCells(orient, i, j, length);
        if (cellsBlocked(cells, blocked)) continue;
        const start = { i, j };
        const orientMatch = orient === slot.orient ? 1 : 0;
        const cheb = chebyshev(start, slot.start);
        const d2 = dist2(start, slot.start);
        if (
          !best
          || orientMatch > best.orientMatch
          || (orientMatch === best.orientMatch && cheb < best.cheb)
          || (orientMatch === best.orientMatch && cheb === best.cheb && d2 < best.d2)
          || (orientMatch === best.orientMatch && cheb === best.cheb && d2 === best.d2
            && (i - best.i || j - best.j) < 0)
        ) {
          best = { orient, i, j, cells, orientMatch, cheb, d2 };
        }
      }
    }
  }
  return best;
}

function placeFormatReplicas(n, blocked, length) {
  const slots = idealFormatSlots(n);
  const replicas = [];
  for (const slot of slots) {
    const picked = pickBestRun(n, blocked, slot, length);
    if (!picked) {
      throw new AutoplaceError(
        AUTOPLACE_FORMAT_SLOT,
        '포맷 복제 ' + slot.id + ' 에 연속 ' + length + '셀을 둘 자리가 없다',
        { slot, formatBlockLength: length },
      );
    }
    replicas.push({
      id: slot.id,
      orient: picked.orient,
      start: { i: picked.i, j: picked.j },
      cells: picked.cells.map((cell) => ({ i: cell.i, j: cell.j })),
      centroid: runCentroidDoubled(picked.orient, picked.i, picked.j, length),
    });
    addCells(blocked, picked.cells);
  }

  let maxSep = 0;
  let minSep = Infinity;
  for (let a = 0; a < replicas.length; a += 1) {
    for (let b = a + 1; b < replicas.length; b += 1) {
      const dx = replicas[a].centroid.x - replicas[b].centroid.x;
      const dy = replicas[a].centroid.y - replicas[b].centroid.y;
      // 중심은 2배 좌표라 실제 거리² = (dx²+dy²)/4.
      //
      // ⚠ **가드 삭제 사유 (2026-08-16 · 적대 검증 F5 지적 반영)**. 개정 전에는
      // `(dx²+dy²) % 4 !== 0` 이면 AUTOPLACE_COLLISION 을 던졌다. 그 «정수 강제» 는
      // 복제 길이가 **홀수**(v1=5)일 때만 성립하던 우연이다 — 홀수 길이면 런 중심의
      // 2배 좌표가 항상 짝수라 나눗셈이 정수로 떨어진다. **짝수**(v2=6)에서는 h 런과
      // v 런의 중심이 반 칸씩 어긋나 1/4 단위가 남고(실측 sFmtMin 40.5 · 84.5 · 60.5),
      // 참인 배치가 가드에 걸린다. 그래서 길이 조건부로 남기지 않고 **통째로 지웠다** —
      // v1 경로도 이제 가드가 없다. 값은 그대로다(v1 5 인스턴스 전부 정수로 떨어짐을
      // 회귀가 단언). 게이트가 실제로 쓰는 것은 `sFmtMax ≥ sFmtMinRequired` 쪽이고
      // 그 비교는 1/4 단위에서도 성립하므로 어떤 하한도 완화되지 않았다.
      const d2 = (dx * dx + dy * dy) / 4;
      if (d2 > maxSep) maxSep = d2;
      if (d2 < minSep) minSep = d2;
    }
  }
  const required = minFormatSeparation(n);
  if (maxSep < required) {
    throw new AutoplaceError(
      AUTOPLACE_FORMAT_SEPARATION,
      '포맷 복제 최대 이격 S_fmt=' + maxSep + ' 이 하한 ' + required + ' 미만이다',
      { maxSep, minSep, required },
    );
  }
  return { replicas, maxSep, minSep };
}

function freezeCells(cells) {
  return Object.freeze(cells.map((cell) => Object.freeze({ i: cell.i, j: cell.j })));
}

function assertFormatBlockLength(length) {
  if (length !== FORMAT_BLOCK_LENGTH_V1 && length !== FORMAT_BLOCK_LENGTH_V2) {
    throw new RangeError(
      'formatBlockLength 는 ' + FORMAT_BLOCK_LENGTH_V1 + '(v1) 또는 '
      + FORMAT_BLOCK_LENGTH_V2 + '(v2) 여야 한다: ' + length,
    );
  }
  return length;
}

/**
 * n 과 파인더 점유 셀에서 format(3복제 × blockLength) · reference 12 를 유도한다.
 * @param {number} n
 * @param {Iterable} occupied
 * @param {{formatBlockLength?:number}} [options] 생략 시 v1(5) — 기존 경로 불변.
 * @returns {{
 *   n:number,
 *   formatBlockLength:number,
 *   formatCells:{i:number,j:number}[],
 *   referenceCells:{i:number,j:number}[],
 *   referenceGroups:{anchor:{i:number,j:number}, cells:{i:number,j:number}[]}[],
 *   metrics:{dRef:number, dRefMin:number, sFmtMax:number, sFmtMin:number, sFmtMinRequired:number, occupied:number}
 * }}
 */
export function placeReservedCells(n, occupied, options = {}) {
  const size = assertN(n);
  const blockLength = assertFormatBlockLength(
    options.formatBlockLength === undefined ? FORMAT_BLOCK_LENGTH_V1 : options.formatBlockLength,
  );
  const normalized = normalizeOccupied(size, occupied);
  const blocked = new Set(normalized.keys);

  const refs = placeReferenceGroups(size, blocked);
  const fmts = placeFormatReplicas(size, blocked, blockLength);

  const formatCells = [];
  for (const replica of fmts.replicas) {
    for (const cell of replica.cells) formatCells.push(cell);
  }
  const referenceCells = [];
  for (const group of refs.groups) {
    for (const cell of group.cells) referenceCells.push(cell);
  }

  if (formatCells.length !== FORMAT_REPLICAS * blockLength) {
    throw new AutoplaceError(
      AUTOPLACE_COLLISION,
      'format 셀 수가 ' + (FORMAT_REPLICAS * blockLength) + ' 가 아니다: ' + formatCells.length,
    );
  }
  if (referenceCells.length !== REFERENCE_GROUP_COUNT * 3) {
    throw new AutoplaceError(
      AUTOPLACE_COLLISION,
      'reference 셀 수가 12 가 아니다: ' + referenceCells.length,
    );
  }

  const seen = new Set();
  for (const cell of [...formatCells, ...referenceCells]) {
    const key = cellKey(cell.i, cell.j);
    if (seen.has(key)) {
      throw new AutoplaceError(AUTOPLACE_COLLISION, '배치 내부 중복: ' + key);
    }
    if (normalized.keys.has(key)) {
      throw new AutoplaceError(
        AUTOPLACE_COLLISION,
        '배치가 파인더 점유와 겹친다: ' + key,
      );
    }
    seen.add(key);
  }

  return Object.freeze({
    n: size,
    formatBlockLength: blockLength,
    formatCells: freezeCells(formatCells),
    referenceCells: freezeCells(referenceCells),
    referenceGroups: Object.freeze(refs.groups.map((group) => Object.freeze({
      anchor: Object.freeze({ i: group.anchor.i, j: group.anchor.j }),
      cells: freezeCells(group.cells),
    }))),
    metrics: Object.freeze({
      dRef: refs.dRef,
      dRefMin: minReferenceDispersion(size),
      sFmtMax: fmts.maxSep,
      sFmtMin: fmts.minSep,
      sFmtMinRequired: minFormatSeparation(size),
      occupied: normalized.cells.length,
    }),
  });
}

/** 결정성 대조용. 같은 배치는 같은 문자열. */
export function placementKey(placement) {
  const fmt = placement.formatCells.map((c) => cellKey(c.i, c.j)).join(';');
  const ref = placement.referenceCells.map((c) => cellKey(c.i, c.j)).join(';');
  return placement.n + '|F:' + fmt + '|R:' + ref;
}

export function roleMapFromPlacement(placement) {
  const map = new Map();
  placement.referenceCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'reference', index });
  });
  placement.formatCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'format', index });
  });
  return map;
}

export function movedReservedCount(left, right) {
  const a = new Set(left.formatCells.concat(left.referenceCells).map((c) => cellKey(c.i, c.j)));
  const b = new Set(right.formatCells.concat(right.referenceCells).map((c) => cellKey(c.i, c.j)));
  let onlyA = 0;
  for (const key of a) {
    if (!b.has(key)) onlyA += 1;
  }
  return onlyA;
}
