/**
 * render3d-parity.test.js — 「2.5D 에서 켠 것이 3D 에서도 같은 뜻으로 반영되는가」의 자.
 *
 * 발단: 운영자 실기 2026-09-07 20:1x 「3D 렌더에서 현재 파인더/로케이터 강조나 배경색
 * 선택, 코너 QR 출력 등이 동일하게 반영되지 않는다 … 3D 일 때 렌더링되는 큐브 크기도
 * 아이소메트릭 기준, 2.5D 일 때 크기와 동일하게 나와야겠고」.
 *
 * ⚠ 재는 것은 **성질**이지 값이 아니다. 그리고 자마다 「먼저 잴 게 있나」를 확인한다 —
 *   강조가 아무것도 안 바꾸는 구성에서 「같다」는 항진명제라 변이를 통과시킨다
 *   (2026-09-07 검토 F3 과 같은 함정).
 *
 * 실행: node --test test/render3d-parity.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, yLevelTables } from '../src/sceneY.js';
import { layoutForCube, moduleQuad, YFACES } from '../src/ygrid.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { buildOrbitMesh, paintQuads, fitViewScene } from '../src/y3d-viewer.js';
import { slotQrFaceQuads } from '../src/y3d-slot-qr.js';
import { CELL_SURFACE_FINAL_V0 } from '../src/cellSurfaceFinal.js';
import { faceGainsForRenderProfile, DEFAULT_RENDER_PROFILE } from '../src/render-profile.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/**
 * 소스 축 자가 보는 것은 **코드**지 산문이 아니다. 주석을 안 벗기면 「이 식별자를 읽지
 * 않는다」는 자가 그것을 **설명하는 주석 한 줄**에 걸려 빨개진다 (실제로 났다).
 * 「철자를 재는 자는 썩는다」의 완화 — 최소한 «어디에 적혔나» 는 가른다.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
}

/** `index.html` 의 3D 미리보기 본문 (주석 제거). */
function paintY3dBody() {
  const start = INDEX.indexOf('function paintY3dPreview()');
  assert.ok(start > 0, 'paintY3dPreview 를 못 찾았다 — 소스 축 자의 전제가 깨졌다');
  const end = INDEX.indexOf('\nfunction ', start + 10);
  return stripComments(INDEX.slice(start, end > 0 ? end : start + 12000));
}

const PRESET = getPreset(DEFAULT_PRESET);
const QR_TEXT = 'HTTPS://TL.ESTRE.SO';
/** 배경 3택 — index.html `BG_MODE_COLORS` 와 같은 뜻. 'transparent' 는 **null** 이다. */
const BG_TRANSPARENT = null;

function palette(background) {
  return {
    background: background === undefined ? { r: 0, g: 0, b: 0 } : background,
    levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: faceGainsForRenderProfile(DEFAULT_RENDER_PROFILE),
  };
}

const encoded = encodeY('TLCUBE', {
  version: 0, eccLevel: 'H', tones: 3,
  cellSurface: true, cellSurfaceLayout: CELL_SURFACE_FINAL_V0,
});

function scene25(emphasis, background) {
  const opts = { palette: palette(background), qrText: QR_TEXT };
  if (emphasis !== undefined) opts.centralN7Emphasis = emphasis;
  return buildSceneY(encoded, opts);
}

/**
 * `index.html` 의 `paintY3dPreview` 필드 모드를 **그대로** 세운다.
 * (화면이 아니라 «같은 입력을 같은 함수에 넣는다» 는 성질을 재는 자리다.)
 */
function mesh3d(emphasis, background, pose) {
  const p = pose || {};
  const pal = palette(background);
  const scene = scene25(emphasis, background);
  const tables = yLevelTables(pal, scene.locatorProfile, emphasis);
  const mesh = buildOrbitMesh({
    n: encoded.n,
    tones: 3,
    levels: pal.levels,
    faceLevels: tables.data,
    locatorFaceLevels: tables.locator,
    layout: scene.layout,
    yaw: p.yaw || 0,
    pitch: p.pitch || 0,
    roll: p.roll || 0,
    perspective: p.perspective || 0,
    faces: 3,
    digitAt: (i, j) => {
      const e = encoded.cellDigits.get(`${i},${j}`);
      return e ? e.digit : null;
    },
    levelAt: (i, j, face) => {
      const e = encoded.cellDigits.get(`${i},${j}`);
      const lv = e && e.tones ? e.tones[face] : null;
      return Number.isInteger(lv) ? lv : null;
    },
    faceQuads: slotQrFaceQuads({
      layoutId: encoded.cellSurfaceLayout, n: encoded.n, qrText: QR_TEXT, palette: pal,
    }),
    includeBack: true,
  });
  return { mesh, scene };
}

