// 실물 사진/스크린샷을 **스캐너가 보는 방식으로** 디코더에 물린다.
//
// 🔴 이 파일은 한 번 크게 틀렸다. 처음엔 3840×2160 원본을 그대로 `decodeFrontend` 에
//    넣고 21/21 실패를 보고했다. 그런데 스캐너는 프레임을 **정사각으로 크롭하고 긴 변
//    960px(FRAME_MAX_SIDE)로 줄여서** 넘기고, 사용자는 조준 가이드에 코드를 맞춘다.
//    원본에서는 코드가 프레임의 9.5% 였고 스캐너에서는 54\~90% 다. 스케일이 4배,
//    점유율이 6배 다르면 그건 같은 실험이 아니다 — 제품이 사는 축에서 재야 한다.
//    (같은 이미지가 점유율만 바꾸니 70% 에서 바로 복호됐다.)
//
// 사용: node tools/warp/scan-photo.mjs <파일.png> <코드중심x> <코드중심y> <코드폭px>
//   좌표·폭은 원본 픽셀 기준. 모르면 --probe 로 점유율만 훑는다 (중심 = 프레임 중앙).
//
// 🔴 실패 «코드» 만 세지 마라. 실패하면 그 이미지를 열어 봐야 한다.
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { pngToRaster } from '../asset-render.mjs';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { GUIDE_OUTER_FRACTION, FRAME_MAX_SIDE } from '../../src/scanner-zoom.js';

/** 쌍선형 축소 — 스캐너의 canvas drawImage 에 해당한다 (최근접이면 셀 경계가 깨진다). */
function resample(src, sx, sy, sSide, target) {
  const out = new Uint8ClampedArray(target * target * 4);
  const scale = sSide / target;
  for (let y = 0; y < target; y += 1) {
    const fy = sy + (y + 0.5) * scale - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(fy)));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < target; x += 1) {
      const fx = sx + (x + 0.5) * scale - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(fx)));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * target + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const a = src.pixels[(y0 * src.width + x0) * 4 + c];
        const b = src.pixels[(y0 * src.width + x1) * 4 + c];
        const d = src.pixels[(y1 * src.width + x0) * 4 + c];
        const e = src.pixels[(y1 * src.width + x1) * 4 + c];
        out[o + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return { width: target, height: target, pixels: out };
}

function judge(raster) {
  try {
    const d = decodeFrontend(raster, {});
    if (d && d.ok) return { ok: true, text: String(d.text), s: `✓ ok  "${String(d.text).slice(0, 46)}"` };
    const c = (d.detail && d.detail.cause) || {};
    const g = c.diagnostics || {};
    return {
      ok: false,
      s: `✗ ${(d.reason || '').replace('frontend:', '').padEnd(22)}`
        + ` 가설 ${String(g.hypothesisCount ?? '-').padStart(4)}`
        + ` · 후보 ${g.formatCandidateCount ?? '-'} · 본문 ${g.bodyValidCount ?? '-'}`,
    };
  } catch (e) { return { ok: false, s: `✗ throw ${e.message.slice(0, 44)}` }; }
}

const OCCUPANCIES = [0.90, 0.80, 0.70, GUIDE_OUTER_FRACTION, 0.45, 0.35, 0.25];

const [file, CX, CY, CODEPX] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.log('사용: node tools/warp/scan-photo.mjs <파일.png> <중심x> <중심y> <코드폭px>');
  process.exit(1);
}
const src = pngToRaster(readFileSync(file));
const cx = Number.isFinite(+CX) ? +CX : src.width / 2;
const cy = Number.isFinite(+CY) ? +CY : src.height / 2;
const codePx = Number.isFinite(+CODEPX) ? +CODEPX : Math.round(src.width * 0.1);

console.log(`${basename(file)}  ${src.width}×${src.height}`);
console.log(`코드 중심 (${Math.round(cx)},${Math.round(cy)}) · 폭 ${codePx}px = 프레임의 ${(codePx / src.width * 100).toFixed(1)}%`);
console.log(`스캐너 규약: 조준 가이드 = 분석 정사각의 ${(GUIDE_OUTER_FRACTION * 100).toFixed(0)}% · 프레임 상한 ${FRAME_MAX_SIDE}px\n`);
console.log('점유율   분석변    판정');
let best = null;
for (const occ of OCCUPANCIES) {
  const side = Math.round(codePx / occ);
  if (side > Math.min(src.width, src.height)) {
    console.log(`${(occ * 100).toFixed(0).padStart(5)}%   ${String(side).padStart(5)}    (프레임보다 큼 — 이 점유율은 이 사진에서 만들 수 없다)`);
    continue;
  }
  const sx = Math.max(0, Math.min(src.width - side, cx - side / 2));
  const sy = Math.max(0, Math.min(src.height - side, cy - side / 2));
  const r = resample(src, sx, sy, side, Math.min(FRAME_MAX_SIDE, side));
  const v = judge(r);
  const tag = occ === GUIDE_OUTER_FRACTION ? '  ← 가이드 규약' : '';
  console.log(`${(occ * 100).toFixed(0).padStart(5)}%   ${String(side).padStart(5)}    ${v.s}${tag}`);
  // OCCUPANCIES 는 내림차순이라 성공할 때마다 덮어써야 **가장 낮은** 성공이 남는다.
  // (`best === null` 로 막으면 첫 성공인 90% 에서 굳어 70% 를 놓친다 — 실제로 그랬다.)
  if (v.ok) best = occ;
}
console.log(best === null
  ? '\n어느 점유율에서도 안 읽힌다.'
  : `\n가장 낮은 성공 점유율: ${(best * 100).toFixed(0)}% (가이드 규약 ${(GUIDE_OUTER_FRACTION * 100).toFixed(0)}% 보다 ${best > GUIDE_OUTER_FRACTION ? '**높다** — 가이드대로 맞추면 실패한다' : '낮다 — 가이드로 충분하다'})`);
