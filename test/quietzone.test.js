// quietzone.test.js — 안전영역 도형 생성 (렌더 전용, 데이터 계약 무관)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  convexHull, offsetConvex, clipToRect, clusterShapes, quietZonePolygons, addQuietZone,
} from '../src/quietzone.js';

const WHITE = { r: 255, g: 255, b: 255 };
const RED = { r: 200, g: 20, b: 20 };

/** 폴리곤의 부호 없는 넓이 (도형 확대/축소 판정용). */
function area(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(s) / 2;
}

const square = (x0, y0, side) => [
  { x: x0, y: y0 }, { x: x0 + side, y: y0 },
  { x: x0 + side, y: y0 + side }, { x: x0, y: y0 + side },
];

describe('convexHull', () => {
  test('내부 점은 버리고 볼록 껍질만 남긴다', () => {
    const hull = convexHull([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
      { x: 5, y: 5 }, { x: 3, y: 7 }, // 내부 점
    ]);
    assert.equal(hull.length, 4);
    assert.equal(area(hull), 100);
  });

  test('점 3개 미만이면 입력 그대로 (복사본)', () => {
    const pts = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    const hull = convexHull(pts);
    assert.deepEqual(hull, pts);
    assert.notEqual(hull[0], pts[0], '입력 객체를 그대로 돌려주면 호출측 변형에 오염된다');
  });

  test('결정적 — 입력 순서를 바꿔도 같은 껍질', () => {
    const pts = [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 2, y: 5 }, { x: 1, y: 1 }];
    const a = convexHull(pts);
    const b = convexHull([...pts].reverse());
    assert.deepEqual(new Set(a.map((p) => `${p.x},${p.y}`)), new Set(b.map((p) => `${p.x},${p.y}`)));
  });
});

describe('offsetConvex — 마이터 바깥 오프셋', () => {
  test('정사각형을 d 만큼 밀면 각 변이 정확히 d 만큼 바깥으로 간다', () => {
    const off = offsetConvex(square(2, 2, 4), 1);
    const xs = off.map((p) => p.x).sort((a, b) => a - b);
    const ys = off.map((p) => p.y).sort((a, b) => a - b);
    assert.deepEqual(xs, [1, 1, 7, 7]);
    assert.deepEqual(ys, [1, 1, 7, 7]);
  });

  test('입력 방향(시계/반시계)과 무관하게 항상 바깥으로 간다', () => {
    const cw = square(2, 2, 4);
    const ccw = [...cw].reverse();
    assert.ok(area(offsetConvex(cw, 1)) > area(cw), '시계 입력이 안쪽으로 갔다');
    assert.ok(area(offsetConvex(ccw, 1)) > area(ccw), '반시계 입력이 안쪽으로 갔다');
    assert.equal(area(offsetConvex(cw, 1)), area(offsetConvex(ccw, 1)));
  });

  test('d = 0 이면 그대로', () => {
    const sq = square(0, 0, 3);
    assert.deepEqual(offsetConvex(sq, 0), sq);
  });

  test('예각 꼭짓점은 마이터 한계에서 베벨로 잘린다 (정점 수가 늘어난다)', () => {
    // 아주 납작한 삼각형 — 꼭짓점 내각이 좁아 마이터가 폭주한다.
    const sliver = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 2 }];
    const off = offsetConvex(sliver, 2, 2);
    assert.ok(off.length > 3, `베벨이 안 걸렸다 (정점 ${off.length})`);
    assert.ok(area(off) > area(sliver));
  });

  test('정삼각형(60°)은 기본 마이터 한계(4) 안이라 꼭짓점 3개를 유지한다', () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8.66 }];
    assert.equal(offsetConvex(tri, 1).length, 3);
  });
});

describe('clipToRect', () => {
  test('캔버스를 넘는 폴리곤을 캔버스로 자른다', () => {
    const clipped = clipToRect(square(-2, -2, 14), 10, 10);
    assert.equal(area(clipped), 100);
    for (const p of clipped) {
      assert.ok(p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 10, `클립 밖 좌표 (${p.x},${p.y})`);
    }
  });

  test('안에 완전히 들어 있으면 넓이가 보존된다', () => {
    assert.equal(area(clipToRect(square(2, 2, 4), 10, 10)), 16);
  });
});

