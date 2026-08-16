/**
 * claude-skew-real-widecmp.mjs — 초광각 45런 vs 표준 72런(lab) **깔때기 대조 집계**.
 *
 * 두 코퍼스의 원자료 JSON 만 읽어 단계별 통과/거절을 같은 자로 센다. 추정하지 않는다 —
 * 원자료에 없는 필드는 null 로 남긴다. 결정적(난수 없음).
 *
 * 사용: node tools/probes/claude-skew-real-widecmp.mjs [--json <out.json>]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LANES = join(ROOT, 'test', 'output', 'lanes');

const read = (f) => JSON.parse(readFileSync(join(LANES, f), 'utf8'));

function collect(rows, label) {
  const lab = rows.filter((r) => r.opt === 'lab');
  const acc = {
    label,
    runsAll: rows.length,
    runsLab: lab.length,
    ok: lab.filter((r) => r.ok).length,
    reasons: {},
    poseFrames: 0,
    poseV0Median: null,
    csAttempt: {},
    csAccept: {},
    csBest: {},
    csReasons: {},
    cubeHypFrames: 0,
    qrHypValues: [],
    formatProposalFrames: 0,
    fillRatio: [],
    touchesBorder: { true: 0, false: 0 },
    cubeCause: {},
    silhouetteRejections: {},
    msList: [],
  };
  const poseV0 = [];
  for (const r of lab) {
    acc.reasons[r.ok ? '(ok)' : r.reason] = (acc.reasons[r.ok ? '(ok)' : r.reason] || 0) + 1;
    const pose = r.csBlockLocator && r.csBlockLocator.poseCount;
    if (pose && Number.isFinite(pose.v0)) { poseV0.push(pose.v0); if (pose.v0 >= 2) acc.poseFrames += 1; }
    for (const l of r.layouts || []) {
      acc.csAttempt[l.layoutId] = (acc.csAttempt[l.layoutId] || 0) + l.attempted;
      acc.csAccept[l.layoutId] = (acc.csAccept[l.layoutId] || 0) + l.accepted;
      if (Number.isFinite(l.bestScore)) {
        acc.csBest[l.layoutId] = Math.max(acc.csBest[l.layoutId] ?? -1, l.bestScore);
      }
      for (const [k, v] of Object.entries(l.reasons || {})) {
        const key = `${l.layoutId}:${k}`;
        acc.csReasons[key] = (acc.csReasons[key] || 0) + v;
      }
    }
    if ((r.cube && r.cube.hypothesisCount) > 0) acc.cubeHypFrames += 1;
    if (r.qr && Number.isFinite(r.qr.hypothesisCount)) acc.qrHypValues.push(r.qr.hypothesisCount);
    if ((r.format && r.format.formatProposalCount) > 0) acc.formatProposalFrames += 1;
    if (r.outline) {
      if (Number.isFinite(r.outline.fillRatio)) acc.fillRatio.push(r.outline.fillRatio);
      acc.touchesBorder[String(r.outline.touchesBorder === true)] += 1;
    }
    const cause = r.cube && r.cube.cause;
    acc.cubeCause[cause || '(none)'] = (acc.cubeCause[cause || '(none)'] || 0) + 1;
    for (const [k, v] of Object.entries((r.silhouette && r.silhouette.rejections) || {})) {
      acc.silhouetteRejections[k] = (acc.silhouetteRejections[k] || 0) + v;
    }
    if (Number.isFinite(r.ms)) acc.msList.push(r.ms);
  }
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  acc.poseV0Median = med(poseV0);
  acc.fillRatioMin = acc.fillRatio.length ? Math.min(...acc.fillRatio) : null;
  acc.fillRatioMax = acc.fillRatio.length ? Math.max(...acc.fillRatio) : null;
  acc.fillRatioMedian = med(acc.fillRatio);
  acc.fillRatioN = acc.fillRatio.length;
  delete acc.fillRatio;
  acc.msMedian = med(acc.msList);
  acc.msMax = acc.msList.length ? Math.max(...acc.msList) : null;
  delete acc.msList;
  acc.qrHypMedian = med(acc.qrHypValues);
  acc.qrHypMin = acc.qrHypValues.length ? Math.min(...acc.qrHypValues) : null;
  acc.qrHypMax = acc.qrHypValues.length ? Math.max(...acc.qrHypValues) : null;
  delete acc.qrHypValues;
  return acc;
}

const stdRows = [...read('claude-skew-real-results.json'),
  ...read('claude-skew-real-crops.json'), ...read('claude-skew-real-crops2.json')];
const wideRows = read('claude-skew-real-wide.json');

const out = { standard: collect(stdRows, 'standard(6장)'), wide: collect(wideRows, 'wide(3장)') };

function show(a) {
  console.log(`\n=== ${a.label} — lab ${a.runsLab} 런 (전체 ${a.runsAll}) ===`);
  console.log(`복호 성공 ${a.ok}/${a.runsLab}`);
  console.log('사유:', JSON.stringify(a.reasons));
  console.log(`pose_v0 ≥ 2 프레임 ${a.poseFrames}/${a.runsLab} (중앙값 ${a.poseV0Median})`);
  for (const id of ['v0', 'v0x', 'v2r2', 'v1r2']) {
    if (!a.csAttempt[id]) continue;
    const rs = Object.entries(a.csReasons).filter(([k]) => k.startsWith(`${id}:`))
      .map(([k, v]) => `${k.slice(id.length + 1)} ${v}`).join(' · ');
    console.log(`  ${id.padEnd(5)} 시도 ${String(a.csAttempt[id]).padStart(6)} 수용 ${String(a.csAccept[id]).padStart(4)}`
      + ` 최고 ${a.csBest[id]?.toFixed(4)}  | ${rs}`);
  }
  console.log(`cube.hypothesisCount ≥1 프레임 ${a.cubeHypFrames}/${a.runsLab} · formatProposal ≥1 ${a.formatProposalFrames}/${a.runsLab}`);
  console.log(`qr.hypothesisCount 중앙값 ${a.qrHypMedian} (${a.qrHypMin}–${a.qrHypMax})`);
  console.log(`fillRatio ${a.fillRatioMin?.toFixed(4)}–${a.fillRatioMax?.toFixed(4)} 중앙값 ${a.fillRatioMedian?.toFixed(4)} (n=${a.fillRatioN}) · touchesBorder true ${a.touchesBorder.true} / false ${a.touchesBorder.false}`);
  console.log('cube.cause:', JSON.stringify(a.cubeCause));
  console.log('실루엣 rejection:', JSON.stringify(a.silhouetteRejections));
  console.log(`시간 중앙값 ${a.msMedian} ms · 최대 ${a.msMax} ms`);
}

show(out.standard);
show(out.wide);

const idx = process.argv.indexOf('--json');
if (idx >= 0 && process.argv[idx + 1]) {
  writeFileSync(process.argv[idx + 1], JSON.stringify(out, null, 1));
  console.log(`\n→ ${process.argv[idx + 1]}`);
}
void basename;
