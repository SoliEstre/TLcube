/**
 * markerK.test.js — K-CM «앵커 위 마커»((다)안) 잠금.
 *
 * markerK.js 의 로드 자기검증은 «모듈이 자기 주장을 지키는가» 를 본다. 이 파일은
 * 거기서 한 칸 더 나간다: **모듈 헤더가 근거로 든 실측값 자체**를 자로 고정한다.
 * 헤더가 «margin 1.0000 · 60° 0.3889 · 평 K 최고 < 0.78» 이라고 적었으면 그 문장이
 * 참이어야 하고, 언젠가 거짓이 되면 여기서 죽어야 한다 (주석의 주장은 사실이어야 한다).
 *
 * 사상·채점은 전부 정본 함수다 — 손 계산 0 (`decoder/orientation-scorer.js`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  markerCellsK,
  markerPositionSetK,
  markerGroupsK,
  invertedTrianglesK,
  MARKER_INVERTED_DIGITS_K,
  MARKER_CELL_COUNT_K,
  MARKER_OVERHEAD_ADDED_K,
  VERSIONS_KCM,
  capacityForKMarker,
  capacityTableKMarker,
  versionSpecKMarker,
  chooseVersionKMarker,
  patchReferenceCellsKMarker,
  buildRoleSetsKMarker,
  roleOfKMarker,
  dataCellsInScanOrderKMarker,
  fillerCellsKMarker,
  orientationMarginKMarker,
} from '../src/markerK.js';
import {
  ANCHOR_INVERTED_DIGIT,
  invertedVertexAnchors,
  vertexAnchorsK,
  vertexAnchorPositionSetK,
  patchReferenceCellsK,
  buildRoleSetsK,
  regionCellsK,
  patchOfK,
  isInRegionK,
} from '../src/placementK.js';
import { dataCellsInScanOrderK } from '../src/layoutK.js';
import { markerCellsA, MARKER_LOCAL_DIGITS_A, MARKER_CELL_COUNT_A } from '../src/markerA.js';
import { patchReferenceRings } from '../src/placementA.js';
import { rotate120, rotate240 } from '../src/placement.js';
import { digitToRanks } from '../src/lehmer.js';
import { encodeK } from '../src/encodeK.js';
import { VERSIONS_K, capacityForK } from '../src/capacityK.js';
import {
  hexLayoutFrom, idealAgreement, hexAuxCoordMaps, hexHypothesis,
  FACE_IDENTITY, FACE_CYCLE_CW, FACE_CYCLE_CW2, UNVERIFIED_ORIENTATION_SCORER,
} from '../src/decoder/orientation-scorer.js';

const KS = VERSIONS_K.map((spec) => spec.k);
const key = (c) => `${c.q},${c.r}`;
/** corner-marker-detect.DEFAULT_MARKER_AGREEMENT 와 같은 값 — 완화 아님, 동일 계승. */
const MARKER_AGREEMENT_FLOOR = 0.78;

/** 정본 H2CO3 (k=4·30셀) `userNonData` — `.agent/decoder/data/finder-oak-candidates.json`. */
const H2CO3_K4 = [
  '-7,3', '-7,4', '-6,2', '-6,3', '-6,4', '-5,2', '-5,3', '-4,-4', '-4,-3', '-4,7',
  '-4,8', '-3,-4', '-3,7', '2,-6', '2,-5', '2,3', '2,4', '3,-7', '3,-6', '3,-5',
  '3,2', '3,3', '3,4', '4,-7', '4,-6', '4,2', '4,3', '7,-4', '7,-3', '8,-4',
];

function toneLayout(cells) {
  return hexLayoutFrom(cells.map((c) => ({ q: c.q, r: c.r, tones: digitToRanks(c.digit) })));
}

function auxAgreement(cells, mapName, faceMap) {
  const coordMap = hexAuxCoordMaps()[mapName];
  return idealAgreement(toneLayout(cells), hexHypothesis(mapName, coordMap, faceMap)).agreement;
}

function auxMax(cells, mapName) {
  return Math.max(...[FACE_IDENTITY, FACE_CYCLE_CW, FACE_CYCLE_CW2]
    .map((faceMap) => auxAgreement(cells, mapName, faceMap)));
}

test('발자국 — 규칙 유도가 정본 H2CO3 30셀과 집합 동일하다 (k=4)', () => {
  const derived = markerPositionSetK(4);
  assert.equal(derived.size, H2CO3_K4.length);
  for (const kk of H2CO3_K4) assert.ok(derived.has(kk), `정본 셀 ${kk} 이 유도에 없다`);
});

