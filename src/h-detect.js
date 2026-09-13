/**
 * H-v2 픽셀 검출. 입력은 휘도 필드만 받아요. 부호화·자세·쿼드 정답은 쓰지 않아요.
 */
import { estimateHomography4, projectPoint } from './decoder/homography.js';
import { decodeH } from './h-codec.js';
import { H_FACE_IDS, hModeFaces, normalizeHProfile, readHFormatByte } from './h-profile.js';
import { hLayout, hCodebook, hamming, hReservedLevel, validateHFace } from './h-layout.js';
import {detectHCornerQuads} from './h-corner-detect.js';

// 작은 대각 테두리의 AA 픽셀을 끊지 않아요. 최종 흑백/예약 검증은 별도예요.
const DEFAULT_THRESHOLD = 0.12;
// 연결 확장은 AA를 포함하되 시작점은 진한 검정이어야 해요. 유색 low 데이터가
// 후보 수를 먼저 소모하지 않게 하는 hysteresis이며 최종 수락 문턱은 아니에요.
const DEFAULT_SEED_THRESHOLD = 0.04;
const EDGE_THRESHOLD = 0.21404114048223255;
const BLACK_MAX = 0.18;
const WHITE_MIN = 0.82;
const MAX_CONTOUR = 8192;
const MAX_HULL = 64;
const MAX_FACES = 24;
const MAX_REJECTED = 32;
const MAX_PIXELS = 4000000;
const BOOK = hCodebook();

/** 광학 프레임의 검정/흰색 기준만 정규화해요. 입력 배열이나 Y 경로는 변경하지 않아요. */
function contrastField(field) {
  const hist=new Uint32Array(256),stride=Math.max(1,Math.ceil(field.data.length/131072));let count=0;
  for(let i=0;i<field.data.length;i+=stride){const v=field.data[i];if(Number.isFinite(v)){hist[Math.max(0,Math.min(255,Math.round(v*255)))]++;count++;}}
  const quantile=f=>{let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=Math.max(1,count*f))return i/255;}return 1;};
  const low=quantile(.005),high=quantile(.995),range=high-low;
  if(range<.12||!count)return {field,low,high,normalized:false};
  if(low<=.008&&high>=.992)return {field,low,high,normalized:false};
  const data=new Float32Array(field.data.length);
  for(let i=0;i<data.length;i++)data[i]=Math.max(0,Math.min(1,(field.data[i]-low)/range));
  return {field:{width:field.width,height:field.height,data},low,high,normalized:true};
}

function projectH(H, x, y) {
  return projectPoint(H, { x, y });
}

function sample(field, x, y) {
  const { width, height, data } = field;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  x -= 0.5;
  y -= 0.5;
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const row0 = y0 * width;
  const row1 = (y0 + 1) * width;
  const x1 = x0 + 1;
  return data[row0 + x0] * (1 - fx) * (1 - fy)
    + data[row0 + x1] * fx * (1 - fy)
    + data[row1 + x0] * (1 - fx) * fy
    + data[row1 + x1] * fx * fy;
}

function sampleCell(field, H, i, j) {
  const p = projectH(H, j + 0.5, i + 0.5);
  return p ? sample(field, p.x, p.y) : NaN;
}

function darkAt(field, x, y, threshold) {
  const v = field.data[y * field.width + x];
  return Number.isFinite(v) && v < threshold;
}

function flood(field, sx, sy, seen, id, threshold) {
  const { width, height } = field;
  const stack = [sy * width + sx];
  seen[sy * width + sx] = id;
  const pixels = [];
  while (stack.length) {
    const p = stack.pop();
    pixels.push(p);
    const x = p % width;
    const y = (p - x) / width;
    const tryN = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const q = ny * width + nx;
      if (seen[q] || !darkAt(field, nx, ny, threshold)) return;
      seen[q] = id;
      stack.push(q);
    };
    tryN(x - 1, y);
    tryN(x + 1, y);
    tryN(x, y - 1);
    tryN(x, y + 1);
  }
  return pixels;
}

