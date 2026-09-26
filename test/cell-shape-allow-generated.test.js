// cell-shape-allow-generated.test.js — **생성된** 허용표(src/cell-shape-allow.js)의 성질 (DESIGN_001 §3.4 · §7.6, 2026-09-27)
//
// 허용표는 L6 측정 영수증에서 생성된다(손으로 고치지 않는다). 측정 사실(어떤 행이 왜 있는가)은 private 영수증에 있어
// 여기서 잴 수 없다 — 이 자는 «표가 제품 코드와 맞물리는가» 만 잰다. 재측정 때마다 바뀌는 값(행 수 · 특정 행)은 박제하지
// 않는다(박제하면 다음 재생성이 이유 없이 빨개진다 — 교훈 «철자를 재는 자는 썩는다»).
//
// 재는 것(성질):
//   ⓐ 머리 상수 — RECEIPT_SHA256 64-hex · MEASURED_AT 가 왕복하는 ISO 8601 · FINGERPRINT 가 지문 필드 넷(head 40-hex ·
//      번들/소스 sha 64-hex)을 정확히 가진다 · 표 · 행 · 지문이 동결돼 있다.
//   ⓑ 행 모양 — 모든 행이 제 표의 키 목록(CELL_SHAPE_ALLOW_KEYS · H_CELL_STYLE_ALLOW_KEYS · QR_ALLOW_KEYS — 코드에서 읽는다)
//      + 모양 키와 **정확히** 같은 키를 가진다. 머리 주석 «행 모양» 줄이 적은 키 순서도 코드 목록과 같다.
//   ⓒ 값 도메인 — 스키마(GENERATOR_STATE_SCHEMA · DECORATION_STATE_DOMAINS)와 모듈 상수에서 유도한다(손 목록 없음).
//      y 행의 seamAdjacent 는 제품 값(Y_SEAM_ADJACENT_PRODUCT)만 — 제품 문맥이 다른 값을 안 만들므로 그 행은 죽은 행이다.
//   ⓓ 구조 잠금에 걸린 «죽은 행» 0 — cellShapeStructuralLock · QR_LOCKED_HOSTS · H resolver 의 2톤/corners 사유로 판정.
//   ⓔ 정렬 — 머리 주석의 규칙(표 순서 → 표 키 순서대로 값, null < boolean < number < string)대로 **엄격히** 오름차순
//      (= 결정적 · 중복 0). 머리 주석의 표별 행 수가 실제 행 수와 같다(수치는 박제하지 않고 주석 ↔ 표를 대조한다).
//   ⓕ 각 행이 resolver 에서 **실제로 열린다** — 행의 문맥으로 resolver 를 부르면 spec 이 나오고, 같은 호출을 빈 표로
//      하면 잠긴다(열림의 원인이 그 행이다). H 행은 실제 encodeH 가 그 문맥을 만든다(제품이 도달할 수 있는 문맥).
//   ⓖ 판별력 — 생성 표 사본에 결함을 하나씩 심으면(구조 잠금 행 · 키 빠진 행 · 중복 행 · 순서 뒤집기 · 도메인 밖 ·
//      여분 키 · 메타 결함 · 주석 행 수 어긋남) 그 결함의 범주가 **각각** 잡힌다.
//   ⓗ 잠금 사유가 표에서 유도된다 — 흰 틈 노출형 행의 미지 틈 문맥은 (열리지 않으면) exposed-gap, 표에 없는 버전 · n 은
//      unmeasured(«틈 탓» 이라 말하지 않는다 — 2026-09-27 화면의 Y n21 오안내).
// 못 재는 것: 행이 측정적으로 참인가(영수증 · 승격 게이트 재측정의 몫 — §7.6). y 행의 구조 잠금 문맥 키(qrPosition ·
//   qrWindow · qrSlot)는 표에 없어 «제품 기본 Y(코너 QR · 윈도 아님 · 슬롯 없음)» 값으로 채워 잰다 — 다른 QR 배치에서
//   열리는지는 이 자 밖이다(구조 잠금 쪽은 cell-shape-allowlist ③ 이 잰다).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CELL_SHAPES, CELL_SHAPE_ALLOW_KEYS, CELL_SHAPE_DEFAULT, CELL_SHAPE_LOCK_CTX_KEYS, CELL_SHAPE_PARAMS, CELL_GAP_GRADES,
  EXPOSED_CELL_SHAPES, Y_SEAM_ADJACENT_PRODUCT, cellShapeStructuralLock, resolveCellShapeSpec,
} from '../src/cell-shape.js';
import {
  H_CELL_GROUNDS, H_CELL_STYLE_ALLOW_KEYS, H_CELL_STYLE_DEFAULT, H_CELL_STYLE_LOCK_REASONS, hCellStyleCtx,
  resolveHCellStyleSpec,
} from '../src/generator-h.js';
import {
  QR_ALLOW_KEYS, QR_COLOR_MODES, QR_DECO_DEFAULTS, QR_EYE_MODES, QR_HOSTS, QR_LOCKED_HOSTS, resolveQrDeco,
} from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES } from '../src/square-cell-style.js';
import { DECORATION_STATE_DOMAINS, GENERATOR_STATE_SCHEMA, createGeneratorState } from '../src/generator-state.js';
import { LOCATOR_PROFILES_Y } from '../src/locatorY.js';
import { CELL_SURFACE_FINAL_IDS } from '../src/cellSurfaceFinal.js';
import { CELL_SURFACE_LAYOUT_IDS } from '../src/cellSurfaceLayouts.js';
import { encodeH } from '../src/h-codec.js';
import { getPreset } from '../src/luminance.js';

