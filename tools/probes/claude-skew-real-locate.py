"""claude-skew-real-locate.py — 사진에서 **TL큐브 영역**을 독립적으로 찾는다 (진단 전용).

디코더와 독립인 규칙만 쓴다 (디코더 결과로 크롭을 정하면 순환 논증이 된다):
  이 코퍼스의 TL큐브는 **채도가 있다**(청보라). 같은 화면의 QR·체커보드 배경·모니터
  UI 는 사실상 무채색이다. 그래서 «채도 임계 + 최대 연결성분» 이 큐브를 고른다.

산출: JSON {photo, size, bbox, hull, hexVertices, nearCorner, faceMeans, ...}
  - hull      : 채도 성분의 볼록껍질 (원본 좌표)
  - hexVertices: 껍질을 6방향 극점으로 줄인 육각 근사 (CCW)
  - nearCorner : 소실점 3개로 구한 **Y 접합점**(가까운 꼭짓점)의 사영 정확해
  - faceMeans  : 세 면의 상대휘도 통계 (median/mean/p10/p90/span)

주: 상대휘도는 `src/luminance.js` 와 같은 sRGB→선형 변환 + Rec.709 가중.
"""

import argparse
import json
import math
import sys
from collections import deque

from PIL import Image


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


LUT = [srgb_to_linear(v) for v in range(256)]


def rel_luma(r, g, b):
    return 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b]