const rgb = (c) => `${c.r},${c.g},${c.b}`;
const quadKey = (pts) => pts.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).join('|');

/** scene 도형 중 «셀 한 면» 인 것만 좌표로 되찾는다 (순서 가정 없이). */
function cellColors25(scene) {
  const want = new Map();
  for (let j = 0; j < scene.n; j += 1) {
    for (let i = 0; i < scene.n; i += 1) {
      for (const f of YFACES) want.set(quadKey(moduleQuad(f, i, j, scene.layout)), `${i},${j},${f}`);
    }
  }
  const out = new Map();
  for (const s of scene.shapes) {
    if (s.kind !== 'polygon' || !Array.isArray(s.points) || s.points.length !== 4) continue;
    const id = want.get(quadKey(s.points));
    if (id !== undefined && !out.has(id)) out.set(id, s.color);
  }
  return out;
}

function cellColors3d(mesh) {
  const out = new Map();
  for (const q of mesh.quads) {
    if (q.kind === 'module') out.set(`${q.i},${q.j},${q.face}`, q.color);
  }
  return out;
}

/** 그린 것을 기록하는 가짜 ctx — 끝단(paintQuads)까지 재려고 쓴다. */
function stubCtx(width, height) {
  return {
    canvas: { width, height },
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    fills: [], _pts: [], fillRectCount: 0, clearRectCount: 0,
    fillRect() { this.fillRectCount += 1; },
    clearRect() { this.clearRectCount += 1; },
    beginPath() { this._pts = []; },
    moveTo(x, y) { this._pts.push([x, y]); },
    lineTo(x, y) { this._pts.push([x, y]); },
    closePath() {},
    fill() { this.fills.push({ style: this.fillStyle, pts: this._pts.slice() }); },
    stroke() {},
    fillText() {},
  };
}

