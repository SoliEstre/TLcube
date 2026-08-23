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
// ⚠ scene.shapes 는 셀/QR 을 구분하는 라벨을 갖지 않는다. 그래서 안전영역은 **마크 전체**
// (코드 + 코너 QR 블록)의 볼록 껍질을 기준으로 잡는다. 인쇄물에서 한 덩어리로 취급되는
// 단위가 그것이므로 의미상으로도 이쪽이 맞다.

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
function selfQuietShapeIndices(shapes, selfQuietColors) {
  const excluded = new Set();
  if (!selfQuietColors || selfQuietColors.length === 0) return excluded;

  for (let i = 0; i < shapes.length; i += 1) {
    if (shapes[i].selfQuiet === true) excluded.add(i);
  }

  for (const idx of clusterShapes(shapes, CONNECT_GAP)) {
    let all = true;
    for (const i of idx) {
      if (!shapeIsSelfQuietColored(shapes[i], selfQuietColors)) { all = false; break; }
    }
    if (all) for (const i of idx) excluded.add(i);
  }
  return excluded;
}

/**
 * 마크 덩어리별 **볼록 껍질**. 안전영역(`quietZonePolygons`)과 입체 음영(`shading.js`)이
 * 같은 껍질에서 출발하도록 여기 한 번만 만든다 — 두 레이어가 서로 다른 껍질을 쓰면
 * 그림자가 안전영역 밖으로 새거나 안쪽으로 파고드는 날이 온다.
 *
 * @param {{shapes:Array}} scene
 * @param {number} clusterGap 덩어리 묶음 간격 (scene 단위)
 * @param {{r:number,g:number,b:number}[]} [selfQuietColors] 이 색들로만 이뤄진 **연결
 *   덩어리**는 제외한다 (폴백 QR 블록 — 자체 콰이어트 존이 있다). 생략하면 제외 없음.
 * @returns {{x:number,y:number}[][]} 껍질(정점 3개 이상)만
 */
export function markHulls(scene, clusterGap, selfQuietColors) {
  const excluded = selfQuietShapeIndices(scene.shapes, selfQuietColors);
  const kept = [];
  for (let i = 0; i < scene.shapes.length; i += 1) {
    if (excluded.has(i)) continue;
    kept.push(scene.shapes[i]);
  }

  const out = [];
  for (const idx of clusterShapes(kept, clusterGap)) {
    const pts = [];
    for (const i of idx) pts.push(...shapePoints(kept[i]));
    const hull = convexHull(pts);
    if (hull.length >= 3) out.push(hull);
  }
  return out;
}

/**
 * 안전영역 폴리곤들을 만든다 — 클러스터별 볼록 껍질 + 바깥 오프셋 + 캔버스 클립.
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
    const poly = clipToRect(offsetConvex(hull, margin), scene.width, scene.height);
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
