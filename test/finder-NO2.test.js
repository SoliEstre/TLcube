/**
 * finder-NO2.test.js — NO2 파인더 (V-CM 자리의 기본 파인더, 운영자 작화 2026-08-24) 회귀.
 *
 * 값이 아니라 **규칙으로** 잰다 — 이 파일에 NO2 좌표 리터럴은 없다. 9셀 자리는 전부
 * `vertexAnchors` + `neighbors` 유도이고, 정본 JSON 은 그 유도를 «대조하는 자»로만 쓴다.
 *
 * 고정하는 것 (표 층):
 *   ① 정본 전사 — repo 사본 `test/output/lanes/finder-NO2.json` (편집기 v2 export
 *      바이트 동일 사본) → 유도 9셀과 좌표·톤 27면 전수 대조.
 *   ② 전 k 유도 — k=4(정본) + 6/8/10(발행)에서 마커 6·앵커 3 · 라벨 복사 규칙 성립.
 *   ③ 회계 불변 — 마커 6 ⊂ A-CM 21 · 앵커 3 = 꼭짓점 앵커 · V-CM 용량표 무변동.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NO2_NAME, NO2_LOCAL_TONES_V, NO2_LABELS, NO2_MARKER_LABELS, NO2_ANCHOR_LABEL,
  NO2_CELL_COUNT, NO2_ANCHOR_COUNT, NO2_MARKER_COUNT,
  no2CellsA, no2CellsTurnA, no2TonesByKeyTurnA, no2SeatMarkerCellsA, no2SeatAnchorCellsA,
} from '../src/finder-NO2.js';
import { vertexAnchors } from '../src/placementA.js';
import {
  markerCellsA, markerPositionSetA, VERSIONS_ACM, capacityForAMarker,
} from '../src/markerA.js';
import { VERSIONS_A } from '../src/capacityA.js';
import { bullseyeCellMasks } from '../src/cell-editor-core.js';

const key = (c) => `${c.q},${c.r}`;
/** 정본 작화 k(4, 발행 버전 아님) + 발행 k — 표에서 유도한다. */
const KS = [4, ...VERSIONS_A.map((spec) => spec.k)];

function loadCanon() {
  return JSON.parse(readFileSync(
    new URL('./output/lanes/finder-NO2.json', import.meta.url), 'utf8',
  ));
}

test('① 정본 전사 — repo 사본 JSON 이 유도 9셀·27면과 전수 일치한다', () => {
  const json = loadCanon();
  assert.equal(json.k, 4, '정본은 k=4 export 다');
  assert.equal(json.type, 'V', '정본은 내부 타입 V(턴A) 작화다');
  assert.equal(json.name, NO2_NAME, '정본 이름이 NO2 가 아니다');
  assert.equal(json.finderStarter, 'bullseye', '중앙 기준선은 불스아이다 — 대체 금지');

  // 정본은 **턴A(이미지) 좌표계**다 — 유도 쪽도 같은 공간으로 맞춰 비교한다.
  const derived = no2CellsTurnA(json.k);
  assert.equal(derived.length, NO2_CELL_COUNT);

  // ⓐ 발자국: userNonData(6) = 유도 마커 6 · 나머지 3 = 꼭짓점 앵커.
  const canonDetector = new Set(json.userNonData.map(key));
  const derivedMarker = new Set(derived.filter((c) => c.role === 'marker').map(key));
  assert.deepEqual(derivedMarker, canonDetector,
    '유도 마커 6셀이 정본 userNonData 와 다르다');
  assert.equal(json.counts.detector, NO2_MARKER_COUNT,
    '정본 counts.detector 가 마커 6 과 다르다');

  const derivedAnchor = new Set(derived.filter((c) => c.role === 'anchor').map(key));
  const turnedVertices = new Set(vertexAnchors(json.k).map((c) => key({ q: -c.q, r: -c.r })));
  assert.deepEqual(derivedAnchor, turnedVertices,
    '유도 앵커 3셀이 V 꼭짓점 앵커(= A 앵커의 180° 상)와 다르다');

  // ⓑ 톤: toneOverrides 27항목이 정확히 9셀 × 3면을 덮고 값이 전수 일치한다.
  //     («없는 면 = 중간톤 1» 폴백을 쓰는 면이 0 이라는 것도 여기서 잠긴다.)
  const canonTone = new Map();
  for (const o of json.toneOverrides) {
    const kk = `${o.q},${o.r}`;
    if (!canonTone.has(kk)) canonTone.set(kk, {});
    canonTone.get(kk)[o.face] = o.tone;
  }
  assert.equal(json.toneOverrides.length, NO2_CELL_COUNT * 3,
    '정본 toneOverrides 가 9셀 × 3면이 아니다 — 중간톤 폴백 규약이 끼어든다');
  assert.equal(canonTone.size, NO2_CELL_COUNT, '정본 톤이 닿는 셀 수가 9 가 아니다');

  const derivedTone = no2TonesByKeyTurnA(json.k);
  assert.deepEqual(new Set(derivedTone.keys()), new Set(canonTone.keys()),
    '톤 표 좌표가 정본과 다르다');
  for (const [kk, tones] of derivedTone) {
    assert.deepEqual({ ...tones }, canonTone.get(kk), kk + ' 전사 불일치');
  }

  // ⓒ 중앙 파인더와 직교 — 정본의 중앙 19셀 표현은 **기본 불스아이와 바이트 동일**이다.
  //    (새 중앙 디자인이 아니라는 뜻. finder-H 정본과 같은 성질 — NO2 는 자리 심볼이다.)
  assert.deepEqual(json.finderPattern.cellMasks, bullseyeCellMasks(),
    '정본 cellMasks 가 기본 불스아이와 다르다 — 새 중앙 파인더로 읽힐 자리다');
});

