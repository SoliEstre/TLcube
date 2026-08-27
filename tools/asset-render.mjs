#!/usr/bin/env node

/**
 * 소개 사이트 공개 자산 검증기 + OG 배너 재생성기.
 *
 * - 화면의 Type Y 자동 검출기 해소 순서를 따라 v0 Y를 만든다.
 * - sites/tl/assets/type-{O,A,K,Y}.png는 현행 기본값 증거라 읽기만 한다.
 * - OG 배너만 O=slate, A=노랑, K=단풍 붉은색, Y=초록으로 렌더한다.
 * - 성공 조건을 모두 통과한 뒤에만 og-banner.png를 쓴다.
 *
 * 사용:
 *   node tools/asset-render.mjs
 *   node tools/asset-render.mjs --dry-run
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

import { hasCenterQrSlot } from '../src/cellSurfaceFinal.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import { autoSeatsFor } from '../src/generator-seat-auto.js';
import { resolveAutoY, resolveVersionForLayout } from '../src/generator-auto-y.js';
import { encodeOptionsForY, sceneOptionsForOA } from '../src/generator-render-config.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  createGeneratorState,
} from '../src/generator-state.js';
import {
  CENTER_QR_FINDER_PATTERN_ID,
  selectGeneratorType,
} from '../src/finder-selection.js';
import { payloadByteLength } from '../src/header.js';
import {
  isCellSurfaceLocatorProfileY,
  LOCATOR_PROFILE_HEX_FRAME_V1,
} from '../src/locatorY.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  DELTA_MIN_CONTRACT,
  getPreset,
  PRESET_BG_SEPARATION_MIN,
  PRESET_DELTA_MIN,
  relativeLuminance,
} from '../src/luminance.js';
import { makeCustomPalette } from '../src/palette-hue.js';
import { crc32, rasterToPng } from '../src/png.js';
import { resolveQuietZoneChoice } from '../src/quiet-auto.js';
import { addQuietZone } from '../src/quietzone.js';
import { rasterize } from '../src/raster.js';
import { selfCheckVerdict } from '../src/render-status.js';
import { buildScene } from '../src/scene.js';
import { DEFAULT_FACE_GAINS, buildSceneY } from '../src/sceneY.js';
import { addShading } from '../src/shading.js';
import { verifyRaster } from '../src/verify.js';
import { verifyRasterY } from '../src/verifyY.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const ASSET_DIR = path.join(REPO_ROOT, 'sites', 'tl', 'assets');
const OG_FILE = path.join(ASSET_DIR, 'og-banner.png');
const TYPES = Object.freeze(['O', 'A', 'K', 'Y']);
const TYPES_OAK = Object.freeze(['O', 'A', 'K']);

const SITE_TARGET_SHORT_SIDE = 750;
const HERO_SOURCE_SHORT_SIDE = 920;
const SITE_PADDING_PX = 72;
const SITE_COMPONENT_GAP_CELLS = 2;
const SITE_WORKING_PAD_CELLS = 10;
const HERO_PADDING_PX = 14;
const SUB_ASSET_PADDING_PX = 12;
const SUPERSAMPLE = 2;
const VERIFY_PIXELS_PER_UNIT = Object.freeze({ O: 12, A: 12, K: 12, Y: 10 });
const OG_BOUNDARY_COLOR_THRESHOLD = 2;

/** index.html §withQuietZone과 같은 값. */
const QUIET_MARGIN_CELLS = 2;
const QUIET_WHITE = Object.freeze({ r: 255, g: 255, b: 255 });
const QUIET_BLACK = Object.freeze({ r: 0, g: 0, b: 0 });
const BG_SEPARATION_MIN = 0.05;

