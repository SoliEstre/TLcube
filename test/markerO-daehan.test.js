/**
 * markerO-daehan.test.js — G(CM) × daehan 개방 자.
 *
 * G2~G4의 코너 tetrad와 daehan(원자·사괘 분해)을 함께 쓸 때 다음을 잠근다.
 *
 * ① 역할 집합은 서로소이고 합성 회계가 실측과 같다.
 * ② V*CMD는 별도 NSYM 행을 쓰되 V*CM formatIndex를 공유한다.
 * ③ 양방향 CM↔CMD 오독은 전 k·전 ECC에서 거절된다.
 * ④ 원자 daehan과 사괘 분해 모두 digit·프런트엔드 왕복이 선다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { decodeCells } from '../src/decode.js';
import { decode as decodeFormatInfo } from '../src/formatinfo.js';
import {
  markerCells,
  formatCellsOMarker,
  referenceCellsOMarker,
  dataCellsInScanOrderOMarker,
} from '../src/markerO.js';
import {
  VERSIONS_OCM_DAEHAN,
  capacityForOMarkerDaehan,
  daehanReservedCellsOMarker,
  dataCellsInScanOrderOMarkerDaehan,
  fillerCellsOMarkerDaehan,
  overheadBreakdownOMarkerDaehan,
} from '../src/markerOdaehan.js';
import { NSYM_TABLE_OCM_DAEHAN } from '../src/rs211.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCellFinders } from '../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { FINDER_CELL_MASK_PATTERNS } from '../src/finder-patterns.js';
import {
  OAK_FINDER_PATTERNS, OAK_RENDER_ONLY_FINDER_PATTERNS,
} from '../src/finder-oak-patterns.js';

const LEVELS = Object.freeze(['L', 'M', 'H']);
const key = (cell) => `${cell.q},${cell.r}`;
const preset = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: preset.background,
  levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const DECOMPOSED_CENTRAL = 'oak-aspirin';
const DECOMPOSED_LINEUP = Object.freeze([
  ...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, ...OAK_RENDER_ONLY_FINDER_PATTERNS,
]);

const EXPECT = Object.freeze({
  V2CMD: Object.freeze({
    k: 8, formatIndex: 0, overhead: 98, dataCells: 119, symbols: 39, residual: 2,
    nsym: Object.freeze({ L: 5, M: 11, H: 16 }),
    payload: Object.freeze({ L: 31, M: 26, H: 21 }),
  }),
  V3CMD: Object.freeze({
    k: 10, formatIndex: 1, overhead: 122, dataCells: 209, symbols: 69, residual: 2,
    nsym: Object.freeze({ L: 8, M: 17, H: 28 }),
    payload: Object.freeze({ L: 57, M: 49, H: 38 }),
  }),
  V4CMD: Object.freeze({
    k: 12, formatIndex: 0, overhead: 126, dataCells: 343, symbols: 114, residual: 1,
    nsym: Object.freeze({ L: 14, M: 31, H: 46 }),
    payload: Object.freeze({ L: 95, M: 79, H: 64 }),
  }),
});

function formatIndexOf(encoded) {
  const digits = Array.from(encoded.formatDigits);
  const result = decodeFormatInfo([digits.slice(0, 5), digits.slice(5, 10), digits.slice(10, 15)]);
  assert.equal(result.ok, true, '포맷 워드가 복호되지 않는다');
  return result.version;
}

function digitsOf(encoded, scan) {
  return Uint8Array.from(scan.map((cell) => {
    const entry = encoded.cellDigits.get(key(cell));
    assert.ok(entry, `데이터 scan 셀에 digit이 없다: ${key(cell)}`);
    return entry.digit;
  }));
}

function textAtCapacity(capacity) {
  return 'G'.repeat(capacity.maxPayloadBytes);
}

function decomposedCentralEvidence(raster) {
  const luma = toRelativeLuminance(raster, {});
  const detected = detectCellFinders(luma, DECOMPOSED_LINEUP, {
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
  });
  assert.equal(detected.ok, true, '분해 장면에서 중앙 cell-mask를 찾지 못했다');
  const finder = detected.candidates.find((candidate) => candidate.patternId === DECOMPOSED_CENTRAL);
  assert.ok(finder, '원자 daehan을 제외한 명부에서 분해 중앙 증거가 없다');
  return finder;
}

test('① 기하·회계 — G2~G4 tetrad/format/reference와 daehan 예약은 모두 서로소', () => {
  assert.deepEqual(VERSIONS_OCM_DAEHAN.map((spec) => spec.name), ['V2CMD', 'V3CMD', 'V4CMD']);
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const want = EXPECT[spec.name];
    const reserved = daehanReservedCellsOMarker(spec.k);
    const reservedSet = new Set(reserved.map(key));
    for (const [label, cells] of [
      ['tetrad', markerCells(spec.k)],
      ['format', formatCellsOMarker(spec.k)],
      ['reference', referenceCellsOMarker(spec.k)],
    ]) {
      assert.equal(cells.some((cell) => reservedSet.has(key(cell))), false,
        `${spec.name}: ${label} × daehan 충돌`);
    }
    const cmScan = dataCellsInScanOrderOMarker(spec.k);
    const combined = dataCellsInScanOrderOMarkerDaehan(spec.k);
    assert.equal(combined.length, cmScan.length - reserved.length, `${spec.name}: scan 차감`);
    assert.equal(new Set(combined.map(key)).size, combined.length, `${spec.name}: 중복 scan`);

    const overhead = overheadBreakdownOMarkerDaehan(spec.k);
    assert.equal(overhead.total, want.overhead);
    assert.equal(combined.length, want.dataCells);
    assert.equal(fillerCellsOMarkerDaehan(spec.k).length, want.residual);
  }
});

test('② 회계·와이어 — V*CMD 신규 NSYM, V*CM formatIndex 공유, 청킹 정합', () => {
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const want = EXPECT[spec.name];
    assert.deepEqual({ ...NSYM_TABLE_OCM_DAEHAN[spec.symbolKey] }, {
      symbols: want.symbols, ...want.nsym,
    }, spec.name);
    for (const level of LEVELS) {
      const cap = capacityForOMarkerDaehan(spec, level);
      assert.equal(cap.overhead, want.overhead);
      assert.equal(cap.dataCells, want.dataCells);
      assert.equal(cap.usedSymbols, want.symbols);
      assert.equal(cap.residualCells, want.residual);
      assert.equal(cap.nsym, want.nsym[level]);
      assert.equal(cap.maxPayloadBytes, want.payload[level]);
    }
    const marked = encode('wire', {
      version: spec.version, eccLevel: 'M', cornerMarker: true, daehanFinder: true,
    });
    assert.equal(marked.capacity.name, spec.name);
    assert.equal(formatIndexOf(marked), spec.formatIndex,
      `${spec.name}: V*CM 와이어를 공유하지 않는다`);
  }
  assert.throws(
    () => encode('g1은 아직 닫힘', { version: 1, cornerMarker: true, daehanFinder: true }),
    /알 수 없는 버전/,
  );
});

test('③ direct 왕복 — 원자 daehan·사괘 분해 × G2~G4 × 전 ECC × 경계 payload', () => {
  for (const spec of VERSIONS_OCM_DAEHAN) {
    for (const level of LEVELS) {
      const capacity = capacityForOMarkerDaehan(spec, level);
      for (const option of [{ daehanFinder: true }, { sagoae: true }]) {
        for (const text of ['', 'CMD', textAtCapacity(capacity)]) {
          const encoded = encode(text, {
            version: spec.version, eccLevel: level, cornerMarker: true, ...option,
          });
          assert.equal(encoded.daehanFinder, true);
          assert.equal(encoded.cornerMarker, true);
          const digits = digitsOf(encoded, dataCellsInScanOrderOMarkerDaehan(spec.k));
          const decoded = decodeCells(digits, {
            type: 'O', version: spec.version, k: spec.k, formatIndex: spec.formatIndex,
            eccLevel: level, cornerMarker: true, daehanFinder: true,
          });
          assert.equal(decoded.ok, true, `${spec.name}/${level}/${JSON.stringify(option)}: ${decoded.reason}`);
          assert.equal(decoded.text, text);
        }
      }
    }
  }
});

test('④ 상호 오독 전수 — CMD 모양과 평 CM 회계는 k·쓰기ECC·읽기ECC 54건 모두 거절', () => {
  let rejected = 0;
  for (const spec of VERSIONS_OCM_DAEHAN) {
    for (const writeLevel of LEVELS) {
      const cmd = encode('CMD-misread', {
        version: spec.version, eccLevel: writeLevel, cornerMarker: true, daehanFinder: true,
      });
      const cm = encode('CM-misread', {
        version: spec.version, eccLevel: writeLevel, cornerMarker: true,
      });
      const cmdDigits = digitsOf(cmd, dataCellsInScanOrderOMarkerDaehan(spec.k));
      const cmDigits = digitsOf(cm, dataCellsInScanOrderOMarker(spec.k));
      for (const readLevel of LEVELS) {
        const asCm = decodeCells(cmdDigits, {
          type: 'O', version: spec.version, k: spec.k, formatIndex: spec.formatIndex,
          eccLevel: readLevel, cornerMarker: true,
        });
        assert.equal(asCm.ok, false, `${spec.name}: CMD(${writeLevel}) -> CM(${readLevel}) 오수용`);
        rejected += 1;
        const asCmd = decodeCells(cmDigits, {
          type: 'O', version: spec.version, k: spec.k, formatIndex: spec.formatIndex,
          eccLevel: readLevel, cornerMarker: true, daehanFinder: true,
        });
        assert.equal(asCmd.ok, false, `${spec.name}: CM(${writeLevel}) -> CMD(${readLevel}) 오수용`);
        rejected += 1;
      }
    }
  }
  assert.equal(rejected, 54);
});

test('⑤ 프런트엔드 왕복 — 원자 daehan × G2~G4', () => {
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const text = `atomic-G${spec.version}`;
    const encoded = encode(text, {
      version: spec.version, eccLevel: 'M', cornerMarker: true, daehanFinder: true,
    });
    const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: daehanPatternId(spec.k) });
    const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 2 });
    const decoded = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
    assert.equal(decoded.ok, true, `${spec.name}: ${decoded.reason}`);
    assert.equal(decoded.text, text);
  }
});

test('⑥ 프런트엔드 왕복 — 사괘 분해 × G2~G4', () => {
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const text = `split-G${spec.version}`;
    const encoded = encode(text, {
      version: spec.version, eccLevel: 'M', cornerMarker: true, sagoae: true,
    });
    const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: DECOMPOSED_CENTRAL });
    const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 2 });
    const central = decomposedCentralEvidence(raster);
    const decoded = decodeFrontend(raster, {
      familyEvidence: { finders: [central] },
      bootstrap: { cellFinderDaehan: true },
    });
    assert.equal(decoded.ok, true, `${spec.name}: ${decoded.reason}`);
    assert.equal(decoded.text, text);
    assert.match(decoded.hypothesis.id, /-sagoae$/, `${spec.name}: 사괘 검증 경로가 아니다`);
  }
});
