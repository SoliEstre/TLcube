#!/usr/bin/env node

/**
 * gallery-render.mjs — 레퍼런스 갤러리 조합 순회 렌더 (PM/022 항목 12 · 1차).
 *
 * 조합 축은 손 목록이 아니라 `gallery-axes.mjs` 의 **live 유도**다. 여기서는 그
 * 조합을 encode → buildScene → rasterize → PNG 로 굽고 매니페스트를 남긴다.
 *
 * ─ 인코더/scene 옵션은 생성기 앱 레이어를 **재사용**한다 ───────────────────
 * `sceneOptionsForOA` · `encodeOptionsForY`(src/generator-render-config.js)가
 * 배치 정책(margin 20)·윈도 강제 같은 규칙의 단일 소유자다. 여기서 옵션을 다시
 * 쓰면 «화면과 갤러리가 다른 그림» 이 되고 스캔 표본으로서의 값이 죽는다.
 * 화면(index.html §renderTypeO/A/Y)이 하는 나머지 배선(daehan k 재사상 · Y
 * 로케이터 프로파일 · QR 슬롯 qrText 가드 · 안전영역)도 같은 순서로 따른다.
 *
 * ─ 산출물 ──────────────────────────────────────────────────────────────────
 *   test/output/gallery/refs/<조합id>.png        구운 레퍼런스 (gitignore 구역)
 *   test/output/gallery/manifest.json            조합 표 (갤러리가 fetch)
 *   test/output/gallery/manifest.js              같은 표의 file:// 폴백 (classic script)
 *
 * 사용: node tools/gallery-render.mjs [--output <dir>] [--ppu <n>] [--only <id필터>] [--ecc <L|M|H>]
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hasCenterQrSlot } from '../src/cellSurfaceFinal.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import { daehanPatternId, isDaehanFinderPatternId } from '../src/finder-daehan.js';
import {
  CENTER_QR_FINDER_PATTERN_ID, isCentralV0FinderPatternId,
} from '../src/finder-selection.js';
import { encodeOptionsForY, sceneOptionsForOA } from '../src/generator-render-config.js';
import {
  GENERATOR_STATE_SCHEMA, RESOLUTION_TIER_VERSIONS,
} from '../src/generator-state.js';
import {
  isCellSurfaceLocatorProfileY, LOCATOR_PROFILE_HEX_FRAME_V1,
} from '../src/locatorY.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset, relativeLuminance,
} from '../src/luminance.js';
import { rasterToPng } from '../src/png.js';
import { addQuietZone } from '../src/quietzone.js';
import { resolveQuietZoneChoice } from '../src/quiet-auto.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { DEFAULT_FACE_GAINS, buildSceneY } from '../src/sceneY.js';
import { verifyRaster } from '../src/verify.js';
import { verifyRasterY } from '../src/verifyY.js';
import {
  fallbackForCombo, galleryCombos, gallerySummary,
} from './gallery-axes.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
export const DEFAULT_GALLERY_DIR = path.join(REPO_ROOT, 'test', 'output', 'gallery');

/** 화면 미리보기와 같은 배율 계열 — O/A 12, Y 10 (index.html) 의 1.5× 확대판. */
const PIXELS_PER_UNIT = Object.freeze({ O: 18, A: 18, Y: 15 });
const SUPERSAMPLE = 2;

/** 안전영역 규약 — index.html §withQuietZone 과 같은 상수. */
const QUIET_MARGIN_CELLS = 2;
const QUIET_WHITE = Object.freeze({ r: 255, g: 255, b: 255 });
const QUIET_BLACK = Object.freeze({ r: 0, g: 0, b: 0 });
/** 셀 분리 바닥 — index.html `BG_SEPARATION_MIN`. */
const BG_SEPARATION_MIN = 0.05;

const PRESET_NAME = DEFAULT_PRESET;
const PRESET = getPreset(PRESET_NAME);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const PALETTE_Y = Object.freeze({ ...PALETTE, faceGains: DEFAULT_FACE_GAINS });

/** 코너·중앙 QR 에 싣는 리더 URL — 생성기 기본값 그대로. */
const QR_TEXT = GENERATOR_STATE_SCHEMA.qrText.defaultValue;

