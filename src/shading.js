/**
 * shading.js — **입체 음영** 레이어 (과업 #17). 렌더 전용, 데이터 계약 무관.
 *
 * 무엇을 그리나: 좌상단 조명을 전제로 마크 실루엣 **바깥**에 두르는 방향성 띠다.
 *   · 아래쪽 띠(`lower`, 기본 옵션) — 우하(R면 방향) **그림자** + 좌하(L면 방향) **반사광**
 *   · 위쪽 띠(`upper`, 별도 서브옵션) — T면 왼쪽 엣지 **반사광** + 오른쪽 엣지 **그림자**
 *
 * ## 조명 방향은 새로 정한 값이 아니다
 *
 * 면 게인 표(`render-profile.js`)가 이미 조명을 말하고 있다 — T 1 · L 0.72 · R 0.52\~0.62.
 * 즉 **T·L 은 밝고 R 이 어둡다**. 아이소메트릭 투영에서 세 면의 바깥 법선은 화면 좌표로
 * T (0, −1) · L (−√3/2, +1/2) · R (+√3/2, +1/2) 이므로, 빛의 **진행 방향** d 를
 * R 면 법선과 같게 두면
 *
 *   n_T·d = −0.5 (밝음) · n_L·d = −0.5 (밝음) · n_R·d = +1 (어두움)
 *
 * 이 되어 게인 표의 명암 순서와 정확히 일치한다. 그래서 `LIGHT_DIRECTION` 은 상수를
 * 하나 더 발명한 것이 아니라 **이미 있는 게인 표의 기하학적 표현**이다.
 *
 * ## 셀 무접촉 (이 모듈의 핵심 계약)
 *
 * 띠는 마크 껍질(convex hull)을 `gap` 만큼 바깥으로 민 선에서 **시작**한다. 모든 도형은
 * 껍질 **안**에 있으므로, 껍질 변 i 의 법선 방향으로 잰 거리에서
 *
 *   도형 ≤ 0 < gap ≤ 띠(변 i 에서 나온 사변형)
 *
 * 가 성립한다 — 변마다 **분리축**이 하나씩 존재하므로 교차가 0 이다. 증명이 이렇게 짧은
 * 것은 띠를 «껍질에서 밀어낸 사변형» 으로만 만들기 때문이고, 그래서 이 모듈은 그 형태를
 * 벗어나지 않는다. (테스트가 SAT 로 다시 확인한다 — 증명은 주장이고 측정이 사실이다.)
 *
 * 껍질은 **QR 블록을 제외하고** 묶는다 (운영자 판정 2026-08-17 — 안전영역과 같은
 * `selfQuietColors` 제외 규칙). 처음엔 «그림자는 물체 하나가 진다» 논지로 QR 을
 * 포함했는데, 검증 렌즈 실측이 그 결과를 반증했다: QR 이 별도 껍질이 되어 안전영역
 * 없는 자기 음영 링을 두르고 (흰 배경 코너 QR 에서 10/10 → 0/10 전멸), 미학적으로도
 * 보조 표식이 본체와 같은 무게의 그림자를 갖는 것이 어색하다. 제외해도 «셀 무접촉»
 * 증명은 그대로다 — QR 자리는 띠가 아예 안 나므로 교차할 것이 없다.
 *
 * ## 렌더 백엔드 계약
 *
 * `scene.shading` 은 `scene.shapes` 와 **별도 배열**이다. shapes 의 kind 계약
 * (`polygon | disc`)을 늘리지 않으려는 선택이다 — 디코더 하네스·finder-score·
 * quietzone 이 전부 shapes 를 순회하므로, 새 kind 를 끼우면 그 전부가 «알 수 없는
 * kind» 로 터지거나 조용히 음영을 데이터로 오인한다.
 *
 * 각 띠는 **SVG 선형 그라데이션 정의 그대로**다: 축 (x1,y1)→(x2,y2), t = 축 위로의
 * 정사영을 [0,1] 로 자른 값, 알파 = a1 + (a2 − a1)·t, 색은 상수. 그래서 SVG 는
 * `<linearGradient>` 로, 래스터·canvas 는 같은 식으로 각각 그려도 결과가 같다.
 *
 * @module shading
 */

import { clipToRect, markHulls } from './quietzone.js';

