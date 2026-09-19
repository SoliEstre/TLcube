/**
 * Type X 격자 분할 — 사이트(x,y,z) 를 중심/데이터 트리플/잔여 역할로 나눠요.
 *
 * 두 layoutId 를 내요(RT rt-2750180b3f4d rd-1):
 *   - `lee-fo-v1`  규칙형. 중심 = x+2y+3z ≡ c (mod 7)(Golomb–Welch PL(3,1,7) Lee 십자 타일링),
 *                  경계 셀은 팔 수(6/5/4/3)로 분류하고 5팔 셀은 «면 정사각»(잉여 팔 2 + 같은 면 소유의
 *                  대각 고아) 트리플을 더해요. 고아의 소유 면을 일치시키므로 중심 순회 순서와 무관해요.
 *   - `x8-gpt-v1`  표형(N=8 전용). 내부 I7 30 + K4 56 + T4 18 + 슬롯 6 — golden 회귀 대조군.
 *
 * 이 모듈은 raw layout(예약 전) 만 내요. 파인더·포맷 예약 뒤의 profile layout 은 x-profile 이 맡아요.
 * 트리플 내 점 순서는 digit 의미의 일부라 여기서 고정해요: 변위 벡터의 (첫 비영 축, 부호 + 우선, 비영 성분 수) 순.
 */
import { X8_GPT_V1_N, X8_GPT_V1_MODULES, X8_GPT_V1_SLOTS } from './x-layout-x8-gpt-v1.js';

export const X_LAYOUT_SCHEMA = 'TLcube:X:raw-layout:v1';
export const X_LAYOUT_IDS = Object.freeze(['lee-fo-v1', 'x8-gpt-v1']);
export const LEE_COEF = Object.freeze([1, 2, 3]);
export const LEE_MOD = 7;
export const X_ARMS = Object.freeze([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);

const mod7 = v => ((v % LEE_MOD) + LEE_MOD) % LEE_MOD;

export function xSiteId(N, p) {
  return (p[0] * N + p[1]) * N + p[2];
}

export function xSiteCoord(N, id) {
  return [Math.floor(id / (N * N)), Math.floor(id / N) % N, id % N];
}

/** 중심 합동식의 잔여류(0 이면 중심) */
export function leeResidue(p, c = 0) {
  return mod7(p[0] * LEE_COEF[0] + p[1] * LEE_COEF[1] + p[2] * LEE_COEF[2] - c);
}

function assertGrid(N, c) {
  if (!Number.isInteger(N) || N < 4 || N > 24) throw new RangeError(`N 은 4…24 정수여야 해요: ${N}`);
  if (!Number.isInteger(c) || c < 0 || c >= LEE_MOD) throw new RangeError(`c 는 0…6 정수여야 해요: ${c}`);
}

/** 트리플 내 점 순서 키 — 변위 v 의 (첫 비영 축, 부호(+ 먼저), 비영 성분 수) */
function displacementKey(v) {
  const axis = v.findIndex(x => x !== 0);
  const nonzero = v.filter(x => x !== 0).length;
  return [axis, v[axis] > 0 ? 0 : 1, nonzero];
}

function orderTriple(N, centre, ids) {
  const withKey = ids.map(id => {
    const p = xSiteCoord(N, id);
    return { id, key: displacementKey([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]) };
  });
  withKey.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.id - b.id);
  return withKey.map(x => x.id);
}

/**
 * lee-fo-v1 — 규칙형 분할.
 * @returns {{schemaVersion, layoutId, N, c, cells, residual, roleCounts, digits, kinds, fallbacks}}
 */
