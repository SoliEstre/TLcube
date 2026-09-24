/**
 * 3D 인쇄 파일 검증 자예요(설계 §6-7 · §6-8). 만드는 쪽(src/mesh-export.js)의 코드를 하나도 쓰지 않아요 —
 * CRC 표·ZIP 필드 해석·XML 파서·STL 해석을 여기서 따로 구현해요. inflate 만 node:zlib 을 대조 오라클로 써요.
 *
 * 모든 검사는 던지지 않고 «문제 목록»(issues: {code, detail}[])을 돌려줘요. 테스트는 정상 산출에서 목록이 비었는지,
 * 심은 결함 fixture 에서 그 결함의 코드가 나오는지를 결함마다 단언해요.
 */
import {inflateRawSync} from 'node:zlib';

export const NS = Object.freeze({
  core: 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
  material: 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02',
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
  relationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
  xml: 'http://www.w3.org/XML/1998/namespace',
});
export const REQUIRED_3MF_PARTS = Object.freeze(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
const REL_TYPE_3DMODEL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

// ─────────────────────────────────────────────────────────────────────────────
// CRC-32 (독립 구현: 비트 단위, 표 없음)
// ─────────────────────────────────────────────────────────────────────────────

export function crc32Bitwise(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ZIP 을 끝(EOCD) → 중앙 디렉터리 → 로컬 헤더 순으로 읽어요.
 * 표준 요건(서명·필드 일치·CRC·크기·배치) 외에 이 저장소의 작성 규약도 재요: 주석·extra 없음, 분할 없음,
 * 풀기 버전 STORE 10 · deflate 20, 플래그는 UTF-8 이름(bit 11)만. 그래서 다른 도구가 만든 ZIP 에는 그대로 쓰지 않아요.
 * @returns {{entries: Array<{name, method, flags, crc, csize, usize, offset, dataStart, data: Uint8Array|null, time, date}>, issues}}
 */
export function readZip(bytes, {allowedMethods = [0, 8]} = {}) {
  const issues = [];
  const add = (code, detail) => issues.push({code, detail});
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => view.getUint16(o, true);
  const u32 = (o) => view.getUint32(o, true);
  const entries = [];
  if (bytes.length < 22) {
    add('eocd-missing', '22 B 보다 짧아요');
    return {entries, issues};
  }
  // 주석 없는 ZIP 만 만들므로 EOCD 는 정확히 마지막 22 B 여야 해요.
  const eocd = bytes.length - 22;
  if (u32(eocd) !== 0x06054b50) {
    add('eocd-missing', '마지막 22 B 가 EOCD 서명이 아니에요');
    return {entries, issues};
  }
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0) add('eocd-disk', '분할 ZIP 이에요');
  const countDisk = u16(eocd + 8), count = u16(eocd + 10), cdSize = u32(eocd + 12), cdOffset = u32(eocd + 16);
  if (u16(eocd + 20) !== 0) add('eocd-comment', '주석 길이가 0 이 아니에요');
  if (countDisk !== count) add('eocd-count', `디스크 엔트리 ${countDisk} ≠ 전체 ${count}`);
  if (cdOffset + cdSize !== eocd) add('eocd-cd-range', `중앙 디렉터리 [${cdOffset}, ${cdOffset + cdSize}) 가 EOCD(${eocd}) 에 붙어 있지 않아요`);
  if (cdOffset > eocd) return {entries, issues};
  let o = cdOffset;
  const names = new Set();
  for (let k = 0; k < count; k += 1) {
    if (o + 46 > eocd || u32(o) !== 0x02014b50) {
      add('cd-signature', `중앙 디렉터리 ${k} 번 서명이 없어요(@${o})`);
      return {entries, issues};
    }
    const nameLen = u16(o + 28), extraLen = u16(o + 30), commentLen = u16(o + 32);
    const flags = u16(o + 8);
    const nameBytes = bytes.subarray(o + 46, Math.min(o + 46 + nameLen, eocd));
    let name;
    try {
      name = new TextDecoder('utf-8', {fatal: true}).decode(nameBytes);
    } catch {
      name = `#${k}`;
      add('name-utf8', name);
    }
    const entry = {
      versionNeeded: u16(o + 6), flags, method: u16(o + 10), time: u16(o + 12), date: u16(o + 14),
      crc: u32(o + 16), csize: u32(o + 20), usize: u32(o + 24), offset: u32(o + 42),
      name, nameBytes, data: null,
    };
    if (u16(o + 34) !== 0) add('cd-disk', entry.name);
    if (extraLen !== 0 || commentLen !== 0) add('cd-extra', entry.name);
    if (entry.nameBytes.some((b) => b > 0x7f) !== ((flags & 0x0800) !== 0)) add('utf8-flag', entry.name);
    if (flags & ~0x0800) add('flags', `${entry.name}: 플래그 0x${flags.toString(16)}(암호·데이터 기술자 등)`);
    if (!allowedMethods.includes(entry.method)) add('method', `${entry.name}: method ${entry.method}`);
    if (names.has(entry.name)) add('duplicate-name', entry.name);
    names.add(entry.name);
    entries.push(entry);
    o += 46 + nameLen + extraLen + commentLen;
  }
  if (o !== eocd) add('cd-size', `중앙 디렉터리 끝 ${o} ≠ EOCD ${eocd}`);
  // 로컬 헤더: 중앙 디렉터리와 필드가 일치하고, 엔트리들이 [0, cdOffset) 를 빈틈·겹침 없이 차례로 채워야 해요.
  let cursor = 0;
  for (const entry of entries) {
    const at = entry.offset;
    if (at !== cursor) add('layout', `${entry.name}: 로컬 헤더 @${at}, 기대 @${cursor}`);
    if (at + 30 > cdOffset || u32(at) !== 0x04034b50) {
      add('local-signature', `${entry.name} @${at}`);
      cursor = NaN;
      continue;
    }
    const nameLen = u16(at + 26), extraLen = u16(at + 28);
    const localName = bytes.subarray(at + 30, at + 30 + nameLen);
    const same = u16(at + 4) === entry.versionNeeded && u16(at + 6) === entry.flags && u16(at + 8) === entry.method
      && u16(at + 10) === entry.time && u16(at + 12) === entry.date && u32(at + 14) === entry.crc
      && u32(at + 18) === entry.csize && u32(at + 22) === entry.usize && nameLen === entry.nameBytes.length
      && localName.every((b, i) => b === entry.nameBytes[i]);
    if (!same) add('local-mismatch', entry.name);
    if (extraLen !== 0) add('local-extra', entry.name);
    const expectedVersion = entry.method === 8 ? 20 : 10;
    if (entry.versionNeeded !== expectedVersion) add('version', `${entry.name}: ${entry.versionNeeded}`);
    entry.dataStart = at + 30 + nameLen + extraLen;
    const end = entry.dataStart + entry.csize;
    if (end > cdOffset) {
      add('size', `${entry.name}: 데이터가 중앙 디렉터리를 넘어요`);
      cursor = NaN;
      continue;
    }
    const packed = bytes.subarray(entry.dataStart, end);
    let data = null;
    if (entry.method === 0) {
      data = packed;
      if (entry.csize !== entry.usize) add('size', `${entry.name}: STORE 인데 csize ${entry.csize} ≠ usize ${entry.usize}`);
    } else if (entry.method === 8) {
      try {
        data = new Uint8Array(inflateRawSync(packed));
      } catch (error) {
        add('inflate', `${entry.name}: ${error.message}`);
      }
    }
    if (data) {
      if (data.length !== entry.usize) add('size', `${entry.name}: 풀린 길이 ${data.length} ≠ usize ${entry.usize}`);
      if (crc32Bitwise(data) !== entry.crc) add('crc', entry.name);
      entry.data = data;
    }
    cursor = end;
  }
  if (Number.isFinite(cursor) && cursor !== cdOffset) add('layout', `마지막 엔트리 끝 ${cursor} ≠ 중앙 디렉터리 ${cdOffset}`);
  return {entries, issues};
}

/** DOS 시각·날짜 → {year, month, day, hour, minute, second}. */
export function dosFields(time, date) {
  return {
    year: 1980 + (date >>> 9), month: (date >>> 5) & 15, day: date & 31,
    hour: time >>> 11, minute: (time >>> 5) & 63, second: (time & 31) * 2,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// XML (작은 엄격 파서: 요소·속성·텍스트·주석·XML 선언, 네임스페이스 해석)
// ─────────────────────────────────────────────────────────────────────────────

export class XmlError extends Error {
  constructor(message, at) {
    super(`${message} @${at}`);
    this.at = at;
  }
}

const NAME = /[A-Za-z_][-A-Za-z0-9_.]*(?::[A-Za-z_][-A-Za-z0-9_.]*)?/y;
const ENTITY = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function decodeEntities(raw, at) {
  return raw.replace(/&([^;&<]*);|&/g, (match, body, offset) => {
    if (body === undefined) throw new XmlError('끝나지 않은 엔티티', at + offset);
    if (ENTITY[body] !== undefined) return ENTITY[body];
    const numeric = /^#(?:x([0-9A-Fa-f]+)|([0-9]+))$/.exec(body);
    if (!numeric) throw new XmlError(`알 수 없는 엔티티 &${body};`, at + offset);
    const code = numeric[1] ? parseInt(numeric[1], 16) : parseInt(numeric[2], 10);
    if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)))
      throw new XmlError(`XML 에 없는 문자 참조 &${body};`, at + offset);
    return String.fromCodePoint(code);
  });
}

