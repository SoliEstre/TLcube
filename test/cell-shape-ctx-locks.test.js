// cell-shape-ctx-locks.test.js — 제품 문맥 유도(cellShapeCtx · qrDecoCtx)의 성질 + L0 하네스 유도와의 대조
// (레인 README «단계 C 뒤 통합자 결정» 1 · 2 · 3, 레인 D1 2026-09-26)
//
// 재는 것:
//   ① 틈 등급의 어휘와 뜻 — quiet-auto 가 낼 수 있는 판 색 전부를 다루고(검증되는 사본 CELL_GAP_QUIET_COLORS 대조),
//      Y 기본(투명 · auto)은 «미지 표면» 이다(설계 §3.2 safety B2 — Y 기본에서 노출형 모양은 흰 틈 행으로 못 연다).
//   ② 슬롯 판정은 코드(role 'slot' 셀)에서 — cellSurfaceFinal.hasCenterQrSlot 과 모든 Y 레이아웃에서 같은 답.
//   ③ 실효 타입 — C 는 인코딩(notchC)이 판정(상태 표지가 아니라) · G · V · H(null).
//   ④ 제품 경로 문맥은 완전하다(렌더 값을 주면 표 키 · 설계 잠금 키 · 측정 구성 키가 전부 정의) · Y 심 변형은 생산자 기본과 같다.
//   ⑤ qrDecoCtx 는 허용표 QR 키 정확히 + 눈 접기가 resolver 와 같은 뜻.
//   ⑥ (TL_L0_DIR) L0 하네스 tl-decode.mjs 의 allowCtx 유도(하네스 사본 CTX_DERIVE)와 제품 cellShapeCtx 가 대표 케이스
//      격자에서 표 키마다 같다. 하네스는 CLI 스크립트라(유도 함수가 모듈 밖으로 안 나온다) **하위 프로세스로 돌려**
//      대조군 행의 allowCtx 를 읽고, 같은 케이스를 하네스 조립 라이브러리(lib-assemble — export 됨)로 다시 조립해 제품
//      문맥을 만든다. 하네스가 이미 제품 함수를 부르는 모드(ctxSource 'product')면 행의 ctxMismatch 로 하네스 사본 값을
//      복원해 대조한다 — 제품 값끼리 비교하는 자기 참조를 피한다. 허용 차이는 없다(표 키 전부 엄격 일치).
//      이력: 첫 대조(2026-09-26 17:1x)에서 Y 투명 · 판 없음의 gapGrade 가 하네스 'white' · 제품 'unknown' 으로 갈렸다
//      (하네스 L6 «white» 등급이 투명 PNG 를 흰 표면에 합성). 하네스 레인(D2)이 17:2x 에 제품 뜻(설계 §3.2 B2)으로
//      맞추고 Y «white» 등급을 bgMode white(흰 평탄화)로 조립하게 바꿨다 — 그 케이스('y-v0' · 'y-v0|gap=white')가 격자에 있다.
// TL_L0_DIR 이 없으면(⑥ 만) 명시 사유로 skip — public 트리에는 private 하네스가 없다. 나머지는 항상 돈다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import { encodeH } from '../src/h-codec.js';
import { getPreset, relativeLuminance, PRESETS } from '../src/luminance.js';
import * as QA from '../src/quiet-auto.js';
import { hasCenterQrSlot } from '../src/cellSurfaceFinal.js';
import { buildSceneY, Y_SEAM_ADJACENT_MODES } from '../src/sceneY.js';
import { encodeOptionsForY } from '../src/generator-render-config.js';
import {
  CELL_GAP_GRADES, CELL_GAP_QUIET_COLORS, CELL_SHAPE_ALLOW_KEYS, CELL_SHAPE_LOCK_CTX_KEYS, CELL_SHAPE_MEASURED_CONFIG_KEYS,
  CELL_SHAPE_REQUIRED_CTX_KEYS, Y_SEAM_ADJACENT_PRODUCT,
  cellGapGrade, cellShapeAllowCtx, cellShapeCtx, cellShapeTypeOf, paletteGradeOf,
} from '../src/cell-shape.js';
import { QR_ALLOW_KEYS, QR_HOSTS, qrDecoCtx, resolveQrDeco } from '../src/qr-colors.js';
import { hPaletteGrade } from '../src/generator-h.js';
import { GENERATOR_STATE_SCHEMA, createGeneratorState } from '../src/generator-state.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PAYLOAD = 'https://tl.estre.so';
const FRESH = createGeneratorState();
const yEnc = (locatorProfileY, tone, fallback = { mode: 'corner', corner: 'TL' }) => encodeY(PAYLOAD, encodeOptionsForY({ tone, fallback, locatorProfileY }));

