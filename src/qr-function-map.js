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
 * 의존: square-cell-style.js(`styledGridShapes` — 꾸민 모듈 조각 생성, `qrStyledModulePieces`) 하나.
 * 빌드 모듈 순서(tools/build-single.mjs · build-finder-editor.mjs)에서 square-cell-style 이 이미 앞이다.
 */

import { styledGridShapes } from './square-cell-style.js';

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
 * 모듈 분류(읽기용) — 밝은 모듈 → null, 어두운 기능 모듈 → 'fixed', 어두운 데이터 모듈 → 'data'.
 *
 * ⚠ **`styledGridShapes` 의 역할 콜백으로 쓰지 않는다.** 밝은 기능 모듈이 null(빈 칸)이면 liquid 오목
 * 필렛이 그 칸 모서리를 어두운 색으로 칠한다 — 실측(2026-09-26 외부 검토 grok·agy): 포맷 (8,8) · (8,13)
 * 이 밝고 직교 두 이웃 + 대각이 어두운 데이터인 문구(예: 'P5' · 'P1024')에서 필렛이 검출 요소를 침범했다.
 * 그리기는 세 호스트 모두 `qrStyledModulePieces`(역할 규칙 `qrStyledModuleRole`)를 탄다.
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
 * 꾸민 QR 을 `styledGridShapes` 로 펼 때의 역할 규칙 — 세 호스트(O/A/K · Y · H)가 같은 규칙을 쓰도록
 * 여기 하나로 둔다(DESIGN_001 §4.1). **기능 모듈은 밝든 어둡든 'fixed'**(사각 · 그 칸엔 필렛 없음),
 * 어두운 데이터 모듈 → 'data'(스타일), 밝은 데이터 모듈 → null(빈 칸 — 오목 필렛은 여기에만 생긴다).
 * 밝은 기능 모듈이 내는 흰 사각은 `qrStyledModulePieces` 가 버린다(밝은 판이 바탕).
 */
export function qrStyledModuleRole(qr, row, col) {
  if (qr.size !== SIZE) throw new RangeError(`qr-function-map: v1(21) 전용이다: size ${qr.size}`);
  if (qrFunctionMapV1().isFunctionModule(col, row)) return 'fixed';
  return qr.modules[row * SIZE + col] === 1 ? 'data' : null;
}

/**
 * 꾸민 코너 QR 모듈 조각 — O/A/K(scene.js pushQrBlock) · Y(sceneY 코너) · H(generator-h-qr
 * hStyledQrPieces → CPU 장면 · GPU 텍스처)가 **이 한 함수**로 편다. 규칙:
 *   ① 역할 = `qrStyledModuleRole`(기능 모듈은 밝든 어둡든 'fixed' — liquid 필렛이 검출 요소에 못 들어간다).
 *   ② 색 = 밝은 모듈 deco.light, 어두운 모듈 `qrModuleColor`(눈만 deco.eye).
 *   ③ 모듈 로컬 좌표(1 = 한 모듈)로 먼저 펴서 조각 무게중심의 모듈로 가르고, **밝은 기능 모듈의 사각은 버린다**
 *      (호스트가 밝은 판을 먼저 깐다). 남은 조각에만 `map` 을 적용한다.
 * 규칙이 H 의 종전 구현(2026-09-26 generator-h-qr)과 같아 H 출력은 바이트 동일하고, O/A/K · Y 는
 * 밝은 기능 모듈 위 필렛만 사라진다(나머지 조각 · 순서 · 꼭짓점 불변).
 *
 * @param {{size:number, modules:Uint8Array}} qr `qrMatrix` 출력(v1 전용)
 * @param {{dark:{r,g,b}, light:{r,g,b}, eye:{r,g,b}, cellStyle:string}} deco `resolveQrDeco` 의 deco
 * @param {{map:(x:number,y:number)=>{x:number,y:number}, tags:object}} opts 모듈 로컬 → 장면 좌표 · 조각 태그
 *        (host 'qr' 필수 태그 selfQuiet · noSeam 은 styledGridShapes 가 강제한다)
 * @returns {Array<{kind:'polygon', points:{x,y}[], color:{r,g,b}}>}
 */
export function qrStyledModulePieces(qr, deco, { map, tags }) {
  if (qr?.size !== SIZE) throw new RangeError(`qr-function-map: v1(21) 전용이다: size ${qr?.size}`);
  if (typeof map !== 'function') throw new TypeError('qrStyledModulePieces: map 은 함수여야 한다');
  const fn = qrFunctionMapV1();
  const dark = (r, c) => qr.modules[r * SIZE + c] === 1;
  const local = styledGridShapes({
    rows: SIZE,
    cols: SIZE,
    style: deco.cellStyle,
    host: 'qr',
    role: (r, c) => qrStyledModuleRole(qr, r, c),
    color: (r, c) => (!dark(r, c) ? deco.light : qrModuleColor(deco, r, c)),
    map: (x, y) => ({ x, y }),
    tags,
  });
  const out = [];
  for (const piece of local) {
    let sx = 0;
    let sy = 0;
    for (const point of piece.points) { sx += point.x; sy += point.y; }
    const r = Math.floor(sy / piece.points.length);
    const c = Math.floor(sx / piece.points.length);
    if (fn.isFunctionModule(c, r) && !dark(r, c)) continue;
    out.push({ ...piece, points: piece.points.map((point) => map(point.x, point.y)) });
  }
  return out;
}

/**
 * 어두운 모듈의 색 — 눈(파인더 7×7) 안은 `deco.eye`, 나머지는 `deco.dark`.
 * @param {{dark:{r,g,b}, eye:{r,g,b}}} deco `resolveQrDeco` 의 deco
 */
export function qrModuleColor(deco, row, col) {
  return qrFunctionMapV1().isEyeModule(col, row) ? deco.eye : deco.dark;
}
