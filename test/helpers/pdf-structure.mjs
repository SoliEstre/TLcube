/**
 * PDF 파서 없이 PDF 1쪽 파일의 구조를 재는 자예요(설계 §6-18).
 *
 * 앞에서부터 객체를 차례로 걸어서(«N G obj» · 사전 · /Length 만큼의 스트림 · endobj) 실제 객체 위치를 구하고,
 * 그것을 xref 표 · trailer · startxref 와 따로 대조해요. xref 를 믿고 객체를 찾지 않으므로 오프셋이 틀리면
 * 드러나요. 각 검사는 필드 하나씩이라 심은 결함마다 어느 필드가 빨개지는지 단언할 수 있어요.
 *
 * 콘텐츠 스트림은 토큰(수 · 이름 · 연산자)으로 읽어서 채움(f)과 이미지(Do) 사건 목록으로 바꿔요.
 * fillReport 는 그 사건 목록을 입력 mm 장면과 대조해요: 모든 도형이 제 색으로 정확히 한 번 · 같은 면·같은 색은
 * 채움 하나 · 겹치는 다른 색은 장면 순서 · 한 채움 안 부분경로 방향 일치. 실제 종이 도안 대조도 이 자를 써요.
 */
import {inflateSync} from 'node:zlib';

const latin1 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

