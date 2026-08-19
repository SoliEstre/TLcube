// orientation-scorer.test.js — 레이아웃 주도·타입 비종속 방향 채점기 (oak §4-4)
//
// 자 검증이 본론이다: 이 채점기가 Y 정본 4종의 알려진 margin (v0w 0.0952 ·
// v0w2 0.1512 · v0wq 0.0889 · v0wy 0.0796, HEAD 2354f71 기준) 을 기존
// cellSurfaceY-detect ideal 채점과 **동시에** 재현해야 자가 맞는 것이다.
// oak 정본 후보 7종 재현은 정본 JSON 이 있는 기계에서만 돈다 (없으면 skip —
// skip 사유가 로그에 남는다). 재측정 스크립트는 test/output/lanes/claude-oak-margins.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FACE_CYCLE_CW,
  FACE_CYCLE_CW2,
  FACE_IDENTITY,
  hexAuxCoordMaps,
  hexHypothesis,
  hexKey,
  hexLayoutFrom,
  hexRotationHypotheses,
  idealAgreement,
  scoreLayoutOrientation,
  scoreSampledOrientation,
  UNVERIFIED_ORIENTATION_SCORER,
} from '../src/decoder/orientation-scorer.js';
import { locatorCellsCellSurfaceFinal } from '../src/cellSurfaceFinal.js';
import { evaluateCellSurfaceGeometry } from '../src/decoder/cellSurfaceY-detect.js';
import { markerCells, orientationMarginOMarker } from '../src/markerO.js';
import { markerCellsA, orientationMarginAMarker } from '../src/markerA.js';
import { digitToRanks } from '../src/lehmer.js';

// 정본 팩은 **바깥(private) repo** 에 있다 — TLcube 는 그 안에 중첩된 별도 repo 이므로
// `TLcube/test/` 기준 두 단계 위가 바깥 repo 루트다. 기계 고정 절대경로를 쓰면 다른
// 체크아웃·CI 에서 조용히 skip 되어 «거짓 초록» 이 된다.
const CANDIDATES_PATH = fileURLToPath(
  new URL('../../.agent/decoder/data/finder-oak-candidates.json', import.meta.url));

// Y 레이아웃 → 채점기 레이아웃 (key = "i,j" — 좌표계 무관함이 타입 비종속의 요점)
function yLayout(n, id) {
  return locatorCellsCellSurfaceFinal(n, id).map((cell) => ({
    key: cell.i + ',' + cell.j,
    tones: { T: cell.T, L: cell.L, R: cell.R },
  }));
}

// Y 의 물리 회전 = (i,j) 항등 ∘ 면 순환 — cellSurfaceY-detect 의 FACE_CYCLES 와 동일
function yHypotheses() {
  return [
    { id: 'identity', mapKey: (key) => key, faceMap: FACE_IDENTITY },
    { id: 'cycle-LRT', mapKey: (key) => key, faceMap: FACE_CYCLE_CW2 },
    { id: 'cycle-RTL', mapKey: (key) => key, faceMap: FACE_CYCLE_CW },
  ];
}

// cellSurfaceY-detect 의 ideal 표본기 (claude-v0w2-probe.mjs 와 동일 규약)
function idealSampleCellFor(n, id) {
  const table = locatorCellsCellSurfaceFinal(n, id);
  const byKey = new Map(table.map((cell) => [cell.i + ',' + cell.j, cell]));
  return (i, j) => {
    const cell = byKey.get(i + ',' + j);
    if (!cell) return { i, j, ok: false };
    return {
      i, j, ok: true,
      T: { median: cell.T === 0 ? 0.08 : 0.82 },
      L: { median: cell.L === 0 ? 0.08 : 0.82 },
      R: { median: cell.R === 0 ? 0.08 : 0.82 },
    };
  };
}

const Y_KNOWN = [
  ['v0w', 21, '0.0952'],
  ['v0w2', 21, '0.1512'],
  ['v0wq', 21, '0.0889'],
  ['v0wy', 21, '0.0796'],
];

test('자 검증 — Y 정본 4종 margin 을 기존 채점기와 동일하게 재현한다', () => {
  for (const [id, n, known] of Y_KNOWN) {
    const scored = scoreLayoutOrientation(yLayout(n, id), yHypotheses());
    // ① 알려진 공표치 재현 (HEAD 2354f71 의 레이아웃 기준)
    assert.equal(
      scored.orientationMargin.toFixed(4), known,
      id + '@' + n + ' margin 공표치 재현 실패',
    );
    // ② 기존 cellSurfaceY-detect ideal 채점과 동치 — 자와 자가 서로 맞다
    const reference = evaluateCellSurfaceGeometry(
      { n }, idealSampleCellFor(n, id), { cellSurfaceLayout: id },
    );
    assert.ok(reference.scored, id + ' 기준 채점기 결과 없음');
    assert.ok(
      Math.abs(scored.orientationMargin - reference.scored.orientationMargin) < 1e-12,
      id + ' margin 이 기존 채점기와 다르다: '
      + scored.orientationMargin + ' vs ' + reference.scored.orientationMargin,
    );
  }
});

