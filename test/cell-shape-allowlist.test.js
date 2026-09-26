// cell-shape-allowlist.test.js — 허용표 · 잠금 분류 · 상태 정규화의 성질 (DESIGN_001 §3.4 · §7.5, 레인 D1 2026-09-26)
//
// 재는 것:
//   ① 허용표 내부 일관성 · 지문 — 행 모양(표별 키 **정확히**) · 도메인 · 중복 없음 · 구조 잠금에 걸린 «죽은 행» 없음 ·
//      영수증 sha/측정 시각/지문은 셋이 함께 있거나 함께 없다(행이 있으면 반드시 있다). 판정 함수는 심은 결함 표로
//      빨개지는지 따로 잰다.
//   ② UI 가 열거하는 선택지 전부(스키마 DECORATION_STATE_DOMAINS 에서 **유도** — 손 목록 없음)를 실제 인코딩에서 유도한
//      대표 문맥(cellShapeCtx · hCellStyleCtx · QR 호스트)마다 resolver 에 넣으면, 결과는 «허용»(spec/deco) ·
//      «기본값(사유 없는 null)» · «잠금 + 안정 사유 id» 셋 중 하나다. 스텁 표에서는 비기본 전부가 잠금 + 사유.
//   ③ 구조 잠금 — 그 조합의 행을 **정확히** 넣은 «전부 열림» 표(심은 결함)로도 잠긴다. 판별력: 잠금 조건 하나만 뒤집은
//      문맥(같은 표)에서는 같은 선택이 열린다. 구조 잠금 사유 7(셀) + 1(QR) + 2(H) 가 모두 실제 문맥에서 한 번 이상 난다.
//   ④ resolver 는 상태를 고치지 않는다(동결 상태 · JSON 전후 동일).
//   ⑤ 상태 정규화 — 부재 · 문자열 · 범위 밖 · 정수 아님 → 기본값, 도메인 안은 그대로. 정규화를 거친 customSat 로는
//      makeCustomPalette 가 절대 RangeError 를 내지 않는다.
//   ⑥ 생성기 상태 → QR 호스트(qrDecoHostOf): H(Y+3d) 는 'h' — isHGenerator · cellShapeTypeOf 와 같은 격자, h 행 하나로
//      실제로 열린다(y 로 보내면 구조 잠금으로 빨개진다). 런타임 대비 재단언은 열리는 호스트(oak · h)에서.
//      UI 입력(문자열 .value) → decorationValueFromInput: 스키마 선택지 전부가 문자열로 왕복한다.
// 못 재는 것: 허용표의 **측정 사실**(영수증은 private — §7.6, 승격 게이트 재측정이 덮는다).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as STUB_ALLOW from '../src/cell-shape-allow.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import { encodeH } from '../src/h-codec.js';
import { getPreset, PRESETS } from '../src/luminance.js';
import { makeCustomPalette } from '../src/palette-hue.js';
import { centralBeaconEncoderOptions, encodeOptionsForY } from '../src/generator-render-config.js';
import {
  CELL_SHAPES, CELL_SHAPE_ALLOW_KEYS, CELL_SHAPE_DEFAULT, CELL_SHAPE_LOCK_REASONS, CELL_SHAPE_PARAMS,
  CELL_SHAPE_STRUCTURAL_LOCK_REASONS, cellShapeAllowCtx, cellShapeCtx, cellShapeStructuralLock, cellShapeTypeOf,
  resolveCellShapeSpec,
} from '../src/cell-shape.js';
import {
  QR_ALLOW_KEYS, QR_DECO_LOCK_REASONS, QR_DECO_STRUCTURAL_LOCK_REASONS, QR_HOSTS, QR_LOCKED_HOSTS, qrDecoHostOf,
  resolveQrDeco,
} from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES } from '../src/square-cell-style.js';
import {
  H_CELL_STYLE_ALLOW_KEYS, H_CELL_STYLE_LOCK_REASONS, hCellStyleCtx, isHGenerator, resolveHCellStyleSpec,
} from '../src/generator-h.js';
import {
  DECORATION_LOCK_REASON_IDS, DECORATION_STATE_DOMAINS, DECORATION_STATE_KEYS, GENERATOR_STATE_SCHEMA,
  createGeneratorState, decorationValueFromInput, normalizeDecorationState, normalizeDecorationValue,
} from '../src/generator-state.js';
import { GENERATOR_TYPES } from '../src/generator-types.js';

const PAYLOAD = 'https://tl.estre.so';
const SLATE = getPreset('slate');
const FRESH = createGeneratorState();

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ── 선택지 — 스키마 도메인에서 유도 ─────────────────────────────────────────

const D = DECORATION_STATE_DOMAINS;
const optionsOf = (key) => (D[key].kind === 'enum' ? D[key].values : D[key].samples);

