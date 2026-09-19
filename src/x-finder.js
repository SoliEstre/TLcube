/**
 * x-finder — Type X 파인더 «패턴» (인코더 쪽, rd-3 연구 옵션 · 잠금 아님)
 *
 * 계약 X.5(연구): 파인더 = 코너 8 상시 on + 코너 모티프(길이 m) + 모서리 워드(간격 s) — 모서리선 위 «구조 사이트».
 * 이 모듈은 «어느 사이트가 구조인가» 와 «그 사이트의 v0 레벨» 만 내요. 검출기(x-finder 검출 슬라이스, codex 소유)는 여기 없어요.
 *
 * 실제 계약은 stride 이름이 아니라 **구조 siteId 집합 + 탈락 whole-group 목록**(x-profile 이 예약을 적용하며 만들어요).
 * 워드 값(방향·면 ID)은 TBD — v0 는 결정적 «타이밍 교대» 자리표(wordRule 'timing-alt-v0')이고, 파인더-파인더 후보(JSON tlx-finder/1)
 * 가 확정되면 그 비트로 바꿔요(레벨만 바뀌고 사이트 집합·용량은 같아요).
 *
 * 규칙(N ≥ 2m+2):
 *   - 모서리 12 개 = 축 ax∈{x,y,z} × 나머지 두 좌표 (a,b)∈{0,N−1}². 모서리 위 위치 i = 0…N−1(축 좌표 오름차순).
 *   - 코너(i=0, N−1): 구조, 레벨 1.
 *   - 모티프(코너에서 거리 d=1…m): 구조, 레벨 = d 가 홀수면 0, 짝수면 1(코너 옆은 꺼 «외로운 밝은 점» 대비).
 *   - 워드(나머지 내부 위치 j = i−(m+1) 가 0 ≤ j ≤ N−2−2m 이고 j ≡ phase (mod s)): 구조, 레벨 = (⌊j/s⌋ 짝수 ? 1 : 0).
 *   - 그 외 모서리 사이트: 데이터/잔여 그대로(예약 안 함).
 *   코너는 세 모서리에 공유돼요 — 집합은 중복 제거.
 */

export const X_FINDER_SCHEMA = 'TLcube:X:finder:v0';
export const X_FINDER_WORD_RULE = 'timing-alt-v0';

export const X_FINDER_PATTERNS = Object.freeze({
  'edge-all-v0': Object.freeze({ m: 2, s: 1, phase: 0, symmetric: false, note: '모서리선 전부 구조(코너 + 모티프 2 + 타이밍 워드)' }),
  'edge-m1s2-v0': Object.freeze({ m: 1, s: 2, phase: 0, symmetric: false, note: '희소 — 모티프 1, 워드 간격 2(낮은 코너 쪽 한 방향 stride)' }),
  'edge-m1s3-v0': Object.freeze({ m: 1, s: 3, phase: 0, symmetric: false, note: '희소 — 모티프 1, 워드 간격 3, 한 방향 stride(N8 lee-fo 140→114 · N10 271→244)' }),
  // symmetric: 워드 위치 = 낮은 코너 쪽 stride ∪ 높은 코너 쪽 stride(양끝 union) — 옛 buildGeom 정의(codex 0308): N8 → 114 · N10 → 234(종합 «희소 234» 재현)
  'edge-m1s3sym-v0': Object.freeze({ m: 1, s: 3, phase: 0, symmetric: true, note: '희소 — 모티프 1, 워드 간격 3, 양끝 stride union(N8 140→114 · N10 271→234)' }),
});
export const X_FINDER_IDS = Object.freeze(Object.keys(X_FINDER_PATTERNS));

const describeId = id => (typeof id === 'string' ? JSON.stringify(id) : `<${typeof id}>`);

/** 파인더 패턴 조회 — 문자열 + 자기 키만(프로토타입 체인·비문자열 거절) */
export function xFinderPattern(finderId) {
  if (typeof finderId !== 'string' || !Object.hasOwn(X_FINDER_PATTERNS, finderId)) throw new RangeError(`알 수 없는 finderId: ${describeId(finderId)}`);
  return X_FINDER_PATTERNS[finderId];
}

/** siteId = (x·N + y)·N + z (계약 X.2) */
export function xSiteIdOf(N, x, y, z) { return (x * N + y) * N + z; }

/**
 * 모서리 12 개 — 정본 순서: 축 0,1,2 → a∈{0,N−1} → b∈{0,N−1}. 각 모서리는 축 좌표 오름차순 N 개 siteId.
 * @returns {{axis:number, fixed:number[], sites:number[]}[]}
 */
