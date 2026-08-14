/**
 * build-print-poster.mjs — 영상 촬영용 A4 인쇄 포스터를 정적 HTML 로 굽는다.
 *
 * 기존 생성기 번들(dist/, lab-*)을 건드리지 않는다. 출력은 print/tlcube-poster.html.
 *
 * QR: src/qr-v2-byte.js 의 v2-L 바이트 모드. 페이로드는 TLcube 와 같은
 *     소문자 문자열 `https://tl.estre.so` 이다 (바이트 단위 동일).
 * TLcube: Type Y1 · 3톤 · ECC-M. 영상용 컬러 포스터에서 세 휘도 단계가 드러나도록
 *         하되, 코드 영역에는 장식을 겹치지 않는다.
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
export const POSTER_TL_TONES = 3;
export const POSTER_TL_ECC = 'M';
export const SYMBOL_BOX_CLASS = 'symbol-box';
export const SYMBOL_BOX_TOKEN = '--symbol-box';
export const SYMBOL_BOX_MM = 45;
export const QR_QUIET_MODULES = 4;

/** 컬러 인쇄용 3톤. RGB가 달라도 상대 휘도 간격은 크게 유지한다. */
export const PRINT_PALETTE = Object.freeze({
  background: Object.freeze({ r: 255, g: 255, b: 255 }),
  levels: Object.freeze([
    Object.freeze({ r: 18, g: 22, b: 48 }),
    Object.freeze({ r: 82, g: 68, b: 178 }),
    Object.freeze({ r: 188, g: 226, b: 240 }),
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
    ${SYMBOL_BOX_TOKEN}: ${SYMBOL_BOX_MM}mm;
    --ink: #18142d;
    --muted: #5d5872;
    --paper: #f8f7ff;
    --violet: #6548e8;
    --violet-deep: #352276;
    --cyan: #58d7e5;
    --pink: #ff6da6;
    --yellow: #ffd56a;
    color-scheme: light;
  }
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    background: #17122d;
    color: var(--ink);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .sheet {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    background:
      radial-gradient(circle at 12% 4%, rgba(255, 213, 106, 0.72), transparent 25%),
      radial-gradient(circle at 94% 18%, rgba(88, 215, 229, 0.48), transparent 27%),
      linear-gradient(145deg, #fffdf8 0%, var(--paper) 48%, #eeeaff 100%);
    color: var(--ink);
  }
  .sheet::before,
  .sheet::after {
    content: "";
    position: absolute;
    z-index: -1;
    pointer-events: none;
  }
  .sheet::before {
    width: 94mm;
    height: 94mm;
    right: -35mm;
    top: -34mm;
    border: 1.5mm solid rgba(101, 72, 232, 0.11);
    border-radius: 50%;
    box-shadow:
      0 0 0 9mm rgba(88, 215, 229, 0.08),
      0 0 0 20mm rgba(101, 72, 232, 0.045);
  }
  .sheet::after {
    width: 72mm;
    height: 55mm;
    left: -28mm;
    bottom: -19mm;
    background: linear-gradient(135deg, rgba(255, 109, 166, 0.2), rgba(101, 72, 232, 0.11));
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    transform: rotate(18deg);
  }
  .content {
    position: relative;
    z-index: 1;
  }
  .brand-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8mm;
    margin-bottom: 8mm;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 3mm;
    min-height: 9mm;
    padding: 2mm 4mm;
    border: 0.45mm solid rgba(53, 34, 118, 0.18);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 2mm 8mm rgba(53, 34, 118, 0.08);
    font-size: 9pt;
    font-weight: 750;
    letter-spacing: 0.08em;
  }
  .brand-dot {
    width: 3.2mm;
    height: 3.2mm;
    border-radius: 0.8mm;
    background: linear-gradient(135deg, var(--pink), var(--violet) 54%, var(--cyan));
    transform: rotate(30deg);
  }
  .edition {
    color: var(--violet-deep);
    font-size: 8pt;
    font-weight: 750;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .headline {
    max-width: 155mm;
    margin: 0;
    font-family: Georgia, "Times New Roman", Times, serif;
    font-size: 38pt;
    font-weight: 700;
    letter-spacing: -0.045em;
    line-height: 0.98;
  }
  .headline em {
    color: var(--violet);
    font-style: normal;
  }
  .lede {
    max-width: 145mm;
    margin: 6mm 0 0;
    color: var(--muted);
    font-size: 15pt;
    font-weight: 520;
    line-height: 1.38;
    letter-spacing: -0.012em;
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20mm minmax(0, 1fr);
    align-items: stretch;
    margin-top: 11mm;
  }
  .card {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 112mm;
    flex-direction: column;
    align-items: center;
    margin: 0;
    padding: 7mm 5mm 6mm;
    overflow: hidden;
    border: 0.55mm solid rgba(53, 34, 118, 0.13);
    border-radius: 7mm;
    background: rgba(255, 255, 255, 0.84);
    box-shadow: 0 5mm 15mm rgba(53, 34, 118, 0.11);
  }
  .card::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 3.2mm;
    background: var(--pink);
  }
  .card--tlcube::before {
    background: linear-gradient(90deg, var(--violet), var(--cyan));
  }
  .card-meta {
    align-self: stretch;
    min-height: 19mm;
    text-align: center;
  }
  .card figcaption {
    margin: 0;
    font-family: Georgia, "Times New Roman", Times, serif;
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1;
    text-transform: none;
  }
  .tagline {
    margin: 2.4mm auto 0;
    color: var(--muted);
    font-size: 10pt;
    font-weight: 620;
    line-height: 1.35;
  }
  .code-stage {
    display: grid;
    width: 57mm;
    height: 57mm;
    place-items: center;
    margin: 3.5mm auto 3mm;
    border: 0.45mm solid rgba(24, 20, 45, 0.12);
    border-radius: 5mm;
    background: #ffffff;
    box-shadow:
      0 2.5mm 8mm rgba(53, 34, 118, 0.1),
      inset 0 0 0 1.4mm rgba(248, 247, 255, 0.85);
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
  .dimension {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20mm;
    min-height: 9mm;
    margin-top: auto;
    padding: 1.7mm 4mm;
    border-radius: 999px;
    background: #fff1f6;
    color: #8f2450;
    font-size: 12pt;
    font-weight: 800;
    letter-spacing: 0.08em;
  }
  .card--tlcube .dimension {
    background: #eeeaff;
    color: var(--violet-deep);
  }
  .format-note {
    margin-top: 2.4mm;
    color: var(--muted);
    font-size: 7.5pt;
    font-weight: 720;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .choice {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--violet-deep);
    text-align: center;
  }
  .choice::before,
  .choice::after {
    content: "";
    width: 0.45mm;
    height: 23mm;
    border-radius: 999px;
    background: linear-gradient(var(--pink), var(--violet), var(--cyan));
  }
  .choice-copy {
    display: block;
    margin: 4mm -3mm;
    font-size: 7.5pt;
    font-weight: 820;
    letter-spacing: 0.12em;
    line-height: 1.35;
    text-transform: uppercase;
  }
  .choice-copy strong {
    display: block;
    margin-top: 1.5mm;
    font-family: Georgia, "Times New Roman", Times, serif;
    font-size: 11.5pt;
    letter-spacing: -0.025em;
    line-height: 1.02;
    text-transform: uppercase;
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 6mm;
    margin: 9mm 0 0;
    padding: 5mm 6mm;
    border-radius: 5mm;
    background: var(--ink);
    color: #ffffff;
  }
  .facts-kicker {
    color: var(--cyan);
    font-size: 8pt;
    font-weight: 820;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .facts-copy {
    margin: 0;
    font-family: Georgia, "Times New Roman", Times, serif;
    font-size: 11.5pt;
    line-height: 1.35;
  }
  @media screen {
    body {
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 24px 12px;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      padding: 13mm 13mm 11mm;
      box-shadow: 0 12px 55px rgba(0, 0, 0, 0.32);
    }
  }
  @media print {
    html, body { background: #ffffff; }
    body { padding: 0; display: block; }
    .sheet {
      width: auto;
      min-height: 281mm;
      padding: 9mm 8mm 8mm;
      box-shadow: none;
    }
    html, body, .sheet, .card, .code-stage, .${SYMBOL_BOX_CLASS}, .dimension, .facts {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<main class="sheet">
  <div class="content">
    <div class="brand-line">
      <div class="brand"><span class="brand-dot" aria-hidden="true"></span>TLcube · OPEN VISUAL CODE</div>
      <div class="edition">PRINT / SCAN STUDY</div>
    </div>
    <h1 class="headline">A code can be part of <em>the design.</em></h1>
    <p class="lede">Both marks carry the same link. QR stays familiar; TLcube explores a 2.5D visual language made to live with the work around it.</p>
    <div class="pair">
      <figure class="card card--qr">
        <div class="card-meta">
          <figcaption>QR</figcaption>
          <p class="tagline">Familiar by design.</p>
        </div>
        <div class="code-stage">
          <div class="${SYMBOL_BOX_CLASS}" id="qr-symbol" data-poster-symbol="qr" data-payload="${POSTER_URL}">
${qrSvg.trim()}
          </div>
        </div>
        <div class="dimension">2D</div>
        <div class="format-note">STANDARD QR</div>
      </figure>
      <div class="choice" aria-label="One link. Choose your way.">
        <span class="choice-copy">ONE LINK<strong>CHOOSE<br>YOUR WAY</strong></span>
      </div>
      <figure class="card card--tlcube">
        <div class="card-meta">
          <figcaption>TLcube</figcaption>
          <p class="tagline">Designed to live with your work.</p>
        </div>
        <div class="code-stage">
          <div class="${SYMBOL_BOX_CLASS}" id="tlcube-symbol" data-poster-symbol="tlcube" data-payload="${POSTER_URL}" data-type="${POSTER_TL_TYPE}" data-version="${POSTER_TL_VERSION}" data-tones="${POSTER_TL_TONES}" data-ecc="${POSTER_TL_ECC}">
${tlSvg.trim()}
          </div>
        </div>
        <div class="dimension">2.5D</div>
        <div class="format-note">TYPE Y · THREE-TONE</div>
      </figure>
    </div>
    <footer class="facts">
      <div class="facts-kicker">Built in the open</div>
      <p class="facts-copy">TLcube is an open-source 2.5D visual code. A fallback QR can be included when the situation calls for one.</p>
    </footer>
  </div>
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
