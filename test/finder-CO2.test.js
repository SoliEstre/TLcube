/**
 * finder-CO2.test.js — CO2 파인더 (V-CM 자리의 기본 파인더, 운영자 작화 2026-08-24) 회귀.
 *
 * 값이 아니라 **규칙으로** 잰다 — 이 파일에 CO2 좌표 리터럴은 없다. 9셀 자리는 전부
 * `vertexAnchors` + `neighbors` 유도이고, 정본 JSON 은 그 유도를 «대조하는 자»로만 쓴다.
 *
 * 고정하는 것 (표 층):
 *   ① 정본 전사 — repo 사본 `test/output/lanes/finder-CO2.json` (편집기 v2 export
 *      바이트 동일 사본) → 유도 9셀과 좌표·톤 27면 전수 대조.
 *   ② 전 k 유도 — k=4(정본) + 6/8/10(발행)에서 마커 6·앵커 3 · 라벨 복사 규칙 성립.
 *   ③ 회계 불변 — 마커 6 ⊂ A-CM 21 · 앵커 3 = 꼭짓점 앵커 · V-CM 용량표 무변동.
 * 자리 층:
 *   ④ 렌더 적재 — V-CM 프레임에서 마커 6셀만 palette.levels 톤 (파인더 축 아님).
 *   ⑤ 중앙 파인더와 **직교** — 임의 중앙 파인더 6종에서 CO2 색이 바이트 동일.
 *      center-qr 만 서지 않고, 그 원인이 «자리의 와이어»(V-CMQ)임을 값으로 고정.
 *   ⑥ ⛔ 알려진 공백 — 앵커 톤(opt-in)을 실으면 digit 앵커 검출이 죽는다.
 *   ⑦ 옵션 가드 — co2AnchorTones 는 boolean · 자리 없이 못 켠다 · 기본 false.
 *   ⑧ A-CM 무회귀 — turnA=false 자리는 H2O 그대로 (톤 표 + 픽셀 sha256).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  CO2_NAME, CO2_LOCAL_TONES_V, CO2_LABELS, CO2_MARKER_LABELS, CO2_ANCHOR_LABEL,
  CO2_CELL_COUNT, CO2_ANCHOR_COUNT, CO2_MARKER_COUNT,
  co2CellsA, co2CellsTurnA, co2TonesByKeyTurnA, co2SeatMarkerCellsA, co2SeatAnchorCellsA,
} from '../src/finder-CO2.js';
import { vertexAnchors } from '../src/placementA.js';
import {
  markerCellsA, markerPositionSetA, VERSIONS_ACM, capacityForAMarker, h2oTonesByKeyA,
} from '../src/markerA.js';
import { VERSIONS_A } from '../src/capacityA.js';
import { bullseyeCellMasks } from '../src/cell-editor-core.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { FACES, facePolygon } from '../src/hexgrid.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const key = (c) => `${c.q},${c.r}`;
/** 정본 작화 k(4, 발행 버전 아님) + 발행 k — 표에서 유도한다. */
const KS = [4, ...VERSIONS_A.map((spec) => spec.k)];

function loadCanon() {
  return JSON.parse(readFileSync(
    new URL('./output/lanes/finder-CO2.json', import.meta.url), 'utf8',
  ));
}

