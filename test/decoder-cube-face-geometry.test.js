import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  enumerateCubeFaceGeometry,
  sampleUnitFaceHsInto,
} from '../src/decoder/cube-face-geometry.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';

const OBSERVED_SIX = [
  { x: 258.15788145424267, y: 929.4111419129426 },
  { x: 223.3452857972168, y: 595.9698970957319 },
  { x: 529.6898636203766, y: 448.65012179851294 },
  { x: 839.2856297883197, y: 591.6683790688137 },
  { x: 805.7189356224283, y: 930.0185180291508 },
  { x: 533.1478343862708, y: 1116.3189233745675 },
];

function stable(result) {
  return result.map((branch) => ({
    ...branch,
    faceHs: branch.faceHs?.map((H) => Array.from(H)) ?? null,
  }));
}

test('D6 열두 방향의 두 face-H 해석을 선택 없이 모두 반환한다', () => {
  const result = enumerateCubeFaceGeometry(OBSERVED_SIX);
  assert.equal(result.length, 24);
  assert.equal(result.filter((branch) => branch.ok).length, 24);
  for (let direction = 0; direction < 12; direction += 1) {
    const [pose, near] = result.slice(direction * 2, direction * 2 + 2);
    assert.equal(pose.direction.id, near.direction.id);
    assert.equal(pose.method, 'pose-faceH');
    assert.equal(near.method, 'sil3-nearpoint');
    assert.equal(pose.direction.vertices.length, 6);
    for (const branch of [pose, near]) {
      assert.equal(branch.faceHs.length, 3);
      for (const H of branch.faceHs) {
        assert.ok(H instanceof Float64Array);
        assert.equal(H.length, 9);
        assert.ok([...H].every(Number.isFinite));
      }
    }
  }
  assert.deepEqual(
    result.filter((_, index) => index % 2 === 0).map((branch) => branch.direction.id),
    ['forward-r0', 'forward-r1', 'forward-r2', 'forward-r3', 'forward-r4', 'forward-r5',
      'reverse-r0', 'reverse-r1', 'reverse-r2', 'reverse-r3', 'reverse-r4', 'reverse-r5'],
  );
});

test('입력 6점과 반환 branch/H는 호출별로 소유권이 분리된다', () => {
  const input = OBSERVED_SIX.map((point) => ({ ...point }));
  const before = input.map((point) => ({ ...point }));
  const first = enumerateCubeFaceGeometry(input);
  const pristine = stable(enumerateCubeFaceGeometry(before));
  assert.deepEqual(input, before);
  assert.notStrictEqual(first[0].faceHs[0], first[1].faceHs[0]);
  assert.notStrictEqual(first[0].direction.vertices[0], input[0]);
  input[0].x = -1;
  first[0].faceHs[0][0] = -123;
  first[0].direction.vertices[0].x = -456;
  first[0].unitPoseResidual.residualRmsCells = -789;
  assert.deepEqual(stable(enumerateCubeFaceGeometry(before)), pristine);
});

test('퇴화 입력도 D6×두 가지를 보존하되 유효 H를 지어내지 않는다', () => {
  const result = enumerateCubeFaceGeometry(
    Array.from({ length: 6 }, () => ({ x: 1, y: 1 })),
  );
  assert.equal(result.length, 24);
  assert.ok(result.every((branch) => branch.ok === false));
  assert.ok(result.every((branch) => branch.faceHs === null));
  assert.deepEqual(
    result.map((branch) => [branch.direction.id, branch.method]),
    Array.from({ length: 12 }, (_, direction) => {
      const flip = direction < 6 ? 'forward' : 'reverse';
      const rotation = direction % 6;
      return [
        [`${flip}-r${rotation}`, 'pose-faceH'],
        [`${flip}-r${rotation}`, 'sil3-nearpoint'],
      ];
    }).flat(),
  );
});

test('unit face-H와 명시 scan을 기존 byte 표본 규칙으로 into 출력한다', () => {
  const data = new Float32Array(100);
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) data[y * 10 + x] = (x + y) / 20;
  }
  const luma = { width: 10, height: 10, data };
  Object.defineProperty(luma, 'alpha', {
    get() { throw new Error('alpha를 읽으면 안 된다'); },
  });
  const identityTranslated = () =>
    new Float64Array([2, 0, 4, 0, 2, 4, 0, 0, 1]);
  const faceHs = [identityTranslated(), identityTranslated(), identityTranslated()];
  const faceLuma = new Uint16Array(3);
  const visible = new Uint8Array(1);
  assert.equal(sampleUnitFaceHsInto(
    luma, faceHs, 1, [{ i: 0, j: 0 }], faceLuma, visible,
  ), 1);
  assert.deepEqual([...faceLuma], [89, 97, 119]);
  assert.deepEqual([...visible], [1]);

  const outside = [0, 1, 2].map(() =>
    new Float64Array([1, 0, -100, 0, 1, -100, 0, 0, 1]));
  faceLuma.fill(77);
  visible.fill(1);
  assert.equal(sampleUnitFaceHsInto(
    luma, outside, 1, [{ i: 0, j: 0 }], faceLuma, visible,
  ), 0);
  assert.deepEqual([...faceLuma], [0, 0, 0]);
  assert.deepEqual([...visible], [0]);
});

