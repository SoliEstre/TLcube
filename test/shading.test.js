/**
 * shading.test.js — 입체 음영 레이어 (과업 #17).
 *
 * 이 파일이 지키는 계약 셋:
 *   ① **셀 무접촉** — 음영 폴리곤과 scene 도형의 교차 넓이가 0 이다. 모듈이 «분리축이
 *      변마다 하나씩 있다» 고 증명해 두었지만, 증명은 주장이고 여기 측정이 사실이다.
 *      레이아웃·버전·톤·QR 위치를 돌면서 실제 폴리곤끼리 교차 검사를 한다.
 *   ② **SVG ↔ 래스터 시각 동등성** — SVG 는 선언형 `<linearGradient>`, 래스터는 명령형
 *      보간이라 **구현이 둘**이다. SVG 문자열을 다시 읽어 독립적으로 평가하고, 같은
 *      표본 위치에서 래스터 픽셀과 맞춰 본다.
 *   ③ **끄면 아무것도 안 바뀐다** — 산출물 바이트 동일성. 새 옵션이 기존 결정성 핀을
 *      건드리지 않는다는 것이 이 옵션을 켜도 되는 근거다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_SHADING_MODE, LIGHT_DIRECTION, SHADING_GAP, SHADING_MODES, SHADING_OFF,
  SHADING_ON, addShading, miterVertices, outwardEdgeNormals, shadingBands,
} from '../src/shading.js';
import { markHulls } from '../src/quietzone.js';
import { addQuietZone } from '../src/quietzone.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { sceneToSvg } from '../src/svg.js';
import { rasterToPng } from '../src/png.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { faceGainsForRenderProfile } from '../src/render-profile.js';
import { TL_READER_URL } from '../src/qr.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: faceGainsForRenderProfile('screen'),
});
const PAYLOAD = 'https://tl.estre.so';

function sceneFor(opts = {}) {
  const encodeOpts = {
    version: opts.version === undefined ? 0 : opts.version,
    tones: opts.tones === undefined ? 3 : opts.tones,
    eccLevel: 'M',
  };
  if (opts.layout) {
    encodeOpts.cellSurface = true;
    encodeOpts.cellSurfaceLayout = opts.layout;
  }
  const sceneOpts = { palette: PALETTE };
  if (opts.locatorProfile) sceneOpts.locatorProfile = opts.locatorProfile;
  if (opts.qr) sceneOpts.qrText = TL_READER_URL;
  if (opts.qrCorner) sceneOpts.qrCorner = opts.qrCorner;
  return buildSceneY(encodeY(PAYLOAD, encodeOpts), sceneOpts);
}

// ── 폴리곤 교차 판정 (볼록성에 기대지 않는 정확한 검사) ──────────────────────
//
// SAT 는 볼록에서만 정확한데, 셀 표면 레이아웃이 만드는 도형이 언제까지 볼록일지는
// 이 파일이 보증할 수 없다. 그래서 «변끼리 교차» + «한쪽 정점이 다른 쪽 내부» 두
// 가지를 본다 — 단순 폴리곤이면 이 둘로 교차 여부가 정확히 갈린다.

function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a, b, c) => d(a, b, c) === 0
    && Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x)
    && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
  return on(p3, p4, p1) || on(p3, p4, p2) || on(p1, p2, p3) || on(p1, p2, p4);
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y)
      && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonsIntersect(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

/** 도형의 폴리곤 표현. disc 는 **외접 사각**으로 과대 근사한다 — 껍질이 그 사각을
 *  포함하도록 만들어져 있으므로(quietzone.shapePoints) 과대 근사가 계약을 느슨하게
 *  하지 않는다: 사각과 안 겹치면 원과도 안 겹친다. */
function shapePolygon(shape) {
  if (shape.kind === 'polygon') return shape.points;
  return [
    { x: shape.cx - shape.r, y: shape.cy - shape.r },
    { x: shape.cx + shape.r, y: shape.cy - shape.r },
    { x: shape.cx + shape.r, y: shape.cy + shape.r },
    { x: shape.cx - shape.r, y: shape.cy + shape.r },
  ];
}

