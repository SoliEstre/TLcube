/**
 * capacity-v4.test.js — V4 «대용량» (k=12) 신설의 자 (2026-08-30 운영자 지시).
 *
 * 이 파일이 잠그는 것:
 *   ① 회계 — nsym 을 **절차**로 잠근다. 값만 박아 두면 그 값이 어디서 왔는지가 다음
 *      사람에게 사라지고, 표를 손으로 고쳐도 초록이 된다. SPEC §5 절차식을 여기서
 *      다시 계산해 표와 대조하고, **같은 식이 기존 행(V1·V3·O-CM 전 행)도 재현**하는지
 *      함께 잰다 — 절차가 V4 에만 맞는 사후 설명이 아님을 그것이 보인다.
 *   ② 청킹 — SPEC §5 의 «절차값이 base-211 청킹과 어긋나면 최근접 홀수로 대체» 조항이
 *      V4 에서 **발동하지 않는다**는 사실. 발동하면 조용히 인코딩 불가가 된다.
 *   ③ 와이어 — V4(3) · V4Q(7) · V4CM(0) · V4CMQ(1) 이 전부 k=12 에서 서로 다르다.
 *   ④ 왕복 — digit 계층(전 ECC × 경계 페이로드) + **프런트엔드**(합성 렌더 → 격자
 *      가설 → k=12 검출 → 복호). 후자가 없으면 「초록 테스트는 동작하는 UI 가 아니다」.
 *   ⑤ 배타 — daehan/sagoae × V4 명시 거절 + **대조군**(daehan V1\~V3 은 여전히 통과).
 *
 * 용량 계약값(통합자가 SPEC §5.5 · README · 생성기 «대용량» 카드에 배선할 수)은
 * ①의 마지막 테스트가 값으로 든다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { VERSIONS, capacityFor } from '../src/capacity.js';
import { NSYM_TABLE } from '../src/rs211.js';
import {
  VERSIONS_OCM, NSYM_TABLE_OCM, capacityForOMarker, dataCellsInScanOrderOMarker,
} from '../src/markerO.js';
import { markerGSpec } from '../src/markerG.js';
import { encode } from '../src/encode.js';
import { decodeCells } from '../src/decode.js';
import { decode as decodeFormatInfo } from '../src/formatinfo.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { daehanReservedCells } from '../src/finder-daehan.js';
import { VERSIONS_A_DAEHAN } from '../src/capacityA.js';
import { VERSIONS_K_DAEHAN } from '../src/capacityK.js';
import { symbolCountForByteLength } from '../src/base211.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { TL_READER_URL } from '../src/qr.js';

const LEVELS = ['L', 'M', 'H'];
const V4 = VERSIONS.find((spec) => spec.version === 4);
const V4CM = VERSIONS_OCM.find((spec) => spec.version === 4);

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

/**
 * SPEC §5 의 nsym 산출 절차. **이 파일이 정본을 베끼는 게 아니라 절차를 다시 적는다** —
 * 표와 절차가 갈리면 둘 중 하나가 틀렸다는 뜻이고, 그걸 보려면 두 벌이 있어야 한다.
 *   M = round(0.25·S) (JS half-up), 짝수면 +1 홀수화 / L = round(0.12·S) / H = round(0.40·S)
 */
function nsymByProcedure(symbols) {
  let M = Math.round(0.25 * symbols);
  if (M % 2 === 0) M += 1;
  return { L: Math.round(0.12 * symbols), M, H: Math.round(0.40 * symbols) };
}

function formatIndexOf(encoded) {
  const digits = Array.from(encoded.formatDigits);
  const result = decodeFormatInfo([digits.slice(0, 5), digits.slice(5, 10), digits.slice(10, 15)]);
  assert.equal(result.ok, true, '포맷 워드가 복호되지 않는다');
  return result.version;
}

