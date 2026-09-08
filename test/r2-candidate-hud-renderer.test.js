import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateHudRenderer } from '../src/r2-candidate-hud-renderer.js';
import { createCandidateHudModel, R2_CANDIDATE_SUCCESS_MS } from '../src/r2-candidate-hud-model.js';
import { acceptStopDelayMs, createAcceptStopGate } from '../src/scanner-accept-delay.js';
import { R2_TYPE_C_PROFILE } from '../src/r2/profiles/c.js';
import { syntheticC } from './r2-c-fixtures.js';
import { enumerateCubeFaceGeometry } from '../src/decoder/cube-face-geometry.js';
import { hexCorners } from '../src/hexgrid.js';
import { candidateHudGeometry, candidateHudQuadSlot } from '../src/r2/candidate-hud-geometry.js';
import { HUD_ROLE, HUD_TONE_NONE } from '../src/r2-hud-model.js';

class Path {
  points = [];
  moveTo(x, y) { this.points.push([x, y]); }
  lineTo(x, y) { this.points.push([x, y]); }
  closePath() {}
}
class Context extends Path {
  calls = [];
  globalAlpha = 1;
  setTransform(...values) { this.transform = values; }
  clearRect() { this.calls = []; }
  beginPath() { this.points = []; }
  fill(path) { this.calls.push({ op: 'fill', color: this.fillStyle, alpha: this.globalAlpha, points: [...path.points] }); }
  stroke() { this.calls.push({ op: 'stroke', color: this.strokeStyle, alpha: this.globalAlpha, dash: this.dash, points: [...this.points] }); }
  setLineDash(value) { this.dash = value; }
}
function fixture() {
  const doc = { defaultView: { devicePixelRatio: 1 }, createElement: (tag) => element(tag) };
  function element(tag) {
    const classes = new Set();
    return {
      tag, ownerDocument: doc, children: [], dataset: {}, hidden: true,
      style: { setProperty(name, value) { this[name] = value; } },
      classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v) },
      append(...nodes) { this.children.push(...nodes); },
      setAttribute(name, value) { this[name] = value; },
      getContext() { return this.context ??= new Context(); },
      clientWidth: 360,
    };
  }
  const container = element('div'), overlay = element('canvas'), stage = element('div');
  const renderer = createCandidateHudRenderer({ container, overlay, stage,
    labelFor: (key) => key,
    paintFor: (role, state, tone, corrected) => ({ color: corrected ? '#ff00ff' : ['#223344', '#aabbcc', '#66dd99', '#ff7777'][state], alpha: 1 }),
  });
  return { renderer, container, overlay, stage };
}
const row = (id, D, extra = {}) => ({ id, type: 'Y', n: 13, layoutId: 'v0', D,
  tracking: true, retained: false, alive: true, formatWire: 2, cellMap: new Uint8Array(169).fill(2),
  cellCount: 169, H: [3, 0, 180, 0, 3, 180, 0, 0, 1], frameWidth: 360, frameHeight: 360, ...extra });

test('실제 DOM 소비자가 슬롯/색/비활성/역전을 연결하고 중앙 채움은 한 후보만 그려요', () => {
  const old = globalThis.Path2D; globalThis.Path2D = Path;
  try {
    const { renderer: r, container, overlay } = fixture();
    const a = row('A', .8), b = row('B', .5, { retained: true, tracking: false });
    r.render([a, b], 0);
    assert.equal(container.children.length, 12);
    assert.equal(container.dataset.leaderId, 'A');
    assert.equal(container.children[0].style.gridColumn, '4');
    assert.equal(container.children[1].style.gridRow, '2');
    assert.equal(container.children[1].style.opacity, '0.38');
    assert.equal(container.children[1].dataset.state, 'retained');
    const strokes = overlay.context.calls.filter((x) => x.op === 'stroke');
    assert.equal(strokes.length, 2);
    assert.equal(strokes[0].color, container.children[0].style['--candidate-color']);
    assert.equal(strokes[1].color, container.children[1].style['--candidate-color']);
    assert.equal(overlay.context.calls.filter((x) => x.op === 'fill').length, 2);
    r.render([a, { ...b, D: .9 }], 1);
    assert.equal(container.dataset.leaderId, 'B');
    assert.equal(container.children[0].dataset.candidateId, 'A');
    assert.equal(container.children[1].dataset.candidateId, 'B');
  } finally { globalThis.Path2D = old; }
});