describe('clusterShapes — 코너 QR 과 코드 본체를 분리한다', () => {
  const shapes = [
    // 본체 — 서로 붙어 있는 3개
    { kind: 'polygon', color: RED, points: square(0, 0, 2) },
    { kind: 'polygon', color: RED, points: square(2, 0, 2) },
    { kind: 'polygon', color: RED, points: square(0, 2, 2) },
    // 멀리 떨어진 QR 블록 1개
    { kind: 'polygon', color: WHITE, points: square(40, 40, 3) },
  ];

  test('gap 보다 멀리 떨어진 덩어리는 다른 클러스터가 된다', () => {
    const clusters = clusterShapes(shapes, 1);
    assert.equal(clusters.length, 2);
    const sizes = clusters.map((c) => c.length).sort((a, b) => a - b);
    assert.deepEqual(sizes, [1, 3]);
  });

  test('gap 이 충분히 크면 전부 한 덩어리 — 이게 껍질 하나 방식의 실패 모드다', () => {
    assert.equal(clusterShapes(shapes, 100).length, 1);
  });

  test('disc 도 외접 사각으로 클러스터에 참여한다', () => {
    const withDisc = [...shapes, { kind: 'disc', color: RED, cx: 1, cy: 1, r: 1 }];
    const clusters = clusterShapes(withDisc, 1);
    assert.equal(clusters.length, 2);
    assert.equal(Math.max(...clusters.map((c) => c.length)), 4);
  });
});

describe('addQuietZone', () => {
  const scene = () => ({
    width: 50,
    height: 50,
    background: null,
    shapes: [
      { kind: 'polygon', color: RED, points: square(5, 5, 10) },
      { kind: 'polygon', color: WHITE, points: square(38, 38, 6) },
    ],
  });

  test('클러스터마다 폴리곤 1개를 shapes **앞**에 꽂는다 (painter 순서상 뒤로 깔린다)', () => {
    const out = addQuietZone(scene(), { color: WHITE, margin: 2 });
    assert.equal(out.shapes.length, 4);
    assert.equal(out.quietZone.count, 2);
    for (let i = 0; i < 2; i += 1) {
      assert.deepEqual(out.shapes[i].color, WHITE);
      assert.equal(out.shapes[i].kind, 'polygon');
    }
    // 원본 도형은 순서 그대로 뒤에 남는다.
    assert.deepEqual(out.shapes.slice(2), scene().shapes);
  });

  test('입력 scene 을 변형하지 않는다', () => {
    const s = scene();
    const before = s.shapes.length;
    addQuietZone(s, { color: WHITE, margin: 2 });
    assert.equal(s.shapes.length, before);
    assert.equal(s.quietZone, undefined);
  });

  test("color 가 null 이면('없음') 같은 scene 을 그대로 돌려준다", () => {
    const s = scene();
    assert.equal(addQuietZone(s, { color: null }), s);
  });

  test('음수·비유한 margin 은 RangeError', () => {
    assert.throws(() => addQuietZone(scene(), { color: WHITE, margin: -1 }), RangeError);
    assert.throws(() => addQuietZone(scene(), { color: WHITE, margin: NaN }), RangeError);
  });

  test('안전영역은 원 도형보다 넓고 캔버스를 안 넘는다', () => {
    const out = addQuietZone(scene(), { color: WHITE, margin: 2 });
    const quiet = out.shapes[0];
    assert.ok(area(quiet.points) > 100, '10×10 도형을 감싸는데 넓이가 100 이하다');
    for (const p of quiet.points) {
      assert.ok(p.x >= -1e-9 && p.x <= 50 + 1e-9, `x=${p.x} 캔버스 밖`);
      assert.ok(p.y >= -1e-9 && p.y <= 50 + 1e-9, `y=${p.y} 캔버스 밖`);
    }
  });
});