function contourOf(field, pixels, seen, id) {
  const { width, height } = field;
  const pts = [];
  for (const p of pixels) {
    const x = p % width;
    const y = (p - x) / width;
    const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1
      || seen[p - 1] !== id || seen[p + 1] !== id
      || seen[p - width] !== id || seen[p + width] !== id;
    if (edge) pts.push({ x: x + 0.5, y: y + 0.5 });
    if (pts.length > MAX_CONTOUR) return null;
  }
  return pts;
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 4) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function quadArea(a, b, c, d) {
  return 0.5 * Math.abs(
    a.x * b.y - b.x * a.y + b.x * c.y - c.x * b.y + c.x * d.y - d.x * c.y + d.x * a.y - a.x * d.y,
  );
}

function orderCcw(quad) {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  return quad.slice().sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
}

function quadFromHull(hull) {
  const n=hull.length;
  if(n<4||n>MAX_HULL)return null;
  // 작은 AA 계단을 하나씩 지우면 실제 코너를 먼저 잃을 수 있어요.
  // 볼록 hull의 대각(a,c) 양쪽에서 최대 삼각형을 골라 전역 최대면적 사각을
  // 구해요. 순수 기하만 사용하며 O(n³), n≤64 작업 상한을 유지해요.
  const triangle=(a,b,c)=>Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
  let best=null,area=0;
  for(let a=0;a<n-3;a++)for(let c=a+2;c<n-1;c++){
    let bi=a+1,di=c+1,barea=-1,darea=-1;
    for(let b=a+1;b<c;b++){const q=triangle(hull[a],hull[b],hull[c]);if(q>barea){barea=q;bi=b;}}
    for(let d=c+1;d<n;d++){const q=triangle(hull[a],hull[c],hull[d]);if(q>darea){darea=q;di=d;}}
    if(barea+darea>area){area=barea+darea;best=[hull[a],hull[bi],hull[c],hull[di]];}
  }
  return best&&area/2>8?orderCcw(best):null;
}

function refineQuad(field, quad) {
  const center = {
    x: quad.reduce((s, p) => s + p.x, 0) / 4,
    y: quad.reduce((s, p) => s + p.y, 0) / 4,
  };
  const lines = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const a = quad[edge];
    const b = quad[(edge + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) return quad;
    let nx = -dy / len;
    let ny = dx / len;
    if (nx * (center.x - (a.x + b.x) / 2) + ny * (center.y - (a.y + b.y) / 2) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const points = [];
    const range = Math.max(1.5, Math.min(12, len * 0.06));
    for (let k = 0; k < 15; k += 1) {
      const t = 0.12 + 0.76 * (k + 0.5) / 15;
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      let prev = null;
      let choice = null;
      for (let distance = -range; distance <= range; distance += 0.2) {
        const luma = sample(field, px + nx * distance, py + ny * distance);
        if (!Number.isFinite(luma)) {
          prev = null;
          continue;
        }
        if (prev && prev.luma < EDGE_THRESHOLD && luma >= EDGE_THRESHOLD) {
          const cross = prev.distance
            + (distance - prev.distance) * (EDGE_THRESHOLD - prev.luma) / (luma - prev.luma);
          if (!choice || Math.abs(cross) < Math.abs(choice.distance)) {
            choice = { x: px + nx * cross, y: py + ny * cross, distance: cross };
          }
        }
        prev = { luma, distance };
      }
      if (choice) points.push(choice);
    }
    if (points.length < 8) return quad;
    const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const my = points.reduce((s, p) => s + p.y, 0) / points.length;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const p of points) {
      xx += (p.x - mx) ** 2;
      xy += (p.x - mx) * (p.y - my);
      yy += (p.y - my) ** 2;
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const lx = -Math.sin(angle);
    const ly = Math.cos(angle);
    lines.push({ x: lx, y: ly, c: lx * mx + ly * my });
  }
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    const a = lines[(i + 3) % 4];
    const b = lines[i];
    const det = a.x * b.y - a.y * b.x;
    if (Math.abs(det) < 0.05) return quad;
    const p = { x: (a.c * b.y - a.y * b.c) / det, y: (a.x * b.c - a.c * b.x) / det };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.hypot(p.x - quad[i].x, p.y - quad[i].y) > 24) {
      return quad;
    }
    out.push(p);
  }
  return out;
}

