/**
 * r2-hud-geometry.test.js — HUD 사영 기하의 자.
 *
 * 무엇을 재나: 「HUD 가 그리는 자리」가 **정합이 실제로 본 자리**와 같은가.
 * 그래서 기대값을 손으로 적지 않는다 — 전부 `src/ygrid.js`(면 격자 원본)와
 * `src/hexgrid.js`(실루엣 원본)에서 유도하고, 마지막 자는 **어댑터 자신**과 대조한다.
 *
 * ⚠ 사본 목록 금지: 면 라벨·꼭짓점 순서·코너 개수는 원본 배열에서 온다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { YFACES, moduleQuad } from '../src/ygrid.js';
import {
  HUD_FACES,
  projectPointInto,
  faceQuadCount,
  faceQuadFloats,
  faceQuadSlot,
  projectFaceQuadsInto,
  gridLineCount,
  gridLineFloats,
  projectGridLinesInto,
  projectOutlineInto,
  finiteBoundsInto,
} from '../src/r2/hud-geometry.js';

const IDENTITY = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const NS = [13, 21, 25];

/** 시드 고정 난수 (mulberry32) — 「임의 H」가 재현 가능해야 실패를 다시 볼 수 있다. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 회전 + 비등방 스케일 + 이동 아핀 H. */
function affineH(theta, sx, sy, tx, ty) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return new Float64Array([
    sx * c, -sx * s, tx,
    sy * s, sy * c, ty,
    0, 0, 1,
  ]);
}

function randomAffines(seed, count) {
  const r = rng(seed);
  const out = [];
  for (let k = 0; k < count; k += 1) {
    out.push(affineH(
      (r() - 0.5) * Math.PI,
      2 + r() * 10,
      2 + r() * 10,
      (r() - 0.5) * 400,
      (r() - 0.5) * 400,
    ));
  }
  return out;
}

/** 완만한 사영 H (H6, H7 ≠ 0) — 육각 범위에서 w 가 부호를 바꾸지 않을 만큼 작게. */
function perspectiveH(base, h6, h7) {
  const H = new Float64Array(base);
  H[6] = h6;
  H[7] = h7;
  return H;
}

const P2 = new Float64Array(2);
function projected(H, x, y) {
  projectPointInto(H, x, y, P2, 0);
  return [P2[0], P2[1]];
}

const key = (x, y) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;

test('HUD_FACES 는 ygrid.YFACES 와 같은 면 순서다 (어댑터 면 인덱스 0/1/2)', () => {
  assert.deepEqual([...HUD_FACES], [...YFACES]);
});

test('(i) 항등 H — 모든 (face,i,j) 마름모 4점이 ygrid.moduleQuad 와 같다', () => {
  for (const n of NS) {
    const out = new Float64Array(faceQuadFloats(n));
    const wrote = projectFaceQuadsInto(IDENTITY, n, out);
    assert.equal(wrote, faceQuadCount(n));
    assert.equal(wrote, n * n * HUD_FACES.length);

    for (let f = 0; f < HUD_FACES.length; f += 1) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const expect = moduleQuad(HUD_FACES[f], i, j, { size: 1 });
          const slot = faceQuadSlot(n, f, i, j);
          for (let c = 0; c < 4; c += 1) {
            assert.ok(Math.abs(out[slot + c * 2] - expect[c].x) < 1e-9,
              `n=${n} ${HUD_FACES[f]}(${i},${j}) v${c}.x`);
            assert.ok(Math.abs(out[slot + c * 2 + 1] - expect[c].y) < 1e-9,
              `n=${n} ${HUD_FACES[f]}(${i},${j}) v${c}.y`);
          }
        }
      }
    }
  }
});

test('(ii) 임의 아핀·완만한 사영 H — 마름모 4점 == moduleQuad 점을 사영한 값', () => {
  const n = 13;
  const hs = randomAffines(0xa11ce, 3);
  hs.push(perspectiveH(hs[0], 3e-4, -2e-4));
  const out = new Float64Array(faceQuadFloats(n));

  for (const H of hs) {
    projectFaceQuadsInto(H, n, out);
    for (let f = 0; f < HUD_FACES.length; f += 1) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const quad = moduleQuad(HUD_FACES[f], i, j, { size: 1 });
          const slot = faceQuadSlot(n, f, i, j);
          for (let c = 0; c < 4; c += 1) {
            const [px, py] = projected(H, quad[c].x, quad[c].y);
            assert.ok(Number.isFinite(px) && Number.isFinite(py), '사영이 유한해야 한다');
            assert.ok(Math.abs(out[slot + c * 2] - px) < 1e-9);
            assert.ok(Math.abs(out[slot + c * 2 + 1] - py) < 1e-9);
          }
        }
      }
    }
  }
});

