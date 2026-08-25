/**
 * generator-types.js — 생성기 타입 목록의 **유일한 정의**.
 *
 * 왜 별도 모듈인가: `generator-state.js` 가 `finder-selection.js` 를 import 하므로
 * (스키마가 파인더·QR 프로파일을 필요로 한다) 반대 방향 import 는 순환이 된다.
 * 그래서 둘 다 이 모듈을 본다 — 어느 쪽도 목록을 소유하지 않는다.
 *
 * ⚠ 2026-08-25 까지 `finder-selection.js:56` 이 `['O','A','Y']` **손 사본**을 들고
 *   있었다. 「수기 사본 철폐」 때 놓친 자리이고, Type K 를 붙이려 할 때 스키마보다
 *   **앞서** RangeError 를 내는 진짜 첫 관문이었다. 자를 두 군데 적으면 반드시
 *   어긋나고, 어긋난 쪽이 먼저 죽는다.
 */

/**
 * 생성기 화면에서 고를 수 있는 타입.
 *
 * - `O` 육각 · `A` 삼각(정립) · `Y` 큐브 · `K` 별
 * - 내부 타입(`G` = O+o-cm · `V` = A+turnA)은 **여기 없다** — 자리·옵션에서 유도되는
 *   파생 타입이라 카드로 고르는 축이 아니다 (index.html effectiveEditorTypeFromGenerator).
 */
export const GENERATOR_TYPES = Object.freeze(['O', 'A', 'Y', 'K']);
