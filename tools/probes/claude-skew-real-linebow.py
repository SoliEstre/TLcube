r"""claude-skew-real-linebow.py — 사진 속 **물리적 직선**의 굴곡(bow)을 재서 배럴 왜곡을
정량한다. 진단 전용 · src 무수정 · 결정적(난수 없음).

원리(plumb-line): 실세계 직선은 왜곡 없는 사영 카메라에서 **직선으로** 맺힌다.
곡선으로 맺히면 그 굴곡이 렌즈 왜곡이다. 굴곡을 현(chord) 길이로 정규화하면
(sagitta / chord) 초점거리·거리·자세와 무관한 무차원 왜곡 지표가 된다.

측정 대상은 이 코퍼스에서 가장 긴 물리적 직선 — **모니터 화면의 경계(베젤 모서리)** 다.
두 끝점만 사람이 준다(사진을 보고 고른 값 · 디코더와 무관). 나머지는 자동:
  · 현을 따라 N 지점에서 **수직으로** ±S px 프로파일을 뽑고
  · 평활 1차 미분의 **지배 부호 쪽 최대점**을 포물선 보간으로 서브픽셀 위치화
  · 그 점들에 총최소제곱 직선을 맞추고 잔차를 본다.
보고: chordLenPx · sagittaPx(2차 적합 최대 편차) · bowPct = 100·sagitta/chord ·
      rmsDevPx · 중심에서 선까지 평균 거리(왜곡은 반경에 따라 커지므로 함께 읽는다).

사용:
  python tools/probes/claude-skew-real-linebow.py <jpg> --p0 x,y --p1 x,y \
      [--search 60] [--samples 120] [--json out.json] [--debug out.png]
"""

import argparse
import json
import math
import os

import numpy as np
from PIL import Image


def sample_bilinear(gray, xs, ys):
    h, w = gray.shape
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 2)
    fx = np.clip(xs - x0, 0.0, 1.0)
    fy = np.clip(ys - y0, 0.0, 1.0)
    a = gray[y0, x0]
    b = gray[y0, x0 + 1]
    c = gray[y0 + 1, x0]
    d = gray[y0 + 1, x0 + 1]
    return (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy)
            + c * (1 - fx) * fy + d * fx * fy)


def smooth(profile, sigma):
    radius = max(1, int(round(3 * sigma)))
    k = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    k /= k.sum()
    return np.convolve(profile, k, mode='same')


