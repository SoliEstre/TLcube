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

/**
 * 하한 100 으로 묶은 직전 전체 프레임 비용. 두 뜻으로 쓰인다 — 스위치가 **없는** 화면의 R1 은 이
 * 값을 그대로 «복호 **시작** 시각 사이의 간격» 으로 쓰고, 스위치가 실재하는 화면은 이 값을
 * `idleAfterDecodeMs` 의 입력, 즉 **완료 뒤 유휴 창**의 재료로 쓴다 (sites/tlscan/scanner.js R1 캐던스).
 */
export function adaptiveFrameIntervalMs(previousFrameCostMs) {
  const cost = Number(previousFrameCostMs);
  return Number.isFinite(cost) && cost > 0
    ? Math.max(FRAME_MIN_INTERVAL_MS, cost)
    : FRAME_MIN_INTERVAL_MS;
}

/**
 * R1 단발 복호가 끝난 뒤 **쉬는 창**의 비율 (직전 프레임 비용 대비).
 *
 * 왜 있나: R1 단발 복호는 rAF 콜백 **안**의 동기 호출이라 1.4\~2.8 s 동안 메인 스레드를
 * 붙잡는다. 옛 캐던스는 간격을 «복호 **시작** 시각» 에서 재서, 간격 == 비용이면 복호가 끝나는
 * 순간 이미 다음 grab 이 도래해 있었다 — duty ≈ 99 %, 유휴는 한 프레임뿐. 그 한 프레임에
 * 입력(탭)은 접수돼도 **페인트**가 다음 복호 뒤로 밀린다.
 *
 * 거래(의도된 것): 사이클이 cost → cost × (1 + R1_IDLE_FRACTION) 가 되어 **처리율 ≈ −33 %**. 그 대가로
 * 복호 사이에 cost × 비율의 유휴가 생겨 입력·페인트·rAF 가 실제로 돈다. 밀도가 아니라 반응성을 산다.
 * (수치는 비율에서 유도된다 — scanner-frame-rate.test ⓔ 가 상수와 이 문장을 함께 잰다.)
 *
 * ⚠ **누가 이 거래를 치르나**: 엔진 스위치가 실재하는 화면(`r2Available`)만. **2026-09-06 승격**
 * 뒤로는 시험판·정식 **둘 다**가 그 화면이라, R1 위치를 고른 정식 사용자의 처리율도 −33 % 다
 * (결정 ⑮ 가 새 코드 없이 이 갈래를 타고 넘어갔다). 스위치가 없는 화면 — 승격을 되돌린 정식 —
 * 만 옛 시작 시각 기준 캐던스로 돌아간다
 * (sites/tlscan/scanner.js 의 `const intervalMs = r2Available ? … : …`).
 */
export const R1_IDLE_FRACTION = 0.5;

/**
 * 복호 **완료 시각**부터 다음 grab 까지의 최소 유휴 시간. 하한은 `FRAME_MIN_INTERVAL_MS` —
 * 빠른 기기에서 유휴가 0 으로 붕괴하지 않게 한다(그러면 옛 duty 99 % 로 되돌아간다).
 * 비유한·0 이하(= 아직 실측 없음)는 하한.
 */
export function idleAfterDecodeMs(previousFrameCostMs) {
  const cost = Number(previousFrameCostMs);
  return Number.isFinite(cost) && cost > 0
    ? Math.max(FRAME_MIN_INTERVAL_MS, Math.round(cost * R1_IDLE_FRACTION))
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
