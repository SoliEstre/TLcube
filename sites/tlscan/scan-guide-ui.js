/**
 * scan-guide-ui.js — 스캐너 K/C 조준 가이드의 순수 UI 상태·기하 헬퍼.
 *
 * 배포에서 `sites/tlscan` 이 문서 루트가 되므로 이 모듈은 `src/` 를 직접 import 하지
 * 않는다. scanner.js 가 정본 상수(EDGE_UNIT_OFFSETS · GUIDE_OUTER_FRACTION)를
 * 주입한다. 이 경계를 두면 브라우저 번들과 Node 국소 자가 같은 함수를 그대로 쓴다.
 */

export const SCAN_GUIDE_TYPE = Object.freeze({
  K: 'K',
  C: 'C',
});

export const DEFAULT_SCAN_GUIDE_TYPE = SCAN_GUIDE_TYPE.K;

/** EDGE_UNIT_OFFSETS[1] = (1, 0), 즉 Type C의 3시 V-노치 코너다. */
export const TYPE_C_NOTCH_VERTEX_INDEX = 1;

const GUIDE_COPY_KEYS = Object.freeze({
  [SCAN_GUIDE_TYPE.K]: Object.freeze({
    message: 'guide.message',
    detail: 'guide.dots',
  }),
  [SCAN_GUIDE_TYPE.C]: Object.freeze({
    message: 'guide.cMessage',
    detail: 'guide.cDots',
  }),
});

export function normalizeScanGuideType(value) {
  return value === SCAN_GUIDE_TYPE.C ? SCAN_GUIDE_TYPE.C : DEFAULT_SCAN_GUIDE_TYPE;
}

export function scanGuideCopyKeys(type) {
  return GUIDE_COPY_KEYS[normalizeScanGuideType(type)];
}

/**
 * Type C의 5점 좌표.
 *
 * Type C 외곽 육각의 꼭짓점은 E 방향이며, 3시 V-노치가 파낸 E_1만 표시하지 않는다.
 * 반지름은 K 바깥 링과 같은 `outerFraction * side / 2`라 두 가이드의 지름이 같다.
 */
export function typeCGuideDotPositions({
  screenSide,
  centerX = Number(screenSide) / 2,
  centerY = Number(screenSide) / 2,
  edgeUnitOffsets,
  outerFraction,
}) {
  const side = Number(screenSide);
  const cx = Number(centerX);
  const cy = Number(centerY);
  const fraction = Number(outerFraction);
  if (!(side > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)
      || !(fraction > 0) || !Array.isArray(edgeUnitOffsets)
      || edgeUnitOffsets.length !== 6) {
    return null;
  }

  for (const offset of edgeUnitOffsets) {
    if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
  }

  const notch = edgeUnitOffsets[TYPE_C_NOTCH_VERTEX_INDEX];
  if (notch.x !== 1 || notch.y !== 0) {
    throw new RangeError('Type C 가이드는 EDGE_UNIT_OFFSETS[1] = (1, 0)을 요구한다.');
  }

  const radius = fraction * (side / 2);
  return edgeUnitOffsets
    .filter((_, index) => index !== TYPE_C_NOTCH_VERTEX_INDEX)
    .map((offset) => ({
      x: cx + offset.x * radius,
      y: cy + offset.y * radius,
    }));
}

/**
 * K/C 선택 버튼을 한 개의 폐쇄 상태로 묶는다. DOM 전역을 읽지 않고 전달받은 root만
 * 만지므로 국소 자에서 브라우저 없이 검증할 수 있다.
 */
export function wireScanGuideType(root, options = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('스캔 가이드 선택 root가 필요하다.');
  }

  const buttons = [...root.querySelectorAll('[data-guide-type]')];
  const byType = new Map(buttons.map((button) => [button.dataset.guideType, button]));
  if (!byType.has(SCAN_GUIDE_TYPE.K) || !byType.has(SCAN_GUIDE_TYPE.C)) {
    throw new Error('스캔 가이드 선택에는 K와 C 버튼이 모두 필요하다.');
  }

  let type = normalizeScanGuideType(options.initialType);
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

  const paint = () => {
    for (const button of buttons) {
      const active = button.dataset.guideType === type;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  const setType = (nextType) => {
    const next = normalizeScanGuideType(nextType);
    if (next === type) return false;
    type = next;
    paint();
    onChange(type);
    return true;
  };

  const listeners = buttons.map((button) => {
    const listener = () => setType(button.dataset.guideType);
    button.addEventListener('click', listener);
    return [button, listener];
  });
  paint();

  return Object.freeze({
    get type() {
      return type;
    },
    setType,
    destroy() {
      for (const [button, listener] of listeners) button.removeEventListener('click', listener);
    },
  });
}
