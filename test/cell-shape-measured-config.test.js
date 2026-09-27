// cell-shape-measured-config.test.js — 셀 꾸미기 «측정 구성» 잠금 (2026-09-27 자리 레인)
//
// 허용표 행은 표 키(타입 · 버전 · 파인더 · 톤 · 틈 · 바탕 · 팔레트 · QR 위치)만 갖지만, 그 행이 참인 것은 **측정 구성**
// (L6 측정 하네스 규약 — 자동 자리 · O 는 안쪽 없음 · 사괘 없음 · ECC H)에서다. 표 키 밖의 축이 다르면 같은 표 키에서도
// 셀 역할 · 정정 여유가 달라진다(A · K 바깥 «없음» 이 a-cm/k-cm 에서 잰 행으로 열리던 거짓 열림). 그래서 resolver 는
// 렌더 구성이 그 타입의 측정 구성(cell-shape `CELL_SHAPE_MEASURED_CONFIG`)과 다르면 구조 잠금으로 모든 모양을 잠근다.
//
// 재는 것(실제 인코더 · 생성 허용표 · 제품 자동 자리표):
//   ⓐ 유닛 — 측정 구성 문맥은 생성 표 행으로 열리고, 표 키가 같은 «한 축만 다른» 문맥은 새 사유로 잠긴다:
//      A · K 바깥 없음(seat-config) · O 사괘(seat-config) · 같은 버전 ECC M · L(ecc-level, Y 포함) · O 안쪽 o-cm = G(unmeasured).
//      K · Y 기본 인코딩이 ctx-incomplete 로 잠기지 않는다(K 사괘 «개념 없음» = false).
//   ⓑ 유도 규칙의 반례 — K 는 사괘를 던지고 결과에 키가 없다(«개념 없음» 의 근거) · 인코더가 boolean 을 주면 늘 그 값 ·
//      O/A 에서 키가 빠지면 값 모름(ctx-incomplete) · ECC 이름 밖 값은 값 모름.
//   ⓒ 생성 표 성질 — 행이 있는 타입마다 선언이 있고, 모든 셀 행은 그 타입 측정 구성 문맥에서 열리며, 측정 구성 키를 하나
//      바꾸면 그 축의 사유로 잠긴다(ECC 는 다른 레벨 전부).
//   ⓓ 선언 ↔ 제품 자동 자리표 — A · K 의 코너 마커 = 자동 바깥 자리가 켜는 마커(finder-zone-ui 술어) · 사괘 = 자동 심부 자리
//      (비-taegeuk) · O 는 측정 하네스 규약(안쪽 없음)이라 false 이고 제품 자동 O(안쪽 o-cm)는 타입 G 로 갈린다.
//   ⓔ 선언이 묶인 영수증 = 허용표 RECEIPT_SHA256 — 표를 다시 생성하면 빨개진다(선언을 재유도하고 sha 를 갱신할 것).
// 못 재는 것: 측정 구성 자체가 참인가(private 측정 하네스 · 영수증의 몫). ECC 는 기하가 아니라 판독 여유 축이다 — 같은
//   버전의 M · L 이 실제로 안 읽힌다는 증거가 아니라 «측정 밖» 이라서 잠근다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as ALLOW from '../src/cell-shape-allow.js';
import {
  CELL_SHAPE_ALLOW_KEYS, CELL_SHAPE_LOCK_CTX_KEYS, CELL_SHAPE_LOCK_REASONS, CELL_SHAPE_MEASURED_CONFIG,
  CELL_SHAPE_MEASURED_CONFIG_KEYS, CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256, CELL_SHAPE_PARAMS,
  CELL_SHAPE_SEAT_CONFIG_KEYS, CELL_SHAPE_STRUCTURAL_LOCK_REASONS, cellShapeAllowCtx, cellShapeCtx, cellShapeTypeOf,
  resolveCellShapeSpec,
} from '../src/cell-shape.js';
import { ECC_NAME_BY_VALUE } from '../src/formatinfo.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import { centralBeaconEncoderOptions, encodeOptionsForY } from '../src/generator-render-config.js';
import { AUTO_SEAT_TYPES, SEAT_NONE, SEAT_SAGOAE, autoSeatsFor } from '../src/generator-seat-auto.js';
import { cornerMarkerSeatActive } from '../src/finder-zone-ui.js';
import { createGeneratorState } from '../src/generator-state.js';

