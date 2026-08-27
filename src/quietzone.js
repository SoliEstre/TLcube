// quietzone.js — 코드 주변 안전영역(quiet zone) 도형 생성 (렌더 전용, 데이터 계약 무관)
//
// QR 의 콰이어트 존과 같은 목적이다: 코드 바깥에 **깨끗한 여백**을 확보해, 코드가 놓인
// 표면의 무늬가 실루엣 검출을 방해하지 못하게 한다. 배경을 투명으로 내보내면 실효 배경이
// 배치 표면이 되므로(SPEC §9) 이 옵션의 가치가 특히 커진다.
//
// 설계 판단 — **scene 후처리로 분리한다**:
//   · scene.js/sceneY.js 를 건드리지 않는다 (두 렌더러의 와이어 스냅샷·가드가 그대로 산다)
//   · PNG·SVG 가 같은 scene 을 소비하므로 여기 한 번만 넣으면 양쪽에 자동으로 나간다
//   · 순수 기하 함수라 단독으로 검증된다
//
// 도형은 **scene.shapes 의 맨 앞**에 꽂는다 — painter 순서상 뒤에 그려지는 셀·불스아이·QR
// 이 전부 그 위에 얹힌다.
//
// ⚠ scene.shapes 는 셀/QR 을 구분하는 라벨을 갖지 않는다. 그래서 기본 안전영역은
// **마크 전체**(코드 + 코너 QR 블록)의 볼록 껍질을 기준으로 잡는다. 단 Type K 는
// scene.markSilhouette 메타데이터로 본체를 식별해 육망성 공유 외곽을 쓴다.

import { axialToPixel } from './hexgrid.js';
import { regionCellsK } from './placementK.js';

/** 부동소수 비교 여유 — 좌표는 scene 단위(셀 크기 1 근방)라 이 정도면 충분하다. */
const EPS = 1e-9;

/**
 * 볼록 껍질 (Andrew monotone chain). 완전 결정적 — 삼각함수·난수 없음.
 * @param {{x:number,y:number}[]} points
 * @returns {{x:number,y:number}[]} 껍질 정점 (중복 없음, 3개 미만이면 입력 그대로)
 */
export function convexHull(points) {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const pts = points.map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 폴리곤의 부호 있는 넓이 × 2. 방향 판정용. */
function signedArea2(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return s;
}

/**
 * 볼록 폴리곤을 바깥으로 `d` 만큼 평행이동(마이터 오프셋)한다.
 *
 * 각 변을 법선 방향으로 d 만큼 밀고 인접한 두 변의 교점을 새 정점으로 삼는다 —
 * **중심에서 스케일하는 근사가 아니다**. 정육각형·정삼각형처럼 중심에서 각 변까지의
 * 거리가 같은 도형에서는 두 방식이 일치하지만, 코너 QR 을 포함한 껍질은 그렇지
 * 않아서 스케일 방식은 변마다 여백이 달라진다.
 *
 * 마이터 길이는 꼭짓점 내각이 좁을수록 커진다(삼각형 60° → 2d). 그래서 상한을
 * `d * miterLimit` 으로 자르고, 넘으면 그 꼭짓점을 두 점으로 잘라 낸다(베벨).
 *
 * @param {{x:number,y:number}[]} poly 볼록 폴리곤
 * @param {number} d 바깥 오프셋 거리 (scene 단위)
 * @param {number} [miterLimit]
 * @returns {{x:number,y:number}[]}
 */
export function offsetConvex(poly, d, miterLimit = 4) {
  if (poly.length < 3 || d === 0) return poly.map((p) => ({ x: p.x, y: p.y }));
  // 바깥 방향은 방향(부호 있는 넓이)에 달렸다 — 넓이가 커지는 쪽이 바깥이다.
  const sign = signedArea2(poly) > 0 ? 1 : -1;

  // 변별 단위 법선 (제곱근 1회씩 — 결정적이다).
  const n = poly.length;
  const edges = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len < EPS) { edges.push(null); continue; }
    // (ex,ey) 를 90° 돌린 것이 법선. sign 으로 바깥쪽을 고른다.
    edges.push({ a, b, nx: (ey / len) * sign, ny: (-ex / len) * sign });
  }

  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = edges[(i - 1 + n) % n];
    const cur = edges[i];
    if (!prev || !cur) continue;
    // 밀린 두 직선의 교점. 직선: (p - (a + d·n)) · n = 0.
    const p1x = prev.a.x + d * prev.nx;
    const p1y = prev.a.y + d * prev.ny;
    const p2x = cur.a.x + d * cur.nx;
    const p2y = cur.a.y + d * cur.ny;
    const det = prev.nx * cur.ny - prev.ny * cur.nx;
    const vertex = poly[i];
    if (Math.abs(det) < EPS) {
      // 평행(일직선 이음) — 그냥 밀기만 한다.
      out.push({ x: vertex.x + d * cur.nx, y: vertex.y + d * cur.ny });
      continue;
    }
    const c1 = prev.nx * p1x + prev.ny * p1y;
    const c2 = cur.nx * p2x + cur.ny * p2y;
    const ix = (cur.ny * c1 - prev.ny * c2) / det;
    const iy = (prev.nx * c2 - cur.nx * c1) / det;
    const mx = ix - vertex.x;
    const my = iy - vertex.y;
    if (Math.sqrt(mx * mx + my * my) > Math.abs(d) * miterLimit) {
      // 마이터 폭주 — 베벨로 자른다 (두 변의 밀린 점을 각각 낸다).
      out.push({ x: vertex.x + d * prev.nx, y: vertex.y + d * prev.ny });
      out.push({ x: vertex.x + d * cur.nx, y: vertex.y + d * cur.ny });
    } else {
      out.push({ x: ix, y: iy });
    }
  }
  return out;
}