def largest_saturated_component(im, work_width=600, sat_threshold=12):
    """«어두우면서 유채색» 픽셀의 최대 연결성분. 반환은 (cells, scale, w, h).

    왜 이 조합인가 (실측, p03 @1200px):
      어두운 20% 픽셀의 chroma 중앙값 — TL큐브 **20** · QR **6** · 배경 **5**.
      순수 채도만 쓰면 큐브 밝은 셀이 임계 아래로 빠져 성분이 조각난다(첫 시도에서
      실제로 좌측 면만 잡혔다). 어두움 + 유채색이 QR·체커보드와 큐브를 깨끗이 가른다.
    """
    w0, h0 = im.size
    scale = work_width / max(w0, h0)
    w, h = max(1, round(w0 * scale)), max(1, round(h0 * scale))
    small = im.resize((w, h), Image.BOX)
    px = small.load()
    lum = [0.0] * (w * h)
    chroma = [0] * (w * h)
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            i = y * w + x
            lum[i] = (r + g + b) / 3.0
            chroma[i] = max(r, g, b) - min(r, g, b)
    order = sorted(lum)
    dark_cut = order[int(0.30 * (len(order) - 1))]
    sat = bytearray(w * h)
    for i in range(w * h):
        if lum[i] <= dark_cut and chroma[i] >= sat_threshold:
            sat[i] = 1
    # 3×3 닫힘 — 밝은 셀이 뚫은 구멍을 메워 한 성분으로 잇는다
    for _ in range(2):
        grown = bytearray(sat)
        for y in range(h):
            for x in range(w):
                if sat[y * w + x]:
                    continue
                hits = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and sat[ny * w + nx]:
                            hits += 1
                if hits >= 3:
                    grown[y * w + x] = 1
        sat = grown

    best, best_size = None, 0
    seen = bytearray(w * h)
    for start in range(w * h):
        if sat[start] == 0 or seen[start]:
            continue
        queue = deque([start])
        seen[start] = 1
        cells = []
        while queue:
            idx = queue.popleft()
            cells.append(idx)
            cy, cx = divmod(idx, w)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h:
                    nidx = ny * w + nx
                    if sat[nidx] and not seen[nidx]:
                        seen[nidx] = 1
                        queue.append(nidx)
        # 프레임 가장자리에 닿는 성분은 큐브가 아니다 — p00 에서 책상 밑 케이블·RGB
        # 조명이 «어둡고 유채색» 조건을 통과해 최대 성분을 가로챘다(실측: bbox x=0,
        # N 스프레드 706px). 큐브는 여섯 장 모두 화면 안쪽에 있다.
        xs = [c % w for c in cells]
        ys = [c // w for c in cells]
        if min(xs) <= 1 or min(ys) <= 1 or max(xs) >= w - 2 or max(ys) >= h - 2:
            continue
        # 종횡비 게이트 — p00 은 책상 밑 케이블·RGB 조명 덩어리가 «어둡고 유채색» 을
        # 통과해 최대 성분을 가로챘다 (bbox 2087×694, N 스프레드 326px). 큐브 실루엣은
        # 육각이라 종횡비가 1 근처다. (hull 채움비는 쓰지 않는다 — 마스크가 «어두운
        # 셀만» 이라 밝은 셀 자리가 구멍으로 남아 채움비가 0.5 근처다. 게이트로 걸면
        # 진짜 큐브가 떨어진다 — 실측으로 확인.)
        bw = max(xs) - min(xs) + 1
        bh = max(ys) - min(ys) + 1
        aspect = bw / bh
        if not (0.6 <= aspect <= 1.7):
            continue
        if len(cells) > best_size:
            best, best_size = cells, len(cells)
    return best, scale, w, h


def convex_hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def hex_from_hull(hull, center):
    """볼록껍질 → 육각 꼭짓점 6개. **변 6개를 먼저 고르고 교점으로 꼭짓점을 만든다.**

    껍질 정점을 직접 고르면(외각 상위 6개) 계단 픽셀 때문에 한 모서리에 3개가 몰린다
    (첫 구현에서 실제로 그랬다 — 3점이 13px 안에 붙음). 실루엣이 육각이면 **긴 변 6개**가
    안정적이다: 껍질 변을 방향이 비슷한 것끼리 묶어 대표선(총최소제곱)을 뽑고, 길이 상위
    6개를 각도순으로 정렬해 이웃끼리 교차시킨다.
    """
    n = len(hull)
    edges = []
    for i in range(n):
        p, q = hull[i], hull[(i + 1) % n]
        length = math.hypot(q[0] - p[0], q[1] - p[1])
        angle = math.atan2(q[1] - p[1], q[0] - p[0]) % math.pi
        edges.append({'p': p, 'q': q, 'len': length, 'angle': angle, 'pts': [p, q]})

    # 방향 유사(≤12°) + 연속인 껍질 변을 하나로 병합
    merged = []
    for edge in edges:
        if merged:
            prev = merged[-1]
            diff = abs(prev['angle'] - edge['angle'])
            diff = min(diff, math.pi - diff)
            if diff <= math.radians(12):
                prev['pts'].append(edge['q'])
                total = prev['len'] + edge['len']
                prev['angle'] = prev['angle'] if prev['len'] >= edge['len'] else edge['angle']
                prev['len'] = total
                continue
        merged.append({'angle': edge['angle'], 'len': edge['len'], 'pts': list(edge['pts'])})
    if len(merged) > 1:
        first, last = merged[0], merged[-1]
        diff = abs(first['angle'] - last['angle'])
        diff = min(diff, math.pi - diff)
        if diff <= math.radians(12):
            last['pts'].extend(first['pts'])
            last['len'] += first['len']
            merged.pop(0)

    # 방향 3계열 × 양쪽 = 변 6개. «가장 긴 6개» 를 그냥 쓰면 거의 평행한 두 변이
    # 이웃으로 배치돼 교점이 무한대로 날아간다 (p03 첫 시도에서 오른쪽 위로 스파이크).
    # 큐브 실루엣은 마주보는 변이 평행하므로 **방향 3계열로 묶고 양쪽 극단선**을 쓴다.
    by_length = sorted(merged, key=lambda e: -e['len'])

    def angdiff(a, b):
        d = abs(a - b) % math.pi
        return min(d, math.pi - d)

    dirs = []
    for edge in by_length:
        if all(angdiff(edge['angle'], d) > math.radians(22) for d in dirs):
            dirs.append(edge['angle'])
        if len(dirs) == 3:
            break
    if len(dirs) < 3:
        return None

    groups = {}
    for edge in merged:
        k = min(range(3), key=lambda i: angdiff(edge['angle'], dirs[i]))
        nx, ny = -math.sin(dirs[k]), math.cos(dirs[k])
        mx = sum(p[0] for p in edge['pts']) / len(edge['pts'])
        my = sum(p[1] for p in edge['pts']) / len(edge['pts'])
        side = 1 if (mx - center[0]) * nx + (my - center[1]) * ny >= 0 else -1
        groups.setdefault((k, side), []).extend(edge['pts'])
    if len(groups) < 6:
        return None
    # 각 (방향, 쪽) 에서 점이 많은 6개만 남긴다
    top = [{'pts': pts} for _, pts in sorted(groups.items(), key=lambda kv: -len(kv[1]))[:6]]

    lines = []
    for edge in top:
        pts = edge['pts']
        mx = sum(p[0] for p in pts) / len(pts)
        my = sum(p[1] for p in pts) / len(pts)
        sxx = sum((p[0] - mx) ** 2 for p in pts)
        syy = sum((p[1] - my) ** 2 for p in pts)
        sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
        theta = 0.5 * math.atan2(2 * sxy, sxx - syy)  # 총최소제곱 주축
        dx, dy = math.cos(theta), math.sin(theta)
        a, b = -dy, dx
        lines.append({'line': (a, b, -(a * mx + b * my)),
                      'mid': (mx, my),
                      'ang': math.atan2(my - center[1], mx - center[0])})

    lines.sort(key=lambda e: e['ang'])
    verts = []
    for i in range(6):
        point = intersect(lines[i]['line'], lines[(i + 1) % 6]['line'])
        if point is None:
            return None
        verts.append(point)
    verts.sort(key=lambda p: math.atan2(p[1] - center[1], p[0] - center[0]))
    return verts


def line_through(p, q):
    return (p[1] - q[1], q[0] - p[0], p[0] * q[1] - q[0] * p[1])


def intersect(l1, l2):
    a1, b1, c1 = l1
    a2, b2, c2 = l2
    d = a1 * b2 - a2 * b1
    if abs(d) < 1e-12:
        return None
    return ((b1 * c2 - b2 * c1) / d, (c1 * a2 - c2 * a1) / d)


def seam_contrast(im, n_pt, verts):
    """세 후보 심(N→V0, N→V2, N→V4) 양옆의 평균 휘도 차 합.

    참 심은 **면 게인이 바뀌는 경계**(T 1.0 · L 0.72 · R 0.52)라 양옆 평균이 계통적으로
    다르다. 거짓 심(면 한가운데를 가르는 선)은 양옆이 같은 면이라 차이가 0 에 수렴한다.
    parity 판정을 «세 직선 교점의 근접도» 로만 하면 안 되는 이유: 정투영 극한에서
    가까운 꼭짓점과 먼 꼭짓점이 같은 점에 투영돼 두 parity 의 spread 가 거의 같다
    (p05 실측 — 잘못된 parity 가 이겨 면이 반씩 섞였다).
    """
    px = im.load()
    w, h = im.size
    total = 0.0
    for k in (0, 2, 4):
        vx, vy = verts[k]
        dx, dy = vx - n_pt[0], vy - n_pt[1]
        length = math.hypot(dx, dy)
        if length < 1:
            continue
        ux, uy = dx / length, dy / length
        nx, ny = -uy, ux
        # 오프셋은 작게, 표본은 많이, 통계는 **중앙값**. 평균 + 큰 오프셋(10%)은 셀
        # 텍스처와 이웃 면 침범에 흔들려 p05 에서 오판했다(실측).
        off = max(3.0, length * 0.05)
        left, right = [], []
        for step in range(30):
            t = (step + 1.0) / 32.0
            bx, by = n_pt[0] + dx * t, n_pt[1] + dy * t
            for sign, bucket in ((1, left), (-1, right)):
                sx = int(round(bx + nx * off * sign))
                sy = int(round(by + ny * off * sign))
                if 0 <= sx < w and 0 <= sy < h:
                    r, g, b = px[sx, sy]
                    bucket.append(rel_luma(r, g, b))
        if left and right:
            total += abs(sorted(left)[len(left) // 2] - sorted(right)[len(right) // 2])
    return total


def near_corner(v, im=None, force_parity=None):
    """육각 꼭짓점 6개(순서대로) → Y 접합점 N (사영 정확해).

    3D 큐브 실루엣에서 마주보는 변은 평행하다. 소실점 3개를 구한 뒤
    N = line(V0,P_z) ∩ line(V2,P_y) 로 얻는다. 두 패리티는 **심 대비**로 고르고
    (im 이 있을 때), 없으면 교점 스프레드로 폴백한다.
    """
    cands = []
    for parity in (0, 1):
        w = [v[(i + parity) % 6] for i in range(6)]
        p_a = intersect(line_through(w[0], w[1]), line_through(w[3], w[4]))
        p_b = intersect(line_through(w[1], w[2]), line_through(w[4], w[5]))
        p_c = intersect(line_through(w[2], w[3]), line_through(w[5], w[0]))
        if p_a is None or p_b is None or p_c is None:
            continue
        l0 = line_through(w[0], p_b)
        l1 = line_through(w[2], p_a)
        l2 = line_through(w[4], p_c)
        pts = [intersect(l0, l1), intersect(l1, l2), intersect(l0, l2)]
        if any(p is None for p in pts):
            continue
        cx = sum(p[0] for p in pts) / 3
        cy = sum(p[1] for p in pts) / 3
        spread = max(math.hypot(p[0] - cx, p[1] - cy) for p in pts)
        contrast = seam_contrast(im, (cx, cy), w) if im is not None else None
        gainSpread = quad_gain_spread(im, (cx, cy), w) if im is not None else None
        cand = {
            'parity': parity, 'N': (cx, cy), 'spread': spread,
            'seamContrast': contrast, 'gainSpread': gainSpread,
            'vanishing': [p_a, p_b, p_c], 'order': w,
        }
        cands.append(cand)
    if not cands:
        return None
    # parity 판정 = **심 대비**. 참 심은 면 게인이 바뀌는 실제 모서리라 양옆 중앙값이
    # 계통적으로 다르고, 거짓 심은 한 면의 대각선이라 양옆이 같은 면이다 → 대비 ≈ 0.
    if force_parity is not None:
        forced = [c for c in cands if c['parity'] == force_parity]
        best = forced[0] if forced else cands[0]
    elif all(c['seamContrast'] is not None for c in cands):
        best = max(cands, key=lambda c: c['seamContrast'])
    else:
        best = min(cands, key=lambda c: c['spread'])
    best['alternatives'] = [
        {'parity': c['parity'], 'seamContrast': c['seamContrast'],
         'gainSpread': c['gainSpread'], 'spread': c['spread']} for c in cands]
    return best


def quad_gain_spread(im, n_pt, verts, shrink=0.8):
    """세 면 사각형의 휘도 중앙값이 얼마나 벌어지는가 = (max−min)/mean.

    parity 가 맞으면 세 사각형은 각각 T·L·R 한 면이라 게인(1 / 0.72 / 0.52)이 그대로
    드러난다. parity 가 틀리면 각 사각형이 이웃 두 면을 반씩 물어 중앙값이 서로
    가까워진다 (기대 스프레드가 약 절반). **면 라벨링과 무관한 판정**이다 —
    «어느 사각형이 R 인가» 는 여기서 정하지 않는다.
    """
    px = im.load()
    w, h = im.size
    medians = []
    for k in range(3):
        quad = [n_pt, verts[(2 * k) % 6], verts[(2 * k + 1) % 6], verts[(2 * k + 2) % 6]]
        gx = sum(p[0] for p in quad) / 4
        gy = sum(p[1] for p in quad) / 4
        shrunk = [(gx + (p[0] - gx) * shrink, gy + (p[1] - gy) * shrink) for p in quad]
        xs = [p[0] for p in shrunk]
        ys = [p[1] for p in shrunk]
        x0, x1 = int(max(0, min(xs))), int(min(w - 1, max(xs)))
        y0, y1 = int(max(0, min(ys))), int(min(h - 1, max(ys)))
        step = max(1, (x1 - x0) // 60)
        vals = []
        for y in range(y0, y1 + 1, step):
            for x in range(x0, x1 + 1, step):
                if point_in_poly(x + 0.5, y + 0.5, shrunk):
                    r, g, b = px[x, y]
                    vals.append(rel_luma(r, g, b))
        if not vals:
            return None
        vals.sort()
        medians.append(vals[len(vals) // 2])
    mean = sum(medians) / 3
    if mean <= 0:
        return None
    return (max(medians) - min(medians)) / mean


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin:
                inside = not inside
    return inside


def quantiles(values, qs):
    if not values:
        return [None] * len(qs)
    s = sorted(values)
    out = []
    for q in qs:
        idx = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
        out.append(s[idx])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('--json', default=None)
    ap.add_argument("--sat", type=int, default=12)
    ap.add_argument('--work', type=int, default=1200)
    ap.add_argument('--debug', default=None, help='육각·면·N 을 그린 확인용 PNG')
    ap.add_argument('--parity', type=int, default=None, help='패리티 강제 (0/1) — 자동판정 검증용')
    ap.add_argument('--shrink', type=float, default=0.86,
                    help='면 표본용 축소율 (경계 픽셀 배제)')
    args = ap.parse_args()

    im = Image.open(args.source).convert('RGB')
    cells, scale, w, h = largest_saturated_component(im, args.work, args.sat)
    if not cells:
        print(json.dumps({'error': 'no-saturated-component'}))
        return 1
    pts = [(idx % w, idx // w) for idx in cells]
    hull_small = convex_hull(pts)
    cx = sum(p[0] for p in hull_small) / len(hull_small)
    cy = sum(p[1] for p in hull_small) / len(hull_small)
    hexv_small = hex_from_hull(hull_small, (cx, cy))
    if hexv_small is None:
        print(json.dumps({'error': 'hex-fit-failed', 'hullPoints': len(hull_small)}))
        return 1
    inv = 1.0 / scale
    hexv = [(p[0] * inv, p[1] * inv) for p in hexv_small]
    nc = near_corner(hexv, im, force_parity=args.parity)

    xs = [p[0] for p in hexv]
    ys = [p[1] for p in hexv]
    bbox = [min(xs), min(ys), max(xs), max(ys)]

    out = {
        'photo': args.source,
        'size': list(im.size),
        'componentPixels': len(cells),
        'workScale': scale,
        'bbox': bbox,
        'hexVertices': hexv,
        'nearCorner': nc and {'N': nc['N'], 'spread': nc['spread'], 'parity': nc['parity'], 'seamContrast': nc['seamContrast'], 'gainSpread': nc['gainSpread'], 'alternatives': nc['alternatives']},
    }

    if nc:
        order = nc['order']
        n_pt = nc['N']
        faces = []
        for k in range(3):
            quad = [n_pt, order[(2 * k) % 6], order[(2 * k + 1) % 6], order[(2 * k + 2) % 6]]
            gx = sum(p[0] for p in quad) / 4
            gy = sum(p[1] for p in quad) / 4
            shrunk = [(gx + (p[0] - gx) * args.shrink, gy + (p[1] - gy) * args.shrink) for p in quad]
            faces.append({'quad': quad, 'shrunk': shrunk, 'centroid': (gx, gy)})

        px = im.load()
        x0, y0, x1, y1 = (int(bbox[0]), int(bbox[1]), int(math.ceil(bbox[2])), int(math.ceil(bbox[3])))
        x0 = max(0, x0); y0 = max(0, y0)
        x1 = min(im.size[0] - 1, x1); y1 = min(im.size[1] - 1, y1)
        step = max(1, int((x1 - x0) / 240))
        values = [[], [], []]
        for y in range(y0, y1 + 1, step):
            for x in range(x0, x1 + 1, step):
                for k in range(3):
                    if point_in_poly(x + 0.5, y + 0.5, faces[k]['shrunk']):
                        r, g, b = px[x, y]
                        values[k].append(rel_luma(r, g, b))
                        break
        # 면 이름 — 렌더 규약: Y 접합점 N 에서 T 는 위, L 은 왼쪽 아래, R 은 오른쪽 아래.
        # N→중심 방향으로 가장 «위» 인 면이 T, 남은 둘 중 x 가 작은 쪽이 L.
        # 라벨은 **심 방향**으로 정한다. 면 중심 방향으로 하면 아래에서 올려 찍어
        # T 면이 납작해진 장(p00·p01)에서 T 가 «가장 위» 가 아니게 되어 라벨이
        # 한 칸 회전한다(실측: R/T 가 1.37 로 나옴 = T 를 R 로 읽음).
        # 렌더 규약상 세 심 중 **하나만 아래로** 향하고 그 심이 L|R 경계다.
        # 면 k 는 심 k 와 심 k+1 사이 → 아래 심 d 에 안 닿는 면(d+1)이 T.
        seams = [(order[(2 * k) % 6][0] - n_pt[0], order[(2 * k) % 6][1] - n_pt[1]) for k in range(3)]
        down = max(range(3), key=lambda k: seams[k][1] / max(1e-9, math.hypot(*seams[k])))
        t_index = (down + 1) % 3
        dirs = [(faces[k]['centroid'][0] - n_pt[0], faces[k]['centroid'][1] - n_pt[1]) for k in range(3)]
        rest = [k for k in range(3) if k != t_index]
        rest.sort(key=lambda k: dirs[k][0])
        names = [None, None, None]
        names[t_index] = 'T'
        names[rest[0]] = 'L'
        names[rest[1]] = 'R'
        out['faceOrder'] = names
        stats = {}
        for k in range(3):
            q = quantiles(values[k], [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95])
            stats[names[k]] = {
                'n': len(values[k]),
                'mean': (sum(values[k]) / len(values[k])) if values[k] else None,
                'p05': q[0], 'p10': q[1], 'p25': q[2], 'median': q[3],
                'p75': q[4], 'p90': q[5], 'p95': q[6],
                'span_p10_p90': (q[5] - q[1]) if q[1] is not None else None,
                'centroid': faces[k]['centroid'],
                'quad': faces[k]['quad'],
            }
        out['faceStats'] = stats
        out['sampleStep'] = step

    if args.debug and nc:
        from PIL import ImageDraw
        dbg = im.copy()
        draw = ImageDraw.Draw(dbg)
        colors = [(255, 0, 0), (0, 200, 0), (0, 120, 255)]
        for k, face in enumerate(faces):
            draw.polygon([tuple(p) for p in face['shrunk']], outline=colors[k], width=6)
        draw.line([tuple(p) for p in nc['order']] + [tuple(nc['order'][0])], fill=(255, 255, 0), width=4)
        n_pt = nc['N']
        draw.ellipse([n_pt[0] - 12, n_pt[1] - 12, n_pt[0] + 12, n_pt[1] + 12], outline=(255, 0, 255), width=6)
        for k, face in enumerate(faces):
            cxx, cyy = face['centroid']
            draw.text((cxx - 6, cyy - 6), names[k], fill=(255, 255, 0))
            draw.ellipse([cxx - 22, cyy - 22, cxx + 22, cyy + 22], outline=(255, 255, 0), width=4)
        pad = 0.35 * max(bbox[2] - bbox[0], bbox[3] - bbox[1])
        dbg = dbg.crop((int(bbox[0] - pad), int(bbox[1] - pad), int(bbox[2] + pad), int(bbox[3] + pad)))
        dbg.thumbnail((720, 720), Image.LANCZOS)
        dbg.save(args.debug)

    text = json.dumps(out, indent=1)
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as fh:
            fh.write(text)
    print(text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
