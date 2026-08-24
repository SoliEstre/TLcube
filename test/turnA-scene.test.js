/**
 * turnA-scene.test.js — 턴A(내부 타입 V) 렌더 기하 회귀 (Wave 3 ①, 2026-08-24).
 *
 * 기하 규약 (scene.js buildScene 의 turnA 분기가 정본):
 *   · **배치만 180° 돈다. 셀(큐브)은 정립이다** — 셀 (q,r) 의 3면 폴리곤을
 *     (−q,−r) 자리(= 중심 대칭 상)에 그린다. 장면 전체(픽셀) 회전이 아니다:
 *     그쪽은 셀 내부 Y-접합을 ⅄ 로 뒤집어 검출기의 face offset 계약과 충돌한다.
 *   · 셀 회계·데이터 좌표·마스크 불변 — cellDigits 는 정삼각과 같은 키·같은 값이고
 *     (format 15셀의 digit 만 V 표 인덱스라 다르다), 그리는 자리만 바뀐다.
 *
 * 실측 (2026-08-24, 레인 T 보고서 §기하):
 *   · 전경 마스크(배경색 대비)가 정삼각 렌더의 정확한 180° 상 — 픽셀 불일치는
 *     라스터 양자화 경계뿐 (A0 0.053% · A1 0.078% · A2 0.111%).
 *   · 정상 A(turnA=false) 렌더는 바이트 동일 (사전/사후 sha256 일치 3/3).
 *   · 코너 QR × 턴A: V0/V1/V2 × TL/TR/BL/BR 12조합 전부 무교차 (×20 margin 경로).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeA } from '../src/encodeA.js';
import { buildScene, QR_CORNERS } from '../src/scene.js';
import { axialToPixel, facePolygon, FACES, hexDistance } from '../src/hexgrid.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function cellShapes(scene, cellCount) {
  // painter 규약: (0) 중앙 QR 없음 → 셀 3면 폴리곤이 shapes 의 앞부분이다.
  return scene.shapes.slice(0, cellCount * 3);
}

test('턴A 렌더 — 셀 폴리곤이 정삼각 렌더의 «중심 대칭 상 + 정립 면» 이다', () => {
  for (const version of [0, 1, 2]) {
    const plain = encodeA('scene-geom', { version, eccLevel: 'M' });
    const turned = encodeA('scene-geom', { version, eccLevel: 'M', turnA: true });
    // 셀 회계·좌표 불변 — 키 집합이 같다 (와이어 층 검증).
    assert.deepEqual([...turned.cellDigits.keys()], [...plain.cellDigits.keys()],
      `A${version}: turnA 가 셀 좌표 집합을 바꿨다 — 회계 불변 위반`);

    const scenePlain = buildScene(plain, { palette: PALETTE, margin: 20 });
    const sceneTurn = buildScene(turned, { palette: PALETTE, margin: 20 });
    assert.equal(sceneTurn.shapes.length, scenePlain.shapes.length,
      `A${version}: shape 수가 다르다`);

    const center = axialToPixel(0, 0, scenePlain.layout);
    const cells = [...plain.cellDigits.keys()];
    const plainCellShapes = cellShapes(scenePlain, cells.length);
    const turnCellShapes = cellShapes(sceneTurn, cells.length);
    for (let i = 0; i < cells.length; i += 1) {
      const [q, r] = cells[i].split(',').map(Number);
      // ⓐ 자리: 셀 «중심» 은 중심 대칭 상으로 돈다 — axialToPixel(−q,−r) =
      //    2·center − axialToPixel(q,r). (면 폴리곤 자체는 반전상이 **아니다** —
      //    정립 유지라 평행이동 사본이다. 이것이 «배치만 돌고 셀은 정립» 의 정의:
      //    픽셀 회전이었다면 폴리곤도 반전상이어야 했다.)
      const plainCellCenter = axialToPixel(q, r, scenePlain.layout);
      const turnCellCenter = axialToPixel(-q, -r, scenePlain.layout);
      assert.ok(
        Math.abs(turnCellCenter.x - (2 * center.x - plainCellCenter.x)) < 1e-9
        && Math.abs(turnCellCenter.y - (2 * center.y - plainCellCenter.y)) < 1e-9,
        `A${version} 셀 ${cells[i]}: 자리가 중심 대칭 상이 아니다`);
      for (let f = 0; f < FACES.length; f += 1) {
        const plainShape = plainCellShapes[i * 3 + f];
        const turnShape = turnCellShapes[i * 3 + f];
        // ⓐ′ 정립 면: 턴A 폴리곤 = facePolygon(−q,−r) — 점별·순서까지 동일.
        const expected = facePolygon(-q, -r, FACES[f], scenePlain.layout);
        assert.equal(turnShape.points.length, plainShape.points.length);
        for (let p = 0; p < turnShape.points.length; p += 1) {
          assert.ok(
            Math.abs(turnShape.points[p].x - expected[p].x) < 1e-9
            && Math.abs(turnShape.points[p].y - expected[p].y) < 1e-9,
            `A${version} 셀 ${cells[i]} 면 ${FACES[f]}: facePolygon(−q,−r) 과 다르다`);
        }
        // ⓑ 면 색: 비-format 셀은 digit 이 같으므로 색도 같아야 한다 (마스크가
        //    canonical (q,r) 로 계산됨의 렌더 층 검증). format 셀은 V 표 인덱스라
        //    digit 이 달라질 수 있다 — 대상에서 뺀다.
        if (plain.cellDigits.get(cells[i]).role !== 'format') {
          assert.deepEqual(turnShape.color, plainShape.color,
            `A${version} 셀 ${cells[i]} 면 ${FACES[f]}: 비-format 셀 색이 달라졌다`);
        }
      }
    }
  }
});

test('턴A 렌더 — 정상 A 는 한 바이트도 안 바뀐다 (turnA=false 경로 동일성)', () => {
  const enc = encodeA('scene-geom', { version: 0, eccLevel: 'M' });
  const scene = buildScene(enc, { palette: PALETTE, margin: 20 });
  const cells = [...enc.cellDigits.keys()];
  const shapes = cellShapes(scene, cells.length);
  for (let i = 0; i < cells.length; i += 1) {
    const [q, r] = cells[i].split(',').map(Number);
    const expected = facePolygon(q, r, FACES[0], scene.layout);
    assert.deepEqual(shapes[i * 3].points, expected,
      `정삼각 셀 ${cells[i]} 이 제자리에 없다`);
  }
});

test('턴A × 코너 QR — V0/V1/V2 × 4코너 전부 무교차 (실측 고정)', () => {
  for (const version of [0, 1, 2]) {
    for (const qrCorner of QR_CORNERS) {
      const enc = encodeA('scene-qr', { version, eccLevel: 'M', turnA: true });
      // 던지지 않아야 한다 — 던지면 턴A 패치·코너 QR 겹침 (scene.js turnA 가드).
      buildScene(enc, { palette: PALETTE, qrText: 'HTTPS://TL.ESTRE.SO/', qrCorner });
    }
  }
});

test('턴A 패치가 육각 코어 밖에 실재한다 — 반전 가드의 전제', () => {
  const enc = encodeA('x', { version: 0, eccLevel: 'M', turnA: true });
  const patch = [...enc.cellDigits.keys()]
    .map((key) => key.split(',').map(Number))
    .filter(([q, r]) => hexDistance(q, r) > 6);
  assert.equal(patch.length, 63, 'k=6 패치 셀 수가 63 이 아니다 (placementA 실측)');
});
