"""claude-skew-real-tilt.py — 실사진의 **심볼 평면 기울기 θ** 추정 (진단 전용).

원리: 렌더된 큐브 실루엣은 **정육각형**이다 (`src/hexgrid.js` CORNER_UNIT_OFFSETS =
단위원 위 60° 간격 6점 — 확인함). 화면은 평면이므로 «정육각형 → 관측 육각형» 은
호모그래피 H 다. 정사각 픽셀 + 주점=영상 중심 + skew 0 을 가정하면 H 한 장으로
초점거리 f 를 풀 수 있고 (Zhang 의 두 제약), 이어서 평면 법선 r3 을 얻는다.
θ = acos(|r3·z|) = 카메라 광축과 화면 법선이 이루는 각.

두 제약(직교·등노름)은 **각각 독립으로** f 를 준다 — 둘의 불일치를 그대로 보고해
추정 품질을 드러낸다(억지로 하나로 합치지 않는다).

입력: claude-skew-real-locate.py 가 낸 JSON (hexVertices), 또는 --verts 로 직접.
"""

import argparse
import json
import math


def dlt_homography(src, dst):
    """4점 이상 대응 → H (3×3, h33=1 정규화 없이 SVD 최소특이벡터)."""
    rows = []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    return [list(r) for r in svd_null(rows)]


def svd_null(a):
    """A^T A 의 최소 고윳벡터 (야코비 고유분해). 외부 의존 없이 9×9 대칭 고유문제."""
    n = len(a[0])
    ata = [[sum(row[i] * row[j] for row in a) for j in range(n)] for i in range(n)]
    v = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    for _ in range(200):
        off = 0.0
        p = q = 0
        for i in range(n):
            for j in range(i + 1, n):
                if abs(ata[i][j]) > off:
                    off = abs(ata[i][j])
                    p, q = i, j
        if off < 1e-14:
            break
        app, aqq, apq = ata[p][p], ata[q][q], ata[p][q]
        theta = 0.5 * math.atan2(2 * apq, app - aqq)
        c, s = math.cos(theta), math.sin(theta)
        for k in range(n):
            akp, akq = ata[k][p], ata[k][q]
            ata[k][p] = c * akp + s * akq
            ata[k][q] = -s * akp + c * akq
        for k in range(n):
            apk, aqk = ata[p][k], ata[q][k]
            ata[p][k] = c * apk + s * aqk
            ata[q][k] = -s * apk + c * aqk
        for k in range(n):
            vkp, vkq = v[k][p], v[k][q]
            v[k][p] = c * vkp + s * vkq
            v[k][q] = -s * vkp + c * vkq
    idx = min(range(n), key=lambda i: ata[i][i])
    vec = [v[i][idx] for i in range(n)]
    return [vec[0:3], vec[3:6], vec[6:9]]


def apply_h(h, p):
    x, y = p
    w = h[2][0] * x + h[2][1] * y + h[2][2]
    return ((h[0][0] * x + h[0][1] * y + h[0][2]) / w,
            (h[1][0] * x + h[1][1] * y + h[1][2]) / w)


CANON = [(math.sin(math.radians(60 * k)), -math.cos(math.radians(60 * k))) for k in range(6)]


def best_homography(observed):
    """정육각형 ↔ 관측 육각형의 12가지 대응 중 재투영 오차 최소를 고른다."""
    best = None
    for flip in (False, True):
        base = CANON if not flip else list(reversed(CANON))
        for shift in range(6):
            src = [base[(i + shift) % 6] for i in range(6)]
            h = dlt_homography(src, observed)
            err = 0.0
            for s, d in zip(src, observed):
                px, py = apply_h(h, s)
                err += (px - d[0]) ** 2 + (py - d[1]) ** 2
            rms = math.sqrt(err / 6)
            if best is None or rms < best['rms']:
                best = {'h': h, 'rms': rms, 'shift': shift, 'flip': flip, 'src': src}
    return best


def focal_from_h(h, cx, cy):
    h11, h12 = h[0][0], h[0][1]
    h21, h22 = h[1][0], h[1][1]
    h31, h32 = h[2][0], h[2][1]
    a1x, a1y = h11 - cx * h31, h21 - cy * h31
    a2x, a2y = h12 - cx * h32, h22 - cy * h32
    f_orth = None
    if abs(h31 * h32) > 1e-18:
        val = -(a1x * a2x + a1y * a2y) / (h31 * h32)
        if val > 0:
            f_orth = math.sqrt(val)
    f_norm = None
    denom = h32 * h32 - h31 * h31
    if abs(denom) > 1e-18:
        val = ((a1x * a1x + a1y * a1y) - (a2x * a2x + a2y * a2y)) / denom
        if val > 0:
            f_norm = math.sqrt(val)
    return f_orth, f_norm


def tilt_from_h(h, f, cx, cy):
    g1 = [(h[0][0] - cx * h[2][0]) / f, (h[1][0] - cy * h[2][0]) / f, h[2][0]]
    g2 = [(h[0][1] - cx * h[2][1]) / f, (h[1][1] - cy * h[2][1]) / f, h[2][1]]
    n1 = math.sqrt(sum(v * v for v in g1))
    n2 = math.sqrt(sum(v * v for v in g2))
    r1 = [v / n1 for v in g1]
    r2 = [v / n2 for v in g2]
    r3 = [r1[1] * r2[2] - r1[2] * r2[1],
          r1[2] * r2[0] - r1[0] * r2[2],
          r1[0] * r2[1] - r1[1] * r2[0]]
    norm = math.sqrt(sum(v * v for v in r3))
    r3 = [v / norm for v in r3]
    return math.degrees(math.acos(min(1.0, abs(r3[2])))), r3, math.degrees(
        math.acos(max(-1.0, min(1.0, sum(a * b for a, b in zip(r1, r2))))))


