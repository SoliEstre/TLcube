/**
 * decoder-corner-marker-tones.test.js — 코너 마커의 **절대 톤 검증 경로** (배선 회귀).
 *
 * 전제 (2026-08-20 레인 실측으로 확정): A-CM 을 비-순열 톤(정본 H2O — 21셀 중 9셀이
 * 비-순열)으로 그리면 `scoreTetradAt` 의 순위 접기(rankDigit)가 동률 셀을 통째로
 * 0점 처리한다 — agreement 상한 (63−27)/63 = 0.5714 < 게이트 0.78 → `no-anchors`.
 * 「margin 을 만드는 성질(비-순열)이 그것을 재는 자(순위 접기)를 깨뜨린다」.
 *
 * 그래서 셀이 `tones: {T,L,R}` 를 실으면 `corner-marker-detect` 가 순위 대신
 * `orientation-scorer.scoreSampledOrientation` 의 절대 톤 분류를 쓴다. 이 파일이
 * 고정하는 것:
 *   ① `markerCellsA(k, tonesByKey)` 톤 적재 계약 — 발자국·digit 불변, 누락·범위는 던짐
 *   ② 절대 톤 경로가 painted 프레임에서 **실제로 통과**한다 (합성 + 정본 H2O)
 *   ③ 방향 판정층 — 21셀 정족수(면·톤별 8)를 **완화 없이** 채우고 margin 게이트 통과
 *   ④ 틀린 방향 H 에서는 기각된다 (마커 층 agreement 게이트가 자른다)
 *   ⑤ 순위(digit-only) 경로 무변경 — HEAD 9f8cda1 패치 전 실측 스냅샷과 값까지 동일
 *
 * 문턱은 하드코딩하지 않는다 — 전부 `UNVERIFIED_ORIENTATION_SCORER` ·
 * `DEFAULT_MARKER_AGREEMENT` 에서 유도한다 (완화 금지 목록의 정본 상수).
 *
 * ⚠ 이 회귀는 변이 검증을 했다: `scoreTetradAt` 의 절대 톤 갈래를 순위 갈래로
 *   되돌리면(분기 조건을 죽이면) ②·③(파이프라인 쪽)이 빨개진다. 그걸 눈으로 보고
 *   남겼다 (레인 기록: lane-out/verify.txt, 2026-08-20).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MARKER_AGREEMENT,
  verifyCornerMarkers,
} from '../src/decoder/corner-marker-detect.js';
import { markerCellsA, markerGroupsA } from '../src/markerA.js';
import { markerCells } from '../src/markerO.js';
import {
  hexKey, hexLayoutFrom, hexRotationHypotheses, scoreSampledOrientation,
  UNVERIFIED_ORIENTATION_SCORER,
} from '../src/decoder/orientation-scorer.js';
import { axialToPixel, cellSampleDiscs, FACES } from '../src/hexgrid.js';
import { digitToRanks } from '../src/lehmer.js';

// ── 정본 팩 — 두 배치 관례 탐침 (finder-oak-lineup.test.js 규약 승계) ────────
const DATA_LAYOUTS = ['../../.agent/decoder/data/', '../../TrilLuminanceCube/.agent/decoder/data/'];
function canonicalPathOrNull(fileName) {
  for (const rel of DATA_LAYOUTS) {
    const p = fileURLToPath(new URL(rel + fileName, import.meta.url));
    if (existsSync(p)) return p;
  }
  return null;
}

/** 정본 H2O 톤 표 — export 에 없는 셀은 중간색(1) (편집기 v2 규약). */
function canonicalH2oTonesOrNull() {
  const path = canonicalPathOrNull('finder-oak-candidates.json');
  if (path === null) return null;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const cand = doc.candidates.find((c) => c.name === 'H2O');
  const map = new Map();
  const touch = (q, r) => {
    const k = hexKey(q, r);
    if (!map.has(k)) map.set(k, { T: 1, L: 1, R: 1 });
    return map.get(k);
  };
  for (const [q, r] of cand.userNonData) touch(q, r);
  for (const face of FACES) {
    for (const [q, r, tone] of (cand.toneOverrides[face] || [])) touch(q, r)[face] = tone;
  }
  return map;
}

