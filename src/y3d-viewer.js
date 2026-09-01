/**
 * y3d-viewer.js — Type Y 3D 뷰어 레이어
 *
 * scene.js / sceneY.js 를 수정하지 않는다. 큐브 좌표를 frozen isometric 으로
 * 투영하면 `ygrid.moduleQuad` 와 점 단위로 같다. yaw/pitch 는 그 위에 얹는
 * 궤도 회전일 뿐이고, PNG·SVG 파이프라인은 이 모듈을 import 하지 않는다.
 *
 * 생성기에서는 **opt-in** 이다. 기본 미리보기는 2.5D 그대로다.
 *
 * 런타임 의존성 0. 브라우저 ESM · node --test 둘 다 로드 가능.
 */

import { CORNER_UNIT_OFFSETS, SQRT3 } from './hexgrid.js';
import { YFACES } from './ygrid.js';
import { digitToRanks } from './lehmer.js';
import { digitToPattern } from './tonemap.js';

/** 아이소메트릭 세 축 = ygrid FACE_BASIS 가 쓰는 꼭짓점 그대로. */
const C1 = CORNER_UNIT_OFFSETS[1];
const C3 = CORNER_UNIT_OFFSETS[3];
const C5 = CORNER_UNIT_OFFSETS[5];

/**
 * 화면-오른쪽 · 화면-위 3D 축 (cube-space).
 * 카메라가 (1,1,1) 쪽에서 원점을 볼 때, frozen isometric 의 가로·세로와 같다.
 * 정규화는 호출 측에서 한 번만 한다.
 */
const SCREEN_RIGHT = Object.freeze({ x: 1, y: -1, z: 0 });
const SCREEN_UP = Object.freeze({ x: 1, y: 1, z: -2 });

/**
 * 화면 법선 = 시선축. **유도된 값이지 고른 값이 아니다**:
 * `SCREEN_RIGHT × SCREEN_UP = (2,2,2)` (실측) → 정규화하면 `(1,1,1)/√3`.
 * 그리고 그것은 `isoProject` 의 **커널**이다 — `isoProject(1,1,1)` 이 정확히 (0,0) 이다.
 * 즉 이 축의 회전(roll)은 깊이(`q·n̂`)를 보존하므로 정렬·facing 이 roll 에 불변이다.
 */
const SCREEN_NORMAL = Object.freeze({ x: 1, y: 1, z: 1 });

const RIGHT_LEN = Math.sqrt(2);
const UP_LEN = Math.sqrt(6);
const NORMAL_LEN = SQRT3;

/**
 * 원근의 상한. `β = invDist × radius3d = sin α` (α = 외접구가 카메라에 대하는 반각).
 * α = 60° 를 넘기면 근점 코너가 카메라 평면에 다가가 `1 + e·Δw → 0` 이 되고 정점이
 * 화면 밖으로 날아간다 (고전적 near-plane 아티팩트). 여기서 잘라 그 구간을 아예 없앤다.
 */
export const BETA_MAX = Math.sin(Math.PI / 3);

/** 면 (a,b) 파라메트릭 → 큐브 좌표. T:z=0 · R:y=0 · L:x=0. */
export function cubePoint(face, a, b) {
  if (face === 'T') return { x: a, y: b, z: 0 };
  if (face === 'R') return { x: b, y: 0, z: a };
  if (face === 'L') return { x: 0, y: a, z: b };
  throw new RangeError(`면 라벨은 T | L | R 이어야 한다: ${face}`);
}

/**
 * Frozen isometric. layout 원점·크기 규약은 ygrid.facePoint 와 동일.
 * yaw=pitch=0 에서 moduleCorners3d 투영 = ygrid.moduleQuad.
 */
export function isoProject(x, y, z, layout) {
  const size = layout.size;
  return {
    x: layout.originX + (x * C1.x + y * C5.x + z * C3.x) * size + 0,
    y: layout.originY + (x * C1.y + y * C5.y + z * C3.y) * size + 0,
  };
}

/**
 * **원근을 얹은** 투영. `invDist` 가 0(또는 음수·NaN)이면 `isoProject` 그대로다.
 *
 * ⭐ 왜 «C 중심 방사 스케일» 인가 — `isoProject` 는 아핀이라
 *   `isoProject(p) − C = k·(q·ê_r, −q·ê_u)` 가 **정확히** 성립한다 (k = size·√6/2,
 *   ê_r=(1,−1,0)/√2 · ê_u=(1,1,−2)/√6 · n̂=(1,1,1)/√3 는 완전 직교). 그래서 원근은
 *   3D 카메라 행렬을 새로 세우는 게 아니라, 기존 2D 상(像)을 C 중심으로 정점마다
 *   `s = 1/(1 + e·Δw)` 배 하는 것과 **수학적으로 같다**. Δw 는 중심 상대 깊이다.
 *
 * ⚠ **부호**: 카메라는 `−n̂` 쪽에 있고 `+n̂` 을 본다 (`quadDepth` 가 이미 「(x+y+z)가
 *   클수록 멀다」 규약이다). 그래서 근점 코너 (0,0,0) 이 `s > 1` 로 **커져야** 맞다.
 *   `1/(1 − e·Δw)` 로 쓰면 안팎이 뒤집혀 «속이 파인 가면» 이 된다.
 *
 * ⚠ **e=0 early return 은 스타일이 아니라 필수다.** `C + 1·(P−C)` 가 `P` 와 바이트
 *   동일할 거라 기대하면 안 된다 — 적대적 크기 조합(원점이 큰 layout)에서는 유효숫자
 *   8자리에서 갈린다. 현행 layout 범위로만 재면 0건이라 **테스트가 초록인 채로** 깨진다.
 *   「픽셀 동일」을 부동소수 운이 아니라 **분기 구조**가 보장하게 한다.
 *
 * @param {{x:number,y:number,z:number}} p  회전이 **끝난** 큐브 좌표 (투시 나눗셈은 회전 후).
 * @param {{size:number, originX:number, originY:number}} layout
 * @param {{x:number,y:number,z:number}} center  큐브 중심 (= 소실점의 3D 대응점)
 * @param {number} invDist  e = sin α / radius3d. 0 이면 평행투영.
 * @param {{x:number,y:number}} [C]  `isoProject(center)` — 루프 밖에서 1회 계산해 넘긴다.
 */
