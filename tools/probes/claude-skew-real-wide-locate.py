r"""claude-skew-real-wide-locate.py — 초광각 3장에서 TL큐브를 국소화한다.

`claude-skew-real-locate.py` **를 고치지 않고** 두 겹을 앞에 붙인 드라이버다:

 1. `claude-skew-real-huemask.py` — 「어둡고 유채색」 픽셀 중 큐브 색상(청보라)
    밖을 지운다. 초광각은 화각이 넓어 책상 위 유채색 물체가 대량으로 들어온다.
 2. **ROI 사전 크롭** — 그래도 남는 방해물(RGB 데스크 조명 = hue 240\~260° 로 큐브와
    같은 창 안에 있다)이 큐브보다 큰 성분을 만든다. w00·w02 에서 실제로 그랬다
    (오버레이 확인). ROI 는 **사진을 보고** 고른 창이며 **디코더 산출과 무관**하다
    (디코더로 창을 정하면 «크롭이 검출을 돕나» 가 순환한다).

계측기 스케일을 표준 6장과 맞춘다: 표준 세트는 `--work 1200` 을 4000 px 프레임에
걸었으므로 작업 배율이 **0.30**이다. ROI 는 프레임보다 작으므로 `--work` 를
`round(0.30 × ROI 최대변)` 으로 낮춰 **원본 픽셀 기준 작업 배율을 같게** 만든다.
(`--work-scale` 로 바꿀 수 있다. 감도 확인용.)

산출 좌표는 전부 **원본 프레임 좌표로 되돌린다** (순수 평행이동이라 θ·면비는 불변).

사용:
  python tools/probes/claude-skew-real-wide-locate.py w01 --json <out.json> [--debug <png>]
"""

import argparse
import json
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WIDE_DIR = os.path.join(ROOT, 'test', 'output', 'photos', 'skew-wide-20260816')
MASK_DIR = os.path.join(WIDE_DIR, '_masked')

# 초광각 코퍼스. roi = 원본 좌표 (x0, y0, x1, y1) — 눈으로 고른 창(디코더 독립).
# parity = 심 대비 자동판정을 강제할 때만 채운다.
WIDE = {
    'w00': {'file': 'KakaoTalk_20260816_133329976.jpg', 'roi': (800, 1600, 1780, 2620), 'parity': None},
    'w01': {'file': 'KakaoTalk_20260816_133329976_01.jpg', 'roi': (1240, 1010, 2150, 2350), 'parity': None},
    'w02': {'file': 'KakaoTalk_20260816_133329976_02.jpg', 'roi': (760, 1120, 2160, 2440), 'parity': None},
}


def shift_points(obj, dx, dy):
    if isinstance(obj, list) and len(obj) == 2 and all(isinstance(v, (int, float)) for v in obj):
        return [obj[0] + dx, obj[1] + dy]
    if isinstance(obj, list):
        return [shift_points(v, dx, dy) for v in obj]
    return obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo', choices=sorted(WIDE))
    ap.add_argument('--json', required=True)
    ap.add_argument('--debug', default=None)
    ap.add_argument('--work-scale', type=float, default=0.30)
    ap.add_argument('--parity', type=int, default=None)
    ap.add_argument('--no-mask', action='store_true')
    args = ap.parse_args()

    spec = WIDE[args.photo]
    src = os.path.join(WIDE_DIR, spec['file'])
    os.makedirs(MASK_DIR, exist_ok=True)
    masked = os.path.join(MASK_DIR, f'{args.photo}.png')
    if not args.no_mask:
        if not os.path.exists(masked):
            subprocess.run([sys.executable, os.path.join(HERE, 'claude-skew-real-huemask.py'),
                            src, masked], check=True, stdout=subprocess.DEVNULL)
        base = masked
    else:
        base = src

    x0, y0, x1, y1 = spec['roi']
    im = Image.open(base).convert('RGB')
    full_size = list(im.size)
    roi = im.crop((x0, y0, x1, y1))
    roi_path = os.path.join(MASK_DIR, f'{args.photo}.roi.png')
    roi.save(roi_path)
    work = max(60, round(args.work_scale * max(roi.size)))

    cmd = [sys.executable, os.path.join(HERE, 'claude-skew-real-locate.py'), roi_path,
           '--work', str(work), '--json', roi_path + '.json']
    parity = args.parity if args.parity is not None else spec['parity']
    if parity is not None:
        cmd += ['--parity', str(parity)]
    if args.debug:
        cmd += ['--debug', args.debug]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not os.path.exists(roi_path + '.json'):
        print(proc.stdout[-2000:] or proc.stderr[-2000:], file=sys.stderr)
        return 1

    d = json.load(open(roi_path + '.json', encoding='utf-8'))
    d['photo'] = src
    d['roi'] = [x0, y0, x1, y1]
    d['roiSize'] = list(roi.size)
    d['workWidth'] = work
    d['workScaleOnOriginal'] = args.work_scale
    d['masked'] = not args.no_mask
    # ROI → 원본 좌표 (평행이동만)
    d['bbox'] = [d['bbox'][0] + x0, d['bbox'][1] + y0, d['bbox'][2] + x0, d['bbox'][3] + y0]
    d['hexVertices'] = [[p[0] + x0, p[1] + y0] for p in d['hexVertices']]
    if d.get('nearCorner'):
        d['nearCorner']['N'] = [d['nearCorner']['N'][0] + x0, d['nearCorner']['N'][1] + y0]
    for stats in (d.get('faceStats') or {}).values():
        stats['centroid'] = [stats['centroid'][0] + x0, stats['centroid'][1] + y0]
        stats['quad'] = shift_points(stats['quad'], x0, y0)
    # tilt.py 는 size 로 주점을 잡는다 — 원본 프레임 크기를 쓴다 (아핀 θ 에는 무영향).
    d['sizeRoi'] = d['size']
    d['size'] = full_size

    with open(args.json, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, indent=1)
    print(json.dumps({k: d[k] for k in ('photo', 'roi', 'workWidth', 'bbox', 'faceOrder')
                      if k in d}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
