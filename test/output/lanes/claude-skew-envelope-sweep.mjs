/**
 * claude-skew-envelope-sweep.mjs — skew·광각 왜곡 트랙 1단계: 현행 실패 봉투 측정.
 *
 * src 무수정 · 공개 API 만 사용 · 결정적(RNG 없음). 개선 구현 없음 — 측정 전용.
 *
 * 모드:
 *   node claude-skew-envelope-sweep.mjs smoke    — 왕복·타이밍·실패 진단 구조 확인
 *   node claude-skew-envelope-sweep.mjs main     — 본 스윕 (결과 JSON append)
 *   node claude-skew-envelope-sweep.mjs refine   — 붕괴 문턱 주변 2.5° 촘촘 측정
 *   node claude-skew-envelope-sweep.mjs extend   — k1 상한 연장 (0.2/0.3/0.4, θ=0)
 *   node claude-skew-envelope-sweep.mjs report   — 결과 집계 표 출력 (MD)
 *
 * 왜곡 규약: cameraTilt(distanceRatio 4 고정) → barrel(반대각 정규화) → S-커브 0.6.
 * 성공 = decodeFrontend ok && text 일치 (body RS 복호).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { applySCurve, barrelDistortImage, cameraTiltImage } from '../../harness/distort.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, 'claude-skew-envelope-results.json');

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
const MARGIN = 20;
const S_CURVE_AMOUNT = 0.6;
const AXES = Object.freeze(['horizontal', 'vertical', 'diagonal']);
const THETAS = Object.freeze([0, 10, 15, 20, 25, 30, 40]);
const K1S = Object.freeze([0, 0.05, 0.1, 0.15]);
const TONES_MODES = Object.freeze(['none', 's0.6']);

/**
 * 스윕 계획 — 조합 폭발 관리 (silent cap 금지, 여기 명시가 정본):
 *  - v0@13 (주): tones {2,3} × cell_px {15,10} × 전 축·θ·k1·톤 격자. θ=0 은 축 무의미
 *    → horizontal 만 측정하고 vertical/diagonal 은 «동일값 생략» 으로 기록.
 *  - v1r2@21 · v2r2@21 (부): tones {2} × cell_px {15} 만. θ {0,15,25,30,40} ·
 *    k1 {0,0.1,0.15} · 톤 {none,s0.6} · 축 {horizontal,diagonal} 부분격자.
 *    뺀 것: 3톤 전부 · cell_px 10 · θ {10,20} · k1 0.05 · 축 vertical —
 *    비용 사유(프레임당 0.3~3s), 주 레이아웃 v0 가 전 격자를 덮는다.
 *  - refine 모드가 v0 의 각 (tones,ppu,axis,k1,tone) 레인에서 마지막 통과 θ 와
 *    첫 실패 θ 사이를 2.5° 간격으로 채운다 (경계 촘촘 요건).
 */
const PLANS = [
  {
    id: 'v0', layout: 'v0', version: 0, n: 13,
    tones: [2, 3], ppus: [15, 10], axes: AXES, thetas: THETAS, k1s: K1S, toneModes: TONES_MODES,
  },
  {
    id: 'v2r2', layout: 'v2r2', version: 1, n: 21,
    tones: [2], ppus: [15], axes: ['horizontal', 'diagonal'],
    thetas: [0, 15, 25, 30, 40], k1s: [0, 0.1, 0.15], toneModes: TONES_MODES,
  },
  {
    id: 'v1r2', layout: 'v1r2', version: 1, n: 21,
    tones: [2], ppus: [15], axes: ['horizontal', 'diagonal'],
    thetas: [0, 15, 25, 30, 40], k1s: [0, 0.1, 0.15], toneModes: TONES_MODES,
  },
];

// ---- 렌더·왜곡·복호 -------------------------------------------------------------

const rasterCache = new Map();

function baseRaster(layout, version, tones, ppu) {
  const key = layout + '/' + tones + '/' + ppu;
  if (!rasterCache.has(key)) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
    });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: MARGIN });
    rasterCache.set(key, rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
  }
  return rasterCache.get(key);
}

