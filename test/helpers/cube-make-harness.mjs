/**
 * «만들기용 파일» 섹션(index.html #cubeMakeSection)의 VM 하네스예요.
 *
 * - 가짜 DOM 은 손으로 적지 않고 **index.html 의 실제 마크업**을 파싱해서 만들어요. 코드가 쓰는 id·data-* 가
 *   마크업과 어긋나면 `$()` 가 던져서 바로 빨개져요.
 * - 핸들러는 index.html 의 «cubeMake VM 슬라이스» 표시 사이를 그대로 잘라 실행해요(사본 없음).
 * - 사전(GENERATOR_STRINGS)도 index.html 에서 그대로 읽어요. 없는 키를 부르면 기록해 두고 테스트가 잡아요.
 * - src 모듈은 실제 것을 넣어요. 테스트가 특정 함수만 가짜로 바꿀 수 있게 `overrides` 를 받아요.
 */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

import {encodeH} from '../../src/h-codec.js';
import {generatorCubeModel} from '../../src/generator-cube-export.js';
import {hDisplayMap} from '../../src/h-face-arrangement.js';
import {hExportIconMarkup} from '../../src/h-preview-decor.js';
import {hControlIcon} from '../../src/h-preview-controls.js';
import {sceneToSvg} from '../../src/svg.js';
import {renderExportPng} from '../../src/export-render.js';
import * as cubePhysical from '../../src/cube-physical.js';
import * as paperNet from '../../src/paper-net.js';
import * as pdfWriter from '../../src/pdf-writer.js';
import * as printMesh from '../../src/print-mesh.js';
import * as meshExport from '../../src/mesh-export.js';

export const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
export const SLICE_START = '// ── cubeMake VM 슬라이스 시작';
export const SLICE_END = '// ── cubeMake VM 슬라이스 끝 ──';

/** 두 표시 사이의 핸들러 원문. */
export function cubeMakeSlice(source = INDEX) {
  const start = source.indexOf(SLICE_START), end = source.indexOf(SLICE_END, start);
  if (start < 0 || end <= start) throw new Error('cubeMake 슬라이스 표시를 못 찾았어요');
  return source.slice(start, end);
}
/** `<section id="cubeMakeSection" …>…</section>` 원문. */
export function cubeMakeMarkup(source = INDEX) {
  const match = /<section id="cubeMakeSection"[\s\S]*?<\/section>/.exec(source);
  if (!match) throw new Error('#cubeMakeSection 마크업을 못 찾았어요');
  return match[0];
}

/** GENERATOR_STRINGS 객체를 index.html 에서 그대로 평가해요. */
export function generatorStrings(source = INDEX) {
  const start = source.indexOf('const GENERATOR_STRINGS = {');
  const end = source.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('GENERATOR_STRINGS 를 못 찾았어요');
  return vm.runInNewContext('(' + source.slice(source.indexOf('{', start), end + 2) + ')');
}

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
/** HTML «유효한 부동소수 문자열»(value sanitization 기준). type=number 칸은 이 꼴이 아니면 value 가 '' 이고 validity.badInput 이에요. */
export const VALID_FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;
function makeNode(tag, attrs) {
  const listeners = new Map();
  const dataset = {};
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  const classes = new Set((attrs.class ?? '').split(/\s+/).filter(Boolean));
  const node = {
    tag, attrs, dataset, children: [], parent: null, text: '',
    hidden: 'hidden' in attrs, disabled: 'disabled' in attrs,
    textContent: '', innerHTML: '', title: attrs.title ?? '', value: attrs.value ?? '', min: '', max: '', step: '',
    validity: {badInput: false},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; },
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    removeAttribute(k) { delete attrs[k]; if (k === 'max') node.max = ''; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    /** 등록된 핸들러를 부르고, 비동기 핸들러가 끝날 때까지 기다릴 Promise 를 돌려줘요. */
    fire(type) { return Promise.all((listeners.get(type) ?? []).map((fn) => fn({type, target: node}))); },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
  };
  return node;
}

