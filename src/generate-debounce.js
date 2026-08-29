/**
 * generate-debounce.js — 생성 비콘의 시간 축을 다루는 순수 상태 전이.
 *
 * 렌더·타이머·DOM 수명주기는 여기서 모른다. 입력은 change/time/flush 세 사건뿐이고,
 * 호출자는 반환된 emitted를 실제 비콘으로 보내고 pending.dueAt에 타이머를 맞춘다.
 */

/** 입력·설정 변경이 이 시간 동안 없으면 하나의 정착된 설정으로 본다. */
export const GENERATE_SETTLE_MS = 1_800;

export function createGenerateDebounceState() {
  return { lastSignature: '', pending: null };
}

function emitPending(state) {
  if (!state.pending) return { state, emitted: [] };
  return {
    state: { ...state, pending: null },
    emitted: [state.pending.props],
  };
}

/**
 * @param {{lastSignature:string, pending:null|{dueAt:number, props:object}}} state
 * @param {{type:'change'|'time'|'flush', at?:number, signature?:string,
 *   props?:object, enabled?:boolean}} action
 * @returns {{state:object, emitted:object[]}}
 */
export function reduceGenerateDebounce(state, action) {
  if (!state || typeof state.lastSignature !== 'string') {
    throw new TypeError('generate debounce 상태가 올바르지 않다');
  }
  if (!action || typeof action.type !== 'string') {
    throw new TypeError('generate debounce 사건이 올바르지 않다');
  }

  if (action.type === 'flush') return emitPending(state);

  const at = Number(action.at);
  if (!Number.isFinite(at)) throw new TypeError('generate debounce 시각은 유한수여야 한다');

  if (action.type === 'time') {
    if (!state.pending || at < state.pending.dueAt) return { state, emitted: [] };
    return emitPending(state);
  }

  if (action.type !== 'change') {
    throw new RangeError(`알 수 없는 generate debounce 사건: ${action.type}`);
  }
  if (typeof action.signature !== 'string') {
    throw new TypeError('generate 설정 서명은 문자열이어야 한다');
  }

  // 타이머가 바쁜 탭에서 늦게 실행됐으면 새 변경을 받기 전에 이미 정착한 상태부터 낸다.
  let working = state;
  let emitted = [];
  if (working.pending && at >= working.pending.dueAt) {
    const settled = emitPending(working);
    working = settled.state;
    emitted = settled.emitted;
  }

  // 기존 내용 서명 축을 유지한다. 같은 렌더는 새 의도가 아니며 정착 시계도 늘리지 않는다.
  if (action.signature === working.lastSignature) return { state: working, emitted };

  working = { ...working, lastSignature: action.signature };
  // 첫 예제 자동 렌더는 관측만 한다. 이후 같은 상태를 중복 생성으로 세지 않기 위해서다.
  if (action.enabled !== true) return { state: working, emitted };

  return {
    state: {
      ...working,
      pending: {
        dueAt: at + GENERATE_SETTLE_MS,
        props: action.props && typeof action.props === 'object' ? { ...action.props } : {},
      },
    },
    emitted,
  };
}
