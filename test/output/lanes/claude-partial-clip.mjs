/**
 * claude-partial-clip.mjs — 잘림 전후 벤치 (부분 앵커 포즈 + locator 셀 소거).
 *
 * 잘림 모델·자는 `claude-finish-clip-harness.mjs` 와 같다 (claude-partial-frames.mjs 로
 * 공유). 다른 것은 **before 팔의 기준선**이다: finish 레인은 04fdff4 를 before 로 썼고,
 * 이 레인은 **현재 HEAD(4697355)** 를 before 로 쓴다 (`_baseline-partial/src`,
 * `git archive HEAD src` 로 뜬 원본 트리). 즉 이 표의 before 는 finish 레인의 after 다.
 *
 * 모드:
 *   selftest— 계측기 자기검사 (교차 판정 자가 접두 사각을 갖지 않는가)
 *   ruler   — 자 검증 (요청 잘림 == 실제 잘림)
 *   main    — 전후 표 (192 프레임 × 2팔) + 오수용·교차·구제·퇴행
 *   cross   — 교차 오수용: 완성 포즈를 **다른 레이아웃·다른 방향**으로 강제 주입
 *   report  — 저장된 JSON 재출력
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodeFrontend as decodeAfter } from '../../../src/decoder/frontend.js';
import { decodeFrontend as decodeBefore } from './_baseline-partial/src/decoder/frontend.js';
import { distortImage } from '../../harness/distort.mjs';
import {
  DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import {
  buildClippedFrame, baseFrameFor, windowFor, ruler, biteFor,
  PAYLOAD, TARGET_IDS,
} from './claude-partial-frames.mjs';

const FILL_RGBA = Object.freeze({ ...getPreset(DEFAULT_PRESET).background, a: 255 });

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, 'claude-partial-clip-results.json');

const LEVELS = ['full', 'qz', 0.05, 0.1, 0.15, 0.2];
const MODES = ['corner-se', 'corner-nw', 'edge-right'];
const TONE_NAMES = ['none', 'sCurve0.6', 'gamma0.7'];

/**
 * 타깃 id → **정답 레이아웃 id** 정확 일치 맵.
 *
 * 2026-08-16 r2 수정. 이전 판은 교차를 `!target.toLowerCase().startsWith(layout)` 로
 * 쟀는데 `'v0x@21'.startsWith('v0') === true` 라 **v0X 프레임이 레이아웃 v0 로 수용되면
 * 교차로 세지 않는** 사각이 있었다 — 하필 이름·계보가 가장 인접한 쌍이다. 실측에서는
 * 발동하지 않았지만(수용 70건 전부 자기 레이아웃) 「교차 0」 을 그 경우를 볼 수 없는
 * 자로 잰 값이었다. `runCross` 는 처음부터 이 맵을 썼고, 이제 셋이 같은 자를 쓴다.
 */
const LAYOUT_OF = Object.freeze({
  'v0@13': 'v0', 'v0X@21': 'v0x', 'v1r2@21': 'v1r2', 'v2r2@21': 'v2r2',
});
const ALL_LAYOUTS = Object.freeze(['v0', 'v0x', 'v1r2', 'v2r2']);

/** 수용된 레이아웃이 그 타깃의 정답과 «다른가» — 접두 비교 금지, 정확 일치만. */
function isCrossLayout(target, layout) {
  if (layout === null || layout === undefined) return false;
  const want = LAYOUT_OF[target];
  if (!want) throw new Error('레이아웃 맵에 없는 타깃: ' + target);
  return String(layout) !== want;
}

const DECODE_OPTIONS = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

function decodeWith(decode, frame, options = DECODE_OPTIONS) {
  try {
    return decode({ width: frame.width, height: frame.height, pixels: frame.pixels }, options);
  } catch (error) {
    return { ok: false, reason: 'throw:' + (error && error.message) };
  }
}

function outcome(result) {
  if (result && result.ok === true && result.text === PAYLOAD) return 'ok';
  if (result && result.ok === true) return 'wrong-text';
  return 'fail';
}

// ---- 자 검증 ---------------------------------------------------------------