const R = CELL_SHAPE_LOCK_REASONS;
const PAYLOAD = 'https://tl.estre.so'; // 19 B — 제품 기본 URL
const P12 = 'https://tl.e'; // 12 B — O 사괘가 측정 버전(V2)에 머무는 길이
const N7 = centralBeaconEncoderOptions('central-n7-payload', false);
const FRESH = createGeneratorState({ qrPosition: 'TL' });
const WHITE = { quietColor: 'white' };
const ECC_NAMES = Object.freeze(Object.values(ECC_NAME_BY_VALUE));
const Y_TL = { mode: 'corner', corner: 'TL' };
const yEnc = (eccLevel) => encodeY(PAYLOAD, { ...encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0' }), eccLevel });

/** 문맥의 표 키와 같은 생성 표 행(셀 표) — 행은 박제하지 않고 표에서 고른다. */
function rowsFor(ctx) {
  const base = cellShapeAllowCtx(ctx);
  return ALLOW.ROWS.filter((row) => Object.keys(base).every((k) => row[k] === base[k]));
}
function stateOf(row) {
  const def = CELL_SHAPE_PARAMS[row.cellShape];
  return def ? { cellShape: row.cellShape, [def.key]: row.param } : { cellShape: row.cellShape };
}
const resolveRow = (row, ctx) => resolveCellShapeSpec(Object.freeze(stateOf(row)), Object.freeze(ctx));

/**
 * 측정 구성 문맥(measured)은 생성 표 행으로 열리고, 한 축만 바꾼 문맥(other)은 표 키가 같은데 모든 행이 `reason` 으로 잠긴다.
 * 반환: 잰 행 수(자가 비지 않았는지 호출자가 본다).
 */
function assertMeasuredOpensOtherLocks(name, measured, other, reason) {
  assert.deepEqual(cellShapeAllowCtx(other), cellShapeAllowCtx(measured), `${name}: 표 키가 다르다 — 대조군이 아니다`);
  const rows = rowsFor(measured);
  assert.ok(rows.length > 0, `${name}: 측정 구성 문맥에 표 행이 없다 — 자가 비었다 ${JSON.stringify(cellShapeAllowCtx(measured))}`);
  for (const row of rows) {
    const open = resolveRow(row, measured);
    assert.deepEqual(open, { spec: { kind: row.cellShape, param: row.param } }, `${name}: 측정 구성인데 안 열렸다 ${row.cellShape}(${row.param}) ${open.lockReason}`);
    assert.deepEqual(resolveRow(row, other), { spec: null, lockReason: reason }, `${name}: ${row.cellShape}(${row.param})`);
  }
  return rows.length;
}

// ── 선언의 모양 ─────────────────────────────────────────────────────────────

test('선언: 측정 구성 키 = oak 구조 잠금 문맥 키 · y 는 ECC 를 더 갖는다 · 새 사유 둘은 구조 잠금 사유다', () => {
  assert.deepEqual([...CELL_SHAPE_LOCK_CTX_KEYS.oak], [...CELL_SHAPE_MEASURED_CONFIG_KEYS.oak]);
  for (const k of CELL_SHAPE_MEASURED_CONFIG_KEYS.y) assert.ok(CELL_SHAPE_LOCK_CTX_KEYS.y.includes(k), k);
  assert.ok(CELL_SHAPE_SEAT_CONFIG_KEYS.every((k) => CELL_SHAPE_MEASURED_CONFIG_KEYS.oak.includes(k)));
  for (const [type, config] of Object.entries(CELL_SHAPE_MEASURED_CONFIG)) {
    const want = CELL_SHAPE_MEASURED_CONFIG_KEYS[type === 'Y' ? 'y' : 'oak'];
    assert.deepEqual(Object.keys(config).sort(), [...want].sort(), type);
    assert.ok(Object.isFrozen(config), type);
    assert.ok(ECC_NAMES.includes(config.eccLevel), `${type}: eccLevel ${config.eccLevel}`);
  }
  assert.ok(CELL_SHAPE_STRUCTURAL_LOCK_REASONS.includes(R.SEAT_CONFIG));
  assert.ok(CELL_SHAPE_STRUCTURAL_LOCK_REASONS.includes(R.ECC_LEVEL));
});

// ── ⓐ 유닛 (실제 인코더) ────────────────────────────────────────────────────

test('ⓐ A · K: 자동 바깥 자리(코너 마커)는 생성 표 행으로 열리고, 바깥 «없음» 은 표 키가 같아도 seat-config 로 잠긴다', () => {
  const A = { ...FRESH, type: 'A' };
  const aMeasured = cellShapeCtx('A', encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...A, outerSeat: 'a-cm' }, WHITE);
  const aNone = cellShapeCtx('A', encodeA(PAYLOAD, { ...N7, eccLevel: 'H' }), A, WHITE);
  assert.equal(aMeasured.cornerMarker, true);
  assert.equal(aNone.cornerMarker, false);
  assertMeasuredOpensOtherLocks('A 바깥 없음', aMeasured, aNone, R.SEAT_CONFIG);

  const K = { ...FRESH, type: 'K' };
  const kMeasured = cellShapeCtx('K', encodeK(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...K, outerSeat: 'k-cm' }, WHITE);
  const kNone = cellShapeCtx('K', encodeK(PAYLOAD, { ...N7, eccLevel: 'H' }), K, WHITE);
  assertMeasuredOpensOtherLocks('K 바깥 없음', kMeasured, kNone, R.SEAT_CONFIG);
});

test('ⓐ O: 안쪽 없음은 열리고, 안쪽 o-cm 은 타입 G(행 0 — unmeasured), 사괘는 같은 버전에서 seat-config 로 잠긴다', () => {
  const O = { ...FRESH, type: 'O' };
  const oMeasured = cellShapeCtx('O', encode(P12, { ...N7, eccLevel: 'H', version: 2 }), O, WHITE);
  const oSagoae = cellShapeCtx('O', encode(P12, { ...N7, sagoae: true, eccLevel: 'H', version: 2 }), { ...O, deepSeat: 'sagoae' }, WHITE);
  assert.equal(oSagoae.sagoae, true);
  assertMeasuredOpensOtherLocks('O 사괘', oMeasured, oSagoae, R.SEAT_CONFIG);
  // 안쪽 o-cm(제품 자동) — 타입 G 로 갈리고 G 행이 없어 미확인. 측정 구성 선언도 없다(자리 사유가 아니다).
  const g = cellShapeCtx('O', encode(PAYLOAD, { ...N7, cornerMarker: true, markerTones: true, eccLevel: 'H' }), { ...O, innerSeat: 'o-cm' }, WHITE);
  assert.equal(g.type, 'G');
  assert.equal(Object.prototype.hasOwnProperty.call(CELL_SHAPE_MEASURED_CONFIG, 'G'), false);
  for (const row of rowsFor({ ...g, type: 'O' })) {
    assert.deepEqual(resolveRow(row, g), { spec: null, lockReason: R.UNMEASURED }, `G ${row.cellShape}`);
  }
});

test('ⓐ ECC: 같은 버전에서 측정(H)이 아닌 레벨은 ecc-level 로 잠긴다 — O · A · K · Y', () => {
  const O = { ...FRESH, type: 'O' };
  const A = { ...FRESH, type: 'A', outerSeat: 'a-cm' };
  const K = { ...FRESH, type: 'K', outerSeat: 'k-cm' };
  let measured = 0;
  for (const ecc of ECC_NAMES.filter((e) => e !== 'H')) {
    measured += assertMeasuredOpensOtherLocks(`O v2 ECC ${ecc}`,
      cellShapeCtx('O', encode(P12, { ...N7, eccLevel: 'H', version: 2 }), O, WHITE),
      cellShapeCtx('O', encode(P12, { ...N7, eccLevel: ecc, version: 2 }), O, WHITE), R.ECC_LEVEL);
    measured += assertMeasuredOpensOtherLocks(`A v0 ECC ${ecc}`,
      cellShapeCtx('A', encodeA(P12, { ...N7, cornerMarker: true, eccLevel: 'H', version: 0 }), A, WHITE),
      cellShapeCtx('A', encodeA(P12, { ...N7, cornerMarker: true, eccLevel: ecc, version: 0 }), A, WHITE), R.ECC_LEVEL);
    measured += assertMeasuredOpensOtherLocks(`K v0 ECC ${ecc}`,
      cellShapeCtx('K', encodeK(P12, { ...N7, cornerMarker: true, eccLevel: 'H', version: 0 }), K, WHITE),
      cellShapeCtx('K', encodeK(P12, { ...N7, cornerMarker: true, eccLevel: ecc, version: 0 }), K, WHITE), R.ECC_LEVEL);
    const Y = { ...FRESH, type: 'Y', bgMode: 'white' };
    const yH = cellShapeCtx('Y', yEnc('H'), Y, { quietColor: 'none' });
    const yOther = cellShapeCtx('Y', yEnc(ecc), Y, { quietColor: 'none' });
    if (JSON.stringify(cellShapeAllowCtx(yOther)) === JSON.stringify(cellShapeAllowCtx(yH))) {
      measured += assertMeasuredOpensOtherLocks(`Y v0 ECC ${ecc}`, yH, yOther, R.ECC_LEVEL);
    } else {
      // 다른 n 으로 갔다면 표 키부터 다르다 — 그래도 ECC 가 측정 밖이면 구조 잠금이 먼저다(행 유무와 무관).
      for (const row of rowsFor(yH)) assert.equal(resolveRow(row, { ...yH, eccLevel: ecc }).lockReason, R.ECC_LEVEL);
    }
  }
  assert.ok(measured > 0);
});

test('ⓐ K · Y 기본 인코딩은 ctx-incomplete 로 잠기지 않는다 — K 사괘는 «개념 없음» 이라 false, Y 는 ECC 가 정의된다', () => {
  const k = cellShapeCtx('K', encodeK(PAYLOAD), { ...FRESH, type: 'K' }, WHITE);
  assert.equal(k.sagoae, false);
  for (const key of [...CELL_SHAPE_ALLOW_KEYS.oak, ...CELL_SHAPE_LOCK_CTX_KEYS.oak]) assert.notEqual(k[key], undefined, 'K ' + key);
  assert.notEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, k).lockReason, R.CTX_INCOMPLETE);
  const y = cellShapeCtx('Y', encodeY(PAYLOAD, encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0' })), FRESH, { quietColor: 'none' });
  assert.ok(ECC_NAMES.includes(y.eccLevel), `Y eccLevel ${y.eccLevel}`);
  for (const key of [...CELL_SHAPE_ALLOW_KEYS.y, ...CELL_SHAPE_LOCK_CTX_KEYS.y]) assert.notEqual(y[key], undefined, 'Y ' + key);
  assert.notEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, y).lockReason, R.CTX_INCOMPLETE);
});

