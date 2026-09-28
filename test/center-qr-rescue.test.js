/**
 * center-qr-rescue.test.js — 중앙 QR 복호 섬의 소생 단계 잠금 (2026-09-28).
 *
 * 중앙 QR 코드가 ppu 격자 중간의 **섬**에서 안 읽혔다(하한이 아니라 산발). 기전 셋 — 전부
 * `src/decoder/bootstrap.js` 「중앙 QR 소생」 머리 주석:
 *   A 순위  — 참 삼중쌍이 종류당 16 상한 밖에서 잘린다(관측 수 가산이 모듈 크기에 비례).
 *   B QR 꺼짐 — 거짓 파인더(중앙 3톤 큐브 · QR 파인더를 읽은 불스아이) 양성이 QR 탐지를 끈다.
 *   C 척도  — 참 삼중쌍으로 포맷 CRC 는 통과하는데 작은 QR 의 ±1.6 % 척도 오차가 k 배로 커져
 *            본문 RS 가 한두 개 넘친다.
 * 처방은 frontend 의 «실패 프레임 소생 전용» 한 단계다(무시드 재시도와 같은 정형).
 *
 * 이 파일이 지키는 성질:
 *   ① 참 삼중쌍은 «주 목록 ∪ 예비» 안에 있다(격자) — 그리고 예비로만 잡히는 점이 격자에 있다
 *      (없으면 이 격자가 예비를 재지 않는 것이다 — 정족수).
 *   ② 섬 왕복 — 기전별 대표점이 기본 decodeFrontend 로 원문을 되읽고, 소생을 끈 대조군은 죽는다
 *      (그래야 이 자가 주 경로가 아니라 소생을 잰다).
 *   ③ 원장은 적기만 한다 — 주 경로 결과가 원장 유무로 한 비트도 안 바뀐다. 성공 프레임은 소생을
 *      안 탄다(소생 끔 대조군과 결과 JSON 동일).
 *   ④ 소생이 실패하면 실패 객체도 그대로다(진단 모양 불변).
 *   ⑤ 오독 게이트 — 본문을 훼손한 중앙 QR 코드는 포맷까지 가서 소생(정련)이 돌아도 오독 0.
 *   ⑥ 소생 예산 — 파인더 같은 것이 없는 실패 프레임에서 예비는 비고(밀도 하한), 우연히 포맷 CRC 를
 *      통과한 가짜 포즈는 정련하지 않는다(시드 구조 점수 문턱). 시간이 아니라 일감으로 잰다.
 *
 * 합성 장면 = 흰 불투명 · margin 20 · bullseye · 링 없음 · ECC M · 화면 면 게인
 * (섬을 처음 잰 합성 조립과 같은 규약).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeK } from '../src/encodeK.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { padRasterToCanvas } from '../src/export-render.js';
import { TL_READER_URL } from '../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { faceGainsForRenderProfile, RENDER_PROFILE_SCREEN } from '../src/render-profile.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  createCenterQrRescueLedger,
  detectQrFinderTriples,
  enumerateGridHypotheses,
  rescueCenterQrGrid,
} from '../src/decoder/bootstrap.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';

const TEXT = 'https://tl.estre.so';
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: { r: 255, g: 255, b: 255 },
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: faceGainsForRenderProfile(RENDER_PROFILE_SCREEN),
});
const CENTER_QR_MODULE_UNITS = 0.2247900722;
const QR_BLOCK_MODULES = 29;

/** 구성 이름 → 인코더 · 장면 옵션. */
const CONFIGS = Object.freeze({
  k2cmc: { encoder: encodeK, enc: { version: 2, cornerMarker: true }, cornerToo: false },
  k2cc: { encoder: encodeK, enc: { version: 2 }, cornerToo: true },
  k2c: { encoder: encodeK, enc: { version: 2 }, cornerToo: false },
  k0cc: { encoder: encodeK, enc: { version: 0 }, cornerToo: true },
  a0cc: { encoder: encodeA, enc: { version: 0 }, cornerToo: true },
  o2c: { encoder: encode, enc: { version: 2 }, cornerToo: false },
  // Type C(노치) — 반경 k 18/20 이라 척도 오차(기전 C)가 가장 크게 증폭되는 구성.
  c2c: { encoder: encode, enc: { version: 2, notchC: true }, cornerToo: false },
  c3c: { encoder: encode, enc: { version: 3, notchC: true }, cornerToo: false },
});

const sceneCache = new Map();
function sceneFor(name) {
  if (!sceneCache.has(name)) {
    const config = CONFIGS[name];
    const encoded = config.encoder(TEXT, { eccLevel: 'M', centerQr: true, ...config.enc });
    sceneCache.set(name, buildScene(encoded, {
      palette: PALETTE,
      finderPatternId: 'bullseye',
      qrText: TL_READER_URL,
      margin: 20,
      centerQr: true,
      cornerToo: config.cornerToo,
    }));
  }
  return sceneCache.get(name);
}

