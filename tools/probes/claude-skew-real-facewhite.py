r"""claude-skew-real-facewhite.py — 면별 휘도를 **국소 흰 배경으로 정규화**한다.

왜 필요한가: §2.2 의 면 median 비 R/T 는 «면 게인 × 국소 조도» 다. 화면을 크게
비스듬히 찍으면 시야각 감쇠·글레어로 국소 조도가 면마다 다르고, 그러면 설계 게인
(T 1.0 · L 0.72 · R 0.52)이 살아 있어도 비가 어긋난다 — w00 에서 L/T 0.458 ·
R/T 0.554 로 **L 과 R 의 순서가 뒤집혀** 보였다.

정규화: 각 면의 바깥쪽(육각 중심 → 면 중심 방향으로 반경의 1.25배 지점)에 있는
**흰 카드**를 원판 표본으로 재서 그 면의 국소 백색점 W_k 로 삼고, median_k / W_k 를
본다. 카드는 게인이 걸리지 않은 흰색이므로 W_k 는 국소 조도의 대리값이다.

한계(명기): 카드가 좁거나(타이트 크롭) 큐브에 가려지면 표본이 배경·그림자를 물 수
있다. 표본 원판의 p90 을 쓰고 표본 수를 함께 낸다 — 수가 작으면 믿지 않는다.

사용: python tools/probes/claude-skew-real-facewhite.py <loc.json> [--json out.json]
"""

import argparse
import json
import math
import os

from PIL import Image

LUT = [((c / 255.0) / 12.92 if (c / 255.0) <= 0.04045 else (((c / 255.0) + 0.055) / 1.055) ** 2.4)
       for c in range(256)]


def rel_luma(r, g, b):
    return 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('locate_json')
    ap.add_argument('--json', default=None)
    ap.add_argument('--reach', type=float, default=1.25, help='육각 반경 대비 표본 중심 거리')
    ap.add_argument('--disc', type=float, default=0.12, help='육각 반경 대비 표본 원판 반경')
    args = ap.parse_args()

    d = json.load(open(args.locate_json, encoding='utf-8'))
    im = Image.open(d['photo']).convert('RGB')
    px = im.load()
    W, H = im.size
    hexv = d['hexVertices']
    cx = sum(p[0] for p in hexv) / 6.0
    cy = sum(p[1] for p in hexv) / 6.0
    radius = max(math.hypot(p[0] - cx, p[1] - cy) for p in hexv)

    out = {'photo': d['photo'], 'center': [cx, cy], 'radiusPx': radius, 'faces': {}}
    for name, stats in d['faceStats'].items():
        fx, fy = stats['centroid']
        vx, vy = fx - cx, fy - cy
        norm = math.hypot(vx, vy) or 1.0
        sx = cx + vx / norm * radius * args.reach
        sy = cy + vy / norm * radius * args.reach
        rad = radius * args.disc
        vals = []
        step = max(1, int(rad / 25))
        for y in range(int(sy - rad), int(sy + rad) + 1, step):
            for x in range(int(sx - rad), int(sx + rad) + 1, step):
                if 0 <= x < W and 0 <= y < H and (x - sx) ** 2 + (y - sy) ** 2 <= rad * rad:
                    r, g, b = px[x, y]
                    vals.append(rel_luma(r, g, b))
        vals.sort()
        white = vals[int(0.90 * (len(vals) - 1))] if vals else None
        out['faces'][name] = {
            'median': stats['median'],
            'span_p10_p90': stats['span_p10_p90'],
            'sampleCenter': [sx, sy],
            'localWhiteP90': white,
            'localWhiteN': len(vals),
            'normalizedMedian': (stats['median'] / white) if white else None,
            'normalizedSpan': (stats['span_p10_p90'] / white) if white else None,
        }
    f = out['faces']
    if all(f[k].get('normalizedMedian') for k in ('T', 'L', 'R')):
        out['normalizedRatios'] = {
            'L/T': f['L']['normalizedMedian'] / f['T']['normalizedMedian'],
            'R/T': f['R']['normalizedMedian'] / f['T']['normalizedMedian'],
        }
        out['rawRatios'] = {'L/T': f['L']['median'] / f['T']['median'],
                            'R/T': f['R']['median'] / f['T']['median']}
    text = json.dumps(out, indent=1)
    if args.json:
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        with open(args.json, 'w', encoding='utf-8') as fh:
            fh.write(text)
    print(text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