export function projectPoint(p, layout, center, invDist, C) {
  if (!(invDist > 0)) return isoProject(p.x, p.y, p.z, layout);
  const dw = ((p.x - center.x) + (p.y - center.y) + (p.z - center.z)) / SQRT3;
  const s = 1 / (1 + invDist * dw);
  const base = C || isoProject(center.x, center.y, center.z, layout);
  const P = isoProject(p.x, p.y, p.z, layout);
  return { x: base.x + s * (P.x - base.x), y: base.y + s * (P.y - base.y) };
}

export function moduleCorners3d(face, i, j) {
  return [
    cubePoint(face, i, j),
    cubePoint(face, i + 1, j),
    cubePoint(face, i + 1, j + 1),
    cubePoint(face, i, j + 1),
  ];
}

function rotateAround(p, axis, axisLen, angle) {
  if (angle === 0) return p;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ax = axis.x / axisLen;
  const ay = axis.y / axisLen;
  const az = axis.z / axisLen;
  const dot = p.x * ax + p.y * ay + p.z * az;
  const t = 1 - c;
  return {
    x: p.x * c + (ay * p.z - az * p.y) * s + ax * dot * t,
    y: p.y * c + (az * p.x - ax * p.z) * s + ay * dot * t,
    z: p.z * c + (ax * p.y - ay * p.x) * s + az * dot * t,
  };
}

/**
 * 큐브 중심 기준 궤도. pitch = 화면-오른쪽 축, yaw = 화면-위 축, roll = 화면 법선 축.
 * (0,0,0) 은 frozen isometric 과 같다.
 *
 * ⚠ **roll 은 반드시 가장 바깥(마지막)이다.** 이유가 둘이다.
 *   ① `SCREEN_NORMAL` 은 투영의 커널이라 roll 은 `q·n̂` 을 보존한다 ⇒ 깊이·facing·
 *      정렬 순서가 roll 에 **완전 불변**이고 화면 상만 C 중심 강체 회전한다.
 *      (원근을 켠 상태에서도 그대로다 — s 가 Δw 의 함수인데 Δw 가 안 변한다.)
 *   ② 중간에 끼우면 기존 yaw/pitch 의 트랙볼 드리프트 성격이 바뀌어 운영자가
 *      「드래그 감이 달라졌다」로 느낀다. 현행 조작감은 계약이다.
 *
 * `roll` 은 **후행 선택 인자**다 — 기존 4인자 호출부는 한 글자도 안 바뀌고,
 * `rotateAround` 의 `angle === 0` early return 덕에 roll=0 은 바이트 동일이 공짜다.
 * 양수 roll = 화면에서 반시계(CCW).
 */
export function orbitPoint(p, yaw, pitch, center, roll) {
  const q = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
  const r = rotateAround(q, SCREEN_RIGHT, RIGHT_LEN, pitch);
  const s = rotateAround(r, SCREEN_UP, UP_LEN, yaw);
  const t = rotateAround(s, SCREEN_NORMAL, NORMAL_LEN, roll || 0);
  return { x: t.x + center.x, y: t.y + center.y, z: t.z + center.z };
}

export function cubeCenter(n) {
  const h = n / 2;
  return { x: h, y: h, z: h };
}

function colorOfDigit(digit, face, tones, levels) {
  if (tones === 2) {
    const bit = digitToPattern(digit)[face];
    return levels[bit ? 2 : 0];
  }
  return levels[digitToRanks(digit)[face]];
}

/**
 * 한 셀 한 면의 색.
 *
 * ⭐ **digit 만으로는 부족하다** (2026-08-26 운영자 신고 「파인더 영역에 구멍이 뚫린다」).
 * 셀 표면 로케이터(`cellSurface`)를 켜면 파인더 칸은 `digit: null` 이고 대신
 * **`tones: {T,L,R}`** (면별 절대 레벨 인덱스)를 든다. 실측: Y0 v0 에서 169칸 중
 * **30칸**이 그 모양이다 (`role:'locator'`).
 *
 * 종전 뷰어는 `digitAt` 이 null 이면 그 칸을 **통째로 건너뛰어** 구멍이 됐다.
 * 2.5D(`sceneY.js` §locator)는 같은 자리에서 tones 를 읽어 칠하므로 꽉 찬다 —
 * 두 렌더가 갈렸던 것이고, 여기서 **같은 화법**으로 맞춘다.
 *
 * `levelAt(i, j, face)` 는 호출자가 주는 «절대 레벨 인덱스 또는 null» 이다.
 * null 이면 digit 경로로 떨어진다 — 로케이터가 없는 구성에서는 종전과 완전히 같다.
 */
function colorOfCell(digit, face, tones, levels, levelAt, i, j) {
  if (typeof levelAt === 'function') {
    const lv = levelAt(i, j, face);
    if (Number.isInteger(lv) && lv >= 0 && lv < levels.length) return levels[lv];
  }
  return colorOfDigit(digit, face, tones, levels);
}

function quadDepth(corners) {
  let s = 0;
  for (const p of corners) s += p.x + p.y + p.z;
  return s / corners.length;
}