describe('render3d-parity — 색 (면 게인 · 검출기 강조)', () => {
  test('ⓐ 먼저 «잴 게 있나» — 게인이 면을 실제로 가르고, 강조가 실제로 셀을 바꾼다', () => {
    const gains = faceGainsForRenderProfile(DEFAULT_RENDER_PROFILE);
    assert.notEqual(gains.T, gains.L, '면 게인이 평면(1/1/1)이면 게인 축을 못 잰다');
    assert.notEqual(gains.T, gains.R, '면 게인이 평면(1/1/1)이면 게인 축을 못 잰다');

    const off = cellColors25(scene25(undefined));
    const all = cellColors25(scene25('all'));
    let changed = 0;
    for (const [k, c] of off) if (rgb(c) !== rgb(all.get(k))) changed += 1;
    assert.ok(changed > 0,
      '이 구성에서 강조가 2.5D 를 하나도 안 바꾼다 — 아래 파리티 자가 항진명제가 된다');
    // 로케이터 «검출 셀» 만 바뀌어야 한다 (Y 는 데이터 팔이 없다) — 전부 바뀌면 축이 다르다.
    assert.ok(changed < off.size, '강조가 코드 셀까지 바꿨다 — Y 는 로케이터 팔만이어야 한다');
  });

  for (const emphasis of [undefined, 'default', 'locator', 'all']) {
    test(`ⓑ 3D 셀면 색이 2.5D 와 전부 같다 (강조 ${emphasis === undefined ? '미지정' : emphasis})`, () => {
      const s = scene25(emphasis);
      const { mesh } = mesh3d(emphasis);
      const a = cellColors25(s);
      const b = cellColors3d(mesh);
      assert.equal(a.size, encoded.n * encoded.n * 3, '2.5D 셀면 수가 예상과 다르다');
      assert.equal(b.size, a.size, '3D 셀면 수가 2.5D 와 다르다 — 구멍이 생겼다');
      const diff = [];
      for (const [k, c] of a) if (rgb(c) !== rgb(b.get(k))) diff.push([k, rgb(c), rgb(b.get(k))]);
      assert.deepEqual(diff, [],
        `3D 색이 2.5D 와 ${diff.length}면 다르다 (면 게인 또는 강조가 3D 로 안 넘어갔다)`);
    });
  }

  test('ⓒ 강조가 3D 에서도 **같은 면 집합**을 바꾼다', () => {
    const off25 = cellColors25(scene25(undefined));
    const all25 = cellColors25(scene25('all'));
    const off3 = cellColors3d(mesh3d(undefined).mesh);
    const all3 = cellColors3d(mesh3d('all').mesh);
    const changed25 = new Set();
    const changed3 = new Set();
    for (const k of off25.keys()) {
      if (rgb(off25.get(k)) !== rgb(all25.get(k))) changed25.add(k);
      if (rgb(off3.get(k)) !== rgb(all3.get(k))) changed3.add(k);
    }
    assert.ok(changed25.size > 0, '잴 게 없다');
    assert.deepEqual([...changed3].sort(), [...changed25].sort(),
      '강조로 달라지는 면 집합이 2.5D 와 3D 에서 다르다');
  });

  test('ⓓ 강조 인자를 안 주면 3D 도 강조 없는 그림이다 (정식 화면 새어나감 방지)', () => {
    // `renderY` 는 게이트를 통과한 때만 `sceneOpts.centralN7Emphasis` 를 심는다.
    // 그러므로 «인자 없음» 이 곧 «정식 화면» 이고, 그때 강조가 하나도 안 먹어야 한다.
    const plain = cellColors3d(mesh3d(undefined).mesh);
    const emph = cellColors3d(mesh3d('all').mesh);
    const base = cellColors25(scene25(undefined));
    for (const [k, c] of base) {
      assert.equal(rgb(plain.get(k)), rgb(c), `강조 미지정인데 3D 가 다른 색을 냈다: ${k}`);
    }
    let changed = 0;
    for (const k of plain.keys()) if (rgb(plain.get(k)) !== rgb(emph.get(k))) changed += 1;
    assert.ok(changed > 0, '두 팔이 비트 동일이다 — 이 자가 아무것도 안 지킨다');
  });

  test('ⓔ 3D 강조 모드의 출처는 `sceneOpts` 다 — generatorState 를 직접 안 읽는다', () => {
    /*
     * 이 자가 대답하는 질문: 「3D 경로가 `renderY` 의 게이트(적용 대상 검출기 ×
     * 고급/시험판 노출)를 **우회**하는가」. 함수 축(ⓓ)은 «인자를 안 주면 안 먹는다» 만
     * 재고, «호출자가 인자를 어디서 가져오나» 는 못 잰다 — 거기가 새는 자리다.
     */
    const body = paintY3dBody();
    assert.equal(body.includes('generatorState.centralN7Emphasis'), false,
      '3D 경로가 generatorState 의 강조를 직접 읽는다 — renderY 게이트를 우회한다');
    assert.ok(body.includes('sceneOpts') && body.includes('centralN7Emphasis'),
      '3D 경로가 sceneOpts 의 강조를 안 읽는다 — 강조가 다시 무시된다');
  });

  test('ⓕ½ index.html: 3D 가 2.5D 와 **같은 유도**를 넘긴다 (레벨 표 · 지면)', () => {
    /*
     * 이 자가 대답하는 질문: 「모듈은 옳은데 화면이 그 배선을 안 쓰는가」.
     * 아래 함수 축 자들은 «같은 입력을 넣으면 같은 그림» 만 재고, 호출자가 그 입력을
     * 실제로 만드는지는 못 잰다 — 2026-09-07 (C) 가 밟았던 「켰는데 안 먹는」 자리다.
     */
    const body = paintY3dBody();
    assert.ok(body.includes('yLevelTables('), '3D 가 2.5D 의 레벨 표 유도를 안 쓴다');
    assert.ok(body.includes('faceLevels: levelTables.data'), '면 게인 표를 안 넘긴다');
    assert.ok(body.includes('locatorFaceLevels: levelTables.locator'), '검출 셀 표를 안 넘긴다');
    assert.ok(body.includes('current.scene.locatorProfile'),
      '로케이터 프로파일을 buildSceneY 가 해소한 값에서 안 받는다 — 사본이 생긴다');
    assert.ok(body.includes('current.scene.width') && body.includes('current.scene.height'),
      '지면 rect 를 2.5D scene 에서 안 받는다 — 크기 파리티가 깨진다');
    assert.ok(body.includes('layout') && body.includes('current.scene.layout'),
      '3D 가 2.5D 의 layout 을 안 쓴다 — 좌표계가 갈린다');
    assert.ok(INDEX.includes("import { buildSceneY, yLevelTables } from './src/sceneY.js';"),
      'yLevelTables 를 import 하지 않는다');
  });

  test('ⓕ 모양이 어긋난 레벨 표는 **던진다** (조용한 무시 금지)', () => {
    const base = {
      n: 3, tones: 3, levels: PRESET.levels,
      layout: layoutForCube(3, { size: 1, margin: 0.25 }),
      digitAt: () => 0,
    };
    assert.throws(() => buildOrbitMesh({ ...base, faceLevels: { T: PRESET.levels, L: PRESET.levels } }),
      RangeError, 'faceLevels 에 면이 빠졌는데 안 던졌다');
    assert.throws(() => buildOrbitMesh({
      ...base,
      faceLevels: { T: PRESET.levels, L: PRESET.levels, R: PRESET.levels.slice(0, 2) },
    }), RangeError, 'faceLevels 길이가 틀렸는데 안 던졌다');
    assert.throws(() => buildOrbitMesh({
      ...base, locatorFaceLevels: { T: PRESET.levels, R: PRESET.levels },
    }), RangeError, 'locatorFaceLevels 에 면이 빠졌는데 안 던졌다');
  });
});