def best_affine(observed):
    """정육각형 → 관측 육각형 최소제곱 아핀 (2×3). 12 대응 중 최적 회전/반사를 고른다.

    왜 아핀도 재는가: 호모그래피 한 장에서 f 를 푸는 Zhang 제약은 이 코퍼스처럼
    원근이 약하고 꼭짓점 잡음이 1~3% 인 입력에서 **극도로 불안정**하다
    (실측: f 추정이 3.8k~48k px 로 12배 흔들리고 두 제약이 146% 어긋난다).
    아핀 축소는 K 를 요구하지 않는다 — 약원근 근사에서 cos θ = σ2/σ1 이다.
    """
    best = None
    for flip in (False, True):
        base = CANON if not flip else list(reversed(CANON))
        for shift in range(6):
            src = [base[(i + shift) % 6] for i in range(6)]
            # [x y 1] · M = [u v]  최소제곱 (정규방정식 3×3)
            sxx = sum(p[0] * p[0] for p in src)
            syy = sum(p[1] * p[1] for p in src)
            sxy = sum(p[0] * p[1] for p in src)
            sx = sum(p[0] for p in src)
            sy = sum(p[1] for p in src)
            n = len(src)
            g = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
            cols = []
            for k in range(2):
                b = [sum(p[0] * d[k] for p, d in zip(src, observed)),
                     sum(p[1] * d[k] for p, d in zip(src, observed)),
                     sum(d[k] for d in observed)]
                cols.append(solve3(g, b))
            a = [[cols[0][0], cols[0][1]], [cols[1][0], cols[1][1]]]
            t = [cols[0][2], cols[1][2]]
            err = 0.0
            for p, d in zip(src, observed):
                u = a[0][0] * p[0] + a[0][1] * p[1] + t[0]
                v = a[1][0] * p[0] + a[1][1] * p[1] + t[1]
                err += (u - d[0]) ** 2 + (v - d[1]) ** 2
            rms = math.sqrt(err / n)
            if best is None or rms < best['rms']:
                best = {'A': a, 't': t, 'rms': rms, 'shift': shift, 'flip': flip}
    return best


def solve3(m, b):
    a = [row[:] + [b[i]] for i, row in enumerate(m)]
    for i in range(3):
        pivot = max(range(i, 3), key=lambda r: abs(a[r][i]))
        a[i], a[pivot] = a[pivot], a[i]
        if abs(a[i][i]) < 1e-15:
            return [0.0, 0.0, 0.0]
        for r in range(3):
            if r == i:
                continue
            f = a[r][i] / a[i][i]
            for c in range(i, 4):
                a[r][c] -= f * a[i][c]
    return [a[i][3] / a[i][i] for i in range(3)]


def singular_values_2x2(a):
    m = [[a[0][0] * a[0][0] + a[1][0] * a[1][0], a[0][0] * a[0][1] + a[1][0] * a[1][1]],
         [a[0][0] * a[0][1] + a[1][0] * a[1][1], a[0][1] * a[0][1] + a[1][1] * a[1][1]]]
    tr = m[0][0] + m[1][1]
    det = m[0][0] * m[1][1] - m[0][1] * m[1][0]
    disc = max(0.0, tr * tr / 4 - det)
    l1 = tr / 2 + math.sqrt(disc)
    l2 = max(0.0, tr / 2 - math.sqrt(disc))
    return math.sqrt(l1), math.sqrt(l2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('locate_json')
    ap.add_argument('--width', type=float, default=None)
    ap.add_argument('--height', type=float, default=None)
    ap.add_argument('--label', default='')
    args = ap.parse_args()

    d = json.load(open(args.locate_json, encoding='utf-8'))
    verts = [tuple(p) for p in d['hexVertices']]
    w = args.width or d['size'][0]
    h_img = args.height or d['size'][1]
    cx, cy = w / 2.0, h_img / 2.0

    fit = best_homography(verts)
    aff = best_affine(verts)
    s1, s2 = singular_values_2x2(aff['A'])
    f_orth, f_norm = focal_from_h(fit['h'], cx, cy)
    out = {
        'label': args.label or d.get('photo'),
        'imageSize': [w, h_img],
        'hexFitRmsPx': fit['rms'],
        'affineRmsPx': aff['rms'],
        'perspectiveResidualPx': aff['rms'] - fit['rms'],
        'symbolCircumradiusPx': s1,
        'foreshortenRatio': (s2 / s1) if s1 > 0 else None,
        'tiltAffineDeg': math.degrees(math.acos(max(-1.0, min(1.0, s2 / s1)))) if s1 > 0 else None,
        'focalOrthogonalPx': f_orth,
        'focalEqualNormPx': f_norm,
    }
    fs = [f for f in (f_orth, f_norm) if f]
    if fs:
        f = sum(fs) / len(fs)
        out['focalUsedPx'] = f
        out['focalDisagreementPct'] = (abs(f_orth - f_norm) / f * 100) if (f_orth and f_norm) else None
        out['hfovDeg'] = 2 * math.degrees(math.atan(max(w, h_img) / (2 * f)))
        tilt, normal, ortho_err = tilt_from_h(fit['h'], f, cx, cy)
        out['tiltDeg'] = tilt
        out['planeNormalCam'] = normal
        out['basisAngleDeg'] = ortho_err
        # 두 f 각각으로도 계산해 민감도를 보인다
        out['tiltDegFromOrthogonal'] = tilt_from_h(fit['h'], f_orth, cx, cy)[0] if f_orth else None
        out['tiltDegFromEqualNorm'] = tilt_from_h(fit['h'], f_norm, cx, cy)[0] if f_norm else None
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    raise SystemExit(main())
