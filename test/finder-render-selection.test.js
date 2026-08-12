import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import {
  FINDER_BASELINE_SCORES, FINDER_PATTERNS,
} from '../src/finder-patterns.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { sceneToSvg } from '../src/svg.js';
import { verifyRaster } from '../src/verify.js';

const PRESET = getPreset(DEFAULT_PRESET);
function paletteWithBackground(background) {
  return Object.freeze({
    background,
    levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  });
}
const PALETTE = paletteWithBackground(PRESET.background);

// ⚠ 배경 3택은 «파인더와 직교한 축» 이 아니다. 이 파일은 오래 파인더 목록만 흔들고
//   배경은 불투명 하나로 고정해 뒀는데, 중앙 3톤 큐브가 슬롯을 palette.background 로
//   칠하면서 **투명(생성기 기본값)에서만** 렌더가 죽었다(2026-08-12). 고정된 축에 사는
//   결함은 그 축을 흔들기 전엔 원리적으로 안 보인다 — 두 축을 함께 돈다.
const BACKGROUNDS = Object.freeze([
  Object.freeze({ label: 'transparent', color: null }),
  Object.freeze({ label: 'white', color: Object.freeze({ r: 255, g: 255, b: 255 }) }),
  Object.freeze({ label: 'black', color: Object.freeze({ r: 0, g: 0, b: 0 }) }),
]);

const TYPES = Object.freeze(['O', 'A']);
const FINDER_RENDER_CASES = Object.freeze([
  ...Object.values(FINDER_BASELINE_SCORES),
  ...FINDER_PATTERNS,
]);

function isCenterQrBaseline(entry) {
  return entry.id === 'center-qr';
}

function encodeFor(type, centerQr) {
  const options = { version: 1, eccLevel: 'M', centerQr };
  return type === 'A'
    ? encodeA('finder selection', options)
    : encode('finder selection', options);
}

function renderSelectedFinder(type, entry, palette = PALETTE) {
  const centerQr = isCenterQrBaseline(entry);
  const encoded = encodeFor(type, centerQr);
  const options = {
    palette,
    finderPatternId: entry.id,
    margin: type === 'A' ? 20 : undefined,
  };
  if (centerQr) options.qrText = 'TLSCAN.ESTRE.SO';
  const scene = buildScene(encoded, options);
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
  const check = verifyRaster(raster, scene, encoded);
  return { scene, raster, check };
}

test('기준선과 모든 FINDER_PATTERNS를 Type O/A 장면으로 선택·렌더한다', () => {
  assert.ok(FINDER_RENDER_CASES.length > FINDER_PATTERNS.length);
  for (const type of TYPES) {
    for (const entry of FINDER_RENDER_CASES) {
      let result;
      try {
        result = renderSelectedFinder(type, entry);
      } catch (error) {
        assert.fail(type + '/' + entry.id + ' 렌더 예외: ' + (error && error.stack ? error.stack : error));
      }
      assert.ok(result.scene.shapes.length > 0, type + '/' + entry.id + ': shapes 없음');
      assert.equal(
        result.check.ok,
        true,
        type + '/' + entry.id + ': ' + JSON.stringify(result.check.mismatches),
      );
    }
  }
});

test('모든 파인더 × 배경 3택이 PNG·SVG 두 경로 모두 렌더된다', () => {
  for (const type of TYPES) {
    for (const entry of FINDER_RENDER_CASES) {
      for (const background of BACKGROUNDS) {
        const where = type + '/' + entry.id + '/' + background.label;
        let scene;
        try {
          ({ scene } = renderSelectedFinder(type, entry, paletteWithBackground(background.color)));
          // export 경로도 같은 shape.color 를 읽는다 — 미리보기만 되고 저장이 죽는 걸 막는다.
          sceneToSvg(scene);
        } catch (error) {
          assert.fail(where + ' 렌더 예외: ' + (error && error.stack ? error.stack : error));
        }
        // 투명은 scene.background 한 곳에만 산다. shape 까지 새면 두 렌더러가 다 죽는다.
        for (let i = 0; i < scene.shapes.length; i += 1) {
          assert.equal(
            typeof scene.shapes[i].color, 'object',
            where + ': shape[' + i + '](' + scene.shapes[i].kind + ').color 가 구체 색이 아니다',
          );
          assert.notEqual(scene.shapes[i].color, null, where + ': shape[' + i + '].color 가 null');
        }
      }
    }
  }
});
