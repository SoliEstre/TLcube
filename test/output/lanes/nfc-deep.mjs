// frontend:no-format-candidate 실사진 실패를 재현·분해하는 결정적 포렌식 도구.
//
// 실행:
//   node test/output/lanes/nfc-deep.mjs
//
// 359개 디코드는 CPU 비용이 크므로 worker 8개가 나눠 맡되, 출력은 원래 덤프 순서로
// 다시 정렬한다. 모든 worker는 이 포그라운드 프로세스가 끝나기 전에 합류한다.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';

import {
  listLumaDumps,
  lumaToRaster,
  readLumaDump,
} from '../../../tools/read-luma.mjs';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { rasterToPng } from '../../../src/png.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const LANE_OUT = path.join(ROOT, 'lane-out');
const WORKER_COUNT = 8;
const NFC_REASON = 'frontend:no-format-candidate';

function inferFamily(hypothesisId) {
  if (typeof hypothesisId !== 'string') return null;
  if (hypothesisId.startsWith('hex-')) return 'hex';
  if (hypothesisId.startsWith('tri-')) return 'tri';
  if (hypothesisId.startsWith('cube-')) return 'cube';
  return null;
}

function cellLabel(cell) {
  if (!cell || typeof cell !== 'object') return null;
  if (Number.isFinite(cell.q) && Number.isFinite(cell.r)) {
    return 'q=' + cell.q + ',r=' + cell.r;
  }
  if (Number.isFinite(cell.i) && Number.isFinite(cell.j)) {
    return 'i=' + cell.i + ',j=' + cell.j;
  }
  return JSON.stringify(cell);
}

function diagnosticsOf(result) {
  const detail = result && result.detail && typeof result.detail === 'object'
    ? result.detail
    : {};
  const cause = detail.cause && typeof detail.cause === 'object' ? detail.cause : {};
  const validation = cause.diagnostics && typeof cause.diagnostics === 'object'
    ? cause.diagnostics
    : detail.diagnostics && typeof detail.diagnostics === 'object'
      ? detail.diagnostics
      : {};
  const geometry = detail.geometryDiagnostics && typeof detail.geometryDiagnostics === 'object'
    ? detail.geometryDiagnostics
    : cause.geometryDiagnostics && typeof cause.geometryDiagnostics === 'object'
      ? cause.geometryDiagnostics
      : {};
  return { detail, cause, validation, geometry };
}

function firstFormatFailure(validation) {
  const failures = Array.isArray(validation.formatFailures) ? validation.formatFailures : [];
  for (const entry of failures) {
    const detail = entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
    const erased = Array.isArray(detail.erasedFormatCellDetails)
      ? detail.erasedFormatCellDetails
      : [];
    const first = detail.firstFormatCellFailure
      || erased[0]
      || (detail.cell ? { cell: detail.cell, reason: entry.reason, cause: detail.cause } : null);
    if (first) return { entry, detail, first, erased };
  }
  if (failures.length === 0) return null;
  const entry = failures[0];
  const detail = entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
  return { entry, detail, first: null, erased: [] };
}

function formatFailureLabel(failure) {
  if (!failure) return 'unobserved-format-failure';
  if (failure.first && typeof failure.first.reason === 'string'
    && failure.first.reason !== NFC_REASON) return failure.first.reason;
  if (failure.first && typeof failure.first.cause === 'string') return failure.first.cause;
  if (failure.first && typeof failure.first.reason === 'string') return failure.first.reason;
  if (typeof failure.detail.cause === 'string') return failure.detail.cause;
  if (failure.entry.reason !== NFC_REASON) return failure.entry.reason;
  if (failure.detail.stage === 'format') return 'format-crc-no-candidate';
  return failure.entry.reason || 'unobserved-format-failure';
}

function compactRow(item, luma, result) {
  const { cause, validation, geometry } = diagnosticsOf(result);
  const failure = firstFormatFailure(validation);
  const failedCells = failure
    ? failure.erased.map((entry) => cellLabel(entry.cell)).filter(Boolean)
    : [];
  const firstCell = failure && failure.first ? cellLabel(failure.first.cell) : null;
  const hypothesisId = failure ? failure.entry.hypothesisId ?? null : null;
  const family = geometry.classification?.family
    ?? result.family
    ?? failure?.entry?.family
    ?? inferFamily(hypothesisId);
  const formatHypothesisFamily = failure?.entry?.family ?? inferFamily(hypothesisId);
  const resolutionMatch = item.name.match(/\.(960|1440)\.luma$/);
  const resolution = resolutionMatch ? Number(resolutionMatch[1]) : Math.max(luma.width, luma.height);
  return {
    index: item.index,
    name: item.name,
    width: luma.width,
    height: luma.height,
    resolution,
    ok: Boolean(result.ok),
    reason: result.reason ?? null,
    family: family ?? null,
    formatHypothesisFamily: formatHypothesisFamily ?? null,
    finderCount: geometry.finderCount ?? null,
    formatCandidateCount: validation.formatCandidateCount
      ?? cause.formatCandidateCount
      ?? null,
    formatFailureReason: formatFailureLabel(failure),
    formatFailureCause: failure?.first?.cause
      ?? failure?.detail?.cause
      ?? null,
    formatFailureHypothesisId: hypothesisId,
    firstFailedCell: firstCell,
    failedCellCount: failure
      ? (failure.erased.length || failure.detail.erasedFormatCells || (firstCell ? 1 : 0))
      : 0,
    failedCells,
    outlineFillRatio: geometry.outline?.fillRatio ?? null,
    qrHypothesisCount: geometry.qr?.hypothesisCount ?? null,
  };
}