/**
 * XML 문서를 파싱해요. 잘못된 문서면 XmlError 를 던져요.
 * @returns {{name, prefix, local, ns, attrs: Object<string,string>, attrOrder: string[], children: Array, text: string, at: number}}
 */
export function parseXml(text) {
  let i = 0;
  const n = text.length;
  const fail = (message) => { throw new XmlError(message, i); };
  const skipWs = () => { while (i < n && /[ \t\r\n]/.test(text[i])) i += 1; };
  const readName = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(text);
    if (!m) fail('이름이 와야 해요');
    i = NAME.lastIndex;
    return m[0];
  };
  const skipMisc = () => {
    for (;;) {
      skipWs();
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        if (end < 0) fail('끝나지 않은 주석');
        if (text.slice(i + 4, end).includes('--')) fail('주석 안의 --');
        i = end + 3;
      } else return;
    }
  };
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  if (text.startsWith('<?xml', i)) {
    const end = text.indexOf('?>', i);
    if (end < 0) fail('끝나지 않은 XML 선언');
    const decl = text.slice(i + 5, end);
    if (!/^\s+version\s*=\s*(["'])1\.0\1(\s+encoding\s*=\s*(["'])UTF-8\3)?(\s+standalone\s*=\s*(["'])(yes|no)\5)?\s*$/i.test(decl)) fail('XML 선언 형식');
    i = end + 2;
  }
  skipMisc();
  const parseElement = (scope) => {
    const at = i;
    if (text[i] !== '<') fail('요소 시작 < 이 와야 해요');
    i += 1;
    const name = readName();
    const attrs = Object.create(null);
    const attrOrder = [];
    let selfClose = false;
    for (;;) {
      const before = i;
      skipWs();
      if (text.startsWith('/>', i)) { i += 2; selfClose = true; break; }
      if (text[i] === '>') { i += 1; break; }
      if (i === before) fail('속성 앞에 공백이 와야 해요');
      const attrName = readName();
      skipWs();
      if (text[i] !== '=') fail('속성 = 이 와야 해요');
      i += 1;
      skipWs();
      const quote = text[i];
      if (quote !== '"' && quote !== "'") fail('속성 값 따옴표');
      const end = text.indexOf(quote, i + 1);
      if (end < 0) fail('끝나지 않은 속성 값');
      const raw = text.slice(i + 1, end);
      if (raw.includes('<')) fail('속성 값 안의 <');
      if (attrName in attrs) fail(`속성 중복 ${attrName}`);
      attrs[attrName] = decodeEntities(raw, i + 1);
      attrOrder.push(attrName);
      i = end + 1;
    }
    const ns = Object.assign(Object.create(null), scope);
    for (const a of attrOrder) {
      if (a === 'xmlns') ns[''] = attrs[a];
      else if (a.startsWith('xmlns:')) ns[a.slice(6)] = attrs[a];
    }
    const colon = name.indexOf(':');
    const prefix = colon < 0 ? '' : name.slice(0, colon);
    const local = colon < 0 ? name : name.slice(colon + 1);
    if (prefix && ns[prefix] === undefined) throw new XmlError(`선언되지 않은 접두 ${prefix}:`, at);
    for (const a of attrOrder) {
      const c = a.indexOf(':');
      if (c < 0 || a.startsWith('xmlns')) continue;
      const p = a.slice(0, c);
      if (ns[p] === undefined) throw new XmlError(`선언되지 않은 속성 접두 ${p}:`, at);
    }
    const node = {name, prefix, local, ns: ns[prefix] ?? '', attrs, attrOrder, children: [], text: '', at};
    if (selfClose) return node;
    const textParts = [];
    for (;;) {
      if (i >= n) fail(`닫히지 않은 요소 <${name}>`);
      if (text.startsWith('</', i)) {
        i += 2;
        const closing = readName();
        if (closing !== name) fail(`닫는 태그 </${closing}> 가 <${name}> 와 달라요`);
        skipWs();
        if (text[i] !== '>') fail('닫는 태그 > 가 와야 해요');
        i += 1;
        break;
      }
      if (text.startsWith('<!--', i)) { skipMisc(); continue; }
      if (text.startsWith('<!', i) || text.startsWith('<?', i)) fail('지원하지 않는 마크업(CDATA·DTD·처리 지시)');
      if (text[i] === '<') { node.children.push(parseElement(ns)); continue; }
      const next = text.indexOf('<', i);
      const end = next < 0 ? n : next;
      const raw = text.slice(i, end);
      if (raw.includes(']]>')) fail('텍스트 안의 ]]>');
      textParts.push(decodeEntities(raw, i));
      i = end;
    }
    node.text = textParts.join('');
    return node;
  };
  const root = parseElement(Object.assign(Object.create(null), {xml: NS.xml}));
  skipMisc();
  if (i !== n) fail('루트 요소 뒤에 내용이 있어요');
  return root;
}