/**
 * 이 quad 가 카메라를 **등지고 있나**. 부호만 쓴다 — `>0` 이면 뒤를 본다.
 *
 * 시선은 depth 와 같은 축이다: `quadDepth` 가 (x+y+z)/4 이고 «값이 클수록 멀다» 이므로
 * «멀어지는 방향» = (1,1,1). 바깥쪽 법선이 그쪽을 향하면 그 면은 뒤를 보는 것이다.
 *
 * ⚠ **감기(winding) 순서를 믿지 않는다.** `cubePoint` 는 T·L·R 를 각자 편한 파라메트릭
 *    순서로 내므로 세 면의 감기가 같지 않다. 대신 «큐브 중심 → quad 중심» 벡터로
 *    바깥쪽을 정한다 — 모델이 볼록 상자라 이 판정은 회전과 무관하게 옳다.
 *
 * ⭐ **원근(invDist>0)에서는 판정식이 다르다** — 이걸 안 고치면 2026-08-26 신고
 *    「특정 각도에서 셀이 투명해진다」가 원근 각도대에서 **조용히** 되살아난다.
 *    평행투영의 옳은 판정은 `n·n̂` 이지만, 원근의 옳은 판정은
 *    `n·(quad중심 − 카메라위치)` 다. 카메라 = `center − d·n̂` 이므로
 *    `n·c + d·(n·n̂)` 이고, 부호를 보존한 채 `e = 1/d` 를 곱하면
 *    `(nx+ny+nz)/√3 + e·(n·c)` 가 된다 (`n·c` 는 위에서 이미 구했다).
 *    실측(n=13, yaw −90..90° × pitch −60..60° 격자): β=0.3 에서 1,917개,
 *    β=0.5 에서 2,968개, β=0.839 에서 4,690개 각도가 평행 판정과 갈렸다.
 *    뒤집히는 띠 폭은 `β/√3` 로 **n 과 무관**하다.
 *
 * ⚠ 두 분기는 **배율이 다르다** (평행은 `n·n̂`×√3, 원근은 `n·n̂` + e·n·c).
 *    소비처가 전부 `facing < 0` **부호만** 쓰므로 안전하다. 크기를 비교에 쓰면 즉시
 *    깨진다 — facing 은 정규화돼 있지 않아 quad 넓이에도 비례한다.
 */
function outwardFacing(corners, center, invDist) {
  const [p0, p1, , p3] = corners;
  const ux = p1.x - p0.x; const uy = p1.y - p0.y; const uz = p1.z - p0.z;
  const vx = p3.x - p0.x; const vy = p3.y - p0.y; const vz = p3.z - p0.z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  let cx = 0; let cy = 0; let cz = 0;
  for (const p of corners) { cx += p.x; cy += p.y; cz += p.z; }
  cx = cx / corners.length - center.x;
  cy = cy / corners.length - center.y;
  cz = cz / corners.length - center.z;
  if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  if (!(invDist > 0)) return nx + ny + nz;
  return (nx + ny + nz) / SQRT3 + invDist * (nx * cx + ny * cy + nz * cz);
}

const BACK_COLOR = Object.freeze({ r: 36, g: 40, b: 48 });

/**
 * 보이는 세 면의 n×n 모듈 + (옵션) 데이터 없는 뒷면 3장.
 * `digitAt(i,j)` 가 null/undefined 인 칸은 건너뛴다 (3면 모드).
 *
 * 옵션 `faces: 6` 이면 **뒤 3면에 같은 코드**를 얹는다 (§ 아래 M 주석).
 * 옵션 `roll` · `invDist` 는 보기 층 확장이다 — 기본값 0 에서 종전과 바이트 동일하다.
 *
 * @returns {{n:number, yaw:number, pitch:number, roll:number, invDist:number,
 *            faces:number, quads:object[], center:object, radius3d:number}}
 */
