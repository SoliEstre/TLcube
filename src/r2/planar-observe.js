/** 평면 O/A/V/K의 실제 광학 후보. 본문 복호·인코더·타입 최종 선택은 포함하지 않아요. */
import { R2_TYPE_O_PROFILE } from './profiles/o.js';
import { R2_TYPE_A_PROFILE } from './profiles/a.js';
import { R2_TYPE_V_PROFILE } from './profiles/v.js';
import { R2_TYPE_K_PROFILE } from './profiles/k.js';
import { FINDER_CELL_MASK_PATTERNS } from '../finder-patterns.js';
import { OAK_FINDER_PATTERNS, OAK_RENDER_ONLY_FINDER_PATTERNS } from '../finder-oak-patterns.js';
import { DAEHAN_FINDER_PATTERNS } from '../finder-daehan.js';
import { HYBRID_INNER_CUBE_BANDS } from '../bullseye.js';
import { detectCellFindersSteps } from '../decoder/cell-finder-detect.js';
import { detectBullseyesSteps } from '../decoder/bullseye-detect.js';
import { detectCentralCubeFindersSteps } from '../decoder/cube-detect.js';
import { findOAnchorHypothesesSteps, findAAnchorHypothesesSteps, findKAnchorHypothesesSteps } from '../decoder/anchor-detect.js';
import { findOCornerMarkerHypothesesSteps, findACornerMarkerHypothesesSteps, findKCornerMarkerHypothesesSteps } from '../decoder/corner-marker-detect.js';
import { createVerifiedCursorPrototypeV3 } from '../decoder/cs-verified-cursor-v3-prototype.js';
import { createCentralN7BlockCursor } from '../decoder/cellsurface-block-detect.js';
import { centralN7CenterPriorSeeds, centralN7FindersFromShapes } from '../decoder/central-n7-observe.js';
import { discoverCentralBeaconFindersSteps } from '../decoder/central-v0-observe.js';
import { BEACON_CS_BLOCK_LOCATOR, affineCellHomography } from '../decoder/central-beacon-observation-shared.js';
import { detectQrFinderTriplesSteps } from '../decoder/qr-finder-observe.js';
import { qrCenterHomographies } from '../decoder/qr-center-geometry.js';
import { readFormatWithCells } from '../decoder/format-read.js';
import { formatCells } from '../placement.js';
import { ECC_NAME_BY_VALUE } from '../formatinfo.js';
import { DEFAULT_MASK_INDEX } from '../mask.js';
import { verifySagoae } from '../decoder/sagoae-verify.js';

export const PLANAR_PROFILES = Object.freeze({ O: R2_TYPE_O_PROFILE, A: R2_TYPE_A_PROFILE,
  V: R2_TYPE_V_PROFILE, K: R2_TYPE_K_PROFILE });
export const PLANAR_FINDER_SOURCES = Object.freeze(['n7', 'qr', 'cell', 'bullseye', 'three-tone', 'daehan', 'v0']);
const FAMILIES = Object.freeze({ O: 'hex', A: 'tri', V: 'tri', K: 'star' });
const DIMENSIONS = Object.freeze(Object.fromEntries(['O', 'A', 'K'].map(id => [id,
  Object.freeze([...new Set(PLANAR_PROFILES[id].formatEntries.map(row => row.dimension))])])));
const ANCHORS = Object.freeze({ O: findOAnchorHypothesesSteps, A: findAAnchorHypothesesSteps, K: findKAnchorHypothesesSteps });
const MARKERS = Object.freeze({ O: findOCornerMarkerHypothesesSteps, A: findACornerMarkerHypothesesSteps, K: findKCornerMarkerHypothesesSteps });
const CELL_LINEUP = Object.freeze([...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS]);
const DAEHAN_LINEUP = Object.freeze([...CELL_LINEUP, ...DAEHAN_FINDER_PATTERNS, ...OAK_RENDER_ONLY_FINDER_PATTERNS]);

/** daehan 라인업은 cell/OAK의 상위집합이라 기본 경로에서 같은 픽셀을 두 번 훑지 않아요. */
export function planarSourcePasses(sources = PLANAR_FINDER_SOURCES) {
  if (!sources.includes('cell') || !sources.includes('daehan')) return [...sources];
  let emitted = false;
  return sources.flatMap(source => {
    if (source !== 'cell' && source !== 'daehan') return [source];
    if (emitted) return [];
    emitted = true;
    return ['daehan'];
  });
}
const validH = H => H instanceof Float64Array && H.length === 9 && H.every(Number.isFinite);
const ownH = finder => finder?.H ?? finder?.transform ?? finder?.B;