// 표는 URL 하나로 읽는다 — 모듈과 머리 주석이 같은 파일에서 온다(심은 결함 사본 실행도 이 한 줄만 바꾼다).
const ALLOW_URL = new URL('../src/cell-shape-allow.js', import.meta.url);
const GEN = await import(ALLOW_URL.href);
const HEADER = readFileSync(ALLOW_URL, 'utf8').split('export const ROWS')[0];

/** 명시적 빈 표 — 스텁 모양(행 0 · 영수증 없음). «열림의 원인이 그 행인가» 를 가르는 대조군. */
const EMPTY = Object.freeze({ ROWS: Object.freeze([]), RECEIPT_SHA256: null, MEASURED_AT: null, FINGERPRINT: null });

const SCHEMA = GENERATOR_STATE_SCHEMA;
const D = DECORATION_STATE_DOMAINS;
const FRESH = createGeneratorState();

// ── 표별 키 · 도메인 (코드에서 유도) ────────────────────────────────────────

/** 표 → 행 키 순서(table 제외) = 문맥 키 + 모양 키. 문맥 키는 코드 목록, 모양 키는 resolver 가 행에서 읽는 이름. */
const ROW_KEYS = Object.freeze({
  oak: [...CELL_SHAPE_ALLOW_KEYS.oak, 'cellShape', 'param'],
  y: [...CELL_SHAPE_ALLOW_KEYS.y, 'cellShape', 'param'],
  h: [...H_CELL_STYLE_ALLOW_KEYS, 'hCellStyle'],
  qr: [...QR_ALLOW_KEYS],
});

/**
 * y 행 구조 잠금 문맥 키(표 밖)의 «제품 기본 Y» 값 — 코너 QR(상태 기본 qrPosition) · 윈도 아님 · 슬롯 없음.
 * 키 목록은 cell-shape.js 에서 읽는다 — 키가 늘면 여기서 던진다(빠진 키는 resolver 가 ctx-incomplete 로 잠가
 * ⓕ 가 엉뚱한 사유로 빨개진다).
 */
const Y_LOCK_CTX = Object.freeze({ qrPosition: FRESH.qrPosition, qrWindow: false, qrSlot: false });
{
  const want = [...CELL_SHAPE_LOCK_CTX_KEYS.y].sort().join(',');
  const have = Object.keys(Y_LOCK_CTX).sort().join(',');
  if (want !== have) throw new Error(`y 구조 잠금 문맥 키 어긋남: 모듈 ${want} · 자 ${have}`);
  if (CELL_SHAPE_LOCK_CTX_KEYS.oak.length !== 0) throw new Error('oak 구조 잠금 문맥 키가 생겼다 — cellCtxOf 에 채워라');
  if (FRESH.qrPosition === 'inner') throw new Error('제품 기본 qrPosition 이 inner 다 — Y_LOCK_CTX 가 잠그는 값이 됐다');
}

