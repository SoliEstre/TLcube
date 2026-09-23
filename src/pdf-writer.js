/**
 * pdf-writer.js — mm 장면을 벡터 PDF 한 쪽으로 옮겨요 (설계 §3.8 PDF).
 *
 * 입력 장면은 sceneToSvg 가 받는 구조 그대로예요: {width, height, background, shapes}. 단위는 mm 이고
 * (scene.unit 이 있으면 'mm' 이어야 해요) y 는 아래로 자라요. 도형은 polygon · disc · image 를 받아요.
 * 음영 레이어(scene.shading)는 종이 도안에 쓰지 않아서 받지 않아요 — 조용히 빠뜨리지 않고 던져요.
 *
 * 뼈대(ISO 32000-1 최소 구성)
 * - `%PDF-1.4` 다음 줄에 128 이상 바이트 4개짜리 주석을 둬요(이진 파일 표시).
 * - 1 Catalog · 2 Pages · 3 Page · 4 콘텐츠 스트림 · 5 이후 면 이미지 XObject(알파가 있으면 바로 뒤에 SMask).
 * - xref 항목은 `oooooooooo 00000 n` + 공백 + LF 로 정확히 20 B 예요. trailer · startxref · %%EOF 로 끝나요.
 * - MediaBox 는 pt = mm·72/25.4 를 소수 3자리로 적어요(A4 → 595.276 841.890).
 *
 * 콘텐츠
 * - 앞에 `q 2.834646 0 0 -2.834646 0 {Hpt} cm` 을 걸어 장면의 mm · y 아래 좌표를 그대로 써요.
 * - 같은 색 도형은 경로 하나의 부분경로로 이어 붙이고 `f` 한 번으로 칠해요. 이웃 모듈 사각형이 한 채움 안에서
 *   합쳐져 뷰어 앤티에일리어싱 이음선이 생기지 않아요. 행 단위로 따로 칠하면 행 경계가 남아서 그렇게 하지 않아요.
 * - 묶기는 painter 순서를 바꾸지 않을 때만 해요. 도형을 앞선 같은 색 묶음으로 끌어올리려면, 그 묶음 뒤에 칠해질
 *   다른 색 도형(이미지 포함)과 bbox 가 넓이 있게 겹치지 않아야 해요. 겹치면 새 묶음을 열어요.
 * - 모든 부분경로를 같은 방향(re 와 같은 양의 넓이)으로 맞춰서 nonzero 채움이 합집합이 되게 해요.
 *   스스로 교차하는 다각형은 방향을 맞출 수 없어서 혼자 칠해요(다른 도형이 합류하지 않아요).
 * - 좌표는 0.1 µm 정수 격자로 한 번 양자화해서 적어요. 이웃 사각형이 공유하는 변이 문자열까지 같아져요.
 *
 * 면 이미지
 * - RGB 8비트 XObject 이고, 네 꼭짓점(TL·TR·BR·BL)을 `cm` 아핀으로 놓아요. 이미지 단위 정사각형의 원점이
 *   왼쪽 아래라서 y 축은 BL→TL 로 잡아요. 평행사변형이 아닌 사각형(원근)은 아핀 한 번으로 못 놓아서 던져요.
 * - 알파가 255 가 아닌 픽셀이 있으면 DeviceGray SMask 를 붙이고, 그 아래를 shape.color 로 먼저 칠해요.
 *   SVG·래스터가 알파를 shape.color 위에 합성하는 것과 같은 결과예요. gain(<1)은 색과 바탕에 곱해요.
 *
 * 압축
 * - 동기(sceneToPdfSync)는 png.js 의 고정 허프만 zlibWrap 이라 같은 입력이면 바이트가 같아요.
 * - 비동기(sceneToPdf)는 CompressionStream('deflate')(RFC 1950 zlib = FlateDecode)를 쓰고, 생성자가 없거나
 *   도중에 실패하면 zlibWrap 으로 내요. 두 경로 모두 풀면 같은 원문이에요.
 * - 폰트 객체는 없어요. 글자는 장면이 이미 다각형으로 들고 와요(설계 §3.7).
 */
