/**
 * H 사각 파인더 검출. 입력은 정규화된 luma와 검은 성분 쿼드뿐이에요.
 * 내부 flood를 하지 않아요. 한 마커로 면 전체를 외삽하지 않아요.
 */
import { estimateHomography4, estimateHomographyN, projectPoint } from './decoder/homography.js';
import { normalizeHProfile, readHFormatByte } from './h-profile.js';
import { hLayout, hamming, hReservedLevel, validateHFace } from './h-layout.js';
import { hCornerCodebook } from './h-corner-layout.js';

const BLACK_MAX = 0.18;
const WHITE_MIN = 0.82;
const MATCH_HAMMING_MAX = 2;
const MATCH_MARGIN_MIN = 4;
const MAX_QUADS = 128;
const MAX_FACES = 12;
const MAX_REJECTED = 32;
const CORNER_CELL = 0.35;
const BOOK = hCornerCodebook();
const LOCAL_BORDER = Object.freeze([
  Object.freeze({ x: 1, y: 1 }),
  Object.freeze({ x: 9, y: 1 }),
  Object.freeze({ x: 9, y: 9 }),
  Object.freeze({ x: 1, y: 9 }),
]);
const VERSIONS = Object.freeze([5, 6, 7, 8]);

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

// 외곽/quiet 셀은 얇은 outline과 이웃 면 사이에 있어요. bilinear 지지영역이
// 이웃 셀을 건너면 흰색도 회색이 돼요. 중심 70% 안에 픽셀 전체가 들어가는
// 가장 가까운 표본을 색과 무관하게 고르고, 없으면 기존 중심 보간을 써요.
function sampleQuietCell(field,H,i,j){
  const center=projectH(H,j+.5,i+.5);
  const quad=[[.15,.15],[.85,.15],[.85,.85],[.15,.85]].map(([x,y])=>projectH(H,j+x,i+y));
  if(!center||quad.some(p=>!p))return NaN;
  const inside=(x,y)=>{
    let positive=false,negative=false;
    for(let k=0;k<4;k++){
      const a=quad[k],b=quad[(k+1)%4],cross=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);
      if(cross>1e-8)positive=true;if(cross< -1e-8)negative=true;
      if(positive&&negative)return false;
    }
    return true;
  };
  const candidates=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const x=Math.floor(center.x)+dx,y=Math.floor(center.y)+dy;
    if(x>=0&&y>=0&&x<field.width&&y<field.height)candidates.push({x,y,d:(x+.5-center.x)**2+(y+.5-center.y)**2});
  }
  candidates.sort((a,b)=>a.d-b.d);
  for(const p of candidates)if(inside(p.x,p.y)&&inside(p.x+1,p.y)&&inside(p.x+1,p.y+1)&&inside(p.x,p.y+1))return field.data[p.y*field.width+p.x];
  return sample(field,center.x,center.y);
}

function bitFromLuma(v) {
  if (!Number.isFinite(v)) return null;
  if (v <= BLACK_MAX) return 1;
  if (v >= WHITE_MIN) return 0;
  return null;
}

function d4Polygons(ccw) {
  const rows = [];
  for (let r = 0; r < 4; r += 1) rows.push([0, 1, 2, 3].map((k) => ccw[(k + r) % 4]));
  const cw = [ccw[0], ccw[3], ccw[2], ccw[1]];
  for (let r = 0; r < 4; r += 1) rows.push([0, 1, 2, 3].map((k) => cw[(k + r) % 4]));
  return rows;
}

function orderCcw(quad) {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  return quad.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
}

function slotOrigin(n, slot) {
  if (slot === 0) return { i: 0, j: 0 };
  if (slot === 1) return { i: 0, j: n - 10 };
  if (slot === 2) return { i: n - 10, j: n - 10 };
  return { i: n - 10, j: 0 };
}

