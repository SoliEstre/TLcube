import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY } from '../src/sceneY.js';
import { buildOrbitMesh, paintQuads } from '../src/y3d-viewer.js';
import { slotQrFaceQuads } from '../src/y3d-slot-qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { layoutForCube, faceBasis } from '../src/ygrid.js';
import {
  CENTER_QR_MODULE_GRID, CENTER_QR_QUIET_MODULES, centerQrSlotCellsFor,
} from '../src/cellSurfaceFinal.js';

/*
 * 3D 미리보기의 슬롯 QR — 운영자 신고 2026-09-01 「안쪽 QR 은 QR 이 표시 안 됨」.
 *
 * 🔴 **여기서 재는 것은 «그려진다» 가 아니라 «2.5D 와 같은 그림이냐» 다.**
 *    두 렌더러가 같은 슬롯을 각자 그리므로, 도형을 세는 테스트만 두면 뒤집기(flip)나
 *    피치가 한쪽에서만 바뀌어도 초록으로 통과한다 — 이 프로젝트에서 반복된 실패다.
 *    §4 가 슬롯 전면(29×29 모듈 격자)을 두 렌더에서 **전수 대조**한다.
 */

const PAYLOAD = 'HTTPS://TLSCAN.ESTRE.SO';
const QR_TEXT = 'HTTPS://TLSCAN.ESTRE.SO';
const SLOT_LAYOUTS = ['v0trq', 'v0ty', 'v0try'];
const PLAIN_LAYOUTS = ['v0', 'v0t', 'v0tr'];
const SPAN = CENTER_QR_MODULE_GRID + 2 * CENTER_QR_QUIET_MODULES; // 29
const MARGIN = 40; // locatorPad 보다 확실히 커서 sceneY 의 margin 해석이 이 값을 쓴다.

const preset = getPreset(DEFAULT_PRESET);
/*
 * 생성기의 `paletteOf` 와 **같은 모양**으로 조립한다 — 프리셋(`getPreset`) 자체에는
 * 파인더 축(bullseyeLight/Dark)이 없다. 그걸 빼면 둘 다 undefined 가 되어 «다크와
 * 콰이어트가 같다» 는 무의미한 초록이 난다 (실제로 났다 — 841/841 이 전부 다크).
 */
/** 면 게인 없음 — 3D 뷰어에는 게인 축 자체가 없다 (모듈 주석 §면 게인). */
const palette = {
  levels: preset.levels,
  background: preset.background,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: { T: 1, L: 1, R: 1 },
};

function encodeFor(layoutId) {
  // v0 는 n=13 · 용량 20 B 라 긴 URL 이 안 들어간다 — 대조군은 짧은 걸 쓴다.
  return encodeY(layoutId === 'v0' ? 'TL' : PAYLOAD, {
    cellSurface: true,
    cellSurfaceLayout: layoutId,
    tones: 3,
    eccLevel: 'H',
    version: layoutId === 'v0' ? 0 : 1,
  });
}

function quadsFor(layoutId) {
  const encoded = encodeFor(layoutId);
  return {
    encoded,
    quads: slotQrFaceQuads({
      layoutId, n: encoded.n, qrText: QR_TEXT, palette,
    }),
  };
}

test('① 기준선 — 콰이어트 판 1 + 다크 모듈 N + L/R 채움 2 (2.5D 와 같은 구성)', () => {
  for (const id of SLOT_LAYOUTS) {
    const { quads } = quadsFor(id);
    const side = centerQrSlotCellsFor(id);
    const tFace = quads.filter((q) => q.face === 'T');
    assert.equal(quads.filter((q) => q.face === 'L').length, 1, `${id} L 면`);
    assert.equal(quads.filter((q) => q.face === 'R').length, 1, `${id} R 면`);

    // 🔴 순서가 계약이다 — 판이 **먼저** 나와야 다크가 그 위에 얹힌다.
    assert.equal(quads[0].face, 'T', `${id} 첫 도형이 T 판이 아니다`);
    assert.equal(quads[0].color, palette.bullseyeLight, `${id} 첫 도형이 콰이어트가 아니다`);
    assert.equal(quads[0].size, side, `${id} 판이 슬롯 전체를 안 덮는다`);

    const dark = tFace.filter((q) => q.color === palette.bullseyeDark);
    assert.equal(dark.length, tFace.length - 1, `${id} 판 말고는 전부 다크여야 한다`);
    // 다크가 0 이거나 격자를 꽉 채우면 QR 이 아니라 단색 판이다 — 한 값으로 몰리면
    // 자를 의심하라. QR v1 의 다크 비율은 대략 40\~55% 다.
    assert.ok(
      dark.length > CENTER_QR_MODULE_GRID ** 2 * 0.3
      && dark.length < CENTER_QR_MODULE_GRID ** 2 * 0.7,
      `${id} 다크 모듈 수가 ${dark.length} 로 몰렸다`,
    );
  }
});

