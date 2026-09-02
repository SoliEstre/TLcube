#!/usr/bin/env node
/**
 * quiet-ladder-shot.mjs — **운영자 스크린샷 안전영역 사다리**를 성공률로 판정한다.
 *
 * 왜 있나: 합성 자(`quiet-thickness-oa.mjs` · 해시 바닥 + 쌍선형 축소)는 실사진 지면의 층을
 * 못 본다 (PM/031 §18.13 — 대조군이 공표 전에 잡았다). 그래서 «판이 실물에서 도움이 되는가» 는
 * 운영자가 생성기 «TL 배치 미리보기» 로 찍은 사다리로만 답할 수 있다. 이 파일이 그 자다.
 *
 * 입력: 생성기 스크린샷 <PREFIX>-<균일면배수>.png 여러 장. `0.00` 은 «안전영역 없음» 표시다
 *   (없음일 때 UI 가 «균일 면 = 코드 폭의 1.00배» 라 적으므로 1.00 과 충돌한다 — 그래서 0.00).
 *
 * 하는 일 (이 순서):
 *   1. 사진 합성 사각형을 찾는다 (어두운 UI 크롬 대비 «행의 대부분이 밝은» 최장 구간).
 *   2. 그 안에서 코드의 중심·폭을 잰다. 판별자는 «한 창 안에 팔레트 톤이 둘 이상 섞임» 이다 —
 *      단순 색 거리(사진 화소가 섞임)도, 밀도만(하늘 같은 단일 톤 균일면이 통과)도 안 된다.
 *      ⚠ 사다리 안에서 이 값이 장마다 같아야 통제 실험이다. 다르면 그 사실이 결과다.
 *   3. 스캐너 규약으로 훑는다: 정사각 크롭(변 = 코드폭/점유율) → 쌍선형 960 축소 → decodeFrontend.
 *      한 점유율의 통과/실패는 앨리어싱 잡음이므로(§18.8) **성공률**로 판정한다.
 *   4. 짝비교(같은 점유율 격자를 공유하므로 비율 비교보다 세다)와 두께 추세를 낸다.
 *
 * 🔴 판정 규율 셋 (전부 실제로 물렸던 함정):
 *   · **원문을 확인한다.** 프레임에 TL스캐너 QR 이 함께 있으면 디코더가 그걸 읽고 ok 를 낼 수 있다.
 *     `--expect=<원문>` 을 주면 원문 일치만 성공으로 센다.
 *   · **점유율 하한은 기하가 정한다.** 크롭이 사진 밖(UI 크롬)으로 나가면 «가짜 배경» 을 재게 된다.
 *     범위 밖 점은 건너뛰고 그 수를 보고한다. 코드가 프레임을 꽉 채우면 유효 점이 급감한다.
 *   · **셀 px 을 같이 본다.** 9 px 하한 아래면 그건 배경 실험이 아니라 해상도 실험이다.
 *
 * 사용:
 *   node tools/warp/quiet-ladder-shot.mjs --dir=<디렉터리> --prefix=G4 \
 *     [--occ=0.45:0.90:0.01] [--expect=https://tl.estre.so] [--out=<경로.json>] [--md=<경로.md>]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { pngToRaster } from '../asset-render.mjs';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRAME = 960;
const CELL_PX_FLOOR = 9;

/* ── 1. 사진 합성 사각형 ───────────────────────────────────────────────────── */
const isChrome = (r, g, b) => r < 60 && g < 64 && b < 78;

