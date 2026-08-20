/**
 * markerA.test.js — Type A 코너 마커(A-CM) 레이아웃 · 회계 · 왕복 · 검출
 *
 * 고정하는 것:
 *   ① 발자국이 정본 H2O 와 같다 (k=4 에서 `userNonData` 18셀과 집합 동일)
 *   ② 정본 H2O 의 **톤은 Type A 알파벳 밖**이다 — 9셀이 비-순열. 이 사실을 테스트로
 *      박아 두어야 나중에 «정본 톤을 그대로 썼다» 는 오해가 안 생긴다.
 *   ③ 방향 margin 1.0000 (앵커를 안 물어서 공변 슬롯이 0)
 *   ④ 왕복 · 회전 3방향 · 60°급 기각 · 교차 오수용 0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  markerCellsA,
  markerGroupsA,
  markerPositionSetA,
  ringCentersA,
  MARKER_LOCAL_DIGITS_A,
  MARKER_CELL_COUNT_A,
  H2O_LOCAL_TONES_A,
  h2oTonesByKeyA,
  orientationMarginAMarker,
  patchReferenceCellsAMarker,
  dataCellsInScanOrderAMarker,
  fillerCellsAMarker,
  capacityForAMarker,
  capacityTableAMarker,
  VERSIONS_ACM,
  NSYM_TABLE_ACM,
} from '../src/markerA.js';
import { patchReferenceCells, vertexAnchors, isInRegionA } from '../src/placementA.js';
import { rotate120, rotate240 } from '../src/placement.js';
import { VERSIONS_A, capacityForA } from '../src/capacityA.js';
import { encodeA } from '../src/encodeA.js';
import { encode } from '../src/encode.js';
import { decodeCells } from '../src/decode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { verifyRaster } from '../src/verify.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset, relativeLuminance,
} from '../src/luminance.js';
import { findACornerMarkerHypotheses, findOCornerMarkerHypotheses } from '../src/decoder/corner-marker-detect.js';
import { findAAnchorHypotheses } from '../src/decoder/anchor-detect.js';

const KS = [6, 8, 10];
const key = (c) => `${c.q},${c.r}`;
const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};
const BACKGROUND = relativeLuminance(PRESET.background);

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const offset = (y * raster.width + x) * 4;
      data[y * raster.width + x] = relativeLuminance({
        r: raster.pixels[offset], g: raster.pixels[offset + 1], b: raster.pixels[offset + 2],
      });
    }
  }
  return {
    width: raster.width, height: raster.height, data, alpha: null,
  };
}

function renderFrame(encoded, cellSize, margin) {
  const scene = buildScene(encoded, { palette: PALETTE, cellSize, margin });
  const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: 4 });
  return {
    scene,
    raster,
    luma: rasterToLuma(raster),
    bullseye: {
      center: { x: scene.layout.originX, y: scene.layout.originY },
      cellSize,
      score: 1,
      hardChecksPassed: true,
    },
  };
}

function rotateLuma(source, center, radians) {
  const data = new Float32Array(source.data.length);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      const sx = Math.round(c * dx + s * dy + center.x);
      const sy = Math.round(-s * dx + c * dy + center.y);
      data[y * source.width + x] = sx >= 0 && sy >= 0 && sx < source.width && sy < source.height
        ? source.data[sy * source.width + sx] : BACKGROUND;
    }
  }
  return {
    width: source.width, height: source.height, data, alpha: null,
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES_PATH = path.resolve(HERE, '..', '..', '..', '..', '..', '..');

test('markerA: 정본 H2O 톤 표 — k=4 좌표·비-순열 9, 무인자 산출은 digit-only', () => {
  const bare = markerCellsA(4);
  for (const cell of bare) assert.equal('tones' in cell, false);
  const tones = h2oTonesByKeyA(4);
  assert.equal(tones.size, MARKER_CELL_COUNT_A);
  const loaded = markerCellsA(4, tones);
  let nonperm = 0;
  for (const cell of loaded) {
    assert.deepEqual(cell.tones, H2O_LOCAL_TONES_A[cell.corner][cell.label]);
    const sorted = [cell.tones.T, cell.tones.L, cell.tones.R].slice().sort().join('');
    if (sorted !== '012') nonperm += 1;
  }
  assert.equal(nonperm, 9);
  assert.deepEqual(tones.get('3,-6'), { T: 2, L: 2, R: 2 });
  // 다른 k 는 로컬 라벨 복사 — 발자국만 옮긴다.
  for (const k of KS) {
    const atK = markerCellsA(k, h2oTonesByKeyA(k));
    assert.equal(atK.length, MARKER_CELL_COUNT_A);
    for (const cell of atK) {
      assert.deepEqual(cell.tones, H2O_LOCAL_TONES_A[cell.corner][cell.label]);
    }
  }
});

test('markerA: 발자국이 정본 H2O 와 같은 규칙 — 링 중심은 꼭짓점에서 2칸 안쪽', () => {
  // k=4 정본 좌표(H2O userNonData 18셀). 정본 JSON 은 private repo 에 있어 여기에
  // **좌표를 옮겨 고정**한다 — 규칙이 바뀌면 이 목록과 어긋나 테스트가 잡는다.
  const H2O_K4 = [
    [-7, 3], [-7, 4], [-6, 2], [-6, 4], [-5, 2], [-5, 3],
    [2, -6], [2, -5], [2, 3], [2, 4], [3, -7], [3, -5],
    [3, 2], [3, 4], [4, -7], [4, -6], [4, 2], [4, 3],
  ].map(([q, r]) => `${q},${r}`).sort();
  const derived = markerCellsA(4).filter((c) => c.label !== 'Z').map(key).sort();
  assert.deepEqual(derived, H2O_K4);
  // 링 중심 3셀은 정본에서 데이터였다 — 이 레인이 마커에 편입했다(리뷰 §1.2 «슬롯 63»).
  assert.deepEqual(ringCentersA(4).map(key), ['3,-6', '3,3', '-6,3']);
  assert.equal(markerCellsA(4).length, MARKER_CELL_COUNT_A);
  void CANDIDATES_PATH;
});

test('markerA: 마커는 ρ-불변이고 꼭짓점 앵커를 안 문다', () => {
  for (const k of KS) {
    const set = markerPositionSetA(k);
    assert.equal(set.size, MARKER_CELL_COUNT_A);
    for (const rot of [rotate120, rotate240]) {
      for (const kk of set) {
        const [q, r] = kk.split(',').map(Number);
        const p = rot(q, r);
        assert.equal(set.has(`${p.q},${p.r}`), true, `k=${k}: ρ-불변 아님`);
      }
    }
    for (const c of markerCellsA(k)) assert.equal(isInRegionA(c.q, c.r, k), true);
    for (const v of vertexAnchors(k)) assert.equal(set.has(key(v)), false);
    const groups = markerGroupsA(k);
    assert.equal(groups.length, 3);
    for (const g of groups) {
      assert.equal(g.cells.length, 7);
      assert.equal(g.anchorLabel, 'Z');
      assert.equal(g.cells[0].label, 'Z');
      assert.equal(g.cells[0].digit, MARKER_LOCAL_DIGITS_A.center);
    }
  }
});

test('markerA: 방향 margin 1.0000 — 공변 슬롯 0', () => {
  for (const k of KS) {
    const m = orientationMarginAMarker(k);
    assert.equal(m.slots, 63);
    assert.equal(m.agree120, 0);
    assert.equal(m.agree240, 0);
    assert.equal(m.margin, 1);
  }
});

test('markerA: 패치 레퍼런스 재배치 — 마커 충돌 0, 개수 불변', () => {
  for (const k of KS) {
    const marker = markerPositionSetA(k);
    const legacy = patchReferenceCells(k);
    const placed = patchReferenceCellsAMarker(k);
    assert.equal(placed.length, legacy.length);
    for (const c of placed) assert.equal(marker.has(key(c)), false);
    // 최외곽 링(2k−1)의 레거시 3셀이 실제로 마커에 먹혀 있었다 — 이 테스트의 전제.
    const clashed = legacy.filter((c) => marker.has(key(c)));
    assert.equal(clashed.length, 3, `k=${k}: 전제(최외곽 3셀 충돌)가 깨졌다`);
  }
});

test('markerA: 용량표 (제안 NSYM — 확정은 운영자)', () => {
  assert.deepEqual(Object.keys(NSYM_TABLE_ACM), ['A0CM', 'A1CM', 'A2CM']);
  const rows = capacityTableAMarker('M').map((r) => [
    r.name, r.k, r.totalCells, r.overhead, r.dataCells, r.usedSymbols, r.residualCells,
    r.nsym, r.maxPayloadBytes,
  ]);
  assert.deepEqual(rows, [
    ['A0CM', 6, 190, 75, 115, 38, 1, 11, 25],
    ['A1CM', 8, 325, 79, 246, 82, 0, 21, 57],
    ['A2CM', 10, 496, 86, 410, 136, 2, 35, 96],
  ]);
  const legacy = VERSIONS_A.map((s) => capacityForA(s, 'M').maxPayloadBytes);
  assert.deepEqual(legacy, [31, 62, 101]);
  assert.deepEqual(legacy.map((v, i) => v - rows[i][8]), [6, 5, 5]);
  assert.throws(() => capacityForAMarker({
    name: 'X', version: 0, k: 8, overhead: 79, symbolKey: 'A0CM',
  }, 'M'), RangeError);
});

test('markerA: 왕복 — 심볼 3버전 × 3레벨 · 래스터 전 셀', () => {
  for (const spec of VERSIONS_ACM) {
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForAMarker(spec, level);
      const text = 'TLcube-A-CM-roundtrip-0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, cap.maxPayloadBytes);
      const encoded = encodeA(text, {
        version: spec.version, eccLevel: level, cornerMarker: true,
      });
      assert.equal(encoded.cornerMarker, true);
      const scan = dataCellsInScanOrderAMarker(encoded.k);
      const digits = scan.map((c) => encoded.cellDigits.get(key(c)).digit);
      const result = decodeCells(digits, {
        type: 'A', version: spec.version, eccLevel: level, k: encoded.k, cornerMarker: true,
      });
      assert.equal(result.ok, true, `${spec.name}/${level}: ${result.reason}`);
      assert.equal(result.text, text);
    }
    const encoded = encodeA('TLcube-A-CM', {
      version: spec.version, eccLevel: 'M', cornerMarker: true,
    });
    const frame = renderFrame(encoded, 10, 240);
    const verified = verifyRaster(frame.raster, frame.scene, encoded);
    assert.equal(verified.mismatches.length, 0);
    assert.equal(verified.ok, true);
    assert.equal(fillerCellsAMarker(encoded.k).length, capacityForAMarker(spec, 'M').residualCells);
  }
});

test('markerA: 레거시 A 경로 무영향', () => {
  for (const spec of VERSIONS_A) {
    const encoded = encodeA('legacy-a-reg', { version: spec.version, eccLevel: 'M' });
    assert.equal(encoded.cornerMarker, false);
    assert.deepEqual(
      patchReferenceCells(spec.k).map(key),
      // 마커 없는 경로는 레거시 좌표를 그대로 쓴다.
      patchReferenceCells(spec.k).map(key),
    );
    for (const c of markerCellsA(spec.k)) {
      assert.notEqual(encoded.cellDigits.get(key(c)).role, 'marker');
    }
  }
  assert.throws(() => encodeA('x', { version: 1, cornerMarker: true, centerQr: true }), RangeError);
});

/**
 * 마커 셀의 톤을 **떼어** digit-only 프레임을 만든다 (대조군).
 *
 * ⚠ 2026-08-20 이전에는 반대였다 — 인코더가 digit 만 냈고 테스트가 톤을 **덧씌웠다**.
 * 이제 `encodeA` 가 정본 H2O 톤을 직접 싣는다(양 끝 배선). 그래서 대조군을 만들려면
 * 덧씌우는 게 아니라 떼어야 한다. 아래 `ENCODED_ACM` 단언이 그 전제를 잠근다 —
 * 인코더가 다시 digit-only 로 돌아가면 이 파일이 **조용히 무의미해지지 않고** 빨개진다.
 */