const optionsOf = (key) => SCHEMA[key].options;
const Y_LAYOUTS = new Set(['none', ...CELL_SURFACE_FINAL_IDS, ...CELL_SURFACE_LAYOUT_IDS]); // cellShapeCtx: 인코딩 ?? 'none'

/** 문맥 키 → 값 검사(참 = 도메인 안). 셀 표 공통 키는 스키마 · 모듈 상수에서. */
const CELL_COMMON_DOMAIN = {
  tones: (v) => optionsOf('tone').includes(v),
  gapGrade: (v) => CELL_GAP_GRADES.includes(v),
  bgMode: (v) => optionsOf('bgMode').includes(v),
  paletteGrade: (v) => optionsOf('preset').includes(v),
};
const DOMAIN = {
  oak: {
    ...CELL_COMMON_DOMAIN,
    // type 은 resolver 가 표를 고르는 값 — ⓕ(행이 실제로 열린다)가 oak 계열인지 판정한다. 여기선 문자열만.
    type: (v) => typeof v === 'string' && v.length > 0,
    version: (v) => Number.isInteger(v) && v >= 0,
    finderPatternId: (v) => optionsOf('finderPatternId').includes(v),
    qrPosition: (v) => optionsOf('qrPosition').includes(v),
  },
  y: {
    ...CELL_COMMON_DOMAIN,
    cellSurfaceLayout: (v) => Y_LAYOUTS.has(v),
    locatorProfile: (v) => LOCATOR_PROFILES_Y.includes(v),
    nBand: (v) => typeof v === 'string' && /^[1-9]\d*$/.test(v),
    seamAdjacent: (v) => v === Y_SEAM_ADJACENT_PRODUCT,
  },
  h: {
    // version · finder · tones 는 ⓕ 의 encodeH 실현이 잰다(normalizeHProfile 가 도메인 밖을 던진다).
    version: (v) => Number.isInteger(v),
    finder: (v) => typeof v === 'string',
    tones: (v) => optionsOf('tone').includes(v),
    ground: (v) => H_CELL_GROUNDS.includes(v),
    paletteGrade: (v) => optionsOf('preset').includes(v),
    hCellStyle: (v) => SQUARE_CELL_STYLES.includes(v) && D.hCellStyle.values.includes(v) && v !== H_CELL_STYLE_DEFAULT,
  },
  qr: {
    host: (v) => QR_HOSTS.includes(v),
    qrCellStyle: (v) => D.qrCellStyle.values.includes(v),
    qrColorMode: (v) => QR_COLOR_MODES.includes(v) && D.qrColorMode.values.includes(v),
    eyeMode: (v) => QR_EYE_MODES.includes(v) && D.qrEye.values.includes(v),
  },
};
for (const [table, keys] of Object.entries(ROW_KEYS)) {
  const shapeKeys = table === 'oak' || table === 'y' ? ['cellShape', 'param'] : [];
  const missing = keys.filter((k) => !shapeKeys.includes(k) && !DOMAIN[table][k]);
  if (missing.length) throw new Error(`${table}: 도메인 검사가 없는 키 ${missing} — 키 목록이 늘었다, DOMAIN 에 채워라`);
}

// ── 행 → resolver 호출 ──────────────────────────────────────────────────────

/** 셀 행의 문맥(resolver 입력) — 표 키 + (y) 제품 기본 구조 잠금 키. type 은 oak 행의 값, y 는 'Y'. */
function cellCtxOf(row) {
  const ctx = { table: row.table };
  for (const k of CELL_SHAPE_ALLOW_KEYS[row.table]) ctx[k] = row[k];
  if (row.table === 'y') Object.assign(ctx, { type: 'Y' }, Y_LOCK_CTX);
  return ctx;
}
function cellStateOf(row) {
  const def = CELL_SHAPE_PARAMS[row.cellShape];
  return def ? { cellShape: row.cellShape, [def.key]: row.param } : { cellShape: row.cellShape };
}
function hCtxOf(row) {
  const ctx = {};
  for (const k of H_CELL_STYLE_ALLOW_KEYS) if (k !== 'ground') ctx[k] = row[k];
  return ctx;
}
const hStateOf = (row) => ({ hCellStyle: row.hCellStyle, hCellGround: row.ground, preset: row.paletteGrade });
const qrStateOf = (row) => ({ qrCellStyle: row.qrCellStyle, qrColorMode: row.qrColorMode, qrEye: row.eyeMode });
const QR_BASE = getPreset('slate');