/** 셀 모양 선택지: 모양 × 그 모양의 강도 키 도메인(round-bevel 은 고정). */
function cellChoices() {
  const out = [];
  for (const kind of optionsOf('cellShape')) {
    const def = CELL_SHAPE_PARAMS[kind];
    if (!def) { out.push({ cellShape: kind }); continue; }
    for (const v of optionsOf(def.key)) out.push({ cellShape: kind, [def.key]: v });
  }
  return out;
}
/** H 선택지: 스타일 × 바탕. */
function hChoices() {
  return optionsOf('hCellStyle').flatMap((hCellStyle) => optionsOf('hCellGround').map((hCellGround) => ({ hCellStyle, hCellGround })));
}
/** QR 선택지: 스타일 × 모드(custom 은 hue × sat 표본) × 눈(custom 은 hue × sat 표본). */
function qrChoices() {
  const eyes = optionsOf('qrEye').flatMap((qrEye) => (qrEye === 'custom'
    ? optionsOf('qrEyeHue').flatMap((qrEyeHue) => optionsOf('qrEyeSat').map((qrEyeSat) => ({ qrEye, qrEyeHue, qrEyeSat })))
    : [{ qrEye }]));
  const modes = optionsOf('qrColorMode').flatMap((qrColorMode) => (qrColorMode === 'custom'
    ? optionsOf('qrHue').flatMap((qrHue) => optionsOf('qrSat').map((qrSat) => ({ qrColorMode, qrHue, qrSat })))
    : [{ qrColorMode }]));
  const out = [];
  for (const qrCellStyle of optionsOf('qrCellStyle')) for (const m of modes) for (const e of eyes) out.push({ qrCellStyle, ...m, ...e });
  return out;
}
const isCellDefault = (c) => c.cellShape === D.cellShape.defaultValue;
const isHDefault = (c) => c.hCellStyle === D.hCellStyle.defaultValue;
const isQrDefault = (c) => c.qrCellStyle === D.qrCellStyle.defaultValue && c.qrColorMode === D.qrColorMode.defaultValue
  && (c.qrEye === D.qrEye.defaultValue || c.qrEye === 'darker'); // default 의 darker 는 바꿀 것이 없어 none 으로 접힌다

// ── 대표 문맥 — 실제 인코딩 + 상태에서 제품 함수로 유도 ─────────────────────

const N7 = 'central-n7-payload';
const PINWHEEL = 'pinwheel-c2-2-1100-cw';
const yEnc = (locatorProfileY, tone, fallback = { mode: 'corner', corner: 'TL' }) => encodeY(PAYLOAD, encodeOptionsForY({ tone, fallback, locatorProfileY }));
const W = { quietColor: 'white' };
/** 이름 → {ctx, expect: 구조 잠금 기대(설계 §3.1 · §3.2 1차 잠금 목록 — 선택 → 사유|null)}. */
const CTXS = {
  'O n7 TL': { ctx: cellShapeCtx('O', encode(PAYLOAD, centralBeaconEncoderOptions(N7, false)), FRESH, W), expect: () => null },
  'O pinwheel(흰 평탄화)': { ctx: cellShapeCtx('O', encode(PAYLOAD), { ...FRESH, finderPatternId: PINWHEEL, bgMode: 'white' }, { quietColor: 'none' }), expect: () => null },
  'O 불스아이': { ctx: cellShapeCtx('O', encode(PAYLOAD), { ...FRESH, finderPatternId: 'bullseye' }, W), expect: (k) => (k === 'dot' ? 'bullseye-dot' : null) },
  'O cube-bullseye': { ctx: cellShapeCtx('O', encode(PAYLOAD), { ...FRESH, finderPatternId: 'cube-bullseye' }, W), expect: (k) => (k === 'dot' ? 'bullseye-dot' : null) },
  'C(ultra)': { ctx: cellShapeCtx('O', encode(PAYLOAD, { notchC: true, version: 0 }), { ...FRESH, versionO: 'ultra', finderPatternId: PINWHEEL }, W), expect: () => 'type-c-ultra' },
  'G(o-cm)': { ctx: cellShapeCtx('O', encode(PAYLOAD, { cornerMarker: true }), { ...FRESH, innerSeat: 'o-cm', finderPatternId: PINWHEEL }, W), expect: () => null },
  'A n7': { ctx: cellShapeCtx('A', encodeA(PAYLOAD, centralBeaconEncoderOptions(N7, false)), { ...FRESH, type: 'A' }, W), expect: () => null },
  'V(turnA)': { ctx: cellShapeCtx('A', encodeA(PAYLOAD, { turnA: true }), { ...FRESH, type: 'A', turnA: true, finderPatternId: PINWHEEL }, W), expect: () => null },
  'K pinwheel(검정 판)': { ctx: cellShapeCtx('K', encodeK(PAYLOAD), { ...FRESH, type: 'K', finderPatternId: PINWHEEL }, { quietColor: 'black' }), expect: () => null },
  'Y v0 3톤(투명)': { ctx: cellShapeCtx('Y', yEnc('cell-surface-v0', 3), FRESH, { quietColor: 'none' }), expect: () => null },
  'Y v0 3톤(흰 평탄화)': { ctx: cellShapeCtx('Y', yEnc('cell-surface-v0', 3), { ...FRESH, bgMode: 'white' }, { quietColor: 'none' }), expect: () => null },
  'Y v0 2톤': { ctx: cellShapeCtx('Y', yEnc('cell-surface-v0', 2), { ...FRESH, tone: 2, bgMode: 'white' }, { quietColor: 'none' }), expect: () => 'y-two-tone' },
  'Y hex-frame 3톤': { ctx: cellShapeCtx('Y', yEnc('hex-frame-v1', 3), { ...FRESH, bgMode: 'white', locatorProfileY: 'hex-frame-v1' }, { quietColor: 'none' }), expect: (k) => (k === 'gap' || k === 'dot' ? 'y-hex-frame-gap-dot' : null) },
  'Y v0ty 슬롯 3톤': { ctx: cellShapeCtx('Y', yEnc('cell-surface-v0ty', 3), { ...FRESH, bgMode: 'white' }, { quietColor: 'none' }), expect: () => 'y-qr-slot' },
  'Y v0 안쪽 QR 3톤': { ctx: cellShapeCtx('Y', yEnc('cell-surface-v0', 3), { ...FRESH, bgMode: 'white', qrPosition: 'inner' }, { quietColor: 'none' }), expect: () => 'y-inner-qr' },
  'Y 윈도 β': { ctx: cellShapeCtx('Y', yEnc('off', 3, { mode: 'window' }), { ...FRESH, bgMode: 'white', qrPosition: 'inner' }, { quietColor: 'none' }), expect: () => 'y-two-tone' },
};
/** bevel 1.4(돌출)는 문맥 무관 구조 잠금 — 문맥 기대보다 뒤에 적용(문맥 잠금이 먼저 판정된다). */
function expectedStructural(name, choice) {
  const kind = choice.cellShape;
  const byCtx = CTXS[name].expect(kind);
  if (byCtx) return byCtx;
  if (kind === 'bevel' && choice.cellBevel > 1) return 'bevel-raised';
  return null;
}