import {zlibWrap} from './png.js';
import {assertSceneImage} from './scene-image.js';

/** 1 mm 의 pt 수(72/25.4). */
export const PT_PER_MM = 72 / 25.4;
/** 콘텐츠 앞 cm 의 배율 표기(설계 §3.8 고정 문자열). */
export const PDF_CTM_SCALE = '2.834646';
/** PDF 1.4 뷰어의 쪽 크기 한계 14 400 pt(200 in)예요. */
const MAX_PAGE_MM = 5080;
/** 좌표 양자화 단위: 1e-4 mm. */
const Q = 1e4;
/** bbox 겹침 판정 여유(mm). 공유 변의 부동소수 잡음(1e-14 규모)을 겹침으로 세지 않아요. */
const OVERLAP_EPS = 1e-6;
/** 단순 다각형 검사를 하는 꼭짓점 수 상한. 넘으면 보수적으로 «합류 안 함»이에요. */
const MAX_SIMPLE_CHECK = 64;
/** 공간 해시에서 칸을 이만큼 넘게 덮는 bbox 는 «큰 도형» 목록으로 따로 봐요. */
const MAX_CELLS_PER_ENTRY = 1024;
/** 원을 3차 베지어 4개로 근사하는 상수. */
const KAPPA = 0.5522847498307936;
const ENCODER = new TextEncoder();

// ─────────────────────────────────────────────────────────────────────────────
// 수 표기
// ─────────────────────────────────────────────────────────────────────────────

const quantize = (v) => {
  const n = Math.round(v * Q);
  return n === 0 ? 0 : n; // -0 을 0 으로
};

