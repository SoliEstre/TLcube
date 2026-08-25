/**
 * M1 계측 ④ — n=25 프레임의 **끝단 복호**가 전/후로 어떻게 달라지나.
 *
 * 가설 하나를 되찾는 것이 복호를 깨지 않는지(그리고 깨진 것을 고치는지) 본다.
 * decodeFrontend 는 로케이터 shape 를 «표식» 으로만 쓰고 실패하면 SUPPORTED_N 으로
 * 되돌아가므로(cube-detect §F-15), 여기서 재는 것은 «표식이 맞아졌나» 의 하류 효과다.
 */
import {
  PALETTE, PAYLOAD, FILL,
  embed960, decodeLab,
  encodeY, buildSceneY, rasterize, distortImage,
} from '../../cellSurface-block-locator.helpers.mjs';

function frameFor(layoutId, version, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layoutId, version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return embed960(rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
}

for (const [layoutId, version, n, ppu] of [
  ['v0t', 2, 25, 13], ['v0tr', 2, 25, 13], ['v0t', 1, 21, 15], ['v0tr', 1, 21, 15],
]) {
  const frame = frameFor(layoutId, version, ppu);
  for (const [toneLabel, tone] of [['clean', {}], ['gamma0.7', { gamma: 0.7 }], ['rot120', { rotation: 120 }]]) {
    const decoded = decodeLab(distortImage(frame, { ...tone, fill: FILL }));
    console.log(layoutId + '@' + n + ' ' + toneLabel
      + ' | ok=' + decoded.ok
      + ' text=' + (decoded.text === PAYLOAD ? 'OK' : JSON.stringify(decoded.text || null))
      + ' layout=' + (decoded.hypothesis ? decoded.hypothesis.cellSurfaceLayout : null)
      + ' n=' + (decoded.hypothesis ? decoded.hypothesis.n : null)
      + (decoded.ok ? '' : ' reason=' + decoded.reason));
  }
}