/** 정사각 캔버스 래스터 + 참 중앙 QR(픽셀 좌표 · 모듈 폭). */
function frame(name, ppu) {
  const scene = sceneFor(name);
  const side = Math.ceil(Math.max(scene.width, scene.height) * ppu);
  const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
  const padded = padRasterToCanvas(raster, side, side, scene.background);
  const ox = Math.floor((side - raster.width) / 2);
  const oy = Math.floor((side - raster.height) / 2);
  const blocks = scene.shapes
    .filter((shape) => shape.selfQuiet === true && shape.kind === 'polygon' && shape.points.length === 4)
    .map((shape) => {
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      return {
        cx: (Math.max(...xs) + Math.min(...xs)) / 2,
        cy: (Math.max(...ys) + Math.min(...ys)) / 2,
        module: w / QR_BLOCK_MODULES,
      };
    })
    .sort((a, b) => Math.abs(a.module / CENTER_QR_MODULE_UNITS - 1)
      - Math.abs(b.module / CENTER_QR_MODULE_UNITS - 1));
  const block = blocks[0];
  return {
    raster: padded,
    truth: { x: ox + block.cx * ppu, y: oy + block.cy * ppu, module: block.module * ppu },
  };
}

function isTrueTriple(candidate, truth) {
  return Math.hypot(candidate.center.x - truth.x, candidate.center.y - truth.y) < 2 * truth.module
    && Math.abs(candidate.module / truth.module - 1) < 0.25;
}

const RESCUE_OFF = Object.freeze({ bootstrap: { _centerQrRescue: false } });

test('① A 순위 — 참 삼중쌍은 주 목록 ∪ 예비 안에 있고, 예비로만 잡히는 점이 격자에 있다', () => {
  const grid = [
    ['k2cmc', [14, 16, 18, 20]],
    ['k2cc', [12, 14, 16, 18, 20]],
  ];
  const reserveOnly = [];
  for (const [name, ppus] of grid) {
    for (const ppu of ppus) {
      const { raster, truth } = frame(name, ppu);
      const detected = detectQrFinderTriples(toRelativeLuminance(raster, {}));
      assert.equal(detected.ok, true, `${name}@${ppu}: ${detected.reason}`);
      const inMain = detected.candidates.some((candidate) => isTrueTriple(candidate, truth));
      const inReserve = detected.reserve.some((candidate) => isTrueTriple(candidate, truth));
      assert.ok(inMain || inReserve,
        `${name}@${ppu}: 참 중앙 QR 삼중쌍이 주 목록(${detected.candidates.length})에도 예비(${detected.reserve.length})에도 없다`);
      assert.ok(detected.reserve.every((candidate) => !detected.candidates.includes(candidate)),
        `${name}@${ppu}: 예비는 주 목록과 겹치지 않아야 한다`);
      if (!inMain) reserveOnly.push(`${name}@${ppu}`);
    }
  }
  // 증거 1(k-ppu-floor): K2 CM@16·18 · K2 병행@14·18 이 16 밖이었다. 하나도 없으면 이 격자는 예비를 안 잰다.
  assert.ok(reserveOnly.length >= 2, `예비로만 잡힌 점 ${reserveOnly.length}개 (${reserveOnly.join(' ')}) — 정족수 2`);
});

/*
 * 기전별 대표점 — 0c70b43 · 0c3c679 의 합성 격자에서 기본 복호가 죽던 점.
 * path 는 소생이 실제로 탄 경로(`diagnostics.bootstrap.centerQrRescue.path`)의 허용 집합이다 —
 * 정확한 경로 하나를 박지 않는다(같은 섬을 두 경로가 살릴 수 있다: 순서만 정해져 있다).
 */
