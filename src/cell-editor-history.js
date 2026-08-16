/**
 * cell-editor-history.js — 셀 편집기 되돌리기/다시하기 코어 (순수 · DOM 무관)
 *
 * 왜 별도 모듈인가: 편집기가 두 곳에 있다(생성기 `/lab/` 섹션 · 독립 `/celleditor/`).
 * 둘이 같은 되돌리기 의미를 갖지 않으면 사용자는 «여기선 한 번에 지워지는데 저기선
 * 셀마다 지워진다» 를 겪는다. 스택 규칙을 여기 한 곳에 두고 양쪽이 부른다.
 *
 * ## 스냅샷은 불투명하다
 * 이 모듈은 스냅샷의 **내용을 모른다**. 호출자가 «복제본» 을 만들어 넣고, 되돌릴 때
 * 받은 값을 자기 상태에 되붙인다. 그래서 Type Y 편집기(type-y-cell-editor.js)와
 * 다중 타입 코어(cell-editor-core.js)가 서로 다른 상태 모양을 갖고도 같은 스택을 쓴다.
 *
 * ## 스트로크 코얼레싱 (핵심)
 * 드래그 도색은 셀 수십 개를 건드리지만 사용자에게는 **한 동작**이다. 셀마다 스냅샷을
 * 쌓으면 Ctrl+Z 를 수십 번 눌러야 한 번의 붓질이 지워진다 — 되돌리기가 있으나 마나다.
 * 그래서 `beginStroke` 가 스트로크 **시작 직전** 스냅샷 하나만 넣고 스택을 잠근다.
 * 잠긴 동안의 `recordSnapshot` 은 전부 무시된다(=코얼레싱). `endStroke` 로 푼다.
 * 단위는 **스트로크**이지 셀이 아니다.
 *
 * ## 스텝은 «실제로 바뀐 뒤» 에만 생긴다 (빈 스텝 금지)
 * 잠긴 셀(중앙 파인더·reference/format·파인더 점유)을 눌러도 스텝이 생기면 Ctrl+Z 가
 * 아무것도 안 하는 것처럼 보이고, 반복 클릭이 유한 스택을 밀어내 **되돌릴 수 있었던
 * 진짜 편집을 잃는다**. 그래서 두 장치가 있다:
 *   1. `armStroke` — 포인터를 누른 순간은 «예약» 만 한다. 첫 실제 편집에서 확정된다.
 *   2. `commitEdit` — 편집 전 스냅샷 → `apply()` → **바뀐 경우에만** 기록.
 * 호출자가 «기록 → 편집» 순서로 직접 부르면 이 규칙이 깨진다. 편집 경로는 전부
 * `commitEdit` 를 지난다.
 *
 * ## 유한 스택
 * 상한 `CELL_EDITOR_HISTORY_LIMIT = 50` 스텝. 넘으면 **가장 오래된 것부터** 버린다
 * (스냅샷이 Set·Map 복제라 무한 스택은 큰 격자에서 메모리를 먹는다).
 *
 * ## 타입(·크기)별 분리
 * 스토어는 `historyKey(type, size)` 로 버킷을 가른다. Type Y n=21 스냅샷을 Type O k=6
 * 상태에 되붙이는 것은 좌표계부터 다르므로 **되돌리기가 아니라 파괴**다. 타입 전환이
 * 히스토리를 비우지 않고 «그 타입의 히스토리로 갈아타는» 이유다.
 *
 * 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).
 */

/** 되돌리기 스택 상한 (스텝 수). */
export const CELL_EDITOR_HISTORY_LIMIT = 50;

/** 단축키 분류 결과. */
export const HISTORY_SHORTCUT_UNDO = 'undo';
export const HISTORY_SHORTCUT_REDO = 'redo';

/**
 * 편집 단위. 드래그 중복 방지 키는 **편집 단위와 같아야 한다**.
 * 톤 편집은 면(T/L/R) 하나를 바꾸지만 마스크 토글은 좌표 하나를 세 면 공통으로
 * 뒤집으므로, 한 셀의 여러 면을 스치면 면 단위 키로는 토글이 여러 번 일어나 상쇄된다.
 */
export const CELL_EDIT_UNIT_FACE = 'face';
export const CELL_EDIT_UNIT_COORD = 'coord';

/**
 * 마스크 모드 이름. `cell-editor-core` · `type-y-cell-editor` 의
 * `CELL_EDITOR_MODE_MASK` 와 **같은 값이어야 한다** (이 모듈은 의존성 0 이라 못
 * 가져온다 — 어긋나면 테스트가 잡는다).
 */
export const HISTORY_MASK_MODE = 'mask';

