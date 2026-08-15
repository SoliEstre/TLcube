/**
 * claude-finish-clip-harness.mjs — 합성 «잘림(clipping)» 하네스 + 전후 벤치.
 *
 * 잘림 모델: 렌더한 코드를 960² 프레임 안에서 (dx, dy) 만큼 **평행이동** 시켜
 * 코드의 한 코너/한 변이 캔버스 밖으로 나가게 한다. 캔버스 밖 픽셀은 소멸한다
 * (프레임 밖 = 관측 없음). 회전·원근을 섞지 않아 손실량이 해석적으로 계산된다.
 *
 * 자 검증 (ruler): 요청한 잘림 비율 f 가 실제로 얼마나 잘렸는지를 **픽셀에서**
 * 다시 잰다.
 *   ① 잉크 bbox 를 원본 픽셀에서 직접 찾는다 (배경색과 다른 픽셀의 최소 사각형).
 *   ② 해석적 손실 면적 = bboxArea − (평행이동된 bbox ∩ 캔버스) 면적.
 *   ③ bbox 픽셀을 하나씩 창에 넣어 보며 밖으로 나간 것을 센다.
 *   ④ 잘려 나간 bbox 열/행 수가 round(f · bboxW) 와 ±1 px 안에서 일치하는지.
 *
 * **[r2 정정] 독립 경로는 ②③④ 셋이 아니라 ①④ 둘이다.** ②와 ③은 축정렬 사각형
 * 두 개에서 **항등**이다 — ③이 세는 «box 픽셀 중 창 밖» 은 정의상
 * boxArea − |box ∩ win| 이고, 축정렬이므로 |box ∩ win| = keptW·keptH 라
 * ②와 글자 그대로 같은 값이다. 무작위 사각형쌍 200,000 브루트포스에서 반례 0.
 * 즉 `areaAgrees` 는 **거짓이 될 수 없는 게이트**이므로 검증 실적으로 세면 안 된다
 * (교훈: «재는 대상이 그것인가»). 실제로 판별력이 있는 것은 픽셀에서 뽑은 ①과,
 * 요청값과 대조하는 ④, 그리고 별도 보고되는 **잉크 손실 열**뿐이다.
 * ②③ 는 회귀 감시용 항등 확인으로 남긴다 — 통과했다고 «자가 맞다» 의 근거가 되지 않는다.
 *
 * 전후: «before» 는 `_baseline/src` (git HEAD 원본 트리를 그대로 풀어 놓은 것),
 * «after» 는 현재 `src`. 두 팔이 같은 프레임 픽셀을 받는다.
 *
 * 사용:
 *   node claude-finish-clip-harness.mjs ruler     — 자 검증만
 *   node claude-finish-clip-harness.mjs main      — 전후 표 (JSON 저장)
 *   node claude-finish-clip-harness.mjs corner    — 코너 1개 완전 소실 집중 측정
 *   node claude-finish-clip-harness.mjs report    — 저장된 JSON → MD 표
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { applySCurve, applyGamma } from '../../harness/distort.mjs';

import { decodeFrontend as decodeAfter } from '../../../src/decoder/frontend.js';
import { decodeFrontend as decodeBefore } from './_baseline/src/decoder/frontend.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, 'claude-finish-clip-results.json');

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';
const CANVAS = 1280;

const TARGETS = [
  { id: 'v0@13', layout: 'v0', version: 0, ppu: 17 },
  { id: 'v0X@21', layout: 'v0x', version: 1, ppu: 15 },
  { id: 'v1r2@21', layout: 'v1r2', version: 1, ppu: 15 },
  { id: 'v2r2@21', layout: 'v2r2', version: 1, ppu: 15 },
];
const TONES = [
  ['none', (frame) => frame],
  ['sCurve0.6', (frame) => applySCurve(frame, 0.6)],
  ['gamma0.7', (frame) => applyGamma(frame, 0.7)],
];
/**
 * 잘림 5수준 — 축을 분리해서 잰다.
 *  `full`  : 정상 quiet zone (대조군)
 *  `qz`    : **코드 손실 0**, 창이 코드 경계에 딱 붙어 quiet zone 만 사라진 상태
 *  0.05~0.20 : 코드 자체가 그 비율만큼 창 밖
 * `qz` 가 없으면 «잘림 때문에 실패» 와 «quiet zone 이 없어서 실패» 가 섞인다 —
 * 첫 측정에서 실제로 섞여 있었고(5% 에서 이미 0/9), 그 혼동이 이 rung 을 낳았다.
 */
const LEVELS = ['full', 'qz', 0.05, 0.10, 0.15, 0.20];
/** 방향: 코너 1개 · 변 1개. SE 의존 가설을 보려고 반대 코너도 넣는다. */
const MODES = ['corner-se', 'corner-nw', 'edge-right'];