/** 행 하나를 resolver 에 넣은 결과 {opened, lockReason} — allow 는 호출자가 고른다(생성 표 · 빈 표). */
function resolveRow(row, allow) {
  if (row.table === 'oak' || row.table === 'y') {
    const res = resolveCellShapeSpec(Object.freeze(cellStateOf(row)), Object.freeze(cellCtxOf(row)), allow);
    const want = { kind: row.cellShape, param: row.param };
    return { opened: JSON.stringify(res) === JSON.stringify({ spec: want }), lockReason: res.lockReason ?? null };
  }
  if (row.table === 'h') {
    const res = resolveHCellStyleSpec(Object.freeze(hStateOf(row)), Object.freeze(hCtxOf(row)), allow);
    const want = { style: row.hCellStyle, ground: row.ground };
    return { opened: JSON.stringify(res) === JSON.stringify({ spec: want }), lockReason: res.lockReason ?? null };
  }
  const res = resolveQrDeco(Object.freeze(qrStateOf(row)), QR_BASE, row.host, allow);
  return { opened: Boolean(res.deco) && res.deco.cellStyle === row.qrCellStyle, lockReason: res.lockReason ?? null };
}

/** 행이 구조 잠금에 걸리는가 — 사유 id 또는 null. 판정은 제품 함수(손으로 옮긴 조건 없음). */
function structuralLockOf(row) {
  if (row.table === 'oak' || row.table === 'y') return cellShapeStructuralLock(row.table, row.cellShape, row.param, cellCtxOf(row));
  if (row.table === 'h') {
    const { lockReason } = resolveHCellStyleSpec(hStateOf(row), hCtxOf(row), { ROWS: [row] });
    return [H_CELL_STYLE_LOCK_REASONS.TWO_TONE, H_CELL_STYLE_LOCK_REASONS.CORNERS_FINDER].includes(lockReason) ? lockReason : null;
  }
  return QR_LOCKED_HOSTS.includes(row.host) ? 'qr-y-host' : null;
}

// ── 머리 주석 파싱 (정렬 규칙 · 표 순서 · 행 수) ─────────────────────────────

const SORT_RULE = '정렬: 표 순서 → 표 키 순서대로 값(null < boolean < number < string)';
const TYPE_RANK = (v) => (v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : 3);

/** 머리 주석의 «행 모양» 줄 → [[표, [키…]], …] (표 순서 = 줄 순서). */
function headerShapes(header) {
  return [...header.matchAll(/^ \* {3}(\w+): \{ ([^}]+) \}\s*$/gm)].map((m) => [m[1], m[2].split(',').map((s) => s.trim())]);
}
/** 머리 주석의 «행 N개 (oak a · y b · …)» → {total, per:{표: n}} 또는 null. */
function headerCounts(header) {
  const m = /행 (\d+)개 \(([^)]*)\)/.exec(header);
  if (!m) return null;
  const per = {};
  for (const part of m[2].split('·')) {
    const pm = /^\s*(\w+) (\d+)\s*$/.exec(part);
    if (pm) per[pm[1]] = Number(pm[2]);
  }
  return { total: Number(m[1]), per };
}
function compareValues(a, b) {
  const ra = TYPE_RANK(a), rb = TYPE_RANK(b);
  if (ra !== rb) return ra - rb;
  if (a === b) return 0;
  if (ra === 1 || ra === 2) return a < b ? -1 : 1; // false < true · 숫자
  return a < b ? -1 : 1; // 문자열: 코드 단위 순
}

// ── 판정 함수 — 결함 범주 목록(빈 배열 = 성질 전부 참) ─────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const FINGERPRINT_FIELDS = Object.freeze({ // 머리 주석 «잰 대상 지문 {head, …}» 의 계약(스텁 주석과 같은 네 필드)
  head: HEX40, generatorBundleSha256: HEX64, scannerBundleSha256: HEX64, decoderSourceSha256: HEX64,
});