function matchBits(bits) {
  let best = null;
  let second = Infinity;
  for (const row of BOOK) {
    const d = hamming(bits, row.bits);
    if (!best || d < best.d) {
      second = best ? best.d : Infinity;
      best = { d, row };
    } else if (d < second) second = d;
  }
  if (!best || best.d > MATCH_HAMMING_MAX) return null;
  if (!(second - best.d >= MATCH_MARGIN_MIN)) return null;
  return best;
}

function readBits36(field, H) {
  const bits = new Uint8Array(36);
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 6; c += 1) {
      const bit = bitFromLuma(sampleCell(field, H, 2 + r, 2 + c));
      if (bit === null) return null;
      bits[r * 6 + c] = bit;
    }
  }
  return bits;
}

function verifyQuietBorder(field, H) {
  let quietBad = 0;
  let borderBad = 0;
  let quiet = 0;
  let border = 0;
  for (let u = 0; u < 10; u += 1) {
    for (let v = 0; v < 10; v += 1) {
      const value = sampleCell(field, H, u, v);
      if (!Number.isFinite(value)) return false;
      const quietCell = u === 0 || v === 0 || u === 9 || v === 9;
      const borderCell = !quietCell && (u === 1 || v === 1 || u === 8 || v === 8);
      if (quietCell) {
        quiet += 1;
        if (!(value >= WHITE_MIN)) quietBad += 1;
      } else if (borderCell) {
        border += 1;
        if (!(value <= BLACK_MAX)) borderBad += 1;
      }
      if(quietBad>2||borderBad>2)return false;
    }
  }
  return quiet >= 32 && border >= 24 && quietBad <= 2 && borderBad <= 2;
}

function correctedBits(observed, expected) {
  const flipped = [];
  for (let k = 0; k < 36; k += 1) {
    if (observed[k] !== expected[k]) flipped.push(k);
  }
  return flipped;
}

function readMarker(field, quad, index) {
  if (!Array.isArray(quad) || quad.length !== 4) return { ok: false, reason: 'quad' };
  if(Array.from({length:4},(_,i)=>quad[i]).some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return {ok:false,reason:'quad'};
  const pts = quad.map((p) => ({ x: p.x, y: p.y }));
  const ordered = orderCcw(pts);
  const polys = d4Polygons(ordered);
  let best = null;
  for (let ori = 0; ori < 8; ori += 1) {
    const H = estimateHomography4(LOCAL_BORDER, polys[ori]);
    if (!H) continue;
    if (!verifyQuietBorder(field, H)) continue;
    const bits = readBits36(field, H);
    if (!bits) continue;
    const hit = matchBits(bits);
    if (!hit) continue;
    const center = projectH(H, 5, 5);
    const corners = LOCAL_BORDER.map((p) => projectH(H, p.x, p.y));
    if (!center || corners.some((p) => !p)) continue;
    const candidate = {
      ok: ori < 4,
      reason: ori >= 4 ? 'reflection' : null,
      mode: hit.row.mode,
      face: hit.row.face,
      slot: hit.row.slot,
      bits: Uint8Array.from(hit.row.bits),
      observedBits: bits,
      flipped: correctedBits(bits, hit.row.bits),
      hamming: hit.d,
      H,
      center,
      corners,
      rotation: ori % 4,
      mirror: ori >= 4,
      quadIndex: index,
    };
    if (!best || candidate.hamming < best.hamming) best = candidate;
  }
  return best || { ok: false, reason: 'no-marker' };
}

function cellPxOf(H) {
  const a = projectH(H, 0, 0);
  const b = projectH(H, 1, 0);
  const c = projectH(H, 0, 1);
  if (!a || !b || !c) return 0;
  return Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y));
}

