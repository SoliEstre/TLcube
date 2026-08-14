/**
 * 포커스·클릭 시 입력값 전체를 선택한다.
 *
 * 마우스로 포커스하면 mouseup 이 선택을 풀어 버린다. 그 한 번의 mouseup 만
 * 막고, 이미 포커스된 뒤의 드래그·부분 선택은 그대로 둔다. 키보드 포커스는
 * mouseup 이 없으므로 focus 에서 고른다.
 */

export function wireSelectAllOnActivate(input) {
  if (!input || typeof input.addEventListener !== 'function') {
    throw new TypeError('선택 대상 입력이 필요하다');
  }

  let selectOnMouseUp = false;

  function selectAll() {
    if (typeof input.select === 'function') input.select();
  }

  input.addEventListener('focus', () => {
    selectOnMouseUp = true;
    queueMicrotask(selectAll);
  });

  input.addEventListener('mouseup', (event) => {
    if (!selectOnMouseUp) return;
    selectOnMouseUp = false;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    selectAll();
  });

  input.addEventListener('blur', () => {
    selectOnMouseUp = false;
  });

  input.addEventListener('keydown', () => {
    selectOnMouseUp = false;
  });
}