export function buildOrbitMesh(options) {
  const n = options.n;
  const tones = options.tones === undefined ? 3 : options.tones;
  const levels = options.levels;
  const layout = options.layout;
  const yaw = options.yaw === 0 ? 0 : (options.yaw || 0);
  const pitch = options.pitch === 0 ? 0 : (options.pitch || 0);
  const roll = options.roll === 0 ? 0 : (options.roll || 0);
  const digitAt = options.digitAt;
  /** (i,j,face) → 절대 레벨 인덱스 | null. 로케이터 칸용. 없으면 digit 경로만 쓴다. */
  const levelAt = options.levelAt;
  const includeBack = options.includeBack !== false;
  /*
   * ⭐ **faceQuads — 셀 격자와 무관한 면 사각형** (2026-09-01, 슬롯 QR 구멍 수리).
   *
   * 셀 단위 `digitAt`/`levelAt` 으로는 **1 셀보다 잔** 것을 못 그린다. QR 슬롯이
   * 그렇다 (모듈 피치 = slotCells/29 ≈ 0.28 셀) — 그래서 슬롯 칸이 digit·level 을
   * 둘 다 안 들어 통째로 건너뛰어졌고, 3D 미리보기에서 **검은 구멍**이 됐다
   * (운영자 신고 「안쪽 QR 은 QR 이 표시 안 됨」). 기하는 `y3d-slot-qr.js` 가 낸다 —
   * 이 모듈은 «어디에 무슨 색» 만 받고 QR·레이아웃을 모른다.
   *
   * 각 항목: {face:'T'|'L'|'R', a, b, size, color}. (a,b) 는 `cubePoint` 파라메트릭
   * 좌표(= `facePointFor` 와 같은 공간)이고 소수 좌표가 그대로 유효하다.
   */
  const faceQuads = Array.isArray(options.faceQuads) ? options.faceQuads : [];
  const faces = options.faces === 6 ? 6 : 3;
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`n 은 1 이상의 정수여야 한다: ${n}`);
  }
  if (tones !== 2 && tones !== 3) {
    throw new RangeError(`tones 는 2 | 3 이어야 한다: ${tones}`);
  }
  const center = cubeCenter(n);
  // 회전 불변 반지름 — `fitViewStable` 이 이 값으로 스케일을 고정한다.
  //
  // ⚠ **회전된 코너를 훑지 마라.** 처음엔 그렇게 짰는데, 회전이 부동소수 잡음을 넣어
  //    같은 모델인데도 각도마다 반지름이 **1 ulp** 씩 달라졌다 (27.268938433450444 vs
  //    …45045). 스케일이 사실상 같아도 «불변» 이라는 성질 자체가 깨진다.
  //
  // 모델은 항상 축정렬 상자 [0,n]³ 이고 중심이 (n/2,n/2,n/2) 이므로 최원점은 꼭짓점,
  // 거리는 **닫힌 형태** (n/2)·√3 이다. 회전과 무관하고 잡음도 없다. 6면이어도 같은
  // 상자라 그대로 유효하다.
  // (실측 대조: n=13 → 11.258, 코너 스캔 결과와 같다.)
  const radius3d = (n / 2) * SQRT3;
  // `perspective` (0~1 정규화 노브) 가 권장 입구다 — UI 가 radius3d 유도식을 사본으로
  // 갖지 않게 한다. `invDist` 를 직접 준 호출은 그쪽이 이긴다 (테스트·저수준 용).
  const rawInvDist = options.invDist === undefined
    ? perspectiveInvDist(options.perspective, radius3d)
    : (options.invDist === 0 ? 0 : (options.invDist || 0));
  // ⚠ **두 겹 클램프** — 음수면 역원근이 되고 Δw = +1/|e| 에서 특이점이 생긴다.
  //    β = e·radius3d ≥ 1 (= α ≥ 90°) 이면 근점 코너가 카메라 평면을 통과해 s 가
  //    ∞ 또는 음수가 된다. UI 부호 버그를 여기서 흡수한다.
  const invDist = Math.min(Math.max(0, rawInvDist), BETA_MAX / radius3d);
  // 소실 중심. **루프 밖에서 1회** 계산한다 — 정점마다 부르면 4배 낭비다.
  const C2 = isoProject(center.x, center.y, center.z, layout);
  const project = (p) => projectPoint(p, layout, center, invDist, C2);
  const quads = [];

  /*
   * ⭐ **6면 모드의 뒤 3면은 «M = SCREEN_RIGHT 축 180° 고유회전»** 이다.
   *
   * `orbitPoint` 가 `R_up(yaw) ∘ R_right(pitch)` 순서라 같은 축끼리 합성돼
   * `orbit(M(p), yaw, pitch) = orbit(p, yaw, pitch + π)` 가 된다 (실측 오차 8.9e-16).
   * ⇒ **새 축·새 파라메트릭·새 좌표계가 0 이다.** pitch 에 π 를 더하기만 한다.
   *
   * ⚠ **«자연스러운» 배치가 곧 거울이다.** T사본→T‑ · L사본→L‑ · R사본→R‑ 로 놓으면
   *    (점대칭이든 평행이동이든) det = −1 이 되고, 디코더는 세 마름모를 **화면 슬롯**
   *    으로 T/L/R 라벨링하므로 L↔R 전치가 들어가 6심볼이 전부 재사상된다
   *    (0↔1 · 2↔4 · 3↔5). 재사상된 것도 «유효한» 순열이라 검출·격자맞춤은 통과하고
   *    ECC 에서만 전멸한다 — 「검출은 되는데 절대 안 풀림」이다.
   *    옳은 배치는 **엇갈린다**: T→T‑(z=n) · L→R‑(y=n) · R→L‑(x=n) (실측).
   *    감기부호 실측: M 은 front 와 같은 −1,−1,−1 · 점대칭은 +1,+1,+1 (거울).
   *
   * ⚠ 인덱스 산술이 전치(i↔j)로 보여 «거울이다» 라고 오진하기 쉽다. 착지 평면의
   *    바깥법선이 반대라 그 반전이 한 번 더 상쇄된다 — 되돌리면 그때 진짜 거울이 된다.
   */
  const sides = faces === 6
    ? [{ side: 'front', tilt: 0 }, { side: 'back', tilt: Math.PI }]
    : [{ side: 'front', tilt: 0 }];

  const emit = (kind, face, i, j, side, digit, color, corners3d) => {
    quads.push({
      kind,
      face,
      i,
      j,
      side,
      digit,
      color,
      corners3d,
      points2d: corners3d.map(project),
      depth: quadDepth(corners3d),
      facing: outwardFacing(corners3d, center, invDist),
    });
  };

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const digit = digitAt(i, j);
      // ⚠ digit 이 없어도 **levelAt 이 색을 낼 수 있으면 그린다** — 로케이터 칸이 그렇다.
      //    종전엔 무조건 건너뛰어 파인더가 구멍이 됐다 (운영자 신고 2026-08-26).
      const hasDigit = digit !== null && digit !== undefined;
      const hasLevel = typeof levelAt === 'function'
        && YFACES.some((f) => Number.isInteger(levelAt(i, j, f)));
      // 6면 모드에는 큰 필러 3장이 없다 (§ 아래). 구멍을 그대로 두면 그 자리로 **뒷면
      // 코드가 비쳐** 보이므로, 빈 칸을 셀 단위 BACK_COLOR 로 앞·뒤 양쪽에 메운다.
      // 실측: 실 Y 코드(v0 H/M · v1 M · 2톤)는 구멍이 **0칸**이라 이 경로는 합성·부분
      // 구성에서만 탄다. 그래도 «동일평면 겹침 0» 이라는 정렬 전제를 지키려면 필요하다.
      const kind = (hasDigit || hasLevel) ? 'module' : 'back';
      if (kind === 'back' && faces !== 6) continue;
      for (const s of sides) {
        for (const face of YFACES) {
          const raw = moduleCorners3d(face, i, j);
          const corners = raw.map((p) => orbitPoint(p, yaw, pitch + s.tilt, center, roll));
          emit(
            kind, face, i, j, s.side,
            kind === 'module' ? digit : null,
            kind === 'module' ? colorOfCell(digit, face, tones, levels, levelAt, i, j) : BACK_COLOR,
            corners,
          );
        }
      }
    }
  }

  /*
   * 큰 BACK_COLOR 필러 3장 — **3면 모드 전용**이다.
   *
   * 🔴 6면 모드에서 이걸 남기면 2026-08-26 「셀이 투명해진다」가 그대로 재발한다.
   *    필러는 뒷면 데이터 셀과 **완전 동일 평면**이라 아래 정렬의 볼록성 논거
   *    (「등진 면끼리는 안 겹친다」)의 유일한 반례가 되고, depth 대표점 문제가 재현된다:
   *    실측 n=13 에서 필러 depth 26 vs z=n 평면 뒷사본 셀 depth 13~39 —
   *    **169칸 중 78칸**이 필러보다 «멀다» 로 정렬돼 덮인다. 3면 모드에선 앞면에 가려
   *    안 보였을 뿐이고, 뒤를 보는 게 목적인 6면 모드에선 정면에서 절반이 사라진다.
   *    ⇒ 6면에서는 여섯 데이터 면이 이미 상자를 봉하므로 필러가 필요 없다.
   */
  if (includeBack && faces === 3) {
    const backs = [
      { face: 'T-', corners: [{ x: 0, y: 0, z: n }, { x: n, y: 0, z: n }, { x: n, y: n, z: n }, { x: 0, y: n, z: n }] },
      { face: 'R-', corners: [{ x: 0, y: n, z: 0 }, { x: n, y: n, z: 0 }, { x: n, y: n, z: n }, { x: 0, y: n, z: n }] },
      { face: 'L-', corners: [{ x: n, y: 0, z: 0 }, { x: n, y: n, z: 0 }, { x: n, y: n, z: n }, { x: n, y: 0, z: n }] },
    ];
    for (const back of backs) {
      const corners = back.corners.map((p) => orbitPoint(p, yaw, pitch, center, roll));
      emit('back', back.face, -1, -1, 'none', null, BACK_COLOR, corners);
    }
  }

  /*
   * 면 사각형 — 셀 루프가 끝난 뒤 emit 한다. `kind: 'overlay'` 는 정렬에서 **같은
   * 무리의 맨 마지막**으로 가므로(아래 비교자), 3면 모드에서 비어 있는 슬롯 자리든
   * 6면 모드에서 BACK_COLOR 필러가 깔린 자리든 항상 그 위에 얹힌다.
   *
   * 뒤 3면(6면 모드)에는 안 얹는다 — 2.5D 에도 뒷면 QR 이 없다. 한 코드에 QR 이
   * 여섯 개가 되는 쪽이 «같은 그림» 에서 더 멀다.
   */
  for (const q of faceQuads) {
    const raw = [
      cubePoint(q.face, q.a, q.b),
      cubePoint(q.face, q.a + q.size, q.b),
      cubePoint(q.face, q.a + q.size, q.b + q.size),
      cubePoint(q.face, q.a, q.b + q.size),
    ];
    const corners = raw.map((p) => orbitPoint(p, yaw, pitch, center, roll));
    emit('overlay', q.face, -1, -1, 'front', null, q.color, corners);
  }

  // ── 칠하는 순서: ①등진 면 먼저 ②오버레이는 맨 뒤 ③그 안에서 먼 것부터 ────────
  //
  // ⚠ **depth 만으로는 못 가른다** (2026-08-26 운영자 신고 「특정 각도 넘어가면 셀이
  //    투명해진다」). 뒷면은 n×n 을 통째로 덮는 **큰 사각 한 장**이라 depth 가 «중심
  //    한 점» 이고, 앞면 셀은 작아서 제 자리의 depth 를 갖는다. n=13 에서 뒷면 중심
  //    depth 26 vs 앞면 먼 구석 셀 25 — **여유가 1** 이다. 조금만 돌리면 구석 셀이
  //    26 을 넘어 «더 멀다» 로 정렬되고, 뒤이어 칠해진 뒷면이 그 위를 덮는다.
  //    실측(n=13, yaw 0~90° × pitch ±30° 격자 133점): **118점에서 최대 143칸**이
  //    그렇게 묻혔다. pitch ±10° 만으로 이미 6~10칸이다 — 「특정 각도」가 아니라
  //    **정위치(0,0)만 우연히 0** 이었다.
  //
  // 고친 방법: **면이 어느 쪽을 보는가**를 먼저 본다. 모델은 볼록 상자 [0,n]³ 라
  //    ①등진 면끼리는 서로 안 겹치고 ②마주 보는 면끼리도 서로 안 겹치며 ③겹침은
  //    «등진 면 ↔ 마주 보는 면» 사이에서만 난다. 그래서 등진 것을 **전부 먼저** 칠하면
  //    depth 의 대표점 오차와 무관하게 항상 옳다. 뒷면을 지우지 않고 남겨 둔 이유는
  //    데이터 없는 칸의 구멍으로 «속» 이 비쳐 보이면 안 되기 때문이다.
  //
  // depth 정렬은 그대로 둔다 — 같은 무리 안에서는 여전히 먼 것부터가 맞고,
  // 나중에 볼록하지 않은 요소가 붙어도 한 겹의 방어가 남는다.
  quads.sort((a, b) => {
    const af = a.facing < 0 ? 1 : 0; // 1 = 카메라를 마주 본다
    const bf = b.facing < 0 ? 1 : 0;
    if (af !== bf) return af - bf; // 등진 면(0) 을 먼저 칠한다
    // 오버레이는 자기가 얹힌 면과 **완전 동일 평면**이라 depth 로는 못 가른다
    // (뒷면 필러에서 이미 같은 실패를 겪었다 — 위 § 참조). 무리 안에서 맨 마지막.
    const ao = a.kind === 'overlay' ? 1 : 0;
    const bo = b.kind === 'overlay' ? 1 : 0;
    if (ao !== bo) return ao - bo;
    // 🔴 오버레이끼리는 **방출 순서를 그대로 둔다** (Array.sort 는 ES2019 부터 안정).
    //    콰이어트 판과 그 위 다크 모듈은 완전 동일 평면이라 depth 대표점이 사실상
    //    같고, 정렬에 맡기면 다크가 판 뒤로 밀려 사라진다. 순서는 공급자가 안다.
    if (ao === 1) return 0;
    return b.depth - a.depth;
  });

  // roll·invDist·faces 를 mesh 에 실어 보낸다 — 그래야 `fitViewStable`·`paintQuads` 가
  // 여기서 읽어 **시그니처를 안 바꾸고도** 원근을 반영한다.
  return { n, yaw, pitch, roll, invDist, faces, quads, center, radius3d };
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o);
    o += p.byteLength;
  }
  return out;
}

