/**
 * claude-skew-real-frontend.mjs — raw RGBA 프레임(.rgba, "TLRG")을 `decodeFrontend` 에
 * 먹이고 **깔때기 단계별 회계**를 JSON 으로 낸다. 진단 전용 · src 무수정.
 *
 * 왜 raw RGBA 인가: Node 에 JPEG 디코더가 없다. `tools/probes/claude-skew-real-jpeg.py`
 * 가 Pillow 로 디코드 + 스캐너와 같은 크롭/축소를 해서 이 형식으로 떨군다. 휘도 변환은
 * 여기서 `src/decoder/luma.js` 가 한다 — 브라우저 경로와 **같은 함수**다.
 *
 * 사용:
 *   node tools/probes/claude-skew-real-frontend.mjs <frame.rgba> [--stable] [--json out.json]
 *
 * 기본은 lab 경로(enableLocatorY + enableCellSurfaceY = true). `--stable` 은 배포
 * 스캐너 `/` 의 옵션(둘 다 false).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decodeFrontend } from '../../src/decoder/frontend.js';

export function readRgba(path) {
  const buffer = readFileSync(path);
  if (buffer.toString('latin1', 0, 4) !== 'TLRG') throw new Error(`magic 아님: ${path}`);
  const width = buffer.readUInt32LE(4);
  const height = buffer.readUInt32LE(8);
  const expected = 12 + width * height * 4;
  if (buffer.length !== expected) throw new Error(`길이 불일치 ${buffer.length} != ${expected}`);
  const pixels = new Uint8ClampedArray(buffer.buffer, buffer.byteOffset + 12, width * height * 4);
  return { width, height, pixels };
}

function labOptions(stable) {
  return {
    bootstrap: {
      family: { cube: { enableLocatorY: !stable, enableCellSurfaceY: !stable } },
    },
  };
}

/** 깔때기 단계 회계를 결과에서 뽑아낸다. 없는 값은 null — 추정하지 않는다. */
export function funnel(result) {
  const detail = result && result.detail ? result.detail : {};
  const boot = result && result.ok
    ? result.diagnostics && result.diagnostics.bootstrap
    : detail.diagnostics;
  // geometry 진단은 두 자리에 걸쳐 있다: bootstrap 레벨(geometry) 과 cube 검출기 레벨
  // (geometryDiagnostics.cube.diagnostics). CS 로케이터·레이아웃 리포트는 후자에 있다.
  const geoTop = (boot && boot.geometry) || detail.geometryDiagnostics || {};
  // cube 검출기 진단의 깊이는 성공/실패 경로에서 다르다 (성공: cube.diagnostics,
  // 실패: cube.diagnostics.diagnostics). 키로 찾는다 — 경로를 손으로 박으면 한쪽이 null 이 된다.
  const geometry = findNodeWith(geoTop, ['geometryReports', 'csBlockLocator', 'shapes']) || geoTop;
  const validation = (boot && boot.validation)
    || (result && result.ok ? {} : (detail.cause && detail.cause.diagnostics) || {});
  const reports = Array.isArray(geometry.geometryReports) ? geometry.geometryReports : [];
  const csl = geometry.csBlockLocator || null;

  const byLayout = new Map();
  for (const report of reports) {
    const id = report.layoutId || report.profile || '(none)';
    const row = byLayout.get(id) || { layoutId: id, reports: 0, attempted: 0, accepted: 0, reasons: {}, bestScore: null };
    row.reports += 1;
    if (report.attempted === true) row.attempted += 1;
    if (report.accepted === true) row.accepted += 1;
    const reason = report.accepted === true ? '(accepted)' : (report.reason || 'rejected');
    row.reasons[reason] = (row.reasons[reason] || 0) + 1;
    if (Number.isFinite(report.score) && (row.bestScore === null || report.score > row.bestScore)) {
      row.bestScore = report.score;
    }
    byLayout.set(id, row);
  }

  return {
    ok: result.ok === true,
    text: result.ok === true ? result.text : null,
    reason: result.ok === true ? null : result.reason,
    pipelineStage: detail.pipelineStage || null,
    pipelineCode: detail.pipelineCode || null,
    geometryStage: detail.geometryStage ?? geometry.geometryStage ?? null,
    detectPath: detail.detectPath ?? geometry.detectPath ?? null,
    finderSource: geoTop.finderSource ?? null,
    finderCount: geoTop.finderCount ?? null,
    geometryHypothesisCount: geoTop.geometryHypothesisCount ?? null,
    cube: geoTop.cube ? {
      ok: geoTop.cube.ok === true,
      reason: geoTop.cube.reason ?? null,
      hypothesisCount: geoTop.cube.hypothesisCount ?? null,
      cause: (geoTop.cube.diagnostics && geoTop.cube.diagnostics.cause) ?? null,
      geometryStage: (geoTop.cube.diagnostics && geoTop.cube.diagnostics.geometryStage) ?? null,
    } : null,
    qr: geoTop.qr ? {
      ok: geoTop.qr.ok === true,
      reason: geoTop.qr.reason ?? null,
      hypothesisCount: geoTop.qr.hypothesisCount ?? null,
      skipped: geoTop.qr.skipped === true,
    } : null,
    outline: geoTop.outline
      ? {
        area: geoTop.outline.area,
        fillRatio: geoTop.outline.fillRatio,
        touchesBorder: geoTop.outline.touchesBorder,
        threshold: geoTop.outline.threshold,
      }
      : null,
    // 실루엣/파인더 단계
    silhouette: {
      source: geometry.source ?? null,
      downsampleFactor: geometry.downsampleFactor ?? null,
      shapeCandidates: geometry.shapeCandidates ?? null,
      shapes: summarizeShapes(geometry.shapes),
      hypothesisCount: geometry.hypothesisCount ?? null,
      rejections: summarizeRejections(geometry.shapes || geometry),
    },
    // CS 블록 로케이터(파인더 후보 → 앵커 → 포즈)
    csBlockLocator: csl ? {
      blockCount: csl.blockCount ?? null,
      centerCount: csl.centerCount ?? null,
      anchorCount: csl.anchorCount ?? null,
      poseCount: csl.poseCount ?? null,
      verified: csl.verified ?? null,
      reason: csl.reason ?? null,
      stages: csl.stages ?? null,
      raw: csl,
    } : null,
    cellSurfaceProbe: geometry.cellSurfaceProbe || null,
    layouts: [...byLayout.values()],
    geometryReportCount: reports.length,
    // 포맷 → RS
    format: {
      hypothesisCount: validation.hypothesisCount ?? null,
      formatProposalCount: validation.formatProposalCount ?? null,
      formatCandidateCount: validation.formatCandidateCount ?? null,
      bodyValidCount: validation.bodyValidCount ?? null,
      formatFailures: summarizeFailures(validation.formatFailures),
      bodyFailures: summarizeFailures(validation.bodyFailures),
      readAccounting: summarizeFormatReads(validation.formatFailures),
    },
  };
}