test('합성 사상 — O-CM tetrad margin 0.9444 를 markerO 와 동일하게 재현한다', () => {
  for (const k of [6, 8, 10]) {
    const layout = hexLayoutFrom(markerCells(k).map((c) => ({
      q: c.q, r: c.r, tones: digitToRanks(c.digit),
    })));
    const scored = scoreLayoutOrientation(layout, hexRotationHypotheses());
    const reference = orientationMarginOMarker(k);
    assert.ok(
      Math.abs(scored.orientationMargin - reference.margin) < 1e-12,
      'k=' + k + ' O-CM margin 불일치: ' + scored.orientationMargin + ' vs ' + reference.margin,
    );
    assert.equal(scored.orientationMargin.toFixed(4), '0.9444', 'k=' + k);
  }
});

test('합성 사상 — A-CM 링 마커 margin 1.0000 을 markerA 와 동일하게 재현한다', () => {
  for (const k of [6, 8, 10]) {
    const layout = hexLayoutFrom(markerCellsA(k).map((c) => ({
      q: c.q, r: c.r, tones: digitToRanks(c.digit),
    })));
    const scored = scoreLayoutOrientation(layout, hexRotationHypotheses());
    const reference = orientationMarginAMarker(k);
    assert.ok(
      Math.abs(scored.orientationMargin - reference.margin) < 1e-12,
      'k=' + k + ' A-CM margin 불일치',
    );
    assert.equal(scored.orientationMargin, 1, 'k=' + k + ' A-CM margin 은 1 이어야 한다');
  }
});

test('oak 정본 후보 7종 margin 재현 (정본 JSON 있는 기계에서만)', (t) => {
  if (!existsSync(CANDIDATES_PATH)) {
    t.skip('finder-oak-candidates.json 없음 — 이 검증은 정본이 있는 기계에서 돈다');
    return;
  }
  const doc = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf8'));
  const canonical = doc._margins_canonical;
  assert.ok(canonical, '_margins_canonical 이 없다');
  const keyOf = (c) => (c.name === 'Nitrogen' ? 'Nitrogen(O,dead)' : c.name + '(' + c.type + ')');
  for (const cand of doc.candidates) {
    const cells = new Map();
    const touch = (q, r) => {
      const k = hexKey(q, r);
      if (!cells.has(k)) cells.set(k, { q, r, tones: { T: 1, L: 1, R: 1 } });
      return cells.get(k);
    };
    for (const [q, r] of cand.userNonData) touch(q, r);
    for (const face of ['T', 'L', 'R']) {
      for (const [q, r, tone] of (cand.toneOverrides[face] || [])) touch(q, r).tones[face] = tone;
    }
    const layout = hexLayoutFrom([...cells.values()]);
    const scored = scoreLayoutOrientation(layout, hexRotationHypotheses());
    const expected = canonical[keyOf(cand)];
    assert.ok(expected !== undefined, keyOf(cand) + ' 공표치 없음');
    assert.ok(
      Math.abs(scored.orientationMargin - expected) < 5e-4,
      cand.name + ' margin ' + scored.orientationMargin.toFixed(4) + ' vs 공표 ' + expected,
    );
  }
});

