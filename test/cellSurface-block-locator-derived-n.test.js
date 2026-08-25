/**
 * cellSurface-block-locator-derived-n.test.js — 블록 로케이터의 **합법 n 유도** 회귀.
 *
 * 배경 (2026-08-25): 셀 표면 라인업이 v0T·v0TR 을 `[21, 25]` 로 열었는데
 * `cellsurface-block-detect.js` 는 레이아웃마다 `const V0xx_N = 21;` 을 손으로 들고
 * 있었다. 그래서 n=25 프레임에서 그 패밀리의 **가설이 아예 시드되지 않았다** —
 * 「라인업만 넓히고 상수를 안 걷은」 잔존이다. 이 파일이 잠그는 것:
 *
 *   ① 앵커드 가설의 n 목록이 `CELL_SURFACE_FINAL_NS` 와 **글자 그대로 같다**
 *      (손 상수가 다시 들어오면 여기서 죽는다).
 *   ② 코너 앵커 반경이 문서의 닫힌형과 **사실로 일치**한다 (√279 @21 · √427 @25).
 *      주석이 주장을 하면 그 주장이 참이어야 한다.
 *   ③ 스칼라 반경 계열(v2r2·v1r2·v0X)이 ①에서 빠진 **이유가 실측으로 성립**한다 —
 *      그 셋만 코너 반경이 «패치 앵커» 가 아니라 «K5 코어 중심» 이라 유도가 다르다.
 *   ④ n=25 프레임에서 그 패밀리의 포즈가 실제로 **n=25 로 표식**된다.
 *   ⑤ n=21 프레임의 표식은 21 그대로다 (무회귀).
 *   ⑥ 되찾은 가설이 **끝단 복호까지** 간다.
 *
 * 게이트는 한 값도 안 건드렸다 (agreement 0.78 · orientation margin 0.035 · CRC · RS).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, PAYLOAD, FILL,
  embed960, decodeLab,
  CS_BLOCK_LOCATOR_INTERNALS, detectCellSurfaceBlockShapes, toRelativeLuminance,
  encodeY, buildSceneY, rasterize, distortImage, TL_READER_URL,
} from './cellSurface-block-locator.helpers.mjs';
import { UNVERIFIED_CS_BLOCK_LOCATOR } from '../src/decoder/cellsurface-block-detect.js';
import { CELL_SURFACE_FINAL_IDS, CELL_SURFACE_FINAL_NS } from '../src/cellSurfaceFinal.js';

const { anchoredHypothesesFor, finalNsFor, V2R2_RADII } = CS_BLOCK_LOCATOR_INTERNALS;

/**
 * 로케이터가 다루는 레이아웃 = **패밀리 스위치가 있는 레이아웃**. 목록을 손으로
 * 적지 않고 캘리브레이션 키에서 유도한다 (스위치가 늘면 이 회귀도 같이 넓어진다).
 */
const FAMILY_IDS = CELL_SURFACE_FINAL_IDS.filter(
  (id) => (id + 'Family') in UNVERIFIED_CS_BLOCK_LOCATOR,
);

/**
 * ③ 의 대상 — 코너 반경이 **패치 앵커와 다른 양**이라 앵커 유도를 못 쓰는 셋.
 * 목록이 아니라 **성질**로 정의된다: 이 파일의 §③ 이 매 실행 그 성질을 실측한다.
 */
const SCALAR_SEED_IDS = Object.freeze(['v2r2', 'v1r2', 'v0x']);
const DERIVED_IDS = FAMILY_IDS.filter((id) => !SCALAR_SEED_IDS.includes(id));

function renderY(layoutId, version, pixelsPerUnit, qrText = null) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layoutId, version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, ...(qrText ? { qrText } : {}),
  });
  return embed960(rasterize(scene, { pixelsPerUnit, supersample: 2 }));
}

function familyShapes(detected, familyId) {
  return detected.shapes.filter(
    (shape) => shape.blockLocator && shape.blockLocator.family === familyId,
  );
}