function runRuler() {
  const rows = [];
  let bad = 0;
  for (const target of TARGET_IDS) {
    const { base, box } = baseFrameFor(target);
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
        if (!okColumns || !okRows) bad += 1;
        rows.push({
          target,
          box: box.w + 'x' + box.h,
          level: String(level),
          mode,
          lostColRow: measured.lostColumns + '/' + measured.lostRows,
          expectColRow: expectedColumns + '/' + expectedRows,
          inkLostPct: (measured.inkLostFraction * 100).toFixed(2),
          geomLostPct: (measured.geometricLostFraction * 100).toFixed(2),
          verdict: (okColumns && okRows) ? 'OK' : 'MISMATCH',
        });
      }
    }
  }
  console.table(rows);
  console.log(bad === 0
    ? '자 검증 통과 — 픽셀 bbox(①) · 요청 대조(④) 일치, ' + rows.length + '행'
    : '자 검증 실패 ' + bad + '건');
  return bad === 0;
}

// ---- 전후 표 ---------------------------------------------------------------

function runMain() {
  const results = [];
  let index = 0;
  const total = TARGET_IDS.length * (1 + 5 * MODES.length) * TONE_NAMES.length;
  for (const target of TARGET_IDS) {
    for (const level of LEVELS) {
      const modes = level === 'full' ? ['none'] : MODES;
      for (const mode of modes) {
        for (const tone of TONE_NAMES) {
          const built = buildClippedFrame(target, mode, level, tone);
          const before = decodeWith(decodeBefore, built.frame);
          const after = decodeWith(decodeAfter, built.frame);
          index += 1;
          results.push({
            target,
            level: String(level),
            mode,
            tone,
            inkLostPct: Number((built.ruler.inkLostFraction * 100).toFixed(3)),
            geomLostPct: Number((built.ruler.geometricLostFraction * 100).toFixed(3)),
            before: outcome(before),
            after: outcome(after),
            beforeReason: before.ok ? null : (before.reason || null),
            afterReason: after.ok ? null : (after.reason || null),
            afterLayout: after.ok ? after.hypothesis.cellSurfaceLayout : null,
            beforeLayout: before.ok ? before.hypothesis.cellSurfaceLayout : null,
            afterN: after.ok ? after.hypothesis.n : null,
            afterCrs: after.ok ? after.crsDistance : null,
            afterErasure: after.ok && after.diagnostics && after.diagnostics.erasureFallback
              ? after.diagnostics.erasureFallback.erasureSymbolIndices.length : 0,
            afterCellErasure: after.ok && after.diagnostics
              && after.diagnostics.cubeSamplingFallback
              ? after.diagnostics.cubeSamplingFallback.erasureCellCount : 0,
          });
          if (index % 12 === 0) console.error('  ... ' + index + '/' + total);
        }
      }
    }
  }
  writeFileSync(RESULTS_PATH, JSON.stringify({ generatedAt: Date.now(), results }, null, 2));
  console.log('저장: ' + RESULTS_PATH + ' (' + results.length + '행)');
  report(results);
}

function labelOf(level) {
  if (level === 'full') return 'quiet zone 정상';
  if (level === 'qz') return 'quiet zone 0 (코드 손실 0)';
  return (Number(level) * 100).toFixed(0) + '%';
}

const LEVEL_ORDER = ['full', 'qz', '0.05', '0.1', '0.15', '0.2'];