test('A3 L4와 같이 작은 quad와 front T 반대 부호 face를 셀 전체에서 제외한다', () => {
  const luma = { width: 20, height: 20, data: new Float32Array(400).fill(0.5) };
  const good = () => new Float64Array([2, 0, 8, 0, 2, 8, 0, 0, 1]);
  const faceLuma = new Uint16Array(3);
  const visible = new Uint8Array(1);

  const small = good();
  small[0] = 0.5;
  small[4] = 0.5;
  assert.equal(sampleUnitFaceHsInto(
    luma, [good(), small, good()], 1, [{ i: 0, j: 0 }], faceLuma, visible,
  ), 0, 'abs(doubled area) <= 1인 face는 제외해야 한다');
  assert.deepEqual([...faceLuma], [0, 0, 0]);

  const reversed = new Float64Array([-2, 0, 8, 0, 2, 8, 0, 0, 1]);
  assert.equal(sampleUnitFaceHsInto(
    luma, [good(), reversed, good()], 1, [{ i: 0, j: 0 }], faceLuma, visible,
  ), 0, '첫 T(0,0) quad와 반대 부호인 face는 제외해야 한다');
  assert.deepEqual([...visible], [0]);
});

test('A3 L4처럼 네 꼭짓점은 유한하기만 하면 되고 화면 안에는 centroid만 있으면 된다', () => {
  const luma = { width: 12, height: 12, data: new Float32Array(144).fill(0.25) };
  const centers = [
    { x: 0, y: -0.5 },
    { x: -Math.sqrt(3) / 4, y: 0.25 },
    { x: Math.sqrt(3) / 4, y: 0.25 },
  ];
  const faceHs = centers.map(({ x, y }) => new Float64Array([
    20, 0, 5 - 20 * x,
    0, 20, 5 - 20 * y,
    0, 0, 1,
  ]));
  const faceLuma = new Uint16Array(3);
  const visible = new Uint8Array(1);
  assert.equal(sampleUnitFaceHsInto(
    luma, faceHs, 1, [{ i: 0, j: 0 }], faceLuma, visible,
  ), 1, 'offscreen quad corner 자체는 L4 탈락 사유가 아니다');
  assert.deepEqual([...faceLuma], [64, 64, 64]);

  const cornerAtInfinity = new Float64Array(faceHs[0]);
  cornerAtInfinity[6] = 2 / Math.sqrt(3);
  cornerAtInfinity[8] = 1;
  assert.equal(sampleUnitFaceHsInto(
    luma, [cornerAtInfinity, faceHs[1], faceHs[2]], 1,
    [{ i: 0, j: 0 }], faceLuma, visible,
  ), 0, '네 꼭짓점 중 하나라도 투영이 유한하지 않으면 제외해야 한다');
  assert.deepEqual([...faceLuma], [0, 0, 0]);
});

test('같은 평면 H3에서 standalone 표본은 현재 A3 alignInto와 동등하다', () => {
  const luma = { width: 20, height: 20, data: new Float32Array(400) };
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) luma.data[y * 20 + x] = (2 * x + y) / 60;
  }
  const H = new Float64Array([3, 0.2, 9, -0.1, 3, 9, 0.001, -0.002, 1]);
  const standaloneLuma = new Uint16Array(3);
  const standaloneVisible = new Uint8Array(1);
  assert.equal(sampleUnitFaceHsInto(
    luma, [H, H, H], 1, [{ i: 0, j: 0 }], standaloneLuma, standaloneVisible,
  ), 1);

  const adapters = createA3Adapters({ n: 1, gateF: -Infinity });
  adapters.installHomography(H, 1, '');
  const a3Luma = new Uint16Array(3);
  const a3Visible = new Uint8Array(1);
  const output = {
    gatePassed: 0, weightQ15: 0, mismatchCount: 0, matchCount: 0,
    visibleCount: 0, distrusted: 0,
  };
  adapters.alignInto(
    luma, 20, 20, 1, null, {}, output, a3Luma, a3Visible,
  );
  assert.deepEqual([...standaloneLuma], [...a3Luma]);
  assert.deepEqual([...standaloneVisible], [...a3Visible]);
});

test('malformed/nonfinite 입력과 퇴화 face-H를 거부한다', () => {
  for (const input of [
    null,
    [],
    Array.from({ length: 5 }, () => ({ x: 0, y: 0 })),
    [...OBSERVED_SIX.slice(0, 5), { x: NaN, y: 0 }],
  ]) {
    assert.throws(() => enumerateCubeFaceGeometry(input), TypeError);
  }
  const luma = { width: 2, height: 2, data: new Float32Array(4) };
  const zeroHs = [0, 1, 2].map(() => new Float64Array(9));
  assert.throws(() => sampleUnitFaceHsInto(
    luma, zeroHs, 1, [{ i: 0, j: 0 }], new Uint16Array(3), new Uint8Array(1),
  ), TypeError);
});

test('decoder 절단면은 n/layout/format/body/RS/R2 모듈을 import하지 않는다', async () => {
  const source = await readFile(
    new URL('../src/decoder/cube-face-geometry.js', import.meta.url),
    'utf8',
  );
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), [
    '../y3d-viewer.js',
    './cube-pose.js',
    './homography.js',
  ]);
  assert.doesNotMatch(
    imports.join('\n'),
    /r2|layout|format|body|decode|session|rs/i,
  );
});
