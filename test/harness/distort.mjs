/**
 * distort.mjs — 디코더와 독립적인 결정적 M1 왜곡 하네스.
 *
 * 이 모듈의 공개 입력·출력은 raster.js 의 계약과 같다.
 *
 *   { width: number, height: number, pixels: Uint8ClampedArray }
 *
 * 모든 함수는 입력 객체와 픽셀 버퍼를 바꾸지 않고, 같은 크기의 새 이미지를
 * 반환한다. pixels 는 RGBA interleaved 8bit 이며 알파 채널은 기하 변환에서
 * 함께 보간하고, 색/톤/노이즈/JPEG 변환에서는 그대로 보존한다.
 *
 * 기본 파이프라인은 distortImage(image, options) 이다.
 *
 *   geometry → camera tilt → barrel → gamma → S-curve → vignette → Gaussian noise → JPEG 근사
 *
 * 개별 단계도 export 하므로 M1 매트릭스의 한 항목만 독립적으로 측정할 수 있다.
 * 기하 함수는 출력 캔버스를 입력과 같은 크기로 유지한다. 회전·확대는 가장자리
 * 밖을 기본 투명 흑색으로 채우며, fill: {r,g,b,a} 로 바꿀 수 있다.
 *
 * 리샘플링은 destination pixel 을 source 로 역투영한 뒤 4개 이웃의 bilinear
 * 보간을 쓴다. nearest-neighbor 는 회전/원근 경계에 계단과 가짜 순위 변동을
 * 만들고, 브라우저 canvas 는 엔진에 따라 결과가 달라질 수 있으므로 선택하지
 * 않았다. 역방향 매핑은 구멍(hole)을 만들지 않고, 명시적 산술과 정수 반올림은
 * 같은 런타임에서 byte 결과를 결정적으로 만든다.
 *
 * JPEG 는 파일 포맷 인코더가 아니다. RGB 각 채널에 JPEG 표준 luminance 양자화
 * 표를 적용한 8×8 level-shifted DCT → 양자화 → IDCT 를 수행하는 근사다. 실제
 * JPEG 의 YCbCr 변환, chroma subsampling, zig-zag/entropy coding, 메타데이터는
 * 일부러 구현하지 않았다. 따라서 이름과 문서에서 항상 "JPEG 근사"라고 한다.
 */

const CHANNELS = 4;
const MAX_TILT_DEGREES = 30;
const MAX_CAMERA_TILT_DEGREES = 60;
const DEFAULT_TILT_DISTANCE_RATIO = 4;
const DEFAULT_S_CURVE_AMOUNT = 0.6;
const DEFAULT_VIGNETTE_AMOUNT = 0.5;
const DEFAULT_FILL = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

function assertImage(image) {
  if (image === null || typeof image !== 'object') {
    throw new TypeError('image 는 객체여야 한다');
  }
  if (!Number.isInteger(image.width) || image.width < 1) {
    throw new RangeError('image.width 는 1 이상의 정수여야 한다: ' + image.width);
  }
  if (!Number.isInteger(image.height) || image.height < 1) {
    throw new RangeError('image.height 는 1 이상의 정수여야 한다: ' + image.height);
  }
  if (!(image.pixels instanceof Uint8ClampedArray)) {
    throw new TypeError('image.pixels 는 Uint8ClampedArray 여야 한다');
  }
  const expected = image.width * image.height * CHANNELS;
  if (image.pixels.length !== expected) {
    throw new RangeError('image.pixels 길이가 RGBA 크기와 다르다: ' + image.pixels.length + ' !== ' + expected);
  }
}

function cloneImage(image) {
  assertImage(image);
  return { ...image, pixels: new Uint8ClampedArray(image.pixels) };
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(label + ' 는 유한한 수여야 한다: ' + value);
}

function assertRange(value, min, max, label) {
  assertFiniteNumber(value, label);
  if (value < min || value > max) {
    throw new RangeError(label + ' 는 ' + min + '..' + max + ' 범위여야 한다: ' + value);
  }
}

function assertUnit(value, label) {
  assertRange(value, 0, 1, label);
}

