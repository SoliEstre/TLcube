/**
 * r2-runtime-probe.mjs — **S5 런타임을 코퍼스로 잰다.**
 *
 * `createR2ScanRuntime` 은 어댑터를 **공유**해 후보 세션을 병렬로 돌린다. 그 설계가
 * 실제로 비용을 깎는지, 그리고 먼저 복호되는 쪽이 참 격자인지를 여기서 확인한다.
 *
 * 비교 대상은 `test/output/ltc-gain-postfix.json` 의 단발 팔 (PM/029B §20.1):
 *   y0 1,440 ms · y1 2,768 ms · y2 2,309 ms (첫 성공까지 벽시계)
 *
 * ⚠ 이 자가 못 재는 축: 라이브 프레임률·손떨림. 10 fps 리플레이다.
 *
 * 쓰기: node tools/r2-runtime-probe.mjs [시퀀스...]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { listLumaSequences, readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TRUTH = JSON.parse(readFileSync(join(ROOT, 'test', 'sequence-truth.json'), 'utf8'));
const LABELS = JSON.parse(readFileSync(join(ROOT, 'tools', 'a3-wire-labels.json'), 'utf8'));

// PM/029B §20.1 의 단발 팔 (같은 기계가 아니면 비율만 인용해야 한다).
const SINGLE_MS = Object.freeze({ y0: 1440, y1: 2768, y2: 2309 });

function run(name) {
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === name);
  if (!seq || !seq.frames.length) return { name, skipped: 'no-dump' };
  const spec = LABELS.sequences[name];
  const expect = (TRUTH[name] && TRUTH[name].expect) ?? null;
  const runtime = createR2ScanRuntime({ enabled: true });

  let cumulativeMs = 0;
  const frameMs = [];
  for (let i = 0; i < seq.frames.length; i += 1) {
    const dump = readLumaDump(seq.frames[i].path);
    const t0 = performance.now();
    const hit = runtime.pushFrame(dump, i * 100);
    const ms = performance.now() - t0;
    cumulativeMs += ms;
    if (frameMs.length < 10) frameMs.push(Math.round(ms));
    if (hit) {
      return {
        name,
        done: true,
        frame: i,
        msToDone: Math.round(cumulativeMs),
        layoutId: hit.layoutId,
        truthLayout: spec && spec.layoutId,
        layoutRight: !!spec && hit.layoutId === spec.layoutId,
        text: hit.text,
        correct: expect !== null && hit.text === expect,
        candidates: runtime.stats.candidateCount,
        binds: runtime.stats.binds,
        frameMs,
      };
    }
  }
  return {
    name,
    done: false,
    frame: -1,
    msToDone: null,
    candidates: runtime.stats.candidateCount,
    binds: runtime.stats.binds,
    frames: seq.frames.length,
    msPerFrame: Number((cumulativeMs / seq.frames.length).toFixed(2)),
    frameMs,
  };
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['y0', 'y1', 'y2', 'y2-p9rot'];
console.log('시퀀스     후보 bind | DONE  f   msToDone  격자  글자  | 단발ms  이득');
for (const name of targets) {
  const r = run(name);
  if (r.skipped) { console.log(`${name.padEnd(10)} 건너뜀 (${r.skipped})`); continue; }
  const single = SINGLE_MS[name];
  if (r.done) {
    const gain = single ? (single / r.msToDone).toFixed(1) + '×' : '—';
    console.log(
      `${name.padEnd(10)} ${String(r.candidates).padStart(4)} ${String(r.binds).padStart(4)} |`
      + `  ✓  ${String(r.frame).padStart(2)} ${String(r.msToDone).padStart(9)} `
      + ` ${r.layoutRight ? '★맞음' : '✗' + r.layoutId} ${r.correct ? '정답' : '**오답**'}`
      + ` | ${String(single ?? '—').padStart(6)} ${gain.padStart(6)}`,
    );
  } else {
    console.log(
      `${name.padEnd(10)} ${String(r.candidates).padStart(4)} ${String(r.binds).padStart(4)} |`
      + `  ✗   —         —                  |`
      + ` ${r.frames}프레임 · ${r.msPerFrame} ms/프레임`,
    );
  }
  console.log(`           첫 10프레임 ms: [${r.frameMs.join(', ')}]`);
}
