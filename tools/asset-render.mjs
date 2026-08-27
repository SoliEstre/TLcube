#!/usr/bin/env node

/**
 * 소개 사이트 타입 이미지 4장 재생성기.
 *
 * 생성기 첫 화면의 기본 상태와 자동 정책을 읽고, 화면 렌더 순서대로
 * encode → scene → 자체검증 → 음영 → 안전영역 → PNG 를 수행한다.
 * PNG 는 임시 파일로 구운 뒤 다시 읽어 decodeFrontend 원문 왕복까지 확인한다.
 * 검증에 실패한 타입은 기존 파일을 건드리지 않는다.
 *
 * 사용:
 *   node assets-render.mjs
 *   node assets-render.mjs --dry-run
 *   node assets-render.mjs --only K
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { inflateSync } from 'node:zlib';

import { hasCenterQrSlot } from './src/cellSurfaceFinal.js';
import { decodeFrontend } from './src/decoder/frontend.js';
import { encode } from './src/encode.js';
import { encodeA } from './src/encodeA.js';
import { encodeK } from './src/encodeK.js';
import { encodeY } from './src/encodeY.js';
import { autoSeatsFor } from './src/generator-seat-auto.js';
import { resolveAutoY, resolveVersionForLayout } from './src/generator-auto-y.js';
import { encodeOptionsForY, sceneOptionsForOA } from './src/generator-render-config.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  createGeneratorState,
} from './src/generator-state.js';
import {
  CENTER_QR_FINDER_PATTERN_ID,
  selectGeneratorType,
} from './src/finder-selection.js';
import { payloadByteLength } from './src/header.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  DELTA_MIN_CONTRACT,
  getPreset,
  relativeLuminance,
} from './src/luminance.js';
import { crc32, rasterToPng } from './src/png.js';
import { resolveQuietZoneChoice } from './src/quiet-auto.js';
import { addQuietZone } from './src/quietzone.js';
import { rasterize } from './src/raster.js';
import { selfCheckVerdict } from './src/render-status.js';
import { buildScene } from './src/scene.js';
import { DEFAULT_FACE_GAINS, buildSceneY } from './src/sceneY.js';
import { addShading } from './src/shading.js';
import { verifyRaster } from './src/verify.js';
import { verifyRasterY } from './src/verifyY.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')));
const ASSET_DIR = path.join(REPO_ROOT, 'sites', 'tl', 'assets');
const TYPES = Object.freeze(['O', 'A', 'K', 'Y']);

/** 자체검증은 화면과 같은 해상도로 돌리고, 사이트 자산의 최종 크기는 별도로 맞춘다. */
const VERIFY_PIXELS_PER_UNIT = Object.freeze({ O: 12, A: 12, K: 12, Y: 10 });
const TARGET_SHORT_SIDE = 750;
const SUPERSAMPLE = 2;

/** index.html §withQuietZone 과 같은 상수. */
const QUIET_MARGIN_CELLS = 2;
const QUIET_WHITE = Object.freeze({ r: 255, g: 255, b: 255 });
const QUIET_BLACK = Object.freeze({ r: 0, g: 0, b: 0 });
const BG_SEPARATION_MIN = 0.05;