/** 두 선분이 교차·접촉·공선 중첩하는가. */
function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS))
    && ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))) return true;
  const onSegment = (p, q, r, turn) => Math.abs(turn) <= EPS
    && r.x >= Math.min(p.x, q.x) - EPS && r.x <= Math.max(p.x, q.x) + EPS
    && r.y >= Math.min(p.y, q.y) - EPS && r.y <= Math.max(p.y, q.y) + EPS;
  return onSegment(a, b, c, abC) || onSegment(a, b, d, abD)
    || onSegment(c, d, a, cdA) || onSegment(c, d, b, cdB);
}

/** 단순 폴리곤의 비인접 변끼리 교차·접촉·중첩하는가. */
function hasSelfIntersection(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const iNext = (i + 1) % n;
    for (let j = i + 1; j < n; j += 1) {
      const jNext = (j + 1) % n;
      if (i === j || iNext === j || jNext === i) continue;
      if (segmentsIntersect(poly[i], poly[iNext], poly[j], poly[jNext])) return true;
    }
  }
  return false;
}

/** 반사 꼭짓점이 하나라도 있는가. 감김과 무관하다. */
function isConcave(poly) {
  if (poly.length < 4) return false;
  const winding = signedArea2(poly) > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[(i - 1 + poly.length) % poly.length];
    const b = poly[i];
    const c = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross * winding < -EPS) return true;
  }
  return false;
}

/**
 * 알려진 단순 오목 폴리곤의 바깥 마이터 오프셋.
 *
 * 계산은 기존 `offsetConvex` 와 같지만, 오목 입력에는 결과의 단순성 검사가 추가된다.
 * K 육망성의 기본 margin 범위에서는 6개 반사 꼭짓점이 유지된다. margin 이 너무 커서
 * 노치가 서로 교차하는 순간에는 잘못된 SVG 를 조용히 내보내지 않고 명시적으로 막는다.
 */
export function offsetSimple(poly, d, miterLimit = 4) {
  const out = offsetConvex(poly, d, miterLimit);
  if (hasSelfIntersection(out)) {
    throw new RangeError(`오목 폴리곤 offset(${d}) 이 자기교차한다 — margin 을 줄여야 한다`);
  }
  return out;
}

/**
 * Type K 의 셀 중심 육망성 12각형을 실제 셀 외접반지름만큼 부풀린 공유 외곽.
 *
 * 6개 돌출점은 두 정삼각의 꼭짓점(축좌표 거리 2k), 6개 반사 꼭짓점은 두 삼각의
 * 교차 경계(거리 k)다. `regionCellsK` 로 12점이 정본 영역에 실제로 존재하는지 먼저
 * 잠근 뒤 화면 좌표로 옮긴다. 셀 하나의 모든 꼭짓점은 중심에서 `layout.size` 이내라
 * 마지막 offset 은 전 셀 도형을 포함한다.
 */
