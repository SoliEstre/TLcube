// qr-selfquiet.test.js — 꾸민 코너 QR(O/A/K 호스트)의 안전영역 제외 · 검출 모듈 고정 · 중앙 QR 불변
// (DESIGN_001 §4.1 styledGridShapes tags · §4.2 scene.js ⓒ · §5.2 · §7.5, 레인 L2b 2026-09-26)
//
// 왜 필요한가: 안전영역 제외는 ① `selfQuiet` 태그 ② «전 도형이 [BULLSEYE_LIGHT, BULLSEYE_DARK] 색»
// 클러스터, 두 갈래다(quietzone.js 제외 주석). 코너 QR 색을 바꾸면(`qrColorMode ≠ default`) ②가
// 성립하지 않아 ① 만 남는다 — 태그가 빠지면 A 하단 BL·BR 코너의 «213/213 삼킴» 사고가 재발한다.
//
// 성질:
//   ① A v0 BL·BR × 색 모드(custom hue·sat 양 끝 · match) × 스타일 9 × 눈(none · darker)에서 안전영역이
//      코너 QR 조각 중심을 하나도 덮지 않는다. 조각은 **deco 색 + 사분면**으로 찾는다(태그로 찾으면
//      재는 대상으로 자를 만드는 순환이다).
//   ② 역사적 실패 기하(블록을 3셀 안쪽 — 수리 전 0.5셀 여유)로 되돌려도 태그가 QR 을 구한다.
//      같은 기하에서 태그를 벗기면 삼켜진다(심은 결함 — 이 자가 판별력이 있다는 증거).
//   ③ 꾸민 조각은 모두 `selfQuiet` · `noSeam` 을 단다. 필수 태그가 빠진 QR 호출은 던진다(계약).
//   ④ 검출 모듈 고정: 파인더 7×7(규격에서 손으로 유도한 세 사각) 어두운 모듈은 정확한 모듈 사각 ·
//      눈 색, 타이밍 행/열 6 은 정확한 사각 · 어두운 색. 데이터 모듈엔 스타일이 실제로 먹는다.
//   ⑤ 중앙 QR 은 qrDeco 가 있어도 인자·출력 불변 · 불스아이 · 셀 · 팔레트(bullseyeDark/Light)도 불변.
//   ⑥ svg: 꾸민 조각은 seam stroke 가 없다(`s.qr || s.noSeam`).
// 허용표는 fixture 로 주입한다(스텁은 전부 잠금이라 resolveQrDeco 가 아무것도 안 연다).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { quietZonePolygons } from '../src/quietzone.js';
import { sceneToSvg } from '../src/svg.js';
import { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { qrMatrix, TL_READER_URL } from '../src/qr.js';
import { resolveQrDeco, QR_COLOR_MODES, QR_EYE_MODES } from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES, styledGridShapes } from '../src/square-cell-style.js';

const SLATE = getPreset('slate');
const PALETTE = Object.freeze({
  background: null, levels: SLATE.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
});
const QR_COLORS = [BULLSEYE_LIGHT, BULLSEYE_DARK];

/** fixture 허용표 — QR 표 전 조합(스텁 대신 주입). */
const ALLOW_ALL_QR = Object.freeze({
  ROWS: Object.freeze(SQUARE_CELL_STYLES.flatMap((qrCellStyle) => QR_COLOR_MODES.flatMap((qrColorMode) => (
    QR_EYE_MODES.map((eyeMode) => Object.freeze({ table: 'qr', host: 'oak', qrCellStyle, qrColorMode, eyeMode }))
  )))),
});

function decoOf(state) {
  const r = resolveQrDeco(state, SLATE, 'oak', ALLOW_ALL_QR);
  assert.ok(r.deco, `전제: deco 가 안 열렸다 ${JSON.stringify(state)} → ${r.lockReason}`);
  return r.deco;
}

/** 색 축: custom hue·sat 양 끝 + match(slate). */
const COLOR_STATES = [
  { qrColorMode: 'custom', qrHue: 210, qrSat: 200 },
  { qrColorMode: 'custom', qrHue: 0, qrSat: 0 },
  { qrColorMode: 'custom', qrHue: 120, qrSat: 100 },
  { qrColorMode: 'match' },
];

const sameRgb = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;

