r"""claude-skew-real-huemask.py — 「어둡고 유채색」 픽셀 중 **큐브 색상(청보라) 밖**을
중성 회색으로 지워, `claude-skew-real-locate.py` 가 큐브 아닌 성분을 최대 성분으로
집어가는 것을 막는다. 진단 전용 · src 무수정 · 결정적(난수 없음).

왜 필요한가 (실측): 초광각 3장은 표준 렌즈 6장과 같은 화면을 찍었지만 화각이 넓어
**책상 위 물체가 대량으로 들어온다**. w02 에서 민트색 마우스패드(어두운 30% · chroma
16 · hue 170°)가 큐브보다 큰 «어둡고 유채색» 성분이 되어 locate.py 의 최대 성분
규칙을 가로챘다 (bbox 가 화면 밖 책상으로 잡힘 — 디버그 오버레이로 눈 확인).

판별자는 실측이다 (w02, 어두운 30% 픽셀 · chroma ≥ 12):
  TL큐브 hue 중앙값 **241.9°** (p10 236.0 · p90 249.5) · 마우스패드 **169.7°**.
기본 창 [200°, 290°] 는 큐브 p10\~p90 의 양쪽으로 36°/40° 여유가 있다.

**마스크는 큐브 픽셀을 건드리지 않는다** — 그래서 표준 6장에 걸어 locate.py 산출이
원본과 같은지 확인할 수 있다 (대조군 · §7 참조).

사용:
  python tools/probes/claude-skew-real-huemask.py <src.jpg> <out.png> [--lo 200] [--hi 290]
"""

import argparse
import os

import numpy as np
from PIL import Image

FILL = 200


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('out')
    ap.add_argument('--lo', type=float, default=200.0)
    ap.add_argument('--hi', type=float, default=290.0)
    ap.add_argument('--chroma', type=int, default=12)
    ap.add_argument('--dark-quantile', type=float, default=0.30,
                    help='locate.py 와 같은 어두움 컷 정의 (평균채널 하위 q, 기본 0.30)')
    args = ap.parse_args()

    im = Image.open(args.source).convert('RGB')
    rgb = np.asarray(im, dtype=np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    chroma = mx - mn
    lum = rgb.sum(axis=2) / 3.0

    dark_cut = float(np.quantile(lum, args.dark_quantile))

    # hue (도) — colorsys.rgb_to_hsv 와 같은 식, 벡터화만 다르다.
    c = np.where(chroma == 0, 1, chroma).astype(np.float64)
    hue = np.zeros(lum.shape, dtype=np.float64)
    is_r = (mx == r)
    is_g = (~is_r) & (mx == g)
    is_b = (~is_r) & (~is_g)
    hue[is_r] = ((g - b)[is_r] / c[is_r]) % 6.0
    hue[is_g] = ((b - r)[is_g] / c[is_g]) + 2.0
    hue[is_b] = ((r - g)[is_b] / c[is_b]) + 4.0
    hue = (hue * 60.0) % 360.0

    if args.lo <= args.hi:
        in_window = (hue >= args.lo) & (hue <= args.hi)
    else:
        in_window = (hue >= args.lo) | (hue <= args.hi)

    wipe = (lum <= dark_cut) & (chroma >= args.chroma) & (~in_window)
    out = np.asarray(im, dtype=np.uint8).copy()
    out[wipe] = FILL

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    Image.fromarray(out).save(args.out)
    n = int(wipe.sum())
    print(f'{args.out} {im.size[0]}x{im.size[1]} darkCut={dark_cut:.2f} '
          f'wiped={n} ({100.0 * n / wipe.size:.2f}%)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