async function decodeItems(items) {
  const rows = [];
  for (const item of items) {
    const luma = readLumaDump(item.path);
    const result = decodeFrontend(lumaToRaster(luma), {});
    rows.push(compactRow(item, luma, result));
  }
  return rows;
}

if (!isMainThread) {
  decodeItems(workerData.items)
    .then((rows) => parentPort.postMessage({ rows }))
    .catch((error) => {
      parentPort.postMessage({
        error: error instanceof Error ? String(error.stack || error.message) : String(error),
      });
    });
} else {
  const dumps = listLumaDumps().map((dump, index) => ({ ...dump, index }));
  if (dumps.length !== 359) {
    throw new Error('휘도 덤프 수 불일치: ' + dumps.length + ' != 359');
  }

  const workerTotal = Math.min(WORKER_COUNT, dumps.length);
  const shards = Array.from({ length: workerTotal }, () => []);
  for (const dump of dumps) shards[dump.index % workerTotal].push(dump);

  const batches = await Promise.all(shards.map((items) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { items } });
    worker.once('message', (message) => {
      if (message.error) reject(new Error(message.error));
      else resolve(message.rows);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error('worker exit ' + code));
    });
  })));
  const rows = batches.flat().sort((left, right) => left.index - right.index);

  const tally = (values) => {
    const counts = new Map();
    for (const value of values) {
      const key = value ?? '—';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((left, right) =>
      right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), 'en'));
  };
  const nfc = rows.filter((row) => row.reason === NFC_REASON);
  const reasonCounts = tally(rows.map((row) => row.ok ? 'OK' : row.reason));
  const failureReasonCounts = tally(nfc.map((row) => row.formatFailureReason));
  const families = [...new Set(nfc.map((row) => row.family ?? '—'))]
    .sort((left, right) => String(left).localeCompare(String(right), 'en'));
  const resolutions = [...new Set(nfc.map((row) => row.resolution))]
    .sort((left, right) => left - right);

  function crossRows(columns, keyOf) {
    return failureReasonCounts.map(([reason]) => ({
      reason,
      counts: columns.map((column) => nfc.filter((row) =>
        row.formatFailureReason === reason && keyOf(row) === column).length),
    }));
  }

  fs.mkdirSync(LANE_OUT, { recursive: true });
  const renders = [];
  for (let rank = 0; rank < Math.min(2, failureReasonCounts.length); rank += 1) {
    const reason = failureReasonCounts[rank][0];
    const row = nfc.find((candidate) => candidate.formatFailureReason === reason);
    if (!row) continue;
    const source = dumps[row.index];
    const luma = readLumaDump(source.path);
    const raster = lumaToRaster(luma);
    const png = rasterToPng(raster);
    const reasonSlug = reason.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const sourceSlug = path.basename(row.name, '.luma').replace(/[^a-z0-9._-]+/gi, '-');
    const targetName = 'nfc-dominant-' + (rank + 1) + '-' + reasonSlug + '-' + sourceSlug + '.png';
    const target = path.join(LANE_OUT, targetName);
    fs.writeFileSync(target, png);
    renders.push({
      rank: rank + 1,
      reason,
      source: row.name,
      target: 'lane-out/' + targetName,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  }

  const lines = [];
  lines.push('command: node test/output/lanes/nfc-deep.mjs');
  lines.push('workers: ' + workerTotal);
  lines.push('dumps: ' + rows.length);
  lines.push('successes: ' + rows.filter((row) => row.ok).length);
  lines.push('reason distribution:');
  for (const [reason, count] of reasonCounts) lines.push('  ' + reason + ' | ' + count);
  lines.push('no-format-candidate: ' + nfc.length);
  lines.push('format first-failure distribution:');
  for (const [reason, count] of failureReasonCounts) lines.push('  ' + reason + ' | ' + count);
  lines.push('cross reason x family | ' + families.join(' | '));
  for (const row of crossRows(families, (item) => item.family ?? '—')) {
    lines.push('  ' + row.reason + ' | ' + row.counts.join(' | '));
  }
  lines.push('cross reason x resolution | ' + resolutions.join(' | '));
  for (const row of crossRows(resolutions, (item) => item.resolution)) {
    lines.push('  ' + row.reason + ' | ' + row.counts.join(' | '));
  }
  lines.push('no-format-candidate rows:');
  for (const row of nfc) {
    const { index, ...printable } = row;
    lines.push('  ' + JSON.stringify(printable));
  }
  lines.push('dominant-reason renders:');
  for (const render of renders) lines.push('  ' + JSON.stringify(render));

  const numbered = lines.map((line, index) =>
    '[L' + String(index + 1).padStart(3, '0') + '] ' + line).join('\n');
  process.stdout.write(numbered + '\n');
}