test('발자국 — 전 k 에서 30셀 · ρ-불변 · 영역 K 의 패치 위 · A 21 + 반전 9', () => {
  for (const k of KS) {
    const cells = markerCellsK(k);
    assert.equal(cells.length, MARKER_CELL_COUNT_K, `k=${k}`);
    assert.equal(cells.filter((c) => c.series === 'A').length, MARKER_CELL_COUNT_A);
    assert.equal(cells.filter((c) => c.series === 'inverted').length, 9);
    // A 계열은 markerA 정본과 좌표·digit 이 바이트 동일이어야 한다 (재유도 금지).
    const a = markerCellsA(k);
    cells.filter((c) => c.series === 'A').forEach((c, i) => {
      assert.equal(key(c), key(a[i]));
      assert.equal(c.digit, a[i].digit);
      assert.equal(c.label, a[i].label);
    });
    const set = markerPositionSetK(k);
    assert.equal(set.size, MARKER_CELL_COUNT_K);
    for (const c of cells) {
      assert.ok(isInRegionK(c.q, c.r, k), `${key(c)} 이 영역 밖`);
      assert.notEqual(patchOfK(c.q, c.r, k), null, `${key(c)} 이 육각 코어`);
      for (const rot of [rotate120, rotate240]) {
        const p = rot(c.q, c.r);
        assert.ok(set.has(`${p.q},${p.r}`), `ρ-불변 위반 ${key(c)}`);
      }
    }
    // 반전 삼각은 6패치 중 반전 3패치를 정확히 하나씩 덮는다 (계약 K-4 순서).
    assert.deepEqual(
      invertedTrianglesK(k).map((tri) => patchOfK(tri[0].q, tri[0].r, k)),
      ['TL', 'bottom', 'TR'],
    );
    assert.deepEqual(invertedTrianglesK(k).map((tri) => tri.length), [3, 3, 3]);
    // 코너 묶음 6개 — A 3(기준 Z) + 반전 3(기준 W).
    const groups = markerGroupsK(k);
    assert.equal(groups.length, 6);
    assert.deepEqual(groups.map((g) => g.anchorLabel), ['Z', 'Z', 'Z', 'W', 'W', 'W']);
    assert.deepEqual(groups.map((g) => g.cells.length), [7, 7, 7, 3, 3, 3]);
  }
});

test('(다)안 — 꼭짓점 셀이 앵커 digit 과 마커 digit 을 같은 값으로 만족한다', () => {
  // 이 단언이 (다)안 그 자체다. 깨지면 앵커 판정과 마커 판정이 서로 싸운다.
  assert.equal(MARKER_INVERTED_DIGITS_K.W, ANCHOR_INVERTED_DIGIT);
  // 나머지 둘은 markerA 어휘 안 — 새 digit 어휘 0개 (실측이 고른 값).
  assert.equal(MARKER_INVERTED_DIGITS_K.N0, MARKER_LOCAL_DIGITS_A.ringOdd);
  assert.equal(MARKER_INVERTED_DIGITS_K.N1, MARKER_LOCAL_DIGITS_A.center);

  for (const k of KS) {
    const anchorDigit = new Map(vertexAnchorsK(k).map((c) => [key(c), c.digit]));
    const covered = markerCellsK(k).filter((c) => vertexAnchorPositionSetK(k).has(key(c)));
    assert.equal(covered.length, 3, `k=${k} 마커가 덮는 꼭짓점 앵커`);
    for (const c of covered) {
      assert.equal(c.digit, anchorDigit.get(key(c)), `k=${k} ${key(c)}`);
      // 덮이는 것은 **반전 계열**뿐이다 — A 계열 꼭짓점(5/0/0)은 안 닿는다.
      assert.ok(invertedVertexAnchors(k).some((v) => key(v) === key(c)));
    }
  }
});

test('① 방향 margin — orientation-scorer 정본으로 1.0000 (게이트 0.035)', () => {
  for (const k of KS) {
    const scored = orientationMarginKMarker(k);
    assert.equal(scored.slots, MARKER_CELL_COUNT_K * 3);
    assert.equal(scored.margin, 1, `k=${k}`);
    assert.ok(scored.margin >= UNVERIFIED_ORIENTATION_SCORER.minimumOrientationMargin);
    for (const phase of scored.phases) {
      assert.equal(phase.agreement, phase.id === 'identity' ? 1 : 0, phase.id);
    }
  }
});