/** 첫 화면 URL 입력값 `tl.estre.so` 를 normalizeUrl 이 푼 실제 페이로드. */
const PAYLOAD = 'https://tl.estre.so';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  // 소개 사이트 자산은 투명 PNG가 아니므로 프리셋 기준 배경을 명시적으로 굽는다.
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const PALETTE_Y = Object.freeze({ ...PALETTE, faceGains: DEFAULT_FACE_GAINS });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngMeta(bytes) {
  const signature = '89504e470d0a1a0a';
  if (Buffer.from(bytes.subarray(0, 8)).toString('hex') !== signature) {
    throw new Error('PNG 시그니처가 아니다');
  }
  return {
    width: Buffer.from(bytes).readUInt32BE(16),
    height: Buffer.from(bytes).readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** PNG 파일을 decodeFrontend 입력 RGBA 래스터로 되푼다. */
function pngToRaster(bytes) {
  const meta = pngMeta(bytes);
  if (meta.bitDepth !== 8 || ![2, 6].includes(meta.colorType)) {
    throw new Error(`지원하지 않는 PNG 형식: depth=${meta.bitDepth}, colorType=${meta.colorType}`);
  }

  const idats = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = Buffer.from(bytes).readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = Buffer.from(typeBytes).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = Buffer.from(bytes).readUInt32BE(offset + 8 + length);
    const crcInput = new Uint8Array(4 + length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, 4);
    if (crc32(crcInput) !== expectedCrc) throw new Error(`${type} CRC 불일치`);
    if (type === 'IDAT') idats.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (idats.length === 0) throw new Error('PNG IDAT 청크가 없다');

  const channels = meta.colorType === 2 ? 3 : 4;
  const stride = meta.width * channels;
  const stream = new Uint8Array(inflateSync(Buffer.concat(idats.map((x) => Buffer.from(x)))));
  if (stream.length !== (stride + 1) * meta.height) {
    throw new Error(`PNG 스캔라인 길이 불일치: ${stream.length}`);
  }

  const raw = new Uint8Array(stride * meta.height);
  for (let y = 0; y < meta.height; y += 1) {
    const scan = y * (stride + 1);
    const filter = stream[scan];
    for (let x = 0; x < stride; x += 1) {
      const encoded = stream[scan + 1 + x];
      const at = y * stride + x;
      const left = x >= channels ? raw[at - channels] : 0;
      const up = y > 0 ? raw[at - stride] : 0;
      const upLeft = y > 0 && x >= channels ? raw[at - stride - channels] : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else throw new Error(`지원하지 않는 PNG 필터: ${filter}`);
      raw[at] = (encoded + predictor) & 0xff;
    }
  }

  const pixels = new Uint8ClampedArray(meta.width * meta.height * 4);
  for (let i = 0; i < meta.width * meta.height; i += 1) {
    pixels[i * 4] = raw[i * channels];
    pixels[i * 4 + 1] = raw[i * channels + 1];
    pixels[i * 4 + 2] = raw[i * channels + 2];
    pixels[i * 4 + 3] = channels === 4 ? raw[i * channels + 3] : 255;
  }
  return { width: meta.width, height: meta.height, pixels };
}

function defaultStateFor(type) {
  const initial = createGeneratorState({ type: 'Y' });
  const state = selectGeneratorType(initial, type, GENERATOR_DEFAULT_FINDER_PATTERN_ID);

  // index.html §syncSeatUi — 정식 화면의 자동 자리 정책은 숨은 일반 모드에서도 적용된다.
  if (type !== 'Y') {
    const seats = autoSeatsFor({ type, centralFinderIsTaegeuk: false, allowBlocked: false });
    state.innerSeat = seats.inner;
    state.outerSeat = seats.outer;
  }

  // index.html §applyAutoLocatorProfileY — 첫 로드에서 기본 URL 길이로 즉시 유도한다.
  if (type === 'Y') {
    const auto = resolveAutoY({
      payloadBytes: payloadByteLength(PAYLOAD),
      tones: state.tone === 3 ? 3 : 2,
      eccLevel: state.eccLevel,
    });
    state.locatorProfileY = auto.locatorProfileY;
  }
  return state;
}

function assertDefaultState(type, state) {
  const expected = type === 'Y'
    ? { finderPatternId: GENERATOR_DEFAULT_FINDER_PATTERN_ID, qrPosition: 'TL' }
    : { finderPatternId: CENTER_QR_FINDER_PATTERN_ID, qrPosition: 'inner' };
  if (state.finderPatternId !== expected.finderPatternId
    || state.qrPosition !== expected.qrPosition) {
    throw new Error(
      `${type} 기본 상태 불일치: ${state.finderPatternId}/${state.qrPosition}`,
    );
  }
  // qrMatrix 가 받는 v1 알파뉴메릭 문자만 허용한다. URL 파싱도 별도로 통과해야 한다.
  if (!/^[0-9A-Z $%*+\-./:]+$/.test(state.qrText)) {
    throw new Error(`${type} QR 링크가 알파뉴메릭 안전 문자열이 아니다: ${state.qrText}`);
  }
  const parsed = new URL(state.qrText);
  if (parsed.protocol !== 'https:' || parsed.hostname === '') {
    throw new Error(`${type} QR 링크가 유효한 HTTPS URL이 아니다: ${state.qrText}`);
  }
}

function fallbackForDefault(type, state) {
  if (state.qrPosition === 'inner' && type !== 'Y') {
    return { mode: 'center', cornerToo: state.qrCornerToo === true };
  }
  if (state.qrPosition === 'none') return { mode: 'off' };
  if (!['TL', 'TR', 'BL', 'BR'].includes(state.qrPosition)) {
    throw new Error(`${type} 기본 QR 위치를 렌더할 수 없다: ${state.qrPosition}`);
  }
  return { mode: 'corner', corner: state.qrPosition };
}

function encodeWithEcc(encodeFn, text, options, eccLevel) {
  const ladder = eccLevel === 'auto' ? ['H', 'M', 'L'] : [eccLevel];
  let lastError = null;
  for (const ecc of ladder) {
    try {
      return encodeFn(text, { ...options, eccLevel: ecc });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('ECC 사다리가 비었다');
}

function effectiveYVersion(state) {
  if (state.versionY !== 'auto') return Number(state.versionY);
  if (typeof state.locatorProfileY === 'string'
    && state.locatorProfileY.startsWith('cell-surface-')) {
    return resolveVersionForLayout({
      layout: state.locatorProfileY.slice('cell-surface-'.length),
      payloadBytes: payloadByteLength(PAYLOAD),
      tones: state.tone === 3 ? 3 : 2,
      eccLevel: state.eccLevel,
    });
  }
  return resolveAutoY({
    payloadBytes: payloadByteLength(PAYLOAD),
    tones: state.tone === 3 ? 3 : 2,
    eccLevel: state.eccLevel,
  }).version;
}

function renderDefault(type) {
  const state = defaultStateFor(type);
  assertDefaultState(type, state);
  const fallback = fallbackForDefault(type, state);
  let encoded;
  let scene;

  if (type === 'Y') {
    const encodeOptions = encodeOptionsForY({
      tone: state.tone,
      versionY: effectiveYVersion(state),
      fallback,
      locatorProfileY: state.locatorProfileY,
    });
    encoded = encodeWithEcc(encodeY, PAYLOAD, encodeOptions, state.eccLevel);
    const sceneOptions = { palette: PALETTE_Y };
    if (fallback.mode !== 'off') {
      sceneOptions.qrText = state.qrText;
      if (fallback.mode === 'corner') sceneOptions.qrCorner = fallback.corner;
    }
    if (encodeOptions.cellSurface === true && hasCenterQrSlot(encodeOptions.cellSurfaceLayout)
      && sceneOptions.qrText === undefined) {
      sceneOptions.qrText = state.qrText;
    }
    scene = buildSceneY(encoded, sceneOptions);
  } else if (type === 'K') {
    const encodeOptions = {};
    if (state.versionK !== 'auto') encodeOptions.version = Number(state.versionK);
    if (state.outerSeat === 'k-cm') encodeOptions.cornerMarker = true;
    if (fallback.mode === 'center') encodeOptions.centerQr = true;
    encoded = encodeWithEcc(encodeK, PAYLOAD, encodeOptions, state.eccLevel);
    // index.html §renderTypeK — K는 sceneOptionsForOA의 O/A 계약 밖이라 화면도 직접 잇는다.
    const sceneOptions = {
      palette: PALETTE,
      margin: 20,
      finderPatternId: state.finderPatternId,
    };
    if (fallback.mode === 'center') {
      sceneOptions.centerQr = true;
      sceneOptions.qrText = state.qrText;
      sceneOptions.cornerToo = Boolean(fallback.cornerToo);
    }
    scene = buildScene(encoded, sceneOptions);
  } else {
    const encodeOptions = { centerQr: fallback.mode === 'center' };
    const version = state[`version${type}`];
    if (version !== 'auto') encodeOptions.version = Number(version);
    if (type === 'O' && state.innerSeat === 'o-cm') {
      encodeOptions.cornerMarker = true;
      encodeOptions.markerTones = true;
    }
    if (type === 'A' && state.outerSeat === 'a-cm') encodeOptions.cornerMarker = true;
    const encodeFn = type === 'A' ? encodeA : encode;
    encoded = encodeWithEcc(encodeFn, PAYLOAD, encodeOptions, state.eccLevel);
    const sceneOptions = sceneOptionsForOA({
      fallback,
      finderPatternId: state.finderPatternId,
      palette: PALETTE,
      qrText: state.qrText,
      type,
    });
    scene = buildScene(encoded, sceneOptions);
  }

  const verifyPpu = VERIFY_PIXELS_PER_UNIT[type];
  const selfRaster = rasterize(scene, {
    pixelsPerUnit: verifyPpu,
    supersample: SUPERSAMPLE,
  });
  const check = type === 'Y'
    ? verifyRasterY(selfRaster, scene, encoded)
    : verifyRaster(selfRaster, scene, encoded);

  const separation = (color) => {
    const y = relativeLuminance(color);
    return Math.min(...PALETTE.levels.map((level) => Math.abs(relativeLuminance(level) - y)));
  };
  const quietChoice = resolveQuietZoneChoice({
    quietMode: state.quietMode,
    bgMode: state.bgMode,
    type,
    sepWhite: separation(QUIET_WHITE),
    sepBlack: separation(QUIET_BLACK),
    surfaceLuminance: null,
    separationFloor: BG_SEPARATION_MIN,
  });
  const quietColor = quietChoice.color === 'white' ? QUIET_WHITE
    : quietChoice.color === 'black' ? QUIET_BLACK : null;
  const shaded = type === 'Y'
    ? addShading(scene, {
      mode: state.shading,
      rim: state.shadingRim === true,
      clusterGap: QUIET_MARGIN_CELLS,
      selfQuietColors: [BULLSEYE_LIGHT, BULLSEYE_DARK],
    })
    : scene;
  const finalScene = addQuietZone(shaded, {
    color: quietColor,
    margin: QUIET_MARGIN_CELLS,
    selfQuietColors: [BULLSEYE_LIGHT, BULLSEYE_DARK],
  });
  const exportPpu = TARGET_SHORT_SIDE / Math.min(finalScene.width, finalScene.height);
  const finalRaster = rasterize(finalScene, {
    pixelsPerUnit: exportPpu,
    supersample: SUPERSAMPLE,
  });

  return { state, fallback, encoded, check, finalRaster, quietChoice, exportPpu };
}

function idealLogMargin() {
  const lo = relativeLuminance(PALETTE.levels[0]);
  const hi = relativeLuminance(PALETTE.levels[2]);
  return 0.5 * Math.log(hi / lo);
}

function checkSummary(type, check) {
  const verdict = selfCheckVerdict(check, {
    deltaMinContract: DELTA_MIN_CONTRACT,
    idealLogMargin: idealLogMargin(),
  });
  return {
    ok: check.ok,
    cells: check.total,
    mismatches: check.mismatches.length,
    erasures: Array.isArray(check.erasures) ? check.erasures.length : 0,
    deltaMin: type === 'Y' ? check.minDeltaY : check.minDelta,
    residualMax: check.residualGate && Number.isFinite(check.residualGate.maxResidual)
      ? check.residualGate.maxResidual : null,
    residualGate: check.residualGate && Number.isFinite(check.residualGate.epsilon)
      ? check.residualGate.epsilon : null,
    verdict: verdict.state,
    gateHeadroomPercent: verdict.headroomPercent,
  };
}

async function fileRecord(file) {
  const bytes = await fs.readFile(file);
  const stat = await fs.stat(file);
  return { ...pngMeta(bytes), modifiedAt: stat.mtime.toISOString() };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function renderOne(type, dryRun) {
  const target = path.join(ASSET_DIR, `type-${type}.png`);
  const backup = path.join(ASSET_DIR, `_old-type-${type}.png`);
  const baseline = await fileRecord(await exists(backup) ? backup : target);
  const built = renderDefault(type);
  const png = rasterToPng(built.finalRaster);

  // test/output 대신 repo 루트의 임시 파일을 쓴다. 성공·실패와 무관하게 아래에서 걷는다.
  const stage = path.join(REPO_ROOT, `.assets-render-${process.pid}-${type}.png`);
  let decoded;
  try {
    await fs.writeFile(stage, png);
    const baked = await fs.readFile(stage);
    decoded = decodeFrontend(pngToRaster(baked));
  } finally {
    await fs.rm(stage, { force: true });
  }

  const image = pngMeta(png);
  const selfCheck = checkSummary(type, built.check);
  const decodeOk = decoded.ok === true && decoded.text === PAYLOAD;
  const stateOk = (type === 'Y'
    ? built.state.finderPatternId === GENERATOR_DEFAULT_FINDER_PATTERN_ID
      && built.state.qrPosition !== 'inner'
    : built.state.finderPatternId === CENTER_QR_FINDER_PATTERN_ID
      && built.state.qrPosition === 'inner');
  const eligible = decodeOk && selfCheck.ok && stateOk && image.colorType === 2;

  let replaced = false;
  if (eligible && !dryRun) {
    if (!(await exists(backup))) {
      await fs.copyFile(target, backup, fsConstants.COPYFILE_EXCL);
    }
    await fs.writeFile(target, png);
    replaced = true;
  }

  return {
    type,
    status: eligible ? (dryRun ? 'validated-dry-run' : 'replaced') : 'kept-old',
    replaced,
    payload: PAYLOAD,
    qrText: built.state.qrText,
    state: {
      finderPatternId: built.state.finderPatternId,
      qrPosition: built.state.qrPosition,
      locatorProfileY: type === 'Y' ? built.state.locatorProfileY : null,
      innerSeat: built.state.innerSeat,
      outerSeat: built.state.outerSeat,
    },
    encoded: {
      version: built.encoded.version,
      eccLevel: built.encoded.eccLevel,
      formatIndex: built.encoded.formatIndex,
      k: built.encoded.k ?? null,
      n: built.encoded.n ?? null,
      tones: built.encoded.tones ?? null,
      centerQr: built.encoded.centerQr === true,
      cornerMarker: built.encoded.cornerMarker === true,
      cellSurfaceLayout: built.encoded.cellSurfaceLayout ?? null,
    },
    decode: {
      ok: decoded.ok === true,
      text: decoded.text ?? null,
      family: decoded.family ?? null,
      version: decoded.version ?? null,
      reason: decoded.reason ?? null,
      pipelineCode: decoded.detail && decoded.detail.pipelineCode
        ? decoded.detail.pipelineCode : null,
    },
    selfCheck,
    quietZone: { color: built.quietChoice.color, reason: built.quietChoice.reason },
    exportPixelsPerUnit: built.exportPpu,
    oldImage: baseline,
    newImage: image,
  };
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const onlyAt = argv.indexOf('--only');
  const selected = onlyAt < 0 ? TYPES : [String(argv[onlyAt + 1] || '').toUpperCase()];
  if (selected.some((type) => !TYPES.includes(type))) {
    throw new RangeError(`--only 는 ${TYPES.join('|')} 중 하나여야 한다`);
  }
  return { dryRun, selected };
}

async function main() {
  const { dryRun, selected } = parseArgs(process.argv.slice(2));
  const rows = [];
  let failed = false;
  for (const type of selected) {
    try {
      rows.push(await renderOne(type, dryRun));
      if (rows.at(-1).status === 'kept-old') failed = true;
    } catch (error) {
      failed = true;
      rows.push({
        type,
        status: 'kept-old',
        replaced: false,
        error: error && error.stack ? error.stack : String(error),
      });
    }
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    generator: 'assets-render.mjs',
    dryRun,
    preset: DEFAULT_PRESET,
    verifyPixelsPerUnit: VERIFY_PIXELS_PER_UNIT,
    targetShortSide: TARGET_SHORT_SIDE,
    supersample: SUPERSAMPLE,
    rows,
  }, null, 2));
  if (failed) process.exitCode = 1;
}

await main();
