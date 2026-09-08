/** 3D Y 외곽 관측을 unit-face H + CRC 포맷 후보로 bind해요. */
import { detectSeedlessBgLinefitCandidates } from '../decoder/cube-silhouette-observe.js';
import { enumerateCubeFaceGeometry, sampleUnitFaceHsInto } from '../decoder/cube-face-geometry.js';
import { measureFaceGridConfidence } from '../decoder/cube-face-confidence.js';
import { readFormatFromLocator } from '../decoder/locator-format.js';
import { finalLayoutIdsForN, dataCellsInScanOrderCellSurfaceFinal } from '../cellSurfaceFinal.js';
import { LINEUP_NS, GRID_LOCK_GATE_F } from './adapter-locator.js';
import { DEFAULT_R2_PARAMS } from './params.js';
import { buildYLayout } from './y-layout.js';
import { createR2CandidateKey } from './candidate-key.js';

function ownHs(faceHs) { return faceHs.map((H) => Float64Array.from(H)); }
function cellHs(faceHs, n) {
  return faceHs.map((unit) => {
    const H = Float64Array.from(unit);
    for (const i of [0, 1, 3, 4, 6, 7]) H[i] /= n;
    return H;
  });
}
function formatKey(format) {
  return `${format.tones}|${format.versionIndex}|${format.eccName}|${format.maskIndex}|${format.formatWireVersion}`;
}

export function observeCubeYCandidates(field, { maxCandidates = 8 } = {}) {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) {
    throw new TypeError('maxCandidates는 0 이상의 정수여야 해요');
  }
  const raw = detectSeedlessBgLinefitCandidates(field);
  const descriptors = [];
  let geometryCount = 0;
  for (const [rawOrdinal, shape] of raw.candidates.entries()) {
    for (const [geometryOrdinal, geometry] of enumerateCubeFaceGeometry(shape.vertices).entries()) {
      if (!geometry.ok) continue;
      geometryCount++;
      const confidence = measureFaceGridConfidence(field, geometry.faceHs, LINEUP_NS);
      const best = confidence.diagnostics.best;
      if (!best || best.F < GRID_LOCK_GATE_F
        || confidence.diagnostics.margin < DEFAULT_R2_PARAMS.lockMarginMin) continue;
      const n = best.n;
      const perCellHs = cellHs(geometry.faceHs, n);
      for (const [layoutOrdinal, layoutId] of finalLayoutIdsForN(n).entries()) {
        const read = readFormatFromLocator(field, { H: perCellHs[0], faceHs: perCellHs, n, layoutId });
        if (!read.ok) continue;
        for (const [formatOrdinal, format] of read.candidates.entries()) {
          const key = createR2CandidateKey({ profile: 'Y3D', layoutId, dimensionKind: 'n', dimension: n,
            ecc: format.eccName, maskIndex: format.maskIndex, wire: format.formatWireVersion,
            tones: format.tones, orientation: geometry.direction.id,
            sourceIdentity: `y-faces:${rawOrdinal}:${geometryOrdinal}:${geometry.method}` });
          if (!key) continue;
          const faceHs = ownHs(geometry.faceHs);
          const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId, format.formatWireVersion);
          const faceLuma = new Uint8Array(scan.length * 3);
          const visibleCells = new Uint8Array(scan.length);
          const visibleCount = sampleUnitFaceHsInto(field, faceHs, n, scan, faceLuma, visibleCells);
          descriptors.push({ key, n, layoutId, format: { ...format }, faceHs, scan,
            bound: buildYLayout(n, layoutId, format.eccName, format.maskIndex, format.formatWireVersion),
            F: best.F, margin: confidence.diagnostics.margin, visibleCount, faceLuma, visibleCells,
            rawOrdinal, geometryOrdinal, layoutOrdinal, formatOrdinal, geometryMethod: geometry.method,
            scoreKey: `${best.F}|${formatKey(format)}` });
        }
      }
    }
  }
  descriptors.sort((a, b) => b.F - a.F || a.rawOrdinal - b.rawOrdinal
    || a.geometryOrdinal - b.geometryOrdinal || a.layoutOrdinal - b.layoutOrdinal
    || a.formatOrdinal - b.formatOrdinal);
  return { observed: raw.candidates.length, geometryCount, descriptorCount: descriptors.length,
    candidates: descriptors.slice(0, maxCandidates) };
}