function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * 보이는 세 면만 glTF 2.0 JSON 으로. three.js / GLTFExporter 없음.
 * 뒷면은 포맷 밖이라 넣지 않는다.
 *
 * 생성기 UI 에는 이 경로를 **배선하지 않는다** (지금은 값이 없다 — 필요하면
 * 이 함수로 손짠 JSON 이면 된다). lab 페이지(`tools/y3d-viewer.html`)만 쓴다.
 */
export function meshToGltf(mesh) {
  const modules = mesh.quads.filter((q) => q.kind === 'module');
  const pos = new Float32Array(modules.length * 4 * 3);
  const col = new Float32Array(modules.length * 4 * 3);
  const idx = new Uint16Array(modules.length * 6);
  let v = 0;
  let t = 0;
  for (const q of modules) {
    const base = v;
    for (const p of q.corners3d) {
      pos[v * 3] = p.x;
      pos[v * 3 + 1] = p.y;
      pos[v * 3 + 2] = p.z;
      col[v * 3] = q.color.r / 255;
      col[v * 3 + 1] = q.color.g / 255;
      col[v * 3 + 2] = q.color.b / 255;
      v += 1;
    }
    idx[t] = base;
    idx[t + 1] = base + 1;
    idx[t + 2] = base + 2;
    idx[t + 3] = base;
    idx[t + 4] = base + 2;
    idx[t + 5] = base + 3;
    t += 6;
  }
  const posBytes = new Uint8Array(pos.buffer);
  const colBytes = new Uint8Array(col.buffer);
  const idxBytes = new Uint8Array(idx.buffer);
  const bin = concatBytes([posBytes, colBytes, idxBytes]);
  const colOff = posBytes.byteLength;
  const idxOff = colOff + colBytes.byteLength;
  return {
    asset: { version: '2.0', generator: 'tlcube-y3d-viewer' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, COLOR_0: 1 },
        indices: 2,
        mode: 4,
        material: 0,
      }],
    }],
    materials: [{
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    }],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: v, type: 'VEC3',
        min: min3(pos, v), max: max3(pos, v),
      },
      { bufferView: 1, componentType: 5126, count: v, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: t, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: colOff, byteLength: colBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes.byteLength, target: 34963 },
    ],
    buffers: [{
      byteLength: bin.byteLength,
      uri: 'data:application/octet-stream;base64,' + bytesToB64(bin),
    }],
  };
}