export function layoutLeeFo(N, c = 0) {
  assertGrid(N, c);
  const total = N * N * N;
  const inside = p => p.every(x => x >= 0 && x < N);
  const centreOf = new Int32Array(total).fill(-1); // 팔 → 소유 중심 siteId(안), 고아 → -2
  const isCentre = new Uint8Array(total);
  const arms = new Map(); // centreId → [armId...]
  for (let id = 0; id < total; id += 1) {
    const p = xSiteCoord(N, id);
    if (leeResidue(p, c) === 0) { isCentre[id] = 1; arms.set(id, []); }
  }
  const orphans = new Set();
  for (let id = 0; id < total; id += 1) {
    if (isCentre[id]) continue;
    const p = xSiteCoord(N, id);
    let owner = null;
    for (const a of X_ARMS) {
      const q = [p[0] + a[0], p[1] + a[1], p[2] + a[2]];
      if (leeResidue(q, c) === 0) { owner = q; break; }
    }
    // 잔여류가 서로 다르므로 소유 중심은 정확히 하나예요.
    if (inside(owner)) { const qid = xSiteId(N, owner); centreOf[id] = qid; arms.get(qid).push(id); }
    else { centreOf[id] = -2; orphans.add(id); }
  }

  const cells = [];
  const spare = new Set();
  const kinds = { '6arm': 0, '5arm': 0, '4arm': 0, '3arm': 0, lt3: 0, square: 0 };
  let fallbacks = 0;
  const centres = [...arms.keys()].sort((a, b) => a - b);
  for (const qid of centres) {
    const q = xSiteCoord(N, qid);
    const armIds = arms.get(qid);
    const vs = armIds.map(id => { const p = xSiteCoord(N, id); return [p[0] - q[0], p[1] - q[1], p[2] - q[2]]; });
    const has = v => vs.some(w => w[0] === v[0] && w[1] === v[1] && w[2] === v[2]);
    const at = v => xSiteId(N, [q[0] + v[0], q[1] + v[1], q[2] + v[2]]);
    const cell = { centre: qid, kind: '', triples: [], tags: [] };
    if (vs.length === 6) {
      cell.kind = '6arm'; kinds['6arm'] += 1;
      cell.triples.push(orderTriple(N, q, [at([1, 0, 0]), at([0, 1, 0]), at([0, 0, 1])]));
      cell.triples.push(orderTriple(N, q, [at([-1, 0, 0]), at([0, -1, 0]), at([0, 0, -1])]));
    } else if (vs.length === 5) {
      cell.kind = '5arm'; kinds['5arm'] += 1;
      const single = vs.find(v => !has([-v[0], -v[1], -v[2]]));
      const dbl = [0, 1, 2].filter(i => single[i] === 0);
      // 결손 팔 방향(상자 밖)이 놓인 면 b 의 고아만 소유 면이 같아요: 그 고아의 소유 중심은 면 b 바깥에 있어
      // 잔여류가 (q[b]===0 ? +coef : −coef) 이에요.
      const b = single.findIndex(x => x !== 0);
      const desired = mod7((q[b] === 0 ? 1 : -1) * LEE_COEF[b]);
      let chosen = null;
      for (const sv of [1, -1]) {
        for (const sw of [1, -1]) {
          const av = [0, 0, 0]; av[dbl[0]] = sv;
          const aw = [0, 0, 0]; aw[dbl[1]] = sw;
          const diag = [q[0] - av[0] - aw[0], q[1] - av[1] - aw[1], q[2] - av[2] - aw[2]];
          if (!inside(diag)) continue;
          const diagId = xSiteId(N, diag);
          if (!orphans.has(diagId)) continue;
          if (leeResidue(diag, c) !== desired) continue;
          if (chosen) throw new Error(`5팔 셀 ${qid} 의 같은 면 고아 후보가 둘이에요`);
          chosen = { av, aw, diagId };
        }
      }
      if (chosen) {
        const { av, aw, diagId } = chosen;
        cell.triples.push(orderTriple(N, q, [at(single), at(av), at(aw)]));
        cell.triples.push(orderTriple(N, q, [at([-av[0], -av[1], -av[2]]), at([-aw[0], -aw[1], -aw[2]]), diagId]));
        cell.tags.push('square'); kinds.square += 1;
        orphans.delete(diagId);
      } else {
        // 같은 면 고아가 없을 때(현재 N 8…16 에서는 발생하지 않음)의 규칙: 단독 팔 + 각 축의 + 팔, 나머지는 잔여.
        fallbacks += 1;
        const av = [0, 0, 0]; av[dbl[0]] = 1;
        const aw = [0, 0, 0]; aw[dbl[1]] = 1;
        cell.triples.push(orderTriple(N, q, [at(single), at(av), at(aw)]));
        spare.add(at([-av[0], -av[1], -av[2]])); spare.add(at([-aw[0], -aw[1], -aw[2]]));
        cell.tags.push('fallback');
      }
    } else if (vs.length === 4) {
      cell.kind = '4arm'; kinds['4arm'] += 1;
      const singles = vs.filter(v => !has([-v[0], -v[1], -v[2]]));
      const dblArms = vs.filter(v => has([-v[0], -v[1], -v[2]]));
      const pick = dblArms.reduce((a, v) => (v[0] + v[1] + v[2] > a[0] + a[1] + a[2] ? v : a));
      cell.triples.push(orderTriple(N, q, [at(singles[0]), at(singles[1]), at(pick)]));
      spare.add(at([-pick[0], -pick[1], -pick[2]]));
    } else if (vs.length === 3) {
      cell.kind = '3arm'; kinds['3arm'] += 1;
      cell.triples.push(orderTriple(N, q, vs.map(at)));
    } else {
      cell.kind = 'lt3'; kinds.lt3 += 1;
      for (const v of vs) spare.add(at(v));
    }
    cells.push(cell);
  }
  const residual = [...spare, ...orphans].sort((a, b) => a - b);
  const digits = cells.reduce((s, cell) => s + cell.triples.length, 0);
  return finish({ layoutId: 'lee-fo-v1', N, c, cells, residual, digits, kinds, fallbacks });
}