/**
 * 포맷 읽기 회계 — «소거 다수결이 작동했는가» 를 숫자로 본다.
 * generated.{majority,replicas,unique} = 만들어진 제안 수, crcChecked/crcOk = CRC 통과 수,
 * erasedFormatCells = 톤 판정 자체가 실패한 포맷 셀 수(18 중), replicaAgreement = 복제 3개가
 * 자리별로 몇 자리에서 «둘 이상 같은 값» 을 냈는가 (다수결 성립 자릿수).
 */
function summarizeFormatReads(failures) {
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const acc = {
    hypotheses: 0,
    majority: 0,
    replicas: 0,
    erasedReplicas: 0,
    unique: 0,
    crcChecked: 0,
    crcOk: 0,
    crcFailed: 0,
    erasedFormatCellsMin: null,
    erasedFormatCellsMax: null,
    majorityDigitsMax: null,
    samples: [],
  };
  for (const failure of failures) {
    const detail = failure && failure.detail;
    if (!detail) continue;
    acc.hypotheses += 1;
    const generated = (detail.diagnostics && detail.diagnostics.generated) || {};
    acc.majority += generated.majority || 0;
    acc.replicas += generated.replicas || 0;
    acc.erasedReplicas += generated.erasedReplicas || 0;
    acc.unique += generated.unique || 0;
    acc.crcChecked += (detail.diagnostics && detail.diagnostics.crcChecked) || 0;
    acc.crcOk += (detail.diagnostics && detail.diagnostics.crcOk) || 0;
    acc.crcFailed += (detail.diagnostics && detail.diagnostics.crcFailed) || 0;
    const erased = detail.erasedFormatCells;
    if (Number.isFinite(erased)) {
      acc.erasedFormatCellsMin = acc.erasedFormatCellsMin === null ? erased : Math.min(acc.erasedFormatCellsMin, erased);
      acc.erasedFormatCellsMax = acc.erasedFormatCellsMax === null ? erased : Math.max(acc.erasedFormatCellsMax, erased);
    }
    if (Array.isArray(detail.reads) && detail.reads.length === 3) {
      let digits = 0;
      for (let d = 0; d < detail.reads[0].length; d += 1) {
        const column = detail.reads.map((row) => row[d]).filter((v) => v !== null && v !== undefined);
        const counts = new Map();
        for (const v of column) counts.set(v, (counts.get(v) || 0) + 1);
        if ([...counts.values()].some((c) => c >= 2)) digits += 1;
      }
      acc.majorityDigitsMax = acc.majorityDigitsMax === null ? digits : Math.max(acc.majorityDigitsMax, digits);
      if (acc.samples.length < 3) acc.samples.push({ id: failure.hypothesisId, reads: detail.reads, erased });
    }
  }
  return acc;
}

