#!/usr/bin/env node
/**
 * pose-compare.mjs — 실사진 실패 프레임의 포즈 후보와 성공 포즈 구간을 비교한다.
 * worker_threads 는 이 한 포그라운드 명령이 모두 await 하며, 입력과 소스를 읽기만 한다.
 */
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { availableParallelism, cpus } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../../tools/read-luma.mjs';
import { enumerateGridHypotheses, selectGridHypothesis } from '../../../src/decoder/bootstrap.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';

const EXPECTED_DUMPS = 359;
const NFC = 'frontend:no-format-candidate';
const EXPECTED = Object.freeze({
  ok: 116,
  'frontend:symbol-clipped': 145,
  'frontend:no-format-candidate': 71,
  'frontend:no-grid-hypothesis': 27,
});
const AXES = Object.freeze(['cellSizePx', 'centerXNorm', 'centerYNorm', 'rotationDeg', 'symbolFrameRatio']);

function finite(value) { return Number.isFinite(value) ? value : null; }
function round(value) { return Number.isFinite(value) ? Number(value.toFixed(6)) : null; }
function point(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null;
}
function project(H, p) {
  if (!H || H.length !== 9 || !p) return null;
  const z = H[6] * p.x + H[7] * p.y + H[8];
  if (!Number.isFinite(z) || z === 0) return null;
  const x = (H[0] * p.x + H[1] * p.y + H[2]) / z;
  const y = (H[3] * p.x + H[4] * p.y + H[5]) / z;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
function normDeg(value) {
  let out = value % 360;
  if (out <= -180) out += 360;
  if (out > 180) out -= 360;
  return out;
}
function angleDelta(value, anchor) { return normDeg(value - anchor); }
function hexBoundary(k) {
  if (!Number.isFinite(k) || !(k > 0)) return [];
  const r = k + 0.5;
  const half = [
    { x: Math.sqrt(3) * r, y: 0 },
    { x: -Math.sqrt(3) * r / 2, y: 1.5 * r },
    { x: -Math.sqrt(3) * r / 2, y: -1.5 * r },
  ];
  return half.concat(half.map((p) => ({ x: -p.x, y: -p.y })));
}
function percentile(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (xs.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (at - lo);
}
function scalar(values) {
  const xs = values.filter(Number.isFinite);
  return { n: xs.length, p05: round(percentile(xs, 0.05)), median: round(percentile(xs, 0.5)), p95: round(percentile(xs, 0.95)) };
}
function rotation(values) {
  const xs = values.filter(Number.isFinite);
  if (xs.length === 0) return { n: 0, anchorDeg: null, p05DeltaDeg: null, medianDeltaDeg: null, p95DeltaDeg: null, p05Deg: null, medianDeg: null, p95Deg: null };
  const radians = xs.map((v) => v * Math.PI / 180);
  const anchor = Math.atan2(radians.reduce((s, v) => s + Math.sin(v), 0), radians.reduce((s, v) => s + Math.cos(v), 0)) * 180 / Math.PI;
  const ds = xs.map((v) => angleDelta(v, anchor));
  const p05 = percentile(ds, 0.05);
  const med = percentile(ds, 0.5);
  const p95 = percentile(ds, 0.95);
  return {
    n: xs.length,
    anchorDeg: round(normDeg(anchor)),
    p05DeltaDeg: round(p05), medianDeltaDeg: round(med), p95DeltaDeg: round(p95),
    p05Deg: round(normDeg(anchor + p05)), medianDeg: round(normDeg(anchor + med)), p95Deg: round(normDeg(anchor + p95)),
  };
}
function metrics(hypothesis, width, height) {
  const H = hypothesis && hypothesis.H;
  const center = point(hypothesis && hypothesis.center) || project(H, { x: 0, y: 0 });
  const xAxis = center && project(H, { x: 1, y: 0 });
  const cellSizePx = H && H.length >= 6 ? (Math.hypot(Number(H[0]), Number(H[3])) + Math.hypot(Number(H[1]), Number(H[4]))) / 2 : null;
  const rotationDeg = center && xAxis ? normDeg(Math.atan2(xAxis.y - center.y, xAxis.x - center.x) * 180 / Math.PI) : null;
  const vertices = Array.isArray(hypothesis && hypothesis.vertices) ? hypothesis.vertices.map(point).filter(Boolean) : [];
  const boundary = vertices.length >= 3 ? vertices : hexBoundary(Number(hypothesis && (hypothesis.k || hypothesis.n))).map((p) => project(H, p)).filter(Boolean);
  let symbolFrameRatio = null;
  if (boundary.length >= 3) {
    const xs = boundary.map((p) => p.x);
    const ys = boundary.map((p) => p.y);
    symbolFrameRatio = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / Math.hypot(width, height);
  }
  return {
    id: hypothesis && hypothesis.hypothesisId || null,
    family: hypothesis && hypothesis.family || null,
    source: hypothesis && hypothesis.source || null,
    cellSizePx: finite(cellSizePx),
    centerXNorm: center ? finite(center.x / width) : null,
    centerYNorm: center ? finite(center.y / height) : null,
    rotationDeg: finite(rotationDeg),
    symbolFrameRatio: finite(symbolFrameRatio),
  };
}
function complete(metric) { return AXES.every((axis) => Number.isFinite(metric && metric[axis])); }
function sessionOf(name) {
  const parts = name.split('/');
  const candidates = [parts[0] || '', (parts[parts.length - 1] || '').replace(/\.luma$/i, '')];
  for (const field of candidates) {
    let m = field.match(/^(cellmask|finder)-(\d{8})(?:[-_]|$)/i);
    if (m) return m[1].toLowerCase() + '-' + m[2];
    m = field.match(/^(KakaoTalk)_(\d{8})(?:_|$)/i);
    if (m) return 'KakaoTalk_' + m[2];
  }
  return (parts[0] || 'unclassified').replace(/\.luma$/i, '');
}
function tally(values) {
  const map = new Map();
  for (const value of values) {
    const key = value == null ? 'null' : String(value);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
function inspectDump(dump) {
  const session = sessionOf(dump.name);
  try {
    const luma = toRelativeLuminance(lumaToRaster(readLumaDump(dump.path)));
    if (luma && luma.ok === false) return { name: dump.name, session, outcome: luma.reason, error: 'luma conversion failed' };
    const enumerated = enumerateGridHypotheses(luma, undefined, {});
    if (!enumerated.ok) {
      const row = { name: dump.name, session, outcome: enumerated.reason };
      if (enumerated.reason !== NFC) return row;
      const failures = enumerated.detail && enumerated.detail.diagnostics && enumerated.detail.diagnostics.formatFailures || [];
      const geometryDiagnostics = enumerated.detail && enumerated.detail.geometryDiagnostics || {};
      const hypotheses = Array.isArray(geometryDiagnostics.poseDiagnostics) ? geometryDiagnostics.poseDiagnostics : [];
      const formatIds = failures.map((entry) => entry.hypothesisId).sort();
      const geometryIds = hypotheses.map((entry) => entry.hypothesisId).sort();
      const diagnosticAvailable = Array.isArray(geometryDiagnostics.poseDiagnostics);
      row.nfc = {
        actualFormatFailureCount: failures.length,
        geometryPoseCount: hypotheses.length,
        exactIdMatch: diagnosticAvailable && sameSet(formatIds, geometryIds),
        geometryReason: diagnosticAvailable ? null : 'pose-diagnostics-unavailable',
        formatFailureCauses: tally(failures.map((entry) => entry.detail && entry.detail.cause || entry.reason)),
        poseCandidates: hypotheses.map((entry) => metrics(entry, luma.width, luma.height)),
      };
      return row;
    }
    const validation = enumerated.diagnostics && enumerated.diagnostics.validation || {};
    const selected = selectGridHypothesis(enumerated.candidates, {
      formatProposalCount: validation.formatProposalCount,
      formatCandidateCount: validation.formatCandidateCount,
    });
    if (!selected.ok) return { name: dump.name, session, outcome: selected.reason };
    return { name: dump.name, session, outcome: 'ok', acceptedPose: metrics(selected.candidate.hypothesis, luma.width, luma.height) };
  } catch (error) {
    return { name: dump.name, session, outcome: 'exception', error: error instanceof Error ? error.message : String(error) };
  }
}
function axisReport(metricsRows) {
  return {
    cellSizePx: scalar(metricsRows.map((m) => m.cellSizePx)),
    centerXNorm: scalar(metricsRows.map((m) => m.centerXNorm)),
    centerYNorm: scalar(metricsRows.map((m) => m.centerYNorm)),
    rotationDeg: rotation(metricsRows.map((m) => m.rotationDeg)),
    symbolFrameRatio: scalar(metricsRows.map((m) => m.symbolFrameRatio)),
  };
}
function ranges(metricsRows) { return axisReport(metricsRows); }
function inScalar(value, range) {
  return Number.isFinite(value) && Number.isFinite(range.p05) && Number.isFinite(range.p95) && value >= range.p05 && value <= range.p95;
}
function inRotation(value, range) {
  if (!Number.isFinite(value) || !Number.isFinite(range.anchorDeg) || !Number.isFinite(range.p05DeltaDeg) || !Number.isFinite(range.p95DeltaDeg)) return false;
  const delta = angleDelta(value, range.anchorDeg);
  return delta >= range.p05DeltaDeg && delta <= range.p95DeltaDeg;
}
function inside(metric, healthy) {
  return complete(metric)
    && inScalar(metric.cellSizePx, healthy.cellSizePx)
    && inScalar(metric.centerXNorm, healthy.centerXNorm)
    && inScalar(metric.centerYNorm, healthy.centerYNorm)
    && inRotation(metric.rotationDeg, healthy.rotationDeg)
    && inScalar(metric.symbolFrameRatio, healthy.symbolFrameRatio);
}
function offset(value, range) {
  if (!Number.isFinite(value) || !Number.isFinite(range.p05) || !Number.isFinite(range.p95)) return null;
  const denominator = Math.max(range.p95 - range.p05, Number.EPSILON);
  if (value < range.p05) return (value - range.p05) / denominator;
  if (value > range.p95) return (value - range.p95) / denominator;
  return 0;
}
function medians(candidates) {
  return {
    cellSizePx: percentile(candidates.map((m) => m.cellSizePx), 0.5),
    centerXNorm: percentile(candidates.map((m) => m.centerXNorm), 0.5),
    centerYNorm: percentile(candidates.map((m) => m.centerYNorm), 0.5),
    rotationDeg: rotation(candidates.map((m) => m.rotationDeg)).medianDeg,
    symbolFrameRatio: percentile(candidates.map((m) => m.symbolFrameRatio), 0.5),
  };
}
function label(offsetValue) { return !Number.isFinite(offsetValue) ? 'unmeasured' : offsetValue < 0 ? 'below' : offsetValue > 0 ? 'above' : 'within'; }
function cross(nfcRows, healthy) {
  const rows = [];
  const allMeasured = [];
  for (const row of nfcRows) {
    if (!(row.nfc && row.nfc.exactIdMatch)) continue;
    const candidates = row.nfc.poseCandidates || [];
    const measured = candidates.filter(complete);
    const inRange = measured.filter((metric) => inside(metric, healthy));
    allMeasured.push(...measured);
    const median = medians(measured);
    const scaleOffset = offset(median.symbolFrameRatio, healthy.symbolFrameRatio);
    const xOffset = offset(median.centerXNorm, healthy.centerXNorm);
    const yOffset = offset(median.centerYNorm, healthy.centerYNorm);
    rows.push({
      name: row.name, session: row.session, candidateCount: candidates.length, measuredCount: measured.length, inRangeCount: inRange.length,
      scaleOffset, xOffset, yOffset,
      centerOffsetMagnitude: Number.isFinite(xOffset) && Number.isFinite(yOffset) ? Math.hypot(xOffset, yOffset) : null,
    });
  }
  const deviations = rows.filter((row) => Number.isFinite(row.scaleOffset) && Number.isFinite(row.centerOffsetMagnitude));
  return {
    rows,
    summary: {
      verifiedFrames: rows.length,
      totalCandidates: rows.reduce((sum, row) => sum + row.candidateCount, 0),
      measuredCandidates: allMeasured.length,
      candidatesInsideAllAxes: allMeasured.filter((metric) => inside(metric, healthy)).length,
      zeroInsideFrames: rows.filter((row) => row.inRangeCount === 0).length,
      insideCountPerFrame: scalar(rows.map((row) => row.inRangeCount)),
      insideCountHistogram: tally(rows.map((row) => row.inRangeCount)),
      scaleDirection: tally(deviations.map((row) => label(row.scaleOffset))),
      centerXDirection: tally(deviations.map((row) => label(row.xOffset))),
      centerYDirection: tally(deviations.map((row) => label(row.yOffset))),
      scaleOffset: scalar(deviations.map((row) => row.scaleOffset)),
      centerOffsetMagnitude: scalar(deviations.map((row) => row.centerOffsetMagnitude)),
      scaleDominantFrames: deviations.filter((row) => Math.abs(row.scaleOffset) > row.centerOffsetMagnitude).length,
      centerDominantFrames: deviations.filter((row) => Math.abs(row.scaleOffset) < row.centerOffsetMagnitude).length,
      tiedDominanceFrames: deviations.filter((row) => Math.abs(row.scaleOffset) === row.centerOffsetMagnitude).length,
    },
  };
}
function sessions(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.session)) map.set(row.session, []);
    map.get(row.session).push(row);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map((entry) => {
    const values = entry[1];
    return {
      session: entry[0], total: values.length,
      ok: values.filter((row) => row.outcome === 'ok').length,
      noFormatCandidate: values.filter((row) => row.outcome === NFC).length,
      otherFailures: values.filter((row) => row.outcome !== 'ok' && row.outcome !== NFC).length,
    };
  });
}
function sessionControl(rows) {
  const reports = [];
  for (const entry of sessions(rows)) {
    if (entry.ok === 0 || entry.noFormatCandidate === 0) continue;
    const group = rows.filter((row) => row.session === entry.session);
    const successes = group.filter((row) => row.outcome === 'ok').map((row) => row.acceptedPose);
    const failed = group.filter((row) => row.outcome === NFC);
    const healthy = ranges(successes);
    reports.push({ session: entry.session, successFrames: successes.length, nfcFrames: failed.length, healthy: axisReport(successes), cross: cross(failed, healthy).summary });
  }
  return reports;
}
function mergeCauses(rows) {
  const map = new Map();
  for (const row of rows) for (const pair of Object.entries(row.nfc && row.nfc.formatFailureCauses || {})) map.set(pair[0], (map.get(pair[0]) || 0) + pair[1]);
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}
function render(rows, workerCount) {
  let line = 1;
  const lines = [];
  const emit = (kind, payload) => {
    lines.push('[L' + String(line).padStart(3, '0') + '] ' + kind + ' ' + (typeof payload === 'string' ? payload : JSON.stringify(payload)));
    line += 1;
  };
  const outcomes = tally(rows.map((row) => row.outcome));
  const censusPass = Object.keys(EXPECTED).every((key) => outcomes[key] === EXPECTED[key]) && Object.keys(outcomes).length === Object.keys(EXPECTED).length;
  const successRows = rows.filter((row) => row.outcome === 'ok');
  const nfcRows = rows.filter((row) => row.outcome === NFC);
  const successMetrics = successRows.map((row) => row.acceptedPose);
  const healthy = ranges(successMetrics);
  const verified = nfcRows.filter((row) => row.nfc && row.nfc.exactIdMatch);
  const candidateMetrics = verified.flatMap((row) => row.nfc.poseCandidates || []);
  const allCross = cross(verified, healthy);
  const integrity = {
    nfcFrames: nfcRows.length,
    exactIdMatchFrames: verified.length,
    mismatchFrames: nfcRows.length - verified.length,
    actualFormatFailures: nfcRows.reduce((sum, row) => sum + (row.nfc && row.nfc.actualFormatFailureCount || 0), 0),
    geometryPoses: nfcRows.reduce((sum, row) => sum + (row.nfc && row.nfc.geometryPoseCount || 0), 0),
    formatFailureCauses: mergeCauses(nfcRows),
    mismatchExamples: nfcRows.filter((row) => !(row.nfc && row.nfc.exactIdMatch)).slice(0, 5).map((row) => ({ name: row.name, actualFormatFailureCount: row.nfc && row.nfc.actualFormatFailureCount || null, geometryPoseCount: row.nfc && row.nfc.geometryPoseCount || null, geometryReason: row.nfc && row.nfc.geometryReason || null })),
  };
  emit('METADATA', { script: 'test/output/lanes/pose-compare.mjs', workers: workerCount, percentile: 'linear interpolation p=0.05,0.50,0.95', allAxisMembership: 'cellSizePx, centerXNorm, centerYNorm, circular rotationDeg, symbolFrameRatio' });
  emit('INPUT_GATE', { lumaDumps: rows.length, expected: EXPECTED_DUMPS, pass: rows.length === EXPECTED_DUMPS });
  emit('OUTCOME_COUNTS', outcomes);
  emit('CENSUS_359_CHECK', { expected: EXPECTED, pass: censusPass });
  emit('CANDIDATE_ID_INTEGRITY', integrity);
  emit('HEALTHY_SUCCESS_116_AXES', axisReport(successMetrics));
  emit('NFC_CANDIDATE_AXES', axisReport(candidateMetrics));
  emit('CROSS_ALL_FRAMES', allCross.summary);
  emit('SCALE_VS_CENTER', {
    scaleUses: 'per-frame candidate-median symbolFrameRatio against healthy p05..p95; normalized by interval width',
    centerUses: 'per-frame candidate-median centerXNorm and centerYNorm against their healthy intervals; Euclidean normalized offset',
    result: {
      scaleOffset: allCross.summary.scaleOffset, centerOffsetMagnitude: allCross.summary.centerOffsetMagnitude,
      scaleDirection: allCross.summary.scaleDirection, centerXDirection: allCross.summary.centerXDirection, centerYDirection: allCross.summary.centerYDirection,
      scaleDominantFrames: allCross.summary.scaleDominantFrames, centerDominantFrames: allCross.summary.centerDominantFrames, tiedDominanceFrames: allCross.summary.tiedDominanceFrames,
    },
  });
  const table = sessions(rows);
  const controlled = sessionControl(rows);
  emit('SESSION_TABLE', table);
  if (controlled.length === 0) emit('SESSION_CONTROL', { sameSessionSuccessAndNfc: false, cohorts: [] });
  else {
    emit('SESSION_CONTROL', { sameSessionSuccessAndNfc: true, cohortCount: controlled.length });
    for (const cohort of controlled) emit('SESSION_COHORT', cohort);
  }
  emit('ZERO_IN_RANGE_EXAMPLES', allCross.rows.filter((row) => row.inRangeCount === 0).slice(0, 5).map((row) => ({ name: row.name, session: row.session, candidateCount: row.candidateCount, measuredCount: row.measuredCount })));
  return lines.join('\n') + '\n';
}
function workerCountFor(total) {
  const available = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  return Math.max(1, Math.min(8, available, total));
}
function runWorker(names) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { names } });
    let received = false;
    worker.once('message', (message) => { received = true; if (message && message.error) reject(new Error(message.error)); else resolve(message.rows); });
    worker.once('error', reject);
    worker.once('exit', (code) => { if (!received && code !== 0) reject(new Error('worker exited with code ' + code)); });
  });
}
function cliValue(prefix) {
  const found = process.argv.find(function(value) { return value.startsWith(prefix); });
  return found ? found.slice(prefix.length) : null;
}
function laneOutPath(value) {
  if (typeof value !== 'string' || !value.startsWith('lane-out/')) throw new Error('lane-out path required');
  return value;
}
function emitOrWrite(text, outputPath) {
  const write = outputPath ? writeFile(laneOutPath(outputPath), text, 'utf8') : Promise.resolve();
  return write.then(function() { process.stdout.write(text); });
}
async function main() {
  const dumps = listLumaDumps();
  if (dumps.length !== EXPECTED_DUMPS) {
    process.stdout.write('[L001] INPUT_GATE ' + JSON.stringify({ lumaDumps: dumps.length, expected: EXPECTED_DUMPS, pass: false }) + '\n');
    process.stdout.write('[L002] STOP dump count is not 359; no distribution was calculated.\n');
    process.exitCode = 2;
    return;
  }
  const outputPath = cliValue('out=');
  const mergeValue = cliValue('merge=');
  if (mergeValue) {
    const paths = mergeValue.split(',').map(laneOutPath);
    return Promise.all(paths.map(function(path) {
      return readFile(path, 'utf8').then(function(text) { return JSON.parse(text); });
    })).then(function(payloads) {
      const rows = payloads.flatMap(function(payload) { return payload.rows || []; }).sort(function(left, right) { return left.name.localeCompare(right.name); });
      const names = new Set(rows.map(function(row) { return row.name; }));
      if (rows.length !== EXPECTED_DUMPS || names.size !== EXPECTED_DUMPS) throw new Error('merged shard rows are not exactly 359 unique dumps');
      return emitOrWrite(render(rows, 'merged-shards'), outputPath);
    });
  }
  const shardValue = cliValue('shard=');
  let selectedDumps = dumps;
  let shard = null;
  if (shardValue) {
    const pieces = shardValue.split('/').map(Number);
    if (pieces.length !== 2 || !Number.isInteger(pieces[0]) || !Number.isInteger(pieces[1]) || pieces[1] < 1 || pieces[0] < 0 || pieces[0] >= pieces[1]) throw new Error('invalid shard value');
    selectedDumps = dumps.filter(function(dump, offset) { return offset % pieces[1] === pieces[0]; });
    shard = { index: pieces[0], total: pieces[1] };
  }
  const workers = workerCountFor(selectedDumps.length);
  const batches = Array.from({ length: workers }, function() { return []; });
  selectedDumps.forEach(function(dump, index) { batches[index % workers].push(dump.name); });
  return Promise.all(batches.map(function(names) { return runWorker(names); })).then(function(results) {
    const rows = results.flat().sort(function(left, right) { return left.name.localeCompare(right.name); });
    const writePath = cliValue('write=');
    if (writePath) {
      const path = laneOutPath(writePath);
      const payload = JSON.stringify({ sourceDumpCount: dumps.length, shard, rows });
      return writeFile(path, payload, 'utf8').then(function() {
        process.stdout.write('[L001] SHARD_WRITTEN ' + JSON.stringify({ path, sourceDumpCount: dumps.length, shard, rows: rows.length, workers }) + '\n');
      });
    }
    return emitOrWrite(render(rows, workers), outputPath);
  });
}

if (!isMainThread) {
  try {
    const wanted = new Set(workerData.names);
    const rows = listLumaDumps().filter((dump) => wanted.has(dump.name)).map(inspectDump);
    parentPort.postMessage({ rows });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.stack || error.message : String(error) });
  }
} else {
  await main();
}