export function findPhotoRect(img) {
  const { width: W, height: H, pixels: P } = img;
  const XMAX = Math.floor(W * 0.78);   // 오른쪽은 컨트롤 패널
  const rowFrac = new Float64Array(H);
  for (let y = 0; y < H; y += 1) {
    let n = 0, t = 0;
    for (let x = 0; x < XMAX; x += 3) {
      const i = (y * W + x) * 4;
      t += 1;
      if (!isChrome(P[i], P[i + 1], P[i + 2])) n += 1;
    }
    rowFrac[y] = n / t;
  }
  let best = null, cur = null;
  for (let y = 0; y < H; y += 1) {
    if (rowFrac[y] >= 0.6) { if (!cur) cur = { y0: y, y1: y }; else cur.y1 = y; }
    else { if (cur && (!best || cur.y1 - cur.y0 > best.y1 - best.y0)) best = cur; cur = null; }
  }
  if (cur && (!best || cur.y1 - cur.y0 > best.y1 - best.y0)) best = cur;
  if (!best) return null;
  let x0 = XMAX, x1 = -1;
  for (let y = best.y0; y <= best.y1; y += 4) {
    for (let x = 0; x < XMAX; x += 1) {
      const i = (y * W + x) * 4;
      if (isChrome(P[i], P[i + 1], P[i + 2])) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  return { x0, y0: best.y0, x1, y1: best.y1, w: x1 - x0 + 1, h: best.y1 - best.y0 + 1 };
}

/* ── 2. 코드 기하 — «창 안에 팔레트 톤 둘 이상» ────────────────────────────── */
const TOL = 24, WIN = 5, MIN_FRAC = 0.12, MIN_LEVELS = 2;

export function findCodeRect(img, rect, levels) {
  const { width: W, pixels: P } = img;
  const w = rect.w, h = rect.h;
  const S = levels.map(() => new Int32Array((w + 1) * (h + 1)));
  const runs = new Int32Array(levels.length);
  for (let y = 0; y < h; y += 1) {
    runs.fill(0);
    for (let x = 0; x < w; x += 1) {
      const i = ((rect.y0 + y) * W + rect.x0 + x) * 4;
      const r = P[i], g = P[i + 1], b = P[i + 2];
      for (let k = 0; k < levels.length; k += 1) {
        const L = levels[k];
        if (Math.abs(r - L.r) <= TOL && Math.abs(g - L.g) <= TOL && Math.abs(b - L.b) <= TOL) runs[k] += 1;
        S[k][(y + 1) * (w + 1) + x + 1] = S[k][y * (w + 1) + x + 1] + runs[k];
      }
    }
  }
  const box = (k, ax, ay, bx, by) => S[k][(by + 1) * (w + 1) + bx + 1] - S[k][ay * (w + 1) + bx + 1] - S[k][(by + 1) * (w + 1) + ax] + S[k][ay * (w + 1) + ax];
  const area = (2 * WIN + 1) ** 2;
  const cols = new Int32Array(w), rws = new Int32Array(h);
  let dense = 0;
  for (let y = WIN; y < h - WIN; y += 2) {
    for (let x = WIN; x < w - WIN; x += 2) {
      let hits = 0;
      for (let k = 0; k < levels.length; k += 1) if (box(k, x - WIN, y - WIN, x + WIN, y + WIN) / area >= MIN_FRAC) hits += 1;
      if (hits < MIN_LEVELS) continue;
      cols[x] += 1; rws[y] += 1; dense += 1;
    }
  }
  const span = (arr) => {
    const max = Math.max(...arr);
    const thr = Math.max(3, max * 0.10);
    let a = -1, b = -1;
    for (let i = 0; i < arr.length; i += 1) if (arr[i] >= thr) { if (a < 0) a = i; b = i; }
    return [a, b];
  };
  const [cx0, cx1] = span(cols);
  const [cy0, cy1] = span(rws);
  if (cx0 < 0 || cy0 < 0) return null;
  return {
    x0: rect.x0 + cx0, y0: rect.y0 + cy0, x1: rect.x0 + cx1, y1: rect.y0 + cy1,
    w: cx1 - cx0 + 1, h: cy1 - cy0 + 1,
    cx: rect.x0 + Math.round((cx0 + cx1) / 2), cy: rect.y0 + Math.round((cy0 + cy1) / 2),
    densePx: dense,
  };
}

/* ── 3. 스캐너 규약 훑기 ───────────────────────────────────────────────────── */
/** 쌍선형 축소 — 스캐너의 canvas drawImage 에 해당 (scan-photo.mjs 와 같은 식). */
function resample(src, sx, sy, sSide, target) {
  const out = new Uint8ClampedArray(target * target * 4);
  const scale = sSide / target;
  for (let y = 0; y < target; y += 1) {
    const fy = sy + (y + 0.5) * scale - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(fy)));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < target; x += 1) {
      const fx = sx + (x + 0.5) * scale - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(fx)));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * target + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const a = src.pixels[(y0 * src.width + x0) * 4 + c];
        const b = src.pixels[(y0 * src.width + x1) * 4 + c];
        const d = src.pixels[(y1 * src.width + x0) * 4 + c];
        const e = src.pixels[(y1 * src.width + x1) * 4 + c];
        out[o + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return { width: target, height: target, pixels: out };
}

function sweepOne(row, occs) {
  const img = pngToRaster(readFileSync(row.file));
  const { cx, cy, w: codePx } = row.code;
  const p = row.photo;
  const halfMax = Math.min(cx - p.x0, p.x0 + p.w - 1 - cx, cy - p.y0, p.y0 + p.h - 1 - cy);
  const results = [];
  for (const occ of occs) {
    const side = Math.round(codePx / occ);
    if (side / 2 > halfMax) { results.push({ occ, skipped: 'crop-outside-photo' }); continue; }
    const frame = resample(img, cx - side / 2, cy - side / 2, side, FRAME);
    const t0 = Date.now();
    let ok = false, reason = null, text = null, cellPx = null;
    try {
      const d = decodeFrontend(frame, {});
      ok = !!(d && d.ok);
      reason = ok ? 'ok' : (d && d.reason) || 'fail';
      text = ok ? String(d.text) : null;
      cellPx = d && d.hypothesis ? d.hypothesis.cellSizePx ?? null : null;
    } catch (e) { reason = 'throw:' + (e && e.message ? e.message.slice(0, 60) : String(e)); }
    results.push({ occ, side, ok, reason, text, cellPx, ms: Date.now() - t0 });
  }
  return { ...row, halfMax, occFloor: codePx / (2 * halfMax), results };
}