test('표본 채점 — 완전 표본에서 항등 수용 · 라이벌 agreement = 공변분율', () => {
  const layout = hexLayoutFrom(markerCells(8).map((c) => ({
    q: c.q, r: c.r, tones: digitToRanks(c.digit),
  })));
  const LUMA = { 0: 0.08, 1: 0.45, 2: 0.82 };
  const byKey = new Map(layout.map((e) => [e.key, e]));
  const sampler = (key) => {
    const cell = byKey.get(key);
    if (!cell) return null;
    return { T: LUMA[cell.tones.T], L: LUMA[cell.tones.L], R: LUMA[cell.tones.R] };
  };
  // 12셀 마커는 면별 톤 정족수(8)에 못 미친다 — 여기서는 «메커니즘» 을 검증하므로
  // 정족수만 시험용으로 낮춘다 (게이트 완화가 아니라 테스트 국소 설정).
  const options = { calibration: { orientationScorer: { minimumSamplesPerTone: 1 } } };
  const scored = scoreSampledOrientation(layout, hexRotationHypotheses(), sampler, options);
  assert.equal(scored.claimed.id, 'identity');
  assert.equal(scored.claimed.agreement, 1);
  assert.ok(scored.accepted, '완전 표본 항등 가설이 수용돼야 한다: ' + scored.rejectReason);
  // 라이벌은 항등을 이길 수 없어야 한다. (주의: 분류 파이프라인의 라이벌 agreement 는
  // 가설별 앵커 재산출 때문에 naive 공변분율과 수치가 다를 수 있다 — ideal 동치는
  // «레이아웃 모드» 의 성질이고 위 Y 4종 테스트가 그쪽을 고정한다.)
  for (const phase of scored.phases) {
    if (phase.id === 'identity') continue;
    assert.ok(phase.agreement < 1, phase.id + ' 가 항등과 동률이면 방향이 안 선다');
  }
  assert.ok(scored.orientationMargin > 0);
});

test('표본 채점 — 관측 없는 슬롯은 분모에서 빠진다 (소거 규약)', () => {
  const layout = hexLayoutFrom(markerCells(8).map((c) => ({
    q: c.q, r: c.r, tones: digitToRanks(c.digit),
  })));
  const LUMA = { 0: 0.08, 1: 0.45, 2: 0.82 };
  const byKey = new Map(layout.map((e) => [e.key, e]));
  // B 셀(digit 4)은 세 코너에 복제돼 있어 하나를 소거해도 면별 앵커가 죽지 않는다.
  // (layout[0] = 코너0 앵커 digit 5 는 T-bright 유일 표본이라 소거하면 앵커 자체가
  // 죽는 별개 상황이 된다 — 그건 소거 규약이 아니라 앵커 정족수의 영역이다.)
  const dropped = layout[1].key;
  const sampler = (key) => {
    if (key === dropped) return null; // 프레임 밖 소거
    const cell = byKey.get(key);
    if (!cell) return null;
    return { T: LUMA[cell.tones.T], L: LUMA[cell.tones.L], R: LUMA[cell.tones.R] };
  };
  const options = { calibration: { orientationScorer: { minimumSamplesPerTone: 1 } } };
  const scored = scoreSampledOrientation(layout, hexRotationHypotheses(), sampler, options);
  assert.equal(scored.claimed.id, 'identity');
  assert.equal(scored.claimed.agreement, 1, '소거 슬롯이 불일치로 새면 1 이 깨진다');
  assert.equal(scored.claimed.total, (layout.length - 1) * 3);
});

test('게이트 상수는 cellSurfaceY-detect 와 같은 값이다 (완화 없음)', () => {
  assert.equal(UNVERIFIED_ORIENTATION_SCORER.minimumAgreement, 0.78);
  assert.equal(UNVERIFIED_ORIENTATION_SCORER.minimumOrientationMargin, 0.035);
  assert.equal(UNVERIFIED_ORIENTATION_SCORER.minimumSamplesPerTone, 8);
  assert.equal(UNVERIFIED_ORIENTATION_SCORER.classifyMidFraction, 0.28);
});

test('보조 사상 — rot60 두 번은 rotate120, mirror 는 대합', () => {
  const { rot60, rot180, rot300, mirror } = hexAuxCoordMaps();
  const K = (p) => hexKey(p.q, p.r); // String(-0) === "0" — 키 비교로 −0 잡음 제거
  for (let q = -3; q <= 3; q += 1) {
    for (let r = -3; r <= 3; r += 1) {
      const once = rot60(q, r);
      const twice = rot60(once.q, once.r);
      assert.equal(K(twice), hexKey(-q - r, q), 'rot60² = rotate120');
      const thrice = rot60(twice.q, twice.r);
      assert.equal(K(thrice), K(rot180(q, r)), 'rot60³ = rot180');
      const six = rot300(once.q, once.r);
      assert.equal(K(six), hexKey(q, r), 'rot300 ∘ rot60 = 항등');
      const m1 = mirror(q, r);
      assert.equal(K(mirror(m1.q, m1.r)), hexKey(q, r), 'mirror² = 항등');
    }
  }
  // 스모크: hexHypothesis 로 감싼 60° 가설이 idealAgreement 에 먹힌다
  const layout = hexLayoutFrom(markerCells(8).map((c) => ({
    q: c.q, r: c.r, tones: digitToRanks(c.digit),
  })));
  const h60 = hexHypothesis('rot60-cycleT', rot60, FACE_CYCLE_CW);
  const a = idealAgreement(layout, h60);
  // O-CM 실측 §1.3: 60° 는 12/12 전부 집합 밖 — 위치로 죽는다
  assert.equal(a.outside, layout.length * 3, 'O-CM 60° 는 전 슬롯이 집합 밖이어야 한다');
  assert.equal(a.agreement, 0);
});