test('② 전 k 유도 — 마커 6·앵커 3 · 같은 (코너,라벨) 튜플 복사 + 심볼 성질', () => {
  for (const k of KS) {
    const cells = no2CellsA(k);
    assert.equal(cells.length, NO2_CELL_COUNT, 'k=' + k + ' 셀 수');
    assert.equal(cells.filter((c) => c.role === 'anchor').length, NO2_ANCHOR_COUNT, 'k=' + k + ' 앵커 수');
    assert.equal(cells.filter((c) => c.role === 'marker').length, NO2_MARKER_COUNT, 'k=' + k + ' 마커 수');
    for (const cell of cells) {
      // 규칙 그 자체: k 무관하게 같은 (코너, 라벨) → 같은 튜플.
      assert.deepEqual(cell.tones, NO2_LOCAL_TONES_V[cell.corner][cell.label],
        'k=' + k + ' ' + key(cell) + ' 이 로컬 라벨 복사 규칙과 다르다');
    }
    // 코너별로 라벨이 정확히 A·N0·N1 하나씩.
    for (const corner of [0, 1, 2]) {
      const labels = cells.filter((c) => c.corner === corner).map((c) => c.label).sort();
      assert.deepEqual(labels, [...NO2_LABELS].sort(), 'k=' + k + ' 코너 ' + corner + ' 라벨');
    }
  }
  // 심볼 성질 (값으로): 9셀 전부 비-순열 — 데이터 셀(순열 digit)이 못 만드는 무늬다.
  let nonPermutation = 0;
  const cornerTuples = [];
  for (const [corner, labels] of Object.entries(NO2_LOCAL_TONES_V)) {
    const parts = [];
    for (const label of NO2_LABELS) {
      const t = labels[label];
      if (new Set([t.T, t.L, t.R]).size < 3) nonPermutation += 1;
      parts.push(`${t.T}${t.L}${t.R}`);
    }
    cornerTuples.push(corner + ':' + parts.join('|'));
  }
  assert.equal(nonPermutation, NO2_CELL_COUNT, '비-순열 셀 수가 9(전부) 가 아니다');
  assert.equal(new Set(cornerTuples).size, 3, '세 코너 튜플이 서로 달라야 한다 (코너 구별)');
});

test('③ 회계 불변 — 마커 6 ⊂ A-CM 21 · 앵커 3 = 꼭짓점 · V-CM 용량표 무변동', () => {
  for (const k of KS) {
    const markerSet = markerPositionSetA(k);
    const vertexSet = new Set(vertexAnchors(k).map(key));
    for (const cell of no2CellsA(k)) {
      if (cell.role === 'marker') {
        assert.ok(markerSet.has(key(cell)),
          'k=' + k + ' 마커 셀 ' + key(cell) + ' 이 A-CM 21셀 밖이다 — 회계가 움직인다');
      } else {
        assert.ok(vertexSet.has(key(cell)),
          'k=' + k + ' 앵커 셀 ' + key(cell) + ' 이 꼭짓점 앵커가 아니다');
      }
    }
    // 자리 적재본: 좌표·digit 은 A-CM 그대로, tones 만 6셀에 붙는다.
    const seat = no2SeatMarkerCellsA(k);
    const base = markerCellsA(k);
    assert.equal(seat.length, base.length, 'k=' + k + ' 자리 적재본 셀 수');
    assert.deepEqual(
      seat.map((c) => [c.q, c.r, c.digit]),
      base.map((c) => [c.q, c.r, c.digit]),
      'k=' + k + ': 자리 적재본이 A-CM 좌표/digit 을 바꿨다',
    );
    assert.equal(seat.filter((c) => c.tones).length, NO2_MARKER_COUNT,
      'k=' + k + ': 톤 실린 마커 셀 수가 6 이 아니다');
    // 앵커 적재본은 digit 을 꼭짓점 앵커에서 그대로 물려받는다.
    const anchors = no2SeatAnchorCellsA(k);
    assert.equal(anchors.length, NO2_ANCHOR_COUNT);
    assert.deepEqual(
      anchors.map((c) => [c.q, c.r, c.digit]),
      vertexAnchors(k).map((c) => [c.q, c.r, c.digit]),
      'k=' + k + ': 앵커 적재본이 꼭짓점 앵커 digit 을 바꿨다',
    );
    assert.deepEqual(
      anchors.map((c) => c.tones),
      [0, 1, 2].map((corner) => NO2_LOCAL_TONES_V[corner][NO2_ANCHOR_LABEL]),
      'k=' + k + ': 앵커 톤이 코너별 로컬 표와 다르다',
    );
  }
  // V-CM 회계는 A-CM 표 그대로다 (NO2 는 셀을 새로 먹지 않는다).
  for (const spec of VERSIONS_ACM) {
    const cap = capacityForAMarker(spec, 'M');
    assert.equal(cap.overhead, spec.overhead,
      spec.name + ': 오버헤드가 움직였다 — NO2 편입이 회계를 건드렸다');
  }
  // 마커 라벨/앵커 라벨 분할이 표와 어긋나지 않는다 (사본 목록 부패 방지).
  assert.deepEqual(
    [NO2_ANCHOR_LABEL, ...NO2_MARKER_LABELS].sort(),
    [...NO2_LABELS].sort(),
    '앵커/마커 라벨 분할이 NO2_LABELS 와 다르다',
  );
});