// ── ⓑ 유도 규칙의 반례 ──────────────────────────────────────────────────────

test('ⓑ K 사괘 «개념 없음» 의 근거: encodeK 는 sagoae:true 를 던지고, 결과에 sagoae 키가 없다', () => {
  assert.throws(() => encodeK(PAYLOAD, { sagoae: true }), RangeError);
  const k = encodeK(PAYLOAD, { cornerMarker: true, eccLevel: 'H' });
  assert.equal(Object.prototype.hasOwnProperty.call(k, 'sagoae'), false, 'K 결과에 sagoae 키가 생겼다 — «개념 없음» 유도를 다시 볼 것');
  // 인코더가 boolean 을 주면 그 값이 늘 우선이다(K 가 사괘를 지원하게 되면 자동으로 읽힌다).
  const kWith = cellShapeCtx('K', { ...k, sagoae: true }, { ...FRESH, type: 'K' }, WHITE);
  assert.equal(kWith.sagoae, true);
  assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, kWith).lockReason, R.SEAT_CONFIG);
});

test('ⓑ O · A 에서 표지 키가 빠지면 값 모름(ctx-incomplete) — 개념 없음으로 채우지 않는다 · ECC 이름 밖 값도 값 모름', () => {
  const cases = [
    ['O', encode(PAYLOAD, { ...N7, eccLevel: 'H' }), { ...FRESH, type: 'O' }],
    ['A', encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...FRESH, type: 'A', outerSeat: 'a-cm' }],
    ['K', encodeK(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...FRESH, type: 'K', outerSeat: 'k-cm' }],
  ];
  for (const [type, enc, state] of cases) {
    const full = cellShapeCtx(type, enc, state, WHITE);
    assert.notEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, full).lockReason, R.CTX_INCOMPLETE, type + ' 대조군');
    for (const key of ['cornerMarker', 'sagoae', 'eccLevel']) {
      if (!Object.prototype.hasOwnProperty.call(enc, key)) continue; // K 의 sagoae — 개념 없음(위 ⓑ)
      const { [key]: _drop, ...partial } = enc;
      const ctx = cellShapeCtx(type, partial, state, WHITE);
      assert.equal(ctx[key], undefined, `${type} ${key}`);
      assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx).lockReason, R.CTX_INCOMPLETE, `${type} ${key} 빠짐`);
    }
    for (const bad of ['RESERVED', 'Q', 2, null]) {
      const ctx = cellShapeCtx(type, { ...enc, eccLevel: bad }, state, WHITE);
      assert.equal(ctx.eccLevel, undefined, `${type} eccLevel ${bad}`);
      assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx).lockReason, R.CTX_INCOMPLETE);
    }
    // boolean 이 아닌 코너 마커도 값 모름이다.
    assert.equal(cellShapeCtx(type, { ...enc, cornerMarker: 'yes' }, state, WHITE).cornerMarker, undefined);
  }
});

