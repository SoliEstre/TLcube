/** 후보 카드와 실제 사영 실루엣. 디코더를 변경하지 않는 표시 전용 소비자예요. */
import { createCandidateHudModel, R2_CANDIDATE_SLOTS } from './r2-candidate-hud-model.js';
import { HUD_ROLE, HUD_TONE_NONE } from './r2-hud-model.js';
import { candidateHudBounds, candidateHudFrameGeometry, candidateHudGeometry, candidateHudMode, candidateHudQuadSlot } from './r2/candidate-hud-geometry.js';
const DROP_COLOR = '#ff656d';
const SUCCESS_COLOR = '#66f5a0';

function polygon(ctx, points, offset, count) {
  for (let k = 0; k < count * 2; k += 1) if (!Number.isFinite(points[offset + k])) return false;
  ctx.moveTo(points[offset], points[offset + 1]);
  for (let k = 1; k < count; k += 1) ctx.lineTo(points[offset + k * 2], points[offset + k * 2 + 1]);
  ctx.closePath();
  return true;
}

/** 호출자의 document만 사용하고, 표시 문자열을 HTML로 해석하지 않아요. */
export function createCandidateHudRenderer({ container, overlay, stage, paintFor, labelFor = (key) => key }) {
  const model = createCandidateHudModel();
  const cacheStats = { canonicalBuilds: 0, frameBuilds: 0 };
  const doc = container.ownerDocument;
  const cards = R2_CANDIDATE_SLOTS.map(([row, column], index) => {
    const element = doc.createElement('div');
    element.className = 'r2-candidate-card';
    element.dataset.slot = String(index);
    element.style.gridRow = String(row + 1);
    element.style.gridColumn = String(column + 1);
    element.hidden = true;
    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const title = doc.createElement('span');
    title.className = 'r2-candidate-title';
    const progress = doc.createElement('span');
    progress.className = 'r2-candidate-progress';
    element.append(canvas, title, progress);
    container.append(element);
    return { element, canvas, title, progress, geometry: null };
  });

  function geometryFor(card, candidate) {
    const mode = candidateHudMode(candidate);
    if (!mode) return null;
    const stable = card.geometry
      && card.id === candidate.id && card.mode === mode && card.n === candidate.n
      && card.k === candidate.k && card.layoutId === candidate.layoutId
      && card.formatWire === candidate.formatWire && card.cellCoord === candidate.cellCoord
      && card.faceRevision === (mode === 'y-faces' ? candidate.revision : undefined);
    if (stable) return card.geometry;
    const geometry = candidateHudGeometry(candidate);
    if (!geometry) return null;
    const bounds = candidateHudBounds(geometry, new Float64Array(4));
    if (!bounds || !(bounds[2] > bounds[0]) || !(bounds[3] > bounds[1])) return null;
    card.id = candidate.id; card.mode = mode; card.n = candidate.n; card.k = candidate.k;
    card.layoutId = candidate.layoutId; card.formatWire = candidate.formatWire;
    card.cellCoord = candidate.cellCoord; card.faceRevision = mode === 'y-faces' ? candidate.revision : undefined;
    card.frame = null;
    cacheStats.canonicalBuilds += 1;
    card.geometry = { ...geometry, bounds };
    return card.geometry;
  }

  function frameGeometryFor(card, candidate, geometry) {
    if (geometry.mode === 'y-faces') return geometry;
    const H = candidate.H;
    if (!H || H.length !== 9) return null;
    const same = card.frame && card.frameH && card.frameH.length === H.length
      && card.frameH.every((value, index) => Object.is(value, H[index]));
    if (same) return card.frame;
    const frame = candidateHudFrameGeometry(candidate, geometry);
    if (!frame) return null;
    card.frameH = Float64Array.from(H);
    card.frame = frame;
    cacheStats.frameBuilds += 1;
    return frame;
  }

  function cells(ctx, geometry, candidate, quads, alpha, correction) {
    const { count, roleGrid, scanGrid, toneGrid } = geometry;
    // 기존 HUD 색표를 받되 각 후보 자신의 scanGrid로 셀을 대응시켜요.
    const buckets = new Map();
    const isExactRevision = correction?.candidateId === candidate.id
      && (correction.revision === candidate.revision
        || (correction.revision === undefined && candidate.revision === undefined));
    const corrected = correction?.cells && isExactRevision ? new Set(correction.cells) : null;
    for (let cell = 0; cell < count; cell += 1) {
      for (let face = 0; face < 3; face += 1) {
        const idx = geometry.mode === 'c-hex' ? cell * 3 + face : cell;
        const role = roleGrid[idx];
        if (role === HUD_ROLE.EMPTY) continue;
        const scan = scanGrid[idx];
        const state = role === HUD_ROLE.DATA && scan >= 0 ? candidate.cellMap?.[scan] ?? 0 : 0;
        const quad = candidateHudQuadSlot(geometry, cell, face);
        const tone = toneGrid[quad / 8];
        const paint = paintFor(role, state, tone === HUD_TONE_NONE ? null : tone, corrected?.has(scan) === true);
        if (!paint) continue;
        let bucket = buckets.get(paint.color);
        if (!bucket) { bucket = { path: new Path2D(), alpha: paint.alpha }; buckets.set(paint.color, bucket); }
        polygon(bucket.path, quads, quad, 4);
      }
    }
    for (const [color, bucket] of buckets) {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * bucket.alpha;
      ctx.fill(bucket.path);
    }
    ctx.globalAlpha = 1;
  }

  function outline(ctx, geometry) {
    const paths = geometry.outlinePaths ?? 1;
    for (let path = 0; path < paths; path += 1) polygon(ctx, geometry.outline, path * geometry.outlineCount * 2, geometry.outlineCount);
  }

  function render(candidates, timestamp, { enabled = true, correction = null } = {}) {
    if (!enabled) { reset(); return; }
    // producer가 명시한 기하만 소비해요. C를 Y 격자로 꾸며 그리지 않아요.
    model.update(candidates.filter((candidate) => candidateHudMode(candidate)), timestamp);
    container.hidden = false;
    overlay.hidden = false;
    stage.classList.add('r2-candidate-mode');
    const side = stage.clientWidth;
    const dpr = Math.min(2, doc.defaultView?.devicePixelRatio || 1);
    const backing = Math.max(1, Math.round(side * dpr));
    if (overlay.width !== backing) overlay.width = backing;
    if (overlay.height !== backing) overlay.height = backing;
    const ctx = overlay.getContext('2d');
    ctx?.setTransform(1, 0, 0, 1, 0, 0);
    ctx?.clearRect(0, 0, backing, backing);
    container.dataset.leaderId = model.leaderId || '';
    // 선두 채움을 먼저 그려서 나머지 후보의 외곽선을 덮지 않아요.
    const order = model.slots.filter(Boolean).sort((a, b) => Number(b.id === model.leaderId) - Number(a.id === model.leaderId));
    for (let index = 0; index < cards.length; index += 1) cards[index].element.hidden = !model.slots[index];
    for (const slot of order) {
      const card = cards[slot.slot];
      const candidate = slot.candidate;
      const color = slot.status === 'dropped' ? DROP_COLOR : slot.status === 'success' ? SUCCESS_COLOR : slot.color;
      card.element.hidden = false;
      card.element.dataset.candidateId = slot.id;
      card.element.dataset.state = slot.status;
      card.element.dataset.leader = String(slot.id === model.leaderId);
      card.element.style.setProperty('--candidate-color', color);
      card.element.style.opacity = String(slot.opacity);
      const dimension = candidate.dimensionKind === 'radius-k' ? `k${candidate.k ?? candidate.n}` : `n${candidate.n}`;
      const name = `${slot.slot + 1} · ${candidate.type || 'Y'} ${String(candidate.layoutId || '').replace(/^v0/i, '').toUpperCase() || '0'} · ${dimension}`;
      card.title.textContent = name;
      const percent = slot.status === 'success' ? 100 : Math.round(Math.max(0, Math.min(1, Number(candidate.D) || 0)) * 100);
      const state = slot.status === 'success' ? 'done' : slot.status === 'dropped' ? 'dropped' : slot.status === 'retained' ? 'hold' : 'collecting';
      card.progress.textContent = `${percent}% · ${labelFor(state)}`;
      card.element.setAttribute('aria-label', `${name}, ${card.progress.textContent}`);
      const geometry = geometryFor(card, candidate);
      const miniSide = Math.max(1, Math.round(side * .23 * dpr));
      if (card.canvas.width !== miniSide) card.canvas.width = miniSide;
      if (card.canvas.height !== miniSide) card.canvas.height = miniSide;
      const mini = card.canvas.getContext('2d');
      if (mini) {
        mini.setTransform(1, 0, 0, 1, 0, 0);
        mini.clearRect(0, 0, miniSide, miniSide);
        if (geometry) {
          const b = geometry.bounds;
          const scale = Math.min(miniSide * .88 / (b[2] - b[0]), miniSide * .80 / (b[3] - b[1]));
          mini.setTransform(scale, 0, 0, scale, (miniSide - (b[0] + b[2]) * scale) / 2, (miniSide - (b[1] + b[3]) * scale) / 2);
          cells(mini, geometry, candidate, geometry.quads, .88, correction);
          mini.beginPath(); outline(mini, geometry);
          mini.strokeStyle = color; mini.lineWidth = 1.2 * dpr / scale; mini.stroke();
        }
      }
      if (!ctx || !geometry || !(candidate.frameWidth > 0) || !(candidate.frameHeight > 0) || slot.status === 'dropped') continue;
      const sx = backing / candidate.frameWidth;
      const sy = backing / candidate.frameHeight;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      const actual = frameGeometryFor(card, candidate, geometry);
      if (!actual) continue;
      if (slot.id === model.leaderId) {
        cells(ctx, actual, candidate, actual.quads, .55 * slot.opacity, correction);
      }
      // 같은 위치의 가설을 임의로 옮기지 않아요. 점선 위상으로 겹친 윤곽을 구분해요.
      ctx.globalAlpha = slot.opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = (slot.id === model.leaderId ? 2.3 : 2) * dpr / sx;
      ctx.setLineDash(slot.id === model.leaderId && candidate.tracking ? [] : [4 * dpr / sx, (R2_CANDIDATE_SLOTS.length - 1) * 4 * dpr / sx]);
      ctx.lineDashOffset = slot.slot * 4 * dpr / sx;
      ctx.beginPath(); outline(ctx, actual); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
    }
  }

  function reset() {
    model.reset();
    container.hidden = true;
    overlay.hidden = true;
    container.dataset.leaderId = '';
    stage.classList.remove('r2-candidate-mode');
    for (const card of cards) { card.element.hidden = true; card.geometry = null; card.frame = null; card.frameH = null; }
  }

  return { render, reset, accept: (id, timestamp) => model.accept(id, timestamp), model,
    get cacheStats() { return { ...cacheStats }; } };
}