function report(rows) {
  const byTarget = new Map();
  for (const row of rows) {
    if (!byTarget.has(row.target)) byTarget.set(row.target, new Map());
    const levels = byTarget.get(row.target);
    if (!levels.has(row.level)) levels.set(row.level, { total: 0, before: 0, after: 0 });
    const bucket = levels.get(row.level);
    bucket.total += 1;
    if (row.before === 'ok') bucket.before += 1;
    if (row.after === 'ok') bucket.after += 1;
  }
  console.log('\n| 타깃 | 잘림 | before | after |');
  console.log('|---|---|---|---|');
  for (const target of TARGET_IDS) {
    const levels = byTarget.get(target);
    for (const level of LEVEL_ORDER) {
      const bucket = levels.get(level);
      if (!bucket) continue;
      console.log('| ' + target + ' | ' + labelOf(level) + ' | '
        + bucket.before + '/' + bucket.total + ' | ' + bucket.after + '/' + bucket.total + ' |');
    }
  }

  // 방향별 (잘림 있는 행만)
  console.log('\n| 타깃 | 방향 | 5% | 10% | 15% | 20% |');
  console.log('|---|---|---|---|---|---|');
  for (const target of TARGET_IDS) {
    for (const mode of MODES) {
      const cells = ['0.05', '0.1', '0.15', '0.2'].map((level) => {
        const bucket = rows.filter((row) =>
          row.target === target && row.mode === mode && row.level === level);
        const before = bucket.filter((row) => row.before === 'ok').length;
        const after = bucket.filter((row) => row.after === 'ok').length;
        return before + '→' + after + '/' + bucket.length;
      });
      console.log('| ' + target + ' | ' + mode + ' | ' + cells.join(' | ') + ' |');
    }
  }

  const wrong = rows.filter((row) => row.after === 'wrong-text');
  const cross = rows.filter((row) => row.after === 'ok'
    && isCrossLayout(row.target, row.afterLayout));
  const beforeCross = rows.filter((row) => row.before === 'ok'
    && isCrossLayout(row.target, row.beforeLayout));
  const gained = rows.filter((row) => row.before !== 'ok' && row.after === 'ok');
  const lost = rows.filter((row) => row.before === 'ok' && row.after !== 'ok');
  const erasureRows = rows.filter((row) => row.after === 'ok'
    && (row.afterErasure > 0 || row.afterCellErasure > 0));
  console.log('\n| 지표 | 값 |');
  console.log('|---|---|');
  console.log('| 오수용 (after ok 인데 다른 텍스트) | ' + wrong.length + ' |');
  console.log('| 교차 레이아웃 선택 (after, 정확 일치 자) | ' + cross.length + ' |');
  console.log('| 교차 레이아웃 선택 (before, 대조) | ' + beforeCross.length + ' |');
  console.log('| 수용 (after ok) — 교차의 실분모 | '
    + rows.filter((row) => row.after === 'ok').length + ' |');
  console.log('| 구제 (before 실패 → after 성공) | ' + gained.length + ' |');
  console.log('| 퇴행 (before 성공 → after 실패) | ' + lost.length + ' |');
  console.log('| 소거 발동 (after ok 중 셀·심볼 소거 > 0) | ' + erasureRows.length + ' |');
  console.log('| 전체 행 | ' + rows.length + ' |');
  // 수용된 레이아웃 히스토그램 — 「교차 0」 을 독자가 직접 확인할 수 있는 원자료.
  const layoutHistogram = new Map();
  for (const row of rows.filter((entry) => entry.after === 'ok')) {
    const key = row.target + ' → ' + row.afterLayout;
    layoutHistogram.set(key, (layoutHistogram.get(key) || 0) + 1);
  }
  console.log('수용 레이아웃 분포: ' + JSON.stringify([...layoutHistogram].sort()));
  if (lost.length) console.log('퇴행 상세: ' + JSON.stringify(lost.slice(0, 10)));
  if (wrong.length) console.log('오수용 상세: ' + JSON.stringify(wrong.slice(0, 10)));
  if (cross.length) console.log('교차 상세: ' + JSON.stringify(cross.slice(0, 10)));
  const gainedByLevel = new Map();
  for (const row of gained) {
    const key = row.level + '/' + row.mode;
    gainedByLevel.set(key, (gainedByLevel.get(key) || 0) + 1);
  }
  console.log('구제 분포: ' + JSON.stringify([...gainedByLevel].sort()));
  const erasureDetail = erasureRows.map((row) =>
    row.target + ' ' + row.level + ' ' + row.mode + ' ' + row.tone
    + ' cells=' + row.afterCellErasure + ' syms=' + row.afterErasure + ' crs=' + row.afterCrs);
  console.log('소거 발동 상세: ' + JSON.stringify(erasureDetail.slice(0, 40), null, 0));
}

// ---- 교차 오수용 -----------------------------------------------------------

/**
 * 완성 포즈가 **다른 레이아웃으로 오수용**되지 않는지 강제 주입으로 확인한다.
 * 각 잘림 프레임을 «그 프레임이 아닌» 레이아웃 하나만 열어 놓고 복호시킨다 —
 * 성공하면 그 자체가 오수용이다 (텍스트가 맞아도 레이아웃이 틀렸으므로).
 */
function runCross() {
  const rows = [];
  let accepted = 0;
  for (const target of TARGET_IDS) {
    for (const level of [0.05, 0.1]) {
      for (const mode of MODES) {
        const { frame } = buildClippedFrame(target, mode, level, 'none');
        for (const layout of ALL_LAYOUTS) {
          if (layout === LAYOUT_OF[target]) continue;
          // cellSurfaceLayouts 는 **cube 옵션**이다 — bootstrap 루트에 두면 조용히
          // 무시돼 «자기 레이아웃 정상 복호» 를 «교차 수용» 으로 오독한다.
          const result = decodeWith(decodeAfter, frame, {
            bootstrap: {
              family: {
                cube: {
                  enableLocatorY: true,
                  enableCellSurfaceY: true,
                  cellSurfaceLayouts: [layout],
                },
              },
            },
          });
          const ok = result && result.ok === true;
          if (ok) accepted += 1;
          rows.push({
            target, level: String(level), mode, forcedLayout: layout,
            ok: ok ? (result.text === PAYLOAD ? 'OK-SAME-TEXT' : 'OK-OTHER-TEXT') : '-',
            reason: ok ? null : String(result.reason).replace('frontend:', ''),
          });
        }
      }
    }
  }
  const bad = rows.filter((row) => row.ok !== '-');
  console.log('교차 주입 ' + rows.length + '회 · 수용 ' + accepted
    + (bad.length ? ' → ' + JSON.stringify(bad.slice(0, 10)) : ' (오수용 0)'));
  return accepted === 0;
}