/** 항상 현재 표면 15셀에서 읽어요. 옛 n7 payload를 현재 CRC로 재사용하지 않아요. */
export function readPlanarFormats(field, hypothesis) {
  const profile = PLANAR_PROFILES[hypothesis.profile];
  if (!profile || !validH(hypothesis.H)) return { ok: false, formats: [], bindings: [] };
  const entries = profile.formatEntries.filter(row => row.dimension === hypothesis.k);
  const valid = [...new Set(entries.map(row => row.formatIndex))];
  const cells = formatCells(hypothesis.k).map(cell => hypothesis.profile === 'V'
    ? { q: -cell.q, r: -cell.r } : cell);
  const read = readFormatWithCells(field, { family: FAMILIES[hypothesis.profile], H: hypothesis.H, k: hypothesis.k }, {}, valid, cells, 1);
  if (!read.ok) return { ok: false, formats: [], bindings: [], detail: read.detail };
  const formats = [], bindings = [];
  for (const proposal of read.formatCandidates) {
    const ecc = ECC_NAME_BY_VALUE[proposal.eccLevel];
    if (!ecc) continue;
    for (const entry of entries.filter(row => row.formatIndex === proposal.versionIndex)) {
      const format = Object.freeze({ kind: 'read', layoutId: entry.layoutId, ecc,
        maskIndex: DEFAULT_MASK_INDEX, wire: 1 });
      formats.push(format);
      bindings.push({ profile, format, formatIndex: proposal.versionIndex });
    }
  }
  return { ok: formats.length > 0, formats, bindings, reads: read.reads };
}

/** D 예약 해석만 사괘의 독립 광학 증명을 요구해요. 기본 해석을 지우지 않아요. */
export function planarReservationProven(field, hypothesis, format) {
  if (!/D(?:Q)?$/.test(format.layoutId)) return true;
  return verifySagoae(field, hypothesis.H, hypothesis.k).ok === true;
}

function* n7Finders(field, origin, stats) {
  const cursor = createVerifiedCursorPrototypeV3(field, origin,
    { calibration: { csBlockLocator: BEACON_CS_BLOCK_LOCATOR } });
  try {
    while (cursor.status.phase !== 'done') { cursor.resume(origin); yield null; }
    const verified = cursor.takeForFrame(origin)?.verified ?? [];
    const seeds = centralN7CenterPriorSeeds(field, verified);
    yield null;
    const n7 = createCentralN7BlockCursor(field, seeds, origin);
    try {
      while (n7.status.phase !== 'done') { n7.resume(origin); yield null; }
      const shapes = n7.takeForFrame(origin)?.shapes ?? [];
      const found = centralN7FindersFromShapes(field, shapes);
      stats.finders += found.length;
      for (const finder of found) yield finder;
    } finally { n7.discard('planar-source-closed'); }
  } finally { cursor.discard('planar-source-closed'); }
}

function* findersForSource(field, source, origin, stats, shared = null) {
  if (source === 'n7') {
    if (!shared) { yield* n7Finders(field, origin, stats); return; }
    while (shared.lease.status.state === 'active') {
      shared.lease.resume(shared.current());
      yield null;
    }
    const observed = shared.lease.readOrigin();
    if (observed) {
      stats.finders += observed.finders.length;
      yield* observed.finders;
    }
    return;
  }
  if (source === 'v0') {
    const found = yield* discoverCentralBeaconFindersSteps(field, origin, { centralBeacon: { centralN7: false } });
    stats.finders += found.length;
    yield null;
    yield* found;
    return;
  }
  if (source === 'qr') {
    const read = yield* detectQrFinderTriplesSteps(field);
    for (const [index, qr] of (read.ok ? read.candidates : []).entries()) {
      if (qr.kind !== 'center' && qr.kindAmbiguous !== true) continue;
      for (const [axis, H] of qrCenterHomographies(qr).entries()) {
        stats.finders++;
        yield { H, transform: H, B: H, center: { ...qr.center }, centerQr: true,
          finderKind: 'center-qr', patternId: 'center-qr', orientation: axis,
          cellSize: Math.hypot(H[0], H[3]), sourceIndex: index };
      }
    }
    return;
  }
  if (source === 'bullseye') {
    const emitted = new Set();
    function* publish(finder) {
      const key = JSON.stringify([finder.innerBandsReplaced, ...ownH(finder)]);
      if (emitted.has(key)) return;
      emitted.add(key); stats.finders++; yield finder;
      // 원형 관측의 projective H와 별개인 등방 가설. 실제 포맷/본문 검증을 통과해야 해요.
      if (!Number.isFinite(finder.cellSize) || !Number.isFinite(finder.center?.x)
        || !Number.isFinite(finder.center?.y)) return;
      const H = affineCellHomography(finder.center, finder.cellSize, 0);
      stats.finders++;
      yield { ...finder, H, transform: H, B: H, geometryMode: 'affine',
        source: 'bullseye-isotropic-proposal' };
    }
    const cursor = detectBullseyesSteps(field, { ringLayouts: [0, HYBRID_INNER_CUBE_BANDS], streamCandidates: true });
    try {
      for (let step = cursor.next(); ; step = cursor.next()) {
        if (step.done) { for (const finder of step.value?.candidates ?? []) yield* publish(finder); break; }
        if (step.value?.kind === 'candidate') yield* publish(step.value.candidate);
        else yield null;
      }
    } finally { cursor.return?.(); }
    return;
  }
  const read = source === 'cell' ? yield* detectCellFindersSteps(field, CELL_LINEUP)
    : source === 'daehan' ? yield* detectCellFindersSteps(field, DAEHAN_LINEUP)
      : yield* detectCentralCubeFindersSteps(field);
  yield null;
  const found = read.ok ? read.candidates : [];
  stats.finders += found.length;
  yield* found;
}