function clampByte(value) {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function normalizeFill(fill) {
  const source = fill === undefined ? DEFAULT_FILL : fill;
  if (source === null || typeof source !== 'object') {
    throw new TypeError('fill 은 {r,g,b,a} 객체여야 한다');
  }
  // fill 을 줬는데 a 가 없으면 예전엔 0 으로 채워 투명 구멍이 됐다.
  // 생략(DEFAULT_FILL.a=0)과 명시 a:0 은 그대로 두고, 빠진 a 만 거부한다.
  if (fill !== undefined && source.a === undefined) {
    throw new TypeError('fill.a 가 없다. 불투명은 a:255, 투명은 a:0 을 명시하라');
  }
  const result = {
    r: source.r === undefined ? 0 : source.r,
    g: source.g === undefined ? 0 : source.g,
    b: source.b === undefined ? 0 : source.b,
    a: source.a === undefined ? 0 : source.a,
  };
  for (const channel of ['r', 'g', 'b', 'a']) {
    assertRange(result[channel], 0, 255, 'fill.' + channel);
    result[channel] = Math.round(result[channel]);
  }
  return result;
}

function pixelChannel(image, x, y, channel, fill) {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) return fill[channel];
  return image.pixels[(y * image.width + x) * CHANNELS + channel];
}

/** source pixel 중심 좌표에서 bilinear 보간해 output[offset] 에 RGBA 를 쓴다. */
function writeBilinear(image, sourceX, sourceY, fill, output, offset) {
  if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
    output[offset] = fill.r;
    output[offset + 1] = fill.g;
    output[offset + 2] = fill.b;
    output[offset + 3] = fill.a;
    return;
  }

  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = sourceX - x0;
  const ty = sourceY - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;

  const fillChannels = [fill.r, fill.g, fill.b, fill.a];
  for (let channel = 0; channel < CHANNELS; channel += 1) {
    const value =
      pixelChannel(image, x0, y0, channel, fillChannels) * w00 +
      pixelChannel(image, x1, y0, channel, fillChannels) * w10 +
      pixelChannel(image, x0, y1, channel, fillChannels) * w01 +
      pixelChannel(image, x1, y1, channel, fillChannels) * w11;
    output[offset + channel] = clampByte(value);
  }
}

/**
 * destination → source 역매핑 함수로 한 번만 리샘플한다.
 * @param {(x:number,y:number)=>{x:number,y:number}} map
 */
function resampleImage(image, map, fill) {
  const output = new Uint8ClampedArray(image.pixels.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = map(x, y);
      writeBilinear(image, source.x, source.y, fill, output, (y * image.width + x) * CHANNELS);
    }
  }
  return { ...image, pixels: output };
}

function normalizedRotation(degrees) {
  const result = degrees % 360;
  return result === 0 ? 0 : result;
}

