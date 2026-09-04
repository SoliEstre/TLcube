/**
 * lambda-sweep.mjs — **λ(망각 계수)가 벽을 내리는가, 그리고 오답을 만드는가.**
 *
 * 🔴 왜 있나 (2026-09-05): `accumulate.js` 의 갱신식이 `next = old × λ + evidence × w`
 * 라 점수가 `e/(1−λ)` 로 **수렴**한다. λ=0.9 면 천장이 단발 마진의 **10배**다.
 * 실측(`tools/margin-ceiling-probe.mjs`): 실패 세트의 단발 마진 p50 이 10\~25 라
 * 10배로도 `tauCellQ8`(768)에 한참 못 미친다. λ=0.99 면 천장이 100배가 된다.
 *
 * 🔴 **그러나 마진이 커지는 것과 «옳은» 답은 다르다.** 편향된 관측을 더 모으면
 * **확신에 차서 틀린다.** 그래서 이 자는 둘을 **같이** 센다:
 *   · 새로 읽히는 세트 (이득)
 *   · **오답** — 정답을 아는 세트에서 다른 글자가 나오는 것 (대가)
 * 이득만 세면 λ 를 올리자는 결론이 자동으로 나온다. 그게 이 자가 막으려는 것이다.
 *
 * ⚠ 정답을 아는 세트는 `test/sequence-truth.json` 에 있는 것뿐이다. 나머지는
 * 「읽혔다」만 셀 수 있고 **맞았는지는 모른다** — 그 구분을 출력에 남긴다.
 *
 * 쓰기: node tools/lambda-sweep.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { createR2Session, R2_INDICATOR } from '../src/r2/session.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { Q15_ONE } from '../src/r2/params.js';
import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../src/cellSurfaceFinal.js';
import { maskValue } from '../src/mask.js';
import { unframe } from '../src/header.js';
import { readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LUMA = join(ROOT, 'test', 'output', 'photos', 'luma');
const TRUTH = JSON.parse(readFileSync(join(ROOT, 'test', 'sequence-truth.json'), 'utf8'));
const SIDE = '960';
const MAX_FRAMES = 16;
const LAMBDAS = [0.9, 0.95, 0.98, 0.99, 0.995];

const SETS = [
  'y0', 'y1', 'y2', 'y2-p9rot',
  'finder-20260820-tele', 'finder-20260820-wide',
  'cellmask-20260819-tele', 'emph-20260829',
  'v0t-crop-20260817', 'cube-20260812d', 'edge-20260904',
];

function runSet(name, lambda) {
  const dir = join(LUMA, name);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(`.${SIDE}.luma`)).sort(); } catch { return null; }
  if (!files.length) return null;
  files = files.slice(0, MAX_FRAMES);

  const params = { lambdaQ15: Math.round(lambda * Q15_ONE) };
  const adapters = createA3Adapters({});
  const detection = { found: 0, family: 0, n: 0, H: null, layoutId: '', faceLabels: null };
  let n = 0;
  for (const file of files) {
    const luma = readLumaDump(join(dir, file));
    adapters.detectInto(luma.data, luma.width, luma.height, 0, null, detection);
    if (detection.found) { n = adapters.stats.n; break; }
  }
  if (!n) return { hit: null, maxD: 0 };

  // 후보 전수 — 런타임과 같은 형태로 돌린다 (레이아웃은 본문 RS 가 가른다).
  let ids;
  try { ids = finalLayoutIdsForN(n); } catch { return { hit: null, maxD: 0 }; }
  const sessions = [];
  for (const layoutId of ids) {
    let scan;
    let cap;
    try {
      scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId);
      cap = capacityForCellSurfaceFinal(n, 'H', 2, layoutId);
    } catch { continue; }
    const maskDigits = new Uint8Array(scan.length);
    for (let k = 0; k < scan.length; k += 1) maskDigits[k] = maskValue(scan[k].i, scan[k].j, 0);
    sessions.push({
      layoutId,
      session: createR2Session({
        layout: {
          cellCount: scan.length,
          requiredSymbolCount: cap.dataSymbols,
          nsym: cap.nsym,
          maskDigits,
          maxPayloadBytes: cap.dataBytes,
          payloadBytes: cap.dataBytes,
        },
        params,
        detectInto: adapters.detectInto,
        alignInto: adapters.alignInto,
        decodeInto: createRsDecodeInto({ codewordCapacity: Math.floor(scan.length / 3) }),
      }),
    });
  }

  let maxD = 0;
  for (let index = 0; index < files.length; index += 1) {
    const luma = readLumaDump(join(dir, files[index]));
    for (const entry of sessions) {
      const r = entry.session.pushFrame(luma.data, luma.width, luma.height, index * 100, null);
      if (r.progress && r.progress.D > maxD) maxD = r.progress.D;
      if (r.indicator !== R2_INDICATOR.DONE) continue;
      let text = null;
      try { text = unframe(Uint8Array.from(r.payload.slice(0, r.payloadLength))).text; } catch { continue; }
      return { hit: { text, layoutId: entry.layoutId, frame: index }, maxD };
    }
  }
  return { hit: null, maxD };
}

console.log('세트                          정답      | ' + LAMBDAS.map((l) => `λ=${l}`.padStart(9)).join(' '));
let gains = 0;
let wrongs = 0;
for (const name of SETS) {
  const expect = (TRUTH[name] && TRUTH[name].expect) ?? null;
  const cells = [];
  let base = null;
  for (const lambda of LAMBDAS) {
    const r = runSet(name, lambda);
    if (!r) { cells.push('       —'); continue; }
    if (lambda === LAMBDAS[0]) base = !!r.hit;
    if (!r.hit) { cells.push(`  D${r.maxD.toFixed(2)}`.padStart(9)); continue; }
    const verdict = expect === null ? '?' : (r.hit.text === expect ? '✓' : '✗');
    if (verdict === '✗') wrongs += 1;
    if (!base && verdict !== '✗') gains += 1;
    cells.push(`f${r.hit.frame}${verdict}`.padStart(9));
  }
  console.log(`${name.padEnd(29)}${(expect === null ? '(모름)' : '(있음)').padEnd(10)}| ${cells.join(' ')}`);
}
console.log(`\nλ 를 올려 **새로 읽힌** 칸 ${gains} · **오답** 칸 ${wrongs}`);
console.log('✓=정답 · ✗=오답 · ?=정답 모름(읽히기는 함) · D=미복호 최대진행률');