// ── ⓒ 생성 표 성질 ──────────────────────────────────────────────────────────

test('ⓒ 생성 표: 행이 있는 타입마다 측정 구성 선언이 있고, 모든 셀 행은 그 구성에서 열리며 구성 키 하나만 바꾸면 그 축 사유로 잠긴다', () => {
  const cellRows = ALLOW.ROWS.filter((r) => r.table === 'oak' || r.table === 'y');
  assert.ok(cellRows.length > 0);
  const typesWithRows = new Set(cellRows.map((r) => (r.table === 'y' ? 'Y' : r.type)));
  for (const t of typesWithRows) {
    assert.ok(Object.prototype.hasOwnProperty.call(CELL_SHAPE_MEASURED_CONFIG, t),
      `타입 ${t} 의 행이 생겼는데 측정 구성 선언이 없다 — cell-shape CELL_SHAPE_MEASURED_CONFIG 에 그 측정 구성을 적어라`);
  }
  // y 행의 표 밖 구조 잠금 키(QR 배치)는 «제품 기본 Y» 값 — cell-shape-allow-generated 와 같다.
  const yLock = { qrPosition: FRESH.qrPosition, qrWindow: false, qrSlot: false };
  let flips = 0;
  for (const row of cellRows) {
    const t = row.table === 'y' ? 'Y' : row.type;
    const config = CELL_SHAPE_MEASURED_CONFIG[t];
    const ctx = { table: row.table, type: t };
    for (const k of CELL_SHAPE_ALLOW_KEYS[row.table]) ctx[k] = row[k];
    if (row.table === 'y') Object.assign(ctx, yLock);
    Object.assign(ctx, config);
    const at = JSON.stringify(row);
    assert.deepEqual(resolveRow(row, ctx), { spec: { kind: row.cellShape, param: row.param } }, `측정 구성에서 안 열린다: ${at}`);
    for (const key of Object.keys(config)) {
      const others = key === 'eccLevel' ? ECC_NAMES.filter((e) => e !== config[key]) : [!config[key]];
      const want = CELL_SHAPE_SEAT_CONFIG_KEYS.includes(key) ? R.SEAT_CONFIG : R.ECC_LEVEL;
      for (const v of others) {
        assert.deepEqual(resolveRow(row, { ...ctx, [key]: v }), { spec: null, lockReason: want }, `${key}=${v}: ${at}`);
        flips += 1;
      }
    }
  }
  assert.ok(flips >= cellRows.length * 2, `뒤집기 ${flips}`);
});

