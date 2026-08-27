// sceneA.test.js — buildScene 의 Type A(삼각 실루엣 확장) 렌더 지원 검증
// (ADR 0005 §2 D1·D7, ADR 0004 §1-7)
//
// placementA.js·layoutA.js 는 병렬 lane 산출물이라 import 하지 않는다 — 이 스위트는
// 작은 k 에 대해 육각부 몇 셀 + "패치" 셀(hexDistance(q,r) > k, ADR 0005 D1 의 삼각
// 코너 패치 위치대) 몇 개를 수동으로 cellDigits 에 얹어 합성 encoded 를 만든다.
//
// 다루는 계약:
//   (1) 패치 셀(육각 영역 밖) 도 렌더된다 — regionCells(k) 필터 방식이었다면 누락됐을
//       셀이 cellDigits 삽입 순서 순회로는 그려진다는 회귀 방지.
//   (2) painter 순서 = cellDigits 삽입 순서(육각부 먼저 오도록 구성해도, 순서는
//       Map 삽입 그대로 존중된다).
//   (3) 불스아이·QR 슬롯(19셀) 은 Type A 에서도 무변경(ADR 0005 D7) — 패치 셀 유무와
//       무관하게 6 disc 규약 그대로.
//   (4) 코너 QR 위치 4택(TL/TR/BL/BR) — 방위 고정 + 코너 대칭 배치, 무교차.
//       ⭐ 2026-08-27: 기준이 «bbox 코너» 에서 «코드 실루엣» 으로 바뀌었다 — 실루엣이
//       가까운 코너에서는 바깥으로 당겨 최소 여유를 확보한다 (scene.js 상수 주석 참조).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildScene, QR_CORNERS } from '../src/scene.js';
import {
  FACES, facePolygon, layoutForRegion, hexDistance, codeBounds,
} from '../src/hexgrid.js';
import { digitToRanks } from '../src/lehmer.js';
import { bandRadii } from '../src/bullseye.js';
import { qrMatrix, TL_READER_URL } from '../src/qr.js';

const PALETTE = {
  background: { r: 255, g: 255, b: 255 },
  levels: [
    { r: 20, g: 20, b: 20 },
    { r: 128, g: 128, b: 128 },
    { r: 235, g: 235, b: 235 },
  ],
  bullseyeDark: { r: 0, g: 0, b: 0 },
  bullseyeLight: { r: 255, g: 255, b: 255 },
};

const K = 2;

// 합성 패치 셀(아래 makeEncodedA)은 육각 k=2 캔버스 밖까지 뻗는다 — scene.js 의
// 셀 캔버스 포함 가드(침묵 소실 방지 throw)에 걸리지 않도록 충분한 margin 을
// 명시한다 (기본 margin ×2 경로는 아래 '캔버스 포함 가드' describe 가 따로 다룬다).
const MARGIN_A = 10;

/**
 * 육각부 셀 2개 + "패치" 셀 2개(hexDistance(q,r) > K — ADR 0005 D1: 삼각 코너 패치는
 * 정확히 한 좌표가 -k 미만인 셀들이다. 여기서는 패치 조건의 대표 산술만 재현한다 —
 * placementA.js 의 실제 패치 셀 목록은 쓰지 않는다) 를 이 순서로 삽입한다.
 */
function makeEncodedA() {
  const cellDigits = new Map();
  // 육각부(hexDistance <= K) — 기존 Type O 경로와 동일 형태.
  cellDigits.set('2,0', { digit: 1, role: 'data' });
  cellDigits.set('-2,1', { digit: 4, role: 'data' });
  // 패치 셀 — r < -K (상단 패치 방향, ADR 0005 D1). hexDistance 로 육각 영역 밖임을
  // 스스로 확인한다(회귀 테스트 전제 문서화).
  const patchA = { q: 0, r: -(K + 2) };
  const patchB = { q: 1, r: -(K + 3) };
  assert.ok(hexDistance(patchA.q, patchA.r) > K, '패치 셀 A 가 육각 영역 안에 있음 — 테스트 전제 깨짐');
  assert.ok(hexDistance(patchB.q, patchB.r) > K, '패치 셀 B 가 육각 영역 안에 있음 — 테스트 전제 깨짐');
  cellDigits.set(`${patchA.q},${patchA.r}`, { digit: 3, role: 'data' });
  cellDigits.set(`${patchB.q},${patchB.r}`, { digit: 5, role: 'data' });
  return { k: K, cellDigits, patchA, patchB };
}