function fitFace(markers, n) {
  if (markers.length !== 4) return null;
  const bySlot = [null, null, null, null];
  for (const m of markers) {
    if (bySlot[m.slot]) return null;
    bySlot[m.slot] = m;
  }
  if (bySlot.some((m) => !m)) return null;
  const canonicalCenters = [];
  const imageCenters = [];
  const canonicalCorners = [];
  const imageCorners = [];
  for (const m of bySlot) {
    const o = slotOrigin(n, m.slot);
    canonicalCenters.push({ x: o.j + 5, y: o.i + 5 });
    imageCenters.push(m.center);
    for (const p of LOCAL_BORDER) {
      canonicalCorners.push({ x: o.j + p.x, y: o.i + p.y });
    }
    imageCorners.push(...m.corners);
  }
  let H = estimateHomography4(canonicalCenters, imageCenters);
  if (!H) return null;
  const px = cellPxOf(H);
  if (!(px > 0)) return null;
  const limit = Math.max(0.75, CORNER_CELL * px);
  const residual = (Huse) => {
    let max = 0;
    for (let k = 0; k < 16; k += 1) {
      const q = projectH(Huse, canonicalCorners[k].x, canonicalCorners[k].y);
      if (!q) return Infinity;
      max = Math.max(max, Math.hypot(q.x - imageCorners[k].x, q.y - imageCorners[k].y));
    }
    return max;
  };
  let maxRes = residual(H);
  // 네 중심의 fit이 상한 안이어도 16개 실제 테두리로 더 정확한 사영을 고를 수 있어요.
  // 잔차 상한과 예약셀/본문 검증은 그대로 유지해요.
  {
    const Href = estimateHomographyN(canonicalCorners, imageCorners);
    if (Href) {
      const refit = residual(Href);
      if (refit < maxRes) {
        H = Href;
        maxRes = refit;
      }
    }
  }
  if (!(maxRes <= limit)) return null;
  return { H, cellPx: cellPxOf(H), maxResidualPx: maxRes, maxResidualCell: maxRes / Math.max(cellPxOf(H), 1e-6) };
}

