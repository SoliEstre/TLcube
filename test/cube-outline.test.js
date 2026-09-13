import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cubeOutlineShapes, CUBE_OUTLINE_COLOR, CUBE_OUTLINE_WIDTH,
} from '../src/cube-outline.js';

const square = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

function endpoints(shape) {
  const pts = shape.points;
  const mx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const my = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const along = [
    { x: (pts[0].x + pts[3].x) / 2, y: (pts[0].y + pts[3].y) / 2 },
    { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 },
  ];
  return { mx, my, along };
}

test('동일 변은 한 번만 그리고 입력은 그대로예요', () => {
  const a = { points: square.map((p) => ({ ...p })) };
  const b = { points: square.map((p) => ({ ...p })) };
  const snapshot = JSON.stringify(a);
  const shapes = cubeOutlineShapes([a, b]);
  assert.equal(shapes.length, 4);
  assert.equal(JSON.stringify(a), snapshot);
  a.points[0].x = 99;
  assert.equal(shapes[0].points.some((p) => p.x === 99), false);
});

test('퇴화·비유한 변은 건너뛰어요', () => {
  const collapsed = [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }];
  assert.deepEqual(cubeOutlineShapes([{ points: collapsed }]), []);
  const nanQuad = [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.deepEqual(cubeOutlineShapes([{ points: nanQuad }]), []);
  assert.deepEqual(cubeOutlineShapes([{ points: square }], { width: 0 }), []);
  assert.deepEqual(cubeOutlineShapes(null), []);
});

test('한 면의 네 변은 닫힌 외곽이고 폭·색이 계약과 같아요', () => {
  const shapes = cubeOutlineShapes([{ points: square }]);
  assert.equal(shapes.length, 4);
  for (const shape of shapes) {
    assert.equal(shape.kind, 'polygon');
    assert.deepEqual(shape.color, { r: 34, g: 34, b: 34 });
    assert.equal(shape.color.r, CUBE_OUTLINE_COLOR.r);
    const pts = shape.points;
    assert.equal(pts.length, 4);
    const w0 = Math.hypot(pts[0].x - pts[3].x, pts[0].y - pts[3].y);
    const w1 = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y);
    assert.ok(Math.abs(w0 - CUBE_OUTLINE_WIDTH) < 1e-9);
    assert.ok(Math.abs(w1 - CUBE_OUTLINE_WIDTH) < 1e-9);
  }
  const mids = shapes.map((shape) => {
    const pts = shape.points;
    return {
      x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4,
      y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4,
    };
  });
  const expected = [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];
  for (const e of expected) {
    assert.ok(mids.some((m) => Math.hypot(m.x - e.x, m.y - e.y) < 1e-6));
  }
});

test('세 면 큐브는 외곽 6변과 Y 심지 3변을 합쳐 9개예요', () => {
  const t = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  const l = [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: -1, y: 3 }, { x: -1, y: 1 }];
  const r = [{ x: 0, y: 0 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }];
  const shapes = cubeOutlineShapes([
    { points: t },
    { points2d: l },
    r,
  ]);
  assert.equal(shapes.length, 9);
  const custom = cubeOutlineShapes([{ points: t }], { width: 0.1, color: { r: 34, g: 34, b: 34 } });
  assert.equal(custom.length, 4);
  const w = Math.hypot(custom[0].points[0].x - custom[0].points[3].x, custom[0].points[0].y - custom[0].points[3].y);
  assert.ok(Math.abs(w - 0.1) < 1e-9);
});