// ── ① 셀 무접촉 ───────────────────────────────────────────────────────────

const CASES = [
  { name: 'Y0 3톤', opts: { version: 0, tones: 3 } },
  { name: 'Y0 2톤', opts: { version: 0, tones: 2 } },
  { name: 'Y1 3톤', opts: { version: 1, tones: 3 } },
  { name: 'Y2 3톤', opts: { version: 2, tones: 3 } },
  { name: 'Y1 + 코너 QR TL', opts: { version: 1, tones: 3, qr: true, qrCorner: 'TL' } },
  { name: 'Y1 + 코너 QR BR', opts: { version: 1, tones: 3, qr: true, qrCorner: 'BR' } },
  { name: 'Y0 CS v0', opts: { version: 0, tones: 3, layout: 'v0' } },
  { name: 'Y1 CS v2r2', opts: { version: 1, tones: 3, layout: 'v2r2' } },
  { name: 'Y1 CS v0x', opts: { version: 1, tones: 3, layout: 'v0x' } },
];

// ⚠ **의도적 갱신 (2026-08-17, 운영자 지시 — 길이 10×·QR 제외·발산 협소화)**:
//   길어진 띠는 QR 블록 «영역» 을 지날 수 있다. 계약이 바뀐 것이지 풀린 것이 아니다 —
//   ① 코드 본체 도형과의 기하 무접촉은 그대로 전수 검사하고 ② QR 패치 색으로만 이뤄진
//   도형은 기하 검사에서 빼되, 렌더 순서가 도형 **아래**라 QR 이 가린다는 사실을 아래
//   «가림 실증» 픽셀 테스트가 잰다. 같은 두 색을 쓰는 불스아이는 코드 껍질 안에 있어
//   띠가 애초에 못 닿는다 — 빼도 잃는 검사가 없다.
const QR_PATCH_COLORS = [PALETTE.bullseyeLight, PALETTE.bullseyeDark];
const isQrColored = (shape) => QR_PATCH_COLORS.some(
  (c) => c.r === shape.color.r && c.g === shape.color.g && c.b === shape.color.b,
);

for (const { name, opts } of CASES) {
  test(`셀 무접촉 — ${name}: 음영 폴리곤이 코드 본체 도형과 안 겹친다`, () => {
    const scene = sceneFor(opts);
    // 프로덕션 호출 (index.html withShading) 과 동일하게 QR 클러스터를 껍질에서 제외.
    const bands = shadingBands(scene, {
      mode: SHADING_ON, rim: true, clusterGap: 2, selfQuietColors: QR_PATCH_COLORS,
    });
    assert.ok(bands.length >= 4, `띠가 너무 적다(${bands.length}) — 껍질 계산이 죽었을 수 있다`);
    const shapes = scene.shapes.map(shapePolygon);
    for (const band of bands) {
      for (let i = 0; i < shapes.length; i += 1) {
        if (isQrColored(scene.shapes[i])) continue;
        assert.equal(polygonsIntersect(band.points, shapes[i]), false,
          `${name}: ${band.group}/${band.role} 띠가 shape[${i}](${scene.shapes[i].kind}) 와 겹친다 — `
          + '음영은 코드 본체에 닿으면 안 된다');
      }
    }
  });
}

