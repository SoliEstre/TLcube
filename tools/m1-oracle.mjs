/**
 * m1-oracle.mjs — M1 oracle-tone / oracle-geometry 사전 측정 드라이버
 *
 * 검출기와 호모그래피를 우회하고, 인코더가 만든 scene 기하를 그대로 주입한다.
 * 따라서 이 파일은 기하 왜곡을 실행하지 않는다. gamma/S-curve의 단조 톤 축과
 * noise/JPEG/vignette의 비기하 축을 OAT로 측정해 픽셀 순위 계약을 분리한다.
 */

import { appendFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { encode } from '../src/encode.js';
import { capacityFor, VERSIONS } from '../src/capacity.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeCells } from '../src/decode.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { digitToRanks } from '../src/lehmer.js';
import { FACES, hexCorners } from '../src/hexgrid.js';
import { measureCellFaceMedians, recoverDigit } from '../src/verify.js';
import { rasterToPng } from '../src/png.js';
import {
  applyGamma,
  applySCurve,
  distortImage,
} from '../test/harness/distort.mjs';

const TOOL_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(TOOL_PATH), '..');
const RUN_SEED = 'm1-2026-08-10-v1';
const CALIBRATION_RATIO = 0.60;
const HOLDOUT_RATIO = 0.40;
const HOLDOUT_TARGET_PER_ACCEPTANCE_CELL = 300;
const K_OF_VERSION = Object.freeze({ 1: 6, 2: 8, 3: 10 });
const EXCLUDED_GEOMETRY_AXES = Object.freeze(['rotation', 'perspective', 'scale']);
const RENDER_SEED = 'deterministic-render-v1';

const FULL_GRID = Object.freeze({
  rotation_degrees: Object.freeze([
    0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195,
    210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 360,
  ]),
  perspective: Object.freeze({
    degrees: Object.freeze([-30, -20, -10, 0, 10, 20, 30]),
    axis: Object.freeze(['horizontal', 'vertical', 'both']),
  }),
  scale: Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]),
  noise_sigma: Object.freeze([0, 2, 4, 8, 12, 16, 24, 32]),
  jpeg_quality_acceptance: Object.freeze([60]),
  gamma: Object.freeze([0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.8]),
  s_curve_amount: Object.freeze([-1, -0.6, -0.3, 0, 0.3, 0.6, 1]),
  vignette: Object.freeze({
    amount: Object.freeze([0, 0.25, 0.5, 0.75, 1]),
    power: Object.freeze([0.5, 1, 2]),
  }),
});

const FULL_CASES = Object.freeze([
  Object.freeze({
    id: 'v1-m-ascii',
    text: 'hello trilume',
    payloadFamily: 'short_ascii',
    version: 1,
    eccLevel: 'M',
  }),
  Object.freeze({
    id: 'v1-l-single',
    text: 'x',
    payloadFamily: 'single_byte',
    version: 1,
    eccLevel: 'L',
  }),
  Object.freeze({
    id: 'v2-m-url',
    text: 'https://tl.estre.so',
    payloadFamily: 'url',
    version: 2,
    eccLevel: 'M',
  }),
  Object.freeze({
    id: 'v3-m-korean',
    text: '한글 페이로드 테스트',
    payloadFamily: 'utf8_korean',
    version: 3,
    eccLevel: 'M',
  }),
  Object.freeze({
    id: 'v3-h-korean',
    text: '한국어 문자열 확인용',
    payloadFamily: 'utf8_korean',
    version: 3,
    eccLevel: 'H',
  }),
]);

const GENERATED_PAYLOAD_M_WEIGHT = 14;
const GENERATED_PAYLOAD_TOTAL_WEIGHT = 15;
const GENERATED_M_STRATA = Object.freeze([
  Object.freeze({ version: 1, eccLevel: 'M' }),
  Object.freeze({ version: 2, eccLevel: 'M' }),
  Object.freeze({ version: 3, eccLevel: 'M' }),
]);
const GENERATED_NON_M_STRATA = Object.freeze([
  Object.freeze({ version: 1, eccLevel: 'L' }),
  Object.freeze({ version: 1, eccLevel: 'H' }),
  Object.freeze({ version: 2, eccLevel: 'L' }),
  Object.freeze({ version: 2, eccLevel: 'H' }),
  Object.freeze({ version: 3, eccLevel: 'L' }),
  Object.freeze({ version: 3, eccLevel: 'H' }),
]);
const GENERATED_PAYLOAD_FAMILIES = Object.freeze(['ascii', 'utf8_korean', 'emoji', 'mixed', 'url']);
const GENERATED_PIXELS_PER_UNIT = Object.freeze([8, 10, 14]);
const ASCII_PAYLOAD_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._';
const URL_PAYLOAD_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789.-_/';
const KOREAN_PAYLOAD_TOKENS = Object.freeze(['한', '글', '빛', '큐', '브', '테', '스', '트']);
const EMOJI_PAYLOAD_TOKENS = Object.freeze(['🚀', '🧊', '🌈', '🧩', '📦']);
const TEXT_ENCODER = new TextEncoder();

function utf8ByteLength(text) {
  return TEXT_ENCODER.encode(text).length;
}

function deterministicInteger(seed, label, minimum, maximum) {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
    throw new RangeError('결정적 정수 범위가 유효하지 않습니다: ' + minimum + '..' + maximum);
  }
  const span = maximum - minimum + 1;
  const value = Number.parseInt(sha256(String(seed) + '\u0000' + label).slice(0, 8), 16);
  return minimum + value % span;
}

function deterministicPick(seed, label, values) {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError('결정적 선택 후보가 비어 있습니다.');
  return values[deterministicInteger(seed, label, 0, values.length - 1)];
}

function fillPayloadToByteLength({ prefix, targetBytes, tokens, fallbackAlphabet, seed, label }) {
  let text = prefix;
  let used = utf8ByteLength(text);
  if (used > targetBytes) throw new RangeError('payload prefix 가 목표 바이트 수를 초과합니다.');
  let tokenIndex = 0;
  while (used < targetBytes) {
    const fitting = tokens.filter((token) => utf8ByteLength(token) <= targetBytes - used);
    if (fitting.length === 0) break;
    const token = deterministicPick(seed, label + ':token:' + tokenIndex, fitting);
    text += token;
    used += utf8ByteLength(token);
    tokenIndex += 1;
  }
  const fallbackChars = [...fallbackAlphabet];
  let fillIndex = 0;
  while (used < targetBytes) {
    text += deterministicPick(seed, label + ':ascii:' + fillIndex, fallbackChars);
    used += 1;
    fillIndex += 1;
  }
  if (utf8ByteLength(text) !== targetBytes) throw new Error('결정적 payload 바이트 회계가 일치하지 않습니다.');
  return text;
}

function makeGeneratedPayload({ requestedFamily, targetBytes, payloadSeed, label }) {
  let payloadFamily = requestedFamily;
  let prefix = '';
  let tokens = [...ASCII_PAYLOAD_ALPHABET];
  let fallbackAlphabet = ASCII_PAYLOAD_ALPHABET;
  if (requestedFamily === 'utf8_korean') {
    if (targetBytes >= 3) {
      prefix = deterministicPick(payloadSeed, label + ':korean-prefix', KOREAN_PAYLOAD_TOKENS);
      tokens = KOREAN_PAYLOAD_TOKENS;
    } else {
      payloadFamily = 'ascii_fallback_from_utf8_korean';
    }
  } else if (requestedFamily === 'emoji') {
    if (targetBytes >= 4) {
      prefix = deterministicPick(payloadSeed, label + ':emoji-prefix', EMOJI_PAYLOAD_TOKENS);
      tokens = EMOJI_PAYLOAD_TOKENS;
    } else {
      payloadFamily = 'ascii_fallback_from_emoji';
    }
  } else if (requestedFamily === 'mixed') {
    if (targetBytes >= 8) {
      prefix = 'T'
        + deterministicPick(payloadSeed, label + ':mixed-korean-prefix', KOREAN_PAYLOAD_TOKENS)
        + deterministicPick(payloadSeed, label + ':mixed-emoji-prefix', EMOJI_PAYLOAD_TOKENS);
      tokens = [...ASCII_PAYLOAD_ALPHABET, ...KOREAN_PAYLOAD_TOKENS, ...EMOJI_PAYLOAD_TOKENS];
    } else if (targetBytes >= 4) {
      prefix = deterministicPick(payloadSeed, label + ':mixed-emoji-prefix', EMOJI_PAYLOAD_TOKENS);
      tokens = [...ASCII_PAYLOAD_ALPHABET, ...KOREAN_PAYLOAD_TOKENS, ...EMOJI_PAYLOAD_TOKENS];
    } else if (targetBytes >= 3) {
      prefix = deterministicPick(payloadSeed, label + ':mixed-korean-prefix', KOREAN_PAYLOAD_TOKENS);
      tokens = [...ASCII_PAYLOAD_ALPHABET, ...KOREAN_PAYLOAD_TOKENS];
    } else {
      payloadFamily = 'ascii_fallback_from_mixed';
    }
  } else if (requestedFamily === 'url') {
    if (targetBytes >= 9) {
      prefix = 'https://x';
      tokens = [...URL_PAYLOAD_ALPHABET];
      fallbackAlphabet = URL_PAYLOAD_ALPHABET;
    } else {
      payloadFamily = 'ascii_fallback_from_url';
    }
  }
  const text = fillPayloadToByteLength({
    prefix,
    targetBytes,
    tokens,
    fallbackAlphabet,
    seed: payloadSeed,
    label,
  });
  return { text, payloadFamily };
}

