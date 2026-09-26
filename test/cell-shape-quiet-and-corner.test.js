// cell-shape-quiet-and-corner.test.js — 셀 꾸미기가 안전영역 · 코너 QR 배치를 안 움직인다
// (DESIGN_001 §4.2 scene.js ⓑ · quietzone.js · quiet-extent.js · §4.4 · §7.5, 레인 L2b 2026-09-26)
//
// 성질: 꾸미기 켬/끔에서 아래가 **같다**(기대값은 같은 실행의 끔 장면 — HEAD 박제 아님).
//   ① 코너 QR 블록(원점 · 모든 조각) — 치환이 코너 QR 배치(`pullCornerBlockOut`) 뒤라서.
//   ② 안전영역 판 polygon(따라서 bbox) — `shapePoints` 가 꾸민 셀의 `basePoints` 를 먼저 읽어서.
//   ③ 음영 외곽 `markHulls`(shading.js 가 같은 함수를 쓴다).
//   ④ `quietCoverage` — 안전영역 있음 · 없음(«없음» 은 quiet-extent 의 bbox 경로) 둘 다.
//   ⑤ `holdsOrigin`(중앙 면제) — 원점을 품은 도형이 꾸민 셀(dot 은 kind 가 disc!)이어도 중앙
//      덩어리가 면제된다. 실장면에선 셀이 원점을 품는 일이 없어(중앙 슬롯이 늘 점유) 합성 장면에
//      **심은 결함**으로 잰다: basePoints 를 무시하면 중앙 덩어리가 통째로 빠진다.
//
// 격자: O v1 · A v0 · V v0(턴A) · K v0 × 코너 4 × 모양 9(파라미터 양 끝) + 중앙 QR·cornerToo(O · K) —
// 코너마다 코드–QR 여유가 다르고(A 하단 BL·BR 0.5셀 사고), K 는 육망성 외곽(원점 포함 본체)이라
// 경로가 다르다. 안전영역 두께는 2 · 3셀.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { addQuietZone, markHulls, quietZonePolygons } from '../src/quietzone.js';
import { quietCoverage } from '../src/quiet-extent.js';
import { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { TL_READER_URL } from '../src/qr.js';

const SLATE = getPreset('slate');
const PALETTE = {
  background: null, levels: SLATE.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
const QR_COLORS = [BULLSEYE_LIGHT, BULLSEYE_DARK];
const WHITE = { r: 255, g: 255, b: 255 };
const PAYLOAD = 'quiet zone';

const SPECS = [
  { kind: 'round', param: 0.35 }, { kind: 'round', param: 1.0 },
  { kind: 'bevel', param: 0.6 }, { kind: 'bevel', param: 1.4 },
  { kind: 'round-bevel', param: null },
  { kind: 'gap', param: 0.04 }, { kind: 'gap', param: 0.08 },
  { kind: 'dot', param: 0.8 }, { kind: 'dot', param: 1.0 },
];
const specLabel = (s) => `${s.kind}${s.param === null ? '' : ` ${s.param}`}`;

const CORNER_FIXTURES = [
  { id: 'O v1', encoded: () => encode(PAYLOAD, { version: 1 }), opts: { finderPatternId: 'bullseye' } },
  { id: 'A v0', encoded: () => encodeA(PAYLOAD, { version: 0 }), opts: { finderPatternId: 'bullseye' } },
  { id: 'V v0 (턴A)', encoded: () => encodeA(PAYLOAD, { version: 0, turnA: true }), opts: { finderPatternId: 'pinwheel-c2-2-1100-cw' } },
  { id: 'K v0', encoded: () => encodeK(PAYLOAD, { version: 0 }), opts: { finderPatternId: 'bullseye' } },
  // ⚠ 심은 기하 — 실제 A/V 는 삼각 꼭짓점 셀이 anchor(T1)라 «꾸미기가 코너 QR 당김을 바꾼다»
  // 위험을 **우연히** 가린다(실측 2026-09-26: 치환을 코너 QR 배치 앞으로 옮긴 변이가 위 격자에서
  // 0/192 로 안 잡혔다). 모든 셀을 data 로 바꾸면 실루엣 모서리 셀이 꾸밈 대상이 되고, 같은 변이가
  // A0 BL·BR · V0 TL·TR 에서 원점을 0.04–0.40셀 옮긴다 — 이 행이 «치환은 배치 뒤» 를 지킨다.
  { id: 'A v0 · 전 셀 data(심은 기하)', encoded: () => allData(encodeA(PAYLOAD, { version: 0 })), opts: { finderPatternId: 'bullseye' } },
  { id: 'V v0 · 전 셀 data(심은 기하)', encoded: () => allData(encodeA(PAYLOAD, { version: 0, turnA: true })), opts: { finderPatternId: 'bullseye' } },
];

/** 모든 셀을 tones 없는 data 로 — 역할 방패를 벗긴 기하 fixture. */
function allData(encoded) {
  return {
    ...encoded,
    cellDigits: new Map([...encoded.cellDigits].map(([k, v]) => [k, { digit: v.digit ?? 0, role: 'data' }])),
  };
}

const CENTER_FIXTURES = [
  { id: 'O 중앙 QR + cornerToo', encoded: () => encode(PAYLOAD, { version: 1, centerQr: true }), opts: { qrText: TL_READER_URL, cornerToo: true } },
  { id: 'K 중앙 QR + cornerToo', encoded: () => encodeK(PAYLOAD, { version: 0, centerQr: true }), opts: { qrText: TL_READER_URL, cornerToo: true } },
];

/** 안전영역 관련 관측 전부 — 켬/끔을 이 묶음 하나로 대조한다. */
function observe(scene) {
  const out = {
    selfQuiet: scene.shapes.filter((s) => s.selfQuiet === true),
    hulls: markHulls(scene, 2, QR_COLORS),
    coverageBare: quietCoverage(scene, QR_COLORS),
  };
  for (const margin of [2, 3]) {
    out[`polys${margin}`] = quietZonePolygons(scene, margin, QR_COLORS);
    const zoned = addQuietZone(scene, { color: WHITE, margin, selfQuietColors: QR_COLORS });
    out[`coverage${margin}`] = quietCoverage(zoned, QR_COLORS);
    out[`zoneShapes${margin}`] = zoned.shapes.slice(0, zoned.quietZone ? zoned.quietZone.count : 0);
  }
  return out;
}

function bbox(polys) {
  const pts = polys.flat();
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
  };
}

describe('①–④ 켬/끔에서 코너 QR · 안전영역 판 · 음영 외곽 · quietCoverage 가 같다', () => {
  for (const fx of CORNER_FIXTURES) {
    for (const qrCorner of ['TL', 'TR', 'BL', 'BR']) {
      test(`${fx.id} · ${qrCorner}`, () => {
        const encoded = fx.encoded();
        const base = { ...fx.opts, palette: PALETTE, qrText: TL_READER_URL, qrCorner };
        const off = buildScene(encoded, base);
        const want = observe(off);
        assert.ok(want.selfQuiet.length > 0, '전제: 코너 QR 이 없다');
        assert.ok(want.polys2.length > 0, '전제: 안전영역이 없다');
        for (const spec of SPECS) {
          const on = buildScene(encoded, { ...base, cellShape: spec });
          assert.ok(on.shapes.some((s) => Array.isArray(s.basePoints)), `${specLabel(spec)}: 꾸밈이 안 닿았다`);
          const got = observe(on);
          assert.deepEqual(got.selfQuiet, want.selfQuiet, `${specLabel(spec)}: 코너 QR(원점·조각)이 움직였다`);
          assert.deepEqual(bbox(got.polys2), bbox(want.polys2), `${specLabel(spec)}: 안전영역 판 bbox 가 움직였다`);
          assert.deepEqual(got, want, `${specLabel(spec)}: 안전영역 · 음영 외곽 · quietCoverage 중 하나가 달라졌다`);
        }
      });
    }
  }

  for (const fx of CENTER_FIXTURES) {
    test(`${fx.id} — 원점을 품은 중앙 QR 덩어리 면제(holdsOrigin)가 꾸미기에 흔들리지 않는다`, () => {
      const encoded = fx.encoded();
      const base = { ...fx.opts, palette: PALETTE };
      const off = buildScene(encoded, base);
      const want = observe(off);
      for (const spec of SPECS) {
        const on = buildScene(encoded, { ...base, cellShape: spec });
        assert.ok(on.shapes.some((s) => Array.isArray(s.basePoints)), `${specLabel(spec)}: 꾸밈이 안 닿았다`);
        assert.deepEqual(observe(on), want, `${fx.id} · ${specLabel(spec)}`);
      }
    });
  }
});

describe('⑤ holdsOrigin 은 꾸민 셀의 basePoints 로 판정한다 (심은 결함)', () => {
  // 합성 장면: 원점(10,10)을 품은 마름모 셀 하나 + 그에 붙은 셀 하나, 둘 다 «QR 색»(흰·검).
  // 끔 = polygon, 켬 = 같은 셀을 dot(disc + basePoints)로. 색 경로 ②만 보면 이 덩어리는 «전부
  // QR 색» 이라 제외 대상이다 — 원점 면제(holdsOrigin)가 있어야만 남는다. 면제가 basePoints 를
  // 안 읽으면 disc 는 points 가 없어 «원점을 안 품음» 이 되고 덩어리가 통째로 빠진다.
  const S3 = Math.sqrt(3);
  const rhombus = (cx, cy) => [
    { x: cx, y: cy - 1 }, { x: cx + S3 / 2, y: cy - 0.5 },
    { x: cx, y: cy }, { x: cx - S3 / 2, y: cy - 0.5 },
  ].map((p) => ({ x: p.x, y: p.y + 0.5 })); // 중심이 (cx, cy) 에 오게
  const holder = rhombus(10, 10);
  const neighbour = rhombus(10 + S3, 10);
  const scene = (holderShape) => ({
    width: 20, height: 20, background: null,
    layout: { originX: 10, originY: 10, size: 1 },
    shapes: [holderShape, { kind: 'polygon', points: neighbour, color: BULLSEYE_DARK }],
  });
  const offScene = scene({ kind: 'polygon', points: holder, color: BULLSEYE_LIGHT });
  const onScene = scene({
    kind: 'disc', cx: 10, cy: 10, r: 0.3, color: BULLSEYE_LIGHT, basePoints: holder, noSeam: true,
  });

  test('전제: 원점 면제 없이는 이 덩어리가 제외된다(색 경로만으로는 못 남는다)', () => {
    const noOrigin = { ...offScene, layout: undefined };
    assert.equal(markHulls(noOrigin, 2, QR_COLORS).length, 0);
    assert.equal(markHulls(offScene, 2, QR_COLORS).length, 1);
  });

  test('켬(disc + basePoints)도 끔과 같은 외곽 · 안전영역을 낸다', () => {
    assert.deepEqual(markHulls(onScene, 2, QR_COLORS), markHulls(offScene, 2, QR_COLORS));
    assert.deepEqual(quietZonePolygons(onScene, 2, QR_COLORS), quietZonePolygons(offScene, 2, QR_COLORS));
  });

  test('quiet-extent «안전영역 없음» bbox 도 basePoints 로 잰다(disc 도 원 마름모로)', () => {
    assert.deepEqual(quietCoverage(onScene), quietCoverage(offScene));
  });
});