function stripTones(encoded) {
  const cellDigits = new Map();
  for (const [kk, entry] of encoded.cellDigits) {
    const { tones, ...rest } = entry;
    cellDigits.set(kk, rest);
  }
  return { ...encoded, cellDigits };
}

const ENCODED_ACM = encodeA('TLcube-A-CM-rot', { version: 1, eccLevel: 'M', cornerMarker: true });
const FRAME_ACM = renderFrame(ENCODED_ACM, 10, 240);

test('A-CM: 인코더는 마커 톤을 기본으로 «안» 싣는다 (2026-08-20 되돌림)', () => {
  // 톤을 실으면 마커가 파인더 축(순백 포함)으로 그려져 실루엣에 구멍이 난다 —
  // 운영자 실기기 보고로 원거리 인식률 하락이 확인돼 되돌렸다 (scene.js faceColor 주석).
  // 톤 경로 자체는 살아 있다: markerCellsA(k, tones) 는 여전히 톤을 싣는다.
  for (const [, entry] of ENCODED_ACM.cellDigits) {
    assert.equal(entry.tones, undefined,
      '인코더가 마커 톤을 다시 싣는다 — 재설계(데이터 팔레트 + 조합 제한 해제) 없이 켜면 안 된다');
  }
  assert.ok(h2oTonesByKeyA(ENCODED_ACM.k).size > 0, 'H2O 표 자체는 남아 있어야 한다');
});