function min3(pos, count) {
  const m = [pos[0], pos[1], pos[2]];
  for (let i = 1; i < count; i += 1) {
    if (pos[i * 3] < m[0]) m[0] = pos[i * 3];
    if (pos[i * 3 + 1] < m[1]) m[1] = pos[i * 3 + 1];
    if (pos[i * 3 + 2] < m[2]) m[2] = pos[i * 3 + 2];
  }
  return m;
}

function max3(pos, count) {
  const m = [pos[0], pos[1], pos[2]];
  for (let i = 1; i < count; i += 1) {
    if (pos[i * 3] > m[0]) m[0] = pos[i * 3];
    if (pos[i * 3 + 1] > m[1]) m[1] = pos[i * 3 + 1];
    if (pos[i * 3 + 2] > m[2]) m[2] = pos[i * 3 + 2];
  }
  return m;
}

export function hexOf(c) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * **회전 불변** 캔버스 맞춤 변환 (2026-08-26 운영자 신고).
 *
 * 종전 `fitView` 는 **투영점의 2D bbox** 로 스케일을 잡았다. bbox 는 회전하면 변하므로
 * 「돌릴 때마다 «출력 가능한 최대 크기» 로 다시 맞춰져 크기가 계속 바뀌는」 상태가 됐다.
 *
 * 처방: 스케일을 **회전에 안 변하는 양**에서 뽑는다.
 *   · `radius3d` — 중심에서 가장 먼 코너까지의 3D 거리. 회전은 거리를 보존하니 불변이다.
 *   · `projMax`  — `isoProject` 가 단위 벡터를 얼마나 늘릴 수 있나의 상한.
 *     투영이 **선형**이라 이 값은 layout 만의 함수고 회전과 무관하다.
 * ⇒ 화면 반지름 = `radius3d × projMax` 로 고정하고, 중심은 캔버스 중앙에 못 박는다.
 *
 * 대가: 어떤 각도에서는 여백이 조금 남는다 (최악 각도 기준으로 잡으므로). 그 대신
 * **어느 각도에서도 안 잘리고 크기가 안 흔들린다** — 회전 UI 에서는 그쪽이 맞다.
 */
