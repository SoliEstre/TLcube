/**
 * qr-function-map.js — QR 버전 1(21×21) 모듈 역할 맵 (DESIGN_001 §3.3 · §4.1)
 *
 * 폴백 QR 꾸미기(`qrCellStyle` · 눈 색)는 **데이터 모듈만** 모양을 바꾸고, 검출 요소
 * (파인더+분리자 · 타이밍 · 포맷 · dark module)는 항상 사각·고정이다. 그 가름을
 * `qr.js` 를 고치지 않고 **ISO/IEC 18004 v1 규격에서 다시 유도**한다 — `qr.js` 는 TL
 * 스캐너 import 폐포 안이라 고치면 SCANNER_BUILD 까지 딸려 온다(wiring m1). 대신
 * `test/qr-function-map.test.js` 가 `qrMatrix` 실제 출력에 대해 이 맵을 잰다
 * (여러 페이로드에서 기능 위치 불변 · 데이터 208 비트가 유효한 RS 코드워드로 읽힘).
 *
 * v1 규격(정렬 패턴 없음):
 *   파인더+분리자  세 모서리의 8×8(7×7 파인더 + 안쪽 1모듈 분리자)  3×64 = 192
 *   타이밍          행 6 · 열 6 의 파인더 밖 구간                     5+5  = 10
 *   포맷            행 8 · 열 8 의 파인더 인접 구간(타이밍 제외)       2×15 = 30
 *   dark module     (x=8, y=4·1+9=13)                                         1
 *   ─────────────────────────────────────────────────────────────────────────
 *   기능 233 · 데이터 441−233 = 208 = 26 코드워드(데이터 19 + EC 7) × 8
 *
 * 좌표는 `qr.js` 와 같다: x = 열, y = 행, 모듈 인덱스 = y·21 + x.
 * 눈(eye)은 파인더 7×7(분리자 제외) — «로케이터 진한 색» 옵션이 칠하는 영역이다(§5.2 ④).
 *
 * 의존 없음(잎 모듈).
 */

/** QR v1 한 변 모듈 수. */
export const QR_V1_SIZE = 21;

/** 모듈 역할 이름. `roleAt` 의 반환 도메인이다. */
export const QR_MODULE_ROLES = Object.freeze(['data', 'finder', 'timing', 'format', 'dark-module']);

const SIZE = QR_V1_SIZE;
const ROLE_CODE = Object.freeze({ data: 0, finder: 1, timing: 2, format: 3, 'dark-module': 4 });

/** 파인더 중심 (x, y) — 좌상 · 우상 · 좌하. */
const FINDER_CENTERS = Object.freeze([[3, 3], [SIZE - 4, 3], [3, SIZE - 4]]);

/** v1 dark module 위치: 열 8, 행 4·v + 9. */
const DARK_MODULE = Object.freeze({ x: 8, y: 4 * 1 + 9 });

function chebyshevToFinder(x, y) {
  let best = Infinity;
  for (const [cx, cy] of FINDER_CENTERS) {
    best = Math.min(best, Math.max(Math.abs(x - cx), Math.abs(y - cy)));
  }
  return best;
}

/**
 * 규격 서술에서 역할을 유도한다(qr.js 의 그리기 순서를 옮기지 않는다):
 *   파인더+분리자 — 어느 파인더 중심에서 체비셰프 거리 ≤ 4 (격자 밖은 잘림 → 8×8).
 *   타이밍 — 행 6 또는 열 6, 파인더 밖.
 *   dark module — (8, 13).
 *   포맷 — 열 8 의 행 0‥8 · 행 SIZE−7‥SIZE−1, 행 8 의 열 0‥8 · 열 SIZE−8‥SIZE−1 중
 *          앞의 셋이 아닌 칸.
 */
function deriveRole(x, y) {
  if (chebyshevToFinder(x, y) <= 4) return 'finder';
  if (x === 6 || y === 6) return 'timing';
  if (x === DARK_MODULE.x && y === DARK_MODULE.y) return 'dark-module';
  const onCol8 = x === 8 && (y <= 8 || y >= SIZE - 7);
  const onRow8 = y === 8 && (x <= 8 || x >= SIZE - 8);
  if (onCol8 || onRow8) return 'format';
  return 'data';
}

