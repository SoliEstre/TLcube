/** 후보 HUD와 좌측 요약이 같은 선두를 말하게 하는 표시 전용 어댑터예요. */
import { R2_INDICATOR } from './r2/session.js';

export function candidateDisplayState(stats, view, candidates, previousId = '', { visibleOnly = false } = {}) {
  const live = Array.isArray(candidates) ? candidates.filter(row => row && row.alive !== false
    && row.indicator !== R2_INDICATOR.DROPPED && row.indicator !== R2_INDICATOR.FAILED
    && (row.type === 'Y' || row.type === 'C') && Number.isFinite(row.D)) : [];
  if (live.length === 0) return {
    stats: visibleOnly ? { ...stats, candidateCount: 0, candidates: [], lockedN: 0,
      progressD: 0, leadingLayoutId: '', indicator: R2_INDICATOR.SEARCHING } : stats,
    view: visibleOnly ? { ...view, n: 0, layoutId: '', cellCount: 0, H: null, faceHs: null } : view,
    family: 'Y', candidateId: '', leadingId: '',
  };
  let leader = live[0];
  for (const row of live) if (row.D > leader.D) leader = row;
  const previous = live.find(row => row.id === previousId);
  if (previous && previous.D === leader.D) leader = previous;
  return {
    candidateId: leader.id, leadingId: leader.layoutId, family: leader.type,
    stats: { ...stats, candidateCount: live.length, candidates: live,
      lockedN: leader.n, leadingLayoutId: leader.layoutId, progressD: leader.D, indicator: leader.indicator,
      lockDistrusted: leader.type === 'Y' && leader.geometryMode !== 'y-faces' ? stats.lockDistrusted : false },
    view: { ...view, profile: leader.type, n: leader.n, layoutId: leader.layoutId,
      dimensionKind: leader.dimensionKind, geometryMode: leader.geometryMode,
      lockRevision: leader.id, H: leader.H ?? null, faceHs: leader.faceHs ?? null },
  };
}
