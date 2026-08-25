/**
 * cellSurfaceFinal-decode.test.js — 최종 라인업 합성 왕복 (lab 경로) + 정식 경로 음성.
 *
 * v0(n=13) · v2r2(n=21/25) × 2톤/3톤. 정식 `/` 는 enableCellSurfaceY 없이는 이
 * 심볼들을 수용하지 않는다 (안정판 불변식 — scanner-i18n.test.js 의 isLabPath 게이트).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { hasCenterQrSlot } from '../src/cellSurfaceFinal.js';
import { TL_READER_URL } from '../src/qr.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';
/**
 * **드랍된** 와이어 라인업 (v2r2@21 · v2r2@25). 판독 능력 보존의 회귀다 —
 * 스위치(RESTORE_DROPPED) 없이는 검출 라인업에 없다.
 * 의도적 갱신 «드랍 정본화» (2026-08-16).
 */
const LINEUP = Object.freeze([
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v2r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 2, n: 25 },
]);

/**
 * 드랍 후 **기본 라인업** — 스위치 없이 검출·복호되어야 하는 것들.
 * 의도적 갱신 «v0W 편입» (2026-08-16): v0w 가 n=21 세 번째 후보로 들어왔다.
 * 기본(`finalLayoutIdForN(21)`)은 여전히 v0x 이지만, 왕복은 셋 다 서야 한다.
 */
// 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): v0wq 가 n=21 네 번째 후보로 들어왔다.
// v0WY 는 **여기 없다** — 와이어가 v0W 라 이 표에서는 v0w 행이 곧 v0WY 의 왕복이다
// (그 사실 자체는 cellSurface-block-locator-v0wy-w2.test.js 의 «v0WY 는 렌더 선택이다» 가 잰다).
// 의도적 갱신 «v0W2 편입» (2026-08-17): v0w2 가 n=21 다섯 번째 후보로 들어왔다.
//
// **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드)** —
// v0x 행을 **활성 표에서 드랍 보존 표로 옮긴다** (값·버전·n 무변경).
// 이 파일에서 두 표를 가르는 기준은 «스위치 없이 도는가» 하나다 — 드랍된
// 레이아웃은 정의상 스위치가 있어야 돌고, 그것이 «차단» 의 증명이다.
//
// **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
// v0T 가 Type Y 최종 파인더로 확정되면서 v0w · v0wq · v0w2 행이 드랍 보존 표로
// 옮겨 가고, 활성 표는 v0 · v0t · v0ty 가 된다. 기본은 **v0t** 로 승계된다
// (v0w → v0t). 값·버전·n 은 어느 행도 안 바뀐다.
//
// ⚠ **v0wy 행은 여기 없다** — 드랍 전에도 이 파일의 활성 표에 없었고, 그 왕복
// 회귀는 `cellSurface-block-locator-v0wy-w2.test.js` 가 자기 조건(ppu 15 · embed960)으로
// 잰다. 실측 (`claude-v0t-wy-restore-debug.out.txt`): 이 파일의 조건(ppu 10)에서는
// v0wy 가 복원 스위치를 다 켜도 안 돌고, ppu 15 에서는 돈다 — 즉 여기 행을
// 신설하면 «드랍 때문» 이 아닌 실패를 드랍 회귀로 오인하게 된다 (행별 조건은
// 드랍 전 그대로 보존한다는 이 표의 규약).
const ACTIVE_LINEUP = Object.freeze([
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v0t', version: 1, n: 21 },
  { layout: 'v0ty', version: 1, n: 21 },
]);

/** 드랍 보존 팔 — 복원 스위치 위에서만 돌고, 값은 드랍 전과 같다. */
const DROPPED_N21_LINEUP = Object.freeze([
  { layout: 'v0x', version: 1, n: 21 },
  { layout: 'v0w', version: 1, n: 21 },
  { layout: 'v0wq', version: 1, n: 21 },
  { layout: 'v0w2', version: 1, n: 21 },
]);

