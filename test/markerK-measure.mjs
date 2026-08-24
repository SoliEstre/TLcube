/**
 * markerK-measure.mjs — K-CM «앵커 위 마커»((다)안) 성립 여부 실측 (레인 C §3-1, 구현 전).
 *
 * 이 스크립트가 markerK.js 의 **근거**다. 재는 것 셋:
 *   ① 마커 방향 margin — `orientation-scorer` 정본 사상(좌표 회전 ∘ 면 순환) 기준.
 *      게이트 = UNVERIFIED_ORIENTATION_SCORER.minimumOrientationMargin (0.035, 완화 없음).
 *   ② 60° 오가설 사멸 — 별 꼭짓점 앵커 6셀만으로. K-2 의 근거가 톤 재배정 후에도 서는가.
 *   ③ 마커 유/무 구분 — K-CM 기대 vs **평 K 프레임**(encodeK 실산출)의 face agreement.
 *      게이트 = corner-marker-detect.DEFAULT_MARKER_AGREEMENT (0.78, 완화 없음).
 *
 * 그리고 ①이 전 조합 동률이므로 반전 삼각 digit 을 (a) 오가설 최고 agreement
 * (b) 평 K 최고 agreement 두 축으로 고른다 — 취향이 아니라 실측이 고른다.
 *
 * 말미에 **(가) vs (다) 대조**가 붙는다: 두 안은 용량(−27)도 판별력(합집합 agreement)도
 * 같다. 이 절이 없으면 «(다)가 낫다» 가 근거 없이 굴러다닌다 — 실제로 이 레인의
 * 보고서 초안이 «(다)가 3셀을 덜 뺏는다» 고 잘못 적었고 이 측정이 잡았다.
 *
 * ⚠ 이 스크립트는 markerK.js 를 **import 하지 않는다**. 발자국·digit 을 정본 함수에서
 *   독립 유도해 markerK 의 주장과 대조할 수 있게 남긴다 (사본이 아니라 재유도).
 *   markerK 와의 일치는 test/markerK.test.js 가 잠근다.
 *
 * 실행: node test/markerK-measure.mjs
 */

import { neighbors } from '../src/hexgrid.js';
import { rotate120, rotate240 } from '../src/placement.js';
import { markerCellsA, MARKER_CELL_COUNT_A } from '../src/markerA.js';
import {
  vertexAnchorsK, invertedVertexAnchors, isInRegionK, patchOfK, buildRoleSetsK, roleOfK,
} from '../src/placementK.js';
import { digitToRanks } from '../src/lehmer.js';
import {
  hexLayoutFrom, hexRotationHypotheses, scoreLayoutOrientation, idealAgreement,
  hexAuxCoordMaps, hexHypothesis, FACE_IDENTITY, FACE_CYCLE_CW, FACE_CYCLE_CW2,
  UNVERIFIED_ORIENTATION_SCORER,
} from '../src/decoder/orientation-scorer.js';
import { encodeK } from '../src/encodeK.js';
import { dataCellsInScanOrderK } from '../src/layoutK.js';
import { VERSIONS_K } from '../src/capacityK.js';
import { hexDistance } from '../src/hexgrid.js';

const KS = [6, 8, 10];
const MARKER_AGREEMENT_FLOOR = 0.78; // corner-marker-detect.DEFAULT_MARKER_AGREEMENT
const key = (q, r) => `${q},${r}`;
const out = (...a) => console.log(...a);

// ─── 발자국 유도 (손 좌표 0) ────────────────────────────────────────────────

/** 반전 꼭짓점 하나의 삼각 3셀 = {V} ∪ (neighbors(V) ∩ 영역 K). */
function vertexTriangle(anchor, k) {
  const inward = neighbors(anchor.q, anchor.r).filter((c) => isInRegionK(c.q, c.r, k));
  return [{ q: anchor.q, r: anchor.r, label: 'W' },
    ...inward.map((c, i) => ({ q: c.q, r: c.r, label: 'N' + i }))];
}