/**
 * @param {{ROWS, RECEIPT_SHA256, MEASURED_AT, FINGERPRINT}} mod 생성 표(또는 결함 심은 사본)
 * @param {string} header 머리 주석 텍스트
 * @returns {{cat: string, msg: string}[]}
 */
function generatedProblems(mod, header) {
  const out = [];
  const add = (cat, msg) => out.push({ cat, msg });
  // ⓐ 메타
  if (!HEX64.test(String(mod.RECEIPT_SHA256))) add('meta-receipt', `RECEIPT_SHA256 ${mod.RECEIPT_SHA256}`);
  const at = mod.MEASURED_AT;
  if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(at) || Number.isNaN(Date.parse(at))) {
    add('meta-measured-at', `MEASURED_AT ${at}`);
  }
  const fp = mod.FINGERPRINT;
  if (!fp || typeof fp !== 'object') add('meta-fingerprint', 'FINGERPRINT 없음');
  else {
    const got = Object.keys(fp).sort().join(','), want = Object.keys(FINGERPRINT_FIELDS).sort().join(',');
    if (got !== want) add('meta-fingerprint', `FINGERPRINT 필드 ${got} ≠ ${want}`);
    for (const [k, re] of Object.entries(FINGERPRINT_FIELDS)) if (!re.test(String(fp[k]))) add('meta-fingerprint', `FINGERPRINT.${k} ${fp[k]}`);
  }
  if (!Array.isArray(mod.ROWS)) { add('rows', 'ROWS 가 배열이 아니다'); return out; }
  if (!Object.isFrozen(mod.ROWS) || mod.ROWS.some((r) => !Object.isFrozen(r)) || (fp && !Object.isFrozen(fp))) add('frozen', '표 · 행 · 지문이 동결되지 않았다');

  // ⓔ 머리 주석 — 규칙 문구 · 행 모양 줄(키 순서 = 코드) · 행 수
  if (!header.includes(SORT_RULE)) add('header-rule', '머리 주석에 정렬 규칙 문구가 없다(규칙이 바뀌었으면 이 자의 비교 함수도 바꿔라)');
  const shapes = headerShapes(header);
  const tableOrder = shapes.map(([t]) => t);
  if (JSON.stringify([...tableOrder].sort()) !== JSON.stringify(Object.keys(ROW_KEYS).sort())) add('header-shape', `행 모양 줄의 표 ${tableOrder}`);
  for (const [t, keys] of shapes) {
    if (ROW_KEYS[t] && JSON.stringify(keys) !== JSON.stringify(['table', ...ROW_KEYS[t]])) add('header-shape', `${t} 행 모양 ${keys} ≠ 코드 ${ROW_KEYS[t]}`);
  }
  const counts = headerCounts(header);
  const actual = {};
  for (const r of mod.ROWS) actual[r && r.table] = (actual[r && r.table] ?? 0) + 1;
  if (!counts) add('header-count', '머리 주석에 «행 N개 (…)» 가 없다');
  else {
    if (counts.total !== mod.ROWS.length) add('header-count', `주석 총 ${counts.total} ≠ 실제 ${mod.ROWS.length}`);
    for (const t of new Set([...Object.keys(counts.per), ...Object.keys(actual)])) {
      if ((counts.per[t] ?? 0) !== (actual[t] ?? 0)) add('header-count', `주석 ${t} ${counts.per[t] ?? 0} ≠ 실제 ${actual[t] ?? 0}`);
    }
  }

  // ⓑ–ⓓ 행별
  const seen = new Set();
  mod.ROWS.forEach((row, i) => {
    const where = `ROWS[${i}] ${JSON.stringify(row)}`;
    const keys = row && ROW_KEYS[row.table];
    if (!keys) { add('table', `${where}: 모르는 표`); return; }
    const got = Object.keys(row).filter((k) => k !== 'table').sort();
    const want = [...keys].sort();
    const missing = want.filter((k) => !got.includes(k)), extra = got.filter((k) => !want.includes(k));
    if (missing.length) add('missing-key', `${where}: 빠진 키 ${missing}`);
    if (extra.length) add('extra-key', `${where}: 여분 키 ${extra}`);
    if (Object.values(row).some((v) => v !== null && typeof v === 'object')) add('domain', `${where}: 원시값이 아닌 값`);
    const sig = JSON.stringify(['table', ...keys].map((k) => row[k]));
    if (seen.has(sig)) add('duplicate', `${where}: 중복 행`);
    seen.add(sig);
    if (missing.length || extra.length) return; // 모양이 틀린 행은 아래 판정이 무의미하다
    // ⓒ 도메인
    for (const [k, ok] of Object.entries(DOMAIN[row.table])) if (!ok(row[k])) add('domain', `${where}: ${k}=${JSON.stringify(row[k])}`);
    if (row.table === 'oak' || row.table === 'y') {
      if (!CELL_SHAPES.includes(row.cellShape) || row.cellShape === CELL_SHAPE_DEFAULT || !D.cellShape.values.includes(row.cellShape)) {
        add('domain', `${where}: cellShape`);
      } else {
        const def = CELL_SHAPE_PARAMS[row.cellShape];
        if (def ? !def.domain.includes(row.param) : row.param !== null) add('domain', `${where}: param`);
      }
    }
    if (row.table === 'qr' && row.qrCellStyle === QR_DECO_DEFAULTS.qrCellStyle && row.qrColorMode === QR_DECO_DEFAULTS.qrColorMode
      && row.eyeMode === QR_DECO_DEFAULTS.qrEye) add('domain', `${where}: 기본 조합 행(아무것도 열지 않는다)`);
    // ⓓ 구조 잠금
    const lock = structuralLockOf(row);
    if (lock !== null) { add('structural', `${where}: 구조 잠금 ${lock} 에 걸린 죽은 행`); return; }
    // ⓕ 실제로 열린다 · 빈 표에선 잠긴다
    const open = resolveRow(row, mod);
    if (!open.opened) add('not-opened', `${where}: resolver 가 안 연다(${open.lockReason})`);
    const shut = resolveRow(row, EMPTY);
    if (shut.opened || shut.lockReason === null) add('not-opened', `${where}: 빈 표에서도 열린다 — 열림의 원인이 행이 아니다`);
  });

  // ⓔ 정렬 — 표 순서(행 모양 줄 순서) → 키 순서대로 값. 엄격 오름차순.
  const rank = (t) => tableOrder.indexOf(t);
  for (let i = 1; i < mod.ROWS.length; i += 1) {
    const a = mod.ROWS[i - 1], b = mod.ROWS[i];
    if (!a || !b) continue;
    let c = rank(a.table) - rank(b.table);
    if (c === 0 && ROW_KEYS[a.table]) {
      for (const k of ROW_KEYS[a.table]) { c = compareValues(a[k] ?? null, b[k] ?? null); if (c !== 0) break; }
    }
    if (c >= 0) add('order', `ROWS[${i - 1}] · ROWS[${i}] 순서 ${c === 0 ? '같음(중복)' : '뒤집힘'}`);
  }
  return out;
}