const H_STATE = createGeneratorState({ type: 'Y', yRepresentation: '3d' });
const H_CTXS = {
  'H2 frame 3톤': { ctx: hCellStyleCtx(encodeH('TL', { version: 2, mode: 3, tones: 3, finder: 'frame', ecc: 'M' }), H_STATE), expect: null },
  'H2 frame 2톤': { ctx: hCellStyleCtx(encodeH('TL', { version: 2, mode: 3, tones: 2, finder: 'frame', ecc: 'M' }), H_STATE), expect: 'h-two-tone' },
  'H5 corners 3톤': { ctx: hCellStyleCtx(encodeH('TL', { version: 5, mode: 3, tones: 3, finder: 'corners', ecc: 'M' }), H_STATE), expect: 'h-corners-finder' },
};

/** 문맥 하나에 대해 선택지 전부를 여는 표(행 = 그 문맥의 표 키 + 모양) — 구조 잠금 «심은 결함» 표. */
function openCellFixture(ctx) {
  const base = cellShapeAllowCtx(ctx);
  return deepFreeze({
    ROWS: cellChoices().filter((c) => !isCellDefault(c)).map((c) => {
      const def = CELL_SHAPE_PARAMS[c.cellShape];
      return { ...base, cellShape: c.cellShape, param: def ? c[def.key] : null };
    }),
  });
}
function openHFixture(ctx) {
  return deepFreeze({
    ROWS: hChoices().filter((c) => !isHDefault(c)).map((c) => {
      const row = { table: 'h', hCellStyle: c.hCellStyle, ground: c.hCellGround };
      for (const k of H_CELL_STYLE_ALLOW_KEYS) if (k !== 'ground') row[k] = ctx[k];
      return row;
    }),
  });
}
const OPEN_QR = deepFreeze({
  ROWS: QR_HOSTS.flatMap((host) => optionsOf('qrCellStyle').flatMap((qrCellStyle) => optionsOf('qrColorMode')
    .flatMap((qrColorMode) => optionsOf('qrEye').map((eyeMode) => ({ table: 'qr', host, qrCellStyle, qrColorMode, eyeMode }))))),
});

// ── ① 허용표 내부 일관성 ─────────────────────────────────────────────────

