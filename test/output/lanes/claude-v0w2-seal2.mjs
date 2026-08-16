/**
 * claude-v0w2-seal2.mjs — 봉합 **3조건 분리** A/B (과업 3 ②·③ 확정 측정).
 *
 * 팔 — 조건을 하나씩 켠다. 합쳐 재면 어느 쪽이 일했는지 못 본다.
 *   | `pre`         | 거부권 off · QR다움 off · 확증 off | 봉합 전 기준선 |
 *   | `rejectOnly`  | on · on · **off**                  | ②만 (가짜 제거) |
 *   | `confirmOnly` | off · off · **on**                 | ③만 (진짜 구제) |
 *   | `sealed`      | on · on · on                        | 출고 기본 |
 *
 * 로케이터는 **따로 안 부른다** — decodeFrontend 진단에서 같은 실행의 csBlockLocator
 * 를 꺼낸다 (같은 프레임을 두 번 훑지 않는다 = 측정 대상이 실제 경로 하나다).
 *
 * ⚠ P0 — calibration 은 bootstrap.family.cube.calibration 중첩 경로.
 * 시간은 여기서 재지 않는다 (인접 교대 벤치는 claude-v0w2-sealbench.mjs).
 *
 * 실행: node test/output/lanes/claude-v0w2-seal2.mjs
 */

import { decodeFrontend } from '../../../src/decoder/frontend.js';
import {
  render, embed960, photoLike, diagnosticsOf, findCsBlockLocator,
} from './claude-v0w2-leak.mjs';

const PAYLOAD = 'https://tl.estre.so';

const ARMS = Object.freeze({
  pre: {
    centreQrBullseyeVeto: false,
    centreQrRequireFinderContrast: false,
    centreBullseyeConfirmedPoses: false,
  },
  rejectOnly: { centreBullseyeConfirmedPoses: false },
  confirmOnly: { centreQrBullseyeVeto: false, centreQrRequireFinderContrast: false },
  sealed: {},
});

function decodeLab(frame, csBlockLocator) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: {
          enableLocatorY: true, enableCellSurfaceY: true, calibration: { csBlockLocator },
        },
      },
    },
  });
}

const LADDER = Object.freeze([
  ['L0 clean', {}],
  ['L2 blur1.6', { blur: 1.6 }],
  ['L4 photo', { blur: 1.6, noise: 6, jpeg: 55 }],
  ['L5 photo+tilt18', { blur: 1.6, noise: 6, jpeg: 55, tilt: 18 }],
  ['L7 photo+g0.7', { blur: 1.6, noise: 6, jpeg: 55, gamma: 0.7 }],
  ['LA photo+g1.4', { blur: 1.6, noise: 6, jpeg: 55, gamma: 1.4 }],
  ['LB photo+sC0.6', { blur: 1.6, noise: 6, jpeg: 55, sCurve: 0.6 }],
  ['L9 hard', { blur: 2.4, noise: 9, jpeg: 45 }],
]);
const ROTS = [0, 17, 120, 240];
const TARGETS = ['v0x', 'v0w', 'v0w2', 'v0wq'];
const armNames = Object.keys(ARMS);

const stats = {};
for (const target of TARGETS) {
  stats[target] = Object.fromEntries(armNames.map((name) => [name, {
    cells: 0, hit: 0, ok: 0, fakeV0wq: 0, ownPoses: 0, vetoed: 0, contrastCut: 0,
    confirmedPoses: 0, outcomes: [],
  }]));
}

for (const target of TARGETS) {
  for (const tones of [2, 3]) {
    const base = embed960(render(target, 15, tones));
    for (const [ladder, spec] of LADDER) {
      for (const rotation of ROTS) {
        const frame = photoLike(base, { ...spec, rotation });
        for (const name of armNames) {
          const entry = stats[target][name];
          const result = decodeLab(frame, ARMS[name]);
          const locator = findCsBlockLocator(diagnosticsOf(result));
          entry.cells += 1;
          if (result.ok) entry.ok += 1;
          if (result.ok && result.text === PAYLOAD
            && result.hypothesis.cellSurfaceLayout === target) entry.hit += 1;
          entry.outcomes.push(result.ok
            ? `${target}/${tones}/${ladder}/rot${rotation} OK:${result.hypothesis.cellSurfaceLayout}`
            : `${target}/${tones}/${ladder}/rot${rotation} FAIL:${result.reason}`);
          if (!locator) continue;
          entry.ownPoses += locator.poseCount[target] || 0;
          if (target !== 'v0wq') entry.fakeV0wq += locator.poseCount.v0wq;
          entry.vetoed += locator.centerQr.v0wqBullseyeVetoed || 0;
          entry.contrastCut += locator.centerQr.v0wqFinderContrastRejected || 0;
          entry.confirmedPoses += locator.bullseyeConfirmed
            ? locator.bullseyeConfirmed.poses : 0;
        }
      }
    }
  }
}

console.log('target arm          칸 정타  복호  가짜v0wq  자기포즈  거부권  QR다움  확증포즈');
for (const target of TARGETS) {
  for (const name of armNames) {
    const e = stats[target][name];
    console.log([
      target.padEnd(5), name.padEnd(12),
      String(e.cells).padStart(3), String(e.hit).padStart(4), String(e.ok).padStart(5),
      String(e.fakeV0wq).padStart(9), String(e.ownPoses).padStart(9),
      String(e.vetoed).padStart(6), String(e.contrastCut).padStart(7),
      String(e.confirmedPoses).padStart(8),
    ].join(' '));
  }
}

console.log('\n--- pre 대비 칸별 변화 (정확도 회귀·구제 판정) ---');
for (const target of TARGETS) {
  const base = stats[target].pre.outcomes;
  for (const name of armNames) {
    if (name === 'pre') continue;
    const now = stats[target][name].outcomes;
    const gained = [];
    const lost = [];
    for (let index = 0; index < base.length; index += 1) {
      if (base[index] === now[index]) continue;
      const wasOk = base[index].includes('OK:' + target);
      const isOk = now[index].includes('OK:' + target);
      if (!wasOk && isOk) gained.push(now[index]);
      else if (wasOk && !isOk) lost.push(`${base[index]} → ${now[index]}`);
      else lost.push(`(중립) ${base[index]} → ${now[index]}`);
    }
    console.log(`${target} ${name}: 구제 +${gained.length} · 손실/중립변화 ${lost.length}`);
    for (const line of gained) console.log('   + ' + line);
    for (const line of lost) console.log('   ! ' + line);
  }
}

console.log('\n--- 합계 ---');
for (const name of armNames) {
  const hit = TARGETS.reduce((sum, t) => sum + stats[t][name].hit, 0);
  const cells = TARGETS.reduce((sum, t) => sum + stats[t][name].cells, 0);
  const fake = TARGETS.filter((t) => t !== 'v0wq')
    .reduce((sum, t) => sum + stats[t][name].fakeV0wq, 0);
  console.log(`${name.padEnd(12)} 정타 ${hit}/${cells}` +
    ` · 가짜 v0wq 포즈 ${fake} · v0WQ 정타 ${stats.v0wq[name].hit}/${stats.v0wq[name].cells}`);
}
