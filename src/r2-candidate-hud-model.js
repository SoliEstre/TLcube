import { R2_INDICATOR } from './r2/session.js';

export const R2_CANDIDATE_COLORS = Object.freeze([
  '#38bdf8', '#f472b6', '#a78bfa', '#34d399',
  '#fbbf24', '#fb7185', '#22d3ee', '#c084fc',
  '#4ade80', '#facc15', '#60a5fa', '#e879f9',
]);

export const R2_CANDIDATE_SLOTS = Object.freeze([
  [0, 3], [1, 3], [2, 3], [3, 3],
  [3, 2], [3, 1], [3, 0], [2, 0],
  [1, 0], [0, 0], [0, 1], [0, 2],
].map((slot) => Object.freeze(slot)));

export const R2_CANDIDATE_SUCCESS_MS = 150;
export const R2_CANDIDATE_DROP_MS = 180;

const DROP_COLOR = '#ef4444';
const SUCCESS_COLOR = '#22c55e';

function checkedNow(nowMs) {
  const value = Number(nowMs);
  if (!Number.isFinite(value)) throw new TypeError('nowMs must be finite');
  return value;
}

function checkedCandidates(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const byId = new Map();
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object' || typeof candidate.id !== 'string') {
      throw new TypeError('each candidate must have a string id');
    }
    if (byId.has(candidate.id)) throw new TypeError(`duplicate candidate id: ${candidate.id}`);
    byId.set(candidate.id, candidate);
  }
  return byId;
}

function liveStatus(candidate) {
  return candidate.retained === true || candidate.tracking === false ? 'retained' : 'active';
}

export function createCandidateHudModel({ dropMs = R2_CANDIDATE_DROP_MS } = {}) {
  const duration = Number(dropMs);
  if (!Number.isFinite(duration) || duration < 0) throw new RangeError('dropMs must be finite and non-negative');

  const entries = new Array(R2_CANDIDATE_SLOTS.length).fill(null);
  let leaderId = null;
  let observedNow = 0;

  const hasRankableId = (id) => entries.some((entry) => entry !== null
    && entry.id === id && entry.status !== 'dropped' && Number.isFinite(entry.candidate.D));

  function rankLeader() {
    let bestD = -Infinity;
    for (const entry of entries) {
      if (entry === null || entry.status === 'dropped' || !Number.isFinite(entry.candidate.D)) continue;
      if (entry.candidate.D > bestD) bestD = entry.candidate.D;
    }
    if (bestD === -Infinity) {
      leaderId = null;
      return;
    }
    if (hasRankableId(leaderId)) {
      const current = entries.find((entry) => entry !== null && entry.id === leaderId);
      if (current?.candidate.D === bestD) return;
    }
    leaderId = entries.find((entry) => entry !== null && entry.status !== 'dropped'
      && Number.isFinite(entry.candidate.D) && entry.candidate.D === bestD)?.id ?? null;
  }

  function outputSlots() {
    return entries.map((entry, index) => {
      if (entry === null) return null;
      const droppedOpacity = duration === 0 ? 0
        : Math.max(0, Math.min(1, (entry.dropUntil - observedNow) / duration));
      return {
        slot: index,
        position: R2_CANDIDATE_SLOTS[index],
        id: entry.id,
        color: entry.status === 'dropped' ? DROP_COLOR
          : entry.status === 'success' ? SUCCESS_COLOR : R2_CANDIDATE_COLORS[index],
        candidate: entry.candidate,
        status: entry.status,
        opacity: entry.status === 'dropped' ? droppedOpacity
          : entry.status === 'success' ? 1 : (entry.candidate.retained === true || entry.candidate.tracking === false ? 0.38 : 1),
        dropUntil: entry.dropUntil,
      };
    });
  }

  function update(candidates, nowMs) {
    observedNow = checkedNow(nowMs);
    const byId = checkedCandidates(candidates);

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === null) continue;
      const current = byId.get(entry.id);
      const currentIsLive = current !== undefined && current.alive !== false && current.indicator !== R2_INDICATOR.DROPPED;
      if (entry.status === 'success') {
        if (currentIsLive) entry.candidate = current;
        byId.delete(entry.id);
        continue;
      }
      if (entry.status === 'dropped') {
        if (observedNow >= entry.dropUntil) {
          entries[index] = null;
        } else if (currentIsLive) {
          entry.candidate = current;
          entry.status = liveStatus(current);
          entry.dropUntil = 0;
          byId.delete(entry.id);
        } else {
          byId.delete(entry.id);
        }
        continue;
      }
      if (currentIsLive) {
        entry.candidate = current;
        entry.status = liveStatus(current);
        entry.dropUntil = 0;
        byId.delete(entry.id);
      } else {
        entry.status = 'dropped';
        entry.dropUntil = observedNow + duration;
        byId.delete(entry.id);
        if (duration === 0) entries[index] = null;
      }
    }

    for (const candidate of byId.values()) {
      if (candidate.alive === false || candidate.indicator === R2_INDICATOR.DROPPED) continue;
      const index = entries.indexOf(null);
      if (index < 0) break;
      entries[index] = { id: candidate.id, candidate, status: liveStatus(candidate), dropUntil: 0 };
    }
    rankLeader();
    return outputSlots();
  }

  function accept(id, nowMs) {
    observedNow = checkedNow(nowMs);
    const entry = entries.find((item) => item !== null && item.id === id && item.status !== 'dropped');
    if (!entry) return false;
    entry.status = 'success';
    entry.dropUntil = observedNow + R2_CANDIDATE_SUCCESS_MS;
    rankLeader();
    return true;
  }

  function reset() {
    entries.fill(null);
    leaderId = null;
    observedNow = 0;
  }

  return Object.freeze({
    update,
    accept,
    reset,
    get slots() { return outputSlots(); },
    get leaderId() { return leaderId; },
  });
}
