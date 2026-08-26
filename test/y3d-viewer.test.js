/**
 * y3d-viewer.test.js — Type Y 3D 뷰어 레이어 (레인 Y3DW)
 *
 * 실행: node --test test/y3d-viewer.test.js
 * 전체 스위트는 통합자가 돌린다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { moduleQuad, layoutForCube, YFACES } from '../src/ygrid.js';
import { encodeY } from '../src/encodeY.js';
import { encode } from '../src/encode.js';
import { buildSceneY } from '../src/sceneY.js';
import { buildScene } from '../src/scene.js';
import { sceneToSvg } from '../src/svg.js';
import { rasterize } from '../src/raster.js';
import { rasterToPng } from '../src/png.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { MODULE_ORDER } from '../tools/build-single.mjs';
import {
  cubePoint, isoProject, moduleCorners3d, orbitPoint, cubeCenter,
  buildOrbitMesh, meshToGltf, fitViewStable, hexOf, paintQuads,
} from '../src/y3d-viewer.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function palette() {
  const p = getPreset(DEFAULT_PRESET);
  return {
    background: p.background,
    levels: p.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function sceneFingerprint(scene) {
  return sha256(JSON.stringify({
    width: scene.width,
    height: scene.height,
    background: scene.background,
    locatorProfile: scene.locatorProfile || null,
    n: scene.n || null,
    shapes: scene.shapes,
  }));
}

function syntheticEncoded(n, tones = 3) {
  const cellDigits = new Map();
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      cellDigits.set(`${i},${j}`, { digit: (i + 2 * j) % 6, role: 'data' });
    }
  }
  return { n, cellDigits, tones };
}

describe('frozen isometric = ygrid.moduleQuad', () => {
  test('n=5 전 모듈 꼭짓점 4개가 점 단위로 같다', () => {
    const n = 5;
    const layout = layoutForCube(n, { size: 1, margin: 0.5 });
    for (const face of YFACES) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const fromGrid = moduleQuad(face, i, j, layout);
          const from3d = moduleCorners3d(face, i, j).map((p) =>
            isoProject(p.x, p.y, p.z, layout));
          assert.deepEqual(from3d, fromGrid, `${face}(${i},${j})`);
        }
      }
    }
  });

  test('orbit (0,0) 은 isoProject 와 같다', () => {
    const p = cubePoint('T', 2, 3);
    const c = cubeCenter(5);
    assert.deepEqual(orbitPoint(p, 0, 0, c), p);
  });
});

describe('scene · 포맷 무영향', () => {
  test('src/scene.js 가 HEAD 와 바이트 동일하다', () => {
    const disk = execFileSync('git', ['hash-object', 'src/scene.js'], {
      cwd: ROOT, encoding: 'utf8',
    }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD:src/scene.js'], {
      cwd: ROOT, encoding: 'utf8',
    }).trim();
    assert.equal(disk, head);
  });

  test('src/sceneY.js 가 HEAD 와 바이트 동일하다', () => {
    const disk = execFileSync('git', ['hash-object', 'src/sceneY.js'], {
      cwd: ROOT, encoding: 'utf8',
    }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD:src/sceneY.js'], {
      cwd: ROOT, encoding: 'utf8',
    }).trim();
    assert.equal(disk, head);
  });

  test('뷰어 모듈이 scene.js / sceneY.js / three 를 import 하지 않는다', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'y3d-viewer.js'), 'utf8');
    assert.equal(/from ['"][^'"]*scene(?:Y)?\.js['"]/.test(src), false);
    assert.equal(/from ['"][^'"]*three/.test(src), false);
  });

  test('뷰어를 돌린 뒤에도 PNG·SVG 가 바이트 동일하다', () => {
    const pal = palette();
    const exportOnce = () => {
      const encoded = encodeY('y3d-identity', { version: 0, eccLevel: 'M', tones: 3 });
      const scene = buildSceneY(encoded, {
        palette: pal, margin: 4, cellSize: 1, cornerQr: false,
      });
      const svg = sceneToSvg(scene);
      const png = rasterToPng(rasterize(scene, { pixelsPerUnit: 6, supersample: 1 }));
      return { svg, png: sha256(png), n: encoded.n, fp: sceneFingerprint(scene) };
    };

    const before = exportOnce();
    const encoded = syntheticEncoded(5, 3);
    const layout = layoutForCube(5, { size: 1, margin: 0.25 });
    const mesh = buildOrbitMesh({
      n: 5,
      tones: 3,
      levels: pal.levels,
      layout,
      yaw: 0.4,
      pitch: -0.25,
      digitAt: (i, j) => encoded.cellDigits.get(`${i},${j}`).digit,
    });
    assert.ok(mesh.quads.length >= 3 * 25);
    const gltf = meshToGltf(mesh);
    assert.equal(gltf.asset.version, '2.0');
    const after = exportOnce();
    assert.equal(after.svg, before.svg);
    assert.equal(after.png, before.png);
    assert.equal(after.fp, before.fp);
    assert.equal(after.n, 13);
  });
});

describe('scene 지문 스냅샷 (배선 전 기준선)', () => {
  // 레인 Y3DW 가 코드를 만지기 **전** 에 잰 값. 배선이 scene 을 한 바이트라도
  // 바꾸면 여기가 빨개진다. 명령: node lane-out/_y3dw-baseline.mjs (당시).
  const pal = palette();

  test('Y0 3톤 · Y0 2톤 · Y1 3톤 · O-v2 지문이 배선 전과 같다', () => {
    const y0_3 = encodeY('y3dw-identity', { version: 0, eccLevel: 'M', tones: 3 });
    const y0_3s = buildSceneY(y0_3, { palette: pal, margin: 4, cellSize: 1, cornerQr: false });
    assert.equal(sceneFingerprint(y0_3s),
      '0c33863e72896ec22a00f3dd6c61d4c089549b6610e9a67f49ee902a0e1340ed');
    assert.equal(sha256(sceneToSvg(y0_3s)),
      'b7954ca46715f06baf3343cc0946010ec270f349a31600b7f59feabea3a38f86');

    const y0_2 = encodeY('y3dw-identity', { version: 0, eccLevel: 'M', tones: 2 });
    const y0_2s = buildSceneY(y0_2, { palette: pal, margin: 4, cellSize: 1, cornerQr: false });
    assert.equal(sceneFingerprint(y0_2s),
      'f2c505e5238556d5a84986d95ff810f19dd48a97a0bf01719c053759c327a2c6');
    assert.equal(sha256(sceneToSvg(y0_2s)),
      '5fbb41f7bef122ca75a85161700d213bb0a3564d1043fc1f1d1d47f892bd375f');

    const y1_3 = encodeY('y3dw-identity', { version: 1, eccLevel: 'M', tones: 3 });
    const y1_3s = buildSceneY(y1_3, { palette: pal, margin: 4, cellSize: 1, cornerQr: false });
    assert.equal(sceneFingerprint(y1_3s),
      '79c3515c43ec962a75c793104fa06b613212d0befd33bd1b31c5590034bb2035');
    assert.equal(sha256(sceneToSvg(y1_3s)),
      'e711baeb799676d772893efcfae079efea6a3ae26600c1e11725c0e60dd71b12');

    const o = encode('y3dw-identity', { version: 2, eccLevel: 'M' });
    const os = buildScene(o, { palette: pal });
    assert.equal(sceneFingerprint(os),
      '3a1a7b04d93146de9e4a3132a6854842cdda59d08491dc6dd7b97bee5ac53f1c');
    assert.equal(sha256(sceneToSvg(os)),
      '5ad3509e2bc1579677eb00953dabe529add94131b149a6a44c7e5ebf660980ad');
  });
});

describe('생성기 배선 — 3D 는 opt-in, 기본은 2.5D', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  test('y3d-viewer 를 import 하고 MODULE_ORDER 에 있다', () => {
    assert.match(html, /from '\.\/src\/y3d-viewer\.js'/);
    assert.ok(MODULE_ORDER.includes('y3d-viewer'), 'MODULE_ORDER 에 y3d-viewer 가 없다');
    const iViewer = MODULE_ORDER.indexOf('y3d-viewer');
    assert.ok(MODULE_ORDER.indexOf('ygrid') < iViewer, 'ygrid 가 y3d-viewer 앞이어야 한다');
    assert.ok(MODULE_ORDER.indexOf('tonemap') < iViewer, 'tonemap 가 y3d-viewer 앞이어야 한다');
    assert.ok(MODULE_ORDER.indexOf('lehmer') < iViewer, 'lehmer 가 y3d-viewer 앞이어야 한다');
  });

  test('three.js / OrbitControls / glTF 문자열이 생성기에 없다', () => {
    assert.equal(html.includes('three.js'), false);
    assert.equal(/OrbitControls/.test(html), false);
    assert.equal(/glTF|GLTF/.test(html), false);
  });

  test('기본은 2.5D 이고 3D 캔버스는 꺼진 채 시작한다', () => {
    assert.match(html, /const y3dPreview = \{[\s\S]*?on:\s*false/);
    assert.match(html, /id="y3dMode25"[^>]*class="y3d-btn on"|class="y3d-btn on"[^>]*id="y3dMode25"/);
    assert.match(html, /<canvas id="view3d"/);
    assert.equal(/<canvas id="view3d"[^>]*\bon\b/.test(html), false);
    assert.match(html, /id="y3dBar"[^>]*hidden|hidden[^>]*id="y3dBar"/);
  });

  test('3D 토글은 schedule/encode 를 부르지 않는다', () => {
    const at = html.indexOf("els.y3dMode3d.addEventListener('click'");
    assert.ok(at > 0, '3D 토글 핸들러가 없다');
    const body = html.slice(at, at + 400);
    assert.equal(body.includes('schedule()'), false, '3D 켜기가 재인코드를 탄다');
    assert.equal(body.includes('encodeY'), false);
    assert.equal(body.includes('buildSceneY'), false);
  });

  test('drawScene 은 그대로 돌고, 3D 는 그 위 보기 층이다', () => {
    assert.match(html, /drawScene\(result\.scene, els\.canvas, 26\);/);
    assert.match(html, /paintY3dPreview\(\);/);
    const at = html.indexOf('function paintY3dPreview(');
    assert.ok(at > 0, 'paintY3dPreview 가 없다');
    const body = html.slice(at, html.indexOf('\n}\n', at));
    assert.equal(body.includes('buildSceneY'), false);
    assert.equal(body.includes('encodeY('), false);
    assert.equal(body.includes('buildScene('), false);
  });
});

describe('glTF 손짠 내보내기 (lab 전용 — 생성기 미배선)', () => {
  test('모듈 쿼드당 삼각형 2개, three 없이 JSON 이 나온다', () => {
    const n = 3;
    const layout = layoutForCube(n, { size: 1, margin: 0 });
    const mesh = buildOrbitMesh({
      n,
      tones: 3,
      levels: palette().levels,
      layout,
      yaw: 0,
      pitch: 0,
      digitAt: (i, j) => (i + j) % 6,
      includeBack: true,
    });
    const modules = mesh.quads.filter((q) => q.kind === 'module');
    assert.equal(modules.length, 3 * n * n);
    const backs = mesh.quads.filter((q) => q.kind === 'back');
    assert.equal(backs.length, 3);
    const gltf = meshToGltf(mesh);
    const json = JSON.stringify(gltf);
    assert.equal(gltf.accessors[2].count, modules.length * 6);
    assert.ok(gltf.buffers[0].uri.startsWith('data:application/octet-stream;base64,'));
    assert.equal(json.includes('three'), false);
    assert.ok(json.length > 1000);
  });
});

/*
 * ⭐ **화면에 실제로 무엇이 칠해지나** (2026-08-26 신설 — 운영자 신고 두 건의 자).
 *
 * 이 파일의 종전 단언들은 «3D 가 scene 을 안 건드린다»(무영향)와 «배선이 opt-in 이다»를
 * 쟀다. 둘 다 초록이었는데 **라이브 화면은 코드가 아예 안 보였다** — 데이터 없는
 * 뒷면(back)이 맨 위에 칠해져 단색 육각형만 남았고, 스위트 2571건이 그걸 못 봤다.
 *
 * 이유는 재는 대상이 달랐기 때문이다: 「scene 을 안 바꾼다」는 **안 한 일**의 단언이고,
 * 「코드가 보인다」는 **한 일**의 단언이다. 아래 셋이 후자를 잰다.
 */