/** 반전 계열 9셀 — 기준 삼각 + ρ120/ρ240 상 (라벨 보존). */
function invertedTriangles(k) {
  const base = vertexTriangle(invertedVertexAnchors(k)[0], k);
  return [base,
    base.map((c) => ({ ...rotate120(c.q, c.r), label: c.label })),
    base.map((c) => ({ ...rotate240(c.q, c.r), label: c.label }))];
}

/** (다)안 발자국 30셀 — A 계열 21(markerA 정본) + 반전 삼각 9(꼭짓점 포함). */
function markerCellsKcm(k, d) {
  return [
    ...markerCellsA(k).map((c) => ({ ...c, series: 'A' })),
    ...invertedTriangles(k).flat().map((c, i) => ({
      q: c.q, r: c.r, label: c.label, series: 'INV', corner: Math.floor(i / 3), digit: d[c.label],
    })),
  ];
}

/** (가)안 발자국 27셀 — 반전 삼각에서 꼭짓점 제외. */
function markerCellsPlanGa(k, d) {
  return markerCellsKcm(k, d).filter((c) => !(c.series === 'INV' && c.label === 'W'));
}

// ─── 0. 발자국이 정본 H2CO3 와 집합 동일한가 ────────────────────────────────

/** 정본 H2CO3 (k=4) `userNonData` 30셀 — `.agent/decoder/data/finder-oak-candidates.json`. */
const H2CO3_K4 = [[-7, 3], [-7, 4], [-6, 2], [-6, 3], [-6, 4], [-5, 2], [-5, 3], [-4, -4], [-4, -3],
  [-4, 7], [-4, 8], [-3, -4], [-3, 7], [2, -6], [2, -5], [2, 3], [2, 4], [3, -7], [3, -6], [3, -5],
  [3, 2], [3, 3], [3, 4], [4, -7], [4, -6], [4, 2], [4, 3], [7, -4], [7, -3], [8, -4]];

out('══ 0. 발자국 유도 대조 (정본 H2CO3 k=4) ══');
{
  const derived = new Set(markerCellsKcm(4, { W: 1, N0: 1, N1: 2 }).map((c) => key(c.q, c.r)));
  const canon = new Set(H2CO3_K4.map(([q, r]) => key(q, r)));
  const missing = [...canon].filter((kk) => !derived.has(kk));
  const extra = [...derived].filter((kk) => !canon.has(kk));
  out(`  유도 ${derived.size}셀 · 정본 ${canon.size}셀 · 누락 ${missing.length} · 초과 ${extra.length}`
    + ` → ${missing.length === 0 && extra.length === 0 ? '집합 동일 ✓' : '불일치 ✗'}`);
}
for (const k of KS) {
  const cells = markerCellsKcm(k, { W: 1, N0: 1, N1: 2 });
  const set = new Set(cells.map((c) => key(c.q, c.r)));
  const rhoOk = [...set].every((kk) => {
    const [q, r] = kk.split(',').map(Number);
    const a = rotate120(q, r); const b = rotate240(q, r);
    return set.has(key(a.q, a.r)) && set.has(key(b.q, b.r));
  });
  out(`  k=${k}: ${cells.length}셀 (A ${MARKER_CELL_COUNT_A} + 반전 ${cells.length - MARKER_CELL_COUNT_A})`
    + ` · ρ-불변 ${rhoOk} · 영역내 ${cells.every((c) => isInRegionK(c.q, c.r, k))}`
    + ` · 패치 ${[...new Set(cells.map((c) => patchOfK(c.q, c.r, k)))].sort().join(',')}`);
}

// ─── ① 방향 margin ─────────────────────────────────────────────────────────

function marginOf(cells) {
  const layout = hexLayoutFrom(cells.map((c) => ({ q: c.q, r: c.r, tones: digitToRanks(c.digit) })));
  const s = scoreLayoutOrientation(layout, hexRotationHypotheses());
  return {
    margin: s.orientationMargin,
    slots: s.claimed.total,
    phases: s.phases.map((p) => `${p.id}=${p.agreement.toFixed(4)}`).join(' '),
  };
}

