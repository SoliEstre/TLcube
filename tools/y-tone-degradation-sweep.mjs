/**
 * y-tone-degradation-sweep.mjs — Type Y 2톤/3톤의 촬영 열화 축을 같은 입력으로 대조한다.
 *
 * 한 행은 문안·버전·ECC·팔레트·여백·원본 해상도를 고정하고 tones 만 2/3으로
 * 바꾼 한 쌍이다. blur / low-resolution / perspective / gamma 는 서로 섞지
 * 않고 한 축씩만 적용한다. 따라서 결과는 어느 축과 강도에서 갈리는지 보여 주며,
 * 서로 다른 촬영 세트를 비교하는 근거로 쓰지 않는다.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { distortImage } from '../test/harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

export const Y_TONE_SWEEP_DEFAULTS = Object.freeze({
  text: 'https://tl.estre.so',
  version: 1,
  eccLevel: 'M',
  margin: 18,
  sourcePixelsPerUnit: 16,
  supersample: 2,
});

export const Y_TONE_SWEEP_LEVELS = Object.freeze({
  blur: Object.freeze([0, 0.8, 1.6, 2.4, 3.2]),
  lowResolution: Object.freeze([16, 12, 10, 8, 6, 4]),
  perspective: Object.freeze([0, 8, 16, 24, 30]),
  gamma: Object.freeze([0.6, 0.75, 1, 1.25, 1.5, 1.8]),
});

const AXIS_LABELS = Object.freeze({
  blur: '블러 σ',
  lowResolution: '저해상도 ppu',
  perspective: '투시 °',
  gamma: '감마',
});

function cloneRaster(raster) {
  return { ...raster, pixels: new Uint8ClampedArray(raster.pixels) };
}

/**
 * 결정적 separable Gaussian blur. 입력을 바꾸지 않고 RGBA alpha 는 보존한다.
 */
export function gaussianBlur(raster, sigma) {
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new RangeError('blur sigma는 0 이상의 유한한 수여야 한다: ' + sigma);
  }
  if (sigma === 0) return cloneRaster(raster);

  const radius = Math.ceil(3 * sigma);
  const weights = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= total;

  const { width, height } = raster;
  const horizontal = new Float32Array(width * height * 3);
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sourceX = Math.max(0, Math.min(width - 1, x + offset));
          sum += raster.pixels[(y * width + sourceX) * 4 + channel] * weights[offset + radius];
        }
        horizontal[(y * width + x) * 3 + channel] = sum;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sourceY = Math.max(0, Math.min(height - 1, y + offset));
          sum += horizontal[(sourceY * width + x) * 3 + channel] * weights[offset + radius];
        }
        pixels[(y * width + x) * 4 + channel] = Math.round(sum);
      }
    }
  }
  return { ...raster, pixels };
}

/**
 * 고해상도 원본을 targetPixelsPerUnit의 촬영본처럼 box-average로 축소한다.
 * 두 톤은 같은 원본 ppu와 target ppu를 쓰며, 출력 픽셀 수까지 쌍으로 검사한다.
 */
export function downsampleRaster(raster, sourcePixelsPerUnit, targetPixelsPerUnit) {
  if (!Number.isFinite(sourcePixelsPerUnit) || sourcePixelsPerUnit <= 0
    || !Number.isFinite(targetPixelsPerUnit) || targetPixelsPerUnit <= 0) {
    throw new RangeError('해상도는 양의 유한한 수여야 한다');
  }
  if (targetPixelsPerUnit >= sourcePixelsPerUnit) return cloneRaster(raster);

  const ratio = targetPixelsPerUnit / sourcePixelsPerUnit;
  const width = Math.max(1, Math.round(raster.width * ratio));
  const height = Math.max(1, Math.round(raster.height * ratio));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const sourceScaleX = raster.width / width;
  const sourceScaleY = raster.height / height;

  for (let targetY = 0; targetY < height; targetY += 1) {
    const startY = Math.floor(targetY * sourceScaleY);
    const endY = Math.min(raster.height, Math.ceil((targetY + 1) * sourceScaleY));
    for (let targetX = 0; targetX < width; targetX += 1) {
      const startX = Math.floor(targetX * sourceScaleX);
      const endX = Math.min(raster.width, Math.ceil((targetX + 1) * sourceScaleX));
      const sums = [0, 0, 0, 0];
      let samples = 0;
      for (let sourceY = startY; sourceY < endY; sourceY += 1) {
        for (let sourceX = startX; sourceX < endX; sourceX += 1) {
          const sourceOffset = (sourceY * raster.width + sourceX) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += raster.pixels[sourceOffset + channel];
          samples += 1;
        }
      }
      const targetOffset = (targetY * width + targetX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        pixels[targetOffset + channel] = Math.round(sums[channel] / samples);
      }
    }
  }
  return { width, height, pixels };
}

