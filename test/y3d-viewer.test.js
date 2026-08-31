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
  buildOrbitMesh, meshToGltf, fitViewStable, hexOf, paintQuads, hitTest,
  projectPoint, perspectiveInvDist, BETA_MAX, fitView,
} from '../src/y3d-viewer.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** 리뷰 회귀 자들이 쓰는 생성기 소스 (읽기 1회). */
const INDEX = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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
    // ⚠ **의도적 확장 (2026-08-31, V1~V4)**: yaw/pitch 만 흔들면 새 축(원근·roll·6면)이
    //    내보내기로 새는 경로를 안 잰다. 「내보내는 PNG·SVG 는 항상 2.5D」는 뷰 상태
    //    **전부**에 대한 계약이므로, 뷰어를 극단 상태로 돌린 뒤에도 같은 바이트여야 한다.
    let mesh = null;
    for (const view of [
      { yaw: 0.4, pitch: -0.25 },
      { yaw: 0.4, pitch: -0.25, perspective: 1, roll: 1.3, faces: 6 },
      { yaw: -2.2, pitch: 1.1, perspective: 0.5, roll: -0.7, faces: 6 },
    ]) {
      mesh = buildOrbitMesh({
        n: 5,
        tones: 3,
        levels: pal.levels,
        layout,
        digitAt: (i, j) => encoded.cellDigits.get(`${i},${j}`).digit,
        ...view,
      });
      assert.ok(mesh.quads.length >= 3 * 25);
    }
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

  /*
   * ⭐ **UI 축을 덮는 자** (2026-08-31, V1~V4 편입).
   *
   * 모듈 자들은 `buildOrbitMesh` 를 **직접** 부르므로, 생성기가 새 옵션을 안 넘기면
   * 전부 초록인 채로 화면에서는 「켰는데 안 먹는」 상태가 된다. 그 배선을 여기서 잰다.
   */
  test('새 보기 컨트롤이 3D 행과 같은 규약으로 붙어 있다 (기본은 꺼짐)', () => {
    for (const id of ['y3dViewRow', 'y3dSnapRow']) {
      assert.match(html, new RegExp(`id="${id}"[^>]*hidden`), `${id} 가 기본 hidden 이 아니다`);
      assert.match(html, new RegExp(`els\\.${id}\\.hidden = !isY \\|\\| !y3dPreview\\.on;`),
        `${id} 가 3D 토글과 같은 조건으로 안 열린다`);
    }
    for (const id of ['y3dPersp', 'y3dFaces3', 'y3dFaces6', 'y3dSnapSave', 'y3dSnapCopy']) {
      assert.match(html, new RegExp(`id="${id}"`), `${id} 컨트롤이 없다`);
    }
    // 3면이 기본으로 켜져 있어야 픽셀 동일 계약의 «시작 상태» 절반이 성립한다.
    assert.match(html, /id="y3dFaces3"[^>]*class="y3d-btn on"|class="y3d-btn on"[^>]*id="y3dFaces3"/);
    assert.match(html, /id="y3dPersp"[^>]*value="0"/);
  });

  test('시작 상태가 중립이다 — roll 0 · 원근 0 · 3면 (픽셀 동일 계약의 절반)', () => {
    const at = html.indexOf('const y3dPreview = {');
    assert.ok(at > 0);
    const body = html.slice(at, html.indexOf('\n};', at));
    assert.match(body, /\broll:\s*0\b/, 'roll 기본값이 0 이 아니다');
    assert.match(body, /\bpersp:\s*0\b/, '원근 기본값이 0 이 아니다');
    assert.match(body, /\bfaces:\s*3\b/, '면 수 기본값이 3 이 아니다');
  });

  test('생성기가 roll·원근·면 수를 **실제로 넘긴다** — 안 넘기면 모듈 자가 다 초록인 채 UI 만 죽는다', () => {
    const at = html.indexOf('y3dPreview.mesh = buildOrbitMesh({');
    assert.ok(at > 0, 'buildOrbitMesh 호출을 못 찾았다');
    const call = html.slice(at, html.indexOf('});', at));
    assert.match(call, /roll:\s*y3dPreview\.roll/, 'roll 을 안 넘긴다');
    assert.match(call, /perspective:\s*y3dPreview\.persp\s*\/\s*100/, '원근 노브를 안 넘긴다');
    assert.match(call, /faces:\s*y3dPreview\.faces/, '면 수를 안 넘긴다');
  });

  test('정위치 버튼이 roll·원근도 되돌린다 — 안 그러면 g884 라벨이 거짓이 된다', () => {
    const at = html.indexOf("els.y3dReset.addEventListener('click'");
    assert.ok(at > 0);
    const body = html.slice(at, html.indexOf('});', at));
    for (const line of ['y3dPreview.yaw = 0', 'y3dPreview.pitch = 0',
      'y3dPreview.roll = 0', 'y3dPreview.persp = 0']) {
      assert.ok(body.includes(line), `리셋이 ${line} 을 안 한다`);
    }
  });

  test('Shift+휠이 deltaX 도 읽는다 — 브라우저가 Shift+휠을 가로 스크롤로 준다', () => {
    // Chrome·Edge·Firefox 는 Shift+휠을 deltaY=0, deltaX=± 로 리매핑한다.
    // deltaY 만 읽으면 roll 이 **아무 일도 안 하는데** 에러도 안 난다.
    const at = html.indexOf("els.view3d.addEventListener('wheel'");
    assert.ok(at > 0, '휠 핸들러가 없다');
    const body = html.slice(at, html.indexOf('{ passive: false }', at));
    assert.match(body, /ev\.deltaY \|\| ev\.deltaX/, 'Shift+휠의 deltaX 를 안 읽는다');
    assert.match(body, /ev\.shiftKey/, 'Shift 분기가 없다');
    assert.match(body, /ev\.preventDefault\(\)/, 'preventDefault 가 빠지면 페이지가 가로로 스크롤된다');
  });

  test('roll 드래그 축은 pointerdown 에서 래치되고, 그때 hitTest 를 건너뛴다', () => {
    const at = html.indexOf("els.view3d.addEventListener('pointerdown'");
    assert.ok(at > 0);
    const body = html.slice(at, html.indexOf("els.view3d.addEventListener('pointermove'", at));
    assert.match(body, /y3dPreview\.dragMode = ev\.shiftKey \? 'roll' : 'orbit'/,
      '드래그 축을 pointerdown 에서 안 래치한다 — 도중에 Shift 를 떼면 큐브가 튄다');
    const latchAt = body.indexOf("dragMode = ev.shiftKey");
    const hitAt = body.indexOf('hitTest(');
    assert.ok(latchAt >= 0 && hitAt > latchAt, 'hitTest 가 래치보다 앞에 있다');
    assert.match(body.slice(latchAt, hitAt), /return;/,
      'roll 분기에서 안 빠져나간다 — Shift+클릭이 digit 까지 바꾼다');
  });

  test('🔴 스냅샷은 **코드 내보내기 경로를 타지 않는다** (불변 계약)', () => {
    const at = html.indexOf('function y3dSnapshotBlob(');
    assert.ok(at > 0, '스냅샷 함수가 없다');
    const end = html.indexOf("els.y3dMode25.addEventListener('click'");
    assert.ok(end > at);
    const body = html.slice(at, end);
    for (const forbidden of ['exportPlanFor', 'renderExportPng', 'renderExportSvg',
      'sceneToSvg', 'buildSceneY', 'buildScene(', 'encodeY(']) {
      assert.equal(body.includes(forbidden), false,
        `스냅샷이 ${forbidden} 을 탄다 — 뷰 상태가 코드 내보내기로 샌다`);
    }
    // 제품 export 퍼널도 오염시키지 않는다 (지표가 조용히 부풀어 오른다).
    // ⚠ **호출 형태**로 잰다 — 이름만 보면 「안 부른다」고 적어 둔 주석이 자기 자신에
    //    걸린다 (실제로 처음 돌렸을 때 그렇게 빨개졌다).
    assert.equal(body.includes('emitProductExport('), false,
      '스냅샷이 emitProductExport 를 부른다 — export 지표에 뷰 스냅샷이 섞인다');
    // 그리고 파일명이 «코드» 가 아니라 «뷰» 라고 말해야 한다.
    assert.match(body, /type:\s*'Y-view'/);
    assert.match(body, /version:\s*'snapshot'/);
    // 클립보드 실패는 **조용히** 넘어가면 안 된다 — 문구 + 다운로드 폴백.
    const copyAt = html.indexOf("els.y3dSnapCopy.addEventListener('click'");
    assert.ok(copyAt > 0, '스냅샷 복사 핸들러가 없다');
    const copyBody = html.slice(copyAt, html.indexOf('\n});', copyAt));
    assert.match(copyBody, /tf\('g430'/, '복사 실패 문구가 없다');
    assert.match(copyBody, /y3dSnapshotDownload\(\)/, '복사 실패 시 다운로드 폴백이 없다');
    // Safari 제스처 만료 — ClipboardItem 에 **프로미스**를 넘겨야 한다.
    assert.match(copyBody, /'image\/png':\s*y3dSnapshotBlob\(\)/,
      'await 한 Blob 을 넘기면 Safari 에서 사용자 제스처를 잃는다');
  });

  test('도움말 g886 이 8언어 모두 새 조작을 안내하고 2.5D 계약을 유지한다', () => {
    // 「휠로 여백을 조절합니다」만 말하던 본문은 Shift+휠 roll 이 붙는 순간 거짓이 된다.
    // 언어 중립 토큰만 잰다 — 산문을 옮겨 적으면 다음 번역 손질까지만 산다.
    const start = html.indexOf('const GENERATOR_STRINGS = {');
    const js = html.slice(start, html.indexOf('\n};', start));
    const values = [...js.matchAll(/"g886":\s*("(?:\\.|[^"])*")/g)].map((m) => JSON.parse(m[1]));
    assert.equal(values.length, 8, `g886 이 8언어에 없다 (${values.length})`);
    // ⚠ 토큰은 **언어 중립**인 것만 고른다. 「Shift」의 번역어 목록(Maiusc·Umschalt·
    //    Mayús…)을 여기 적으면 언어가 늘 때마다 이 자가 먼저 늙는다.
    for (const v of values) {
      assert.ok(v.includes('2.5D'), '2.5D 계약 문구가 빠졌다 (AGENTS §7 — 기술 용어 유지)');
      assert.ok(v.includes('[') && v.includes(']'), 'roll 키([ ]) 안내가 없다');
      assert.ok(v.includes('Z'), 'Z축 회전(roll) 안내가 없다');
      assert.ok(v.includes('0–5'), 'digit 단축키 안내가 사라졌다');
      assert.ok(v.includes('PNG'), '스냅샷 PNG 안내가 없다');
    }
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

  /*
   * ⚠ 위 자는 **정위치에서만** 옳다. `kind`(back/module) 는 «칠하는 순서» 의 판단 축이
   * 아니다 — 180° 돌리면 뒷면이 앞으로 와야 맞다. 진짜 축은 **면이 어느 쪽을 보는가**다.
   *
   * 운영자 신고 (2026-08-26): 「특정 각도 넘어가면 셀이 투명해진다」.
   * 원인은 대표점 오차였다. 뒷면은 n×n 을 통째로 덮는 **큰 사각 한 장**이라 depth 가
   * «중심 한 점» 이고, 앞면 셀은 작아서 제 자리의 depth 를 갖는다. n=13 에서 뒷면 26 vs
   * 앞면 먼 구석 셀 25 — **여유가 1** 이라 조금만 돌리면 구석 셀이 «더 멀다» 로 밀리고
   * 뒤이어 칠해진 뒷면이 그 위를 덮었다.
   * 실측(격자 133점): 118점에서 최대 143칸. pitch ±10° 만으로 이미 6~10칸이었다.
   */
  test('돌려도 셀이 안 묻힌다 — 등진 면이 **전부** 마주 본 면보다 먼저 칠해진다', () => {
    const angles = [];
    for (let yawDeg = 0; yawDeg <= 180; yawDeg += 15) {
      for (let pitchDeg = -60; pitchDeg <= 60; pitchDeg += 15) angles.push([yawDeg, pitchDeg]);
    }
    const DEG = Math.PI / 180;
    let sawDepthInversion = false;
    for (const [yawDeg, pitchDeg] of angles) {
      const { mesh } = build(yawDeg * DEG, pitchDeg * DEG);
      const fronts = mesh.quads.filter((q) => q.facing < 0);
      const backs = mesh.quads.filter((q) => !(q.facing < 0));
      // ⚠ 먼저 «값이 있나» — 한 무리가 비면 아래 순서 단언이 공짜로 통과한다.
      assert.ok(fronts.length > 0 && backs.length > 0,
        `facing 이 두 무리를 못 만든다 (yaw=${yawDeg} pitch=${pitchDeg}, `
        + `front=${fronts.length} back=${backs.length}) — 자가 잠들었다.`);
      const firstFront = mesh.quads.findIndex((q) => q.facing < 0);
      const lastBack = mesh.quads.map((q) => !(q.facing < 0)).lastIndexOf(true);
      assert.ok(lastBack < firstFront,
        `등진 면이 마주 본 면 뒤에 칠해진다 (yaw=${yawDeg} pitch=${pitchDeg}, `
        + `마지막 등진=${lastBack}, 첫 마주=${firstFront}) — 그 자리에 구멍이 뚫린다.`);
      // depth 만으로 정렬했으면 실제로 뒤집혔을 각도가 이 격자에 **있어야** 한다.
      // 없으면 이 자는 안 나는 사고를 지키는 셈이라, 다음 사람이 지워도 안 잡힌다.
      const nearestHiddenBack = Math.min(...backs.map((q) => q.depth));
      if (fronts.some((q) => q.kind === 'module' && q.depth > nearestHiddenBack)) {
        sawDepthInversion = true;
      }
    }
    assert.ok(sawDepthInversion,
      'depth 역전이 이 격자에서 한 번도 안 났다 — 이 자가 지키는 사고가 재현되지 않는다. '
      + '각도 격자를 넓히거나, 원인이 바뀐 것인지 확인하라.');
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

/*
 * ⭐ **보기 층 확장 — V1 원근 · V3 6면 · V4 roll** (PM/031 §2)
 *
 * 재는 것은 «성질» 이지 값이 아니다. 특히 「원근 0 · roll 0 · 3면에서 픽셀 동일」은
 * 스냅샷 해시가 아니라 **오라클 대조**(`isoProject`)로 잰다 — 해시는 layout 이 바뀌면
 * 이유를 못 말한 채 빨개지고, 옮겨 적은 값은 다음 리팩터링까지만 산다.
 */
const Y3D_PRESET = getPreset(DEFAULT_PRESET);

function ext(opts) {
  const n = 7;
  const layout = layoutForCube(n, { size: 1, margin: 0.25 });
  const mesh = buildOrbitMesh({
    n,
    tones: 3,
    levels: Y3D_PRESET.levels,
    layout,
    digitAt: (i, j) => (i + 2 * j) % 6,
    includeBack: true,
    ...opts,
  });
  return { n, layout, mesh };
}

const quadKey = (q) => `${q.kind}:${q.face}:${q.i}:${q.j}:${q.side}`;

/** 감기 법선 · (quad중심 − 큐브중심) 의 부호. 고유회전은 보존, 거울은 뒤집는다. */
function windingSign(corners, center) {
  const [p0, p1, , p3] = corners;
  const ux = p1.x - p0.x; const uy = p1.y - p0.y; const uz = p1.z - p0.z;
  const vx = p3.x - p0.x; const vy = p3.y - p0.y; const vz = p3.z - p0.z;
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
  let cx = 0; let cy = 0; let cz = 0;
  for (const p of corners) { cx += p.x; cy += p.y; cz += p.z; }
  cx = cx / 4 - center.x; cy = cy / 4 - center.y; cz = cz / 4 - center.z;
  return Math.sign(nx * cx + ny * cy + nz * cz);
}

describe('V1 원근 — d=∞ 가 현행과 픽셀 동일, 키우면 가까운 것이 커진다', () => {
  test('기본 상태에서 points2d 는 isoProject 와 **바이트 동일**하다 (오라클 대조)', () => {
    // 「d=∞ 는 평행투영과 같다」를 부동소수 운이 아니라 **분기 구조**로 잰다.
    // 회전을 얹은 상태에서도 성립해야 한다 — 투시 나눗셈은 회전 «후» 이므로.
    for (const [yaw, pitch] of [[0, 0], [0.4, -0.25], [2.1, 0.9]]) {
      const { layout, mesh } = ext({ yaw, pitch });
      assert.equal(mesh.invDist, 0, 'invDist 기본값이 0 이 아니다');
      assert.equal(mesh.roll, 0, 'roll 기본값이 0 이 아니다');
      assert.equal(mesh.faces, 3, 'faces 기본값이 3 이 아니다');
      assert.ok(mesh.quads.length > 0);
      for (const q of mesh.quads) {
        q.corners3d.forEach((p, k) => {
          const o = isoProject(p.x, p.y, p.z, layout);
          assert.equal(q.points2d[k].x, o.x, `${quadKey(q)} x 가 isoProject 와 다르다`);
          assert.equal(q.points2d[k].y, o.y, `${quadKey(q)} y 가 isoProject 와 다르다`);
        });
      }
    }
  });

  test('중립값을 **명시해도** 아무것도 안 바뀐다 — 옵션 추가가 기본 경로를 안 건드린다', () => {
    const a = ext({ yaw: 0.4, pitch: -0.25 }).mesh;
    const b = ext({
      yaw: 0.4, pitch: -0.25, roll: 0, perspective: 0, faces: 3,
    }).mesh;
    assert.deepEqual(b.quads, a.quads);
  });

  test('원근을 키우면 가까운 정점이 더 크게 사영된다 (단조)', () => {
    const { n, layout } = ext({});
    const center = cubeCenter(n);
    const C = isoProject(center.x, center.y, center.z, layout);
    const radius3d = (n / 2) * Math.sqrt(3);
    // ⚠ (0,0,0)·(n,n,n) 은 **투영의 커널 위**라 둘 다 반경 0 이다 — 자가 잠든다.
    //    ⊥ 성분은 같고 깊이만 반대인 두 점을 쓴다.
    const h = n / 2;
    const near = { x: h + 1 - h / 2, y: h - 1 - h / 2, z: h - h / 2 };
    const far = { x: h + 1 + h / 2, y: h - 1 + h / 2, z: h + h / 2 };
    const radiusOf = (p, e) => {
      const P = projectPoint(p, layout, center, e, C);
      return Math.hypot(P.x - C.x, P.y - C.y);
    };
    const r0n = radiusOf(near, 0);
    const r0f = radiusOf(far, 0);
    assert.ok(r0n > 0 && Math.abs(r0n - r0f) < 1e-12,
      `평행투영에서 두 점의 반경이 달라서는 안 된다 (${r0n} vs ${r0f}) — 자의 전제가 깨졌다`);
    let prevN = r0n;
    let prevF = r0f;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const e = perspectiveInvDist(t, radius3d);
      const rn = radiusOf(near, e);
      const rf = radiusOf(far, e);
      assert.ok(rn > prevN, `t=${t.toFixed(2)}: 가까운 점이 안 커진다 (${rn} ≤ ${prevN})`);
      assert.ok(rf < prevF, `t=${t.toFixed(2)}: 먼 점이 안 작아진다 (${rf} ≥ ${prevF})`);
      prevN = rn;
      prevF = rf;
    }
  });

  test('안팎이 안 뒤집힌다 — 근점 배율 > 1 > 원점 배율', () => {
    // 부호를 뒤집어 `1/(1−e·Δw)` 로 쓰면 근점이 작아져 «속이 파인 가면» 이 된다.
    const { n, layout } = ext({});
    const center = cubeCenter(n);
    const C = isoProject(center.x, center.y, center.z, layout);
    const e = perspectiveInvDist(0.6, (n / 2) * Math.sqrt(3));
    // ⊥ 성분이 같고 깊이만 다른 두 점의 «반경 비» 가 곧 배율이다.
    const h = n / 2;
    const off = { x: 1, y: -1, z: 0 };
    const at = (depth) => ({
      x: h + off.x + depth, y: h + off.y + depth, z: h + off.z + depth,
    });
    const base = Math.hypot(
      projectPoint(at(0), layout, center, 0, C).x - C.x,
      projectPoint(at(0), layout, center, 0, C).y - C.y,
    );
    const scaleAt = (depth) => Math.hypot(
      projectPoint(at(depth), layout, center, e, C).x - C.x,
      projectPoint(at(depth), layout, center, e, C).y - C.y,
    ) / base;
    const sNear = scaleAt(-h);
    const sFar = scaleAt(h);
    assert.ok(sNear > 1, `근점 배율이 1 이하다 (${sNear}) — 원근 부호가 뒤집혔다`);
    assert.ok(sFar < 1, `원점 배율이 1 이상이다 (${sFar}) — 원근 부호가 뒤집혔다`);
  });

  test('β 는 항상 클램프 안이다 — 음수·과대 입력이 특이점을 못 만든다', () => {
    const { n } = ext({});
    const radius3d = (n / 2) * Math.sqrt(3);
    for (const bad of [-1, -1e-9, 10, Infinity, NaN, undefined]) {
      const m = ext({ invDist: bad }).mesh;
      assert.ok(m.invDist >= 0, `invDist 가 음수다 (${bad} → ${m.invDist})`);
      assert.ok(m.invDist * radius3d <= BETA_MAX + 1e-12,
        `β 가 상한을 넘었다 (${bad} → ${m.invDist * radius3d})`);
      assert.ok(m.quads.every((q) => q.points2d.every((p) =>
        Number.isFinite(p.x) && Number.isFinite(p.y))), `${bad}: 유한하지 않은 정점이 나왔다`);
    }
    assert.equal(perspectiveInvDist(0, radius3d), 0, 't=0 이 정확히 0 이어야 한다');
    assert.equal(ext({ perspective: 0 }).mesh.invDist, 0);
  });

  test('원근 ON 에서도 fitViewStable 이 회전 불변이고, 맞춤 반경이 1/cos α 로 넓어진다', () => {
    const { n, layout } = ext({});
    const radius3d = (n / 2) * Math.sqrt(3);
    const poses = [[0, 0, 0], [0.4, 0.2, 0], [1.1, -0.3, 0.7], [2.5, 0.6, -1.4], [-1.7, 1.2, 3.0]];
    const scaleFor = (t) => poses.map(([yaw, pitch, roll]) => fitViewStable(
      ext({ yaw, pitch, roll, invDist: perspectiveInvDist(t, radius3d) }).mesh,
      800, 800, 24, layout,
    ).scale);
    let s0 = null;
    for (const t of [0, 0.35, 0.7, 1]) {
      const s = scaleFor(t);
      for (const v of s) assert.ok(Number.isFinite(v) && v > 0, `t=${t}: scale 이 없다 (${v})`);
      for (let i = 1; i < s.length; i += 1) {
        assert.equal(s[i], s[0],
          `t=${t}: 자세 ${poses[i]} 에서 스케일이 다르다 (${s[i]} vs ${s[0]}) — 회전 불변이 깨졌다`);
      }
      if (t === 0) s0 = s[0];
      if (t === 1) {
        // α=60° ⇒ 실루엣 반지름이 1/cos 60° = 정확히 2배 ⇒ 스케일은 절반.
        assert.ok(Math.abs(s[0] / s0 - 0.5) < 1e-9,
          `α=60° 스케일 비가 0.5 가 아니다 (${s[0] / s0}) — 1/√(1−β²) 보정이 안 걸렸다`);
      }
      if (t > 0) assert.ok(s[0] < s0, `t=${t}: 원근을 켰는데 맞춤이 안 좁아졌다`);
    }
  });

  test('원근이 켜졌는데 layout 이 없으면 paintQuads 가 **던진다** (조용한 bbox 폴백 금지)', () => {
    // bbox 폴백은 원근·회전에 따라 크기가 변해서 슬라이더를 움직일 때마다 그림이
    // 펌프질한다 — `fitViewStable` 을 만든 이유와 **같은 증상**이라 조용히 떨어지면
    // 안 된다. 원근을 끈 mesh 는 종전대로 폴백을 탄다 (기존 호출 계약 유지).
    const on = ext({ perspective: 0.5 }).mesh;
    assert.ok(on.invDist > 0, '원근이 안 켜졌다 — 자가 잠들었다');
    assert.throws(() => paintQuads(miniCtx(64, 64), on, { pad: 8 }), RangeError);
    const off = ext({}).mesh;
    assert.doesNotThrow(() => paintQuads(miniCtx(64, 64), off, { pad: 8 }));
  });
});

describe('V4 roll — 깊이·정렬에 불변, θ 와 −θ 가 역, 2π 가 항등', () => {
  test('roll θ 와 −θ 가 서로의 역이고 2π 는 항등이다', () => {
    const c = cubeCenter(7);
    const pts = [cubePoint('T', 2, 3), cubePoint('L', 0, 4), cubePoint('R', 5, 1)];
    for (const p of pts) {
      for (const th of [0.3, 1.0, Math.PI, -2.2]) {
        const a = orbitPoint(p, 0, 0, c, th);
        const back = orbitPoint(a, 0, 0, c, -th);
        for (const k of ['x', 'y', 'z']) {
          assert.ok(Math.abs(back[k] - p[k]) < 1e-12,
            `roll ${th} → −${th} 이 항등이 아니다 (${k}: ${back[k]} vs ${p[k]})`);
        }
      }
      const twoPi = orbitPoint(p, 0, 0, c, 2 * Math.PI);
      for (const k of ['x', 'y', 'z']) {
        assert.ok(Math.abs(twoPi[k] - p[k]) < 1e-12, `roll 2π 가 항등이 아니다 (${k})`);
      }
    }
  });

  test('roll=0 은 **바이트 동일**이다 — 인자를 더해도 기존 3인자 경로가 안 변한다', () => {
    const c = cubeCenter(7);
    const p = cubePoint('T', 2, 3);
    assert.deepEqual(orbitPoint(p, 0.7, -0.4, c, 0), orbitPoint(p, 0.7, -0.4, c));
    assert.deepEqual(orbitPoint(p, 0.7, -0.4, c, undefined), orbitPoint(p, 0.7, -0.4, c));
  });

  test('정렬 순서와 facing 부호가 roll 에 **완전 불변**이다', () => {
    // 화면 법선이 곧 투영의 커널이라 roll 은 q·n̂ 을 보존한다. 이게 깨지면 roll 을
    // 돌릴 때마다 오클루전이 재배열돼 셀이 깜빡인다.
    for (const invDist of [0, perspectiveInvDist(0.7, (7 / 2) * Math.sqrt(3))]) {
      const base = ext({ yaw: 0.4, pitch: -0.25, invDist });
      const key = (m) => m.quads.map((q) => `${quadKey(q)}:${q.facing < 0 ? 1 : 0}`).join('|');
      const want = key(base.mesh);
      for (const roll of [0.3, 1.0, Math.PI, 2.5, -1.9]) {
        const got = key(ext({ yaw: 0.4, pitch: -0.25, roll, invDist }).mesh);
        assert.equal(got, want, `invDist=${invDist} roll=${roll}: 정렬/facing 이 달라졌다`);
      }
      // 깊이도 보존돼야 한다 (roll 축이 깊이축이므로).
      const idx = new Map(base.mesh.quads.map((q, k) => [quadKey(q), k]));
      const rolled = ext({ yaw: 0.4, pitch: -0.25, roll: 1.0, invDist }).mesh;
      for (const q of rolled.quads) {
        const b = base.mesh.quads[idx.get(quadKey(q))];
        assert.ok(Math.abs(q.depth - b.depth) < 1e-9, `${quadKey(q)}: depth 가 roll 에 변했다`);
      }
    }
  });

  test('화면 상은 C 중심 2D 강체 회전이다 (원근을 켠 상태에서도)', () => {
    const theta = 0.37;
    for (const t of [0, 0.7]) {
      const invDist = perspectiveInvDist(t, (7 / 2) * Math.sqrt(3));
      const a = ext({ yaw: 0.4, pitch: -0.25, invDist });
      const b = ext({
        yaw: 0.4, pitch: -0.25, roll: theta, invDist,
      });
      const c = cubeCenter(a.n);
      const C = isoProject(c.x, c.y, c.z, a.layout);
      const idx = new Map(b.mesh.quads.map((q, k) => [quadKey(q), k]));
      // 양수 roll = 화면 CCW. 캔버스 y 는 아래가 양수라 그 회전 행렬은 −θ 다.
      const cs = Math.cos(-theta);
      const sn = Math.sin(-theta);
      let maxErr = 0;
      for (const q of a.mesh.quads) {
        const r = b.mesh.quads[idx.get(quadKey(q))];
        q.points2d.forEach((p, k) => {
          const dx = p.x - C.x;
          const dy = p.y - C.y;
          maxErr = Math.max(maxErr,
            Math.abs(C.x + cs * dx - sn * dy - r.points2d[k].x),
            Math.abs(C.y + sn * dx + cs * dy - r.points2d[k].y));
        });
      }
      assert.ok(maxErr < 1e-9, `t=${t}: roll 이 2D 강체 회전이 아니다 (maxErr=${maxErr})`);
    }
  });
});

describe('V3 6면 — 뒤 세 면에 같은 코드, 거울이 아니다', () => {
  test('면 수가 정확히 2배이고, 큰 필러 3장은 6면에서 사라진다', () => {
    const three = ext({ faces: 3 }).mesh;
    const six = ext({ faces: 6 }).mesh;
    const m3 = three.quads.filter((q) => q.kind === 'module');
    const m6 = six.quads.filter((q) => q.kind === 'module');
    assert.equal(m3.length, 3 * 7 * 7);
    assert.equal(m6.length, 2 * m3.length, '6면 데이터 면이 3면의 2배가 아니다');
    assert.equal(three.quads.length - m3.length, 3, '3면 필러가 3장이 아니다');
    // 🔴 필러가 남으면 2026-08-26 「셀이 투명해진다」가 재발한다 — 필러는 뒷면 셀과
    //    **동일 평면**이라 「등진 면끼리 안 겹친다」는 정렬 전제의 유일한 반례가 된다.
    assert.equal(six.quads.filter((q) => q.kind === 'back' && q.i < 0).length, 0,
      '6면 모드에 큰 BACK_COLOR 필러가 남아 있다');
    assert.equal(six.faces, 6);
  });

  test('digit → 색 매핑이 두 모드에서 같고, 앞뒤 쌍둥이가 같은 색이다', () => {
    const m3 = ext({ faces: 3 }).mesh.quads.filter((q) => q.kind === 'module');
    const m6 = ext({ faces: 6 }).mesh.quads.filter((q) => q.kind === 'module');
    const pick = (arr, side) => new Map(arr
      .filter((q) => q.side === side)
      .map((q) => [`${q.face}:${q.i}:${q.j}`, `${q.digit}/${hexOf(q.color)}`]));
    const front3 = pick(m3, 'front');
    const front6 = pick(m6, 'front');
    const back6 = pick(m6, 'back');
    assert.equal(front3.size, 3 * 7 * 7);
    assert.equal(back6.size, front3.size, '뒷면 사본 수가 앞면과 다르다');
    for (const [k, v] of front3) {
      assert.equal(front6.get(k), v, `${k}: 6면의 앞면 색이 3면과 다르다`);
      assert.equal(back6.get(k), v, `${k}: 뒷면 사본 색이 앞면과 다르다 — 뷰가 색을 바꿨다`);
    }
    // 세 레벨이 전부 살아 있어야 순위가 보인다 (한 색으로 뭉개지면 이 자가 잡는다).
    assert.equal(new Set([...back6.values()].map((v) => v.split('/')[1])).size, 3);
  });

  test('🔴 거울이 아니다 — 뒷면 사본의 감기 법선 부호가 앞면과 같다', () => {
    /*
     * 「T사본→T‑ · L사본→L‑ · R사본→R‑」 라는 **가장 자연스러운 배치가 곧 거울**이다
     * (점대칭이든 평행이동이든 det = −1). 그러면 디코더가 슬롯으로 라벨링할 때 L↔R
     * 전치가 들어가 6심볼이 0↔1 · 2↔4 · 3↔5 로 재사상된다 — 재사상된 것도 «유효한»
     * 순열이라 검출·격자맞춤은 통과하고 ECC 에서만 전멸한다. 「검출은 되는데 절대
     * 안 풀림」이 그 증상이다. 옳은 배치는 L→R‑, R→L‑ 로 **엇갈린다**.
     */
    const n = 7;
    const center = cubeCenter(n);
    const mesh = ext({ faces: 6, yaw: 0, pitch: 0 }).mesh;
    const mods = mesh.quads.filter((q) => q.kind === 'module');
    const front = new Map(mods.filter((q) => q.side === 'front')
      .map((q) => [`${q.face}:${q.i}:${q.j}`, windingSign(q.corners3d, center)]));
    const backs = mods.filter((q) => q.side === 'back');
    assert.ok(backs.length > 0, '뒷면 사본이 없다 — 자가 무의미해진다');
    for (const q of backs) {
      const want = front.get(`${q.face}:${q.i}:${q.j}`);
      assert.ok(want === 1 || want === -1, '앞면 감기 부호가 ±1 이 아니다 — 자가 깨졌다');
      assert.equal(windingSign(q.corners3d, center), want,
        `${q.face}(${q.i},${q.j}) 뒷면 사본이 **거울**이다 — 순위 삼중항이 전치된다`);
    }
    // 그리고 실제로 **엇갈려** 착지해야 한다: T→z=n · L→y=n · R→x=n.
    const axis = { T: 'z', L: 'y', R: 'x' };
    for (const q of backs) {
      assert.ok(q.corners3d.every((p) => Math.abs(p[axis[q.face]] - n) < 1e-9),
        `${q.face}(${q.i},${q.j}) 뒷면 사본이 ${axis[q.face]}=n 평면 위가 아니다`);
    }
  });

  test('6면·원근·roll 을 다 켜도 등진 면이 **전부** 마주 본 면보다 먼저 칠해진다', () => {
    const DEG = Math.PI / 180;
    const radius3d = (7 / 2) * Math.sqrt(3);
    let checked = 0;
    for (const t of [0, 0.5, 1]) {
      const invDist = perspectiveInvDist(t, radius3d);
      for (let yawDeg = 0; yawDeg <= 180; yawDeg += 30) {
        for (let pitchDeg = -60; pitchDeg <= 60; pitchDeg += 30) {
          for (const roll of [0, 1.1]) {
            for (const faces of [3, 6]) {
              const { mesh } = ext({
                yaw: yawDeg * DEG, pitch: pitchDeg * DEG, roll, invDist, faces,
              });
              const fronts = mesh.quads.filter((q) => q.facing < 0).length;
              const backs = mesh.quads.length - fronts;
              assert.ok(fronts > 0 && backs > 0,
                `facing 이 두 무리를 못 만든다 (t=${t} yaw=${yawDeg} pitch=${pitchDeg} `
                + `roll=${roll} faces=${faces}) — 자가 잠들었다.`);
              const firstFront = mesh.quads.findIndex((q) => q.facing < 0);
              const lastBack = mesh.quads.map((q) => !(q.facing < 0)).lastIndexOf(true);
              assert.ok(lastBack < firstFront,
                `등진 면이 마주 본 면 뒤에 칠해진다 (t=${t} yaw=${yawDeg} pitch=${pitchDeg} `
                + `roll=${roll} faces=${faces}) — 그 자리에 구멍이 뚫린다.`);
              checked += 1;
            }
          }
        }
      }
    }
    assert.ok(checked >= 400, `격자가 너무 작다 (${checked})`);
  });

  test('hitTest 가 side 를 함께 낸다 — 6면에서 앞뒤 쌍둥이를 가를 수 있다', () => {
    const { layout, mesh } = ext({ faces: 6, yaw: 0.3, pitch: -0.2 });
    const view = paintQuads(miniCtx(400, 400), mesh, { layout, pad: 24 });
    const hit = hitTest(mesh, view, 200, 200);
    assert.ok(hit, '캔버스 한가운데가 아무 quad 에도 안 맞는다 — 자가 잠들었다');
    assert.ok(hit.side === 'front' || hit.side === 'back', `side 가 없다: ${hit.side}`);
  });
});

/*
 * ⭐ **원근 보정이 오클루전 판정을 실제로 바꾸는가** (자가 지키는 사고가 재현되나).
 *
 * `outwardFacing` 에 원근 항을 안 넣어도 위 「등진 면 먼저」 자는 초록일 수 있다 —
 * 평행 판정으로도 대부분의 각도에서 답이 같기 때문이다. 그래서 **판정이 갈리는 각도가
 * 이 격자에 실재하는지**를 따로 잰다. 실측(n=13, 2° 격자): β=0.3 에서 1,917개,
 * β=0.5 에서 2,968개, β=0.839 에서 4,690개 각도에서 갈렸다.
 */
describe('원근 오클루전 — 평행 판정과 «실제로» 갈린다', () => {
  test('같은 각도에서 facing 부호가 평행 판정과 달라지는 quad 가 존재한다', () => {
    const DEG = Math.PI / 180;
    const radius3d = (7 / 2) * Math.sqrt(3);
    const invDist = perspectiveInvDist(0.6, radius3d);
    let flipped = 0;
    for (let yawDeg = -90; yawDeg <= 90; yawDeg += 10) {
      for (let pitchDeg = -60; pitchDeg <= 60; pitchDeg += 10) {
        const pose = { yaw: yawDeg * DEG, pitch: pitchDeg * DEG, faces: 6 };
        const par = ext(pose).mesh;
        const per = ext({ ...pose, invDist }).mesh;
        const sign = (m) => new Map(m.quads.map((q) => [quadKey(q), q.facing < 0]));
        const a = sign(par);
        const b = sign(per);
        for (const [k, v] of a) if (b.get(k) !== v) flipped += 1;
      }
    }
    assert.ok(flipped > 0,
      '원근에서도 facing 판정이 평행과 한 번도 안 갈렸다 — 원근 항이 안 걸렸거나 '
      + '(더 나쁘게) 이 자가 지키는 사고가 재현되지 않는다.');
  });
});

/*
 * ⭐ **V2 스냅샷 — 캔버스 픽셀을 실제로 읽어 PNG 바이트가 나오나.**
 *
 * 브라우저에서는 `canvas.toBlob` 이 하는 일을 node 에서 재려면 2D 컨텍스트가 필요하다.
 * 그래서 **최소 스캔라인 채우기 ctx** 를 두고 `paintQuads` 를 그대로 태운다 — 재는 것은
 * 뷰어의 실제 칠하기 경로이고, PNG 인코딩은 저장소의 `rasterToPng` 를 쓴다.
 * (생성기 UI 는 같은 `paintQuads` 를 오프스크린 캔버스에 태워 `toBlob` 한다.)
 */
function miniCtx(w, h) {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  let subpaths = [];
  let cur = null;
  const rgb = (hex) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    pixels[o] = c.r;
    pixels[o + 1] = c.g;
    pixels[o + 2] = c.b;
    pixels[o + 3] = 255;
  };
  const ctx = {
    canvas: { width: w, height: h },
    pixels,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect(x, y, ww, hh) {
      const c = rgb(ctx.fillStyle);
      for (let yy = Math.max(0, y | 0); yy < Math.min(h, (y + hh) | 0); yy += 1) {
        for (let xx = Math.max(0, x | 0); xx < Math.min(w, (x + ww) | 0); xx += 1) put(xx, yy, c);
      }
    },
    beginPath() { subpaths = []; cur = null; },
    moveTo(x, y) { cur = [{ x, y }]; subpaths.push(cur); },
    lineTo(x, y) {
      if (!cur) { cur = []; subpaths.push(cur); }
      cur.push({ x, y });
    },
    closePath() {},
    fill() {
      const c = rgb(ctx.fillStyle);
      for (const poly of subpaths) {
        if (poly.length < 3) continue;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of poly) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
        for (let yy = Math.max(0, Math.floor(minY)); yy <= Math.min(h - 1, Math.ceil(maxY)); yy += 1) {
          const sy = yy + 0.5;
          const xs = [];
          for (let k = 0; k < poly.length; k += 1) {
            const a = poly[k];
            const b = poly[(k + 1) % poly.length];
            if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
              xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
            }
          }
          xs.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            for (let xx = Math.ceil(xs[k] - 0.5); xx <= Math.floor(xs[k + 1] - 0.5); xx += 1) {
              put(xx, yy, c);
            }
          }
        }
      }
    },
    stroke() {},
    fillText() {},
  };
  return ctx;
}

describe('V2 미리보기 스냅샷 — 캔버스 픽셀에서 PNG 바이트가 나온다', () => {
  const SIZE = 128;
  const shoot = (opts) => {
    const { layout, mesh } = ext(opts);
    const ctx = miniCtx(SIZE, SIZE);
    paintQuads(ctx, mesh, {
      layout, pad: 8, background: { r: 14, g: 16, b: 24 }, selected: null,
    });
    return ctx;
  };

  test('PNG 시그니처 + 길이 > 0, 그리고 배경만 있는 게 아니다', () => {
    const ctx = shoot({ yaw: 0.4, pitch: -0.25 });
    const png = rasterToPng({ width: SIZE, height: SIZE, pixels: ctx.pixels });
    assert.ok(png.length > 0, 'PNG 바이트가 비었다');
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG 시그니처가 아니다');
    // ⚠ **먼저 «그린 게 있나»**: 배경 한 색만 있으면 위 두 단언은 공짜로 통과한다.
    const seen = new Set();
    for (let i = 0; i < ctx.pixels.length; i += 4) {
      seen.add(`${ctx.pixels[i]},${ctx.pixels[i + 1]},${ctx.pixels[i + 2]}`);
    }
    assert.ok(seen.size >= 4, `칠해진 색이 ${seen.size}종뿐이다 — 코드가 안 그려졌다`);
  });

  test('원근 0 · roll 0 · 3면 렌더가 **픽셀 단위로** 기본 렌더와 같다', () => {
    // 불변 계약의 끝단 자. 위 오라클 대조가 모델 층이라면 이건 «화면» 층이다.
    const a = shoot({ yaw: 0.4, pitch: -0.25 });
    const b = shoot({
      yaw: 0.4, pitch: -0.25, roll: 0, perspective: 0, faces: 3,
    });
    assert.deepEqual([...b.pixels], [...a.pixels]);
    // 그리고 축을 켜면 **달라져야** 한다 — 안 달라지면 배선이 끊긴 것이다.
    for (const opts of [{ perspective: 0.6 }, { roll: 0.5 }]) {
      const c = shoot({ yaw: 0.4, pitch: -0.25, ...opts });
      assert.notDeepEqual([...c.pixels], [...a.pixels],
        `${JSON.stringify(opts)} 를 켰는데 화면이 그대로다 — 배선이 끊겼다`);
    }
  });

  test('6면은 **뒤를 볼 때** 코드가 보인다 (앞에서는 같은 게 맞다)', () => {
    /*
     * ⚠ 여기서 `faces:6` 을 앞모습으로 재면 안 된다. 모델이 볼록 상자라 어느 시점에서도
     *   보이는 면은 셋뿐이고 앞 세 면이 실루엣을 통째로 덮는다 — 그래서 앞모습이 같은
     *   것이 **옳다**. 6면이 값을 내는 자리는 뒤를 봤을 때다. 그 축으로 잰다.
     */
    const backPose = { yaw: Math.PI, pitch: 0.35 };
    const colorsOf = (ctx) => {
      const seen = new Set();
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        seen.add(`${ctx.pixels[i]},${ctx.pixels[i + 1]},${ctx.pixels[i + 2]}`);
      }
      return seen;
    };
    const levels = new Set(Y3D_PRESET.levels.map((c) => `${c.r},${c.g},${c.b}`));
    const three = colorsOf(shoot({ ...backPose, faces: 3 }));
    const six = colorsOf(shoot({ ...backPose, faces: 6 }));
    // 3면: 뒤에는 데이터가 없다 — 팔레트 레벨이 화면에 **하나도** 없어야 한다.
    for (const lv of levels) {
      assert.equal(three.has(lv), false, `3면인데 뒤에서 팔레트 색 ${lv} 이 보인다`);
      assert.equal(six.has(lv), true, `6면인데 뒤에서 팔레트 색 ${lv} 이 안 보인다`);
    }
    assert.ok(six.size > three.size, `6면이 뒤에서 더 다채롭지 않다 (${six.size} vs ${three.size})`);
  });
});