/** 음영 끔. */
export const SHADING_OFF = 'off';
/** 음영 켬 — 아래쪽 띠(그림자 + 반사광). */
export const SHADING_ON = 'on';
/** 상태 스키마 허용값. */
export const SHADING_MODES = Object.freeze([SHADING_OFF, SHADING_ON]);
/**
 * 기본값 = **끔** (decode-safe 기본값 — Type Y 복호 보호).
 *
 * 음영은 렌더러(index.html withShading)에서 **Type Y 에만** 얹힌다 — 조명 방향의
 * 근거가 Y 면 게인 표이고, O/A 는 withShading 이 그대로 통과시킨다. 그래서 이 상수는
 * 사실상 «Type Y 음영 기본값» 이고, O/A 산출물에는 어떤 값이든 영향이 없다.
 *
 * 켜면 Y 복호가 죽는다 (실측: 흰/검 배경에서 shading on → no-format-candidate,
 * shading off → OK). 띠는 셀에 안 닿지만 안전영역·배경 영역을 채워 전경 실루엣
 * 검출을 깨뜨리므로, 셀만 재는 자체검증(verifyRasterY)은 통과하는데 라이브 복호는
 * 실패한다. 그래서 도입기 «새 옵션은 끔» 을 지나 2026-08-17 에 잠깐 켬으로 뒀던
 * 기본값을 다시 **끔** 으로 되돌린다 — «아무것도 안 골랐는데 못 읽히는» 산출물이
 * 나오면 안 된다는 것이 켬 미학보다 앞선다. 음영은 고급에서 명시로 켜는 옵트인이다
 * (명시 선택 > 자동 기본값). 끄면 산출물이 음영 도입 전과 바이트 동일하다
 * (addShading off 경로).
 */
export const DEFAULT_SHADING_MODE = SHADING_OFF;

/**
 * 빛의 진행 방향 (화면 좌표, y 는 아래가 +). = R 면 바깥 법선.
 * √3/2 는 아이소메트릭 30° 의 코사인 — 런타임 삼각함수를 쓰지 않으려고 상수로 박는다.
 */
export const LIGHT_DIRECTION = Object.freeze({ x: 0.8660254037844386, y: 0.5 });

/** 껍질 ↔ 띠 안쪽 모서리 사이 여유 (scene 단위 = 셀 1). 셀 무접촉의 폭이 이 값이다. */
export const SHADING_GAP = 0.12;
/**
 * 아래쪽 띠 두께. 운영자 지시 (2026-08-17) 로 1.1 → **11 (10×)** — 길고 자연스러운
 * 그림자. Y 기본 margin 20셀 > gap + depth = 11.12 라 기본 캔버스에 항상 들어간다.
 */
export const SHADING_LOWER_DEPTH = 11;
/** 위쪽 띠(T면 엣지 아웃라인) 두께 — «아웃라인» 이라 얇다. 10× 대상 아님. */
export const SHADING_UPPER_DEPTH = 0.3;

/**
 * 발산 집중 지수 (운영자 지시 2026-08-17 — «광원이 z축으로 나와 그림자 발산이
 * 좁아져야»). 아래쪽 띠의 알파에 정렬도^FOCUS 를 걸어 빛 축에서 벗어난 변일수록
 * 급감시키고, 그라데이션 도달 거리도 정렬도에 비례시킨다 (quad 는 전깊이 —
 * 그라데이션 종점 뒤는 pad 로 투명이라 기하 이음새 없이 변마다 길이가 준다).
 */
export const SHADING_FOCUS = 2;

/** 최대 알파 (실제 알파는 여기에 면 방향 세기 |n·d| 를 곱한 값이다). */
export const SHADING_SHADOW_ALPHA = 0.34;
export const SHADING_REFLECT_ALPHA = 0.3;

/** 그림자색 · 반사광색. 순수 흑/백이고 세기는 알파가 만든다. */
const SHADOW_COLOR = Object.freeze({ r: 0, g: 0, b: 0 });
const REFLECT_COLOR = Object.freeze({ r: 255, g: 255, b: 255 });

/** 마이터 폭주 상한 (quietzone.offsetConvex 와 같은 값). */
const MITER_LIMIT = 4;

/** 부동소수 여유. */
const EPS = 1e-9;

/** 폴리곤의 부호 있는 넓이 × 2 — 감김 방향 판정용. */
function signedArea2(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return s;
}

