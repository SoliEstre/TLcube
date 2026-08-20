// 봉투(envelope)의 «자기 통과율» 을 잰다.
//
// 레인 D 의 결론은 「후보 12,371개 중 봉투 안 0개」다. 그런데 봉투는 성공 116장의
// 축별 5~95 퍼센타일을 **다섯 축 동시** 로 요구한다. 축이 독립이면 성공 자신도
// 0.9^5 = 59% 만 통과한다 — 봉투가 얼마나 «너그러운 자» 인지 모르면 0 의 무게를 못 잰다.
//
// 그래서 같은 봉투를 **성공 116장 자신에게** 적용해 통과율을 낸다. 게이트는 안 건드린다.
import fs from 'node:fs';

const paths = process.argv.slice(2);
const rows = [];
for (const p of paths) rows.push(...JSON.parse(fs.readFileSync(p, 'utf8')).rows);
if (rows.length !== 359) throw new Error('rows != 359: ' + rows.length);

const AXES = ['cellSizePx', 'centerXNorm', 'centerYNorm', 'symbolFrameRatio'];
const successes = rows.filter((r) => r.outcome === 'ok' && r.acceptedPose).map((r) => r.acceptedPose);
console.log('성공 포즈 ' + successes.length + '개');

const pct = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const env = {};
for (const ax of AXES) {
  const xs = successes.map((s) => s[ax]).filter(Number.isFinite);
  env[ax] = { lo: pct(xs, 0.05), hi: pct(xs, 0.95), n: xs.length };
}
console.log('봉투 (회전 제외 4축):');
for (const ax of AXES) console.log('  ' + ax.padEnd(18) + env[ax].lo.toFixed(6) + ' ~ ' + env[ax].hi.toFixed(6));

const inEnv = (p) => AXES.every((ax) => Number.isFinite(p[ax]) && p[ax] >= env[ax].lo && p[ax] <= env[ax].hi);
const selfPass = successes.filter(inEnv).length;
console.log('\n⇒ 성공 자신의 봉투 통과율 : ' + selfPass + '/' + successes.length
  + '  (' + (100 * selfPass / successes.length).toFixed(1) + '%)');

// 축을 하나씩 빼면서 통과율이 어떻게 변하는지 — 어느 축이 좁은지 드러난다
console.log('\n축별 단독 통과율:');
for (const ax of AXES) {
  const n = successes.filter((p) => Number.isFinite(p[ax]) && p[ax] >= env[ax].lo && p[ax] <= env[ax].hi).length;
  console.log('  ' + ax.padEnd(18) + n + '/' + successes.length);
}

// 같은 4축 봉투를 실패 후보에 적용 — 레인 D 는 5축(회전 포함)이었다
let cand = 0, hit = 0;
const perFrame = new Map();
for (const r of rows) {
  if (r.outcome === 'ok' || !Array.isArray(r.candidatePoses)) continue;
  if (r.reason !== 'frontend:no-format-candidate') continue;
  let h = 0;
  for (const p of r.candidatePoses) { cand += 1; if (inEnv(p)) { hit += 1; h += 1; } }
  perFrame.set(r.name, h);
}
console.log('\n⇒ 실패 후보 (4축 봉투) : ' + hit + ' / ' + cand + ' 통과 · 프레임 ' + perFrame.size + '개');
const withHit = [...perFrame.values()].filter((v) => v > 0).length;
console.log('  통과 후보가 1개 이상인 프레임 : ' + withHit + '/' + perFrame.size);