const ISLANDS = Object.freeze([
  { name: 'k2cmc', ppu: 16, mechanism: 'A', paths: ['reserve', 'reserve+cq-refine'] },
  { name: 'k2cmc', ppu: 18, mechanism: 'A', paths: ['reserve', 'reserve+cq-refine'] },
  { name: 'k2cc', ppu: 14, mechanism: 'A', paths: ['reserve', 'reserve+cq-refine'] },
  { name: 'k2cc', ppu: 18, mechanism: 'A', paths: ['reserve', 'reserve+cq-refine'] },
  { name: 'k0cc', ppu: 18, mechanism: 'B', paths: ['finder-skipped-qr', 'finder-skipped-qr+cq-refine'] },
  // B 의 앵커 사망 판 — 다운샘플 불스아이가 중앙 QR 을 파인더로 읽고 둘레에 앵커가 없어 가설 0개.
  { name: 'c3c', ppu: 20, mechanism: 'B', paths: ['finder-skipped-qr', 'finder-skipped-qr+cq-refine', 'finder-skipped-qr-reserve'] },
  // C — 참 삼중쌍이 주 목록 안인데 포맷만 통과하고 본문 RS 가 넘친다(구조 정련으로만 산다).
  { name: 'c3c', ppu: 10, mechanism: 'C', paths: ['cq-refine'] },
  { name: 'k2c', ppu: 8, mechanism: 'C', paths: ['cq-refine'] },
  // A+C — 예비로 들어온 참 삼중쌍이 다시 척도에서 걸린다.
  { name: 'c2c', ppu: 10, mechanism: 'A+C', paths: ['reserve+cq-refine'] },
]);

test('② 섬 왕복 — 기전별 대표점이 원문을 되읽고, 소생을 끈 대조군은 죽는다', { timeout: 600_000 }, () => {
  for (const island of ISLANDS) {
    const label = `${island.name}@${island.ppu} (${island.mechanism})`;
    const { raster } = frame(island.name, island.ppu);
    const control = decodeFrontend(raster, RESCUE_OFF);
    assert.equal(control.ok, false, `${label}: 소생 없이도 읽힌다 — 이 점은 더 이상 섬이 아니다(대표점을 다시 골라라)`);
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true, `${label}: ${result.reason} ${JSON.stringify(result.detail?.pipelineCode)}`);
    assert.equal(result.text, TEXT, label);
    const rescue = result.diagnostics.bootstrap.centerQrRescue;
    assert.ok(rescue && island.paths.includes(rescue.path),
      `${label}: 소생 경로 ${rescue && rescue.path} ∉ {${island.paths.join(', ')}}`);
  }
});

test('③ 원장은 적기만 한다 — 주 경로는 원장 유무로 안 바뀌고, 성공 프레임은 소생을 안 탄다', { timeout: 300_000 }, () => {
  const strip = (value) => JSON.parse(JSON.stringify(value));
  for (const [name, ppu] of [['k2c', 20], ['a0cc', 12], ['o2c', 12], ['k2cmc', 20]]) {
    const { raster } = frame(name, ppu);
    const luma = toRelativeLuminance(raster, {});
    const bare = enumerateGridHypotheses(luma, undefined, {});
    const ledger = createCenterQrRescueLedger();
    const recorded = enumerateGridHypotheses(luma, undefined, { _qrRescueLedger: ledger });
    assert.deepEqual(strip(recorded), strip(bare), `${name}@${ppu}: 원장이 주 경로 결과를 바꿨다`);
    const withRescue = decodeFrontend(raster);
    assert.equal(withRescue.ok, true, `${name}@${ppu}: 대조 프레임이 안 읽힌다 — ${withRescue.reason}`);
    assert.equal(withRescue.diagnostics.bootstrap.centerQrRescue, undefined, `${name}@${ppu}: 성공 프레임이 소생을 탔다`);
    assert.deepEqual(strip(withRescue), strip(decodeFrontend(raster, RESCUE_OFF)),
      `${name}@${ppu}: 성공 프레임 결과가 소생 켬/끔에서 다르다`);
  }
});

/** 참 중앙 QR 중심에서 오른쪽으로 `fromCells` 셀 밖의 코드 픽셀을 배경(흰색)으로 지운다 — 본문만 훼손. */
function wipeRightOfCenter(raster, truth, fromCells, ppu) {
  const pixels = new Uint8ClampedArray(raster.pixels);
  const x0 = Math.ceil(truth.x + fromCells * ppu);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = Math.max(0, x0); x < raster.width; x += 1) {
      const o = (y * raster.width + x) * 4;
      pixels[o] = 255; pixels[o + 1] = 255; pixels[o + 2] = 255; pixels[o + 3] = 255;
    }
  }
  return { width: raster.width, height: raster.height, pixels };
}

