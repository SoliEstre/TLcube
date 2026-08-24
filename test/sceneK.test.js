/**
 * sceneK.test.js — Type K(육각별) 렌더 (브리프 ②).
 *
 * scene.js 는 **무수정**이다 — buildScene 은 cellDigits 삽입 순서를 painter 순서로
 * 쓰므로(Type A 패치 전례) K 의 패치 6개도 같은 경로로 그려진다. 기존 O/A/Y 렌더의
 * 바이트 동일 보존은 «scene.js 무변경» 으로 자명하고, 기존 scene/sceneA 테스트가
 * 회귀로 잰다. 이 파일은 K 프레임이 실제로 그려지는가(실루엣·앵커·캔버스 수용)를 잰다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { VERSIONS_K } from '../src/capacityK.js';
import { vertexAnchorsK } from '../src/placementK.js';
import { axialToPixel, facePolygon, FACES } from '../src/hexgrid.js';
import { digitToRanks } from '../src/lehmer.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

test('K 실루엣 — 전 버전이 margin 20 에서 캔버스 안에 그려진다 (셀면 3×|cellDigits|)', () => {
  for (const spec of VERSIONS_K) {
    const encoded = encodeK('scene-' + spec.name, { version: spec.version });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
    assert.equal(scene.k, spec.k);
    // 셀면 폴리곤 수 — 파인더/불스아이 shape 이 더 있으므로 «이상» 으로 잰다.
    const polygons = scene.shapes.filter((s) => s.kind === 'polygon');
    assert.ok(polygons.length >= encoded.cellDigits.size * 3,
      spec.name + ': 셀면 폴리곤이 모자라다');
    // 별 꼭짓점(d=2k) 여섯 끝이 전부 캔버스 안에 있다 — 침묵 소실 없음.
    for (const anchor of vertexAnchorsK(spec.k)) {
      const p = axialToPixel(anchor.q, anchor.r, scene.layout);
      assert.ok(p.x > 0 && p.x < scene.width && p.y > 0 && p.y < scene.height,
        spec.name + ': 꼭짓점 ' + anchor.q + ',' + anchor.r + ' 이 캔버스 밖');
    }
    // 래스터 스모크 — 그대로 픽셀화된다.
    const raster = rasterize(scene, { pixelsPerUnit: 8, supersample: 1 });
    assert.ok(raster.width > 0 && raster.height > 0);
  }
});

test('기본 margin(×2)은 K 패치를 수용하지 못한다 — 조용한 소실 대신 throw (A 전례)', () => {
  const encoded = encodeK('margin-guard', { version: 0 });
  assert.throws(() => buildScene(encoded, { palette: PALETTE }), RangeError);
});

test('앵커 digit 렌더 — A 계열 5/0/0 + 반전 1/1/1 이 그 자리 면 색으로 실린다', () => {
  const spec = VERSIONS_K[0];
  const encoded = encodeK('anchor-render', { version: spec.version });
  const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
  const colorKey = (c) => c.r + '/' + c.g + '/' + c.b;
  // scene.shapes 에서 폴리곤을 좌표로 못 찾는 대신, facePolygon(계약 기하)으로
  // 기대 폴리곤을 만들어 «같은 점 집합 + 기대 색» shape 이 존재하는지 찾는다.
  const shapeIndex = new Map();
  for (const s of scene.shapes) {
    if (s.kind !== 'polygon' || s.points.length !== 4) continue;
    const sig = s.points.map((p) => p.x.toFixed(6) + ',' + p.y.toFixed(6)).join(';');
    shapeIndex.set(sig, s);
  }
  for (const anchor of vertexAnchorsK(spec.k)) {
    const ranks = digitToRanks(anchor.digit);
    for (const face of FACES) {
      const expected = facePolygon(anchor.q, anchor.r, face, scene.layout);
      const sig = expected.map((p) => p.x.toFixed(6) + ',' + p.y.toFixed(6)).join(';');
      const shape = shapeIndex.get(sig);
      assert.ok(shape, `앵커 (${anchor.q},${anchor.r}) ${face} 면 폴리곤이 없다`);
      assert.equal(colorKey(shape.color), colorKey(PALETTE.levels[ranks[face]]),
        `앵커 (${anchor.q},${anchor.r}) ${face} 면 색이 digit ${anchor.digit} 순위와 다르다`);
    }
  }
});
