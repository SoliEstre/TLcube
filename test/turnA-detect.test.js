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

/*
 * ── 디코더 해석 배선 (2026-08-18, 마지막 연결) ─────────────────────────────
 *
 * `typeASpecFromFormatIndex(index, turn)` 이 방향을 받아 규약을 고른다:
 *   turn=false → 기본 A 산술 유도 (발행 규약) · turn=true → 턴A 표.
 * 방향은 `family.js` 의 tri 점수가 정한다 (패치 100% 배타 — 위 테스트).
 *
 * ⚠ **자의 한계를 적어 둔다.** 해석 층만 떼어 잴 공개 API 가 없어서
 * (`resolveProfile` 은 비공개) 여기서는 ⓐ 소스에 분기·전달이 실재하는가와
 * ⓑ 두 표가 같은 값에 **다른 k** 를 준다는 사실을 잰다. «디코더가 실제로 k=10 을
 * 골랐다» 를 직접 관측하지는 못한다 — 픽셀 왕복 테스트가 생기면 그때 좁힌다.
 */
test('디코더가 방향을 받아 규약을 고른다 — 분기와 전달이 실재한다', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/decode.js', import.meta.url), 'utf8');
  assert.match(source, /function typeASpecFromFormatIndex\(index, turn = false\)/,
    '해석기가 방향 인자를 안 받는다');
  assert.match(source, /if \(turn === true\)/, '턴A 분기가 없다');
  assert.match(source, /TURN_A_FORMAT_INDEX/, '해석기가 턴A 표를 안 쓴다');
  assert.match(source, /typeASpecFromFormatIndex\(formatIndex, format\.turn === true\)/,
    '호출부가 방향을 안 넘긴다');
});

test('같은 formatIndex 가 방향에 따라 다른 k 로 간다 — 판별이 필수인 이유', async () => {
  const { TURN_A_FORMAT_INDEX } = await import('../src/turnA.js');
  const { VERSIONS_A } = await import('../src/capacityA.js');
  const shared = TURN_A_FORMAT_INDEX.filter((entry) => VERSIONS_A.some(
    (spec) => spec.formatIndex === entry.formatIndex || spec.formatIndex + 2 === entry.formatIndex,
  ));
  assert.ok(shared.length > 0, '공유 formatIndex 가 없다 — 이 테스트의 전제가 사라졌다');
  for (const entry of shared) {
    const plain = VERSIONS_A.find(
      (spec) => spec.formatIndex === entry.formatIndex || spec.formatIndex + 2 === entry.formatIndex,
    );
    // 실측 2026-08-18: fmtIdx 3 → 턴A A2TQ(k=10) vs 기본 A0Q(k=6).
    assert.notEqual(entry.k, plain.k,
      entry.name + '(k=' + entry.k + ') 와 기본 A(k=' + plain.k + ') 의 k 가 같다'
      + ' — 그렇다면 방향 판별 없이도 무해했다는 뜻이니 이 편입의 근거를 재검토하라');
  }
});