// ─────────────────────────────────────────────────────────────────────────────
// 버킷 단위 API — 상태 객체가 곧 버킷일 수도 있다 (cell-editor-core 가 그렇게 쓴다)
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {{undoStack: Array, redoStack: Array, strokeOpen: boolean, pendingStroke: null}} */
export function createHistoryBucket() {
  return { undoStack: [], redoStack: [], strokeOpen: false, pendingStroke: null };
}

function assertBucket(bucket) {
  if (bucket === null || typeof bucket !== 'object'
    || !Array.isArray(bucket.undoStack) || !Array.isArray(bucket.redoStack)) {
    throw new TypeError('undoStack/redoStack 배열을 가진 히스토리 버킷이 필요하다');
  }
  return bucket;
}

function normalizeLimit(limit) {
  return Number.isInteger(limit) && limit > 0 ? limit : CELL_EDITOR_HISTORY_LIMIT;
}

function pushBounded(stack, snapshot, limit) {
  stack.push(snapshot);
  while (stack.length > limit) stack.shift();
}

/**
 * 새 스텝 기록. 스트로크가 열려 있으면 **아무것도 하지 않는다**(코얼레싱).
 * @returns {boolean} 실제로 쌓았으면 true
 */
export function recordOnBucket(bucket, snapshot, limit) {
  assertBucket(bucket);
  if (bucket.strokeOpen === true) return false;
  pushBounded(bucket.undoStack, snapshot, normalizeLimit(limit));
  bucket.redoStack.length = 0;
  return true;
}

/**
 * 스트로크 시작. 시작 직전 스냅샷 하나를 쌓고 스택을 잠근다.
 * 이미 열려 있으면 false (중첩 스트로크는 스텝을 더 만들지 않는다).
 */
export function beginStrokeOnBucket(bucket, snapshot, limit) {
  assertBucket(bucket);
  if (bucket.strokeOpen === true) return false;
  pushBounded(bucket.undoStack, snapshot, normalizeLimit(limit));
  bucket.redoStack.length = 0;
  bucket.strokeOpen = true;
  return true;
}

/**
 * 스트로크 **예약**. 스냅샷을 들고만 있다가 첫 실제 편집(`commitEdit`)에서 확정한다.
 * 잠긴 셀을 눌렀을 뿐인 클릭은 스텝을 만들지 않는다 (모듈 주석 «빈 스텝 금지»).
 * @returns {boolean} 예약했으면 true (이미 열린 스트로크면 false)
 */
export function armStrokeOnBucket(bucket, snapshot) {
  assertBucket(bucket);
  if (bucket.strokeOpen === true) return false;
  bucket.pendingStroke = { snapshot };
  return true;
}

export function isStrokeArmedOnBucket(bucket) {
  assertBucket(bucket);
  return bucket.pendingStroke !== null && bucket.pendingStroke !== undefined;
}

/** 스트로크 종료. 열려 있지 않았으면 false (예약만 있었으면 그 예약을 버린다). */
export function endStrokeOnBucket(bucket) {
  assertBucket(bucket);
  bucket.pendingStroke = null;
  if (bucket.strokeOpen !== true) return false;
  bucket.strokeOpen = false;
  return true;
}

export function isStrokeOpenOnBucket(bucket) {
  assertBucket(bucket);
  return bucket.strokeOpen === true;
}

/**
 * `apply()` 결과 → «실제로 바뀌었나».
 * - `false` · `{changed:false}` → 무동작 (스텝 없음)
 * - `true` · `{changed:true}` · `undefined` → 변경으로 본다.
 *   판정 불가(`undefined`)를 «변경» 으로 두는 이유: 스텝을 잃는 쪽이 더 나쁘다.
 */
export function editDidChange(outcome) {
  if (outcome === false) return false;
  if (outcome !== null && typeof outcome === 'object' && 'changed' in outcome) {
    return outcome.changed !== false;
  }
  return true;
}

/**
 * 편집 한 번을 스텝 규칙 아래서 수행한다 — **이 모듈의 정문**이다.
 *
 * 1. 스냅샷이 필요할 때만(예약도 열린 스트로크도 없을 때) `snapshot()` 을 부른다.
 * 2. `apply()` 로 실제 편집을 한다.
 * 3. 바뀐 경우에만 스텝을 만든다 — 예약이 있었으면 그 예약 스냅샷으로 스트로크를 연다.
 *
 * @param {{snapshot: function, apply: function, limit?: number}} options
 * @returns {{changed: boolean, recorded: boolean, outcome: *}}
 */