describe('render3d-parity — 크기', () => {
  test('ⓖ 반올림 없는 상자에서는 셀 꼭짓점이 **정확히** 2.5D 와 같다', () => {
    const ppu = 10;
    const { mesh, scene } = mesh3d('all');
    // 정수 반올림이 없는 상자 — 「규칙이 같은가」만 남긴다.
    const W = scene.width * ppu;
    const H = scene.height * ppu;
    const view = paintQuads(stubCtx(W, H), mesh, {
      layout: scene.layout, fitScene: { width: scene.width, height: scene.height },
    });
    let worst = 0;
    for (const q of mesh.quads) {
      if (q.kind !== 'module') continue;
      const p25 = moduleQuad(q.face, q.i, q.j, scene.layout).map((p) => ({ x: p.x * ppu, y: p.y * ppu }));
      const p3 = q.points2d.map(view.map);
      for (let k = 0; k < 4; k += 1) {
        worst = Math.max(worst, Math.abs(p25[k].x - p3[k].x), Math.abs(p25[k].y - p3[k].y));
      }
    }
    assert.ok(worst < 1e-9, `정면 자세에서 셀 꼭짓점이 어긋난다: ${worst} px`);
  });

  test('ⓗ 실제(정수) 상자에서도 서브픽셀 — 잔차는 캔버스 반올림뿐이다', () => {
    const ppu = 10;
    const { mesh, scene } = mesh3d('all');
    const W = Math.round(scene.width * ppu);
    const H = Math.round(scene.height * ppu);
    const view = paintQuads(stubCtx(W, H), mesh, {
      layout: scene.layout, fitScene: { width: scene.width, height: scene.height },
    });
    let worst = 0;
    for (const q of mesh.quads) {
      if (q.kind !== 'module') continue;
      const p25 = moduleQuad(q.face, q.i, q.j, scene.layout).map((p) => ({ x: p.x * ppu, y: p.y * ppu }));
      const p3 = q.points2d.map(view.map);
      for (let k = 0; k < 4; k += 1) {
        worst = Math.max(worst, Math.abs(p25[k].x - p3[k].x), Math.abs(p25[k].y - p3[k].y));
      }
    }
    assert.ok(worst < 0.5, `정수 상자에서 어긋남이 서브픽셀을 넘는다: ${worst} px`);
    // ⚠ **먼저 «옛 규칙이면 빨간가»**: 외접원 맞춤(fitViewStable)은 2배 넘게 갈렸다.
    const stable = paintQuads(stubCtx(W, H), mesh, { layout: scene.layout, pad: 48 });
    assert.ok(Math.abs(stable.scale / view.scale - 1) > 0.5,
      '지면 맞춤과 외접원 맞춤이 사실상 같은 스케일이다 — 이 자가 변이를 못 잡는다');
  });

  test('ⓘ 지면 맞춤 스케일은 **각도의 함수가 아니다** (회전해도 안 흔들린다)', () => {
    const poses = [
      { yaw: 0, pitch: 0, roll: 0 },
      { yaw: 0.4, pitch: 0.2, roll: 0 },
      { yaw: 1.1, pitch: -0.3, roll: 0.5 },
      { yaw: 2.5, pitch: 0.6, roll: -1.2, perspective: 0.6 },
    ];
    const scales = poses.map((pose) => {
      const { mesh, scene } = mesh3d('all', undefined, pose);
      const W = Math.round(scene.width * 10);
      const H = Math.round(scene.height * 10);
      return paintQuads(stubCtx(W, H), mesh, {
        layout: scene.layout, fitScene: { width: scene.width, height: scene.height },
      }).scale;
    });
    for (let i = 1; i < scales.length; i += 1) {
      assert.equal(scales[i], scales[0], `자세 ${i} 에서 스케일이 달라졌다: ${scales[i]}`);
    }
  });

  test('ⓙ 회전·원근 최대에서도 큐브가 지면 밖으로 안 나간다', () => {
    const { mesh, scene } = mesh3d('all', undefined, { yaw: 0.9, pitch: 0.7, roll: 0.4, perspective: 1 });
    const W = Math.round(scene.width * 10);
    const H = Math.round(scene.height * 10);
    const view = paintQuads(stubCtx(W, H), mesh, {
      layout: scene.layout, fitScene: { width: scene.width, height: scene.height },
    });
    for (const q of mesh.quads) {
      for (const p of q.points2d) {
        const m = view.map(p);
        assert.ok(m.x >= 0 && m.x <= W && m.y >= 0 && m.y <= H,
          `최대 왜곡에서 잘렸다: (${m.x.toFixed(1)}, ${m.y.toFixed(1)}) vs ${W}x${H}`);
      }
    }
  });

  test('ⓚ zoom 은 «기본이 파리티, 조작은 그 위» — 생략과 1 이 같고 단조롭다', () => {
    const rect = { width: 40, height: 60 };
    const a = fitViewScene(400, 600, rect);
    const b = fitViewScene(400, 600, { ...rect, zoom: 1 });
    assert.equal(a.scale, b.scale, 'zoom 생략과 zoom:1 이 다르다 — 기본이 파리티가 아니다');
    assert.ok(fitViewScene(400, 600, { ...rect, zoom: 4 }).scale > a.scale);
    assert.ok(fitViewScene(400, 600, { ...rect, zoom: 0.3 }).scale < a.scale);
    assert.throws(() => fitViewScene(400, 600, { ...rect, zoom: 0 }), RangeError);
    assert.throws(() => fitViewScene(400, 600, { width: 0, height: 10 }), RangeError);
  });

  test('ⓛ index.html: 정위치 여백 값이 **한 자리**에서만 나온다', () => {
    /*
     * 이 자가 대답하는 질문: 「정위치 버튼을 눌렀을 때 zoom 이 정확히 1 인가」.
     * 초기값·정위치·zoom 분모가 각자 숫자를 들면 하나만 바뀌어도 «정위치인데 크기가
     * 2.5D 와 다르다» 가 조용히 생긴다 — 값이 아니라 **출처가 하나** 임을 잰다.
     */
    assert.ok(/const Y3D_PAD_BASE = \d+;/.test(INDEX), 'Y3D_PAD_BASE 상수가 없다');
    assert.ok(INDEX.includes('pad: Y3D_PAD_BASE'), '초기값이 상수를 안 읽는다');
    assert.ok(INDEX.includes('y3dPreview.pad = Y3D_PAD_BASE'), '정위치 버튼이 상수를 안 읽는다');
    assert.ok(INDEX.includes('zoom: Y3D_PAD_BASE / y3dPreview.pad'), 'zoom 이 상수를 안 읽는다');
  });
});

