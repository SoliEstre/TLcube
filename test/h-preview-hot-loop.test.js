import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {createHPreviewRenderer} from '../src/h-preview-renderer.js';

function previewHarness() {
  const calls = { getError: 0, texImage2D: 0, deleteTexture: 0 };
  let error = 0;
  const gl = new Proxy({
    NO_ERROR: 0, VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ELEMENT_ARRAY_BUFFER: 5, ARRAY_BUFFER: 6, STATIC_DRAW: 7, STREAM_DRAW: 8,
    TEXTURE_2D: 9, TEXTURE0: 10, UNPACK_FLIP_Y_WEBGL: 11, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 12,
    TEXTURE_WRAP_S: 13, TEXTURE_WRAP_T: 14, CLAMP_TO_EDGE: 15, TEXTURE_MIN_FILTER: 16,
    TEXTURE_MAG_FILTER: 17, LINEAR: 18, NEAREST: 19, RGBA: 20, UNSIGNED_BYTE: 21,
    DEPTH_TEST: 22, CULL_FACE: 23, BLEND: 24, SRC_ALPHA: 25, ONE_MINUS_SRC_ALPHA: 26,
    COLOR_BUFFER_BIT: 27, FLOAT: 28, TRIANGLE_FAN: 29, TRIANGLES: 30, UNSIGNED_SHORT: 31,
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: () => ({}), getError: () => { calls.getError++; const value = error; error = 0; return value; },
    texImage2D: () => { calls.texImage2D++; }, deleteTexture: () => { calls.deleteTexture++; },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const listeners = new Map();
  const canvas = {
    width: 320, height: 320, getContext: () => gl,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
  };
  return { calls, canvas, setError: value => { error = value; }, lose: () => listeners.get('webglcontextlost')?.({ preventDefault() {} }), listeners };
}

const options = { rotateX: .2, rotateY: .4, rotateZ: .1, perspective: .3, outline: true };

test('H GPU hot loop은 첫 draw와 리소스 변경만 오류를 확인하고 pose 회전은 texture를 다시 올리지 않아요', () => {
  const h = previewHarness(), renderer = createHPreviewRenderer(h.canvas), encoded = encodeH('P', { version: 5, mode: 3, finder: 'auto' });
  assert.equal(h.calls.getError, 1, '초기 program/buffer 생성은 확인해야 해요');
  assert.equal(renderer.draw(encoded, options), true);
  const checked = h.calls.getError, uploads = h.calls.texImage2D;
  for (let frame = 0; frame < 8; frame++) assert.equal(renderer.draw(encoded, { ...options, rotateY: frame / 10 }), true);
  assert.equal(h.calls.getError, checked, '지속 pose draw는 driver 오류 동기화를 하지 않아요');
  assert.equal(h.calls.texImage2D, uploads, '지속 pose draw는 texture upload를 하지 않아요');

  const palette = { levels: [{ r: 10, g: 20, b: 30 }, { r: 80, g: 90, b: 100 }, { r: 160, g: 180, b: 220 }], background: { r: 255, g: 255, b: 255 } };
  assert.equal(renderer.draw(encoded, { ...options, palette }), true);
  const changedUploads = h.calls.texImage2D;
  palette.levels[0].r = 11;
  assert.equal(renderer.draw(encoded, { ...options, palette }), true);
  assert.ok(h.calls.texImage2D > changedUploads, '가변 palette의 값 변경은 cache를 무효화해야 해요');
  assert.ok(h.calls.getError > checked, '리소스 변경 draw는 오류를 확인해야 해요');

  const beforeArrangement = h.calls.texImage2D;
  assert.equal(renderer.draw(encoded, { ...options, palette, arrangement: 'horizontal' }), true);
  assert.ok(h.calls.texImage2D > beforeArrangement, 'arrangement 변경은 display/texture cache를 무효화해야 해요');
});

test('H GPU strict 진단과 checked draw 오류는 실패로 보고하고 context loss 뒤에는 즉시 중지해요', () => {
  const h = previewHarness(), renderer = createHPreviewRenderer(h.canvas), encoded = encodeH('P', { version: 0, mode: 3, finder: 'auto' });
  assert.equal(renderer.draw(encoded, options), true);
  const normalChecks = h.calls.getError;
  assert.equal(renderer.draw(encoded, { ...options, diagnosticStrict: true }), true);
  assert.equal(renderer.draw(encoded, { ...options, diagnosticStrict: true }), true);
  assert.equal(h.calls.getError, normalChecks + 2, 'strict 진단은 매 draw를 확인해야 해요');
  h.setError(99);
  assert.equal(renderer.draw(encoded, { ...options, diagnosticStrict: true }), false, 'checked GL error는 성공으로 숨기지 않아요');
  assert.equal(renderer.draw(encoded, options), false, 'checked 오류 뒤 renderer는 다음 pose를 성공으로 되돌리지 않아요');
  h.lose();
  assert.equal(renderer.draw(encoded, options), false, 'context loss는 다음 draw를 기다리지 않고 GPU를 중지해요');
  renderer.dispose();
  assert.equal(h.listeners.has('webglcontextlost'), false, 'dispose는 context listener를 정리해야 해요');
});

test('H GPU는 pose 0부터 59까지 동기 확인 없이 제출하고 60에서 오류를 발견해 영구 실패로 잠가요', () => {
  const h = previewHarness(), renderer = createHPreviewRenderer(h.canvas), encoded = encodeH('P', { version: 0, mode: 3, finder: 'auto' });
  assert.equal(renderer.draw(encoded, options), true);
  const checksAfterFirstDraw = h.calls.getError;
  h.setError(97);
  for (let pose = 0; pose < 60; pose++) assert.equal(renderer.draw(encoded, { ...options, rotateY: pose / 100 }), true);
  assert.equal(h.calls.getError, checksAfterFirstDraw, 'pose 0…59는 getError를 호출하지 않아요');
  assert.equal(renderer.draw(encoded, { ...options, rotateY: .61 }), false, 'pose 60의 bounded check가 대기 오류를 발견해야 해요');
  assert.equal(renderer.draw(encoded, options), false, 'periodic 오류 뒤 renderer는 다시 성공하지 않아요');
});

test('H GPU 첫 draw와 resource rebuild 오류도 각각 renderer 수명 전체를 실패로 만들어요', () => {
  const first = previewHarness(), encoded = encodeH('P', { version: 0, mode: 3, finder: 'auto' }), renderer = createHPreviewRenderer(first.canvas);
  first.setError(96);
  assert.equal(renderer.draw(encoded, options), false);
  assert.equal(renderer.draw(encoded, options), false, '첫 draw 오류 뒤에도 재시도 성공을 보고하면 안 돼요');

  const changed = previewHarness(), resourceRenderer = createHPreviewRenderer(changed.canvas);
  assert.equal(resourceRenderer.draw(encoded, options), true);
  changed.setError(95);
  assert.equal(resourceRenderer.draw(encodeH('Q', { version: 0, mode: 3, finder: 'auto' }), options), false);
  assert.equal(resourceRenderer.draw(encoded, options), false, 'resource rebuild 오류도 영구 실패여야 해요');
});