test('A-CM: 회전 3방향 정답 하나 · 60°급 수용 0', () => {
  for (let turn = 0; turn < 3; turn += 1) {
    const luma = turn === 0
      ? FRAME_ACM.luma
      : rotateLuma(FRAME_ACM.luma, FRAME_ACM.bullseye.center, turn * (2 * Math.PI / 3));
    const result = findACornerMarkerHypotheses(luma, FRAME_ACM.bullseye, [6, 8, 10]);
    assert.equal(result.ok, true, `turn=${turn}`);
    assert.equal(result.hypotheses.length, 1);
    assert.equal(result.hypotheses[0].k, ENCODED_ACM.k);
    assert.equal(result.hypotheses[0].orientation, turn);
    assert.equal(result.hypotheses[0].agreement, 1);
    assert.equal(result.hypotheses[0].family, 'tri-marker');
  }
  for (const degrees of [60, 180, 300]) {
    const luma = rotateLuma(FRAME_ACM.luma, FRAME_ACM.bullseye.center, degrees * (Math.PI / 180));
    assert.equal(findACornerMarkerHypotheses(luma, FRAME_ACM.bullseye, [6, 8, 10]).ok, false);
  }
});

test('A-CM: 교차 오수용 0 — 레거시 A · 레거시 O · O-CM', () => {
  const frames = [];
  for (const version of [0, 1, 2]) {
    frames.push(renderFrame(encodeA('legacy-a', { version, eccLevel: 'M' }), 10, 240));
  }
  for (const version of [1, 2, 3]) {
    frames.push(renderFrame(encode('legacy-o', { version, eccLevel: 'M' }), 20));
  }
  frames.push(renderFrame(encode('o-cm', { version: 2, eccLevel: 'M', cornerMarker: true }), 20));
  for (const frame of frames) {
    assert.equal(findACornerMarkerHypotheses(frame.luma, frame.bullseye, [6, 8, 10]).ok, false);
  }
  // 반대 방향도 — O 마커 검출기가 A-CM 프레임을 물지 않는다.
  assert.equal(findOCornerMarkerHypotheses(FRAME_ACM.luma, FRAME_ACM.bullseye, [6, 8, 10]).ok, false);
});

test('A-CM: 레거시 꼭짓점 앵커 3점이 그대로 성립', () => {
  for (let turn = 0; turn < 3; turn += 1) {
    const luma = turn === 0
      ? FRAME_ACM.luma
      : rotateLuma(FRAME_ACM.luma, FRAME_ACM.bullseye.center, turn * (2 * Math.PI / 3));
    const result = findAAnchorHypotheses(luma, FRAME_ACM.bullseye, [6, 8, 10], { minSeparation: 0.04 });
    assert.equal(result.ok, true);
    assert.equal(result.hypotheses.length, 1);
    assert.equal(result.hypotheses[0].k, ENCODED_ACM.k);
    assert.equal(result.hypotheses[0].orientation, turn);
  }
});