// ── 리뷰(2026-08-31)가 잡은 3건의 회귀 자 ─────────────────────────────────
// 셋 다 「소스에 그 문자열이 있는가」가 아니라 **동작**을 잰다. 첫 구현의 자는
// `id="..." hidden` 이 적혀 있는지만 봐서 «hidden 이 안 먹는» 것을 구조적으로 못 잡았다.

test('6면 + 라벨: 등진 면에는 라벨을 찍지 않는다', () => {
  // 라벨은 모든 fill 뒤에 깊이 판정 없이 얹히므로, 등진 면에 찍으면 보이는 면 위에
  // 글자가 놓인다. 3면 모드에서는 module 이 셋뿐이라 우연히 옳았다.
  const calls = [];
  const ctx = {
    canvas: { width: 400, height: 400 },
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() {}, stroke() {}, clearRect() {}, setTransform() {}, fillRect() {},
    fillText(text, x, y) { calls.push({ text, x, y }); },
    set font(v) {}, set textAlign(v) {}, set textBaseline(v) {},
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set lineJoin(v) {},
  };
  const pal = palette();
  const base = {
    n: 1,
    tones: 3,
    levels: pal.levels,
    layout: layoutForCube(1, { size: 1, margin: 0.5 }),
    digitAt: () => 0,
  };
  const counts = {};
  for (const faces of [3, 6]) {
    calls.length = 0;
    const mesh = buildOrbitMesh({ ...base, faces });
    const view = fitView(mesh.quads, 400, 400, 10);
    paintQuads(ctx, mesh, { view, labels: true });
    counts[faces] = calls.length;
  }
  assert.equal(counts[3], 3, '3면 모드는 라벨 3개');
  assert.equal(counts[6], 3, '6면 모드에서도 보이는 면만 — 등진 면 라벨 0개');
});