test('② 60° 오가설 — 앵커 6셀만으로 죽는다 (계약 K-2 근거, (다)안 후에도 유지)', () => {
  for (const k of KS) {
    const anchors = vertexAnchorsK(k);
    for (const mapName of ['rot60', 'rot180', 'rot300']) {
      const agreement = auxMax(anchors, mapName);
      assert.ok(agreement < MARKER_AGREEMENT_FLOOR,
        `k=${k} ${mapName} agreement ${agreement} 가 하한 위다`);
      assert.equal(Number(agreement.toFixed(4)), 0.3889, `k=${k} ${mapName}`);
    }
    // ⚠ 거울은 앵커만으로 **안 죽는다** — 모듈 헤더 §2 의 부수 실측. 이 단언이
    // 뒤집히면(= 앵커가 거울도 죽이게 되면) 헤더의 «마커가 메운다» 서술이 낡는다.
    assert.equal(auxMax(anchors, 'mirror'), 1, `k=${k} 앵커 단독 거울`);
    // 마커를 포함하면 거울이 죽는다 — K-CM 이 평 K 에 더하는 값.
    const withMarker = auxMax(markerCellsK(k), 'mirror');
    assert.ok(withMarker < MARKER_AGREEMENT_FLOOR, `k=${k} 마커 포함 거울 ${withMarker}`);
    assert.equal(Number(withMarker.toFixed(4)), 0.4);
  }
});

test('③ 마커 유/무 — 평 K 프레임에 K-CM 기대를 대면 하한 아래다', () => {
  let worst = 0;
  for (const spec of VERSIONS_K) {
    const expect = markerCellsK(spec.k);
    for (const level of ['L', 'M', 'H']) {
      for (const text of ['', 'TLcube', 'https://tlcube.example/k', 'x'.repeat(30)]) {
        let encoded;
        try {
          encoded = encodeK(text, { version: spec.version, eccLevel: level });
        } catch {
          continue; // 용량 초과
        }
        let match = 0;
        let total = 0;
        for (const cell of expect) {
          const placed = encoded.cellDigits.get(key(cell));
          if (!placed) continue;
          const got = digitToRanks(placed.digit);
          const want = digitToRanks(cell.digit);
          for (const face of ['T', 'L', 'R']) {
            total += 1;
            if (got[face] === want[face]) match += 1;
          }
        }
        const agreement = match / total;
        assert.ok(agreement < MARKER_AGREEMENT_FLOOR,
          `평 K ${spec.name}/${level} 이 마커 하한을 넘겼다: ${agreement}`);
        if (agreement > worst) worst = agreement;
      }
    }
  }
  // K-CM 프레임은 정의상 1.0 이다 — 두 값 사이가 «유/무 구분» 의 여유다.
  assert.ok(worst < 0.6, `평 K 최고 agreement ${worst} — 여유가 예상보다 작다`);
});

test('패치 레퍼런스 재배치 — 개수 유지 · 마커/꼭짓점앵커 무겹침 · 전부 패치 위', () => {
  for (const k of KS) {
    const refs = patchReferenceCellsKMarker(k);
    assert.equal(refs.length, patchReferenceRings(k).length * 6, `k=${k} 개수`);
    const keys = new Set(refs.map(key));
    assert.equal(keys.size, refs.length, '중복');
    const marker = markerPositionSetK(k);
    const vertices = vertexAnchorPositionSetK(k);
    for (const c of refs) {
      assert.ok(!marker.has(key(c)), `${key(c)} 이 마커와 겹친다`);
      assert.ok(!vertices.has(key(c)), `${key(c)} 이 꼭짓점 앵커와 겹친다`);
      assert.notEqual(patchOfK(c.q, c.r, k), null, `${key(c)} 이 패치 밖`);
    }
    // 마커가 안 먹은 자리는 평 K 좌표 그대로다 — 재배치는 «막힌 만큼만» 이다.
    const plain = patchReferenceCellsK(k);
    const plainKeys = new Set(plain.map(key));
    const moved = refs.filter((c) => !plainKeys.has(key(c)));
    const eaten = plain.filter((c) => marker.has(key(c)));
    assert.equal(moved.length, eaten.length,
      `k=${k}: 옮긴 셀 ${moved.length} 이 마커가 먹은 셀 ${eaten.length} 과 다르다`);
  }
});