test('① 정본 전사 — repo 사본 JSON 이 유도 9셀·27면과 전수 일치한다', () => {
  const json = loadCanon();
  assert.equal(json.k, 4, '정본은 k=4 export 다');
  assert.equal(json.type, 'V', '정본은 내부 타입 V(턴A) 작화다');
  assert.equal(json.name, CO2_NAME, '정본 이름이 CO2 가 아니다');
  assert.equal(json.finderStarter, 'bullseye', '중앙 기준선은 불스아이다 — 대체 금지');

  // 정본은 **턴A(이미지) 좌표계**다 — 유도 쪽도 같은 공간으로 맞춰 비교한다.
  const derived = co2CellsTurnA(json.k);
  assert.equal(derived.length, CO2_CELL_COUNT);

  // ⓐ 발자국: userNonData(6) = 유도 마커 6 · 나머지 3 = 꼭짓점 앵커.
  const canonDetector = new Set(json.userNonData.map(key));
  const derivedMarker = new Set(derived.filter((c) => c.role === 'marker').map(key));
  assert.deepEqual(derivedMarker, canonDetector,
    '유도 마커 6셀이 정본 userNonData 와 다르다');
  assert.equal(json.counts.detector, CO2_MARKER_COUNT,
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
  assert.equal(json.toneOverrides.length, CO2_CELL_COUNT * 3,
    '정본 toneOverrides 가 9셀 × 3면이 아니다 — 중간톤 폴백 규약이 끼어든다');
  assert.equal(canonTone.size, CO2_CELL_COUNT, '정본 톤이 닿는 셀 수가 9 가 아니다');

  const derivedTone = co2TonesByKeyTurnA(json.k);
  assert.deepEqual(new Set(derivedTone.keys()), new Set(canonTone.keys()),
    '톤 표 좌표가 정본과 다르다');
  for (const [kk, tones] of derivedTone) {
    assert.deepEqual({ ...tones }, canonTone.get(kk), kk + ' 전사 불일치');
  }

  // ⓒ 중앙 파인더와 직교 — 정본의 중앙 19셀 표현은 **기본 불스아이와 바이트 동일**이다.
  //    (새 중앙 디자인이 아니라는 뜻. finder-H 정본과 같은 성질 — CO2 는 자리 심볼이다.)
  assert.deepEqual(json.finderPattern.cellMasks, bullseyeCellMasks(),
    '정본 cellMasks 가 기본 불스아이와 다르다 — 새 중앙 파인더로 읽힐 자리다');
});

test('② 전 k 유도 — 마커 6·앵커 3 · 같은 (코너,라벨) 튜플 복사 + 심볼 성질', () => {
  for (const k of KS) {
    const cells = co2CellsA(k);
    assert.equal(cells.length, CO2_CELL_COUNT, 'k=' + k + ' 셀 수');
    assert.equal(cells.filter((c) => c.role === 'anchor').length, CO2_ANCHOR_COUNT, 'k=' + k + ' 앵커 수');
    assert.equal(cells.filter((c) => c.role === 'marker').length, CO2_MARKER_COUNT, 'k=' + k + ' 마커 수');
    for (const cell of cells) {
      // 규칙 그 자체: k 무관하게 같은 (코너, 라벨) → 같은 튜플.
      assert.deepEqual(cell.tones, CO2_LOCAL_TONES_V[cell.corner][cell.label],
        'k=' + k + ' ' + key(cell) + ' 이 로컬 라벨 복사 규칙과 다르다');
    }
    // 코너별로 라벨이 정확히 A·N0·N1 하나씩.
    for (const corner of [0, 1, 2]) {
      const labels = cells.filter((c) => c.corner === corner).map((c) => c.label).sort();
      assert.deepEqual(labels, [...CO2_LABELS].sort(), 'k=' + k + ' 코너 ' + corner + ' 라벨');
    }
  }
  // 심볼 성질 (값으로): 9셀 전부 비-순열 — 데이터 셀(순열 digit)이 못 만드는 무늬다.
  let nonPermutation = 0;
  const cornerTuples = [];
  for (const [corner, labels] of Object.entries(CO2_LOCAL_TONES_V)) {
    const parts = [];
    for (const label of CO2_LABELS) {
      const t = labels[label];
      if (new Set([t.T, t.L, t.R]).size < 3) nonPermutation += 1;
      parts.push(`${t.T}${t.L}${t.R}`);
    }
    cornerTuples.push(corner + ':' + parts.join('|'));
  }
  assert.equal(nonPermutation, CO2_CELL_COUNT, '비-순열 셀 수가 9(전부) 가 아니다');
  assert.equal(new Set(cornerTuples).size, 3, '세 코너 튜플이 서로 달라야 한다 (코너 구별)');
});

test('③ 회계 불변 — 마커 6 ⊂ A-CM 21 · 앵커 3 = 꼭짓점 · V-CM 용량표 무변동', () => {
  for (const k of KS) {
    const markerSet = markerPositionSetA(k);
    const vertexSet = new Set(vertexAnchors(k).map(key));
    for (const cell of co2CellsA(k)) {
      if (cell.role === 'marker') {
        assert.ok(markerSet.has(key(cell)),
          'k=' + k + ' 마커 셀 ' + key(cell) + ' 이 A-CM 21셀 밖이다 — 회계가 움직인다');
      } else {
        assert.ok(vertexSet.has(key(cell)),
          'k=' + k + ' 앵커 셀 ' + key(cell) + ' 이 꼭짓점 앵커가 아니다');
      }
    }
    // 자리 적재본: 좌표·digit 은 A-CM 그대로, tones 만 6셀에 붙는다.
    const seat = co2SeatMarkerCellsA(k);
    const base = markerCellsA(k);
    assert.equal(seat.length, base.length, 'k=' + k + ' 자리 적재본 셀 수');
    assert.deepEqual(
      seat.map((c) => [c.q, c.r, c.digit]),
      base.map((c) => [c.q, c.r, c.digit]),
      'k=' + k + ': 자리 적재본이 A-CM 좌표/digit 을 바꿨다',
    );
    assert.equal(seat.filter((c) => c.tones).length, CO2_MARKER_COUNT,
      'k=' + k + ': 톤 실린 마커 셀 수가 6 이 아니다');
    // 앵커 적재본은 digit 을 꼭짓점 앵커에서 그대로 물려받는다.
    const anchors = co2SeatAnchorCellsA(k);
    assert.equal(anchors.length, CO2_ANCHOR_COUNT);
    assert.deepEqual(
      anchors.map((c) => [c.q, c.r, c.digit]),
      vertexAnchors(k).map((c) => [c.q, c.r, c.digit]),
      'k=' + k + ': 앵커 적재본이 꼭짓점 앵커 digit 을 바꿨다',
    );
    assert.deepEqual(
      anchors.map((c) => c.tones),
      [0, 1, 2].map((corner) => CO2_LOCAL_TONES_V[corner][CO2_ANCHOR_LABEL]),
      'k=' + k + ': 앵커 톤이 코너별 로컬 표와 다르다',
    );
  }
  // V-CM 회계는 A-CM 표 그대로다 (CO2 는 셀을 새로 먹지 않는다).
  for (const spec of VERSIONS_ACM) {
    const cap = capacityForAMarker(spec, 'M');
    assert.equal(cap.overhead, spec.overhead,
      spec.name + ': 오버헤드가 움직였다 — CO2 편입이 회계를 건드렸다');
  }
  // 마커 라벨/앵커 라벨 분할이 표와 어긋나지 않는다 (사본 목록 부패 방지).
  assert.deepEqual(
    [CO2_ANCHOR_LABEL, ...CO2_MARKER_LABELS].sort(),
    [...CO2_LABELS].sort(),
    '앵커/마커 라벨 분할이 CO2_LABELS 와 다르다',
  );
});

// ─────────────────────────────────────────────────────────────────────────
// 렌더·직교·공백 (자리 층) — ④⑤⑥⑦⑧
// ─────────────────────────────────────────────────────────────────────────

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const sha256 = (raster) => createHash('sha256').update(raster.pixels).digest('hex');

function encodeVcm(version, extra = {}) {
  return encodeA('CO2-render', {
    version, eccLevel: 'M', turnA: true, cornerMarker: true, ...extra,
  });
}

/** CO2 마커 6셀 × 3면의 색을 cellDigits 순회 순서 그대로 뽑는다 (scene 계약 승계). */
function co2FaceColors(encoded, scene) {
  const wanted = new Set(co2CellsA(encoded.k)
    .filter((c) => c.role === 'marker').map(key));
  const out = [];
  let idx = 0;
  for (const [kk, entry] of encoded.cellDigits) {
    const [q, r] = kk.split(',').map(Number);
    for (const face of FACES) {
      const shape = scene.shapes[idx];
      if (wanted.has(kk)) {
        // 턴A 배치 사상 — 셀은 정립, 그리는 자리만 (−q,−r) (scene.js turnA 분기).
        assert.deepEqual(shape.points, facePolygon(-q, -r, face, scene.layout),
          kk + ':' + face + ' 폴리곤 어긋남 — 순회/사상 계약이 바뀌었나');
        out.push({ kk, face, color: shape.color, tone: entry.tones && entry.tones[face] });
      }
      idx += 1;
    }
  }
  return out;
}

test('④ 렌더 적재 — V-CM 프레임에서 CO2 마커 6셀만 palette.levels 톤으로 그려진다', () => {
  for (const version of [0, 1, 2]) {
    const encoded = encodeVcm(version);
    const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
    const faces = co2FaceColors(encoded, scene);
    assert.equal(faces.length, CO2_MARKER_COUNT * FACES.length,
      'V' + version + 'CM: CO2 면 수가 6셀 × 3면과 다르다 — 적재가 죽었거나 샜다');
    for (const f of faces) {
      assert.ok(f.tone === 0 || f.tone === 1 || f.tone === 2,
        f.kk + ':' + f.face + ' 에 톤이 안 실렸다');
      assert.deepEqual(f.color, PALETTE.levels[f.tone],
        f.kk + ':' + f.face + ' 색이 palette.levels[' + f.tone + '] 가 아니다');
      assert.notDeepEqual(f.color, PALETTE.bullseyeLight,
        f.kk + ':' + f.face + ' 가 파인더 축(순백)으로 그려졌다 — 실루엣이 깨진다');
    }
    // 톤이 실린 셀은 정확히 CO2 마커 6셀뿐이다 — 앵커는 기본 적재에서 제외(⑥ 공백).
    const toned = [...encoded.cellDigits.entries()].filter(([, v]) => v.tones).map(([kk]) => kk);
    assert.deepEqual(
      toned.sort(),
      co2CellsA(encoded.k).filter((c) => c.role === 'marker').map(key).sort(),
      'V' + version + 'CM: 톤 실린 셀이 CO2 마커 6셀과 다르다',
    );
    // 자리 21셀의 digit·역할은 A-CM 과 바이트 동일 (회계 불변의 인코더측 확인).
    const seatKeys = new Set(markerCellsA(encoded.k).map(key));
    for (const [kk, entry] of encoded.cellDigits) {
      if (entry.role === 'marker') assert.ok(seatKeys.has(kk), kk + ' 이 A-CM 자리 밖인데 marker 다');
    }
  }
});

test('⑤ 중앙 파인더와 직교 — 임의 중앙 파인더 × CO2 가 서고 CO2 색이 바이트 동일', () => {
  // 운영자 확정 2026-08-24 «중앙 파인더 관련 없음 — 모두 사용 가능».
  // CO2 는 자리(V-CM) 심볼이라 중앙 19셀 슬롯 축과 갈리지 않는다. 배타를 새로
  // 만들지 않았다는 것을 «조합이 실제로 선다» + «CO2 색이 안 움직인다» 로 잰다.
  const COMBOS = [
    { id: undefined, enc: {} }, // 기본(불스아이)
    { id: 'bullseye', enc: {} },
    { id: 'cube-bullseye', enc: {} },
    { id: 'central-cube-3tone', enc: {} },
    { id: 'pinwheel-c2-2-1100-cw', enc: {} }, // cell-mask 계열 — «임의» 의 실증
    { id: CENTRAL_V0_FINDER_PATTERN_ID, enc: { centralV0: true } },
  ];
  let baseline = null;
  for (const combo of COMBOS) {
    const encoded = encodeVcm(1, combo.enc);
    const scene = buildScene(encoded, {
      palette: PALETTE, margin: 20, ...(combo.id ? { finderPatternId: combo.id } : {}),
    });
    assert.ok(scene.shapes.length > 0, (combo.id ?? '기본') + ' × V-CM 렌더가 비었다');
    const signature = JSON.stringify(co2FaceColors(encoded, scene)
      .map((f) => [f.kk, f.face, f.color, f.tone]));
    if (baseline === null) baseline = signature;
    else {
      assert.equal(signature, baseline,
        (combo.id ?? '기본') + ': 중앙 파인더를 바꿨더니 CO2 색이 움직였다 — 직교가 깨졌다');
    }
  }
  // 표 층의 직교 — CO2 톤 표는 k 만의 함수다 (중앙 파인더 인자가 애초에 없다).
  // 그 주장을 두 갈래로 잰다: ① 시그니처에 k 말고 다른 인자가 없다 ② 같은 k 를
  // 두 번 물으면 바이트 동일이다(숨은 가변 상태 없음). ①이 없으면 주석은 주장이고
  // 단언은 자기 자신과의 비교에 그친다.
  assert.equal(co2TonesByKeyTurnA.length, 1,
    'co2TonesByKeyTurnA 가 k 외의 인자를 받는다 — 표 층 직교가 깨졌다');
  assert.equal(
    JSON.stringify([...co2TonesByKeyTurnA(8)]),
    JSON.stringify([...co2TonesByKeyTurnA(8)]),
  );

  // ⛔→✅ center-qr 도 V-CM 에서 **선다**. 이 레인은 V-CMQ 가 아직 닫혀 있던
  //    커밋에서 갈라져 나와 여기에 «막혀 있어야 한다» 는 구 락을 남겼는데, 그 락은
  //    이 테스트 머리의 운영자 확정(«중앙 파인더 관련 없음 — 모두 사용 가능»)과
  //    정면으로 모순이었다. 2026-08-24 V-CMQ 개설(V*CM 인덱스 공유)로 배타가
  //    사라졌으므로 구 락을 **양성 단언으로 전환**한다 (배타 개설 정형 ④).
  assert.doesNotThrow(
    () => encodeVcm(1, { centerQr: true }),
    'V-CM × centerQr 이 막혔다 — V-CMQ 는 V*CM 인덱스 공유로 열려 있다',
  );
  assert.doesNotThrow(
    () => encodeA('acmq', {
      version: 1, eccLevel: 'M', cornerMarker: true, centerQr: true,
    }),
    'A-CM × centerQr 이 막혔다 — center-qr 배타가 심볼 축으로 번졌다',
  );
});

test('⑥ ⛔ 알려진 공백 — CO2 앵커 톤(opt-in)의 벽은 «앵커» 가 아니라 «형식 정보» 다', () => {
  // 2026-08-25 풀링 수리 이후 **재측정** (원격 좌석, 페이로드 4 × 버전 3 × ppu 2 = 24칸).
  // 공백은 닫히지 않았다. 대신 **원인이 한 층 내려갔다** — 그게 이 락이 잡는 것이다.
  //
  //            수리 전            수리 후
  //   성공      2/24              2/24        ← 총합은 그대로
  //   no-anchors        20               7    ← 13칸이 여기서 빠져나갔고
  //   no-format-candidate 2             15    ← 그대로 여기 쌓였다
  //
  // 원인은 **페이로드가 아니라 버전으로 갈린다** (24칸 전수에서 재현):
  //   V0      → no-anchors            (8칸 중 7 — 앵커가 아직 굶는다)
  //   V1·V2   → no-format-candidate   (16칸 중 15 — 앵커는 섰다)
  //             진단: hypothesisCount ≥ 1 · formatProposalCount 0 · formatCandidateCount 0
  //             즉 «포즈는 섰는데 형식 정보를 못 읽는다».
  //   생존 2칸은 여전히 페이로드 의존이다 ('CO2-render' × V1 뿐) — «가끔 된다» 이지
  //   «된다» 가 아니다.
  //
  // ⚠ 이 formatProposalCount 0 서명은 **실기기 V-CM 실패와 같다** (2026-08-25 실사진
  //    12프레임: hypothesisCount 290~342 · formatProposalCount 0). 입력 조건은 다르지만
  //    (저쪽은 기본 경로, 여기는 앵커 톤 ON) 벽의 서명이 일치한다 — 실물 병목의
  //    **60초짜리 합성 재현**일 가능성이 높다. 다음 표적(포즈 정합 · F-108)의 입구다.
  const GAP_TEXT = 'TLcube';
  // 버전별 벽 — 격자 전수에서 나온 값이다. 바뀌면 «원인이 또 옮겨갔다» 는 뜻이니 터진다.
  const WALL_BY_VERSION = { 0: 'no-anchors', 1: 'no-format-candidate', 2: 'no-format-candidate' };
  const render12 = (encoded) => rasterize(
    buildScene(encoded, { palette: PALETTE, margin: 20 }),
    { pixelsPerUnit: 12, supersample: 1 },
  );
  const encodeGap = (version, extra) => encodeA(GAP_TEXT, {
    version, eccLevel: 'M', turnA: true, cornerMarker: true, ...extra,
  });
  for (const version of [0, 1, 2]) {
    // 대조군 — 기본 적재는 선다 (공백 잠금의 전제이자, 이 공백이 «앵커 톤» 축임을 가른다).
    const base = decodeFrontend(render12(encodeGap(version)));
    assert.equal(base.ok, true,
      'V' + version + 'CM 기본 왕복이 죽었다 — 공백 잠금의 전제 붕괴');

    const toned = decodeFrontend(render12(encodeGap(version, { co2AnchorTones: true })));
    assert.equal(toned.ok, false,
      'V' + version + 'CM: CO2 앵커 톤 검출이 서기 시작했다 — 이 단언을 뒤집고 '
      + 'co2AnchorTones 기본값 전환을 운영자와 논의하라 (한쪽만 켜면 효과가 음수다)');
    const code = typeof toned.reason === 'string' ? toned.reason : toned.reason?.code ?? '';
    assert.ok(String(code).includes(WALL_BY_VERSION[version]),
      'V' + version + 'CM: 벽이 옮겨갔다 — 기대 ' + WALL_BY_VERSION[version] + ' · 실제 ' + code
      + ' (원인이 바뀌었으면 격자를 다시 재고 이 표를 갱신하라)');

    // V1·V2 는 «포즈는 섰는데 형식 정보가 0» 이라는 서명까지 잠근다 — 실기기와 대조할 자다.
    // ⚠ 진단은 detail.cause.diagnostics 다 (detail 바로 밑 아님). 이 계열의 키를 두 번
    //    틀렸으니 값을 적기 전에 덤프부터 한다 — formatFailureSummary.counts 와 같은 함정.
    if (WALL_BY_VERSION[version] === 'no-format-candidate') {
      const cause = toned.detail?.cause ?? {};
      const diag = cause.diagnostics ?? {};
      assert.ok((diag.hypothesisCount ?? 0) >= 1,
        'V' + version + 'CM: 포즈 가설이 0 이다 — 벽이 형식 정보가 아니라 포즈로 되돌아갔다');
      assert.equal(diag.formatProposalCount, 0,
        'V' + version + 'CM: formatProposalCount 가 0 이 아니다 (' + diag.formatProposalCount
        + ') — 형식 정보가 읽히기 시작했다면 이 공백이 닫히는 중이다');
      // 지배 사유가 crc = «표본은 정상인데 CRC 가 전멸» = 틀린 포즈 신호. 실기기 V-CM
      // 실패의 지배 사유와 **같다**. 이게 바뀌면 두 현상이 갈라진 것이니 다시 이어야 한다.
      assert.equal(cause.formatFailureSummary?.dominant, 'crc',
        'V' + version + 'CM: 지배 사유가 crc 가 아니다 ('
        + cause.formatFailureSummary?.dominant + ') — 실기기 실패와의 서명 일치가 깨졌다');
    }
  }
});

test('⑦ 옵션 가드 — co2AnchorTones 는 boolean · 자리(V-CM) 없이 못 켠다 · 기본 false', () => {
  assert.throws(
    () => encodeA('TL', { version: 1, eccLevel: 'M', co2AnchorTones: true }),
    RangeError,
  );
  assert.throws(
    () => encodeA('TL', { version: 1, eccLevel: 'M', cornerMarker: true, co2AnchorTones: true }),
    RangeError,
    'turnA 없이(= A-CM 자리) 켜졌다 — CO2 는 V 자리 심볼이다',
  );
  assert.throws(
    () => encodeVcm(1, { co2AnchorTones: 1 }),
    TypeError,
  );
  assert.equal(encodeVcm(1).co2AnchorTones, false, '기본값이 false 가 아니다');
  assert.equal(encodeVcm(1, { co2AnchorTones: true }).co2AnchorTones, true);
});

test('⑧ A-CM 무회귀 — turnA=false 자리는 H2O 21셀 톤 그대로 (픽셀 바이트)', () => {
  // 이 레인은 A 경로 무접촉이어야 한다 — 자리의 기본 심볼을 turnA 로만 가른다.
  for (const spec of VERSIONS_ACM) {
    const encoded = encodeA('acm-pin', { version: spec.version, eccLevel: 'M', cornerMarker: true });
    const expected = h2oTonesByKeyA(encoded.k);
    const toned = [...encoded.cellDigits.entries()].filter(([, v]) => v.tones);
    assert.equal(toned.length, expected.size,
      spec.name + ': A-CM 톤 셀 수가 H2O 21 과 다르다 — CO2 가 A 경로로 샜다');
    for (const [kk, entry] of toned) {
      assert.deepEqual({ ...entry.tones }, { ...expected.get(kk) }, spec.name + ' ' + kk + ' 톤이 H2O 가 아니다');
    }
  }
  // 픽셀 고정 — finder-H.test ⑤ 와 같은 A0CM 기준값 (HEAD 실측 · 이 레인 무접촉).
  const scene = buildScene(
    encodeA('pin', { version: 0, eccLevel: 'M', cornerMarker: true }),
    { palette: PALETTE, cellSize: 8, margin: 80 },
  );
  assert.equal(
    sha256(rasterize(scene, { pixelsPerUnit: 1, supersample: 2 })),
    '108478c8aa81155e0602a33c94f3d8c3be01f65919da69879c8f2ffcefcd7c65',
    'A0CM 렌더가 움직였다 — CO2 편입이 A 경로를 건드렸다',
  );
});