const elementsOf = (node, local, ns) => node.children.filter((c) => c.local === local && (ns === undefined || c.ns === ns));
function* walk(node) {
  yield node;
  for (const c of node.children) yield* walk(c);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3MF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 3MF 패키지 파트들을 검사해요.
 * @param {Map<string, Uint8Array>} files 이름 → 바이트
 * @returns {{issues, model: null | {application, colorGroups: Map<id, string[]>, objects: Array, build: Array, buildTranslations: Array<number[]|null>, structure}}}
 */
export function check3mf(files) {
  const issues = [];
  const add = (code, detail) => issues.push({code, detail});
  for (const name of REQUIRED_3MF_PARTS) if (!files.has(name)) add('part-missing', name);
  for (const name of files.keys()) if (!REQUIRED_3MF_PARTS.includes(name)) add('part-extra', name);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const parse = (name) => {
    if (!files.has(name)) return null;
    try {
      const text = decoder.decode(files.get(name));
      return {text, root: parseXml(text)};
    } catch (error) {
      add('xml', `${name}: ${error.message}`);
      return null;
    }
  };
  const ct = parse('[Content_Types].xml');
  if (ct) {
    const {root} = ct;
    if (root.local !== 'Types' || root.ns !== NS.contentTypes) add('content-types', '루트·네임스페이스');
    const defaults = new Map(elementsOf(root, 'Default', NS.contentTypes).map((d) => [String(d.attrs.Extension).toLowerCase(), d.attrs.ContentType]));
    if (defaults.get('rels') !== 'application/vnd.openxmlformats-package.relationships+xml') add('content-types', 'rels');
    if (defaults.get('model') !== 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml') add('content-types', 'model');
  }
  const rels = parse('_rels/.rels');
  if (rels) {
    const {root} = rels;
    if (root.local !== 'Relationships' || root.ns !== NS.relationships) add('rels', '루트·네임스페이스');
    const models = elementsOf(root, 'Relationship', NS.relationships).filter((r) => r.attrs.Type === REL_TYPE_3DMODEL);
    if (models.length !== 1) add('rels', `3dmodel 관계 ${models.length}개`);
    else {
      if (models[0].attrs.Target !== '/3D/3dmodel.model') add('rels', `Target ${models[0].attrs.Target}`);
      if (!models[0].attrs.Id) add('rels', 'Id 없음');
    }
  }
  const parsed = parse('3D/3dmodel.model');
  if (!parsed) return {issues, model: null};
  const {text, root} = parsed;
  if (root.local !== 'model' || root.ns !== NS.core) add('namespace', `루트 ${root.name} / ${root.ns}`);
  if (root.attrs.unit !== 'millimeter') add('unit', String(root.attrs.unit));
  if (root.attrs['xmlns:m'] !== NS.material) add('namespace', 'xmlns:m');
  if ('requiredextensions' in root.attrs) add('forbidden', 'requiredextensions');
  if (!text.includes('<m:colorgroup')) add('m-prefix', '문자 그대로의 <m:colorgroup 이 없어요');
  for (const node of walk(root)) {
    if (node.local === 'basematerials') add('forbidden', 'basematerials');
    if ((node.local === 'colorgroup' || node.local === 'color') && (node.prefix !== 'm' || node.ns !== NS.material)) add('m-prefix', node.name);
  }
  const metadata = elementsOf(root, 'metadata', NS.core).filter((m) => m.attrs.name === 'Application');
  const application = metadata.length === 1 ? metadata[0].text : null;
  if (application === null) add('application', `Application 메타 ${metadata.length}개`);
  else if (application.startsWith('BambuStudio-')) add('application', application);
  const resources = elementsOf(root, 'resources', NS.core);
  const builds = elementsOf(root, 'build', NS.core);
  if (resources.length !== 1 || builds.length !== 1) {
    add('structure', `resources ${resources.length} · build ${builds.length}`);
    return {issues, model: null};
  }
  const ids = new Set();
  const colorGroups = new Map();
  const objects = new Map();
  const checkId = (node) => {
    const id = Number(node.attrs.id);
    if (!/^[1-9][0-9]*$/.test(String(node.attrs.id))) add('id', `${node.name} id=${node.attrs.id}`);
    else if (ids.has(id)) add('id-dup', String(id));
    ids.add(id);
    return id;
  };
  for (const node of resources[0].children) {
    if (node.local === 'colorgroup' && node.ns === NS.material) {
      const id = checkId(node);
      const colors = elementsOf(node, 'color', NS.material).map((c) => c.attrs.color);
      if (colors.length === 0) add('color', `그룹 ${id} 가 비었어요`);
      for (const c of colors) if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(String(c))) add('color', `그룹 ${id}: ${c}`);
      colorGroups.set(id, colors);
      continue;
    }
    if (node.local !== 'object' || node.ns !== NS.core) {
      add('resource', node.name);
      continue;
    }
    const id = checkId(node);
    const meshes = elementsOf(node, 'mesh', NS.core), comps = elementsOf(node, 'components', NS.core);
    const object = {id, name: node.attrs.name, type: node.attrs.type ?? 'model', pid: null, pindex: null, vertices: null, triangles: null, components: null};
    if (object.type !== 'model') add('object-type', `${id}: ${object.type}`);
    if (meshes.length + comps.length !== 1) add('object-shape', `${id}: mesh ${meshes.length} · components ${comps.length}`);
    if (meshes.length === 1) {
      const pid = Number(node.attrs.pid), pindex = Number(node.attrs.pindex);
      object.pid = pid;
      object.pindex = pindex;
      if (!colorGroups.has(pid)) add('pid', `${id}: pid ${node.attrs.pid} 는 앞서 정의된 색 그룹이 아니에요`);
      else if (!Number.isInteger(pindex) || pindex < 0 || pindex >= colorGroups.get(pid).length) add('pindex', `${id}: ${node.attrs.pindex}`);
      const vertexNodes = elementsOf(meshes[0], 'vertices', NS.core).flatMap((v) => elementsOf(v, 'vertex', NS.core));
      const triangleNodes = elementsOf(meshes[0], 'triangles', NS.core).flatMap((t) => elementsOf(t, 'triangle', NS.core));
      object.vertices = vertexNodes.map((v) => ['x', 'y', 'z'].map((k) => Number(v.attrs[k])));
      if (object.vertices.some((v) => v.some((x) => !Number.isFinite(x)))) add('vertex', `${id}`);
      object.triangles = triangleNodes.map((t) => ['v1', 'v2', 'v3'].map((k) => (/^[0-9]+$/.test(String(t.attrs[k])) ? Number(t.attrs[k]) : NaN)));
      const V = object.vertices.length;
      let badRange = 0, repeated = 0;
      for (const [a, b, c] of object.triangles) {
        if (![a, b, c].every((x) => Number.isInteger(x) && x >= 0 && x < V)) badRange += 1;
        if (a === b || b === c || a === c) repeated += 1;
      }
      if (badRange) add('index-range', `${id}: ${badRange}개`);
      if (repeated) add('triangle-repeat', `${id}: ${repeated}개`);
      if (object.triangles.length < 4) add('triangle-count', `${id}: ${object.triangles.length}개`);
      for (const t of triangleNodes) if ('pid' in t.attrs && !colorGroups.has(Number(t.attrs.pid))) add('pid', `${id}: 삼각형 pid`);
    } else if (comps.length === 1) {
      if ('pid' in node.attrs || 'pindex' in node.attrs) add('pid', `${id}: 부모 오브젝트에 pid`);
      object.components = elementsOf(comps[0], 'component', NS.core).map((c) => {
        if ('transform' in c.attrs) add('transform', `component ${c.attrs.objectid}`);
        const ref = Number(c.attrs.objectid);
        const target = objects.get(ref);
        if (!target) add('forward-ref', `${id} → ${c.attrs.objectid}`);
        else if (target.components) add('nested-components', `${id} → ${ref}`);
        return ref;
      });
    }
    objects.set(id, object);
  }
  // build item 변환은 «판 위 평행 이동만» 받아요: 앞 9개가 정확히 단위 행렬 문자열이고, 이동 3개(4행 m30 m31 m32)는
  // 3MF ST_Number 표기이며(16진 «0x25» · 끝 점 «37.» 은 Number() 로는 읽혀도 스펙 밖이에요) x·y ≥ 0(양의 8분 공간, 코어 §3.3
  // 권고) · z = 0(바닥이 판에 닿은 채)이에요. 회전·배율·거울은 판 배치가 아니라 기하를 바꾸므로 'transform' 이에요.
  // 이동은 buildTranslations 로 돌려줘요(없으면 null).
  const ST_NUMBER = /^[-+]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
  const buildTranslations = [];
  const build = elementsOf(builds[0], 'item', NS.core).map((item) => {
    let translation = null;
    if ('transform' in item.attrs) {
      const fields = String(item.attrs.transform).trim().split(/\s+/);
      const identity = ['1', '0', '0', '0', '1', '0', '0', '0', '1'];
      const moveFields = fields.slice(9), move = moveFields.map(Number);
      const moveOk = moveFields.every((f) => ST_NUMBER.test(f)) && move.every(Number.isFinite) && move[0] >= 0 && move[1] >= 0 && move[2] === 0;
      if (fields.length !== 12 || fields.slice(0, 9).some((f, k) => f !== identity[k]) || !moveOk) add('transform', `item ${item.attrs.objectid}: ${item.attrs.transform}`);
      else translation = move;
    }
    buildTranslations.push(translation);
    const ref = Number(item.attrs.objectid);
    if (!objects.has(ref)) add('build-ref', String(item.attrs.objectid));
    return ref;
  });
  if (build.length === 0) add('build', 'build item 이 없어요');
  // 모든 mesh 오브젝트는 build 에서 정확히 한 번 닿아야 해요(부모 components 경유든 item 직접이든).
  const reach = new Map();
  const visit = (ref) => {
    const o = objects.get(ref);
    if (!o) return;
    if (o.components) o.components.forEach(visit);
    else reach.set(ref, (reach.get(ref) ?? 0) + 1);
  };
  build.forEach(visit);
  for (const o of objects.values()) {
    if (o.components) continue;
    const count = reach.get(o.id) ?? 0;
    if (count !== 1) add('reach', `mesh 오브젝트 ${o.id} 가 build 에서 ${count}번 닿아요`);
  }
  const parents = [...objects.values()].filter((o) => o.components);
  let structure = 'other';
  if (parents.length === 1 && build.length === 1 && build[0] === parents[0].id) structure = 'components';
  else if (parents.length === 0 && build.length === objects.size) structure = 'items';
  return {issues, model: {application, colorGroups, objects: [...objects.values()], build, buildTranslations, structure}};
}

/** ZIP 바이트를 읽어 3MF 검사까지 해요. 두 단계 문제를 합쳐 돌려줘요. */
export function check3mfZip(bytes) {
  const zip = readZip(bytes);
  const files = new Map(zip.entries.filter((e) => e.data).map((e) => [e.name, e.data]));
  const pkg = check3mf(files);
  return {zip, files, issues: [...zip.issues, ...pkg.issues], model: pkg.model};
}

// ─────────────────────────────────────────────────────────────────────────────
// binary STL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * binary STL 을 읽어요. 법선은 단위벡터(|n|−1 < 1e-5)이거나, 넓이 0 삼각형에 한해 0 이어야 하고,
 * 단위 법선은 꼭짓점 순서의 오른손 외적과 같은 쪽이어야 해요.
 */
export function parseBinaryStl(bytes) {
  const issues = [];
  const add = (code, detail) => issues.push({code, detail});
  if (bytes.length < 84) {
    add('length', `${bytes.length} B`);
    return {header: '', count: 0, triangles: [], issues};
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = String.fromCharCode(...bytes.subarray(0, 80)).replace(/\0+$/, '');
  if (/^\s*solid/i.test(header)) add('header-solid', header.slice(0, 20));
  const count = view.getUint32(80, true);
  if (bytes.length !== 84 + 50 * count) add('length', `${bytes.length} ≠ 84 + 50·${count}`);
  const available = Math.min(count, Math.floor((bytes.length - 84) / 50));
  const triangles = [];
  for (let t = 0; t < available; t += 1) {
    const o = 84 + 50 * t;
    const f = (k) => view.getFloat32(o + 4 * k, true);
    const normal = [f(0), f(1), f(2)];
    const v = [[f(3), f(4), f(5)], [f(6), f(7), f(8)], [f(9), f(10), f(11)]];
    const attr = view.getUint16(o + 48, true);
    triangles.push({normal, v, attr});
    if (attr !== 0) add('attribute', `삼각형 ${t}: ${attr}`);
    if (![...normal, ...v.flat()].every(Number.isFinite)) {
      add('vertex', `삼각형 ${t}`);
      continue;
    }
    const u = v[1].map((x, k) => x - v[0][k]), w = v[2].map((x, k) => x - v[0][k]);
    const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const crLen = Math.hypot(...cr), nLen = Math.hypot(...normal);
    if (nLen === 0) {
      if (crLen > 1e-9) add('normal', `삼각형 ${t}: 넓이가 있는데 법선이 0`);
    } else if (Math.abs(nLen - 1) > 1e-5) add('normal', `삼각형 ${t}: |n| = ${nLen}`);
    else if (crLen > 1e-9 && (normal[0] * cr[0] + normal[1] * cr[1] + normal[2] * cr[2]) / crLen < 0.999) add('normal-winding', `삼각형 ${t}`);
  }
  return {header, count, triangles, issues};
}

/** 닫힌 삼각형 묶음의 부호 있는 부피 Σ v1·(v2×v3)/6 이에요(바깥 법선이면 양수). */
export function signedVolume(triangles) {
  let sum = 0;
  for (const [a, b, c] of triangles) {
    sum += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

export const issueCodes = (issues) => [...new Set(issues.map((i) => i.code))].sort();
