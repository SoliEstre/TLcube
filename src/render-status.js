// render-status.js — 생성기 렌더 결과와 에러 표시의 단일 경계

function errorMessage(error) {
  return String(error && error.message ? error.message : error);
}

/**
 * 동기 렌더 작업을 실행하고 표시를 그 결과로 완전히 교체한다.
 * 성공 콜백이 빈 문자열을 반환하면 이전 경로에서 남긴 어떤 에러도 비워진다.
 */
export function renderWithErrorDisplay(errorOutput, renderOperation, onError = () => {}) {
  if (!errorOutput || typeof errorOutput !== 'object') {
    throw new TypeError('errorOutput 객체가 필요하다');
  }
  if (typeof renderOperation !== 'function' || typeof onError !== 'function') {
    throw new TypeError('renderOperation 과 onError 콜백이 필요하다');
  }

  try {
    const successMessage = renderOperation();
    errorOutput.textContent =
      successMessage === undefined || successMessage === null ? '' : String(successMessage);
    return true;
  } catch (error) {
    errorOutput.textContent = errorMessage(error);
    onError(error);
    return false;
  }
}