function centroid(s) {
  if (s.kind === 'disc') return { x: s.cx, y: s.cy };
  return s.points.reduce((a, q) => ({ x: a.x + q.x / s.points.length, y: a.y + q.y / s.points.length }), { x: 0, y: 0 });
}

/**
 * 코너 QR 조각을 태그 없이 찾는다: ① 사분면 바깥쪽의 가장 큰 deco.light 사각 = 콰이어트 패치,
 * ② 그 패치 안에 중심이 있는 deco 색 도형. (match 모드의 어두운 색은 팔레트 levels[0] 이라 코드
 * 셀과 같은 색이다 — 색만으로 거르면 셀을 줍는다.)
 */
function cornerPieces(scene, deco, corner) {
  const colors = [deco.dark, deco.eye, deco.light];
  const wantLeft = corner === 'TL' || corner === 'BL';
  const wantTop = corner === 'TL' || corner === 'TR';
  const inQuadrant = (p) => {
    const inX = wantLeft ? p.x < scene.width / 2 : p.x > scene.width / 2;
    const inY = wantTop ? p.y < scene.height / 2 : p.y > scene.height / 2;
    return inX && inY && Math.hypot(p.x - scene.width / 2, p.y - scene.height / 2) > Math.min(scene.width, scene.height) / 4;
  };
  let patch = null; let patchArea = 0;
  for (const s of scene.shapes) {
    if (s.kind !== 'polygon' || s.points.length !== 4 || !sameRgb(s.color, deco.light) || !inQuadrant(centroid(s))) continue;
    const w = Math.max(...s.points.map((p) => p.x)) - Math.min(...s.points.map((p) => p.x));
    const h = Math.max(...s.points.map((p) => p.y)) - Math.min(...s.points.map((p) => p.y));
    if (w * h > patchArea) { patch = s; patchArea = w * h; }
  }
  if (patch === null) return [];
  const minX = Math.min(...patch.points.map((p) => p.x)); const maxX = Math.max(...patch.points.map((p) => p.x));
  const minY = Math.min(...patch.points.map((p) => p.y)); const maxY = Math.max(...patch.points.map((p) => p.y));
  return scene.shapes.filter((s) => {
    if (!colors.some((c) => sameRgb(c, s.color))) return false;
    const p = centroid(s);
    return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  });
}

function inside(poly, p) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[j]; const b = poly[i];
    if ((b.y > p.y) !== (a.y > p.y) && p.x < ((a.x - b.x) * (p.y - b.y)) / (a.y - b.y) + b.x) hit = !hit;
  }
  return hit;
}

function coveredCount(scene, pieces) {
  let n = 0;
  for (const poly of quietZonePolygons(scene, 2, QR_COLORS)) {
    for (const s of pieces) if (inside(poly, centroid(s))) n += 1;
  }
  return n;
}

const ENCODED_A0 = encodeA('quiet zone', { version: 0 });
const sceneA0 = (corner, deco) => buildScene(ENCODED_A0, {
  palette: deco ? { ...PALETTE, qrDeco: deco } : PALETTE,
  qrText: TL_READER_URL,
  qrCorner: corner,
  finderPatternId: 'bullseye',
});

// ── ①③ ─────────────────────────────────────────────────────────────────────

describe('①③ A v0 BL·BR × 색 × 스타일 × 눈 — 안전영역이 꾸민 코너 QR 을 덮지 않는다', () => {
  for (const corner of ['BL', 'BR']) {
    for (const colorState of COLOR_STATES) {
      test(`${corner} · ${JSON.stringify(colorState)}`, () => {
        for (const qrCellStyle of SQUARE_CELL_STYLES) {
          for (const qrEyeMode of ['none', 'darker']) {
            const deco = decoOf({ ...colorState, qrCellStyle, qrEyeMode });
            const label = `${qrCellStyle} · 눈 ${qrEyeMode}`;
            // 전제: 색 경로(②)로는 못 구하는 색이어야 이 자가 태그를 잰다.
            assert.ok(!QR_COLORS.some((c) => sameRgb(c, deco.dark)), `${label}: 전제 — 어두운 색이 불스아이 색이다`);
            const scene = sceneA0(corner, deco);
            const pieces = cornerPieces(scene, deco, corner);
            assert.ok(pieces.length > 21, `${label}: 코너 QR 조각을 못 찾았다(${pieces.length})`);
            for (const s of pieces) {
              assert.equal(s.selfQuiet, true, `${label}: selfQuiet 없는 조각`);
              if (!sameRgb(s.color, deco.light)) assert.equal(s.noSeam, true, `${label}: noSeam 없는 모듈 조각`);
            }
            assert.equal(coveredCount(scene, pieces), 0, `${label}: 안전영역이 코너 QR 을 덮었다`);
          }
        }
      });
    }
  }
});