/**
 * 표본 자기식별 (PM/022 항목 12 «페이로드에 조합 id»). 용량이 허락하는 가장 긴
 * 형태부터 시도해 내려간다 — 마지막 칸(타입+버전)까지도 **식별자**다. 어느 형태가
 * 실렸는지는 매니페스트에 남는다 (사진에서 되읽을 때의 정본).
 *
 * ⚠ 최저 용량 실측: V1D(daehan k6)는 데이터 15 B — 조합 id 19 B 도 안 들어간다.
 * 그래서 «oak-» 접두를 떤 압축형과 «타입+버전» 두 칸이 더 있다.
 */
export function payloadLadder(combo) {
  const compact = `${combo.type}${combo.version}-${String(combo.axisId).replace(/^oak-/, '')}`;
  // 최저 칸은 **해시 태그**다 — 이름을 더 줄이면 조합끼리 문자열이 같아져
  // (O-V1 의 세 조합이 전부 'O1' 이 됐다 — 1차 실측) 사진에서 «어느 조합인가» 를
  // 못 가른다. 4 hex 는 조합 25개에서 충돌하지 않고, 충돌하면 아래 유일성 단언이
  // 그 자리에서 죽는다.
  const tag = createHash('sha256').update(combo.id).digest('hex').slice(0, 4);
  return [
    `https://tl.estre.so/g/${combo.id}`,
    `tl.estre.so/g/${combo.id}`,
    `g/${combo.id}`,
    combo.id,
    compact,
    `${combo.type}${combo.version}#${tag}`,
    `#${tag}`,
  ];
}

/** eccLevel 'auto' 규약 — H → M → L (index.html §encodeWithEcc). */
const ECC_LADDER = Object.freeze(['H', 'M', 'L']);

/**
 * ECC 가 **바깥 고리**다 — 스캔 A/B 에서 ECC 는 통제해야 할 변수이지 페이로드 길이의
 * 잔돈이 아니다. 강한 레벨을 먼저 고정하고 그 안에서 가장 긴 식별 페이로드를 고른다
 * (반대 순서로 두면 조합마다 ECC 가 L/M/H 로 섞여 A/B 가 오염된다 — 1차 실측).
 * `--ecc <L|M|H>` 로 못 박으면 그 레벨만 시도한다.
 */