test('② 대조군 — 슬롯 없는 레이아웃·빈 qrText 는 빈 배열 (구멍을 안 만든다)', () => {
  for (const id of PLAIN_LAYOUTS) {
    const encoded = encodeFor(id);
    assert.deepEqual(
      slotQrFaceQuads({ layoutId: id, n: encoded.n, qrText: QR_TEXT, palette }), [],
      `${id} 는 슬롯이 없다`,
    );
  }
  const { encoded } = quadsFor('v0trq');
  assert.deepEqual(slotQrFaceQuads({ layoutId: 'v0trq', n: encoded.n, palette }), []);
  // QR v1 알파뉴메릭 밖 문자 — 미리보기가 **던지지 않고** 조용히 생략한다.
  assert.deepEqual(
    slotQrFaceQuads({ layoutId: 'v0trq', n: encoded.n, qrText: 'tl.estre.so 소문자', palette }), [],
  );
});

test('③ 기하 — 다크 모듈은 겹치지 않고 콰이어트 테두리를 침범하지 않는다', () => {
  for (const id of SLOT_LAYOUTS) {
    const { quads } = quadsFor(id);
    const side = centerQrSlotCellsFor(id);
    const pitch = side / SPAN;
    const patch = quads[0];
    const dark = quads.filter((q) => q.face === 'T' && q.color === palette.bullseyeDark);
    const seen = new Set();
    for (const q of dark) {
      assert.ok(Math.abs(q.size - pitch) < 1e-12, `${id} 모듈 크기`);
      const u = Math.round((q.a - patch.a) / pitch);
      const v = Math.round((q.b - patch.b) / pitch);
      const key = `${u},${v}`;
      assert.ok(!seen.has(key), `${id} 모듈 겹침: ${key}`);
      seen.add(key);
      // 콰이어트 테두리(4모듈)를 침범하면 QR 리더가 심볼을 못 찾는다.
      assert.ok(
        u >= CENTER_QR_QUIET_MODULES && u < SPAN - CENTER_QR_QUIET_MODULES
        && v >= CENTER_QR_QUIET_MODULES && v < SPAN - CENTER_QR_QUIET_MODULES,
        `${id} 모듈 (${u},${v}) 이 콰이어트 테두리를 침범한다`,
      );
    }
    assert.equal(seen.size, dark.length);
  }
});

// ── §4 두 렌더 대조 ────────────────────────────────────────────────────────

function pointOf(face, a, b, layout) {
  const { ei, ej } = faceBasis(face);
  return {
    x: layout.originX + (a * ei.x + b * ej.x) * layout.size,
    y: layout.originY + (a * ei.y + b * ej.y) * layout.size,
  };
}

function inPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const yi = pts[i].y; const yj = pts[j].y;
    if ((yi > p.y) !== (yj > p.y)) {
      const x = pts[i].x + ((p.y - yi) / (yj - yi)) * (pts[j].x - pts[i].x);
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** painter 순서 — 마지막으로 그 점을 덮는 도형이 화면 색이다. */
function colorAt(shapes, p) {
  for (let k = shapes.length - 1; k >= 0; k -= 1) {
    const s = shapes[k];
    if (Array.isArray(s.points) && inPolygon(p, s.points)) return s.color;
  }
  return null;
}

test('④ 🔴 2.5D 와 같은 그림 — 슬롯 29×29 전수 대조 (flip·피치·원점을 다 잠근다)', () => {
  for (const id of SLOT_LAYOUTS) {
    const { encoded, quads } = quadsFor(id);
    const scene = buildSceneY(encoded, {
      palette, qrText: QR_TEXT, cellSize: 1, margin: MARGIN,
    });
    const layout = layoutForCube(encoded.n, { size: 1, margin: MARGIN });
    const patch = quads[0];
    const pitch = centerQrSlotCellsFor(id) / SPAN;

    // 3D 가 «여기는 다크» 라고 말한 자리들.
    const darkSet = new Set(quads
      .filter((q) => q.face === 'T' && q.color === palette.bullseyeDark)
      .map((q) => `${Math.round((q.a - patch.a) / pitch)},${Math.round((q.b - patch.b) / pitch)}`));

    let darkChecked = 0;
    let lightChecked = 0;
    for (let v = 0; v < SPAN; v += 1) {
      for (let u = 0; u < SPAN; u += 1) {
        const expected = darkSet.has(`${u},${v}`) ? palette.bullseyeDark : palette.bullseyeLight;
        const p = pointOf('T', patch.a + (u + 0.5) * pitch, patch.b + (v + 0.5) * pitch, layout);
        const got = colorAt(scene.shapes, p);
        assert.ok(got !== null, `${id}: 2.5D 가 모듈 (${u},${v}) 를 안 덮는다`);
        for (const ch of ['r', 'g', 'b']) {
          assert.ok(
            Math.abs(got[ch] - expected[ch]) <= 1,
            `${id} 모듈 (${u},${v}) 채널 ${ch}: 2.5D ${got[ch]} vs 3D ${expected[ch]}`,
          );
        }
        if (expected === palette.bullseyeDark) darkChecked += 1; else lightChecked += 1;
      }
    }
    // 한쪽만 검사됐으면 «일치» 가 공허하다.
    assert.ok(darkChecked > 100, `${id} 다크 표본 ${darkChecked}`);
    assert.ok(lightChecked > 100, `${id} 콰이어트 표본 ${lightChecked}`);
  }
});

test('⑤ 3D 메시에 실린다 — overlay 가 방출 순서를 지키고 셀보다 나중에 칠해진다', () => {
  const { encoded, quads } = quadsFor('v0trq');
  const digitAt = (i, j) => {
    const c = encoded.cellDigits.get(`${i},${j}`);
    return c ? c.digit : null;
  };
  const levelAt = (i, j, face) => {
    const c = encoded.cellDigits.get(`${i},${j}`);
    if (!c || !c.tones) return null;
    return Number.isInteger(c.tones[face]) ? c.tones[face] : null;
  };
  const layout = layoutForCube(encoded.n, { size: 1, margin: 0.25 });
  const mesh = buildOrbitMesh({
    n: encoded.n,
    tones: 3,
    levels: preset.levels,
    layout,
    digitAt,
    levelAt,
    faceQuads: quads,
    includeBack: true,
  });
  const overlays = mesh.quads.filter((q) => q.kind === 'overlay');
  assert.equal(overlays.length, quads.length, 'faceQuads 가 전부 실려야 한다');

  // 🔴 순서 보존 — 판이 다크보다 **먼저** 칠해져야 한다. 정렬이 depth 로 섞으면
  //    완전 동일 평면이라 다크가 판 뒤로 밀려 QR 이 통째로 사라진다.
  const tOverlays = overlays.filter((q) => q.face === 'T');
  assert.equal(tOverlays[0].color, palette.bullseyeLight, 'T 오버레이 첫 장이 판이 아니다');
  assert.ok(
    tOverlays.slice(1).every((q) => q.color === palette.bullseyeDark),
    '판 뒤로 다크만 와야 한다 — 정렬이 순서를 섞었다',
  );

  // 정렬 계약: 마주 본 무리(facing < 0) 안에서 overlay 는 non-overlay 뒤에 온다.
  const facing = mesh.quads.filter((q) => q.facing < 0);
  const lastPlain = facing.reduce((acc, q, k) => (q.kind === 'overlay' ? acc : k), -1);
  const firstOverlay = facing.findIndex((q) => q.kind === 'overlay');
  assert.ok(firstOverlay >= 0, '보이는 면에 overlay 가 하나도 없다');
  assert.ok(
    firstOverlay > lastPlain,
    `overlay 가 셀보다 먼저 칠해진다 (first ${firstOverlay} vs lastPlain ${lastPlain})`,
  );

  // 대조 — faceQuads 없이 부르면 종전과 같다 (새 축이 기본 동작을 안 건드린다).
  const bare = buildOrbitMesh({
    n: encoded.n,
    tones: 3,
    levels: preset.levels,
    layout,
    digitAt,
    levelAt,
    includeBack: true,
  });
  assert.equal(bare.quads.filter((q) => q.kind === 'overlay').length, 0);
  assert.equal(bare.quads.length, mesh.quads.length - quads.length);
});

test('⑥ 오버레이는 테두리를 안 긋는다 — 얇은 모듈이 검은 실선에 먹히면 QR 이 죽는다', () => {
  // 운영자 2026-09-01 「QR이 좀 어두운데? 배경까지?」 — 캔버스에 순백이 **0 픽셀**이었다.
  // 원인은 paintQuads 가 quad 마다 긋는 rgba(0,0,0,0.35) 0.6px 테두리다. 셀(≈8px)에는
  // 격자 구분이지만 QR 모듈(≈2px)에는 면적의 절반이다. 여기서 그 계약을 잠근다.
  const { encoded, quads } = quadsFor('v0trq');
  const layout = layoutForCube(encoded.n, { size: 1, margin: 0.25 });
  const mesh = buildOrbitMesh({
    n: encoded.n,
    tones: 3,
    levels: preset.levels,
    layout,
    digitAt: () => null,
    levelAt: () => null,
    faceQuads: quads,
    includeBack: false,
  });
  // 셀이 하나도 없는 메시라(digitAt/levelAt 이 null) 그려지는 것은 오버레이뿐이다.
  assert.equal(mesh.quads.length, quads.length, '이 메시는 오버레이만 있어야 한다');

  const strokes = [];
  const fills = [];
  const ctx = {
    canvas: { width: 400, height: 400 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fillRect() {},
    fill() { fills.push(this.fillStyle); },
    stroke() { strokes.push(this.strokeStyle); },
  };
  paintQuads(ctx, mesh, { layout, background: preset.background });
  // 배경 fillRect 1회는 fills 에 안 들어간다 (fill() 만 센다).
  assert.equal(fills.length, quads.length, '오버레이가 전부 칠해져야 한다');
  assert.equal(strokes.length, 0, `오버레이에 stroke 가 ${strokes.length}회 걸렸다`);
});