export function fitViewStable(mesh, width, height, pad, layout) {
  const margin = pad === undefined ? 24 : pad;
  // isoProject 의 최대 확대율. 선형이라 단위 구면을 훑으면 상한이 정확히 나온다.
  // 기저 세 벡터의 상만으로는 부족하다 (대각 방향이 더 길 수 있다) — 그래서 샘플링한다.
  const zero = { size: layout.size, originX: 0, originY: 0 };
  let projMax = 0;
  const STEPS = 64;
  for (let a = 0; a < STEPS; a += 1) {
    const th = (a / STEPS) * Math.PI * 2;
    for (let b = 0; b <= STEPS / 2; b += 1) {
      const ph = (b / (STEPS / 2)) * Math.PI;
      const ux = Math.sin(ph) * Math.cos(th);
      const uy = Math.sin(ph) * Math.sin(th);
      const uz = Math.cos(ph);
      const p = isoProject(ux, uy, uz, zero);
      const r = Math.hypot(p.x, p.y);
      if (r > projMax) projMax = r;
    }
  }
  /*
   * ⭐ **원근 보정** — 닫힌 형태가 있고, 회전 불변성이 그대로 유지된다.
   *
   * 원근에서 `radius3d × projMax` 는 화면 반지름을 **과소평가**한다 (근점이 최대
   * `1/(1−β)` 배 커지므로 잘린다). 제약 최대화를 풀면
   * (q⊥² + q_n² ≤ R² 위에서 `k·q⊥/(1 + e·q_n)` 최대화, cos φ = −β 에서 최대)
   *   **screenR = k·R / √(1 − β²) = k·R / cos α**
   * 이고, 물리적으로는 외접구 접선원뿔의 실루엣 반지름이다.
   *
   * 회전 불변인 이유: R 도 β 도 회전에 안 변하고, 구 중심이 광축 위에 있어 실루엣이
   * C 중심의 **원**이다. 그래서 「중심을 캔버스 중앙에 못 박는」 현행 처방이 원근에서도
   * 그대로 옳다 — 2026-08-26 신고(「크기가 계속 바뀐다」)의 처방이 유지된다.
   *
   * β = 0 이면 `1/cos 0 = 1` 이라 연속 확장이지만, 여기서도 **early return** 으로
   * 기존 식을 그대로 낸다 (나눗셈 한 번도 안 끼워 넣는다 — 픽셀 동일을 구조가 보장).
   */
  const beta = Math.min((mesh.invDist || 0) * mesh.radius3d, BETA_MAX);
  const screenR = beta > 0
    ? Math.max(mesh.radius3d * projMax / Math.sqrt(1 - beta * beta), 1e-9)
    : Math.max(mesh.radius3d * projMax, 1e-9);
  const avail = Math.min(width, height) / 2 - margin;
  const scale = Math.max(avail, 1) / screenR;
  const c = isoProject(mesh.center.x, mesh.center.y, mesh.center.z, layout);
  const ox = width / 2 - c.x * scale;
  const oy = height / 2 - c.y * scale;
  return {
    scale,
    map(p) { return { x: p.x * scale + ox, y: p.y * scale + oy }; },
  };
}

/** 투영점의 축정렬 bbox → 캔버스 맞춤 변환. ⚠ 회전하면 스케일이 변한다 —
 *  회전 UI 에는 `fitViewStable` 을 쓴다. 정지 렌더(내보내기 등)용으로만 남긴다. */
export function fitView(quads, width, height, pad) {
  const margin = pad === undefined ? 24 : pad;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of quads) {
    for (const p of q.points2d) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const bw = Math.max(maxX - minX, 1e-9);
  const bh = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((width - 2 * margin) / bw, (height - 2 * margin) / bh);
  const ox = (width - bw * scale) / 2 - minX * scale;
  const oy = (height - bh * scale) / 2 - minY * scale;
  return {
    map(p) {
      return { x: p.x * scale + ox, y: p.y * scale + oy };
    },
  };
}