function hexagramHull(scene) {
  const { k, layout } = scene;
  if (!Number.isInteger(k) || !layout || !Number.isFinite(layout.size)) {
    throw new TypeError('hexagram scene 은 정수 k 와 유한한 layout.size 를 가져야 한다');
  }
  const axial = [
    { q: k, r: -2 * k }, { q: k, r: -k },
    { q: 2 * k, r: -k }, { q: k, r: 0 },
    { q: k, r: k }, { q: 0, r: k },
    { q: -k, r: 2 * k }, { q: -k, r: k },
    { q: -2 * k, r: k }, { q: -k, r: 0 },
    { q: -k, r: -k }, { q: 0, r: -k },
  ];
  const region = new Set(regionCellsK(k).map((c) => `${c.q},${c.r}`));
  for (const p of axial) {
    if (!region.has(`${p.q},${p.r}`)) {
      throw new Error(`Type K 12각형 정점 (${p.q},${p.r}) 이 regionCellsK(${k}) 밖이다`);
    }
  }
  const centers = axial.map((p) => axialToPixel(p.q, p.r, layout));
  return offsetSimple(centers, layout.size);
}

/**
 * 폴리곤을 [0,width]×[0,height] 사각형으로 자른다 (Sutherland–Hodgman).
 * 안전영역이 캔버스를 넘으면 래스터는 조용히 버리지만 SVG 는 넘친 채로 나가므로,
 * 두 출력이 갈리지 않게 여기서 맞춘다.
 */
export function clipToRect(poly, width, height) {
  const clipEdge = (pts, inside, intersect) => {
    const res = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const cur = pts[i];
      const prv = pts[j];
      const curIn = inside(cur);
      const prvIn = inside(prv);
      if (curIn) {
        if (!prvIn) res.push(intersect(prv, cur));
        res.push(cur);
      } else if (prvIn) {
        res.push(intersect(prv, cur));
      }
    }
    return res;
  };
  const lerpX = (a, b, x) => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  const lerpY = (a, b, y) => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });

  let out = poly.map((p) => ({ x: p.x, y: p.y }));
  out = clipEdge(out, (p) => p.x >= 0, (a, b) => lerpX(a, b, 0));
  out = clipEdge(out, (p) => p.x <= width, (a, b) => lerpX(a, b, width));
  out = clipEdge(out, (p) => p.y >= 0, (a, b) => lerpY(a, b, 0));
  out = clipEdge(out, (p) => p.y <= height, (a, b) => lerpY(a, b, height));
  return out;
}

/** 도형의 좌표점 (disc 는 외접 사각의 네 꼭짓점으로 근사). */
function shapePoints(s) {
  if (s.kind === 'polygon') return s.points;
  if (s.kind === 'disc') {
    return [
      { x: s.cx - s.r, y: s.cy - s.r }, { x: s.cx + s.r, y: s.cy - s.r },
      { x: s.cx + s.r, y: s.cy + s.r }, { x: s.cx - s.r, y: s.cy + s.r },
    ];
  }
  throw new RangeError(`알 수 없는 shape.kind: ${s.kind}`);
}

