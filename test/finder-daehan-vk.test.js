/**
 * finder-daehan-vk.test.js — daehan × V(턴A) · K 배타 개방 (2026-08-29, 브리프 C).
 *
 * 구 락 두 곳 — encodeA 의 «turnA × daehan/sagoae 배치 검증 미실시» throw,
 * encodeK 의 «daehan × K 배치 검증 미실시» throw — 을 배타 개설 정형 ④에 따라
 * 이 파일의 양성 단언으로 전환한다.
 *
 * 개설 근거 (전부 실측 — 값으로 잠근다):
 *   ① daehan 79셀 좌표 **집합이 180° 자기 대칭** (전 k 잘림본 포함). scene 은
 *      파인더·사괘를 제자리(절대 좌표)에 그리고 데이터만 (−q,−r) 로 돌리므로,
 *      이 대칭이 곧 «턴 프레임에서 파인더가 데이터를 덧칠하지 않는다» 의 증명이다.
 *   ② 사괘(예약 셀) ∩ V/K 의 모든 역할 셀 = 전 k 에서 0. PM/017 의 «사괘 ∩ O-CM
 *      k=6 4셀» 같은 조건부 충돌이 V-CM 마커 21·K-CM 마커 30 에는 **없다**.
 *   ③ 와이어: V×daehan 은 V 표(V0=2·V1=4·V2=0)를 그대로 공유(V*D — A*D 1·12·13
 *      과 값이 달라 모호성 없음), K×daehan 은 평 K 7 을 공유(광학+RS/CRC 계약 —
 *      O/A daehan 과 동일). 새 (값,k) 는 만들지 않았다.
 *
 * 왕복은 decodeCells/decodeCellsK 만이 아니라 decodeFrontend 다 (검출 손실 0 /
 * 왕복 실패 사고 — finder-daehan-a.test.js 와 같은 규율). daehan 검출은 여전히
 * `cellFinderDaehan` 옵트인 뒤다 — 기본 라인업 거절이 곧 오독 방지 자다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hexDistance } from '../src/hexgrid.js';
import {
  DAEHAN_RADII, DAEHAN_FINDER_CELLS, daehanFinderCellsFor, daehanReservedCells,
  daehanPatternId, taegeukCells,
} from '../src/finder-daehan.js';
import { centralSlotCells } from '../src/layout.js';
import { anchorCells, formatCells, referenceCellsAll } from '../src/placement.js';
import { vertexAnchors, patchReferenceCells } from '../src/placementA.js';
import { markerCellsA } from '../src/markerA.js';
import {
  vertexAnchorsK, invertedVertexAnchors, patchReferenceCellsK,
} from '../src/placementK.js';
import { markerCellsK } from '../src/markerK.js';
import { dataCellsInScanOrderA } from '../src/layoutA.js';
import { dataCellsInScanOrderK, fillerCellsK, layoutMapK } from '../src/layoutK.js';
import { VERSIONS_A_DAEHAN, capacityForADaehan } from '../src/capacityA.js';
import {
  VERSIONS_K, NSYM_TABLE_K, VERSIONS_K_DAEHAN, capacityForKDaehan, overheadBreakdownK,
} from '../src/capacityK.js';
import { TURN_A_FORMAT_INDEX, turnASpec } from '../src/turnA.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { decodeCells } from '../src/decode.js';
import { decodeCellsK } from '../src/decoder/decode-k.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const key = (c) => c.q + ',' + c.r;
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function intersect(cellsA, cellsB) {
  const set = new Set(cellsB.map(key));
  return cellsA.filter((c) => set.has(key(c)));
}

// ── 개설 근거 ① — 좌표 집합의 180° 자기 대칭 (V 개방의 하중 지지 성질) ─────────
test('daehan 좌표 집합은 자기 180° 상과 같다 — 전체·전 k 잘림본', () => {
  const image = (cells) => new Set(cells.map((c) => (-c.q) + ',' + (-c.r)));
  const same = (cells) => {
    const original = new Set(cells.map(key));
    const turned = image(cells);
    return original.size === turned.size && [...original].every((k) => turned.has(k));
  };
  assert.equal(same(DAEHAN_FINDER_CELLS), true, '전체 79셀이 180° 대칭이 아니다');
  for (const k of DAEHAN_RADII) {
    assert.equal(same(daehanFinderCellsFor(k)), true, 'k=' + k + ' 잘림본이 180° 대칭이 아니다');
    assert.equal(same(daehanReservedCells(k)), true, 'k=' + k + ' 사괘가 180° 대칭이 아니다');
  }
});

// ── 개설 근거 ② — 교집합 0 (V·K × 전 역할, 조건부 충돌 스윕 포함) ─────────────
test('사괘 ∩ V(턴A=A 정준 좌표) 역할 셀 = 전 k 에서 0 — V-CM 마커 조건부 스윕 포함', () => {
  for (const k of DAEHAN_RADII) {
    const reserved = daehanReservedCells(k);
    for (const [name, cells] of [
      ['hex 앵커', anchorCells(k)],
      ['꼭짓점 앵커', vertexAnchors(k)],
      ['포맷', formatCells(k)],
      ['hex 레퍼런스', referenceCellsAll(k)],
      ['패치 레퍼런스', patchReferenceCells(k)],
      ['중앙 슬롯', centralSlotCells()],
      // PM/017 축 — O-CM 은 k=6 에서 4셀 충돌했다. V-CM(=A-CM 자리) 마커 21셀은
      // 전 k 에서 0 이어야 «전역 개방» 이 서고, 아니면 k 조건부 게이트가 필요하다.
      ['V-CM 마커 21', markerCellsA(k)],
    ]) {
      assert.equal(intersect(reserved, cells).length, 0,
        'k=' + k + ' 사괘 ∩ ' + name + ' 이 0 이 아니다');
    }
  }
});

test('사괘 ∩ K 역할 셀 = 전 k 에서 0 — K-CM 마커 조건부 스윕 포함 · taegeuk = 중앙 슬롯', () => {
  const slot = new Set(centralSlotCells().map(key));
  const taegeuk = taegeukCells();
  assert.equal(taegeuk.length, 19);
  assert.equal(taegeuk.every((c) => slot.has(key(c))), true,
    'taegeuk 이 중앙 19셀 슬롯과 좌표가 다르다 — K 중앙 점유자 규약의 전제');
  for (const k of DAEHAN_RADII) {
    const reserved = daehanReservedCells(k);
    assert.equal(reserved.every((c) => hexDistance(c.q, c.r) <= k), true,
      'k=' + k + ' 사괘가 육각 코어 밖으로 나갔다');
    for (const [name, cells] of [
      ['hex 앵커', anchorCells(k)],
      ['별 꼭짓점 앵커', vertexAnchorsK(k)],
      ['반전 꼭짓점', invertedVertexAnchors(k)],
      ['포맷', formatCells(k)],
      ['hex 레퍼런스', referenceCellsAll(k)],
      ['패치 레퍼런스 K', patchReferenceCellsK(k)],
      // PM/017 축 — K-CM 마커 30셀(앵커 위 마커, 링 k·k−1)과의 조건부 충돌 스윕.
      ['K-CM 마커 30', markerCellsK(k)],
    ]) {
      assert.equal(intersect(reserved, cells).length, 0,
        'k=' + k + ' 사괘 ∩ ' + name + ' 이 0 이 아니다');
    }
    // 사괘는 전부 기존 data 셀이다 — 회계가 «잘라내기» 하나로 선다.
    assert.equal(intersect(reserved, dataCellsInScanOrderK(k)).length, reserved.length,
      'k=' + k + ' 사괘 중 data 가 아닌 셀이 있다');
  }
});

// ── 개설 근거 ③ — 와이어 공유 ────────────────────────────────────────────────
test('와이어 — V×daehan 은 V 표를, K×daehan 은 평 K 7 을 공유하고 새 값을 만들지 않는다', () => {
  // V*D: turnASpec(비-CM·비-Q 행) 공유. A*D(1·12·13)와 값이 달라 모호성이 없다.
  for (const spec of VERSIONS_A_DAEHAN) {
    const v = turnASpec(spec.version, {});
    assert.equal(v.k, spec.k);
    assert.notEqual(v.formatIndex, spec.formatIndex,
      'V' + spec.version + 'D 와 A' + spec.version + 'D 의 와이어가 같다 — 역해석 모호');
    const enc = encodeA('w', { version: spec.version, eccLevel: 'M', turnA: true, daehanFinder: true });
    assert.equal(enc.formatIndex, v.formatIndex,
      'V' + spec.version + 'D 인코더 formatIndex 가 V 표와 다르다');
    // V 표에 daehan 전용 행을 만들지 않았다 — 표 크기가 그 증거다 (6 + V-CM 3).
    assert.equal(TURN_A_FORMAT_INDEX.length, 9, 'V 표 크기가 변했다 — 전용 행 신설 여부를 보라');
  }
  // K*D: 평 K 와 같은 (값, k) — capacityK 로드 자기검증과 겹으로 성질을 잰다.
  for (const spec of VERSIONS_K_DAEHAN) {
    const parent = VERSIONS_K.find((v) => v.version === spec.version);
    assert.equal(spec.formatIndex, parent.formatIndex, spec.name + ' 와이어가 평 K 와 갈렸다');
    const enc = encodeK('w', { version: spec.version, eccLevel: 'M', daehanFinder: true });
    assert.equal(enc.formatIndex, parent.formatIndex);
    assert.equal(enc.daehanFinder, true);
  }
});

// ── K 회계 — 표·레이아웃·부모 nsym 승계 ─────────────────────────────────────
test('K daehan 회계 — 오버헤드 83/107/137 · 페이로드 표 · 부모 nsym 승계 (전부 정렬)', () => {
  const EXPECT = {
    K0D: { k: 6, overhead: 83, dataCells: 170, symbols: 56, payload: { L: 45, M: 36, H: 28 } },
    K1D: { k: 8, overhead: 107, dataCells: 326, symbols: 108, payload: { L: 88, M: 73, H: 55 } },
    K2D: { k: 10, overhead: 137, dataCells: 524, symbols: 174, payload: { L: 141, M: 119, H: 91 } },
  };
  assert.equal(VERSIONS_K_DAEHAN.length, 3);
  for (const spec of VERSIONS_K_DAEHAN) {
    const want = EXPECT[spec.name];
    const reserved = daehanReservedCells(spec.k);
    assert.equal(spec.overhead, overheadBreakdownK(spec.k, reserved.length).total);
    assert.equal(dataCellsInScanOrderK(spec.k, reserved).length, want.dataCells);
    assert.equal(fillerCellsK(spec.k, reserved).length, 2);
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForKDaehan(spec, level);
      assert.equal(cap.maxPayloadBytes, want.payload[level], spec.name + '/' + level);
      assert.equal(cap.daehanFinder, true);
      assert.equal(cap.chunkAligned, true);
      // 부모 절대 정정능력 승계 — K 는 A2D/M 류의 +2 보정 없이 전 조합 정렬이다.
      assert.equal(cap.nsym, NSYM_TABLE_K[VERSIONS_K.find((v) => v.version === spec.version).symbolKey][level]);
    }
    assert.ok(!VERSIONS_K.includes(spec), 'VERSIONS_K 에 K daehan spec 이 섞였다');
    // layoutMapK 의 finder 역할 회계 — 예약 셀 수와 정확히 같다.
    const map = layoutMapK(spec.k, reserved);
    assert.equal(
      Array.from(map.values()).filter((entry) => entry.role === 'finder').length,
      reserved.length,
    );
  }
});

// ── 셀 왕복 — 전 k × ECC 전수 ────────────────────────────────────────────────
test('encodeA(turnA+daehan) → decodeCells 가 k×ECC 9칸 전부 원문', () => {
  const base = 'V-daehan roundtrip 0123456789 abcdefghijklmnopqrstuvwxyz';
  for (const spec of VERSIONS_A_DAEHAN) {
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForADaehan(spec, level);
      let text = '';
      while (text.length < cap.maxPayloadBytes) text += base;
      text = text.slice(0, cap.maxPayloadBytes);
      const enc = encodeA(text, {
        version: spec.version, eccLevel: level, turnA: true, daehanFinder: true,
      });
      assert.equal(enc.turnA, true);
      assert.equal(enc.daehanFinder, true);
      const vSpec = turnASpec(spec.version, {});
      const scan = dataCellsInScanOrderA(spec.k, daehanReservedCells(spec.k));
      const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
      // 후단은 정준 좌표로 돈다 (턴은 표본 자리 사상 — bootstrap negateCellKeys).
      const out = decodeCells(digits, {
        type: 'A', daehanFinder: true, k: spec.k, formatIndex: vSpec.formatIndex, eccLevel: level,
      });
      assert.ok(out.ok, 'V' + spec.version + 'D/' + level + ': ' + out.reason);
      assert.equal(out.text, text);
      for (const cell of daehanReservedCells(spec.k)) {
        assert.equal(enc.cellDigits.has(key(cell)), false, 'V' + spec.version + 'D ' + key(cell));
      }
    }
  }
});

test('encodeK(daehan) → decodeCellsK 가 k×ECC 9칸 전부 원문', () => {
  const base = 'K-daehan roundtrip 0123456789 abcdefghijklmnopqrstuvwxyz';
  for (const spec of VERSIONS_K_DAEHAN) {
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForKDaehan(spec, level);
      let text = '';
      while (text.length < cap.maxPayloadBytes) text += base;
      text = text.slice(0, cap.maxPayloadBytes);
      const enc = encodeK(text, { version: spec.version, eccLevel: level, daehanFinder: true });
      assert.equal(enc.daehanFinder, true);
      assert.equal(enc.k, spec.k);
      const scan = dataCellsInScanOrderK(spec.k, daehanReservedCells(spec.k));
      const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
      const out = decodeCellsK(digits, {
        type: 'K', daehanFinder: true, k: spec.k, formatIndex: spec.formatIndex, eccLevel: level,
      });
      assert.ok(out.ok, spec.name + '/' + level + ': ' + out.reason);
      assert.equal(out.text, text);
      for (const cell of daehanReservedCells(spec.k)) {
        assert.equal(enc.cellDigits.has(key(cell)), false, spec.name + ' ' + key(cell));
      }
    }
  }
});

// ── 오독 거절 — 같은 digits 를 이웃 회계로 읽으면 조용히 통과하지 않는다 ──────
test('이웃 회계 오독 거절 — V-daehan↔레거시 V · K-daehan↔평 K', () => {
  {
    const enc = encodeA('V daehan wire', { version: 1, eccLevel: 'M', turnA: true, daehanFinder: true });
    const scan = dataCellsInScanOrderA(8, daehanReservedCells(8));
    const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
    const out = decodeCells(digits, {
      type: 'A', turn: true, k: 8, formatIndex: turnASpec(1, {}).formatIndex, eccLevel: 'M',
    });
    assert.equal(out.ok, false, '레거시 V 회계가 V daehan 을 조용히 받아들였다');
  }
  {
    const enc = encodeK('K daehan wire', { version: 1, eccLevel: 'M', daehanFinder: true });
    const scan = dataCellsInScanOrderK(8, daehanReservedCells(8));
    const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
    const out = decodeCellsK(digits, { type: 'K', k: 8, formatIndex: 7, eccLevel: 'M' });
    assert.equal(out.ok, false, '평 K 회계가 K daehan 을 조용히 받아들였다');
    const plain = encodeK('plain K wire', { version: 1, eccLevel: 'M' });
    const plainDigits = dataCellsInScanOrderK(8)
      .map((c) => plain.cellDigits.get(key(c)).digit);
    const reverse = decodeCellsK(plainDigits, {
      type: 'K', daehanFinder: true, k: 8, formatIndex: 7, eccLevel: 'M',
    });
    assert.equal(reverse.ok, false, 'K daehan 회계가 평 K 를 조용히 받아들였다');
  }
});

// ── 프런트엔드 왕복 — 옵트인 성공 · 기본 라인업 거절 (finder-daehan-a 규율) ────
test('decodeFrontend 왕복 — V0D/V1D/V2D 옵트인 · 이긴 가설은 turn', () => {
  for (const version of [0, 1, 2]) {
    const text = 'TLcube-V' + version + 'D';
    const enc = encodeA(text, { version, eccLevel: 'M', turnA: true, daehanFinder: true });
    const scene = buildScene(enc, {
      palette: PALETTE, margin: 20, finderPatternId: daehanPatternId(enc.k),
    });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
    assert.equal(decodeFrontend(raster).ok, false,
      'V' + version + 'D 가 옵트인 없이 읽혔다 — daehan 서랍의 고급 전용 근거가 사라졌다');
    const on = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
    assert.equal(on.ok, true, 'V' + version + 'D: ' + (on.reason || ''));
    assert.equal(on.text, text);
    assert.equal(on.family, 'tri');
    assert.equal(on.hypothesis.turn, true,
      'V' + version + 'D: 이긴 가설이 turn 이 아니다 — 다른 경로로 우연히 성공했다 ('
      + on.hypothesis.id + ')');
  }
});

test('decodeFrontend 왕복 — K0D/K1D/K2D 옵트인 · family=star', () => {
  for (const version of [0, 1, 2]) {
    const text = 'TLcube-K' + version + 'D';
    const enc = encodeK(text, { version, eccLevel: 'M', daehanFinder: true });
    const scene = buildScene(enc, {
      palette: PALETTE, margin: 20, finderPatternId: daehanPatternId(enc.k),
    });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
    assert.equal(decodeFrontend(raster).ok, false,
      'K' + version + 'D 가 옵트인 없이 읽혔다 — daehan 서랍의 고급 전용 근거가 사라졌다');
    const on = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
    assert.equal(on.ok, true, 'K' + version + 'D: ' + (on.reason || ''));
    assert.equal(on.text, text);
    assert.equal(on.family, 'star');
  }
});

// ── §배선 — 생성기 디스패치가 세 타입 모두 같은 술어로 daehan 을 싣는다 ────────
test('encodeOptsFor 배선 — O·A·K 세 분기가 daehan 술어와 옵션 세우기를 다 가진다', () => {
  // generator-ui-wiring §3.2 의 O 분기 자와 같은 층위 — index.html 의 인라인
  // 디스패치는 import 할 수 없어 분기 조각을 잘라 성질(술어 + 옵션 세우기)을 잰다.
  const dispatch = INDEX.slice(INDEX.indexOf('function encodeOptsFor'));
  const body = dispatch.slice(0, dispatch.indexOf('\nfunction ', 10));
  const aStart = body.indexOf("cfg.type === 'A'");
  const kStart = body.indexOf("cfg.type === 'K'");
  const kEnd = body.indexOf('return { fn: encodeK', kStart);
  const aBranch = body.slice(aStart, kStart);
  const kBranch = body.slice(kStart, kEnd);
  const oBranch = body.slice(kEnd);
  for (const [label, branch] of [['A', aBranch], ['K', kBranch], ['O', oBranch]]) {
    assert.match(branch, /isDaehanFinderPatternId\(cfg\.finderPatternId\)/,
      label + ' 분기가 파인더 id 로 daehan 을 판별하지 않는다');
    assert.match(branch, /opts\.daehanFinder = true/,
      label + ' 분기가 daehanFinder 를 인코더 옵션으로 안 넘긴다 — «켰는데 안 먹는» 상태');
  }
  // A 분기는 daehan 과 turnA 를 **함께** 싣는다 (V*D — 2026-08-29 개설).
  const daehanBlockA = aBranch.slice(aBranch.indexOf('opts.daehanFinder = true'));
  assert.match(daehanBlockA.slice(0, daehanBlockA.indexOf('} else if')), /opts\.turnA = true/,
    'A 분기의 daehan 갈래가 turnA 를 함께 싣지 않는다 — V×daehan 이 화면에서 정삼각으로 나온다');
});
