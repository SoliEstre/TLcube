// placementY.js — Type Y 레퍼런스 조 · 포맷 정보 15셀 · 역할 배치 (SPEC §14, ADR 0003 U8·U9)
//
// Type Y 는 인덱스 공간이다 — 셀은 3면 공통 좌표 (i,j), 0..n-1 정수 좌표일 뿐 기하가
// 필요 없다(hexgrid.js/ygrid 미참조). 이 모듈은 "n×n 격자 어디에 레퍼런스·포맷 정보가
// 사는가"만 다룬다. scan order(U7)는 layoutY.js, 용량 회계(생성물 표)는 capacityY.js
// 소관.
//
// 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).

// ─────────────────────────────────────────────────────────────────────────────
// 레퍼런스 4조 (U9) — SPEC §14 "라틴 스퀘어 digit {0,4,3} 3셀 1조, 공간 분산 ≥ 3조"
// ─────────────────────────────────────────────────────────────────────────────
//
// 조 앵커(순서 고정): A = (2,2), (n-3,2), (2,n-3), (n-3,n-3). 네 앵커는 격자의 네
// 모서리 근방(가장자리에서 inset 2)에 하나씩 놓여 "공간 분산(비일직선) ≥ 3조" 요건을
// 코너 대각 배치로 만족한다.
//
// 조 내 3셀: L자형 [(p,q), (p+1,q), (p,q+1)] — 앵커 (p,q) 에서 i 방향으로 한 칸,
// j 방향으로 한 칸. 이 3셀에 `REFERENCE_GROUP_DIGITS = [0,4,3]` 을 그 순서대로 배정한다
// (ADR 0003 D3: digit {0,4,3} 의 순위행이 세 면 모두에 레벨 {0,1,2} 전부를 준다).

/** 레퍼런스 조 내 3셀에 배정하는 digit, L자형 셀 순서([(p,q),(p+1,q),(p,q+1)])대로. */
export const REFERENCE_GROUP_DIGITS = Object.freeze([0, 4, 3]);

function key(i, j) {
  return `${i},${j}`;
}

function assertSize(n) {
  if (!Number.isInteger(n) || n < 9) {
    // n < 9 이면 앵커 (n-3,n-3) 등이 (2,2) 와 겹치거나 음수가 된다 — Type Y 최소
    // 버전(Y1: n=21)보다 훨씬 작은 값에서 이미 무의미하므로 넉넉히 9 미만을 막는다.
    throw new RangeError(`n 은 9 이상의 정수여야 한다: ${n}`);
  }
  return n;
}

/** 레퍼런스 조 앵커 4개, 조 순서 고정: (2,2) · (n-3,2) · (2,n-3) · (n-3,n-3). */
export function referenceAnchors(n) {
  assertSize(n);
  return [
    { p: 2, q: 2 },
    { p: n - 3, q: 2 },
    { p: 2, q: n - 3 },
    { p: n - 3, q: n - 3 },
  ];
}

/**
 * 레퍼런스 4조. 각 조 = {cells: [{i,j}×3], digits: REFERENCE_GROUP_DIGITS}.
 * cells 순서 = [(p,q), (p+1,q), (p,q+1)], digits[k] 가 cells[k] 에 대응.
 * @param {number} n
 * @returns {{cells:{i:number,j:number}[], digits: number[]}[]} 길이 4
 */
export function referenceGroups(n) {
  assertSize(n);
  return referenceAnchors(n).map(({ p, q }) => ({
    cells: [
      { i: p, j: q },
      { i: p + 1, j: q },
      { i: p, j: q + 1 },
    ],
    digits: REFERENCE_GROUP_DIGITS,
  }));
}

/**
 * 레퍼런스 12셀 전부(조 순 · 조 내 순 평탄화), 각 셀에 digit 을 얹은 목록.
 * @param {number} n
 * @returns {{i:number, j:number, digit:number}[]} 길이 12
 */