out('');
out('══ ① 방향 margin — 반전 삼각 digit 전수 (꼭짓점 W=1 고정) ══');
out(`  게이트: margin ≥ ${UNVERIFIED_ORIENTATION_SCORER.minimumOrientationMargin}`);
const margins = [];
for (let n0 = 0; n0 < 6; n0 += 1) {
  for (let n1 = 0; n1 < 6; n1 += 1) {
    const digits = { W: 1, N0: n0, N1: n1 };
    margins.push({ digits, per: KS.map((k) => marginOf(markerCellsKcm(k, digits))) });
  }
}
const worstMargin = Math.min(...margins.flatMap((m) => m.per.map((p) => p.margin)));
const bestMargin = Math.max(...margins.flatMap((m) => m.per.map((p) => p.margin)));
out(`  36조합 × k 3종 = ${margins.length * KS.length} 측정 — margin 최소 ${worstMargin.toFixed(4)} · 최대 ${bestMargin.toFixed(4)}`);
out(`  (전 조합 동률: ρ 사상은 삼각을 다른 삼각으로 보내고 σ 는 고정점 없는 3-순환이라`);
out('   어떤 digit 을 넣어도 세 면이 전부 어긋난다 — markerO 로드 자기검증의 사실)');
out(`  게이트 ①: ${worstMargin >= UNVERIFIED_ORIENTATION_SCORER.minimumOrientationMargin ? '통과' : '실패'}`);
for (const k of KS) {
  const i = KS.indexOf(k);
  out(`    k=${k}: (다)안 30셀 ${margins[0].per[i].margin.toFixed(4)} (${margins[0].per[i].phases}, slots ${margins[0].per[i].slots})`
    + ` · (가)안 27셀 ${marginOf(markerCellsPlanGa(k, { W: 1, N0: 1, N1: 2 })).margin.toFixed(4)}`
    + ` · A-CM 단독 21셀 ${marginOf(markerCellsA(k)).margin.toFixed(4)}`);
}

// ─── ② 60° 오가설 사멸 (앵커 판정만으로) ────────────────────────────────────

const AUX = hexAuxCoordMaps();
const FACEMAPS = { id: FACE_IDENTITY, cw: FACE_CYCLE_CW, cw2: FACE_CYCLE_CW2 };

function auxProfile(cells) {
  const layout = hexLayoutFrom(cells.map((c) => ({ q: c.q, r: c.r, tones: digitToRanks(c.digit) })));
  const byMap = {};
  let best = { id: null, agreement: -1 };
  for (const [mapName, coordMap] of Object.entries(AUX)) {
    let m = -1;
    for (const [fmName, faceMap] of Object.entries(FACEMAPS)) {
      const a = idealAgreement(layout, hexHypothesis(`${mapName}/${fmName}`, coordMap, faceMap));
      if (a.agreement > m) m = a.agreement;
      if (a.agreement > best.agreement) best = { id: `${mapName}/${fmName}`, agreement: a.agreement };
    }
    byMap[mapName] = m;
  }
  return { byMap, best };
}

out('');
out('══ ② 60° 오가설 사멸 — 별 꼭짓점 앵커 6셀만 ══');
for (const k of KS) {
  const p = auxProfile(vertexAnchorsK(k));
  out(`  k=${k}: rot60 ${p.byMap.rot60.toFixed(4)} · rot180 ${p.byMap.rot180.toFixed(4)}`
    + ` · rot300 ${p.byMap.rot300.toFixed(4)} · mirror ${p.byMap.mirror.toFixed(4)}`
    + `  (최고 ${p.best.id}=${p.best.agreement.toFixed(4)})`);
}
out('  ⚠ 실측: 앵커 6셀은 **거울 사상에 불변**이다 (mirror/면항등 = 1.0000) — K-2 는 60° 만');
out('     죽인다. 거울은 마커가 죽인다 (아래 (a) 축).');
out('  (다)안 톤 재배정이 앵커 digit 을 건드리는가 —');
for (const k of KS) {
  const anchorDigit = new Map(vertexAnchorsK(k).map((c) => [key(c.q, c.r), c.digit]));
  const marker = new Map(markerCellsKcm(k, { W: 1, N0: 1, N1: 2 }).map((c) => [key(c.q, c.r), c.digit]));
  const shared = [...anchorDigit.keys()].filter((kk) => marker.has(kk));
  const conflict = shared.filter((kk) => marker.get(kk) !== anchorDigit.get(kk));
  out(`    k=${k}: 앵커∩마커 ${shared.length}셀 · digit 충돌 ${conflict.length}`
    + `${conflict.length ? ' ✗ ' + conflict.join(' ') : ' ✓ → K-2 근거 유지'}`);
}