function payloadCapacityFor(version, eccLevel) {
  const spec = VERSIONS.find((entry) => entry.version === version);
  if (!spec) throw new RangeError('지원하지 않는 version: ' + version);
  return capacityFor(spec, eccLevel).maxPayloadBytes;
}

function generatedTargetBytes(maxPayloadBytes, stratumOrdinal, payloadSeed, label) {
  const anchors = [
    1,
    maxPayloadBytes,
    Math.max(1, Math.floor(maxPayloadBytes / 2)),
    Math.max(1, maxPayloadBytes - 1),
  ];
  if (stratumOrdinal < anchors.length) return anchors[stratumOrdinal];
  return deterministicInteger(payloadSeed, label + ':target-bytes', 1, maxPayloadBytes);
}

function generatedStratumKey(version, eccLevel) {
  return 'V' + version + '-ECC-' + eccLevel;
}

function allocateGeneratedPayloadStrata(generatedSceneCount) {
  const hasFullStratumCoverage = generatedSceneCount >= GENERATED_M_STRATA.length + GENERATED_NON_M_STRATA.length;
  const nominalNonMCount = generatedSceneCount
    - Math.floor(generatedSceneCount * GENERATED_PAYLOAD_M_WEIGHT / GENERATED_PAYLOAD_TOTAL_WEIGHT);
  const nonMCount = Math.max(hasFullStratumCoverage ? GENERATED_NON_M_STRATA.length : 0, nominalNonMCount);
  const mCount = generatedSceneCount - nonMCount;
  const entries = [];
  const countsByStratum = {};
  for (let index = 0; index < mCount; index += 1) {
    const stratum = GENERATED_M_STRATA[index % GENERATED_M_STRATA.length];
    const stratumOrdinal = Math.floor(index / GENERATED_M_STRATA.length);
    const key = generatedStratumKey(stratum.version, stratum.eccLevel);
    entries.push({ generationIndex: entries.length, stratum, stratumOrdinal, kind: 'acceptance_ecc_m' });
    countsByStratum[key] = (countsByStratum[key] || 0) + 1;
  }
  for (let index = 0; index < nonMCount; index += 1) {
    const stratum = GENERATED_NON_M_STRATA[index % GENERATED_NON_M_STRATA.length];
    const stratumOrdinal = Math.floor(index / GENERATED_NON_M_STRATA.length);
    const key = generatedStratumKey(stratum.version, stratum.eccLevel);
    entries.push({ generationIndex: entries.length, stratum, stratumOrdinal, kind: 'coverage_non_m' });
    countsByStratum[key] = (countsByStratum[key] || 0) + 1;
  }
  return {
    entries,
    metadata: {
      requested_scenes: generatedSceneCount,
      acceptance_ecc_m_payloads: mCount,
      coverage_non_m_payloads: nonMCount,
      allocation: 'ECC-M 14/15 목표 비중 + n>=9 에서 9개 version/ECC stratum 최소 1개',
      counts_by_stratum: countsByStratum,
    },
  };
}

function buildGeneratedCases(generatedSceneCount, payloadSeed) {
  const plan = allocateGeneratedPayloadStrata(generatedSceneCount);
  const cases = plan.entries.map((entry) => {
    const { version, eccLevel } = entry.stratum;
    const stratumKey = generatedStratumKey(version, eccLevel);
    const maxPayloadBytes = payloadCapacityFor(version, eccLevel);
    const targetBytes = generatedTargetBytes(
      maxPayloadBytes,
      entry.stratumOrdinal,
      payloadSeed,
      stratumKey + ':' + entry.stratumOrdinal,
    );
    const familyOffset = deterministicInteger(payloadSeed, stratumKey + ':family-offset', 0, GENERATED_PAYLOAD_FAMILIES.length - 1);
    const requestedFamily = GENERATED_PAYLOAD_FAMILIES[
      (entry.stratumOrdinal + familyOffset) % GENERATED_PAYLOAD_FAMILIES.length
    ];
    const payload = makeGeneratedPayload({
      requestedFamily,
      targetBytes,
      payloadSeed,
      label: stratumKey + ':' + entry.stratumOrdinal,
    });
    const actualBytes = utf8ByteLength(payload.text);
    if (actualBytes > maxPayloadBytes || actualBytes !== targetBytes) {
      throw new RangeError('생성 payload 가 V' + version + '/ECC-' + eccLevel + ' 용량 계약을 벗어났습니다.');
    }
    return {
      id: 'generated-' + String(entry.generationIndex).padStart(4, '0'),
      text: payload.text,
      payloadFamily: payload.payloadFamily,
      payloadFamilyRequested: requestedFamily,
      version,
      eccLevel,
      pixelsPerUnit: deterministicPick(payloadSeed, 'pixels-per-unit:' + entry.generationIndex, GENERATED_PIXELS_PER_UNIT),
      corpusSource: 'generated',
      generation: {
        seed: payloadSeed,
        index: entry.generationIndex,
        stratum: stratumKey,
        stratum_ordinal: entry.stratumOrdinal,
        allocation_kind: entry.kind,
        target_bytes: targetBytes,
        actual_bytes: actualBytes,
        max_payload_bytes: maxPayloadBytes,
      },
    };
  });
  return {
    cases,
    metadata: {
      ...plan.metadata,
      payload_seed: payloadSeed,
      generator: 'sha256 counter-derived selection; Math.random() 미사용',
    },
  };
}

function sha256(value) {
  const hash = createHash('sha256');
  if (typeof value === 'string') {
    hash.update(value, 'utf8');
  } else if (value instanceof Uint8Array) {
    hash.update(value);
  } else {
    hash.update(JSON.stringify(value), 'utf8');
  }
  return hash.digest('hex');
}

function sha256Raster(raster) {
  const hash = createHash('sha256');
  hash.update('tlcube-raster-v1', 'utf8');
  hash.update(String(raster.width), 'utf8');
  hash.update(String(raster.height), 'utf8');
  hash.update(String(raster.pixelsPerUnit), 'utf8');
  hash.update(Buffer.from(raster.pixels.buffer, raster.pixels.byteOffset, raster.pixels.byteLength));
  return hash.digest('hex');
}

function cloneMedians(medians) {
  return { T: medians.T, L: medians.L, R: medians.R };
}

function equalArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function numberToken(value) {
  return String(value).replace('-', 'neg').replace('.', 'p');
}

function orderForDigit(digit) {
  const ranks = digitToRanks(digit);
  return FACES.slice().sort((left, right) => ranks[left] - ranks[right] || FACES.indexOf(left) - FACES.indexOf(right));
}

