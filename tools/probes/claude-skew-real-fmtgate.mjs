/**
 * claude-skew-real-fmtgate.mjs — 포맷 단계의 **문지기**를 가설별로 분해한다.
 * 「제안이 몇 개 만들어졌고, CRC 전에 어느 의미론 게이트에서 몇 개가 잘렸는가」.
 *
 * 기존 `claude-skew-real-frontend.mjs` 의 readAccounting 은 generated/crcChecked 만
 * 합산해서 `semanticRejected` 를 버린다 — 그래서 「unique 6 인데 crcChecked 0」 이
 * 「구할 게 없었다」 로 오독됐다. 이 프로브는 그 빈칸을 채운다. 진단 전용 · src 무수정.
 *
 * 사용: node tools/probes/claude-skew-real-fmtgate.mjs <frame.rgba> [--stable] [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { readRgba } from './claude-skew-real-frontend.mjs';

function labOptions(stable) {
  return {
    bootstrap: {
      family: { cube: { enableLocatorY: !stable, enableCellSurfaceY: !stable } },
    },
  };
}

function findNodeWith(root, keys, maxDepth = 8) {
  const queue = [[root, 0]];
  const seen = new Set();
  while (queue.length > 0) {
    const [node, depth] = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node) || depth > maxDepth) continue;
    seen.add(node);
    if (keys.some((key) => Object.prototype.hasOwnProperty.call(node, key))) return node;
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push([value, depth + 1]);
    }
  }
  return null;
}

export function fmtGate(framePath, { stable = false } = {}) {
  const raster = readRgba(framePath);
  const result = decodeFrontend(raster, labOptions(stable));
  const detail = result && result.detail ? result.detail : {};
  const boot = result && result.ok
    ? result.diagnostics && result.diagnostics.bootstrap
    : detail.diagnostics;
  const validation = (boot && boot.validation)
    || (result && result.ok ? {} : (detail.cause && detail.cause.diagnostics) || {})
    || {};
  const failures = Array.isArray(validation.formatFailures) ? validation.formatFailures : [];
  const bodyFailures = Array.isArray(validation.bodyFailures) ? validation.bodyFailures : [];

  const rows = failures.map((failure) => {
    const d = failure && failure.detail ? failure.detail : {};
    const diag = d.diagnostics || {};
    return {
      hypothesisId: failure.hypothesisId ?? null,
      reason: failure.reason ?? null,
      erasedFormatCells: d.erasedFormatCells ?? null,
      reads: d.reads ?? null,
      generated: diag.generated ?? null,
      semanticRejected: diag.semanticRejected ?? null,
      crcChecked: diag.crcChecked ?? null,
      crcOk: diag.crcOk ?? null,
      crcFailed: diag.crcFailed ?? null,
    };
  });

  const totals = { generated: {}, semanticRejected: {}, crcChecked: 0, crcOk: 0, crcFailed: 0 };
  for (const row of rows) {
    for (const [k, v] of Object.entries(row.generated || {})) {
      totals.generated[k] = (totals.generated[k] || 0) + (v || 0);
    }
    for (const [k, v] of Object.entries(row.semanticRejected || {})) {
      totals.semanticRejected[k] = (totals.semanticRejected[k] || 0) + (v || 0);
    }
    totals.crcChecked += row.crcChecked || 0;
    totals.crcOk += row.crcOk || 0;
    totals.crcFailed += row.crcFailed || 0;
  }

  const geoTop = (boot && boot.geometry) || detail.geometryDiagnostics || {};
  const geometry = findNodeWith(geoTop, ['geometryReports', 'csBlockLocator']) || geoTop;

  return {
    frame: framePath,
    width: raster.width,
    height: raster.height,
    stable,
    ok: result.ok === true,
    text: result.ok === true ? result.text : null,
    reason: result.ok === true ? null : result.reason,
    pipelineCode: detail.pipelineCode ?? null,
    hypothesisCount: validation.hypothesisCount ?? null,
    formatProposalCount: validation.formatProposalCount ?? null,
    formatCandidateCount: validation.formatCandidateCount ?? null,
    bodyValidCount: validation.bodyValidCount ?? null,
    perHypothesis: rows,
    totals,
    bodyFailures: bodyFailures.map((f) => ({
      hypothesisId: f.hypothesisId ?? null,
      reason: f.reason ?? null,
      message: (f.detail && (f.detail.message || f.detail.reason)) ?? null,
    })),
    csPoseCount: (geometry.csBlockLocator && geometry.csBlockLocator.poseCount) ?? null,
  };
}

if (process.argv[1] && process.argv[1].endsWith('claude-skew-real-fmtgate.mjs')) {
  const args = process.argv.slice(2);
  const framePath = args.find((a) => !a.startsWith('--'));
  const stable = args.includes('--stable');
  const jsonIndex = args.indexOf('--json');
  const out = fmtGate(framePath, { stable });
  const text = JSON.stringify(out, null, 1);
  if (jsonIndex >= 0 && args[jsonIndex + 1]) writeFileSync(args[jsonIndex + 1], text);
  else console.log(text);
}