function encodeWithLadder(fn, combo, baseOpts, eccPin = null) {
  let lastError = null;
  const levels = eccPin ? [eccPin] : ECC_LADDER;
  for (const eccLevel of levels) {
    for (const text of payloadLadder(combo)) {
      try {
        return { encoded: fn(text, { ...baseOpts, eccLevel }), text, eccLevel };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error('인코딩 사다리가 비었다');
}

/** 안전영역 색 — 규칙 모듈(quiet-auto)에 그대로 물어본다. */
function quietColorFor(type) {
  const separation = (color) => {
    const y = relativeLuminance(color);
    return Math.min(...PALETTE.levels.map((lvl) => Math.abs(relativeLuminance(lvl) - y)));
  };
  const choice = resolveQuietZoneChoice({
    quietMode: GENERATOR_STATE_SCHEMA.quietMode.defaultValue,
    bgMode: GENERATOR_STATE_SCHEMA.bgMode.defaultValue,
    type,
    sepWhite: separation(QUIET_WHITE),
    sepBlack: separation(QUIET_BLACK),
    // 배치 미리보기 사진이 없다 — 규칙상 셀 분리만 본다.
    surfaceLuminance: null,
    separationFloor: BG_SEPARATION_MIN,
  });
  const color = choice.color === 'white' ? QUIET_WHITE
    : choice.color === 'black' ? QUIET_BLACK : null;
  return { choice, color };
}

/** Type O/A 한 조합 — index.html §renderTypeO/renderTypeA 와 같은 순서. */
function renderOA(combo, eccPin) {
  const fallback = fallbackForCombo(combo);
  const centerQr = fallback.mode === 'center';
  const opts = { centerQr, version: combo.version };
  if (isCentralV0FinderPatternId(combo.axisId) && !centerQr) opts.centralV0 = true;
  if (isDaehanFinderPatternId(combo.axisId) && !centerQr) opts.daehanFinder = true;

  const fn = combo.type === 'A' ? encodeA : encode;
  const { encoded, text, eccLevel } = encodeWithLadder(fn, combo, opts, eccPin);

  // daehan 은 «그리는 템플릿의 k 를 버전이 정한다» — 라벨이 프레임과 어긋나지
  // 않도록 화면과 같이 재사상한다 (index.html §renderTypeO).
  const renderedFinderPatternId = encoded.daehanFinder
    ? daehanPatternId(encoded.k)
    : centerQr ? CENTER_QR_FINDER_PATTERN_ID : combo.axisId;
  const sceneOpts = sceneOptionsForOA({
    fallback,
    finderPatternId: renderedFinderPatternId,
    palette: PALETTE,
    qrText: QR_TEXT,
    type: combo.type,
  });
  const scene = buildScene(encoded, sceneOpts);
  return {
    encoded, text, eccLevel, scene, renderedFinderPatternId, fallback,
    verify: (raster) => verifyRaster(raster, scene, encoded),
  };
}

/** Type Y 한 조합 — index.html §renderTypeY 와 같은 순서. */
function renderY(combo, eccPin) {
  const fallback = fallbackForCombo(combo);
  const tierVersion = RESOLUTION_TIER_VERSIONS.Y[combo.tier];
  const opts = encodeOptionsForY({
    tone: GENERATOR_STATE_SCHEMA.tone.defaultValue,
    versionY: tierVersion,
    fallback,
    locatorProfileY: combo.axisId,
  });
  const { encoded, text, eccLevel } = encodeWithLadder(encodeY, combo, opts, eccPin);

  const sceneOpts = { palette: PALETTE_Y };
  if (combo.axisId === LOCATOR_PROFILE_HEX_FRAME_V1
    || isCellSurfaceLocatorProfileY(combo.axisId)) {
    sceneOpts.locatorProfile = combo.axisId;
  }
  if (fallback.mode !== 'off') {
    sceneOpts.qrText = QR_TEXT;
    if (fallback.mode === 'corner') sceneOpts.qrCorner = fallback.corner;
  }
  // QR 슬롯이 레이아웃 정의인 변형은 qrText 가 필수다 (슬롯이 비면 sceneY 가 던진다).
  if (opts.cellSurface === true && hasCenterQrSlot(opts.cellSurfaceLayout)
    && sceneOpts.qrText === undefined) {
    sceneOpts.qrText = QR_TEXT;
  }
  const scene = buildSceneY(encoded, sceneOpts);
  return {
    encoded, text, eccLevel, scene, renderedFinderPatternId: combo.axisId, fallback,
    verify: (raster) => verifyRasterY(raster, scene, encoded),
  };
}

function selfCheckRecord(type, check) {
  const record = { ok: check.ok, total: check.total, mismatches: check.mismatches.length };
  if (type === 'Y') {
    if (Number.isFinite(check.logMargin)) record.logMargin = check.logMargin;
    if (Number.isFinite(check.minDeltaY)) record.minDeltaY = check.minDeltaY;
    if (Array.isArray(check.erasures)) record.erasures = check.erasures.length;
  } else if (Number.isFinite(check.minDelta)) {
    record.minDelta = check.minDelta;
  }
  return record;
}

/** 한 조합을 굽는다. 실패는 던지지 않고 **표에 기록**한다 (부재에도 이유가 필요하다). */
async function bakeCombo(combo, outputDir, pixelsPerUnit, eccPin) {
  const row = {
    ...combo,
    file: null,
    status: 'ok',
  };
  let built;
  try {
    built = combo.type === 'Y' ? renderY(combo, eccPin) : renderOA(combo, eccPin);
  } catch (error) {
    row.status = 'unrenderable';
    row.error = String(error && error.message ? error.message : error);
    return row;
  }

  const { encoded, scene } = built;
  const raster = rasterize(scene, { pixelsPerUnit, supersample: SUPERSAMPLE });
  const check = built.verify(raster);
  row.selfCheck = selfCheckRecord(combo.type, check);
  if (!check.ok) row.status = 'self-check-failed';

  const { choice, color } = quietColorFor(combo.type);
  const quietScene = addQuietZone(scene, {
    color,
    margin: QUIET_MARGIN_CELLS,
    selfQuietColors: [BULLSEYE_LIGHT, BULLSEYE_DARK],
  });
  const outRaster = quietScene === scene
    ? raster
    : rasterize(quietScene, { pixelsPerUnit, supersample: SUPERSAMPLE });
  const png = rasterToPng(outRaster);
  const file = `${combo.id}.png`;
  await fs.writeFile(path.join(outputDir, 'refs', file), png);

  row.file = `refs/${file}`;
  row.payload = built.text;
  row.eccLevel = built.eccLevel;
  row.renderedFinderPatternId = built.renderedFinderPatternId;
  row.fallback = built.fallback;
  row.encoded = {
    version: encoded.version,
    eccLevel: encoded.eccLevel,
    capacityBytes: encoded.capacity ? encoded.capacity.maxPayloadBytes : null,
    ...(encoded.k === undefined ? {} : { k: encoded.k }),
    ...(encoded.n === undefined ? {} : { n: encoded.n }),
    ...(encoded.tones === undefined ? {} : { tones: encoded.tones }),
    ...(encoded.cellSurfaceLayout === undefined
      ? {} : { cellSurfaceLayout: encoded.cellSurfaceLayout }),
    ...(encoded.centerQr ? { centerQr: true } : {}),
    ...(encoded.centralV0 ? { centralV0: true } : {}),
    ...(encoded.daehanFinder ? { daehanFinder: true } : {}),
  };
  row.image = {
    width: outRaster.width,
    height: outRaster.height,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  };
  row.quietZone = { color: choice.color, reason: choice.reason };
  return row;
}

function argValue(args, name, fallback) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  if (!args[at + 1]) throw new RangeError(name + ' 뒤에 값이 필요하다');
  return args[at + 1];
}

export async function renderGallery(options = {}) {
  const outputDir = options.outputDir || DEFAULT_GALLERY_DIR;
  const filter = options.only || null;
  const eccPin = options.eccLevel || null;
  if (eccPin !== null && !ECC_LADDER.includes(eccPin)) {
    throw new RangeError('--ecc 는 ' + ECC_LADDER.join('|') + ' 중 하나여야 한다: ' + eccPin);
  }
  await fs.mkdir(path.join(outputDir, 'refs'), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'captures'), { recursive: true });

  const combos = galleryCombos().filter((c) => filter === null || c.id.includes(filter));
  const rows = [];
  for (const combo of combos) {
    const ppu = options.pixelsPerUnit || PIXELS_PER_UNIT[combo.type] || 12;
    rows.push(await bakeCombo(combo, outputDir, ppu, eccPin));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'tools/gallery-render.mjs',
    purpose: '레퍼런스 갤러리 1차 — 조합 순회 렌더 + 수동 캡처 슬롯 (PM/022 항목 12)',
    preset: PRESET_NAME,
    supersample: SUPERSAMPLE,
    pixelsPerUnit: PIXELS_PER_UNIT,
    qrText: QR_TEXT,
    eccPolicy: eccPin === null ? 'auto(H→M→L, 레벨 고정 후 최장 식별 페이로드)' : ('pinned:' + eccPin),
    axes: gallerySummary(),
    counts: {
      total: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      selfCheckFailed: rows.filter((r) => r.status === 'self-check-failed').length,
      unrenderable: rows.filter((r) => r.status === 'unrenderable').length,
    },
    combos: rows,
  };
  // 표본 자기식별의 **유일성 단언** — 두 조합이 같은 문자열을 실으면 사진에서
  // 되읽어도 어느 조합인지 못 가른다 (그 순간 갤러리는 표본 공급 장치가 아니다).
  const payloads = rows.filter((r) => r.payload).map((r) => r.payload);
  if (new Set(payloads).size !== payloads.length) {
    const dup = payloads.filter((p, i) => payloads.indexOf(p) !== i);
    throw new Error('조합 페이로드가 중복이다: ' + [...new Set(dup)].join(', '));
  }

  const json = JSON.stringify(manifest, null, 2) + '\n';
  await fs.writeFile(path.join(outputDir, 'manifest.json'), json, 'utf8');
  // file:// 폴백 — 브라우저가 로컬 fetch 를 막아도 classic script 는 읽힌다.
  await fs.writeFile(
    path.join(outputDir, 'manifest.js'),
    'window.__TL_GALLERY_MANIFEST__ = ' + json,
    'utf8',
  );
  return manifest;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const args = process.argv.slice(2);
    const outputArg = argValue(args, '--output', null);
    const ppuArg = argValue(args, '--ppu', null);
    const manifest = await renderGallery({
      outputDir: outputArg ? path.resolve(outputArg) : DEFAULT_GALLERY_DIR,
      only: argValue(args, '--only', null),
      pixelsPerUnit: ppuArg ? Number(ppuArg) : null,
      eccLevel: argValue(args, '--ecc', null),
    });
    const { total, ok, selfCheckFailed, unrenderable } = manifest.counts;
    console.log(`갤러리 조합 ${total}개 — ok ${ok} · 자체검증실패 ${selfCheckFailed}`
      + ` · 렌더불가 ${unrenderable}`);
    for (const row of manifest.combos) {
      if (row.status === 'ok') continue;
      console.log(`  ⚠ ${row.id} [${row.status}] ${row.error || JSON.stringify(row.selfCheck)}`);
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