// ── ⓓ 선언 ↔ 제품 자동 자리표 ───────────────────────────────────────────────

test('ⓓ 선언 ↔ 자동 자리표: A · K 코너 마커 = 자동 바깥 자리 · 사괘 = 자동 심부(비-taegeuk) · O 는 하네스 규약(안쪽 없음)', () => {
  const auto = (type) => autoSeatsFor({ type, centralFinderIsTaegeuk: false, allowBlocked: false });
  for (const type of ['A', 'K']) {
    const a = auto(type);
    const config = CELL_SHAPE_MEASURED_CONFIG[type];
    // 자리 id → 와이어 코너 마커는 제품 술어(finder-zone-ui)로 옮긴다(buildConfig 의 cornerMarker 와 같은 함수).
    assert.equal(config.cornerMarker, a.outer !== SEAT_NONE, `${type}: 자동 바깥 자리 ${a.outer}`);
    assert.equal(config.cornerMarker, cornerMarkerSeatActive({ type, outerSeat: a.outer, turnA: false }), type);
    assert.equal(config.sagoae, a.deep !== SEAT_NONE, `${type}: 자동 심부 ${a.deep}`);
  }
  // O — 측정 하네스는 안쪽을 «없음» 으로 내렸다(안쪽 o-cm 은 타입 G 로 따로 갈린다). 사괘는 자동 심부와 같다.
  const o = auto('O');
  assert.equal(CELL_SHAPE_MEASURED_CONFIG.O.cornerMarker, false);
  assert.equal(CELL_SHAPE_MEASURED_CONFIG.O.sagoae, o.deep === SEAT_SAGOAE);
  assert.equal(cellShapeTypeOf('O', encode(PAYLOAD), { innerSeat: o.inner }), o.inner === SEAT_NONE ? 'O' : 'G',
    '제품 자동 O 의 안쪽 자리가 타입을 가르는 방식이 바뀌었다');
  // 자동 자리표에 있는데 선언이 없는 타입(V)은 표에 행이 0 이어야 한다(행이 생기면 선언 — ⓒ).
  for (const type of AUTO_SEAT_TYPES) {
    if (Object.prototype.hasOwnProperty.call(CELL_SHAPE_MEASURED_CONFIG, type)) continue;
    assert.equal(ALLOW.ROWS.filter((r) => r.table === 'oak' && r.type === type).length, 0, `${type}: 선언 없는 타입의 행`);
  }
});

// ── ⓔ 영수증 결속 ────────────────────────────────────────────────────────────

test('ⓔ 측정 구성 선언이 묶인 영수증 = 허용표 RECEIPT_SHA256 (표를 다시 생성하면 선언을 재유도할 것)', () => {
  assert.match(CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(ALLOW.RECEIPT_SHA256, CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256,
    '허용표가 다시 생성됐다 — 새 영수증의 측정 구성(자리 · 사괘 · ECC)을 확인해 CELL_SHAPE_MEASURED_CONFIG 를 재유도하고 '
    + 'CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256 을 갱신하라');
});
