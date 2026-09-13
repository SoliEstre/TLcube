/** 한 active unit의 iterator와 후속 검증을 같은 탐색 소스의 CPU 몫으로 계산해요. */
export function createPlanarWorkAccounting() {
  let active = false, owner = null, measuredIteratorMs = 0;
  const cost = value => {
    if (!Number.isFinite(value) || value < 0) throw new TypeError('유한 비음수 비용이 필요해요');
    return value;
  };
  function beginUnit() {
    if (active) throw new Error('소스 회계 unit은 중첩할 수 없어요');
    active = true; measuredIteratorMs = 0;
  }
  function recordGroup(group, elapsedMs) {
    if (!active) throw new Error('활성 unit에서만 소스 비용을 기록해요');
    const elapsed = cost(elapsedMs);
    if (!group || !Number.isFinite(group.spentMs) || group.spentMs < 0) throw new TypeError('유효한 소스 회계가 필요해요');
    // 0ms로 보인 아주 작은 iterator도 영원히 최우선이 되지 않도록 기존 최소값을 보존해요.
    group.spentMs += Math.max(0.001, elapsed);
    measuredIteratorMs += elapsed; owner = group;
  }
  function finishUnit(totalMs) {
    if (!active) throw new Error('활성 unit이 없어요');
    const elapsed = cost(totalMs);
    const outerMs = owner ? Math.max(0, elapsed - measuredIteratorMs) : 0;
    if (owner) owner.spentMs += outerMs;
    active = false;
    return outerMs;
  }
  return Object.freeze({ beginUnit, recordGroup, finishUnit });
}
