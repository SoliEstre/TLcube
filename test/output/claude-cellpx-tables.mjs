/**
 * claude-cellpx-tables.mjs — 스윕 JSON → 마크다운 표 (읽기 전용, 커밋 대상 아님).
 * 붕괴 문턱 = 그 레이아웃의 성공률이 처음으로 100% 가 되는 최소 cell_px,
 * 그리고 «완전 붕괴(0%)» 를 벗어나는 최소 cell_px 를 함께 낸다.
 */
import { readFileSync } from 'node:fs';

const sweep = JSON.parse(readFileSync(new URL('./claude-cellpx-sweep.json', import.meta.url), 'utf8'));
const rows = sweep.rows;
const CELL_PX = [...new Set(rows.map((r) => r.cellPx))].sort((a, b) => a - b);
const LAYOUTS = ['v0', 'v1r2', 'v2r2'];
const CHANNELS = [...new Set(rows.map((r) => r.channel))];
const ROTS = [...new Set(rows.map((r) => r.deg))].sort((a, b) => a - b);
const TONES = [...new Set(rows.map((r) => r.tones))].sort((a, b) => a - b);

const sel = (f) => rows.filter((r) => Object.entries(f).every(([k, v]) => v === undefined || r[k] === v));
const pct = (s) => (s.length ? Math.round((s.filter((r) => r.ok).length / s.length) * 100) : null);
const frac = (s) => (s.length ? `${s.filter((r) => r.ok).length}/${s.length}` : '—');
const cell = (s) => (s.length ? `${pct(s)}% (${frac(s)})` : '—');

const out = [];
const p = (line) => out.push(line);

// ── 표 1: cell_px × 레이아웃 총괄 ──────────────────────────────────────────
p('### 표 1 — cell_px × 레이아웃 총괄 성공률 (30 조합/칸: 2·3톤 × 회전 3 × 채널 5)');
p('');
p('| cell_px | 셀 가로폭 px | ' + LAYOUTS.map((l) => l + (l === 'v0' ? '@13' : '@21')).join(' | ') + ' |');
p('|---|---|' + LAYOUTS.map(() => '---').join('|') + '|');
for (const c of CELL_PX) {
  p(`| **${c}** | ${(Math.sqrt(3) * c).toFixed(1)} | `
    + LAYOUTS.map((l) => cell(sel({ cellPx: c, layout: l }))).join(' | ') + ' |');
}
p('');

// ── 표 2: 채널별 ──────────────────────────────────────────────────────────
p('### 표 2 — cell_px × 레이아웃 × 왜곡 채널 (6 조합/칸: 2·3톤 × 회전 3)');
p('');
p('| cell_px | 레이아웃 | ' + CHANNELS.join(' | ') + ' |');
p('|---|---|' + CHANNELS.map(() => '---').join('|') + '|');
for (const c of CELL_PX) {
  for (const l of LAYOUTS) {
    p(`| ${c} | ${l} | ` + CHANNELS.map((ch) => cell(sel({ cellPx: c, layout: l, channel: ch }))).join(' | ') + ' |');
  }
}
p('');

// ── 표 3: 회전별 ──────────────────────────────────────────────────────────
p('### 표 3 — cell_px × 레이아웃 × 회전 (10 조합/칸: 2·3톤 × 채널 5)');
p('');
p('| cell_px | 레이아웃 | ' + ROTS.map((d) => d + '°').join(' | ') + ' |');
p('|---|---|' + ROTS.map(() => '---').join('|') + '|');
for (const c of CELL_PX) {
  for (const l of LAYOUTS) {
    p(`| ${c} | ${l} | ` + ROTS.map((d) => cell(sel({ cellPx: c, layout: l, deg: d }))).join(' | ') + ' |');
  }
}
p('');

// ── 표 4: 톤별 ────────────────────────────────────────────────────────────
p('### 표 4 — cell_px × 레이아웃 × 톤 수 (15 조합/칸: 회전 3 × 채널 5)');
p('');
p('| cell_px | ' + LAYOUTS.flatMap((l) => TONES.map((t) => `${l} ${t}톤`)).join(' | ') + ' |');
p('|---|' + LAYOUTS.flatMap(() => TONES.map(() => '---')).join('|') + '|');
for (const c of CELL_PX) {
  p(`| ${c} | ` + LAYOUTS.flatMap((l) => TONES.map((t) => cell(sel({ cellPx: c, layout: l, tones: t })))).join(' | ') + ' |');
}
p('');

// ── 표 5: 붕괴 문턱 ───────────────────────────────────────────────────────
p('### 표 5 — 붕괴 문턱 (핵심 산출물)');
p('');
p('| 레이아웃 | 완전붕괴(0%) 상한 | 첫 회복(>0%) | 실용선(≥90%) | 무결(100%) | 무왜곡만 100% |');
p('|---|---|---|---|---|---|');
const thresholds = {};
for (const l of LAYOUTS) {
  const series = CELL_PX.map((c) => ({ c, pctAll: pct(sel({ cellPx: c, layout: l })), pctClean: pct(sel({ cellPx: c, layout: l, channel: 'clean' })) }));
  const zeroMax = [...series].reverse().find((s) => s.pctAll === 0);
  const first = series.find((s) => s.pctAll > 0);
  const p90 = series.find((s) => s.pctAll >= 90);
  const p100 = series.find((s) => s.pctAll === 100);
  const clean100 = series.find((s) => s.pctClean === 100);
  thresholds[l] = { series, zeroMax, first, p90, p100, clean100 };
  p(`| **${l}** | ${zeroMax ? zeroMax.c : '—'} | ${first ? first.c : '없음'} | ${p90 ? p90.c : '없음'} | ${p100 ? p100.c : '없음'} | ${clean100 ? clean100.c : '없음'} |`);
}
p('');

