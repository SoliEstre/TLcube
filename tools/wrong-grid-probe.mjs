/**
 * wrong-grid-probe.mjs — **틀린 격자에서 누적이 어떻게 거동하나.**
 *
 * 🔴 왜 있나 (2026-09-04, PM/029B §23.6): S5 의 형태가 「후보별 병렬 누적, 먼저
 * 복호되는 쪽 채택」으로 확정됐는데, 그 설계는 **틀린 후보가 빨리 죽는다**를 전제한다.
 * 그런데 코퍼스를 라벨 격자로만 돌려 와서 **틀린 격자에서의 거동이 미측정**이다.
 *
 * 재는 것 셋:
 *   ① 🔴 **틀린 격자가 DONE 을 내는가** (= 오수용). 하나라도 나오면 설계가 무너진다.
 *   ② 틀린 후보가 «살아 있는» 비용 — 복호 시도 횟수와 프레임당 ms.
 *   ③ 참 격자가 이기는 프레임 vs 틀린 후보가 포기하는 프레임.
 *
 * ⚠ 이 자가 못 재는 축: 라이브 프레임률·손떨림. 10 fps 리플레이다.
 *
 * 쓰기: node tools/wrong-grid-probe.mjs [시퀀스...] [--out 파일]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { createR2Session, R2_INDICATOR } from '../src/r2/session.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../src/cellSurfaceFinal.js';
import { maskValue } from '../src/mask.js';
import { unframe } from '../src/header.js';
import { listLumaSequences, readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LABELS = JSON.parse(readFileSync(join(ROOT, 'tools', 'a3-wire-labels.json'), 'utf8'));
const TRUTH = JSON.parse(readFileSync(join(ROOT, 'test', 'sequence-truth.json'), 'utf8'));
const ECC_LEVELS = Object.freeze(['L', 'M', 'H']);
const MASK_INDICES = Object.freeze([0, 1, 2]);

/** 한 (레이아웃 × ecc × mask) 조합을 시퀀스 전체에 돌린다. */
function runCombo(paths, n, layoutId, ecc, maskIndex) {
  let scan;
  let cap;
  try {
    scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId);
    cap = capacityForCellSurfaceFinal(n, ecc, 2, layoutId);
  } catch (error) {
    return { skipped: String(error.message).slice(0, 60) };
  }
  const maskDigits = new Uint8Array(scan.length);
  for (let k = 0; k < scan.length; k += 1) {
    maskDigits[k] = maskValue(scan[k].i, scan[k].j, maskIndex);
  }
  const adapters = createA3Adapters({ n });
  const inner = createRsDecodeInto({ codewordCapacity: Math.floor(scan.length / 3) });
  let decodeAttempts = 0;
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
    decodeInto: (...args) => { decodeAttempts += 1; return inner(...args); },
  });

  let cumulativeMs = 0;
  for (let i = 0; i < paths.length; i += 1) {
    const dump = readLumaDump(paths[i]);
    const t0 = performance.now();
    const r = session.pushFrame(dump.data, dump.width, dump.height, i * 100, null);
    cumulativeMs += performance.now() - t0;
    if (r.indicator === R2_INDICATOR.DONE) {
      let text = null;
      try {
        text = unframe(Uint8Array.from(r.payload.slice(0, r.payloadLength))).text;
      } catch { text = null; }
      return {
        done: true,
        doneFrame: i,
        text,
        decodeAttempts,
        msToDone: Math.round(cumulativeMs),
        msPerFrame: Number((cumulativeMs / (i + 1)).toFixed(3)),
      };
    }
  }
  return {
    done: false,
    doneFrame: -1,
    text: null,
    decodeAttempts,
    msToDone: null,
    msPerFrame: Number((cumulativeMs / paths.length).toFixed(3)),
  };
}

function main() {
  const argv = process.argv.slice(2);
  let outPath = join(ROOT, 'test', 'output', 'wrong-grid.json');
  const names = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') { outPath = argv[i + 1]; i += 1; continue; }
    names.push(argv[i]);
  }
  if (!isAbsolute(outPath)) outPath = resolve(ROOT, outPath);
  const targets = names.length > 0 ? names : ['y0', 'y1', 'y2'];

  const results = [];
  for (const name of targets) {
    const seq = listLumaSequences().find((s) => s.name.split('/').pop() === name);
    const spec = LABELS.sequences[name];
    if (!seq || !seq.frames.length || !spec) {
      results.push({ name, skipped: 'no-dump-or-label' });
      continue;
    }
    const expect = (TRUTH[name] && TRUTH[name].expect) ?? null;
    const paths = seq.frames.map((f) => f.path);
    const candidates = finalLayoutIdsForN(spec.n);
    const rows = [];
    for (const layoutId of candidates) {
      for (const ecc of ECC_LEVELS) {
        for (const maskIndex of MASK_INDICES) {
          const r = runCombo(paths, spec.n, layoutId, ecc, maskIndex);
          if (r.skipped) continue;
          rows.push({ layoutId, ecc, maskIndex, truth: layoutId === spec.layoutId, ...r });
        }
      }
      console.error(`  [${name}] ${layoutId} 완료`);
    }
    results.push({ name, n: spec.n, truthLayout: spec.layoutId, expect, candidates, frames: paths.length, rows });
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ results }, null, 2), 'utf8');

  console.log('\n── 틀린 격자 거동 ──');
  for (const r of results) {
    if (r.skipped) { console.log(`${r.name} 건너뜀 (${r.skipped})`); continue; }
    console.log(`\n${r.name}  n=${r.n}  참 격자 ${r.truthLayout}  후보 ${r.candidates.length}개  프레임 ${r.frames}`);
    console.log('  layout   참? | DONE  프레임  글자일치  시도  ms/프레임');
    for (const layoutId of r.candidates) {
      const mine = r.rows.filter((x) => x.layoutId === layoutId);
      const dones = mine.filter((x) => x.done);
      const correct = dones.filter((x) => x.text === r.expect).length;
      const wrong = dones.length - correct;
      const attempts = mine.reduce((n, x) => n + x.decodeAttempts, 0);
      const ms = mine.reduce((n, x) => n + x.msPerFrame, 0) / (mine.length || 1);
      const first = dones.length ? Math.min(...dones.map((x) => x.doneFrame)) : -1;
      console.log(
        `  ${layoutId.padEnd(8)} ${(layoutId === r.truthLayout ? '★' : ' ').padEnd(4)}|`
        + ` ${String(dones.length).padStart(2)}/9`
        + ` ${String(first < 0 ? '—' : first).padStart(6)}`
        + ` ${String(correct).padStart(6)}정답${wrong > 0 ? ` **${wrong}오답**` : '      '}`
        + ` ${String(attempts).padStart(6)}`
        + ` ${ms.toFixed(2).padStart(9)}`,
      );
    }
    const falseAccepts = r.rows.filter((x) => x.done && !x.truth && x.text === r.expect).length;
    const garbage = r.rows.filter((x) => x.done && x.text !== r.expect).length;
    console.log(`  🔴 틀린 격자가 **정답**을 낸 조합 ${falseAccepts} · **쓰레기 DONE** ${garbage}`);
  }
  console.log(`\n→ ${outPath}`);
}

main();