const SHAPE_KEYS = Object.freeze({
  oak: ['cellShape', 'param'], y: ['cellShape', 'param'], h: ['hCellStyle'], qr: [],
});
const TABLE_KEYS = Object.freeze({
  oak: CELL_SHAPE_ALLOW_KEYS.oak, y: CELL_SHAPE_ALLOW_KEYS.y, h: H_CELL_STYLE_ALLOW_KEYS, qr: QR_ALLOW_KEYS,
});

/** 허용표 결함 목록(빈 배열 = 일관). */
function tableProblems(allow) {
  const out = [];
  if (!Array.isArray(allow.ROWS)) return ['ROWS 가 배열이 아니다'];
  const meta = [allow.RECEIPT_SHA256, allow.MEASURED_AT, allow.FINGERPRINT];
  if (!(meta.every((v) => v === null) || meta.every((v) => v !== null && v !== undefined))) out.push('영수증 sha · 측정 시각 · 지문은 셋이 함께 있거나 함께 없어야 한다');
  if (allow.RECEIPT_SHA256 !== null) {
    if (!/^[0-9a-f]{64}$/.test(String(allow.RECEIPT_SHA256))) out.push('RECEIPT_SHA256 이 sha256 hex 가 아니다');
    if (Number.isNaN(Date.parse(String(allow.MEASURED_AT)))) out.push('MEASURED_AT 이 ISO 시각이 아니다');
    if (!allow.FINGERPRINT || typeof allow.FINGERPRINT.head !== 'string') out.push('FINGERPRINT.head 가 없다');
  } else if (allow.ROWS.length > 0) out.push('행이 있는데 영수증이 없다');
  const seen = new Set();
  allow.ROWS.forEach((row, i) => {
    const where = `ROWS[${i}]`;
    const keys = TABLE_KEYS[row && row.table];
    if (!keys) { out.push(`${where}: 모르는 표 ${row && row.table}`); return; }
    const want = ['table', ...keys, ...SHAPE_KEYS[row.table]].sort();
    const got = Object.keys(row).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${where}: 키 ${got} ≠ ${want}`);
    if (Object.values(row).some((v) => v !== null && typeof v === 'object')) out.push(`${where}: 원시값이 아닌 값`);
    const sig = JSON.stringify(want.map((k) => row[k]));
    if (seen.has(sig)) out.push(`${where}: 중복 행`);
    seen.add(sig);
    if (row.table === 'oak' || row.table === 'y') {
      if (row.cellShape === CELL_SHAPE_DEFAULT || !CELL_SHAPES.includes(row.cellShape)) out.push(`${where}: cellShape ${row.cellShape}`);
      const def = CELL_SHAPE_PARAMS[row.cellShape];
      if (def ? !def.domain.includes(row.param) : row.param !== null) out.push(`${where}: param ${row.param}`);
      if (cellShapeStructuralLock(row.table, row.cellShape, row.param, row) !== null) out.push(`${where}: 구조 잠금에 걸린 죽은 행`);
    } else if (row.table === 'h') {
      if (!SQUARE_CELL_STYLES.includes(row.hCellStyle) || row.hCellStyle === D.hCellStyle.defaultValue) out.push(`${where}: hCellStyle ${row.hCellStyle}`);
      if (row.tones === 2 || row.finder === 'corners') out.push(`${where}: 구조 잠금에 걸린 죽은 행(H)`);
    } else {
      if (QR_LOCKED_HOSTS.includes(row.host)) out.push(`${where}: 구조 잠금 호스트 ${row.host} 의 죽은 행`);
      if (!QR_HOSTS.includes(row.host)) out.push(`${where}: host ${row.host}`);
    }
  });
  return out;
}

test('① 허용표 내부 일관성 · 지문 — 기본 표(스텁)는 결함 0 · 전부 잠금 스텁 모양', () => {
  assert.deepEqual(tableProblems(STUB_ALLOW), []);
  assert.ok(Object.isFrozen(STUB_ALLOW.ROWS));
  if (STUB_ALLOW.ROWS.length === 0) assert.equal(STUB_ALLOW.RECEIPT_SHA256, null, '스텁: 영수증 없음');
});

test('① 판정 함수 판별력 — 심은 결함 표마다 해당 결함을 잡는다', () => {
  const okOak = { table: 'oak', ...cellShapeAllowCtx(CTXS['O n7 TL'].ctx), cellShape: 'round', param: 0.7 };
  const receipt = { RECEIPT_SHA256: 'a'.repeat(64), MEASURED_AT: '2026-09-26T00:00:00Z', FINGERPRINT: { head: 'x' } };
  assert.deepEqual(tableProblems({ ROWS: [okOak], ...receipt }), [], '대조군: 정상 행 + 영수증');
  const plants = [
    ['행 있는데 영수증 없음', { ROWS: [okOak], RECEIPT_SHA256: null, MEASURED_AT: null, FINGERPRINT: null }],
    ['메타 셋 불일치', { ROWS: [], RECEIPT_SHA256: 'a'.repeat(64), MEASURED_AT: null, FINGERPRINT: null }],
    ['키 빠짐', { ROWS: [(() => { const r = { ...okOak }; delete r.qrPosition; return r; })()], ...receipt }],
    ['여분 키', { ROWS: [{ ...okOak, role: 'data' }], ...receipt }],
    ['중복', { ROWS: [okOak, { ...okOak }], ...receipt }],
    ['도메인 밖 param', { ROWS: [{ ...okOak, param: 0.5 }], ...receipt }],
    ['구조 잠금 죽은 행(C)', { ROWS: [{ ...okOak, type: 'C' }], ...receipt }],
    ['구조 잠금 죽은 행(bevel 1.4)', { ROWS: [{ ...okOak, cellShape: 'bevel', param: 1.4 }], ...receipt }],
    ['구조 잠금 죽은 행(Y 호스트 QR)', { ROWS: [{ table: 'qr', host: 'y', qrCellStyle: 'dots', qrColorMode: 'custom', eyeMode: 'none' }], ...receipt }],
    ['구조 잠금 죽은 행(H 2톤)', { ROWS: [{ table: 'h', version: 2, finder: 'frame', tones: 2, ground: 'level5', paletteGrade: 'slate', hCellStyle: 'dots' }], ...receipt }],
  ];
  for (const [name, table] of plants) assert.ok(tableProblems(table).length > 0, `심은 결함을 못 잡았다: ${name}`);
});

// ── ② · ③ · ④ 선택지 분류 ─────────────────────────────────────────────────

const REASON_IDS = new Set(DECORATION_LOCK_REASON_IDS);

function assertClassified(res, isDefault, key, where) {
  const val = res[key];
  if (isDefault) {
    assert.deepEqual(res, { [key]: null }, `${where}: 기본값은 사유 없는 null`);
    return 'default';
  }
  if (val !== null) {
    assert.equal(res.lockReason, undefined, `${where}: 허용인데 사유가 붙었다`);
    return 'allowed';
  }
  assert.ok(REASON_IDS.has(res.lockReason), `${where}: 잠금 사유 ${res.lockReason} 가 안정 id 목록에 없다`);
  return 'locked';
}

test('② 스텁 표: 셀 모양 선택지 전부 × 대표 문맥 전부 → 기본값이거나 «잠금 + 사유» · 상태 불변', () => {
  const choices = cellChoices();
  assert.equal(choices.length, 1 + 3 + 2 + 1 + 2 + 2, '스키마 유도 선택지 수(모양 × 강도)');
  for (const [name, { ctx }] of Object.entries(CTXS)) {
    assert.ok(ctx, `${name}: 문맥 null`);
    for (const c of choices) {
      const st = deepFreeze({ ...FRESH, ...c });
      const before = JSON.stringify(st);
      const kind = assertClassified(resolveCellShapeSpec(st, ctx), isCellDefault(c), 'spec', `${name} ${JSON.stringify(c)}`);
      assert.notEqual(kind, 'allowed', `${name} ${JSON.stringify(c)}: 스텁에서 열렸다`);
      assert.equal(JSON.stringify(st), before);
    }
  }
});

test('③ 구조 잠금: 그 행을 넣은 표로도 잠긴다 · 기대 사유와 정확히 같다 · 나머지는 열린다(판별력)', () => {
  const hit = new Set();
  for (const [name, { ctx }] of Object.entries(CTXS)) {
    const open = openCellFixture(ctx);
    for (const c of cellChoices().filter((x) => !isCellDefault(x))) {
      const st = deepFreeze({ ...FRESH, ...c });
      const res = resolveCellShapeSpec(st, ctx, open);
      const want = expectedStructural(name, c);
      const where = `${name} ${JSON.stringify(c)}`;
      if (want === null) {
        const def = CELL_SHAPE_PARAMS[c.cellShape];
        assert.deepEqual(res, { spec: { kind: c.cellShape, param: def ? c[def.key] : null } }, `${where}: 행이 있는데 안 열렸다`);
      } else {
        assert.deepEqual(res, { spec: null, lockReason: want }, `${where}: 구조 잠금이 아니다`);
        hit.add(want);
      }
    }
  }
  // 윈도 β 는 2톤이 먼저 잡는다 — qrWindow 단독 경로는 문맥 한 키만 뒤집어 잰다(실제 인코딩은 3톤 윈도가 없다).
  const v0 = CTXS['Y v0 3톤(흰 평탄화)'].ctx;
  const winOnly = { ...v0, qrWindow: true };
  assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, winOnly, openCellFixture(v0)).lockReason, CELL_SHAPE_LOCK_REASONS.Y_INNER_QR);
  assert.deepEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, v0, openCellFixture(v0)), { spec: { kind: 'bevel', param: 0.6 } });
  hit.add(CELL_SHAPE_LOCK_REASONS.Y_INNER_QR);
  assert.deepEqual([...hit].sort(), [...CELL_SHAPE_STRUCTURAL_LOCK_REASONS].sort(), '모든 구조 잠금 사유가 실제 문맥에서 난다');
});

test('③ 구조 잠금 문맥 키가 빠지면 잠근다(fail-closed) — 추측으로 열지 않는다', () => {
  const v0 = CTXS['Y v0 3톤(흰 평탄화)'].ctx;
  for (const k of ['qrPosition', 'qrWindow', 'qrSlot', ...CELL_SHAPE_ALLOW_KEYS.y]) {
    const ctx = { ...v0 };
    delete ctx[k];
    assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx, openCellFixture(v0)).lockReason, CELL_SHAPE_LOCK_REASONS.CTX_INCOMPLETE, k);
  }
  // gapGrade 는 렌더 뒤 값 — render 가 없으면 잠긴다.
  const noRender = cellShapeCtx('Y', yEnc('cell-surface-v0', 3), { ...FRESH, bgMode: 'white' });
  assert.equal(noRender.gapGrade, undefined);
  assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, noRender, openCellFixture(v0)).lockReason, CELL_SHAPE_LOCK_REASONS.CTX_INCOMPLETE);
});

test('② · ③ H: 스텁 전부 잠금 · 열림 표에서도 2톤 · corners 는 구조 잠금 · 상태 불변', () => {
  const hit = new Set();
  for (const [name, { ctx, expect }] of Object.entries(H_CTXS)) {
    const open = openHFixture(ctx);
    for (const c of hChoices()) {
      const st = deepFreeze({ ...H_STATE, ...c });
      const before = JSON.stringify(st);
      const where = `${name} ${JSON.stringify(c)}`;
      const stub = assertClassified(resolveHCellStyleSpec(st, ctx), isHDefault(c), 'spec', where);
      assert.notEqual(stub, 'allowed', where);
      const res = resolveHCellStyleSpec(st, ctx, open);
      assertClassified(res, isHDefault(c), 'spec', where);
      if (!isHDefault(c)) {
        if (expect === null) assert.deepEqual(res.spec, { style: c.hCellStyle, ground: c.hCellGround }, where);
        else { assert.deepEqual(res, { spec: null, lockReason: expect }, where); hit.add(expect); }
      }
      assert.equal(JSON.stringify(st), before);
    }
  }
  assert.deepEqual([...hit].sort(), [H_CELL_STYLE_LOCK_REASONS.CORNERS_FINDER, H_CELL_STYLE_LOCK_REASONS.TWO_TONE].sort());
});

test('② · ③ 폴백 QR: 선택지 전부 × 호스트 3 — 스텁 전부 잠금 · 열림 표에서 y 호스트만 구조 잠금 · 상태 불변', () => {
  const choices = qrChoices();
  assert.ok(choices.length > 100, '스키마 유도 선택지');
  let yLocked = 0;
  for (const host of QR_HOSTS) {
    for (const c of choices) {
      const st = deepFreeze({ ...FRESH, ...c });
      const before = JSON.stringify(st);
      const where = `${host} ${JSON.stringify(c)}`;
      const stub = assertClassified(resolveQrDeco(st, SLATE, host), isQrDefault(c), 'deco', where);
      assert.notEqual(stub, 'allowed', where);
      const res = resolveQrDeco(st, SLATE, host, OPEN_QR);
      const kind = assertClassified(res, isQrDefault(c), 'deco', where);
      if (!isQrDefault(c)) {
        if (QR_LOCKED_HOSTS.includes(host)) {
          assert.equal(res.lockReason, QR_DECO_LOCK_REASONS.Y_HOST, where);
          yLocked += 1;
        } else {
          assert.equal(kind, 'allowed', `${where}: 열림 표 · 대비 가드 안인데 잠겼다(${res.lockReason})`);
        }
      }
      assert.equal(JSON.stringify(st), before);
    }
  }
  assert.ok(yLocked > 0);
  assert.deepEqual([...QR_DECO_STRUCTURAL_LOCK_REASONS], [QR_DECO_LOCK_REASONS.Y_HOST]);
});

test('안정 사유 id: 모듈별 사유 전부가 합집합 목록에 있고 중복 없는 문자열이다', () => {
  const all = [
    ...Object.values(CELL_SHAPE_LOCK_REASONS), ...Object.values(H_CELL_STYLE_LOCK_REASONS), ...Object.values(QR_DECO_LOCK_REASONS),
  ];
  for (const r of all) assert.ok(REASON_IDS.has(r), r);
  assert.equal(new Set(DECORATION_LOCK_REASON_IDS).size, DECORATION_LOCK_REASON_IDS.length);
  for (const r of DECORATION_LOCK_REASON_IDS) assert.match(r, /^[a-z0-9-]+$/, r);
  for (const r of CELL_SHAPE_STRUCTURAL_LOCK_REASONS) assert.ok(Object.values(CELL_SHAPE_LOCK_REASONS).includes(r), r);
});

// ── ⑤ 정규화 ──────────────────────────────────────────────────────────────

test('⑤ 상태 정규화: 도메인 안은 그대로 · 부재/문자열/범위 밖/정수 아님 → 기본값', () => {
  for (const key of DECORATION_STATE_KEYS) {
    const d = D[key];
    assert.equal(GENERATOR_STATE_SCHEMA[key].exposure, 'both', `${key}: 노출 BOTH(§2.2)`);
    const valid = d.kind === 'enum' ? d.values : [...d.samples, d.min + 1, d.max - 1, Math.floor((d.min + d.max) / 2)];
    for (const v of valid) assert.equal(normalizeDecorationValue(key, v), v, `${key}=${v}`);
    const bad = [undefined, null, NaN, Infinity, {}, [], true, 'square', String(valid[0])];
    if (d.kind === 'int') bad.push(d.min - 1, d.max + 1, d.min + 0.5);
    else bad.push('nope', 0.5, 999);
    for (const v of bad) {
      if (d.kind === 'enum' && d.values.includes(v)) continue;
      assert.equal(normalizeDecorationValue(key, v), d.defaultValue, `${key}=${String(v)} → 기본값`);
    }
  }
  assert.throws(() => normalizeDecorationValue('bgMode', 'white'), RangeError);
  // 복원 입력 경로(createGeneratorState)도 같은 정규화를 탄다.
  const s = createGeneratorState({ customSat: '150', qrHue: 400, qrSat: -5, cellRound: 0.5, qrEye: 'glow', hCellGround: 'grey' });
  for (const k of ['customSat', 'qrHue', 'qrSat', 'cellRound', 'qrEye', 'hCellGround']) assert.equal(s[k], D[k].defaultValue, k);
  // 입력은 고치지 않는다.
  const input = deepFreeze({ customSat: 999, preset: 'slate' });
  const out = normalizeDecorationState(input);
  assert.equal(input.customSat, 999);
  assert.equal(out.customSat, D.customSat.defaultValue);
  assert.equal(out.preset, 'slate');
});

test('⑤ 정규화를 거친 채도로는 makeCustomPalette 가 RangeError 를 내지 않는다(L1 도메인 가드를 UI 가 못 만난다)', () => {
  const fuzz = [undefined, '120', -1, 0, 1, 99.5, 100, 150, 200, 201, 1e9, NaN, null, -Infinity];
  for (const raw of fuzz) {
    const sat = normalizeDecorationValue('customSat', raw);
    assert.doesNotThrow(() => makeCustomPalette(210, 'custom', sat), String(raw));
  }
  // 대조: 정규화 없이 넣으면 던진다(가드가 실제로 있다 — 공허한 초록 아님).
  assert.throws(() => makeCustomPalette(210, 'custom', 201), RangeError);
  // 팔레트 등급 키(preset)는 이 표의 소관이 아니다 — 프리셋 목록이 스키마 허용값과 같은지만 본다.
  assert.deepEqual(GENERATOR_STATE_SCHEMA.preset.options, [...Object.keys(PRESETS), 'custom']);
});

// ── ⑥ 생성기 상태 → QR 호스트 · UI 입력 경로 (검토 지적 D1-major · minor 1, 2026-09-26) ──────────────

test('⑥ 생성기 상태 → QR 호스트: H(Y+3d) 는 h — 셀 모양 · H 판정과 같은 격자 · h 행 하나로 실제로 열린다', () => {
  // 생성기 상태의 H 는 type 'Y' + yRepresentation '3d' 다(GENERATOR_TYPES 에 'H' 없음). 격자 = 타입 × 표현 선택지(스키마 유도).
  assert.ok(!GENERATOR_TYPES.includes('H'));
  const reps = GENERATOR_STATE_SCHEMA.yRepresentation.options;
  let hSeen = 0;
  for (const type of GENERATOR_TYPES) {
    for (const yRepresentation of reps) {
      const st = createGeneratorState({ type, yRepresentation });
      const host = qrDecoHostOf(st.type, st);
      const where = `${type}/${yRepresentation}`;
      assert.ok(QR_HOSTS.includes(host), where);
      // 세 판정의 일치: qrDecoHostOf 'h' ⇔ isHGenerator ⇔ (Y 이면서) cellShapeTypeOf === null.
      assert.equal(host === 'h', isHGenerator(st), where);
      assert.equal(host === 'h', type === 'Y' && cellShapeTypeOf(st.type, null, st) === null, where);
      assert.equal(host === 'y', type === 'Y' && !isHGenerator(st), where);
      if (host === 'h') hSeen += 1;
    }
  }
  assert.ok(hSeen > 0, 'H 상태가 격자에 있다');
  // 끝단: H 상태 + 비기본 QR 선택 + «h 호스트 행 하나» 만 있는 표 → 꾸밈이 실제로 나온다(qr-y-host 가 아니다).
  // 호스트를 'y' 로 보내면 구조 잠금, 'oak' 로 보내면 qr-unmeasured 로 빨개진다.
  const hState = deepFreeze(createGeneratorState({ type: 'Y', yRepresentation: '3d', qrCellStyle: 'dots' }));
  const onlyH = deepFreeze({ ROWS: [{ table: 'qr', host: 'h', qrCellStyle: 'dots', qrColorMode: 'default', eyeMode: 'none' }] });
  const r = resolveQrDeco(hState, SLATE, qrDecoHostOf(hState.type, hState), onlyH);
  assert.notEqual(r.lockReason, QR_DECO_LOCK_REASONS.Y_HOST);
  assert.equal(r.deco && r.deco.cellStyle, 'dots', JSON.stringify(r));
  // 같은 선택의 Y 2.5D 는 구조 잠금 그대로(양성 단언).
  const yState = deepFreeze(createGeneratorState({ type: 'Y', yRepresentation: '2.5d', qrCellStyle: 'dots' }));
  assert.equal(resolveQrDeco(yState, SLATE, qrDecoHostOf(yState.type, yState), OPEN_QR).lockReason, QR_DECO_LOCK_REASONS.Y_HOST);
});

test('⑥ 런타임 대비 재단언은 열리는 호스트(oak · h)에서 잰다 · y 는 그보다 먼저 구조 잠금', () => {
  // qr-colors.test 의 런타임 재단언이 y 호스트만 썼다 — 구조 잠금이 앞서 걸리면 가드 경로가 안 지나간다. 여기서 덮는다.
  const bright = deepFreeze({ name: 'slate', label: 'x', background: SLATE.background,
    levels: [{ r: 150, g: 150, b: 150 }, SLATE.levels[1], SLATE.levels[2]] });
  for (const host of QR_HOSTS) {
    const r = resolveQrDeco({ qrColorMode: 'match' }, bright, host, OPEN_QR);
    assert.equal(r.deco, null, host);
    if (QR_LOCKED_HOSTS.includes(host)) { assert.equal(r.lockReason, QR_DECO_LOCK_REASONS.Y_HOST, host); continue; }
    assert.equal(r.lockReason, QR_DECO_LOCK_REASONS.CONTRAST, host);
    assert.ok(r.failures.some((f) => f.gate === 'G4'), host);
    // 대조: 같은 호스트 · 같은 표에서 정상 기저 팔레트면 열린다(가드가 잠금의 원인이다).
    assert.ok(resolveQrDeco({ qrColorMode: 'match' }, SLATE, host, OPEN_QR).deco, host);
  }
});

test('⑥ UI 입력(문자열 .value) → 값: 스키마 선택지 전부가 문자열로 왕복한다 · 빈 값/쓰레기는 기본값', () => {
  let numericKeys = 0;
  let snappedWithoutHelper = 0;
  for (const key of DECORATION_STATE_KEYS) {
    const d = D[key];
    for (const v of optionsOf(key)) {
      assert.equal(decorationValueFromInput(key, String(v)), v, `${key}='${String(v)}'`);
      assert.equal(decorationValueFromInput(key, v), v, `${key}=${String(v)}`);
      // 판별력: 문자열을 곧장 정규화하면 숫자 키의 비기본 선택은 기본값으로 튄다(도우미가 필요한 이유).
      if (typeof v === 'number' && v !== d.defaultValue) {
        assert.equal(normalizeDecorationValue(key, String(v)), d.defaultValue, key);
        snappedWithoutHelper += 1;
      }
    }
    const numeric = optionsOf(key).every((v) => typeof v === 'number');
    if (numeric) numericKeys += 1;
    for (const junk of ['', '  ', 'abc', 'NaN', '1e999']) {
      assert.equal(decorationValueFromInput(key, junk), d.defaultValue, `${key}='${junk}'`);
    }
    if (d.kind === 'int') {
      assert.equal(decorationValueFromInput(key, String(d.max + 1)), d.defaultValue, key);
      assert.equal(decorationValueFromInput(key, String(d.min + 0.5)), d.defaultValue, key);
    }
  }
  assert.ok(numericKeys >= 8, `숫자 키 ${numericKeys}`);
  assert.ok(snappedWithoutHelper > 0);
  assert.throws(() => decorationValueFromInput('bgMode', 'white'), RangeError);
  // 도우미를 거친 채도는 L1 가드를 못 만난다.
  for (const raw of ['', '201', '-1', '150', '99.5']) {
    assert.doesNotThrow(() => makeCustomPalette(210, 'custom', decorationValueFromInput('customSat', raw)), raw);
  }
});
