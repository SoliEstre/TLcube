/**
 * autoplaceHex.js — 육각(Type O/A 육각부) 경로의 format · reference 좌표를
 * «검출기가 점유한 셀» 에서 유도한다. `autoplaceY.js` 의 계약을 축 좌표 링 산술로
 * 옮긴 것이며, 세 성질을 그대로 지킨다:
 *
 *   ① **결정적** — 같은 (k, occupied) 는 바이트 동일 출력. 집합 순회 순서·부동소수·
 *      동률 자유도가 없다. 모든 탐색이 **이상 인덱스에서 시작하는 정방향(+1) 선형
 *      스캔**이고 «처음 만난 빈 칸» 이 곧 답이므로, 애초에 동률이 생기지 않는다.
 *   ② **탐색 규칙 = 레거시 규칙** — 자리를 «순환 거리 최소» 로 고르지 **않는다**.
 *      `placement.referenceCells`(그리고 포맷 블록)가 쓰는 규칙이 정방향 선형 스캔
 *      이고, 레거시 좌표를 그대로 재현하는 유일한 규칙이 그것이기 때문이다.
 *      (처음엔 `autoplaceY` 처럼 순환 거리 최소로 짰다가 링 3 에서 레거시와 다른
 *      셀을 골랐고, 모듈 로드 자기검증이 그것을 잡아 정정했다. 이 파일의
 *      `cyclicDistance` 는 **선택이 아니라 검사**에만 쓰인다 — 배치된 레퍼런스 2셀의
 *      각분리를 «재는» 자다.)
 *      하한(포맷 3복제 이격 · 링당 레퍼런스 2셀 각분리)은 레거시 배치 실계산에서
 *      유도한다. 상수를 손으로 적지 않는다.
 *   ③ **AutoplaceError** — 자리를 못 찾거나 하한을 못 지키면 조용히 타협하지 않고
 *      코드가 붙은 오류를 던진다. 오류 클래스는 `autoplaceY.js` 의 것을 그대로
 *      재사용한다(소비자가 한 종류만 catch 하면 되게).
 *
 * 왜 필요한가: 코너 마커(markerO.js)는 링 k·k−1 의 코너 주변 셀을 예약한다. 레거시
 * `referenceCells(k, r)` 는 링 인덱스 0 / 3r 에서 «앵커·포맷만» 점유로 보고 선형
 * 탐색하므로, 마커가 그 자리를 먹으면 좌표가 겹친다 (실측: 모든 k 에서 링 k 와
 * 링 k−1 레퍼런스 각 1셀이 코너 tetrad 와 충돌한다). 이 모듈이 그 재배치를 맡는다.
 *
 * **레거시 무영향**: `occupied` 가 마커 없이(=불스아이+앵커만) 들어오면 산출은
 * `placement.js` 의 `formatCells(k)` · `referenceCellsAll(k)` 와 **좌표까지 동일**하다
 * (autoplaceHex.test.js 가 k=6·8·10 전수로 고정한다). 즉 이 모듈은 레거시의
 * 일반화이지 대체가 아니다.
 *
 * 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).
 */

import { hexDistance } from './hexgrid.js';
import {
  FORMAT_RING,
  FORMAT_BLOCK_LENGTH,
  FORMAT_REPLICAS,
  ringWalk,
  formatBlockStarts,
  formatCells as legacyFormatCells,
  referenceCellsAll as legacyReferenceCellsAll,
  anchorPositionSet,
} from './placement.js';
import { AutoplaceError } from './autoplaceY.js';

export const AUTOPLACE_HEX_FORMAT_SLOT = 'AUTOPLACE_HEX_FORMAT_SLOT';
export const AUTOPLACE_HEX_FORMAT_SEPARATION = 'AUTOPLACE_HEX_FORMAT_SEPARATION';
export const AUTOPLACE_HEX_REF_RING = 'AUTOPLACE_HEX_REF_RING';
export const AUTOPLACE_HEX_REF_SEPARATION = 'AUTOPLACE_HEX_REF_SEPARATION';
export const AUTOPLACE_HEX_COLLISION = 'AUTOPLACE_HEX_COLLISION';

