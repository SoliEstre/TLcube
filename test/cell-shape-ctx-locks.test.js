// cell-shape-ctx-locks.test.js — 제품 문맥 유도(cellShapeCtx · qrDecoCtx)의 성질 + L0 하네스 유도와의 대조
// (레인 README «단계 C 뒤 통합자 결정» 1 · 2 · 3, 레인 D1 2026-09-26)
//
// 재는 것:
//   ① 틈 등급의 어휘와 뜻 — quiet-auto 가 낼 수 있는 판 색 전부를 다루고(검증되는 사본 CELL_GAP_QUIET_COLORS 대조),
//      Y 기본(투명 · auto)은 «미지 표면» 이다(설계 §3.2 safety B2 — Y 기본에서 노출형 모양은 흰 틈 행으로 못 연다).
//   ② 슬롯 판정은 코드(role 'slot' 셀)에서 — cellSurfaceFinal.hasCenterQrSlot 과 모든 Y 레이아웃에서 같은 답.
//   ③ 실효 타입 — C 는 인코딩(notchC)이 판정(상태 표지가 아니라) · G · V · H(null).
//   ④ 제품 경로 문맥은 완전하다(렌더 값 — 안전영역 판 색 · 실효 검출 강조 — 을 주면 표 키 · 설계 잠금 키 · 측정 구성 키가 전부
//      정의) · Y 심 변형은 생산자 기본과 같다.
//   ⑤ qrDecoCtx 는 허용표 QR 키 정확히 + 눈 접기가 resolver 와 같은 뜻.
//   ⑥ (TL_L0_DIR) L0 하네스 tl-decode.mjs 의 allowCtx 유도(하네스 사본 CTX_DERIVE)와 제품 cellShapeCtx 가 대표 케이스
//      격자에서 표 키마다 같다. 하네스는 CLI 스크립트라(유도 함수가 모듈 밖으로 안 나온다) **하위 프로세스로 돌려**
//      대조군 행의 allowCtx 를 읽고, 같은 케이스를 하네스 조립 라이브러리(lib-assemble — export 됨)로 다시 조립해 제품
//      문맥을 만든다. 하네스가 이미 제품 함수를 부르는 모드(ctxSource 'product')면 행의 ctxMismatch 로 하네스 사본 값을
//      복원해 대조한다 — 제품 값끼리 비교하는 자기 참조를 피한다. 허용 차이는 없다(표 키 전부 엄격 일치).
//      이력: 첫 대조(2026-09-26 17:1x)에서 Y 투명 · 판 없음의 gapGrade 가 하네스 'white' · 제품 'unknown' 으로 갈렸다
//      (하네스 L6 «white» 등급이 투명 PNG 를 흰 표면에 합성). 하네스 레인(D2)이 17:2x 에 제품 뜻(설계 §3.2 B2)으로
//      맞추고 Y «white» 등급을 bgMode white(흰 평탄화)로 조립하게 바꿨다 — 그 케이스('y-v0' · 'y-v0|gap=white')가 격자에 있다.
//   ⑦ (TL_L0_DIR) 측정 구성 선언(CELL_SHAPE_MEASURED_CONFIG) ≡ 하네스 조립 — ⑥ 격자(제품 기본 G 계열 g-n7 포함)를 하네스 lib-assemble 로 조립하고 조립
//      sceneOpts 로 실효 검출 강조를 유도(detectorEmphasisEquivalents)해 제품 문맥을 만들면 (1) 문맥이 완전하고 (2) 선언이 있는
//      타입은 측정 구성 값이 선언과 같고(강조는 «선언 값이 같은 그림 집합에 드는가») (3) 하네스 구조 잠금 판정(lib-ctx
//      cellShapeProductLock)이 키 드리프트 없이 제품 cellShapeStructuralLock 과 같은 답을 낸다. 선언은 «그 하네스가 잰 구성» 의
//      주장이라 주석 · git diff 가 아니라 하네스 조립으로 잰다(선언 · 하네스 한쪽만 바뀌면 빨강).
//   ⑧ (TL_L0_DIR) 하네스의 **실제** 처치 주입 경로 — tl-decode 를 처치 팔 하나로 하위 프로세스 실행해, 처치 행이 render-error 없이
//      allowShape 또는 allowWithheld 를 받는지 본다. ⑥ 은 --treatments none 이라 이 경로를 안 지난다. 왜 따로 재나(2026-09-27
//      실측): 하네스가 제품 문맥에 측정 구성 키(detectorEmphasis)를 안 실으면 lib-ctx 가 «키 드리프트» 로 던지는데, tl-decode
//      trial 이 그것을 render-error 로 삼키고(처치 표지보다 먼저 던져 producerPath.treatmentErrors 에도 안 잡힌다) 처치 행을
//      treatment-invalid 로 세어 **판정 PASS · exit 0** 으로 끝난다 — 영수증에 allowShape 를 받은 처치 행이 조용히 0 개가 된다.
//      이 자가 그 경로의 유일한 자다.
// TL_L0_DIR 이 없으면(⑥ · ⑦ · ⑧) 명시 사유로 skip — public 트리에는 private 하네스가 없다. 나머지는 항상 돈다.

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
import { detectorEmphasisEquivalents, encodeOptionsForY } from '../src/generator-render-config.js';
import { makeCustomPalette } from '../src/palette-hue.js';
import * as CELL_SHAPE_MODULE from '../src/cell-shape.js';
import {
  CELL_GAP_GRADES, CELL_GAP_QUIET_COLORS, CELL_SHAPE_ALLOW_KEYS, CELL_SHAPE_LOCK_CTX_KEYS, CELL_SHAPE_MEASURED_CONFIG,
  CELL_SHAPE_MEASURED_CONFIG_KEYS, CELL_SHAPE_REQUIRED_CTX_KEYS, Y_SEAM_ADJACENT_PRODUCT,
  cellGapGrade, cellShapeAllowCtx, cellShapeCtx, cellShapeStructuralLock, cellShapeTypeOf, paletteGradeOf,
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
      // 렌더 값 = 안전영역 판 색 + 실효 검출 강조(생산자 옵션 — 이 팔레트 · 상태 파인더 · O/A/K 는 상태 강조, Y 일반 화면은 안
      // 싣는다 — 에서 제품 유도 함수로). 둘 중 하나라도 없으면 그 키가 undefined 다(값 모름 — 잠금).
      const levels = preset === 'custom' ? makeCustomPalette(FRESH.customHue, 'custom', FRESH.customSat).levels : getPreset(preset).levels;
      const sceneOpts = { palette: { levels }, finderPatternId: st.finderPatternId };
      if (type !== 'Y') sceneOpts.centralN7Emphasis = st.centralN7Emphasis;
      const render = { quietColor: 'none', detectorEmphasis: detectorEmphasisEquivalents(type, enc, sceneOpts) };
      const ctx = cellShapeCtx(type, enc, { ...st, preset }, render);
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
  'g-n7': { type: 'G' }, // L6g — 제품 기본 O(자동 안쪽 o-cm = 실효 타입 G) · 생성기 기본 파인더(중앙 n7)
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
  // 제품 기본 O(자동 안쪽 o-cm = 실효 타입 G) · 생성기 기본 파인더(중앙 n7) — L6g 계열. 'G|pinwheel…' 는 고른 조합이고 강조
  // 구조가 다르다(중앙 두 팔 'all' vs 코너 마커 검출 셀 한 팔 'locator+all'). 하네스 tl-decode FAMILIES 가 'g-n7' 을 받는다
  // (2026-09-27 검토에서 --cases g-n7 실행 확인 — 옛 «⑦ 에만» 은 그 확인 전의 보류였다).
  'g-n7',
  'y-v0', 'y-v0|gap=white', 'y-v0|gap=black', 'y-v0|gap=unknown', 'y-v0|bg=white',
  'Y|hex-frame-v1|t3', 'Y|cell-surface-v0ty|t3', 'Y|off|t2',
];
const OAK_BASE = { O: 'O', G: 'O', C: 'O', A: 'A', V: 'A', K: 'K', Y: 'Y' };
/** ⑥ · ⑦ 의 케이스 격자 — CASES_BASE + 하네스 기본 hue 표본 중 210° 에 가장 가까운 custom(sat 200) 한 케이스. */
async function l0CaseIds() {
  const { HUE_SAMPLE_SETS, HUE_SET_DEFAULT } = await import(pathToFileURL(join(L0, 'lib-color-samples.mjs')).href);
  const customHue = HUE_SAMPLE_SETS[HUE_SET_DEFAULT].reduce((a, h) => (Math.abs(h - 210) < Math.abs(a - 210) ? h : a));
  return [...CASES_BASE, `o-pinwheel|palette=custom${customHue}/sat200`];
}
/** 제품 문맥 함수에 넘길 상태 — 하네스 조립 상태 + 케이스가 바꾼 값(하네스 productStateOf 와 같은 결). */
function productStateFor(c, a) {
  const pal = c.palette ?? 'slate';
  const cm = /^custom(\d+)(?:\/sat(\d+))?$/.exec(pal);
  return {
    ...a.state, bgMode: c.bgMode ?? a.state.bgMode, quietMode: c.quietMode ?? a.state.quietMode,
    preset: cm ? 'custom' : pal, ...(cm ? { customHue: Number(cm[1]), customSat: Number(cm[2] ?? 100) } : {}),
    ...(a.kind === 'y' ? { locatorProfileY: a.locatorProfileY, qrPosition: c.qrPosition ?? a.state.qrPosition } : {}),
  };
}
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
  const CASES = await l0CaseIds();
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
      const product = cellShapeCtx(OAK_BASE[c.type], a.encoded, productStateFor(c, a), { quietColor: a.quietChoice.color });
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