function digitsOf(encoded) {
  const scan = encoded.cornerMarker
    ? dataCellsInScanOrderOMarker(encoded.k)
    : dataCellsInScanOrder(encoded.k);
  return Uint8Array.from(scan.map((cell) => {
    const entry = encoded.cellDigits.get(cell.q + ',' + cell.r);
    assert.ok(entry, 'scan order 셀에 digit 가 없다: ' + cell.q + ',' + cell.r);
    return entry.digit;
  }));
}

function assertRoundTrip(text, options) {
  const encoded = encode(text, options);
  assert.equal(encoded.k, 12, 'V4 는 k=12 여야 한다');
  const result = decodeCells(digitsOf(encoded), {
    version: encoded.version,
    formatIndex: formatIndexOf(encoded),
    eccLevel: encoded.eccLevel,
    k: encoded.k,
    ...(encoded.cornerMarker ? { cornerMarker: true } : {}),
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  assert.equal(result.text, text);
  assert.equal(result.corrected, 0);
  return encoded;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('① 회계 — nsym 은 절차의 산물이지 손으로 고른 수가 아니다', () => {
  test('V4 · V4CM 의 nsym 이 SPEC §5 절차와 정확히 같다', () => {
    assert.deepEqual(
      { L: NSYM_TABLE.V4.L, M: NSYM_TABLE.V4.M, H: NSYM_TABLE.V4.H },
      nsymByProcedure(NSYM_TABLE.V4.symbols),
      'V4 nsym 이 절차값과 다르다 — 표를 고쳤으면 근거를 rs211.js 주석에 적어라',
    );
    assert.deepEqual(
      { L: NSYM_TABLE_OCM.V4CM.L, M: NSYM_TABLE_OCM.V4CM.M, H: NSYM_TABLE_OCM.V4CM.H },
      nsymByProcedure(NSYM_TABLE_OCM.V4CM.symbols),
      'V4CM nsym 이 절차값과 다르다',
    );
  });

  test('같은 절차가 기존 행도 재현한다 — V2 M 하나만 문서화된 예외', () => {
    const mismatches = [];
    for (const [name, row] of Object.entries(NSYM_TABLE)) {
      const want = nsymByProcedure(row.symbols);
      for (const level of LEVELS) {
        if (row[level] !== want[level]) mismatches.push(`${name}/${level} ${row[level]}≠${want[level]}`);
      }
    }
    for (const [name, row] of Object.entries(NSYM_TABLE_OCM)) {
      const want = nsymByProcedure(row.symbols);
      for (const level of LEVELS) {
        if (row[level] !== want[level]) mismatches.push(`${name}/${level} ${row[level]}≠${want[level]}`);
      }
    }
    // V2/M = 14 는 ADR §3.3.2 (2026-07-29 운영자 확정) 승계값이라 절차값 15 와 다르다.
    // rs211.js 헤더가 이미 예외로 적어 둔 자리다 — 예외가 **하나뿐**임을 여기서 잠근다.
    assert.deepEqual(mismatches, ['V2/M 14≠15'],
      '절차 ↔ 표 불일치 목록이 바뀌었다. 새 불일치는 절차가 틀렸거나 표가 틀렸다는 뜻이다');
  });

  test('② 청킹 — V4 의 어느 레벨도 base-211 «최근접 홀수 대체» 조항을 안 부른다', () => {
    for (const level of LEVELS) {
      for (const [label, cap] of [
        ['V4', capacityFor(V4, level)],
        ['V4CM', capacityForOMarker(V4CM, level)],
      ]) {
        assert.equal(symbolCountForByteLength(cap.dataBytes), cap.dataSymbols,
          `${label}/${level}: K=${cap.dataBytes} B 가 ${cap.dataSymbols} 심볼로 안 떨어진다`
          + ' — SPEC §5 의 최근접 홀수 대체가 필요하다');
      }
    }
  });

  test('용량 계약값 — 통합자가 SPEC §5.5 · README · 생성기 카드에 배선할 수', () => {
    // 평 O V4 (k=12, 총 469셀, 오버헤드 57, 데이터 412, S=137, 잔여 1)
    assert.deepEqual(LEVELS.map((l) => capacityFor(V4, l).maxPayloadBytes), [115, 97, 78]);
    // O-CM V4 = G4 (오버헤드 66 — 마커 9셀, 데이터 403, S=134, 잔여 1)
    assert.deepEqual(LEVELS.map((l) => capacityForOMarker(V4CM, l).maxPayloadBytes), [112, 94, 76]);
    // 총 셀·오버헤드 내역 (파생값이라 여기서 값으로 다시 든다 — 통합자 전달용)
    const m = capacityFor(V4, 'M');
    assert.deepEqual(
      [m.totalCells, m.overhead, m.dataCells, m.usedSymbols, m.residualCells],
      [469, 57, 412, 137, 1],
    );
    const cm = capacityForOMarker(V4CM, 'M');
    assert.deepEqual(
      [cm.totalCells, cm.overhead, cm.dataCells, cm.usedSymbols, cm.residualCells],
      [469, 66, 403, 134, 1],
    );
  });

  test('V4Q 는 평 V4 와 용량이 **완전히 같다** — 중앙 슬롯은 애초에 셀 밖', () => {
    // centerQr 는 불스아이 19셀을 대체할 뿐 새 셀을 안 먹는다. 그래서 별도 용량 행이
    // 없고, 통합자는 V4Q 칸에 평 V4 값을 그대로 쓴다. 그 «같음» 을 값으로 잠근다.
    for (const level of LEVELS) {
      const plain = encode('q', { version: 4, eccLevel: level });
      const q = encode('q', { version: 4, eccLevel: level, centerQr: true });
      assert.equal(q.capacity.maxPayloadBytes, plain.capacity.maxPayloadBytes);
      assert.equal(q.capacity.totalCells, plain.capacity.totalCells);
      assert.equal(q.capacity.overhead, plain.capacity.overhead);
    }
  });

  test('chooseVersion — V3 를 넘는 페이로드가 V4 로 승격된다', () => {
    const v3Max = capacityFor(VERSIONS.find((s) => s.version === 3), 'M').maxPayloadBytes;
    assert.equal(encode('x'.repeat(v3Max)).version, 3);
    assert.equal(encode('x'.repeat(v3Max + 1)).version, 4);
    assert.equal(encode('x'.repeat(capacityFor(V4, 'M').maxPayloadBytes)).version, 4);
    assert.throws(() => encode('x'.repeat(capacityFor(V4, 'M').maxPayloadBytes + 1)), RangeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('③ 와이어 — V4 계열 formatIndex 는 k=12 안에서 서로 다르다', () => {
  test('V4=3 · V4Q=7 · V4CM=0 · V4CMQ=1', () => {
    assert.equal(formatIndexOf(encode('w', { version: 4 })), 3);
    assert.equal(formatIndexOf(encode('w', { version: 4, centerQr: true })), 7);
    assert.equal(formatIndexOf(encode('w', { version: 4, cornerMarker: true })), 0);
    assert.equal(
      formatIndexOf(encode('w', { version: 4, cornerMarker: true, centerQr: true })), 1,
    );
    // G 표 쪽 정본과 대조 (인코더가 표를 읽는지 — 산술로 우회하지 않는지)
    assert.equal(markerGSpec('hex', 4, false).formatIndex, 0);
    assert.equal(markerGSpec('hex', 4, true).formatIndex, 1);
    assert.equal(markerGSpec('hex', 4, false).k, 12);
  });

  test('네 값이 서로 다르다 — 같으면 디코더가 회계/중앙 점유를 못 가른다', () => {
    const values = [
      formatIndexOf(encode('w', { version: 4 })),
      formatIndexOf(encode('w', { version: 4, centerQr: true })),
      formatIndexOf(encode('w', { version: 4, cornerMarker: true })),
      formatIndexOf(encode('w', { version: 4, cornerMarker: true, centerQr: true })),
    ];
    assert.equal(new Set(values).size, 4, 'k=12 에서 V4 계열 인덱스가 겹친다: ' + values.join(','));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('④ 왕복 — digit 계층', () => {
  test('평 O V4 × L/M/H × 경계 페이로드 (빈값·1B·최대·한글·이모지)', () => {
    for (const level of LEVELS) {
      const max = capacityFor(V4, level).maxPayloadBytes;
      const cases = [
        '',
        'x',
        'A'.repeat(max),
        '가나다라마바사'.repeat(3),
        'TLcube ✅🧊 대용량 V4',
      ];
      for (const text of cases) {
        assertRoundTrip(text, { version: 4, eccLevel: level });
      }
    }
  });

  test('O-CM V4 (= G4) × L/M/H', () => {
    for (const level of LEVELS) {
      const max = capacityForOMarker(V4CM, level).maxPayloadBytes;
      assertRoundTrip('B'.repeat(max), { version: 4, eccLevel: level, cornerMarker: true });
      assertRoundTrip('오시엠 V4 ✅', { version: 4, eccLevel: level, cornerMarker: true });
    }
  });

  test('중앙 슬롯 점유자 조합 — V4Q · V4CMQ · markerTones 가 따라온다', () => {
    assertRoundTrip('centerQr V4', { version: 4, centerQr: true });
    assertRoundTrip('centerQr + CM V4', { version: 4, cornerMarker: true, centerQr: true });
    assertRoundTrip('H 톤 V4', { version: 4, cornerMarker: true, markerTones: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('④ 왕복 — 프런트엔드 (합성 렌더 → 격자 가설 → k=12 검출 → 복호)', () => {
  function frontendRoundTrip(text, encodeOptions, sceneOptions = {}) {
    const encoded = encode(text, encodeOptions);
    const scene = buildScene(encoded, { palette: PALETTE, ...sceneOptions });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true,
      result.ok ? '' : `${result.reason} ${JSON.stringify(result.detail?.pipelineCode)}`);
    assert.equal(result.text, text);
    // **격자 가설부터** 진입했다는 증거: 앞단이 스스로 k=12 를 골랐다 (호출자가 안 줬다).
    assert.equal(result.hypothesis.family, 'hex');
    assert.equal(result.hypothesis.k, 12, '앞단이 k=12 격자 가설을 못 세웠다');
    return result;
  }

  test('평 O V4/M — 앞단이 k=12 를 스스로 세우고 formatIndex 3 을 읽는다', { timeout: 180_000 }, () => {
    const result = frontendRoundTrip('v4 frontend 대용량', { version: 4, eccLevel: 'M' });
    assert.equal(result.version, 4);
    assert.equal(result.diagnostics.format.formatIndex, 3);
  });

  test('O-CM V4/M (= G4) — 마커 회계로 k=12 를 읽는다', { timeout: 180_000 }, () => {
    const result = frontendRoundTrip('g4 frontend', { version: 4, eccLevel: 'M', cornerMarker: true });
    assert.equal(result.diagnostics.format.formatIndex, 0);
  });

  test('V4Q — 중앙 QR 점유자도 k=12 에서 따라온다', { timeout: 180_000 }, () => {
    const result = frontendRoundTrip(
      'v4q frontend',
      { version: 4, eccLevel: 'M', centerQr: true },
      { qrText: TL_READER_URL, centerQr: true },
    );
    assert.equal(result.diagnostics.format.formatIndex, 7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 는 배타 자였다 («daehan/sagoae × V4 는 정의가 없다») — V4D 개방(2026-08-30,
// PM/027 §5.5)으로 양성 + 대조군으로 반전한다. 개방의 선행 게이트는 misread 재실측
// (test/output/lanes/claude-v4d-misread.mjs — 거절 실패 0건)이다.
describe('⑤ 개방 — daehan/sagoae × V4 = V4D (와이어는 V 인덱스 공유)', () => {
  test('양성 — 구 거절 조합 전부가 V4D 회계로 선다', () => {
    for (const options of [
      { version: 4, daehanFinder: true },
      { version: 4, sagoae: true },
      { version: 4, eccLevel: 'H', daehanFinder: true },
    ]) {
      const encoded = encode('daehan v4', options);
      assert.equal(encoded.k, 12, JSON.stringify(options));
      assert.equal(encoded.daehanFinder, true, 'daehan 예약 회계 신호가 안 섰다');
      assert.equal(encoded.capacity.usedSymbols, 117, 'V4D 회계(S=117)가 아니다');
      // 와이어 — 전용 formatIndex 신설 금지: 평 V4 의 3 을 그대로 공유한다.
      assert.equal(formatIndexOf(encoded), 3, JSON.stringify(options));
    }
  });

  test('용량 계약값 — V4D 96/78/58 B (nsym 은 V4 승계 16/35/55, 절차 재산출 아님)', () => {
    const bytes = {};
    for (const level of LEVELS) {
      const encoded = encode('v4d', { version: 4, eccLevel: level, daehanFinder: true });
      bytes[level] = encoded.capacity.maxPayloadBytes;
      assert.equal(encoded.capacity.nsym, NSYM_TABLE.V4[level],
        `V4D/${level}: nsym 이 V4 승계값이 아니다`);
    }
    assert.deepEqual(bytes, { L: 96, M: 78, H: 58 });
  });

  test('digit 왕복 — V4D × L/M/H × 경계 페이로드', () => {
    for (const level of LEVELS) {
      const encoded = encode('v4d cap', { version: 4, eccLevel: level, daehanFinder: true });
      const max = encoded.capacity.maxPayloadBytes;
      for (const text of ['', 'x', 'D'.repeat(max), '대한 V4D ✅']) {
        const enc = encode(text, { version: 4, eccLevel: level, daehanFinder: true });
        const scan = dataCellsInScanOrder(12, daehanReservedCells(12));
        const digits = scan.map((c) => enc.cellDigits.get(c.q + ',' + c.r).digit);
        const out = decodeCells(digits, {
          type: 'O', daehanFinder: true, k: 12, formatIndex: 3, eccLevel: level,
        });
        assert.equal(out.ok, true, level + ': ' + (out.reason || ''));
        assert.equal(out.text, text);
      }
    }
  });

  test('대조군 — daehan V1~V3 은 여전히 통과한다 (「V4 만 열렸다」가 아니다)', () => {
    for (const version of [1, 2, 3]) {
      const encoded = encode('daehan ok', { version, daehanFinder: true });
      assert.equal(encoded.daehanFinder, true);
      assert.equal(encoded.version, version);
    }
  });

  test('cornerMarker 는 **열려 있다** — G4 가 거절되지 않는지 대조 (보존)', () => {
    assert.equal(encode('g4 ok', { version: 4, cornerMarker: true }).cornerMarker, true);
  });

  test('배타 유지 — daehan × cornerMarker 는 여전히 원자 거절 (배치 검증 미실시)', () => {
    assert.throws(
      () => encode('d x cm', { version: 4, daehanFinder: true, cornerMarker: true }),
      /중앙 슬롯 점유자는 하나다/,
    );
  });

  test('개방은 hex 축 한정 — A/K daehan 표에는 k=12 행이 없다 (게이트의 정본이 이 표다)', () => {
    // bootstrap.daehanReservedCellsFor 의 게이트가 family 별 회계 표 유도로 바뀌었다
    // (2026-08-30) — 그래서 이 표 단언이 곧 «O 표 하나로 전 가족을 조종하지 않는다»
    // 의 결정 단계 단언이다.
    assert.equal(VERSIONS_A_DAEHAN.some((spec) => spec.k === 12), false);
    assert.equal(VERSIONS_K_DAEHAN.some((spec) => spec.k === 12), false);
  });
});
