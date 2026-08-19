/**
 * dither.js — 적은 색상 화면 최적화: **결정적 양자화 + 오차확산 디더링** (내보내기 층)
 *
 * 왜 있나 (운영자 확정 2026-08-19): 전자잉크·산업용 저색상 패널처럼 표시 비트깊이가
 * 낮은 화면에 코드를 띄우는 사용처가 있다. 「입력 힌트」가 아니라 **실제로 양자화까지
 * 해서 내보낸다** — 그래야 «그 화면에서 어떻게 보이고, 읽히는가» 를 내보내기 전에
 * 왕복으로 잴 수 있다 (재는 자리: test/output/lanes/export-options-report.md §2.2).
 *
 * ⚠ **이 포맷의 진짜 위험과의 관계.** 데이터는 3면 휘도 «순위» 에 실린다. 디더링의
 * 공간 잡음은 디코더가 면을 평균 내므로 대체로 중립이지만, **양자화가 서로 다른 면
 * 레벨을 같은 값으로 뭉개면 순위가 통째로 죽는다.** 그래서 이 모듈은 «되게 만드는»
 * 장치가 아니라 «어느 비트깊이부터 무너지는지를 정직하게 드러내는» 장치다 — 무너지는
 * 깊이는 값으로 보고서에 적고, UI 는 그 값을 경고로 옮긴다.
 *
 * ## 비트깊이 → 채널 분배 (관행 그대로)
 *
 *   24 = R8 G8 B8 (항등 — 양자화 없음)
 *   16 = R5 G6 B5 (RGB565 — high color 표준 분배)
 *   8  = R3 G3 B2 (RGB332 — 8비트 트루컬러 근사 관행)
 *   4  = R1 G2 B1 (16색 — 휘도 기여가 큰 G 에 한 비트 더)
 *   2  = 휘도 4계조 그레이스케일 (2비트를 세 채널로 못 쪼갠다 — 색은 버리고
 *        순위가 실리는 축인 «휘도» 만 남긴다. Rec.709 계수를 sRGB 코드값에 직접
 *        적용하는 근사다 — 표시 장치의 감마 전 코드값 세계에서 동작하는 장치라서다)
 *
 * ## 결정성
 *
 * Floyd–Steinberg 오차확산, **래스터 순서 고정**(왼→오, 위→아래 — serpentine 없음),
 * 오차는 Float32 행 버퍼. Math.random·Date 금지 (raster.js 와 같은 계약).
 * 같은 입력 → 바이트 동일 출력.
 *
 * 알파는 건드리지 않는다 — 투명 배경 내보내기의 RGB 는 언프리멀티플라이드라
 * 알파 0 픽셀의 RGB 양자화도 무해하다.
 *
 * @module dither
 */

/** 지원 비트깊이 (24 = 항등). UI 선택지 «자동» 은 export-options.js 의 어휘다. */
export const DITHER_BIT_DEPTHS = Object.freeze([24, 16, 8, 4, 2]);

/** 비트깊이 → [R,G,B] 채널 비트 수. 2비트는 채널 분배가 아니라 휘도 경로를 탄다. */
const CHANNEL_BITS = Object.freeze({
  24: Object.freeze([8, 8, 8]),
  16: Object.freeze([5, 6, 5]),
  8: Object.freeze([3, 3, 2]),
  4: Object.freeze([1, 2, 1]),
});

export function assertDitherBitDepth(bits) {
  if (!DITHER_BIT_DEPTHS.includes(bits)) {
    throw new RangeError('알 수 없는 디더링 비트깊이: ' + bits);
  }
  return bits;
}

/** b비트 채널의 재구성 값 표 (0..255). round(level * 255 / (2^b - 1)). */
function reconstructionTable(bits) {
  const levels = (1 << bits) - 1;
  const table = new Uint8Array(levels + 1);
  for (let i = 0; i <= levels; i += 1) table[i] = Math.round((i * 255) / levels);
  return table;
}

/**
 * RGBA 래스터를 비트깊이에 맞춰 양자화 + Floyd–Steinberg 디더링한 **새 래스터**를
 * 돌려준다. 입력은 바꾸지 않는다. bits 24 는 픽셀 사본 그대로다(항등).
 *
 * @param {{width:number, height:number, pixels:Uint8ClampedArray}} raster
 * @param {24|16|8|4|2} bits
 * @returns {{width:number, height:number, pixels:Uint8ClampedArray}}
 */
export function quantizeDitherRaster(raster, bits) {
  assertDitherBitDepth(bits);
  if (raster === null || typeof raster !== 'object'
    || !Number.isInteger(raster.width) || !Number.isInteger(raster.height)
    || !(raster.pixels instanceof Uint8ClampedArray)
    || raster.pixels.length !== raster.width * raster.height * 4) {
    throw new TypeError('raster 는 {width, height, pixels(RGBA)} 여야 한다');
  }
  const { width, height } = raster;
  const pixels = new Uint8ClampedArray(raster.pixels);
  if (bits === 24) return { width, height, pixels };
  if (bits === 2) return ditherLuma4(width, height, pixels);

  const channelBits = CHANNEL_BITS[bits];
  const tables = channelBits.map((b) => reconstructionTable(b));
  const levelsMax = channelBits.map((b) => (1 << b) - 1);

  // 채널별 오차확산 — 현재 행·다음 행 두 버퍼(FS 계수 7/16, 3/16, 5/16, 1/16).
  let errCur = new Float32Array(width * 3);
  let errNext = new Float32Array(width * 3);
  for (let y = 0; y < height; y += 1) {
    errNext.fill(0);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const want = pixels[o + c] + errCur[x * 3 + c];
        const clamped = want < 0 ? 0 : want > 255 ? 255 : want;
        const level = Math.round((clamped * levelsMax[c]) / 255);
        const got = tables[c][level];
        pixels[o + c] = got;
        const err = want - got;
        if (x + 1 < width) errCur[(x + 1) * 3 + c] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) errNext[(x - 1) * 3 + c] += (err * 3) / 16;
          errNext[x * 3 + c] += (err * 5) / 16;
          if (x + 1 < width) errNext[(x + 1) * 3 + c] += (err * 1) / 16;
        }
      }
    }
    const swap = errCur;
    errCur = errNext;
    errNext = swap;
  }
  return { width, height, pixels };
}

/** 2비트 경로 — 휘도 4계조(0·85·170·255) 그레이스케일 + FS 오차확산. */
function ditherLuma4(width, height, pixels) {
  let errCur = new Float32Array(width);
  let errNext = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    errNext.fill(0);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      // Rec.709 휘도 계수를 코드값에 직접 — 모듈 헤더의 근사 선언 참조.
      const luma = 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
      const want = luma + errCur[x];
      const clamped = want < 0 ? 0 : want > 255 ? 255 : want;
      const level = Math.round(clamped / 85);
      const got = level * 85;
      pixels[o] = got;
      pixels[o + 1] = got;
      pixels[o + 2] = got;
      const err = want - got;
      if (x + 1 < width) errCur[x + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) errNext[x - 1] += (err * 3) / 16;
        errNext[x] += (err * 5) / 16;
        if (x + 1 < width) errNext[x + 1] += (err * 1) / 16;
      }
    }
    const swap = errCur;
    errCur = errNext;
    errNext = swap;
  }
  return { width, height, pixels };
}