// ── ⑦ 측정 구성 선언 ≡ 하네스 조립 (TL_L0_DIR) ─────────────────────────────

/** 측정 구성 값 비교 — 강조는 문맥이 «같은 그림 집합» 이라 선언 값이 그 집합에 드는가, 나머지는 같은 값인가(resolver 와 같은 뜻). */
const measuredSame = (k, ctxValue, declared) => (k === 'detectorEmphasis'
  ? typeof ctxValue === 'string' && ctxValue.split('+').includes(declared)
  : ctxValue === declared);

test('⑦ 측정 구성 선언 ≡ L0 하네스 조립 — 조립 sceneOpts 로 유도한 문맥이 완전하고 선언과 같으며, 하네스 구조 잠금 판정이 키 드리프트 없이 답한다', async (t) => {
  if (!L0) { t.skip(SKIP_REASON); return; }
  for (const f of ['lib-assemble.mjs', 'lib-tree.mjs', 'lib-ctx.mjs', 'lib-color-samples.mjs']) {
    assert.ok(existsSync(join(L0, f)), `TL_L0_DIR 이 설정됐는데 하네스 파일이 없다(skip 아님 — 경로 오류): ${f}`);
  }
  const { loadModules, assemble } = await import(pathToFileURL(join(L0, 'lib-assemble.mjs')).href);
  const { openTree } = await import(pathToFileURL(join(L0, 'lib-tree.mjs')).href);
  const { cellShapeProductLock } = await import(pathToFileURL(join(L0, 'lib-ctx.mjs')).href);
  const M = await loadModules(openTree(ROOT));
  const declaredSeen = new Set();
  const undeclaredSeen = new Set();
  const structural = {};
  for (const id of await l0CaseIds()) {
    const c = caseSpec(id);
    const a = assemble(M, c);
    const base = OAK_BASE[c.type];
    // 하네스가 제품 문맥에 실어야 하는 렌더 값 — 안전영역 판 색 + 조립 sceneOpts(생산자에 실제로 넘긴 옵션)의 실효 검출 강조.
    const render = { quietColor: a.quietChoice.color, detectorEmphasis: detectorEmphasisEquivalents(base, a.encoded, a.sceneOpts) };
    const ctx = cellShapeCtx(base, a.encoded, productStateFor(c, a), render);
    assert.ok(ctx, `${id}: 제품 문맥 null`);
    const missing = CELL_SHAPE_REQUIRED_CTX_KEYS[ctx.table].filter((k) => ctx[k] === undefined);
    assert.deepEqual(missing, [], `${id}: 조립 sceneOpts 로 유도한 문맥에 빠진 키`);
    const declared = CELL_SHAPE_MEASURED_CONFIG[ctx.table === 'y' ? 'Y' : ctx.type];
    if (declared) {
      declaredSeen.add(ctx.table === 'y' ? 'Y' : ctx.type);
      for (const k of CELL_SHAPE_MEASURED_CONFIG_KEYS[ctx.table]) {
        assert.ok(measuredSame(k, ctx[k], declared[k]),
          `${id}: 측정 구성 ${k} — 하네스 조립 ${JSON.stringify(ctx[k])} 가 선언 ${JSON.stringify(declared[k])} 와 다르다 `
          + '(선언은 하네스가 잰 구성이다 — 영수증에서 다시 유도하거나 하네스 조립을 되돌릴 것)');
      }
    } else undeclaredSeen.add(ctx.type);
    // 하네스 구조 잠금 판정에 이 문맥의 행을 주입 — 키 드리프트면 lib-ctx 가 던진다(빨강). 답은 제품 구조 잠금과 같아야 한다.
    const lock = cellShapeProductLock(CELL_SHAPE_MODULE, { table: ctx.table, ctx: cellShapeAllowCtx(ctx), resolverCtx: ctx, kind: 'round', param: 0.7 });
    assert.equal(lock, cellShapeStructuralLock(ctx.table, 'round', 0.7, ctx), `${id}: 하네스 구조 잠금 판정 ≠ 제품 구조 잠금`);
    if (lock) structural[lock] = (structural[lock] ?? 0) + 1;
  }
  // 판별력 — 선언이 있는 타입 전부가 격자에 있다(선언을 더하면 그 타입 케이스도 격자에 더할 것).
  assert.deepEqual([...declaredSeen].sort(), Object.keys(CELL_SHAPE_MEASURED_CONFIG).sort(), '격자가 측정 구성 선언 타입을 다 덮는다');
  t.diagnostic(`선언 대조 ${[...declaredSeen].join(',')} · 선언 없음 ${[...undeclaredSeen].join(',') || '-'} · 구조 잠금 ${JSON.stringify(structural)}`);
});

