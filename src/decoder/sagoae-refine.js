/**
 * 실제 사괘 고리만으로 중앙 파인더의 바깥 기하를 보정해요.
 * 본문·포맷·RS·기대 원문을 모르며, 결과는 verifySagoae의 기존 문턱을 통과해야 해요.
 * caller가 소유하는 고정 프레임 위에서 한 점수마다 양보하는 순수 관측 generator예요.
 */
import { verifySagoae } from './sagoae-verify.js';
import { CQ_STRUCTURAL_REFINE_GRID } from './cq-structural-refine.js';

function adjusted(H, scaleX, scaleY, dx = 0, dy = 0) {
  const cx = H[2] / H[8], cy = H[5] / H[8];
  const ax = cx + dx - scaleX * cx, ay = cy + dy - scaleY * cy;
  const result = H.slice();
  for (let col = 0; col < 3; col++) {
    result[col] = scaleX * H[col] + ax * H[6 + col];
    result[col + 3] = scaleY * H[col + 3] + ay * H[6 + col];
  }
  return result;
}

export function* refineSagoaeGeometrySteps(field, H, k) {
  if (!(H instanceof Float64Array) || H.length !== 9 || !H.every(Number.isFinite)
    || !Number.isSafeInteger(k) || k < 6) throw new TypeError('사괘의 관측 기하와 반경이 필요해요');
  let best = null, evaluations = 0;
  function evaluate(trial) {
    const verification = verifySagoae(field, trial, k); evaluations++;
    if (Number.isFinite(verification.correlation) && (!best
      || verification.correlation > best.verification.correlation)) best = { H: trial, verification };
  }
  yield null; evaluate(H.slice());
  // 앵커 탐색과 같은 반경 정규화 범위: 바깥 3k에서 ±1.5셀, 0.25셀 간격이에요.
  for (let step = 1; step <= 6; step++) for (const sign of [1, -1]) {
    const scale = 1 + sign * step * 0.25 / (3 * k);
    yield null; evaluate(adjusted(H, scale, scale));
  }
  // 본문 CQ 보정과 같은 좌표별 coarse/fine 그리드예요. 점수만 고리의 NCC예요.
  for (const grid of [CQ_STRUCTURAL_REFINE_GRID.coarse, CQ_STRUCTURAL_REFINE_GRID.fineDeltaAroundCoarse]) {
    for (const axis of ['scaleX', 'scaleY', 'translateX', 'translateY']) {
      const base = best?.H ?? H;
      const values = axis.startsWith('scale') ? grid.scale : grid.translation;
      for (const delta of values) {
        if (delta === 0) continue;
        const trial = adjusted(base, axis === 'scaleX' ? 1 + delta : 1,
          axis === 'scaleY' ? 1 + delta : 1, axis === 'translateX' ? delta : 0,
          axis === 'translateY' ? delta : 0);
        yield null; evaluate(trial);
      }
    }
  }
  return best?.verification.ok ? { ...best, H: best.H.slice(), evaluations } : null;
}
