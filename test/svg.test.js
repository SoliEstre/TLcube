/**
 * svg.test.js — 결정적 SVG 직렬화 검증 (T10)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sceneToSvg, colorToHex } from '../src/svg.js';
import { encode } from '../src/encode.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { buildScene } from '../src/scene.js';

function sampleScene() {
  const p = getPreset(DEFAULT_PRESET);
  const encoded = encode('svg ✓', { version: 1, eccLevel: 'M' });
  return buildScene(encoded, {
    palette: {
      background: p.background,
      levels: p.levels,
      bullseyeDark: BULLSEYE_DARK,
      bullseyeLight: BULLSEYE_LIGHT,
    },
  });
}

test('colorToHex — 8bit → #rrggbb', () => {
  assert.equal(colorToHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(colorToHex({ r: 255, g: 255, b: 255 }), '#ffffff');
  assert.equal(colorToHex({ r: 14, g: 16, b: 24 }), '#0e1018');
});

test('sceneToSvg — 구조: 배경 rect 1 + 폴리곤 = 3·셀수 + circle 6', () => {
  const scene = sampleScene();
  const svg = sceneToSvg(scene);
  const polygons = scene.shapes.filter((s) => s.kind === 'polygon').length;

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>\n'));
  assert.equal((svg.match(/<rect /g) || []).length, 1);
  assert.equal((svg.match(/<polygon /g) || []).length, polygons);
  assert.equal((svg.match(/<circle /g) || []).length, 6);
});

test('sceneToSvg — 결정성: 같은 scene 2회 → 문자열 동일, -0 미출현', () => {
  const scene = sampleScene();
  const a = sceneToSvg(scene);
  const b = sceneToSvg(scene);
  assert.equal(a, b);
  assert.ok(!a.includes('-0.0000'), '-0 정규화 실패');
});

test('sceneToSvg — 문서 순서가 painter 순서를 보존한다 (disc 가 폴리곤 뒤)', () => {
  const svg = sceneToSvg(sampleScene());
  const lastPolygon = svg.lastIndexOf('<polygon ');
  const firstCircle = svg.indexOf('<circle ');
  assert.ok(lastPolygon < firstCircle);
});

test('sceneToSvg — 옵션 검증', () => {
  const scene = sampleScene();
  assert.throws(() => sceneToSvg(scene, { pixelsPerUnit: 0 }), RangeError);
  assert.throws(() => sceneToSvg(scene, { precision: 0 }), RangeError);
  assert.throws(() => sceneToSvg(scene, { precision: 9 }), RangeError);
});