test('(ii-b) 격자선 끝점도 같은 사영식을 따른다 (canonical 끝점을 직접 사영한 값)', () => {
  const n = 21;
  const hs = randomAffines(0xbeef, 2);
  hs.push(perspectiveH(hs[0], -2.5e-4, 1.5e-4));
  const lines = new Float64Array(gridLineFloats(n));

  for (const H of hs) {
    const wrote = projectGridLinesInto(H, n, lines);
    assert.equal(wrote, gridLineCount(n));

    // 기대값도 ygrid 기저에서 유도한다 — 끝점은 마름모 격자의 격자점이다.
    let slot = 0;
    for (const face of HUD_FACES) {
      for (let k = 0; k <= n; k += 1) {
        // a=k 선: (k,0)→(k,n) 은 (i=k-1 열의) 격자점, moduleQuad 로 유도
        const ends = [
          gridPoint(face, k, 0), gridPoint(face, k, n),
          gridPoint(face, 0, k), gridPoint(face, n, k),
        ];
        for (let e = 0; e < 4; e += 1) {
          const [px, py] = projected(H, ends[e].x, ends[e].y);
          assert.ok(Math.abs(lines[slot + e * 2] - px) < 1e-9, `${face} k=${k} e=${e}.x`);
          assert.ok(Math.abs(lines[slot + e * 2 + 1] - py) < 1e-9, `${face} k=${k} e=${e}.y`);
        }
        slot += 8;
      }
    }
  }
});

/**
 * canonical 격자점 (a,b) — ygrid.moduleQuad 에서 **유도**한다(기저 사본 금지).
 * moduleQuad(face, i, j)[0] 이 곧 격자점 (i,j) 다.
 */
function gridPoint(face, a, b) {
  return moduleQuad(face, a, b, { size: 1 })[0];
}

test('(iii) 격자선 끝점 집합 ⊆ 마름모 꼭짓점 집합 · 선분 수가 맞다', () => {
  for (const n of NS) {
    const H = randomAffines(0xc0ffee, 1)[0];

    const quads = new Float64Array(faceQuadFloats(n));
    projectFaceQuadsInto(H, n, quads);
    const corners = new Set();
    for (let k = 0; k < faceQuadCount(n) * 4; k += 1) {
      corners.add(key(quads[k * 2], quads[k * 2 + 1]));
    }

    const lines = new Float64Array(gridLineFloats(n));
    const segs = projectGridLinesInto(H, n, lines);
    assert.equal(segs, gridLineCount(n));
    assert.equal(segs, 3 * 2 * (n + 1));

    for (let s = 0; s < segs; s += 1) {
      for (let e = 0; e < 2; e += 1) {
        const k = key(lines[s * 4 + e * 2], lines[s * 4 + e * 2 + 1]);
        assert.ok(corners.has(k),
          `n=${n} 선분 ${s} 끝점 ${e} 가 마름모 꼭짓점 집합에 없다`);
      }
    }
  }
});

test('(iv) 외곽 6점 == CORNER_UNIT_OFFSETS×n 사영 · 실루엣이 면 격자 꼭짓점 안에 있다', () => {
  for (const n of NS) {
    const H = randomAffines(0xd15ea5e, 1)[0];
    const outline = new Float64Array(12);
    const wrote = projectOutlineInto(H, n, outline);
    assert.equal(wrote, CORNER_UNIT_OFFSETS.length);
    assert.equal(wrote, 6);

    for (let c = 0; c < CORNER_UNIT_OFFSETS.length; c += 1) {
      const [px, py] = projected(H, CORNER_UNIT_OFFSETS[c].x * n, CORNER_UNIT_OFFSETS[c].y * n);
      assert.ok(Math.abs(outline[c * 2] - px) < 1e-9);
      assert.ok(Math.abs(outline[c * 2 + 1] - py) < 1e-9);
    }

    // 세 면 마름모 격자가 육각 실루엣을 «덮는다» — 6 꼭짓점이 모두 격자점이다.
    const quads = new Float64Array(faceQuadFloats(n));
    projectFaceQuadsInto(H, n, quads);
    const corners = new Set();
    for (let k = 0; k < faceQuadCount(n) * 4; k += 1) {
      corners.add(key(quads[k * 2], quads[k * 2 + 1]));
    }
    for (let c = 0; c < 6; c += 1) {
      assert.ok(corners.has(key(outline[c * 2], outline[c * 2 + 1])),
        `n=${n} 실루엣 코너 ${c} 가 면 격자 꼭짓점이 아니다`);
    }
  }
});