describe('render3d-parity — 배경 · 코너 QR', () => {
  test('ⓜ 배경 «투명» 은 색이 아니라 «칠하지 않는다» 다', () => {
    const { mesh, scene } = mesh3d('all', BG_TRANSPARENT);
    assert.equal(scene.background, null, '2.5D 가 투명 배경을 null 로 안 낸다 — 전제가 바뀌었다');
    const W = Math.round(scene.width * 10);
    const H = Math.round(scene.height * 10);
    const fit = { width: scene.width, height: scene.height };
    const clear = stubCtx(W, H);
    paintQuads(clear, mesh, { background: { r: 14, g: 16, b: 24 }, transparent: true, layout: scene.layout, fitScene: fit });
    assert.equal(clear.fillRectCount, 0, '투명인데 배경을 칠했다');
    assert.equal(clear.clearRectCount, 1, '투명인데 지우지 않았다');
    const opaque = stubCtx(W, H);
    paintQuads(opaque, mesh, { background: { r: 14, g: 16, b: 24 }, transparent: false, layout: scene.layout, fitScene: fit });
    assert.equal(opaque.fillRectCount, 1, '불투명 경로가 배경을 안 칠했다 — 자가 축을 못 가른다');
  });

  test('ⓝ index.html: 투명 배경이 3D 에서 남색으로 폴백되지 않는다', () => {
    const body = paintY3dBody();
    assert.ok(body.includes('pal.background === null'),
      '3D 경로가 «투명» 갈래를 안 가른다 — null 이 폴백 색으로 칠해진다');
    assert.ok(body.includes("classList.toggle('checker'"),
      '3D 캔버스에 체커를 안 켠다 — 2.5D 는 켠다(drawScene)');
  });

  test('ⓞ 코너 QR 이 3D 지면의 **같은 자리**에 같은 색으로 온다', () => {
    const ppu = 10;
    const { mesh, scene } = mesh3d('all');
    const flat = scene.shapes.filter((s) => s.selfQuiet === true);
    assert.ok(flat.length > 1, '이 구성에 코너 QR 이 없다 — 자가 무의미해진다');
    const W = scene.width * ppu;
    const H = scene.height * ppu;
    const ctx = stubCtx(W, H);
    paintQuads(ctx, mesh, {
      layout: scene.layout, fitScene: { width: scene.width, height: scene.height },
      flatShapes: flat,
    });
    // 지면 도형은 **맨 마지막**에 그려진다 (QR 이 묻히면 안 된다).
    const drawnFlat = ctx.fills.slice(-flat.length);
    assert.equal(drawnFlat.length, flat.length, '지면 도형이 다 안 그려졌다');
    for (let i = 0; i < flat.length; i += 1) {
      const expect = flat[i].points.map((p) => [p.x * ppu, p.y * ppu]);
      const got = drawnFlat[i].pts;
      assert.equal(got.length, expect.length, `지면 도형 ${i} 의 점 수가 다르다`);
      for (let k = 0; k < expect.length; k += 1) {
        assert.ok(Math.abs(expect[k][0] - got[k][0]) < 1e-9
          && Math.abs(expect[k][1] - got[k][1]) < 1e-9,
        `지면 도형 ${i} 의 점 ${k} 가 2.5D 와 다른 자리다`);
      }
    }
  });

  test('ⓟ 지면 도형에 안전영역·음영이 섞여 들어오지 않는다 (selfQuiet 유도)', () => {
    /*
     * 안전영역 판·음영 띠는 **큐브 실루엣에서 유도된 껍질**이라 정위치에서만 맞는다.
     * 돌리면 그림자가 큐브에서 떨어져 나오므로 3D 에 안 얹는다 (레인 보고서 §5).
     * 그 배제가 «손 목록» 이 아니라 `selfQuiet` 태그의 성질임을 잰다.
     */
    const { scene } = mesh3d('all');
    const flat = scene.shapes.filter((s) => s.selfQuiet === true);
    const palette25 = new Set([rgb(BULLSEYE_LIGHT), rgb(BULLSEYE_DARK)]);
    for (const s of flat) {
      assert.ok(palette25.has(rgb(s.color)),
        `selfQuiet 도형에 QR 색이 아닌 것이 있다: ${rgb(s.color)} — 배제 축이 흔들렸다`);
    }
    // 셀 폴리곤은 절대 selfQuiet 이 아니다.
    const cellKeys = new Set();
    for (let j = 0; j < scene.n; j += 1) {
      for (let i = 0; i < scene.n; i += 1) {
        for (const f of YFACES) cellKeys.add(quadKey(moduleQuad(f, i, j, scene.layout)));
      }
    }
    for (const s of flat) {
      assert.equal(cellKeys.has(quadKey(s.points)), false, '셀 폴리곤이 지면 도형으로 샜다');
    }
  });

  test('ⓠ index.html: 코너 QR 선택이 손 목록이 아니라 selfQuiet 유도다', () => {
    const body = paintY3dBody();
    assert.ok(body.includes('selfQuiet === true'), '3D 가 코너 QR 을 안 가져간다');
    assert.ok(body.includes('flatShapes'), 'paintQuads 에 지면 도형을 안 넘긴다');
  });
});