function renderFinal(text, {
  layout, version, tones = 2, eccLevel = 'M',
  pixelsPerUnit = 10, supersample = 2, margin = 16,
} = {}) {
  const encoded = encodeY(text, {
    cellSurfaceLayout: layout, version, tones, eccLevel,
  });
  // 중앙 QR 변형(v0xq · v0wq)은 QR 이 레이아웃 정의의 일부라 qrText 가 필수다.
  const scene = buildSceneY(encoded, {
    palette: PALETTE,
    margin,
    ...(hasCenterQrSlot(layout) ? { qrText: TL_READER_URL } : {}),
  });
  const raster = rasterize(scene, { pixelsPerUnit, supersample });
  return { encoded, scene, raster };
}

/**
 * **드랍 복원 스위치** (운영자 확정 2026-08-16 «v2r2 · v1r2 실험판 드랍»).
 *
 * 이 파일의 LINEUP 은 **와이어 왕복**을 재는 것이라 드랍 뒤에도 그대로 유지한다 —
 * 드랍은 «차단» 이지 «삭제» 가 아니고, 그 사실의 증명이 바로 이 스위치 두 개다:
 *   · `calibration.csBlockLocator.{v2r2Family, v1r2Family}` → 블록 로케이터 패밀리
 *   · `includeDroppedCellSurfaceLayouts` → CS 평가 후보
 * 게이트(agreement 0.78 · margin 0.035 · CRC · RS)는 **한 값도 안 건드린다**.
 * 기본 라인업(v0 · v0X · v0XQ)의 왕복은 아래 «활성 라인업» 테스트가 스위치 없이 잰다.
 */
const RESTORE_DROPPED = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  calibration: { csBlockLocator: { v2r2Family: true, v1r2Family: true } },
});

function decodeLab(raster, extra = undefined) {
  return decodeFrontend(raster, {
    bootstrap: {
      family: {
        cube: {
          enableLocatorY: true,
          enableCellSurfaceY: true,
          ...(extra === undefined ? {} : extra),
        },
      },
    },
  });
}

test('활성 라인업 왕복 — v0(n=13)·v0T 계열(n=21) × 2톤/3톤 (스위치 없음)', {
  timeout: 300_000,
}, () => {
  for (const { layout, version, n } of ACTIVE_LINEUP) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version, tones });
      const result = decodeLab(fixture.raster);
      assert.equal(result.ok, true, JSON.stringify({
        layout, n, tones, reason: result.reason,
      }));
      assert.equal(result.text, PAYLOAD);
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
      assert.equal(result.hypothesis.n, n);
    }
  }
});

/**
 * **v0TR 계열 왕복** (편입 2026-08-17) — 위 «활성 라인업» 바로 옆에 **따로** 둔다.
 *
 * 옆에 붙이는 이유: 위 테스트는 드랩 이력을 지나온 **기존 핀**이라, 새 계열을
 * 그 안으로 넣으면 실패했을 때 «어느 쪽이 깨졌는가» 를 바로 못 읽는다.
 *
 * 재는 것은 셀 표면의 전 구간이다 — 인코드 → 렌더 → 블록 로케이터 → refinePose
 * → CS 게이트(0.78 / 0.035) → RS → 페이로드. 게이트는 한 값도 안 건드렸다.
 *
 * ⚠ **레이아웃 id 까지 단언한다.** v0tr ↔ v0trq 는 이상 표본기에서 구조적
 * 별칭이지만(§cellSurfaceFinal.test.js), 실물 래스터에서는 슬롯 자리에 진짜 픽셀
 * (QR 모듈·필러)이 있어 갈리는지를 여기서 재는 것이 본론이다.
 */
test('v0TR 계열 왕복 — v0tr · v0trq (n=21) × 2톤/3톤 (스위치 없음)', {
  timeout: 300_000,
}, () => {
  for (const layout of ['v0tr', 'v0trq']) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version: 1, tones });
      const result = decodeLab(fixture.raster);
      assert.equal(result.ok, true, JSON.stringify({
        layout, tones, reason: result.reason,
      }));
      assert.equal(result.text, PAYLOAD);
      assert.equal(result.hypothesis.cellSurfaceLayout, layout,
        layout + '@' + tones + '톤 이 ' + result.hypothesis.cellSurfaceLayout + ' 로 읽혔다');
      assert.equal(result.hypothesis.n, 21);
    }
  }
});