test('④⑤ 훼손 본문 — 포맷까지 간 중앙 QR 을 소생이 정련해도 오독 0, 실패 객체는 그대로', { timeout: 300_000 }, () => {
  let exercised = 0;
  for (const [name, ppu, fromCells] of [['k2c', 20, 4], ['k2c', 16, 5], ['o2c', 12, 4]]) {
    const label = `${name}@${ppu} 오른쪽 ${fromCells}셀 밖 지움`;
    const { raster, truth } = frame(name, ppu);
    const damaged = wipeRightOfCenter(raster, truth, fromCells, ppu);
    const luma = toRelativeLuminance(damaged, {});
    const ledger = createCenterQrRescueLedger();
    const main = enumerateGridHypotheses(luma, undefined, { _qrRescueLedger: ledger });
    assert.equal(main.ok, false, `${label}: 훼손이 모자라 주 경로가 읽는다 — 자를 다시 세워라`);
    const rescue = rescueCenterQrGrid(luma, { _qrRescueLedger: ledger }, { reason: main.reason });
    assert.ok(rescue === null || rescue.ok === false,
      `${label}: 훼손 본문을 소생이 «읽었다» — ${rescue && rescue.ok && JSON.stringify(rescue.diagnostics.centerQrRescue)}`);
    if (ledger.formatPassed.length > 0 && rescue && rescue.attempts.some((a) => a.path === 'cq-refine')) exercised += 1;
    const result = decodeFrontend(damaged);
    assert.ok(!(result.ok === true && result.text !== TEXT), `${label}: 오독 — ${result.text}`);
    assert.equal(result.ok, false, `${label}: 훼손 본문이 읽혔다`);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), JSON.parse(JSON.stringify(decodeFrontend(damaged, RESCUE_OFF))),
      `${label}: 소생이 실패 객체를 바꿨다`);
  }
  // 정련 경로(포맷 통과 → 구조 정련 → 재검증)가 실제로 돈 프레임이 없으면 ⑤ 는 게이트를 안 잰 것이다.
  assert.ok(exercised >= 1, `정련이 돈 훼손 프레임 ${exercised}개 — 정족수 1`);
});

/** 결정적 질감 — 크기 3\~26 px 사각 2500 개(세 톤). 파인더 비슷한 클러스터와 우연한 포맷 통과를 만든다. */
function textureFrame(seed, width = 720, height = 960) {
  let a = seed | 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let n = 0; n < 2500; n += 1) {
    const s = 3 + Math.floor(rnd() * 24);
    const x0 = Math.floor(rnd() * (width - s));
    const y0 = Math.floor(rnd() * (height - s));
    const v = rnd() < 0.5 ? 20 : rnd() < 0.5 ? 120 : 235;
    for (let y = y0; y < y0 + s; y += 1) {
      for (let x = x0; x < x0 + s; x += 1) {
        const o = (y * width + x) * 4;
        pixels[o] = v; pixels[o + 1] = v; pixels[o + 2] = v;
      }
    }
  }
  return { width, height, pixels };
}

test('⑥ 소생 예산 — 파인더 없는 실패 프레임에서 예비는 비고, 우연한 포맷 통과는 정련하지 않는다', { timeout: 300_000 }, () => {
  // 시간이 아니라 «일감» 을 잰다: 두 문턱(예비 밀도 하한 · 정련 시드 문턱)이 빠지면 실패 프레임마다 가설
  // 수십\~수백 개 검증 · 정련 \~0.3 s 가 조용히 붙는다 — 다른 자는 초록인 채로(bootstrap QR_RESERVE · 정련 예산 주석).
  let truncated = 0;
  let chanceFormatPass = 0;
  for (const seed of [1, 2, 3]) {
    const luma = toRelativeLuminance(textureFrame(seed), {});
    const ledger = createCenterQrRescueLedger();
    const main = enumerateGridHypotheses(luma, undefined, { _qrRescueLedger: ledger });
    assert.equal(main.ok, false, `질감 ${seed}: 읽혔다 — ${main.ok && JSON.stringify(main.candidates?.[0]?.text)}`);
    assert.equal(ledger.qrProbed, true, `질감 ${seed}: QR 탐지가 안 돌아 이 자가 예비를 못 잰다`);
    if (ledger.qr.candidates.filter((c) => c.kind === 'center').length >= 16) truncated += 1;
    assert.deepEqual(ledger.qr.reserve, [], `질감 ${seed}: 밀도 하한 아래 후보가 예비에 들었다`);
    const unlimited = detectQrFinderTriples(luma, { reserveCandidates: 100 });
    assert.deepEqual(unlimited.reserve, [], `질감 ${seed}: 예비 개수를 풀어도 하한을 넘는 후보가 없어야 한다`);
    chanceFormatPass += ledger.formatPassed.length;
    const rescue = rescueCenterQrGrid(luma, { _qrRescueLedger: ledger }, { reason: main.reason });
    assert.equal(rescue, null, `질감 ${seed}: 소생이 일을 했다 — ${JSON.stringify(rescue && rescue.attempts)}`);
  }
  assert.ok(truncated >= 2, `QR 목록이 잘린 질감 ${truncated}개 — 예비 문턱을 재려면 절단이 있어야 한다`);
  assert.ok(chanceFormatPass >= 1, `우연한 포맷 통과 ${chanceFormatPass}건 — 정련 문턱을 재려면 하나는 있어야 한다`);
});
