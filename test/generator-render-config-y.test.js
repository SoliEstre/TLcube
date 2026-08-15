// generator-render-config-y.test.js — Type Y 인코더 옵션 경계.
//
// 왜 필요한가: 윈도 β(안쪽 폴백 QR)는 **Y2 · 2톤 전용**(ADR 0003 D1 조건 ②)인데,
// 생성기는 version 만 강제하고 tones 는 사용자 값을 그대로 넘겼다. 생성기 기본 톤이 3 이라
// **「타입 Y + 3톤 + 안쪽 QR」이면 RangeError 로 렌더가 통째로 죽었다** — 사용자가 실기기에서
// 발견했다. 그 조합이 인라인 HTML 안에만 있어 테스트가 닿지 않던 것이 원인이다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeOptionsForY } from '../src/generator-render-config.js';
import { encodeY } from '../src/encodeY.js';
import { WINDOW_SUPPORTED_TONES, WINDOW_SUPPORTED_VERSION } from '../src/capacityY.js';
import {
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0X,
  LOCATOR_PROFILE_CELL_SURFACE_V1R2,
  LOCATOR_PROFILE_CELL_SURFACE_V2R2,
} from '../src/locatorY.js';

const TEXT = 'https://tl.estre.so';
const windowState = (tone) => ({ tone, versionY: undefined, fallback: { mode: 'window' } });

test('안쪽 폴백 QR(윈도 β)은 사용자 톤과 무관하게 Y2·2톤으로 인코딩된다', () => {
  for (const tone of [2, 3]) {
    const opts = encodeOptionsForY(windowState(tone));
    assert.equal(opts.window, true, `tone=${tone}: window 플래그`);
    assert.equal(opts.tones, WINDOW_SUPPORTED_TONES, `tone=${tone}: 톤이 2 로 강제돼야 한다`);
    assert.equal(opts.version, WINDOW_SUPPORTED_VERSION, `tone=${tone}: 버전이 Y2 로 강제돼야 한다`);
  }
});

// 회귀의 핵심 — 옵션이 «그럴듯한 모양» 인 것으로는 부족하고 실제로 인코딩돼야 한다.
test('기본값(3톤)에서 안쪽 QR 을 골라도 렌더가 죽지 않는다 — 실기기 신고 회귀', () => {
  assert.doesNotThrow(() => encodeY(TEXT, encodeOptionsForY(windowState(3))));
  const encoded = encodeY(TEXT, encodeOptionsForY(windowState(3)));
  assert.equal(encoded.tones, WINDOW_SUPPORTED_TONES);
});

// 강제는 윈도일 때만이다. 벗어나면 사용자가 고른 톤·해상도가 그대로 살아야 한다 —
// 저장값을 건드리면 «안쪽을 한 번 눌렀더니 톤이 영영 2 로 바뀌는» 사고가 난다.
test('윈도가 아니면 사용자가 고른 톤·해상도를 그대로 넘긴다', () => {
  for (const mode of ['none', 'corner']) {
    const opts = encodeOptionsForY({ tone: 3, versionY: 1, fallback: { mode } });
    assert.equal(opts.tones, 3, `${mode}: 톤 보존`);
    assert.equal(opts.version, 1, `${mode}: 해상도 보존`);
    assert.equal(opts.window, undefined, `${mode}: window 플래그가 붙으면 안 된다`);
  }
  const auto = encodeOptionsForY({ tone: 2, versionY: undefined, fallback: { mode: 'none' } });
  assert.equal('version' in auto, false, 'auto 해상도는 version 을 안 넘긴다');
});

// 최종 라인업 (2026-08-15): v0 = Y0(n=13) 고정 · v2r2 = Y1 기본/Y2 명시. 초안
// (v1r2/v2) 매핑은 UI 경계에서 내렸다 — 초안 인코딩은 encodeY 직접 옵션으로만 산다.
test('셀 표면 v0 는 version=0 을 강제하되 사용자 톤을 보존하고 윈도보다 앞선다', () => {
  for (const tone of [2, 3]) {
    const opts = encodeOptionsForY({
      tone,
      versionY: 1,
      fallback: { mode: 'window' },
      locatorProfileY: LOCATOR_PROFILE_CELL_SURFACE_V0,
    });
    assert.equal(opts.cellSurface, true);
    assert.equal(opts.cellSurfaceLayout, 'v0');
    assert.equal(opts.tones, tone);
    assert.equal(opts.version, 0);
    assert.equal(opts.window, undefined);
    const encoded = encodeY('short', opts);
    assert.equal(encoded.cellSurface, true);
    assert.equal(encoded.cellSurfaceLayout, 'v0');
    assert.equal(encoded.n, 13);
    assert.equal(encoded.tones, tone);
    assert.equal(encoded.formatIndex, tone === 3 ? 3 : 1);
    assert.equal(encoded.capacity.dataCells, 112);
  }
});

