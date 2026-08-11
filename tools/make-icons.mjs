/**
 * make-icons.mjs — PWA·홈 화면 아이콘 PNG 를 굽는다.
 *
 * 왜 PNG 인가: **iOS 는 홈 화면 아이콘에 SVG 를 쓰지 않는다.** `apple-touch-icon` PNG 가
 * 없으면 파비콘을 끌어다 확대해서 저해상도로 나온다(실기기 확인 2026-08-11). Android 도
 * 매니페스트에 SVG 만 있으면 기기·런처에 따라 품질이 들쭉날쭉하다. 그래서 실제 크기의
 * PNG 를 미리 굽는다.
 *
 * 도형은 `sites/_shared/favicon.svg` 와 같다 — 아이소메트릭 큐브 3면에 slate 프리셋의
 * rank 2/1/0 을 그대로 써서, 아이콘 자체가 "휘도 순서" 를 보여 준다.
 *
 * 의존성 0: repo 의 `src/png.js` 인코더로 직접 쓴다. 래스터화는 삼각형 두 개로 나눈
 * 폴리곤 채우기 + **4×4 슈퍼샘플링**(계단 완화)이다.
 *
 * 사용: node tools/make-icons.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rasterToPng } from '../src/png.js';

const OUT_DIR = fileURLToPath(new URL('../sites/_shared/', import.meta.url));
const SIZES = [180, 192, 512];
const SUPERSAMPLE = 4;

/** favicon.svg 와 같은 32단위 좌표계의 큐브 3면. 위·왼쪽·오른쪽 순으로 밝기가 낮아진다. */
/*
 * ⚠ **참 아이소메트릭**이어야 한다 — 실루엣이 정육각형이고 큐브 세 모서리가 투영 후
 *    같은 길이여야 한다. 예전 값은 윗면 마름모만 맞고 수직 모서리가 눌려서 실루엣이
 *    가로로 2/√3 배 늘어난 «직육각형» 이었다(2026-08-11 수정).
 *    중심 (16,16) · 외접반경 R=14 · 가로 반폭 R·√3/2 = 12.124 → 모서리 3종 모두 14.
 */
const R = 14;
const CX = 16;
const CY = 16;
const HX = R * Math.sqrt(3) / 2;
const P = {
  top: [CX, CY - R],
  upperRight: [CX + HX, CY - R / 2],
  lowerRight: [CX + HX, CY + R / 2],
  bottom: [CX, CY + R],
  lowerLeft: [CX - HX, CY + R / 2],
  upperLeft: [CX - HX, CY - R / 2],
  centre: [CX, CY],
};

const FACES = [
  { points: [P.top, P.upperRight, P.centre, P.upperLeft], color: [0xdc, 0xe4, 0xf0] },
  { points: [P.upperLeft, P.centre, P.bottom, P.lowerLeft], color: [0x6e, 0x87, 0xbe] },
  { points: [P.upperRight, P.centre, P.bottom, P.lowerRight], color: [0x3a, 0x44, 0x6c] },
];

/** 배경 — 투명하게 두면 iOS 가 검게 채운다. 다크 패널색으로 채워 두는 편이 안전하다. */
const BACKGROUND = [0x10, 0x12, 0x18];

/** 짝수-교차 point-in-polygon. 폴리곤이 볼록이라 경계 규칙은 단순해도 된다. */
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function renderIcon(size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const scale = size / 32;
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) * step) / scale;
          const y = (py + (sy + 0.5) * step) / scale;
          let color = BACKGROUND;
          // 뒤에 그린 면이 이긴다 — SVG 의 그리기 순서와 같다.
          for (const face of FACES) if (inside(face.points, x, y)) color = face.color;
          r += color[0]; g += color[1]; b += color[2];
        }
      }
      const i = (py * size + px) * 4;
      pixels[i] = Math.round(r / samples);
      pixels[i + 1] = Math.round(g / samples);
      pixels[i + 2] = Math.round(b / samples);
      pixels[i + 3] = 255;
    }
  }
  return { width: size, height: size, pixels };
}

for (const size of SIZES) {
  const png = rasterToPng(renderIcon(size));
  const name = `icon-${size}.png`;
  writeFileSync(OUT_DIR + name, png);
  console.log(`${name.padEnd(16)} ${png.length.toLocaleString()} B`);
}
console.log(`\n→ ${OUT_DIR}`);
