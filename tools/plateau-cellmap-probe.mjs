/**
 * plateau-cellmap-probe.mjs — **D 가 멈춘 순간 셀맵이 무엇을 말하나.**
 *
 * 🔴 왜 있나 (2026-09-05): D 궤적이 일찍 평평해지는 것을 확인했다
 * (`tools/d-plateau-probe.mjs`). 「더 기다려도 안 된다」까지는 알았는데
 * **무엇이 안 서는지**를 모른다. 고칠 곳을 정하려면 그것이 필요하다.
 *
 * 재는 것: 평평해진 뒤의 셀맵 상태 분포.
 *   · 대부분이 «미관측» 이면 → 정합이 셀에 못 닿는다 (기하 축)
 *   · 관측은 됐는데 «임계 미달» 이면 → 셀당 픽셀·대비 축 (tauCellQ8)
 *   · «소거» 가 많으면 → 신뢰도 문턱 축 (erasureMarginQ8)
 * 셋은 처방이 전부 다르다.
 *
 * ⚠ 셀맵 상태값의 의미는 `src/r2/progress.js` 의 `CELL_MAP_STATE` 가 정본이다.
 * 여기서 이름을 손으로 적지 않고 **그 표를 뒤집어 쓴다**.
 *
 * 쓰기: node tools/plateau-cellmap-probe.mjs [세트...]
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { createR2Session, R2_INDICATOR } from '../src/r2/session.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { CELL_MAP_STATE } from '../src/r2/progress.js';
import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../src/cellSurfaceFinal.js';
import { maskValue } from '../src/mask.js';
import { readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LUMA = join(ROOT, 'test', 'output', 'photos', 'luma');
const SIDE = '960';

// 손 목록 금지 — 정본 표를 뒤집는다.
const STATE_NAME = Object.freeze(Object.fromEntries(
  Object.entries(CELL_MAP_STATE).map(([k, v]) => [v, k]),
));

const DEFAULT = ['y0/y0', 'finder-20260820-tele', 'emph-20260829', 'v0t-crop-20260817'];

function runSet(name) {
  const dir = join(LUMA, name);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(`.${SIDE}.luma`)).sort(); } catch { return null; }
  if (!files.length) return null;
  files = files.slice(0, 16);

  // 락 n 을 먼저 얻는다 (런타임과 같은 순서 — 검출 → 후보).
  const adapters = createA3Adapters({});
  const detection = { found: 0, family: 0, n: 0, H: null, layoutId: '', faceLabels: null };
  let n = 0;
  for (const file of files) {
    const luma = readLumaDump(join(dir, file));
    adapters.detectInto(luma.data, luma.width, luma.height, 0, null, detection);
    if (detection.found) { n = adapters.stats.n; break; }
  }
  if (!n) return { name, skipped: 'no-lock' };

  // 라인업 첫 후보로 세션 하나만 본다 — 셀맵 «분포» 를 보는 데는 충분하다.
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

  let last = null;
  let done = false;
  files.forEach((file, index) => {
    const luma = readLumaDump(join(dir, file));
    const r = session.pushFrame(luma.data, luma.width, luma.height, index * 100, null);
    if (r.indicator === R2_INDICATOR.DONE) done = true;
    last = r;
  });

  const cellMap = last && last.progress ? last.progress.cellMap : null;
  const histogram = new Map();
  if (cellMap) {
    for (let i = 0; i < cellMap.length; i += 1) {
      const key = STATE_NAME[cellMap[i]] ?? `?${cellMap[i]}`;
      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
  }
  return {
    name,
    n,
    layoutId,
    cells: scan.length,
    D: last && last.progress ? last.progress.D : 0,
    done,
    histogram,
  };
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
console.log('세트                          n/layout      셀  D     DONE | 셀맵 상태 분포');
for (const name of targets) {
  const r = runSet(name);
  if (!r) { console.log(`${name.padEnd(29)} 건너뜀 (덤프 없음)`); continue; }
  if (r.skipped) { console.log(`${name.padEnd(29)} 건너뜀 (${r.skipped})`); continue; }
  const hist = [...r.histogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
  console.log(
    `${r.name.padEnd(29)} n${String(r.n).padEnd(3)}/${r.layoutId.padEnd(6)}${String(r.cells).padStart(4)}`
    + `  ${r.D.toFixed(2)}  ${(r.done ? '✓' : '—').padStart(4)} | ${hist}`,
  );
}
