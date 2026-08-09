// placementY.js — Type Y 레퍼런스 조 · 포맷 정보 15셀 · 역할 배치 (SPEC §14, ADR 0003 U8·U9)
//
// Type Y 는 인덱스 공간이다 — 셀은 3면 공통 좌표 (i,j), 0..n-1 정수 좌표일 뿐 기하가
// 필요 없다(hexgrid.js/ygrid 미참조). 이 모듈은 "n×n 격자 어디에 레퍼런스·포맷 정보가
// 사는가"만 다룬다. scan order(U7)는 layoutY.js, 용량 회계(생성물 표)는 capacityY.js
// 소관.
//
// 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).

// ─────────────────────────────────────────────────────────────────────────────
// 레퍼런스 4조 (U9) — SPEC §14 "라틴 스퀘어 3셀 1조, 공간 분산 ≥ 3조"
// ─────────────────────────────────────────────────────────────────────────────
//
// 조 앵커(순서 고정): A = (2,2), (n-3,2), (2,n-3), (n-3,n-3). 네 앵커는 격자의 네
// 모서리 근방(가장자리에서 inset 2)에 하나씩 놓여 "공간 분산(비일직선) ≥ 3조" 요건을
// 코너 대각 배치로 만족한다.
//
// 조 내 3셀: L자형 [(p,q), (p+1,q), (p,q+1)] — 앵커 (p,q) 에서 i 방향으로 한 칸,
// j 방향으로 한 칸. 이 3셀에 digit 을 그 순서대로 배정한다 — **어떤 digit 인지는
// 톤 모드(tones)에 따라 갈린다** (ADR 0003 v3.1 §4b D9, 전환 비용 항목):
//
//   tones=2(2톤 메인) → REFERENCE_GROUP_DIGITS_2T = [0,1,2] : 조 내 3셀이 매 면마다
//     밝음 1·어두움 2 를 갖는다(양 앵커 확보 — U14 θ_f 추정이 밝은/어두운 앵커 둘
//     다 필요). 4조 구조는 3톤과 동일 — 공간 분산이 오염 방어선(§4b 근거 수치).
//   tones=3(Y-T 옵션) → REFERENCE_GROUP_DIGITS_3T = [0,4,3] (구 REFERENCE_GROUP_DIGITS,
//     ADR 0003 D3): 이 순위행이 세 면 모두에 레벨 {0,1,2} 전부를 준다.
//
// 조 좌표·L자형 셀 구조 자체는 톤 모드 무관 불변 — 바뀌는 것은 digit 배정뿐이다.

/** 레퍼런스 조 내 3셀에 배정하는 digit(tones=2, 2톤 메인), L자형 셀 순서대로. */
export const REFERENCE_GROUP_DIGITS_2T = Object.freeze([0, 1, 2]);

/** 레퍼런스 조 내 3셀에 배정하는 digit(tones=3, Y-T 옵션), L자형 셀 순서대로. */
export const REFERENCE_GROUP_DIGITS_3T = Object.freeze([0, 4, 3]);

function referenceDigitsFor(tones) {
  if (tones === 2) return REFERENCE_GROUP_DIGITS_2T;
  if (tones === 3) return REFERENCE_GROUP_DIGITS_3T;
  throw new RangeError(`지원하지 않는 tones: ${tones} (허용 2 또는 3)`);
}

function key(i, j) {
  return `${i},${j}`;
}

function assertSize(n) {
  // 하한 11: n=9·10 에서는 포맷 복제 2 가 레퍼런스 조와 실제로 충돌한다 (검증 라운드
  // 전수 검산 — n=9 의 (2,7)·n=10 의 (2,8)). 그 범위를 허용하면 "충돌 시 throw" 계약이
  // roleOf 우선순위에 은폐된다. n=11..20 은 무충돌이나 규범 버전은 21·25 뿐이다.
  if (!Number.isInteger(n) || n < 11) {
    throw new RangeError(`n 은 11 이상의 정수여야 한다: ${n}`);
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
 * 레퍼런스 4조. 각 조 = {cells: [{i,j}×3], digits}. cells 순서 = [(p,q), (p+1,q),
 * (p,q+1)], digits[k] 가 cells[k] 에 대응. digits 는 tones 모드별
 * (REFERENCE_GROUP_DIGITS_2T | _3T) — 조 좌표·셀 구조는 tones 무관 불변.
 * @param {number} n
 * @param {2|3} [tones] 기본 2(2톤 메인, ADR 0003 v3.1 §4b).
 * @returns {{cells:{i:number,j:number}[], digits: number[]}[]} 길이 4
 */
export function referenceGroups(n, tones = 2) {
  assertSize(n);
  const digits = referenceDigitsFor(tones);
  return referenceAnchors(n).map(({ p, q }) => ({
    cells: [
      { i: p, j: q },
      { i: p + 1, j: q },
      { i: p, j: q + 1 },
    ],
    digits,
  }));
}

/**
 * 레퍼런스 12셀 전부(조 순 · 조 내 순 평탄화), 각 셀에 digit 을 얹은 목록.
 * @param {number} n
 * @param {2|3} [tones] 기본 2(2톤 메인) — referenceGroups 로 그대로 전달.
 * @returns {{i:number, j:number, digit:number}[]} 길이 12
 */
export function referenceCellsAll(n, tones = 2) {
  const out = [];
  for (const group of referenceGroups(n, tones)) {
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