export function xEdges(N) {
  if (!Number.isInteger(N) || N < 2) throw new RangeError('N 은 2 이상 정수');
  const edges = [];
  for (const axis of [0, 1, 2]) {
    const others = [0, 1, 2].filter(k => k !== axis);
    for (const a of [0, N - 1]) for (const b of [0, N - 1]) {
      const sites = [];
      for (let i = 0; i < N; i += 1) {
        const c = [0, 0, 0];
        c[axis] = i; c[others[0]] = a; c[others[1]] = b;
        sites.push(xSiteIdOf(N, c[0], c[1], c[2]));
      }
      edges.push({ axis, fixed: [a, b], sites });
    }
  }
  return edges;
}

/**
 * 파인더 구조 사이트와 v0 레벨.
 * @returns {{schema, finderId, N, m, s, phase, wordRule, corners:number[], motif:number[], word:number[], structureSites:number[], levels:Map<number,0|1>, edges:object[]}}
 */
export function xFinderSpec(N, finderId) {
  const pat = xFinderPattern(finderId);
  const { m, s, phase, symmetric } = pat;
  if (!Number.isInteger(N) || N < 2 * m + 2) throw new RangeError(`N ${N} 은 2m+2 = ${2 * m + 2} 이상이어야 해요(finderId ${finderId})`);
  const corners = new Set(), motif = new Set(), word = new Set();
  const levels = new Map();
  const setLevel = (site, lv, role) => {
    if (levels.has(site) && levels.get(site) !== lv) throw new Error(`finder 레벨 충돌 site ${site}(${role})`);
    levels.set(site, lv);
  };
  const edges = xEdges(N).map(e => {
    const positions = e.sites.map((siteId, i) => {
      const d = Math.min(i, N - 1 - i);
      if (d === 0) { corners.add(siteId); setLevel(siteId, 1, 'corner'); return { i, siteId, role: 'corner', bit: 1 }; }
      if (d <= m) { const bit = d % 2 === 1 ? 0 : 1; motif.add(siteId); setLevel(siteId, bit, 'motif'); return { i, siteId, role: 'motif', bit }; }
      const j = i - (m + 1), jHi = (N - 1 - i) - (m + 1);
      const lowHit = j >= 0 && j <= N - 2 - 2 * m && j % s === phase;
      const highHit = symmetric && jHi >= 0 && jHi <= N - 2 - 2 * m && jHi % s === phase;
      if (lowHit || highHit) {
        // 비트: 낮은 코너 쪽 stride 에 걸리면 j 로, 아니면(대칭 union 의 높은 쪽만) jHi 로 — 결정적
        const jj = lowHit ? j : jHi;
        const bit = Math.floor(jj / s) % 2 === 0 ? 1 : 0;
        word.add(siteId); setLevel(siteId, bit, 'word'); return { i, siteId, role: 'word', bit };
      }
      return { i, siteId, role: 'data', bit: null };
    });
    return { axis: e.axis, fixed: e.fixed, positions };
  });
  const structureSites = [...new Set([...corners, ...motif, ...word])].sort((a, b) => a - b);
  return {
    schema: X_FINDER_SCHEMA, finderId, N, m, s, phase, symmetric: Boolean(symmetric), wordRule: X_FINDER_WORD_RULE,
    corners: [...corners].sort((a, b) => a - b), motif: [...motif].sort((a, b) => a - b), word: [...word].sort((a, b) => a - b),
    structureSites, levels, edges,
  };
}

/** 정본 문자열(구조 지문용) — 사이트 집합과 레벨만(설명 문구 제외) */
export function xFinderCanonical(spec) {
  return JSON.stringify({ schema: spec.schema, finderId: spec.finderId, N: spec.N, m: spec.m, s: spec.s, phase: spec.phase, symmetric: spec.symmetric, wordRule: spec.wordRule, effective: Boolean(spec.effective), sites: spec.structureSites.map(id => [id, spec.levels.get(id)]) });
}

/**
 * 실효 spec(codex 0308): 구조 사이트가 Lee 중심과 겹치면 인코더는 중심 규칙(상시 on = tones−1)을 따르므로 nominal 비트는 실효 진리가 아니에요.
 * 중심 집합을 받아 levels 를 실효값으로 덮고, 덮어쓴 자리를 overrides 로 기록해요(edges positions 에 effectiveBit 추가). 사이트 집합·역할은 불변.
 */
export function xFinderEffective(spec, centres, onLevel = 1) {
  const levels = new Map(spec.levels);
  const overrides = [];
  const roleOf = new Map([...spec.corners.map(id => [id, 'corner']), ...spec.motif.map(id => [id, 'motif']), ...spec.word.map(id => [id, 'word'])]);
  for (const id of spec.structureSites) if (centres.has(id)) { const nominal = levels.get(id); levels.set(id, onLevel); if (nominal !== onLevel) overrides.push({ siteId: id, role: roleOf.get(id), nominal, effective: onLevel, reason: 'centre-always-on' }); }
  const edges = spec.edges.map(e => ({ ...e, positions: e.positions.map(p => ({ ...p, effectiveBit: p.role === 'data' ? null : levels.get(p.siteId) })) }));
  return { ...spec, levels, edges, overrides, effective: true };
}