const cats = (problems) => [...new Set(problems.map((p) => p.cat))].sort();

// ── 자 ─────────────────────────────────────────────────────────────────────

test('ⓐ–ⓕ 생성 허용표: 메타 · 행 모양 · 도메인 · 구조 잠금 0 · 정렬 · 행마다 resolver 가 연다 — 결함 0', () => {
  assert.notEqual(GEN.RECEIPT_SHA256, null, '기본 허용표가 스텁이다 — 이 자는 생성본을 잰다(스텁 성질은 cell-shape-allowlist · geometry 가 주입으로 잰다)');
  const problems = generatedProblems(GEN, HEADER);
  assert.deepEqual(problems.map((p) => `${p.cat}: ${p.msg}`), []);
  // 자가 비지 않았는가 — 셀 표 행이 있어야 ⓕ 가 무언가를 잰다(수치는 박제하지 않는다).
  assert.ok(GEN.ROWS.some((r) => r.table === 'oak' || r.table === 'y'), '셀 모양 행이 하나도 없다');
});

test('ⓕ H 행의 문맥은 실제 encodeH 가 만든다(제품이 도달할 수 있는 문맥) · ground 는 상태에서 온다', () => {
  const seen = new Map();
  for (const row of GEN.ROWS.filter((r) => r.table === 'h')) {
    const key = JSON.stringify(hCtxOf(row));
    if (seen.has(key)) continue;
    const encoded = encodeH('TL', { version: row.version, mode: 3, tones: row.tones, finder: row.finder, ecc: 'M' });
    const ctx = hCellStyleCtx(encoded, { preset: row.paletteGrade });
    assert.deepEqual(ctx, hCtxOf(row), `H 행 문맥 ${key} 을 인코딩이 안 만든다`);
    seen.set(key, true);
  }
  // 문맥 키 + ground = 표 키(ground 만 상태에서) — 목록이 바뀌면 hCtxOf 가 틀린다.
  const ctxKeys = Object.keys(hCellStyleCtx(encodeH('TL', { version: 0, mode: 3, tones: 3, finder: 'frame', ecc: 'M' }), FRESH));
  assert.deepEqual([...ctxKeys, 'ground'].sort(), [...H_CELL_STYLE_ALLOW_KEYS].sort());
});