function d4Polygons(ccw) {
  const rows = [];
  for (let r = 0; r < 4; r += 1) rows.push([0, 1, 2, 3].map((k) => ccw[(k + r) % 4]));
  const cw = [ccw[0], ccw[3], ccw[2], ccw[1]];
  for (let r = 0; r < 4; r += 1) rows.push([0, 1, 2, 3].map((k) => cw[(k + r) % 4]));
  return rows;
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
}

function bitFromLuma(v) {
  if (!Number.isFinite(v)) return null;
  if (v <= BLACK_MAX) return 1;
  if (v >= WHITE_MIN) return 0;
  return null;
}

function pushRejected(rejected, row) {
  if (rejected.length < MAX_REJECTED) rejected.push(row);
}

function profileFamilyKey(row) {
  return [row.mode, row.tones, row.ecc, row.mask, row.routeId].join('/');
}

function profileKey(row) {
  return `${row.version}/${profileFamilyKey(row)}`;
}

/**
 * 같은 component에서 version만 겹친 family가 완성됐을 때만 RS/CRC로 후보를 좁혀요.
 * 정상 단일후보와 검증할 완성 profile이 없는 부분 관측은 그대로 collector에 넘겨요.
 */
function retainVerifiedProfiles(faces, rejected, ambiguousFamilies) {
  if (ambiguousFamilies.size === 0) return faces;
  const groups = new Map();
  for (const row of faces) {
    const family = profileFamilyKey(row);
    if (!ambiguousFamilies.has(family)) continue;
    const key = profileKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const verified = new Map();
  for (const [key, rows] of groups) {
    const exemplar = rows[0];
    const family = profileFamilyKey(exemplar);
    const required = hModeFaces(exemplar.mode);
    const byFace = {};
    for (const row of rows) if (!byFace[row.face]) byFace[row.face] = row.levels;
    if (!required.every((face) => byFace[face])) continue;
    const decoded = decodeH(byFace, {
      version: exemplar.version,
      mode: exemplar.mode,
      tones: exemplar.tones,
      ecc: exemplar.ecc,
      mask: exemplar.mask,
      routeId: exemplar.routeId,
    });
    if (decoded.ok) {
      if (!verified.has(family)) verified.set(family, new Set());
      verified.get(family).add(key);
    }
    else pushRejected(rejected, { reason: 'profile-crc', version: exemplar.version, mode: exemplar.mode });
  }
  if (verified.size === 0) return faces;
  return faces.filter((row) => {
    const profiles = verified.get(profileFamilyKey(row));
    return !profiles || profiles.has(profileKey(row));
  });
}

function readFace(field, H, version, ori, quad) {
  const layout = hLayout(version);
  const { n } = layout;
  const tagBits = new Uint8Array(16);
  for (let k = 0; k < 16; k += 1) {
    const bit = bitFromLuma(sampleCell(field, H, layout.tagCells[k].i, layout.tagCells[k].j));
    if (bit === null) return { ok: false, reason: 'tag-contrast' };
    tagBits[k] = bit;
  }
  const hits = BOOK.filter((row) => hamming(row.bits, tagBits) === 0);
  if (hits.length !== 1) return { ok: false, reason: 'tag-match' };
  const hit = hits[0];
  let formatByte = 0;
  for (const cell of layout.formatCells) {
    const bit = bitFromLuma(sampleCell(field, H, cell.i, cell.j));
    if (bit === null) return { ok: false, reason: 'format-contrast' };
    if (bit) formatByte |= 1 << cell.bit;
  }
  const format = readHFormatByte(formatByte);
  if (!format) return { ok: false, reason: 'format-byte' };
  let routeId = 0;
  for (const cell of layout.routeCells) {
    const bit = bitFromLuma(sampleCell(field, H, cell.i, cell.j));
    if (bit === null) return { ok: false, reason: 'route-contrast' };
    if (bit) routeId |= 1 << cell.bit;
  }
  let profile;
  try {
    profile = normalizeHProfile({
      version,
      mode: hit.mode,
      tones: format.tones,
      ecc: format.ecc,
      mask: format.mask,
    });
  } catch {
    return { ok: false, reason: 'profile' };
  }
  const groups = Array.from({ length: profile.tones }, () => []);
  for (const cell of layout.reference) {
    const v = sampleCell(field, H, cell.i, cell.j);
    if (!Number.isFinite(v)) return { ok: false, reason: 'reference-sample' };
    groups[(cell.i + cell.j) % profile.tones].push(v);
  }
  if (groups.some((row) => row.length === 0)) return { ok: false, reason: 'reference-group' };
  const centers = groups.map(median);
  const ordered = centers.slice().sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ordered.length; i += 1) gaps.push(ordered[i] - ordered[i - 1]);
  const refGap = Math.min(...gaps);
  if (!(refGap > 0.06)) return { ok: false, reason: 'reference-gap' };
  let refSpread = 0;
  for (let t = 0; t < profile.tones; t += 1) {
    for (const v of groups[t]) refSpread = Math.max(refSpread, Math.abs(v - centers[t]));
  }
  if (!(refSpread < 0.06) || !(refSpread < refGap * 0.5)) return { ok: false, reason: 'reference-spread' };
  const levels = new Uint8Array(n * n);
  for (const cell of layout.roles.values()) {
    const expected = hReservedLevel(cell, profile, hit.face, routeId);
    const v = sampleCell(field, H, cell.i, cell.j);
    if (expected === null) {
      if (!Number.isFinite(v)) {
        levels[cell.i * n + cell.j] = 255;
        continue;
      }
      let rank = 0;
      for (let t = 1; t < profile.tones; t += 1) {
        if (Math.abs(v - centers[t]) < Math.abs(v - centers[rank])) rank = t;
      }
      const dist = Math.abs(v - centers[rank]);
      const lo = ordered[0];
      const hi = ordered[ordered.length - 1];
      if (v < lo - refGap * 0.42 || v > hi + refGap * 0.42 || dist > refGap * 0.42) {
        levels[cell.i * n + cell.j] = 255;
      } else {
        levels[cell.i * n + cell.j] = rank;
      }
      continue;
    }
    if (expected === 5) {
      levels[cell.i * n + cell.j] = 5;
      continue;
    }
    if (!Number.isFinite(v)) return { ok: false, reason: 'reserved-sample' };
    if (expected === 3 && !(v <= BLACK_MAX)) return { ok: false, reason: 'reserved-black' };
    if (expected === 4 && !(v >= WHITE_MIN)) return { ok: false, reason: 'reserved-white' };
    if (expected !== 3 && expected !== 4) {
      levels[cell.i * n + cell.j] = expected;
      continue;
    }
    levels[cell.i * n + cell.j] = expected;
  }
  let known = 0;
  let dataCount = 0;
  for (const cell of layout.scan) {
    dataCount += 1;
    if (levels[cell.i * n + cell.j] !== 255) known += 1;
  }
  const knownRatio = dataCount ? known / dataCount : 0;
  if (!(knownRatio >= 0.55)) return { ok: false, reason: 'known-ratio' };
  const observation = {
    ok: true,
    version: profile.version,
    n: profile.n,
    mode: profile.mode,
    tones: profile.tones,
    ecc: profile.ecc,
    mask: profile.mask,
    routeId,
    face: hit.face,
    levels,
    H,
    quad: quad.map((p) => ({ x: p.x, y: p.y })),
    rotation: ori % 4,
    mirror: ori >= 4,
    hamming: 0,
  };
  if (!validateHFace(levels, { ...profile, face: hit.face, routeId })) {
    return { ok: false, reason: 'validate-face' };
  }
  const a = projectH(H, 1, 1);
  const b = projectH(H, 2, 1);
  const cellPx = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const dataMargin = refGap * 0.42;
  const score = Math.min(1, Math.max(0,
    0.45 * Math.min(1, cellPx / 12)
    + 0.25 * (1 - Math.min(1, refSpread / 0.06))
    + 0.30 * knownRatio,
  ));
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  observation.quality = { score, refGap, refSpread, dataMargin, knownRatio };
  observation.bounds = {
    minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys),
  };
  if (ori >= 4) return { ok: false, reason: 'reflection', face: hit.face, mode: hit.mode };
  return observation;
}