/** 이 섹션에 필요한 만큼만 HTML 을 파싱해요(태그 · 속성 · 부모/자식 · 텍스트). */
export function parseMarkup(html) {
  const root = makeNode('#root', {});
  const stack = [root], byId = new Map(), all = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[4] !== undefined) { stack.at(-1).text += m[4]; continue; }
    const [, close, rawTag, rawAttrs] = m, tag = rawTag.toLowerCase();
    if (close) {
      for (let i = stack.length - 1; i > 0; i -= 1) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([^\s="'/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    const node = makeNode(tag, attrs);
    node.parent = stack.at(-1);
    stack.at(-1).children.push(node);
    all.push(node);
    if (attrs.id) {
      if (byId.has(attrs.id)) throw new Error(`id 중복: ${attrs.id}`);
      byId.set(attrs.id, node);
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(rawAttrs)) stack.push(node);
  }
  return {root, byId, all};
}

/** 슬라이스에서 `$('id')` 로 부르는 id 와 표 상수의 id 를 모아요. 마크업에 없으면 돌려줘요. */
export function missingMarkupIds(markup, slice) {
  const {byId} = parseMarkup(markup);
  const ids = new Set([...slice.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((x) => x[1]));
  for (const table of ['CUBE_MAKE_PAPER_IDS', 'CUBE_MAKE_PRINT_IDS']) {
    const body = new RegExp(`const ${table}=\\[([^\\]]*)\\]`).exec(slice);
    if (!body) throw new Error(`${table} 을 못 찾았어요`);
    for (const x of body[1].matchAll(/'([^']+)'/g)) ids.add(x[1]);
  }
  const inputs = /const CUBE_MAKE_INPUTS=\{([\s\S]*?)\n\};/.exec(slice);
  if (!inputs) throw new Error('CUBE_MAKE_INPUTS 를 못 찾았어요');
  for (const x of inputs[1].matchAll(/^\s*([A-Za-z0-9_]+):\{key:/gm)) ids.add(x[1]);
  return [...ids].filter((id) => !byId.has(id)).sort();
}

/** H 인코딩 + 현재 프레임 모양(render() 가 만드는 current 의 H 필드 중 이 섹션이 읽는 것). */
export function hCurrent(label, {version = 0, mode = 3, tones = 3, arrangement = 'isometric', renderFaces, text = 'H', ...encodeOptions} = {}) {
  const encoded = encodeH(text, {version, mode, tones, ...encodeOptions});
  return {label, type: 'H', encoded, scene: {}, sceneOpts: {arrangement, renderFaces: renderFaces ?? (mode > 3 ? 6 : 3)}};
}

/**
 * localStorage 모양의 메모리 저장소(getItem · setItem · removeItem). entries 로 처음 값을 넣고, map 으로 들여다봐요.
 * @param {Record<string,string>} [entries]
 */
export function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}
/** 모든 접근이 던지는 저장소(프라이빗 모드 · 막힌 사이트 데이터 흉내). calls 로 닿은 횟수를 세요. */
export function throwingStorage() {
  const storage = {calls: 0};
  for (const name of ['getItem', 'setItem', 'removeItem']) storage[name] = () => { storage.calls += 1; throw new Error('SecurityError: storage blocked'); };
  return storage;
}

/**
 * @param {object} [options]
 * @param {string} [options.source] 슬라이스를 자를 원문(자 검증용 변이 원문을 넣을 수 있어요)
 * @param {boolean} [options.lab] isLabPath()
 * @param {boolean} [options.h] hGeneratorActive()
 * @param {object|null} [options.current]
 * @param {'manual'|'auto'} [options.raf] manual 이면 한 프레임 양보가 release() 까지 멈춰요
 * @param {object} [options.overrides] 주입 값 덮어쓰기(가짜 src 함수 등)
 * @param {object} [options.storage] 주입할 localStorage(기본: 빈 메모리 저장소 — memoryStorage()). 던지는 저장소도 넣을 수 있어요.
 *   슬라이스는 localStorage 를 try/catch 로 감싸서, 주입을 빠뜨려도 ReferenceError 가 삼켜져 «기본값» 으로 조용히 돌아요 —
 *   그래서 하네스가 늘 저장소를 주입하고, 테스트는 저장소에 실제로 닿았는지(값 읽기 · 쓰기)를 재요.
 */
export function createCubeMakeHarness({source = INDEX, markup, lab = true, h = true, current = hCurrent('old'), lang = 'ko', uiMode = 'normal', raf = 'auto', overrides = {}, storage = memoryStorage()} = {}) {
  const dict = generatorStrings(source);
  const {byId, all} = parseMarkup(markup ?? cubeMakeMarkup(source));
  const downloads = [], prints = [], missingKeys = new Set(), rafQueue = [];
  const $ = (id) => {
    const node = byId.get(id);
    if (!node) throw new Error(`마크업에 없는 id: ${id}`);
    return node;
  };
  const translate = (key) => {
    const lang = c.genI18n.lang;
    if (!(key in dict.ko) || !(key in (dict[lang] ?? {}))) missingKeys.add(key);
    return dict[lang]?.[key] ?? dict.ko[key] ?? key;
  };
  const c = {
    // 실제 src
    ...cubePhysical, ...paperNet, ...pdfWriter, ...printMesh, ...meshExport,
    generatorCubeModel, hDisplayMap, hExportIconMarkup, hControlIcon, sceneToSvg, renderExportPng,
    // 페이지 쪽 도우미
    $, document: {activeElement: null},
    genI18n: {lang},
    t: translate,
    tf: (key, vars) => translate(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)),
    isLabPath: () => c.lab, hGeneratorActive: () => c.h, lab, h,
    current, pendingCurrent: null, flushes: 0,
    generatorState: {preset: 'mono'}, mode: uiMode,
    paletteOf: () => undefined,
    hImageEditor: {flush() {}},
    flushScheduledRender() { c.flushes += 1; if (c.pendingCurrent) { c.current = c.pendingCurrent; c.pendingCurrent = null; } },
    exportFilename(ext) { if (!c.current) throw new Error('filename needs current'); return `${c.current.label}.${ext}`; },
    download(bytes, mime, filename) { downloads.push({bytes, mime, filename}); },
    printSvgSheet: async (svgText, paper) => { prints.push({svgText, paper}); },
    GENERATOR_BUILD: '2026-01-01.01',
    requestAnimationFrame: (fn) => { if (raf === 'manual') rafQueue.push(fn); else setTimeout(fn, 0); },
    setTimeout, TextEncoder,
    localStorage: storage,
    ...overrides,
  };
  // focus() 는 document.activeElement 를 옮겨요(sync 의 «입력 중인 칸은 덮지 않음» 가드와 같은 자리를 봐요).
  for (const node of all) node.focus = () => { c.document.activeElement = node; };
  vm.createContext(c);
  vm.runInContext(cubeMakeSlice(source), c, {filename: 'index.html#cubeMake'});
  const run = (code) => vm.runInContext(code, c);
  return {
    c, $, all, dict, downloads, prints, missingKeys, storage,
    sync: () => run('syncCubeMakeUi()'),
    state: () => run('cubeMakeState'),
    expand() { if (run('cubeMakeCollapsed')) return $('cubeMakeToggle').fire('click'); return Promise.resolve(); },
    click: (id) => $(id).fire('click'),
    /** 숫자 입력에 값을 넣고 change 를 보내요. type=number 칸은 브라우저처럼 값을 정리해요(HTML value sanitization):
     *  유효한 부동소수 문자열이 아닌 글자(«abc» · «4e» · «-» · 공백 · «48,3»)는 value '' + validity.badInput 이에요 —
     *  날 글자를 그대로 넘기면 «빈 칸» 과 «틀린 글자» 가 브라우저에서 같은 '' 로 온다는 것을 테스트가 못 봐요. */
    input(id, value) {
      const node = $(id), text = String(value);
      if (node.attrs.type === 'number') { const ok = text === '' || VALID_FLOAT.test(text); node.value = ok ? text : ''; node.validity = {badInput: !ok}; }
      else node.value = text;
      return node.fire('change');
    },
    select(id, value) { $(id).value = String(value); return $(id).fire('change'); },
    /** manual 모드에서 멈춘 프레임 양보를 풀어요. */
    release() { while (rafQueue.length) setTimeout(rafQueue.shift(), 0); },
    pendingFrames: () => rafQueue.length,
    text: (key) => dict[c.genI18n.lang]?.[key] ?? dict.ko[key],
  };
}

/** 마크업에서 data-i18n / data-i18n-attr / data-help 로 부르는 키와 슬라이스의 'g…' 키를 모아요. */
export function referencedKeys(markup, slice) {
  const keys = new Set();
  for (const m of markup.matchAll(/data-(?:i18n|help)="(g\d+)"/g)) keys.add(m[1]);
  for (const m of markup.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) keys.add(pair.split(':')[1].trim());
  for (const m of slice.matchAll(/'(g\d{3,})'/g)) keys.add(m[1]);
  return [...keys].sort();
}

/** 표(code → g-키)가 덮지 못한 TLP 코드. */
export function missingCodeKeys(table, codes) {
  return [...codes].filter((code) => !table[code]).sort();
}
/** 슬라이스의 CUBE_MAKE_CODE_KEYS 표를 읽어요. */
export function codeKeyTable(slice) {
  const body = /const CUBE_MAKE_CODE_KEYS=\{([\s\S]*?)\};/.exec(slice);
  if (!body) throw new Error('CUBE_MAKE_CODE_KEYS 를 못 찾았어요');
  return Object.fromEntries([...body[1].matchAll(/(TLP_[A-Z_]+):'(g\d+)'/g)].map((m) => [m[1], m[2]]));
}