test('① 앵커드 가설의 n 목록 = 정본 CELL_SURFACE_FINAL_NS (손 상수 부재)', () => {
  assert.ok(DERIVED_IDS.length >= 8,
    '유도 대상이 ' + DERIVED_IDS.length + '개뿐이다 — 스위치 유도가 헛돌고 있다');
  for (const id of DERIVED_IDS) {
    assert.deepEqual(
      anchoredHypothesesFor(id).map((hypothesis) => hypothesis.n),
      [...CELL_SURFACE_FINAL_NS[id]],
      id + ': 로케이터 가설의 n 이 정본과 다르다 — 손 상수가 다시 들어왔나',
    );
    assert.deepEqual(
      [...finalNsFor(id)], [...CELL_SURFACE_FINAL_NS[id]],
      id + ': finalNsFor 가 정본을 안 본다',
    );
  }
  // 라인업이 실제로 넓은 레이아웃이 **하나라도** 있어야 이 회귀가 의미를 갖는다.
  // (전부 단일 n 이면 ① 은 통과해도 아무것도 안 잠근다 — 그 상태를 소리내 적는다.)
  const widened = DERIVED_IDS.filter((id) => CELL_SURFACE_FINAL_NS[id].length > 1);
  assert.ok(widened.length > 0,
    '유도 계열 중 n 이 둘 이상인 레이아웃이 없다 — 라인업이 좁아졌다면 이 회귀의 '
    + '④·⑥ 이 무의미해진다 (그 자체가 보고 대상)');
});

test('② 코너 앵커 반경이 문서의 닫힌형과 일치한다 (검증되는 사본)', () => {
  // 유도 계열은 전부 **같은 NE 동심 사각**(v0X SE 의 평행이동)을 코너 앵커로 쓴다.
  // n=21: 무게중심 (3,18) → r² = 9 + 324 − 54 = 279.
  // n=25: 면 모서리 기준으로 (3,22) → r² = 9 + 484 − 66 = 427.
  for (const id of DERIVED_IDS) {
    for (const { n, radius } of anchoredHypothesesFor(id)) {
      if (n === 21) {
        // hypot(−12.99038105676658, −10.5) 은 √279 와 **비트 동일**이다 (실측).
        assert.equal(radius, Math.sqrt(279), id + '@21 코너 반경이 √279 가 아니다');
      } else if (n === 25) {
        // hypot 과 sqrt 는 라운딩 경로가 달라 마지막 ULP 가 갈릴 수 있다.
        assert.ok(Math.abs(radius - Math.sqrt(427)) < 1e-12,
          id + '@25 코너 반경이 √427 이 아니다: ' + radius);
      } else {
        assert.fail(id + '@' + n + ': 닫힌형이 기록되지 않은 n 이다 — 반경을 재고 여기 적어라');
      }
    }
  }
});

test('③ 스칼라 반경 계열이 유도에서 빠진 이유가 실측으로 성립한다', () => {
  // v1r2 는 코너 반경이 **K5 코어 중심 18.0** 인데 패치 앵커(블록 무게중심)는 18.5 다.
  // 두 양이 다르므로 앵커 유도로 갈아타면 스냅 창이 0.5셀 움직인다 — 그래서 제외다.
  assert.equal(anchoredHypothesesFor('v1r2')[0].radius, 18.5,
    'v1r2 패치 앵커가 18.5 가 아니다 — 제외의 근거가 사라졌으니 다시 재라');
  assert.equal(CELL_SURFACE_FINAL_NS.v1r2.length, 1,
    'v1r2 의 합법 n 이 늘었다 — soleFinalN 이 로드에서 죽는다. 새 n 의 코어 중심 반경을 '
    + '재서 표를 세워라 (드랍 계열이라 실기기 근거부터 필요하다)');
  // v0X 는 우연히 앵커(18)와 코어(18)가 같지만 시드 경로가 다르다(스칼라 similarity).
  assert.equal(anchoredHypothesesFor('v0x')[0].radius, 18, 'v0X 패치 앵커가 18 이 아니다');
  assert.equal(CELL_SURFACE_FINAL_NS.v0x.length, 1, 'v0X 의 합법 n 이 늘었다 — §③ 참조');
  // v2r2 는 닫힌형이 n 의 함수(n−3.5)라 **n 목록만** 유도한다.
  assert.deepEqual(V2R2_RADII.map((row) => row.n), [...CELL_SURFACE_FINAL_NS.v2r2],
    'v2r2 반경표가 정본 n 을 안 따라간다');
  for (const row of V2R2_RADII) assert.equal(row.radius, row.n - 3.5);
});