/**
 * 볼록 폴리곤의 **변별 바깥 단위 법선**. 길이 0 인 변은 null.
 * @returns {({nx:number,ny:number}|null)[]} 인덱스 i = 변 (poly[i] → poly[i+1])
 */
export function outwardEdgeNormals(poly) {
  const sign = signedArea2(poly) > 0 ? 1 : -1;
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len < EPS) { out.push(null); continue; }
    out.push({ nx: (ey / len) * sign, ny: (-ex / len) * sign });
  }
  return out;
}

/**
 * 볼록 폴리곤을 바깥으로 `d` 만큼 민 **정점 배열** — 길이가 입력과 **같다**.
 *
 * `quietzone.offsetConvex` 와 다른 점이 이 «같은 길이» 다. 그쪽은 마이터가 폭주하면
 * 꼭짓점을 둘로 쪼개(베벨) 정점 수가 늘어난다. 음영 띠는 «변 i 의 안쪽 모서리 ↔ 바깥
 * 모서리» 를 1:1 로 짝지어야 사변형이 만들어지므로, 여기서는 쪼개는 대신 마이터 길이를
 * **자른다**. 자르면 그 꼭짓점에서 띠가 얇아질 뿐 — 셀 쪽으로 파고들지는 않는다
 * (자른 점도 두 변의 바깥 반평면 안에 남는다).
 */
export function miterVertices(poly, d) {
  const normals = outwardEdgeNormals(poly);
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = normals[(i - 1 + n) % n];
    const cur = normals[i];
    const v = poly[i];
    if (!prev || !cur) { out.push({ x: v.x, y: v.y }); continue; }
    const det = prev.nx * cur.ny - prev.ny * cur.nx;
    if (Math.abs(det) < EPS) {
      out.push({ x: v.x + d * cur.nx, y: v.y + d * cur.ny });
      continue;
    }
    const c1 = prev.nx * (v.x + d * prev.nx) + prev.ny * (v.y + d * prev.ny);
    const c2 = cur.nx * (v.x + d * cur.nx) + cur.ny * (v.y + d * cur.ny);
    const ix = (cur.ny * c1 - prev.ny * c2) / det;
    const iy = (prev.nx * c2 - cur.nx * c1) / det;
    const mx = ix - v.x;
    const my = iy - v.y;
    const mlen = Math.sqrt(mx * mx + my * my);
    const cap = Math.abs(d) * MITER_LIMIT;
    if (mlen > cap && mlen > EPS) {
      const s = cap / mlen;
      out.push({ x: v.x + mx * s, y: v.y + my * s });
    } else {
      out.push({ x: ix, y: iy });
    }
  }
  return out;
}

/**
 * 껍질 하나에서 띠들을 만든다.
 *
 * @param {{x:number,y:number}[]} hull 볼록 껍질
 * @param {{gap:number, depth:number, group:'lower'|'upper', shadowAlpha:number,
 *          reflectAlpha:number, width:number, height:number}} opts
 * @returns {Array} 띠 목록
 */