function combinations(slots) {
  const counts = slots.map((list) => list.length);
  const total = counts.reduce((s, n) => s * n, 1);
  if (total > 16) return null;
  const out = [];
  const walk = (i, acc) => {
    if (i === 4) {
      out.push(acc.slice());
      return;
    }
    for (const m of slots[i]) {
      acc.push(m);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function readFace(field, markers, version) {
  const n = 13 + 4 * version;
  const fit = fitFace(markers, n);
  if (!fit) return { ok: false, reason: 'face-fit' };
  const H = fit.H;
  const mode = markers[0].mode;
  const face = markers[0].face;
  let layout;
  try {
    layout = hLayout(version, 'corners');
  } catch {
    return { ok: false, reason: 'layout' };
  }
  if (layout.n !== n) return { ok: false, reason: 'layout-n' };
  const formatVotes = Array.from({ length: 8 }, () => []);
  for (const cell of layout.formatCells) {
    const bit = bitFromLuma(sampleCell(field, H, cell.i, cell.j));
    if (bit === null) return { ok: false, reason: 'format-contrast' };
    formatVotes[cell.bit].push(bit);
  }
  let formatByte = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    const votes = formatVotes[bit];
    if (!votes.length || votes.some((v) => v !== votes[0])) return { ok: false, reason: 'format-tile' };
    if (votes[0]) formatByte |= 1 << bit;
  }
  const format = readHFormatByte(formatByte);
  if (!format) return { ok: false, reason: 'format-byte' };
  const routeVotes = Array.from({ length: 8 }, () => []);
  for (const cell of layout.routeCells) {
    const bit = bitFromLuma(sampleCell(field, H, cell.i, cell.j));
    if (bit === null) return { ok: false, reason: 'route-contrast' };
    routeVotes[cell.bit].push(bit);
  }
  let routeId = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    const votes = routeVotes[bit];
    if (!votes.length || votes.some((v) => v !== votes[0])) return { ok: false, reason: 'route-tile' };
    if (votes[0]) routeId |= 1 << bit;
  }
  let profile;
  try {
    profile = normalizeHProfile({
      version, mode, tones: format.tones, ecc: format.ecc, mask: format.mask, finder: 'corners',
    });
  } catch {
    return { ok: false, reason: 'profile' };
  }
  const groups = Array.from({ length: profile.tones }, () => []);
  for (const cell of layout.reference) {
    const v = sampleCell(field, H, cell.i, cell.j);
    if (!Number.isFinite(v)) return { ok: false, reason: 'reference-sample' };
    const g = profile.tones === 2 ? (cell.tone2Rank ?? (cell.rank === 2 ? 1 : cell.rank)) : (cell.rank ?? (cell.i + cell.j) % 3);
    if (!Number.isInteger(g) || g < 0 || g >= profile.tones) return { ok: false, reason: 'reference-group' };
    groups[g].push(v);
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
  const flipped = new Set();
  for (const m of markers) {
    for (const bit of m.flipped) flipped.add(`${m.slot}:${bit}`);
  }
  const levels = new Uint8Array(n * n);
  for (const cell of layout.roles.values()) {
    const expected = hReservedLevel(cell, profile, face, routeId);
    const at = cell.i * n + cell.j;
    if (expected === null) {
      const v = sampleCell(field, H, cell.i, cell.j);
      if (!Number.isFinite(v)) {
        levels[at] = 255;
        continue;
      }
      let rank = 0;
      for (let t = 1; t < profile.tones; t += 1) {
        if (Math.abs(v - centers[t]) < Math.abs(v - centers[rank])) rank = t;
      }
      const dist = Math.abs(v - centers[rank]);
      const lo = ordered[0];
      const hi = ordered[ordered.length - 1];
      if (v < lo - refGap * 0.42 || v > hi + refGap * 0.42 || dist > refGap * 0.42) levels[at] = 255;
      else levels[at] = rank;
      continue;
    }
    if (expected === 5) {
      levels[at] = 5;
      continue;
    }
    const v = cell.role==='boundary'||cell.kind==='quiet'
      ? sampleQuietCell(field,H,cell.i,cell.j) : sampleCell(field, H, cell.i, cell.j);
    const markerBit = cell.role === 'marker' && cell.kind === 'bit'
      ? `${cell.slot}:${cell.bit}`
      : null;
    const correctedMarker = markerBit && flipped.has(markerBit);
    if (!correctedMarker) {
      if (!Number.isFinite(v)) return { ok: false, reason: 'reserved-sample' };
      if (expected === 3 && !(v <= BLACK_MAX)) return { ok: false, reason: 'reserved-black' };
      if (expected === 4 && !(v >= WHITE_MIN)) return { ok: false, reason: 'reserved-white',cell:{i:cell.i,j:cell.j,role:cell.role,kind:cell.kind,value:v},fit:{cellPx:fit.cellPx,maxResidualPx:fit.maxResidualPx} };
    }
    levels[at] = expected;
  }
  let known = 0;
  let dataCount = 0;
  for (const cell of layout.scan) {
    dataCount += 1;
    if (levels[cell.i * n + cell.j] !== 255) known += 1;
  }
  const knownRatio = dataCount ? known / dataCount : 0;
  if (!(knownRatio >= 0.55)) return { ok: false, reason: 'known-ratio' };
  if (!validateHFace(levels, { ...profile, face, routeId })) return { ok: false, reason: 'validate-face' };
  const corners = [
    projectH(H, 0, 0), projectH(H, n, 0), projectH(H, n, n), projectH(H, 0, n),
  ];
  if (corners.some((p) => !p)) return { ok: false, reason: 'face-quad' };
  const dataMargin = refGap * 0.42;
  const score = Math.min(1, Math.max(0,
    0.45 * Math.min(1, fit.cellPx / 12)
    + 0.25 * (1 - Math.min(1, refSpread / 0.06))
    + 0.30 * knownRatio,
  ));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    ok: true,
    finder: 'corners',
    version: profile.version,
    n: profile.n,
    mode: profile.mode,
    tones: profile.tones,
    ecc: profile.ecc,
    mask: profile.mask,
    routeId,
    face,
    levels,
    H,
    quad: corners.map((p) => ({ x: p.x, y: p.y })),
    rotation: 0,
    mirror: false,
    hamming: Math.max(...markers.map((m) => m.hamming)),
    quality: { score, refGap, refSpread, dataMargin, knownRatio },
    bounds: {
      minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys),
    },
  };
}

