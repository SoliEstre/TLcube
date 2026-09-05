/**
 * scanner-debug-overlay.test.js — lab 디버그 오버레이 (작업 1) + 안정판 불활성 계약.
 *
 * 핵심은 **부정 단언의 기능화**다: «안정판에서 오버레이가 불활성» 을 regex 로 믿지
 * 않고, 기록형 스텁 DOM 을 주입해 mutation 카운트 0 을 실행으로 증명한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIP_COLORS,
  clipColorOf,
  createDebugOverlay,
  projectFramePoint,
  summarizeFrameDebug,
} from '../src/scanner-debug-overlay.js';
import { extractCsAnchors } from '../src/lab-telemetry.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { distortImage } from './harness/distort.mjs';

/**
 * 모든 변이를 세는 기록형 스텁 요소. hidden 은 **속성**으로 표현한다 — 오버레이는
 * `.hidden` 프로퍼티를 쓰지 않는다(SVG 요소에는 그 IDL 이 없어 조용히 무효가 된다,
 * 실브라우저 확인 2026-08-16). authored `hidden` 을 반영해 attrs.hidden='' 로 시작한다.
 */
function stubElement(name) {
  const element = {
    name,
    attrs: { hidden: '' },
    children: [],
    listeners: {},
    classes: new Set(),
    mutations: 0,
  };
  let hidden = true;
  let text = '';
  Object.defineProperty(element, 'hidden', {
    get: () => hidden,
    set: (value) => { element.mutations += 1; hidden = Boolean(value); },
  });
  Object.defineProperty(element, 'textContent', {
    get: () => text,
    set: (value) => { element.mutations += 1; text = String(value); },
  });
  element.setAttribute = (key, value) => {
    element.mutations += 1;
    element.attrs[key] = String(value);
  };
  element.removeAttribute = (key) => {
    element.mutations += 1;
    delete element.attrs[key];
  };
  element.append = (...nodes) => {
    element.mutations += 1;
    element.children.push(...nodes);
  };
  element.replaceChildren = (...nodes) => {
    element.mutations += 1;
    element.children = [...nodes];
  };
  element.addEventListener = (type, handler) => {
    element.mutations += 1;
    (element.listeners[type] ||= []).push(handler);
  };
  element.classList = {
    toggle(cls, force) {
      element.mutations += 1;
      const on = force === undefined ? !element.classes.has(cls) : Boolean(force);
      if (on) element.classes.add(cls); else element.classes.delete(cls);
      return on;
    },
  };
  return element;
}

function stubDoc() {
  return {
    created: [],
    createElementNS(_ns, tag) {
      const element = stubElement(tag);
      this.created.push(element);
      return element;
    },
    createDocumentFragment() {
      const fragment = stubElement('#fragment');
      // fragment 는 카운트 대상이 아니다 — DOM 에 아직 안 붙었다.
      fragment.mutations = 0;
      return fragment;
    },
  };
}

test('clipSide → 색: none=초록 · 단면=노랑 · multi=빨강 · 미상=회청', () => {
  assert.equal(clipColorOf('none'), CLIP_COLORS.none);
  assert.equal(clipColorOf('multi'), CLIP_COLORS.multi);
  for (const single of ['left', 'right', 'top', 'bottom', 'border']) {
    assert.equal(clipColorOf(single), CLIP_COLORS.single, single);
  }
  assert.equal(clipColorOf(null), CLIP_COLORS.unknown);
  assert.equal(clipColorOf(''), CLIP_COLORS.unknown);
});

test('앵커 투영 — 프레임(중앙 정사각)→뷰(중앙 정사각)는 순수 배율이다', () => {
  const projected = projectFramePoint({ x: 480, y: 240 }, 960, 960, 320);
  assert.deepEqual(projected, { x: 160, y: 80 });
  // 역투영·오프셋이 없다 — r3 구조 그대로.
  assert.equal(projectFramePoint({ x: 0, y: 0 }, 960, 960, 320).x, 0);
  assert.equal(projectFramePoint({ x: 'x', y: 0 }, 960, 960, 320), null);
  assert.equal(projectFramePoint({ x: 1, y: 1 }, 0, 960, 320), null);
});