describe('3D 가 실제로 코드를 그리는가 (운영자 신고 회귀)', () => {
  const preset = getPreset(DEFAULT_PRESET);
  const build = (yaw = 0, pitch = 0) => {
    const enc = encodeY('https://tl.estre.so', { version: 0, eccLevel: 'H', tones: 3 });
    const layout = layoutForCube(enc.n, { size: 1, margin: 0.25 });
    const mesh = buildOrbitMesh({
      n: enc.n, tones: 3, levels: preset.levels, layout, yaw, pitch,
      digitAt: (i, j) => {
        const e = enc.cellDigits.get(`${i},${j}`);
        return e ? e.digit : null;
      },
    });
    return { enc, layout, mesh };
  };

  test('뒷면은 데이터 면보다 **먼저** 칠해진다 — 배열 순서가 곧 칠하기 순서다', () => {
    const { mesh } = build();
    const lastBack = mesh.quads.map((q) => q.kind).lastIndexOf('back');
    const firstModule = mesh.quads.findIndex((q) => q.kind === 'module');
    assert.ok(mesh.quads.some((q) => q.kind === 'back'), '뒷면이 아예 없다 — 자가 무의미해진다');
    assert.ok(
      lastBack < firstModule,
      `뒷면이 데이터 면 뒤에 칠해진다 (마지막 back=${lastBack}, 첫 module=${firstModule}) `
      + '— 화가 알고리즘은 **먼 것부터**다. 라이브에서 코드가 통째로 덮인다.',
    );
  });

  test('데이터 면 색은 전부 팔레트 레벨이다 — 뒷면 색이 새어 나오지 않는다', () => {
    const { mesh } = build();
    const allowed = new Set(preset.levels.map(hexOf));
    const mods = mesh.quads.filter((q) => q.kind === 'module');
    assert.ok(mods.length > 100, `데이터 면이 너무 적다: ${mods.length}`);
    const bad = mods.filter((q) => !allowed.has(hexOf(q.color)));
    assert.equal(bad.length, 0,
      `팔레트 밖 색이 데이터 면에 있다: ${[...new Set(bad.map((q) => hexOf(q.color)))].join(' ')}`);
    // 세 레벨이 **전부** 등장해야 한다. 하나로 뭉개지면 순위가 안 보인다.
    const used = new Set(mods.map((q) => hexOf(q.color)));
    assert.equal(used.size, 3, `쓰인 레벨이 3종이 아니다: ${[...used].join(' ')}`);
  });

  test('회전해도 스케일이 안 변한다 — fitViewStable (운영자 신고 「크기 보존 안 됨」)', () => {
    const angles = [[0, 0], [0.4, 0.2], [1.1, -0.3], [2.5, 0.6], [-1.7, 1.2]];
    const scales = angles.map(([y, p]) => {
      const { mesh, layout } = build(y, p);
      return fitViewStable(mesh, 800, 800, 24, layout).scale;
    });
    for (let i = 1; i < scales.length; i += 1) {
      assert.equal(scales[i], scales[0],
        `각도마다 스케일이 다르다 (${angles[i]} → ${scales[i]} vs ${scales[0]}) `
        + '— 돌릴 때마다 크기가 변한다.');
    }
    // radius3d 도 회전 불변이어야 한다 (회전은 거리를 보존한다).
    const radii = angles.map(([y, p]) => build(y, p).mesh.radius3d);
    for (const r of radii) assert.ok(Math.abs(r - radii[0]) < 1e-9, '반지름이 회전에 변한다');
  });

  /*
   * ⚠ 위 테스트만으로는 부족하다 — `fitViewStable` 을 **직접** 부르므로
   *   `paintQuads` 가 실제로 그 경로를 타는지는 안 잰다. 실제로 배선을 되돌리는
   *   변이를 넣어 봤더니 16/16 이 그대로 초록이었다. 그래서 **끝단**을 잰다.
   */
  /*
   * ⭐ **파인더(로케이터) 칸도 그려야 한다** (2026-08-26 운영자 신고
   *   「데이터 부분만 셀 출력이 되고 파인더 영역은 구멍이 뚫린다」).
   *
   * 셀 표면 로케이터를 켜면 그 칸은 `digit: null` + `tones: {T,L,R}` 다.
   * digit 만 보면 건너뛰어 **구멍**이 되고, 2.5D 는 tones 를 읽어 꽉 찬다.
   * 두 렌더가 갈렸던 자리다.
   */
  test('로케이터 칸이 구멍이 되지 않는다 — digit 없어도 tones 로 그린다', async () => {
    const { CELL_SURFACE_FINAL_V0 } = await import('../src/cellSurfaceFinal.js');
    const enc = encodeY('https://tl.estre.so', {
      version: 0, eccLevel: 'H', tones: 3,
      cellSurface: true, cellSurfaceLayout: CELL_SURFACE_FINAL_V0,
    });
    const locators = [...enc.cellDigits.entries()].filter(([, v]) => v.role === 'locator');
    assert.ok(locators.length > 0, '이 구성에 로케이터 칸이 없다 — 자가 무의미해진다');
    // ⚠ **먼저 「잴 게 있나」**: 로케이터 칸이 정말 digit 없이 tones 만 드는가.
    assert.ok(locators.every(([, v]) => v.digit === null || v.digit === undefined),
      '로케이터가 digit 을 든다 — 이 회귀의 전제가 바뀌었다');
    assert.ok(locators.every(([, v]) => v.tones), '로케이터가 tones 를 안 든다');

    const layout = layoutForCube(enc.n, { size: 1, margin: 0.25 });
    const mesh = buildOrbitMesh({
      n: enc.n, tones: 3, levels: preset.levels, layout, yaw: 0, pitch: 0,
      digitAt: (i, j) => {
        const e = enc.cellDigits.get(`${i},${j}`);
        return e ? e.digit : null;
      },
      levelAt: (i, j, face) => {
        const e = enc.cellDigits.get(`${i},${j}`);
        const lv = e && e.tones ? e.tones[face] : null;
        return Number.isInteger(lv) ? lv : null;
      },
    });
    // 전 칸 × 3면이 다 그려져야 한다 — 로케이터를 건너뛰면 이 수가 모자란다.
    const mods = mesh.quads.filter((q) => q.kind === 'module');
    assert.equal(mods.length, enc.n * enc.n * 3,
      `데이터 면 수가 모자란다 (${mods.length} vs ${enc.n * enc.n * 3}) `
      + `— 로케이터 ${locators.length}칸이 구멍이 됐을 수 있다.`);
    // 그 칸들의 색도 팔레트 안이어야 한다 (뒷면 색이 새면 안 된다).
    const allowed = new Set(preset.levels.map(hexOf));
    assert.ok(mods.every((q) => allowed.has(hexOf(q.color))), '팔레트 밖 색이 있다');
  });

  test('paintQuads 가 그 안정 경로를 실제로 탄다 — 가짜 ctx 로 끝단 측정', () => {
    const stub = () => {
      const canvas = { width: 800, height: 800 };
      return {
        canvas,
        fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
        fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        fill() {}, stroke() {}, fillText() {},
      };
    };
    const angles = [[0, 0], [0.4, 0.2], [1.1, -0.3], [2.5, 0.6]];
    const scales = angles.map(([y, p]) => {
      const { mesh, layout } = build(y, p);
      return paintQuads(stub(), mesh, { layout, pad: 24 }).scale;
    });
    // ⚠ **먼저 «값이 있나» 를 재라.** 구 `fitView` 는 `scale` 을 반환하지 않아서,
    //    배선이 그쪽으로 되돌아가면 undefined === undefined 로 **조용히 통과**한다.
    //    실제로 그 변이를 넣었을 때 17/17 이 그대로 초록이었다 (2026-08-26).
    for (const sc of scales) {
      assert.ok(Number.isFinite(sc) && sc > 0,
        `paintQuads 가 scale 을 안 낸다 (${sc}) — 안정 경로를 안 타고 있다.`);
    }
    for (let i = 1; i < scales.length; i += 1) {
      assert.equal(scales[i], scales[0],
        `paintQuads 가 각도마다 다른 스케일을 낸다 (${angles[i]} → ${scales[i]} vs ${scales[0]}) `
        + '— 안정 경로(fitViewStable)로 안 가고 있다.');
    }
  });
});