function geometricDistort(image, { rotation = 0, perspective = 0, scale = 1, axis = 'both', fill }) {
  assertImage(image);
  assertRange(rotation, 0, 360, 'rotation');
  assertRange(perspective, -MAX_TILT_DEGREES, MAX_TILT_DEGREES, 'perspective');
  assertRange(scale, 0.5, 2, 'scale');
  if (!['horizontal', 'vertical', 'both'].includes(axis)) {
    throw new RangeError('axis 는 horizontal, vertical, both 중 하나여야 한다: ' + axis);
  }

  const rotationValue = normalizedRotation(rotation);
  if (rotationValue === 0 && perspective === 0 && scale === 1) return cloneImage(image);

  const outFill = normalizeFill(fill);
  const centerX = (image.width - 1) / 2;
  const centerY = (image.height - 1) / 2;
  // 폭/높이가 1인 이미지에서도 0으로 나누지 않도록 정규화 반폭을 0.5로 둔다.
  const halfWidth = Math.max(centerX, 0.5);
  const halfHeight = Math.max(centerY, 0.5);
  const radians = (rotationValue * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // tan(theta)/2 는 정규화 화면에서 30°에도 분모가 양수인 projective skew 를
  // 만든다. both 는 두 축에 같은 기울기를 나눠 넣어 corner singularity 를 피한다.
  const projective = Math.tan((perspective * Math.PI) / 180) / 2;
  let perspectiveX = 0;
  let perspectiveY = 0;
  if (axis === 'horizontal') perspectiveX = projective;
  if (axis === 'vertical') perspectiveY = projective;
  if (axis === 'both') {
    perspectiveX = projective / Math.SQRT2;
    perspectiveY = projective / Math.SQRT2;
  }

  return resampleImage(image, (destinationX, destinationY) => {
    let x = destinationX - centerX;
    let y = destinationY - centerY;

    // forward 회전이 screen 좌표에서 clockwise 이므로 destination 에서 source 로
    // 돌아갈 때는 역행렬 [cos sin; -sin cos] 을 적용한다.
    if (rotationValue !== 0) {
      const rotatedX = cos * x + sin * y;
      const rotatedY = -sin * x + cos * y;
      x = rotatedX;
      y = rotatedY;
    }

    if (perspective !== 0) {
      const normalizedX = x / halfWidth;
      const normalizedY = y / halfHeight;
      const denominator = 1 + perspectiveX * normalizedX + perspectiveY * normalizedY;
      if (denominator <= 0) return { x: Number.NaN, y: Number.NaN };
      x = (normalizedX / denominator) * halfWidth;
      y = (normalizedY / denominator) * halfHeight;
    }

    // scale > 1 은 확대(zoom)이고, destination 한 칸이 source 에서는 더 가까운
    // 간격을 보도록 역변환한다. 따라서 0.5 는 축소·여백, 2 는 확대·crop 이다.
    return { x: centerX + x / scale, y: centerY + y / scale };
  }, outFill);
}

/**
 * 회전 왜곡.
 * @param {ImageDataLike} image
 * @param {number} degrees 0..360, 화면 기준 시계 방향
 * @param {{fill?: {r:number,g:number,b:number,a:number}}} [options]
 * @returns {ImageDataLike}
 */
export function rotateImage(image, degrees, options = {}) {
  return geometricDistort(image, { rotation: degrees, perspective: 0, scale: 1, fill: options.fill });
}

/**
 * 원근 기울기 왜곡. 기본 axis='both' 는 두 축을 같은 양으로 기울인다.
 * @param {ImageDataLike} image
 * @param {number} degrees -30..30
 * @param {{axis?: 'horizontal'|'vertical'|'both', fill?: object}} [options]
 * @returns {ImageDataLike}
 */
export function perspectiveImage(image, degrees, options = {}) {
  return geometricDistort(image, {
    rotation: 0,
    perspective: degrees,
    scale: 1,
    axis: options.axis === undefined ? 'both' : options.axis,
    fill: options.fill,
  });
}

/**
 * 고정 캔버스 스케일 왜곡.
 * @param {ImageDataLike} image
 * @param {number} factor 0.5..2
 * @param {{fill?: object}} [options]
 * @returns {ImageDataLike}
 */
export function scaleImage(image, factor, options = {}) {
  return geometricDistort(image, { rotation: 0, perspective: 0, scale: factor, fill: options.fill });
}

const TILT_AXIS_ANGLES = Object.freeze({
  horizontal: 0,
  vertical: 90,
  diagonal: 45,
});

/**
 * 카메라 기울기(원근) 왜곡 — 핀홀 카메라가 코드 평면을 θ° 기울여 보는 사영 워프.
 *
 * 모델 (스펙이자 자 검증 기준):
 *   - 평면 점 p 를 이미지 중심 기준으로 축 성분 t = p·a, 수직 성분 w = p·n 으로 분해.
 *     a = 회전축 단위벡터 (horizontal (1,0) · vertical (0,1) · diagonal 45°),
 *     n = a 를 +90° 돌린 수직벡터.
 *   - 축 둘레로 θ 회전: 평면 내 좌표 t·a + w·cosθ·n, 깊이 오프셋 w·sinθ.
 *   - 카메라 거리 d = distanceRatio · E (E = min(반폭, 반높이) — 심볼 반폭 근사),
 *     초점거리 f = d 로 두면 θ=0 이 항등이 된다. 사영:
 *       forward:  q = (t·a + w·cosθ·n) / (1 + w·sinθ/d)
 *   - 역매핑(dest→src, 리샘플에 쓰는 방향)은 닫힌 형태다:
 *       w = q_w / (cosθ − q_w·sinθ/d),  t = q_t · (1 + w·sinθ/d)
 *     분모 ≤ 0 은 수평선 너머 — fill 로 채운다.
 *
 * distanceRatio 는 원근 수렴(키스톤)의 세기다: 작을수록 광각 근접 촬영
 * (기본 4 = 심볼 반폭의 4배 거리 ≈ 심볼이 프레임을 크게 채우는 폰 촬영,
 * 심볼이 시야각 약 2·atan(1/4) ≈ 28° 를 차지). ∞ 면 순수 아핀 foreshortening.
 *
 * θ>0 에서 멀어지는 쪽: horizontal = 화면 아래(w=+y), vertical = 화면 왼쪽(w=−x),
 * diagonal = 왼쪽-아래. 부호만 다른 대칭이므로 봉투 측정에는 영향이 없다.
 *
 * @param {ImageDataLike} image
 * @param {number} degrees -60..60
 * @param {{axis?: 'horizontal'|'vertical'|'diagonal', distanceRatio?: number, fill?: object}} [options]
 * @returns {ImageDataLike}
 */
export function cameraTiltImage(image, degrees, options = {}) {
  assertImage(image);
  assertRange(degrees, -MAX_CAMERA_TILT_DEGREES, MAX_CAMERA_TILT_DEGREES, 'camera tilt degrees');
  const opts = optionObject(options, 'cameraTilt');
  const axis = opts.axis === undefined ? 'horizontal' : opts.axis;
  if (!(axis in TILT_AXIS_ANGLES)) {
    throw new RangeError('tilt axis 는 horizontal, vertical, diagonal 중 하나여야 한다: ' + axis);
  }
  const distanceRatio = opts.distanceRatio === undefined
    ? DEFAULT_TILT_DISTANCE_RATIO
    : opts.distanceRatio;
  assertRange(distanceRatio, 1.5, 1000, 'tilt distanceRatio');
  if (degrees === 0) return cloneImage(image);

  const fill = normalizeFill(opts.fill);
  const centerX = (image.width - 1) / 2;
  const centerY = (image.height - 1) / 2;
  const extent = Math.max(Math.min(centerX, centerY), 0.5);
  const distance = distanceRatio * extent;
  const phi = (TILT_AXIS_ANGLES[axis] * Math.PI) / 180;
  const axisX = Math.cos(phi);
  const axisY = Math.sin(phi);
  const normalX = -Math.sin(phi);
  const normalY = Math.cos(phi);
  const theta = (degrees * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return resampleImage(image, (destinationX, destinationY) => {
    const ux = destinationX - centerX;
    const uy = destinationY - centerY;
    const qt = ux * axisX + uy * axisY;
    const qw = ux * normalX + uy * normalY;
    const wDenominator = cosTheta - (qw * sinTheta) / distance;
    if (wDenominator <= 1e-9) return { x: Number.NaN, y: Number.NaN };
    const w = qw / wDenominator;
    const denominator = 1 + (w * sinTheta) / distance;
    if (denominator <= 1e-9) return { x: Number.NaN, y: Number.NaN };
    const t = qt * denominator;
    return {
      x: centerX + t * axisX + w * normalX,
      y: centerY + t * axisY + w * normalY,
    };
  }, fill);
}

/** 폰 광각 전형 k1 프리셋 (정규화 반경 = 반대각선 기준). */
export const BARREL_PRESETS = Object.freeze({
  phoneWideMild: 0.05,
  phoneWide: 0.1,
  phoneWideStrong: 0.15,
});

/**
 * 방사(배럴) 렌즈 왜곡 — r' = r·(1 + k1·r² [+ k2·r⁴]) 역매핑 샘플링.
 *
 * 규약 (스펙이자 자 검증 기준):
 *   - destination 픽셀의 정규화 반경 r 에서 source 를 r' = r·(1 + k1·r² + k2·r⁴) 에서
 *     샘플한다 (dest→src 역매핑이 닫힌 형태 — 수치 반전 없음).
 *   - 중심: 기본 이미지 중심 ((w−1)/2, (h−1)/2), options.center {x,y} 로 명시 가능.
 *   - 정규화 반경: 기본 반대각선 hypot(반폭, 반높이) — 이미지 코너가 r=1.
 *     options.radiusNorm 으로 명시 가능.
 *   - k1 > 0 이 배럴이다: source 의 콘텐츠가 반경에 따라 점점 중심 쪽으로 당겨져
 *     사각형 모서리가 안으로 말린다 (denominator 규약상 k<0 pincushion 은
 *     비단조 위험이 있어 범위 밖 — 측정 대상 아님).
 *   - forward(src→dest)는 3차식 반전이 필요하므로 여기서 제공하지 않는다 —
 *     자 검증 테스트가 Newton 반복으로 독립 구현해 대조한다.
 *
 * @param {ImageDataLike} image
 * @param {{k1?: number, k2?: number, center?: {x:number,y:number}, radiusNorm?: number, fill?: object}} [options]
 * @returns {ImageDataLike}
 */
export function barrelDistortImage(image, options = {}) {
  assertImage(image);
  const opts = optionObject(options, 'barrelDistort');
  const k1 = opts.k1 === undefined ? 0 : opts.k1;
  const k2 = opts.k2 === undefined ? 0 : opts.k2;
  assertRange(k1, 0, 0.6, 'barrel k1');
  assertRange(k2, 0, 0.3, 'barrel k2');
  if (k1 === 0 && k2 === 0) return cloneImage(image);

  const fill = normalizeFill(opts.fill);
  const defaultCenterX = (image.width - 1) / 2;
  const defaultCenterY = (image.height - 1) / 2;
  let centerX = defaultCenterX;
  let centerY = defaultCenterY;
  if (opts.center !== undefined) {
    const center = optionObject(opts.center, 'barrel center');
    assertFiniteNumber(center.x, 'barrel center.x');
    assertFiniteNumber(center.y, 'barrel center.y');
    centerX = center.x;
    centerY = center.y;
  }
  const defaultRadius = Math.hypot(
    Math.max(defaultCenterX, 0.5),
    Math.max(defaultCenterY, 0.5),
  );
  const radiusNorm = opts.radiusNorm === undefined ? defaultRadius : opts.radiusNorm;
  assertFiniteNumber(radiusNorm, 'barrel radiusNorm');
  if (radiusNorm <= 0) throw new RangeError('barrel radiusNorm 은 양수여야 한다: ' + radiusNorm);

  return resampleImage(image, (destinationX, destinationY) => {
    const rx = (destinationX - centerX) / radiusNorm;
    const ry = (destinationY - centerY) / radiusNorm;
    const r2 = rx * rx + ry * ry;
    const stretch = 1 + k1 * r2 + k2 * r2 * r2;
    return {
      x: centerX + rx * stretch * radiusNorm,
      y: centerY + ry * stretch * radiusNorm,
    };
  }, fill);
}

/**
 * xorshift32 결정적 균등 난수기. seed 가 같으면 호출 순서가 같은 한 바이트열이
 * 항상 같다. seed=0 도 영(零) 상태가 되지 않도록 고정 비영 상태를 사용한다.
 * @param {number|string|bigint} [seed=0]
 * @returns {()=>number} [0,1) 균등 난수
 */
export function createSeededRandom(seed = 0) {
  let state;
  if (typeof seed === 'number') {
    assertFiniteNumber(seed, 'seed');
    state = Math.trunc(seed) >>> 0;
  } else if (typeof seed === 'bigint') {
    state = Number(seed & 0xffffffffn) >>> 0;
  } else {
    const text = String(seed);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    }
    state = hash >>> 0;
  }
  if (state === 0) state = 0x9e3779b9;

  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state >>>= 0;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function nextGaussian(random, spare) {
  if (spare.value !== null) {
    const result = spare.value;
    spare.value = null;
    return result;
  }
  // u1=0 이면 log(0) 이 되므로 PRNG 의 최소 양의 값으로 바꾼다.
  const u1 = Math.max(random(), Number.MIN_VALUE);
  const u2 = random();
  const radius = Math.sqrt(-2 * Math.log(u1));
  const angle = 2 * Math.PI * u2;
  spare.value = radius * Math.sin(angle);
  return radius * Math.cos(angle);
}

/**
 * 결정적 Gaussian RGB 노이즈.
 * @param {ImageDataLike} image
 * @param {number} sigma 표준편차, 0..255 byte 단위
 * @param {{seed?: number|string|bigint}} [options]
 * @returns {ImageDataLike}
 */
export function addGaussianNoise(image, sigma = 0, options = {}) {
  assertImage(image);
  assertRange(sigma, 0, 255, 'noise sigma');
  if (sigma === 0) return cloneImage(image);
  if (options === null || typeof options !== 'object') {
    throw new TypeError('noise options 는 객체여야 한다');
  }

  const random = createSeededRandom(options.seed === undefined ? 0 : options.seed);
  const spare = { value: null };
  const output = new Uint8ClampedArray(image.pixels);
  for (let i = 0; i < output.length; i += CHANNELS) {
    for (let channel = 0; channel < 3; channel += 1) {
      output[i + channel] = clampByte(output[i + channel] + sigma * nextGaussian(random, spare));
    }
  }
  return { ...image, pixels: output };
}

/**
 * 감마 곡선의 단일 값. convention 은 out = in ** (1 / gamma) 이다.
 * gamma=1 은 항등, gamma>1 은 중간톤을 밝게, gamma<1 은 어둡게 한다.
 * @param {number} value 0..1
 * @param {number} gamma 0.6..1.8 (M1 매트릭스)
 */
export function gammaCurve(value, gamma) {
  assertUnit(value, 'gamma curve input');
  assertRange(gamma, 0.6, 1.8, 'gamma');
  return Math.pow(value, 1 / gamma);
}

/** 감마 곡선을 RGBA 이미지의 RGB 채널에 적용한다. alpha 는 보존한다. */
export function applyGamma(image, gamma) {
  assertImage(image);
  assertRange(gamma, 0.6, 1.8, 'gamma');
  if (gamma === 1) return cloneImage(image);
  const exponent = 1 / gamma;
  const output = new Uint8ClampedArray(image.pixels);
  for (let i = 0; i < output.length; i += CHANNELS) {
    output[i] = clampByte(Math.pow(output[i] / 255, exponent) * 255);
    output[i + 1] = clampByte(Math.pow(output[i + 1] / 255, exponent) * 255);
    output[i + 2] = clampByte(Math.pow(output[i + 2] / 255, exponent) * 255);
  }
  return { ...image, pixels: output };
}

/**
 * 대칭 S-커브.
 *
 * x + amount*x*(1-x)*(2*x-1) 는 양 끝을 고정하고 amount ∈ [-1,1] 에서
 * 도함수가 음수가 되지 않는다. amount=1 은 가장 강한 contrast S-커브이며,
 * amount=0 은 정확한 항등이다. logistic 함수를 쓰지 않아 끝점에서 0/1을
 * 반올림으로 잃지 않고, 단조성 검증의 기준 함수로도 직접 쓸 수 있다.
 */
export function sCurveValue(value, amount = DEFAULT_S_CURVE_AMOUNT) {
  assertUnit(value, 'S-curve input');
  assertRange(amount, -1, 1, 'S-curve amount');
  return value + amount * value * (1 - value) * (2 * value - 1);
}

/** S-커브를 RGB 채널에 적용한다. alpha 는 보존한다. */
export function applySCurve(image, amount = DEFAULT_S_CURVE_AMOUNT) {
  assertImage(image);
  assertRange(amount, -1, 1, 'S-curve amount');
  if (amount === 0) return cloneImage(image);
  const output = new Uint8ClampedArray(image.pixels);
  for (let i = 0; i < output.length; i += CHANNELS) {
    output[i] = clampByte(sCurveValue(output[i] / 255, amount) * 255);
    output[i + 1] = clampByte(sCurveValue(output[i + 1] / 255, amount) * 255);
    output[i + 2] = clampByte(sCurveValue(output[i + 2] / 255, amount) * 255);
  }
  return { ...image, pixels: output };
}

/**
 * 중심은 유지하고 모서리를 어둡게 하는 radial vignette.
 * amount=0..1, power>0. alpha 는 이미지 실루엣을 보존하기 위해 바꾸지 않는다.
 * @param {ImageDataLike} image
 * @param {number} amount 0..1
 * @param {{power?:number}} [options]
 */
export function applyVignette(image, amount = DEFAULT_VIGNETTE_AMOUNT, options = {}) {
  assertImage(image);
  assertRange(amount, 0, 1, 'vignette amount');
  if (options === null || typeof options !== 'object') {
    throw new TypeError('vignette options 는 객체여야 한다');
  }
  const power = options.power === undefined ? 1 : options.power;
  assertFiniteNumber(power, 'vignette power');
  if (power <= 0) throw new RangeError('vignette power 는 양수여야 한다: ' + power);
  if (amount === 0) return cloneImage(image);

  const output = new Uint8ClampedArray(image.pixels);
  const centerX = (image.width - 1) / 2;
  const centerY = (image.height - 1) / 2;
  const halfWidth = Math.max(centerX, 0.5);
  const halfHeight = Math.max(centerY, 0.5);
  for (let y = 0; y < image.height; y += 1) {
    const normalizedY = (y - centerY) / halfHeight;
    for (let x = 0; x < image.width; x += 1) {
      const normalizedX = (x - centerX) / halfWidth;
      const radius = Math.min(1, (normalizedX * normalizedX + normalizedY * normalizedY) / 2);
      const factor = 1 - amount * Math.pow(radius, power);
      const offset = (y * image.width + x) * CHANNELS;
      output[offset] = clampByte(output[offset] * factor);
      output[offset + 1] = clampByte(output[offset + 1] * factor);
      output[offset + 2] = clampByte(output[offset + 2] * factor);
    }
  }
  return { ...image, pixels: output };
}

const JPEG_LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

const DCT_COS = Array.from({ length: 8 }, (_, coordinate) =>
  Array.from({ length: 8 }, (_, frequency) =>
    Math.cos(((2 * coordinate + 1) * frequency * Math.PI) / 16),
  ),
);
const DCT_SCALE = [1 / Math.sqrt(2), 1, 1, 1, 1, 1, 1, 1];

function jpegQuantizationTable(quality) {
  assertRange(quality, 1, 100, 'JPEG quality');
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  return JPEG_LUMA_QUANT.map((base) => Math.max(1, Math.floor((base * scale + 50) / 100)));
}

/**
 * 8×8 DCT 양자화 손실을 적용한 JPEG 근사.
 * quality=60 이 SPEC §10의 M1 기본점이다. 결과의 크기·알파는 유지된다.
 */
export function applyJpegApproximation(image, quality = 60) {
  assertImage(image);
  const quantization = jpegQuantizationTable(quality);
  const output = new Uint8ClampedArray(image.pixels);
  const coefficients = new Float64Array(64);

  for (let blockY = 0; blockY < image.height; blockY += 8) {
    for (let blockX = 0; blockX < image.width; blockX += 8) {
      for (let channel = 0; channel < 3; channel += 1) {
        // forward DCT; edge block 은 마지막 유효 픽셀을 반복해 JPEG식 padding을 흉내 낸다.
        for (let frequencyY = 0; frequencyY < 8; frequencyY += 1) {
          for (let frequencyX = 0; frequencyX < 8; frequencyX += 1) {
            let sum = 0;
            for (let sampleY = 0; sampleY < 8; sampleY += 1) {
              const y = Math.min(blockY + sampleY, image.height - 1);
              for (let sampleX = 0; sampleX < 8; sampleX += 1) {
                const x = Math.min(blockX + sampleX, image.width - 1);
                const offset = (y * image.width + x) * CHANNELS + channel;
                sum +=
                  (image.pixels[offset] - 128) *
                  DCT_COS[sampleX][frequencyX] *
                  DCT_COS[sampleY][frequencyY];
              }
            }
            const index = frequencyY * 8 + frequencyX;
            const coefficient = 0.25 * DCT_SCALE[frequencyX] * DCT_SCALE[frequencyY] * sum;
            coefficients[index] = Math.round(coefficient / quantization[index]) * quantization[index];
          }
        }

        // inverse DCT. 같은 block 의 경계 밖 픽셀은 저장하지 않는다.
        const maxY = Math.min(8, image.height - blockY);
        const maxX = Math.min(8, image.width - blockX);
        for (let sampleY = 0; sampleY < maxY; sampleY += 1) {
          for (let sampleX = 0; sampleX < maxX; sampleX += 1) {
            let sum = 0;
            for (let frequencyY = 0; frequencyY < 8; frequencyY += 1) {
              for (let frequencyX = 0; frequencyX < 8; frequencyX += 1) {
                const index = frequencyY * 8 + frequencyX;
                sum +=
                  DCT_SCALE[frequencyX] *
                  DCT_SCALE[frequencyY] *
                  coefficients[index] *
                  DCT_COS[sampleX][frequencyX] *
                  DCT_COS[sampleY][frequencyY];
              }
            }
            const offset = ((blockY + sampleY) * image.width + blockX + sampleX) * CHANNELS + channel;
            output[offset] = clampByte(0.25 * sum + 128);
          }
        }
      }
    }
  }
  return { ...image, pixels: output };
}

function optionObject(value, label) {
  if (value === null || typeof value !== 'object') throw new TypeError(label + ' 옵션은 객체여야 한다');
  return value;
}

function readPerspectiveOption(value) {
  if (value === undefined) return { degrees: 0, axis: 'both' };
  if (typeof value === 'number') return { degrees: value, axis: 'both' };
  const object = optionObject(value, 'perspective');
  return {
    degrees: object.degrees === undefined ? object.angle === undefined ? 0 : object.angle : object.degrees,
    axis: object.axis === undefined ? 'both' : object.axis,
  };
}

function readTiltOption(value) {
  if (value === undefined) return { degrees: 0, axis: 'horizontal', distanceRatio: undefined };
  if (typeof value === 'number') {
    return { degrees: value, axis: 'horizontal', distanceRatio: undefined };
  }
  const object = optionObject(value, 'tilt');
  return {
    degrees: object.degrees === undefined ? 0 : object.degrees,
    axis: object.axis === undefined ? 'horizontal' : object.axis,
    distanceRatio: object.distanceRatio,
  };
}

function readBarrelOption(value) {
  if (value === undefined) return null;
  if (typeof value === 'number') return { k1: value };
  const object = optionObject(value, 'barrel');
  return {
    k1: object.k1 === undefined ? 0 : object.k1,
    k2: object.k2 === undefined ? 0 : object.k2,
    center: object.center,
    radiusNorm: object.radiusNorm,
  };
}

function readToneAmount(value, fallback, label) {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const object = optionObject(value, label);
  return object.amount === undefined ? fallback : object.amount;
}

/**
 * M1 전체 파이프라인.
 *
 * @param {ImageDataLike} image raster.js 형식 RGBA 이미지
 * @param {{
 *   rotation?: number,
 *   perspective?: number|{degrees?:number,angle?:number,axis?:string},
 *   tilt?: number|{degrees?:number,axis?:'horizontal'|'vertical'|'diagonal',distanceRatio?:number},
 *   barrel?: number|{k1?:number,k2?:number,center?:{x:number,y:number},radiusNorm?:number},
 *   scale?: number,
 *   fill?: {r:number,g:number,b:number,a:number},
 *   gamma?: number,
 *   sCurve?: number|{amount?:number},
 *   vignette?: number|{amount?:number,power?:number},
 *   noise?: number|{sigma?:number,seed?:number|string|bigint},
 *   noiseSigma?: number,
 *   seed?: number|string|bigint,
 *   jpegQuality?: number,
 * }} [options]
 * @returns {ImageDataLike}
 */
export function distortImage(image, options = {}) {
  assertImage(image);
  const opts = optionObject(options, 'distortImage');
  const perspective = readPerspectiveOption(opts.perspective);
  const rotation = opts.rotation === undefined ? 0 : opts.rotation;
  const scale = opts.scale === undefined ? 1 : opts.scale;

  let result = geometricDistort(image, {
    rotation,
    perspective: perspective.degrees,
    axis: perspective.axis,
    scale,
    fill: opts.fill,
  });

  // 카메라 포즈(tilt) → 렌즈(barrel) 순서 — 실제 촬영의 물리 순서와 같다.
  const tilt = readTiltOption(opts.tilt);
  if (tilt.degrees !== 0) {
    result = cameraTiltImage(result, tilt.degrees, {
      axis: tilt.axis,
      distanceRatio: tilt.distanceRatio,
      fill: opts.fill,
    });
  }
  const barrelOptions = readBarrelOption(opts.barrel);
  if (barrelOptions !== null && ((barrelOptions.k1 || 0) !== 0 || (barrelOptions.k2 || 0) !== 0)) {
    result = barrelDistortImage(result, { ...barrelOptions, fill: opts.fill });
  }

  if (opts.gamma !== undefined) result = applyGamma(result, opts.gamma);

  const sCurveAmount = readToneAmount(opts.sCurve, DEFAULT_S_CURVE_AMOUNT, 'sCurve');
  if (sCurveAmount !== undefined) result = applySCurve(result, sCurveAmount);

  let vignetteAmount;
  let vignetteOptions = {};
  if (opts.vignette !== undefined) {
    if (typeof opts.vignette === 'number') {
      vignetteAmount = opts.vignette;
    } else {
      vignetteOptions = optionObject(opts.vignette, 'vignette');
      vignetteAmount = vignetteOptions.amount === undefined ? DEFAULT_VIGNETTE_AMOUNT : vignetteOptions.amount;
    }
    result = applyVignette(result, vignetteAmount, vignetteOptions);
  }

  let noiseSigma;
  let noiseOptions = {};
  if (opts.noise !== undefined) {
    if (typeof opts.noise === 'number') {
      noiseSigma = opts.noise;
    } else {
      noiseOptions = { ...optionObject(opts.noise, 'noise') };
      noiseSigma = noiseOptions.sigma === undefined ? 0 : noiseOptions.sigma;
    }
  } else if (opts.noiseSigma !== undefined) {
    noiseSigma = opts.noiseSigma;
  }
  if (noiseSigma !== undefined) {
    if (noiseOptions.seed === undefined) noiseOptions.seed = opts.seed === undefined ? 0 : opts.seed;
    result = addGaussianNoise(result, noiseSigma, noiseOptions);
  }

  if (opts.jpegQuality !== undefined) result = applyJpegApproximation(result, opts.jpegQuality);
  return result;
}

// 읽기 쉬운 짧은 이름도 제공하되, 본문/JSDoc 에서는 의미가 분명한 이름을 우선한다.
export function rotate(image, degrees, options) {
  return rotateImage(image, degrees, options);
}

export function perspective(image, degrees, options) {
  return perspectiveImage(image, degrees, options);
}

export function scale(image, factor, options) {
  return scaleImage(image, factor, options);
}

export function cameraTilt(image, degrees, options) {
  return cameraTiltImage(image, degrees, options);
}

export function barrel(image, options) {
  return barrelDistortImage(image, options);
}

export function gaussianNoise(image, sigma, options) {
  return addGaussianNoise(image, sigma, options);
}

export function jpegApproximation(image, quality = 60) {
  return applyJpegApproximation(image, quality);
}

export function gamma(image, value) {
  return applyGamma(image, value);
}

export function sCurve(image, amount = DEFAULT_S_CURVE_AMOUNT) {
  return applySCurve(image, amount);
}

export function vignette(image, amount = DEFAULT_VIGNETTE_AMOUNT, options) {
  return applyVignette(image, amount, options);
}