export { AutoplaceError };

const MIN_K = FORMAT_RING + 1;

function key(q, r) {
  return q + ',' + r;
}

function assertK(k) {
  if (!Number.isInteger(k) || k < MIN_K) {
    throw new RangeError('k 는 ' + MIN_K + ' 이상의 정수여야 한다: ' + k);
  }
  return k;
}

function parseCell(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const parts = value.split(',');
    if (parts.length !== 2) return null;
    return { q: Number(parts[0]), r: Number(parts[1]) };
  }
  if (Array.isArray(value) && value.length >= 2) return { q: value[0], r: value[1] };
  if (Number.isInteger(value.q) && Number.isInteger(value.r)) return { q: value.q, r: value.r };
  return null;
}

/**
 * 점유 입력을 정렬된 고유 (q,r) 목록 + Set 으로 정규화한다. 호출자가 넘긴 순서는
 * 버린다 — 결정성의 입구 (`autoplaceY.normalizeOccupied` 와 동형).
 * @param {number} k
 * @param {Iterable} occupied
 */
export function normalizeOccupiedHex(k, occupied) {
  assertK(k);
  const seen = new Set();
  const cells = [];
  const list = occupied == null ? [] : occupied;
  if (typeof list[Symbol.iterator] !== 'function') {
    throw new TypeError('occupied 는 이터러블이어야 한다');
  }
  for (const raw of list) {
    const cell = parseCell(raw);
    if (!cell || !Number.isInteger(cell.q) || !Number.isInteger(cell.r)) {
      throw new RangeError('occupied 항목이 {q,r} 가 아니다');
    }
    if (hexDistance(cell.q, cell.r) > k) {
      throw new RangeError('occupied 셀 (' + cell.q + ',' + cell.r + ') 이 k=' + k + ' 육각부 밖이다');
    }
    const kk = key(cell.q, cell.r);
    if (seen.has(kk)) continue;
    seen.add(kk);
    cells.push({ q: cell.q, r: cell.r });
  }
  cells.sort((a, b) => a.q - b.q || a.r - b.r);
  return { cells: Object.freeze(cells), keys: seen };
}

/** 링 인덱스 순환 거리. */
function cyclicDistance(a, b, size) {
  const d = Math.abs(a - b) % size;
  return Math.min(d, size - d);
}

// ─────────────────────────────────────────────────────────────────────────
// 하한 — 전부 레거시 배치 실계산에서 유도한다 (하드코딩 없음)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 포맷 3복제의 «가장 가까운 두 복제» 시작 셀 사이 hexDistance 하한.
 * 레거시(링 3, 인덱스 0/6/12)의 실계산 최소값을 그대로 쓴다.
 * @param {number} k
 */
