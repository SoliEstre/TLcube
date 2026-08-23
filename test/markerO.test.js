/**
 * markerO.test.js — Type O 코너 마커(O-CM) 레이아웃 · 회계 · 왕복
 *
 * 여기서 고정하는 것 넷:
 *   ① σ(물리 120° 회전의 digit 치환)가 `decoder/anchor-detect.js` 의 SIGMA_CW 와 같다
 *      — claude-oak-review.md §4-2 «회전 사상 KAT» 의 digit 층 실측이다.
 *   ② 마커 위치 집합의 대칭 성질 (120°/240° 불변 · 60°/180°/300° 겹침 0)
 *   ③ 방향 margin 0.9444 (앵커 digit 이 강제하는 2 슬롯만 공변)
 *   ④ 왕복 — 심볼(encode→decodeCells) · 래스터(scene→rasterize→verifyRaster)
 * 그리고 레거시 O 경로가 한 톨도 안 변했다는 회귀.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKER_LOCAL_DIGITS,
  markerCells,
  markerTetrads,
  markerPositionSet,
  tetradBase,
  rotateDigitCw,
  rotateDigitCcw,
  orientationMarginOMarker,
  overheadBreakdownOMarker,
  capacityForOMarker,
  capacityTableOMarker,
  VERSIONS_OCM,
  NSYM_TABLE_OCM,
  dataCellsInScanOrderOMarker,
  fillerCellsOMarker,
  formatCellsOMarker,
  referenceCellsOMarker,
  roleOfOMarker,
} from '../src/markerO.js';
import { anchorCells, rotate120, rotate240 } from '../src/placement.js';
import { physicalRotationSigma } from '../src/decoder/anchor-detect.js';
import { encode } from '../src/encode.js';
import { decodeCells } from '../src/decode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { verifyRaster } from '../src/verify.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset,
} from '../src/luminance.js';
import { capacityFor, VERSIONS } from '../src/capacity.js';
import { dataCellsInScanOrder } from '../src/layout.js';

const KS = [6, 8, 10];
const key = (c) => `${c.q},${c.r}`;
const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};

test('markerO: σ 는 anchor-detect 의 SIGMA_CW/CCW 와 같다 (회전 사상 digit KAT)', () => {
  const cw = [0, 1, 2, 3, 4, 5].map(rotateDigitCw);
  const ccw = [0, 1, 2, 3, 4, 5].map(rotateDigitCcw);
  assert.deepEqual(cw, physicalRotationSigma('cw'));
  assert.deepEqual(ccw, physicalRotationSigma('ccw'));
  assert.deepEqual(cw, [4, 5, 1, 0, 3, 2]);
  // 3-순환 · 고정점 없음.
  for (let d = 0; d < 6; d += 1) assert.equal(cw[cw[cw[d]]], d);
});

test('markerO: tetrad 는 ρ 궤도이고 코너 셀 A 는 레거시 앵커 그대로', () => {
  for (const k of KS) {
    const base = tetradBase(k);
    const tetrads = markerTetrads(k);
    assert.equal(tetrads.length, 3);
    const anchors = anchorCells(k);
    for (let m = 0; m < 3; m += 1) {
      const cells = tetrads[m].cells;
      assert.deepEqual(cells.map((c) => c.label), ['A', 'B', 'C', 'D']);
      const a = cells[0];
      assert.equal(a.role, 'anchor');
      assert.equal(a.q, anchors[m].q);
      assert.equal(a.r, anchors[m].r);
      assert.equal(a.digit, anchors[m].digit);
      for (const label of ['B', 'C', 'D']) {
        const cell = cells.find((c) => c.label === label);
        assert.equal(cell.role, 'marker');
        assert.equal(cell.digit, MARKER_LOCAL_DIGITS[label]);
        const expected = m === 0
          ? base[label]
          : (m === 1 ? rotate120(base[label].q, base[label].r) : rotate240(base[label].q, base[label].r));
        assert.equal(cell.q, expected.q);
        assert.equal(cell.r, expected.r);
      }
    }
    assert.equal(markerCells(k).length, 12);
  }
});

test('markerO: 마커 위치 집합 — 120/240 불변, 60/180/300 겹침 0', () => {
  const maps = {
    120: (q, r) => rotate120(q, r),
    240: (q, r) => rotate240(q, r),
    60: (q, r) => ({ q: -r, r: q + r }),
    180: (q, r) => ({ q: -q, r: -r }),
    300: (q, r) => ({ q: q + r, r: -q }),
  };
  for (const k of KS) {
    const set = markerPositionSet(k);
    assert.equal(set.size, 12);
    for (const [name, f] of Object.entries(maps)) {
      let hit = 0;
      for (const kk of set) {
        const [q, r] = kk.split(',').map(Number);
        const p = f(q, r);
        if (set.has(`${p.q},${p.r}`)) hit += 1;
      }
      const want = (name === '120' || name === '240') ? 12 : 0;
      assert.equal(hit, want, `k=${k} ${name}° 겹침 ${hit} !== ${want}`);
    }
  }
});

test('markerO: 방향 margin 0.9444 — 공변 슬롯은 앵커가 강제하는 2개뿐', () => {
  for (const k of KS) {
    const m = orientationMarginOMarker(k);
    assert.equal(m.slots, 36);
    assert.equal(m.agree120, 2);
    assert.equal(m.agree240, 2);
    assert.equal(Number(m.margin.toFixed(4)), 0.9444);
  }
});

test('markerO: 회계 — 오버헤드 분해와 총 셀 항등', () => {
  const expected = {
    6: {
      bullseye: 19, anchor: 3, marker: 9, format: 15, reference: 8, total: 54,
    },
    8: {
      bullseye: 19, anchor: 3, marker: 9, format: 15, reference: 12, total: 58,
    },
    10: {
      bullseye: 19, anchor: 3, marker: 9, format: 15, reference: 16, total: 62,
    },
  };
  for (const k of KS) {
    const ob = overheadBreakdownOMarker(k);
    assert.deepEqual(ob, { k, ...expected[k] });
    const total = 3 * k * k + 3 * k + 1;
    assert.equal(total, ob.total + dataCellsInScanOrderOMarker(k).length);
    // 역할 좌표 상호 배타.
    const seen = new Set();
    for (const c of [...markerCells(k), ...formatCellsOMarker(k), ...referenceCellsOMarker(k)]) {
      assert.equal(seen.has(key(c)), false, `k=${k} 역할 충돌 ${key(c)}`);
      seen.add(key(c));
    }
    // 마커 셀은 데이터 scan order 에 들지 않는다.
    const scan = new Set(dataCellsInScanOrderOMarker(k).map(key));
    for (const c of markerCells(k)) assert.equal(scan.has(key(c)), false);
    assert.equal(roleOfOMarker(0, 0, k), 'bullseye');
    assert.equal(roleOfOMarker(k, 0, k), 'anchor');
    assert.equal(roleOfOMarker(k, -1, k), 'marker');
  }
});

test('markerO: 용량표 (제안 NSYM — 확정은 운영자)', () => {
  assert.deepEqual(Object.keys(NSYM_TABLE_OCM), ['V1CM', 'V2CM', 'V3CM']);
  const rows = capacityTableOMarker('M').map((r) => [
    r.name, r.k, r.totalCells, r.overhead, r.dataCells, r.usedSymbols, r.residualCells,
    r.nsym, r.dataBytes, r.maxPayloadBytes,
  ]);
  assert.deepEqual(rows, [
    ['V1CM', 6, 127, 54, 73, 24, 1, 7, 16, 15],
    ['V2CM', 8, 217, 58, 159, 53, 0, 13, 38, 37],
    ['V3CM', 10, 331, 62, 269, 89, 2, 23, 63, 62],
  ]);
  // 마커 9셀의 대가 — 레거시 대비 순 페이로드 손실 (M).
  const legacy = VERSIONS.map((s) => capacityFor(s, 'M').maxPayloadBytes);
  const marker = VERSIONS_OCM.map((s) => capacityForOMarker(s, 'M').maxPayloadBytes);
  assert.deepEqual(legacy, [18, 39, 65]);
  assert.deepEqual(marker, [15, 37, 62]);
  assert.deepEqual(legacy.map((v, i) => v - marker[i]), [3, 2, 3]);
  // 표와 실계산이 어긋나면 조용히 맞추지 않는다.
  assert.throws(
    () => capacityForOMarker({
      name: 'X', version: 1, k: 8, overhead: 58, symbolKey: 'V1CM',
    }, 'M'),
    RangeError,
  );
});

test('markerO: 왕복 — 심볼(encode→decodeCells) 3버전 × 3레벨', () => {
  for (const spec of VERSIONS_OCM) {
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForOMarker(spec, level);
      const text = 'TLcube-O-CM-roundtrip-0123456789abcdefghijklmnop'.slice(0, cap.maxPayloadBytes);
      const encoded = encode(text, {
        version: spec.version, eccLevel: level, cornerMarker: true,
      });
      assert.equal(encoded.cornerMarker, true);
      assert.equal(encoded.k, spec.k);
      const scan = dataCellsInScanOrderOMarker(encoded.k);
      const digits = scan.map((c) => encoded.cellDigits.get(key(c)).digit);
      const result = decodeCells(digits, {
        type: 'O', version: spec.version, eccLevel: level, k: encoded.k, cornerMarker: true,
      });
      assert.equal(result.ok, true, `${spec.name}/${level}: ${result.reason}`);
      assert.equal(result.text, text);
    }
  }
});

test('markerO: 왕복 — 래스터 전 셀 (마커 9셀 포함)', () => {
  for (const spec of VERSIONS_OCM) {
    const encoded = encode('TLcube-O-CM', {
      version: spec.version, eccLevel: 'M', cornerMarker: true,
    });
    const scene = buildScene(encoded, { palette: PALETTE, cellSize: 20 });
    const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: 4 });
    const verified = verifyRaster(raster, scene, encoded);
    assert.equal(verified.mismatches.length, 0, `${spec.name}: ${JSON.stringify(verified.mismatches[0])}`);
    assert.equal(verified.ok, true);
    // 마커 셀이 실제로 렌더 대상에 들어 있다.
    for (const c of markerCells(encoded.k)) {
      assert.equal(encoded.cellDigits.get(key(c)).digit, c.digit);
    }
  }
});

test('markerO: 레거시 O 경로 무영향 — scan order·용량·셀 digit 회귀', () => {
  for (const spec of VERSIONS) {
    const legacyScan = dataCellsInScanOrder(spec.k).map(key);
    assert.equal(legacyScan.length, capacityFor(spec, 'M').dataCells);
    const encoded = encode('legacy-o-reg', { version: spec.version, eccLevel: 'M' });
    assert.equal(encoded.cornerMarker, false);
    assert.equal(encoded.cellDigits.size, capacityFor(spec, 'M').totalCells - 19);
    // 마커 좌표(B·C·D)는 레거시에서 여전히 데이터/레퍼런스다 — anchor 가 아니다.
    for (const c of markerCells(spec.k)) {
      if (c.role !== 'marker') continue;
      assert.notEqual(encoded.cellDigits.get(key(c)).role, 'marker');
    }
  }
});

test('markerO: cornerMarker 와 centerQr 동시 사용은 CMQ 인덱스로 개설됐다', () => {
  // **의도적 갱신 (C2a, 2026-08-23)**: 원판 «배치 검증 미실시 조합» 거부가 검증
  // 완료로 개설됐다 (markerG CMQ · 배치·왕복 = test/markerG-centerqr.test.js).
  const combo = encode('x', { version: 1, cornerMarker: true, centerQr: true, qrText: 'x' });
  assert.equal(combo.cornerMarker, true);
  assert.equal(combo.centerQr, true);
  assert.equal(combo.capacity.formatIndex, 13, 'V1CMQ 와이어 (markerG 표)');
  assert.throws(() => encode('x', { version: 1, cornerMarker: 'yes' }), TypeError);
});

test('markerO: 필러는 scan order 꼬리와 같은 셀', () => {
  for (const k of KS) {
    const scan = dataCellsInScanOrderOMarker(k);
    const filler = fillerCellsOMarker(k);
    assert.equal(filler.length, scan.length % 3);
    assert.deepEqual(filler.map(key), scan.slice(scan.length - filler.length).map(key));
  }
});
