/**
 * build-print-poster.mjs — 영상 촬영용 A4 인쇄 포스터를 정적 HTML 로 굽는다.
 *
 * 기존 생성기 번들(dist/, lab-*)을 건드리지 않는다. 출력은 print/tlcube-poster.html.
 *
 * QR: src/qr-v2-byte.js 의 v2-L 바이트 모드. 페이로드는 TLcube 와 같은
 *     소문자 문자열 `https://tl.estre.so` 이다 (바이트 단위 동일).
 * TLcube: Type Y1 · 2톤 · ECC-M. 3톤 실사진 실패를 피하고 인쇄 대비를 크게 잡는다.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { qrV2ByteMatrix } from '../src/qr-v2-byte.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { sceneToSvg } from '../src/svg.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const POSTER_REL = 'print/tlcube-poster.html';
export const POSTER_URL = 'https://tl.estre.so';
export const POSTER_TL_TYPE = 'Y';
export const POSTER_TL_VERSION = 1;
export const POSTER_TL_TONES = 2;
export const POSTER_TL_ECC = 'M';
export const SYMBOL_BOX_CLASS = 'symbol-box';
export const SYMBOL_BOX_TOKEN = '--symbol-box';
export const QR_QUIET_MODULES = 4;

/** 흰 용지 위 2톤 인쇄. 밝은 면도 종이보다 어두워 실루엣이 남는다. */
export const PRINT_PALETTE = Object.freeze({
  background: Object.freeze({ r: 255, g: 255, b: 255 }),
  levels: Object.freeze([
    Object.freeze({ r: 18, g: 18, b: 18 }),
    Object.freeze({ r: 120, g: 120, b: 120 }),
    Object.freeze({ r: 168, g: 168, b: 168 }),
  ]),
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

function qrToSvg(matrix, quiet = QR_QUIET_MODULES) {
  const size = matrix.size;
  const n = size + quiet * 2;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="symbol-render" viewBox="0 0 ${n} ${n}" role="img" aria-label="QR">`,
    `<rect class="quiet-zone" x="0" y="0" width="${n}" height="${n}" fill="#ffffff"/>`,
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!matrix.modules[y * size + x]) continue;
      parts.push(
        `<rect class="mod" x="${x + quiet}" y="${y + quiet}" width="1" height="1" fill="#000000"/>`,
      );
    }
  }
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

function tlcubeToSvg() {
  const encoded = encodeY(POSTER_URL, {
    version: POSTER_TL_VERSION,
    tones: POSTER_TL_TONES,
    eccLevel: POSTER_TL_ECC,
  });
  const scene = buildSceneY(encoded, {
    palette: PRINT_PALETTE,
    cellSize: 1,
    margin: 3,
    cornerQr: false,
  });
  const raw = sceneToSvg(scene, { pixelsPerUnit: 24 });
  return raw
    .replace(/ width="\d+" height="\d+"/, '')
    .replace('<svg ', '<svg class="symbol-render" role="img" aria-label="TLcube" ');
}

export function buildPrintPosterHtml() {
  const qrSvg = qrToSvg(qrV2ByteMatrix(POSTER_URL));
  const tlSvg = tlcubeToSvg();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TLcube print poster</title>
<style>
  :root {
    ${SYMBOL_BOX_TOKEN}: 68mm;
    color-scheme: light;
  }
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    background: #dededc;
    color: #161616;
    font-family: Georgia, "Times New Roman", Times, serif;
  }
  .sheet {
    background: #ffffff;
    color: #161616;
  }
  .headline {
    margin: 0 0 8px;
    font-size: 22pt;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .lede {
    margin: 0 0 18px;
    font-size: 11pt;
    line-height: 1.45;
    max-width: 42em;
  }
  .pair {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10mm;
  }
  .card {
    flex: 1 1 0;
    margin: 0;
    min-width: 0;
  }
  .card figcaption {
    margin: 0 0 4px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 10pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tagline {
    margin: 0 0 8px;
    font-size: 10.5pt;
    line-height: 1.35;
  }
  .${SYMBOL_BOX_CLASS} {
    width: var(${SYMBOL_BOX_TOKEN});
    height: var(${SYMBOL_BOX_TOKEN});
    margin: 0 auto;
    background: #ffffff;
    overflow: hidden;
  }
  .${SYMBOL_BOX_CLASS} .symbol-render {
    display: block;
    width: 100%;
    height: 100%;
  }
  .gutter {
    flex: 0 0 auto;
    align-self: center;
    padding-top: 28px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 9pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6a6a6a;
  }
  .facts {
    margin: 18px 0 0;
    font-size: 9pt;
    line-height: 1.45;
    color: #333;
  }
  @media screen {
    body {
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 18px 12px;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      padding: 16mm 16mm 14mm;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.14);
    }
  }
  @media print {
    html, body { background: #ffffff; }
    body { padding: 0; display: block; }
    .sheet {
      width: auto;
      min-height: 0;
      padding: 0;
      box-shadow: none;
    }
    html, body, .sheet, .${SYMBOL_BOX_CLASS} {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<main class="sheet">
  <h1 class="headline">A code that can sit with the design</h1>
  <p class="lede">Same link, same printed size. Scan the familiar mark on the left, then the TLcube on the right.</p>
  <div class="pair">
    <figure class="card">
      <figcaption>QR</figcaption>
      <p class="tagline">Familiar.</p>
      <div class="${SYMBOL_BOX_CLASS}" id="qr-symbol" data-poster-symbol="qr" data-payload="${POSTER_URL}">
${qrSvg.trim()}
      </div>
    </figure>
    <div class="gutter" aria-hidden="true">then</div>
    <figure class="card">
      <figcaption>TLcube</figcaption>
      <p class="tagline">Designed to live with your work.</p>
      <div class="${SYMBOL_BOX_CLASS}" id="tlcube-symbol" data-poster-symbol="tlcube" data-payload="${POSTER_URL}" data-type="${POSTER_TL_TYPE}" data-version="${POSTER_TL_VERSION}" data-tones="${POSTER_TL_TONES}" data-ecc="${POSTER_TL_ECC}">
${tlSvg.trim()}
      </div>
    </figure>
  </div>
  <p class="facts">A 2.5D visual code. Open source. A fallback QR can travel with it when you need one.</p>
</main>
</body>
</html>
`;
}

export function writePrintPoster(html = buildPrintPosterHtml()) {
  const out = path.join(ROOT, POSTER_REL);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const html = buildPrintPosterHtml();
  writePrintPoster(html);
  process.stdout.write(`${POSTER_REL} written (${Buffer.byteLength(html, 'utf8')} B)\n`);
}
