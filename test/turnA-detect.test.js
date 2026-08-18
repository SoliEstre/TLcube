/**
 * turnA-detect.test.js — 역삼각(턴A) 실루엣 판별.
 *
 * 배경: 턴A 는 별도 타입이 아니라 타입 A 의 **옵션**이고 실루엣만 역삼각이다
 * (운영자 확정 015 §16 · 2026-08-18 «별도 타입처럼 취급하되 UI 상에만 같은 타입»).
 * formatIndex 는 타입 안에서만 유일하면 되므로 턴A 는 자기 표를 갖는데
 * (`src/turnA.js`), 그러면 **A2TQ(3) 과 기본 A0Q(3) 이 같은 값**이 된다.
 * 그 둘을 가르는 것이 실루엣이고 — 이 파일이 «실제로 갈리는가» 를 잰다.
 *
 * 유도: 턴A 영역 = 영역 A 의 축좌표 180° 상 `(q,r) → (−q,−r)` (손 좌표 0).
 * 육각 코어는 180° 대칭이라 공유되고 **패치만 배타적**이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { regionCellsA, regionCellsTurnA } from '../src/placementA.js';

const key = (cell) => cell.q + ',' + cell.r;
const hexDistance = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

test('턴A 영역은 영역 A 의 180° 상이다 — 길이·순서 대응', () => {
  for (const k of [4, 6, 8, 10]) {
    const up = regionCellsA(k);
    const down = regionCellsTurnA(k);
    assert.equal(down.length, up.length, 'k=' + k + ' 길이가 다르다');
    for (let i = 0; i < up.length; i += 1) {
      assert.equal(down[i].q, -up[i].q, 'k=' + k + ' [' + i + '] q 가 180° 상이 아니다');
      assert.equal(down[i].r, -up[i].r, 'k=' + k + ' [' + i + '] r 이 180° 상이 아니다');
    }
  }
});

test('육각 코어는 공유되고 패치는 **완전히** 배타적이다 — 판별력의 근거', () => {
  // 실측 2026-08-18 (claude-turna-detect.out.txt):
  //   k=6  전체 190 · 코어 127 · 패치 각 63 · 역패치가 정영역 밖 63 (100%)
  //   k=8  전체 325 · 코어 217 · 패치 각 108 (100%)
  //   k=10 전체 496 · 코어 331 · 패치 각 165 (100%)
  const EXPECTED = { 6: { total: 190, core: 127, patch: 63 },
    8: { total: 325, core: 217, patch: 108 },
    10: { total: 496, core: 331, patch: 165 } };
  for (const k of [6, 8, 10]) {
    const up = regionCellsA(k);
    const down = regionCellsTurnA(k);
    const upSet = new Set(up.map(key));
    const shared = down.filter((c) => upSet.has(key(c)));
    const upPatch = up.filter((c) => hexDistance(c.q, c.r) > k);
    const downPatch = down.filter((c) => hexDistance(c.q, c.r) > k);
    const want = EXPECTED[k];
    assert.equal(up.length, want.total, 'k=' + k + ' 전체 셀 수');
    assert.equal(shared.length, want.core, 'k=' + k + ' 공유(코어) 셀 수');
    assert.equal(upPatch.length, want.patch, 'k=' + k + ' 정삼각 패치 수');
    assert.equal(downPatch.length, want.patch, 'k=' + k + ' 역삼각 패치 수');
    // **핵심** — 역삼각 패치가 정삼각 영역과 한 셀도 안 겹친다.
    const outside = downPatch.filter((c) => !upSet.has(key(c))).length;
    assert.equal(outside, downPatch.length,
      'k=' + k + ' 역삼각 패치가 정삼각 영역과 겹친다 — 판별력이 줄었다: '
      + outside + '/' + downPatch.length);
  }
});

test('검출기가 방향 가설을 만들고 결과에 실어 보낸다', async () => {
  const source = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/decoder/family.js', import.meta.url), 'utf8',
  ));
  // 방향 가설 열거 · 결과 동봉 · hypothesisId 구분이 실제로 코드에 있는가.
  assert.match(source, /regionCellsTurnA/, 'family.js 가 턴A 영역을 안 쓴다');
  assert.match(source, /const turnCandidates = /, '방향 가설 열거가 없다');
  assert.match(source, /turn: best\.turn === true/, '결과에 turn 이 안 실린다');
  assert.match(source, /'-turn'/, 'hypothesisId 가 방향을 구분하지 않는다');
  // `options.patchCells` 명시 경로는 방향을 추측하지 않는다 (종전 동작 보존).
  assert.match(source, /Array\.isArray\(options\.patchCells\) \? \[false\] : \[false, true\]/,
    '명시 patchCells 경로에서 방향 열거를 끄지 않는다');
});