function emptyResult(elapsedMs, extra = {}) {
  return {
    ok: false,
    faces: [],
    rejected: extra.rejected || [],
    stats: { elapsedMs, components: extra.components || 0, capped: extra.capped === true, capReasons: [] },
  };
}

/**
 * maxComponents는 윤곽/디코드 대상 수예요(최대128). flood 후보는 별도 최대512개예요.
 * @param {{width:number,height:number,data:Float32Array}} field
 * @param {{maxComponents?:number,debug?:boolean,threshold?:number}} [options]
 */
export function detectH(field, options = {}) {
  const started = performance.now();
  if (!field || !Number.isInteger(field.width) || !Number.isInteger(field.height)
    || field.width < 8 || field.height < 8
    || field.width * field.height > MAX_PIXELS
    || !(field.data instanceof Float32Array)
    || field.data.length !== field.width * field.height) {
    return emptyResult(performance.now() - started);
  }
  const photometric=options.normalizeContrast===false?{field,low:0,high:1,normalized:false}:contrastField(field);
  field=photometric.field;
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;
  if (!(threshold > 0) || threshold >= 1) return emptyResult(performance.now() - started);
  const seedThreshold=Number.isFinite(options.threshold)?threshold:DEFAULT_SEED_THRESHOLD;
  let maxComponents = options.maxComponents === undefined ? 128 : options.maxComponents;
  if (!Number.isInteger(maxComponents)) return emptyResult(performance.now() - started);
  if (maxComponents > 128) maxComponents = 128;
  if (maxComponents < 1) maxComponents = 1;
  const debug = options.debug === true;
  const { width, height } = field;
  const seen = new Uint32Array(width * height);
  const components = [];
  let id = 1;
  let capped = false;
  // 복수 상한이 같은 프레임에서 걸릴 수 있어요. 기존 capped는 호환성을 위해 유지해요.
  const capReasons = [];
  const recordCap = reason => { capped = true; if (!capReasons.includes(reason)) capReasons.push(reason); };
  let edgeDiscarded=0,rawComponents=0,candidateComponents=0,tinyComponents=0,floodPixels=0;
  outer: for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (seen[p] || !darkAt(field, x, y, seedThreshold)) continue;
      // grow 문턱의 4이웃도 없으면 기존 flood에서 반드시 크기1로 버릴 성분이에요.
      // 얇은 윤곽의 고립 AA 조각은 flood 예산 전에 제외하고 연결성과 상한은 유지해요.
      if (!(x > 0 && darkAt(field, x - 1, y, threshold))
        && !(x + 1 < width && darkAt(field, x + 1, y, threshold))
        && !(y > 0 && darkAt(field, x, y - 1, threshold))
        && !(y + 1 < height && darkAt(field, x, y + 1, threshold))) continue;
      // 데이터가 어두워져 성분 수가 늘어도 앞쪽 128개만으로 탐색을 끝내지 않아요.
      // flood 후보는 512개, 후단의 윤곽/디코드 작업은 maxComponents개로 따로 제한해요.
      if (candidateComponents >= 512) {
        recordCap('candidates512');
        break outer;
      }
      const pixels = flood(field, x, y, seen, id, threshold);
      rawComponents++;
      floodPixels+=pixels.length;
      id += 1;
      // 최소 크기 미만은 기존에도 무조건 폐기했어요. 후보 예산에는 세지 않아요.
      // seen으로 모든 픽셀은 최대 한 번 flood되어 총 방문은 입력 4M 상한 이내예요.
      if (pixels.length < 32) {tinyComponents++;continue;}
      candidateComponents++;
      if (pixels.length > width * height * 0.8) continue;
      if (pixels.some((q) => {
        const qx = q % width;
        const qy = (q - qx) / width;
        return qx === 0 || qy === 0 || qx === width - 1 || qy === height - 1;
      })){edgeDiscarded++;continue;}
      components.push(pixels);
    }
  }
  const prunedComponents = Math.max(0, components.length - maxComponents);
  if (prunedComponents) {
    // 작은 데이터 조각보다 큰 파인더 성분을 먼저 검사해 raster 위치 편향을 줄여요.
    // 임계값과 후단 검증은 그대로이며, 동률은 원래 탐색 순서를 유지해요.
    components.sort((a, b) => b.length - a.length);
    components.length = maxComponents;
    recordCap('pruned128');
  }
  const faces = [];
  const rejected = [];
  const debugQuads = [];
  const cornerQuads=[];
  const ambiguousFamilies = new Set();
  let work = 0;
  for (const pixels of components) {
    if (faces.length >= MAX_FACES) {
      recordCap('faces24');
      break;
    }
    const contour = contourOf(field, pixels, seen, seen[pixels[0]]);
    if (!contour) continue;
    work += contour.length;
    if (work > 65536) {
      recordCap('work65536');
      break;
    }
    const coarse = quadFromHull(convexHull(contour));
    if (!coarse) continue;
    const quad = refineQuad(field, coarse);
    cornerQuads.push(quad);
    if (debug && debugQuads.length < 24) debugQuads.push({ quad: quad.map((p) => ({ x: p.x, y: p.y })) });
    const valid = [];
    for (let version = 0; version <= 8; version += 1) {
      const n = 13 + 4 * version;
      const local = [{ x: 1, y: 1 }, { x: n - 1, y: 1 }, { x: n - 1, y: n - 1 }, { x: 1, y: n - 1 }];
      const polys = d4Polygons(quad);
      for (let ori = 0; ori < 8; ori += 1) {
        const H = estimateHomography4(local, polys[ori]);
        if (!H) continue;
        const hit = readFace(field, H, version, ori, quad);
        if (hit.ok === true) valid.push(hit);
        else if (!hit.reason.startsWith('tag-')) pushRejected(rejected, { reason: hit.reason, face: hit.face, mode: hit.mode, version, rotation: ori % 4, mirror: ori >= 4 });
      }
    }
    const accepted = valid.filter((row) => row.mirror === false);
    if (accepted.length>1)pushRejected(rejected,{reason:'profile-candidates',count:accepted.length});
    const componentFamilies = new Map();
    for (const row of accepted) {
      const family = profileFamilyKey(row);
      if (!componentFamilies.has(family)) componentFamilies.set(family, new Set());
      componentFamilies.get(family).add(row.version);
    }
    for (const [family, versions] of componentFamilies) {
      if (versions.size > 1) ambiguousFamilies.add(family);
    }
    // 버전 후보는 각기 다른 수집기로 보내요. 광학 후보를 결과로 승격하는 문은 full RS/CRC뿐이에요.
    for(const hit of accepted.slice(0,2)) {
      if(faces.length<MAX_FACES)faces.push(hit);
      else recordCap('faces24');
    }
  }
  const frameFaces = retainVerifiedProfiles(faces, rejected, ambiguousFamilies);
  // 비모호 정상 경로는 원본 배열을 그대로 반환하므로 self-clear 하면 안 돼요.
  if (frameFaces !== faces) {
    faces.length = 0;
    faces.push(...frameFaces);
  }
  const corner=detectHCornerQuads(field,cornerQuads,{debug});
  for(const hit of corner.faces) {
    if(faces.length<MAX_FACES)faces.push(hit);
    else recordCap('faces24');
  }
  for(const row of corner.rejected)pushRejected(rejected,{...row,finder:'corners'});
  const stats = { elapsedMs: performance.now() - started, components: components.length, rawComponents,candidateComponents,prunedComponents,tinyComponents,floodPixels,edgeDiscarded,corners:corner.stats,
    photometric:{low:photometric.low,high:photometric.high,normalized:photometric.normalized,threshold,seedThreshold},capped,capReasons,componentLimit:maxComponents };
  const result = { ok: faces.length > 0, faces, rejected, stats };
  if (debug) result.debugQuads = debugQuads;
  return result;
}