// ─── ③ 마커 유/무 구분 + 회계 ──────────────────────────────────────────────

const PAYLOADS = ['', 'A', 'TLcube', 'https://tlcube.example/k-cm-probe', '0123456789'.repeat(3),
  '한글 페이로드 시험', 'x'.repeat(40), 'The quick brown fox jumps over the lazy dog'];

function plainKFrames() {
  const frames = [];
  for (const spec of VERSIONS_K) {
    for (const level of ['L', 'M', 'H']) {
      for (const text of PAYLOADS) {
        try {
          frames.push({ spec, level, text, enc: encodeK(text, { version: spec.version, eccLevel: level }) });
        } catch { /* 용량 초과 — 건너뛴다 */ }
      }
    }
  }
  return frames;
}
const FRAMES = plainKFrames();

function agreementAgainst(frame, digits) {
  let m = 0; let t = 0;
  for (const c of markerCellsKcm(frame.spec.k, digits)) {
    const cell = frame.enc.cellDigits.get(key(c.q, c.r));
    if (!cell) continue;
    const got = digitToRanks(cell.digit); const want = digitToRanks(c.digit);
    for (const face of ['T', 'L', 'R']) { t += 1; if (got[face] === want[face]) m += 1; }
  }
  return t ? m / t : 0;
}

out('');
out('══ ③ 마커 유/무 구분 — 평 K 프레임 실측 ══');
out(`  게이트: 평 K 최고 agreement < ${MARKER_AGREEMENT_FLOOR} (완화 없음)`);
let gate3 = true;
for (const spec of VERSIONS_K) {
  const rows = FRAMES.filter((f) => f.spec.version === spec.version)
    .map((f) => ({ f, a: agreementAgainst(f, { W: 1, N0: 1, N1: 2 }) }))
    .sort((x, y) => y.a - x.a);
  const mean = rows.reduce((s, r) => s + r.a, 0) / rows.length;
  const roles = {};
  const roleSets = buildRoleSetsK(spec.k);
  for (const c of markerCellsKcm(spec.k, { W: 1, N0: 1, N1: 2 })) {
    const role = hexDistance(c.q, c.r) <= 2 ? 'bullseye' : roleOfK(c.q, c.r, spec.k, roleSets);
    roles[role] = (roles[role] || 0) + 1;
  }
  if (rows[0].a >= MARKER_AGREEMENT_FLOOR) gate3 = false;
  out(`  ${spec.name}(k=${spec.k}): ${rows.length}프레임 — 최고 ${rows[0].a.toFixed(4)}`
    + ` · 평균 ${mean.toFixed(4)} · 최저 ${rows[rows.length - 1].a.toFixed(4)} · K-CM 프레임 1.0000`);
  out(`     30자리의 평 K 역할: ${Object.entries(roles).map(([r, n]) => `${r}=${n}`).join(' ')}`
    + ` → 오버헤드 가산 = 30 − anchor ${roles.anchor} = ${30 - roles.anchor}`);
}
out(`  게이트 ③: ${gate3 ? '통과' : '실패'}`);

// ─── 반전 삼각 digit 선택 — 오가설·평 K 두 축 ───────────────────────────────

out('');
out('══ 반전 삼각 digit 선택 (①이 동률이라 두 축으로 가른다) ══');
const picks = [];
for (let n0 = 0; n0 < 6; n0 += 1) {
  for (let n1 = 0; n1 < 6; n1 += 1) {
    const digits = { W: 1, N0: n0, N1: n1 };
    const aux = Math.max(...KS.map((k) => auxProfile(markerCellsKcm(k, digits)).best.agreement));
    const mirror = Math.max(...KS.map((k) => auxProfile(markerCellsKcm(k, digits)).byMap.mirror));
    const plain = Math.max(...FRAMES.map((f) => agreementAgainst(f, digits)));
    picks.push({ digits, aux, mirror, plain });
  }
}
picks.sort((a, b) => (a.aux - b.aux) || (a.plain - b.plain)
  || a.digits.N0 - b.digits.N0 || a.digits.N1 - b.digits.N1);
