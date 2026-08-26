/**
 * 라이브 스캐너의 호출 주기와 시간 기반 소비자 계약.
 *
 * 100ms 는 빠른 기기의 처리율을 10fps 로 제한한다. 직전 프레임의 실제 비용이 그보다
 * 크면 그 값을 그대로 써 느린 기기에서 새 작업을 재촉하지 않는다. `isDecoding` 이 동시
 * 실행을 막으므로 큐는 생기지 않는다.
 */
export const FRAME_MIN_INTERVAL_MS = 100;

/** 구 24프레임 × 320ms — "더 가까이" 안내의 기존 체감 시간을 보존한다. */
export const CLOSER_HINT_MS = 7680;

/** 구 3프레임 × 320ms — 스치는 잘림에는 침묵하는 기존 체감 시간을 보존한다. */
export const CLIP_HINT_MS = 960;

/** 구 5프레임 × 320ms — 1440px 승격의 기존 비용 주기를 보존한다. */
export const ESCALATE_INTERVAL_MS = 1600;

/** 직전 전체 프레임 비용으로 다음 시작 간격을 정한다. */
export function adaptiveFrameIntervalMs(previousFrameCostMs) {
  const cost = Number(previousFrameCostMs);
  return Number.isFinite(cost) && cost > 0
    ? Math.max(FRAME_MIN_INTERVAL_MS, cost)
    : FRAME_MIN_INTERVAL_MS;
}

/** null 시작점은 아직 스트릭이 없다는 뜻이다. 나머지는 음수가 되지 않는 경과 시간이다. */
export function elapsedSinceMs(startedAtMs, nowAtMs) {
  if (startedAtMs === null || startedAtMs === undefined) return 0;
  const started = Number(startedAtMs);
  const now = Number(nowAtMs);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return 0;
  return Math.max(0, now - started);
}

/** 다음 승격은 언제나 직전 승격(또는 첫 실패)에서 고정 시간 뒤다. */
export function scheduleNextEscalationAt(nowAtMs) {
  const now = Number(nowAtMs);
  return (Number.isFinite(now) ? now : 0) + ESCALATE_INTERVAL_MS;
}

export function escalationDue(nowAtMs, nextAtMs) {
  const now = Number(nowAtMs);
  const next = Number(nextAtMs);
  return nextAtMs !== null && nextAtMs !== undefined
    && Number.isFinite(now) && Number.isFinite(next) && now >= next;
}