test('드랍은 빨강 뒤 빈자리, 후속 후보가 재사용하고 리셋은 모든 표시를 비워요', () => {
  const old = globalThis.Path2D; globalThis.Path2D = Path;
  try {
    const { renderer: r, container, overlay, stage } = fixture();
    r.render([row('A', .4), row('B', .6)], 0);
    r.render([row('B', .6)], 1);
    assert.equal(container.children[0].dataset.state, 'dropped');
    assert.equal(container.children[1].style.gridRow, '2');
    r.render([row('B', .6)], 182);
    assert.equal(container.children[0].hidden, true);
    r.render([row('B', .6), row('C', .7)], 183);
    assert.equal(container.children[0].dataset.candidateId, 'C');
    assert.equal(container.children[1].dataset.candidateId, 'B');
    r.render([], 184, { enabled: false });
    assert.equal(container.hidden, true); assert.equal(overlay.hidden, true);
    assert.equal(stage.classList.contains('r2-candidate-mode'), false);
    assert.ok(container.children.every((e) => e.hidden));
  } finally { globalThis.Path2D = old; }
});

test('지원하지 않는 타입/사영은 꾸며 그리지 않고 정정은 해당 후보에만 칠해요', () => {
  const old = globalThis.Path2D; globalThis.Path2D = Path;
  try {
    const { renderer: r, container, overlay } = fixture();
    r.render([row('C', .99, { type: 'C' }), row('Y', .5, { H: null })], 0);
    assert.equal(container.dataset.leaderId, 'Y');
    assert.equal(container.children.filter((e) => !e.hidden).length, 1);
    assert.equal(overlay.context.calls.length, 0);
    r.render([row('Y', .5)], 1, { correction: { candidateId: 'OTHER', cells: [0] } });
    assert.ok(!overlay.context.calls.some((c) => c.color === '#ff00ff'));
    r.accept('Y', 2);
    r.render([row('Y', .5)], 2, { correction: { candidateId: 'Y', cells: [0] } });
    assert.ok(overlay.context.calls.some((c) => c.color === '#ff00ff'));
    assert.equal(container.children[0].dataset.state, 'success');
  } finally { globalThis.Path2D = old; }
});

test('생산자가 명시한 C 육각과 3D Y face-H만 소비하고 정정 revision을 정확히 맞춰요', () => {
  const old = globalThis.Path2D; globalThis.Path2D = Path;
  try {
    const { renderer: r, container, overlay } = fixture();
    const source = syntheticC(0);
    const bound = R2_TYPE_C_PROFILE.bind({ profile: 'C', layoutId: 'C0', dimension: source.k,
      ecc: 'M', wire: 1, tones: 3, maskIndex: 0, orientation: 0, sourceIdentity: 'hud-render-test' });
    const c = { id: 'C', revision: 4, type: 'C', geometryMode: 'c-hex', k: source.k, n: source.k,
      dimensionKind: 'radius-k', H: source.H, cellCount: bound.cellCount, cellCoord: Int32Array.from(bound.cellCoord),
      cellMap: new Uint8Array(bound.cellCount).fill(2), D: .9, tracking: true, retained: false, alive: true,
      frameWidth: source.field.width, frameHeight: source.field.height };
    r.render([c], 0, { correction: { candidateId: 'C', revision: 3, cells: [0] } });
    assert.equal(container.children[0].dataset.candidateId, 'C');
    assert.ok(!overlay.context.calls.some((call) => call.color === '#ff00ff'), '이전 revision 정정은 재사용하지 않는다');
    r.render([c], 1, { correction: { candidateId: 'C', revision: 4, cells: [0] } });
    assert.ok(overlay.context.calls.some((call) => call.color === '#ff00ff'));
    const branch = enumerateCubeFaceGeometry(hexCorners(0, 0, { size: 120, originX: 180, originY: 180 })).find((entry) => entry.ok);
    const y3d = row('Y3D', .6, { geometryMode: 'y-faces', revision: 1, faceHs: branch.faceHs, H: null });
    r.render([y3d], 2);
    assert.ok(container.children.some((card) => card.dataset.candidateId === 'Y3D'));
    assert.ok(overlay.context.calls.some((call) => call.op === 'stroke'), 'face-H는 own H 없이도 실제 사영 윤곽을 그린다');
  } finally { globalThis.Path2D = old; }
});