/**
 * **v0TRY 왕복** (편입 2026-08-18) — 위 v0TR 계열 테스트 **바로 옆**에 따로 둔다
 * (같은 이유: 실패했을 때 «어느 파생이 깨졌는가» 를 바로 읽어야 한다).
 *
 * ⚠ 이 테스트가 이번 편입의 **§6 판단 근거**다. 이상 표본기
 * (`cellSurfaceFinal.test.js` §교차 수용 ④-c)에서는 v0try 프레임이 **v0tr 로**
 * 뽑힌다 — 동률 1.0 에서 기반이 이기는 구조다. 그런데 그것은 v0ty 프레임이 v0t 로,
 * v0trq 프레임이 v0tr 로 뽑히는 것과 **문자 그대로 같은 좌표**이고 (두 파생 모두
 * 이미 배포돼 있다), 실물 래스터에서는 슬롯 자리에 진짜 픽셀(QR 모듈·필러)이 있어
 * 갈린다. **그 «갈린다» 를 값으로 재는 것이 여기다** — 레이아웃 id 까지 단언한다.
 * 실측 대조: `test/output/lanes/claude-v0try-detect.mjs` ② (10/10 정확).
 */
test('v0TRY 왕복 — v0try (n=21) × 2톤/3톤 (스위치 없음)', {
  timeout: 300_000,
}, () => {
  for (const tones of [2, 3]) {
    const fixture = renderFinal(PAYLOAD, { layout: 'v0try', version: 1, tones });
    const result = decodeLab(fixture.raster);
    assert.equal(result.ok, true, JSON.stringify({
      layout: 'v0try', tones, reason: result.reason,
    }));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v0try',
      'v0try@' + tones + '톤 이 ' + result.hypothesis.cellSurfaceLayout + ' 로 읽혔다');
    assert.equal(result.hypothesis.n, 21);
  }
});

/**
 * **슬롯 계열 n=25 왕복** (레인 QR25, 2026-08-25) — 세 레이아웃 × n=21·25 × ECC L/M/H.
 * 기존 v0T·v0TR n=25 테스트와 같은 파이프라인: encodeY → buildSceneY → rasterize →
 * decodeFrontend. 슬롯 레이아웃은 qrText 가 필수 (`renderFinal` 이 hasCenterQrSlot 로
 * 채운다). 레이아웃 id 와 n 까지 단언한다.
 */
test('슬롯 계열 왕복 — v0ty · v0trq · v0try × n=21/25 × ECC L/M/H (스위치 없음)', {
  timeout: 600_000,
}, () => {
  const LAYOUTS = ['v0ty', 'v0trq', 'v0try'];
  for (const layout of LAYOUTS) {
    for (const { version, n } of [{ version: 1, n: 21 }, { version: 2, n: 25 }]) {
      for (const eccLevel of ['L', 'M', 'H']) {
        const fixture = renderFinal(PAYLOAD, {
          layout, version, tones: 2, eccLevel,
        });
        assert.equal(fixture.encoded.n, n, layout + ' version=' + version);
        assert.equal(fixture.encoded.eccLevel, eccLevel);
        const result = decodeLab(fixture.raster);
        assert.equal(result.ok, true, JSON.stringify({
          layout, n, eccLevel, reason: result.reason,
        }));
        assert.equal(result.text, PAYLOAD, layout + '@' + n + ' ECC-' + eccLevel);
        assert.equal(result.hypothesis.cellSurfaceLayout, layout,
          layout + '@' + n + ' ECC-' + eccLevel + ' 이 '
          + result.hypothesis.cellSurfaceLayout + ' 로 읽혔다');
        assert.equal(result.hypothesis.n, n);
        assert.equal(result.eccLevel, eccLevel);
      }
    }
  }
});