// ── ① 틈 등급 ────────────────────────────────────────────────────────────

test('① 판 색 어휘: quiet-auto 의 QUIET_COLOR_* 과 CELL_GAP_QUIET_COLORS 가 같은 집합이다(검증되는 사본)', () => {
  const qa = Object.entries(QA).filter(([k]) => k.startsWith('QUIET_COLOR_')).map(([, v]) => v);
  assert.ok(qa.length >= 4);
  assert.deepEqual([...new Set(qa)].sort(), [...CELL_GAP_QUIET_COLORS].sort());
});

test('① resolveQuietZoneChoice 가 낼 수 있는 판 색 전부에서 틈 등급이 정의되고, 뜻은 «셀 아래 보이는 것» 이다', () => {
  const sepSets = [{ sepWhite: 0.5, sepBlack: 0.3 }, { sepWhite: 0.2, sepBlack: 0.6 }, { sepWhite: 0.04, sepBlack: 0.03 }];
  let n = 0;
  for (const type of ['O', 'A', 'Y']) {
    for (const quietMode of GENERATOR_STATE_SCHEMA.quietMode.options) {
      for (const bgMode of GENERATOR_STATE_SCHEMA.bgMode.options) {
        for (const surface of [null, 0.3]) {
          for (const sep of sepSets) {
            const choice = QA.resolveQuietZoneChoice({
              quietMode, bgMode, type, ...sep, surfaceLuminance: surface, surfaceSeparation: surface, separationFloor: 0.05,
            });
            const g = cellGapGrade({ quietMode, bgMode }, { quietColor: choice.color });
            assert.ok(CELL_GAP_GRADES.includes(g), `${type} ${quietMode} ${bgMode} → ${choice.color} → ${g}`);
            if (quietMode === 'contrast') assert.equal(g, 'unknown', '설계 §3.0 — contrast 는 미지 표면으로 묶는다');
            else if (choice.color === 'white' || choice.color === 'black') assert.equal(g, choice.color);
            else if (choice.color === 'surface') assert.equal(g, 'unknown');
            else assert.equal(g, bgMode === 'transparent' ? 'unknown' : bgMode, '판 없음 → 배경 평탄화');
            n += 1;
          }
        }
      }
    }
  }
  assert.ok(n > 300);
  // 렌더 값이 없거나 모르는 판 색이면 정의하지 않는다(→ resolver 가 잠근다).
  assert.equal(cellGapGrade({ quietMode: 'auto', bgMode: 'white' }, undefined), undefined);
  assert.equal(cellGapGrade({ quietMode: 'auto', bgMode: 'white' }, { quietColor: 'grey' }), undefined);
});

test('① Y 기본 상태(투명 · auto)는 판이 없어 «미지 표면» — O 기본(slate)은 판 색 그대로', () => {
  const lv = getPreset('slate').levels.map(relativeLuminance);
  const sep = (y) => Math.min(...lv.map((l) => Math.abs(l - y)));
  const input = { quietMode: FRESH.quietMode, bgMode: FRESH.bgMode, sepWhite: sep(1), sepBlack: sep(0), surfaceLuminance: null, surfaceSeparation: null, separationFloor: 0.05 };
  const y = QA.resolveQuietZoneChoice({ ...input, type: 'Y' });
  assert.equal(y.color, 'none');
  assert.equal(cellGapGrade(FRESH, { quietColor: y.color }), 'unknown', '설계 §3.2 B2 — Y 기본에서 노출형은 흰 틈 행으로 못 연다');
  const o = QA.resolveQuietZoneChoice({ ...input, type: 'O' });
  assert.ok(o.color === 'white' || o.color === 'black');
  assert.equal(cellGapGrade(FRESH, { quietColor: o.color }), o.color);
});

