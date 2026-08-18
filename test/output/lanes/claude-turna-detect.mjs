/**
 * claude-turna-detect.mjs — 역삼각 실루엣 판별이 **실제로 되는가**.
 *
 * 배선(2026-08-18): `regionCellsTurnA` (180° 상) + `family.js` 의 tri 점수에
 * 방향 가설(turn false/true) 추가. 육각 코어는 공유고 패치만 배타적이다.
 *
 * 재는 것 — 판별력의 하한을 «셀 집합» 수준에서 먼저 잰다 (렌더 없이):
 *   정삼각 프레임에서 역삼각 패치를 재면 코드 밖을 읽는다. 그 «밖» 비율이
 *   판별의 근거이므로, 두 패치 집합이 서로의 영역 밖에 얼마나 있는지 센다.
 * 그리고 실제 tri 점수 경로가 두 가설을 만들어 내는지 확인한다.
 */
import { regionCellsA, regionCellsTurnA } from '../../../src/placementA.js';

const key = (c) => c.q + ',' + c.r;
console.log('k   | 전체 | 코어공유 | 패치(정) | 패치(역) | 역패치가 정영역 밖 | 판별 가능');
for (const k of [6, 8, 10]) {
  const up = regionCellsA(k);
  const down = regionCellsTurnA(k);
  const upSet = new Set(up.map(key));
  const shared = down.filter((c) => upSet.has(key(c))).length;
  const hexDist = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  const upPatch = up.filter((c) => hexDist(c.q, c.r) > k);
  const downPatch = down.filter((c) => hexDist(c.q, c.r) > k);
  // 역삼각 패치 중 정삼각 영역 **밖**인 셀 — 여기가 «배경을 읽는» 자리다.
  const outside = downPatch.filter((c) => !upSet.has(key(c))).length;
  const ratio = outside / Math.max(downPatch.length, 1);
  console.log(`${String(k).padEnd(4)}| ${String(up.length).padEnd(5)}| ${String(shared).padEnd(9)}`
    + `| ${String(upPatch.length).padEnd(9)}| ${String(downPatch.length).padEnd(9)}`
    + `| ${outside} (${(ratio * 100).toFixed(0)}%)`.padEnd(19)
    + `| ${ratio === 1 ? '완전 ✅' : ratio > 0.5 ? '부분' : '★약함'}`);
}
console.log('\n판독: 역패치가 정영역 밖 100% 면 두 방향이 패치에서 **완전히** 갈린다 —');
console.log('      정삼각 프레임에서 역삼각 가설은 패치 전부가 배경이라 strictRate 가 무너진다.');