/**
 * 물리 회전 3방향 — 잘린 프레임을 0/120/240° 돌려도 같은 텍스트·같은 레이아웃으로
 * 풀리는가. 부분 완성 포즈가 회전 위상을 흡수하는지(=면 T 를 잘못 짚지 않는지) 본다.
 */
function runRotation() {
  const rows = [];
  let wrong = 0;
  for (const target of TARGET_IDS) {
    for (const level of [0.05, 0.1]) {
      for (const mode of ['corner-se', 'edge-right']) {
        for (const degrees of [0, 120, 240]) {
          const { frame } = buildClippedFrame(target, mode, level, 'none');
          const turned = degrees === 0
            ? frame
            : distortImage(frame, { rotation: degrees, fill: FILL_RGBA });
          const result = decodeWith(decodeAfter, turned);
          const verdict = result && result.ok === true
            ? (result.text === PAYLOAD ? 'ok' : 'WRONG-TEXT')
            : '-';
          if (verdict === 'WRONG-TEXT') wrong += 1;
          const layout = result && result.ok ? result.hypothesis.cellSurfaceLayout : null;
          if (isCrossLayout(target, layout)) wrong += 1;
          rows.push({
            target, level: String(level), mode, rot: degrees, verdict, layout,
            reason: result.ok ? null : String(result.reason).replace('frontend:', ''),
          });
        }
      }
    }
  }
  console.table(rows);
  const okCount = rows.filter((row) => row.verdict === 'ok').length;
  console.log('회전 3방향 ' + rows.length + '행 · 복호 ' + okCount
    + ' · 오수용/교차 ' + wrong);
  return wrong === 0;
}

// ---- 계측기 자기검사 -------------------------------------------------------

/**
 * 자를 잰다. 예전 접두 비교가 놓친 **정확히 그 쌍**(v0X 프레임 → 레이아웃 v0)이
 * 이제 교차로 잡히는지 확인한다. 「교차 0」 이 «볼 수 없어서 0» 이 아님을 고정한다.
 */
function runSelftest() {
  const cases = [
    ['v0X@21', 'v0', true, '예전 접두 비교의 사각 — startsWith 로는 false 였다'],
    ['v0X@21', 'v0x', false, '자기 레이아웃'],
    ['v0@13', 'v0x', true, '반대 방향'],
    ['v0@13', 'v0', false, '자기 레이아웃'],
    ['v1r2@21', 'v2r2', true, '무관 쌍'],
    ['v2r2@21', 'v2r2', false, '자기 레이아웃'],
    ['v0X@21', null, false, '미수용 행은 교차가 아니다'],
  ];
  let bad = 0;
  for (const [target, layout, want, note] of cases) {
    const got = isCrossLayout(target, layout);
    if (got !== want) {
      bad += 1;
      console.log('FAIL ' + target + ' → ' + layout + ' : ' + got + ' (기대 ' + want + ') — ' + note);
    }
  }
  console.log(bad === 0
    ? '계측기 자기검사 통과 — ' + cases.length + '케이스 (접두 사각 v0X→v0 포함)'
    : '계측기 자기검사 실패 ' + bad + '건');
  return bad === 0;
}

const mode = process.argv[2] || 'ruler';
if (mode === 'selftest') {
  process.exitCode = runSelftest() ? 0 : 1;
} else if (mode === 'ruler') {
  process.exitCode = runRuler() ? 0 : 1;
} else if (mode === 'main') {
  runMain();
} else if (mode === 'cross') {
  process.exitCode = runCross() ? 0 : 1;
} else if (mode === 'rot') {
  process.exitCode = runRotation() ? 0 : 1;
} else if (mode === 'report') {
  if (!existsSync(RESULTS_PATH)) throw new Error('결과 JSON 이 없다 — main 먼저');
  report(JSON.parse(readFileSync(RESULTS_PATH, 'utf8')).results);
} else {
  throw new Error('알 수 없는 모드: ' + mode);
}