describe('실제 인코더 산출물과의 통합', () => {
  async function cornerQrScene() {
    const { encodeY } = await import('../src/encodeY.js');
    const { buildSceneY } = await import('../src/sceneY.js');
    const { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
    const { TL_READER_URL } = await import('../src/qr.js');
    const p = getPreset('slate');
    return {
      scene: buildSceneY(encodeY('quiet zone', { version: 0 }), {
        palette: {
          background: null, levels: p.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
        },
        qrText: TL_READER_URL,
        qrCorner: 'TL',
      }),
      qrColors: [BULLSEYE_LIGHT, BULLSEYE_DARK],
    };
  }

  test('코너 QR 은 코드와 **다른 클러스터**로 떨어진다', async () => {
    const { scene } = await cornerQrScene();
    assert.equal(quietZonePolygons(scene, 2).length, 2,
      '한 덩어리로 묶이면 둘을 잇는 대각선 판때기가 나온다 (실측 확인된 실패 모드)');
  });

  test('selfQuietColors 를 주면 QR 클러스터는 빠지고 코드 후광만 남는다', async () => {
    const { scene, qrColors } = await cornerQrScene();
    const polys = quietZonePolygons(scene, 2, qrColors);
    assert.equal(polys.length, 1, 'QR 은 자체 콰이어트 존이 있어 제외돼야 한다');
    // 남은 하나가 QR 이 아니라 **코드** 쪽인지 — 넓이로 확인 (코드가 훨씬 크다).
    const [only] = polys;
    const xs = only.map((p) => p.x);
    const ys = only.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    assert.ok(w > 10 && h > 10, `남은 폴리곤이 코드가 아니라 QR 쪽으로 보인다 (${w.toFixed(1)}×${h.toFixed(1)})`);
  });

  // ── 마진이 QR 과 코드를 잇는 구성 (실사진에서 관측된 결함) ────────────────
  //
  // 위 두 테스트는 **Type Y v0** 을 쓴다. 거기선 QR 과 코드 간격이 마진(2셀)보다 넓어
  // 애초에 두 클러스터로 갈린다 — 즉 결함이 나는 영역을 건드리지 않는다. 실제로 결함
  // 코드로 되돌려도 21개가 전부 통과했다(2026-08-11 mutation 검증).
  //
  // 결함이 나는 구성은 **A v0 · O v1** 이다. 마진이 QR 과 코드 사이를 메워 한 덩어리가
  // 되고, 그 덩어리엔 코드 셀이 섞여 있어 "전부 QR 색인가" 가 false → 제외가 조용히
  // 무력화된다. 이때도 폴리곤은 **1개**라서 개수 단언으로는 절대 못 잡는다. 실제 산출은
  //   결함: 47x39@(3,3)  ← 좌상단 QR 까지 삼킨다
  //   정상: 37x33@(13,9) ← 코드만
  // 그래서 여기서는 **기하**를 본다.
  const BRIDGING = [
    { type: 'A', version: 0 },
    { type: 'O', version: 1 },
  ];

  async function oaScene(type, version, qrCorner = 'TL') {
    const { encode } = await import('../src/encode.js');
    const { encodeA } = await import('../src/encodeA.js');
    const { buildScene } = await import('../src/scene.js');
    const { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
    const { TL_READER_URL } = await import('../src/qr.js');
    const p = getPreset('slate');
    const encoded = (type === 'A' ? encodeA : encode)('quiet zone', { version });
    return buildScene(encoded, {
      palette: {
        background: null, levels: p.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
      },
      qrText: TL_READER_URL,
      qrCorner,
    });
  }

  // 코너 QR 도형을 **색 + 위치**로 찾는다. clusterShapes 를 쓰면 검증 대상 로직으로
  // 검증 기준을 만드는 꼴이라 순환이 된다. 불스아이도 같은 색이지만 코드 한가운데
  // 있으므로, 좌상단 사분면 조건으로 코너 QR 만 걸러진다.
  function cornerQrPoints(scene, qrColors) {
    const isQrColor = (c) => qrColors.some((q) => q.r === c.r && q.g === c.g && q.b === c.b);
    const pts = [];
    for (const s of scene.shapes) {
      if (!isQrColor(s.color)) continue;
      const p = s.kind === 'disc'
        ? { x: s.cx, y: s.cy }
        : s.points.reduce((a, q) => ({ x: a.x + q.x / s.points.length, y: a.y + q.y / s.points.length }), { x: 0, y: 0 });
      if (p.x < scene.width / 2 && p.y < scene.height / 2
        && Math.hypot(p.x - scene.width / 2, p.y - scene.height / 2) > Math.min(scene.width, scene.height) / 4) {
        pts.push(p);
      }
    }
    return pts;
  }

  /** 짝수-교차 규칙 point-in-polygon. */
  function inside(poly, p) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[j]; const b = poly[i];
      if ((b.y > p.y) !== (a.y > p.y)
        && p.x < ((a.x - b.x) * (p.y - b.y)) / (a.y - b.y) + b.x) hit = !hit;
    }
    return hit;
  }

  for (const { type, version } of BRIDGING) {
    test(`${type} v${version} — 마진이 QR 과 코드를 이어도 QR 은 안전영역 밖이다`, async () => {
      const { BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
      const qrColors = [BULLSEYE_LIGHT, BULLSEYE_DARK];
      const scene = await oaScene(type, version);

      // 전제: 이 구성이 정말 "마진으로 이어지는" 구성인가. 아니면 결함 영역을 안
      // 건드리는 셈이라 테스트가 무의미해진다 (Y v0 가 정확히 그래서 결함을 놓쳤다).
      assert.equal(quietZonePolygons(scene, 2).length, 1,
        '전제 위반: 마진으로도 QR 과 코드가 안 이어진다 — 결함 영역을 못 건드린다');

      const qrPts = cornerQrPoints(scene, qrColors);
      assert.ok(qrPts.length > 0, '코너 QR 도형을 못 찾았다 — 로케이터가 깨졌다');

      // 자체 콰이어트 존을 가진 블록 위에는 안전영역이 덮이면 안 된다.
      for (const poly of quietZonePolygons(scene, 2, qrColors)) {
        const covered = qrPts.filter((p) => inside(poly, p));
        assert.equal(covered.length, 0,
          `안전영역이 코너 QR 을 ${covered.length}/${qrPts.length} 덮었다 (QR 과 코드를 잇는 판때기)`);
      }
    });
  }

  // ── 4코너 스윕 (PM/022 W1-a, 2026-08-23) ─────────────────────────────────
  //
  // 위 BRIDGING 테스트는 qrCorner 'TL' 고정이라 검증 표면이 1/4 이었다. 결함은 정확히
  // 그 사각지대에 있었다: Type A 는 삼각 패치 셀이 하단 코너를 채워 코드–QR 실간격이
  // 0.5셀인데, 색+연결성 제외의 클러스터 병합 실효 반경(~2·gap)이 그것을 삼켰다 —
  // 실측 BL/BR 에서 QR 도형 213/213 이 안전영역 폴리곤 안 (TL/TR·Type O 는 정상).
  // 수리는 렌더러의 `selfQuiet` 태그 (scene.js pushQrBlock · sceneY 코너 블록).
  //
  // 코너별 사분면 로케이터 — 기존 cornerQrPoints 의 일반화. 색은 검증 대상 로직과
  // 무관한 축이므로 순환이 없다.
  function cornerQrPointsAt(scene, qrColors, corner) {
    const isQrColor = (c) => qrColors.some((q) => q.r === c.r && q.g === c.g && q.b === c.b);
    const wantLeft = corner === 'TL' || corner === 'BL';
    const wantTop = corner === 'TL' || corner === 'TR';
    const pts = [];
    for (const s of scene.shapes) {
      if (!isQrColor(s.color)) continue;
      const p = s.kind === 'disc'
        ? { x: s.cx, y: s.cy }
        : s.points.reduce((a, q) => ({ x: a.x + q.x / s.points.length, y: a.y + q.y / s.points.length }), { x: 0, y: 0 });
      const inX = wantLeft ? p.x < scene.width / 2 : p.x > scene.width / 2;
      const inY = wantTop ? p.y < scene.height / 2 : p.y > scene.height / 2;
      if (inX && inY
        && Math.hypot(p.x - scene.width / 2, p.y - scene.height / 2) > Math.min(scene.width, scene.height) / 4) {
        pts.push(p);
      }
    }
    return pts;
  }

  for (const { type, version } of BRIDGING) {
    for (const corner of ['TL', 'TR', 'BL', 'BR']) {
      test(`${type} v${version} · ${corner} — 어느 코너의 QR 도 안전영역이 덮지 않는다`, async () => {
        const { BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
        const qrColors = [BULLSEYE_LIGHT, BULLSEYE_DARK];
        const scene = await oaScene(type, version, corner);

        // 태그 무결성 — 렌더러가 QR 블록에 selfQuiet 를 실제로 찍는가.
        const tagged = scene.shapes.filter((s) => s.selfQuiet === true);
        assert.ok(tagged.length >= 2, 'QR 블록에 selfQuiet 태그가 없다 — 렌더러 배선이 풀렸다');

        const qrPts = cornerQrPointsAt(scene, qrColors, corner);
        assert.ok(qrPts.length > 0, '코너 QR 도형을 못 찾았다 — 로케이터가 깨졌다');

        for (const poly of quietZonePolygons(scene, 2, qrColors)) {
          const covered = qrPts.filter((p) => inside(poly, p));
          assert.equal(covered.length, 0,
            `안전영역이 ${corner} 코너 QR 을 ${covered.length}/${qrPts.length} 덮었다`);
        }
      });
    }
  }

  test('A v0 · BL — 태그를 벗기면 색 경로만으로는 삼켜진다 (태그가 실제로 일한다)', async () => {
    // 변이 앵커: 색+연결성 폴백이 이 구성을 못 지킨다는 사실이 참이어야 태그 수리에
    // 존재 이유가 있다. 이 단언이 «못 덮는다» 로 뒤집히는 날은 clusterShapes 의 병합
    // 반경이 바뀐 날이다 — 그때는 태그·폴백의 분업 주석(quietzone.js)을 같이 갱신하라.
    const { BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
    const qrColors = [BULLSEYE_LIGHT, BULLSEYE_DARK];
    const scene = await oaScene('A', 0, 'BL');
    const stripped = {
      ...scene,
      shapes: scene.shapes.map((s) => {
        if (s.selfQuiet !== true) return s;
        const clone = { ...s };
        delete clone.selfQuiet;
        return clone;
      }),
    };
    const qrPts = cornerQrPointsAt(stripped, qrColors, 'BL');
    assert.ok(qrPts.length > 0);
    let covered = 0;
    for (const poly of quietZonePolygons(stripped, 2, qrColors)) {
      covered += qrPts.filter((p) => inside(poly, p)).length;
    }
    assert.ok(covered > 0,
      '태그 없이도 안 삼켜진다 — 색 경로가 고쳐졌거나 기하가 바뀌었다. 이 테스트와 분업 주석을 재검토하라');
  });

  test('제외 판정은 마진에 의존하지 않는다', async () => {
    const { BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
    const qrColors = [BULLSEYE_LIGHT, BULLSEYE_DARK];
    const scene = await oaScene('A', 0);
    const qrPts = cornerQrPoints(scene, qrColors);

    // 마진을 키우면 언젠가는 QR 과 코드가 붙는다. 붙는 순간 제외가 꺼지던 것이 결함이다.
    for (const margin of [0.5, 1, 2, 3, 4]) {
      for (const poly of quietZonePolygons(scene, margin, qrColors)) {
        assert.equal(qrPts.filter((p) => inside(poly, p)).length, 0,
          `margin=${margin} 에서 안전영역이 코너 QR 을 덮었다`);
      }
    }
  });

  test('불스아이는 코드와 한 클러스터라 selfQuietColors 로도 코드가 제외되지 않는다', async () => {
    const { encode } = await import('../src/encode.js');
    const { buildScene } = await import('../src/scene.js');
    const { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
    const p = getPreset('slate');
    // 코너 QR 없음 — 불스아이(bullseyeDark/Light 색)가 코드 안에 있는 구성.
    const scene = buildScene(encode('bullseye', { version: 1 }), {
      palette: {
        background: null, levels: p.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
      },
    });
    const polys = quietZonePolygons(scene, 2, [BULLSEYE_LIGHT, BULLSEYE_DARK]);
    assert.equal(polys.length, 1, '불스아이 색 때문에 코드 전체가 제외되면 안 된다');
  });
});