/** 1e-4 단위 정수 → 고정 소수 문자열(뒤 0 제거). 지수 표기가 나오지 않아요. */
function fmtQ(n) {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const whole = Math.floor(a / Q);
  const frac = a - whole * Q;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(frac).padStart(4, '0').replace(/0+$/, '')}`;
}

const fmt = (v) => fmtQ(quantize(v));
const ptBox = (mm) => (mm * PT_PER_MM).toFixed(3);

// ─────────────────────────────────────────────────────────────────────────────
// 입력 검증
// ─────────────────────────────────────────────────────────────────────────────

function checkColor(c, label) {
  if (!c || typeof c !== 'object' || ![c.r, c.g, c.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new TypeError(`${label} 색은 0..255 정수 {r,g,b} 여야 해요 — 투명은 scene.background 에만 둬요`);
  }
  return c;
}

const colorKey = (c) => `${c.r},${c.g},${c.b}`;
const rgOp = (c) => `${fmt(c.r / 255)} ${fmt(c.g / 255)} ${fmt(c.b / 255)} rg`;

function checkPoints(points, label, min = 0) {
  if (!Array.isArray(points) || points.length < min) throw new TypeError(`${label}.points 는 배열이어야 해요`);
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new TypeError(`${label}.points 에 유한하지 않은 꼭짓점이 있어요`);
  }
  return points;
}

function checkPageMm(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_PAGE_MM) {
    throw new RangeError(`${label} 는 0 초과 ${MAX_PAGE_MM} mm 이하여야 해요: ${v}`);
  }
  return v;
}

function pageOf(scene, opts) {
  if (!scene || typeof scene !== 'object') throw new TypeError('scene 은 객체여야 해요');
  if (!opts || typeof opts !== 'object') throw new TypeError('옵션은 객체여야 해요');
  if (scene.unit !== undefined && scene.unit !== 'mm') throw new RangeError(`PDF 장면 단위는 mm 여야 해요: ${scene.unit}`);
  checkPageMm(scene.width, 'scene.width');
  checkPageMm(scene.height, 'scene.height');
  const widthMm = checkPageMm(opts.widthMm === undefined ? scene.width : opts.widthMm, 'widthMm');
  const heightMm = checkPageMm(opts.heightMm === undefined ? scene.height : opts.heightMm, 'heightMm');
  if (scene.width > widthMm + 1e-9 || scene.height > heightMm + 1e-9) {
    throw new RangeError(`장면(${scene.width}×${scene.height} mm)이 쪽(${widthMm}×${heightMm} mm)보다 커서 잘려요`);
  }
  if (!Array.isArray(scene.shapes)) throw new TypeError('scene.shapes 는 배열이어야 해요');
  if (Array.isArray(scene.shading) && scene.shading.length > 0) {
    throw new RangeError('PDF 작성기는 음영 레이어(scene.shading)를 그리지 않아요');
  }
  if (scene.background !== null) checkColor(scene.background, 'scene.background');
  return {widthMm, heightMm, widthPt: ptBox(widthMm), heightPt: ptBox(heightMm)};
}

// ─────────────────────────────────────────────────────────────────────────────
// 도형 → 칠할 항목
// ─────────────────────────────────────────────────────────────────────────────

const bboxOfQ = (qs) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of qs) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0 / Q, y0 / Q, x1 / Q, y1 / Q];
};

/** 양자화된 꼭짓점 4개가 축정렬 직사각형이면 [x0,y0,x1,y1](정수)을, 아니면 null 이에요. */
function axisRectQ(qs) {
  if (qs.length !== 4) return null;
  for (let k = 0; k < 4; k += 1) {
    const [ax, ay] = qs[k], [bx, by] = qs[(k + 1) % 4];
    if ((ax === bx) === (ay === by)) return null; // 변마다 한 좌표만 바뀌어야 해요
  }
  const xs = qs.map((p) => p[0]), ys = qs.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x0 === x1 || y0 === y1) return null;
  if (new Set(qs.map((p) => `${p[0]},${p[1]}`)).size !== 4) return null;
  return [x0, y0, x1, y1];
}

/** 부호 있는 넓이의 두 배(원점을 첫 꼭짓점으로 옮겨 계산해요). */
function area2Q(qs) {
  const [ox, oy] = qs[0];
  let s = 0;
  for (let k = 1; k + 1 < qs.length; k += 1) {
    const ax = qs[k][0] - ox, ay = qs[k][1] - oy, bx = qs[k + 1][0] - ox, by = qs[k + 1][1] - oy;
    s += ax * by - ay * bx;
  }
  return s;
}

const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const onSegment = (a, b, p) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
  && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

/** 닫힌 선분 두 개가 만나는지(끝점 접촉 포함). 정수 좌표라 정확해요. */
function segmentsMeet(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d))
    || (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b));
}

/** 단순 다각형(자기 교차·접촉·되짚기 없음)인지. 크면 보수적으로 false 예요. */
function isSimpleQ(qs) {
  const n = qs.length;
  if (n < 3 || n > MAX_SIMPLE_CHECK) return false;
  for (let k = 0; k < n; k += 1) {
    const a = qs[k], b = qs[(k + 1) % n];
    if (a[0] === b[0] && a[1] === b[1]) return false;
  }
  for (let i = 0; i < n; i += 1) {
    const a = qs[i], b = qs[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      const c = qs[j], d = qs[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // 공유 꼭짓점에서 되짚어 겹치는지(일직선 반대 방향)만 봐요.
        const [p, s, t] = j === i + 1 ? [a, b, d] : [c, a, b];
        if (orient(p, s, t) === 0 && (s[0] - p[0]) * (t[0] - s[0]) + (s[1] - p[1]) * (t[1] - s[1]) < 0) return false;
        continue;
      }
      if (segmentsMeet(a, b, c, d)) return false;
    }
  }
  return true;
}

function polygonItem(shape, label) {
  checkPoints(shape.points, label);
  const qs = shape.points.map((p) => [quantize(p.x), quantize(p.y)]);
  if (qs.length < 3) return null; // 칠할 넓이가 없어요
  const rect = axisRectQ(qs);
  if (rect) {
    const [x0, y0, x1, y1] = rect;
    return {
      kind: 'path', color: shape.color, key: colorKey(shape.color), joinable: true,
      bbox: [x0 / Q, y0 / Q, x1 / Q, y1 / Q],
      ops: `${fmtQ(x0)} ${fmtQ(y0)} ${fmtQ(x1 - x0)} ${fmtQ(y1 - y0)} re`,
    };
  }
  // 넓이 합이 0 이어도 버리지 않아요: 나비넥타이처럼 스스로 교차하면 nonzero 로 칠해지는 넓이가 있어요.
  // 그런 다각형은 단순이 아니라서 혼자 칠해요.
  const ordered = area2Q(qs) < 0 ? qs.slice().reverse() : qs;
  const parts = [`${fmtQ(ordered[0][0])} ${fmtQ(ordered[0][1])} m`];
  for (let k = 1; k < ordered.length; k += 1) parts.push(`${fmtQ(ordered[k][0])} ${fmtQ(ordered[k][1])} l`);
  parts.push('h');
  return {
    kind: 'path', color: shape.color, key: colorKey(shape.color), joinable: isSimpleQ(ordered),
    bbox: bboxOfQ(qs), ops: parts.join(' '),
  };
}

function discItem(shape, label) {
  for (const k of ['cx', 'cy', 'r']) if (!Number.isFinite(shape[k])) throw new TypeError(`${label}.${k} 는 유한한 수여야 해요`);
  if (!(shape.r > 0)) return null;
  const {cx, cy, r} = shape, k = KAPPA * r;
  // re 와 같은 양의 넓이 방향: (cx+r,cy) → (cx,cy+r) → (cx−r,cy) → (cx,cy−r).
  const ops = [
    `${fmt(cx + r)} ${fmt(cy)} m`,
    `${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`,
    `${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`,
    `${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`,
    `${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`,
    'h',
  ].join(' ');
  return {
    kind: 'path', color: shape.color, key: colorKey(shape.color), joinable: true,
    bbox: [cx - r, cy - r, cx + r, cy + r], ops,
  };
}

function imageItem(shape, label) {
  const image = assertSceneImage(shape.image);
  checkPoints(shape.points, label, 4);
  if (shape.points.length !== 4) throw new TypeError(`${label}: 이미지 사각형은 꼭짓점 4개(TL·TR·BR·BL)여야 해요`);
  const [a, b, c, d] = shape.points;
  const extent = Math.max(1, ...shape.points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const tol = 1e-6 * extent;
  if (Math.abs(a.x + c.x - b.x - d.x) > tol || Math.abs(a.y + c.y - b.y - d.y) > tol) {
    throw new RangeError(`${label}: PDF 면 이미지는 평행사변형 사각형만 받아요(원근 사각형은 아핀 한 번으로 못 놓아요)`);
  }
  const e1x = b.x - a.x, e1y = b.y - a.y, e2x = a.x - d.x, e2y = a.y - d.y;
  if (Math.abs(e1x * e2y - e1y * e2x) < 1e-12) throw new RangeError(`${label}: 이미지 사각형이 퇴화했어요`);
  const gain = Number.isFinite(shape.gain) ? Math.min(1, Math.max(0, shape.gain)) : 1;
  const qs = shape.points.map((p) => [quantize(p.x), quantize(p.y)]);
  return {
    kind: 'image', key: null, joinable: false, image, gain, color: shape.color,
    bbox: bboxOfQ(qs),
    matrix: [e1x, e1y, e2x, e2y, d.x, d.y],
    quadOps: `${fmtQ(qs[0][0])} ${fmtQ(qs[0][1])} m ${fmtQ(qs[1][0])} ${fmtQ(qs[1][1])} l ${fmtQ(qs[2][0])} ${fmtQ(qs[2][1])} l ${fmtQ(qs[3][0])} ${fmtQ(qs[3][1])} l h`,
  };
}

function sceneItems(scene) {
  const items = [];
  if (scene.background !== null) {
    // 배경도 같은 색 도형이 합류할 수 있는 첫 묶음이에요(흰 모듈이 배경 채움에 합쳐져요).
    items.push({
      kind: 'path', color: scene.background, key: colorKey(scene.background), joinable: true,
      bbox: [0, 0, scene.width, scene.height],
      ops: `0 0 ${fmt(scene.width)} ${fmt(scene.height)} re`,
    });
  }
  scene.shapes.forEach((shape, index) => {
    const label = `shape[${index}]`;
    if (!shape || typeof shape !== 'object') throw new TypeError(`${label} 는 객체여야 해요`);
    checkColor(shape.color, label);
    let item;
    if (shape.kind === 'polygon') item = polygonItem(shape, label);
    else if (shape.kind === 'disc') item = discItem(shape, label);
    else if (shape.kind === 'image') item = imageItem(shape, label);
    else throw new RangeError(`${label}: 알 수 없는 shape kind: ${shape.kind}`);
    if (item) items.push(item);
  });
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// painter 순서를 지키는 색 묶기
// ─────────────────────────────────────────────────────────────────────────────

const overlaps = (p, q) => Math.min(p[2], q[2]) - Math.max(p[0], q[0]) > OVERLAP_EPS
  && Math.min(p[3], q[3]) - Math.max(p[1], q[1]) > OVERLAP_EPS;

/** 칸 해시. 항목마다 {bbox, group, key} 를 두고, «g 뒤 묶음의 다른 색과 겹치나» 만 물어요. */
class OverlapIndex {
  constructor(cell) {
    this.cell = cell;
    this.cells = new Map();
    this.big = [];
  }

  span(b) {
    const c = this.cell;
    return [Math.floor(b[0] / c), Math.floor(b[1] / c), Math.floor(b[2] / c), Math.floor(b[3] / c)];
  }

  insert(entry) {
    const [i0, j0, i1, j1] = this.span(entry.bbox);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS_PER_ENTRY) {
      this.big.push(entry);
      return;
    }
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const k = `${i},${j}`;
        const list = this.cells.get(k);
        if (list) list.push(entry); else this.cells.set(k, [entry]);
      }
    }
  }

  blocks(bbox, afterGroup, key) {
    const hit = (e) => e.group > afterGroup && e.key !== key && overlaps(e.bbox, bbox);
    for (const e of this.big) if (hit(e)) return true;
    const [i0, j0, i1, j1] = this.span(bbox);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS_PER_ENTRY) {
      // 큰 질의는 칸을 도는 대신 전부 봐요.
      for (const list of this.cells.values()) for (const e of list) if (hit(e)) return true;
      return false;
    }
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const list = this.cells.get(`${i},${j}`);
        if (list) for (const e of list) if (hit(e)) return true;
      }
    }
    return false;
  }
}

function cellSizeOf(items) {
  const sizes = items.filter((it) => it.kind === 'path')
    .map((it) => Math.max(it.bbox[2] - it.bbox[0], it.bbox[3] - it.bbox[1]))
    .sort((p, q) => p - q);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 1;
  return Math.max(0.01, median);
}

/** 항목 → 칠 묶음 목록(painter 순서). 묶음은 {kind:'path', color, ops[]} 또는 이미지 항목이에요. */
function groupItems(items) {
  const index = new OverlapIndex(cellSizeOf(items));
  const groups = [];
  const latestByColor = new Map();
  for (const item of items) {
    if (item.kind === 'image') {
      const g = groups.length;
      groups.push(item);
      index.insert({bbox: item.bbox, group: g, key: null});
      continue;
    }
    let g = item.joinable ? latestByColor.get(item.key) : undefined;
    if (g !== undefined && index.blocks(item.bbox, g, item.key)) g = undefined;
    if (g === undefined) {
      g = groups.length;
      groups.push({kind: 'path', color: item.color, key: item.key, ops: []});
      // 혼자 칠해야 하는 다각형 묶음에는 다른 도형이 합류하지 않게 최신 묶음으로 등록하지 않아요.
      if (item.joinable) latestByColor.set(item.key, g);
    }
    groups[g].ops.push(item.ops);
    index.insert({bbox: item.bbox, group: g, key: item.key});
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// 계획: 콘텐츠 문자열 + 이미지 원문
// ─────────────────────────────────────────────────────────────────────────────

function imageSamples(image, gain) {
  const count = image.width * image.height;
  const rgb = new Uint8Array(count * 3);
  let alpha = null;
  for (let k = 0; k < count; k += 1) {
    if (image.pixels[k * 4 + 3] !== 255) {
      alpha = new Uint8Array(count);
      break;
    }
  }
  for (let k = 0; k < count; k += 1) {
    const s = k * 4;
    rgb[k * 3] = gain === 1 ? image.pixels[s] : Math.round(image.pixels[s] * gain);
    rgb[k * 3 + 1] = gain === 1 ? image.pixels[s + 1] : Math.round(image.pixels[s + 1] * gain);
    rgb[k * 3 + 2] = gain === 1 ? image.pixels[s + 2] : Math.round(image.pixels[s + 2] * gain);
    if (alpha) alpha[k] = image.pixels[s + 3];
  }
  return {rgb, alpha};
}

function planPdf(scene, opts) {
  const page = pageOf(scene, opts);
  const groups = groupItems(sceneItems(scene));
  const xobjects = [];
  const byImage = new Map();
  const lines = ['q', `${PDF_CTM_SCALE} 0 0 -${PDF_CTM_SCALE} 0 ${page.heightPt} cm`];
  for (const g of groups) {
    if (g.kind === 'path') {
      lines.push(rgOp(g.color), ...g.ops, 'f');
      continue;
    }
    let byGain = byImage.get(g.image);
    if (!byGain) byImage.set(g.image, byGain = new Map());
    let x = byGain.get(g.gain);
    if (!x) {
      const {rgb, alpha} = imageSamples(g.image, g.gain);
      x = {name: `Im${xobjects.length}`, width: g.image.width, height: g.image.height, rgb, alpha};
      xobjects.push(x);
      byGain.set(g.gain, x);
    }
    lines.push('q');
    if (x.alpha) {
      const c = g.gain === 1 ? g.color
        : {r: Math.round(g.color.r * g.gain), g: Math.round(g.color.g * g.gain), b: Math.round(g.color.b * g.gain)};
      lines.push(rgOp(c), g.quadOps, 'f');
    }
    lines.push(`${g.matrix.map(fmt).join(' ')} cm`, `/${x.name} Do`, 'Q');
  }
  lines.push('Q');
  return {page, content: ENCODER.encode(`${lines.join('\n')}\n`), xobjects};
}

// ─────────────────────────────────────────────────────────────────────────────
// 조립
// ─────────────────────────────────────────────────────────────────────────────

/** `%PDF-1.4` + 이진 표시 주석(0xE2 0xE3 0xCF 0xD3). */
const HEADER = Uint8Array.of(
  ...ENCODER.encode('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
);

function assemble(page, content, xobjects) {
  const objects = [];
  const imageRefs = [];
  let next = 5;
  const imageObjects = [];
  for (const x of xobjects) {
    const num = next;
    next += 1;
    const smaskNum = x.alphaZ ? next : null;
    if (x.alphaZ) next += 1;
    imageRefs.push(`/${x.name} ${num} 0 R`);
    imageObjects.push({num, smaskNum, x});
  }
  const resources = imageRefs.length ? `<< /XObject << ${imageRefs.join(' ')} >> >>` : '<< >>';
  objects.push({dict: '<< /Type /Catalog /Pages 2 0 R >>'});
  objects.push({dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'});
  objects.push({
    dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.widthPt} ${page.heightPt}] /Resources ${resources} /Contents 4 0 R >>`,
  });
  objects.push({dict: `<< /Length ${content.length} /Filter /FlateDecode >>`, stream: content});
  for (const {smaskNum, x} of imageObjects) {
    const common = `/Type /XObject /Subtype /Image /Width ${x.width} /Height ${x.height} /BitsPerComponent 8 /Filter /FlateDecode`;
    objects.push({
      dict: `<< ${common} /ColorSpace /DeviceRGB${smaskNum ? ` /SMask ${smaskNum} 0 R` : ''} /Length ${x.rgbZ.length} >>`,
      stream: x.rgbZ,
    });
    if (smaskNum) objects.push({dict: `<< ${common} /ColorSpace /DeviceGray /Length ${x.alphaZ.length} >>`, stream: x.alphaZ});
  }

  const chunks = [HEADER];
  let offset = HEADER.length;
  const offsets = [];
  const push = (bytes) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  objects.forEach((o, k) => {
    offsets.push(offset);
    if (o.stream) {
      push(ENCODER.encode(`${k + 1} 0 obj\n${o.dict}\nstream\n`));
      push(o.stream);
      push(ENCODER.encode('\nendstream\nendobj\n'));
    } else {
      push(ENCODER.encode(`${k + 1} 0 obj\n${o.dict}\nendobj\n`));
    }
  });
  const xrefOffset = offset;
  const size = objects.length + 1;
  const xref = [`xref\n0 ${size}\n`, '0000000000 65535 f \n'];
  for (const o of offsets) xref.push(`${String(o).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  push(ENCODER.encode(xref.join('')));

  const out = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 압축
// ─────────────────────────────────────────────────────────────────────────────

async function readAll(readable) {
  const reader = readable.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    parts.push(bytes);
    total += bytes.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** zlib(RFC 1950) 압축. 생성자가 없거나, 생성·스트림 중 실패하거나, 빈 결과면 zlibWrap 으로 내요. */
async function deflateZlib(bytes, Ctor) {
  if (typeof Ctor !== 'function') return zlibWrap(bytes);
  try {
    const stream = new Ctor('deflate');
    const writer = stream.writable.getWriter();
    const writing = (async () => {
      await writer.write(bytes);
      await writer.close();
    })();
    const [, out] = await Promise.all([writing, readAll(stream.readable)]);
    // zlib 스트림은 헤더 2 B + Adler-32 4 B 가 최소예요. 그보다 짧으면 스트림이 망가진 거예요.
    if (out.length < 6 || (((out[0] << 8) | out[1]) % 31) !== 0 || (out[0] & 0x0f) !== 8) return zlibWrap(bytes);
    return out;
  } catch {
    return zlibWrap(bytes);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 공개 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mm 장면 → PDF 1쪽 바이트(동기, 결정적).
 * @param {object} scene {width, height, background, shapes, unit?:'mm'}
 * @param {{widthMm?: number, heightMm?: number}} [opts] 쪽 크기(기본 = 장면 크기). 장면은 쪽 왼쪽 위에 1:1 로 놓여요.
 * @returns {Uint8Array}
 */
export function sceneToPdfSync(scene, opts = {}) {
  const {page, content, xobjects} = planPdf(scene, opts);
  return assemble(page, zlibWrap(content), xobjects.map((x) => ({
    ...x, rgbZ: zlibWrap(x.rgb), alphaZ: x.alpha ? zlibWrap(x.alpha) : null,
  })));
}

/**
 * mm 장면 → PDF 1쪽 바이트(비동기). CompressionStream('deflate') 가 있으면 그것으로, 없거나 실패하면
 * sceneToPdfSync 와 같은 zlibWrap 으로 압축해요. 입력 검증 오류는 거부된 Promise 로 나가요.
 * @param {object} scene
 * @param {{widthMm?: number, heightMm?: number, compressionStream?: Function|null}} [opts]
 *   compressionStream: 압축 스트림 생성자 주입(기본 globalThis.CompressionStream, null 이면 zlibWrap).
 * @returns {Promise<Uint8Array>}
 */
export async function sceneToPdf(scene, opts = {}) {
  const {page, content, xobjects} = planPdf(scene, opts);
  const Ctor = opts.compressionStream === undefined ? globalThis.CompressionStream : opts.compressionStream;
  const contentZ = await deflateZlib(content, Ctor);
  const packed = [];
  for (const x of xobjects) {
    packed.push({
      ...x,
      rgbZ: await deflateZlib(x.rgb, Ctor),
      alphaZ: x.alpha ? await deflateZlib(x.alpha, Ctor) : null,
    });
  }
  return assemble(page, contentZ, packed);
}
