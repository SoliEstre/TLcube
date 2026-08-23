/**
 * markerG.test.js — 내부 타입 G (코너 마커) formatIndex 배정 + 양 끝 배선 회귀.
 *
 * 값이 아니라 **규칙**으로 잠근다 (레인 브리프 §4.4):
 *   ① (formatIndex, k) 충돌 0 — 점유를 **코드에서 유도**한다
 *      (hexTriAxisOccupancy + 턴A 표 + G 표). 목록 손 관리 금지.
 *   ② G 는 K1(7)·cube(8..11) 예약을 침범하지 않는다 — 상수에서 유도.
 *   ③ 와이어 — 인코더 양쪽(O·A)이 cornerMarker 에서 G 인덱스를 싣는다.
 *   ④ 왕복 — cornerMarker 인코딩 → 렌더 → decodeFrontend 가 읽는다 (6항목 전부).
 *      019 의 교훈: 한쪽 끝만 배선하면 효과가 0 이다 — 그래서 왕복으로 잰다.
 *   ⑤ 배선 전제 — CM 데이터 셀 ⊂ 레거시 데이터 셀 (bootstrap 이 레거시 표본 grid 를
 *      재사용하는 근거. 깨지면 CM 본문 일부가 소거로 새서 RS 여유만 조용히 먹는다).
 *   ⑥ 레거시 무회귀 — 마커를 안 쓴 프레임의 발행 formatIndex/포맷 워드는 그대로다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKER_G_FORMAT_INDEX,
  markerGSpec,
  markerGSpecFromFormatIndex,
} from '../src/markerG.js';
import {
  TURN_A_FORMAT_INDEX,
  K1_RESERVED_FORMAT_INDEX,
  CUBE_AXIS_FORMAT_INDEXES,
  hexTriAxisOccupancy,
} from '../src/turnA.js';
import { VERSIONS } from '../src/capacity.js';
import { VERSIONS_A } from '../src/capacityA.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeReplicated, ECC_LEVEL } from '../src/formatinfo.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { dataCellsInScanOrderA } from '../src/layoutA.js';
import { dataCellsInScanOrderOMarker } from '../src/markerO.js';
import { dataCellsInScanOrderAMarker } from '../src/markerA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function render(encoded, options = {}) {
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: options.margin,
    // CMQ(C2a) — 중앙 슬롯이 QR 인 항목은 qrText 까지 넘겨야 렌더된다.
    ...(options.centerQr ? { centerQr: true, qrText: options.qrText } : {}),
  });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
}

test('① (값,k) 무경합 — hex·tri 전점유 + 턴A + G 를 코드에서 유도해 전수 확인', () => {
  const seen = new Map(); // "idx|k" → owner
  const claim = (owner, formatIndex, k) => {
    const key = formatIndex + '|' + k;
    assert.equal(seen.has(key), false,
      owner + ' 와 ' + seen.get(key) + ' 이 (' + formatIndex + ', k' + k + ') 경합');
    seen.set(key, owner);
  };
  for (const occ of hexTriAxisOccupancy()) claim(occ.owner, occ.formatIndex, occ.k);
  for (const entry of TURN_A_FORMAT_INDEX) claim(entry.name, entry.formatIndex, entry.k);
  for (const entry of MARKER_G_FORMAT_INDEX) claim(entry.name, entry.formatIndex, entry.k);
  // G 는 (family, version, centerQr) 커버리지가 기저 표 × Q축과 정확히 같다 —
  // 빠지면 인코더가 던진다. (C2a 2026-08-23: CMQ 6칸 추가 — 6 → 12.)
  assert.equal(MARKER_G_FORMAT_INDEX.length, (VERSIONS.length + VERSIONS_A.length) * 2);
  for (const spec of VERSIONS) {
    assert.ok(markerGSpec('hex', spec.version, false));
    assert.ok(markerGSpec('hex', spec.version, true));
  }
  for (const spec of VERSIONS_A) {
    assert.ok(markerGSpec('tri', spec.version, false));
    assert.ok(markerGSpec('tri', spec.version, true));
  }
});

test('② G 는 K1·cube 예약을 침범하지 않고 4bit 안이며 기저 k 와 일치한다', () => {
  for (const entry of MARKER_G_FORMAT_INDEX) {
    assert.ok(entry.formatIndex >= 0 && entry.formatIndex <= 15, entry.name + ' 4bit 범위');
    assert.notEqual(entry.formatIndex, K1_RESERVED_FORMAT_INDEX, entry.name + ' K1 침범');
    assert.equal(CUBE_AXIS_FORMAT_INDEXES.includes(entry.formatIndex), false,
      entry.name + ' cube 축 침범');
    const base = entry.family === 'hex'
      ? VERSIONS.find((v) => v.version === entry.version)
      : VERSIONS_A.find((v) => v.version === entry.version);
    assert.ok(base, entry.name + ' 기저 버전 없음');
    assert.equal(entry.k, base.k, entry.name + ' 의 k 가 기저와 다르다');
  }
  // 역조회 왕복 — (formatIndex, k) 만으로 유일 결정된다 (패밀리 축 불필요 = 가르기 근거).
  for (const entry of MARKER_G_FORMAT_INDEX) {
    assert.equal(markerGSpecFromFormatIndex(entry.formatIndex, entry.k), entry);
  }
});

test('③ 와이어 — 두 인코더가 cornerMarker 에서 G 인덱스를 싣는다 (Q 변형은 배타로 불필요)', () => {
  for (const spec of VERSIONS) {
    const encoded = encode('TL', { version: spec.version, eccLevel: 'M', cornerMarker: true });
    const want = encodeReplicated({
      version: markerGSpec('hex', spec.version).formatIndex, eccLevel: ECC_LEVEL.M,
    }).flat();
    assert.deepEqual(Array.from(encoded.formatDigits), want,
      'O V' + spec.version + 'CM 포맷 워드가 G 인덱스가 아니다');
    assert.equal(encoded.capacity.formatIndex, markerGSpec('hex', spec.version).formatIndex);
  }
  for (const spec of VERSIONS_A) {
    const encoded = encodeA('TL', { version: spec.version, eccLevel: 'M', cornerMarker: true });
    assert.equal(encoded.formatIndex, markerGSpec('tri', spec.version).formatIndex,
      'A' + spec.version + 'CM formatIndex 가 G 표와 다르다');
  }
  // **의도적 갱신 (C2a, 2026-08-23)**: centerQr 배타가 해제됐다 — 조합은 던지는 대신
  // **CMQ 전용 인덱스**를 싣는다 (배치 검증·왕복은 test/markerG-centerqr.test.js).
  assert.equal(
    encode('TL', { version: 1, eccLevel: 'M', cornerMarker: true, centerQr: true })
      .capacity.formatIndex,
    markerGSpec('hex', 1, true).formatIndex,
  );
  assert.equal(
    encodeA('TL', { version: 0, eccLevel: 'M', cornerMarker: true, centerQr: true }).formatIndex,
    markerGSpec('tri', 0, true).formatIndex,
  );
});

test('④ 왕복 — G 표 12항목 전부: cornerMarker(±Q) 인코딩 → 렌더 → decodeFrontend 가 읽는다', () => {
  for (const entry of MARKER_G_FORMAT_INDEX) {
    const text = 'TLcube-' + entry.name;
    const options = {
      version: entry.version, eccLevel: 'M', cornerMarker: true, centerQr: entry.centerQr,
    };
    const encoded = entry.family === 'hex' ? encode(text, options) : encodeA(text, options);
    const result = decodeFrontend(render(encoded, {
      ...(entry.family === 'tri' ? { margin: 20 } : {}),
      // CMQ — 중앙 슬롯이 QR 이므로 scene 에 qrText 가 필요하다.
      ...(entry.centerQr ? { centerQr: true, qrText: 'HTTPS://TLSCAN.ESTRE.SO' } : {}),
    }));
    assert.equal(result.ok, true, entry.name + ' 왕복 실패: ' + JSON.stringify(result.reason));
    assert.equal(result.text, text, entry.name + ' 페이로드 불일치');
    assert.equal(result.diagnostics.format.formatIndex, entry.formatIndex,
      entry.name + ' 이 G 인덱스가 아니라 다른 회계로 읽혔다');
    assert.equal(result.corrected, 0,
      entry.name + ': 무왜곡 렌더인데 RS 정정 발생 — scan order 양끝이 어긋났다');
  }
});

test('⑤ 배선 전제 — CM 데이터 셀 ⊂ 레거시 데이터 셀 (bootstrap 의 grid 재사용 근거)', () => {
  const key = (c) => c.q + ',' + c.r;
  for (const spec of VERSIONS) {
    const legacy = new Set(dataCellsInScanOrder(spec.k).map(key));
    for (const cell of dataCellsInScanOrderOMarker(spec.k)) {
      assert.ok(legacy.has(key(cell)),
        'O-CM k=' + spec.k + ' 데이터 셀 ' + key(cell) + ' 이 레거시 데이터 밖 — grid 재사용 불가');
    }
  }
  for (const spec of VERSIONS_A) {
    const legacy = new Set(dataCellsInScanOrderA(spec.k).map(key));
    for (const cell of dataCellsInScanOrderAMarker(spec.k)) {
      assert.ok(legacy.has(key(cell)),
        'A-CM k=' + spec.k + ' 데이터 셀 ' + key(cell) + ' 이 레거시 데이터 밖 — grid 재사용 불가');
    }
  }
});

test('⑥ 레거시 무회귀 — 마커 없는 프레임의 발행 인덱스·포맷 워드는 한 자리도 안 바뀐다', () => {
  // 발행 규약 상수 (이미 돌아다니는 코드가 이 값으로 읽힌다 — turnA-wire-regression 참조).
  for (const [version, index] of [[1, 0], [2, 1], [3, 2]]) {
    const plain = encode('TL', { version, eccLevel: 'M' });
    assert.deepEqual(
      Array.from(plain.formatDigits),
      encodeReplicated({ version: index, eccLevel: ECC_LEVEL.M }).flat(),
      'O V' + version + ' 레거시 포맷 워드가 움직였다',
    );
  }
  for (const [version, index] of [[0, 1], [1, 12], [2, 13]]) {
    assert.equal(encodeA('TL', { version, eccLevel: 'M' }).formatIndex, index,
      'A' + version + ' 레거시 formatIndex 가 움직였다');
  }
  // G 값이 레거시·턴A 어느 발행값과도 (값,k) 를 공유하지 않는 것은 ① 이 전수로 잰다.
});