test('회계 — 데이터 셀이 정확히 27 줄고 scan order 가 그 값과 맞는다', () => {
  assert.equal(MARKER_OVERHEAD_ADDED_K, MARKER_CELL_COUNT_K - 3);
  for (const spec of VERSIONS_KCM) {
    const plain = VERSIONS_K.find((entry) => entry.version === spec.version);
    assert.equal(spec.overhead, plain.overhead + MARKER_OVERHEAD_ADDED_K, spec.name);
    const scan = dataCellsInScanOrderKMarker(spec.k);
    assert.equal(scan.length, dataCellsInScanOrderK(spec.k).length - MARKER_OVERHEAD_ADDED_K);
    assert.equal(new Set(scan.map(key)).size, scan.length, '중복');
    const marker = markerPositionSetK(spec.k);
    const sets = buildRoleSetsKMarker(spec.k);
    for (const c of scan) {
      assert.ok(!marker.has(key(c)), `scan 에 마커 셀 ${key(c)}`);
      assert.equal(roleOfKMarker(c.q, c.r, spec.k, sets), 'data', key(c));
    }
    // 앵커 집합은 평 K 와 **바이트 동일** — «한 번만 센다» 의 코드측 근거.
    assert.deepEqual([...sets.anchor].sort(), [...buildRoleSetsK(spec.k).anchor].sort());
    // 영역 전수 = 역할 분할의 합 (빠지거나 겹치는 셀이 없다).
    const counts = {};
    for (const c of regionCellsK(spec.k)) {
      const role = roleOfKMarker(c.q, c.r, spec.k, sets);
      counts[role] = (counts[role] || 0) + 1;
    }
    assert.equal(counts.data, scan.length);
    assert.equal(counts.marker, MARKER_CELL_COUNT_K - 3, '꼭짓점 3셀은 anchor 로 센다');
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(total, 6 * spec.k * spec.k + 6 * spec.k + 1);
    // 필러는 scan 꼬리다.
    const filler = fillerCellsKMarker(spec.k);
    assert.equal(filler.length, scan.length % 3);
    assert.deepEqual(filler.map(key), scan.slice(scan.length - filler.length).map(key));
  }
});

test('용량표 — 확정값 · 전 조합 청크 정렬 · 버전 선택', () => {
  const EXPECT = {
    K0CM: { k: 6, overhead: 90, C: 163, S: 54, resid: 1, payload: { L: 45, M: 36, H: 29 } },
    K1CM: { k: 8, overhead: 94, C: 339, S: 113, resid: 0, payload: { L: 94, M: 80, H: 64 } },
    K2CM: { k: 10, overhead: 104, C: 557, S: 185, resid: 2, payload: { L: 156, M: 132, H: 106 } },
  };
  assert.equal(capacityTableKMarker('M').length, 3);
  for (const spec of VERSIONS_KCM) {
    const want = EXPECT[spec.name];
    assert.ok(want, spec.name);
    assert.equal(spec.k, want.k);
    assert.equal(spec.overhead, want.overhead);
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForKMarker(spec, level);
      assert.equal(cap.dataCells, want.C, `${spec.name} C`);
      assert.equal(cap.usedSymbols, want.S, `${spec.name} S`);
      assert.equal(cap.residualCells, want.resid, `${spec.name} 잔여`);
      assert.equal(cap.maxPayloadBytes, want.payload[level], `${spec.name}/${level} 순 페이로드`);
      assert.equal(cap.chunkAligned, true, `${spec.name}/${level} 청크 정렬`);
      assert.equal(cap.cornerMarker, true);
      // NSYM 절차 재검산 — capacityK 와 같은 공식이다 (대체 칸이 하나도 없다).
      let m = Math.round(0.25 * want.S);
      if (m % 2 === 0) m += 1;
      const proc = { L: Math.round(0.12 * want.S), M: m, H: Math.round(0.40 * want.S) };
      assert.equal(cap.nsym, proc[level], `${spec.name}/${level} 절차값`);
    }
    // K-CM 은 평 K 보다 반드시 용량이 작다 (마커가 27셀을 가져간다).
    const plain = VERSIONS_K.find((entry) => entry.version === spec.version);
    assert.ok(
      capacityForKMarker(spec, 'M').maxPayloadBytes < capacityForK(plain, 'M').maxPayloadBytes,
      `${spec.name} 순 페이로드가 평 ${plain.name} 이상이다`,
    );
  }
  assert.equal(versionSpecKMarker(1).name, 'K1CM');
  assert.throws(() => versionSpecKMarker(9), RangeError);
  assert.equal(chooseVersionKMarker(1, 'M').name, 'K0CM');
  assert.equal(chooseVersionKMarker(37, 'M').name, 'K1CM');
  assert.equal(chooseVersionKMarker(81, 'M').name, 'K2CM');
  assert.throws(() => chooseVersionKMarker(1000, 'M'), RangeError);
});