test('ⓗ 잠금 사유는 생성 표에서 유도된다 — «틈 탓» 은 흰 틈 형제 행이 있을 때만, 행 없는 버전 · n 은 미확인', () => {
  // 2026-09-27 화면 확인: Y 투명 n21(21 B 이상 URL)이 «틈이 알 수 없는 표면으로 드러나 잠겨» 로 나왔다. 같은 틈(unknown)의
  // n13 은 생성 표가 연다 — 원인은 틈이 아니라 n21 행 없음이다. 버전 · n 값은 박제하지 않고 표에 **없는** 값을 유도한다.
  const cellRows = GEN.ROWS.filter((r) => (r.table === 'oak' || r.table === 'y') && r.gapGrade === 'white'
    && EXPOSED_CELL_SHAPES.includes(r.cellShape));
  assert.ok(cellRows.length > 0, '흰 틈 노출형 행이 없다 — 자가 비었다');
  const absent = {
    oak: { version: Math.max(...GEN.ROWS.filter((r) => r.table === 'oak').map((r) => r.version)) + 1 },
    y: { nBand: String(Math.max(...GEN.ROWS.filter((r) => r.table === 'y').map((r) => Number(r.nBand))) + 8) },
  };
  let gapChecked = 0;
  for (const row of cellRows) {
    const state = Object.freeze(cellStateOf(row));
    const dark = { ...cellCtxOf(row), gapGrade: 'unknown', bgMode: 'transparent' };
    const at = JSON.stringify(row);
    const res = resolveCellShapeSpec(state, dark, GEN);
    if (res.spec === null && !cellShapeStructuralLock(row.table, row.cellShape, row.param, dark)) {
      assert.equal(res.lockReason, 'exposed-gap', `흰 틈 형제 행이 있는데 틈 사유가 아니다: ${at}`);
      gapChecked += 1;
    }
    for (const ctx of [dark, cellCtxOf(row)]) {
      const moved = { ...ctx, ...absent[row.table] };
      assert.equal(resolveCellShapeSpec(state, moved, GEN).lockReason, 'unmeasured', `행 없는 ${JSON.stringify(absent[row.table])} 인데 미확인이 아니다: ${at} ${ctx.gapGrade}`);
    }
  }
  assert.ok(gapChecked > 0, '흰 틈만 열린 노출형 문맥이 없다 — exposed-gap 쪽 자가 비었다');
});