describe('buildScene — Type A 패치 셀 렌더', () => {
  test('육각 영역 밖 패치 셀도 shapes 에 포함된다(regionCells(k) 필터 방식이면 누락됨)', () => {
    const encoded = makeEncodedA();
    const scene = buildScene(encoded, { palette: PALETTE, margin: MARGIN_A });
    // 4 셀 × 3 면 + 6 disc.
    assert.equal(scene.shapes.length, 4 * 3 + 6);

    const polys = scene.shapes.filter((s) => s.kind === 'polygon');
    assert.equal(polys.length, 12);

    // 패치 셀 A·B 의 폴리곤이 정확한 좌표로 존재하는지 확인.
    for (const patch of [encoded.patchA, encoded.patchB]) {
      for (const face of FACES) {
        const expected = facePolygon(patch.q, patch.r, face, scene.layout);
        const found = polys.some((p) => JSON.stringify(p.points) === JSON.stringify(expected));
        assert.ok(found, `패치 셀 (${patch.q},${patch.r}) 면 ${face} 폴리곤이 shapes 에 없음`);
      }
    }
  });

  test('painter 순서는 cellDigits 삽입 순서(육각부 → 패치) 그대로', () => {
    const encoded = makeEncodedA();
    const scene = buildScene(encoded, { palette: PALETTE, margin: MARGIN_A });
    let idx = 0;
    for (const [key, entry] of encoded.cellDigits) {
      const [q, r] = key.split(',').map(Number);
      const ranks = digitToRanks(entry.digit);
      for (const face of FACES) {
        const shape = scene.shapes[idx];
        assert.equal(shape.kind, 'polygon');
        assert.deepEqual(shape.points, facePolygon(q, r, face, scene.layout));
        assert.deepEqual(shape.color, PALETTE.levels[ranks[face]]);
        idx += 1;
      }
    }
    assert.equal(idx, 4 * 3);
  });

  test('불스아이 6 disc 는 패치 셀 존재와 무관하게 무변경(ADR 0005 D7 — 19셀 슬롯 동일)', () => {
    const encoded = makeEncodedA();
    const scene = buildScene(encoded, { palette: PALETTE, margin: MARGIN_A });
    const discs = scene.shapes.filter((s) => s.kind === 'disc');
    assert.equal(discs.length, 6);
    const expectedRadii = bandRadii(1).slice().reverse();
    for (let i = 0; i < discs.length; i += 1) assert.equal(discs[i].r, expectedRadii[i]);
  });

  test('결정성: 동일 입력 2회 호출 → deepEqual', () => {
    const encoded = makeEncodedA();
    const a = buildScene(encoded, { palette: PALETTE, margin: MARGIN_A });
    const b = buildScene(encoded, { palette: PALETTE, margin: MARGIN_A });
    assert.deepEqual(a, b);
  });
});