/** 원자 관측 또는 기하 한 건마다 양보해요. null yield도 호출자의 시간 회계에 포함해요. */
export function* planarGeometrySteps(field, origin, stats, sources = PLANAR_FINDER_SOURCES, shared = null, accounting = null) {
  const finderOrdinals = new Map();
  function* geometryForFinder(finder, source) {
      const deferredGeometry = [];
      const H = ownH(finder);
      if (!validH(H)) return;
      const ordinal = finderOrdinals.get(source) ?? 0;
      finderOrdinals.set(source, ordinal + 1);
      const sourceIdentity = `planar:${origin.generation}:${origin.acquisition}:${source}:${ordinal}`;
      for (const id of ['O', 'A', 'K']) {
        if (finder.centralN7 && finder.centralN7.family !== FAMILIES[id]) continue;
        for (const k of DIMENSIONS[id]) {
          const base = { profile: id, family: FAMILIES[id], H: H.slice(), k,
            orientation: finder.orientation ?? 0, sourceKind: source, sourceIdentity, finder };
          deferredGeometry.push(base);
          // 검출된 중앙 포즈가 지닌 기하 가설. 임의 known H가 아니며 RS의 수락은 별도예요.
          if (source !== 'bullseye' || finder.source === 'bullseye-isotropic-proposal') {
            yield base;
            if (id === 'A') yield { ...base, H: H.slice(), profile: 'V', turn: true };
          }
        }
      }
  // 한 파인더의 기본 기하를 먼저 모두 내고 앵커·마커를 따로 재개해요.
  for (const base of deferredGeometry) {
          const { profile: id, k, finder, sourceIdentity, sourceKind: source } = base;
          stats.source = `${source}-anchor`;
          const anchored = yield* ANCHORS[id](field, finder, [k]);
          for (const [index, record] of (anchored.ok ? anchored.hypotheses : []).entries()) {
            yield { ...base, ...record, H: record.H.slice(), profile: id === 'A' && record.turn ? 'V' : id,
              sourceIdentity: `${sourceIdentity}:anchor:${id}:${k}:${index}`, sourceKind: `${source}-anchor` };
          }
  }
  for (const base of deferredGeometry) {
          const { profile: id, k, finder, sourceIdentity, sourceKind: source } = base;
          stats.source = `${source}-marker`;
          const marked = yield* MARKERS[id](field, finder, [k]);
          for (const [index, record] of (marked.ok ? marked.hypotheses : []).entries()) {
            yield { ...base, ...record, H: (record.refinedH ?? record.H).slice(), family: FAMILIES[id],
              profile: id === 'A' && record.turn ? 'V' : id,
              sourceIdentity: `${sourceIdentity}:marker:${id}:${k}:${index}`, sourceKind: `${source}-marker` };
          }
  }
  }
  const groups = planarSourcePasses(sources).map(source => ({ source, spentMs: 0, next: 0,
    tasks: [{ kind: 'source', iterator: findersForSource(field, source, origin, stats, shared), done: false }] }));
  try {
    // 한 unit의 비용은 0.001ms부터 수십ms까지 달라요. 단계 수가 아니라 실제 사용한
    // CPU가 가장 적은 작업에 다음 경계를 줘요. 양보 사이의 대기시간은 세지 않아요.
    while (true) {
      let group = null;
      for (const candidate of groups) if (candidate.tasks.some(task => !task.done)
        && (!group || candidate.spentMs < group.spentMs)) group = candidate;
      if (!group) break;
      let task;
      do { task = group.tasks[group.next++ % group.tasks.length]; } while (task.done);
      stats.source = group.source;
      const at = performance.now(), step = task.iterator.next();
      const elapsed = Math.max(0, performance.now() - at);
      if (accounting) accounting.recordGroup(group, elapsed);
      else group.spentMs += Math.max(0.001, elapsed);
      task.done = step.done;
      if (task.kind === 'source') {
        // 한 QR 소스가 가짜 32개를 내도 32개의 독립 CPU 몫을 얻지 않아요.
        // 그 소스의 획득·기하 전체가 같은 회계와 한 차례를 공유해요.
        if (!step.done && step.value) group.tasks.push({ kind: 'geometry',
          iterator: geometryForFinder(step.value, group.source), done: false });
        yield null;
      } else if (!step.done) yield step.value;
    }
  } finally {
    for (const group of groups) for (const task of group.tasks) task.iterator.return?.();
  }
}