describe('render3d-parity — 무회귀 (새 옵션을 안 주면 종전과 같다)', () => {
  test('ⓡ faceLevels·locatorFaceLevels 를 안 주면 mesh 가 종전 색 규약 그대로다', () => {
    const layout = layoutForCube(7, { size: 1, margin: 0.25 });
    const base = {
      n: 7, tones: 3, levels: PRESET.levels, layout, digitAt: (i, j) => (i + 2 * j) % 6,
    };
    const plain = buildOrbitMesh(base);
    // 세 면이 같은 표를 공유한다 = 종전(`levels` 하나) 과 완전히 같은 색.
    for (const q of plain.quads) {
      if (q.kind !== 'module') continue;
      assert.ok(PRESET.levels.some((l) => rgb(l) === rgb(q.color)),
        '옵션 없는 경로가 팔레트 밖 색을 냈다 — 종전과 달라졌다');
    }
    // 명시적으로 «세 면 같은 표» 를 줘도 결과가 같아야 한다 (배선이 색을 안 바꾼다).
    const explicit = buildOrbitMesh({
      ...base,
      faceLevels: { T: PRESET.levels, L: PRESET.levels, R: PRESET.levels },
    });
    assert.equal(JSON.stringify(explicit.quads.map((q) => q.color)),
      JSON.stringify(plain.quads.map((q) => q.color)),
      'faceLevels 배선 자체가 색을 바꿨다');
  });

  test('ⓢ fitScene·flatShapes 를 안 주면 종전 맞춤 경로를 그대로 탄다', () => {
    const layout = layoutForCube(7, { size: 1, margin: 0.25 });
    const mesh = buildOrbitMesh({
      n: 7, tones: 3, levels: PRESET.levels, layout, digitAt: (i, j) => (i + 2 * j) % 6,
    });
    const a = paintQuads(stubCtx(800, 800), mesh, { layout, pad: 24 });
    assert.ok(Number.isFinite(a.scale) && a.scale > 0, '안정 맞춤 경로를 안 탄다');
    // 각도를 바꿔도 같은 스케일 = fitViewStable 계약 (2026-08-26) 이 살아 있다.
    const rotated = buildOrbitMesh({
      n: 7, tones: 3, levels: PRESET.levels, layout, yaw: 0.7, pitch: 0.3,
      digitAt: (i, j) => (i + 2 * j) % 6,
    });
    const b = paintQuads(stubCtx(800, 800), rotated, { layout, pad: 24 });
    assert.equal(b.scale, a.scale, 'fitViewStable 계약이 깨졌다');
    // 지면 도형을 안 주면 fill 수가 quad 수와 같다 (군더더기 0).
    const ctx = stubCtx(800, 800);
    paintQuads(ctx, mesh, { layout, pad: 24 });
    assert.equal(ctx.fills.length, mesh.quads.length, '옵션 없이도 뭔가를 더 그렸다');
  });
});