function pushRejected(rejected, row) {
  if (rejected.length < MAX_REJECTED) rejected.push(row);
}

/**
 * @param {{width:number,height:number,data:Float32Array}} field
 * @param {Array<Array<{x:number,y:number}>>} quads
 */
export function detectHCornerQuads(field, quads, options = {}) {
  const started = performance.now();
  const rejected = [];
  const empty = (extra = {}) => ({
    faces: [],
    rejected,
    stats: {
      elapsedMs: performance.now() - started,
      markers: extra.markers || 0,
      groups: extra.groups || 0,
      quads: Array.isArray(quads) ? Math.min(quads.length, MAX_QUADS) : 0,
      capped: extra.capped === true,
    },
  });
  if (!field || !Number.isInteger(field.width) || !Number.isInteger(field.height)
    || !(field.data instanceof Float32Array)
    || field.width<8||field.height<8||field.width*field.height>4_000_000
    || field.data.length !== field.width * field.height) {
    return empty();
  }
  if (!Array.isArray(quads)) return empty();
  const capped = quads.length > MAX_QUADS;
  const list = quads.slice(0, MAX_QUADS);
  const markers = [];
  for (let i = 0; i < list.length; i += 1) {
    const hit = readMarker(field, list[i], i);
    if (hit.ok === true) markers.push(hit);
    else if(hit.reason!=='no-marker')pushRejected(rejected, { reason: hit.reason, face: hit.face, slot: hit.slot, mode: hit.mode });
  }
  const buckets = new Map();
  for (const m of markers) {
    const key = `${m.mode}:${m.face}`;
    if (!buckets.has(key)) buckets.set(key, [[], [], [], []]);
    buckets.get(key)[m.slot].push(m);
  }
  const faces = [];
  let groups = 0;
  for (const [key, slots] of buckets) {
    if (slots.some((list) => list.length === 0)) {
      pushRejected(rejected, { reason: 'incomplete-slots', key });
      continue;
    }
    const combos = combinations(slots);
    if (!combos) {
      pushRejected(rejected, { reason: 'ambiguous-markers', key });
      continue;
    }
    const accepted = [];
    for (const combo of combos) {
      groups += 1;
      const unique = new Set(combo.map((m) => m.quadIndex));
      if (unique.size !== 4) continue;
      let best = null;
      let bestN = null;
      for (const version of VERSIONS) {
        const face = readFace(field, combo, version);
        if (face.ok !== true) {if(options.debug)pushRejected(rejected,{reason:face.reason,key,version,...(face.cell?{cell:face.cell,fit:face.fit}:{})});continue;}
        if (best) {
          best = null;
          bestN = 'ambiguous-n';
          break;
        }
        best = face;
        bestN = version;
      }
      if (bestN === 'ambiguous-n') {
        pushRejected(rejected, { reason: 'ambiguous-n', key });
        continue;
      }
      if (best) accepted.push(best);
    }
    if (accepted.length !== 1) {
      if (accepted.length > 1) pushRejected(rejected, { reason: 'ambiguous-instance', key, count: accepted.length });
      else if (accepted.length === 0) pushRejected(rejected, { reason: 'no-face', key });
      continue;
    }
    if (faces.length < MAX_FACES) faces.push(accepted[0]);
  }
  return {
    faces,
    rejected,
    stats: {
      elapsedMs: performance.now() - started,
      markers: markers.length,
      groups,
      quads: list.length,
      capped,
    },
  };
}