export function commitEditOnBucket(bucket, options) {
  assertBucket(bucket);
  const { snapshot, apply, limit } = options || {};
  if (typeof snapshot !== 'function' || typeof apply !== 'function') {
    throw new TypeError('commitEdit 는 snapshot()·apply() 함수가 필요하다');
  }
  const armed = isStrokeArmedOnBucket(bucket) ? bucket.pendingStroke : null;
  const needsBefore = armed === null && bucket.strokeOpen !== true;
  const before = needsBefore ? snapshot() : null;
  const outcome = apply();
  if (!editDidChange(outcome)) return { changed: false, recorded: false, outcome };
  if (armed !== null) {
    bucket.pendingStroke = null;
    return {
      changed: true,
      recorded: beginStrokeOnBucket(bucket, armed.snapshot, limit),
      outcome,
    };
  }
  if (!needsBefore) return { changed: true, recorded: false, outcome }; // 코얼레싱
  return { changed: true, recorded: recordOnBucket(bucket, before, limit), outcome };
}

export function canUndoBucket(bucket) {
  assertBucket(bucket);
  return bucket.undoStack.length > 0;
}

export function canRedoBucket(bucket) {
  assertBucket(bucket);
  return bucket.redoStack.length > 0;
}

/**
 * 되돌리기/다시하기는 진행 중인 붓질을 **끝낸다**.
 *
 * 왜: 스트로크가 열린 채로 스냅샷만 팝되면 그 뒤의 편집은 전부 코얼레싱돼 기록에서
 * 사라진다(스택은 잠겨 있는데 되돌릴 스냅샷은 이미 빠져나갔다). UI 쪽도 같은 규칙을
 * 따라 포인터 스트로크를 함께 끝낸다.
 */
function closeStrokeForStep(bucket) {
  bucket.strokeOpen = false;
  bucket.pendingStroke = null;
}

/**
 * 한 스텝 되돌린다. 현재 스냅샷을 redo 로 넘기고 직전 스냅샷을 돌려준다.
 * @returns {*} 되붙일 스냅샷. 되돌릴 것이 없으면 null.
 */
export function undoOnBucket(bucket, currentSnapshot) {
  assertBucket(bucket);
  closeStrokeForStep(bucket);
  if (bucket.undoStack.length === 0) return null;
  bucket.redoStack.push(currentSnapshot);
  return bucket.undoStack.pop();
}

/** 한 스텝 다시 적용한다. 되돌리기의 정확한 역이다. */
export function redoOnBucket(bucket, currentSnapshot, limit) {
  assertBucket(bucket);
  closeStrokeForStep(bucket);
  if (bucket.redoStack.length === 0) return null;
  pushBounded(bucket.undoStack, currentSnapshot, normalizeLimit(limit));
  return bucket.redoStack.pop();
}