test('가림 실증 — 음영은 도형 아래라 QR 블록 픽셀이 음영을 켜도 안 변한다', () => {
  const scene = sceneFor({ version: 1, tones: 3, qr: true, qrCorner: 'TL' });
  const shaded = addShading(scene, {
    mode: SHADING_ON, rim: true, clusterGap: 2, selfQuietColors: QR_PATCH_COLORS,
  });
  const plain = rasterize(scene, { pixelsPerUnit: 4, supersample: 1 });
  const withBands = rasterize(shaded, { pixelsPerUnit: 4, supersample: 1 });
  // QR 블록의 콰이어트 패치 = 가장 넓은 QR-밝은색 폴리곤. 그 bbox 안은 전부 패치가
  // 덮으므로 (다크 모듈은 그 위) 모든 픽셀이 «도형이 그린 자리» 다 — 배경 픽셀이
  // 섞이면 밴드가 정당하게 보이는 자리까지 비교해 거짓 실패가 난다 (초판 실수).
  let best = null; let bestArea = -1;
  for (const s of scene.shapes) {
    if (s.kind !== 'polygon') continue;
    const c = PALETTE.bullseyeLight;
    if (!(s.color.r === c.r && s.color.g === c.g && s.color.b === c.b)) continue;
    let bxMin = Infinity; let byMin = Infinity; let bxMax = -Infinity; let byMax = -Infinity;
    for (const p of s.points) {
      if (p.x < bxMin) bxMin = p.x;
      if (p.y < byMin) byMin = p.y;
      if (p.x > bxMax) bxMax = p.x;
      if (p.y > byMax) byMax = p.y;
    }
    const area = (bxMax - bxMin) * (byMax - byMin);
    if (area > bestArea) { bestArea = area; best = { bxMin, byMin, bxMax, byMax }; }
  }
  assert.ok(best, 'QR 콰이어트 패치를 못 찾았다');
  const minX = best.bxMin; const minY = best.byMin;
  const maxX = best.bxMax; const maxY = best.byMax;
  assert.ok(minX < maxX, 'QR 패치 bbox 가 비었다');
  const ppu = 4;
  let checked = 0;
  for (let py = Math.ceil(minY * ppu) + 1; py < Math.floor(maxY * ppu) - 1; py += 1) {
    for (let px = Math.ceil(minX * ppu) + 1; px < Math.floor(maxX * ppu) - 1; px += 1) {
      const o = (py * plain.width + px) * 4;
      // 도형이 실제로 덮은 픽셀만 비교한다 (bbox 안 빈틈은 띠가 정당하게 채운다).
      if (plain.pixels[o + 3] === 0) continue;
      for (let ch = 0; ch < 4; ch += 1) {
        assert.equal(withBands.pixels[o + ch], plain.pixels[o + ch],
          `(${px},${py}) ch${ch}: 도형 픽셀이 음영으로 변했다 — 렌더 순서가 위로 돌아갔다`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 100, `비교한 픽셀이 너무 적다 (${checked})`);
});

test('셀 무접촉의 폭은 SHADING_GAP 이다 — 껍질 변마다 분리축이 산다', () => {
  const scene = sceneFor({ version: 1, tones: 3 });
  const hulls = markHulls(scene, 2);
  assert.equal(hulls.length, 1);
  const hull = hulls[0];
  const normals = outwardEdgeNormals(hull);
  const bands = shadingBands(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 });
  // 모든 띠 점은 «자기 변의 바깥 반평면에서 최소 gap 만큼» 떨어져 있다.
  // 어느 변인지는 «그라데이션 축 방향과 같은 법선» 으로 되찾는다.
  for (const band of bands) {
    const dx = band.gradient.x2 - band.gradient.x1;
    const dy = band.gradient.y2 - band.gradient.y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / len;
    const ny = dy / len;
    let edge = -1;
    for (let i = 0; i < normals.length; i += 1) {
      if (normals[i] && Math.abs(normals[i].nx - nx) < 1e-9 && Math.abs(normals[i].ny - ny) < 1e-9) {
        edge = i;
        break;
      }
    }
    assert.ok(edge >= 0, '띠의 법선이 껍질 변 법선과 일치하지 않는다');
    const a = hull[edge];
    for (const p of band.points) {
      const dist = (p.x - a.x) * nx + (p.y - a.y) * ny;
      assert.ok(dist >= SHADING_GAP - 1e-9,
        `띠 점이 껍질에서 ${dist.toFixed(4)} 밖에 안 떨어졌다 (최소 ${SHADING_GAP})`);
    }
  }
});

// ── 조명 방향 · 배분 ───────────────────────────────────────────────────────

test('조명 방향은 면 게인 표와 같은 명암 순서를 만든다 (T·L 밝고 R 어둡다)', () => {
  // 아이소메트릭 세 면의 바깥 법선. n·d > 0 이면 빛을 등진 면(어둡다).
  const nT = { x: 0, y: -1 };
  const nL = { x: -LIGHT_DIRECTION.x, y: LIGHT_DIRECTION.y };
  const nR = { x: LIGHT_DIRECTION.x, y: LIGHT_DIRECTION.y };
  const dot = (n) => n.x * LIGHT_DIRECTION.x + n.y * LIGHT_DIRECTION.y;
  assert.ok(dot(nR) > 0, 'R 면이 그림자 쪽이어야 한다');
  assert.ok(dot(nT) < 0, 'T 면이 빛 쪽이어야 한다');
  assert.ok(dot(nL) < 0, 'L 면이 빛 쪽이어야 한다');
  // 게인 표의 순서와 같은지 — 상수를 두 번 적은 게 아니라는 확인.
  const g = faceGainsForRenderProfile('screen');
  assert.ok(g.T > g.L && g.L > g.R, '게인 표가 T > L > R 이어야 이 조명이 정당하다');
});

test('② 윗면 엣지 아웃라인은 별도 서브옵션이다 — rim 없이는 upper 띠가 없다', () => {
  const scene = sceneFor({ version: 1, tones: 3 });
  const base = shadingBands(scene, { mode: SHADING_ON, rim: false, clusterGap: 2 });
  const full = shadingBands(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 });
  assert.ok(base.length > 0);
  assert.equal(base.every((b) => b.group === 'lower'), true);
  assert.ok(full.length > base.length, 'rim 을 켜면 띠가 늘어야 한다');
  assert.ok(full.some((b) => b.group === 'upper'));
  // ① 부분은 rim 여부와 무관하게 **같은 띠**여야 한다 (두 축이 독립이라는 계약).
  assert.deepEqual(full.filter((b) => b.group === 'lower'), base);
});

test('아래쪽 띠는 우하 그림자 + 좌하 반사광이다', () => {
  const scene = sceneFor({ version: 1, tones: 3 });
  const bands = shadingBands(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 });
  const lower = bands.filter((b) => b.group === 'lower');
  const shadow = lower.filter((b) => b.role === 'shadow');
  const reflect = lower.filter((b) => b.role === 'reflect');
  assert.ok(shadow.length > 0 && reflect.length > 0);
  // 그림자는 오른쪽(법선 x > 0), 반사광은 왼쪽(법선 x < 0) — 세기가 0 에 가까운
  // 빛과 평행한 변은 방향이 애매하므로 뺀다.
  const nx = (b) => b.gradient.x2 - b.gradient.x1;
  for (const b of shadow) if (b.gradient.a1 > 0.01) assert.ok(nx(b) >= 0, '그림자가 왼쪽에 붙었다');
  for (const b of reflect) if (b.gradient.a1 > 0.01) assert.ok(nx(b) <= 0, '반사광이 오른쪽에 붙었다');
  // 위쪽 띠는 T면 왼쪽 = 반사광 · 오른쪽 = 그림자.
  const upper = bands.filter((b) => b.group === 'upper');
  const upLeft = upper.filter((b) => nx(b) < 0 && b.gradient.a1 > 0.01);
  const upRight = upper.filter((b) => nx(b) > 0 && b.gradient.a1 > 0.01);
  assert.ok(upLeft.length > 0 && upLeft.every((b) => b.role === 'reflect'));
  assert.ok(upRight.length > 0 && upRight.every((b) => b.role === 'shadow'));
});