/** 데이터 배치 순서: 우하단부터 2열 지그재그(상향/하향 교대), 타이밍 열 6 건너뜀. */
function deriveDataOrder(roles) {
  const order = [];
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < SIZE; vert += 1) {
      const y = upward ? SIZE - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (roles[y * SIZE + x] === ROLE_CODE.data) order.push(Object.freeze({ x, y }));
      }
    }
  }
  return Object.freeze(order);
}

let cached = null;

function build() {
  const roles = new Uint8Array(SIZE * SIZE);
  const eye = new Uint8Array(SIZE * SIZE);
  const counts = { data: 0, finder: 0, timing: 0, format: 0, 'dark-module': 0 };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const role = deriveRole(x, y);
      roles[y * SIZE + x] = ROLE_CODE[role];
      counts[role] += 1;
      if (chebyshevToFinder(x, y) <= 3) eye[y * SIZE + x] = 1;
    }
  }
  const functionCount = SIZE * SIZE - counts.data;
  // 규격 자기검증 — 233 / 208 이 아니면 유도가 틀린 것이다(모듈 평가 실패).
  if (functionCount !== 233 || counts.data !== 26 * 8
    || counts.finder !== 192 || counts.timing !== 10 || counts.format !== 30 || counts['dark-module'] !== 1) {
    throw new Error(`qr-function-map: v1 역할 집계가 규격과 다르다 ${JSON.stringify(counts)}`);
  }
  const dataOrder = deriveDataOrder(roles);
  const inBounds = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  const check = (x, y) => {
    if (!inBounds(x, y)) throw new RangeError(`qr-function-map: 격자 밖 (${x}, ${y})`);
    return y * SIZE + x;
  };
  return Object.freeze({
    size: SIZE,
    counts: Object.freeze({ ...counts, function: functionCount }),
    /** (x, y) 의 역할 이름. */
    roleAt: (x, y) => QR_MODULE_ROLES[roles[check(x, y)]],
    /** 기능(검출) 모듈인가 — 항상 사각 · 고정색. */
    isFunctionModule: (x, y) => roles[check(x, y)] !== ROLE_CODE.data,
    /** 파인더 7×7(눈) 안인가 — 분리자는 제외. */
    isEyeModule: (x, y) => eye[check(x, y)] === 1,
    /** 데이터 비트 배치 순서(208칸, 코드워드 비트 MSB 먼저). */
    dataOrder,
  });
}

/**
 * QR v1 모듈 역할 맵(한 번 유도해 공유 — 불변 객체).
 * @returns {{size: 21, counts: object, roleAt: Function, isFunctionModule: Function,
 *            isEyeModule: Function, dataOrder: ReadonlyArray<{x:number,y:number}>}}
 */
export function qrFunctionMapV1() {
  if (cached === null) cached = build();
  return cached;
}

/**
 * 꾸민 QR 을 `styledGridShapes` 로 펼 때의 역할 콜백 값 — 세 호스트(O/A/K · Y · H)가 같은
 * 규칙을 쓰도록 여기 하나로 둔다. 밝은 모듈 → null(그리지 않음: 밝은 판이 바탕),
 * 어두운 기능 모듈 → 'fixed'(사각), 어두운 데이터 모듈 → 'data'(스타일).
 *
 * @param {{size:number, modules:Uint8Array}} qr `qrMatrix` 출력
 * @param {number} row y
 * @param {number} col x
 */
export function qrModuleRole(qr, row, col) {
  if (qr.size !== SIZE) throw new RangeError(`qr-function-map: v1(21) 전용이다: size ${qr.size}`);
  if (qr.modules[row * SIZE + col] !== 1) return null;
  return qrFunctionMapV1().isFunctionModule(col, row) ? 'fixed' : 'data';
}

/**
 * 어두운 모듈의 색 — 눈(파인더 7×7) 안은 `deco.eye`, 나머지는 `deco.dark`.
 * @param {{dark:{r,g,b}, eye:{r,g,b}}} deco `resolveQrDeco` 의 deco
 */
export function qrModuleColor(deco, row, col) {
  return qrFunctionMapV1().isEyeModule(col, row) ? deco.eye : deco.dark;
}
