// generator-render-config.js — Type O/A 생성기의 정규 상태 → scene 옵션 경계

import { CENTER_QR_FINDER_PATTERN_ID } from './finder-selection.js';

/**
 * 중앙 QR은 중앙 슬롯을 독점한다. 특히 실험판의 기본 파인더가 cell-mask일 때도
 * finderPatternId를 생략해 기본값으로 되돌아가지 않도록 여기서 명시한다.
 */
export function sceneOptionsForOA({
  fallback,
  finderPatternId,
  palette,
  qrText,
  type,
}) {
  if (fallback === null || typeof fallback !== 'object') {
    throw new TypeError('O/A QR 폴백 상태가 필요하다');
  }
  if (type !== 'O' && type !== 'A') {
    throw new RangeError('sceneOptionsForOA는 Type O 또는 A만 받는다: ' + type);
  }

  const centerQr = fallback.mode === 'center';
  const opts = {
    palette,
    centerQr,
    finderPatternId: centerQr ? CENTER_QR_FINDER_PATTERN_ID : finderPatternId,
  };
  let needsCornerQr = false;
  if (centerQr) {
    opts.qrText = qrText;
    opts.cornerToo = Boolean(fallback.cornerToo);
    needsCornerQr = opts.cornerToo;
  } else if (fallback.mode === 'corner') {
    opts.qrText = qrText;
    opts.qrCorner = fallback.corner;
    needsCornerQr = true;
  }
  if (type === 'A' && !needsCornerQr) opts.margin = 20;
  return opts;
}