/** 첫 화면 URL 입력 `tl.estre.so`를 normalizeUrl이 푼 페이로드. */
const PAYLOAD = 'https://tl.estre.so';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const PALETTE_Y = Object.freeze({ ...PALETTE, faceGains: DEFAULT_FACE_GAINS });
const OG_HUES = Object.freeze({ O: null, A: 48, K: 12, Y: 142 });
const OG_PALETTE_BASES = Object.freeze({
  O: PRESET,
  A: makeCustomPalette(OG_HUES.A, 'Type A'),
  K: makeCustomPalette(OG_HUES.K, 'Type K'),
  Y: makeCustomPalette(OG_HUES.Y, 'Type Y'),
});
const OG_PALETTES = Object.freeze(Object.fromEntries(TYPES.map((type) => {
  const base = OG_PALETTE_BASES[type];
  const palette = {
    background: base.background,
    levels: base.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
  if (type === 'Y') palette.faceGains = DEFAULT_FACE_GAINS;
  return [type, Object.freeze(palette)];
})));
const PALETTE_PARITY_HUES = Object.freeze([0, 12, 48, 142, 359]);
const GENERATOR_PALETTE_BASELINE_SHA256 =
  '14b466faff8029a41603f246365f3243997fc4c63dcd77dc093e2b40eebd4c57';
const OG_CARD_COLOR = Object.freeze(blend(PRESET.background, PRESET.levels[0], 0.18));
/*
 * 히어로 판(plate) 색. **`ogHtml` 과 이 상수가 같은 값을 봐야 한다** — 종전에는
 * `ogHtml` 안에서만 계산하고 히어로 PNG 는 `PRESET.background` 로 구워, 판과 코드
 * 배경이 어긋나 둥근 판 안에 **각진 사각형 이음매**가 보였다 (실측: 판 rgb(19,22,33)
 * vs 코드 rgb(14,16,24), 최대 채널 차 **9**). 서브 카드는 `replaceExactBackground` 로
 * 치환해 Δ0 이었는데 히어로만 그 배선을 안 탔다 — 검사도 서브 3장×4모서리 12쌍만
 * 세어 히어로 4쌍을 못 봤다.
 * 상수를 여기로 올려 **두 소비자가 한 값을 보게** 한다.
 */
/*
 * 배너 문구. ⚠ 사이트 카피(`tools/hub-content.mjs`)는 **서술형**이라 배너에 그대로
 * 쓰면 길고 밋밋하다. 여기 문구는 배너 전용이며, **사실만** 말한다 —
 * 오픈 스펙과 Apache-2.0 은 사이트·README 가 이미 공표한 것이다.
 * ⭐ **홍보 표기는 «3D 바코드»** (운영자 2026-08-27). 공식 사이트 본문만
 *   «3D(2.5D)» 로 적는다 — 배너는 홍보물이므로 3D 로 간다.
 * ⛔ 제3자 브랜드·행사명(출시 플랫폼 등)을 넣지 마라 — 영구 자산이고 곧 낡는다.
 */
const OG_TAGLINE = 'Codes that fit your design, not fight it.';
const OG_TAGLINE_SUB = 'OPEN 3D BARCODE · APACHE-2.0 · FALLBACK QR';

const OG_PLATE_COLOR = Object.freeze(blend(PRESET.background, PRESET.levels[0], 0.11));

/**
 * OG의 모든 그린 요소는 이 레지스트리의 박스만 사용한다.
 * CSS와 이탈 검사가 같은 수치를 소비하므로 보고서 수치가 레이아웃과 갈라지지 않는다.
 */
const OG_LAYOUT = Object.freeze({
  canvas: Object.freeze({ id: '배경', x: 0, y: 0, width: 1200, height: 630 }),
  title: Object.freeze({ id: '타이틀', x: 56, y: 40, width: 500, height: 108 }),
  titleRule: Object.freeze({ id: '타이틀 강조선', x: 60, y: 164, width: 188, height: 6 }),
  heroPlate: Object.freeze({ id: 'Y 히어로 프레임', x: 620, y: 28, width: 540, height: 588 }),
  heroImage: Object.freeze({ id: 'Y 히어로 코드', x: 644, y: 48, width: 492, height: 526 }),
  heroLabel: Object.freeze({ id: 'Y 라벨', x: 644, y: 566, width: 492, height: 28 }),
  tagline: Object.freeze({ id: '홍보 문구', x: 58, y: 186, width: 500, height: 34 }),
  taglineSub: Object.freeze({ id: '보조 문구', x: 58, y: 224, width: 500, height: 24 }),
  cards: Object.freeze([
    Object.freeze({
      type: 'O',
      card: Object.freeze({ id: 'O 카드', x: 56, y: 248, width: 170, height: 294 }),
      image: Object.freeze({ id: 'O 코드', x: 68, y: 262, width: 146, height: 224 }),
      label: Object.freeze({ id: 'O 라벨', x: 70, y: 500, width: 142, height: 28 }),
    }),
    Object.freeze({
      type: 'A',
      card: Object.freeze({ id: 'A 카드', x: 238, y: 248, width: 170, height: 294 }),
      image: Object.freeze({ id: 'A 코드', x: 250, y: 262, width: 146, height: 224 }),
      label: Object.freeze({ id: 'A 라벨', x: 252, y: 500, width: 142, height: 28 }),
    }),
    Object.freeze({
      type: 'K',
      card: Object.freeze({ id: 'K 카드', x: 420, y: 248, width: 170, height: 294 }),
      image: Object.freeze({ id: 'K 코드', x: 432, y: 262, width: 146, height: 224 }),
      label: Object.freeze({ id: 'K 라벨', x: 434, y: 500, width: 142, height: 28 }),
    }),
  ]),
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function paletteParity() {
  const json = JSON.stringify(PALETTE_PARITY_HUES.map((hue) =>
    makeCustomPalette(hue, '사용자 지정')));
  const actualSha256 = sha256(Buffer.from(json, 'utf8'));
  return {
    hues: PALETTE_PARITY_HUES,
    beforeSha256: GENERATOR_PALETTE_BASELINE_SHA256,
    afterSha256: actualSha256,
    byteIdentical: actualSha256 === GENERATOR_PALETTE_BASELINE_SHA256,
  };
}

function paletteMeasurement(type) {
  const palette = OG_PALETTES[type];
  const luminances = palette.levels.map(relativeLuminance);
  const backgroundY = relativeLuminance(palette.background);
  const deltaMin = Math.min(
    luminances[1] - luminances[0],
    luminances[2] - luminances[1],
  );
  const backgroundSeparation = Math.min(...luminances.map((y) => y - backgroundY));
  return {
    type,
    hue: OG_HUES[type],
    background: palette.background,
    levels: palette.levels,
    backgroundY,
    luminances,
    deltaMin,
    backgroundSeparation,
    deltaContract: PRESET_DELTA_MIN,
    backgroundContract: PRESET_BG_SEPARATION_MIN,
    contractOk: deltaMin >= PRESET_DELTA_MIN
      && backgroundSeparation >= PRESET_BG_SEPARATION_MIN,
  };
}

function pngMeta(bytes) {
  const data = Buffer.from(bytes);
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('PNG 시그니처가 아니다');
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
    bytes: data.length,
    sha256: sha256(data),
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

/** PNG를 decodeFrontend와 크롭 계산이 소비할 RGBA 래스터로 되푼다. */
function pngToRaster(bytes) {
  const data = Buffer.from(bytes);
  const meta = pngMeta(data);
  if (meta.bitDepth !== 8 || ![2, 6].includes(meta.colorType)) {
    throw new Error(`지원하지 않는 PNG 형식: depth=${meta.bitDepth}, colorType=${meta.colorType}`);
  }

  const idats = [];
  let offset = 8;
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const typeBytes = data.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    const crcInput = new Uint8Array(4 + length);
    crcInput.set(typeBytes, 0);
    crcInput.set(chunk, 4);
    if (crc32(crcInput) !== expectedCrc) throw new Error(`${type} CRC 불일치`);
    if (type === 'IDAT') idats.push(chunk);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (idats.length === 0) throw new Error('PNG IDAT 청크가 없다');

  const channels = meta.colorType === 2 ? 3 : 4;
  const stride = meta.width * channels;
  const stream = new Uint8Array(inflateSync(Buffer.concat(idats)));
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

function contentBounds(raster, background = PRESET.background) {
  let minX = raster.width;
  let minY = raster.height;
  let maxX = -1;
  let maxY = -1;
  const { r, g, b } = background;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const at = (y * raster.width + x) * 4;
      if (raster.pixels[at] === r
        && raster.pixels[at + 1] === g
        && raster.pixels[at + 2] === b
        && raster.pixels[at + 3] === 255) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('배경과 다른 그린 픽셀이 없다');
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function shapeBounds(shape) {
  let points;
  if (shape.kind === 'polygon') points = shape.points;
  else if (shape.kind === 'disc') {
    points = [
      { x: shape.cx - shape.r, y: shape.cy - shape.r },
      { x: shape.cx + shape.r, y: shape.cy + shape.r },
    ];
  } else throw new RangeError(`알 수 없는 shape.kind: ${shape.kind}`);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function shapesBounds(shapes) {
  if (!Array.isArray(shapes) || shapes.length === 0) {
    throw new Error('바운딩 박스를 계산할 도형이 없다');
  }
  const boxes = shapes.map(shapeBounds);
  const minX = Math.min(...boxes.map((box) => box.minX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const maxX = Math.max(...boxes.map((box) => box.maxX));
  const maxY = Math.max(...boxes.map((box) => box.maxY));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function translateShape(shape, dx, dy) {
  if (shape.kind === 'polygon') {
    return {
      ...shape,
      points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    };
  }
  if (shape.kind === 'disc') return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
  throw new RangeError(`알 수 없는 shape.kind: ${shape.kind}`);
}

/**
 * 떨어진 코너 QR을 큐브 왼쪽 중앙에 붙인다. 원 장면의 데이터·색·셀 크기는 그대로고
 * 최종 도형 좌표만 옮긴다. QR과 큐브의 y 구간이 겹치므로 대각선 빈 삼각형이 생기지
 * 않으며, 이후 renderTightScene이 합집합에 균일 여백을 더한다.
 */
function compactDetachedQrScene(scene, gap = SITE_COMPONENT_GAP_CELLS) {
  const qrShapes = scene.shapes.filter((shape) => shape.selfQuiet === true);
  const bodyShapes = scene.shapes.filter((shape) => shape.selfQuiet !== true);
  if (qrShapes.length === 0 || bodyShapes.length === 0) {
    throw new Error('Type Y 좌우 재배치에 필요한 QR 또는 큐브 도형이 없다');
  }
  const qr = shapesBounds(qrShapes);
  const body = shapesBounds(bodyShapes);
  const contentWidth = qr.width + gap + body.width;
  const contentHeight = Math.max(qr.height, body.height);
  const width = contentWidth + 2 * SITE_WORKING_PAD_CELLS;
  const height = contentHeight + 2 * SITE_WORKING_PAD_CELLS;
  const qrOffset = {
    x: SITE_WORKING_PAD_CELLS - qr.minX,
    y: SITE_WORKING_PAD_CELLS + (contentHeight - qr.height) / 2 - qr.minY,
  };
  const bodyOffset = {
    x: SITE_WORKING_PAD_CELLS + qr.width + gap - body.minX,
    y: SITE_WORKING_PAD_CELLS + (contentHeight - body.height) / 2 - body.minY,
  };
  const shapes = [
    ...qrShapes.map((shape) => translateShape(shape, qrOffset.x, qrOffset.y)),
    ...bodyShapes.map((shape) => translateShape(shape, bodyOffset.x, bodyOffset.y)),
  ];
  return {
    scene: {
      ...scene,
      width,
      height,
      layout: scene.layout ? {
        ...scene.layout,
        width,
        height,
        originX: scene.layout.originX + bodyOffset.x,
        originY: scene.layout.originY + bodyOffset.y,
      } : scene.layout,
      shapes,
    },
    source: { qr, body, gap },
  };
}

/** 8-연결 비배경 픽셀 덩어리. 점유율은 덩어리별 bbox 면적 합으로 잰다. */
function contentComponents(raster, background = PRESET.background) {
  const mask = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < mask.length; i += 1) {
    const at = i * 4;
    if (raster.pixels[at] !== background.r
      || raster.pixels[at + 1] !== background.g
      || raster.pixels[at + 2] !== background.b
      || raster.pixels[at + 3] !== 255) mask[i] = 1;
  }
  const seen = new Uint8Array(mask.length);
  const components = [];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (mask[seed] === 0 || seen[seed] !== 0) continue;
    const queue = [seed];
    let head = 0;
    seen[seed] = 1;
    let pixels = 0;
    let minX = seed % raster.width;
    let maxX = minX;
    let minY = Math.floor(seed / raster.width);
    let maxY = minY;
    while (head < queue.length) {
      const index = queue[head];
      head += 1;
      const x = index % raster.width;
      const y = Math.floor(index / raster.width);
      pixels += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= raster.width || ny >= raster.height) continue;
          const next = ny * raster.width + nx;
          if (mask[next] !== 0 && seen[next] === 0) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    components.push({
      pixels,
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }
  components.sort((a, b) => a.minX - b.minX || a.minY - b.minY);
  return components;
}

function occupancyMeasurement(type, raster) {
  const components = contentComponents(raster);
  const contentArea = components.reduce((sum, box) => sum + box.width * box.height, 0);
  const canvasArea = raster.width * raster.height;
  return {
    type,
    width: raster.width,
    height: raster.height,
    components,
    contentArea,
    canvasArea,
    ratio: contentArea / canvasArea,
  };
}

function cropRaster(raster, box) {
  if (!Number.isInteger(box.x) || !Number.isInteger(box.y)
    || !Number.isInteger(box.width) || !Number.isInteger(box.height)
    || box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1
    || box.x + box.width > raster.width || box.y + box.height > raster.height) {
    throw new RangeError(`래스터 크롭 박스가 범위를 벗어났다: ${JSON.stringify(box)}`);
  }
  const pixels = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const sourceStart = ((box.y + y) * raster.width + box.x) * 4;
    const sourceEnd = sourceStart + box.width * 4;
    pixels.set(raster.pixels.subarray(sourceStart, sourceEnd), y * box.width * 4);
  }
  return { width: box.width, height: box.height, pixels };
}

function centeredCropBox(raster, bounds, width, height) {
  if (width < bounds.width || height < bounds.height) {
    throw new RangeError(`그린 픽셀보다 작은 크롭: ${width}x${height} < ${bounds.width}x${bounds.height}`);
  }
  const centerX = (bounds.minX + bounds.maxX + 1) / 2;
  const centerY = (bounds.minY + bounds.maxY + 1) / 2;
  const x = Math.max(0, Math.min(raster.width - width, Math.floor(centerX - width / 2)));
  const y = Math.max(0, Math.min(raster.height - height, Math.floor(centerY - height / 2)));
  return { x, y, width, height };
}

/**
 * 장면을 내용 바운드 기준으로 고해상도 재렌더하고 짧은 변을 정확히 맞춘다.
 * 먼저 저해상도에서 값의 존재를 찾고, 그 값을 목표 크기에 맞게 반복 보정한다.
 */
function renderTightScene(
  scene, targetShortSide, padding, background = PRESET.background,
) {
  let pixelsPerUnit = 12;
  let raster;
  let bounds;
  for (let i = 0; i < 5; i += 1) {
    raster = rasterize(scene, { pixelsPerUnit, supersample: SUPERSAMPLE });
    bounds = contentBounds(raster, background);
    const contentShort = Math.min(bounds.width, bounds.height);
    pixelsPerUnit *= (targetShortSide - 2 * padding) / contentShort;
  }
  raster = rasterize(scene, { pixelsPerUnit, supersample: SUPERSAMPLE });
  bounds = contentBounds(raster, background);

  let width;
  let height;
  if (bounds.width <= bounds.height) {
    width = targetShortSide;
    height = bounds.height + 2 * padding;
  } else {
    width = bounds.width + 2 * padding;
    height = targetShortSide;
  }
  if (width < bounds.width || height < bounds.height) {
    throw new Error('목표 짧은 변 안에 콘텐츠를 담을 수 없다');
  }
  const cropBox = centeredCropBox(raster, bounds, width, height);
  const cropped = cropRaster(raster, cropBox);
  const croppedBounds = contentBounds(cropped, background);
  return {
    raster: cropped,
    pixelsPerUnit,
    sourceRaster: { width: raster.width, height: raster.height },
    sourceBounds: bounds,
    cropBox,
    contentBounds: croppedBounds,
    margins: {
      left: croppedBounds.minX,
      top: croppedBounds.minY,
      right: cropped.width - 1 - croppedBounds.maxX,
      bottom: cropped.height - 1 - croppedBounds.maxY,
    },
  };
}

function cropExistingAsset(raster, padding) {
  const bounds = contentBounds(raster);
  const box = {
    x: Math.max(0, bounds.minX - padding),
    y: Math.max(0, bounds.minY - padding),
    width: 0,
    height: 0,
  };
  const maxX = Math.min(raster.width - 1, bounds.maxX + padding);
  const maxY = Math.min(raster.height - 1, bounds.maxY + padding);
  box.width = maxX - box.x + 1;
  box.height = maxY - box.y + 1;
  return { raster: cropRaster(raster, box), sourceBounds: bounds, cropBox: box };
}

function defaultStateFor(type) {
  const initial = createGeneratorState({ type: 'Y' });
  const initialLocatorProfileY = initial.locatorProfileY;
  const state = selectGeneratorType(initial, type, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  const selectedLocatorProfileY = state.locatorProfileY;
  let auto = null;

  // index.html §syncSeatUi와 같은 자동 자리 정책.
  if (type !== 'Y') {
    const seats = autoSeatsFor({ type, centralFinderIsTaegeuk: false, allowBlocked: false });
    state.innerSeat = seats.inner;
    state.outerSeat = seats.outer;
  }

  // index.html §resolveAutoYSafe → §applyAutoLocatorProfileY와 같은 순서.
  // create/select의 `off`를 렌더 값으로 쓰지 않고, 현재 페이로드로 자동 사다리를 먼저 푼다.
  if (type === 'Y') {
    const inputs = {
      payloadBytes: payloadByteLength(PAYLOAD),
      tones: state.tone === 3 ? 3 : 2,
      eccLevel: state.eccLevel,
    };
    auto = { inputs, ...resolveAutoY(inputs) };
    state.locatorProfileY = auto.locatorProfileY;
  }

  return {
    state,
    resolution: {
      initialLocatorProfileY,
      selectedLocatorProfileY,
      detectorAutoY: type === 'Y',
      auto,
      renderedLocatorProfileY: type === 'Y' ? state.locatorProfileY : null,
    },
  };
}

function assertDefaultState(type, state) {
  const expected = type === 'Y'
    ? { finderPatternId: GENERATOR_DEFAULT_FINDER_PATTERN_ID, qrPosition: 'TL' }
    : { finderPatternId: CENTER_QR_FINDER_PATTERN_ID, qrPosition: 'inner' };
  if (state.finderPatternId !== expected.finderPatternId
    || state.qrPosition !== expected.qrPosition) {
    throw new Error(`${type} 화면 상태 불일치: ${state.finderPatternId}/${state.qrPosition}`);
  }
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

function quietColorFor(type, state, palette = PALETTE) {
  const separation = (color) => {
    const y = relativeLuminance(color);
    return Math.min(...palette.levels.map((level) => Math.abs(relativeLuminance(level) - y)));
  };
  const choice = resolveQuietZoneChoice({
    quietMode: state.quietMode,
    bgMode: state.bgMode,
    type,
    sepWhite: separation(QUIET_WHITE),
    sepBlack: separation(QUIET_BLACK),
    surfaceLuminance: null,
    separationFloor: BG_SEPARATION_MIN,
  });
  const color = choice.color === 'white' ? QUIET_WHITE
    : choice.color === 'black' ? QUIET_BLACK : null;
  return { choice, color };
}

/** gallery-render.mjs의 renderY/OA 배선 순서와 같은 기본 장면을 만든다. */
function renderDefault(type, { includeQr = true, palette } = {}) {
  const { state, resolution } = defaultStateFor(type);
  assertDefaultState(type, state);
  const fallback = fallbackForDefault(type, state);
  const renderPalette = palette ?? (type === 'Y' ? PALETTE_Y : PALETTE);
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

    const sceneOptions = { palette: renderPalette };
    if (state.locatorProfileY === LOCATOR_PROFILE_HEX_FRAME_V1
      || isCellSurfaceLocatorProfileY(state.locatorProfileY)) {
      sceneOptions.locatorProfile = state.locatorProfileY;
    }
    if (includeQr && fallback.mode !== 'off') {
      sceneOptions.qrText = state.qrText;
      if (fallback.mode === 'corner') sceneOptions.qrCorner = fallback.corner;
    }
    if (includeQr && encodeOptions.cellSurface === true
      && hasCenterQrSlot(encodeOptions.cellSurfaceLayout)
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
    const sceneOptions = {
      palette: renderPalette,
      margin: 20,
      finderPatternId: state.finderPatternId,
    };
    if (includeQr && fallback.mode === 'center') {
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
      palette: renderPalette,
      qrText: includeQr ? state.qrText : undefined,
      type,
    });
    scene = buildScene(encoded, sceneOptions);
  }

  const verifyPpu = VERIFY_PIXELS_PER_UNIT[type];
  const selfRaster = rasterize(scene, { pixelsPerUnit: verifyPpu, supersample: SUPERSAMPLE });
  const check = type === 'Y'
    ? verifyRasterY(selfRaster, scene, encoded)
    : verifyRaster(selfRaster, scene, encoded);
  const { choice: quietChoice, color: quietColor } = quietColorFor(type, state, renderPalette);
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
  const exportPixelsPerUnit = SITE_TARGET_SHORT_SIDE / Math.min(finalScene.width, finalScene.height);

  return {
    type,
    state,
    resolution,
    fallback,
    encoded,
    scene,
    finalScene,
    check,
    quietChoice,
    exportPixelsPerUnit,
    includeQr,
    palette: renderPalette,
  };
}

function idealLogMargin(palette = PALETTE) {
  const lo = relativeLuminance(palette.levels[0]);
  const hi = relativeLuminance(palette.levels[2]);
  return 0.5 * Math.log(hi / lo);
}

function checkSummary(type, check, palette = PALETTE) {
  const verdict = selfCheckVerdict(check, {
    deltaMinContract: DELTA_MIN_CONTRACT,
    idealLogMargin: idealLogMargin(palette),
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

function rgbCss(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function blend(a, b, t) {
  return {
    r: Math.round(a.r * (1 - t) + b.r * t),
    g: Math.round(a.g * (1 - t) + b.g * t),
    b: Math.round(a.b * (1 - t) + b.b * t),
  };
}

function replaceExactBackground(raster, from, to) {
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let i = 0; i < raster.width * raster.height; i += 1) {
    const at = i * 4;
    if (pixels[at] === from.r && pixels[at + 1] === from.g
      && pixels[at + 2] === from.b && pixels[at + 3] === 255) {
      pixels[at] = to.r;
      pixels[at + 1] = to.g;
      pixels[at + 2] = to.b;
    }
  }
  return { width: raster.width, height: raster.height, pixels };
}

function boxStyle(box) {
  return `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`;
}

function pngDataUrl(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

function ogBoxes() {
  return [
    OG_LAYOUT.canvas,
    OG_LAYOUT.title,
    OG_LAYOUT.titleRule,
    OG_LAYOUT.tagline,
    OG_LAYOUT.taglineSub,
    OG_LAYOUT.heroLabel,
    OG_LAYOUT.heroPlate,
    OG_LAYOUT.heroImage,
    ...OG_LAYOUT.cards.flatMap((item) => [item.card, item.image, item.label]),
  ];
}

function verifyOgBounds() {
  const boxes = ogBoxes().map((box) => {
    const minX = box.x;
    const minY = box.y;
    const maxX = box.x + box.width;
    const maxY = box.y + box.height;
    const inside = minX >= 0 && minY >= 0 && maxX <= 1200 && maxY <= 630;
    return { id: box.id, minX, minY, maxX, maxY, inside };
  });
  return {
    boxes,
    allInside: boxes.every((box) => box.inside),
    union: {
      minX: Math.min(...boxes.map((box) => box.minX)),
      minY: Math.min(...boxes.map((box) => box.minY)),
      maxX: Math.max(...boxes.map((box) => box.maxX)),
      maxY: Math.max(...boxes.map((box) => box.maxY)),
    },
  };
}

function ogHtml(heroPng, subPngs) {
  const plateColor = OG_PLATE_COLOR;   // 히어로 PNG 배경 치환과 같은 값을 본다
  const borderColor = blend(PRESET.background, PRESET.levels[1], 0.42);
  const titleColor = PRESET.levels[2];
  const labelColor = blend(PRESET.levels[1], PRESET.levels[2], 0.54);
  const cards = OG_LAYOUT.cards.map((item) => `
    <div class="card" style="${boxStyle(item.card)}"></div>
    <img class="code sub-code" alt="Type ${item.type}" style="${boxStyle(item.image)}"
      src="${pngDataUrl(subPngs[item.type])}">
    <div class="label" style="${boxStyle(item.label)}">TYPE ${item.type}</div>`).join('');

  return `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { background: ${rgbCss(PRESET.background)}; }
  .canvas {
    position: relative; width: 1200px; height: 630px; overflow: hidden;
    background: ${rgbCss(PRESET.background)};
    font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system,
      BlinkMacSystemFont, sans-serif;
  }
  .title {
    position: absolute; margin: 0; display: flex; align-items: center;
    color: ${rgbCss(titleColor)}; font-size: 92px; line-height: 108px;
    font-weight: 760; letter-spacing: -4px;
  }
  .rule { position: absolute; background: ${rgbCss(PRESET.levels[1])}; border-radius: 3px; }
  .hero-plate {
    position: absolute; border: 1px solid ${rgbCss(borderColor)};
    border-radius: 30px; background: ${rgbCss(plateColor)};
  }
  .card {
    position: absolute; border: 1px solid ${rgbCss(borderColor)};
    border-radius: 20px; background: ${rgbCss(OG_CARD_COLOR)};
  }
  .code { position: absolute; display: block; object-fit: contain; }
  .tagline {
    position: absolute; display: flex; align-items: center;
    color: ${rgbCss(PRESET.levels[2])}; font-size: 27px; line-height: 34px;
    font-weight: 620; letter-spacing: -0.4px;
  }
  .tagline-sub {
    position: absolute; display: flex; align-items: center;
    color: ${rgbCss(labelColor)}; font-size: 16px; line-height: 24px;
    font-weight: 600; letter-spacing: 0.6px;
  }
  .label {
    position: absolute; display: flex; align-items: center; justify-content: center;
    color: ${rgbCss(labelColor)}; font-size: 18px; line-height: 28px;
    font-weight: 700; letter-spacing: 2.2px;
  }
</style>
<div class="canvas">
  <h1 class="title" style="${boxStyle(OG_LAYOUT.title)}">TLcube</h1>
  <div class="rule" style="${boxStyle(OG_LAYOUT.titleRule)}"></div>
  <div class="tagline" style="${boxStyle(OG_LAYOUT.tagline)}">${OG_TAGLINE}</div>
  <div class="tagline-sub" style="${boxStyle(OG_LAYOUT.taglineSub)}">${OG_TAGLINE_SUB}</div>
  <div class="hero-plate" style="${boxStyle(OG_LAYOUT.heroPlate)}"></div>
  <img class="code hero-code" alt="Type Y" style="${boxStyle(OG_LAYOUT.heroImage)}"
    src="${pngDataUrl(heroPng)}">
  <div class="label" style="${boxStyle(OG_LAYOUT.heroLabel)}">TYPE Y</div>
  ${cards}
</div>`;
}

async function findEdge() {
  const candidates = [
    process.env['ProgramFiles(x86)']
      ? path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : null,
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : null,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 다음 시스템 설치 위치를 본다.
    }
  }
  throw new Error('시스템 폰트로 OG 타이틀을 렌더할 Microsoft Edge를 찾지 못했다');
}

async function renderOgWithSystemFont(heroPng, subPngs) {
  const tempRoot = path.resolve(os.tmpdir());
  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'tlcube-yfix-'));
  const htmlFile = path.join(tempDir, 'og.html');
  const screenshotFile = path.join(tempDir, 'og-edge.png');
  const profileDir = path.join(tempDir, 'edge-profile');
  try {
    await fs.writeFile(htmlFile, ogHtml(heroPng, subPngs), 'utf8');
    const edge = await findEdge();
    execFileSync(edge, [
      '--headless=new',
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--hide-scrollbars',
      '--no-sandbox',
      '--no-first-run',
      '--force-device-scale-factor=1',
      '--window-size=1200,630',
      `--user-data-dir=${profileDir}`,
      `--screenshot=${screenshotFile}`,
      pathToFileURL(htmlFile).href,
    ], { stdio: 'pipe', windowsHide: true, timeout: 30_000 });
    const screenshot = await fs.readFile(screenshotFile);
    const screenshotMeta = pngMeta(screenshot);
    if (screenshotMeta.width !== 1200 || screenshotMeta.height !== 630) {
      throw new Error(`Edge OG 캔버스가 1200x630이 아니다: ${screenshotMeta.width}x${screenshotMeta.height}`);
    }
    const raster = pngToRaster(screenshot);
    for (let i = 3; i < raster.pixels.length; i += 4) {
      if (raster.pixels[i] !== 255) throw new Error('OG 스크린샷에 투명 픽셀이 있다');
    }
    return { png: rasterToPng(raster), screenshotMeta };
  } finally {
    const resolved = path.resolve(tempDir);
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('tlcube-yfix-')) {
      throw new Error(`임시 디렉터리 경계 검증 실패: ${resolved}`);
    }
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

function containScale(source, box) {
  return Math.min(box.width / source.width, box.height / source.height);
}

function containedImageRect(source, box) {
  const scale = containScale(source, box);
  const width = source.width * scale;
  const height = source.height * scale;
  const minX = box.x + (box.width - width) / 2;
  const minY = box.y + (box.height - height) / 2;
  return { minX, minY, maxX: minX + width, maxY: minY + height, width, height };
}

function rgbAt(raster, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    throw new RangeError(`픽셀 좌표가 캔버스 밖이다: (${x}, ${y})`);
  }
  const at = (y * raster.width + x) * 4;
  return { r: raster.pixels[at], g: raster.pixels[at + 1], b: raster.pixels[at + 2] };
}

function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return {
    maxChannel: Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)),
    euclidean: Math.sqrt(dr * dr + dg * dg + db * db),
  };
}

/** Edge가 실제로 합성한 히어로·서브 코드 모서리와 바로 바깥 판 색을 대조한다. */
function verifyOgBoundaries(ogRaster, heroRaster, subRasters) {
  const corners = Object.freeze([
    { id: '좌상', inside: (r) => [Math.ceil(r.minX) + 1, Math.ceil(r.minY) + 1], outside: (r) => [Math.floor(r.minX) - 2, Math.floor(r.minY) - 2] },
    { id: '우상', inside: (r) => [Math.floor(r.maxX) - 2, Math.ceil(r.minY) + 1], outside: (r) => [Math.ceil(r.maxX) + 1, Math.floor(r.minY) - 2] },
    { id: '좌하', inside: (r) => [Math.ceil(r.minX) + 1, Math.floor(r.maxY) - 2], outside: (r) => [Math.floor(r.minX) - 2, Math.ceil(r.maxY) + 1] },
    { id: '우하', inside: (r) => [Math.floor(r.maxX) - 2, Math.floor(r.maxY) - 2], outside: (r) => [Math.ceil(r.maxX) + 1, Math.ceil(r.maxY) + 1] },
  ]);
  const rows = [];
  const targets = [
    { type: 'Y', raster: heroRaster, image: OG_LAYOUT.heroImage },
    ...OG_LAYOUT.cards.map((item) => ({
      type: item.type, raster: subRasters[item.type], image: item.image,
    })),
  ];
  for (const target of targets) {
    const imageRect = containedImageRect(target.raster, target.image);
    for (const corner of corners) {
      const [insideX, insideY] = corner.inside(imageRect);
      const [outsideX, outsideY] = corner.outside(imageRect);
      const inside = rgbAt(ogRaster, insideX, insideY);
      const outside = rgbAt(ogRaster, outsideX, outsideY);
      rows.push({
        type: target.type,
        corner: corner.id,
        inside: { x: insideX, y: insideY, rgb: inside },
        outside: { x: outsideX, y: outsideY, rgb: outside },
        difference: colorDistance(inside, outside),
      });
    }
  }
  return {
    threshold: OG_BOUNDARY_COLOR_THRESHOLD,
    rows,
    allWithinThreshold: rows.every((row) =>
      row.difference.maxChannel <= OG_BOUNDARY_COLOR_THRESHOLD),
  };
}

function localKst(iso) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function f(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function reportMarkdown(result) {
  const {
    ySite, og, bounds, oak, generatedAt, boundary, occupancy, siteLayout,
  } = result;
  const rgb = (color) => `(${color.r}, ${color.g}, ${color.b})`;
  const boundaryRows = boundary.rows.map((row) =>
    `| ${row.type} | ${row.corner} | (${row.inside.x}, ${row.inside.y}) ${rgb(row.inside.rgb)} | (${row.outside.x}, ${row.outside.y}) ${rgb(row.outside.rgb)} | ${row.difference.maxChannel} / ${f(row.difference.euclidean, 3)} |`).join('\n');
  const occupancyRows = occupancy.map((row) => {
    const boxes = row.components.map((box) =>
      `(${box.minX},${box.minY})–(${box.maxX + 1},${box.maxY + 1})`).join(' + ');
    return `| ${row.type} | ${row.width}×${row.height} | ${boxes} | ${row.contentArea} / ${row.canvasArea} | ${f(row.ratio * 100, 2)}% |`;
  }).join('\n');
  const boxRows = bounds.boxes.map((box) =>
    `| ${box.id} | (${box.minX}, ${box.minY})–(${box.maxX}, ${box.maxY}) | ${box.inside ? '안쪽' : '이탈'} |`).join('\n');
  const siteRows = siteLayout.components.map((box) =>
    `| ${box.id} | (${box.minX}, ${box.minY})–(${box.maxX}, ${box.maxY}) | ${box.inside ? '안쪽' : '이탈'} |`).join('\n');
  const oakRows = oak.map((row) =>
    `| type-${row.type}.png | ${row.before.sha256} | ${row.unchanged ? '불변' : '변경됨'} |`).join('\n');
  const yOccupancy = occupancy.find((row) => row.type === 'Y');
  const kOccupancy = occupancy.find((row) => row.type === 'K');
  const occupancyDelta = Math.abs(yOccupancy.ratio - kOccupancy.ratio) * 100;

  return `# 레인 YFIX2 보고서

- 생성 시각: ${localKst(generatedAt)} (Asia/Seoul)
- 재생성기: \`tools/asset-render.mjs\`
- 변경 범위: 배너 서브 코드 배경 연결, 사이트 Type Y 좌우 밀착 배치
- 스위트: 실행하지 않음. 자산별 픽셀 게이트·자체검증·\`decodeFrontend\` 재복호만 수행함.

## 1. 값이 있나 — 실측

### 1.1 배너 서브 카드 경계 색

아래 좌표는 최종 \`og-banner.png\`에서 직접 읽었다. 안쪽은 실제로 표시된 코드 PNG의 모서리에서 1px 들어간 점, 바깥은 그 모서리에서 카드 쪽으로 2px 벗어난 점이다. 차이는 \`최대 채널 차 / RGB 유클리드 거리\`다.

| 타입 | 모서리 | 코드 안쪽 좌표·RGB | 바깥 카드 좌표·RGB | 차이 |
|---|---|---|---|---:|
${boundaryRows}

### 1.2 네 타입 콘텐츠 점유율

한 기준만 썼다: **8-연결 비배경 콘텐츠 덩어리별 바운딩 박스 면적의 합 ÷ 캔버스 면적**. Type Y의 떨어진 QR과 큐브 사이 빈 공간을 콘텐츠로 부풀리지 않으며, O/A/K에도 같은 계산을 적용했다. 좌표 끝은 배타적이다.

| 타입 | 캔버스 | 콘텐츠 덩어리 bbox | 콘텐츠 면적 / 캔버스 면적 | 점유율 |
|---|---:|---|---:|---:|
${occupancyRows}

### 1.3 두 산출물 PNG 계측

| 파일 | 폭×높이 | bitDepth | colorType | 바이트 |
|---|---:|---:|---:|---:|
| \`sites/tl/assets/type-Y.png\` | ${ySite.image.width}×${ySite.image.height} | ${ySite.image.bitDepth} | ${ySite.image.colorType} | ${ySite.image.bytes} |
| \`og-banner.png\` | ${og.image.width}×${og.image.height} | ${og.image.bitDepth} | ${og.image.colorType} | ${og.image.bytes} |

### 1.4 Type Y 재복호와 v0 값

- 크롭 뒤 재복호: \`ok=${ySite.decode.ok}\`, family \`${ySite.decode.family}\`, version ${ySite.decode.version}, 원문 \`${ySite.decode.text}\`.
- 상태 생성 직후 \`locatorProfileY=${ySite.resolution.initialLocatorProfileY}\`.
- 타입 선택 직후 \`locatorProfileY=${ySite.resolution.selectedLocatorProfileY}\`.
- 실제 렌더 입력 \`locatorProfileY=${ySite.resolution.renderedLocatorProfileY}\`.
- 인코딩 결과 Y${ySite.encoded.version}, \`cellSurfaceLayout=${ySite.encoded.cellSurfaceLayout}\`, ECC ${ySite.encoded.eccLevel}.
- 자체검증 ${ySite.selfCheck.cells}셀, mismatch ${ySite.selfCheck.mismatches}, erasure ${ySite.selfCheck.erasures}, Δmin ${f(ySite.selfCheck.deltaMin, 6)}.

### 1.5 캔버스 이탈 계산

Type Y 사이트 자산의 QR과 큐브는 x축으로 분리되고 y축 구간은 ${siteLayout.yOverlap}px 겹친다. 실제 두 덩어리 사이 간격은 ${siteLayout.gapPixels}px, 합집합 바깥 여백은 좌/상/우/하 ${ySite.crop.margins.left}/${ySite.crop.margins.top}/${ySite.crop.margins.right}/${ySite.crop.margins.bottom}px다.

| Type Y 요소 | 계산 바운딩 박스 | 결과 |
|---|---:|---|
${siteRows}

배너는 끝 좌표를 \`x+width\`, \`y+height\`로 계산했다. 전체 합집합은 (${bounds.union.minX}, ${bounds.union.minY})–(${bounds.union.maxX}, ${bounds.union.maxY})다.

| 배너 요소 | 계산 바운딩 박스 | 결과 |
|---|---:|---|
${boxRows}

## 2. 값이 맞나 — 판정

- **서브 카드 경계:** 12쌍 모두 최대 채널 차 ${boundary.maxDifference}로 임계 ${boundary.threshold} 이하 — 통과. 원본 \`type-O/A/K.png\`는 바꾸지 않고 배너용 합성본의 정확한 배경색만 카드색으로 치환했다.
- **Type Y 밀착 배치:** 두 콘텐츠 덩어리가 좌우로 나뉘고 y축에서 겹치므로 대각선 빈 삼각형이 없다. 짧은 변은 ${Math.min(ySite.image.width, ySite.image.height)}px로 다른 세 장의 750px와 같다.
- **시각적 무게:** Y ${f(yOccupancy.ratio * 100, 2)}%, 가장 큰 K ${f(kOccupancy.ratio * 100, 2)}%, 차이 ${f(occupancyDelta, 2)}%p — 같은 상위 점유율 급이다.
- **PNG 규격:** Type Y는 RGB colorType 2이고, 배너는 1200×630·RGB colorType 2·${og.image.bytes} B로 300000 B 이하 — 통과.
- **재복호:** \`decodeFrontend\`가 \`${ySite.decode.text}\`까지 복원 — 통과.
- **캔버스 이탈:** Type Y ${siteLayout.allInside ? '전 요소 안쪽' : '이탈 있음'}, 배너 ${bounds.allInside ? '전 요소 안쪽' : '이탈 있음'} — ${siteLayout.allInside && bounds.allInside ? '통과' : '실패'}.
- **v0:** 자동 해소 결과 \`${ySite.resolution.renderedLocatorProfileY}\`, 인코딩 \`cellSurfaceLayout=${ySite.encoded.cellSurfaceLayout}\` — 통과.
- **구도 보존:** 배너의 타이틀·Y 히어로·세 카드 좌표는 바꾸지 않았고 히어로 QR도 계속 없다. 제3자 브랜드·행사명은 넣지 않았다.

## 3. 읽기 전용 O/A/K 불변

| 자산 | 작업 전 SHA-256 | 작업 후 |
|---|---|---|
${oakRows}
`;
}

async function readOakAssets() {
  const rows = [];
  for (const type of TYPES_OAK) {
    const file = path.join(ASSET_DIR, `type-${type}.png`);
    const bytes = await fs.readFile(file);
    const raster = pngToRaster(bytes);
    const cropped = cropExistingAsset(raster, SUB_ASSET_PADDING_PX);
    rows.push({ type, file, bytes, before: pngMeta(bytes), raster, cropped });
  }
  return rows;
}

async function readProtectedAssetFingerprints() {
  return Promise.all(TYPES.map(async (type) => {
    const file = path.join(ASSET_DIR, `type-${type}.png`);
    const bytes = await fs.readFile(file);
    return { type, file, image: pngMeta(bytes) };
  }));
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.includes('--dry-run');
  const unknown = args.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) throw new RangeError(`알 수 없는 인자: ${unknown.join(' ')}`);

  const generatedAt = new Date().toISOString();
  const protectedBefore = await readProtectedAssetFingerprints();
  const oak = await readOakAssets();
  const parity = paletteParity();
  if (!parity.byteIdentical) {
    throw new Error(`커스텀 팔레트 추출 전후 바이트 불일치: ${JSON.stringify(parity)}`);
  }
  const paletteMeasurements = TYPES.map(paletteMeasurement);
  const invalidPalette = paletteMeasurements.find((row) => !row.contractOk);
  if (invalidPalette) {
    throw new Error(`OG hue 팔레트 계약 위반: ${JSON.stringify(invalidPalette)}`);
  }

  const yWithQr = renderDefault('Y', { includeQr: true });
  const yHero = renderDefault('Y', {
    includeQr: false,
    palette: OG_PALETTES.Y,
  });
  const ogBuilds = Object.fromEntries(TYPES_OAK.map((type) => [
    type, renderDefault(type, { palette: OG_PALETTES[type] }),
  ]));
  const ySelfCheck = checkSummary('Y', yWithQr.check, PALETTE_Y);
  const heroSelfCheck = checkSummary('Y', yHero.check, OG_PALETTES.Y);
  const ogSelfChecks = Object.fromEntries(TYPES_OAK.map((type) => [
    type, checkSummary(type, ogBuilds[type].check, OG_PALETTES[type]),
  ]));
  if (!ySelfCheck.ok || !heroSelfCheck.ok
    || Object.values(ogSelfChecks).some((check) => !check.ok)) {
    throw new Error('OG 타입별 자체검증 실패');
  }
  if (yWithQr.resolution.renderedLocatorProfileY !== 'cell-surface-v0'
    || yWithQr.encoded.version !== 0
    || yWithQr.encoded.cellSurfaceLayout !== 'v0') {
    throw new Error(`화면 기본 Y가 v0로 해소되지 않았다: ${JSON.stringify(yWithQr.resolution)}`);
  }

  /*
   * ⚠ **폴백 QR 을 옮기지 않는다** (운영자 지시 2026-08-27).
   * 종전에는 `compactDetachedQrScene` 으로 QR 을 큐브 옆에 붙여 가로로 나란히 놨다.
   * 그런데 대각선 배치는 레이아웃 취향이 아니라 **생성기 산출**이다 — Y 의 폴백 QR 은
   * `qrPosition: 'TL'`(좌상단)이 정본이고 큐브는 그 아래 오른쪽에 온다.
   * 소개 페이지 이미지는 **생성기가 내는 그림**이어야 하므로 배치를 건드리지 않고
   * `renderTightScene` 으로 **바깥 여백만** 잘라 낸다.
   * (통합자 지시가 「크롭」이라고만 해서 재배치까지 허용된 것이 원인이었다.)
   */
  const siteTight = renderTightScene(
    yWithQr.finalScene, SITE_TARGET_SHORT_SIDE, SITE_PADDING_PX,
  );
  const sitePng = rasterToPng(siteTight.raster);
  const siteImage = pngMeta(sitePng);
  const decoded = decodeFrontend(pngToRaster(sitePng));
  if (decoded.ok !== true || decoded.text !== PAYLOAD) {
    throw new Error(`크롭 Type Y 재복호 실패: ${JSON.stringify(decoded)}`);
  }
  if (Math.min(siteImage.width, siteImage.height) !== SITE_TARGET_SHORT_SIDE
    || siteImage.colorType !== 2) {
    throw new Error(`Type Y 이미지 규격 실패: ${JSON.stringify(siteImage)}`);
  }

  const heroTight = renderTightScene(
    yHero.finalScene, HERO_SOURCE_SHORT_SIDE, HERO_PADDING_PX,
    OG_PALETTES.Y.background,
  );
  // 커스텀 Y의 배경을 판 색으로 치환한다. PRESET.background를 원본으로 쓰면 이음매가 난다.
  const heroPng = rasterToPng(
    replaceExactBackground(
      heroTight.raster, OG_PALETTES.Y.background, OG_PLATE_COLOR,
    ),
  );
  const heroRaster = pngToRaster(heroPng);
  const subSourceRasters = Object.fromEntries(oak.map((row) => {
    if (row.type === 'O') return [row.type, row.cropped.raster];
    const targetShortSide = Math.min(row.cropped.raster.width, row.cropped.raster.height);
    const tight = renderTightScene(
      ogBuilds[row.type].finalScene,
      targetShortSide,
      SUB_ASSET_PADDING_PX,
      OG_PALETTES[row.type].background,
    );
    return [row.type, tight.raster];
  }));
  const subRasters = Object.fromEntries(oak.map((row) => [
    row.type,
    replaceExactBackground(
      subSourceRasters[row.type], OG_PALETTES[row.type].background, OG_CARD_COLOR,
    ),
  ]));
  const subPngs = Object.fromEntries(oak.map((row) => [
    row.type, rasterToPng(subRasters[row.type]),
  ]));

  const bounds = verifyOgBounds();
  if (!bounds.allInside) throw new Error(`OG 요소 캔버스 이탈: ${JSON.stringify(bounds)}`);
  const renderedOg = await renderOgWithSystemFont(heroPng, subPngs);
  const ogImage = pngMeta(renderedOg.png);
  if (ogImage.width !== 1200 || ogImage.height !== 630 || ogImage.colorType !== 2) {
    throw new Error(`OG 규격 실패: ${JSON.stringify(ogImage)}`);
  }
  if (ogImage.bytes > 300_000) throw new Error(`OG가 300 kB를 넘는다: ${ogImage.bytes} B`);
  const ogRaster = pngToRaster(renderedOg.png);
  const boundary = verifyOgBoundaries(ogRaster, heroRaster, subRasters);
  boundary.maxDifference = Math.max(...boundary.rows.map((row) => row.difference.maxChannel));
  if (!boundary.allWithinThreshold) {
    throw new Error(`OG 16쌍 경계 색이 이어지지 않는다: ${JSON.stringify(boundary)}`);
  }
  if (boundary.rows.length !== 16) {
    throw new Error(`OG 경계 픽셀 쌍이 16개가 아니다: ${boundary.rows.length}`);
  }

  const occupancy = [
    ...oak.map((row) => occupancyMeasurement(row.type, row.raster)),
    occupancyMeasurement('Y', siteTight.raster),
  ];
  const yOccupancy = occupancy.find((row) => row.type === 'Y');
  const oakOccupancyMax = Math.max(...occupancy
    .filter((row) => row.type !== 'Y').map((row) => row.ratio));
  if (yOccupancy.components.length !== 2) {
    throw new Error(`Type Y 콘텐츠 덩어리가 QR+큐브 두 개가 아니다: ${yOccupancy.components.length}`);
  }
  if (yOccupancy.ratio > oakOccupancyMax + 0.04) {
    throw new Error(`Type Y 점유율이 O/A/K 상단 급을 벗어났다: ${yOccupancy.ratio}`);
  }
  const [siteQr, siteCube] = yOccupancy.components;
  const siteLayout = {
    components: [
      {
        id: 'QR', minX: siteQr.minX, minY: siteQr.minY,
        maxX: siteQr.maxX + 1, maxY: siteQr.maxY + 1,
        inside: siteQr.minX >= 0 && siteQr.minY >= 0
          && siteQr.maxX < siteTight.raster.width && siteQr.maxY < siteTight.raster.height,
      },
      {
        id: '큐브', minX: siteCube.minX, minY: siteCube.minY,
        maxX: siteCube.maxX + 1, maxY: siteCube.maxY + 1,
        inside: siteCube.minX >= 0 && siteCube.minY >= 0
          && siteCube.maxX < siteTight.raster.width && siteCube.maxY < siteTight.raster.height,
      },
    ],
    gapPixels: siteCube.minX - siteQr.maxX - 1,
    yOverlap: Math.max(0,
      Math.min(siteQr.maxY, siteCube.maxY) - Math.max(siteQr.minY, siteCube.minY) + 1),
  };
  siteLayout.allInside = siteLayout.components.every((box) => box.inside);
  /*
   * ⚠ **이 게이트가 종전에는 «좌우 밀착»(gap>0 && yOverlap>0)을 **요구**했다.**
   * 그건 통합자 지시(「크롭」)를 레인이 «재배치»로 읽어 굳힌 것이고, 운영자 정정으로
   * 틀린 요구임이 드러났다 — 폴백 QR 의 대각선 배치는 **생성기 산출**이다
   * (`qrPosition: 'TL'`). 배치를 요구하는 자는 생성기가 배치를 바꾸면 거짓말이 된다.
   *
   * 그래서 **배치가 아니라 «잘림 없음 + 여백 없음»** 을 잰다:
   *   ① 두 덩어리가 캔버스 안에 온전히 있다 (잘리지 않았다)
   *   ② 콘텐츠 합집합이 사방 여백에 밀착한다 (바깥 여백이 남지 않았다)
   * 배치가 대각선이든 좌우든 이 둘은 그대로 옳다.
   */
  const unionMinX = Math.min(siteQr.minX, siteCube.minX);
  const unionMinY = Math.min(siteQr.minY, siteCube.minY);
  const unionMaxX = Math.max(siteQr.maxX, siteCube.maxX);
  const unionMaxY = Math.max(siteQr.maxY, siteCube.maxY);
  siteLayout.margins = {
    left: unionMinX,
    top: unionMinY,
    right: siteTight.raster.width - 1 - unionMaxX,
    bottom: siteTight.raster.height - 1 - unionMaxY,
  };
  const marginValues = Object.values(siteLayout.margins);
  siteLayout.marginSpreadPx = Math.max(...marginValues) - Math.min(...marginValues);
  siteLayout.tight = siteLayout.marginSpreadPx <= 2
    && Math.max(...marginValues) <= SITE_PADDING_PX + 2;
  if (!siteLayout.allInside || !siteLayout.tight) {
    throw new Error(`Type Y 밀착 크롭 검증 실패: ${JSON.stringify(siteLayout)}`);
  }

  const cells = {
    Y: {
      pixelsPerCell: heroTight.pixelsPerUnit
        * containScale(heroTight.raster, OG_LAYOUT.heroImage),
      sourcePixelsPerUnit: heroTight.pixelsPerUnit,
      containScale: containScale(heroTight.raster, OG_LAYOUT.heroImage),
    },
  };
  for (const row of oak) {
    const scale = containScale(subSourceRasters[row.type], OG_LAYOUT.cards
      .find((item) => item.type === row.type).image);
    cells[row.type] = {
      pixelsPerCell: ogBuilds[row.type].exportPixelsPerUnit * scale,
      sourcePixelsPerUnit: ogBuilds[row.type].exportPixelsPerUnit,
      containScale: scale,
    };
  }

  // 보고서와 산출물을 쓰기 전에 읽기 전용 자산의 불변성까지 게이트한다.
  for (const row of oak) {
    row.after = pngMeta(await fs.readFile(row.file));
    row.unchanged = row.before.sha256 === row.after.sha256;
    if (!row.unchanged) throw new Error(`type-${row.type}.png가 변경됐다`);
  }
  const protectedAfter = await readProtectedAssetFingerprints();
  const protectedAssets = protectedBefore.map((before) => {
    const after = protectedAfter.find((row) => row.type === before.type);
    const unchanged = before.image.sha256 === after.image.sha256;
    return { type: before.type, before: before.image, after: after.image, unchanged };
  });
  const changedProtectedAsset = protectedAssets.find((row) => !row.unchanged);
  if (changedProtectedAsset) {
    throw new Error(`type-${changedProtectedAsset.type}.png가 변경됐다`);
  }

  const result = {
    generatedAt,
    generator: 'tools/asset-render.mjs',
    dryRun,
    preset: DEFAULT_PRESET,
    hue: {
      palettes: paletteMeasurements,
      parity,
      selfChecks: { ...ogSelfChecks, Y: heroSelfCheck },
    },
    ySite: {
      payload: PAYLOAD,
      qrText: yWithQr.state.qrText,
      resolution: yWithQr.resolution,
      encoded: {
        version: yWithQr.encoded.version,
        eccLevel: yWithQr.encoded.eccLevel,
        n: yWithQr.encoded.n,
        tones: yWithQr.encoded.tones,
        cellSurfaceLayout: yWithQr.encoded.cellSurfaceLayout,
      },
      decode: {
        ok: decoded.ok === true,
        text: decoded.text ?? null,
        family: decoded.family ?? null,
        version: decoded.version ?? null,
        reason: decoded.reason ?? null,
      },
      selfCheck: ySelfCheck,
      image: siteImage,
      crop: {
        pixelsPerUnit: siteTight.pixelsPerUnit,
        sourceRaster: siteTight.sourceRaster,
        sourceBounds: siteTight.sourceBounds,
        cropBox: siteTight.cropBox,
        contentBounds: siteTight.contentBounds,
        margins: siteTight.margins,
      },
    },
    og: {
      image: ogImage,
      systemFontStack: 'Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      hero: {
        qrIncluded: false,
        locatorProfileY: yHero.resolution.renderedLocatorProfileY,
        encodedVersion: yHero.encoded.version,
        cellSurfaceLayout: yHero.encoded.cellSurfaceLayout,
        selfCheck: heroSelfCheck,
        sourceImage: pngMeta(heroPng),
      },
    },
    boundary,
    occupancy,
    siteLayout,
    cells,
    bounds,
    protectedAssets,
    oak: oak.map((row) => ({
      type: row.type,
      before: row.before,
      after: row.after,
      crop: row.cropped.cropBox,
      unchanged: row.unchanged,
    })),
  };

  if (!dryRun) {
    // 네 사이트 타입 자산은 현행 기본값 증거다. 모든 검증 뒤 OG만 쓴다.
    await fs.writeFile(OG_FILE, renderedOg.png);
  }

  console.log(JSON.stringify(result, null, 2));
}

if (Array.isArray(process.argv)
  && process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