function bboxOf(s) {
  const pts = shapePoints(s);
  let minX = pts[0].x; let maxX = pts[0].x; let minY = pts[0].y; let maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * 도형을 **공간 클러스터**로 묶는다 — 서로 `gap` 안쪽에 있는 것끼리 한 덩어리.
 *
 * 왜 필요한가: 마크 전체의 볼록 껍질 하나로 안전영역을 만들면, 코너 QR 과 코드
 * 본체가 한 덩어리로 묶여 **둘을 잇는 대각선 판때기**가 나온다(실측 확인). 클러스터를
 * 나누면 코드는 코드대로, QR 은 QR 대로 각각 감싸는 후광이 된다.
 *
 * 방법: bbox 를 `gap` 만큼 부풀려 `gap` 크기 격자 버킷에 등록하고, 같은 버킷을 공유한
 * 것끼리 union-find 로 합친다. 두 부풀린 bbox 가 겹치면 겹침 영역이 속한 버킷을 둘 다
 * 반드시 공유하므로 누락이 없다. 반대로 안 겹치는데 같은 버킷이라 합쳐지는 경우가
 * 생길 수 있다 — 실효 병합 반경은 `gap` 이 아니라 **~2·gap + 버킷 반올림**이다.
 * (전쌍 비교는 Y2 에서 1875 도형 → 350만 쌍이라 실시간 미리보기에 부담이다.)
 *
 * ⚠ 과병합의 부호는 용도에 따라 반대다. **껍질 묶음**(markHulls)에서는 안전영역이
 * 조금 넉넉해질 뿐이라 안전한 방향이지만, **제외 판정**(selfQuietShapeIndices 의 색
 * 경로)에서는 QR 이 코드 클러스터에 합쳐져 제외가 조용히 무력화되는 방향이다 —
 * 실측: Type A 하단 코너의 코드–QR 간격 0.5셀이 CONNECT_GAP 0.25 의 실효 반경에
 * 병합됐다 (2026-08-23). 그래서 제외의 정본은 `selfQuiet` 태그다 (아래 참조).
 *
 * @param {Array} shapes
 * @param {number} gap
 * @returns {number[][]} 클러스터별 도형 인덱스 목록
 */
export function clusterShapes(shapes, gap) {
  const n = shapes.length;
  const parent = new Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    let c = i;
    while (parent[c] !== c) { const next = parent[c]; parent[c] = r; c = next; }
    return r;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };

  const cell = Math.max(gap, EPS);
  const buckets = new Map();
  for (let i = 0; i < n; i += 1) {
    const b = bboxOf(shapes[i]);
    const x0 = Math.floor((b.minX - gap) / cell);
    const x1 = Math.floor((b.maxX + gap) / cell);
    const y0 = Math.floor((b.minY - gap) / cell);
    const y1 = Math.floor((b.maxY + gap) / cell);
    for (let gy = y0; gy <= y1; gy += 1) {
      for (let gx = x0; gx <= x1; gx += 1) {
        const key = `${gx},${gy}`;
        const first = buckets.get(key);
        if (first === undefined) buckets.set(key, i);
        else union(first, i);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return [...groups.values()];
}

const sameColor = (a, b) => a && b && a.r === b.r && a.g === b.g && a.b === b.b;

/**
 * **연결성** 판정용 간격 (scene 단위 = 셀 크기 1 기준).
 *
 * 안전영역 마진(보통 2셀)과 **분리해야 한다.** 마진으로 연결성을 판정하면 코너 QR 이
 * 코드와 같은 덩어리로 묶여 버린다 — 실제로 그랬다(2026-08-11, Type A·O 모두 클러스터 1개).
 * 서로 맞닿은 셀은 묶고(변을 공유하므로 0 초과면 충분), 눈에 보이는 간격만큼 떨어진
 * 코너 QR 은 안 묶이는 값이어야 한다.
 */
const CONNECT_GAP = 0.25;

/**
 * 도형 하나가 `selfQuietColors` 안의 색만 쓰는가.
 */
function shapeIsSelfQuietColored(shape, selfQuietColors) {
  return selfQuietColors.some((c) => sameColor(c, shape.color));
}

/**
 * 자체 콰이어트 존을 가진 덩어리(폴백 QR 블록)의 도형 인덱스 집합.
 *
 * **폴백 QR 블록은 이미 자기 콰이어트 존(4모듈 밝은 패치)을 갖고 있다.** 거기에 안전영역을
 * 또 두르면 여백만 겹쳐 낭비다(사용자 판정 2026-08-09).
 *
 * 판정은 두 갈래의 합집합이다:
 *
 * ① **`selfQuiet` 태그 (정본, 2026-08-23)** — 렌더러(scene.js·sceneY.js 의 코너 QR
 *   블록)가 자기 도형에 직접 찍는다. 기하 근사가 아니라 자기선언이라 간격과 무관하게
 *   정확하다. 도입 계기: Type A 하단 코너(BL·BR)는 삼각 패치 셀 때문에 코드–QR 간격이
 *   0.5셀인데, 아래 ② 의 연결성 클러스터가 그 간격을 병합해(실효 반경 ~2·gap) 제외가
 *   무력화됐다 — 실측 213/213 삼킴 (2026-08-23). 윈도 β·중앙 QR 은 코드 몸통의 일부라
 *   태그를 찍지 않는다 (hull 에 남아야 한다).
 *
 * ② **색 + 연결성 (폴백)** — 태그 없는 scene(외부 임베더·수제 픽스처)용으로 유지한다.
 *   연결성 간격(CONNECT_GAP)으로 묶은 클러스터 전원이 `selfQuietColors` 면 통째로 제외.
 *   ⚠ 판정을 **안전영역 마진이 아니라 연결성 간격**으로 한다. 이전 구현은 마진(2셀)으로
 *   묶어서, 마진이 QR 과 코드 사이를 메우면 제외가 조용히 무력화됐다(2026-08-11 수리).
 *
 * 불스아이도 같은 두 색을 쓰지만 코드 셀과 **맞닿아** 있어 ② 의 클러스터에 코드 셀이
 * 섞이므로 제외되지 않고, 태그도 없으므로 ① 에도 안 걸린다.
 */
/**
 * 자체 콰이어트 존을 가진 **떨어져 있는** 블록의 인덱스.
 *
 * ⭐ **원점 인식 (2026-08-26, 운영자 지시)** — 이 배제의 뜻은 처음부터
 * 「**폴백** QR 블록」, 즉 코드 **바깥에 따로 붙은** 덩어리였다. 그런데 판정이
 * «색이 전부 불스아이인 연결 덩어리» 하나뿐이라, 코드 **안에 박힌** 중앙 QR 까지
 * 같이 걷어냈다. 중앙 QR 은 떨어져 있지 않다 — 중앙 19셀 슬롯을 채우는 코드의 일부다.
 *
 * 그 오배제가 K 에서 터졌다: `markSilhouette='hexagram'` 은 본체 클러스터를
 * «layout 원점을 품은 도형» 으로 고르는데, 배제된 그 중앙 QR 이 **정확히 원점을
 * 품은 유일한 도형**이었다 ⇒ 본체 없음 ⇒ throw. 실측 대조군(2026-08-26):
 * K 평 OK · K+코너QR OK · K+중앙Y0 OK · **K+중앙QR ❌** · O+중앙QR OK
 * (O 는 육망성 경로를 안 타서 증상만 안 보였을 뿐, 오배제는 O 에서도 일어나고 있었다).
 *
 * ⇒ **원점을 품은 덩어리는 배제하지 않는다.** 술어는 `markHulls` 의 본체 판정과
 * **같은 것**을 쓴다 — 두 곳이 «중앙» 을 다르게 정의하면 그 차이가 그대로 사고다.
 *
 * ⚠ O/A 는 볼록 껍질이라 **안쪽 도형이 늘어도 껍질이 안 바뀐다** — 중앙 QR 은 코드
 * 안쪽이므로 산출이 바이트 동일해야 한다. 그 예측을 테스트가 잠근다.
 *
 * ⚠ **두 배제 경로를 «둘 다» 면제해야 한다** (2026-08-26 실측에서 배웠다).
 * 처음엔 색-클러스터 루프에만 면제를 걸었는데 **아무 효과가 없었다** — 중앙 QR 모듈은
 * `shape.selfQuiet === true` 명시 표지로도 걸리고, 원점을 품은 도형 2개가 **둘 다**
 * 그 표지를 달고 있었다. 그 표지는 «떨어져 있다» 는 단언이 아니라 그냥 «이건 QR» 이라
 * 렌더러가 코너·중앙을 안 가리고 붙인다. 그래서 면제는 표지가 아니라 **위치**로 건다.
 */
function selfQuietShapeIndices(shapes, selfQuietColors, origin) {
  const excluded = new Set();
  if (!selfQuietColors || selfQuietColors.length === 0) return excluded;

  const hasOrigin = origin && Number.isFinite(origin.x) && Number.isFinite(origin.y);
  // ⚠ **bbox 로 판정하면 안 된다** (2026-08-26 실측). 처음엔 `markHulls` 의 본체 판정과
  //    같은 bbox 술어를 썼는데, A v0 의 BL·BR 코너 QR 이 **bbox 만** 원점을 걸쳐
  //    함께 면제됐고 `quietzone.test.js` 의 「어느 코너의 QR 도 안전영역이 덮지
  //    않는다」가 깨졌다. 원 주석이 경계하던 «비정상적으로 큰 외부 블록» 과 같은 함정이다.
  //    면제는 **실제로 원점을 덮는** 도형에만 준다 — 점-다각형 포함으로 좁힌다.
  const holdsOrigin = (i) => {
    if (!hasOrigin) return false;
    const s = shapes[i];
    const pts = s.points;
    if (!Array.isArray(pts) || pts.length < 3) return false;
    // 먼저 bbox 로 싸게 거르고(대부분 여기서 끝난다), 통과한 것만 정확히 판정한다.
    const b = bboxOf(s);
    if (origin.x < b.minX - EPS || origin.x > b.maxX + EPS
      || origin.y < b.minY - EPS || origin.y > b.maxY + EPS) return false;
    let inside = false;
    for (let a = 0, c = pts.length - 1; a < pts.length; c = a, a += 1) {
      const yi = pts[a].y; const yj = pts[c].y;
      if ((yi > origin.y) !== (yj > origin.y)) {
        const xCross = ((pts[c].x - pts[a].x) * (origin.y - yi)) / (yj - yi) + pts[a].x;
        if (origin.x < xCross) inside = !inside;
      }
    }
    return inside;
  };

  // 원점을 품은 도형이 든 덩어리는 통째로 «코드의 일부» 다 — 어느 경로로도 배제하지
  // 않는다. 덩어리 단위로 잡는 이유는, 낱개만 살리면 중앙 QR 이 반쪽만 남아 껍질이
  // 실제 그림과 어긋나기 때문이다.
  const central = new Set();
  if (hasOrigin) {
    for (const idx of clusterShapes(shapes, CONNECT_GAP)) {
      let hit = false;
      for (const i of idx) if (holdsOrigin(i)) { hit = true; break; }
      if (hit) for (const i of idx) central.add(i);
    }
  }

  for (let i = 0; i < shapes.length; i += 1) {
    if (shapes[i].selfQuiet === true && !central.has(i)) excluded.add(i);
  }

  for (const idx of clusterShapes(shapes, CONNECT_GAP)) {
    let all = true;
    for (const i of idx) {
      if (!shapeIsSelfQuietColored(shapes[i], selfQuietColors)) { all = false; break; }
    }
    if (all) for (const i of idx) if (!central.has(i)) excluded.add(i);
  }
  return excluded;
}

/**
 * 마크 덩어리별 **공유 외곽**. 기본은 볼록 껍질이고, `markSilhouette='hexagram'` 인
 * Type K 본체 클러스터만 정본 12각형 외곽을 쓴다. 안전영역(`quietZonePolygons`)과
 * 입체 음영(`shading.js`)이 같은 외곽에서 출발하도록 여기 한 번만 만든다 — 두 레이어가
 * 서로 다른 외곽을 쓰면 그림자가 안전영역 밖으로 새거나 안쪽으로 파고든다.
 *
 * @param {{shapes:Array}} scene
 * @param {number} clusterGap 덩어리 묶음 간격 (scene 단위)
 * @param {{r:number,g:number,b:number}[]} [selfQuietColors] 이 색들로만 이뤄진 **연결
 *   덩어리**는 제외한다 (폴백 QR 블록 — 자체 콰이어트 존이 있다). 생략하면 제외 없음.
 * @returns {{x:number,y:number}[][]} 껍질(정점 3개 이상)만
 */
export function markHulls(scene, clusterGap, selfQuietColors) {
  // ⚠ **원점을 반드시 넘긴다.** 안 넘기면 배제가 원점을 못 보고 중앙 QR 을 다시
  //    걷어내며, 그러면 아래 본체 판정이 «중앙을 품은 도형 없음» 으로 던진다.
  //    (2026-08-26: 함수 인자만 늘리고 이 호출부를 안 고쳐 수정이 무효였다 —
  //     전후 지문이 **완전히 동일**해서 드러났다. 「배타를 열면 소비자도 쓸어라」.)
  const origin = scene.layout
    ? { x: scene.layout.originX, y: scene.layout.originY }
    : null;
  const excluded = selfQuietShapeIndices(scene.shapes, selfQuietColors, origin);
  const kept = [];
  for (let i = 0; i < scene.shapes.length; i += 1) {
    if (excluded.has(i)) continue;
    kept.push(scene.shapes[i]);
  }

  const clusters = clusterShapes(kept, clusterGap);
  let mainCluster = -1;
  if (scene.markSilhouette === 'hexagram') {
    // 본체에는 항상 중앙 파인더가 있어 layout 원점을 포함하는 도형이 있다. 크기만으로
    // 고르면 비정상적으로 큰 외부 블록이 본체를 이길 수 있으므로 중심 포함으로 고른다.
    const cx = scene.layout && scene.layout.originX;
    const cy = scene.layout && scene.layout.originY;
    for (let ci = 0; ci < clusters.length && mainCluster < 0; ci += 1) {
      for (const i of clusters[ci]) {
        const b = bboxOf(kept[i]);
        if (cx >= b.minX - EPS && cx <= b.maxX + EPS
          && cy >= b.minY - EPS && cy <= b.maxY + EPS) {
          mainCluster = ci;
          break;
        }
      }
    }
    if (mainCluster < 0) {
      throw new Error('Type K 본체 클러스터를 찾지 못했다 — 중앙을 포함하는 도형이 없다');
    }
  }

  const out = [];
  for (let ci = 0; ci < clusters.length; ci += 1) {
    if (ci === mainCluster) {
      out.push(hexagramHull(scene));
      continue;
    }
    const idx = clusters[ci];
    const pts = [];
    for (const i of idx) pts.push(...shapePoints(kept[i]));
    const hull = convexHull(pts);
    if (hull.length >= 3) out.push(hull);
  }
  return out;
}

/**
 * 안전영역 폴리곤들을 만든다 — 클러스터별 공유 외곽 + 바깥 오프셋 + 캔버스 클립.
 * @param {{width:number, height:number, shapes:Array}} scene
 * @param {number} margin 오프셋 거리 (scene 단위 — 셀 크기 1 기준 "셀 몇 개분")
 * @param {{r:number,g:number,b:number}[]} [selfQuietColors] 이 색들로만 이뤄진 **연결
 *   덩어리**는 자체 콰이어트 존이 있다고 보고 제외한다 (폴백 QR 블록).
 * @returns {{x:number,y:number}[][]}
 */
export function quietZonePolygons(scene, margin, selfQuietColors) {
  // 제외 판정을 **먼저** 한다 — 연결성 간격 기준으로. 그 다음 남은 도형만 마진으로
  // 묶어 hull 을 만든다. 순서를 반대로 하면 마진이 QR 과 코드를 한 덩어리로 붙여
  // 제외가 무력화된다(그 결과가 QR 과 코드를 잇는 대각선 안전영역이다).
  const out = [];
  for (const hull of markHulls(scene, margin, selfQuietColors)) {
    const expanded = isConcave(hull)
      ? offsetSimple(hull, margin)
      : offsetConvex(hull, margin);
    const poly = clipToRect(expanded, scene.width, scene.height);
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

/**
 * scene 에 안전영역을 얹은 **새 scene** 을 돌려준다 (입력은 안 건드린다).
 * @param {object} scene buildScene / buildSceneY 산출물
 * @param {{color: {r,g,b}|null, margin?: number, selfQuietColors?: {r,g,b}[]}} opts
 *   color 가 null 이면 무변경(= '없음').
 * @returns {object}
 */
export function addQuietZone(scene, opts) {
  const { color, margin = 2, selfQuietColors } = opts || {};
  if (!color) return scene;
  if (!Number.isFinite(margin) || margin < 0) {
    throw new RangeError(`margin 은 0 이상 유한수여야 한다: ${margin}`);
  }
  const polys = quietZonePolygons(scene, margin, selfQuietColors);
  if (polys.length === 0) return scene;
  return {
    ...scene,
    quietZone: { color, margin, count: polys.length },
    shapes: [...polys.map((points) => ({ kind: 'polygon', points, color })), ...scene.shapes],
  };
}