function rankingInfo(medians, nearTieThreshold) {
  const ranked = FACES.map((face, index) => ({ face, index, value: medians[face] }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const sortedValues = ranked.map((entry) => entry.value);
  const differences = [
    sortedValues[1] - sortedValues[0],
    sortedValues[2] - sortedValues[1],
  ];
  const exactTie = differences.some((difference) => Math.abs(difference) <= Number.EPSILON);
  const minMargin = Math.min(...differences);
  const nearTieConfigured = Number.isFinite(nearTieThreshold);
  return {
    order: ranked.map((entry) => entry.face),
    sorted_values: sortedValues,
    adjacent_margins: differences,
    min_margin: minMargin,
    exact_tie: exactTie,
    near_tie: nearTieConfigured ? minMargin <= nearTieThreshold : null,
    near_tie_threshold: nearTieConfigured ? nearTieThreshold : null,
    near_tie_status: nearTieConfigured ? 'CONFIGURED' : 'UNCALIBRATED',
  };
}

function makePalette() {
  const preset = getPreset(DEFAULT_PRESET);
  return {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function buildSceneSpecs(quick, generatedSceneCount = 0, payloadSeed = RUN_SEED + ':payload-v1') {
  const regressionCases = quick ? FULL_CASES.filter((entry) => entry.eccLevel === 'M') : FULL_CASES;
  const generated = buildGeneratedCases(generatedSceneCount, payloadSeed);
  const cases = [
    ...regressionCases.map((entry) => ({
      ...entry,
      payloadFamilyRequested: entry.payloadFamily,
      corpusSource: 'FULL_CASES',
      generation: null,
    })),
    ...generated.cases,
  ];
  const regressionPixelsPerUnitValues = quick ? [8] : [8, 14];
  const scenes = [];
  for (const entry of cases) {
    const maxPayloadBytes = payloadCapacityFor(entry.version, entry.eccLevel);
    const payloadBytes = utf8ByteLength(entry.text);
    if (payloadBytes > maxPayloadBytes) {
      throw new RangeError('scene payload 가 V' + entry.version + '/ECC-' + entry.eccLevel + ' 실제 용량을 초과합니다.');
    }
    const pixelsPerUnitValues = entry.pixelsPerUnit === undefined
      ? regressionPixelsPerUnitValues
      : [entry.pixelsPerUnit];
    for (const pixelsPerUnit of pixelsPerUnitValues) {
      const descriptor = {
        case_id: entry.id,
        corpus_source: entry.corpusSource,
        payload_family: entry.payloadFamily,
        payload_family_requested: entry.payloadFamilyRequested,
        payload_bytes: payloadBytes,
        payload_sha256: sha256(entry.text),
        version: entry.version,
        eccLevel: entry.eccLevel,
        max_payload_bytes: maxPayloadBytes,
        pixelsPerUnit,
        renderer_preset: DEFAULT_PRESET,
        render_seed: RENDER_SEED,
        generation: entry.generation,
      };
      const sceneClusterId = 'cluster-' + sha256(descriptor).slice(0, 16);
      scenes.push({
        ...entry,
        payloadBytes,
        maxPayloadBytes,
        pixelsPerUnit,
        renderSeed: RENDER_SEED,
        sceneClusterId,
        sceneId: 'scene-' + sha256({ ...descriptor, scene_cluster_id: sceneClusterId }).slice(0, 16),
        payloadId: 'payload-' + sha256(entry.text).slice(0, 16),
      });
    }
  }
  return { scenes, generation: generated.metadata };
}

function splitStratumFor(scene) {
  return generatedStratumKey(scene.version, scene.eccLevel);
}

function assignSplits(sceneSpecs, runSeed) {
  const clustersByStratum = new Map();
  const stratumByCluster = new Map();
  for (const scene of sceneSpecs) {
    const stratum = splitStratumFor(scene);
    const previousStratum = stratumByCluster.get(scene.sceneClusterId);
    if (previousStratum && previousStratum !== stratum) {
      throw new Error('scene cluster 가 둘 이상의 split stratum 에 걸쳐 있습니다: ' + scene.sceneClusterId);
    }
    stratumByCluster.set(scene.sceneClusterId, stratum);
    if (!clustersByStratum.has(stratum)) clustersByStratum.set(stratum, new Set());
    clustersByStratum.get(stratum).add(scene.sceneClusterId);
  }
  const splitByCluster = new Map();
  for (const stratum of [...clustersByStratum.keys()].sort()) {
    const clusters = [...clustersByStratum.get(stratum)]
      .sort((left, right) => {
        const leftHash = sha256(runSeed + '\u0000' + stratum + '\u0000' + left);
        const rightHash = sha256(runSeed + '\u0000' + stratum + '\u0000' + right);
        return leftHash.localeCompare(rightHash) || left.localeCompare(right);
      });
    let calibrationCount = Math.round(clusters.length * CALIBRATION_RATIO);
    if (clusters.length > 1) calibrationCount = Math.min(clusters.length - 1, Math.max(1, calibrationCount));
    if (clusters.length === 1) calibrationCount = 0;
    clusters.forEach((cluster, index) => {
      splitByCluster.set(cluster, index < calibrationCount ? 'calibration' : 'holdout');
    });
  }
  return splitByCluster;
}

function splitActual(sceneSpecs, splitByCluster) {
  const clusters = new Map();
  for (const scene of sceneSpecs) {
    if (!clusters.has(scene.sceneClusterId)) {
      clusters.set(scene.sceneClusterId, {
        stratum: splitStratumFor(scene),
        split: splitByCluster.get(scene.sceneClusterId),
      });
    }
  }
  const byStratum = {};
  let calibrationClusters = 0;
  let holdoutClusters = 0;
  for (const stratum of [...new Set([...clusters.values()].map((entry) => entry.stratum))].sort()) {
    byStratum[stratum] = { calibration_clusters: 0, holdout_clusters: 0 };
  }
  for (const entry of clusters.values()) {
    if (entry.split === 'calibration') {
      calibrationClusters += 1;
      byStratum[entry.stratum].calibration_clusters += 1;
    } else {
      holdoutClusters += 1;
      byStratum[entry.stratum].holdout_clusters += 1;
    }
  }
  return { calibration_clusters: calibrationClusters, holdout_clusters: holdoutClusters, by_stratum: byStratum };
}

function buildDistortionCells(quick) {
  const grid = {
    gamma: quick ? [0.6, 1, 1.8] : FULL_GRID.gamma,
    sCurve: quick ? [-1, 0, 1] : FULL_GRID.s_curve_amount,
    noise: quick ? [0, 16, 32] : FULL_GRID.noise_sigma,
    vignetteAmount: quick ? [0, 0.5, 1] : FULL_GRID.vignette.amount,
    vignettePower: quick ? [1, 2] : FULL_GRID.vignette.power,
  };
  const cells = [{
    id: 'baseline',
    axis: 'baseline',
    parameter: 0,
    params: {},
    h1_eligible: false,
    track: 'oracle_geometry',
  }];
  for (const gamma of grid.gamma) {
    cells.push({
      id: 'gamma-' + numberToken(gamma),
      axis: 'gamma',
      parameter: gamma,
      params: { gamma },
      h1_eligible: true,
      track: 'oracle_tone',
    });
  }
  for (const amount of grid.sCurve) {
    cells.push({
      id: 's-curve-' + numberToken(amount),
      axis: 's_curve',
      parameter: amount,
      params: { sCurve: { amount } },
      h1_eligible: true,
      track: 'oracle_tone',
    });
  }
  for (const sigma of grid.noise) {
    cells.push({
      id: 'noise-sigma-' + numberToken(sigma),
      axis: 'noise',
      parameter: sigma,
      params: { noise: { sigma } },
      h1_eligible: false,
      track: 'oracle_geometry',
    });
  }
  cells.push({
    id: 'jpeg-q60',
    axis: 'jpeg',
    parameter: 60,
    params: { jpegQuality: 60 },
    h1_eligible: false,
    track: 'oracle_geometry',
  });
  for (const amount of grid.vignetteAmount) {
    for (const power of grid.vignettePower) {
      cells.push({
        id: 'vignette-a' + numberToken(amount) + '-p' + numberToken(power),
        axis: 'vignette',
        parameter: { amount, power },
        params: { vignette: { amount, power } },
        h1_eligible: false,
        track: 'oracle_geometry',
      });
    }
  }
  return cells;
}

function materializeDistortionParams(cell, distortionSeed) {
  if (cell.axis === 'noise') {
    return { noise: { sigma: cell.parameter, seed: distortionSeed } };
  }
  if (cell.axis === 's_curve') return { sCurve: { amount: cell.parameter } };
  if (cell.axis === 'vignette') {
    return { vignette: { amount: cell.parameter.amount, power: cell.parameter.power } };
  }
  if (cell.axis === 'gamma') return { gamma: cell.parameter };
  if (cell.axis === 'jpeg') return { jpegQuality: 60 };
  return {};
}

function createRampImage() {
  const pixels = new Uint8ClampedArray(256 * 4);
  for (let value = 0; value < 256; value += 1) {
    const offset = value * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return { width: 256, height: 1, pixels };
}

function preflightTransform(axis, parameter, transform) {
  const output = transform(createRampImage());
  let decreasingCount = 0;
  let plateauCount = 0;
  let firstDecrease = null;
  for (let value = 1; value < 256; value += 1) {
    const previous = output.pixels[(value - 1) * 4];
    const current = output.pixels[value * 4];
    if (current < previous) {
      decreasingCount += 1;
      if (firstDecrease === null) firstDecrease = { input: value, previous, current };
    }
    if (current === previous) plateauCount += 1;
  }
  return {
    axis,
    parameter,
    domain: '8-bit neutral RGB ramp (0..255), actual harness implementation',
    monotonic: decreasingCount === 0,
    decreasing_count: decreasingCount,
    plateau_count: plateauCount,
    first_decrease: firstDecrease,
  };
}

function buildTonePreflight(distortionCells) {
  const entries = [];
  for (const cell of distortionCells) {
    if (cell.axis === 'gamma') {
      entries.push(preflightTransform('gamma', cell.parameter, (image) => applyGamma(image, cell.parameter)));
    }
    if (cell.axis === 's_curve') {
      entries.push(preflightTransform('s_curve', cell.parameter, (image) => applySCurve(image, cell.parameter)));
    }
  }
  const lookup = new Map(entries.map((entry) => [entry.axis + ':' + JSON.stringify(entry.parameter), entry]));
  return { entries, lookup };
}

function prepareScene(sceneSpec, split, nearTieThreshold) {
  const encoded = encode(sceneSpec.text, { version: sceneSpec.version, eccLevel: sceneSpec.eccLevel });
  const scene = buildScene(encoded, { palette: makePalette() });
  const raster = rasterize(scene, { pixelsPerUnit: sceneSpec.pixelsPerUnit, supersample: 2 });
  const k = K_OF_VERSION[encoded.version];
  if (k === undefined) throw new RangeError('지원하지 않는 Type O version: ' + encoded.version);

  const cells = [];
  const digits = [];
  let baselineMismatchCount = 0;
  let baselineTieCount = 0;
  for (const cell of dataCellsInScanOrder(k)) {
    const q = cell.q === undefined ? cell[0] : cell.q;
    const r = cell.r === undefined ? cell[1] : cell.r;
    const truth = encoded.cellDigits.get(q + ',' + r);
    if (!truth) throw new Error('encoded.cellDigits 에 data cell 이 없습니다: ' + q + ',' + r);
    const medians = measureCellFaceMedians(raster, scene, q, r);
    const ranking = rankingInfo(medians, nearTieThreshold);
    const expectedOrder = orderForDigit(truth.digit);
    const recovered = recoverDigit(medians);
    if (recovered !== truth.digit || !equalArrays(ranking.order, expectedOrder)) baselineMismatchCount += 1;
    if (ranking.exact_tie || ranking.near_tie === true) baselineTieCount += 1;
    digits.push(recovered);
    cells.push({
      q,
      r,
      key: q + ',' + r,
      expectedDigit: truth.digit,
      expectedOrder,
      baselineMedians: cloneMedians(medians),
      baselineRanking: ranking,
      baselineRecovered: recovered,
    });
  }
  const baselineDecode = decodeCells(digits, {
    version: encoded.version,
    eccLevel: sceneSpec.eccLevel,
    k,
  });
  const baselinePayloadMatches = baselineDecode.ok === true && baselineDecode.text === sceneSpec.text;
  const baselineOk = baselineMismatchCount === 0
    && baselineTieCount === 0
    && baselinePayloadMatches
    && baselineDecode.corrected === 0;
  return {
    sceneSpec,
    split,
    encoded,
    scene,
    raster,
    k,
    cells,
    inputSha256: sha256Raster(raster),
    expectedTextSha256: sha256(sceneSpec.text),
    baseline: {
      mismatch_count: baselineMismatchCount,
      tie_count: baselineTieCount,
      decode: serializeDecodeResult(baselineDecode),
      payload_matches: baselinePayloadMatches,
      ok: baselineOk,
    },
  };
}

function serializeDecodeResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, text_sha256: null, corrected: null, stage: 'runner', reason: 'decoder result 가 객체가 아닙니다' };
  }
  return {
    ok: result.ok === true,
    text_sha256: result.ok === true && typeof result.text === 'string' ? sha256(result.text) : null,
    corrected: Number.isInteger(result.corrected) ? result.corrected : null,
    crsDistance: Number.isFinite(result.crsDistance) ? result.crsDistance : null,
    stage: result.stage === undefined ? null : result.stage,
    reason: result.reason === undefined ? null : String(result.reason),
  };
}

function decodePayloadMatches(result, expectedText) {
  return result && result.ok === true && result.text === expectedText;
}

function h1PreflightFor(cell, tonePreflight) {
  return tonePreflight.lookup.get(cell.axis + ':' + JSON.stringify(cell.parameter)) || null;
}

function classifyNoCellDecodeFailure(prepared, distortion) {
  if (!prepared.baseline.ok) return 'MEASUREMENT_INVALID';
  if (distortion.axis === 'vignette') return 'SPATIAL_TONE_FIELD_FAILURE';
  if (distortion.axis === 'noise' || distortion.axis === 'jpeg') return 'ROBUSTNESS_FAILURE';
  return 'IMPLEMENTATION_FAILURE';
}

function issueForCell(context) {
  const {
    prepared,
    distortion,
    cell,
    payloadMatches,
    decodeFailed,
    tonePreflight,
    nearTieThreshold,
  } = context;
  const hasAnyTie = cell.baselineRanking.exact_tie || cell.observedRanking.exact_tie;
  const hasConfiguredNearTie = cell.baselineRanking.near_tie === true || cell.observedRanking.near_tie === true;
  const strictRankReversal = !equalArrays(cell.expectedOrder, cell.observedRanking.order)
    && !hasAnyTie
    && !hasConfiguredNearTie;
  const h1Preflight = distortion.h1_eligible ? h1PreflightFor(distortion, tonePreflight) : null;
  const common = {
    stage: 'oracle_median',
    cell,
    strict_rank_reversal: strictRankReversal,
    h1_preflight: h1Preflight,
    h1_conditions: {
      monotonic_preflight: h1Preflight ? h1Preflight.monotonic : false,
      exact_oracle_geometry_and_format: true,
      strict_rank_reversal: strictRankReversal,
      recover_digit_mismatch: cell.expectedDigit !== cell.recoveredDigit,
      decode_failure_or_payload_mismatch: decodeFailed,
      deterministic_replays: null,
      audit_status: 'PENDING',
    },
  };

  if (!prepared.baseline.ok) {
    return {
      ...common,
      failure_class: 'MEASUREMENT_INVALID',
      notes: '무왜곡 oracle baseline 이 순위/복호 계약을 통과하지 않아 왜곡 원인을 판정할 수 없습니다.',
    };
  }
  if (hasAnyTie || hasConfiguredNearTie) {
    return {
      ...common,
      failure_class: 'NEAR_TIE',
      notes: hasAnyTie
        ? '원본 또는 왜곡 후 median 에 정확한 tie 가 있어 strict rank reversal 이 아닙니다.'
        : '설정된 near-tie 기준에 걸려 strict rank reversal 이 아닙니다.',
    };
  }
  if (payloadMatches) {
    return {
      ...common,
      failure_class: 'PRE_ECC_CONTRACT_BREACH',
      notes: 'digit mismatch 가 있었지만 ECC-M 또는 후단이 기대 payload 를 복원했습니다. H1 후보가 아닙니다.',
    };
  }
  if (distortion.axis === 'vignette') {
    return {
      ...common,
      failure_class: 'SPATIAL_TONE_FIELD_FAILURE',
      notes: '비네팅은 공간적 tone field 이므로 H1 직접 축으로 분류하지 않습니다.',
    };
  }
  if (distortion.axis === 'noise' || distortion.axis === 'jpeg') {
    return {
      ...common,
      failure_class: 'ROBUSTNESS_FAILURE',
      notes: 'noise/JPEG 축의 실패는 단조 tone curve H1 반증으로 고립되지 않습니다.',
    };
  }
  if (!distortion.h1_eligible || !h1Preflight || !h1Preflight.monotonic) {
    return {
      ...common,
      failure_class: 'IMPLEMENTATION_FAILURE',
      notes: '단조 tone preflight 또는 H1 oracle 조건이 충족되지 않았습니다.',
    };
  }
  if (!strictRankReversal || !decodeFailed) {
    return {
      ...common,
      failure_class: 'IMPLEMENTATION_FAILURE',
      notes: 'recoverDigit mismatch 와 strict rank reversal/decode failure 의 직접 연결을 확인하지 못했습니다.',
    };
  }
  if (!Number.isFinite(nearTieThreshold)) {
    return {
      ...common,
      failure_class: 'MEASUREMENT_INVALID',
      h1_candidate_screening: true,
      h1_candidate_blocker: 'near-tie 기준이 calibration 에서 아직 확정되지 않았습니다.',
      notes: '수학적으로 strict order change 는 관측됐지만, 미확정 near-tie 기준 없이 H1_CANDIDATE 로 승격하지 않습니다.',
    };
  }
  return {
    ...common,
    failure_class: 'H1_CANDIDATE',
    needs_replay: true,
    notes: '단조 tone preflight, exact oracle, strict reversal, digit mismatch, decode failure 조건을 충족했습니다. deterministic replay audit 이 필요합니다.',
  };
}

function evaluateTrial(prepared, distortion, distortionSeed, tonePreflight, nearTieThreshold) {
  const params = materializeDistortionParams(distortion, distortionSeed);
  let distorted;
  try {
    distorted = distortImage(prepared.raster, params);
  } catch (error) {
    return {
      prepared,
      distortion,
      distortionSeed,
      distortionParams: params,
      distorted: null,
      distortedSha256: null,
      decoderResult: null,
      payloadMatches: false,
      roundTripOk: false,
      cells: [],
      issues: [{
        failure_class: 'MEASUREMENT_INVALID',
        stage: 'runner',
        cell: null,
        notes: 'distortImage 실행 오류: ' + (error instanceof Error ? error.message : String(error)),
      }],
      runnerError: error instanceof Error ? error.message : String(error),
    };
  }

  const digits = [];
  const cells = [];
  for (const sourceCell of prepared.cells) {
    const medians = measureCellFaceMedians(distorted, prepared.scene, sourceCell.q, sourceCell.r);
    const observedRanking = rankingInfo(medians, nearTieThreshold);
    const recoveredDigit = recoverDigit(medians);
    digits.push(recoveredDigit);
    cells.push({
      ...sourceCell,
      observedMedians: cloneMedians(medians),
      observedRanking,
      recoveredDigit,
    });
  }

  let decoderResult;
  try {
    decoderResult = decodeCells(digits, {
      version: prepared.encoded.version,
      eccLevel: prepared.sceneSpec.eccLevel,
      k: prepared.k,
    });
  } catch (error) {
    decoderResult = {
      ok: false,
      stage: 'decode_cells',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const payloadMatches = decodePayloadMatches(decoderResult, prepared.sceneSpec.text);
  const roundTripOk = payloadMatches;
  const mismatchedCells = cells.filter((cell) => cell.expectedDigit !== cell.recoveredDigit);
  const issues = [];
  const decodeFailed = !roundTripOk;
  for (const cell of mismatchedCells) {
    issues.push(issueForCell({
      prepared,
      distortion,
      cell,
      payloadMatches,
      decodeFailed,
      tonePreflight,
      nearTieThreshold,
    }));
  }
  if (mismatchedCells.length === 0 && !roundTripOk) {
    issues.push({
      failure_class: classifyNoCellDecodeFailure(prepared, distortion),
      stage: 'decode_cells',
      cell: null,
      notes: '모든 digit 이 일치했는데 decodeCells 결과가 기대 payload 와 다릅니다.',
    });
  }
  if (payloadMatches && decoderResult && Number.isInteger(decoderResult.corrected) && decoderResult.corrected > 0) {
    const alreadyRecorded = issues.some((issue) => issue.failure_class === 'PRE_ECC_CONTRACT_BREACH');
    if (!alreadyRecorded) {
      issues.push({
        failure_class: 'PRE_ECC_CONTRACT_BREACH',
        stage: 'decode_cells',
        cell: null,
        notes: 'corrected > 0 이지만 payload 는 일치합니다. H1 후보가 아닙니다.',
      });
    }
  }

  return {
    prepared,
    distortion,
    distortionSeed,
    distortionParams: params,
    distorted,
    distortedSha256: sha256Raster(distorted),
    decoderResult,
    payloadMatches,
    roundTripOk,
    cells,
    issues,
    runnerError: null,
  };
}

function sameCandidateInReplay(candidateIssue, replay) {
  if (!candidateIssue.cell || !replay || replay.roundTripOk) return false;
  const candidateCell = candidateIssue.cell;
  const replayCell = replay.cells.find((cell) => cell.key === candidateCell.key);
  if (!replayCell) return false;
  const strictRankReversal = !equalArrays(replayCell.expectedOrder, replayCell.observedRanking.order)
    && !replayCell.baselineRanking.exact_tie
    && !replayCell.observedRanking.exact_tie
    && replayCell.baselineRanking.near_tie !== true
    && replayCell.observedRanking.near_tie !== true;
  return replay.payloadMatches === false
    && strictRankReversal
    && replayCell.expectedDigit !== replayCell.recoveredDigit;
}

function finalizeCandidateReplays(primary, replays) {
  for (const issue of primary.issues) {
    if (!issue.needs_replay) continue;
    const reproduced = replays.length === 2 && replays.every((replay) => sameCandidateInReplay(issue, replay));
    issue.h1_conditions.deterministic_replays = reproduced;
    issue.retry = { attempts: replays.length, same_seed_reproduced: reproduced };
    if (!reproduced) {
      issue.failure_class = 'MEASUREMENT_INVALID';
      issue.subclass = 'FLAKY_MEASUREMENT';
      issue.notes = 'H1 candidate replay 가 2회 동일하게 재현되지 않았습니다. pass 로 세지 않습니다.';
    }
  }
}

function issuePriority(failureClass) {
  const priorities = {
    H1_CANDIDATE: 0,
    SPATIAL_TONE_FIELD_FAILURE: 1,
    ROBUSTNESS_FAILURE: 2,
    IMPLEMENTATION_FAILURE: 3,
    MEASUREMENT_INVALID: 4,
    PRE_ECC_CONTRACT_BREACH: 5,
    MARGIN_EROSION: 6,
    NEAR_TIE: 7,
  };
  return priorities[failureClass] === undefined ? 99 : priorities[failureClass];
}

function verdictForIssues(issues, roundTripOk) {
  if (issues.length === 0) return roundTripOk ? 'PASS' : 'FAIL';
  const classes = issues.map((issue) => issue.failure_class);
  if (classes.includes('H1_CANDIDATE')
    || classes.includes('SPATIAL_TONE_FIELD_FAILURE')
    || classes.includes('ROBUSTNESS_FAILURE')
    || classes.includes('IMPLEMENTATION_FAILURE')) return 'FAIL';
  if (classes.includes('MEASUREMENT_INVALID')) return 'INVALID';
  return 'BOUNDARY';
}

function makeTrialRecord(evaluation, runId, retry) {
  const { prepared, distortion } = evaluation;
  const mismatchCount = evaluation.cells.filter((cell) => cell.expectedDigit !== cell.recoveredDigit).length;
  const classes = unique(evaluation.issues.map((issue) => issue.failure_class)).sort((left, right) => issuePriority(left) - issuePriority(right));
  const verdict = verdictForIssues(evaluation.issues, evaluation.roundTripOk);
  const baseId = prepared.sceneSpec.sceneId + '--' + distortion.id;
  return {
    run_id: runId,
    trial_id: retry.attempt === 0 ? baseId : baseId + '--retry-' + retry.attempt,
    logical_trial_id: baseId,
    split: prepared.split,
    track: distortion.track,
    corpus: 'valid',
    scene_cluster_id: prepared.sceneSpec.sceneClusterId,
    scene_id: prepared.sceneSpec.sceneId,
    payload_id: prepared.sceneSpec.payloadId,
    version: prepared.encoded.version,
    eccLevel: prepared.sceneSpec.eccLevel,
    pixelsPerUnit: prepared.sceneSpec.pixelsPerUnit,
    render_seed: prepared.sceneSpec.renderSeed,
    distortion_id: distortion.id,
    distortion_axis: distortion.axis,
    distortion_parameter: distortion.parameter,
    distortion_params: evaluation.distortionParams,
    distortion_seed: evaluation.distortionSeed,
    input_sha256: prepared.inputSha256,
    distorted_sha256: evaluation.distortedSha256,
    expected_text_sha256: prepared.expectedTextSha256,
    decoder_result: serializeDecodeResult(evaluation.decoderResult),
    round_trip_ok: evaluation.roundTripOk,
    baseline: prepared.baseline,
    digit_stats: {
      cell_count: prepared.cells.length,
      mismatched: mismatchCount,
      pre_ecc_error_rate: prepared.cells.length === 0 ? null : mismatchCount / prepared.cells.length,
    },
    score_trace: {
      hypothesis_count: null,
      proposal_count: null,
      crc_pass_count: null,
      semantic_pass_count: null,
      truth_rank: null,
      selectionMargin: null,
    },
    verdict,
    failure_class: classes[0] || null,
    failure_classes: classes,
    retry,
    runner_error: evaluation.runnerError,
  };
}

function cropRaster(raster, bounds) {
  const width = Math.max(1, bounds.x1 - bounds.x0);
  const height = Math.max(1, bounds.y1 - bounds.y0);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = ((bounds.y0 + y) * raster.width + bounds.x0) * 4;
    const targetOffset = y * width * 4;
    pixels.set(raster.pixels.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
  }
  return {
    width,
    height,
    pixels,
    pixelsPerUnit: raster.pixelsPerUnit,
    supersample: raster.supersample,
  };
}

function cellCropBounds(scene, raster, q, r) {
  const corners = hexCorners(q, r, scene.layout);
  const scale = raster.pixelsPerUnit;
  const padding = Math.max(2, Math.round(scale * 0.35));
  const xs = corners.map((point) => point.x * scale);
  const ys = corners.map((point) => point.y * scale);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs)) - padding),
    y0: Math.max(0, Math.floor(Math.min(...ys)) - padding),
    x1: Math.min(raster.width, Math.ceil(Math.max(...xs)) + padding),
    y1: Math.min(raster.height, Math.ceil(Math.max(...ys)) + padding),
  };
}