test('알파는 0 초과 0.5 미만이고 바깥에서 0 으로 끝난다', () => {
  const scene = sceneFor({ version: 1, tones: 3 });
  for (const band of shadingBands(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 })) {
    assert.ok(band.gradient.a1 >= 0 && band.gradient.a1 < 0.5, `a1 범위 이탈: ${band.gradient.a1}`);
    assert.equal(band.gradient.a2, 0, '바깥 끝은 완전 투명이어야 한다');
  }
});

// ── ③ 끄면 아무것도 안 바뀐다 ──────────────────────────────────────────────

// ⚠ **의도적 갱신 (decode-safe 기본값 복귀)** — 음영은 렌더러에서 Type Y 에만 얹히고
//   (index.html withShading), 켜면 Y 전경 실루엣 검출이 깨져 복호가 죽는다
//   (DEFAULT_SHADING_MODE 주석 실측). 그래서 기본값을 다시 **끔**으로 되돌린다.
//   «옵션 생략 = 기본값 = 끔» 이므로 addShading({}) 는 이제 입력 scene 을 그대로
//   돌려준다 (켬은 명시 옵트인). «끄면 무변경» 계약은 명시적 off 로도 계속 잰다.
test('기본값은 끔이고, 기본값·명시적 off 모두 scene 객체가 그대로 돌아온다', () => {
  assert.equal(DEFAULT_SHADING_MODE, SHADING_OFF);
  assert.deepEqual([...SHADING_MODES], [SHADING_OFF, SHADING_ON]);
  const scene = sceneFor({ version: 1, tones: 3 });
  assert.equal(addShading(scene, { mode: SHADING_OFF }), scene, '동일 객체여야 한다');
  assert.equal(addShading(scene, {}), scene, '옵션 생략 = 기본값 = 끔 → 동일 객체');
  assert.ok(Array.isArray(addShading(scene, { mode: SHADING_ON }).shading), '명시 켬은 띠를 만든다');
  assert.equal('shading' in addShading(scene, { mode: SHADING_OFF }), false);
});