// ── 표 6: 실패 사유 분포 ──────────────────────────────────────────────────
p('### 표 6 — 실패 사유 분포 (cell_px × 레이아웃)');
p('');
p('| cell_px | 레이아웃 | 실패 | no-finder | no-grid-hyp | no-format-cand | 기타 |');
p('|---|---|---|---|---|---|---|');
for (const c of CELL_PX) {
  for (const l of LAYOUTS) {
    const s = sel({ cellPx: c, layout: l });
    const bad = s.filter((r) => !r.ok);
    const cnt = (k) => bad.filter((r) => r.reason === k).length;
    const known = ['frontend:no-finder', 'frontend:no-grid-hypothesis', 'frontend:no-format-candidate'];
    const other = bad.filter((r) => !known.includes(r.reason));
    const otherHist = {};
    for (const r of other) otherHist[r.reason] = (otherHist[r.reason] || 0) + 1;
    p(`| ${c} | ${l} | ${bad.length}/${s.length} | ${cnt(known[0])} | ${cnt(known[1])} | ${cnt(known[2])} | ${Object.entries(otherHist).map(([k, v]) => `${k.replace('frontend:', '')}×${v}`).join(', ') || '—'} |`);
  }
}
p('');

// ── 표 7: 로케이터 / 프로브 / 캔버스 ──────────────────────────────────────
p('### 표 7 — 로케이터 앵커 검출률 · 캔버스 · 로케이터 유효 해상도');
p('');
p('| cell_px | 레이아웃 | 캔버스 px | 로케이터 다운샘플 | 유효 cell_px | 앵커 검출(shape>0) | CS 프로브 accept | 본문 복호 |');
p('|---|---|---|---|---|---|---|---|');
for (const c of CELL_PX) {
  for (const l of LAYOUTS) {
    const s = sel({ cellPx: c, layout: l });
    const canvas = [...new Set(s.map((r) => r.canvas))].join('/');
    const ds = [...new Set(s.map((r) => r.locDownsample))].join('/');
    const eff = [...new Set(s.map((r) => r.effectiveCellPx))].join('/');
    const loc = s.filter((r) => r.locShapes > 0).length;
    const probe = s.filter((r) => r.probeAccepted).length;
    p(`| ${c} | ${l} | ${canvas} | ${ds}× | ${eff} | ${Math.round((loc / s.length) * 100)}% (${loc}/${s.length}) | ${Math.round((probe / s.length) * 100)}% (${probe}/${s.length}) | ${cell(s)} |`);
  }
}
p('');

// ── 표 8: 복호 시간 ───────────────────────────────────────────────────────
p('### 표 8 — 평균 복호 시간 ms (성공 행만 / 전체)');
p('');
p('| cell_px | ' + LAYOUTS.join(' | ') + ' |');
p('|---|' + LAYOUTS.map(() => '---').join('|') + '|');
for (const c of CELL_PX) {
  p(`| ${c} | ` + LAYOUTS.map((l) => {
    const s = sel({ cellPx: c, layout: l });
    const okRows = s.filter((r) => r.ok);
    const mean = (a) => (a.length ? Math.round(a.reduce((x, r) => x + r.ms, 0) / a.length) : null);
    return `${okRows.length ? mean(okRows) : '—'} / ${mean(s)}`;
  }).join(' | ') + ' |');
}
p('');

// ── 표 9: 캔버스 arm ──────────────────────────────────────────────────────
let canvasJson = null;
try {
  canvasJson = JSON.parse(readFileSync(new URL('./claude-cellpx-canvas.json', import.meta.url), 'utf8'));
} catch { /* 아직 없음 */ }
if (canvasJson) {
  const crows = canvasJson.rows;
  p('### 표 9 — 보조 arm: 캔버스 px ↔ 로케이터 다운샘플 결합 (회전 0 고정)');
  p('');
  p('| cell_px | 레이아웃 | raw 캔버스 | raw ds | raw 유효px | raw 성공 | embed 캔버스 | embed ds | embed 유효px | embed 성공 |');
  p('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of CELL_PX) {
    for (const l of LAYOUTS) {
      const raw = crows.filter((r) => r.cellPx === c && r.layout === l && r.arm === 'raw');
      const emb = crows.filter((r) => r.cellPx === c && r.layout === l && r.arm === 'embed');
      if (!raw.length) continue;
      const u = (a, k) => [...new Set(a.map((r) => r[k]))].join('/');
      p(`| ${c} | ${l} | ${u(raw, 'canvas')} | ${u(raw, 'ds')}× | ${u(raw, 'effectiveCellPx')} | ${frac(raw)} `
        + `| ${u(emb, 'canvas')} | ${u(emb, 'ds')}× | ${u(emb, 'effectiveCellPx')} | ${frac(emb)} |`);
    }
  }
  p('');
}

process.stdout.write(out.join('\n') + '\n');
process.stderr.write(JSON.stringify(Object.fromEntries(
  LAYOUTS.map((l) => [l, thresholds[l].series]),
), null, 2) + '\n');