function relativePath(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

async function writePng(filePath, raster) {
  await writeFile(filePath, rasterToPng(raster));
}

async function saveArtifacts(outputDirectory, evaluation, trialRecord, issue, cache) {
  if (!evaluation.distorted) return null;
  const cacheKey = trialRecord.trial_id;
  let images = cache.get(cacheKey);
  if (!images) {
    const sourcePath = path.join(outputDirectory, 'artifacts', 'images', cacheKey + '.source.png');
    const distortedPath = path.join(outputDirectory, 'artifacts', 'images', cacheKey + '.distorted.png');
    await writePng(sourcePath, evaluation.prepared.raster);
    await writePng(distortedPath, evaluation.distorted);
    images = {
      source_image: relativePath(outputDirectory, sourcePath),
      distorted_image: relativePath(outputDirectory, distortedPath),
    };
    cache.set(cacheKey, images);
  }
  if (!issue.cell) return { ...images, cell_crop: null, source_cell_crop: null };
  const bounds = cellCropBounds(evaluation.prepared.scene, evaluation.prepared.raster, issue.cell.q, issue.cell.r);
  const suffix = '--cell-' + issue.cell.q + '-' + issue.cell.r;
  const sourceCropPath = path.join(outputDirectory, 'artifacts', 'crops', cacheKey + suffix + '.source.png');
  const distortedCropPath = path.join(outputDirectory, 'artifacts', 'crops', cacheKey + suffix + '.distorted.png');
  await writePng(sourceCropPath, cropRaster(evaluation.prepared.raster, bounds));
  await writePng(distortedCropPath, cropRaster(evaluation.distorted, bounds));
  return {
    ...images,
    cell_crop: relativePath(outputDirectory, distortedCropPath),
    source_cell_crop: relativePath(outputDirectory, sourceCropPath),
  };
}

function failureRecordFor(issue, evaluation, trialRecord, artifactPaths) {
  const cell = issue.cell;
  return {
    run_id: trialRecord.run_id,
    trial_id: trialRecord.trial_id,
    logical_trial_id: trialRecord.logical_trial_id,
    failure_class: issue.failure_class,
    subclass: issue.subclass || null,
    stage: issue.stage,
    cell: cell ? { q: cell.q, r: cell.r } : null,
    face_medians_before: cell ? cell.baselineMedians : null,
    face_medians_after: cell ? cell.observedMedians : null,
    expected_order: cell ? cell.expectedOrder : null,
    observed_order: cell ? cell.observedRanking.order : null,
    baseline_order: cell ? cell.baselineRanking.order : null,
    expected_digit: cell ? cell.expectedDigit : null,
    observed_digit: cell ? cell.recoveredDigit : null,
    median_margin_before: cell ? cell.baselineRanking.min_margin : null,
    median_margin_after: cell ? cell.observedRanking.min_margin : null,
    exact_tie_before: cell ? cell.baselineRanking.exact_tie : null,
    exact_tie_after: cell ? cell.observedRanking.exact_tie : null,
    near_tie_before: cell ? cell.baselineRanking.near_tie : null,
    near_tie_after: cell ? cell.observedRanking.near_tie : null,
    near_tie_status: cell ? cell.observedRanking.near_tie_status : null,
    strict_rank_reversal: issue.strict_rank_reversal === undefined ? null : issue.strict_rank_reversal,
    distortion_params: trialRecord.distortion_params,
    distortion_seed: trialRecord.distortion_seed,
    decoder_result: trialRecord.decoder_result,
    artifact_paths: artifactPaths,
    h1_conditions: issue.h1_conditions || null,
    h1_candidate_screening: issue.h1_candidate_screening === true,
    h1_candidate_blocker: issue.h1_candidate_blocker || null,
    retry: {
      attempt: trialRecord.retry.attempt,
      same_seed_reproduced: issue.retry ? issue.retry.same_seed_reproduced : trialRecord.retry.same_seed_reproduced,
      replay_attempts: issue.retry ? issue.retry.attempts : 0,
    },
    notes: issue.notes,
  };
}

async function appendJsonLine(filePath, value) {
  await appendFile(filePath, JSON.stringify(value) + '\n', 'utf8');
}

async function persistEvaluation(paths, outputDirectory, evaluation, trialRecord, options) {
  await appendJsonLine(paths.trials, trialRecord);
  if (!options.includeFailures) return [];
  const artifactCache = options.artifactCache;
  const failures = [];
  for (const issue of evaluation.issues) {
    const artifactPaths = await saveArtifacts(outputDirectory, evaluation, trialRecord, issue, artifactCache);
    const failure = failureRecordFor(issue, evaluation, trialRecord, artifactPaths);
    await appendJsonLine(paths.failures, failure);
    failures.push(failure);
  }
  return failures;
}

function wilson95(successes, total) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0) return null;
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const halfWidth = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total) / denominator;
  return {
    method: 'Wilson 95% interval; independent Bernoulli approximation only',
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function toneAxisSummary(axis, records, gridValues) {
  const byValue = new Map();
  for (const value of gridValues) byValue.set(JSON.stringify(value), { parameter: value, trials: [] });
  for (const record of records.filter((entry) => entry.distortion_axis === axis)) {
    const key = JSON.stringify(record.distortion_parameter);
    if (!byValue.has(key)) byValue.set(key, { parameter: record.distortion_parameter, trials: [] });
    byValue.get(key).trials.push(record);
  }
  const perParameter = [...byValue.values()]
    .sort((left, right) => Number(left.parameter) - Number(right.parameter))
    .map((entry) => ({
      parameter: entry.parameter,
      trials: entry.trials.length,
      clean_passes: entry.trials.filter((record) => record.verdict === 'PASS').length,
      round_trip_passes: entry.trials.filter((record) => record.round_trip_ok).length,
      all_clean: entry.trials.length > 0 && entry.trials.every((record) => record.verdict === 'PASS'),
      all_round_trip: entry.trials.length > 0 && entry.trials.every((record) => record.round_trip_ok),
      verdict_counts: countBy(entry.trials.map((record) => record.verdict)),
      failure_class_counts: countBy(entry.trials.flatMap((record) => record.failure_classes)),
    }));
  const lookup = new Map(perParameter.map((entry) => [Number(entry.parameter), entry]));
  const identity = axis === 'gamma' ? 1 : 0;
  const lowerValues = gridValues.filter((value) => value < identity).sort((left, right) => right - left);
  const upperValues = gridValues.filter((value) => value > identity).sort((left, right) => left - right);
  const firstNonpass = (values) => {
    for (const value of values) {
      const entry = lookup.get(Number(value));
      if (!entry || !entry.all_clean) return value;
    }
    return null;
  };
  return {
    tested_values: gridValues,
    per_parameter: perParameter,
    observed_clean_pass_values: perParameter.filter((entry) => entry.all_clean).map((entry) => entry.parameter),
    observed_round_trip_pass_values: perParameter.filter((entry) => entry.all_round_trip).map((entry) => entry.parameter),
    first_nonpass_from_identity: {
      lower: firstNonpass(lowerValues),
      upper: firstNonpass(upperValues),
    },
    note: '유한 OAT grid 관측값이며 연속 범위 전체의 증명은 아닙니다.',
  };
}

function makeAcceptanceInvalidRecord(runId, distortion, observed) {
  return {
    run_id: runId,
    trial_id: 'acceptance-' + distortion.id,
    logical_trial_id: 'acceptance-' + distortion.id,
    failure_class: 'MEASUREMENT_INVALID',
    subclass: 'INSUFFICIENT_HOLDOUT_SAMPLE',
    stage: 'runner',
    cell: null,
    face_medians_before: null,
    face_medians_after: null,
    expected_order: null,
    observed_order: null,
    expected_digit: null,
    observed_digit: null,
    artifact_paths: null,
    retry: { attempt: 0, same_seed_reproduced: null, replay_attempts: 0 },
    notes: 'holdout ECC-M scene-cluster 표본 ' + observed + '개가 계획의 제안 target ' + HOLDOUT_TARGET_PER_ACCEPTANCE_CELL + '개에 미달합니다. 관측 성공을 M1 pass 로 세지 않습니다.',
  };
}

async function sourceHashes() {
  const files = [
    'SPEC.md',
    'tools/m1-oracle.mjs',
    'test/harness/distort.mjs',
    'test/decode-render-roundtrip.test.js',
    'src/verify.js',
    'src/decode.js',
    'src/luminance.js',
    'src/capacity.js',
  ];
  const hashes = {};
  for (const file of files) hashes[file] = sha256(await readFile(path.join(REPOSITORY_ROOT, file)));
  return hashes;
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureEmptyOutputDirectory(outputDirectory) {
  if (await pathExists(outputDirectory)) {
    const entries = await readdir(outputDirectory);
    if (entries.length > 0) throw new Error('--out 디렉터리는 비어 있어야 합니다: ' + outputDirectory);
  } else {
    await mkdir(outputDirectory, { recursive: true });
  }
  await mkdir(path.join(outputDirectory, 'artifacts', 'images'), { recursive: true });
  await mkdir(path.join(outputDirectory, 'artifacts', 'crops'), { recursive: true });
}

async function defaultOutputDirectory(runId) {
  const root = path.join(REPOSITORY_ROOT, 'test', 'output');
  let candidate = path.join(root, runId);
  let suffix = 1;
  while (await pathExists(candidate)) {
    candidate = path.join(root, runId + '-' + String(suffix).padStart(2, '0'));
    suffix += 1;
  }
  return candidate;
}

function makeRunId(now) {
  return 'm1-oracle-' + now.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
}

export async function runOracle(options = {}) {
  const quick = options.quick === true;
  const runSeed = options.runSeed === undefined ? RUN_SEED : String(options.runSeed);
  const generatedSceneCount = options.generatedScenes === undefined ? 0 : options.generatedScenes;
  if (!Number.isSafeInteger(generatedSceneCount) || generatedSceneCount < 0) {
    throw new RangeError('generatedScenes 는 0 이상의 안전한 정수여야 합니다.');
  }
  const payloadSeed = options.payloadSeed === undefined ? runSeed + ':payload-v1' : String(options.payloadSeed);
  const nearTieThreshold = Number.isFinite(options.nearTieThreshold) ? options.nearTieThreshold : null;
  const now = options.now instanceof Date ? options.now : new Date();
  const runId = options.runId || makeRunId(now);
  const outputDirectory = options.outputDirectory
    ? path.resolve(options.outputDirectory)
    : await defaultOutputDirectory(runId);
  await ensureEmptyOutputDirectory(outputDirectory);

  const paths = {
    manifest: path.join(outputDirectory, 'manifest.json'),
    trials: path.join(outputDirectory, 'trials.jsonl'),
    failures: path.join(outputDirectory, 'failures.jsonl'),
    summary: path.join(outputDirectory, 'summary.json'),
  };
  await writeFile(paths.trials, '', 'utf8');
  await writeFile(paths.failures, '', 'utf8');

  const sceneCorpus = buildSceneSpecs(quick, generatedSceneCount, payloadSeed);
  const sceneSpecs = sceneCorpus.scenes;
  const splitByCluster = assignSplits(sceneSpecs, runSeed);
  const splitStats = splitActual(sceneSpecs, splitByCluster);
  const distortionCells = buildDistortionCells(quick);
  const tonePreflight = buildTonePreflight(distortionCells);
  const manifest = {
    schema_version: 1,
    run_id: runId,
    created_at: now.toISOString(),
    track: 'oracle-tone/oracle-geometry preflight',
    mode: quick ? 'quick' : 'full-oat-preflight',
    spec_source: {
      format_spec: 'SPEC.md',
      distort_harness: 'test/harness/distort.mjs',
      roundtrip_test: 'test/decode-render-roundtrip.test.js',
      oracle_measurement: 'src/verify.js + src/decode.js',
    },
    source_sha256: await sourceHashes(),
    run_seed: runSeed,
    determinism: {
      trial_seed_rule: 'sha256(run_seed + scene_id + distortion_id)',
      payload_generation_seed: payloadSeed,
      payload_generation_rule: 'sha256 counter-derived selection; Math.random() 미사용',
      render_seed: RENDER_SEED,
      retry_seed_policy: 'same input, same distortion seed, same parameters',
    },
    split: {
      method: 'scene-cluster deterministic hash sort, stratified by version/ECC',
      calibration_ratio: CALIBRATION_RATIO,
      holdout_ratio: HOLDOUT_RATIO,
      actual: splitStats,
    },
    distortion_grid: {
      ...FULL_GRID,
      executed: distortionCells.map((cell) => ({
        id: cell.id,
        axis: cell.axis,
        parameter: cell.parameter,
        params: cell.params,
      })),
      excluded_geometry_axes: EXCLUDED_GEOMETRY_AXES,
      exclusion_reason: 'oracle scene geometry와 맞지 않으므로 rotation/perspective/scale은 이 track에서 실행하지 않습니다.',
    },
    thresholds: {
      tau_H: null,
      tau_k: null,
      weights: null,
      near_tie: nearTieThreshold,
      near_tie_status: nearTieThreshold === null ? 'UNCALIBRATED' : 'CALLER_SUPPLIED',
    },
    tone_preflight: tonePreflight.entries,
    corpus: {
      generation: sceneCorpus.generation,
      valid_scenes: sceneSpecs.map((scene) => ({
        scene_id: scene.sceneId,
        scene_cluster_id: scene.sceneClusterId,
        payload_id: scene.payloadId,
        corpus_source: scene.corpusSource,
        payload_family: scene.payloadFamily,
        payload_family_requested: scene.payloadFamilyRequested,
        payload_bytes: scene.payloadBytes,
        max_payload_bytes: scene.maxPayloadBytes,
        version: scene.version,
        eccLevel: scene.eccLevel,
        pixelsPerUnit: scene.pixelsPerUnit,
        generation: scene.generation,
        split: splitByCluster.get(scene.sceneClusterId),
      })),
      omitted_required_corpora: ['normal_collision', 'correlated_negative'],
      omitted_valid_strata: ['additional_renderer_presets'],
    },
  };
  await writeFile(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const primaryRecords = [];
  const retryRecords = [];
  const failureRecords = [];
  const artifactCache = new Map();
  const primaryKeys = new Set();

  for (const sceneSpec of sceneSpecs) {
    const split = splitByCluster.get(sceneSpec.sceneClusterId);
    let prepared;
    try {
      prepared = prepareScene(sceneSpec, split, nearTieThreshold);
    } catch (error) {
      for (const distortion of distortionCells) {
        const seed = sha256(runSeed + sceneSpec.sceneId + distortion.id);
        const failed = {
          prepared: {
            sceneSpec,
            split,
            encoded: { version: sceneSpec.version },
            cells: [],
            inputSha256: null,
            expectedTextSha256: sha256(sceneSpec.text),
            baseline: { ok: false, error: error instanceof Error ? error.message : String(error) },
          },
          distortion,
          distortionSeed: seed,
          distortionParams: materializeDistortionParams(distortion, seed),
          distorted: null,
          distortedSha256: null,
          decoderResult: null,
          payloadMatches: false,
          roundTripOk: false,
          cells: [],
          issues: [{
            failure_class: 'MEASUREMENT_INVALID',
            stage: 'runner',
            cell: null,
            notes: 'scene 준비 오류: ' + (error instanceof Error ? error.message : String(error)),
          }],
          runnerError: error instanceof Error ? error.message : String(error),
        };
        const record = makeTrialRecord(failed, runId, { attempt: 0, same_seed_reproduced: null });
        primaryRecords.push(record);
        failureRecords.push(...await persistEvaluation(paths, outputDirectory, failed, record, {
          includeFailures: true,
          artifactCache,
        }));
      }
      continue;
    }

    for (const distortion of distortionCells) {
      const logicalTrialId = sceneSpec.sceneId + '--' + distortion.id;
      if (primaryKeys.has(logicalTrialId)) throw new Error('중복 logical trial key: ' + logicalTrialId);
      primaryKeys.add(logicalTrialId);
      const seed = sha256(runSeed + sceneSpec.sceneId + distortion.id);
      const primary = evaluateTrial(prepared, distortion, seed, tonePreflight, nearTieThreshold);
      const candidates = primary.issues.filter((issue) => issue.needs_replay === true);
      const replays = [];
      if (candidates.length > 0) {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          replays.push(evaluateTrial(prepared, distortion, seed, tonePreflight, nearTieThreshold));
        }
        finalizeCandidateReplays(primary, replays);
      }
      const primaryRecord = makeTrialRecord(primary, runId, {
        attempt: 0,
        same_seed_reproduced: candidates.length === 0 ? null : primary.issues.every((issue) => !issue.needs_replay || issue.retry && issue.retry.same_seed_reproduced),
      });
      primaryRecords.push(primaryRecord);
      failureRecords.push(...await persistEvaluation(paths, outputDirectory, primary, primaryRecord, {
        includeFailures: true,
        artifactCache,
      }));
      for (let index = 0; index < replays.length; index += 1) {
        const retryRecord = makeTrialRecord(replays[index], runId, {
          attempt: index + 1,
          same_seed_reproduced: primaryRecord.retry.same_seed_reproduced,
        });
        retryRecords.push(retryRecord);
        await persistEvaluation(paths, outputDirectory, replays[index], retryRecord, {
          includeFailures: false,
          artifactCache,
        });
      }
    }
  }

  const acceptanceInvalidRecords = [];
  for (const distortion of distortionCells) {
    const holdoutM = primaryRecords.filter((record) => record.split === 'holdout'
      && record.eccLevel === 'M'
      && record.distortion_id === distortion.id);
    if (holdoutM.length < HOLDOUT_TARGET_PER_ACCEPTANCE_CELL) {
      const invalid = makeAcceptanceInvalidRecord(runId, distortion, holdoutM.length);
      await appendJsonLine(paths.failures, invalid);
      failureRecords.push(invalid);
      acceptanceInvalidRecords.push({ distortion_id: distortion.id, observed: holdoutM.length, target: HOLDOUT_TARGET_PER_ACCEPTANCE_CELL });
    }
  }

  const holdoutM = primaryRecords.filter((record) => record.split === 'holdout' && record.eccLevel === 'M');
  const holdoutMSuccesses = holdoutM.filter((record) => record.round_trip_ok).length;
  const primaryCorrectedTrials = primaryRecords.filter((record) => Number.isInteger(record.decoder_result?.corrected)
    && record.decoder_result.corrected > 0).length;
  const holdoutMCorrectedTrials = holdoutM.filter((record) => Number.isInteger(record.decoder_result?.corrected)
    && record.decoder_result.corrected > 0).length;
  const h1Candidates = failureRecords.filter((record) => record.failure_class === 'H1_CANDIDATE');
  const candidateScreeningBlocked = failureRecords.filter((record) => record.h1_candidate_screening === true);
  const primaryVerdicts = countBy(primaryRecords.map((record) => record.verdict));
  const executedVerdicts = countBy(primaryRecords.concat(retryRecords).map((record) => record.verdict));
  const failureClassCounts = countBy(failureRecords.map((record) => record.failure_class));
  const trialFailureClassCounts = countBy(primaryRecords.flatMap((record) => record.failure_classes));
  const allPrimaryClean = primaryRecords.length > 0 && primaryRecords.every((record) => record.verdict === 'PASS');
  const anyRoundTripFailure = primaryRecords.some((record) => !record.round_trip_ok);
  const summary = {
    schema_version: 1,
    run_id: runId,
    completed_at: new Date().toISOString(),
    pass: false,
    scope_pass: allPrimaryClean && acceptanceInvalidRecords.length === 0,
    status: anyRoundTripFailure || h1Candidates.length > 0 ? 'FAIL' : 'MEASUREMENT_INVALID',
    scope: {
      name: 'oracle-tone/oracle-geometry OAT preflight',
      full_m1_completion_eligible: false,
      blockers: [
        'full-pipeline detector/homography track is not implemented in this driver',
        'normal collision corpus is not included',
        'correlated negative corpus is not included',
        ...(acceptanceInvalidRecords.length === 0 ? [] : ['holdout sample target per acceptance cell is not met']),
        'near-tie calibration threshold remains unvalidated',
      ],
    },
    trials: {
      logical_trials: primaryRecords.length,
      replay_trials: retryRecords.length,
      executed_trials: primaryRecords.length + retryRecords.length,
      logical_verdict_counts: primaryVerdicts,
      executed_verdict_counts: executedVerdicts,
      observed_clean_passes: primaryVerdicts.PASS || 0,
      observed_failures: (primaryVerdicts.FAIL || 0) + (primaryVerdicts.INVALID || 0) + (primaryVerdicts.BOUNDARY || 0),
    },
    failure_class_counts: failureClassCounts,
    trial_failure_class_counts: trialFailureClassCounts,
    h1: {
      candidate_count: h1Candidates.length,
      confirmed_kill_count: 0,
      pending_audit_count: h1Candidates.length,
      candidate_screening_blocked_by_uncalibrated_near_tie: candidateScreeningBlocked.length,
    },
    holdout: {
      valid_trials: holdoutM.length,
      valid_failures: holdoutM.length - holdoutMSuccesses,
      observed_success_rate: holdoutM.length === 0 ? null : holdoutMSuccesses / holdoutM.length,
      confidence_interval: wilson95(holdoutMSuccesses, holdoutM.length),
      target_per_acceptance_cell: HOLDOUT_TARGET_PER_ACCEPTANCE_CELL,
      independence_warning: true,
    },
    ecc_correction_activity: {
      basis: 'primary logical trials only; deterministic replay trials are excluded',
      primary: {
        trials: primaryRecords.length,
        corrected_trials: primaryCorrectedTrials,
        corrected_trial_rate: primaryRecords.length === 0 ? null : primaryCorrectedTrials / primaryRecords.length,
      },
      holdout_ecc_m: {
        trials: holdoutM.length,
        corrected_trials: holdoutMCorrectedTrials,
        corrected_trial_rate: holdoutM.length === 0 ? null : holdoutMCorrectedTrials / holdoutM.length,
      },
    },
    normal_collision: {
      trials: 0,
      wrong_payload_outputs: 0,
      status: 'NOT_RUN',
    },
    correlated_negative: {
      trials: 0,
      false_accepts: 0,
      three_over_n_95_upper_approx: null,
      independence_warning: true,
      status: 'NOT_RUN',
    },
    thresholds_locked_from_calibration: false,
    thresholds: manifest.thresholds,
    tone_axes: {
      gamma: toneAxisSummary('gamma', primaryRecords, quick ? [0.6, 1, 1.8] : FULL_GRID.gamma),
      s_curve: toneAxisSummary('s_curve', primaryRecords, quick ? [-1, 0, 1] : FULL_GRID.s_curve_amount),
    },
    missing_cells: acceptanceInvalidRecords,
  };
  manifest.completed_at = summary.completed_at;
  manifest.execution = {
    logical_trials: summary.trials.logical_trials,
    replay_trials: summary.trials.replay_trials,
    failure_records: failureRecords.length,
  };
  await writeFile(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(paths.summary, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return { outputDirectory, paths, manifest, summary };
}

function parseNonNegativeIntegerOption(value, flag) {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(flag + ' 뒤에 0 이상의 정수가 필요합니다.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(flag + ' 값이 안전한 정수 범위를 벗어납니다.');
  return parsed;
}

function parseCli(argv) {
  const parsed = { out: null, quick: false, scenes: 0, seed: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--quick') {
      parsed.quick = true;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--out 뒤에 디렉터리 경로가 필요합니다.');
      parsed.out = value;
      index += 1;
    } else if (arg === '--scenes') {
      parsed.scenes = parseNonNegativeIntegerOption(argv[index + 1], '--scenes');
      index += 1;
    } else if (arg === '--seed') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--seed 뒤에 문자열이 필요합니다.');
      parsed.seed = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error('알 수 없는 옵션: ' + arg);
    }
  }
  return parsed;
}

function printUsage() {
  console.log('사용법: node tools/m1-oracle.mjs [--out <dir>] [--quick] [--scenes <n>] [--seed <value>]');
  console.log('기본 출력: TLcube/test/output/m1-oracle-<timestamp>/');
  console.log('--scenes <n>: FULL_CASES 에 더할 결정적 payload scene n개입니다 (기본 0).');
  console.log('--seed <value>: split·왜곡·payload 생성 seed를 바꾸며 manifest 에 기록합니다.');
  console.log('--quick: 축별 대표점과 회귀 ppu=8만 실행합니다. --scenes 지정분은 함께 실행합니다.');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  if (args.help) {
    printUsage();
    return null;
  }
  const outputDirectory = args.out === null ? undefined : path.resolve(process.cwd(), args.out);
  const result = await runOracle({
    quick: args.quick,
    generatedScenes: args.scenes,
    runSeed: args.seed === null ? undefined : args.seed,
    outputDirectory,
  });
  console.log(JSON.stringify({
    output_directory: result.outputDirectory,
    run_id: result.summary.run_id,
    generated_scenes: result.manifest.corpus.generation.requested_scenes,
    logical_trials: result.summary.trials.logical_trials,
    executed_trials: result.summary.trials.executed_trials,
    logical_verdict_counts: result.summary.trials.logical_verdict_counts,
    failure_class_counts: result.summary.failure_class_counts,
    holdout_ecc_m_trials: result.summary.holdout.valid_trials,
    h1_candidate_count: result.summary.h1.candidate_count,
    status: result.summary.status,
  }, null, 2));
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