test('끈 scene 의 PNG·SVG 는 음영 코드가 들어오기 전과 바이트 동일하다', () => {
  const scene = sceneFor({ version: 0, tones: 3 });
  const off = addShading(scene, { mode: SHADING_OFF });
  const raster = rasterize(scene, { pixelsPerUnit: 8, supersample: 2 });
  const rasterOff = rasterize(off, { pixelsPerUnit: 8, supersample: 2 });
  assert.deepEqual(rasterToPng(rasterOff), rasterToPng(raster));
  assert.equal(sceneToSvg(off), sceneToSvg(scene));
  // 그리고 SVG 에 defs 가 아예 안 생긴다 — «없으면 안 낸다» 가 동일성의 근거다.
  assert.equal(sceneToSvg(off).includes('<defs>'), false);
});

test('알 수 없는 모드는 조용히 끄지 않고 던진다', () => {
  const scene = sceneFor({ version: 0, tones: 3 });
  assert.throws(() => shadingBands(scene, { mode: 'soft' }), RangeError);
});

test('결정적이다 — 같은 입력이면 같은 띠·같은 SVG', () => {
  const scene = sceneFor({ version: 1, tones: 3 });
  const a = shadingBands(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 });
  const b = shadingBands(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 });
  assert.deepEqual(a, b);
  const s1 = sceneToSvg(addShading(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 }));
  const s2 = sceneToSvg(addShading(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 }));
  assert.equal(s1, s2);
});

// ── ② SVG ↔ 래스터 시각 동등성 ─────────────────────────────────────────────