/* ── 짝비교 (배열 순서로 — occ 를 키로 쓰면 촘촘한 격자에서 반올림 충돌로 접힌다) ── */
function binomP(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const lg = (k) => { let s = 0; for (let i = 2; i <= k; i += 1) s += Math.log(i); return s; };
  const pk = (k) => Math.exp(lg(n) - lg(k) - lg(n - k) - n * Math.LN2);
  const obs = pk(Math.min(b, c));
  let p = 0;
  for (let k = 0; k <= n; k += 1) { const v = pk(k); if (v <= obs * 1.0000001) p += v; }
  return Math.min(1, p);
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const rank = (arr) => {
    const s = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && s[j + 1][0] === s[i][0]) j += 1;
      const rk = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[s[k][1]] = rk;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs), ry = rank(ys);
  const m = (a) => a.reduce((s, v) => s + v, 0) / n;
  const mx = m(rx), my = m(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}

/* ── main ─────────────────────────────────────────────────────────────────── */
if (!isMainThread) {
  parentPort.postMessage(workerData.rows.map((r) => sweepOne(r, workerData.occs)));
} else {
  const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const dir = arg('dir');
  const prefix = arg('prefix');
  if (!dir || !prefix) {
    console.error('사용: node tools/warp/quiet-ladder-shot.mjs --dir=<디렉터리> --prefix=<접두> [--occ=lo:hi:step] [--expect=<원문>] [--out=x.json] [--md=x.md]');
    process.exit(2);
  }
  const [lo, hi, step] = (arg('occ', '0.45:0.90:0.01')).split(':').map(Number);
  const expect = arg('expect');
  const outJson = arg('out', path.join(HERE, '..', '..', 'test', 'output', `quiet-ladder-${prefix}.json`));
  const outMd = arg('md');
  const preset = getPreset(arg('preset', DEFAULT_PRESET));
  const levels = preset.levels.map((l) => ({ r: l.r, g: l.g, b: l.b }));

  const files = readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && f.toLowerCase().endsWith('.png')).sort();
  if (!files.length) { console.error(`${dir} 에 ${prefix}-*.png 이 없다`); process.exit(2); }

  process.stderr.write(`[ladder] ${files.length}장 · 기하 측정…\n`);
  const rows = [];
  for (const f of files) {
    const file = path.join(dir, f);
    const img = pngToRaster(readFileSync(file));
    const photo = findPhotoRect(img);
    const code = photo ? findCodeRect(img, photo, levels) : null;
    if (!photo || !code) { console.error(`  ⚠ ${f}: 사진/코드 사각형을 못 찾았다 — 건너뛴다`); continue; }
    const label = f.slice(prefix.length + 1).replace(/\.png$/i, '');
    rows.push({ file, name: f, label, mult: Number(label), photo, code });
    process.stderr.write(`  ${label.padStart(5)}  code ${code.w}x${code.h} @(${code.cx},${code.cy})\n`);
  }
  /*
   * 통제 확인 — 사다리 안에서 코드가 같은 크기·같은 자리여야 «판만 바뀐» 실험이다.
   * ⚠ 엄격한 동일 비교는 **너무 빡빡했다** (2026-09-02 A1 실측): 판이 없으면 코드 가장자리가
   *   사진에 직접 닿아 톤 판별자가 한 열을 더 잡아 787 vs 785 px 가 나온다. 0.25% 차이를
   *   «통제 실패» 로 찍으면 진짜 실패(운영자가 사다리 중간에 확대/이동한 경우)와 구분이 안 된다.
   *   그래서 **폭 1% · 중심 4px** 를 허용하고, 실제 흔들림 폭을 항상 같이 찍는다.
   */
  const wSpread = Math.max(...rows.map((r) => r.code.w)) - Math.min(...rows.map((r) => r.code.w));
  const cSpread = Math.max(...rows.map((r) => Math.abs(r.code.cx - rows[0].code.cx) + Math.abs(r.code.cy - rows[0].code.cy)));
  const geomSame = wSpread <= rows[0].code.w * 0.01 && cSpread <= 4;
  process.stderr.write(`[ladder] 코드 기하 흔들림: 폭 ${wSpread}px · 중심 ${cSpread}px → ${geomSame ? '통제 실험 성립' : '🔴 통제 실패 — 결과를 두께 탓으로 읽지 마라'}\n`);

  const occs = [];
  for (let o = lo; o <= hi + 1e-9; o += step) occs.push(o);

  const nW = Math.max(1, Math.min(rows.length, (os.cpus().length || 4) - 2));
  const shards = Array.from({ length: nW }, () => []);
  rows.forEach((r, i) => shards[i % nW].push(r));
  const t0 = Date.now();
  const all = [];
  await Promise.all(shards.filter((s) => s.length).map((rowsShard) => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { rows: rowsShard, occs } });
    wk.on('message', (m) => { all.push(...m); process.stderr.write(`[ladder] ${all.length}/${rows.length}\n`); res(); });
    wk.on('error', rej);
  })));
  all.sort((a, b) => a.mult - b.mult);

  const okOf = (p) => !!(p && !p.skipped && p.ok && (!expect || p.text === expect));
  const base = all.find((r) => r.mult === 0) ?? all[0];
  const validIdx = base.results.map((p, i) => (p.skipped ? -1 : i)).filter((i) => i >= 0);
  const summary = all.map((r) => {
    let b = 0, c = 0, hit = 0;
    for (const i of validIdx) {
      const x = okOf(base.results[i]), y = okOf(r.results[i]);
      if (y) hit += 1;
      if (x && !y) b += 1;
      if (!x && y) c += 1;
    }
    const cells = r.results.filter((p) => p.cellPx).map((p) => p.cellPx).sort((a, z) => a - z);
    return {
      label: r.label, mult: r.mult, hits: hit, tried: validIdx.length, rate: hit / validIdx.length,
      baseOnly: b, thisOnly: c, pairedP: r === base ? null : binomP(b, c),
      medianCellPx: cells.length ? cells[cells.length >> 1] : null,
      occFloor: r.occFloor,
    };
  });
  const plate = summary.filter((s) => s.mult > 0);
  const rho = spearman(plate.map((s) => s.mult), plate.map((s) => s.rate));

  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };
  say(`# 안전영역 사다리 — ${prefix}`);
  say('');
  say(`점유율 ${lo}\\~${hi} step ${step} (${occs.length}점 중 유효 ${validIdx.length}점) · 기대 원문 ${expect ? `\`${expect}\`` : '(미지정 — raw ok)'}`);
  say(`코드 기하: ${rows[0].code.w}×${rows[0].code.h} @(${rows[0].code.cx},${rows[0].code.cy}) · 흔들림 폭 ${wSpread}px·중심 ${cSpread}px → ${geomSame ? "통제 성립" : "🔴 통제 실패"}`);
  const anyLow = summary.some((s) => s.medianCellPx !== null && s.medianCellPx < CELL_PX_FLOOR);
  say(`셀 px 중앙값 ${summary[0].medianCellPx ?? '—'}${anyLow ? ' 🔴 일부 칸이 9px 하한 아래 — 해상도 실험이 섞였다' : ` (9px 하한 위 — 배경 축 실험이 맞다)`}`);
  say('');
  say('| 균일 면 | 통과 | 성공률 | 없음만 | 이 칸만 | 짝 양측p |');
  say('|---|---|---|---|---|---|');
  for (const s of summary) {
    const name = s.mult === 0 ? '**없음**' : `${s.mult.toFixed(2)}배`;
    say(`| ${name} | ${s.hits}/${s.tried} | ${(s.rate * 100).toFixed(1)}% | ${s.mult === 0 ? '—' : s.baseOnly} | ${s.mult === 0 ? '—' : s.thisOnly} | ${s.pairedP === null ? '—' : s.pairedP.toFixed(4)} |`);
  }
  say('');
  say(`두께 추세 (판 ${plate.length}칸): Spearman rho = ${Number.isFinite(rho) ? rho.toFixed(3) : '—'}`);
  say(`없음 ${(summary.find((s) => s.mult === 0)?.rate * 100 || 0).toFixed(1)}% · 판 평균 ${(plate.reduce((a, s) => a + s.rate, 0) / plate.length * 100).toFixed(1)}% · 판 최고 ${(Math.max(...plate.map((s) => s.rate)) * 100).toFixed(1)}%`);
  say(`wall ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  writeFileSync(outJson, JSON.stringify({ prefix, occ: { lo, hi, step }, expect, geomSame, summary, rows: all }, null, 2));
  if (outMd) writeFileSync(outMd, `${lines.join('\n')}\n`);
  process.stderr.write(`[ladder] wrote ${outJson}${outMd ? ` · ${outMd}` : ''}\n`);
}
