/**
 * print-sheet.js — 종이 도안을 같은 문서 본문으로 인쇄해요 (설계 §3.9).
 *
 * iframe 을 쓰지 않아요. iOS·iPadOS Safari 는 iframe.contentWindow.print() 가 예외 없이 상위 문서 전체를
 * 인쇄한다고 알려져 있어서, 본문에 인쇄 호스트를 붙이고 인쇄 미디어에서 나머지를 숨기는 한 경로만 둬요.
 *
 * 흐름
 * 1. 이전 인쇄의 잔여 호스트·스타일(과 그 정리 리스너)을 먼저 지워요.
 * 2. 인쇄용 SVG 는 다운로드 SVG 와 같은 1:1 척도이고, 높이만 용지보다 0.5 mm 짧아요(viewBox 높이도 같이).
 *    용지와 정확히 같은 높이면 반올림으로 빈 두 번째 쪽이 생길 수 있어요(브라우저별 실측 전). 내용은 여백 안쪽이라
 *    잘리지 않아요.
 * 3. body 에 `<style id="tlPrintStyle">` 과 `<div id="tlPrintHost">`(SVG)를 붙여요.
 * 4. 한 프레임 양보한 뒤 print() 를 불러요(진행 문구가 먼저 그려지게).
 * 5. afterprint 나 matchMedia('print') 의 change(false) 에서 지워요. 오지 않으면 다음 인쇄 직전에 지워요.
 *    타이머로는 지우지 않아요 — 인쇄 대화상자가 떠 있는 동안 지우면 빈 쪽이 인쇄돼요.
 *
 * document·window 는 주입형이라 가짜 객체로 VM 테스트를 할 수 있어요. 기본값은 전역이에요.
 * svgText 는 이 저장소의 sceneToSvg(mm 단위)가 만든 신뢰된 SVG 여야 해요. 호스트에 innerHTML 로 넣으므로
 * 스크립트·이벤트 속성·foreignObject 가 보이면 거부해요.
 */

export const PRINT_HOST_ID = 'tlPrintHost';
export const PRINT_STYLE_ID = 'tlPrintStyle';
/** 인쇄 SVG 를 용지보다 짧게 하는 양(mm). */
export const PRINT_HEIGHT_TRIM_MM = 0.5;

/**
 * CSS `@page size` 키워드의 치수(mm, 세로). 출처는 CSS Paged Media 규격의 키워드 정의예요.
 * 호출자가 준 키워드와 widthMm·heightMm 가 어긋나면(용지 표를 잘못 짝지으면) 1:1 이 깨지므로 거부해요.
 */