/** SVG 문자열에서 음영 defs + 폴리곤을 **다시 읽는다** (독립 평가자). */
function parseShadingFromSvg(svg) {
  const grads = new Map();
  const gradRe = /<linearGradient id="(tlsh\d+)" gradientUnits="userSpaceOnUse" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"><stop offset="0" stop-color="(#[0-9a-f]{6})" stop-opacity="([\d.]+)"\/><stop offset="1" stop-color="(#[0-9a-f]{6})" stop-opacity="([\d.]+)"\/><\/linearGradient>/g;
  let m;
  while ((m = gradRe.exec(svg))) {
    grads.set(m[1], {
      x1: Number(m[2]),
      y1: Number(m[3]),
      x2: Number(m[4]),
      y2: Number(m[5]),
      color: m[6],
      a1: Number(m[7]),
      a2: Number(m[9]),
    });
    assert.equal(m[6], m[8], '두 stop 의 색이 달라졌다 — 색은 상수여야 한다');
  }
  const polys = [];
  const polyRe = /<polygon points="([^"]+)" fill="url\(#(tlsh\d+)\)"\/>/g;
  while ((m = polyRe.exec(svg))) {
    polys.push({
      id: m[2],
      points: m[1].split(' ').map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      }),
    });
  }
  return { grads, polys };
}

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

test('SVG 그라데이션과 래스터 픽셀이 같은 그림이다 (표본 대조)', () => {
  const scene = sceneFor({ version: 0, tones: 3 });
  const shaded = addShading(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 });
  const opaque = { ...shaded, background: { r: 240, g: 240, b: 240 } };
  const ppu = 16;
  const raster = rasterize(opaque, { pixelsPerUnit: ppu, supersample: 2 });
  const { grads, polys } = parseShadingFromSvg(sceneToSvg(opaque));
  assert.equal(polys.length, shaded.shading.length);
  assert.equal(grads.size, shaded.shading.length);

  let checked = 0;
  const ss = 2;
  for (const poly of polys) {
    const g = grads.get(poly.id);
    assert.ok(g, `${poly.id} 그라데이션이 없다`);
    const src = hexToRgb(g.color);
    const cx = poly.points.reduce((s, p) => s + p.x, 0) / poly.points.length;
    const cy = poly.points.reduce((s, p) => s + p.y, 0) / poly.points.length;
    // 무게중심 + 각 꼭짓점 쪽으로 40 % 이동한 점들. 변에서 떨어져 있어야 안티에일리어싱이
    // 안 섞이므로, **네 서브픽셀 중심이 전부 폴리곤 안**인 화소만 비교한다.
    const candidates = [{ x: cx, y: cy }];
    for (const v of poly.points) {
      candidates.push({ x: cx + (v.x - cx) * 0.4, y: cy + (v.y - cy) * 0.4 });
    }
    for (const c of candidates) {
      const px = Math.floor(c.x * ppu);
      const py = Math.floor(c.y * ppu);
      if (px < 1 || py < 1 || px >= raster.width - 1 || py >= raster.height - 1) continue;
      let allIn = true;
      for (let dy = 0; dy < ss && allIn; dy += 1) {
        for (let dx = 0; dx < ss && allIn; dx += 1) {
          const sxs = (px * ss + dx + 0.5) / (ppu * ss);
          const sys = (py * ss + dy + 0.5) / (ppu * ss);
          if (!pointInPolygon({ x: sxs, y: sys }, poly.points)) allIn = false;
        }
      }
      if (!allIn) continue;
      // 화소 **중심**에서 SVG 정의대로 독립 평가 — 축 위 정사영을 [0,1] 로 자르고
      // 알파 선형 보간. 그라데이션이 1차식이라 대칭 서브픽셀 평균 = 중심값이다.
      const sx = (px + 0.5) / ppu;
      const sy = (py + 0.5) / ppu;
      const dx = g.x2 - g.x1;
      const dy = g.y2 - g.y1;
      const len2 = dx * dx + dy * dy;
      let tt = ((sx - g.x1) * dx + (sy - g.y1) * dy) / len2;
      tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      const a = g.a1 + (g.a2 - g.a1) * tt;
      const bg = opaque.background;
      const o = (py * raster.width + px) * 4;
      const want = [
        src.r * a + bg.r * (1 - a),
        src.g * a + bg.g * (1 - a),
        src.b * a + bg.b * (1 - a),
      ];
      for (let ch = 0; ch < 3; ch += 1) {
        const diff = Math.abs(raster.pixels[o + ch] - want[ch]);
        assert.ok(diff <= 1.5,
          `${poly.id} 표본 (${px},${py}) 채널 ${ch}: 래스터 ${raster.pixels[o + ch]} vs SVG 정의 ${want[ch].toFixed(2)}`);
      }
      assert.equal(raster.pixels[o + 3], 255);
      checked += 1;
    }
  }
  assert.ok(checked >= 8, `표본이 너무 적다(${checked})`);
});