describe('buildScene — 코너 QR 위치 4택 (ADR 0004 §1-7, Type A 패치 셀 포함 encoded)', () => {
  const encoded = makeEncodedA();

  test('QR_CORNERS = [TL, TR, BL, BR]', () => {
    assert.deepEqual(QR_CORNERS, ['TL', 'TR', 'BL', 'BR']);
  });

  test('4 코너 전부 기본 margin 에서 무교차(throw 없음)', () => {
    for (const qrCorner of QR_CORNERS) {
      assert.doesNotThrow(
        () => buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, qrCorner }),
        `qrCorner=${qrCorner} 에서 예기치 않은 throw`,
      );
    }
  });

  test('알 수 없는 qrCorner 는 RangeError', () => {
    assert.throws(
      () => buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, qrCorner: 'MID' }),
      RangeError,
    );
  });

  test('방위 고정: 4 코너 전부 QR 다크 모듈 좌표(모듈 격자 기준, 블록 원점 상대)가 동일 — 회전하지 않는다', () => {
    const qr = qrMatrix(TL_READER_URL);
    const darkRelCoordsFor = (qrCorner) => {
      const scene = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, qrCorner });
      const quiet = scene.shapes.find((s) => s.kind === 'polygon'
        && s.color === PALETTE.bullseyeLight);
      const originX = Math.min(...quiet.points.map((p) => p.x));
      const originY = Math.min(...quiet.points.map((p) => p.y));
      const qrModuleSize = 0.5; // cellSize=1 기본
      const darkShapes = scene.shapes.filter((s) => s.kind === 'polygon' && s.color === PALETTE.bullseyeDark);
      return darkShapes.map((s) => {
        const x = Math.round((Math.min(...s.points.map((p) => p.x)) - originX) / qrModuleSize) - 4;
        const y = Math.round((Math.min(...s.points.map((p) => p.y)) - originY) / qrModuleSize) - 4;
        return `${x},${y}`;
      }).sort();
    };
    const darkCount = qr.modules.filter((m) => m === 1).length;
    const base = darkRelCoordsFor('TL');
    assert.equal(base.length, darkCount);
    for (const qrCorner of ['TR', 'BL', 'BR']) {
      const other = darkRelCoordsFor(qrCorner);
      assert.deepEqual(other, base, `qrCorner=${qrCorner} 의 상대 다크 모듈 좌표가 TL 과 다름 — 회전 발생 의심`);
    }
  });

  // ⭐ **2026-08-27 배치 규칙 변경.** 종전에는 블록을 **캔버스 bbox 코너** 에 고정
  //    (margin·0.25 안쪽)했다. 그러면 여유가 모양에 따라 들쭉날쭉해서, 넓은 변이 코너에
  //    닿는 A/V 의 두 코너만 코드와 0.5셀이 됐고 안전영역 후광이 QR 흰 패치와 «용접» 돼
  //    보였다 (운영자 신고). 지금은 **코드 실루엣 기준**으로 바깥으로 당긴다.
  //    ⇒ 그래서 재는 것을 둘로 나눈다. 거울상은 **실루엣이 대칭인 코드**에서만 참이고,
  //      이 합성 A 는 패치 셀이 위쪽에만 있어 비대칭이라 거울상 단언 자체가 틀린 주장이다.
  test('bbox 대칭 이동: 실루엣이 대칭인 코드(Type O)에서는 4 코너 원점이 거울상이다', async () => {
    const { encode } = await import('../src/encode.js');
    const cellSize = 1;
    const margin = 20 * cellSize;
    const blockSide = 29 * (cellSize / 2);
    const encodedO = encode('quiet zone', { version: 1 });

    function quietOriginFor(qrCorner) {
      const scene = buildScene(encodedO, {
        palette: PALETTE, qrText: TL_READER_URL, qrCorner, cellSize, margin,
      });
      const quiet = scene.shapes.find((s) => s.kind === 'polygon' && s.color === PALETTE.bullseyeLight);
      return {
        x: Math.min(...quiet.points.map((p) => p.x)),
        y: Math.min(...quiet.points.map((p) => p.y)),
        width: scene.width,
        height: scene.height,
      };
    }

    // 육각 실루엣은 bbox 코너에서 멀어 당기기가 안 걸린다 — 종전 원점 그대로여야 한다.
    const tl = quietOriginFor('TL');
    assert.ok(Math.abs(tl.x - margin * 0.25) < 1e-9);
    assert.ok(Math.abs(tl.y - margin * 0.25) < 1e-9);

    const tr = quietOriginFor('TR');
    assert.ok(Math.abs(tr.x - (tl.width - margin * 0.25 - blockSide)) < 1e-9);
    assert.ok(Math.abs(tr.y - tl.y) < 1e-9);

    const bl = quietOriginFor('BL');
    assert.ok(Math.abs(bl.x - tl.x) < 1e-9);
    assert.ok(Math.abs(bl.y - (tl.height - margin * 0.25 - blockSide)) < 1e-9);

    const br = quietOriginFor('BR');
    assert.ok(Math.abs(br.x - tr.x) < 1e-9);
    assert.ok(Math.abs(br.y - bl.y) < 1e-9);
  });

  test('실루엣이 가까우면 블록은 **바깥으로만** 대각으로 당겨진다 (가장자리 여백 유지)', () => {
    const cellSize = 1;
    const margin = 20 * cellSize;
    const blockSide = 29 * (cellSize / 2);
    const MIN_INSET = 2 * cellSize; // scene.js CORNER_QR_MIN_EDGE_INSET_CELLS
    const EPS = 1e-9;

    for (const qrCorner of QR_CORNERS) {
      const scene = buildScene(encoded, {
        palette: PALETTE, qrText: TL_READER_URL, qrCorner, cellSize, margin,
      });
      const quiet = scene.shapes.find((s) => s.kind === 'polygon' && s.color === PALETTE.bullseyeLight);
      const x = Math.min(...quiet.points.map((p) => p.x));
      const y = Math.min(...quiet.points.map((p) => p.y));
      const baseX = qrCorner === 'TL' || qrCorner === 'BL'
        ? margin * 0.25 : scene.width - margin * 0.25 - blockSide;
      const baseY = qrCorner === 'TL' || qrCorner === 'TR'
        ? margin * 0.25 : scene.height - margin * 0.25 - blockSide;
      const dirX = qrCorner === 'TL' || qrCorner === 'BL' ? -1 : 1;
      const dirY = qrCorner === 'TL' || qrCorner === 'TR' ? -1 : 1;
      const pullX = (x - baseX) * dirX;
      const pullY = (y - baseY) * dirY;

      assert.ok(pullX >= -EPS, `${qrCorner}: 블록이 x 로 안쪽으로 밀렸다 (${pullX.toFixed(3)})`);
      assert.ok(pullY >= -EPS, `${qrCorner}: 블록이 y 로 안쪽으로 밀렸다 (${pullY.toFixed(3)})`);
      assert.ok(Math.abs(pullX - pullY) < 1e-6,
        `${qrCorner}: 당기기가 대각이 아니다 (x ${pullX.toFixed(3)} vs y ${pullY.toFixed(3)})`);
      const inset = Math.min(x, y, scene.width - (x + blockSide), scene.height - (y + blockSide));
      assert.ok(inset >= MIN_INSET - EPS,
        `${qrCorner}: 캔버스 변에서 ${inset.toFixed(2)}셀 — ${MIN_INSET}셀 미만이면 잘려 보인다`);
    }
  });

  test('margin 을 너무 작게 강제하면 4 코너 전부 throw — 셀 캔버스 가드가 먼저 발화', () => {
    // margin=2 는 (a) 패치 셀 캔버스 이탈 (b) QR 블록·실루엣 겹침 둘 다 유발하는데,
    // buildScene 은 셀 순회((1))가 코너 QR((3))보다 앞이라 (a)의 '벗어난다' 가 먼저
    // 던져진다. QR 겹침 가드('겹친다') 자체는 typeO-fallback.test.js(육각 encoded —
    // 셀 가드 비발화)가 계속 커버한다.
    for (const qrCorner of QR_CORNERS) {
      assert.throws(
        () => buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, qrCorner, margin: 2 }),
        /벗어난다/,
      );
    }
  });

  test('기존 기본값 경로(qrCorner 생략 = TL) 스냅샷 불변 — margin·0.25 원점', () => {
    const cellSize = 1;
    const margin = 20 * cellSize;
    const sceneDefault = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, cellSize, margin });
    const sceneExplicitTL = buildScene(
      encoded,
      { palette: PALETTE, qrText: TL_READER_URL, qrCorner: 'TL', cellSize, margin },
    );
    assert.deepEqual(sceneDefault, sceneExplicitTL);

    // ⚠ 원점 스냅샷(margin·0.25)은 2026-08-27 배치 변경으로 **더는 참이 아니다** —
    //   실루엣이 가까우면 바깥으로 당긴다. 대신 그 규칙이 지키는 성질을 잰다.
    const quiet = sceneDefault.shapes.find((s) => s.kind === 'polygon' && s.color === PALETTE.bullseyeLight);
    const originX = Math.min(...quiet.points.map((p) => p.x));
    const originY = Math.min(...quiet.points.map((p) => p.y));
    assert.ok(originX <= margin * 0.25 + 1e-9, '블록이 안쪽으로 밀렸다 — 당기기는 바깥 방향뿐이다');
    assert.ok(originY <= margin * 0.25 + 1e-9, '블록이 안쪽으로 밀렸다 — 당기기는 바깥 방향뿐이다');
    assert.ok(originX >= 2 * cellSize - 1e-9, '캔버스 변에서 2셀 미만 — 잘려 보인다');
    assert.ok(originY >= 2 * cellSize - 1e-9, '캔버스 변에서 2셀 미만 — 잘려 보인다');
  });

  test('무교차 단언은 실제 codeBounds(k, layout) 대비 실측으로도 확인(회귀 이중 확인)', () => {
    const cellSize = 1;
    const margin = 20 * cellSize;
    const layout = layoutForRegion(encoded.k, { size: cellSize, margin });
    const silhouette = codeBounds(encoded.k, layout);
    const qrModuleSize = cellSize / 2;
    const blockSide = 29 * qrModuleSize;
    // TL: 블록이 실루엣 좌상단보다 바깥(작은 좌표)에 있어야 한다.
    assert.ok(margin * 0.25 + blockSide <= silhouette.minX);
    assert.ok(margin * 0.25 + blockSide <= silhouette.minY);
  });
});