export function minFormatSeparationHex(k) {
  assertK(k);
  const starts = formatBlockStarts();
  const ring = ringWalk(FORMAT_RING);
  let min = Infinity;
  for (let a = 0; a < starts.length; a += 1) {
    for (let b = a + 1; b < starts.length; b += 1) {
      const ca = ring[starts[a] % ring.length];
      const cb = ring[starts[b] % ring.length];
      const d = hexDistance(ca.q - cb.q, ca.r - cb.r);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * 링 r 의 레퍼런스 2셀 사이 «링 인덱스 순환 거리» 하한 = ⌊6r/3⌋ = **2r**.
 *
 * 유도 (코드와 맞춘 값): 링 r 의 둘레는 6r 칸이므로 2r 은 **원주의 1/3 = 120°** 다.
 * 레거시가 노리는 이상 자리는 대척점 3r(=180°)이고, 이 하한은 그 **2/3** 다 —
 * «대척에서 최대 60° 까지 밀려도 된다» 는 뜻이다.
 *
 * ⚠ **여유 0 지점이 실재한다 (실측 2026-08-16, `_oak-bench-r2.mjs` §4)**:
 * 링 3 은 포맷 3복제 × 5셀 = 15셀이 18칸 중 15칸을 먹어 빈 인덱스가 {5, 11, 17}
 * 셋뿐이고, 어느 두 개를 골라도 순환 거리가 정확히 6 = 하한 2·3 이다. 즉
 * **k=6·8·10 전부에서 링 3 의 arc − required = 0** 이며 이는 레거시 점유·마커 점유
 * 양쪽 모두 같다 (링 4 이상은 여유가 4 에서 9 사이). 따라서 이 하한을 1 이라도 올리면 링 3 이
 * 전 k 에서 `AUTOPLACE_HEX_REF_SEPARATION` 으로 죽는다. 또한 링 3 의 남은 빈 칸
 * 3개 중 **2개가 더 점유되면** `AUTOPLACE_HEX_REF_RING` 이 던져진다 (1개까지는
 * arc 6 을 유지한다 — 실측). 링 3 은 조용히 타협할 여지가 없는 자리다.
 *
 * @param {number} r
 */
export function minReferenceArcHex(r) {
  return Math.floor((6 * r) / 3);
}

// ─────────────────────────────────────────────────────────────────────────
// 포맷 15셀 (3복제 × 연속 5셀)
// ─────────────────────────────────────────────────────────────────────────

/** 이상 슬롯 — 레거시 `formatCells(k)` 가 쓰는 (링, 시작 인덱스) 3개. */
export function idealFormatSlotsHex(k) {
  assertK(k);
  return Object.freeze(formatBlockStarts().map((start, id) => Object.freeze({
    id, ring: FORMAT_RING, start,
  })));
}

function runOnRing(ring, start, length) {
  const cells = [];
  for (let i = 0; i < length; i += 1) cells.push(ring[(start + i) % ring.length]);
  return cells;
}

function runBlocked(cells, blocked) {
  for (const c of cells) if (blocked.has(key(c.q, c.r))) return true;
  return false;
}

function pickBestRun(k, blocked, slot) {
  // 탐색 순서: 이상 링(3) 부터 바깥으로. 링 안에서는 **이상 시작 인덱스에서
  // 정방향 선형 탐색** — `placement.referenceCells` 가 쓰는 규칙과 같은 것이고,
  // 레거시 좌표를 그대로 재현하는 유일한 규칙이다 (nearest-cyclic 은 링3 에서
  // 레거시와 다른 셀을 고른다 — 실측으로 확인하고 정정했다).
  for (let r = slot.ring; r <= k; r += 1) {
    const ring = ringWalk(r);
    const size = ring.length;
    // 이상 인덱스를 링 크기에 비례 사상 (링 3 의 인덱스를 링 r 로 옮긴다).
    const ideal = Math.round((slot.start / (6 * slot.ring)) * size) % size;
    for (let step = 0; step < size; step += 1) {
      const s = (ideal + step) % size;
      const cells = runOnRing(ring, s, FORMAT_BLOCK_LENGTH);
      if (runBlocked(cells, blocked)) continue;
      return {
        d: step, s, ring: r, cells,
      };
    }
  }
  return null;
}

function placeFormat(k, blocked) {
  const replicas = [];
  for (const slot of idealFormatSlotsHex(k)) {
    const picked = pickBestRun(k, blocked, slot);
    if (!picked) {
      throw new AutoplaceError(
        AUTOPLACE_HEX_FORMAT_SLOT,
        '포맷 복제 ' + slot.id + ' 에 연속 ' + FORMAT_BLOCK_LENGTH + '셀을 둘 링이 없다 (k=' + k + ')',
        { slot, k },
      );
    }
    replicas.push({
      id: slot.id, ring: picked.ring, start: picked.s, cells: picked.cells,
    });
    for (const c of picked.cells) blocked.add(key(c.q, c.r));
  }

  let minSep = Infinity;
  for (let a = 0; a < replicas.length; a += 1) {
    for (let b = a + 1; b < replicas.length; b += 1) {
      const ca = replicas[a].cells[0];
      const cb = replicas[b].cells[0];
      const d = hexDistance(ca.q - cb.q, ca.r - cb.r);
      if (d < minSep) minSep = d;
    }
  }
  const required = minFormatSeparationHex(k);
  if (minSep < required) {
    throw new AutoplaceError(
      AUTOPLACE_HEX_FORMAT_SEPARATION,
      '포맷 복제 최소 이격 ' + minSep + ' 이 하한 ' + required + ' 미만이다',
      { minSep, required, starts: replicas.map((x) => x.cells[0]) },
    );
  }
  return { replicas, minSep, required };
}

// ─────────────────────────────────────────────────────────────────────────
// 레퍼런스 — 데이터 링(3..k) 당 2셀
// ─────────────────────────────────────────────────────────────────────────

function placeReferences(k, blocked) {
  const rings = [];
  for (let r = FORMAT_RING; r <= k; r += 1) {
    const ring = ringWalk(r);
    const size = ring.length;
    const ideals = [0, 3 * r];
    const picked = [];
    for (const ideal of ideals) {
      let best = null;
      // 이상 인덱스에서 **정방향 선형 탐색** — `placement.referenceCells` 의 규칙
      // 그대로. 점유 판정만 «앵커·포맷» 에서 «임의의 예약 셀» 로 넓힌 것이다.
      for (let step = 0; step < size; step += 1) {
        const s = (ideal + step) % size;
        const c = ring[s];
        if (blocked.has(key(c.q, c.r))) continue;
        if (picked.some((p) => p.index === s)) continue;
        best = { d: step, index: s, cell: c };
        break;
      }
      if (!best) {
        throw new AutoplaceError(
          AUTOPLACE_HEX_REF_RING,
          '링 ' + r + ' 에 레퍼런스 셀을 둘 빈 칸이 없다 (k=' + k + ')',
          { k, ring: r, ideal },
        );
      }
      picked.push(best);
      blocked.add(key(best.cell.q, best.cell.r));
    }
    const arc = cyclicDistance(picked[0].index, picked[1].index, size);
    const requiredArc = minReferenceArcHex(r);
    if (arc < requiredArc) {
      throw new AutoplaceError(
        AUTOPLACE_HEX_REF_SEPARATION,
        '링 ' + r + ' 레퍼런스 2셀 각분리 ' + arc + ' 이 하한 ' + requiredArc + ' 미만이다',
        {
          k, ring: r, arc, requiredArc, indices: picked.map((p) => p.index),
        },
      );
    }
    rings.push({
      ring: r,
      arc,
      requiredArc,
      cells: picked.map((p) => ({ q: p.cell.q, r: p.cell.r })),
      indices: picked.map((p) => p.index),
    });
  }
  return rings;
}

function freezeCells(cells) {
  return Object.freeze(cells.map((c) => Object.freeze({ q: c.q, r: c.r })));
}

/**
 * k 와 검출기 점유 셀에서 format 15 · reference 2(k−2) 를 유도한다.
 *
 * @param {number} k
 * @param {Iterable} occupied 점유 셀 (마커 · 앵커 · 불스아이 등)
 * @returns {{
 *   k:number,
 *   formatCells:{q:number,r:number}[],
 *   formatReplicas:{id:number, ring:number, start:number, cells:{q:number,r:number}[]}[],
 *   referenceCells:{q:number,r:number}[],
 *   referenceRings:{ring:number, arc:number, requiredArc:number, cells:{q:number,r:number}[]}[],
 *   metrics:{sFmtMin:number, sFmtMinRequired:number, arcMin:number, occupied:number}
 * }}
 */
export function placeReservedCellsHex(k, occupied) {
  const size = assertK(k);
  const normalized = normalizeOccupiedHex(size, occupied);
  const blocked = new Set(normalized.keys);

  const fmt = placeFormat(size, blocked);
  const refs = placeReferences(size, blocked);

  const formatCells = [];
  for (const replica of fmt.replicas) for (const c of replica.cells) formatCells.push(c);
  const referenceCells = [];
  for (const ring of refs) for (const c of ring.cells) referenceCells.push(c);

  if (formatCells.length !== FORMAT_REPLICAS * FORMAT_BLOCK_LENGTH) {
    throw new AutoplaceError(
      AUTOPLACE_HEX_COLLISION,
      'format 셀 수가 ' + (FORMAT_REPLICAS * FORMAT_BLOCK_LENGTH) + ' 가 아니다: ' + formatCells.length,
    );
  }
  if (referenceCells.length !== 2 * (size - FORMAT_RING + 1)) {
    throw new AutoplaceError(
      AUTOPLACE_HEX_COLLISION,
      'reference 셀 수가 ' + (2 * (size - FORMAT_RING + 1)) + ' 가 아니다: ' + referenceCells.length,
    );
  }

  const seen = new Set();
  for (const c of [...formatCells, ...referenceCells]) {
    const kk = key(c.q, c.r);
    if (seen.has(kk)) throw new AutoplaceError(AUTOPLACE_HEX_COLLISION, '배치 내부 중복: ' + kk);
    if (normalized.keys.has(kk)) {
      throw new AutoplaceError(AUTOPLACE_HEX_COLLISION, '배치가 검출기 점유와 겹친다: ' + kk);
    }
    seen.add(kk);
  }

  let arcMin = Infinity;
  for (const ring of refs) if (ring.arc < arcMin) arcMin = ring.arc;

  return Object.freeze({
    k: size,
    formatCells: freezeCells(formatCells),
    formatReplicas: Object.freeze(fmt.replicas.map((x) => Object.freeze({
      id: x.id, ring: x.ring, start: x.start, cells: freezeCells(x.cells),
    }))),
    referenceCells: freezeCells(referenceCells),
    referenceRings: Object.freeze(refs.map((x) => Object.freeze({
      ring: x.ring, arc: x.arc, requiredArc: x.requiredArc, cells: freezeCells(x.cells),
    }))),
    metrics: Object.freeze({
      sFmtMin: fmt.minSep,
      sFmtMinRequired: fmt.required,
      arcMin,
      occupied: normalized.cells.length,
    }),
  });
}

/** 결정성 대조용 — 같은 배치는 같은 문자열 (`autoplaceY.placementKey` 와 동형). */
export function placementKeyHex(placement) {
  const fmt = placement.formatCells.map((c) => key(c.q, c.r)).join(';');
  const ref = placement.referenceCells.map((c) => key(c.q, c.r)).join(';');
  return placement.k + '|F:' + fmt + '|R:' + ref;
}

/**
 * 레거시 등가 점유 — 불스아이 풋프린트 + 앵커 3셀. 이 입력으로 부른
 * `placeReservedCellsHex` 는 `placement.js` 산출과 좌표까지 같아야 한다.
 * @param {number} k
 */
export function legacyOccupiedHex(k) {
  assertK(k);
  const out = [];
  for (let q = -2; q <= 2; q += 1) {
    for (let r = -2; r <= 2; r += 1) {
      if (hexDistance(q, r) <= 2) out.push({ q, r });
    }
  }
  for (const kk of anchorPositionSet(k)) {
    const [q, r] = kk.split(',').map(Number);
    out.push({ q, r });
  }
  return out;
}

// 모듈 로드 시점 자기검증 — «레거시 무영향» 계약이 실제로 참인지 import 시점부터
// 확인한다 (capacityY.js 의 Y2W 자기검증과 동형). 조용히 어긋난 채로 쓰이는 것을 막는다.
{
  for (const k of [6, 8, 10]) {
    const placed = placeReservedCellsHex(k, legacyOccupiedHex(k));
    const legacyFmt = legacyFormatCells(k).map((c) => key(c.q, c.r)).join(';');
    const gotFmt = placed.formatCells.map((c) => key(c.q, c.r)).join(';');
    if (legacyFmt !== gotFmt) {
      throw new Error('autoplaceHex k=' + k + ': 레거시 format 좌표와 어긋난다\n  legacy=' + legacyFmt + '\n  got   =' + gotFmt);
    }
    const legacyRef = legacyReferenceCellsAll(k).map((c) => key(c.q, c.r)).join(';');
    const gotRef = placed.referenceCells.map((c) => key(c.q, c.r)).join(';');
    if (legacyRef !== gotRef) {
      throw new Error('autoplaceHex k=' + k + ': 레거시 reference 좌표와 어긋난다\n  legacy=' + legacyRef + '\n  got   =' + gotRef);
    }
  }
}