function distortFrame(raster, { theta, axis, k1, toneMode }) {
  let frame = raster;
  if (theta !== 0) frame = cameraTiltImage(frame, theta, { axis, fill: FILL });
  if (k1 !== 0) frame = barrelDistortImage(frame, { k1, fill: FILL });
  if (toneMode === 's0.6') frame = applySCurve(frame, S_CURVE_AMOUNT);
  return frame;
}

function decodeLab(raster) {
  return decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
  });
}

// ---- 실패 결정 단계 귀속 ---------------------------------------------------------

/** 중첩 진단에서 첫 번째로 나오는 key 값을 DFS 로 찾는다 (구조 방어). */
function findKey(root, key, depth = 8) {
  const stack = [[root, 0]];
  const seen = new Set();
  while (stack.length > 0) {
    const [node, level] = stack.pop();
    if (node === null || typeof node !== 'object' || level > depth || seen.has(node)) continue;
    seen.add(node);
    if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, key)) return node[key];
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) stack.push([child, level + 1]);
  }
  return undefined;
}

/**
 * 결정 단계 귀속. 브리프의 4단계 + 그 밖:
 *   silhouette-hull  — 실루엣 경로가 육각을 못 세움 (hull/component 단계)
 *   locator-anchor   — CS 블록 로케이터 앵커 미검출 (pose 0)
 *   geometry-none    — 두 경로 다 기하 생성 실패 (CS 평가 미도달) — 위 둘의 합류
 *   cs-agreement     — CS 평가 도달했으나 게이트 거절 (agreement·orientation 등)
 *   format-read      — 기하 수용 후 포맷 15셀 읽기 실패
 *   body-rs          — 기하·포맷 수용 후 본문 RS 실패
 *   기타             — payload 검증·선택 모호 등 (드묾)
 * 분류 불가 시 «불명» 으로 남긴다.
 */