test('프레임 요약 라인 — 파이프라인 도달(geo→cs→stage)·cell_px·zoom/crop·w×h 가 실린다', () => {
  const lines = summarizeFrameDebug({
    frameW: 960,
    frameH: 960,
    ms: 342.4,
    ok: false,
    reason: 'frontend:no-finder',
    stage: 'proposal',
    geometry: { geometryStage: 'silhouette', clipSide: 'multi', occupancy: 0.42, cellPx: 12.3 },
    cellSurface: {
      attempted: true, accepted: false, score: 0.71, layoutId: 'v1r2',
      expectedLayout: 'v1r2', reason: 'cs-agreement',
    },
    anchors: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    zoom: { zoom: 1, crop: 2, effectiveZoom: 2, zoomError: '' },
  });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /960x960/);
  assert.match(lines[0], /342ms/);
  assert.match(lines[0], /crop 2/);
  assert.match(lines[1], /geo silhouette/);
  assert.match(lines[1], /clip multi/);
  assert.match(lines[1], /cell 12\.3px/);
  assert.match(lines[2], /cs rejected/);
  assert.match(lines[2], /agree 0\.71/);
  assert.match(lines[2], /layout v1r2 \(exp v1r2\)/);
  assert.match(lines[2], /anchors 2/);
  assert.match(lines[3], /stage proposal/);
  assert.match(lines[3], /frontend:no-finder/);
  // cs 미시도·성공 표기.
  const idle = summarizeFrameDebug({ cellSurface: { attempted: false }, ok: true, stage: 'decode' });
  assert.match(idle[2], /cs not-attempted/);
  assert.match(idle[3], /stage decode · OK/);
});

/*
 * 선택 줄(qr · hud, §27.4 0a·3a) — **«있을 때만» 규약**. 정식(`/`)에선 두 인자가 빈 문자열이므로 줄 수가
 * 기본 4줄 그대로여야 한다. 여기서 재는 것은 문자열 내용이 아니라 «없으면 늘지 않는다» 는 성질이다.
 */
test('선택 줄(hud) — 있으면 마지막 줄로 붙고, 없으면 줄 수가 안 변한다', () => {
  const base = summarizeFrameDebug({ cellSurface: { attempted: false }, ok: true, stage: 'decode' });
  assert.equal(base.length, 4);
  for (const empty of [undefined, '', null, 0, 42]) {
    assert.equal(
      summarizeFrameDebug({ cellSurface: { attempted: false }, ok: true, stage: 'decode', hud: empty }).length,
      base.length,
      'hud 가 ' + String(empty) + ' 인데 줄이 늘었다 — 정식 패널이 빈 줄을 얻는다',
    );
  }
  const withHud = summarizeFrameDebug({
    cellSurface: { attempted: false }, ok: true, stage: 'decode', hud: 'hud data · 1.2ms (max 3.4) · n25 v0TR',
  });
  assert.equal(withHud.length, base.length + 1);
  assert.equal(withHud[withHud.length - 1], 'hud data · 1.2ms (max 3.4) · n25 v0TR');
  assert.deepEqual(withHud.slice(0, base.length), base, '앞 줄들이 hud 때문에 바뀌었다');
  // qr 과 hud 가 둘 다 있으면 qr → hud 순 (패널을 읽는 사람의 순서가 고정이어야 한다).
  const both = summarizeFrameDebug({
    cellSurface: { attempted: false }, ok: true, stage: 'decode', qr: 'qr line', hud: 'hud line',
  });
  assert.deepEqual(both.slice(base.length), ['qr line', 'hud line']);
});

