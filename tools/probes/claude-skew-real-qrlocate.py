r"""claude-skew-real-qrlocate.py — 사진에서 **QR 영역**을 독립적으로 찾고, 큐브가 한
픽셀도 들어가지 않는 **QR-only 창**을 계산한다 (§8 실증용). 진단 전용 · src 무수정.

판별자는 §자 검증 1 의 실측을 뒤집어 쓴다: 어두운 픽셀의 chroma 중앙값이
TL큐브 **20** · QR **6** · 배경 **5** 이므로, «어둡고 **무채색**» 성분이 QR 이다.
큐브 bbox(= `claude-skew-real-loc_*.json` 의 육각 bbox)와 겹치는 성분은 버린다.

창 계산: QR bbox 를 margin 배 확대한 정사각 창을 만들되, **큐브 육각 꼭짓점 6개가
전부 창 밖**이 되도록 큐브 반대 방향으로 줄인다. 조건을 만족 못 하면 `usable: false`
로 남기고 창을 만들지 않는다 (억지로 만들지 않는다).

산출: {photo, qrBbox, cubeBbox, window:{cx,cy,side}, usable, cubeInsideVertices}
사용: python tools/probes/claude-skew-real-qrlocate.py <jpg> --locate <loc.json> --json <out>
"""

import argparse
import json
import os
from collections import deque

from PIL import Image


def components(im, work_width=900, chroma_max=10, dark_q=0.35, min_cells=60):
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
    cut = sorted(lum)[int(dark_q * (len(lum) - 1))]
    mask = bytearray(w * h)
    for i in range(w * h):
        if lum[i] <= cut and chroma[i] <= chroma_max:
            mask[i] = 1
    # 닫힘 2회 — QR 의 흰 모듈이 뚫은 구멍을 메워 한 덩어리로 만든다
    for _ in range(3):
        grown = bytearray(mask)
        for y in range(h):
            for x in range(w):
                if mask[y * w + x]:
                    continue
                hits = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and mask[ny * w + nx]:
                            hits += 1
                if hits >= 3:
                    grown[y * w + x] = 1
        mask = grown
    out = []
    seen = bytearray(w * h)
    for start in range(w * h):
        if mask[start] == 0 or seen[start]:
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
                    if mask[nidx] and not seen[nidx]:
                        seen[nidx] = 1
                        queue.append(nidx)
        if len(cells) < min_cells:
            continue
        xs = [c % w for c in cells]
        ys = [c // w for c in cells]
        # 프레임 가장자리에 닿는 성분은 QR 이 아니다 (책상 밑 어두운 무채색 덩어리가
        # QR 보다 크다 — p00·p01·p04·p05 에서 실제로 가로챘다). QR 은 화면 안에 있다.
        if min(xs) <= 1 or min(ys) <= 1 or max(xs) >= w - 2 or max(ys) >= h - 2:
            continue
        bw = max(xs) - min(xs) + 1
        bh = max(ys) - min(ys) + 1
        aspect = bw / bh
        if not (0.65 <= aspect <= 1.55):          # QR 은 정사각
            continue
        if max(bw, bh) > 0.45 * max(w, h):        # 화면만큼 큰 덩어리는 QR 이 아니다
            continue
        out.append({'n': len(cells), 'bbox': [min(xs), min(ys), max(xs), max(ys)]})
    inv = 1.0 / scale
    for c in out:
        c['bboxFull'] = [v * inv for v in c['bbox']]
    return out


def overlaps(a, b, pad=0.0):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('--locate', required=True, help='claude-skew-real-loc_*.json (큐브 참값)')
    ap.add_argument('--json', default=None)
    ap.add_argument('--margin', type=float, default=1.9, help='QR bbox 대비 창 배율')
    ap.add_argument('--gap', type=float, default=20.0, help='큐브에서 띄울 최소 여유(px)')
    args = ap.parse_args()

    im = Image.open(args.source).convert('RGB')
    loc = json.load(open(args.locate, encoding='utf-8'))
    cube = loc['bbox']
    hexv = loc['hexVertices']

    w0, h0 = im.size
    comps = components(im)
    cands = [c for c in comps if not overlaps(c['bboxFull'], cube, pad=args.gap)]
    cands.sort(key=lambda c: -c['n'])

    # **큐브 없는 최대 사각형** 4개 (큐브 bbox 의 위/아래/왼/오). 창을 QR bbox 에
    # 맞춰 억지로 줄이지 않는다 — 프레임 맥락을 그대로 두는 편이 실험으로 더 깨끗하다
    # (§4.4 의 좁은 창은 «QR 만» 인 동시에 «맥락도 없는» 프레임이었다).
    g = args.gap
    rects = {
        'left': [0.0, 0.0, max(0.0, cube[0] - g), float(h0)],
        'right': [min(float(w0), cube[2] + g), 0.0, float(w0), float(h0)],
        'top': [0.0, 0.0, float(w0), max(0.0, cube[1] - g)],
        'bottom': [0.0, min(float(h0), cube[3] + g), float(w0), float(h0)],
    }

    def square_in(rect, cx, cy):
        rw, rh = rect[2] - rect[0], rect[3] - rect[1]
        side = min(rw, rh)
        if side <= 0:
            return None
        x = min(max(rect[0], cx - side / 2), rect[2] - side)
        y = min(max(rect[1], cy - side / 2), rect[3] - side)
        return {'x': x, 'y': y, 'side': side, 'cx': x + side / 2, 'cy': y + side / 2}

    def contains(rect, box):
        return rect[0] <= box[0] and rect[1] <= box[1] and rect[2] >= box[2] and rect[3] >= box[3]

    qr = cands[0]['bboxFull'] if cands else None
    qr_side, qr_window = None, None
    if qr is not None:
        holders = [(k, r) for k, r in rects.items() if contains(r, qr)]
        holders.sort(key=lambda kv: -((kv[1][2] - kv[1][0]) * (kv[1][3] - kv[1][1])))
        if holders:
            qr_side = holders[0][0]
            qr_window = square_in(holders[0][1], (qr[0] + qr[2]) / 2, (qr[1] + qr[3]) / 2)

    # 음성 대조군 — QR 도 큐브도 없는 창 (있으면)
    bg_side, bg_window = None, None
    for k, r in sorted(rects.items(), key=lambda kv: -((kv[1][2] - kv[1][0]) * (kv[1][3] - kv[1][1]))):
        if qr is not None and overlaps(r, qr, pad=g):
            continue
        sq = square_in(r, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
        if sq and sq['side'] >= 400:
            bg_side, bg_window = k, sq
            break

    def cube_verts_in(win):
        if not win:
            return None
        return sum(1 for v in hexv
                   if win['x'] <= v[0] <= win['x'] + win['side']
                   and win['y'] <= v[1] <= win['y'] + win['side'])

    out = {
        'photo': args.source,
        'imageSize': [w0, h0],
        'qrBbox': qr,
        'qrComponentPixels': cands[0]['n'] if cands else None,
        'cubeBbox': cube,
        'qrWindow': qr_window,
        'qrWindowSide': qr_side,
        'qrWindowCubeVertices': cube_verts_in(qr_window),
        'bgWindow': bg_window,
        'bgWindowSide': bg_side,
        'bgWindowCubeVertices': cube_verts_in(bg_window),
        'usable': bool(qr_window) and cube_verts_in(qr_window) == 0,
        'componentCount': len(comps),
    }
    text = json.dumps(out, indent=1)
    if args.json:
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        with open(args.json, 'w', encoding='utf-8') as fh:
            fh.write(text)
    print(text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
