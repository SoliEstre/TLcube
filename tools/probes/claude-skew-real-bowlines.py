r"""claude-skew-real-bowlines.py — §7.4 배럴 왜곡 대조에 쓴 **직선 목록**을 한 번에
돌려 하나의 JSON 으로 아카이브한다. 진단 전용 · src 무수정 · 결정적.

선은 «모니터 화면 경계(베젤 모서리)» 다. 끝점 두 개는 사진을 보고 골랐고
(디코더 무관), 추적·적합은 `claude-skew-real-linebow.py` 가 전부 자동으로 한다.
채택하지 않은 선(w01)도 rms 와 함께 남긴다 — 실패한 측정도 기록이다.

사용: python tools/probes/claude-skew-real-bowlines.py --json <out.json> [--debug-dir <dir>]
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
STD = os.path.join(ROOT, 'test', 'output', 'photos', 'skew-20260816')
WIDE = os.path.join(ROOT, 'test', 'output', 'photos', 'skew-wide-20260816')

LINES = [
    # (label, lens, file, p0, p1, search, accepted)
    ('p00_bottom', 'std', os.path.join(STD, 'KakaoTalk_20260816_110225527.jpg'),
     '60,2820', '2940,2925', 100, True),
    ('p00_bottom_short', 'std', os.path.join(STD, 'KakaoTalk_20260816_110225527.jpg'),
     '200,2830', '2800,2920', 60, True),
    ('p04_top', 'std', os.path.join(STD, 'KakaoTalk_20260816_110225527_04.jpg'),
     '60,385', '2940,370', 160, True),
    ('p05_bottom', 'std', os.path.join(STD, 'KakaoTalk_20260816_110225527_05.jpg'),
     '60,3620', '2940,3600', 160, True),
    ('w00_bottom', 'wide', os.path.join(WIDE, 'KakaoTalk_20260816_133329976.jpg'),
     '60,2500', '1600,3110', 160, True),
    ('w01_right', 'wide', os.path.join(WIDE, 'KakaoTalk_20260816_133329976_01.jpg'),
     '2380,300', '2060,3630', 120, False),      # 케이블 가림 — rms 15 px, 미채택
    ('w02_bottom', 'wide', os.path.join(WIDE, 'KakaoTalk_20260816_133329976_02.jpg'),
     '60,2720', '2940,2660', 220, True),
]

SAMPLES = 160


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', required=True)
    ap.add_argument('--debug-dir', default=None)
    args = ap.parse_args()
    rows = []
    for label, lens, path, p0, p1, search, accepted in LINES:
        cmd = [sys.executable, os.path.join(HERE, 'claude-skew-real-linebow.py'), path,
               '--p0', p0, '--p1', p1, '--search', str(search), '--samples', str(SAMPLES),
               '--label', label]
        if args.debug_dir:
            os.makedirs(args.debug_dir, exist_ok=True)
            cmd += ['--debug', os.path.join(args.debug_dir, label + '.png')]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        try:
            res = json.loads(proc.stdout)
        except Exception:
            res = {'label': label, 'error': 'linebow-failed', 'stderr': proc.stderr[-300:]}
        res['lens'] = lens
        res['accepted'] = accepted
        rows.append(res)
        if 'bowPct' in res:
            print(f"{label:20s} {lens:5s} chord {res['chordLenPx']:8.1f}  sagitta {res['sagittaPx']:6.2f}"
                  f"  bow {res['bowPct']:.4f}%  rms {res['residRmsPx']:5.2f}"
                  f"  r/rmax {res['meanRadiusFrac']:.3f}  n={res['tracedPoints']}"
                  f"  {'채택' if accepted else '미채택'}")
        else:
            print(f'{label:20s} {res}')
    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, 'w', encoding='utf-8') as fh:
        json.dump(rows, fh, indent=1)
    print(f'\n{len(rows)} lines → {args.json}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