// ── 합성 톤 표 — 정본이 없는 기계에서도 절대 톤 경로 회귀가 돌게 하는 재구성 ──
// H2O 와 같은 구조를 값 없이 흉내 낸다: 코너0 = 비-순열 링(두 면 동률) + 전면 밝은
// 중심, 코너1·2 = 순열 링 + 전면 어두운 중심. 비-순열 9셀(= H2O 와 같은 수),
// 면·톤별 전체 정족수 dark 8 / bright 9 — minimumSamplesPerTone 8 을 **꼭 맞게**
// 채우므로 정족수 게이트도 완화 없이 함께 시험된다.
const SYNTH_RING = [
  [
    { T: 0, L: 2, R: 2 }, { T: 2, L: 0, R: 2 }, { T: 2, L: 2, R: 0 },
    { T: 0, L: 2, R: 2 }, { T: 2, L: 0, R: 2 }, { T: 2, L: 2, R: 0 },
  ],
  [
    { T: 1, L: 2, R: 0 }, { T: 0, L: 1, R: 2 }, { T: 2, L: 0, R: 1 },
    { T: 1, L: 0, R: 2 }, { T: 2, L: 1, R: 0 }, { T: 0, L: 2, R: 1 },
  ],
  [
    { T: 0, L: 1, R: 2 }, { T: 2, L: 0, R: 1 }, { T: 1, L: 2, R: 0 },
    { T: 0, L: 2, R: 1 }, { T: 1, L: 0, R: 2 }, { T: 2, L: 1, R: 0 },
  ],
];
const SYNTH_CENTER = [{ T: 2, L: 2, R: 2 }, { T: 0, L: 0, R: 0 }, { T: 0, L: 0, R: 0 }];

function syntheticTones(k) {
  const map = new Map();
  for (const cell of markerCellsA(k)) {
    const tones = cell.label === 'Z'
      ? SYNTH_CENTER[cell.corner]
      : SYNTH_RING[cell.corner][Number(cell.label.slice(1))];
    map.set(hexKey(cell.q, cell.r), tones);
  }
  return map;
}

function nonPermutationCount(cells) {
  return cells.filter((c) => [c.tones.T, c.tones.L, c.tones.R].slice().sort().join('') !== '012').length;
}

// ── painted 프레임 — 면 내접원(fraction 1)을 통째로 칠한다. 표본기는 fraction 0.5
//    원판을 읽으므로 표본 원판이 항상 painted 영역 안에 든다. 렌더러를 안 쓰는 이유:
//    렌더러(digit 계약)는 비-순열 톤을 **그릴 수 없다** — 그게 이 경로의 존재 이유다.
const TONE_LUMA = [0.08, 0.45, 0.82];
const CELL_SIZE = 22;

function paintFrame(cells, toneOf, cellSize) {
  let maxDist = 0;
  for (const c of cells) {
    const p = axialToPixel(c.q, c.r);
    maxDist = Math.max(maxDist, Math.hypot(p.x, p.y));
  }
  const half = Math.ceil((maxDist + 2) * cellSize);
  const width = half * 2 + 1;
  const center = { x: half, y: half };
  const data = new Float32Array(width * width).fill(0.5);
  for (const c of cells) {
    const discs = cellSampleDiscs(c.q, c.r, undefined, { fraction: 1, fractionOf: 'radius' });
    for (const face of FACES) {
      const disc = discs[face];
      const cx = center.x + disc.x * cellSize;
      const cy = center.y + disc.y * cellSize;
      const radius = disc.radius * cellSize;
      const value = TONE_LUMA[toneOf(c, face)];
      const x0 = Math.max(0, Math.floor(cx - radius));
      const x1 = Math.min(width - 1, Math.ceil(cx + radius));
      const y0 = Math.max(0, Math.floor(cy - radius));
      const y1 = Math.min(width - 1, Math.ceil(cy + radius));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) data[y * width + x] = value;
        }
      }
    }
  }
  const H = new Float64Array([cellSize, 0, center.x, 0, cellSize, center.y, 0, 0, 1]);
  return { luma: { width, height: width, data, alpha: null }, H, center };
}

function mul(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let acc = 0;
      for (let i = 0; i < 3; i += 1) acc += left[row * 3 + i] * right[i * 3 + col];
      out[row * 3 + col] = acc;
    }
  }
  return out;
}