test('투명 배경이면 음영이 알파로 남아 삽입 배경 위에 얹힌다', () => {
  const scene = sceneFor({ version: 0, tones: 3 });
  const transparent = { ...addShading(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 }), background: null };
  const raster = rasterize(transparent, { pixelsPerUnit: 16, supersample: 2 });
  // 음영 띠 안쪽 표본에서 0 < alpha < 255 인 픽셀이 실제로 존재해야 한다.
  let partial = 0;
  for (let i = 3; i < raster.pixels.length; i += 4) {
    const a = raster.pixels[i];
    if (a > 4 && a < 200) partial += 1;
  }
  assert.ok(partial > 200, `반투명 픽셀이 ${partial} 개뿐이다 — 음영이 export 에 안 남았다`);
  // 끈 상태에서는 그런 픽셀이 (가장자리 AA 말고는) 훨씬 적다.
  const off = rasterize({ ...scene, background: null }, { pixelsPerUnit: 16, supersample: 2 });
  let partialOff = 0;
  for (let i = 3; i < off.pixels.length; i += 4) {
    const a = off.pixels[i];
    if (a > 4 && a < 200) partialOff += 1;
  }
  assert.ok(partial > partialOff * 3,
    `음영 켠 쪽의 반투명 픽셀(${partial})이 끈 쪽(${partialOff})보다 확실히 많아야 한다`);
});

test('안전영역과 함께 얹어도 음영이 살아남는다 (addQuietZone 이 shading 을 안 떨군다)', () => {
  const scene = sceneFor({ version: 0, tones: 3 });
  const shaded = addShading(scene, { mode: SHADING_ON, rim: true, clusterGap: 2 });
  const full = addQuietZone(shaded, {
    color: { r: 255, g: 255, b: 255 }, margin: 2, selfQuietColors: [BULLSEYE_LIGHT, BULLSEYE_DARK],
  });
  assert.equal(full.shading.length, shaded.shading.length);
  assert.ok(full.shapes.length > shaded.shapes.length);
});

test('띠가 캔버스를 넘지 않는다 (클립)', () => {
  const scene = sceneFor({ version: 0, tones: 3 });
  for (const band of shadingBands(scene, { mode: SHADING_ON, rim: true, clusterGap: 2, gap: 0.1, lowerDepth: 40 })) {
    for (const p of band.points) {
      assert.ok(p.x >= -1e-9 && p.x <= scene.width + 1e-9, `x 가 캔버스 밖: ${p.x}`);
      assert.ok(p.y >= -1e-9 && p.y <= scene.height + 1e-9, `y 가 캔버스 밖: ${p.y}`);
    }
  }
});

test('miterVertices 는 정점 수를 보존한다 (사변형 짝짓기의 전제)', () => {
  const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  const out = miterVertices(square, 1);
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((p) => [p.x, p.y]), [[-1, -1], [5, -1], [5, 5], [-1, 5]]);
  // 아주 뾰족한 삼각형에서도 정점 수가 유지된다 (마이터를 자를 뿐).
  const spike = [{ x: 0, y: 0 }, { x: 100, y: 1 }, { x: 100, y: -1 }];
  assert.equal(miterVertices(spike, 1).length, 3);
});

// ── 생성기 UI 배선 (소스 계약) ─────────────────────────────────────────────