test('Y role-grid는 cell index, tone-grid는 동일 마름모 slot으로 읽어요', () => {
  const old = globalThis.Path2D; globalThis.Path2D = Path;
  try {
    const seen = [];
    const { container, overlay, stage } = fixture();
    const renderer = createCandidateHudRenderer({ container, overlay, stage, labelFor: (key) => key,
      paintFor(role, _state, tone) { seen.push([role, tone]); return { color: `${role}/${tone}`, alpha: 1 }; } });
    const candidate = row('tones', .8);
    const geometry = candidateHudGeometry(candidate);
    const expected = [];
    for (let cell = 0; cell < geometry.count; cell += 1) for (let face = 0; face < 3; face += 1) {
      const role = geometry.roleGrid[cell];
      if (role !== HUD_ROLE.EMPTY) expected.push([role, geometry.toneGrid[candidateHudQuadSlot(geometry, cell, face) / 8] === HUD_TONE_NONE
        ? null : geometry.toneGrid[candidateHudQuadSlot(geometry, cell, face) / 8]]);
    }
    renderer.render([candidate], 0);
    assert.deepEqual(seen.slice(0, expected.length), expected);
    assert.ok(expected.some(([, tone]) => tone !== null), '실제 role grid에 face별 tone이 있어야 한다');
  } finally { globalThis.Path2D = old; }
});

test('정지 Y는 canonical과 image 기하 버퍼를 재사용하고 H 변경 때만 image 기하를 갱신해요', () => {
  const old = globalThis.Path2D; globalThis.Path2D = Path;
  try {
    const { renderer } = fixture();
    const candidate = row('cache', .8, { revision: 1 });
    renderer.render([candidate], 0);
    const first = renderer.cacheStats;
    renderer.render([candidate], 1);
    assert.deepEqual(renderer.cacheStats, first);
    candidate.H = [...candidate.H]; candidate.H[2] += 1;
    renderer.render([candidate], 2);
    assert.equal(renderer.cacheStats.canonicalBuilds, first.canonicalBuilds);
    assert.equal(renderer.cacheStats.frameBuilds, first.frameBuilds + 1);
  } finally { globalThis.Path2D = old; }
});

test('후보 HUD 성공 유예는 정정 유무와 무관한 150ms 한 번이며 R1/QR은 즉시예요', () => {
  for (const correctedCount of [0, 1, 5]) {
    assert.equal(acceptStopDelayMs({ engineR2: true, candidateHud: true, correctedCount }), R2_CANDIDATE_SUCCESS_MS);
  }
  assert.equal(acceptStopDelayMs({ engineR2: false, candidateHud: true, correctedCount: 5 }), 0);
  const calls = []; let fire; let timerDelay;
  const gate = createAcceptStopGate({ setTimer(fn, delay) { fire = fn; timerDelay = delay; return 1; }, clearTimer() {} });
  const model = createCandidateHudModel();
  model.update([row('A', 1)], 0);
  assert.equal(model.slots[0].status, 'active', '누적률만으로 성공 표시를 켜지 않아요');
  model.accept('A', 0);
  calls.push(model.slots[0].status);
  function stop() { const action = gate.take(); model.reset(); calls.push('stop'); action?.(); }
  assert.equal(gate.arm(acceptStopDelayMs({ engineR2: true, candidateHud: true }), () => calls.push('action'), stop), true);
  assert.equal(timerDelay, 150);
  assert.equal(gate.arm(150, () => calls.push('second'), stop), false);
  fire();
  assert.deepEqual(calls, ['success', 'stop', 'action']);
  assert.equal(gate.take(), null);
});