test('셀 표면 v2r2 는 Y1 기본·Y2 명시 선택만 n=25 이고 사용자 톤을 보존한다', () => {
  for (const tone of [2, 3]) {
    for (const [versionY, wantVersion, wantN] of [[0, 1, 21], [1, 1, 21], [2, 2, 25], [undefined, 1, 21]]) {
      const opts = encodeOptionsForY({
        tone,
        versionY,
        fallback: { mode: 'window' },
        locatorProfileY: LOCATOR_PROFILE_CELL_SURFACE_V2R2,
      });
      assert.equal(opts.cellSurface, true);
      assert.equal(opts.cellSurfaceLayout, 'v2r2');
      assert.equal(opts.tones, tone);
      assert.equal(opts.version, wantVersion, 'versionY=' + versionY);
      assert.equal(opts.window, undefined);
      const encoded = encodeY('https://tl.estre.so', opts);
      assert.equal(encoded.cellSurfaceLayout, 'v2r2');
      assert.equal(encoded.n, wantN, 'versionY=' + versionY);
      assert.equal(encoded.formatIndex, tone === 3 ? 3 : 1);
      // 의도적 갱신 (2026-08-16): v2r2 중앙 블록 교체(painted 65→74)로 data 가
      // 349→340 · 533→524 로 재산정됐다.
      assert.equal(encoded.capacity.dataCells, wantN === 25 ? 524 : 340);
    }
  }
});

test('상태가 없거나 폴백이 빠지면 조용히 넘어가지 않는다', () => {
  assert.throws(() => encodeOptionsForY(null), TypeError);
  assert.throws(() => encodeOptionsForY({ tone: 3 }), TypeError);
});

test('셀 표면 v0X 는 버전 선택과 무관하게 Y1(n=21) 이고 사용자 톤을 보존한다', () => {
  // 2026-08-16: n=21 3파전 후보 (QR 파인더 문법 65셀). v1r2 와 같은 계약 —
  // n=25 가 없으므로 사용자가 Y2 를 골라도 Y1 로 고정한다.
  for (const tone of [2, 3]) {
    for (const versionY of [0, 1, 2, undefined]) {
      const opts = encodeOptionsForY({
        tone,
        versionY,
        fallback: { mode: 'window' },
        locatorProfileY: LOCATOR_PROFILE_CELL_SURFACE_V0X,
      });
      assert.equal(opts.cellSurface, true);
      assert.equal(opts.cellSurfaceLayout, 'v0x');
      assert.equal(opts.tones, tone);
      assert.equal(opts.version, 1, 'versionY=' + versionY);
      assert.equal(opts.window, undefined, '윈도보다 앞선다');
      const encoded = encodeY(TEXT, opts);
      assert.equal(encoded.cellSurfaceLayout, 'v0x');
      assert.equal(encoded.locatorProfile, 'cell-surface-v0x');
      assert.equal(encoded.n, 21);
      assert.equal(encoded.formatIndex, tone === 3 ? 3 : 1);
      // v0X 는 파인더가 65셀이라 v1r2(334)·v2r2(340) 보다 데이터가 많다.
      assert.equal(encoded.capacity.dataCells, 349);
    }
  }
});

test('셀 표면 v1r2 는 버전 선택과 무관하게 Y1(n=21) 이고 사용자 톤을 보존한다', () => {
  // 2026-08-15 밤: 「실험 프레임 β」 자리를 대신하는 n=21 A/B 후보. n=25 가 없으므로
  // 사용자가 Y2 를 골라도 Y1 로 고정한다 (조용히 v2r2 로 넘어가지 않는다).
  for (const tone of [2, 3]) {
    for (const versionY of [0, 1, 2, undefined]) {
      const opts = encodeOptionsForY({
        tone,
        versionY,
        fallback: { mode: 'window' },
        locatorProfileY: LOCATOR_PROFILE_CELL_SURFACE_V1R2,
      });
      assert.equal(opts.cellSurface, true);
      assert.equal(opts.cellSurfaceLayout, 'v1r2');
      assert.equal(opts.tones, tone);
      assert.equal(opts.version, 1, 'versionY=' + versionY);
      assert.equal(opts.window, undefined, '윈도보다 앞선다');
      const encoded = encodeY(TEXT, opts);
      assert.equal(encoded.cellSurfaceLayout, 'v1r2');
      assert.equal(encoded.locatorProfile, 'cell-surface-v1r2');
      assert.equal(encoded.n, 21);
      assert.equal(encoded.formatIndex, tone === 3 ? 3 : 1);
      assert.equal(encoded.capacity.dataCells, 334);
    }
  }
});