// ── ② ──────────────────────────────────────────────────────────────────────

describe('② 역사적 실패 기하(0.5셀 여유)로 되돌려도 태그가 구한다 · 태그를 벗기면 삼켜진다', () => {
  for (const corner of ['BL', 'BR']) {
    test(corner, () => {
      const deco = decoOf({ qrColorMode: 'custom', qrHue: 210, qrSat: 200, qrCellStyle: 'dots', qrEyeMode: 'darker' });
      const scene = sceneA0(corner, deco);
      const cell = scene.layout.size;
      const dx = corner === 'BL' ? 3 * cell : -3 * cell;
      const back = {
        ...scene,
        shapes: scene.shapes.map((s) => (s.selfQuiet !== true || !s.points ? s
          : { ...s, points: s.points.map((v) => ({ x: v.x + dx, y: v.y - 3 * cell })) })),
      };
      const strip = {
        ...back,
        shapes: back.shapes.map((s) => {
          if (s.selfQuiet !== true) return s;
          const c = { ...s };
          delete c.selfQuiet;
          return c;
        }),
      };
      const pieces = (sc) => cornerPieces(sc, deco, corner);
      assert.ok(pieces(back).length > 21, '되돌린 기하에서 코너 QR 을 못 찾았다');
      assert.ok(coveredCount(strip, pieces(strip)) > 0,
        '태그를 벗겨도 안 삼켜진다 — 이 기하가 결함 영역을 못 건드린다(자의 판별력 상실)');
      assert.equal(coveredCount(back, pieces(back)), 0, '태그가 있는데 삼켜졌다 — selfQuiet 제외 경로가 끊겼다');
    });
  }

  test('필수 태그가 빠진 QR 호출은 던진다(styledGridShapes 계약 — scene 이 기대는 것)', () => {
    const base = {
      rows: 2, cols: 2, style: 'dots', host: 'qr',
      role: () => 'data', color: () => ({ r: 0, g: 0, b: 0 }), map: (x, y) => ({ x, y }),
    };
    for (const tags of [undefined, {}, { selfQuiet: true }, { noSeam: true }]) {
      assert.throws(() => styledGridShapes({ ...base, tags }), TypeError, JSON.stringify(tags));
    }
    assert.throws(() => styledGridShapes({ ...base, host: 'h', tags: { noSeam: true, qr: true } }), TypeError);
    assert.doesNotThrow(() => styledGridShapes({ ...base, tags: { selfQuiet: true, noSeam: true } }));
  });
});

// ── ④ ──────────────────────────────────────────────────────────────────────