/** s[pos] 의 '<<' 와 짝이 맞는 '>>' 바로 뒤 위치(없으면 −1). 이 작성기의 사전에는 문자열이 없어요. */
function dictEnd(s, pos) {
  if (!s.startsWith('<<', pos)) return -1;
  let depth = 0;
  for (let k = pos; k < s.length - 1; k += 1) {
    if (s[k] === '<' && s[k + 1] === '<') {
      depth += 1;
      k += 1;
    } else if (s[k] === '>' && s[k + 1] === '>') {
      depth -= 1;
      k += 1;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

export const dictInt = (dict, key) => {
  const m = new RegExp(`/${key} (\\d+)(?![\\d.])(?! \\d+ R)`).exec(dict);
  return m ? Number(m[1]) : null;
};
export const dictRef = (dict, key) => {
  const m = new RegExp(`/${key} (\\d+) 0 R`).exec(dict);
  return m ? Number(m[1]) : null;
};
export const dictName = (dict, key) => {
  const m = new RegExp(`/${key} /([A-Za-z0-9]+)`).exec(dict);
  return m ? m[1] : null;
};
export const dictArray = (dict, key) => {
  const m = new RegExp(`/${key} \\[([^\\]]*)\\]`).exec(dict);
  return m ? m[1].trim().split(/\s+/) : null;
};
/** Resources 의 /XObject << /Im0 5 0 R … >> → Map(이름 → 객체 번호). */
export function xobjectRefs(pageDict) {
  const out = new Map();
  const m = /\/XObject <<([^>]*)>>/.exec(pageDict);
  if (!m) return out;
  for (const r of m[1].matchAll(/\/([A-Za-z0-9]+) (\d+) 0 R/g)) out.set(r[1], Number(r[2]));
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {object} 필드별 판정(…Ok), 걸어서 찾은 객체(Map), xref 원자료, 오류 문장 목록
 */
export function inspectPdf(bytes) {
  const s = latin1(bytes);
  const r = {
    bytes, text: s, errors: [], objects: new Map(),
    headerOk: false, binaryCommentOk: false, walkOk: true, lengthsOk: true, duplicateObjects: [],
    xrefFound: false, xrefEntryBytesOk: false, xrefZeroEntryOk: false, xrefOffsetsOk: false, unlistedObjects: [],
    trailerOk: false, trailerSizeOk: false, rootOk: false, startxrefOk: false, eofOk: false,
  };
  const header = /^%PDF-1\.[0-7]\n/.exec(s);
  r.headerOk = !!header;
  let pos = header ? header[0].length : 0;
  const lineEnd = s.indexOf('\n', pos);
  const comment = lineEnd < 0 ? '' : s.slice(pos, lineEnd);
  r.binaryCommentOk = comment.startsWith('%') && [...comment.slice(1)].filter((ch) => ch.charCodeAt(0) >= 128).length >= 4;
  pos = lineEnd + 1;

  // ── 객체를 앞에서부터 걸어요 ──
  let walkedXref = -1;
  for (let guard = 0; guard < 100000; guard += 1) {
    while (pos < s.length && /\s/.test(s[pos])) pos += 1;
    if (s.startsWith('xref', pos)) {
      walkedXref = pos;
      break;
    }
    const m = /^(\d+) (\d+) obj\n/.exec(s.slice(pos, pos + 40));
    if (!m) {
      r.walkOk = false;
      r.errors.push(`객체 시작이 아니에요 @${pos}`);
      break;
    }
    const num = Number(m[1]);
    const offset = pos;
    pos += m[0].length;
    const end = dictEnd(s, pos);
    if (end < 0) {
      r.walkOk = false;
      r.errors.push(`객체 ${num}: 사전이 닫히지 않아요`);
      break;
    }
    const dict = s.slice(pos, end);
    pos = end;
    let stream = null;
    const marker = s.startsWith('\nstream\n', pos) ? '\nstream\n' : s.startsWith('\nstream\r\n', pos) ? '\nstream\r\n' : null;
    if (marker) {
      const start = pos + marker.length;
      const declared = dictInt(dict, 'Length');
      let length = declared;
      if (declared === null || !/^\r?\nendstream/.test(s.slice(start + declared, start + declared + 12))) {
        r.lengthsOk = false;
        r.errors.push(`객체 ${num}: /Length ${declared} 뒤가 endstream 이 아니에요`);
        const found = s.indexOf('\nendstream', start);
        if (found < 0) {
          r.walkOk = false;
          break;
        }
        length = found - start;
      }
      stream = {start, length, declared};
      pos = start + length;
      pos += s.startsWith('\r\n', pos) ? 2 : 1;
      pos += 'endstream'.length;
    }
    if (!/^\r?\nendobj/.test(s.slice(pos, pos + 10))) {
      r.walkOk = false;
      r.errors.push(`객체 ${num}: endobj 가 없어요`);
      break;
    }
    pos = s.indexOf('endobj', pos) + 'endobj'.length;
    if (r.objects.has(num)) r.duplicateObjects.push(num);
    r.objects.set(num, {num, offset, dict, stream});
  }

  // ── startxref · %%EOF ──
  const tail = /startxref\n(\d+)\n%%EOF\n?$/.exec(s);
  r.eofOk = !!tail;
  r.startxref = tail ? Number(tail[1]) : NaN;
  r.startxrefOk = !!tail && walkedXref >= 0 && r.startxref === walkedXref && s.startsWith('xref', r.startxref);

  // ── xref 표 ──
  const xrefAt = walkedXref >= 0 ? walkedXref : r.startxref;
  const head = Number.isInteger(xrefAt) ? /^xref\n0 (\d+)\n/.exec(s.slice(xrefAt, xrefAt + 40)) : null;
  r.xrefFound = !!head;
  r.xrefEntries = [];
  if (head) {
    const count = Number(head[1]);
    let p = xrefAt + head[0].length;
    let bytesOk = true;
    for (let k = 0; k < count; k += 1) {
      const entry = s.slice(p, p + 20);
      const m = /^(\d{10}) (\d{5}) ([nf])(?: \n| \r|\r\n)$/.exec(entry);
      if (!m) {
        bytesOk = false;
        r.errors.push(`xref 항목 ${k} 가 20 B 형식이 아니에요: ${JSON.stringify(entry)}`);
        break;
      }
      r.xrefEntries.push({offset: Number(m[1]), generation: Number(m[2]), type: m[3]});
      p += 20;
    }
    r.xrefEntryBytesOk = bytesOk && r.xrefEntries.length === count;
    const zero = r.xrefEntries[0];
    r.xrefZeroEntryOk = !!zero && zero.offset === 0 && zero.generation === 65535 && zero.type === 'f';
    r.xrefOffsetsOk = r.xrefEntryBytesOk && r.xrefEntries.slice(1).every((e, i) => {
      const num = i + 1;
      const walked = r.objects.get(num);
      const ok = e.type === 'n' && e.generation === 0 && !!walked && walked.offset === e.offset
        && s.startsWith(`${num} 0 obj`, e.offset);
      if (!ok) r.errors.push(`xref ${num}: ${e.offset} 이 «${num} 0 obj» 를 가리키지 않아요`);
      return ok;
    });
    r.unlistedObjects = [...r.objects.keys()].filter((num) => num < 1 || num >= count);
    const trailer = /^trailer\n(<<[\s\S]*?>>)\n/.exec(s.slice(p));
    r.trailerOk = !!trailer;
    if (trailer) {
      r.trailer = {size: dictInt(trailer[1], 'Size'), root: dictRef(trailer[1], 'Root')};
      r.trailerSizeOk = r.trailer.size === count && count === r.objects.size + 1;
      const root = r.objects.get(r.trailer.root);
      r.rootOk = !!root && dictName(root.dict, 'Type') === 'Catalog';
    }
  }
  return r;
}

/** 구조 판정 필드가 모두 참인지(심은 결함 fixture 의 대조용). */
export const STRUCTURE_FIELDS = Object.freeze([
  'headerOk', 'binaryCommentOk', 'walkOk', 'lengthsOk', 'xrefFound', 'xrefEntryBytesOk', 'xrefZeroEntryOk',
  'xrefOffsetsOk', 'trailerOk', 'trailerSizeOk', 'rootOk', 'startxrefOk', 'eofOk',
]);
export function structureFailures(report) {
  const out = STRUCTURE_FIELDS.filter((k) => report[k] !== true);
  if (report.unlistedObjects.length) out.push('unlistedObjects');
  if (report.duplicateObjects.length) out.push('duplicateObjects');
  return out;
}

export function streamBytes(report, num) {
  const o = report.objects.get(num);
  if (!o || !o.stream) throw new Error(`객체 ${num} 에 스트림이 없어요`);
  return report.bytes.subarray(o.stream.start, o.stream.start + o.stream.length);
}
export const inflateStream = (report, num) => new Uint8Array(inflateSync(streamBytes(report, num)));

/** 문서 그래프: Catalog → Pages → Page → Contents · XObject. */
export function pageInfo(report) {
  const catalog = report.objects.get(report.trailer.root);
  const pages = report.objects.get(dictRef(catalog.dict, 'Pages'));
  const kids = /\/Kids \[(\d+) 0 R\]/.exec(pages.dict);
  const page = report.objects.get(Number(kids[1]));
  return {
    catalog, pages, page,
    count: dictInt(pages.dict, 'Count'),
    parent: dictRef(page.dict, 'Parent'),
    mediaBox: dictArray(page.dict, 'MediaBox'),
    contents: dictRef(page.dict, 'Contents'),
    xobjects: xobjectRefs(page.dict),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 콘텐츠 스트림
// ─────────────────────────────────────────────────────────────────────────────

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

/** 콘텐츠 → [{op, args}]. 수는 Number, 이름은 '/Im0' 문자열이에요. */
export function tokenizeContent(text) {
  const ops = [];
  let args = [];
  for (const t of text.split(/\s+/)) {
    if (!t) continue;
    if (NUMBER.test(t)) args.push(Number(t));
    else if (t.startsWith('/')) args.push(t);
    else {
      ops.push({op: t, args});
      args = [];
    }
  }
  return {ops, trailingArgs: args};
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
export const applyCtm = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * 연산자 목록 → 사건 목록. 채움은 {type:'fill', color:{r,g,b}(0..255 반올림), subpaths, ctm},
 * 이미지는 {type:'image', name, ctm}. 부분경로는 {kind:'re', x, y, w, h} 또는 {kind:'path', pts, curves}.
 * 이 작성기가 쓰지 않는 연산자는 unknownOps 에 모아요.
 */
export function contentEvents(ops) {
  const events = [];
  const unknownOps = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let color = null;
  let subpaths = [];
  let current = null;
  for (const {op, args} of ops) {
    switch (op) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() ?? ctm; break;
      case 'cm': ctm = mul(args, ctm); break;
      case 'rg': color = {r: Math.round(args[0] * 255), g: Math.round(args[1] * 255), b: Math.round(args[2] * 255), raw: args}; break;
      case 're': subpaths.push({kind: 're', x: args[0], y: args[1], w: args[2], h: args[3]}); current = null; break;
      case 'm': current = {kind: 'path', pts: [[args[0], args[1]]], curves: false}; subpaths.push(current); break;
      case 'l': current.pts.push([args[0], args[1]]); break;
      case 'c': current.pts.push([args[4], args[5]]); current.curves = true; break;
      case 'h': current = null; break;
      case 'f': events.push({type: 'fill', color, subpaths, ctm}); subpaths = []; current = null; break;
      case 'Do': events.push({type: 'image', name: args[0].slice(1), ctm}); break;
      default: unknownOps.push(op);
    }
  }
  return {events, unknownOps, qDepth: stack.length, danglingSubpaths: subpaths.length};
}

// ─────────────────────────────────────────────────────────────────────────────
// 콘텐츠 ↔ 장면 대조 자
// ─────────────────────────────────────────────────────────────────────────────

const qv = (v) => Math.round(v * 1e4);
function rectKeyQ(qs) {
  if (qs.length !== 4) return null;
  for (let k = 0; k < 4; k += 1) {
    const [ax, ay] = qs[k], [bx, by] = qs[(k + 1) % 4];
    if ((ax === bx) === (ay === by)) return null;
  }
  const xs = qs.map((p) => p[0]), ys = qs.map((p) => p[1]);
  if (new Set(qs.map((p) => p.join(','))).size !== 4) return null;
  return `R:${Math.min(...xs)},${Math.min(...ys)},${Math.max(...xs)},${Math.max(...ys)}`;
}
const polyKey = (qs) => rectKeyQ(qs) ?? `P:${qs.map((p) => p.join(',')).sort().join(';')}`;
export const pointsKey = (points) => polyKey(points.map((p) => [qv(p.x), qv(p.y)]));
export function subpathKey(sp) {
  if (sp.kind === 're') return `R:${qv(sp.x)},${qv(sp.y)},${qv(sp.x + sp.w)},${qv(sp.y + sp.h)}`;
  if (sp.curves) return `C:${sp.pts.map((p) => p.map(qv).join(',')).sort().join(';')}`;
  return polyKey(sp.pts.map((p) => p.map(qv)));
}
/** 원은 m 점과 베지어 끝점 넷(원 위 네 점 + 시작점)으로 알아봐요. */
const discKey = (s) => {
  const pts = [[s.cx + s.r, s.cy], [s.cx, s.cy + s.r], [s.cx - s.r, s.cy], [s.cx, s.cy - s.r], [s.cx + s.r, s.cy]];
  return `C:${pts.map((p) => p.map(qv).join(',')).sort().join(';')}`;
};
/** 부분경로의 넓이 부호(re 는 w·h, 경로는 꼭짓점 신발끈 — 베지어는 끝점만 봐요). */
function subpathSign(sp) {
  if (sp.kind === 're') return Math.sign(sp.w * sp.h);
  let s = 0;
  for (let k = 0; k < sp.pts.length; k += 1) {
    const [ax, ay] = sp.pts[k], [bx, by] = sp.pts[(k + 1) % sp.pts.length];
    s += ax * by - ay * bx;
  }
  return Math.abs(s) < 1e-9 ? 0 : Math.sign(s);
}
export const colorKey = (c) => `${c.r},${c.g},${c.b}`;
const scaled = (c, g) => (g === 1 ? c : {r: Math.round(c.r * g), g: Math.round(c.g * g), b: Math.round(c.b * g)});
const bboxOf = (points) => [Math.min(...points.map((p) => p.x)), Math.min(...points.map((p) => p.y)),
  Math.max(...points.map((p) => p.x)), Math.max(...points.map((p) => p.y))];
const overlaps = (p, q) => Math.min(p[2], q[2]) - Math.max(p[0], q[0]) > 1e-6 && Math.min(p[3], q[3]) - Math.max(p[1], q[1]) > 1e-6;
export const imageHasAlpha = (image) => image.pixels.some((v, k) => k % 4 === 3 && v !== 255);

/**
 * mm 장면(pdf-writer 입력)이 기대하는 칠 목록(배경 → 도형 순, 알파 이미지는 바탕 채움 + 이미지)을 만들고, 사건 목록과 대조해요.
 * @returns {{missing, unmatched, colorMismatch, split, orderViolations, imageCountOk, fills}}
 */
export function fillReport(scene, events) {
  const expected = [];
  if (scene.background !== null) {
    expected.push({key: `R:0,0,${qv(scene.width)},${qv(scene.height)}`, color: scene.background,
      bbox: [0, 0, scene.width, scene.height], order: expected.length, kind: 'fill'});
  }
  scene.shapes.forEach((s, index) => {
    if (s.kind === 'polygon') {
      if (s.points.length < 3) return;
      expected.push({key: pointsKey(s.points), color: s.color, bbox: bboxOf(s.points), face: s.face, index, order: expected.length, kind: 'fill'});
    } else if (s.kind === 'disc') {
      expected.push({key: discKey(s), color: s.color, bbox: [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r], index, order: expected.length, kind: 'fill'});
    } else if (s.kind === 'image') {
      const gain = Number.isFinite(s.gain) ? Math.min(1, Math.max(0, s.gain)) : 1;
      if (imageHasAlpha(s.image)) {
        const qs = s.points.map((p) => [qv(p.x), qv(p.y)]);
        expected.push({key: `P:${qs.map((p) => p.join(',')).sort().join(';')}`, altKey: polyKey(qs), color: scaled(s.color, gain),
          bbox: bboxOf(s.points), index, order: expected.length, kind: 'fill', imageBackground: true});
      }
      expected.push({kind: 'image', bbox: bboxOf(s.points), index, order: expected.length});
    }
  });
  const byKey = new Map();
  for (const e of expected) {
    if (e.kind !== 'fill') continue;
    for (const k of new Set([e.key, e.altKey].filter(Boolean))) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }
  }
  const unmatched = [], colorMismatch = [];
  const images = expected.filter((e) => e.kind === 'image');
  let imageCursor = 0;
  events.forEach((ev, evIndex) => {
    if (ev.type === 'image') {
      const e = images[imageCursor++];
      if (e) e.event = evIndex;
      return;
    }
    for (const sp of ev.subpaths) {
      const list = byKey.get(subpathKey(sp)) ?? [];
      const e = list.find((x) => x.event === undefined);
      if (!e) {
        unmatched.push({evIndex, key: subpathKey(sp)});
        continue;
      }
      e.event = evIndex;
      if (colorKey(ev.color) !== colorKey(e.color) || ev.color.raw.some((v, k) => Math.abs(v * 255 - [e.color.r, e.color.g, e.color.b][k]) > 0.02)) {
        colorMismatch.push({evIndex, index: e.index, want: e.color, got: ev.color});
      }
    }
  });
  const missing = expected.filter((e) => e.event === undefined).map((e) => ({index: e.index, kind: e.kind, key: e.key}));
  // 같은 면·같은 색 모듈이 채움 하나에 모였나.
  const faceColor = new Map();
  for (const e of expected) {
    if (e.kind !== 'fill' || !e.face || e.event === undefined) continue;
    const k = `${e.face}|${colorKey(e.color)}`;
    if (!faceColor.has(k)) faceColor.set(k, new Set());
    faceColor.get(k).add(e.event);
  }
  const split = [...faceColor].filter(([, set]) => set.size !== 1).map(([k, set]) => ({faceColor: k, fills: [...set]}));
  // 겹치는(bbox) 다른 색 쌍은 장면 순서대로 칠해져야 해요. 이미지는 어떤 색과도 다른 것으로 봐요.
  // x 로 정렬해 쓸어 가며 겹칠 수 있는 쌍만 봐요(전 쌍 비교와 같은 결과, H8 에서 수십 배 빨라요).
  const orderViolations = [];
  const tone = (e) => (e.kind === 'image' ? `image#${e.order}` : colorKey(e.color));
  const byX = expected.filter((e) => e.event !== undefined).sort((p, q) => p.bbox[0] - q.bbox[0]);
  for (let i = 0; i < byX.length; i += 1) {
    for (let j = i + 1; j < byX.length && byX[j].bbox[0] < byX[i].bbox[2] - 1e-6; j += 1) {
      const [a, b] = byX[i].order < byX[j].order ? [byX[i], byX[j]] : [byX[j], byX[i]];
      if (tone(a) === tone(b) || !overlaps(a.bbox, b.bbox)) continue;
      if (!(a.event < b.event)) orderViolations.push({first: a.index ?? 'background', second: b.index, events: [a.event, b.event]});
    }
  }
  // 한 채움 안의 부분경로는 모두 같은 방향이어야 nonzero 채움이 합집합이에요(반대 방향이 겹치면 구멍).
  const orientationMixed = [];
  events.forEach((ev, evIndex) => {
    if (ev.type !== 'fill' || ev.subpaths.length < 2) return;
    if (new Set(ev.subpaths.map(subpathSign).filter((v) => v !== 0)).size > 1) orientationMixed.push(evIndex);
  });
  return {
    missing, unmatched, colorMismatch, split, orderViolations, orientationMixed,
    imageCountOk: imageCursor === images.length,
    fills: events.filter((e) => e.type === 'fill').length,
  };
}

export const cleanFillReport = (r) => r.missing.length === 0 && r.unmatched.length === 0 && r.colorMismatch.length === 0
  && r.split.length === 0 && r.orderViolations.length === 0 && r.orientationMixed.length === 0 && r.imageCountOk;

/** PDF 바이트 → 구조 판정 · 쪽 정보 · 콘텐츠 원문 · 연산자 · 사건 목록. */
export function parsePdf(bytes) {
  const report = inspectPdf(bytes);
  const info = pageInfo(report);
  const content = Buffer.from(inflateStream(report, info.contents)).toString('latin1');
  const tokens = tokenizeContent(content);
  const events = contentEvents(tokens.ops);
  return {report, info, content, tokens, ...events};
}