test('드랍 n=21 왕복 (복원 스위치) — v0X · v0W 계열 4종 × 2톤/3톤', {
  timeout: 600_000,
}, () => {
  // «차단이지 삭제가 아니다» 의 증명 — 스위치를 켤때 왕복이 둘 다 살아 있고,
  // 안 켰을 때는 복호 자체가 안 된다 (두 팔을 함께 재야 드랍이 실제로 걸렸다고 말할 수 있다).
  const restore = {
    includeDroppedCellSurfaceLayouts: true,
    calibration: {
      csBlockLocator: {
        v0xFamily: true,
        v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
      },
    },
  };
  for (const { layout, version, n } of DROPPED_N21_LINEUP) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version, tones });
      const restored = decodeLab(fixture.raster, restore);
      assert.equal(restored.ok, true, JSON.stringify({
        layout, n, tones, reason: restored.reason,
      }));
      assert.equal(restored.text, PAYLOAD);
      assert.equal(restored.hypothesis.cellSurfaceLayout, layout);
      assert.equal(restored.hypothesis.n, n);
      const blocked = decodeLab(fixture.raster);
      assert.equal(blocked.ok, false,
        layout + ' t' + tones + ' 이 스위치 없이도 복호됐다 — 드랍이 안 걸렸다');
    }
  }
});

test('와이어 왕복 (드랍 복원) — v0(n=13)·v2r2(n=21/25) × 2톤/3톤', {
  timeout: 300_000,
}, () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version, tones });
      const result = decodeLab(fixture.raster, RESTORE_DROPPED);
      assert.equal(result.ok, true, JSON.stringify({
        layout, n, tones, reason: result.reason,
      }));
      assert.equal(result.text, PAYLOAD);
      assert.equal(result.family, 'cube');
      assert.equal(result.tones, tones);
      assert.equal(result.hypothesis.cellSurface, true);
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
      assert.equal(result.hypothesis.locatorProfile, 'cell-surface-' + layout);
      assert.equal(result.hypothesis.n, n);
      assert.equal(result.diagnostics.format.formatIndex, tones === 3 ? 3 : 1);
      assert.equal(
        result.versionName,
        'Y' + version + (tones === 3 ? 'T' : '') + '-CS-' + layout.toUpperCase(),
      );
    }
  }
});

test('직각 회전 왕복 — v0@13 (활성) · v2r2@21 (드랍 복원, 2톤)', {
  timeout: 300_000,
}, () => {
  for (const { layout, version } of [LINEUP[0], LINEUP[1]]) {
    const extra = layout === 'v2r2' ? RESTORE_DROPPED : undefined;
    const fixture = renderFinal(PAYLOAD, {
      layout, version, tones: 2, margin: 20,
    });
    for (const degrees of [0, 90, 180, 270]) {
      const rotated = distortImage(fixture.raster, { rotation: degrees, fill: FILL });
      const result = decodeLab(rotated, extra);
      assert.equal(
        result.ok === true && result.text === PAYLOAD,
        true,
        JSON.stringify({ layout, degrees, reason: result.reason }),
      );
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
    }
  }
});

/*
 * ⚠ **핀 뒤집기 (2026-08-19 · 운영자 결정)** — 이 자리에 있던 테스트는
 * 「정식 경로(enableCellSurfaceY 없음)는 최종 라인업을 **수용하지 않는다**」였다.
 * 셀 표면이 시험판 전용이라는 전제 위의 명제였고, 그 전제가 뒤집혔다 —
 * 인쇄 포스터가 v0 셀 표면이 되면서 `enableCellSurfaceY` 기본값이 켜짐으로 올라갔다.
 * (같은 계열의 핀이 `test/cellSurface-block-locator-anchored.test.js` 에도 있었고 함께 뒤집었다.)
 *
 * **지우지 않고 뒤집는다.** 이 핀이 원래 막던 것은 «계열이 조용히 정식으로 새는 것»
 * 인데, 지워 버리면 그 감시가 반대 방향으로 사라진다. 오늘은 샌 게 아니라 옮긴 것이다.
 *
 * ⚠ **뒤집으면서 하마터면 잃을 뻔한 것** — 이 한 테스트가 사실 **두 명제**를 겹쳐
 * 지키고 있었다:
 *   ① 「셀 표면은 시험판 전용이다」        ← 오늘 뒤집혔다
 *   ② 「**드랍된** 와이어는 스위치 없이 안 산다」 ← **그대로 유효하다**
 * 처음엔 `LINEUP` 전체가 정식에서 수용된다고 통째로 뒤집었다가 `v2r2` 에서 깨졌다.
 * `LINEUP` 은 **드랍된** 와이어 표(v2r2@21 · v2r2@25)고, 드랍은
 * `includeDroppedCellSurfaceLayouts` 라는 **다른 축**이라 오늘 결정과 무관하다.
 * 그래서 아래를 둘로 갈라 적는다 — 겹쳐 있던 것을 갈라 놓는 것이 이 수정의 요점이다.
 *
 * 이 핀이 함께 지키던 세 번째 성질(「정식 경로가 아무거나 CS 로 오수용하지 않는다」)은
 * 아래 「기존 일반 Y 는 최종 셀 표면으로 오수용되지 않는다」가 계속 잰다 — 확인했다.
 */
