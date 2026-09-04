/**
 * ltc-gain-measure.mjs — 다중프레임 누적(`src/r2/`)이 단발 복호보다 **무엇을 더 읽는지** 잰다.
 *
 * 누적기의 주장은 하나다 — 「단발로 못 읽는 코드를 여러 프레임 모아서 읽는다」.
 * 이 도구는 라벨된 실사진 시퀀스에서 그 주장을 단발 대조군과 나란히 잰다.
 *
 * ── 자를 셋으로 가르는 이유 ──────────────────────────────────────────────────
 *
 * 「누적 성공률 − 단발 성공률」은 **단위가 안 맞는다.** 단발은 프레임당 시행이고,
 * 누적 세션은 시퀀스당 한 번이다 (`src/r2/session.js` — complete 되면 얼어붙는다).
 * 그래서 셋으로 나눈다:
 *
 *   G1 «시퀀스 순증»   단발이 시퀀스 전체에서 원문을 **한 번도** 못 냈는데 누적이 냈다.
 *   G2 «도달 비용»     둘 다 냈다면 **얼마나 걸려서** 냈나. **두 단위로 잰다** —
 *                      프레임 인덱스와 **벽시계 ms**. 🔴 둘은 **부호가 다를 수 있다**:
 *                      단발은 프레임마다 전 탐색(초 단위)이고 누적은 락 뒤 정합만
 *                      (밀리초 단위)이라, 프레임으로는 누적이 늦어도 시간으로는 훨씬
 *                      빠를 수 있다. 사용자가 겪는 단위는 프레임이 아니라 시간이다.
 *   G3 «오수용»        누적이 원문과 **다른** 글자를 DONE 으로 냈다. 0 이어야 한다
 *                      (`src/r2/decode-rs.js` 의 프레이밍 검증이 막는다 — 그 회귀도 겸한다).
 *
 * ── 나오는 수는 **ecc·mask 축에서만** 상한이다 ─────────────────────────────
 *
 * 세션은 ecc·mask·n 을 미리 알아야 만들어지는데, 라이브 스캐너는 그걸 모르고 포맷을
 * 읽어서 알아내야 한다. 여기서는 ecc×mask 를 **전수 스윕**하고 「하나라도 맞으면 성공」
 * 으로 세므로, **그 두 축에서는** 실제 라이브가 이 수 이하다.
 * 이긴 조합(ecc·mask)을 같이 적는다 — 포맷을 읽는 경로가 맞혀야 할 표적이다.
 *
 * 🔴 **그러나 «LTC 의 상한» 이라고 부르면 안 된다.** n·layoutId 는 라벨에서 «주어진» 값이라
 * 오라클이 아니고(아래 ⚠), 검출이 그 축에서 실패하는 시퀀스에서는 이 실험이
 * **검출을 고정한 채 검출을 지목하는** 구조가 된다.
 *
 * ── ⚠ 이 도구가 **못 재는** 축 ─────────────────────────────────────────────
 *
 * - **hex 계열(Type A/C/K/O/V) 시퀀스를 못 돌린다.** A3 어댑터가 cellsurface 전용이다
 *   (`src/r2/adapter-locator.js` 의 `rebuildScanMaps` → `dataCellsInScanOrderCellSurfaceFinal`,
 *   `detectInto` → `detectCellSurfaceBlockShapes`). 그 계열에는 정합 경로가 아예 없다.
 *   ⇒ 그런 시퀀스는 **조용히 0 으로 세지 않고** `skipped: 'no-a3-path'` 로 적는다.
 *      「이득이 0 이었다」와 「돌리지 못했다」를 같은 칸에 넣으면 다음 사람이 잘못된
 *      결론을 물려받는다.
 * - **프레임률**. 누적기의 감쇠·coast 가 전부 프레임 카운트라 (`src/r2/accumulate.js` ·
 *   `identity.js` 에 `timestamp` 참조 0건) 10 fps 리플레이와 라이브 캐던스가 구별 불가다.
 *   ⇒ 여기 ms 는 **연산 비용**이지 «사용자가 기다린 시간» 이 아니다. 라이브에서는 카메라가
 *   프레임을 주는 속도가 따로 걸린다. 그 축은 여전히 이 자를 안 지난다.
 * - 🔴 **n·layoutId 는 오라클이 아니다.** ecc·mask 는 전수 스윕이지만, 세션의 격자
 *   (`cellCount`·`maskDigits`)는 **라벨에서 주어진** n·layoutId 로 고정된다. 실제 격자는
 *   검출기가 스스로 고르고, 둘이 어긋나면 `adapter-locator.js` 의 `cellCoord` 가 래스터
 *   폴백으로 **조용히** 넘어간다. ⇒ 검출이 n·layout 을 못 맞히는 시퀀스에서 이 수는
 *   «누적의 상한» 이 아니라 «현행 검출을 고정했을 때의 성적» 이다. 그런 시퀀스에서
 *   「누적에 이득이 없다」와 「검출이 못 따라간다」는 이 자료로 **안 갈린다.**
 * - **해상도**. 960 덤프 하나로만 잰다. 1440 은 다른 수를 낸다.
 *
 * 입력: `test/output/photos/luma/<시퀀스>/` 의 휘도 덤프 (gitignore 영역이라 없으면 못 돈다).
 *       기하 라벨은 `tools/a3-wire-labels.json`, 정답 문자열은 `test/sequence-truth.json`.
 *
 * 사용:
 *   node tools/ltc-gain-measure.mjs                    # 라벨된 시퀀스 전부
 *   node tools/ltc-gain-measure.mjs y2 y2-p9rot
 *   node tools/ltc-gain-measure.mjs --arm ltc --out test/output/ltc-gain.json
 *   node tools/ltc-gain-measure.mjs --frames 40        # 프레임 상한 (빠른 정찰)
 *   node tools/ltc-gain-measure.mjs --relocate         # 매 프레임 재탐색 (락 축 흔들기)
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { maskValue } from '../src/mask.js';
import { unframe } from '../src/header.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { R2_INDICATOR, createR2Session } from '../src/r2/session.js';
import { lumaToRaster, readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LABELS = JSON.parse(readFileSync(join(ROOT, 'tools', 'a3-wire-labels.json'), 'utf8'));
const TRUTH = JSON.parse(readFileSync(join(ROOT, 'test', 'sequence-truth.json'), 'utf8'));

/** ecc×mask 스윕. 상한을 재는 것이므로 전수다. */
const ECC_LEVELS = Object.freeze(['L', 'M', 'H']);
const MASK_INDICES = Object.freeze([0, 1, 2]);
const TONES = 2;