// ── 셀 캔버스 포함 가드 (검증 lane 2026-08-09 지적 — 침묵 소실 금지) ─────────
//
// layoutForRegion(k) 캔버스는 육각 실루엣 기준이라 Type A 삼각 패치가 기본
// margin(×2)에서 캔버스 밖으로 밀려나고, 래스터가 그 픽셀을 조용히 버려 데이터가
// 침묵 소실되던 문제 — buildScene 이 이제 이탈을 감지해 throw 한다('조용히 맞추지
// 않는다' 규약). 여기서는 실제 encodeA 산출물(잠정 A-U1 표 기준)로 통합 검증한다.

describe('buildScene — 셀 캔버스 포함 가드 (실제 encodeA 통합)', () => {
  test('A0/A1/A2 + 기본 margin(×2, QR 없음) → RangeError("벗어난다") — 조용한 소실 대신 명시 실패', async () => {
    const { encodeA } = await import('../src/encodeA.js');
    for (const version of [0, 1, 2]) { // 0 = A0 (ADR 0006 D6)
      const enc = encodeA('CANVAS GUARD', { version });
      assert.throws(
        () => buildScene(enc, { palette: PALETTE }),
        /벗어난다/,
        `A${version} 기본 margin 에서 이탈이 감지되지 않음`,
      );
    }
  });

  test('A0/A1/A2 + margin ×20(코너 QR 경로와 동일 상수) → 전 셀 폴리곤이 캔버스 안', async () => {
    const { encodeA } = await import('../src/encodeA.js');
    for (const version of [0, 1, 2]) { // 0 = A0 (ADR 0006 D6)
      const enc = encodeA('CANVAS GUARD', { version });
      const cellSize = 1;
      const scene = buildScene(enc, { palette: PALETTE, cellSize, margin: 20 * cellSize });
      for (const s of scene.shapes) {
        if (s.kind !== 'polygon') continue;
        for (const p of s.points) {
          assert.ok(p.x >= -1e-9 && p.x <= scene.width + 1e-9, `A${version}: x=${p.x} 캔버스 밖`);
          assert.ok(p.y >= -1e-9 && p.y <= scene.height + 1e-9, `A${version}: y=${p.y} 캔버스 밖`);
        }
      }
    }
  });

  test('Type O(V1~V3)는 기본 margin(×2) 그대로 무영향 — 가드 비발화', async () => {
    const { encode } = await import('../src/encode.js');
    for (const version of [1, 2, 3]) {
      const enc = encode('OK', { version });
      assert.doesNotThrow(() => buildScene(enc, { palette: PALETTE }));
    }
  });
});