test('안정판 불활성 — enabled=false 면 어떤 DOM 도 만지지 않는 동결 no-op 이다', () => {
  const layer = stubElement('layer');
  const panel = stubElement('panel');
  const toggle = stubElement('toggle');
  const doc = stubDoc();
  const overlay = createDebugOverlay({
    enabled: false, layer, panel, toggleButton: toggle, doc,
  });
  assert.equal(overlay.enabled, false);
  assert.equal(overlay.isVisible(), false);
  // no-op API 를 실제로 두들겨도 —
  overlay.setViewSide(320);
  overlay.frame({ frameW: 960, frameH: 960, geometry: { clipSide: 'multi' } });
  overlay.flagDotIssue([{ ring: 'outer', index: 0 }]);
  overlay.toggle();
  // — mutation 0, authored hidden 속성 유지, 생성 요소 0, 리스너 0.
  assert.equal(layer.mutations, 0);
  assert.equal(panel.mutations, 0);
  assert.equal(toggle.mutations, 0);
  assert.equal(doc.created.length, 0);
  assert.equal(layer.attrs.hidden, '');
  assert.equal(panel.attrs.hidden, '');
  assert.equal(toggle.attrs.hidden, '');
  assert.ok(Object.isFrozen(overlay));
  // 요소가 아예 없어도(마크업 회귀) 조용히 불활성이다.
  const orphan = createDebugOverlay({ enabled: true, layer: null, panel: null, doc });
  assert.equal(orphan.enabled, false);
});