export const CSS_PAGE_SIZES_MM = Object.freeze({
  A5: Object.freeze([148, 210]),
  A4: Object.freeze([210, 297]),
  A3: Object.freeze([297, 420]),
  B5: Object.freeze([176, 250]),
  B4: Object.freeze([250, 353]),
  'JIS-B5': Object.freeze([182, 257]),
  'JIS-B4': Object.freeze([257, 364]),
  letter: Object.freeze([215.9, 279.4]),
  legal: Object.freeze([215.9, 355.6]),
  ledger: Object.freeze([279.4, 431.8]),
});
const PAGE_SIZE_TOLERANCE_MM = 0.5;
/** viewBox 와 용지 치수 비교 허용치(mm). sceneToSvg 는 소수 4자리로 적어요. */
const VIEWBOX_TOLERANCE_MM = 1e-3;
const UNSAFE_SVG = /<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|\son[a-z]+\s*=|javascript:/i;
/** href 는 문서 안 참조(#id)나 내장 PNG 만 받아요 — 외부 요청을 만들지 않게요(scene-image.js 와 같은 방침). */
const HREF_VALUE = /\s(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi;
const SAFE_HREF = /^(?:#[A-Za-z0-9_-]+|data:image\/png;base64,[A-Za-z0-9+/]*={0,2})$/;
const ROOT_SVG = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b([^>]*)>/;

/** 쪽마다(document 마다) 걸어 둔 정리 리스너 해제 함수예요. */
const detachers = new WeakMap();

const mmText = (v) => {
  const s = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};

function checkMm(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= PRINT_HEIGHT_TRIM_MM) {
    throw new RangeError(`${label} 는 ${PRINT_HEIGHT_TRIM_MM} mm 보다 큰 유한한 수여야 해요: ${v}`);
  }
  return v;
}

function pageKeywordOf(pageKeyword, widthMm, heightMm) {
  if (pageKeyword === undefined || pageKeyword === null) return null;
  if (typeof pageKeyword !== 'string') throw new TypeError('pageKeyword 는 문자열이어야 해요');
  const canonical = Object.keys(CSS_PAGE_SIZES_MM).find((k) => k.toLowerCase() === pageKeyword.toLowerCase());
  if (!canonical) throw new RangeError(`알 수 없는 @page 용지 키워드예요: ${pageKeyword}`);
  const [w, h] = CSS_PAGE_SIZES_MM[canonical];
  if (Math.abs(w - widthMm) > PAGE_SIZE_TOLERANCE_MM || Math.abs(h - heightMm) > PAGE_SIZE_TOLERANCE_MM) {
    throw new RangeError(`@page ${canonical}(${w}×${h} mm)와 용지 치수(${widthMm}×${heightMm} mm)가 달라요`);
  }
  return canonical;
}

/**
 * 다운로드용 mm SVG → 인쇄용 SVG 문자열. 루트의 width·height·viewBox 만 바꿔요:
 * width="{W}mm" height="{H−0.5}mm" viewBox="0 0 {W} {H−0.5}" (사용자 단위 1 = 1 mm 유지).
 * 입력 viewBox 가 "0 0 W H"(용지와 같은 크기)가 아니면 1:1 을 보장할 수 없어서 거부해요.
 * @param {string} svgText
 * @param {{widthMm: number, heightMm: number}} paper
 * @returns {string}
 */
export function printSheetSvg(svgText, {widthMm, heightMm} = {}) {
  if (typeof svgText !== 'string') throw new TypeError('svgText 는 문자열이어야 해요');
  checkMm(widthMm, 'widthMm');
  checkMm(heightMm, 'heightMm');
  if (UNSAFE_SVG.test(svgText)) throw new RangeError('인쇄 SVG 에 스크립트·이벤트 속성·foreignObject 가 있어요');
  for (const m of svgText.matchAll(HREF_VALUE)) {
    if (!SAFE_HREF.test(m[2])) throw new RangeError('인쇄 SVG 의 href 는 #id 나 내장 PNG 만 받아요');
  }
  const root = ROOT_SVG.exec(svgText);
  if (!root) throw new TypeError('SVG 문서가 아니에요(<svg 로 시작해야 해요)');
  const viewBox = /\sviewBox="([^"]*)"/.exec(root[1]);
  const box = viewBox ? viewBox[1].trim().split(/[\s,]+/).map(Number) : [];
  if (box.length !== 4 || !box.every(Number.isFinite)) throw new RangeError('인쇄 SVG 에 viewBox 가 없어요');
  if (box[0] !== 0 || box[1] !== 0 || Math.abs(box[2] - widthMm) > VIEWBOX_TOLERANCE_MM
    || Math.abs(box[3] - heightMm) > VIEWBOX_TOLERANCE_MM) {
    throw new RangeError(`SVG viewBox(${box.join(' ')})가 용지(0 0 ${widthMm} ${heightMm})와 달라서 1:1 로 인쇄할 수 없어요`);
  }
  const w = mmText(widthMm), h = mmText(heightMm - PRINT_HEIGHT_TRIM_MM);
  const attrs = root[1].replace(/\s(?:width|height|viewBox)="[^"]*"/g, '');
  const rest = svgText.slice(root.index + root[0].length);
  return `<svg${attrs} width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${rest}`;
}

/**
 * 인쇄 호스트 스타일. 화면에서는 호스트를 숨기고, 인쇄에서는 호스트만 보여요.
 * @param {{pageKeyword?: string, widthMm: number, heightMm: number}} paper
 *   pageKeyword 가 없으면 `size: {W}mm {H}mm` 로 적어요.
 * @returns {string}
 */
export function printSheetCss({pageKeyword, widthMm, heightMm} = {}) {
  checkMm(widthMm, 'widthMm');
  checkMm(heightMm, 'heightMm');
  const keyword = pageKeywordOf(pageKeyword, widthMm, heightMm);
  const size = keyword ? `${keyword} portrait` : `${mmText(widthMm)}mm ${mmText(heightMm)}mm`;
  return [
    `@media screen { #${PRINT_HOST_ID} { display:none } }`,
    '@media print {',
    `  @page { size: ${size}; margin: 0 }`,
    '  html, body { margin:0; padding:0; background:#fff }',
    `  body > *:not(#${PRINT_HOST_ID}) { display:none !important }`,
    `  #${PRINT_HOST_ID} { display:block; break-inside:avoid; break-after:avoid; -webkit-print-color-adjust:exact; print-color-adjust:exact }`,
    `  #${PRINT_HOST_ID} svg { display:block; width:${mmText(widthMm)}mm; height:${mmText(heightMm - PRINT_HEIGHT_TRIM_MM)}mm }`,
    '}',
  ].join('\n');
}