// ── ② 슬롯 판정 ──────────────────────────────────────────────────────────

test('② 슬롯: 인코딩의 role «slot» 셀 유무 ≡ cellSurfaceFinal.hasCenterQrSlot(레이아웃) — 스키마 Y 레이아웃 전부 × 톤 2 · 3', () => {
  let slots = 0;
  for (const p of GENERATOR_STATE_SCHEMA.locatorProfileY.options) {
    for (const tone of [2, 3]) {
      const enc = yEnc(p, tone);
      const ctx = cellShapeCtx('Y', enc, { ...FRESH, tone, locatorProfileY: p }, { quietColor: 'none' });
      const want = enc.cellSurfaceLayout ? hasCenterQrSlot(enc.cellSurfaceLayout) : false;
      assert.equal(ctx.qrSlot, want, `${p} t${tone}`);
      if (want) slots += 1;
    }
  }
  assert.ok(slots >= 4, '슬롯 레이아웃이 격자에 실제로 있다(판별력)');
  const win = yEnc('off', 3, { mode: 'window' });
  assert.equal(cellShapeCtx('Y', win, FRESH, { quietColor: 'none' }).qrWindow, true);
});

// ── ③ 실효 타입 ──────────────────────────────────────────────────────────

test('③ 실효 타입: C 는 코드(notchC)가 판정 · G = O+o-cm · V = A+turnA · H(Y 3D) · 모르는 타입 → null', () => {
  const c = encode(PAYLOAD, { notchC: true, version: 0 });
  const o = encode(PAYLOAD);
  assert.equal(cellShapeTypeOf('O', c, { ...FRESH, versionO: 'auto' }), 'C', '코드가 C 면 상태 표지와 무관');
  assert.equal(cellShapeTypeOf('O', o, { ...FRESH, versionO: 'ultra' }), 'O', '상태 표지만 ultra 인 O 코드는 O');
  assert.equal(cellShapeTypeOf('O', o, { ...FRESH, innerSeat: 'o-cm' }), 'G');
  assert.equal(cellShapeTypeOf('A', encodeA(PAYLOAD), { ...FRESH, turnA: true }), 'V');
  assert.equal(cellShapeTypeOf('A', encodeA(PAYLOAD), FRESH), 'A');
  assert.equal(cellShapeTypeOf('K', encodeK(PAYLOAD), FRESH), 'K');
  assert.equal(cellShapeTypeOf('Y', yEnc('cell-surface-v0', 3), FRESH), 'Y');
  const h = encodeH('TL', { version: 2, mode: 3, tones: 3, finder: 'frame', ecc: 'M' });
  assert.equal(cellShapeCtx('Y', h, { ...FRESH, yRepresentation: '3d' }, { quietColor: 'none' }), null, 'H 는 hCellStyleCtx 몫');
  assert.equal(cellShapeCtx('Z', o, FRESH, { quietColor: 'none' }), null);
  assert.equal(cellShapeCtx('O', null, FRESH), null);
});

// ── ④ 완전성 · 심 변형 ────────────────────────────────────────────────────

