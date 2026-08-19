/**
 * export-render.js — 내보내기 옵션이 적용된 **프로덕션 내보내기 파이프라인** (PNG/SVG)
 *
 * 왜 모듈인가: 종전 내보내기는 index.html 인라인에서 `rasterize(scene, {pixelsPerUnit: 32,
 * supersample: 2})` 를 직접 불렀다. 옵션 4종(크기·디더링·ppi·입체감)이 붙으면서 그
 * 조립이 규칙이 됐고, 인라인 규칙은 테스트가 못 잠근다 (.agent/_lessons/009 — 회귀의
 * 첫 입력이 프로덕션이 만든 것이어야 한다). 그래서 UI 와 테스트가 **같은 함수**를 탄다.
 *
 * 파이프라인 (PNG): rasterize → (캔버스 contain 패딩) → (양자화·디더링) → PNG(pHYs).
 * 파이프라인 (SVG): sceneToSvg(widthPx/heightPx) — 벡터라 디더링·ppi 없음.
 *
 * 결정성: 전 단계가 결정적 모듈(raster/dither/png/svg)이다. 같은 scene + 같은 옵션 →
 * 바이트 동일.
 *
 * @module export-render
 */

import { rasterize } from './raster.js';
import { rasterToPng } from './png.js';
import { sceneToSvg } from './svg.js';
import { quantizeDitherRaster } from './dither.js';

/**
 * 래스터를 width×height 캔버스 **가운데**에 놓는다 (contain 패딩 — resolveExportSize 가
 * ppu 를 캔버스에 맞춰 계산하므로 래스터는 항상 캔버스 이하 크기다).
 *
 * 패딩 색은 scene 배경과 같은 규약이다: {r,g,b} 면 그 색(불투명), null 이면 투명.
 * 크기가 이미 같으면 **입력 래스터를 그대로** 돌려준다 — 패딩 없는 경로의 바이트를
 * 종전과 동일하게 유지한다.
 *
 * @param {{width:number, height:number, pixels:Uint8ClampedArray}} raster
 * @param {number} width
 * @param {number} height
 * @param {{r:number,g:number,b:number}|null} background
 */
export function padRasterToCanvas(raster, width, height, background) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`캔버스 크기가 유효하지 않다: ${width}×${height}`);
  }
  if (raster.width > width || raster.height > height) {
    throw new RangeError(
      `래스터(${raster.width}×${raster.height})가 캔버스(${width}×${height})보다 크다 — `
      + 'resolveExportSize 의 ppu 계산과 어긋났다',
    );
  }
  if (raster.width === width && raster.height === height) return raster;
  if (background !== null && (background === undefined || typeof background !== 'object')) {
    throw new TypeError(`배경은 {r,g,b} 또는 null(투명) 이어야 한다: ${background}`);
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (background !== null) {
    for (let i = 0; i < width * height; i += 1) {
      const o = i * 4;
      pixels[o] = background.r;
      pixels[o + 1] = background.g;
      pixels[o + 2] = background.b;
      pixels[o + 3] = 255;
    }
  }
  const ox = Math.floor((width - raster.width) / 2);
  const oy = Math.floor((height - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    const srcRow = y * raster.width * 4;
    const dstRow = ((oy + y) * width + ox) * 4;
    pixels.set(raster.pixels.subarray(srcRow, srcRow + raster.width * 4), dstRow);
  }
  return { width, height, pixels };
}

/**
 * «여백 없음» 의 scene 재생성 — **성립하는 가장 작은 margin** 을 찾는다.
 *
 * 왜 탐색인가 (통합 감사 수리, §9): scene 빌더는 margin 이 모자라면 던진다 (삼각 패치
 * 캔버스 이탈 · 코너 QR 실루엣 겹침 가드). 시작 margin(trimExportMargin — 타입·버전·
 * 코너QR 실측표)이 그 경계를 덮지만, 표가 모르는 미래 기하(새 레이아웃·새 QR 배치)가
 * 오면 내부 throw 가 사용자에게 그대로 새어 나간다. 그래서 시작값에서 +1 씩 올려
 * **처음 성립하는 margin** 을 쓴다 — «여백 없음 = 장식 여백만 제거» 의 문자적 구현이고,
 * 조용한 전체 폴백(여백 포함으로 되돌리기)이 아니라 최소한만 양보하는 결정적 규칙이다.
 * 탐색이 바닥나면 마지막 에러를 그대로 던진다 (조용히 삼키지 않는다).
 *
 * @param {(encoded: object, opts: object) => object} build buildScene | buildSceneY
 * @param {object} encoded 인코딩 결과
 * @param {object} sceneOpts 렌더 때 쓴 scene 옵션 원본
 * @param {number} startMargin trimExportMargin() 산출값
 * @param {{maxSteps?: number}} [options]
 * @returns {{scene: object, margin: number}}
 */
export function buildTrimmedScene(build, encoded, sceneOpts, startMargin, options = {}) {
  const maxSteps = options.maxSteps === undefined ? 64 : options.maxSteps;
  let lastError = null;
  for (let step = 0; step <= maxSteps; step += 1) {
    const margin = startMargin + step;
    try {
      return { scene: build(encoded, { ...sceneOpts, margin }), margin };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * scene → 내보내기 옵션이 적용된 PNG 바이트.
 *
 * @param {object} scene buildScene/buildSceneY 산출물
 * @param {{ppu: number, width: number, height: number, ditherBits?: number|null,
 *          ppi?: number, supersample?: number}} plan
 *   ppu/width/height 는 export-options.resolveExportSize 산출값.
 *   ditherBits: null 또는 24 = 양자화 없음. ppi: 있으면 pHYs 를 단다.
 * @returns {Uint8Array}
 */
export function renderExportPng(scene, plan) {
  const supersample = plan.supersample === undefined ? 2 : plan.supersample;
  let raster = rasterize(scene, { pixelsPerUnit: plan.ppu, supersample });
  raster = padRasterToCanvas(raster, plan.width, plan.height, scene.background);
  const bits = plan.ditherBits === undefined ? null : plan.ditherBits;
  if (bits !== null && bits !== 24) raster = quantizeDitherRaster(raster, bits);
  return rasterToPng(raster, plan.ppi === undefined ? {} : { ppi: plan.ppi });
}

/**
 * scene → 내보내기 옵션이 적용된 SVG 마크업. 캔버스 크기는 width/height 속성으로
 * 실리고 contain 은 SVG 기본 preserveAspectRatio 가 맡는다 (svg.js 참조).
 *
 * @param {object} scene
 * @param {{width: number, height: number}} plan
 * @returns {string}
 */
export function renderExportSvg(scene, plan) {
  return sceneToSvg(scene, { widthPx: plan.width, heightPx: plan.height });
}