export function referenceCellsAll(n) {
  const out = [];
  for (const group of referenceGroups(n)) {
    group.cells.forEach((cell, idx) => {
      out.push({ ...cell, digit: group.digits[idx] });
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 포맷 정보 15셀 (U8) — 3복제 × 5셀
// ─────────────────────────────────────────────────────────────────────────────
//
// §5.4 구조(12bit·CRC-6·5digit·3복제)를 승계한다. Type Y 는 링 구조가 없으므로
// (인덱스 격자에는 "링"이라는 자연스러운 순회가 없다), 결정 규칙을 좌표 직접 서술로
// 고정한다 — 전 셀 가장자리 inset ≥ 1(0 또는 n-1 좌표를 쓰지 않는다):
//
//   복제 0 = (2,1)..(6,1)         — i = 2..6 오름차순, j = 1 고정
//   복제 1 = (1,2)..(1,6)         — i = 1 고정, j = 2..6 오름차순
//   복제 2 = (n-8,n-2)..(n-4,n-2) — i = n-8..n-4 오름차순, j = n-2 고정
//
// 레퍼런스 4조(위)와 좌표가 절대 겹치지 않아야 하는 와이어 계약이다 — 겹치면
// 조용히 시프트하지 않고 **모듈 로드 시점에 throw** 한다(아래 자기검증 블록).

export const FORMAT_BLOCK_LENGTH = 5;
export const FORMAT_REPLICAS = 3;

/** 포맷 정보 15셀 (복제 3개 × 5셀), 복제 순 · 복제 내 오름차순으로 이어붙인 목록. */
export function formatCells(n) {
  assertSize(n);
  const cells = [];
  for (let i = 2; i <= 6; i += 1) cells.push({ i, j: 1 });
  for (let j = 2; j <= 6; j += 1) cells.push({ i: 1, j });
  for (let i = n - 8; i <= n - 4; i += 1) cells.push({ i, j: n - 2 });
  return cells;
}

function assertFormatInset(n) {
  for (const { i, j } of formatCells(n)) {
    if (i < 1 || i > n - 2 || j < 1 || j > n - 2) {
      throw new RangeError(
        `n=${n}: 포맷 셀 (${i},${j}) 이 가장자리 inset ≥ 1 을 위반한다`,
      );
    }
  }
}

function assertNoReferenceFormatCollision(n) {
  const refSet = new Set(referenceCellsAll(n).map((c) => key(c.i, c.j)));
  for (const { i, j } of formatCells(n)) {
    if (refSet.has(key(i, j))) {
      throw new RangeError(
        `n=${n}: 포맷 셀 (${i},${j}) 이 레퍼런스 셀과 충돌한다 — 결정 규칙을 다시 확정해야 한다`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 역할 분할
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 반경(격자 크기) n 전체의 역할 분류표를 한 번에 만든다 (layout.js `buildRoleSets`
 * 대칭 구조 — roleOf 를 셀마다 재계산하지 않도록 Set 을 미리 구성한다).
 * @param {number} n
 * @returns {{reference: Set<string>, format: Set<string>}}
 */
export function buildRoleSets(n) {
  assertSize(n);
  const reference = new Set(referenceCellsAll(n).map((c) => key(c.i, c.j)));
  const format = new Set(formatCells(n).map((c) => key(c.i, c.j)));
  return { reference, format };
}

/**
 * 셀 (i,j) 의 역할. Type O 와 달리 불스아이·앵커가 없다 — reference | format | data 뿐.
 * @param {number} i
 * @param {number} j
 * @param {number} n
 * @param {{reference:Set<string>, format:Set<string>}} [roleSets]
 * @returns {'reference'|'format'|'data'}
 */
export function roleOf(i, j, n, roleSets) {
  const sets = roleSets || buildRoleSets(n);
  const kk = key(i, j);
  if (sets.reference.has(kk)) return 'reference';
  if (sets.format.has(kk)) return 'format';
  return 'data';
}

// ─────────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 — n=21(Y1)·25(Y2) 무충돌·inset 전수 확인
// ─────────────────────────────────────────────────────────────────────────────
//
// "충돌 시 조용히 시프트" 금지(과제 지침) — 결정 규칙이 깨지면 import 시점에 즉시
// 알아챈다. VERSIONS_Y(capacityY.js)와 별개로 이 모듈 자체가 자기 계약을 지킨다.

for (const n of [21, 25]) {
  assertFormatInset(n);
  assertNoReferenceFormatCollision(n);
}