describe('④ 검출 모듈은 사각 고정 — 눈만 eye 색, 데이터에만 스타일', () => {
  // QR v1 규격(ISO/IEC 18004)의 파인더 7×7 세 사각과 타이밍 — qr-function-map 과 독립으로 손 유도.
  const inFinder = (x, y) => (x < 7 && y < 7) || (x >= 14 && y < 7) || (x < 7 && y >= 14);
  const isTiming = (x, y) => (y === 6 && x >= 8 && x <= 12) || (x === 6 && y >= 8 && y <= 12);
  const qr = qrMatrix(TL_READER_URL);

  for (const qrCellStyle of ['dots', 'diamond', 'liquid', 'classy-rounded']) {
    test(qrCellStyle, () => {
      const deco = decoOf({ qrColorMode: 'custom', qrHue: 300, qrSat: 200, qrCellStyle, qrEyeMode: 'darker' });
      assert.ok(!sameRgb(deco.eye, deco.dark), '전제: 눈 색이 어두운 색과 같다 — 눈 축을 못 잰다');
      const scene = sceneA0('TL', deco);
      const pieces = cornerPieces(scene, deco, 'TL');
      const patch = pieces.find((s) => sameRgb(s.color, deco.light) && s.selfQuiet && s.points.length === 4);
      assert.ok(patch, '콰이어트 패치를 못 찾았다');
      const m = scene.layout.size / 2; // 코너 QR 모듈 = 셀/2
      const ox = patch.points[0].x + 4 * m;
      const oy = patch.points[0].y + 4 * m;
      const squareKey = (x, y) => [
        [ox + x * m, oy + y * m], [ox + (x + 1) * m, oy + y * m],
        [ox + (x + 1) * m, oy + (y + 1) * m], [ox + x * m, oy + (y + 1) * m],
      ];
      const near = (a, b) => Math.abs(a - b) < 1e-9;
      const isSquareAt = (s, x, y) => s.kind === 'polygon' && s.points.length === 4
        && squareKey(x, y).every(([px, py], i) => near(s.points[i].x, px) && near(s.points[i].y, py));

      let finderDark = 0; let timingDark = 0;
      for (let y = 0; y < qr.size; y += 1) {
        for (let x = 0; x < qr.size; x += 1) {
          if (qr.modules[y * qr.size + x] !== 1) continue;
          if (inFinder(x, y)) {
            finderDark += 1;
            assert.ok(pieces.some((s) => isSquareAt(s, x, y) && sameRgb(s.color, deco.eye)),
              `파인더 모듈 (${x},${y}) 가 눈 색 사각이 아니다`);
          } else if (isTiming(x, y)) {
            timingDark += 1;
            assert.ok(pieces.some((s) => isSquareAt(s, x, y) && sameRgb(s.color, deco.dark)),
              `타이밍 모듈 (${x},${y}) 가 어두운 색 사각이 아니다`);
          }
        }
      }
      assert.equal(finderDark, 3 * (24 + 9), '파인더 어두운 모듈 수(규격: 링 24 + 코어 9) × 3');
      assert.ok(timingDark > 0);
      // 눈 색은 파인더 안에만.
      for (const s of pieces.filter((p) => sameRgb(p.color, deco.eye))) {
        const c = centroid(s);
        const x = Math.floor((c.x - ox) / m); const y = Math.floor((c.y - oy) / m);
        assert.ok(inFinder(x, y), `눈 색 조각이 파인더 밖 (${x},${y})`);
      }
      // 데이터엔 스타일이 먹는다(모듈 사각이 아닌 조각이 있다).
      const isModuleSquare = (s) => {
        if (s.kind !== 'polygon' || s.points.length !== 4) return false;
        const x = Math.round((s.points[0].x - ox) / m); const y = Math.round((s.points[0].y - oy) / m);
        return isSquareAt(s, x, y);
      };
      const styled = pieces.filter((s) => sameRgb(s.color, deco.dark) && !isModuleSquare(s));
      assert.ok(styled.length > 0, `${qrCellStyle}: 데이터 모듈에 스타일이 안 먹었다`);
    });
  }
});