// ---- 렌더 ------------------------------------------------------------------

function renderBase(target) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: target.layout, version: target.version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return rasterize(scene, { pixelsPerUnit: target.ppu, supersample: 2 });
}

function embed(raster) {
  if (raster.width > CANVAS || raster.height > CANVAS) {
    throw new Error('raster ' + raster.width + 'x' + raster.height + ' 가 캔버스를 넘는다');
  }
  const out = {
    width: CANVAS, height: CANVAS, pixels: new Uint8ClampedArray(CANVAS * CANVAS * 4),
  };
  for (let index = 0; index < CANVAS * CANVAS; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((CANVAS - raster.width) / 2);
  const oy = Math.floor((CANVAS - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * CANVAS + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

const INK_THRESHOLD = 12;

function isInk(pixels, index) {
  return Math.abs(pixels[index] - FILL.r) > INK_THRESHOLD
    || Math.abs(pixels[index + 1] - FILL.g) > INK_THRESHOLD
    || Math.abs(pixels[index + 2] - FILL.b) > INK_THRESHOLD;
}

/** 배경과 다른 픽셀의 최소 사각형 — 코드가 실제로 차지한 영역. */
function inkBox(frame) {
  let minX = frame.width;
  let minY = frame.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (!isInk(frame.pixels, (y * frame.width + x) * 4)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('잉크가 하나도 없다 — 렌더가 비었다');
  return { x0: minX, y0: minY, x1: maxX, y1: maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 카메라 «창» — 출력 프레임이 원본 장면의 어느 사각형인지. 창 밖은 관측이 없다
 * (배경으로 메우지 않는다 — 배경으로 메우면 «여기서 코드가 끝난다» 는 거짓
 * 정보를 주게 되고, 그건 잘림이 아니라 지우개다).
 *
 * 잘림 수준 f 는 창의 한 변을 코드 bbox 의 f 배만큼 안쪽으로 당긴다.
 */
const QUIET_PAD = 40;

/**
 * 창 «크기» 는 전 수준에서 고정이다 (box + 2·pad). 크기를 바꾸면 프런트엔드의
 * 프레임 크기 의존성(다운샘플 계수 등)이 잘림 축에 섞여 들어온다 — 첫 판에서
 * 실제로 섞였다: 코드 손실 0 인 창에서도 v0@13 이 죽었는데, 원인은 잘림이 아니라
 * 창 크기였다. 그래서 창은 «미끄러지기만» 하고 크기는 고정한다.
 *
 * bite = 창의 한 변이 코드 경계 **안쪽으로** 파고든 픽셀 수.
 *   full → bite = −pad (정상 quiet zone) · qz → bite = 0 · f → bite = round(f·변)
 */
function biteFor(level, span) {
  if (level === 'full') return -QUIET_PAD;
  if (level === 'qz') return 0;
  return Math.round(level * span);
}

function windowFor(box, mode, level) {
  const winW = box.w + 2 * QUIET_PAD;
  const winH = box.h + 2 * QUIET_PAD;
  const biteX = biteFor(level, box.w);
  const biteY = biteFor(level, box.h);
  let x1 = box.x1 + QUIET_PAD;
  let y1 = box.y1 + QUIET_PAD;
  if (mode === 'corner-se') {
    x1 = box.x1 - biteX;
    y1 = box.y1 - biteY;
  } else if (mode === 'corner-nw') {
    // 창의 좌·상 변이 코드 안쪽으로 biteX/biteY 파고든다 → 좌상 코너가 창 밖.
    x1 = box.x0 + biteX + winW - 1;
    y1 = box.y0 + biteY + winH - 1;
  } else if (mode === 'edge-right') {
    x1 = box.x1 - biteX;
  } else if (mode === 'none') {
    x1 = box.x1 + QUIET_PAD;
    y1 = box.y1 + QUIET_PAD;
  } else {
    throw new Error('알 수 없는 mode: ' + mode);
  }
  const x0 = x1 - winW + 1;
  const y0 = y1 - winH + 1;
  return { x0, y0, x1, y1, w: winW, h: winH };
}

function crop(frame, win) {
  if (win.x0 < 0 || win.y0 < 0 || win.x1 >= frame.width || win.y1 >= frame.height) {
    throw new Error('창이 원본 캔버스를 벗어난다 — quiet pad 를 줄이거나 캔버스를 키워라');
  }
  const out = {
    width: win.w, height: win.h, pixels: new Uint8ClampedArray(win.w * win.h * 4),
  };
  for (let y = 0; y < win.h; y += 1) {
    for (let x = 0; x < win.w; x += 1) {
      const s = ((y + win.y0) * frame.width + (x + win.x0)) * 4;
      const d = (y * win.w + x) * 4;
      out.pixels[d] = frame.pixels[s];
      out.pixels[d + 1] = frame.pixels[s + 1];
      out.pixels[d + 2] = frame.pixels[s + 2];
      out.pixels[d + 3] = frame.pixels[s + 3];
    }
  }
  return out;
}

// ---- 자 검증 ---------------------------------------------------------------

function ruler(frame, box, win) {
  // ② 해석: bbox 와 창의 교집합.
  const ix0 = Math.max(box.x0, win.x0);
  const iy0 = Math.max(box.y0, win.y0);
  const ix1 = Math.min(box.x1, win.x1);
  const iy1 = Math.min(box.y1, win.y1);
  const keptW = Math.max(0, ix1 - ix0 + 1);
  const keptH = Math.max(0, iy1 - iy0 + 1);
  const analyticLost = box.w * box.h - keptW * keptH;

  // ③ bbox 픽셀을 하나씩 창에 넣어 보며 밖으로 나간 것을 센다.
  // [r2 정정] «독립» 계수가 아니다 — 축정렬에서 ②와 항등이다. 아래 inkLost 는
  // 진짜 독립 수치지만 boxPixelsLost 는 ②의 다른 표기일 뿐이다.
  let inkTotal = 0;
  let inkLost = 0;
  let boxPixelsLost = 0;
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const outside = x < win.x0 || x > win.x1 || y < win.y0 || y > win.y1;
      if (outside) boxPixelsLost += 1;
      if (isInk(frame.pixels, (y * frame.width + x) * 4)) {
        inkTotal += 1;
        if (outside) inkLost += 1;
      }
    }
  }

  return {
    analyticLostArea: analyticLost,
    countedLostArea: boxPixelsLost,
    // 항등 확인 — 거짓이 될 수 없다. 검증 실적으로 세지 말 것 ([r2 정정]).
    areaAgrees: analyticLost === boxPixelsLost,
    lostColumns: box.w - keptW,
    lostRows: box.h - keptH,
    inkTotal,
    inkLost,
    inkLostFraction: inkTotal === 0 ? 0 : inkLost / inkTotal,
    geometricLostFraction: (box.w * box.h) === 0 ? 0 : analyticLost / (box.w * box.h),
  };
}

// ---- 복호 ------------------------------------------------------------------

function decodeWith(decode, frame) {
  try {
    return decode({ width: frame.width, height: frame.height, pixels: frame.pixels }, {
      bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
    });
  } catch (error) {
    return { ok: false, reason: 'throw:' + (error && error.message) };
  }
}

function outcome(result) {
  if (result && result.ok === true && result.text === PAYLOAD) return 'ok';
  if (result && result.ok === true) return 'wrong-text';
  return 'fail';
}

// ---- 실행 ------------------------------------------------------------------

function buildFrames() {
  const frames = [];
  for (const target of TARGETS) {
    const base = embed(renderBase(target));
    const box = inkBox(base);
    for (const level of LEVELS) {
      const modes = level === 'full' ? ['none'] : MODES;
      for (const mode of modes) {
        const win = windowFor(box, mode, level);
        const clipped = crop(base, win);
        const measured = ruler(base, box, win);
        for (const [toneName, apply] of TONES) {
          frames.push({
            target: target.id,
            level,
            mode,
            tone: toneName,
            window: win.w + 'x' + win.h,
            ruler: measured,
            frame: apply(clipped),
          });
        }
      }
    }
  }
  return frames;
}

function runRuler() {
  const rows = [];
  let bad = 0;
  for (const target of TARGETS) {
    const base = embed(renderBase(target));
    const box = inkBox(base);
    for (const level of LEVELS) {
      const modes = level === 'full' ? ['none'] : MODES;
      for (const mode of modes) {
        const win = windowFor(box, mode, level);
        const measured = ruler(base, box, win);
        const expectedColumns = mode === 'none' ? 0 : Math.max(0, biteFor(level, box.w));
        const expectedRows = mode === 'edge-right' || mode === 'none'
          ? 0 : Math.max(0, biteFor(level, box.h));
        const okColumns = Math.abs(measured.lostColumns - expectedColumns) <= 1;
        const okRows = Math.abs(measured.lostRows - expectedRows) <= 1;
        if (!measured.areaAgrees || !okColumns || !okRows) bad += 1;
        rows.push({
          target: target.id,
          box: box.w + 'x' + box.h,
          level,
          mode,
          window: win.w + 'x' + win.h,
          lostColRow: measured.lostColumns + '/' + measured.lostRows,
          expectColRow: expectedColumns + '/' + expectedRows,
          areaAnalytic: measured.analyticLostArea,
          areaCounted: measured.countedLostArea,
          inkLostPct: (measured.inkLostFraction * 100).toFixed(2),
          geomLostPct: (measured.geometricLostFraction * 100).toFixed(2),
          verdict: (measured.areaAgrees && okColumns && okRows) ? 'OK' : 'MISMATCH',
        });
      }
    }
  }
  console.table(rows);
  // [r2 정정] «3경로 전부 일치» 는 과장이었다. ②(해석 면적)과 ③(계수 면적)은
  // 축정렬 사각형에서 항등이라 areaAgrees 는 실패할 수 없다. 판별력이 있는 것은
  // ①(픽셀에서 뽑은 bbox)와 ④(요청 대조) 두 경로뿐이다.
  console.log(bad === 0
    ? '자 검증 통과 — 독립 2경로(① 픽셀 bbox · ④ 요청 대조) 일치. '
      + '②≡③ 는 항등이라 판별력 없음(회귀 감시용)'
    : ('자 검증 실패 ' + bad + '건'));
  return bad === 0;
}

function runMain() {
  const frames = buildFrames();
  const results = [];
  let index = 0;
  for (const item of frames) {
    index += 1;
    const before = decodeWith(decodeBefore, item.frame);
    const after = decodeWith(decodeAfter, item.frame);
    results.push({
      target: item.target,
      level: item.level,
      mode: item.mode,
      tone: item.tone,
      inkLostPct: Number((item.ruler.inkLostFraction * 100).toFixed(3)),
      geomLostPct: Number((item.ruler.geometricLostFraction * 100).toFixed(3)),
      before: outcome(before),
      after: outcome(after),
      beforeReason: before.ok ? null : (before.reason || null),
      afterReason: after.ok ? null : (after.reason || null),
      afterLayout: after.ok ? after.hypothesis.cellSurfaceLayout : null,
      beforeLayout: before.ok ? before.hypothesis.cellSurfaceLayout : null,
      afterCrs: after.ok ? after.crsDistance : null,
      afterErasure: after.ok && after.diagnostics && after.diagnostics.erasureFallback
        ? after.diagnostics.erasureFallback.erasureSymbolIndices.length : 0,
    });
    if (index % 10 === 0) console.error('  ... ' + index + '/' + frames.length);
  }
  writeFileSync(RESULTS_PATH, JSON.stringify({ generatedAt: Date.now(), results }, null, 2));
  console.log('저장: ' + RESULTS_PATH + ' (' + results.length + '행)');
  report(results);
}

const LEVEL_ORDER = ['full', 'qz', 0.05, 0.1, 0.15, 0.2];

function labelOf(level) {
  if (level === 'full') return 'quiet zone 정상';
  if (level === 'qz') return 'quiet zone 0 (코드 손실 0)';
  return (level * 100).toFixed(0) + '%';
}

function report(rows) {
  const byTarget = new Map();
  for (const row of rows) {
    if (!byTarget.has(row.target)) byTarget.set(row.target, new Map());
    const levels = byTarget.get(row.target);
    const key = row.level;
    if (!levels.has(key)) levels.set(key, { total: 0, before: 0, after: 0 });
    const bucket = levels.get(key);
    bucket.total += 1;
    if (row.before === 'ok') bucket.before += 1;
    if (row.after === 'ok') bucket.after += 1;
  }
  console.log('\n| 타깃 | 잘림 | before | after |');
  console.log('|---|---|---|---|');
  for (const [target, levels] of byTarget) {
    for (const [level, bucket] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
      console.log('| ' + target + ' | ' + labelOf(level) + ' | '
        + bucket.before + '/' + bucket.total + ' | ' + bucket.after + '/' + bucket.total + ' |');
    }
  }

  const wrong = rows.filter((row) => row.after === 'wrong-text');
  console.log('\n오수용(after, 다른 텍스트): ' + wrong.length);
  const cross = rows.filter((row) => row.after === 'ok'
    && row.afterLayout !== null
    && !row.target.toLowerCase().startsWith(String(row.afterLayout).toLowerCase()));
  console.log('교차 레이아웃 선택(after): ' + cross.length
    + (cross.length ? ' → ' + JSON.stringify(cross.slice(0, 5)) : ''));

  const gained = rows.filter((row) => row.before !== 'ok' && row.after === 'ok');
  const lost = rows.filter((row) => row.before === 'ok' && row.after !== 'ok');
  console.log('구제(before 실패 → after 성공): ' + gained.length);
  console.log('퇴행(before 성공 → after 실패): ' + lost.length
    + (lost.length ? ' → ' + JSON.stringify(lost.slice(0, 8)) : ''));
}

const mode = process.argv[2] || 'ruler';
if (mode === 'ruler') {
  process.exitCode = runRuler() ? 0 : 1;
} else if (mode === 'main') {
  runMain();
} else if (mode === 'report') {
  if (!existsSync(RESULTS_PATH)) throw new Error('결과 JSON 이 없다 — main 먼저');
  report(JSON.parse(readFileSync(RESULTS_PATH, 'utf8')).results);
} else {
  throw new Error('알 수 없는 모드: ' + mode);
}