test('④ 제품 경로 문맥은 완전하다 — 렌더 값을 주면 표 키 · 설계 잠금 키 · 측정 구성 키 전부 정의 · 표 투영은 정확히 표 키', () => {
  // resolver 요구 키 = 표 키 ∪ 설계 잠금 키(하네스 계약) ∪ 측정 구성 키 — 셋 중 하나라도 빠지면 이 자가 그 키를 안 잰다.
  for (const t of ['oak', 'y']) {
    assert.deepEqual([...CELL_SHAPE_REQUIRED_CTX_KEYS[t]].sort(),
      [...CELL_SHAPE_ALLOW_KEYS[t], ...CELL_SHAPE_LOCK_CTX_KEYS[t], ...CELL_SHAPE_MEASURED_CONFIG_KEYS[t]].sort(), t);
  }
  const cases = [
    ['O', encode(PAYLOAD), FRESH],
    ['A', encodeA(PAYLOAD), { ...FRESH, type: 'A' }],
    ['K', encodeK(PAYLOAD), { ...FRESH, type: 'K' }],
    ['Y', yEnc('cell-surface-v0', 3), FRESH],
    ['Y', yEnc('hex-frame-v1', 2), { ...FRESH, locatorProfileY: 'hex-frame-v1', tone: 2 }],
    ['Y', yEnc('off', 3), { ...FRESH, locatorProfileY: 'off' }],
  ];
  for (const preset of [...Object.keys(PRESETS), 'custom']) {
    for (const [type, enc, st] of cases) {
      const ctx = cellShapeCtx(type, enc, { ...st, preset }, { quietColor: 'none' });
      const keys = CELL_SHAPE_REQUIRED_CTX_KEYS[ctx.table];
      for (const k of keys) assert.notEqual(ctx[k], undefined, `${type} ${preset} ${k}`);
      const row = cellShapeAllowCtx(ctx);
      assert.deepEqual(Object.keys(row).sort(), ['table', ...CELL_SHAPE_ALLOW_KEYS[ctx.table]].sort());
      assert.equal(ctx.paletteGrade, preset);
    }
  }
  // 팔레트 등급은 H 와 한 벌.
  for (const preset of [...Object.keys(PRESETS), 'custom', 'neon', undefined]) {
    assert.equal(hPaletteGrade({ preset }), paletteGradeOf({ preset }));
  }
});

test('④ Y 심 인접 변형: 제품 문맥 값은 생산자가 아는 변형이고, spec 에 안 실으면 생산자가 그 변형으로 그린다', () => {
  assert.ok(Y_SEAM_ADJACENT_MODES.includes(Y_SEAM_ADJACENT_PRODUCT));
  const enc = yEnc('cell-surface-v0', 3);
  const palette = { background: getPreset('slate').background, levels: getPreset('slate').levels };
  const base = { palette, locatorProfile: 'cell-surface-v0' };
  const implicit = JSON.stringify(buildSceneY(enc, { ...base, cellShape: { kind: 'round', param: 0.7 } }));
  const explicit = JSON.stringify(buildSceneY(enc, { ...base, cellShape: { kind: 'round', param: 0.7, seamAdjacent: Y_SEAM_ADJACENT_PRODUCT } }));
  assert.equal(implicit, explicit, 'resolver spec(심 변형 없음) = 제품 문맥의 심 변형');
  const other = Y_SEAM_ADJACENT_MODES.find((m) => m !== Y_SEAM_ADJACENT_PRODUCT);
  const differs = JSON.stringify(buildSceneY(enc, { ...base, cellShape: { kind: 'round', param: 0.7, seamAdjacent: other } }));
  assert.notEqual(differs, implicit, '판별력: 다른 심 변형은 다른 장면');
});

// ── ⑤ QR 문맥 ─────────────────────────────────────────────────────────────