test('lab 활성 — 기본 켬·외곽선 clip 색·앵커 마커 투영·토글이 동작한다', () => {
  const layer = stubElement('layer');
  const panel = stubElement('panel');
  const toggle = stubElement('toggle');
  const doc = stubDoc();
  const overlay = createDebugOverlay({
    enabled: true, layer, panel, toggleButton: toggle, doc,
  });
  assert.equal(overlay.enabled, true);
  // 기본 켬 (운영자 요청): hidden **속성** 제거로 표시 — SVG 레이어에도 유효한 경로다.
  assert.equal(overlay.isVisible(), true);
  assert.ok(!('hidden' in layer.attrs), 'SVG 레이어의 hidden 속성이 제거돼야 한다');
  assert.ok(!('hidden' in panel.attrs));
  assert.ok(!('hidden' in toggle.attrs));
  assert.equal(toggle.attrs['aria-pressed'], 'true');
  assert.equal(layer.children.length, 2, '외곽선 rect + 앵커 그룹');
  const [outline, markerGroup] = layer.children;

  overlay.setViewSide(320);
  assert.equal(layer.attrs.viewBox, '0 0 320 320');
  assert.equal(outline.attrs.width, String(320 - 3));

  overlay.frame({
    frameW: 960,
    frameH: 960,
    ms: 100,
    ok: false,
    reason: 'frontend:no-finder',
    stage: 'proposal',
    geometry: { clipSide: 'multi', geometryStage: 'silhouette' },
    cellSurface: { attempted: true, accepted: false, score: 0.5 },
    anchors: [{ x: 480, y: 480, u: 12 }],
    zoom: { zoom: 1, crop: 1, effectiveZoom: 1 },
  });
  assert.equal(outline.attrs.stroke, CLIP_COLORS.multi);
  // 앵커 960×960 → 320 뷰: (480,480) → (160,160), 반지름 = max(4, 12/960·320) = 4.
  const fragment = markerGroup.children[0];
  assert.equal(fragment.children.length, 1);
  assert.equal(fragment.children[0].attrs.cx, '160');
  assert.equal(fragment.children[0].attrs.cy, '160');
  assert.equal(fragment.children[0].attrs.r, '4');
  assert.match(panel.textContent, /clip multi/);

  // 점 이탈 표기 (작업 4 연동) — 다음 frame 부터 패널에 실린다.
  overlay.flagDotIssue([{ ring: 'outer', index: 3 }]);
  overlay.frame({ frameW: 960, frameH: 960, geometry: { clipSide: 'none' } });
  assert.match(panel.textContent, /DOT-OOB outer#3/);
  assert.equal(outline.attrs.stroke, CLIP_COLORS.none);

  // 토글: 끄면 숨고 frame 이 패널을 덮어쓰지 않는다. 다시 켜면 돌아온다.
  const beforeToggle = panel.textContent;
  overlay.toggle();
  assert.equal(overlay.isVisible(), false);
  assert.equal(layer.attrs.hidden, '');
  assert.equal(panel.attrs.hidden, '');
  assert.equal(toggle.attrs['aria-pressed'], 'false');
  overlay.frame({ frameW: 960, frameH: 960, geometry: { clipSide: 'multi' } });
  assert.equal(panel.textContent, beforeToggle, '꺼진 동안 패널이 갱신되면 안 된다');
  overlay.toggle();
  assert.ok(!('hidden' in layer.attrs));
  // 토글 버튼 클릭 배선. `.hidden` 프로퍼티 경로는 쓰지 않았다 (SVG 무효 경로 회귀 방지).
  assert.equal(toggle.listeners.click.length, 1);
  assert.equal(layer.hidden, true, 'SVG 에 무효인 .hidden 프로퍼티를 만지면 안 된다');
});

test('extractCsAnchors — 진단 가방 형태별로 앵커를 찾고 좌표를 보존한다', () => {
  // cube-detect 실패 진단이 detail.diagnostics 바로 아래에 실리는 형태.
  const viaDetail = extractCsAnchors({
    ok: false,
    detail: {
      diagnostics: {
        csBlockLocator: {
          verified: [
            { kind: 'k5', x: 100.5, y: 200.25, u: 11, score: 0.7, count: 3 },
            { kind: 'k3', x: 'bad', y: 1 }, // 좌표가 깨진 항목은 걸러진다
          ],
        },
      },
    },
  });
  assert.equal(viaDetail.length, 1);
  assert.deepEqual(viaDetail[0], { kind: 'k5', x: 100.5, y: 200.25, u: 11, score: 0.7 });
  // bootstrap.cube 하위 가방 형태.
  const viaCube = extractCsAnchors({
    ok: false,
    diagnostics: {
      bootstrap: {
        cube: { diagnostics: { csBlockLocator: { verified: [{ kind: 'k5', x: 1, y: 2 }] } } },
      },
    },
  });
  assert.equal(viaCube.length, 1);
  assert.deepEqual(extractCsAnchors(null), []);
  assert.deepEqual(extractCsAnchors({ ok: true }), []);
});

test('extractCsAnchors — 실제 decodeFrontend 결과(로케이터 발동 프레임)에서 앵커가 나온다', {
  timeout: 300_000,
}, () => {
  const PRESET = getPreset(DEFAULT_PRESET);
  const PALETTE = Object.freeze({
    background: PRESET.background,
    levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: DEFAULT_FACE_GAINS,
  });
  const FILL = Object.freeze({ ...PRESET.background, a: 255 });
  const encoded = encodeY('https://tl.estre.so', {
    cellSurfaceLayout: 'v2r2', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  const raster = rasterize(scene, { pixelsPerUnit: 15, supersample: 2 });
  const W = 960;
  const frame = { width: W, height: W, pixels: new Uint8ClampedArray(W * W * 4) };
  for (let i = 0; i < W * W; i += 1) {
    frame.pixels[i * 4] = FILL.r;
    frame.pixels[i * 4 + 1] = FILL.g;
    frame.pixels[i * 4 + 2] = FILL.b;
    frame.pixels[i * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((W - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      frame.pixels[d] = raster.pixels[s];
      frame.pixels[d + 1] = raster.pixels[s + 1];
      frame.pixels[d + 2] = raster.pixels[s + 2];
      frame.pixels[d + 3] = 255;
    }
  }
  const distorted = distortImage(frame, { gamma: 0.7, fill: FILL });
  const result = decodeFrontend({
    width: distorted.width, height: distorted.height, pixels: distorted.pixels,
  }, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
  });
  const anchors = extractCsAnchors(result);
  assert.ok(anchors.length >= 1, '로케이터 발동 프레임인데 앵커 0개');
  for (const anchor of anchors) {
    assert.ok(anchor.x >= 0 && anchor.x <= W, '앵커 x 가 프레임 밖: ' + anchor.x);
    assert.ok(anchor.y >= 0 && anchor.y <= W, '앵커 y 가 프레임 밖: ' + anchor.y);
  }
});
