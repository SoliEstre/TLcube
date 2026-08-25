/**
 * M1 계측 ② — **n=21 무회귀(바이트 동일)** 대조판.
 *
 * 손 상수(`V0TY_N` 등)를 정본 유도로 바꾸기 **전/후** 같은 프레임에 같은 검출기를
 * 돌려 산출을 통째로 직렬화한다. 두 덤프가 문자 하나까지 같아야 이 레인이 통과다.
 * 자는 대상은 로케이터 산출 전부다 — shape 기하(중심·정점·반경)·score·estimatedN·
 * layoutId·partial, 그리고 diagnostics (poseCount·slotQr·불스아이 확증 계수까지).
 *
 * 사용: node test/output/lanes/claude-m1-locator-baseline.mjs <출력파일>
 */
import { writeFileSync } from 'node:fs';
import {
  PALETTE, PAYLOAD, FILL,
  renderFinal, embed960, renderV0ty, renderV0try,
  RESTORE_DROPPED_LOCATOR,
  detectCellSurfaceBlockShapes, toRelativeLuminance,
  encodeY, buildSceneY, rasterize, TL_READER_URL, distortImage,
} from '../../cellSurface-block-locator.helpers.mjs';

function renderSlot(layoutId, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layoutId, version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4, qrText: TL_READER_URL });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

const frames = [
  ['v0t@21', embed960(renderFinal('v0t', 1, 15))],
  ['v0ty@21', embed960(renderV0ty(15))],
  ['v0tr@21', embed960(renderFinal('v0tr', 1, 15))],
  ['v0try@21', embed960(renderV0try(15))],
  ['v0trq@21', embed960(renderSlot('v0trq', 1, 15))],
];

const tones = [
  ['clean', {}],
  ['gamma0.7', { gamma: 0.7 }],
  ['rot120', { rotation: 120 }],
];

/** 부동소수를 통째로 남긴다 — «거의 같다» 를 통과로 읽지 않기 위해서. */
function canonical(detected) {
  return {
    shapes: detected.shapes.map((shape) => ({
      componentIndex: shape.componentIndex,
      estimatedN: shape.estimatedN,
      score: shape.score,
      radius: shape.radius,
      center: shape.center,
      vertices: shape.vertices,
      blockLocator: shape.blockLocator,
    })),
    diagnostics: detected.diagnostics,
  };
}

const out = [];
for (const [label, frame] of frames) {
  for (const [toneLabel, tone] of tones) {
    const distorted = distortImage(frame, { ...tone, fill: FILL });
    const luma = toRelativeLuminance(distorted);
    out.push({
      frame: label + ' ' + toneLabel,
      lineup: 'default',
      result: canonical(detectCellSurfaceBlockShapes(luma)),
    });
    // 드랍 복원 — v2r2·v1r2·v0x·v0w 계열까지 켜서 «안 건드린 패밀리» 도 함께 잰다.
    out.push({
      frame: label + ' ' + toneLabel,
      lineup: 'restore-dropped',
      result: canonical(detectCellSurfaceBlockShapes(
        luma, { calibration: RESTORE_DROPPED_LOCATOR.calibration },
      )),
    });
  }
}

const path = process.argv[2];
if (!path) throw new Error('출력 파일 경로가 필요하다');
writeFileSync(path, JSON.stringify(out, (key, value) =>
  (value instanceof Set ? [...value] : value), 2), 'utf8');
console.log('frames=' + frames.length + ' tones=' + tones.length + ' runs=' + out.length);
