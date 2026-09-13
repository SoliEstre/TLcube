/** 불신 락의 재탐색 시점 힌트. 기하·포맷·신뢰·수용 판정에는 쓰지 않는다. */
export function createYReacquireScene({ minGapFrames, correlationThreshold = 0.75 } = {}) {
  if (!Number.isSafeInteger(minGapFrames) || minGapFrames < 0) throw new TypeError('유효한 재탐색 간격이 필요해요');
  if (!Number.isFinite(correlationThreshold) || correlationThreshold < -1 || correlationThreshold > 1) {
    throw new TypeError('유효한 장면 상관 하한이 필요해요');
  }
  // 중앙 절반을 24×24로 요약한다. 각 칸의 4×4 표본 평균은 작은 화소 이동을 완화한다.
  // 두 고정 버퍼만 소유하며 입력 영상 참조나 전체 스냅샷은 보관하지 않는다.
  const side = 24, taps = 4, count = side * side;
  let previous = new Float64Array(count), current = new Float64Array(count);
  let valid = false, pendingChange = false, lastWidth = 0, lastHeight = 0, sinceRescue = minGapFrames;
  const stats = { correlation: null, rescues: 0, frames: 0 };
  function advanceFrame() { sinceRescue = Math.min(minGapFrames, sinceRescue + 1); }
  function invalidate() { valid = false; pendingChange = false; stats.correlation = null; }
  function reset() { invalidate(); sinceRescue = minGapFrames; stats.rescues = stats.frames = 0; }
  function observe(luma, width, height) {
    stats.frames++;
    const data = luma?.data ?? luma, alpha = luma?.alpha;
    if (!data || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 2 || height < 2 || data.length < width * height) { invalidate(); return false; }
    if (width !== lastWidth || height !== lastHeight) invalidate();
    lastWidth = width; lastHeight = height;
    let at = 0, sumA = 0, sumB = 0, squareA = 0, squareB = 0, cross = 0;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      let sum = 0;
      for (let j = 0; j < taps; j++) for (let i = 0; i < taps; i++) {
        const px = Math.floor(width * (0.25 + (x + (i + 0.5) / taps) / side * 0.5));
        const py = Math.floor(height * (0.25 + (y + (j + 0.5) / taps) / side * 0.5));
        const index = py * width + px, value = data[index];
        if (!Number.isFinite(value) || (alpha && !(alpha[index] > 0))) { invalidate(); return false; }
        sum += value;
      }
      const b = sum / (taps * taps), a = previous[at]; current[at++] = b;
      sumA += a; sumB += b; squareA += a * a; squareB += b * b; cross += a * b;
    }
    const varianceA = squareA - sumA * sumA / count, varianceB = squareB - sumB * sumB / count;
    const correlation = valid && varianceA > 1e-12 && varianceB > 1e-12
      ? Math.max(-1, Math.min(1, (cross - sumA * sumB / count) / Math.sqrt(varianceA * varianceB))) : null;
    const swap = previous; previous = current; current = swap; valid = true;
    stats.correlation = correlation;
    // 전환 도중 한 프레임은 두 코드의 잔상이 섞일 수 있다. 급변을 기록하되 다음
    // 실제 입력에서 새 장면의 안정성을 확인한 뒤 재탐색한다. 기존 Y 처리는 생략하지 않는다.
    if (correlation === null) { pendingChange = false; return false; }
    if (correlation < correlationThreshold) { pendingChange = true; return false; }
    const settledChange = pendingChange; pendingChange = false;
    // 연속 장면 변화도 기존 간격마다 한 번만 구제한다. 무신호/평탄 입력은 힌트가 아니다.
    if (!settledChange || sinceRescue < minGapFrames) return false;
    sinceRescue = 0; stats.rescues++; return true;
  }
  return Object.freeze({ observe, advanceFrame, invalidate, reset, stats });
}