export function paintQuads(ctx, mesh, options) {
  const opts = options || {};
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  /*
    * ⭐ **투명 배경** (운영자 신고 2026-09-01 「삽입 이미지가 표시 안 됨」).
    *
    * 3D 캔버스는 배치 미리보기(`#backdropCanvas`) **위**에 쌓인다(z-index 2 vs 0).
    * 여기서 배경을 전면 채우면 그 사진이 통째로 가려진다 — 「코드를 얹을 표면 위에
    * 놓아 본다」는 기능의 존재 이유가 3D 에서만 사라지는 것이다.
    *
    * 기본은 종전대로 **불투명**이다 (스냅샷·일반 미리보기는 바이트 동일). 호출자가
    * 사진을 깔고 있을 때만 `transparent: true` 를 준다. 채우기 대신 **지우기**를
    * 하므로 직전 프레임이 남지도 않는다.
    */
  const bg = opts.background || { r: 14, g: 16, b: 24 };
  if (opts.transparent === true) {
    ctx.clearRect(0, 0, width, height);
  } else {
    ctx.fillStyle = hexOf(bg);
    ctx.fillRect(0, 0, width, height);
  }
  // ⚠ **원근 ON + layout 없음은 막는다.** 이 폴백(bbox 맞춤)은 회전·원근에 따라 크기가
  //    변해서, 슬라이더를 움직일 때마다 그림이 펌프질한다 — `fitViewStable` 을 만든
  //    이유(2026-08-26 「크기 보존 안 됨」)와 **같은 증상**이라 «고친 걸 또 겪는» 모양이
  //    된다. 조용히 떨어지지 않게 여기서 던진다.
  if (mesh.invDist > 0 && !opts.layout) {
    throw new RangeError('원근(invDist>0)에는 layout 이 필요하다 — bbox 폴백은 크기가 흔들린다');
  }
  // 회전 UI 는 **안정 맞춤**을 쓴다 (크기가 안 흔들린다). layout 이 없으면 종전 경로.
  const view = (opts.layout && mesh.radius3d && mesh.center)
    ? fitViewStable(mesh, width, height, opts.pad, opts.layout)
    : fitView(mesh.quads, width, height, opts.pad);
  const selected = opts.selected;
  for (const q of mesh.quads) {
    const pts = q.points2d.map(view.map);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k += 1) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.closePath();
    ctx.fillStyle = hexOf(q.color);
    ctx.fill();
    // ⚠ `side` 를 안 보면 6면 모드에서 **앞·뒤 쌍둥이가 동시에** 선택된다.
    //    `selected.side` 가 없으면 종전대로 면·칸만 본다 (기존 호출부 무변).
    const hit = selected
      && q.kind === 'module'
      && q.face === selected.face
      && q.i === selected.i
      && q.j === selected.j
      && (selected.side === undefined || q.side === selected.side);
    // ⚠ **오버레이는 긋지 않는다** (운영자 2026-09-01 「QR이 좀 어두운데? 배경까지?」).
    //    검은 실선 0.6px 은 셀(≈8px)에는 격자 구분이지만 QR 모듈(≈2px)에는 면적의
    //    절반을 먹어 흰 콰이어트가 회색이 된다 — 실측: 캔버스에 순백이 **0 픽셀**이었다.
    //    자기 색으로 긋는 대안(2.5D drawScene 의 관용구)은 다크 모듈을 사방 0.3px 씩
    //    불려 면적 +60% 의 **도트게인**이 되므로 더 나쁘다. 오버레이는 서로 겹치지
    //    않거나(콰이어트 판 ↔ 다크 모듈은 부모-자식) 같은 색끼리만 맞닿아 심이 안 보인다.
    if (q.kind !== 'overlay') {
      ctx.strokeStyle = hit ? '#ffe08a' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = hit ? 2.5 : 0.6;
      ctx.stroke();
    }
  }
  if (opts.labels && mesh.n === 1) {
    // 앞을 보는 면만 라벨을 단다. 6면 모드에서는 module quad 가 여섯이고, 라벨은
    // 모든 fill 뒤에 깊이 판정 없이 얹히므로 등진 셋의 글자가 **보이는 면 위에**
    // 찍힌다. 「한 셀」 모드는 어느 마름모가 T 인지를 가르치려고 있는 모드라,
    // 거기서 엉뚱한 자리에 T 가 놓이면 화면의 유일한 면 식별 단서가 오도된다.
    // (3면 모드에서는 module 이 정확히 셋이라 종전에도 우연히 옳았다.)
    const faces = mesh.quads.filter((q) => q.kind === 'module' && q.side !== 'back');
    ctx.font = '600 18px ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const q of faces) {
      const pts = q.points2d.map(view.map);
      const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
      const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
      ctx.fillStyle = q.color.r + q.color.g + q.color.b > 360 ? '#1a1d24' : '#f4f6fb';
      ctx.fillText(q.face, cx, cy);
    }
  }
  return view;
}

/** 뒤쪽 쿼드부터 히트 테스트 (화면에 보이는 것 우선). */
export function hitTest(mesh, view, x, y) {
  for (let i = mesh.quads.length - 1; i >= 0; i -= 1) {
    const q = mesh.quads[i];
    if (q.kind !== 'module') continue;
    const pts = q.points2d.map(view.map);
    // `side` 를 함께 낸다 — 6면 모드에서 `{face,i,j}` 만으로는 앞뒤 쌍둥이를 못 가른다.
    // (뒤에서부터 훑어 «맨 위에 칠해진 것» 을 내는 구조 자체는 6면에서도 옳다.)
    if (pointInQuad(pts, x, y)) {
      return { face: q.face, i: q.i, j: q.j, digit: q.digit, side: q.side };
    }
  }
  return null;
}

function pointInQuad(pts, x, y) {
  return pointInTri(pts[0], pts[1], pts[2], x, y) || pointInTri(pts[0], pts[2], pts[3], x, y);
}

function pointInTri(a, b, c, x, y) {
  const s = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x);
  const t = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
  if ((s < 0) !== (t < 0) && s !== 0 && t !== 0) return false;
  const d = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x);
  return d === 0 || (d < 0) === (s + t <= 0);
}

export const Y3D_FACES = YFACES;
export const ISO_AXES = Object.freeze({
  C1, C3, C5, SCREEN_RIGHT, SCREEN_UP, SCREEN_NORMAL,
});

/**
 * 슬라이더 t ∈ [0,1] → `invDist`. **카메라 거리 d 를 그대로 노브로 쓰면 안 된다** —
 * `radius3d` 가 n 에 비례해서, 같은 d 가 n=5 와 n=25 에서 β 가 5배 달라진다. 「평면 ↔
 * 초광각」 바가 버전마다 다른 뜻이 되고, 왜곡 사다리를 회귀 자로 쓸 때 눈금이 n 따라
 * 움직인다. 그래서 **반각 α** 로 정규화한다: α = t · 60° · β = sin α · e = β / radius3d.
 *
 * t=0 → 정확히 0 → `projectPoint` 의 early return → **현행 평행투영과 픽셀 동일**.
 * t=1 (α=60°) → 근/원 배율 7.46× / 0.536× (비 13.9배) · 맞춤 반경 1/cos 60° = 정확히 2배.
 * `d = ∞` 를 직접 넣으면 `∞/(∞+Δ)` 가 NaN 이라, 노브는 **반드시 역수(e)** 로 들어간다.
 */
export function perspectiveInvDist(t, radius3d) {
  const clamped = Math.min(Math.max(t === 0 ? 0 : (t || 0), 0), 1);
  if (clamped <= 0 || !(radius3d > 0)) return 0;
  return Math.sin(clamped * (Math.PI / 3)) / radius3d;
}
