/**
 * locatorY.test.js — Type Y 실험 로케이터 기하·프로파일·렌더 계약.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOCATOR_PROFILE_Y,
  HEX_FRAME_V1,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_OFF,
  LOCATOR_PROFILES_Y,
  assertLocatorProfileY,
  locatorHubClearsSampleDiscs,
  locatorOuterPaddingCells,
  locatorShapesY,
} from '../src/locatorY.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { moduleSampleDisc, layoutForCube, YFACES } from '../src/ygrid.js';
import { FACE_INRADIUS_COEFF } from '../src/hexgrid.js';
import { qrMatrix } from '../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

function pointInDisc(px, py, disc) {
  const dx = px - disc.x;
  const dy = py - disc.y;
  return dx * dx + dy * dy <= disc.radius * disc.radius;
}

function shapeHitsDisc(shape, disc) {
  if (shape.kind === 'disc') {
    const dx = shape.cx - disc.x;
    const dy = shape.cy - disc.y;
    const reach = Math.sqrt(dx * dx + dy * dy) - shape.r;
    return reach <= disc.radius;
  }
  if (shape.kind !== 'polygon') return false;
  for (const p of shape.points) {
    if (pointInDisc(p.x, p.y, disc)) return true;
  }
  return false;
}

test('프로파일 식별자는 off · hex-frame-v1 · cell-surface-v1/v1r2/v2/v0/v2r2/v0x/v0xq/v0w/v0wq/v0w2/v0wy/v0t/v0ty 이고 기본은 off', () => {
  // v0 · v2r2 · v1r2 · v0x · v0xq · v0w = 최종 라인업 (cellSurfaceFinal.js). v1/v2 는
  // 배포 출력물 법의학용으로 식별자만 유지한다.
  // 의도적 갱신 (2026-08-16): v0X 편입으로 'cell-surface-v0x' 가 목록 끝에 붙었다.
  // 의도적 갱신 (2026-08-17): v0XQ(중앙 QR 변형) 편입으로 'cell-surface-v0xq' 가 뒤에 붙었다.
  // 의도적 갱신 «v0W 편입» (2026-08-16): 'cell-surface-v0w' 가 뒤에 붙었다.
  // **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)**: 'cell-surface-v0wq' 가 뒤에
  // 붙었다. **'cell-surface-v0wy' 는 없다** — v0WY 는 로케이터가 아니라 QR 위치
  // (`qrPosition: 'plane'`) 이고, 와이어는 v0W 그대로다. 프로파일을 만들면 디코더가
  // 절대 돌려줄 수 없는 값이 목록에 남는다.
  // **의도적 갱신 «v0W2 편입» (2026-08-17)**: 'cell-surface-v0w2' 가 뒤에 붙었다
  // (v0W 파생 ② — SE 부 파인더 6×6 확대 + NW·NE 3면 대칭 통일). 근거 실측은
  // `test/output/lanes/claude-v0w2-derive.mjs`(정본 유도) ·
  // `claude-v0w2-render.mjs`(래스터 291면 불일치 0) · `claude-v0w2-probe.mjs`.
  // ⚠ **의도적 갱신 «v0WY 편입» (2026-08-17 운영자 재설계)** — 위 「'cell-surface-v0wy'
  // 는 없다 — v0WY 는 로케이터가 아니라 QR 위치이고 와이어는 v0W 그대로다」 는
  // **허공 마름모 설계**의 서술이었다. QR 이 실루엣 안쪽 먼 코너로 들어와 64셀을
  // 먹으면서 셀 집합·회계·와이어가 v0W 와 갈렸고, 그래서 프로파일이 실재한다.
  // 그 문단이 걱정하던 «디코더가 절대 돌려줄 수 없는 값» 도 해소됐다 — 디코더에
  // `v0wy` 패밀리가 있고 `cellSurface-block-locator.test.js` 가 그 산출을 고정한다.
  // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — 'cell-surface-v0tr' ·
  // 'cell-surface-v0trq' 가 맨 뒤에 붙었다. 둔 다 외곽 패딩이 0 이라
  // `locatorOuterPaddingCells` 분기는 안 늘어난다 (셀 표면 계보 공통).
  // **의도적 갱신 «v0T 편입» (운영자 확정 2026-08-17)** — 'cell-surface-v0t' ·
  // 'cell-surface-v0ty' 가 뒤에 붙었다 (v0T = Type Y 최종 파인더 · v0TY = 먼 코너
  // QR 파생). v0W 계열 넷은 같은 날 드랍됐지만 **프로파일 상수는 그대로다** —
  // 발행분 재생성·법의학 경로가 이 값을 쓴다 (v1r2·v2r2·v0x·v0xq 전례).
  assert.deepEqual([...LOCATOR_PROFILES_Y], [
    'off', 'hex-frame-v1', 'cell-surface-v1', 'cell-surface-v1r2', 'cell-surface-v2',
    'cell-surface-v0', 'cell-surface-v2r2', 'cell-surface-v0x', 'cell-surface-v0xq',
    'cell-surface-v0w', 'cell-surface-v0wq', 'cell-surface-v0w2', 'cell-surface-v0wy',
    'cell-surface-v0t', 'cell-surface-v0ty',
    'cell-surface-v0tr', 'cell-surface-v0trq',
  ]);
  assert.ok(LOCATOR_PROFILES_Y.includes('cell-surface-v0tr')
    && LOCATOR_PROFILES_Y.includes('cell-surface-v0trq'),
    'v0TR·v0TRQ 프로파일이 없다 (2026-08-17 편입)');
  assert.ok(LOCATOR_PROFILES_Y.includes('cell-surface-v0wy'),
    'v0WY 는 이제 로케이터 프로파일이다 (2026-08-17 재설계)');
  assert.ok(LOCATOR_PROFILES_Y.includes('cell-surface-v0t')
    && LOCATOR_PROFILES_Y.includes('cell-surface-v0ty'),
    'v0T·v0TY 프로파일이 없다 (2026-08-17 편입)');
  assert.equal(DEFAULT_LOCATOR_PROFILE_Y, LOCATOR_PROFILE_OFF);
  assert.equal(assertLocatorProfileY('hex-frame-v1'), LOCATOR_PROFILE_HEX_FRAME_V1);
  assert.throws(() => assertLocatorProfileY('unknown'), RangeError);
  assert.equal(locatorOuterPaddingCells('off'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v1'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v0'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v2r2'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v0x'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v0w'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v0wq'), 0);
  assert.ok(locatorOuterPaddingCells('hex-frame-v1') > 1.8);
  assert.equal(locatorHubClearsSampleDiscs('hex-frame-v1'), true);
});

test('hex-frame-v1 획은 Y0 최소 렌더(ppu=8)에서 2px 이상', () => {
  const px = HEX_FRAME_V1.stroke * 8;
  assert.ok(px >= 2, `획 ${px}px 는 인쇄에 너무 가늘다`);
});

test('중앙 파인더는 오른쪽 변이 열린 C형 육각 고리다', () => {
  const layout = layoutForCube(13, { size: 10, margin: 4 });
  const shapes = locatorShapesY(13, layout, PALETTE, 'hex-frame-v1');
  const hubEdges = shapes.filter((shape) => shape.locatorPart === 'hub-c-ring');
  assert.equal(hubEdges.length, 5);
  assert.deepEqual(
    hubEdges.map((shape) => shape.locatorEdge).sort((a, b) => a - b),
    [0, 2, 3, 4, 5],
  );
  assert.equal(hubEdges.some((shape) => shape.locatorEdge === HEX_FRAME_V1.hubGapSide), false);
});

test('기본 프로파일은 기존 scene 도형 수를 바꾸지 않는다', () => {
  const encoded = encodeY('https://tl.estre.so', { version: 0, tones: 3, eccLevel: 'M' });
  const legacy = buildSceneY(encoded, { palette: PALETTE });
  const explicit = buildSceneY(encoded, { palette: PALETTE, locatorProfile: 'off' });
  assert.equal(legacy.shapes.length, explicit.shapes.length);
  assert.equal(legacy.locatorProfile, 'off');
});

test('hex-frame-v1 은 도형을 더하고 샘플 원판과 겹치지 않는다', () => {
  const encoded = encodeY('https://tl.estre.so', { version: 0, tones: 3, eccLevel: 'M' });
  const off = buildSceneY(encoded, { palette: PALETTE, locatorProfile: 'off' });
  const on = buildSceneY(encoded, { palette: PALETTE, locatorProfile: 'hex-frame-v1' });
  assert.equal(on.locatorProfile, 'hex-frame-v1');
  assert.ok(on.shapes.length > off.shapes.length);

  const layout = on.layout;
  const discs = [];
  for (let j = 0; j < encoded.n; j += 1) {
    for (let i = 0; i < encoded.n; i += 1) {
      for (const face of YFACES) {
        discs.push(moduleSampleDisc(face, i, j, layout));
      }
    }
  }
  const added = on.shapes.slice(off.shapes.length);
  // QR 이 없으면 추가분은 전부 로케이터.
  for (const shape of added) {
    if (shape.color === PALETTE.bullseyeLight) continue; // 흰 가드는 원판 밖 여백
    for (const disc of discs) {
      assert.equal(shapeHitsDisc(shape, disc), false,
        `로케이터 도형이 샘플 원판과 겹친다 r=${disc.radius}`);
    }
  }
  const inradius = FACE_INRADIUS_COEFF * layout.size * 0.5;
  assert.ok(inradius > 0);
});

test('로케이터는 코너 QR 블록과 겹치지 않는다', () => {
  const encoded = encodeY('https://tl.estre.so', { version: 0, tones: 3, eccLevel: 'M' });
  const qrText = 'HTTPS://TL.EXAMPLE/A';
  assert.doesNotThrow(() => buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'hex-frame-v1',
    qrText,
    qrCorner: 'TL',
  }));
  const scene = buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'hex-frame-v1',
    qrText,
    qrCorner: 'TL',
  });
  const qr = qrMatrix(qrText);
  let dark = 0;
  for (const m of qr.modules) if (m === 1) dark += 1;
  assert.ok(scene.shapes.length > 3 * encoded.n * encoded.n + 4 + dark);
});

test('작은 margin 은 로케이터 두께만큼 자동으로 늘어난다', () => {
  const encoded = encodeY('x', { version: 0, tones: 3, eccLevel: 'M' });
  const tight = buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'hex-frame-v1',
    margin: 0.5,
  });
  const off = buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'off',
    margin: 0.5,
  });
  const pad = locatorOuterPaddingCells('hex-frame-v1');
  const extra = tight.layout.width - off.layout.width;
  assert.ok(extra > 0, `로케이터 margin 이 안 늘었다 on=${tight.layout.width} off=${off.layout.width}`);
  assert.ok(Math.abs(extra - 2 * (pad - 0.5)) < 1e-9,
    `width Δ=${extra} expected=${2 * (pad - 0.5)}`);
});

test('locatorShapesY(off) 는 빈 배열', () => {
  const layout = layoutForCube(13, { size: 1, margin: 4 });
  assert.deepEqual(locatorShapesY(13, layout, PALETTE, 'off'), []);
  assert.ok(locatorShapesY(13, layout, PALETTE, 'hex-frame-v1').length >= 12);
});