/** x8-gpt-v1 — 표형(N=8) 회귀 레이아웃 */
export function layoutX8Gpt() {
  const N = X8_GPT_V1_N;
  const cells = X8_GPT_V1_MODULES.map(([kind, centre, ...data]) => {
    const triples = [];
    for (let i = 0; i < data.length; i += 3) triples.push(data.slice(i, i + 3));
    return { centre, kind, triples, tags: [] };
  }).sort((a, b) => a.centre - b.centre);
  const kinds = { I7: 0, K4: 0, T4: 0 };
  for (const cell of cells) kinds[cell.kind] += 1;
  const residual = [...X8_GPT_V1_SLOTS].sort((a, b) => a - b);
  const digits = cells.reduce((s, cell) => s + cell.triples.length, 0);
  return finish({ layoutId: 'x8-gpt-v1', N, c: 0, cells, residual, digits, kinds, fallbacks: 0 });
}

function finish(layout) {
  const total = layout.N ** 3;
  const dataSites = layout.cells.reduce((s, cell) => s + cell.triples.length * 3, 0);
  layout.roleCounts = { centres: layout.cells.length, data: dataSites, residual: layout.residual.length, total };
  layout.schemaVersion = X_LAYOUT_SCHEMA;
  return layout;
}

/** layoutId 로 분기 */
export function layoutX({ layoutId, N, c = 0 } = {}) {
  if (layoutId === 'lee-fo-v1') return layoutLeeFo(N, c);
  if (layoutId === 'x8-gpt-v1') {
    if (N !== undefined && N !== X8_GPT_V1_N) throw new RangeError('x8-gpt-v1 은 N=8 전용이에요');
    if (c !== 0) throw new RangeError('x8-gpt-v1 은 c=0 고정이에요(표형 — 다른 잔여류를 조용히 무시하지 않아요)');
    return layoutX8Gpt();
  }
  throw new RangeError(`알 수 없는 layoutId: ${layoutId}`);
}

/** 정본 문자열 — golden hash 의 입력(JS↔Python 교차 일치) */
export function xLayoutCanonical(layout) {
  const cells = layout.cells.map(cell => [cell.centre, cell.kind, cell.triples]);
  return JSON.stringify({ schema: layout.schemaVersion, layoutId: layout.layoutId, N: layout.N, c: layout.c, cells, residual: layout.residual });
}

/** 순서 있는 트리플 전부(셀 순) — 코덱의 scan order 'cell-order-v0' 입력 */
export function xOrderedTriples(layout) {
  return layout.cells.flatMap(cell => cell.triples);
}

/**
 * 구조 검증 — 전 사이트 단일 소유, 트리플 점은 중심의 팔(L1=1) 또는 면 정사각 대각(L1=2, 두 축), 회계 일치.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateXLayout(layout) {
  const errors = [];
  const { N } = layout;
  const total = N ** 3;
  const owner = new Int32Array(total).fill(-1);
  const claim = (id, who) => {
    if (!Number.isInteger(id) || id < 0 || id >= total) { errors.push(`범위 밖 siteId ${id}`); return; }
    if (owner[id] !== -1) errors.push(`이중 소유 siteId ${id}: ${owner[id]} vs ${who}`);
    owner[id] = who;
  };
  for (const cell of layout.cells) {
    claim(cell.centre, cell.centre);
    const q = xSiteCoord(N, cell.centre);
    for (const triple of cell.triples) {
      if (triple.length !== 3 || new Set(triple).size !== 3) errors.push(`트리플 크기/중복 오류 @${cell.centre}`);
      for (const id of triple) {
        claim(id, cell.centre);
        const p = xSiteCoord(N, id);
        const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        const l1 = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]);
        const nonzero = d.filter(x => x !== 0).length;
        if (!(l1 === 1 || (l1 === 2 && nonzero === 2))) errors.push(`트리플 점 ${id} 이 중심 ${cell.centre} 의 팔/대각이 아니에요`);
      }
    }
  }
  for (const id of layout.residual) claim(id, -2);
  for (let id = 0; id < total; id += 1) if (owner[id] === -1) errors.push(`미배정 siteId ${id}`);
  const rc = layout.roleCounts;
  if (rc.centres + rc.data + rc.residual !== total) errors.push('회계 불일치');
  if (layout.digits !== rc.data / 3) errors.push('digit 회계 불일치');
  return { ok: errors.length === 0, errors };
}