/**
 * A3 경로가 없는 시퀀스. 조용히 0 으로 세면 「LTC 이득 0」이라는 **거짓 결론**이 난다.
 * (0/N 이나 «전부 실패» 는 재는 대상이 아니라 자를 의심할 신호다)
 */
const NO_A3_PATH = Object.freeze({
  'c3-tl': 'Type C — A3 어댑터가 cellsurface 전용',
  'c3-daehan': 'Type C — A3 어댑터가 cellsurface 전용',
  'swap-c3tl-c3daehan': 'Type C + 교체 — A3 어댑터가 cellsurface 전용',
  'swap-multi-c3-k2-v2-y2': '다중 타입 교체 — A3 어댑터가 cellsurface 전용',
});

function listFrames(relDir) {
  const dir = join(ROOT, 'test', 'output', 'photos', 'luma', relDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.960.luma'))
    .sort()
    .map((name) => join(dir, name));
}

/** 단발 팔 — 프레임마다 decodeFrontend. ⚠ raster 를 넘긴다 (luma 를 넘기면 전멸한다). */
function runSingleShot(paths, expect, limit) {
  const perFrame = [];
  let firstOk = -1;
  let okCount = 0;
  let cumulativeMs = 0;
  let msToFirstOk = null;
  const n = Math.min(paths.length, limit);
  for (let i = 0; i < n; i += 1) {
    const dump = readLumaDump(paths[i]);
    let text = null;
    // 🔴 **벽시계를 잰다.** G2 를 프레임 인덱스로만 재면 두 팔의 프레임당 비용이
    // 크게 달라 **부호가 뒤집힐 수 있다** (단발은 프레임마다 전 탐색, 누적은 락 뒤
    // 정합만). 사용자가 겪는 단위는 프레임이 아니라 시간이다.
    const t0 = performance.now();
    try {
      const res = decodeFrontend(lumaToRaster(dump), { enableCellSurfaceY: true });
      if (res && res.ok && typeof res.text === 'string') text = res.text;
    } catch { text = null; }
    const ms = performance.now() - t0;
    cumulativeMs += ms;
    const correct = expect !== null && text === expect;
    if (correct) {
      okCount += 1;
      if (firstOk < 0) { firstOk = i; msToFirstOk = cumulativeMs; }
    }
    perFrame.push({ i, text: text === null ? null : String(text).slice(0, 64), correct, ms: Math.round(ms) });
    if ((i + 1) % 20 === 0 || i + 1 === n) console.error(`  [단발] ${i + 1}/${n}`);
  }
  return { frames: n, okCount, firstOk, perFrame, cumulativeMs, msToFirstOk };
}

/** LTC 팔 한 조합. 프레임을 순서대로 밀어 넣고 DONE 이 난 프레임과 글자를 돌려준다. */
function runLtcCombo(paths, seq, ecc, maskIndex, limit, relocate) {
  const scan = dataCellsInScanOrderCellSurfaceFinal(seq.n, seq.layoutId);
  const cap = capacityForCellSurfaceFinal(seq.n, ecc, TONES, seq.layoutId);
  const maskDigits = new Uint8Array(scan.length);
  for (let k = 0; k < scan.length; k += 1) {
    maskDigits[k] = maskValue(scan[k].i, scan[k].j, maskIndex);
  }
  const adapters = createA3Adapters({ n: seq.n, relocateEveryFrame: relocate === true });
  const session = createR2Session({
    layout: {
      cellCount: scan.length,
      requiredSymbolCount: cap.dataSymbols,
      nsym: cap.nsym,
      maskDigits,
      // 🔴 **`dataBytes` 다. `maxPayloadBytes` 가 아니다** (2026-09-04, 하마터면 공표할 뻔).
      // RS 메시지는 인코더가 `frame(text, dataBytes)` 로 만든 **dataBytes** 길이이고,
      // `maxPayloadBytes = dataBytes − HEADER_BYTES(1)` 이다 (`src/header.js`).
      // 1 바이트 짧게 선언하면 `decode-rs.js` 가 `capped` 로 자르고 `decodeChunkInto` 를
      // 부르는데, base-211 은 27B ↔ 28심볼 **청크 단위 대수 변환**이라 take 가 1 줄면
      // 그 청크의 바이트가 「마지막 하나만 빠지는」 게 아니라 **전부 달라진다.**
      // 증상은 조합마다 달라 더 헷갈렸다: dataBytes ≤ 27 이면 단일 청크라 전멸(n=13),
      // 그보다 크면 첫 청크가 살아 19바이트 원문이 우연히 통과한다(n=21·25).
      // 그래서 이 버그가 **「n=13 한정 R2 결함」으로 오진**됐다 — 자의 결함이었다.
      maxPayloadBytes: cap.dataBytes,
      payloadBytes: cap.dataBytes,
    },
    detectInto: adapters.detectInto,
    alignInto: adapters.alignInto,
    decodeInto: createRsDecodeInto({ codewordCapacity: Math.floor(scan.length / 3) }),
  });

  const n = Math.min(paths.length, limit);
  let gatePassedFrames = 0;
  // 벽시계 — 단발 팔과 **같은 축**으로 비교하려고 잰다. 덤프 읽기는 두 팔 공통이라 뺀다.
  let cumulativeMs = 0;
  const frameMs = [];
  for (let i = 0; i < n; i += 1) {
    const dump = readLumaDump(paths[i]);
    const t0 = performance.now();
    const r = session.pushFrame(dump.data, dump.width, dump.height, i * 100, null);
    const ms = performance.now() - t0;
    cumulativeMs += ms;
    if (frameMs.length < 12) frameMs.push(Math.round(ms));
    if (session.buffers.alignmentOutput.gatePassed) gatePassedFrames += 1;
    if (r.indicator === R2_INDICATOR.DONE) {
      const bytes = Uint8Array.from(r.payload.slice(0, r.payloadLength));
      // ⚠ `unframe` 으로 푼다. 손으로 `subarray(1)` 하면 **패딩 0x00 이 글자에 딸려 와**
      // 정답이 오답으로 집계된다 (실제로 한 번 밟았다 — y2 f4 가 정답인데
      // «오수용 1» 로 나왔다). R2 수용 경로가 부르는 것도 같은 `unframe` 이다.
      let text = null;
      try { text = unframe(bytes).text; } catch { text = null; }
      return { done: true, doneFrame: i, gatePassedFrames, text, rawLength: r.payloadLength, msToDone: Math.round(cumulativeMs), frameMs };
    }
  }
  return { done: false, doneFrame: -1, gatePassedFrames, text: null, rawLength: 0, msToDone: null, frameMs };
}

/**
 * 한 DONE 을 채점한다. 🔴 **«틀렸다» 는 정답을 알 때만 말할 수 있다.**
 *
 * 옛 판정은 `done && !correct` 를 오수용으로 셌고, 그래서 `expect: null` 인 시퀀스에서
 * **정답 DONE 이 오수용으로 집계**됐다. 그러면 아직 못 읽은 시퀀스 — 즉 **G1 순증이
 * 나올 수 있는 유일한 자리** — 는 승리를 기록할 수단이 구조적으로 없다.
 * 이제 셋으로 가른다: correct(정답 일치) · wrong(정답을 아는데 다르다) · unknown(모른다).
 *
 * `expectDerived` 는 **측정이 아니라 유도**다 (촬영자 진술 등). 그것과 일치하면
 * `derivedMatch` 로만 적고 `correct` 로 승격하지 않는다.
 */
function makeScorer(expect, expectDerived) {
  return (text, done) => {
    if (!done || text === null) {
      return { correct: false, wrong: false, unknown: false, derivedMatch: false };
    }
    if (expect !== null && expect !== undefined) {
      return {
        correct: text === expect,
        wrong: text !== expect,
        unknown: false,
        derivedMatch: expectDerived !== undefined && text === expectDerived,
      };
    }
    return {
      correct: false,
      wrong: false,
      unknown: true,
      derivedMatch: expectDerived !== undefined && text === expectDerived,
    };
  };
}

function measureSequence(name, spec, arm, limit, relocate) {
  const expect = TRUTH[name] && TRUTH[name].expect !== undefined ? TRUTH[name].expect : null;
  const expectDerived = TRUTH[name] ? TRUTH[name].expectDerived : undefined;
  const score = makeScorer(expect, expectDerived);
  const paths = listFrames(spec.dir);
  const out = {
    name,
    n: spec.n,
    layoutId: spec.layoutId,
    expect,
    frameCount: paths.length,
    framesUsed: Math.min(paths.length, limit),
  };

  if (arm !== 'ltc') {
    console.error(`[${name}] 단발 팔`);
    const s = runSingleShot(paths, expect, limit);
    out.single = {
      okCount: s.okCount,
      rate: s.frames > 0 ? s.okCount / s.frames : 0,
      firstOkFrame: s.firstOk,
      msToFirstOk: s.msToFirstOk === null ? null : Math.round(s.msToFirstOk),
      msPerFrameMedian: Math.round(s.cumulativeMs / Math.max(1, s.frames)),
      // 정답 라벨이 없는 시퀀스에서 단발이 «뭔가» 를 낸 프레임 수 (오수용 후보)
      textFrames: s.perFrame.filter((f) => f.text !== null).length,
    };
    out.singlePerFrame = s.perFrame;
  }

  if (arm !== 'single') {
    const combos = [];
    for (const ecc of ECC_LEVELS) {
      for (const mask of MASK_INDICES) {
        console.error(`[${name}] LTC ecc=${ecc} mask=${mask}`);
        const r = runLtcCombo(paths, spec, ecc, mask, limit, relocate);
        combos.push({ ecc, mask, ...r, ...score(r.text, r.done) });
      }
    }
    const wins = combos.filter((c) => c.correct);
    // 🔴 «틀렸다» 는 **정답을 알 때만** 말할 수 있다. 옛 판정은 `done && !correct` 였고,
    // 그래서 `expect: null` 인 시퀀스에서 **정답 DONE 이 오수용으로 집계**됐다 —
    // 그러면 유일한 G1 후보(`y2-p9rot`)는 승리를 기록할 수단이 구조적으로 없다.
    const wrong = combos.filter((c) => c.wrong);
    const unknown = combos.filter((c) => c.done && !c.correct && !c.wrong);
    wins.sort((a, b) => a.doneFrame - b.doneFrame);
    out.ltc = {
      correct: wins.length > 0,
      doneFrame: wins.length > 0 ? wins[0].doneFrame : -1,
      winner: wins.length > 0 ? { ecc: wins[0].ecc, mask: wins[0].mask } : null,
      msToDone: wins.length > 0 ? wins[0].msToDone : null,
      frameMs: wins.length > 0 ? wins[0].frameMs : null,
      winCount: wins.length,
      // G3 — 정답을 **아는데** 다른 글자를 DONE 으로 낸 조합만 센다.
      falseAccepts: wrong.length,
      falseAcceptSamples: wrong.slice(0, 3).map((c) => ({
        ecc: c.ecc, mask: c.mask, doneFrame: c.doneFrame, text: c.text, rawLength: c.rawLength,
      })),
      // 정답을 **모르는** 시퀀스에서 난 DONE. 오수용도 승리도 아니고 «사람이 봐야 할 것» 이다.
      // 여기 값이 있으면 그 글자를 눈으로 확인해 `sequence-truth.json` 을 채워라.
      unknownAccepts: unknown.length,
      unknownSamples: unknown.slice(0, 3).map((c) => ({
        ecc: c.ecc, mask: c.mask, doneFrame: c.doneFrame, text: c.text, derivedMatch: c.derivedMatch,
      })),
      gatePassedMax: combos.reduce((m, c) => Math.max(m, c.gatePassedFrames), 0),
    };
    out.ltcCombos = combos;
  }

  // ── 판정 ──
  if (out.single && out.ltc) {
    const sOk = out.single.okCount > 0;
    const lOk = out.ltc.correct;
    if (out.ltc.falseAccepts > 0) out.verdict = 'G3-오수용';
    else if (out.ltc.unknownAccepts > 0 && !lOk) out.verdict = '판정보류-정답미상';
    else if (!sOk && lOk) out.verdict = 'G1-시퀀스순증';
    else if (sOk && lOk) {
      // 🔴 **두 단위로 판정한다.** 프레임과 시간은 부호가 다를 수 있고, 실제로 다르다.
      out.frameDelta = out.ltc.doneFrame - out.single.firstOkFrame;
      const sMs = out.single.msToFirstOk;
      const lMs = out.ltc.msToDone;
      out.msDelta = (sMs === null || lMs === null) ? null : lMs - sMs;
      out.msSpeedup = (sMs === null || lMs === null || lMs <= 0) ? null : Number((sMs / lMs).toFixed(1));
      const frameSide = out.frameDelta < 0 ? '프레임이득' : '프레임손해';
      const msSide = out.msDelta === null ? '시간미상' : (out.msDelta < 0 ? '시간이득' : '시간손해');
      out.verdict = `G2-${frameSide}·${msSide}`;
    } else if (sOk && !lOk) out.verdict = 'LTC-미달';
    else out.verdict = '둘다실패';
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  let arm = 'both';
  let outPath = join(ROOT, 'test', 'output', 'ltc-gain.json');
  let limit = Number.POSITIVE_INFINITY;
  let relocate = false;
  const names = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--arm') { arm = argv[++i]; continue; }
    if (argv[i] === '--out') { outPath = argv[++i]; continue; }
    if (argv[i] === '--frames') { limit = Number(argv[++i]); continue; }
    if (argv[i] === '--relocate') { relocate = true; continue; }
    names.push(argv[i]);
  }
  if (!isAbsolute(outPath)) outPath = resolve(ROOT, outPath);

  const targets = names.length > 0 ? names : Object.keys(LABELS.sequences);
  const results = [];
  for (const name of targets) {
    if (NO_A3_PATH[name]) {
      results.push({ name, skipped: 'no-a3-path', reason: NO_A3_PATH[name] });
      console.error(`[${name}] 건너뜀 — ${NO_A3_PATH[name]}`);
      continue;
    }
    const spec = LABELS.sequences[name];
    if (!spec) {
      results.push({ name, skipped: 'no-label', reason: 'a3-wire-labels.json 에 없다' });
      continue;
    }
    results.push(measureSequence(name, spec, arm, limit, relocate));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    arm,
    framesLimit: Number.isFinite(limit) ? limit : null,
    eccLevels: ECC_LEVELS,
    maskIndices: MASK_INDICES,
    note: 'ecc×mask 는 전수 스윕이라 그 축에서는 상한이다. ⚠ n·layoutId 는 라벨에서 «주어진» 값이라 '
      + '오라클이 아니다 — 정합이 그것을 못 맞히는 시퀀스에서는 이 수가 상한이 아니라 «현행 정합의 성적» 이다.',
    // 🔴 이 산출이 **어떤 정답표로 채점됐는지** 박아 둔다. 자는 TRUTH 를 모듈 로드
    // 시점에 한 번 읽으므로, 실행 중에 정답표를 고치면 산출이 낡은 표로 채점된 채
    // 남는다 (실제로 났다 — 원격 단발 팔이 y0 `expect: null` 로 채점돼 108/108 정답을
    // `okCount: 0` 으로 기록했다). 산출을 인용하기 전에 이 표를 현행과 대조해라.
    truthUsed: Object.fromEntries(Object.entries(TRUTH)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => [k, { expect: v.expect ?? null, expectDerived: v.expectDerived ?? null }])),
    results,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log('\n── LTC 이득 ──');
  for (const r of results) {
    if (r.skipped) { console.log(`${r.name.padEnd(24)} 건너뜀 (${r.skipped})`); continue; }
    const s = r.single
      ? `단발 ${r.single.okCount}/${r.framesUsed} f${r.single.firstOkFrame}/${r.single.msToFirstOk ?? '—'}ms`
      : '단발 —';
    const l = r.ltc
      ? `LTC ${r.ltc.correct ? `정답 f${r.ltc.doneFrame}/${r.ltc.msToDone}ms (${r.ltc.winner.ecc}/m${r.ltc.winner.mask}×${r.ltc.winCount})` : '실패'} · 오수용 ${r.ltc.falseAccepts}${r.ltc.unknownAccepts ? ` · 미상 ${r.ltc.unknownAccepts}` : ''}`
      : 'LTC —';
    const speed = r.msSpeedup ? ` [시간 ${r.msSpeedup}×]` : '';
    console.log(`${r.name.padEnd(10)} ${s.padEnd(30)} ${l.padEnd(52)} ${r.verdict ?? ''}${speed}`);
  }
  console.log(`\n→ ${outPath}`);
}

main();
