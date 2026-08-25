/**
 * M1 계측 ③ — **n=25 가설이 실제로 하나 더 서는가** (합성 프레임 실증).
 *
 * 손 상수(21)를 정본 유도로 바꾸기 전/후를 **같은 프레임**에 돌린다. 「전」 은
 * `git show HEAD:` 로 꺼낸 모듈 사본(`src/decoder/_m1-before-detect.js`)이고, 같은
 * 상대 경로에 두므로 import 해상도가 동일하다. 계측 뒤 그 사본은 지운다.
 *
 * 사용: node test/output/lanes/claude-m1-n25-probe.mjs [before-모듈-경로]
 */
import {
  PALETTE, PAYLOAD, FILL,
  embed960,
  detectCellSurfaceBlockShapes, toRelativeLuminance,
  encodeY, buildSceneY, rasterize, distortImage,
} from '../../cellSurface-block-locator.helpers.mjs';

const beforePath = process.argv[2];
const before = beforePath
  ? (await import(beforePath)).detectCellSurfaceBlockShapes
  : null;

function frameFor(layoutId, version, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layoutId, version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return embed960(rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
}

function report(label, detect, frame) {
  const detected = detect(toRelativeLuminance(frame));
  const poses = detected.diagnostics.poseCount;
  const ns = detected.shapes
    .filter((shape) => shape.blockLocator)
    .map((shape) => shape.blockLocator.family + '@n' + shape.estimatedN);
  console.log(label
    + ' | poseCount v0t=' + (poses.v0t || 0) + ' v0tr=' + (poses.v0tr || 0)
    + ' | shapes=[' + ns.join(', ') + ']');
  return detected;
}

for (const [layoutId, version, n] of [['v0t', 2, 25], ['v0tr', 2, 25], ['v0t', 1, 21], ['v0tr', 1, 21]]) {
  let frame = null;
  try {
    frame = frameFor(layoutId, version, 13);
  } catch (e) {
    console.log(layoutId + '@' + n + ': 렌더 실패 — ' + e.message);
    continue;
  }
  for (const [toneLabel, tone] of [['clean', {}], ['gamma0.7', { gamma: 0.7 }], ['rot120', { rotation: 120 }]]) {
    const distorted = distortImage(frame, { ...tone, fill: FILL });
    if (before) report(layoutId + '@' + n + ' ' + toneLabel + ' BEFORE', before, distorted);
    report(layoutId + '@' + n + ' ' + toneLabel + ' AFTER ', detectCellSurfaceBlockShapes, distorted);
  }
}