function stableValue(value) {
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return '[' + value.map(stableValue).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) =>
    key + ':' + stableValue(value[key])).join(',') + '}';
}

/**
 * 2/3톤 외의 모든 입력이 같은지 검사한다. 다르면 스윕 자체를 중단한다.
 */
export function validatePairedCondition(condition) {
  if (!condition || !condition.two || !condition.three) {
    throw new TypeError('paired condition에는 two/three 설정이 필요하다');
  }
  const two = condition.two;
  const three = condition.three;
  if (two.tones !== 2 || three.tones !== 3) {
    throw new RangeError('paired condition의 tones는 각각 2/3이어야 한다');
  }
  const keys = new Set([...Object.keys(two), ...Object.keys(three)]);
  const sharedKeys = [];
  for (const key of keys) {
    if (key === 'tones') continue;
    if (stableValue(two[key]) !== stableValue(three[key])) {
      throw new Error('2톤/3톤 입력 불일치: ' + key);
    }
    sharedKeys.push(key);
  }
  return Object.freeze({ controlled: true, sharedKeys: Object.freeze(sharedKeys.sort()) });
}

function makeToneConfig(base, tones, transform) {
  return Object.freeze({ ...base, tones, transform });
}

/**
 * 같은 설정 한 쌍을 만든다. 각 행에서 tones 외의 값은 동일 객체 또는 동일 값이다.
 */
export function createPairedSweepPlan(options = {}) {
  const base = Object.freeze({
    text: options.text === undefined ? Y_TONE_SWEEP_DEFAULTS.text : options.text,
    version: options.version === undefined ? Y_TONE_SWEEP_DEFAULTS.version : options.version,
    eccLevel: options.eccLevel === undefined ? Y_TONE_SWEEP_DEFAULTS.eccLevel : options.eccLevel,
    margin: options.margin === undefined ? Y_TONE_SWEEP_DEFAULTS.margin : options.margin,
    sourcePixelsPerUnit: options.sourcePixelsPerUnit === undefined
      ? Y_TONE_SWEEP_DEFAULTS.sourcePixelsPerUnit : options.sourcePixelsPerUnit,
    supersample: options.supersample === undefined
      ? Y_TONE_SWEEP_DEFAULTS.supersample : options.supersample,
  });
  const levels = options.levels === undefined ? Y_TONE_SWEEP_LEVELS : options.levels;
  const plan = [];

  for (const axis of Object.keys(Y_TONE_SWEEP_LEVELS)) {
    const axisLevels = levels[axis];
    if (!Array.isArray(axisLevels) || axisLevels.length === 0) {
      throw new RangeError(axis + ' axis needs one or more levels');
    }
    for (const level of axisLevels) {
      const transform = Object.freeze({ axis, level });
      const condition = Object.freeze({
        axis,
        level,
        two: makeToneConfig(base, 2, transform),
        three: makeToneConfig(base, 3, transform),
      });
      validatePairedCondition(condition);
      plan.push(condition);
    }
  }
  return Object.freeze(plan);
}

function renderFixture(config) {
  const encoded = encodeY(config.text, {
    version: config.version,
    tones: config.tones,
    eccLevel: config.eccLevel,
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: config.margin });
  const raster = rasterize(scene, {
    pixelsPerUnit: config.sourcePixelsPerUnit,
    supersample: config.supersample,
  });
  return { encoded, scene, raster };
}

function geometryFacts(fixture) {
  return Object.freeze({
    n: fixture.encoded.n,
    canvasWidth: fixture.raster.width,
    canvasHeight: fixture.raster.height,
    sceneWidth: fixture.scene.width,
    sceneHeight: fixture.scene.height,
  });
}

/**
 * 변환 전 기하 크기도 같은지 확인한다. tones의 의미 차이만 남겨야 한다.
 */
export function preparePairedCondition(condition) {
  const input = validatePairedCondition(condition);
  const two = renderFixture(condition.two);
  const three = renderFixture(condition.three);
  const twoGeometry = geometryFacts(two);
  const threeGeometry = geometryFacts(three);
  if (stableValue(twoGeometry) !== stableValue(threeGeometry)) {
    throw new Error('2톤/3톤 렌더 기하 불일치');
  }
  return Object.freeze({
    condition,
    input,
    geometry: twoGeometry,
    two,
    three,
  });
}

function applyDegradation(raster, config) {
  const { axis, level } = config.transform;
  if (axis === 'blur') return gaussianBlur(raster, level);
  if (axis === 'lowResolution') {
    return downsampleRaster(raster, config.sourcePixelsPerUnit, level);
  }
  if (axis === 'perspective') {
    return distortImage(raster, {
      perspective: { degrees: level, axis: 'both' },
      fill: FILL,
    });
  }
  if (axis === 'gamma') return distortImage(raster, { gamma: level });
  throw new RangeError('unknown degradation axis: ' + axis);
}