test('(v) 어댑터 일치 — projectCellFaceCentres 의 면 중심 == 같은 마름모 4점 평균', async () => {
  const adapterMod = await import('../src/r2/adapter-locator.js');
  const cellMod = await import('../src/cellSurfaceFinal.js');
  const n = 13;
  const H = affineH(0.37, 6.5, 5.25, 320, 240);

  const adapters = adapterMod.createA3Adapters({ n });
  adapters.installHomography(H, n, undefined);
  assert.equal(adapters.stats.locked, 1, '락이 설치돼야 한다 — 아니면 자가 공허하다');

  const scan = cellMod.dataCellsInScanOrderCellSurfaceFinal(n, undefined);
  assert.ok(scan.length > 0, '스캔 순서가 비었다 — 자가 잴 게 없다');

  const centres = new Float64Array(scan.length * 6);
  const mapped = adapters.projectCellFaceCentres(centres, scan.length);
  assert.equal(mapped, scan.length, '모든 데이터 셀이 사영돼야 한다');

  const quads = new Float64Array(faceQuadFloats(n));
  projectFaceQuadsInto(H, n, quads);

  for (let cell = 0; cell < scan.length; cell += 1) {
    const { i, j } = scan[cell];
    for (let f = 0; f < HUD_FACES.length; f += 1) {
      const slot = faceQuadSlot(n, f, i, j);
      let cx = 0;
      let cy = 0;
      for (let c = 0; c < 4; c += 1) {
        cx += quads[slot + c * 2];
        cy += quads[slot + c * 2 + 1];
      }
      cx /= 4;
      cy /= 4;
      // 아핀 H 면 「평균의 사영」 == 「사영의 평균」이라 정확히 같아야 한다.
      assert.ok(Math.abs(centres[cell * 6 + f * 2] - cx) < 1e-6,
        `셀 ${cell}(${i},${j}) 면 ${HUD_FACES[f]} x`);
      assert.ok(Math.abs(centres[cell * 6 + f * 2 + 1] - cy) < 1e-6,
        `셀 ${cell}(${i},${j}) 면 ${HUD_FACES[f]} y`);
    }
  }
});

test('(vi) 버퍼 계약 — 짧으면 RangeError · 재사용해도 같은 결과 · 새 배열을 안 만든다', () => {
  const n = 13;
  assert.throws(() => projectFaceQuadsInto(IDENTITY, n, new Float64Array(faceQuadFloats(n) - 1)),
    RangeError);
  assert.throws(() => projectGridLinesInto(IDENTITY, n, new Float64Array(gridLineFloats(n) - 1)),
    RangeError);
  assert.throws(() => projectOutlineInto(IDENTITY, n, new Float64Array(11)), RangeError);
  assert.throws(() => finiteBoundsInto(new Float64Array(4), 2, new Float64Array(3)), RangeError);

  const H = randomAffines(0xfeed, 1)[0];
  const out = new Float64Array(faceQuadFloats(n));
  const r1 = projectFaceQuadsInto(H, n, out);
  const first = Float64Array.from(out);
  const r2 = projectFaceQuadsInto(H, n, out);
  assert.equal(typeof r1, 'number');
  assert.equal(typeof r2, 'number');
  assert.equal(r1, r2);
  assert.deepEqual([...out], [...first], '같은 버퍼를 두 번 채워도 결과가 같아야 한다');

  // 반환값은 «수» 다 — 새 배열을 만들어 돌려주면 핫 경로 할당 0 이 깨진다.
  const lines = new Float64Array(gridLineFloats(n));
  const outline = new Float64Array(12);
  for (const v of [
    projectGridLinesInto(H, n, lines),
    projectOutlineInto(H, n, outline),
    projectPointInto(H, 1, 2, out, 0),
    faceQuadCount(n), faceQuadFloats(n), gridLineCount(n), gridLineFloats(n),
    faceQuadSlot(n, 0, 1, 2),
  ]) {
    assert.equal(typeof v, 'number');
  }
  assert.equal(typeof finiteBoundsInto(first, 4, new Float64Array(4)), 'boolean');
});

test('(vii) w≈0 은 NaN 두 칸 · finiteBoundsInto 가 그것을 제외한다 · 전부 NaN 이면 false', () => {
  // H6·H7 = 0 이고 H8 = 0 이면 모든 점의 w 가 0 이다.
  const degenerate = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 0]);
  const p = new Float64Array(2);
  assert.equal(projectPointInto(degenerate, 3, 4, p, 0), 0);
  assert.ok(Number.isNaN(p[0]) && Number.isNaN(p[1]));

  // 한 점만 w=0 이 되는 사영 H: w = x + 1 → x = -1 에서 0.
  const H = new Float64Array([1, 0, 0, 0, 1, 0, 1, 0, 1]);
  const pts = new Float64Array(6);
  assert.equal(projectPointInto(H, 0, 0, pts, 0), 1);
  assert.equal(projectPointInto(H, -1, 5, pts, 2), 0);
  assert.equal(projectPointInto(H, 1, 2, pts, 4), 1);
  assert.ok(Number.isNaN(pts[2]) && Number.isNaN(pts[3]));

  const b = new Float64Array(4);
  assert.equal(finiteBoundsInto(pts, 3, b), true);
  for (const v of b) assert.ok(Number.isFinite(v), '경계상자에 NaN 이 새면 안 된다');
  assert.equal(b[0], Math.min(pts[0], pts[4]));
  assert.equal(b[2], Math.max(pts[0], pts[4]));

  const allNaN = new Float64Array([NaN, NaN, NaN, NaN]);
  const b2 = new Float64Array([1, 2, 3, 4]);
  assert.equal(finiteBoundsInto(allNaN, 2, b2), false);
  assert.deepEqual([...b2], [1, 2, 3, 4], 'false 면 out4 를 건드리지 않는다');
});