test('⑤ qrDecoCtx: 허용표 QR 키 정확히 · 눈 접기(default+darker → none)가 resolver 결과와 같은 뜻 · 스키마 키 qrEye 우선', () => {
  for (const host of QR_HOSTS) {
    const ctx = qrDecoCtx(host, FRESH);
    assert.deepEqual(Object.keys(ctx).sort(), ['table', ...QR_ALLOW_KEYS].sort());
    assert.deepEqual(ctx, { table: 'qr', host, qrCellStyle: 'square', qrColorMode: 'default', eyeMode: 'none' });
  }
  assert.equal(qrDecoCtx('oak', { qrColorMode: 'default', qrEye: 'darker' }).eyeMode, 'none');
  assert.equal(qrDecoCtx('oak', { qrColorMode: 'match', qrEye: 'darker' }).eyeMode, 'darker');
  assert.equal(qrDecoCtx('oak', { qrEye: 'custom', qrEyeMode: 'none' }).eyeMode, 'custom', '스키마 키가 초안 키를 이긴다');
  assert.equal(qrDecoCtx('oak', { qrEyeMode: 'darker', qrColorMode: 'custom' }).eyeMode, 'darker', '초안 키(하네스 fixture 철자)도 읽는다');
  assert.equal(qrDecoCtx('oak', { qrEyeDark: true, qrColorMode: 'custom' }).eyeMode, 'darker');
  // 접힌 조합은 resolver 가 «기본값» 으로 본다(deco null · 사유 없음) — 같은 뜻.
  const open = { ROWS: [{ table: 'qr', host: 'oak', qrCellStyle: 'square', qrColorMode: 'default', eyeMode: 'darker' }] };
  assert.deepEqual(resolveQrDeco({ qrColorMode: 'default', qrEye: 'darker' }, getPreset('slate'), 'oak', open), { deco: null });
});

// ── ⑥ L0 하네스 대조 (TL_L0_DIR) ───────────────────────────────────────────

const L0 = process.env.TL_L0_DIR;
const SKIP_REASON = 'TL_L0_DIR 미설정 — L0 하네스(private .agent/lanes/tl-decoration-impl-20260926/l0)가 없는 트리에서는 하네스 유도와의 대조를 못 한다. '
  + '돌리려면 TL_L0_DIR=<그 l0 폴더 절대경로>. 이 한 테스트만 건너뛰고 나머지 제품 문맥 성질은 위에서 모두 돈다.';

/** 하네스 계열 조립 명세(tl-decode.mjs FAMILIES · L6_GRADES 의 사본) — 어긋나면 행의 code/문맥 대조가 빨개진다(조용히 초록 아님). */
const FAM = {
  'o-pinwheel': { type: 'O', finder: 'pinwheel-c2-2-1100-cw' },
  'o-bullseye': { type: 'O', finder: 'bullseye' },
  'y-v0': { type: 'Y' },
  'a-n7': { type: 'A' },
  'k-n7': { type: 'K' },
};
const GRADE = { white: {}, black: { bgMode: 'black' }, unknown: { quietMode: 'none' } };
/** 하네스 L6_GRADES.overY — Y 는 안전영역 판이 없어 «흰» 등급을 흰 평탄화로 조립한다. */
const GRADE_Y = { white: { bgMode: 'white' } };
function caseSpec(id) {
  const parts = id.split('|');
  if (FAM[parts[0]]) {
    const b = FAM[parts[0]];
    if (parts.length === 1) return b;
    const [k, v] = parts[1].split('=');
    if (k === 'gap') return { ...b, ...GRADE[v], ...(b.type === 'Y' ? GRADE_Y[v] : {}) };
    if (k === 'bg') return { ...b, bgMode: v };
    if (k === 'palette') return { ...b, palette: v };
    if (k === 'qr') return { ...b, qrPosition: v };
  } else if (parts[0] === 'Y' && parts.length === 3) {
    const c = { type: 'Y', tones: Number(parts[2].slice(1)) };
    if (parts[1] !== 'auto') c.locatorProfileY = parts[1];
    return c;
  } else if (parts.length === 2) return { type: parts[0], finder: parts[1] };
  throw new Error('케이스 명세를 모른다: ' + id);
}
/** 대표 케이스 — 타입 O·A·K·C·G·V·Y × 틈 등급 3 × 배경 · 팔레트(custom) · QR 없음 · Y 레이아웃(hex-frame · 슬롯 · 2톤). */
// custom 팔레트 케이스는 손으로 적지 않는다 — 하네스의 hue 표본 집합(lib-color-samples)이 바뀌면 이름이 사라진다
// (2026-09-26: 단계 F2 가 표본을 wheel6 으로 바꾸자 옛 «custom210/sat200» 이 없어져 하네스가 이 케이스를 거부했다).
// ⑥ 안에서 하네스 기본 표본 중 210° 에 가장 가까운 hue · sat 200 으로 유도해 CASES 에 더한다.
const CASES_BASE = [
  'o-pinwheel', 'o-pinwheel|gap=black', 'o-pinwheel|gap=unknown', 'o-pinwheel|bg=white',
  'o-pinwheel|qr=none', 'O|bullseye',
  'a-n7|gap=white', 'k-n7|gap=white', 'C|pinwheel-c2-2-1100-cw', 'G|pinwheel-c2-2-1100-cw', 'V|pinwheel-c2-2-1100-cw',
  'y-v0', 'y-v0|gap=white', 'y-v0|gap=black', 'y-v0|gap=unknown', 'y-v0|bg=white',
  'Y|hex-frame-v1|t3', 'Y|cell-surface-v0ty|t3', 'Y|off|t2',
];
const OAK_BASE = { O: 'O', G: 'O', C: 'O', A: 'A', V: 'A', K: 'K', Y: 'Y' };
function runHarness(args) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', () => {});
    child.on('close', (code) => resolveP({ code, err }));
  });
}