test('index.html: .y3d-row[hidden] 규칙이 있다 — 저자 display 가 UA hidden 을 이긴다', () => {
  // 검사 대상은 «display 를 주는 모든 클래스» 가 아니라 **hidden 이 실제로 걸리는
  // 요소가 단 클래스** 다 (.y3d-btn 처럼 토글 대상이 아닌 것까지 요구하면 자가 거짓
  // 실패한다). 마크업에서 hidden 속성을 가진 태그의 class 를 유도한다.
  const css = INDEX.slice(INDEX.indexOf('<style'), INDEX.indexOf('</style>'));
  const hiddenClasses = new Set();
  for (const tag of INDEX.match(/<[a-z]+\b[^>]*\bhidden\b[^>]*>/g) || []) {
    const cls = /class="([^"]*)"/.exec(tag);
    if (cls) for (const name of cls[1].split(/\s+/)) if (name) hiddenClasses.add(name);
  }
  assert.ok(hiddenClasses.size > 0, 'hidden 속성을 단 요소를 못 찾았다 — 자가 헛돌고 있다');

  // ⚠ y3d 계열로 한정한다. 다른 곳은 숨김 기전이 다를 수 있다 — 예로 `.stage-hint` 는
  // display 를 주지만 짝 클래스 `.faded` 가 `visibility:hidden` 으로 실제 숨김을
  // 담당하므로 [hidden] 짝이 없어도 결함이 아니다. 「hidden 이 유일한 숨김 수단인가」를
  // 정적으로 유도할 수 없으므로, 그 규약이 성립하는 구역만 잰다.
  let checked = 0;
  for (const name of hiddenClasses) {
    if (!name.startsWith('y3d')) continue;
    const escaped = name.replace(/[-]/g, '\\$&');
    const givesDisplay = new RegExp(
      `\\.${escaped}\\s*\\{[^}]*display:\\s*(?:flex|grid|block|inline-flex|inline-block)`,
    ).test(css);
    if (!givesDisplay) continue;
    checked += 1;
    assert.match(
      css,
      new RegExp(`\\.${escaped}\\[hidden\\]\\s*\\{[^}]*display:\\s*none`),
      `.${name} 이 display 를 주는데 [hidden] 짝이 없다 — 저자 display 가 UA hidden 을 이겨 안 숨는다`,
    );
  }
  assert.ok(checked > 0, 'display 를 주는 hidden 클래스를 하나도 못 찾았다 — 자가 헛돌고 있다');
});

test('index.html: 스냅샷 가용성은 mesh 존재가 아니라 «3D 가 켜져 있고 mesh 가 있다»', () => {
  // 2.5D 로 되돌려도 mesh 가 남는 경로가 있어, mesh 만 보면 옛 3D 프레임이 저장된다.
  assert.match(
    INDEX,
    /const canSnap = y3dPreview\.on && !!y3dPreview\.mesh;/,
    'canSnap 이 y3dPreview.on 을 안 본다',
  );
});
