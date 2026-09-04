/**
 * margin-ceiling-probe.mjs — **누적 마진의 «천장» 을 잰다.**
 *
 * 🔴 왜 있나 (2026-09-05): 운영자 실기 「수십초 들고있어도 특정 벽을 못 넘는다」의
 * 기전 후보. `accumulate.js` 의 갱신식이
 *
 *     next = oldValue × λ + evidence × weight      (λ = 0.9, `params.lambdaQ15`)
 *
 * 라 **지수 이동 누적**이다. 증거가 일정하면 점수는 `e/(1−λ) = 10e` 로 **수렴**한다.
 * 즉 누적 마진의 천장이 **단발 마진의 10배**이고, 그 천장이 `tauCellQ8` 아래면
 * 프레임을 아무리 더 줘도 그 셀은 **영원히 CONFIRMED 가 안 된다.**
 *
 * 재는 것: 세트마다 셀별 누적 마진의 분포와 τ 대비 위치.
 *   · 최대 마진이 τ 근처에서 멈춰 있으면 → 천장 가설과 일치
 *   · 마진이 τ 를 넘는 셀이 있는데도 D 가 안 차면 → 다른 축이다
 *
 * ⚠ 이 자는 **가설을 반증할 수 있게** 만들었다. 「천장이 원인이다」를 확인하는 게
 * 아니라 「천장이 어디 있고 τ 가 어디 있나」를 재서 **둘의 관계**를 보여 준다.
 *
 * 쓰기: node tools/margin-ceiling-probe.mjs [세트...]
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { createR2Session } from '../src/r2/session.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { createR2Params } from '../src/r2/params.js';
import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../src/cellSurfaceFinal.js';
import { maskValue } from '../src/mask.js';
import { readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LUMA = join(ROOT, 'test', 'output', 'photos', 'luma');
const SIDE = process.argv.includes('--1440') ? '1440' : '960';
const PARAMS = createR2Params();
const TAU = PARAMS.tauCellQ8;
const LAMBDA = PARAMS.lambdaQ15 / 32768;
const CEILING_FACTOR = 1 / (1 - LAMBDA);

const DEFAULT = ['y0', 'y2', 'finder-20260820-tele', 'emph-20260829', 'v0t-crop-20260817'];

function runSet(name) {
  const dir = join(LUMA, name);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(`.${SIDE}.luma`)).sort(); } catch { return null; }
  if (!files.length) return null;
  files = files.slice(0, 16);

  const adapters = createA3Adapters({});
  const detection = { found: 0, family: 0, n: 0, H: null, layoutId: '', faceLabels: null };
  let n = 0;
  for (const file of files) {
    const luma = readLumaDump(join(dir, file));
    adapters.detectInto(luma.data, luma.width, luma.height, 0, null, detection);
    if (detection.found) { n = adapters.stats.n; break; }
  }
  if (!n) return { name, skipped: 'no-lock' };

  const layoutId = finalLayoutIdsForN(n)[0];
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId);
  const cap = capacityForCellSurfaceFinal(n, 'H', 2, layoutId);
  const maskDigits = new Uint8Array(scan.length);
  for (let k = 0; k < scan.length; k += 1) maskDigits[k] = maskValue(scan[k].i, scan[k].j, 0);

  const session = createR2Session({
    layout: {
      cellCount: scan.length,
      requiredSymbolCount: cap.dataSymbols,
      nsym: cap.nsym,
      maskDigits,
      maxPayloadBytes: cap.dataBytes,
      payloadBytes: cap.dataBytes,
    },
    detectInto: adapters.detectInto,
    alignInto: adapters.alignInto,
    decodeInto: createRsDecodeInto({ codewordCapacity: Math.floor(scan.length / 3) }),
  });

  // 첫 프레임의 마진(= 단발 마진 근사)과 마지막 프레임의 마진(= 수렴값)을 둘 다 잡는다.
  let firstMargins = null;
  files.forEach((file, index) => {
    const luma = readLumaDump(join(dir, file));
    session.pushFrame(luma.data, luma.width, luma.height, index * 100, null);
    if (index === 0) {
      firstMargins = [];
      for (let c = 0; c < scan.length; c += 1) firstMargins.push(session.buffers.cellMarginsQ8[c]);
    }
  });
  const last = [];
  for (let c = 0; c < scan.length; c += 1) last.push(session.buffers.cellMarginsQ8[c]);

  const stat = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return { p50: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
  };
  const f = stat(firstMargins || last);
  const l = stat(last);
  return {
    name,
    n,
    layoutId,
    cells: scan.length,
    first: f,
    last: l,
    overTau: last.filter((m) => m >= TAU).length,
  };
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
console.log(`λ = ${LAMBDA.toFixed(3)} → 이론 천장 = 단발 마진의 ${CEILING_FACTOR.toFixed(1)}배 · τ(tauCellQ8) = ${TAU}`);
console.log('세트                          셀  | f0 마진 p50/p90/max | 수렴 마진 p50/p90/max | τ 이상 셀');
for (const name of targets) {
  const r = runSet(name);
  if (!r) { console.log(`${name.padEnd(29)} 건너뜀 (덤프 없음)`); continue; }
  if (r.skipped) { console.log(`${name.padEnd(29)} 건너뜀 (${r.skipped})`); continue; }
  console.log(
    `${r.name.padEnd(29)}${String(r.cells).padStart(4)} |`
    + ` ${String(r.first.p50).padStart(5)}/${String(r.first.p90).padStart(5)}/${String(r.first.max).padStart(5)} |`
    + ` ${String(r.last.p50).padStart(6)}/${String(r.last.p90).padStart(6)}/${String(r.last.max).padStart(6)} |`
    + ` ${String(r.overTau).padStart(4)}/${r.cells}`,
  );
}