test('④ n=25 프레임에서 v0T·v0TR 가설이 n=25 로 표식된다', { timeout: 900_000 }, () => {
  for (const id of ['v0t', 'v0tr']) {
    if (!CELL_SURFACE_FINAL_NS[id].includes(25)) continue;
    const frame = renderY(id, 2, 13);
    for (const [label, tone] of [['clean', {}], ['gamma0.7', { gamma: 0.7 }], ['rot120', { rotation: 120 }]]) {
      const detected = detectCellSurfaceBlockShapes(
        toRelativeLuminance(distortImage(frame, { ...tone, fill: FILL })),
      );
      const mine = familyShapes(detected, id);
      const where = id + '@25 ' + label;
      assert.ok(mine.length > 0, where + ': 자기 패밀리 shape 가 0 이다');
      assert.ok(mine.some((shape) => shape.estimatedN === 25),
        where + ': n=25 표식이 하나도 없다 — 손 상수(21)가 돌아왔나. 관측 표식 = '
        + JSON.stringify(mine.map((shape) => shape.estimatedN)));
    }
  }
});

test('⑤ n=21 프레임의 표식은 21 그대로다 (무회귀)', { timeout: 900_000 }, () => {
  const frames = [
    ['v0t', renderY('v0t', 1, 15)],
    // 슬롯 계열은 QR 이 레이아웃 정의라 qrText 가 필수다 (QR v1 알파뉴메릭 문자셋).
    ['v0ty', renderY('v0ty', 1, 15, TL_READER_URL)],
    ['v0tr', renderY('v0tr', 1, 15)],
    ['v0try', renderY('v0try', 1, 15, TL_READER_URL)],
  ];
  for (const [id, frame] of frames) {
    for (const [label, tone] of [['clean', {}], ['gamma0.7', { gamma: 0.7 }]]) {
      const detected = detectCellSurfaceBlockShapes(
        toRelativeLuminance(distortImage(frame, { ...tone, fill: FILL })),
      );
      const mine = familyShapes(detected, id);
      const where = id + '@21 ' + label;
      assert.ok(mine.length > 0, where + ': 자기 패밀리 shape 가 0 이다');
      for (const shape of mine) {
        assert.equal(shape.estimatedN, 21, where + ': n 표식이 21 이 아니다');
      }
    }
  }
});

test('⑥ 되찾은 n=25 가설이 끝단 복호까지 간다', { timeout: 900_000 }, () => {
  // 손 상수 시절 이 두 칸은 `frontend:no-format-candidate` 로 죽었다 (실측
  // `test/output/lanes/claude-m1-n25-decode.mjs` 전/후 대조 — 10/12 → 12/12).
  for (const id of ['v0t', 'v0tr']) {
    if (!CELL_SURFACE_FINAL_NS[id].includes(25)) continue;
    const frame = renderY(id, 2, 13);
    for (const [label, tone] of [['clean', {}], ['gamma0.7', { gamma: 0.7 }]]) {
      const decoded = decodeLab(distortImage(frame, { ...tone, fill: FILL }));
      const where = id + '@25 ' + label;
      assert.equal(decoded.ok, true, where + ': ' + (decoded.reason || ''));
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.n, 25, where + ': 복호가 n=25 로 안 섰다');
      assert.equal(decoded.hypothesis.cellSurfaceLayout, id, where + ': 남의 레이아웃으로 복호됐다');
    }
  }
});