function rotH(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float64Array([c, -s, 0, s, c, 0, 0, 0, 1]);
}

function snapshotVerify(v) {
  return {
    k: v.k,
    agree: v.agree,
    slots: v.slots,
    agreement: v.agreement,
    accepted: v.accepted,
    meanRadiusRatio: v.meanRadiusRatio,
    radiusOk: v.radiusOk,
    aliveCorners: v.aliveCorners,
    corners: v.corners.map((c) => ({
      corner: c.corner,
      agree: c.agree,
      slots: c.slots,
      sampled: c.sampled,
      alive: c.alive,
      offset: c.offset,
      scale: c.scale,
    })),
  };
}

function acceptToneFrame(tones) {
  const cells = markerCellsA(4, tones);
  const frame = paintFrame(cells, (c, f) => c.tones[f], CELL_SIZE);
  return {
    cells,
    frame,
    verification: verifyCornerMarkers(
      frame.luma,
      { H: frame.H, k: 4, cellSize: CELL_SIZE },
      {
        groups: markerGroupsA(4, tones), center: frame.center, searchCells: 0, scaleSearch: 0,
      },
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

test('① 톤 적재 계약 — 발자국·digit 불변, 누락·범위는 던진다', () => {
  const base = markerCellsA(4);
  for (const cell of base) {
    assert.equal('tones' in cell, false, 'tonesByKey 없이 만든 셀에 tones 가 실렸다');
  }
  const tones = syntheticTones(4);
  const loaded = markerCellsA(4, tones);
  assert.equal(loaded.length, base.length);
  for (let i = 0; i < base.length; i += 1) {
    const { tones: t, ...rest } = loaded[i];
    assert.deepEqual(rest, base[i], i + '번 셀의 발자국/digit 이 톤 적재로 변했다');
    assert.deepEqual(t, tones.get(hexKey(base[i].q, base[i].r)));
  }
  // 누락 — 조용한 digit 폴백 금지, 즉시 던진다.
  const missing = new Map(tones);
  missing.delete(hexKey(base[0].q, base[0].r));
  assert.throws(() => markerCellsA(4, missing), RangeError);
  // 범위 — 톤은 0/1/2 만.
  const bad = new Map(tones);
  bad.set(hexKey(base[0].q, base[0].r), { T: 3, L: 0, R: 1 });
  assert.throws(() => markerCellsA(4, bad), RangeError);
});

test('② 절대 톤 경로 — 합성 비-순열 톤이 painted 프레임에서 통과한다', () => {
  const tones = syntheticTones(4);
  const { cells, verification: v } = acceptToneFrame(tones);
  // 전제 유지 장치: 비-순열 셀이 있어야 이 경로의 존재 이유가 시험된다 (H2O 와 같은 9).
  assert.equal(nonPermutationCount(cells), 9, '합성 표의 비-순열 셀 수가 설계와 다르다');
  // 순위 접기라면 이 프레임의 agreement 상한은 (63−27)/63 — 게이트에 원리적으로 못 미친다.
  const rankFoldCeiling = (63 - 9 * 3) / 63;
  assert.ok(rankFoldCeiling < DEFAULT_MARKER_AGREEMENT,
    '전제 산술이 깨졌다 — 순위 접기 상한이 게이트를 넘으면 이 회귀의 대상이 사라진 것이다');
  assert.equal(v.accepted, true, '절대 톤 경로가 기각됐다: ' + JSON.stringify(snapshotVerify(v)));
  assert.ok(v.agreement >= DEFAULT_MARKER_AGREEMENT,
    'agreement ' + v.agreement + ' 가 마커 게이트 미만이다');
  assert.equal(v.agree, v.slots, '무노이즈 painted 프레임은 전 슬롯 일치여야 한다');
  assert.equal(v.aliveCorners, v.corners.length);
});

test('③ 절대 톤 경로 — 정본 H2O 톤 (정본 팩 있는 기계에서만)', (t) => {
  const tones = canonicalH2oTonesOrNull();
  if (tones === null) {
    t.skip('finder-oak-candidates.json 없음 — 정본 검증은 정본이 있는 기계에서 돈다');
    return;
  }
  // 정본 표는 markerA 발자국(21셀)과 정확히 겹쳐야 한다 (markerA 헤더 §1 실측의 회귀).
  const footprint = new Set(markerCellsA(4).map((c) => hexKey(c.q, c.r)));
  assert.equal(tones.size, footprint.size, '정본 톤 표 셀 수가 마커 발자국과 다르다');
  for (const k of footprint) assert.ok(tones.has(k), '정본 톤 표에 ' + k + ' 가 없다');

  const { cells, verification: v } = acceptToneFrame(tones);
  assert.equal(nonPermutationCount(cells), 9, 'H2O 비-순열 셀 수(레인 전제)가 변했다');
  assert.equal(v.accepted, true, '정본 톤이 기각됐다: ' + JSON.stringify(snapshotVerify(v)));
  assert.ok(v.agreement >= DEFAULT_MARKER_AGREEMENT);
  assert.equal(v.agree, v.slots);
});

test('④ 방향 판정층 — 21셀 정족수를 완화 없이 채우고 margin 게이트를 넘는다', () => {
  const tables = [['합성', syntheticTones(4)]];
  const canonical = canonicalH2oTonesOrNull();
  if (canonical !== null) tables.push(['정본 H2O', canonical]);
  for (const [name, tones] of tables) {
    const layout = hexLayoutFrom(markerCellsA(4, tones));
    const byKey = new Map(layout.map((e) => [e.key, e]));
    const sampler = (key) => {
      const cell = byKey.get(key);
      if (!cell) return null;
      return { T: TONE_LUMA[cell.tones.T], L: TONE_LUMA[cell.tones.L], R: TONE_LUMA[cell.tones.R] };
    };
    // 캘리브레이션 무전달 — 정본 게이트 그대로 (테스트용 정족수 인하 없음).
    const scored = scoreSampledOrientation(layout, hexRotationHypotheses(), sampler);
    assert.equal(scored.claimed.id, 'identity', name);
    assert.equal(scored.claimed.enoughSamples, true,
      name + ': 면·톤별 표본이 정족수(' + UNVERIFIED_ORIENTATION_SCORER.minimumSamplesPerTone
      + ') 미달이다 — 21셀 표가 정족수를 못 채우면 방향 판정층 배선 자체가 무효다');
    assert.equal(scored.accepted, true, name + ' 기각: ' + scored.rejectReason);
    assert.equal(scored.rejectReason, null, name);
    assert.ok(scored.claimed.agreement >= UNVERIFIED_ORIENTATION_SCORER.minimumAgreement, name);
    assert.ok(
      scored.orientationMargin >= UNVERIFIED_ORIENTATION_SCORER.minimumOrientationMargin,
      name + ' margin ' + scored.orientationMargin + ' 이 게이트 미만이다',
    );
  }
});

test('⑤ 틀린 방향 H 는 마커 층 agreement 게이트가 자른다', () => {
  const tables = [['합성', syntheticTones(4)]];
  const canonical = canonicalH2oTonesOrNull();
  if (canonical !== null) tables.push(['정본 H2O', canonical]);
  for (const [name, tones] of tables) {
    const cells = markerCellsA(4, tones);
    const frame = paintFrame(cells, (c, f) => c.tones[f], CELL_SIZE);
    const v = verifyCornerMarkers(
      frame.luma,
      { H: mul(frame.H, rotH((2 * Math.PI) / 3)), k: 4, cellSize: CELL_SIZE },
      {
        groups: markerGroupsA(4, tones), center: frame.center, searchCells: 0, scaleSearch: 0,
      },
    );
    assert.equal(v.accepted, false, name + ': 120° 오가설이 통과했다 — 방향이 안 선다');
    assert.ok(v.agreement < DEFAULT_MARKER_AGREEMENT,
      name + ': 오가설 agreement ' + v.agreement + ' 가 게이트를 넘는다');
  }
});

// ── ⑥ 순위(digit-only) 경로 무변경 — HEAD 9f8cda1 패치 전 실측과 값까지 동일 ──
//
// 아래 스냅샷은 절대 톤 배선 **전**(HEAD 9f8cda1)에서 같은 painted 입력으로 실측한
// 값이다 (lane-out/probe-rank-path.mjs, 2026-08-20 — 같은 명령 2회 diff 로 결정성
// 확인). 순위 경로 코드가 조금이라도 움직이면 여기서 갈린다.

const PIN_ACM_DIGIT = {
  k: 4,
  agree: 63,
  slots: 63,
  agreement: 1,
  accepted: true,
  meanRadiusRatio: 1,
  radiusOk: true,
  aliveCorners: 3,
  corners: [
    {
      corner: 0, agree: 21, slots: 21, sampled: 7, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
    {
      corner: 1, agree: 21, slots: 21, sampled: 7, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
    {
      corner: 2, agree: 21, slots: 21, sampled: 7, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
  ],
};

// 교란 프레임 — 완전 입력 전용 스냅샷이 놓칠 «미묘한 순위 경로 변화» 를 잡는 비완전
// 입력: 코너0 R0 셀의 T/L 페인트를 맞바꾸면 그 셀의 T·L 순위만 정확히 2 슬롯 어긋난다.
const PIN_ACM_DIGIT_PERTURBED = {
  k: 4,
  agree: 61,
  slots: 63,
  agreement: 0.9682539682539683,
  accepted: true,
  meanRadiusRatio: 1,
  radiusOk: true,
  aliveCorners: 3,
  corners: [
    {
      corner: 0, agree: 19, slots: 21, sampled: 7, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
    {
      corner: 1, agree: 21, slots: 21, sampled: 7, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
    {
      corner: 2, agree: 21, slots: 21, sampled: 7, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
  ],
};

const PIN_OCM_DIGIT = {
  k: 6,
  agree: 36,
  slots: 36,
  agreement: 1,
  accepted: true,
  meanRadiusRatio: 1,
  radiusOk: true,
  aliveCorners: 3,
  corners: [
    {
      corner: 0, agree: 12, slots: 12, sampled: 4, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
    {
      corner: 2, agree: 12, slots: 12, sampled: 4, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
    {
      corner: 4, agree: 12, slots: 12, sampled: 4, alive: true, offset: { dx: 0, dy: 0 }, scale: 1,
    },
  ],
};

test('⑥ 순위 경로 무변경 — A-CM digit painted 스냅샷이 패치 전 실측과 같다', () => {
  const cells = markerCellsA(4);
  const frame = paintFrame(cells, (c, f) => digitToRanks(c.digit)[f], CELL_SIZE);
  const v = verifyCornerMarkers(
    frame.luma,
    { H: frame.H, k: 4, cellSize: CELL_SIZE },
    {
      groups: markerGroupsA(4), center: frame.center, searchCells: 0, scaleSearch: 0,
    },
  );
  assert.deepEqual(snapshotVerify(v), PIN_ACM_DIGIT);

  const odd = cells[1];
  const perturbed = paintFrame(cells, (c, f) => {
    const ranks = digitToRanks(c.digit);
    if (c === odd) {
      if (f === 'T') return ranks.L;
      if (f === 'L') return ranks.T;
    }
    return ranks[f];
  }, CELL_SIZE);
  const vp = verifyCornerMarkers(
    perturbed.luma,
    { H: perturbed.H, k: 4, cellSize: CELL_SIZE },
    {
      groups: markerGroupsA(4), center: perturbed.center, searchCells: 0, scaleSearch: 0,
    },
  );
  assert.deepEqual(snapshotVerify(vp), PIN_ACM_DIGIT_PERTURBED);
});

test('⑥ 순위 경로 무변경 — O-CM digit painted (기본 groups·기본 탐색 포함)', () => {
  const cells = markerCells(6);
  const frame = paintFrame(cells, (c, f) => digitToRanks(c.digit)[f], CELL_SIZE);
  const noSearch = verifyCornerMarkers(
    frame.luma,
    { H: frame.H, k: 6, cellSize: CELL_SIZE },
    { center: frame.center, searchCells: 0, scaleSearch: 0 },
  );
  assert.deepEqual(snapshotVerify(noSearch), PIN_OCM_DIGIT);
  // 기본 국소 탐색·배율 탐색을 켜도 같은 값으로 수렴해야 한다 (탐색 기계 무변경).
  const searched = verifyCornerMarkers(
    frame.luma,
    { H: frame.H, k: 6, cellSize: CELL_SIZE },
    { center: frame.center },
  );
  assert.deepEqual(snapshotVerify(searched), PIN_OCM_DIGIT);
});
