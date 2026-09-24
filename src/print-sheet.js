/**
 * print-sheet.js — 종이 도안을 같은 문서 본문으로 인쇄해요 (설계 §3.9).
 *
 * iframe 을 쓰지 않아요. iOS·iPadOS Safari 는 iframe.contentWindow.print() 가 예외 없이 상위 문서 전체를
 * 인쇄한다고 알려져 있어서, 본문에 인쇄 호스트를 붙이고 인쇄 미디어에서 나머지를 숨기는 한 경로만 둬요.
 *
 * 흐름
 * 1. 이전 인쇄의 잔여 호스트·스타일(과 그 정리 리스너)을 먼저 지워요.
 * 2. 인쇄용 SVG 는 다운로드 SVG 와 같은 1:1 척도(사용자 단위 1 = 1 mm)예요. 다만 용지 가장자리 M = PRINT_MARGIN_MM 를
 *    잘라 낸 영역만 그려요 — viewBox "M M W−2M H−2M−0.5", 크기 (W−2M) × (H−2M−0.5) mm, @page 여백도 M 이에요.
 *    다운로드 SVG·PNG·PDF 는 용지 전면 그대로예요(이 모듈은 인쇄 경로만 맡아요).
 *    - 자르는 까닭: 옛 꼴(용지 전면 폭 SVG + @page 여백 0)은 인쇄 대화상자 여백을 «기본값» 이 아닌 값으로 바꾸면
 *      쪽 영역이 SVG 보다 좁아져 비율로 줄었어요. 2026-09-24 헤드리스 실측(A4, 50 mm 막대): Chrome 153(앱 index.html
 *      본문 안)은 여백 3.5 mm 에서 0.984 · 4.23 mm 에서 0.980(둘 다 빈 두 번째 쪽까지), Firefox 149(축소 맞춤 켬, 앱 본문
 *      규칙을 재현한 쪽)는 0.978 · 0.974 였어요. Chromium 소스로는 기본값이 아닌 여백에서 CSS 여백을 무시하고 가로 넘침
 *      비율로 줄이는 경로예요(print_render_frame_helper.cc ignore_css_margins → pagination_utils.cc
 *      CalculateOverflowShrinkForPrinting). 이 꼴은 같은 두 브라우저에서 A4 여백 기본값 · 없음 · 최소 3.5 / 4.23 /
 *      6.35 mm · 비대칭 3·5 mm(Letter 는 그 일부)가 모두 배율 1.000 · 한 쪽이었어요.
 *    - 못 막는 것: 여백을 «맞춤» 으로 M 보다 넓게 고르면 여전히 줄어요(10 mm 에서 Chrome 0.964 · Firefox 0.958, 실측).
 *      운영자가 종이에서 잰 0.966(48.3 mm)의 원인은 확인하지 못했어요. 옛 꼴에서 그 값이 나오려면 여백이 Chrome 은
 *      약 7 mm, Firefox 는 6.35 mm 근처(0.964)여야 해서 흔한 3.5–4.2 mm 로는 설명이 안 되고, 드라이버·OS 의 «인쇄 가능
 *      영역에 맞춤» 도 후보로 남아요 — 그 경로는 뷰어 뒤(드라이버·OS·IPP)에서 일어나 CSS 로도 PDF 로도 막을 수 없고,
 *      안내 문구(g1045 · g1120: 맞춤·축소 끄기 · 인쇄 후 50 mm 막대 재기)만 맡아요. PDF 의 /PrintScaling /None 은 기본값이
 *      «맞춤» 인 PDF 뷰어의 인쇄 대화상자만 바꿔요(pdf-writer.js). 실제 프린터와 Safari(WebKit)는 재지 않았어요.
 *    - 잘라도 도형은 남아요: 도안은 도형을 용지 가장자리에서 PAPER_MARGIN_MM(7) 안쪽에 두고 재단선 잉크만 6.8 까지
 *      와요(paper-net 자체 검사, 네 변 같은 허용). 왼쪽·오른쪽·위 크롭(M = 6.35)은 그 검사로 안전하지만 아래 크롭
 *      (M + 0.5 = 6.85)은 6.8 보다 안쪽이라 자체 검사가 지키지 않아요 — 아래는 하단 띠(PAPER_BAND_MM)가 재단선을 가장자리에서
 *      떼어 놓는 배치 덕이고, 그걸 재는 자는 test/print-sheet.test.js 의 «크롭» 격자(실제 도안)뿐이에요.
 *    - M = 6.35 mm = 24 CSS px 예요. 정수 px 가 아니면 Chrome 이 여백을 px 로 맞춰 위치가 밀렸어요(6 mm 에서 0.085 mm, 실측).
 *    - 높이는 0.5 mm 더 짧아요 — 쪽 영역과 정확히 같은 높이면 반올림으로 빈 두 번째 쪽이 생길 수 있어서예요.
 *    - 호스트는 쪽 영역(html·body 높이 100%) 가운데에 SVG 를 놓아요. «여백: 없음» 이면 쪽 영역이 용지 전체라
 *      가운데 = M 이고, 프린터 여백이 대칭인 «최소» 여도 가운데 = M 이에요(실측 위치 차 0.27 mm 이하). 비대칭이면
 *      (위−아래)/2 만큼 움직여요(3·5 mm 에서 약 1.1 mm). 100vh 는 쓰지 않아요 — Firefox 149 인쇄에서 쪽 영역이 아니었어요
 *      («여백: 없음» 에서 6.4 mm 위로 밀림). 앱 body 규칙(flex · min-height:100vh · align-items:center)도 인쇄에서 풀어요 —
 *      Chrome 에서 옛 꼴 «최소 3.5 mm» 가 그 규칙 없이 0.968 · 한 쪽, 앱 안에서 0.984 · 두 쪽으로 달랐어요. SVG 가
 *      쪽 영역보다 크면 flex 자동 여백이 0 이 되어 왼쪽 위에 붙어요(CSS Flexbox 규칙 — 음수 여백으로 잘리지 않게).
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
 * @page 여백 = 인쇄 SVG 가 용지 가장자리에서 잘라 내는 폭(mm). 프린터 비인쇄 여백이 이 값 이하면(흔히 알려진 값:
 * 잉크젯 3–5 mm · 레이저 4.2–5 mm · PCL 1/4 in = 6.35 mm) «여백: 최소» 에서도 쪽 영역이 SVG 보다 좁아지지 않아요.
 * 상한은 도안 쪽이 정해요: M ≤ PAPER_MARGIN_MM − CUT_LINE_MM(재단선 잉크 6.8) 이고
 * M + PRINT_HEIGHT_TRIM_MM ≤ PAPER_MARGIN_MM(아래 띠 7) — test/print-sheet.test.js 가 paper-net 상수와 실제 도안 격자로 재요.
 * 아래쪽 여유는 0.15 mm(격자 실측 가장자리 최소 7.0 − 6.85)라, 도안 배치가 바뀌면 그 격자가 먼저 빨개지는 것이 의도예요.
 */
