/**
 * d-plateau-probe.mjs — **진행률 D 가 «오르다 마는가» 아니면 «일찍 평평해지는가».**
 *
 * 🔴 왜 있나 (2026-09-05 운영자 실기 2차):
 * > 「게이지가 생각처럼 착착 올라가지 않네, 보통 어느정도에서 멈춰있음. 그러다 읽힐
 * >  때는 바로 읽히고. 수십초 들고있어도 특정 벽을 못 넘는 경우가 많은데?」
 *
 * 이것이 사실이면 **누적의 전제가 깨진 것**이다. 누적은 «독립 잡음» 을 평균해서 이긴다.
 * 그런데 실패가 **체계적**이면(같은 셀이 같은 이유로 매 프레임 애매하면) 프레임을 더
 * 봐도 그 셀은 영원히 안 선다 — D 는 벽에 붙고 시간은 아무것도 못 산다.
 *
 * 재는 것: 프레임별 D 궤적. 그리고 **어디서 평평해지는가**.
 *   · 계속 오르면 → 시간이 부족한 것 (프레임을 더 주면 된다)
 *   · 일찍 평평하면 → **구조적** — 더 기다려도 안 된다. 처방이 완전히 다르다.
 *
 * ⚠ 이 자는 «왜 그 셀이 안 서는가» 는 답하지 않는다. 「기다림이 답인가 아닌가」만 가른다.
 *
 * 쓰기: node tools/d-plateau-probe.mjs [세트...]
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LUMA = join(ROOT, 'test', 'output', 'photos', 'luma');
const SIDE = '960';

/** 성공 세트 둘 + 실패 세트 넷 (최대 D 가 서로 다른 높이에서 멈춘 것들). */
const DEFAULT = [
  'y2/y2', 'y0/y0',
  'v0t-crop-20260817', 'emph-20260829', 'cube-20260812d', 'finder-20260820-wide',
];

function trace(name) {
  const dir = join(LUMA, name);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(`.${SIDE}.luma`)).sort();
  } catch { return null; }
  if (!files.length) return null;

  const runtime = createR2ScanRuntime({ enabled: true });
  const series = [];
  let done = -1;
  files.forEach((file, index) => {
    let luma;
    try { luma = readLumaDump(join(dir, file)); } catch { return; }
    const hit = runtime.pushFrame(luma, index * 100);
    if (hit && done < 0) done = index;
    series.push(runtime.stats.progressD);
  });
  return { name, series, done, frames: files.length, lockedN: runtime.stats.lockedN };
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
console.log('세트                         락n  DONE | D 궤적 (프레임 순)');
for (const name of targets) {
  const r = trace(name);
  if (!r) { console.log(`${name.padEnd(28)} 건너뜀 (덤프 없음)`); continue; }
  const s = r.series;
  // 평평해진 지점 — 이후 증가분이 전부 0.01 미만인 첫 프레임.
  let plateauAt = -1;
  for (let i = 0; i < s.length; i += 1) {
    let flat = true;
    for (let j = i + 1; j < s.length; j += 1) {
      if (s[j] - s[i] > 0.01) { flat = false; break; }
    }
    if (flat) { plateauAt = i; break; }
  }
  const shown = s.slice(0, 24).map((d) => d.toFixed(2)).join(' ');
  console.log(
    `${r.name.padEnd(28)} n${String(r.lockedN).padEnd(3)} ${String(r.done < 0 ? '—' : `f${r.done}`).padStart(4)} | ${shown}${s.length > 24 ? ' …' : ''}`,
  );
  console.log(
    `${''.padEnd(28)}      최대 ${Math.max(...s).toFixed(2)}`
    + ` · 평평해진 프레임 ${plateauAt < 0 ? '—' : `f${plateauAt}`}`
    + ` / 전체 ${s.length}`
    + (plateauAt >= 0 && r.done < 0
      ? `  🔴 f${plateauAt} 이후 ${s.length - plateauAt}프레임이 **아무것도 못 벌었다**`
      : ''),
  );
}