def trace(gray, p0, p1, search, samples, sigma):
    p0 = np.array(p0, dtype=float)
    p1 = np.array(p1, dtype=float)
    d = p1 - p0
    length = float(np.hypot(*d))
    u = d / length
    n = np.array([-u[1], u[0]])
    ts = np.linspace(0.06, 0.94, samples)
    offsets = np.arange(-search, search + 1, 1.0)

    # 1차 통과 — 각 표본의 지배 부호를 정하기 위해 전체 부호 합을 본다.
    grads = []
    for t in ts:
        base = p0 + d * t
        xs = base[0] + n[0] * offsets
        ys = base[1] + n[1] * offsets
        prof = smooth(sample_bilinear(gray, xs, ys), sigma)
        grads.append(np.gradient(prof))
    grads = np.array(grads)
    mid = grads.shape[1] // 2
    window = slice(max(0, mid - int(search * 0.6)), min(grads.shape[1], mid + int(search * 0.6) + 1))
    sign = 1.0 if np.abs(grads[:, window].max(axis=1)).sum() >= np.abs(grads[:, window].min(axis=1)).sum() else -1.0

    devs = []
    kept = []
    for i, t in enumerate(ts):
        g = sign * grads[i]
        j = int(np.argmax(g))
        if j <= 0 or j >= len(g) - 1:
            continue
        y0v, y1v, y2v = g[j - 1], g[j], g[j + 1]
        denom = (y0v - 2 * y1v + y2v)
        delta = 0.0 if abs(denom) < 1e-12 else 0.5 * (y0v - y2v) / denom
        off = offsets[j] + delta
        devs.append(off)
        kept.append(t)
    ts = np.array(kept)
    devs = np.array(devs)
    return p0, d, u, n, length, ts, devs, sign


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('--p0', required=True)
    ap.add_argument('--p1', required=True)
    ap.add_argument('--search', type=float, default=60.0)
    ap.add_argument('--samples', type=int, default=120)
    ap.add_argument('--sigma', type=float, default=2.0)
    ap.add_argument('--iters', type=int, default=6)
    ap.add_argument('--final-search', type=float, default=30.0,
                    help='재중심화 뒤 마지막 추적의 탐색 반경 — 이 값을 작게 두어야 '
                         '다른 모서리로 건너뛰지 않는다 (실측: 220 로 두면 표본 수에 '
                         '따라 sagitta 가 1.2 ↔ 48.8 로 흔들렸다)')
    ap.add_argument('--label', default='')
    ap.add_argument('--json', default=None)
    ap.add_argument('--debug', default=None)
    args = ap.parse_args()

    p0 = [float(v) for v in args.p0.split(',')]
    p1 = [float(v) for v in args.p1.split(',')]
    im = Image.open(args.source).convert('RGB')
    rgb = np.asarray(im, dtype=np.float64)
    gray = rgb @ np.array([0.2126, 0.7152, 0.0722])

    # 반복 재중심화 — 첫 현이 실제 모서리에서 멀면 탐색창이 다른 모서리를 문다.
    # 매 회 (a) 추적 → (b) 강건 직선 적합(MAD 3배 이상 이탈 제거) → (c) 그 직선을 새 현으로.
    search = args.search
    for it in range(args.iters):
        base, d, u, n, length, ts, devs, sign = trace(gray, p0, p1, search, args.samples, args.sigma)
        if len(ts) < 20:
            break
        a1, b1 = np.polyfit(ts * length, devs, 1)
        r = devs - (a1 * ts * length + b1)
        mad = np.median(np.abs(r - np.median(r))) + 1e-9
        keep = np.abs(r - np.median(r)) <= 3.0 * 1.4826 * mad
        if keep.sum() >= 20:
            a1, b1 = np.polyfit((ts * length)[keep], devs[keep], 1)
        new0 = base + n * (a1 * 0.0 + b1)
        new1 = base + d + n * (a1 * length + b1)
        p0, p1 = list(new0), list(new1)
        search = max(args.final_search, search * 0.5)

    search = args.final_search
    base, d, u, n, length, ts, devs, sign = trace(gray, p0, p1, search, args.samples, args.sigma)
    if len(ts) >= 20:
        a1, b1 = np.polyfit(ts * length, devs, 1)
        r = devs - (a1 * ts * length + b1)
        mad = np.median(np.abs(r - np.median(r))) + 1e-9
        keep = np.abs(r - np.median(r)) <= 3.0 * 1.4826 * mad
        if keep.sum() >= 20:
            ts, devs = ts[keep], devs[keep]
    if len(ts) < 20:
        print(json.dumps({'error': 'too-few-traced-points', 'kept': int(len(ts))}))
        return 1

    s = ts * length                      # 현 위 호장
    # 1차(직선) 성분 제거 = 총최소제곱 직선 적합 후 잔차
    a1, b1 = np.polyfit(s, devs, 1)
    resid = devs - (a1 * s + b1)
    # 2차 적합 — sagitta 는 «2차 성분이 만드는 최대 편차»
    c2, c1, c0 = np.polyfit(s, devs, 2)
    fit2 = c2 * s ** 2 + c1 * s + c0
    line2 = np.polyval(np.polyfit(s, fit2, 1), s)
    sagitta = float(np.max(np.abs(fit2 - line2)))
    bow_sign = float(np.sign(c2))

    pts = np.array([base + d * t + n * dv for t, dv in zip(ts, devs)])
    h, w = gray.shape
    center = np.array([w / 2.0, h / 2.0])
    radial = float(np.mean(np.hypot(pts[:, 0] - center[0], pts[:, 1] - center[1])))

    out = {
        'label': args.label or os.path.basename(args.source),
        'photo': args.source,
        'imageSize': [w, h],
        'endpoints': [p0, p1],
        'tracedPoints': int(len(ts)),
        'chordLenPx': float(length * (ts[-1] - ts[0])),
        'sagittaPx': sagitta,
        'bowPct': 100.0 * sagitta / float(length * (ts[-1] - ts[0])),
        'bowSign': bow_sign,
        'residRmsPx': float(np.sqrt(np.mean(resid ** 2))),
        'residMaxPx': float(np.max(np.abs(resid))),
        'meanRadiusPx': radial,
        'meanRadiusFrac': radial / float(math.hypot(w, h) / 2.0),
        'edgePolaritySign': sign,
        'quadCoefPerPx': float(c2),
        'search': args.search,
        'searchFinal': search,
        'iters': args.iters,
        'endpointsRefined': [list(p0), list(p1)],
        'samples': args.samples,
        'sigma': args.sigma,
    }
    text = json.dumps(out, indent=1)
    if args.json:
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        with open(args.json, 'w', encoding='utf-8') as fh:
            fh.write(text)
    print(text)

    if args.debug:
        from PIL import ImageDraw
        dbg = im.copy()
        draw = ImageDraw.Draw(dbg)
        draw.line([tuple(p0), tuple(p1)], fill=(255, 0, 0), width=4)
        for p in pts:
            draw.ellipse([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], fill=(0, 255, 0))
        dbg.thumbnail((900, 900), Image.LANCZOS)
        dbg.save(args.debug)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