function decodeMeasurement(raster, config) {
  const result = decodeFrontend(raster);
  const decoded = result.ok === true
    && result.text === config.text
    && result.family === 'cube'
    && result.version === config.version
    && result.tones === config.tones;
  return Object.freeze({
    decoded,
    frontendOk: result.ok === true,
    reason: result.ok ? null : result.reason,
    pipelineStage: result.detail && result.detail.pipelineStage ? result.detail.pipelineStage : null,
    width: raster.width,
    height: raster.height,
  });
}

/**
 * 한 열화 강도에서 2/3톤 모두를 실행한다. output dimensions도 같은지 검증한다.
 */
export function runPairedCondition(condition) {
  const prepared = preparePairedCondition(condition);
  const twoRaster = applyDegradation(prepared.two.raster, condition.two);
  const threeRaster = applyDegradation(prepared.three.raster, condition.three);
  if (twoRaster.width !== threeRaster.width || twoRaster.height !== threeRaster.height) {
    throw new Error('2톤/3톤 열화 출력 크기 불일치');
  }
  const two = decodeMeasurement(twoRaster, condition.two);
  const three = decodeMeasurement(threeRaster, condition.three);
  return Object.freeze({
    axis: condition.axis,
    level: condition.level,
    pairing: Object.freeze({
      ...prepared.input,
      geometry: prepared.geometry,
      outputWidth: twoRaster.width,
      outputHeight: twoRaster.height,
    }),
    two,
    three,
    split: two.decoded !== three.decoded,
  });
}

function summarizeAxis(rows) {
  const twoPass = rows.filter((row) => row.two.decoded).length;
  const threePass = rows.filter((row) => row.three.decoded).length;
  const splitLevels = rows.filter((row) => row.split).map((row) => row.level);
  return Object.freeze({
    samples: rows.length,
    two: Object.freeze({ pass: twoPass, rate: twoPass / rows.length }),
    three: Object.freeze({ pass: threePass, rate: threePass / rows.length }),
    splitLevels: Object.freeze(splitLevels),
  });
}

/**
 * 전체 행을 실행한다. onProgress는 장시간 CLI 실행의 진행 표시 전용이다.
 */
export function runPairedSweep(plan = createPairedSweepPlan(), { onProgress } = {}) {
  const rows = [];
  for (let index = 0; index < plan.length; index += 1) {
    const row = runPairedCondition(plan[index]);
    rows.push(row);
    if (typeof onProgress === 'function') onProgress({ index: index + 1, total: plan.length, row });
  }
  const axes = Object.freeze(Object.fromEntries(
    Object.keys(Y_TONE_SWEEP_LEVELS).map((axis) => [
      axis,
      summarizeAxis(rows.filter((row) => row.axis === axis)),
    ]),
  ));
  const controlledPairs = rows.filter((row) => row.pairing.controlled).length;
  return Object.freeze({
    fixed: Object.freeze({ ...Y_TONE_SWEEP_DEFAULTS }),
    pairs: rows.length,
    controlledPairs,
    rows: Object.freeze(rows),
    axes,
  });
}

function mark(measurement) {
  return measurement.decoded ? '1/1' : '0/1';
}

export function formatPairedSweepReport(report) {
  const lines = [
    'Y 2톤/3톤 동조건 촬영 열화 스윕',
    '고정: text=' + report.fixed.text
      + ', version=' + report.fixed.version
      + ', ecc=' + report.fixed.eccLevel
      + ', margin=' + report.fixed.margin
      + ', source=' + report.fixed.sourcePixelsPerUnit + ' ppu',
    '동조건 검증: ' + report.controlledPairs + '/' + report.pairs
      + '쌍 (tones 외 입력·변환 전 기하·변환 후 크기 일치)',
    '',
    '축\t강도\tY 2톤\tY 3톤\t분기',
  ];
  for (const row of report.rows) {
    lines.push(
      (AXIS_LABELS[row.axis] || row.axis) + '\t'
      + row.level + '\t'
      + mark(row.two) + '\t'
      + mark(row.three) + '\t'
      + (row.split ? '갈림' : '같음'),
    );
  }
  lines.push('', '축별 복호율 (각 강도 1쌍):');
  for (const axis of Object.keys(report.axes)) {
    const summary = report.axes[axis];
    lines.push(
      (AXIS_LABELS[axis] || axis) + ': '
      + 'Y 2톤 ' + summary.two.pass + '/' + summary.samples
      + ', Y 3톤 ' + summary.three.pass + '/' + summary.samples
      + ', 분기=' + (summary.splitLevels.length ? summary.splitLevels.join(', ') : '없음'),
    );
  }
  return lines.join('\n');
}

function isMain() {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const plan = createPairedSweepPlan();
  const report = runPairedSweep(plan, {
    onProgress({ index, total, row }) {
      console.error('[' + index + '/' + total + '] ' + row.axis + '=' + row.level);
    },
  });
  console.log(formatPairedSweepReport(report));
}