/** 버킷 초기화 — 열린 스트로크도 닫고 예약도 버린다. */
export function clearBucketHistory(bucket) {
  assertBucket(bucket);
  bucket.undoStack.length = 0;
  bucket.redoStack.length = 0;
  bucket.strokeOpen = false;
  bucket.pendingStroke = null;
  return bucket;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스토어 API — (타입, 크기) 별 버킷
// ─────────────────────────────────────────────────────────────────────────────

/** 버킷 키. 크기까지 넣는 이유는 모듈 주석 참조 (n=21 스냅샷 ≠ k=6 상태). */
export function historyKey(type, size) {
  return `${type}:${size}`;
}

export function createHistoryStore(options = {}) {
  return {
    limit: normalizeLimit(options.limit),
    buckets: new Map(),
  };
}

function assertStore(store) {
  if (store === null || typeof store !== 'object' || !(store.buckets instanceof Map)) {
    throw new TypeError('createHistoryStore() 가 만든 스토어가 필요하다');
  }
  return store;
}

export function bucketFor(store, key) {
  assertStore(store);
  let bucket = store.buckets.get(key);
  if (!bucket) {
    bucket = createHistoryBucket();
    store.buckets.set(key, bucket);
  }
  return bucket;
}

export function recordSnapshot(store, key, snapshot) {
  return recordOnBucket(bucketFor(store, key), snapshot, store.limit);
}

export function beginStroke(store, key, snapshot) {
  return beginStrokeOnBucket(bucketFor(store, key), snapshot, store.limit);
}

export function armStroke(store, key, snapshot) {
  return armStrokeOnBucket(bucketFor(store, key), snapshot);
}

export function endStroke(store, key) {
  return endStrokeOnBucket(bucketFor(store, key));
}

export function isStrokeOpen(store, key) {
  return isStrokeOpenOnBucket(bucketFor(store, key));
}

export function isStrokeArmed(store, key) {
  return isStrokeArmedOnBucket(bucketFor(store, key));
}

/** 편집 한 번 — 스냅샷 → apply() → **바뀐 경우에만** 기록. `commitEditOnBucket` 참조. */
export function commitEdit(store, key, options) {
  return commitEditOnBucket(bucketFor(store, key), { ...options, limit: store.limit });
}

export function canUndo(store, key) {
  return canUndoBucket(bucketFor(store, key));
}

export function canRedo(store, key) {
  return canRedoBucket(bucketFor(store, key));
}

export function undoSnapshot(store, key, currentSnapshot) {
  return undoOnBucket(bucketFor(store, key), currentSnapshot);
}

export function redoSnapshot(store, key, currentSnapshot) {
  return redoOnBucket(bucketFor(store, key), currentSnapshot, store.limit);
}

export function clearHistory(store, key) {
  if (key === undefined) {
    assertStore(store);
    store.buckets.clear();
    return store;
  }
  clearBucketHistory(bucketFor(store, key));
  return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// 단축키 분류 — 이벤트 «모양» 만 본다 (DOM 없이 테스트된다)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 글상자 태그. **`SELECT` 는 없다** — 브라우저에 `<select>` 기본 되돌리기가 없어서
 * 여기 넣으면 «기본 동작 보존» 이 아니라 그냥 Ctrl+Z 가 죽는다. 실제로 독립 편집기의
 * 크기·스타터 `<select>` 를 바꾼 직후(포커스가 select 에 남는다) 되돌리기가 먹지
 * 않았다. 되돌릴 «방금 친 글자» 가 있는 곳만 넣는다.
 */
const TEXT_ENTRY_TAGS = Object.freeze(['INPUT', 'TEXTAREA']);

/**
 * 글상자 안인가. **여기서 true 면 편집기는 손을 뗀다** — 이름 칸·붙여넣기 칸에서
 * Ctrl+Z 는 «방금 친 글자» 를 되돌려야지 «방금 칠한 셀» 을 되돌리면 안 된다.
 * 브라우저 기본 동작을 가로채지 않는 것이 계약이다.
 */
export function isTextEntryTarget(target) {
  if (target === null || typeof target !== 'object') return false;
  if (target.isContentEditable === true) return true;
  const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return TEXT_ENTRY_TAGS.includes(tagName);
}

/**
 * 키 이벤트 → 히스토리 동작.
 *
 * - Ctrl/Cmd + Z        → undo
 * - Ctrl/Cmd + Shift + Z → redo
 * - Ctrl/Cmd + Y        → redo
 * - 그 외, Alt 조합, 글상자 안 → null (가로채지 않는다)
 *
 * @param {{ctrlKey?:boolean, metaKey?:boolean, shiftKey?:boolean, altKey?:boolean,
 *          key?:string, target?:object}} event
 * @returns {'undo'|'redo'|null}
 */
export function classifyHistoryShortcut(event) {
  if (event === null || typeof event !== 'object') return null;
  if (isTextEntryTarget(event.target)) return null;
  if (!(event.ctrlKey === true || event.metaKey === true)) return null;
  if (event.altKey === true) return null;
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key === 'z') return event.shiftKey === true ? HISTORY_SHORTCUT_REDO : HISTORY_SHORTCUT_UNDO;
  if (key === 'y') return event.shiftKey === true ? null : HISTORY_SHORTCUT_REDO;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 드래그 중복 방지 — 편집 «단위» 계산
// ─────────────────────────────────────────────────────────────────────────────

/** 편집 모드 → 편집 단위. 마스크 토글은 좌표 단위(세 면 공통), 톤 편집은 면 단위다. */
export function editUnitForMode(mode) {
  return mode === HISTORY_MASK_MODE ? CELL_EDIT_UNIT_COORD : CELL_EDIT_UNIT_FACE;
}

/**
 * 드래그 한 번에 «같은 것을 두 번 편집» 하는 것을 막는 키.
 *
 * ⚠ 단위를 틀리면 조용히 상쇄된다: 마스크 모드에서 면 단위 키를 쓰면 한 셀의 T·L·R 을
 * 스칠 때 좌표 토글이 3회 일어나 드래그가 «아무 일도 안 한» 결과가 된다 (2회면 원복).
 *
 * @param {{face?: string, i?: number, j?: number, q?: number, r?: number}} cell
 * @param {string} mode 편집 모드 ('mask' | 'tone')
 */
export function editUnitKey(cell, mode) {
  if (cell === null || typeof cell !== 'object') {
    throw new TypeError('편집 단위 키는 셀 객체가 필요하다');
  }
  const coord = cell.i === undefined ? `${cell.q},${cell.r}` : `${cell.i},${cell.j}`;
  return editUnitForMode(mode) === CELL_EDIT_UNIT_COORD ? coord : `${cell.face}:${coord}`;
}