out('  N0 N1 | 오가설최고 | 거울   | 평K최고   (상위 6 · 하위 3)');
for (const r of [...picks.slice(0, 6), ...picks.slice(-3)]) {
  out(`   ${r.digits.N0}  ${r.digits.N1} |   ${r.aux.toFixed(4)}  | ${r.mirror.toFixed(4)} | ${r.plain.toFixed(4)}`);
}
const chosen = picks[0];
out(`  → 채택 ${JSON.stringify(chosen.digits)} — 두 축 동시 최소.`);
out('     셋 다 markerA 어휘 {ringEven:4, ringOdd:1, center:2} 안이다'
  + ' (W=1=ringOdd · N0=1=ringOdd · N1=2=center) — 새 digit 어휘 0개.');
out(`     거울 오가설: 앵커 단독 1.0000 → 마커 포함 ${chosen.mirror.toFixed(4)} (마커가 메운다).`);

// ─── (가) vs (다) — «무엇이 실제로 다른가» ─────────────────────────────────
//
// 이 절이 없으면 «(다)가 (가)보다 낫다» 가 근거 없이 굴러다닌다. 실제로 이 레인의
// 보고서 초안이 «(다)가 데이터 3셀을 덜 뺏는다» 고 잘못 적었고, 이 측정이 잡았다.

out('');
out('══ (가) vs (다) — 용량·판별력은 같다 ══');
for (const k of KS) {
  const da = markerCellsKcm(k, { W: 1, N0: 1, N1: 2 });
  const vertexKeys = new Set(vertexAnchorsK(k).map((c) => key(c.q, c.r)));
  const ga = markerCellsPlanGa(k, { W: 1, N0: 1, N1: 2 });
  const onAnchor = da.filter((c) => vertexKeys.has(key(c.q, c.r))).length;
  out(`  k=${k}: (다) 마커 ${da.length} 중 앵커 ${onAnchor} → 데이터 가산 ${da.length - onAnchor}`
    + ` · (가) 마커 ${ga.length} 중 앵커 0 → 데이터 가산 ${ga.length}`
    + `  ⇒ ${da.length - onAnchor === ga.length ? '동일' : '다름 ✗'}`);
  // 검출기가 실제로 보는 집합(마커 ∪ 별 꼭짓점 6)에서는 두 안이 같은 집합이다.
  const daKeys = new Set(da.map((c) => key(c.q, c.r)));
  const unionDa = [...da, ...vertexAnchorsK(k).filter((c) => !daKeys.has(key(c.q, c.r)))];
  const unionGa = [...ga, ...vertexAnchorsK(k)];
  if (unionDa.length !== unionGa.length) {
    throw new Error(`k=${k}: 합집합 크기가 다르다 ${unionDa.length} !== ${unionGa.length}`);
  }
  const pDa = auxProfile(unionDa);
  const pGa = auxProfile(unionGa);
  out(`     합집합 오가설 — (다) rot60 ${pDa.byMap.rot60.toFixed(4)} mirror ${pDa.byMap.mirror.toFixed(4)}`
    + ` · (가) rot60 ${pGa.byMap.rot60.toFixed(4)} mirror ${pGa.byMap.mirror.toFixed(4)}`
    + `  ⇒ ${pDa.byMap.rot60 === pGa.byMap.rot60 && pDa.byMap.mirror === pGa.byMap.mirror ? '동일' : '다름'}`);
}
out('  → (다)를 고르는 근거는 용량도 판별력도 아니다: ① 발자국이 정본 H2CO3 그대로 ');
out('     ② 반전 코너 묶음이 2점이 아니라 3점 (코너 국소 재적합에 프레임이 선다,');
out('     그 3번째 점은 어차피 검증되는 앵커라 공짜) ③ K-8.1 을 회피가 아니라 해소.');
out('  ⚠ 평 K scan 길이 대조 (회계 −27 의 셀 단위 확인):');
for (const k of KS) {
  out(`     k=${k}: 평 K 데이터 ${dataCellsInScanOrderK(k).length}`);
}
