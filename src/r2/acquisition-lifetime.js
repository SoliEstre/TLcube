/** 획득 원본의 나이와 실제로 서비스한 작업량을 분리해 기록해요. */
export function normalizeAcquisitionPolicy(value = 'age') {
  const input = typeof value === 'string' ? { mode: value } : value;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !['age', 'work'].includes(input.mode)
    || Object.keys(input).some(key => !['mode', 'maxServiceMs', 'maxWorkUnits'].includes(key))) {
    throw new TypeError('획득 정책은 age/work와 유한 작업 상한이어야 해요');
  }
  // 최초 측정용 구현 파라미터예요. 영상·포맷·RS 수용 문턱이 아니에요.
  const maxServiceMs = input.maxServiceMs ?? 4000;
  const maxWorkUnits = input.maxWorkUnits ?? 1_000_000;
  if (!Number.isFinite(maxServiceMs) || maxServiceMs <= 0
    || !Number.isSafeInteger(maxWorkUnits) || maxWorkUnits <= 0) {
    throw new TypeError('획득 작업 상한은 유한 양수여야 해요');
  }
  return Object.freeze({ mode: input.mode, maxServiceMs, maxWorkUnits });
}

/** 최근 종료 8건만 보유해요. 영상/기하/후보 객체를 저널에 넣지 않아요. */
export function createAcquisitionJournal(policy) {
  let sequence = 0, active = null;
  const closed = [];
  const journal = {
    begin(origin, stage, copyMs = 0) {
      active = { id: ++sequence, origin: { ...origin }, last: { ...origin },
        serviceMs: Math.max(0, copyMs), units: 0, stage, closeReason: null,
        hypotheses: 0, formatReads: 0, candidateReady: 0, currentAccepted: 0, currentRejected: 0 };
      return active;
    },
    observe(row, current) { if (row && current) Object.assign(row.last, current); },
    charge(row, ms, units = 1, stage = row?.stage) {
      if (!row) return;
      row.serviceMs += Math.max(0, ms); row.units += units; row.stage = stage;
    },
    event(row, name, count = 1) { if (row) row[name] += count; },
    reason(row) {
      if (!row || policy.mode !== 'work') return null;
      if (row.serviceMs >= policy.maxServiceMs) return 'work-service-limit';
      if (row.units >= policy.maxWorkUnits) return 'work-unit-limit';
      return null;
    },
    close(row, reason) {
      if (!row || row.closeReason) return;
      row.closeReason = reason; closed.push(row);
      if (closed.length > 8) closed.shift();
      if (active === row) active = null;
    },
    snapshot() {
      const view = row => row && ({ ...row, origin: { ...row.origin }, last: { ...row.last },
        ageFrames: row.last.ordinal - row.origin.ordinal,
        ageMs: row.last.timestamp - row.origin.timestamp });
      return { policy: { ...policy }, started: sequence, active: view(active), closed: closed.map(view) };
    },
  };
  return journal;
}