test('정식 경로가 이제 **활성** 셀 표면을 수용한다 (기본값 전환 후)', {
  timeout: 120_000,
}, () => {
  // 활성 = 드랍 안 된 것. 오늘 바뀐 축은 이쪽이다.
  const fixture = renderFinal(PAYLOAD, { layout: 'v0', version: 0, tones: 2 });
  const official = decodeFrontend(fixture.raster, {});
  assert.equal(official.ok, true,
    'v0 가 정식 경로에서 안 읽힌다: ' + JSON.stringify(official.reason));
  assert.equal(official.text, PAYLOAD);
  assert.equal(official.hypothesis.cellSurface, true, 'v0 가 정식 경로에서 CS 로 안 읽혔다');
});

test('**드랍된** 와이어는 기본값이 켜져도 스위치 없이는 안 산다', {
  timeout: 120_000,
}, () => {
  // 드랍은 `enableCellSurfaceY` 와 **다른 축**이다. 기본값이 켜졌다고 드랍이 풀리면,
  // 「드랍한다」는 결정이 조용히 무효가 된다.
  for (const { layout, version } of LINEUP.filter((row) => row.layout === 'v2r2')) {
    const fixture = renderFinal(PAYLOAD, { layout, version, tones: 2 });
    const official = decodeFrontend(fixture.raster, {});
    assert.notEqual(
      official.ok === true && official.hypothesis && official.hypothesis.cellSurface === true,
      true,
      layout + '@' + version + ' (드랍) 이 스위치 없이 정식 경로에서 수용됐다',
    );
  }
});

test('2톤·3톤은 서로를 오수용하지 않는다 (v0 · v2r2 — 후자는 드랍 복원)', {
  timeout: 120_000,
}, () => {
  for (const { layout, version } of [LINEUP[0], LINEUP[1]]) {
    const extra = layout === 'v2r2' ? RESTORE_DROPPED : undefined;
    const two = decodeLab(renderFinal(PAYLOAD, { layout, version, tones: 2 }).raster, extra);
    const three = decodeLab(renderFinal(PAYLOAD, { layout, version, tones: 3 }).raster, extra);
    assert.equal(two.ok, true, two.reason);
    assert.equal(three.ok, true, three.reason);
    assert.equal(two.tones, 2);
    assert.equal(three.tones, 3);
    assert.equal(two.diagnostics.format.formatIndex, 1);
    assert.equal(three.diagnostics.format.formatIndex, 3);
  }
});

test('기존 일반 Y 는 최종 셀 표면으로 오수용되지 않는다', { timeout: 120_000 }, () => {
  for (const version of [0, 1, 2]) {
    const encoded = encodeY(PAYLOAD, { version, tones: 2, eccLevel: 'M' });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    const result = decodeLab(raster);
    assert.notEqual(
      result.ok === true && result.hypothesis && result.hypothesis.cellSurface === true,
      true,
      'Y' + version + ' 일반 심볼이 셀 표면으로 오수용됐다',
    );
    // lab 경로에서도 일반 Y 복호 자체는 그대로 살아 있어야 한다.
    assert.equal(result.ok, true, 'Y' + version + ' lab 경로 일반 복호: ' + result.reason);
    assert.equal(result.text, PAYLOAD);
  }
});