function detachNode(node) {
  if (typeof node.remove === 'function') node.remove();
  else if (node.parentNode) node.parentNode.removeChild(node);
}

/**
 * 인쇄 호스트·스타일과 정리 리스너를 지워요. 지운 것이 있으면 true 예요.
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function clearPrintHost(doc = globalThis.document) {
  if (!doc || typeof doc.getElementById !== 'function') throw new TypeError('document 가 필요해요');
  const detach = detachers.get(doc);
  if (detach) {
    detachers.delete(doc);
    detach();
  }
  let removed = false;
  for (const id of [PRINT_HOST_ID, PRINT_STYLE_ID]) {
    // 같은 id 가 여러 번 붙어 있어도 다 지워요. 지워지지 않는 노드에서 멈추지 않게 횟수를 막아요.
    for (let k = 0; k < 16; k += 1) {
      const node = doc.getElementById(id);
      if (!node) break;
      detachNode(node);
      removed = true;
    }
  }
  return removed;
}

function watchPrintEnd(doc, win) {
  let active = true;
  const mql = typeof win.matchMedia === 'function' ? win.matchMedia('print') : null;
  const detach = () => {
    if (!active) return;
    active = false;
    if (typeof win.removeEventListener === 'function') win.removeEventListener('afterprint', onEnd);
    if (mql) {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
      else if (typeof mql.removeListener === 'function') mql.removeListener(onChange);
    }
  };
  function onEnd() {
    if (detachers.get(doc) === detach) clearPrintHost(doc);
    else detach();
  }
  function onChange(event) {
    if (event && event.matches === false) onEnd();
  }
  if (typeof win.addEventListener === 'function') win.addEventListener('afterprint', onEnd);
  if (mql) {
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange);
  }
  return detach;
}

/** rAF 폴백 대기(ms) — 숨은 탭·창에서는 rAF 가 멈춰서, 이 시간 뒤 타이머로 양보를 끝내요. */
export const FRAME_FALLBACK_MS = 120;

/** 한 프레임 양보: rAF 다음 태스크. rAF 가 없으면 태스크 하나만 양보해요.
 * rAF 가 끝내 오지 않아도(숨은 탭·창) 타이머 폴백이 이어 가요 — 먼저 온 쪽 한 번만 유효해요. */
function yieldFrame(win) {
  return new Promise((resolve) => {
    let done = false;
    const task = () => {
      if (done) return;
      done = true;
      if (typeof win.setTimeout === 'function') win.setTimeout(resolve, 0);
      else resolve();
    };
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(task);
      if (typeof win.setTimeout === 'function') win.setTimeout(task, FRAME_FALLBACK_MS);
    } else task();
  });
}

/**
 * 도안 SVG 를 본문 인쇄 호스트로 인쇄해요. print() 를 부른 뒤 resolve 해요.
 * 양보하는 동안 다른 인쇄가 호스트를 갈아 끼웠으면 이 호출은 print() 없이 끝나요(늦게 온 쪽이 인쇄해요).
 * print() 가 던지면 호스트를 지우고 같은 오류로 reject 해요.
 * @param {string} svgText sceneToSvg(scene, {unit:'mm'}) 결과(viewBox = 용지)
 * @param {{pageKeyword?: string, widthMm: number, heightMm: number}} paper
 * @param {{doc?: Document, win?: Window}} [env]
 * @returns {Promise<void>}
 */
export async function printSvgSheet(svgText, paper = {}, {doc = globalThis.document, win = globalThis.window} = {}) {
  if (!doc || typeof doc.createElement !== 'function' || !doc.body) throw new TypeError('인쇄할 document 가 없어요');
  if (!win || typeof win.print !== 'function') throw new TypeError('window.print 가 없어요');
  // DOM 을 건드리기 전에 입력부터 검증해요(실패하면 이전 상태 그대로예요).
  const svg = printSheetSvg(svgText, paper);
  const css = printSheetCss(paper);
  clearPrintHost(doc);
  const style = doc.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = css;
  const host = doc.createElement('div');
  host.id = PRINT_HOST_ID;
  host.innerHTML = svg;
  doc.body.appendChild(style);
  doc.body.appendChild(host);
  detachers.set(doc, watchPrintEnd(doc, win));
  await yieldFrame(win);
  if (doc.getElementById(PRINT_HOST_ID) !== host) return;
  try {
    win.print();
  } catch (error) {
    clearPrintHost(doc);
    throw error;
  }
}