/*
 * ── Type Y 등가 결속 (2026-08-18, 배선 2단계) ──────────────────────────────
 *
 * 이 채점기는 «좌표 회전 ∘ 면 순환» 합성 사상을 가설로 받는다 (O/A/K 대비).
 * 기존 `cellSurfaceY-detect` 는 **면 순환만** 쓴다 (좌표 항등). Type Y 에서는
 * 좌표 회전이 항등이므로 **두 경로가 같은 답을 내야 한다** — 그게 이 모듈을 Y
 * 경로에 붙여도 안전하다는 증명이고, 안 맞으면 붙이는 순간 v0T/v0TR 이득이 흔들린다.
 *
 * ⚠ 판정 축은 **절대 agreement 가 아니라 margin** 이다. 회전 상의 agreement 는
 * 0.90\~0.95 로 게이트 0.78 을 넘지만, 그건 «뚫렸다» 가 아니다 —
 * `margin = 항등 − 최고 라이벌` 이고 1 − 0.9038 = 0.0962 가 v0t 의 정본 margin 이다.
 * (측정 1차에서 이 축을 오독해 «게이트를 넘는다» 로 읽었다. 기록해 둔다.)
 */
test('Type Y 에서 새 채점기의 margin 이 정본 값과 같다 — 붙여도 결론이 안 바뀐다', async () => {
  const { locatorCellsCellSurfaceFinal, finalLayoutIdsForN } =
    await import('../src/cellSurfaceFinal.js');
  // 정본 margin (cellSurfaceFinal.test.js 의 방향 margin 핀과 같은 값).
  //
  // **v0try 0.0645 추가 (2026-08-19 통합)** — 이 값은 A 블록 편입 커밋 `00936ce` 가
  // 파생을 만들기 **전에 예측한 값과 정확히 같다** (「v0try 예측: 비대칭 9 (= A) ·
  // margin 0.0645 (1.84배) → 성립한다」). 예측이 맞았다는 사실 자체가 유도가 옳다는
  // 증거라 여기 적어 둔다 — 값만 박아 두면 다음 사람은 «어디서 나온 숫자인가» 를
  // 다시 물어야 한다.
  const EXPECTED = {
    v0t: 0.0962, v0ty: 0.0632, v0tr: 0.0980, v0trq: 0.0519, v0try: 0.0645,
  };
  for (const id of finalLayoutIdsForN(21)) {
    const layout = locatorCellsCellSurfaceFinal(21, id).map((c) => ({
      key: c.i + ',' + c.j,
      tones: { T: c.T, L: c.L, R: c.R },
    }));
    const identity = idealAgreement(layout,
      { id: 'id', faceMap: FACE_IDENTITY, mapKey: (k) => k });
    assert.equal(identity.agreement, 1, id + ' 정방향 agreement 가 1 이 아니다');
    let worstMargin = Infinity;
    for (const faceMap of [FACE_CYCLE_CW, FACE_CYCLE_CW2]) {
      const rival = idealAgreement(layout, { id: 'r', faceMap, mapKey: (k) => k });
      worstMargin = Math.min(worstMargin, identity.agreement - rival.agreement);
    }
    assert.ok(Math.abs(worstMargin - EXPECTED[id]) < 5e-4,
      id + ' margin ' + worstMargin.toFixed(4) + ' 이 정본 ' + EXPECTED[id] + ' 와 다르다');
    assert.ok(worstMargin >= UNVERIFIED_ORIENTATION_SCORER.minimumOrientationMargin,
      id + ' margin 이 게이트 미만이다');
  }
});

test('게이트 상수가 cellSurfaceY-detect 와 동일 계승이다 — 주석의 주장이 사실인가', async () => {
  const y = await import('../src/decoder/cellSurfaceY-detect.js');
  assert.ok(y.UNVERIFIED_CELL_SURFACE_Y, 'Y 채점기가 캘리브레이션을 안 내보낸다');
  for (const key of Object.keys(UNVERIFIED_ORIENTATION_SCORER)) {
    assert.equal(UNVERIFIED_ORIENTATION_SCORER[key], y.UNVERIFIED_CELL_SURFACE_Y[key],
      key + ' 가 Y 채점기와 다르다 — «완화 아님, 동일 계승» 주석이 거짓이 된다');
  }
});
