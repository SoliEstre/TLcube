import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCubeFaceGeometry, iterateCubeFaceGeometry } from '../src/decoder/cube-face-geometry.js';

const OBSERVED_SIX = [
  { x: 258.15788145424267, y: 929.4111419129426 },
  { x: 223.3452857972168, y: 595.9698970957319 },
  { x: 529.6898636203766, y: 448.65012179851294 },
  { x: 839.2856297883197, y: 591.6683790688137 },
  { x: 805.7189356224283, y: 930.0185180291508 },
  { x: 533.1478343862708, y: 1116.3189233745675 },
];
const stable = (rows) => rows.map((row) => ({ ...row,
  faceHs: row.faceHs?.map((H) => Array.from(H)) ?? null }));

test('D6×2 iterator를 끝까지 소비하면 기존 배열 API의 24 branch와 값·순서가 같다', () => {
  const iterated = stable(Array.from(iterateCubeFaceGeometry(OBSERVED_SIX)));
  const synchronous = stable(enumerateCubeFaceGeometry(OBSERVED_SIX));
  assert.equal(iterated.length, 24);
  assert.deepEqual(iterated, synchronous);
  assert.deepEqual(iterated.map((row) => [row.direction.id, row.method]),
    Array.from({ length: 12 }, (_, direction) => {
      const name = `${direction < 6 ? 'forward' : 'reverse'}-r${direction % 6}`;
      return [[name, 'pose-faceH'], [name, 'sil3-nearpoint']];
    }).flat());
});

test('퇴화 branch도 iterator와 배열 API가 같은 24개 실패를 낸다', () => {
  const input = Array.from({ length: 6 }, () => ({ x: 1, y: 1 }));
  assert.deepEqual(stable(Array.from(iterateCubeFaceGeometry(input))),
    stable(enumerateCubeFaceGeometry(input)));
});
