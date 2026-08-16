/**
 * claude-skew-real-face.mjs — **R면 가설의 디코더측 실측**.
 *
 * 채택된(또는 최상위) 큐브 포즈에서 `evaluateCellSurfaceGeometry` 를 다시 돌려
 * 면별 진단(faceAgreement · sampleCounts · anchors{dark,bright,span})을 꺼낸다.
 * «R 이 가장 어둡다» 는 렌더 상수(sceneY DEFAULT_FACE_GAINS R=0.52)이고, 여기서
 * 재는 것은 **그 어두움이 파인더 점수의 어느 성분을 깎는가** 다.
 *
 * 사용: node tools/probes/claude-skew-real-face.mjs <frame.rgba>
 */

import { readRgba } from './claude-skew-real-frontend.mjs';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { detectCubeHypotheses, sampleCubeCell } from '../../src/decoder/cube-detect.js';
import { evaluateCellSurfaceGeometry } from '../../src/decoder/cellSurfaceY-detect.js';

const raster = readRgba(process.argv[2]);
const luma = toRelativeLuminance(raster, {});
const detection = detectCubeHypotheses(luma, undefined, {
  enableLocatorY: true, enableCellSurfaceY: true,
});
const hypotheses = detection.hypotheses || [];
console.log('cube ok:', detection.ok, '| hypotheses:', hypotheses.length);
if (hypotheses.length === 0) process.exit(0);

const hypothesis = hypotheses[0];
const evaluated = evaluateCellSurfaceGeometry(
  hypothesis,
  (i, j) => sampleCubeCell(luma, hypothesis, i, j, {}),
  { enableCellSurfaceY: true },
);
const diag = evaluated.diagnostics || {};
console.log('layoutId:', diag.layoutId, '| accepted:', evaluated.accepted,
  '| agreement:', diag.agreement, '| reject:', diag.rejectReason,
  '| orientationMargin:', diag.orientationMargin);
console.log('faceAgreement:', JSON.stringify(diag.faceAgreement));
console.log('sampleCounts:', JSON.stringify(diag.sampleCounts));
console.log('minimumSpan:', diag.minimumSpan, '| enoughSamples:', diag.enoughSamples,
  '| toneSeparation:', diag.toneSeparation);

// anchors 는 scoreMappedSamples 안에만 있으므로, 같은 표본으로 면별 dark/bright 를
// 직접 재계산해 span 을 낸다 (게이트 minimumToneSpan = 0.012 와 비교용).
const best = evaluated.scored && evaluated.scored.best;
if (best && best.anchors) {
  for (const face of ['T', 'L', 'R']) {
    const a = best.anchors[face];
    console.log(`  ${face}: dark=${a.dark?.toFixed(5)} bright=${a.bright?.toFixed(5)} span=${a.span?.toFixed(5)}`);
  }
}
