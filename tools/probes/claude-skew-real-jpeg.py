"""claude-skew-real-jpeg.py — 실사진 JPEG → raw RGBA 프레임 (진단 전용, src 무수정).

왜 있나: Node 에 JPEG 디코더가 없다. photo-probe.html(브라우저) 경로를 쓸 수 없는
헤드리스 레인에서 **실사진 픽셀**을 앞단에 먹이기 위한 다리다. 휘도 변환은 하지
않는다 — 그건 Node 측에서 `src/decoder/luma.js` 의 `toRelativeLuminance` 가
그대로 한다(브라우저와 같은 함수).

출력 형식(리틀엔디언): magic "TLRG" · u32 width · u32 height · u8[w*h*4] RGBA.

모드 (sites/tlscan/scanner.js 의 프레임 경로를 그대로 옮긴 것):
  live<N>   : imageDataCenterSquare — 중앙 정사각 크롭 후 N 으로 축소 (라이브 경로)
  whole     : imageDataWhole — 크롭 없음, 짧은변 ≤ 1440 · 총픽셀 ≤ 1440*3200
  whole<N>  : imageDataWhole 변형, 짧은변 상한만 N 으로 바꾼 것 (다중 스케일용)
  box<N>@x,y,s : 임의 정사각 크롭 (원본 좌표계, 한 변 s) 후 N 으로 축소

리샘플: 기본 BOX(area-average) — 큰 축소에서 Skia 의 mip+bilinear 와 가장 가깝다.
`--filter bilinear` 로 대조 가능. 결정적(난수 없음).
"""

import argparse
import os
import struct
import sys

from PIL import Image

FILTERS = {
    "box": Image.BOX,
    "bilinear": Image.BILINEAR,
    "lanczos": Image.LANCZOS,
    "nearest": Image.NEAREST,
}

PHOTO_MAX_PIXELS = 1440 * 3200
PHOTO_MAX_SHORT_SIDE = 1440


def center_square(im, max_side):
    w, h = im.size
    side = min(w, h)
    x = (w - side) / 2.0
    y = (h - side) / 2.0
    target = max(1, min(max_side, round(side)))
    return (x, y, side), target


def whole(im, max_short_side, max_pixels):
    w, h = im.size
    short_scale = min(1.0, max_short_side / min(w, h))
    area_scale = min(1.0, (max_pixels / (w * h)) ** 0.5)
    scale = min(short_scale, area_scale)
    return max(1, round(w * scale)), max(1, round(h * scale))


def emit(im, out_path):
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    w, h = im.size
    data = im.tobytes()
    assert len(data) == w * h * 4, (len(data), w, h)
    with open(out_path, "wb") as fh:
        fh.write(b"TLRG")
        fh.write(struct.pack("<II", w, h))
        fh.write(data)
    return w, h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("out")
    ap.add_argument("mode")
    ap.add_argument("--filter", default="box", choices=sorted(FILTERS))
    args = ap.parse_args()

    resample = FILTERS[args.filter]
    im = Image.open(args.source)
    im = im.convert("RGB")
    mode = args.mode

    if mode.startswith("live"):
        side_cap = int(mode[4:])
        (x, y, side), target = center_square(im, side_cap)
        out = im.resize((target, target), resample, box=(x, y, x + side, y + side))
    elif mode.startswith("box"):
        head, rest = mode[3:].split("@", 1)
        target = int(head)
        cx, cy, s = (float(v) for v in rest.split(","))
        # 프레임 밖으로 나가는 창은 **먼저 밀고, 그래도 넘치면 줄인다** — PIL 은 box 가
        # 이미지를 넘으면 던진다 (p03 의 1.5× 창이 세로를 118px 넘겨 스윕이 죽었다).
        w0, h0 = im.size
        s = min(s, w0, h0)
        cx = min(max(0.0, cx), w0 - s)
        cy = min(max(0.0, cy), h0 - s)
        out = im.resize((target, target), resample, box=(cx, cy, cx + s, cy + s))
    elif mode.startswith("whole"):
        cap = int(mode[5:]) if len(mode) > 5 else PHOTO_MAX_SHORT_SIDE
        # 총픽셀 상한은 라이브 계약 그대로 두되, cap 이 1440 보다 크면 상한도 비례로 푼다
        # (다중 스케일 진단용 — 원 계약 값은 whole 또는 whole1440 이다).
        max_pixels = PHOTO_MAX_PIXELS if cap <= PHOTO_MAX_SHORT_SIDE else PHOTO_MAX_PIXELS * (cap / PHOTO_MAX_SHORT_SIDE) ** 2
        tw, th = whole(im, cap, max_pixels)
        out = im.resize((tw, th), resample)
    else:
        print(f"unknown mode: {mode}", file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    w, h = emit(out, args.out)
    print(f"{args.out} {w}x{h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