function classify(result) {
  if (result.ok === true) return { stage: 'ok', sub: null };
  const detail = result.detail || {};
  const code = detail.pipelineCode || null;
  if (code === 'BODY_RS_FAILED') return { stage: 'body-rs', sub: firstBodyReason(detail) };
  if (code === 'NO_FORMAT_CANDIDATE') return { stage: 'format-read', sub: null };
  if (code === 'PAYLOAD_VALIDATION_FAILED') return { stage: 'payload', sub: firstBodyReason(detail) };
  if (code === 'CUBE_DIRECTION_AMBIGUOUS') return { stage: 'selection-ambiguous', sub: null };

  const probe = findKey(detail, 'cellSurfaceProbe');
  const reports = findKey(detail, 'geometryReports');
  const locator = findKey(detail, 'csBlockLocator');
  const geometryStage = findKey(detail, 'geometryStage');
  const attempted = Array.isArray(reports)
    ? reports.filter((entry) => entry && entry.attempted === true)
    : [];

  if (attempted.length > 0) {
    // CS 평가에 도달했으나 아무도 수용되지 않음 — 게이트 거절 사유 집계.
    const reasons = {};
    for (const entry of attempted) {
      if (entry.accepted === true) continue;
      const reason = entry.reason || 'rejected';
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
    return {
      stage: 'cs-agreement',
      sub: top ? top[0] : 'accepted-but-lost',
      probe: probe && { accepted: probe.accepted, score: probe.score, reason: probe.reason },
      locator: locatorSummary(locator),
    };
  }

  // CS 평가 미도달 — 어느 기하 경로가 막혔는가.
  const locatorInfo = locatorSummary(locator);
  const silhouetteBlocked = geometryStage === 'silhouette' || geometryStage === 'component'
    || geometryStage === undefined || geometryStage === null;
  if (locatorInfo && locatorInfo.shapeCount === 0) {
    const sub = locatorInfo.verifiedCount === 0 ? 'no-anchor' : 'pose-assembly';
    return {
      stage: silhouetteBlocked ? 'geometry-none' : 'locator-anchor',
      sub: 'locator:' + sub + '+silhouette:' + String(geometryStage),
      locator: locatorInfo,
    };
  }
  if (locatorInfo && locatorInfo.shapeCount > 0) {
    // 로케이터가 shape 는 냈는데 CS 평가 기록이 없다 — 예상 밖 경로.
    return { stage: '불명', sub: 'locator-shapes-without-cs-eval', locator: locatorInfo };
  }
  return { stage: '불명', sub: 'no-diagnostics(stage=' + String(detail.stage) + ')' };
}

function locatorSummary(locator) {
  if (!locator || typeof locator !== 'object') return null;
  const poses = locator.poseCount || {};
  return {
    verifiedCount: Array.isArray(locator.verified) ? locator.verified.length : 0,
    poseCount: { v2r2: poses.v2r2 || 0, v1r2: poses.v1r2 || 0, v0: poses.v0 || 0 },
    shapeCount: locator.shapeCount || 0,
  };
}

function firstBodyReason(detail) {
  const failures = findKey(detail, 'bodyFailures');
  if (Array.isArray(failures) && failures.length > 0) return failures[0].reason || null;
  return null;
}

// ---- 실행·기록 ------------------------------------------------------------------

function loadResults() {
  if (!existsSync(RESULTS_PATH)) return [];
  return JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
}

function saveResults(rows) {
  writeFileSync(RESULTS_PATH, JSON.stringify(rows));
}

function conditionKey(row) {
  return [row.layout, row.tones, row.ppu, row.axis, row.theta, row.k1, row.toneMode].join('|');
}

function runCondition(rows, done, plan, tones, ppu, axis, theta, k1, toneMode, suite) {
  const row = {
    suite,
    layout: plan.layout,
    tones,
    ppu,
    axis,
    theta,
    k1,
    toneMode,
  };
  if (done.has(conditionKey(row))) return null;
  const raster = baseRaster(plan.layout, plan.version, tones, ppu);
  const frame = distortFrame(raster, { theta, axis, k1, toneMode });
  const start = process.hrtime.bigint();
  const result = decodeLab(frame);
  row.ms = Number(process.hrtime.bigint() - start) / 1e6;
  row.ok = result.ok === true && result.text === PAYLOAD;
  if (result.ok === true && result.text !== PAYLOAD) row.wrongText = true;
  if (result.ok === true) {
    row.decodedLayout = result.hypothesis ? result.hypothesis.cellSurfaceLayout : null;
    row.decodedTones = result.tones;
  }
  const verdict = classify(result);
  row.stage = verdict.stage;
  row.sub = verdict.sub;
  if (verdict.locator) row.locator = verdict.locator;
  if (verdict.probe) row.probe = verdict.probe;
  rows.push(row);
  done.add(conditionKey(row));
  console.log(JSON.stringify(row));
  return row;
}

function mainSweep() {
  const rows = loadResults();
  const done = new Set(rows.map(conditionKey));
  for (const plan of PLANS) {
    for (const tones of plan.tones) {
      for (const ppu of plan.ppus) {
        for (const toneMode of plan.toneModes) {
          for (const k1 of plan.k1s) {
            for (const theta of plan.thetas) {
              const axes = theta === 0 ? [plan.axes[0]] : plan.axes;
              for (const axis of axes) {
                runCondition(rows, done, plan, tones, ppu, axis, theta, k1, toneMode, 'main');
                saveResults(rows);
              }
            }
          }
        }
      }
    }
  }
  console.log('main done: ' + rows.length + ' rows');
}

/** 레인별 (tones,ppu,axis,k1,tone) 마지막 통과 θ ~ 첫 실패 θ 사이 2.5° 채움. */
function refineSweep() {
  const rows = loadResults();
  const done = new Set(rows.map(conditionKey));
  for (const plan of PLANS) refinePlan(plan, rows, done);
  console.log('refine done: ' + rows.length + ' rows');
}

function refinePlan(plan, rows, done) {
  for (const tones of plan.tones) {
    for (const ppu of plan.ppus) {
      for (const toneMode of plan.toneModes) {
        for (const k1 of plan.k1s) {
          for (const axis of plan.axes) {
            const lane = rows.filter((row) =>
              row.layout === plan.layout && row.tones === tones && row.ppu === ppu
              && row.toneMode === toneMode && row.k1 === k1
              && (row.axis === axis || row.theta === 0));
            const byTheta = new Map(lane.map((row) => [row.theta, row.ok]));
            const thetas = [...byTheta.keys()].sort((a, b) => a - b);
            for (let i = 0; i + 1 < thetas.length; i += 1) {
              const lower = thetas[i];
              const upper = thetas[i + 1];
              if (byTheta.get(lower) !== true || byTheta.get(upper) !== false) continue;
              for (let theta = lower + 2.5; theta < upper - 1e-9; theta += 2.5) {
                runCondition(rows, done, plan, tones, ppu, axis, theta, k1, toneMode, 'refine');
                saveResults(rows);
              }
            }
          }
        }
      }
    }
  }
}

/**
 * θ 축 연장 — 격자 상한(40° 또는 부분격자 상한)이 통과한 레인은 붕괴 문턱이 격자
 * 밖이다. 45/50/55/60° 를 첫 실패까지 측정한다 (60° = 하네스 상한. 첫 실패 후
 * 중단 — θ 단조 악화 가정은 이 주석으로 명시; refine 이 비단조를 다시 본다).
 */
function extendThetaSweep() {
  const rows = loadResults();
  const done = new Set(rows.map(conditionKey));
  for (const plan of PLANS) {
    const gridMax = Math.max(...plan.thetas);
    for (const tones of plan.tones) {
      for (const ppu of plan.ppus) {
        for (const toneMode of plan.toneModes) {
          for (const k1 of plan.k1s) {
            for (const axis of plan.axes) {
              const atMax = rows.find((row) =>
                row.layout === plan.layout && row.tones === tones && row.ppu === ppu
                && row.toneMode === toneMode && row.k1 === k1 && row.axis === axis
                && row.theta === gridMax);
              if (!atMax || atMax.ok !== true) continue;
              for (const theta of [45, 50, 55, 60]) {
                const row = runCondition(rows, done, plan, tones, ppu, axis, theta, k1, toneMode, 'extend-theta');
                saveResults(rows);
                if (row && !row.ok) break;
              }
            }
          }
        }
      }
    }
  }
  console.log('extend-theta done: ' + rows.length + ' rows');
}

/** k1 축 연장 — θ=0 에서 격자 상한(0.15) 밖 붕괴 문턱 탐색. */
function extendSweep() {
  const rows = loadResults();
  const done = new Set(rows.map(conditionKey));
  for (const plan of PLANS) {
    const tones = plan.tones[0];
    const ppu = plan.ppus[0];
    for (const toneMode of plan.toneModes) {
      for (const k1 of [0.2, 0.25, 0.3, 0.4]) {
        const row = runCondition(rows, done, plan, tones, ppu, plan.axes[0], 0, k1, toneMode, 'extend');
        saveResults(rows);
        if (row && !row.ok) break; // 붕괴 이후는 더 안 본다 (단조 가정은 로그에 명시)
      }
    }
  }
  console.log('extend done: ' + rows.length + ' rows');
}

function smoke() {
  const cases = [
    { plan: PLANS[0], tones: 2, ppu: 15, axis: 'horizontal', theta: 0, k1: 0, toneMode: 'none' },
    { plan: PLANS[0], tones: 2, ppu: 15, axis: 'diagonal', theta: 25, k1: 0.1, toneMode: 's0.6' },
    { plan: PLANS[0], tones: 2, ppu: 15, axis: 'horizontal', theta: 40, k1: 0.15, toneMode: 's0.6' },
    { plan: PLANS[1], tones: 2, ppu: 15, axis: 'horizontal', theta: 0, k1: 0, toneMode: 'none' },
    { plan: PLANS[1], tones: 2, ppu: 15, axis: 'horizontal', theta: 30, k1: 0.1, toneMode: 's0.6' },
    { plan: PLANS[2], tones: 2, ppu: 15, axis: 'horizontal', theta: 0, k1: 0, toneMode: 'none' },
  ];
  for (const item of cases) {
    const raster = baseRaster(item.plan.layout, item.plan.version, item.tones, item.ppu);
    const frame = distortFrame(raster, item);
    const start = process.hrtime.bigint();
    const result = decodeLab(frame);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const verdict = classify(result);
    console.log(JSON.stringify({
      layout: item.plan.layout,
      theta: item.theta,
      k1: item.k1,
      toneMode: item.toneMode,
      frame: raster.width + 'x' + raster.height,
      ms: Math.round(ms),
      ok: result.ok === true && result.text === PAYLOAD,
      stage: verdict.stage,
      sub: verdict.sub,
      locator: verdict.locator || null,
    }));
    if (!result.ok && process.env.DUMP_DETAIL === '1') {
      console.log(JSON.stringify(result.detail, (key, value) =>
        (key === 'shapeCandidates' || key === 'pixels' || key === 'data' ? undefined : value)).slice(0, 4000));
    }
  }
}

// ---- 집계 (report) --------------------------------------------------------------

function thetaEnvelope(lane) {
  // lane: 같은 (layout,tones,ppu,toneMode,k1,axis) 의 (θ→ok). 붕괴 문턱 = 통과가
  // 끊긴 뒤 다시 살아나지 않는 첫 실패 θ. 비단조는 표에 그대로 적는다.
  const byTheta = [...lane.entries()].sort((a, b) => a[0] - b[0]);
  let lastPass = null;
  let firstFail = null;
  for (const [theta, ok] of byTheta) {
    if (ok) lastPass = theta;
    else if (firstFail === null) firstFail = theta;
  }
  const nonMonotone = firstFail !== null && lastPass !== null && lastPass > firstFail;
  return { lastPass, firstFail, nonMonotone, detail: byTheta.map(([t, ok]) => t + (ok ? '○' : '×')).join(' ') };
}

function report() {
  const rows = loadResults();
  const lanes = new Map();
  for (const row of rows) {
    if (row.theta === 0) {
      // θ=0 행은 모든 축 레인에 공유 (축 무의미 — 계획 주석 참조).
      for (const axis of AXES) {
        const key = [row.layout, row.tones, row.ppu, row.toneMode, row.k1, axis].join('|');
        if (!lanes.has(key)) lanes.set(key, new Map());
        lanes.get(key).set(row.theta, row.ok);
      }
      continue;
    }
    const key = [row.layout, row.tones, row.ppu, row.toneMode, row.k1, row.axis].join('|');
    if (!lanes.has(key)) lanes.set(key, new Map());
    lanes.get(key).set(row.theta, row.ok);
  }
  console.log('## 축별 봉투 (θ 스윕: 마지막 통과 / 첫 실패, ○=복호 ×=실패)');
  const keys = [...lanes.keys()].sort();
  for (const key of keys) {
    const envelope = thetaEnvelope(lanes.get(key));
    console.log('| ' + key.split('|').join(' | ') + ' | ' + String(envelope.lastPass)
      + ' | ' + String(envelope.firstFail) + ' | ' + envelope.detail
      + (envelope.nonMonotone ? ' (비단조)' : '') + ' |');
  }

  console.log('\n## 결정 단계 귀속 (실패 행만)');
  const attribution = new Map();
  for (const row of rows) {
    if (row.ok) continue;
    const key = row.layout + ' | ' + row.stage + ' | ' + String(row.sub);
    attribution.set(key, (attribution.get(key) || 0) + 1);
  }
  for (const [key, count] of [...attribution.entries()].sort((a, b) => b[1] - a[1])) {
    console.log('| ' + key + ' | ' + count + ' |');
  }

  console.log('\n## 성공/실패 총계');
  const totals = new Map();
  for (const row of rows) {
    const key = row.layout + '/' + row.tones + 'T/' + row.ppu + 'px';
    if (!totals.has(key)) totals.set(key, { pass: 0, fail: 0 });
    totals.get(key)[row.ok ? 'pass' : 'fail'] += 1;
  }
  for (const [key, value] of [...totals.entries()].sort()) {
    console.log('| ' + key + ' | ' + value.pass + '/' + (value.pass + value.fail) + ' |');
  }
}

const mode = process.argv[2] || 'smoke';
if (mode === 'smoke') smoke();
else if (mode === 'main') mainSweep();
else if (mode === 'refine') refineSweep();
else if (mode === 'extend') extendSweep();
else if (mode === 'extend-theta') extendThetaSweep();
else if (mode === 'report') report();
else throw new Error('unknown mode: ' + mode);