export const PRINT_MARGIN_MM = 6.35;

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

/** 여백 M 을 양쪽에서 잘라 내고도(높이는 0.5 mm 더) 남는 치수여야 해요. */
const MIN_PAPER_MM = 2 * PRINT_MARGIN_MM + PRINT_HEIGHT_TRIM_MM;
function checkMm(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= MIN_PAPER_MM) {
    throw new RangeError(`${label} 는 ${MIN_PAPER_MM} mm 보다 큰 유한한 수여야 해요: ${v}`);
  }
  return v;
}
/** 인쇄 SVG 의 mm 크기(= viewBox 크기) 문자열. */
const printBox = (widthMm, heightMm) => ({
  o: mmText(PRINT_MARGIN_MM),
  w: mmText(widthMm - 2 * PRINT_MARGIN_MM),
  h: mmText(heightMm - 2 * PRINT_MARGIN_MM - PRINT_HEIGHT_TRIM_MM),
});

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
 * 다운로드용 mm SVG → 인쇄용 SVG 문자열. 루트의 width·height·viewBox 만 바꿔요(M = PRINT_MARGIN_MM):
 * width="{W−2M}mm" height="{H−2M−0.5}mm" viewBox="{M} {M} {W−2M} {H−2M−0.5}" (사용자 단위 1 = 1 mm 유지).
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
  const {o, w, h} = printBox(widthMm, heightMm);
  const attrs = root[1].replace(/\s(?:width|height|viewBox)="[^"]*"/g, '');
  const rest = svgText.slice(root.index + root[0].length);
  return `<svg${attrs} width="${w}mm" height="${h}mm" viewBox="${o} ${o} ${w} ${h}">${rest}`;
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
  const {o, w, h} = printBox(widthMm, heightMm);
  return [
    `@media screen { #${PRINT_HOST_ID} { display:none } }`,
    '@media print {',
    `  @page { size: ${size}; margin: ${o}mm }`,
    // html·body 높이 100% = 쪽 영역(인쇄의 초기 포함 블록). 100vh 는 Firefox 인쇄에서 쪽 영역이 아니라 못 써요(실측).
    '  html, body { margin:0; padding:0; background:#fff; height:100% }',
    // 앱 본문 규칙(body { display:flex; min-height:100vh; align-items:center })을 인쇄에서 풀어요 — 배치는 호스트가 정해요.
    '  body { display:block; min-height:0 }',
    `  body > *:not(#${PRINT_HOST_ID}) { display:none !important }`,
    // 쪽 영역 가운데. 최소 높이도 0.5 mm 짧게 — «여백: 기본값» 이면 SVG 높이와 같아 위치 = M 이에요.
    `  #${PRINT_HOST_ID} { display:flex; min-height:calc(100% - ${mmText(PRINT_HEIGHT_TRIM_MM)}mm); break-inside:avoid; break-after:avoid; -webkit-print-color-adjust:exact; print-color-adjust:exact }`,
    `  #${PRINT_HOST_ID} svg { display:block; flex:none; margin:auto; width:${w}mm; height:${h}mm }`,
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