function bandsForHull(hull, opts) {
  const {
    gap, depth, group, shadowAlpha, reflectAlpha, width, height,
  } = opts;
  const inner = miterVertices(hull, gap);
  const outer = miterVertices(hull, gap + depth);
  const normals = outwardEdgeNormals(hull);
  const n = hull.length;
  const bands = [];

  for (let i = 0; i < n; i += 1) {
    const nrm = normals[i];
    if (!nrm) continue;
    // 위/아래 배분 — 법선의 y 부호. n.y ≥ 0 (아래를 향한 변) 이 ①, n.y < 0 이 ②다.
    // 정확히 수직인 변(n.y = 0)은 큐브 필드의 좌·우 옆면이라 ① 로 보낸다.
    const lower = nrm.ny >= 0;
    if ((group === 'lower') !== lower) continue;

    const dot = nrm.nx * LIGHT_DIRECTION.x + nrm.ny * LIGHT_DIRECTION.y;
    const shadow = dot > 0;
    const raw = shadow ? dot : -dot;
    // 발산 협소화 (SHADING_FOCUS 주석 참조) — 아래쪽 띠만. 위쪽 아웃라인은 «윤곽»
    // 이라 균등한 것이 맞다.
    const strength = group === 'lower' ? raw ** SHADING_FOCUS : raw;
    const alpha = (shadow ? shadowAlpha : reflectAlpha) * strength;
    // 8bit 로 굽히면 사라지는 띠는 **아예 안 낸다** — 빛과 거의 평행한 변에서 나온다.
    // 내 봐야 SVG defs 만 늘고 그림은 한 픽셀도 안 바뀐다.
    if (alpha < 1 / 255) continue;

    const a = inner[i];
    const b = inner[(i + 1) % n];
    const c = outer[(i + 1) % n];
    const d2 = outer[i];
    const quad = clipToRect([a, b, c, d2], width, height);
    if (quad.length < 3) continue;

    // 그라데이션 축 = 변 중점에서 법선 방향. 도달 거리 = depth × 정렬도 (아래쪽 띠) —
    // 빛 축에 정렬된 변은 전깊이, 벗어난 변은 짧게. 종점 뒤는 pad 라 투명하다.
    const reach = group === 'lower' ? depth * raw : depth;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    bands.push({
      role: shadow ? 'shadow' : 'reflect',
      group,
      points: quad,
      color: shadow ? SHADOW_COLOR : REFLECT_COLOR,
      gradient: {
        x1: mx,
        y1: my,
        x2: mx + nrm.nx * reach,
        y2: my + nrm.ny * reach,
        a1: alpha,
        a2: 0,
      },
    });
  }
  return bands;
}

/**
 * scene 에서 음영 띠 목록을 만든다 (scene 은 안 건드린다).
 *
 * @param {{width:number,height:number,shapes:Array}} scene
 * @param {{mode?:string, rim?:boolean, clusterGap?:number, gap?:number,
 *          lowerDepth?:number, upperDepth?:number,
 *          shadowAlpha?:number, reflectAlpha?:number}} [opts]
 *   `rim` = ② T면 엣지 아웃라인 서브옵션.
 * @returns {Array} 띠 목록 (음영이 꺼져 있으면 빈 배열)
 */
export function shadingBands(scene, opts = {}) {
  const mode = opts.mode === undefined ? DEFAULT_SHADING_MODE : opts.mode;
  if (mode === SHADING_OFF) return [];
  if (mode !== SHADING_ON) throw new RangeError('알 수 없는 음영 모드: ' + mode);

  const clusterGap = opts.clusterGap === undefined ? 2 : opts.clusterGap;
  const gap = opts.gap === undefined ? SHADING_GAP : opts.gap;
  const shadowAlpha = opts.shadowAlpha === undefined ? SHADING_SHADOW_ALPHA : opts.shadowAlpha;
  const reflectAlpha = opts.reflectAlpha === undefined ? SHADING_REFLECT_ALPHA : opts.reflectAlpha;
  const lowerDepth = opts.lowerDepth === undefined ? SHADING_LOWER_DEPTH : opts.lowerDepth;
  const upperDepth = opts.upperDepth === undefined ? SHADING_UPPER_DEPTH : opts.upperDepth;

  // 껍질은 QR 블록을 제외하고 묶는다 (모듈 상단 주석 — 운영자 판정 2026-08-17,
  // 안전영역과 같은 selfQuietColors 규칙).
  const hulls = markHulls(scene, clusterGap, opts.selfQuietColors);
  const bands = [];
  for (const hull of hulls) {
    bands.push(...bandsForHull(hull, {
      gap,
      depth: lowerDepth,
      group: 'lower',
      shadowAlpha,
      reflectAlpha,
      width: scene.width,
      height: scene.height,
    }));
    if (opts.rim) {
      bands.push(...bandsForHull(hull, {
        gap,
        depth: upperDepth,
        group: 'upper',
        shadowAlpha,
        reflectAlpha,
        width: scene.width,
        height: scene.height,
      }));
    }
  }
  return bands;
}

/**
 * scene 에 음영을 얹은 **새 scene** 을 돌려준다 (입력은 안 건드린다).
 * 띠가 없으면 입력 scene 을 그대로 돌려준다 — `scene.shading` 키 자체가 안 생기므로
 * 음영을 안 쓰는 경로의 산출물은 **바이트 한 개도** 안 바뀐다.
 */
export function addShading(scene, opts = {}) {
  const bands = shadingBands(scene, opts);
  if (bands.length === 0) return scene;
  return { ...scene, shading: bands };
}