test('ⓖ 판별력: 생성 표 사본에 결함을 하나씩 심으면 그 범주가 각각 잡힌다', () => {
  const rows = GEN.ROWS;
  const meta = { RECEIPT_SHA256: GEN.RECEIPT_SHA256, MEASURED_AT: GEN.MEASURED_AT, FINGERPRINT: GEN.FINGERPRINT };
  const freezeAll = (list) => Object.freeze(list.map((r) => Object.freeze({ ...r })));
  const copy = (list, extra = {}) => ({ ...meta, ROWS: freezeAll(list), ...extra });
  assert.deepEqual(cats(generatedProblems(copy(rows), HEADER)), [], '대조군: 결함 없는 사본');

  const firstOf = (table) => rows.find((r) => r.table === table);
  const oak = firstOf('oak'), y = firstOf('y'), h = firstOf('h');
  assert.ok(oak && y && h, '심을 표본 행(oak · y · h)이 생성 표에 있어야 한다');
  const replaceAt = (row, patch) => rows.map((r) => (r === row ? { ...r, ...patch } : r));
  const dropKey = (row, key) => rows.map((r) => { if (r !== row) return r; const c = { ...r }; delete c[key]; return c; });
  const ai = rows.indexOf(oak);
  const swapped = [...rows]; [swapped[ai], swapped[ai + 1]] = [swapped[ai + 1], swapped[ai]];
  const headerPlus = HEADER.replace(/행 (\d+)개/, (_, n) => `행 ${Number(n) + 1}개`);

  const plants = [
    // 구조 잠금 행 — 표마다(계산은 제품 함수가 한다)
    ['구조 잠금 C(oak)', copy(replaceAt(oak, { type: 'C' })), 'structural'],
    ['구조 잠금 bevel 1.4(oak)', copy(replaceAt(oak, { cellShape: 'bevel', param: 1.4 })), 'structural'],
    ['구조 잠금 Y 2톤', copy(replaceAt(y, { tones: 2 })), 'structural'],
    ['구조 잠금 H corners', copy(replaceAt(h, { finder: 'corners' })), 'structural'],
    ['구조 잠금 QR y 호스트', copy([...rows, { table: 'qr', host: QR_LOCKED_HOSTS[0], qrCellStyle: 'dots', qrColorMode: 'default', eyeMode: 'none' }]), 'structural'],
    // 키
    ['키 빠진 행(oak 마지막 문맥 키)', copy(dropKey(oak, CELL_SHAPE_ALLOW_KEYS.oak.at(-1))), 'missing-key'],
    ['키 빠진 행(h 첫 문맥 키)', copy(dropKey(h, H_CELL_STYLE_ALLOW_KEYS[0])), 'missing-key'],
    ['여분 키', copy(replaceAt(y, { role: 'data' })), 'extra-key'],
    // 중복 · 순서
    ['중복 행', copy([...rows.slice(0, ai + 1), oak, ...rows.slice(ai + 1)]), 'duplicate'],
    ['순서 뒤집기', copy(swapped), 'order'],
    // 도메인
    ['도메인 밖 param', copy(replaceAt(oak, { param: 0.5 })), 'domain'],
    ['도메인 밖 seamAdjacent', copy(replaceAt(y, { seamAdjacent: 'decorate' })), 'domain'],
    ['도메인 밖 finderPatternId', copy(replaceAt(oak, { finderPatternId: 'nope' })), 'domain'],
    ['도메인 밖 hCellStyle(기본값)', copy(replaceAt(h, { hCellStyle: H_CELL_STYLE_DEFAULT })), 'domain'],
    // ⓕ 만 잡는 결함 — oak 표 행인데 type 이 마름모 oak 계열이 아니다(resolver 가 표를 못 고른다).
    ['oak 행의 type 이 oak 계열 밖', copy(replaceAt(oak, { type: 'H' })), 'not-opened'],
    // 메타
    ['영수증 sha 결함', copy(rows, { RECEIPT_SHA256: 'x'.repeat(64) }), 'meta-receipt'],
    ['측정 시각 결함', copy(rows, { MEASURED_AT: '2026-09-27' }), 'meta-measured-at'],
    ['지문 필드 빠짐', copy(rows, { FINGERPRINT: Object.freeze({ head: GEN.FINGERPRINT.head }) }), 'meta-fingerprint'],
    ['동결 안 됨', { ...meta, ROWS: rows.map((r) => ({ ...r })) }, 'frozen'],
  ];
  for (const [name, table, cat] of plants) {
    const got = cats(generatedProblems(table, HEADER));
    assert.ok(got.includes(cat), `심은 결함을 못 잡았다: ${name} — 기대 ${cat}, 받음 [${got}]`);
  }
  // 머리 주석 행 수 어긋남(주석만 바꾼다).
  assert.ok(cats(generatedProblems(copy(rows), headerPlus)).includes('header-count'), '주석 행 수 어긋남을 못 잡았다');
  // 행이 열리는지(ⓕ)의 판별력: 같은 호출을 빈 표로 하면 전 행이 잠긴다(열림의 원인이 행이다).
  const blind = rows.filter((r) => r.table !== 'qr').map((r) => resolveRow(r, EMPTY));
  assert.ok(blind.every((r) => !r.opened && r.lockReason !== null), '빈 표에서 열리는 행이 있다 — ⓕ 가 행을 안 잰다');
});