test('생성기에 입체 음영 섹션과 두 축이 배선돼 있다', () => {
  assert.equal(INDEX.match(/id="shadingSection"/g)?.length, 1);
  assert.equal(INDEX.match(/id="shadingCards"/g)?.length, 1);
  assert.match(INDEX, /data-shading="off"/);
  assert.match(INDEX, /data-shading="on"/);
  assert.match(INDEX, /<input type="checkbox" id="shadingRim">/);
  // 상태 키가 공용 컨트롤 목록에 등재돼 있어야 노출 대조 테스트가 이 축을 본다.
  assert.match(INDEX, /data-state-keys="[^"]*\bshading\b[^"]*\bshadingRim\b/);
  // Type Y 전용 게이트 + 프로파일과 같은 자리에서 함께 갱신된다.
  assert.match(INDEX, /section\.hidden = generatorState\.type !== 'Y';[\s\S]{0,400}shadingCards/);
  assert.match(INDEX, /syncRenderProfileUi\(\);[\s\S]{0,120}syncShadingUi\(\);/);
  // 아이콘은 인라인 SVG + currentColor.
  const section = INDEX.slice(INDEX.indexOf('id="shadingSection"'), INDEX.indexOf('id="shadingHint"'));
  assert.equal((section.match(/<svg /g) || []).length >= 3, true);
  assert.equal(section.includes('stroke="currentColor"'), true);
  assert.equal(/<img|background-image/.test(section), false, '아이콘은 인라인 SVG 여야 한다');
});

test('음영은 안전영역보다 **먼저** 얹힌다 (껍질을 원본 도형에서 잡아야 한다)', () => {
  assert.match(INDEX, /withQuietZone\(withShading\(scene, 'Y'\)\)/);
  assert.equal(INDEX.includes('withShading(withQuietZone'), false);
});

test('내보내기 파일명이 음영 축을 갈라 준다 (A/B 재스캔)', () => {
  assert.match(INDEX, /function exportShadingTag\(\)/);
  assert.match(INDEX, /exportProfileTag\(\) \+ exportShadingTag\(\)/);
  assert.match(INDEX, /return generatorState\.shadingRim \? '-shr' : '-sh';/);
});

test('배경이 검정이 아닐 때 음영에 실측 경고가 붙는다 (막지는 않는다)', () => {
  // §2.5 ②③ 실측: 흰 배경 20/20 → 6/20 · 투명 + 중간·밝은 표면 10/10 → 0/10 ·
  // 검정 배경 20/20 → 20/20. 음영은 «배경 대비 잘 보일수록 해롭다» — 그래서 조건이
  // «투명일 때» 가 아니라 «검정이 아닐 때» 다. 옵션을 막지 않는 대신 그 자리에서
  // 알린다 — 경고 없이 두면 «켰더니 스캔이 안 된다» 를 원인 없이 겪는다.
  assert.match(INDEX, /const risky = on && generatorState\.bgMode !== 'black';/);
  assert.match(INDEX, /risky \? t\('g992'\) : ''/);
  assert.match(INDEX, /els\.shadingHint\.style\.color = risky \? 'var\(--warn\)' : '';/);
  // 배경 모드를 바꾸면 이 경고가 다시 계산돼야 한다 (안 하면 옛 배경 기준으로 굳는다).
  assert.match(INDEX, /generatorState\.bgMode = card\.dataset\.bg;[\s\S]{0,400}syncShadingUi\(\);/);
  // ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): 3언어 → 8언어.
  assert.equal(INDEX.match(/"g992":/g)?.length, 8);
});

test('음영 문구 8언어가 다 있다', () => {
  // ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): fr·it·de·es·pt 가 붙어
  //   ko/en/ja 3언어 → 8언어다. 계약(«음영 문구는 전 언어에 있다»)은 그대로다.
  for (const key of ['g981', 'g982', 'g983', 'g984', 'g985', 'g986', 'g987', 'g988', 'g989', 'g990', 'g992']) {
    const hits = INDEX.match(new RegExp(`"${key}":`, 'g'));
    assert.equal(hits?.length, 8, `${key} 가 8언어에 다 있어야 한다 (실제 ${hits?.length})`);
  }
});