test('⑥ L0 하네스 allowCtx 유도 ≡ 제품 cellShapeCtx (대표 케이스 격자, 표 키마다)', { timeout: 115_000 }, async (t) => {
  if (!L0) { t.skip(SKIP_REASON); return; }
  const script = join(L0, 'tl-decode.mjs');
  for (const f of [script, join(L0, 'lib-assemble.mjs'), join(L0, 'lib-tree.mjs')]) {
    assert.ok(existsSync(f), `TL_L0_DIR 이 설정됐는데 하네스 파일이 없다(skip 아님 — 경로 오류): ${f}`);
  }
  const { HUE_SAMPLE_SETS, HUE_SET_DEFAULT } = await import(pathToFileURL(join(L0, 'lib-color-samples.mjs')).href);
  const customHue = HUE_SAMPLE_SETS[HUE_SET_DEFAULT].reduce((a, h) => (Math.abs(h - 210) < Math.abs(a - 210) ? h : a));
  const CASES = [...CASES_BASE, `o-pinwheel|palette=custom${customHue}/sat200`];
  const out = mkdtempSync(join(tmpdir(), 'tl-ctx-locks-'));
  try {
    const SHARDS = 4;
    const groups = Array.from({ length: SHARDS }, (_, i) => CASES.filter((_, j) => j % SHARDS === i));
    const runs = await Promise.all(groups.map((g, i) => runHarness([
      script, '--tree', ROOT, '--grid', 'small', '--cases', g.join(','), '--treatments', 'none', '--no-neg',
      '--qr-arms', 'none', '--out', join(out, `s${i}.jsonl`), '--summary', join(out, `s${i}.summary.json`),
    ])));
    const rows = [];
    runs.forEach((r, i) => {
      const p = join(out, `s${i}.jsonl`);
      assert.ok(existsSync(p), `하네스 샤드 ${i} 가 영수증을 안 썼다(exit ${r.code}): ${r.err.slice(-400)}`);
      for (const line of readFileSync(p, 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line));
    });
    const controls = rows.filter((r) => r.arm === 'control');
    // 통합자 결정 4(2026-09-26, 단계 E2): gap=unknown 케이스는 어두운 · 밝은 표면을 **각각** 잰다 —
    // 대조군 행은 케이스마다가 아니라 (케이스, 표면)마다 하나다. 원격 전수 deco-full-001 에서 옛 기대
    // «케이스마다 하나» 가 unknown 두 케이스에서 빨개져 이 모양으로 옮겼다(하네스 쪽이 맞는 새 사실).
    assert.deepEqual([...new Set(controls.map((r) => r.case))].sort(), [...CASES].sort(), '모든 케이스에 대조군 행');
    const surfaceKeys = controls.map((r) => `${r.case}@${r.surface}`);
    assert.equal(new Set(surfaceKeys).size, surfaceKeys.length, '(케이스, 표면)마다 대조군 행 하나');
    for (const c of CASES.filter((x) => /\|gap=unknown$/.test(x))) {
      const surfaces = new Set(controls.filter((r) => r.case === c).map((r) => r.surface));
      assert.ok(surfaces.size >= 2, `${c}: unknown 등급은 표면 둘 이상을 잰다(결정 4) — ${[...surfaces].join(',')}`);
    }

    const { loadModules, assemble } = await import(pathToFileURL(join(L0, 'lib-assemble.mjs')).href);
    const { openTree } = await import(pathToFileURL(join(L0, 'lib-tree.mjs')).href);
    const M = await loadModules(openTree(ROOT));
    const report = { compared: 0, sources: new Set() };
    for (const row of controls) {
      const where = row.case;
      assert.ok(row.allowCtx, `${where}: 대조군 행에 allowCtx 가 없다(${row.outcome} ${row.reason ?? ''})`);
      // 하네스 사본 값 복원: 제품 모드면 ctxMismatch 의 local 로 되돌린다('*' = 제품 호출 실패 → allowCtx 가 곧 사본).
      const local = { ...row.allowCtx };
      report.sources.add(row.ctxSource ?? 'harness-local');
      for (const m of row.ctxMismatch ?? []) if (m.key !== '*') local[m.key] = m.local;

      const c = caseSpec(row.case);
      const a = assemble(M, c);
      assert.equal(a.label, row.code, `${where}: 케이스 명세 사본이 하네스와 다르다(조립 label)`);
      const pal = c.palette ?? 'slate';
      const cm = /^custom(\d+)(?:\/sat(\d+))?$/.exec(pal);
      const state = {
        ...a.state, bgMode: c.bgMode ?? a.state.bgMode, quietMode: c.quietMode ?? a.state.quietMode,
        preset: cm ? 'custom' : pal, ...(cm ? { customHue: Number(cm[1]), customSat: Number(cm[2] ?? 100) } : {}),
        ...(a.kind === 'y' ? { locatorProfileY: a.locatorProfileY, qrPosition: c.qrPosition ?? a.state.qrPosition } : {}),
      };
      const product = cellShapeCtx(OAK_BASE[c.type], a.encoded, state, { quietColor: a.quietChoice.color });
      assert.ok(product, `${where}: 제품 문맥 null`);
      assert.equal(product.table, local.table, `${where}: 표`);
      for (const k of CELL_SHAPE_ALLOW_KEYS[product.table]) {
        if (k === 'seamAdjacent') {
          // 대조군은 null(square 에 해당 없음 — 처치 팔이 채운다). 제품은 생산자 기본 변형.
          assert.equal(local[k], null, `${where}: 대조군 seamAdjacent`);
          assert.equal(product[k], Y_SEAM_ADJACENT_PRODUCT);
          continue;
        }
        report.compared += 1;
        assert.ok(Object.is(local[k], product[k]), `${where}: 키 ${k} — 하네스 ${JSON.stringify(local[k])} ≠ 제품 ${JSON.stringify(product[k])}`);
      }
    }
    // 등급 셋이 격자에 실제로 다 있다(판별력 — 한 등급만 재면 등급 유도의 갈래를 못 본다).
    const grades = new Set(controls.map((r) => r.allowCtx.gapGrade));
    assert.deepEqual([...grades].sort(), [...CELL_GAP_GRADES].sort(), '격자가 틈 등급 셋을 다 덮는다');
    t.diagnostic(`비교 ${report.compared} 키 · 케이스 ${controls.length} · 하네스 ctxSource ${[...report.sources].join(',')}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