// ── ⑧ 하네스 실제 처치 주입 경로 (TL_L0_DIR) ──────────────────────────────

/**
 * 처치 경로 격자 — 강조 구조가 다른 계열 다섯(O 해당 없음 · A 중앙+코너 마커 · K 중앙+코너 마커 · G 중앙+코너 마커 셀(제품 기본 O) ·
 * Y 셀 표면). G(g-n7)는 L6g 로 행이 생긴 제품 기본 타입이라 그 하네스 주입 경로도 잰다(2026-09-27 검토 minor).
 */
const TREATMENT_PATH_CASES = ['o-pinwheel', 'a-n7', 'k-n7', 'g-n7', 'y-v0'];

test('⑧ L0 하네스 처치 주입 경로 — 처치 행이 제품 resolver 에서 키 드리프트 없이 판정된다(render-error 0 · 행마다 allowShape 또는 allowWithheld)', { timeout: 115_000 }, async (t) => {
  if (!L0) { t.skip(SKIP_REASON); return; }
  const script = join(L0, 'tl-decode.mjs');
  assert.ok(existsSync(script), `TL_L0_DIR 이 설정됐는데 하네스 파일이 없다(skip 아님 — 경로 오류): ${script}`);
  const out = mkdtempSync(join(tmpdir(), 'tl-ctx-treat-'));
  try {
    const jsonl = join(out, 'treat.jsonl');
    const r = await runHarness([
      script, '--tree', ROOT, '--grid', 'small', '--cases', TREATMENT_PATH_CASES.join(','), '--treatments', 'round70', '--no-neg',
      '--qr-arms', 'none', '--out', jsonl, '--summary', join(out, 'treat.summary.json'),
    ]);
    assert.ok(existsSync(jsonl), `하네스가 영수증을 안 썼다(exit ${r.code}): ${r.err.slice(-400)}`);
    const rows = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const treated = rows.filter((x) => x.arm !== 'control');
    assert.deepEqual([...new Set(treated.map((x) => x.case))].sort(), [...TREATMENT_PATH_CASES].sort(), '케이스마다 처치 행이 있다');
    const errors = treated.filter((x) => x.outcome === 'render-error' || (!x.allowShape && !x.allowWithheld));
    assert.deepEqual(errors.map((x) => `${x.case}:${x.arm}:${x.outcome}:${String(x.reason ?? '').slice(0, 90)}`), [],
      '처치 행이 제품 resolver 주입에서 쓰러졌다. «키 드리프트(ctx-incomplete)» 면 하네스(tl-decode.mjs allowCtxBaseOf)의 cellShapeCtx 호출이 '
      + '측정 구성 키 detectorEmphasis 를 안 싣는 것이다 — render 에 generator-render-config detectorEmphasisEquivalents(타입, a.encoded, a.sceneOpts) '
      + '를 실어 하네스를 고친다(src/cell-shape.js CELL_SHAPE_MEASURED_CONFIG TODO). 하네스는 이 행들을 treatment-invalid 로 세고 판정 PASS 로 끝나므로 '
      + '이 자를 느슨하게 하면 영수증의 처치 행이 조용히 0 개가 된다');
    t.diagnostic(`처치 행 ${treated.length} · allowShape ${treated.filter((x) => x.allowShape).length} · allowWithheld ${treated.filter((x) => x.allowWithheld).length}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