// ── ⑤ ──────────────────────────────────────────────────────────────────────

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('⑤ 중앙 QR · 불스아이 · 셀 · 팔레트는 qrDeco 에 불변', () => {
  const deco = decoOf({ qrColorMode: 'custom', qrHue: 37, qrSat: 200, qrCellStyle: 'dots', qrEyeMode: 'darker' });

  test('중앙 QR 만(코너 없음): qrDeco 가 있어도 장면 전체가 같다', () => {
    const e = encode('center', { version: 1, centerQr: true });
    const off = buildScene(e, { palette: PALETTE, qrText: TL_READER_URL });
    const on = buildScene(e, { palette: deepFreeze({ ...PALETTE, qrDeco: deco }), qrText: TL_READER_URL });
    assert.deepEqual(on, off);
  });

  test('중앙 QR + cornerToo: 코너 블록 앞 구간(중앙 QR · 셀) 불변, 코너만 꾸며진다', () => {
    const e = encode('center', { version: 1, centerQr: true });
    const opts = { qrText: TL_READER_URL, cornerToo: true };
    const off = buildScene(e, { ...opts, palette: PALETTE });
    const on = buildScene(e, { ...opts, palette: deepFreeze({ ...PALETTE, qrDeco: deco }) });
    // 코너 패치 = 마지막 콰이어트 패치(한 변 29모듈 = 14.5셀) — 끔 장면에서 위치로 찾는다.
    const blockSide = 29 * (off.layout.size / 2);
    const patchIdx = off.shapes.findIndex((s) => s.selfQuiet && s.points.length === 4
      && Math.abs((s.points[1].x - s.points[0].x) - blockSide) < 1e-9);
    assert.ok(patchIdx > 0, '코너 패치를 못 찾았다');
    assert.deepEqual(on.shapes.slice(0, patchIdx), off.shapes.slice(0, patchIdx), '중앙 QR · 셀 구간이 바뀌었다');
    assert.ok(cornerPieces(on, deco, 'TL').some((s) => sameRgb(s.color, deco.dark)), '코너 QR 이 꾸며지지 않았다');
    // 중앙 QR 모듈은 여전히 불스아이 색이다.
    const centerModules = on.shapes.slice(0, patchIdx).filter((s) => s.selfQuiet === true);
    assert.ok(centerModules.length > 21);
    assert.ok(centerModules.every((s) => sameRgb(s.color, BULLSEYE_DARK) || sameRgb(s.color, BULLSEYE_LIGHT)));
  });

  test('불스아이 + 코너 QR: 코너 블록 앞 구간(불스아이 · 셀) 불변 · 팔레트 객체 불변(동결)', () => {
    const e = encode('bullseye', { version: 1 });
    const palette = deepFreeze({ ...PALETTE, qrDeco: deco });
    const off = buildScene(e, { palette: PALETTE, qrText: TL_READER_URL, finderPatternId: 'bullseye' });
    const on = buildScene(e, { palette, qrText: TL_READER_URL, finderPatternId: 'bullseye' });
    const firstCorner = off.shapes.findIndex((s) => s.selfQuiet === true);
    assert.ok(firstCorner > 0);
    assert.deepEqual(on.shapes.slice(0, firstCorner), off.shapes.slice(0, firstCorner));
    const discs = on.shapes.filter((s) => s.kind === 'disc');
    assert.ok(discs.length > 0 && discs.every((s) => sameRgb(s.color, BULLSEYE_DARK) || sameRgb(s.color, BULLSEYE_LIGHT)),
      '불스아이 색이 바뀌었다');
    assert.deepEqual(palette.bullseyeDark, BULLSEYE_DARK);
    assert.deepEqual(palette.bullseyeLight, BULLSEYE_LIGHT);
  });

  test('qrDeco 없음 · null 은 같은 장면 · 반쪽 deco 는 조용히 메우지 않고 던진다', () => {
    const e = encode('bullseye', { version: 1 });
    const base = { qrText: TL_READER_URL, finderPatternId: 'bullseye' };
    const off = buildScene(e, { ...base, palette: PALETTE });
    assert.deepEqual(buildScene(e, { ...base, palette: { ...PALETTE, qrDeco: null } }), off);
    assert.deepEqual(buildScene(e, { ...base, palette: { ...PALETTE, qrDeco: undefined } }), off);
    const { eye: _eye, ...half } = deco;
    assert.throws(() => buildScene(e, { ...base, palette: { ...PALETTE, qrDeco: half } }), TypeError);
    // default 모드 · square · 눈 none 은 resolver 가 null 을 준다 → 키를 안 만든다.
    assert.equal(resolveQrDeco({}, SLATE, 'oak', ALLOW_ALL_QR).deco, null);
  });
});

// ── ⑥ ──────────────────────────────────────────────────────────────────────

describe('⑥ svg — 꾸민 코너 QR 조각은 seam stroke 가 없다', () => {
  test('noSeam 조각 수만큼 stroke 없는 polygon 이 나온다', () => {
    const deco = decoOf({ qrColorMode: 'custom', qrHue: 210, qrSat: 100, qrCellStyle: 'rounded', qrEyeMode: 'none' });
    const scene = sceneA0('TL', deco);
    const noSeam = scene.shapes.filter((s) => s.kind === 'polygon' && s.noSeam === true).length;
    assert.ok(noSeam > 0);
    const svg = sceneToSvg(scene);
    const bare = (svg.match(/<polygon points="[^"]*" fill="#[0-9a-f]{6}"\/>/g) || []).length;
    assert.equal(bare, noSeam);
  });
});