/** 얕은 우선 탐색으로 지정 키를 가진 첫 객체를 찾는다 (진단 경로가 경로마다 다르므로). */
function findNodeWith(root, keys, maxDepth = 6) {
  const queue = [[root, 0]];
  const seen = new Set();
  while (queue.length > 0) {
    const [node, depth] = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node) || depth > maxDepth) continue;
    seen.add(node);
    if (keys.some((key) => Object.prototype.hasOwnProperty.call(node, key))) return node;
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) queue.push([value, depth + 1]);
    }
  }
  return null;
}

function summarizeShapes(shapes) {
  if (!shapes || typeof shapes !== 'object') return null;
  return {
    candidateCount: Array.isArray(shapes.candidates) ? shapes.candidates.length : null,
    componentCount: shapes.componentCount ?? (shapes.diagnostics && shapes.diagnostics.componentCount) ?? null,
  };
}

function summarizeRejections(shapes) {
  const source = shapes && shapes.diagnostics ? shapes.diagnostics : shapes;
  const list = source && Array.isArray(source.rejections) ? source.rejections : null;
  if (!list) return null;
  const out = {};
  for (const entry of list) {
    const key = entry && entry.stage ? entry.stage : 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function summarizeFailures(list) {
  if (!Array.isArray(list)) return null;
  const out = {};
  for (const entry of list) {
    const key = (entry && (entry.reason || entry.stage)) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return { total: list.length, byReason: out };
}

export function runFrame(path, { stable = false } = {}) {
  const raster = readRgba(path);
  const stages = [];
  const t0 = Date.now();
  let result;
  try {
    result = decodeFrontend(raster, {
      ...labOptions(stable),
      onStage: (name, phase) => { if (phase === 'end') stages.push(name); },
    });
  } catch (error) {
    return {
      frame: path, width: raster.width, height: raster.height, stable,
      threw: error && error.message, ms: Date.now() - t0,
    };
  }
  return {
    frame: path,
    width: raster.width,
    height: raster.height,
    stable,
    ms: Date.now() - t0,
    stagesSeen: [...new Set(stages)],
    ...funnel(result),
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || process.argv[1].endsWith('claude-skew-real-frontend.mjs')) {
  const args = process.argv.slice(2);
  const framePath = args.find((a) => !a.startsWith('--'));
  const stable = args.includes('--stable');
  const jsonIndex = args.indexOf('--json');
  const out = runFrame(framePath, { stable });
  const text = JSON.stringify(out, null, 1);
  if (jsonIndex >= 0 && args[jsonIndex + 1]) writeFileSync(args[jsonIndex + 1], text);
  else console.log(text);
}
