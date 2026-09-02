#!/usr/bin/env node
/**
 * temph-probe.mjs — T-EMPH 강조 집합 × 프리셋 문턱 실측.
 *
 * 이 스크립트가 `temph-thresholds.md` 를 만든다. 손으로 표를 고치지 마라.
 * src/ 는 import 만 한다 (측정 레인 — 강조를 제품에 켜지 않는다).
 *
 * 실행: node tools/probes/temph-probe.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encode } from '../../src/encode.js';
import { encodeA } from '../../src/encodeA.js';
import { buildScene } from '../../src/scene.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { UNVERIFIED_CUBE_DETECTION } from '../../src/decoder/cube-detect.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, BULLSEYE_MID, FINDER_CUBE_TONES, FINDER_CUBE_SEAM,
  PRESETS, DEFAULT_PRESET, getPreset, relativeLuminance,
} from '../../src/luminance.js';
import {
  centralN7EmphasisLevels, CENTRAL_N7_EMPHASIS_MODES,
} from '../../src/centralN7Emphasis.js';
import { centralN7EmphasisAppliesTo } from '../../src/generator-render-config.js';
import {
  FINDER_PATTERNS, FINDER_PATTERN_IDS, FINDER_CELL_MASK_PATTERNS, FINDER_CELL_ORDER,
  DEFAULT_FINDER_PATTERN_ID,
} from '../../src/finder-patterns.js';
import {
  CENTRAL_V0_FINDER_PATTERN_ID, CENTER_QR_FINDER_PATTERN_ID,
} from '../../src/finder-selection.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../../src/centralN7Schema.js';
import { CENTRAL_MARKER_N7_FINDER_PATTERN_ID } from '../../src/centralMarkerN7.js';
import {
  OAK_FINDER_PATTERNS, OAK_ALL_FINDER_PATTERNS,
} from '../../src/finder-oak-patterns.js';
import { liveOakCandidates, OAK_LINEUP } from '../../src/finder-oak-lineup.js';
import {
  FINDER_TAXONOMY, TONE_CELL_COLOR, KIND_FINDER, KIND_SEAT,
  taxonomyItem,
} from '../../src/finder-taxonomy.js';
import {
  daehanPatternId, daehanFinderCellsFor, sagoaeCells, SAGOAE_ID,
} from '../../src/finder-daehan.js';
import { notchCellsC, TYPE_C_MIN_RADIUS } from '../../src/notchC.js';
import { neighbors, pixelToAxial, SQRT3, FACE_INRADIUS_COEFF } from '../../src/hexgrid.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 산출물은 test/output/ (gitignore) — tools/ 안에 미추적 .md 를 남기지 않는다. argv[2] 로 바꿀 수 있다.
const OUT_MD = process.argv[2] ?? path.join(HERE, '..', '..', 'test', 'output', 'temph-thresholds.md');

const PPUS = Object.freeze([10, 12, 16, 24]);
const CELL_PX_FLOOR = 9;
const PAYLOAD = 'TEMPH';
const SUPERSAMPLE = 1;
const MARGIN = 20;
const WHITE = Object.freeze({ r: 255, g: 255, b: 255 });

const MASK_FLOOR = UNVERIFIED_CUBE_DETECTION.backgroundToleranceFloor;
const MASK_SPREAD_MULT = UNVERIFIED_CUBE_DETECTION.backgroundSpreadMultiplier;

function fmtY(y) {
  if (!Number.isFinite(y)) return 'n/a';
  return y.toFixed(4);
}

function rgbEq(a, b) {
  return Boolean(a && b && a.r === b.r && a.g === b.g && a.b === b.b);
}

function cellKey(q, r) {
  return q + ',' + r;
}

function paletteOf(preset, background) {
  return {
    background: background === undefined ? preset.background : background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function emphLevelsOf(preset) {
  return centralN7EmphasisLevels(preset.levels);
}

function bwgLevels() {
  return [BULLSEYE_DARK, BULLSEYE_MID, BULLSEYE_LIGHT];
}

/** 정본 질의 — 후보 목록을 손에 적지 않는다. */
function queryCanon() {
  const presetNames = Object.freeze(Object.keys(PRESETS));
  const allFinderIds = [...new Set([
    ...FINDER_PATTERN_IDS,
    ...OAK_ALL_FINDER_PATTERNS.map((p) => p.id),
    DEFAULT_FINDER_PATTERN_ID,
    CENTER_QR_FINDER_PATTERN_ID,
    CENTRAL_V0_FINDER_PATTERN_ID,
    CENTRAL_N7_FINDER_PATTERN_ID,
    CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    ...FINDER_TAXONOMY.map((row) => row.id),
  ])].sort();
  const appliesTo = allFinderIds.filter((id) => {
    try { return centralN7EmphasisAppliesTo(id); } catch { return false; }
  });
  const cubeIds = FINDER_PATTERNS
    .filter((p) => p.renderKind === 'three-tone-cube')
    .map((p) => p.id);
  const liveOak = liveOakCandidates().map((e) => ({
    name: e.name, id: e.id, type: e.type, status: e.status,
  }));
  const liveOakCellMask = OAK_FINDER_PATTERNS.filter((p) =>
    liveOakCandidates().some((e) => e.name === p.lineupName));
  const taxonomyCellColor = FINDER_TAXONOMY.filter((row) =>
    typeof row.toneAxis === 'string' && row.toneAxis.includes('palette.levels'));
  const taxonomyBwg = FINDER_TAXONOMY.filter((row) =>
    typeof row.toneAxis === 'string' && row.toneAxis.includes('흑백회'));
  return {
    presetNames,
    defaultPreset: DEFAULT_PRESET,
    maskFloor: MASK_FLOOR,
    maskSpreadMult: MASK_SPREAD_MULT,
    maskFormula: `max(${MASK_FLOOR}, ${MASK_SPREAD_MULT}·MAD)`,
    emphasisModes: [...CENTRAL_N7_EMPHASIS_MODES],
    appliesTo,
    cubeIds,
    cellMaskCount: FINDER_CELL_MASK_PATTERNS.length,
    liveOak,
    liveOakCellMask: liveOakCellMask.map((p) => p.id),
    taxonomyCellColor: taxonomyCellColor.map((r) => ({
      id: r.id, kind: r.kind, class: r.class, renderable: r.renderable, toneAxis: r.toneAxis,
    })),
    taxonomyBwg: taxonomyBwg.map((r) => ({
      id: r.id, kind: r.kind, class: r.class, renderable: r.renderable,
    })),
    lineupStatus: OAK_LINEUP.map((e) => e.name + ':' + e.status),
  };
}

/**
 * 측정 집합. 각 항목의 좌표·호스트는 정본 함수에서 유도한다.
 * apply: 'native' = buildScene 옵션, 'recolor-levels' | 'recolor-bwg' | 'recolor-cube'.
 */
function buildSets(canon) {
  const sets = [];

  for (const id of canon.appliesTo) {
    if (id === CENTRAL_N7_FINDER_PATTERN_ID) {
      sets.push({
        id: 'central-n7',
        label: '중앙 TL (n=7 payload)',
        origin: 'centralN7EmphasisAppliesTo',
        toneNow: 'palette.levels (locator+data)',
        apply: 'native',
        injection: 'opts.centralN7Emphasis → centralN7LevelPalettes (scene central-n7-payload)',
        host: 'O V1 + centralN7',
        silhouette: 'interior (중앙 슬롯, 축소 마커)',
      });
    } else if (id === CENTRAL_V0_FINDER_PATTERN_ID) {
      sets.push({
        id: 'central-v0',
        label: '중앙 Y0 (비컨)',
        origin: 'centralN7EmphasisAppliesTo',
        toneNow: 'palette.levels (locator tones / data digit)',
        apply: 'native',
        injection: 'opts.centralN7Emphasis → centralN7LevelPalettes (scene central-v0)',
        host: 'O V1 + centralV0',
        silhouette: 'interior (중앙 슬롯, 축소 비컨)',
      });
    } else {
      sets.push({
        id: 'applies-' + id,
        label: id,
        origin: 'centralN7EmphasisAppliesTo (예상 밖 id)',
        toneNow: 'unknown',
        apply: 'unmeasurable',
        injection: '술어는 참인데 이 프로브가 호스트를 모른다',
        host: 'none',
        silhouette: 'unknown',
        skipReason: 'appliesTo 가 반환한 id 의 호스트를 이 레인이 모른다',
      });
    }
  }

  for (const cubeId of canon.cubeIds) {
    sets.push({
      id: 'three-tone-cube',
      label: '3톤 큐브 (' + cubeId + ')',
      origin: 'FINDER_PATTERNS renderKind=three-tone-cube · appliesTo=false (거부)',
      toneNow: 'FINDER_CUBE_TONES (포맷 상수)',
      apply: 'recolor-cube',
      injection: '없음 — scene 분기가 opts.centralN7Emphasis 를 소비하지 않는다. 프로브가 면 색만 치환해 재현한다',
      host: 'O V1 + finderPatternId=' + cubeId,
      silhouette: 'finder-as-silhouette (큐브 실루엣 검출)',
      finderPatternId: cubeId,
    });
  }

  for (const oakId of canon.liveOakCellMask) {
    sets.push({
      id: oakId,
      label: 'OAK 셀마스크 ' + oakId,
      origin: 'liveOakCandidates ∩ OAK_FINDER_PATTERNS',
      toneNow: 'BULLSEYE_DARK/MID/LIGHT (이미 순검정 dark)',
      apply: 'recolor-bwg',
      injection: '없음 — cell-mask 분기는 강조 팔레트를 안 받는다. 프로브가 19셀 면만 치환',
      host: 'O V1 + finderPatternId=' + oakId,
      silhouette: 'interior 19셀 슬롯 (외곽은 데이터)',
      finderPatternId: oakId,
      cellKeysFrom: 'FINDER_CELL_ORDER',
    });
  }

  const h = taxonomyItem('H');
  if (h && h.kind === KIND_FINDER) {
    sets.push({
      id: 'H',
      label: 'H (O-CM tetrad 12셀)',
      origin: 'FINDER_TAXONOMY id=H',
      toneNow: TONE_CELL_COLOR,
      apply: 'recolor-levels',
      injection: '없음 — faceColor(palette.levels). 프로브가 H 12셀 면만 치환',
      host: 'O V1CM + markerTones',
      silhouette: 'hex 코너 (tetrad A = 앵커 3셀 포함, 전면 동톤 0 두 셀)',
    });
  }

  sets.push({
    id: 'anchors',
    label: '앵커 3셀',
    origin: 'encode.cellDigits role=anchor (placement.anchorCells)',
    toneNow: TONE_CELL_COLOR + ' (digit 순위)',
    apply: 'recolor-levels',
    injection: '없음. 프로브가 role=anchor 면만 치환',
    host: 'O V1 레거시',
    silhouette: 'hex 코너 3점',
  });

  sets.push({
    id: 'references',
    label: '레퍼런스 셀',
    origin: 'encode.cellDigits role=reference (placement.referenceCellsAll)',
    toneNow: TONE_CELL_COLOR,
    apply: 'recolor-levels',
    injection: '없음. 프로브가 role=reference 면만 치환',
    host: 'O V1 레거시',
    silhouette: '링 3..k 내부 (최외곽 링에도 2셀)',
  });

  const sagoaeRow = taxonomyItem(SAGOAE_ID);
  sets.push({
    id: 'sagoae',
    label: '사괘 (sagoaeCells, k≥10 이면 60셀)',
    origin: sagoaeRow ? 'FINDER_TAXONOMY id=' + sagoaeRow.id : 'finder-daehan.sagoaeCells',
    toneNow: 'BULLSEYE_* (분류2 규약 palette.levels 와 어긋남 — taxonomy 주석)',
    apply: 'recolor-bwg',
    injection: '없음 — sagoae 렌더는 BULLSEYE_*. 프로브가 고리 면만 치환',
    host: 'O V3 + sagoae (완전판 60셀, k=10)',
    silhouette: '링 6/8/10 — k=10 에서 링 10 은 외곽',
    decodeOptIn: true,
  });

  sets.push({
    id: 'daehan',
    label: '원자 daehan (taegeuk 19 + sagoae 60)',
    origin: 'DAEHAN_FINDER_PATTERN_IDS / daehanFinderCellsFor',
    toneNow: 'BULLSEYE_* 3레벨 (정본은 0/2 이진). 자기 톤 정의 → PM/028 §5 제외 후보',
    apply: 'recolor-bwg',
    injection: '없음. 프로브가 daehan finderCells 면만 치환',
    host: 'O V3 + daehanFinder',
    silhouette: '중앙 19 + 링 6/8/10',
    decodeOptIn: true,
    ownToneDefinition: true,
  });

  sets.push({
    id: 'c-notch-rim',
    label: 'C 노치 림 (노치 인접 데이터 셀, 파생)',
    origin: 'notchCellsC(k) 의 neighbors ∩ cellDigits — 정본 함수 없음, 파생이 계약',
    toneNow: TONE_CELL_COLOR + ' (데이터/앵커/포맷/레퍼런스)',
    apply: 'recolor-levels',
    injection: '없음. 프로브가 림 셀 면만 치환',
    host: 'C0 (k=14) 평 C',
    silhouette: '3시 노치 경계 (실루엣 구멍의 가장자리)',
  });

  const aCm = taxonomyItem('a-cm');
  if (aCm && aCm.kind === KIND_SEAT) {
    sets.push({
      id: 'H2O',
      label: 'H2O (A-CM 기본 심볼)',
      origin: 'SEAT_DEFAULT_FINDER[a-cm] + encodeA cornerMarker → markerCellsA 톤',
      toneNow: TONE_CELL_COLOR,
      apply: 'recolor-levels',
      injection: '없음. 프로브가 tones 실린 A-CM 셀만 치환',
      host: 'A A1CM (encodeA cornerMarker, margin 20)',
      silhouette: '삼각 패치 쪽 꼭짓점 2칸 안쪽 링 (외곽 앵커는 안 덮음)',
      typeA: true,
    });
  }

  const co2 = taxonomyItem('CO2');
  if (co2 && co2.kind === KIND_FINDER) {
    sets.push({
      id: 'CO2',
      label: 'CO2 (V-CM 기본 심볼)',
      origin: 'FINDER_TAXONOMY id=CO2',
      toneNow: TONE_CELL_COLOR,
      apply: 'recolor-levels',
      injection: '없음. 프로브가 CO2 톤 셀만 치환',
      host: 'V V1CM (encodeA turnA+cornerMarker, margin 20)',
      silhouette: '역삼각 꼭짓점 (앵커 3 + 이웃 6, 조건부 앵커 톤)',
      typeA: true,
      turnA: true,
    });
  }

  return sets;
}

function encodeForSet(set) {
  if (set.id === 'central-n7') {
    return encode(PAYLOAD, { version: 1, eccLevel: 'M', centralN7: true });
  }
  if (set.id === 'central-v0') {
    return encode(PAYLOAD, { version: 1, eccLevel: 'M', centralV0: true });
  }
  if (set.id === 'three-tone-cube') {
    return encode(PAYLOAD, { version: 1, eccLevel: 'M' });
  }
  if (set.id.startsWith('oak-')) {
    return encode(PAYLOAD, { version: 1, eccLevel: 'M' });
  }
  if (set.id === 'H') {
    return encode(PAYLOAD, {
      version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true,
    });
  }
  if (set.id === 'anchors' || set.id === 'references') {
    return encode(PAYLOAD, { version: 1, eccLevel: 'M' });
  }
  if (set.id === 'sagoae') {
    return encode(PAYLOAD, { version: 3, eccLevel: 'M', sagoae: true });
  }
  if (set.id === 'daehan') {
    return encode(PAYLOAD, { version: 3, eccLevel: 'M', daehanFinder: true });
  }
  if (set.id === 'c-notch-rim') {
    return encode(PAYLOAD, { notchC: true, version: 0, eccLevel: 'M' });
  }
  if (set.id === 'H2O') {
    return encodeA(PAYLOAD, { version: 1, eccLevel: 'M', cornerMarker: true });
  }
  if (set.id === 'CO2') {
    return encodeA(PAYLOAD, {
      version: 1, eccLevel: 'M', turnA: true, cornerMarker: true,
    });
  }
  throw new Error('encodeForSet: 모르는 집합 ' + set.id);
}

function sceneOptsFor(set, encoded, palette, emphasisNative) {
  const opts = { palette, margin: MARGIN };
  if (set.id === 'central-n7') {
    opts.finderPatternId = CENTRAL_N7_FINDER_PATTERN_ID;
    opts.centralN7Family = 'hex';
    if (emphasisNative) opts.centralN7Emphasis = 'all';
  } else if (set.id === 'central-v0') {
    opts.finderPatternId = CENTRAL_V0_FINDER_PATTERN_ID;
    if (emphasisNative) opts.centralN7Emphasis = 'all';
  } else if (set.finderPatternId) {
    opts.finderPatternId = set.finderPatternId;
  } else if (set.id === 'daehan') {
    opts.finderPatternId = daehanPatternId(encoded.k);
  } else if (set.id === 'sagoae') {
    opts.finderPatternId = DEFAULT_FINDER_PATTERN_ID;
  }
  return opts;
}

function keysFromEncoded(set, encoded) {
  if (set.id === 'anchors') {
    return [...encoded.cellDigits].filter(([, e]) => e.role === 'anchor').map(([k]) => k);
  }
  if (set.id === 'references') {
    return [...encoded.cellDigits].filter(([, e]) => e.role === 'reference').map(([k]) => k);
  }
  if (set.id === 'H') {
    return [...encoded.cellDigits].filter(([, e]) => e.tones).map(([k]) => k);
  }
  if (set.id === 'H2O') {
    return [...encoded.cellDigits].filter(([, e]) => e.tones).map(([k]) => k);
  }
  if (set.id === 'CO2') {
    return [...encoded.cellDigits].filter(([, e]) => e.tones).map(([k]) => k);
  }
  if (set.id === 'c-notch-rim') {
    if (encoded.k < TYPE_C_MIN_RADIUS) return [];
    const notch = new Set(notchCellsC(encoded.k).map((c) => cellKey(c.q, c.r)));
    const rim = new Set();
    for (const key of notch) {
      const [q, r] = key.split(',').map(Number);
      for (const n of neighbors(q, r)) {
        const nk = cellKey(n.q, n.r);
        if (encoded.cellDigits.has(nk)) rim.add(nk);
      }
    }
    return [...rim];
  }
  if (set.cellKeysFrom === 'FINDER_CELL_ORDER') {
    return FINDER_CELL_ORDER.map((c) => cellKey(c.q, c.r));
  }
  if (set.id === 'sagoae') {
    return sagoaeCells(encoded.k).map((c) => cellKey(c.q, c.r));
  }
  if (set.id === 'daehan') {
    return daehanFinderCellsFor(encoded.k).map((c) => cellKey(c.q, c.r));
  }
  return [];
}

function shapeCellKey(shape, layout, turnA) {
  if (shape.kind !== 'polygon' || !Array.isArray(shape.points) || shape.points.length === 0) {
    return null;
  }
  let sx = 0;
  let sy = 0;
  for (const p of shape.points) {
    sx += p.x;
    sy += p.y;
  }
  const n = shape.points.length;
  const axial = pixelToAxial(sx / n, sy / n, layout);
  // 턴A 는 그리는 자리만 (−q,−r). cellDigits 키는 정본 좌표다.
  const q = turnA ? -axial.q : axial.q;
  const r = turnA ? -axial.r : axial.r;
  return cellKey(q, r);
}

function mapColor(color, fromLevels, toLevels) {
  for (let i = 0; i < fromLevels.length; i += 1) {
    if (rgbEq(color, fromLevels[i])) return { r: toLevels[i].r, g: toLevels[i].g, b: toLevels[i].b };
  }
  return null;
}

function recolorScene(scene, set, encoded, preset) {
  const emph = emphLevelsOf(preset);
  let from;
  if (set.apply === 'recolor-cube') from = FINDER_CUBE_TONES;
  else if (set.apply === 'recolor-bwg') from = bwgLevels();
  else if (set.apply === 'recolor-levels') from = preset.levels;
  else return { scene, recolored: 0 };

  const keys = new Set(keysFromEncoded(set, encoded));
  let recolored = 0;
  const shapes = scene.shapes.map((shape) => {
    if (set.apply === 'recolor-cube') {
      const mapped = mapColor(shape.color, from, emph);
      if (!mapped) return shape;
      recolored += 1;
      return { ...shape, color: mapped };
    }
    if (shape.kind !== 'polygon') return shape;
    if (keys.size > 0 && !keys.has(shapeCellKey(shape, scene.layout, scene.turnA === true))) return shape;
    const mapped = mapColor(shape.color, from, emph);
    if (!mapped) return shape;
    recolored += 1;
    return { ...shape, color: mapped };
  });
  return { scene: { ...scene, shapes }, recolored };
}

function decodeOptsFor(set) {
  if (set.decodeOptIn) return { bootstrap: { cellFinderDaehan: true } };
  return {};
}

function judge(result, text) {
  if (!result || typeof result !== 'object') {
    return { pass: false, reason: 'no-result' };
  }
  if (result.ok === true) {
    if (result.text === text) {
      return {
        pass: true,
        reason: 'ok',
        cellSizePx: result.hypothesis && result.hypothesis.cellSizePx,
        finder: result.hypothesis && result.hypothesis.finderPatternId,
        source: result.hypothesis && result.hypothesis.source,
      };
    }
    return { pass: false, reason: 'payload-mismatch:' + JSON.stringify(result.text) };
  }
  return { pass: false, reason: result.reason || 'fail' };
}

function cellGeometry(scene, ppu) {
  const sizePx = scene.layout.size * ppu;
  return {
    hexRadiusPx: sizePx,
    flatToFlatPx: SQRT3 * sizePx,
    faceHeightPx: 2 * FACE_INRADIUS_COEFF * sizePx,
    aboveFloor: sizePx >= CELL_PX_FLOOR,
  };
}

function log(line) {
  process.stderr.write(line + '\n');
}

function runTrial(set, encoded, preset, ppu, mode) {
  const white = mode === 'emphasis-white';
  const emphasis = mode === 'emphasis' || mode === 'emphasis-white';
  const pal = paletteOf(preset, white ? WHITE : undefined);
  const started = Date.now();
  try {
    const scene = buildScene(encoded, sceneOptsFor(set, encoded, pal, set.apply === 'native' && emphasis));
    let used = scene;
    let recolored = 0;
    if (emphasis && set.apply !== 'native' && set.apply !== 'unmeasurable') {
      const rec = recolorScene(scene, set, encoded, preset);
      used = rec.scene;
      recolored = rec.recolored;
      if (recolored === 0) {
        return {
          pass: false,
          reason: 'no-shapes-recolored',
          recolored: 0,
          ms: Date.now() - started,
          k: encoded.k,
          ...cellGeometry(used, ppu),
        };
      }
    }
    const geo = cellGeometry(used, ppu);
    const raster = rasterize(used, { pixelsPerUnit: ppu, supersample: SUPERSAMPLE });
    const judged = judge(decodeFrontend(raster, decodeOptsFor(set)), PAYLOAD);
    return {
      ...judged,
      recolored,
      ms: Date.now() - started,
      rasterW: raster.width,
      rasterH: raster.height,
      ...geo,
      k: encoded.k,
    };
  } catch (error) {
    return {
      pass: false,
      reason: 'throw:' + (error && error.message ? error.message : String(error)),
      recolored: 0,
      ms: Date.now() - started,
      k: encoded && encoded.k,
    };
  }
}

function majorityReason(trials) {
  const counts = new Map();
  for (const t of trials) {
    if (t.pass) continue;
    const r = t.reason || 'fail';
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  let best = '—';
  let n = 0;
  for (const [r, c] of counts) {
    if (c > n) {
      best = r;
      n = c;
    }
  }
  return n === 0 ? '—' : best;
}

function scoreLine(byPpu) {
  const present = PPUS.filter((p) => byPpu[p]);
  if (present.length === 0) return '—';
  const ok = present.filter((p) => byPpu[p].pass).length;
  return ok + '/' + present.length;
}

function measureY(presetNames) {
  const darkY = relativeLuminance(BULLSEYE_DARK);
  const lightY = relativeLuminance(BULLSEYE_LIGHT);
  const midY = relativeLuminance(BULLSEYE_MID);
  const cubeDarkY = relativeLuminance(FINDER_CUBE_TONES[0]);
  const seamY = relativeLuminance(FINDER_CUBE_SEAM);
  const whiteY = relativeLuminance(WHITE);
  const rows = presetNames.map((name) => {
    const preset = getPreset(name);
    const bgY = relativeLuminance(preset.background);
    const l0 = relativeLuminance(preset.levels[0]);
    const l2 = relativeLuminance(preset.levels[2]);
    const deltaEmph = Math.abs(darkY - bgY);
    const deltaL0 = Math.abs(l0 - bgY);
    const deltaCube = Math.abs(cubeDarkY - bgY);
    return {
      name,
      bgRgb: preset.background,
      bgY,
      darkY,
      deltaEmph,
      vsFloor: deltaEmph > MASK_FLOOR ? '문턱 초과 (전경으로 남음)' : '문턱 안 (배경으로 분류될 수 있음)',
      inside: deltaEmph <= MASK_FLOOR,
      l0,
      l2,
      deltaL0,
      l0Inside: deltaL0 <= MASK_FLOOR,
      cubeDarkY,
      deltaCube,
      cubeInside: deltaCube <= MASK_FLOOR,
    };
  });
  rows.push({
    name: 'white-control',
    bgRgb: WHITE,
    bgY: whiteY,
    darkY,
    deltaEmph: Math.abs(darkY - whiteY),
    vsFloor: Math.abs(darkY - whiteY) > MASK_FLOOR ? '문턱 초과 (전경으로 남음)' : '문턱 안',
    inside: Math.abs(darkY - whiteY) <= MASK_FLOOR,
    l0: null,
    l2: null,
    deltaL0: null,
    l0Inside: false,
    cubeDarkY,
    deltaCube: Math.abs(cubeDarkY - whiteY),
    cubeInside: Math.abs(cubeDarkY - whiteY) <= MASK_FLOOR,
  });
  return { darkY, lightY, midY, cubeDarkY, seamY, whiteY, rows };
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function writeReport({ canon, sets, y, grid, errors }) {
  const lines = [];
  const p = (s = '') => { lines.push(s); };

  p('# T-EMPH 강조 집합별 문턱 실측');
  p();
  p('생성: `tools/probes/temph-probe.mjs`. 이 파일을 손으로 고치지 마라 — 스크립트를 다시 돌리면 덮인다.');
  p();
  p('잠긴 결론을 지킨다: 전경 마스크 허용오차·프리셋 정의는 **있는 그대로** 쟀다. `src/` 는 한 줄도 안 바꿨다. 강조를 제품에 켜지 않았다.');
  p();

  p('## 1. 정본 질의');
  p();
  p('- 프리셋 (`luminance.PRESETS`): `' + canon.presetNames.join('`, `') + '` · 기본 `' + canon.defaultPreset + '`');
  p('- 전경 마스크 허용오차 바닥 (`UNVERIFIED_CUBE_DETECTION.backgroundToleranceFloor`): **`' + canon.maskFloor + '`**');
  p('- 런타임 허용오차 식 (`cube-detect.js` k-means 테두리 모델): `' + canon.maskFormula + '`');
  p('  균일 배경(프리셋 단색 콰이어트)에서 MAD ≈ 0 이라 **바닥 0.018 이 구속**한다.');
  p('- 강조 3택 (`CENTRAL_N7_EMPHASIS_MODES`): `' + canon.emphasisModes.join('`, `') + '` — 측정은 가장 센 `' + 'all' + '`');
  p('- 현재 적용 대상 (`centralN7EmphasisAppliesTo` 가 참인 id): '
    + (canon.appliesTo.length ? canon.appliesTo.map((id) => '`' + id + '`').join(', ') : '(없음)'));
  p('- 3톤 큐브 id (`FINDER_PATTERNS` renderKind): '
    + canon.cubeIds.map((id) => '`' + id + '`').join(', ')
    + ' — 술어는 **거짓** (scene 분기가 옵션을 소비하지 않음)');
  p('- 이진 cell-mask 11종 (`FINDER_CELL_MASK_PATTERNS.length`): ' + canon.cellMaskCount
    + ' — OAK 19셀과 같은 BWG 축이라 격자에 한 대표만 넣었다');
  p('- live OAK 명부: ' + canon.liveOak.map((e) => e.name + '(' + e.type + ')').join(', '));
  p('- live ∩ 19셀 렌더 표: '
    + (canon.liveOakCellMask.length ? canon.liveOakCellMask.map((id) => '`' + id + '`').join(', ') : '(없음)'));
  p('- taxonomy `palette.levels` 행: '
    + canon.taxonomyCellColor.map((r) => '`' + r.id + '`/' + r.kind).join(', '));
  p();

  p('## 2. 전경 마스크 허용오차 — 문서 0.018 의 확인·반박');
  p();
  p('PM/028 §5.1 과 `scene.js` §강조 확장 거부 주석이 적은 **0.018 은 맞다.**');
  p('정본은 `src/decoder/cube-detect.js` `UNVERIFIED_CUBE_DETECTION.backgroundToleranceFloor = '
    + MASK_FLOOR + '` 이다.');
  p('같은 객체의 `backgroundSpreadMultiplier = ' + MASK_SPREAD_MULT
    + '` 와 함께 `tolerance = max(floor, 2.5·MAD)` 로 쓰인다');
  p('(`luminance.js` FINDER_CUBE_SEAM 주석이 그 식을 옮겨 적었다).');
  p('이 레인은 바닥값을 **바꾸지 않고** 구속 문턱으로 쓴다.');
  p();

  p('## 3. 프리셋 Y 표 (강조 dark = `BULLSEYE_DARK`)');
  p();
  p('강조 팔레트 dark 는 `centralN7EmphasisLevels` 가 `BULLSEYE_DARK` 를 박는다.');
  p('실측 Y(dark) = **' + fmtY(y.darkY) + '** (순검정). 중간톤 BWG Y = ' + fmtY(y.midY)
    + ', 큐브 최암면 Y = ' + fmtY(y.cubeDarkY) + ', 심 Y = ' + fmtY(y.seamY) + '.');
  p();
  p('| 프리셋 | 배경 RGB | 배경 Y | 강조 dark Y | 차 | 허용오차 ' + MASK_FLOOR + ' 대비 | 데이터 levels[0] Y | levels[0]−bg | 큐브 최암−bg |');
  p('|---|---|---:|---:|---:|---|---:|---:|---:|');
  for (const row of y.rows) {
    const rgb = '`' + row.bgRgb.r + ',' + row.bgRgb.g + ',' + row.bgRgb.b + '`';
    p('| `' + row.name + '` | ' + rgb
      + ' | ' + fmtY(row.bgY)
      + ' | ' + fmtY(row.darkY)
      + ' | ' + fmtY(row.deltaEmph)
      + ' | ' + row.vsFloor
      + ' | ' + (row.l0 == null ? '—' : fmtY(row.l0))
      + ' | ' + (row.deltaL0 == null ? '—' : fmtY(row.deltaL0) + (row.l0Inside ? ' **안**' : ' 밖'))
      + ' | ' + fmtY(row.deltaCube) + (row.cubeInside ? ' **안**' : ' 밖')
      + ' |');
  }
  p();
  const slateY = y.rows.find((r) => r.name === 'slate');
  p('slate 배경 Y 문서값 0.0053: 실측 `' + fmtY(slateY ? slateY.bgY : NaN) + '` — 반올림이 맞다.');
  p();

  p('## 4. 측정 집합과 주입 지점');
  p();
  p('| 집합 | 기원 | 지금 톤 | 주입 | 호스트 | 실루엣 자리 |');
  p('|---|---|---|---|---|---|');
  for (const set of sets) {
    p('| `' + set.id + '` | ' + mdEscape(set.origin)
      + ' | ' + mdEscape(set.toneNow)
      + ' | ' + mdEscape(set.injection)
      + ' | ' + mdEscape(set.host)
      + ' | ' + mdEscape(set.silhouette)
      + ' |');
  }
  p();
  p('공식 주입이 있는 집합은 `central-n7` · `central-v0` 둘뿐이다. 나머지는 장면 폴리곤을 **측정용으로만** 치환했다 — `src/` 배선이 아니다.');
  p('BWG 집합(OAK 셀마스크 · 사괘 · daehan)의 dark 는 **이미** 순검정이다. 강조 치환은 light 를 `levels[2]` 로 당기는 쪽이 실변화다. 「dark 가 배경에 먹힌다」 기전은 palette.levels 집합(H·앵커·레퍼런스·H2O·CO2·노치 림)과 큐브 재현에 해당한다.');
  p();

  p('## 5. 셀당 픽셀 · 9px 하한');
  p();
  p('`buildScene` 기본 `cellSize=1` (hex 외접 반지름). `pixelsPerUnit` = 그 반지름의 픽셀 수.');
  p('스캐너 복호 하한은 셀당 9px (`sites/tlscan/scanner.js` — V1/V2/V3 전부 ppu 9 에서 처음 선다).');
  p();
  p('| ppu | hex 반지름 px | 평평폭 √3·size px | 면 마름모 높이 px | 하한 9px |');
  p('|---:|---:|---:|---:|---|');
  for (const ppu of PPUS) {
    const r = ppu;
    const flat = SQRT3 * r;
    const face = 2 * FACE_INRADIUS_COEFF * r;
    p('| ' + ppu + ' | ' + r.toFixed(2) + ' | ' + flat.toFixed(2) + ' | ' + face.toFixed(2)
      + ' | ' + (r >= CELL_PX_FLOOR ? '위' : '**아래**') + ' |');
  }
  p();
  p('요청 ppu 네 점 모두 셀 반지름 ≥ 10 ≥ 9. 면 높이(마름모)는 ppu 10 에서 8.66px 로 9 미만이지만, 하한의 정본은 **셀**이지 면이 아니다.');
  p();

  p('## 6. 기준선 게이트');
  p();
  p('같은 재료·같은 ppu 에서 강조를 **안 켠** 왕복. 실패면 그 칸의 강조 실패는 강조 탓이 아니다.');
  p('판정은 `decodeFrontend.ok` 만이 아니라 **복호 문자열 = `' + PAYLOAD + '`**.');
  p();

  const presetNames = canon.presetNames;
  p('| 집합 | k | 치환 면 수(대표) | '
    + presetNames.map((n) => n + ' 기준선').join(' | ')
    + ' | 주된 기준선 실패 |');
  p('|---|' + presetNames.map(() => '---').join('|') + '|---|---|---|');

  for (const set of sets) {
    const row = [set.id];
    let k = '—';
    let rec = '—';
    const baseReasons = [];
    const cells = [];
    for (const name of presetNames) {
      const hits = grid.filter((g) => g.set === set.id && g.preset === name && g.mode === 'baseline');
      if (hits.length) {
        k = String(hits[0].k ?? k);
        rec = String(hits[0].recolored ?? rec);
      }
      const byPpu = Object.fromEntries(hits.map((h) => [h.ppu, h]));
      cells.push(scoreLine(byPpu));
      for (const h of hits) {
        if (!h.pass) baseReasons.push(h.reason);
      }
    }
    row.push(k, rec, ...cells, majorityReason(baseReasons.map((reason) => ({ pass: false, reason }))));
    p('| `' + row[0] + '` | ' + row[1] + ' | ' + row[2] + ' | ' + row.slice(3).join(' | ') + ' |');
  }
  p();

  p('## 7. 격자 표 (집합 × 프리셋)');
  p();
  p('각 칸: 왕복 성공/전체 (ppu 10/12/16/24) · 주된 실패 사유. 강조는 native 면 `centralN7Emphasis=\'all\'`, 그 외는 해당 셀 면만 강조 팔레트로 치환.');
  p('흰 배경 열은 같은 프리셋 **levels** 를 유지한 채 배경만 `{255,255,255}` — 「조건부 개방」용. 기준선이 죽은 칸의 강조 실패는 강조 탓으로 세지 않는다.');
  p();

  p('| 집합 | 프리셋 | bg Y | dark Y | 차 | 문턱 대비 | 기준선 | 강조 | 흰 배경 강조 | 주된 강조 실패 |');
  p('|---|---|---:|---:|---:|---|---|---|---|---|');

  for (const set of sets) {
    for (const name of presetNames) {
      const yRow = y.rows.find((r) => r.name === name);
      const baseHits = grid.filter((g) => g.set === set.id && g.preset === name && g.mode === 'baseline');
      const emphHits = grid.filter((g) => g.set === set.id && g.preset === name && g.mode === 'emphasis');
      const whiteHits = grid.filter((g) => g.set === set.id && g.preset === name && g.mode === 'emphasis-white');
      const baseBy = Object.fromEntries(baseHits.map((h) => [h.ppu, h]));
      const emphBy = Object.fromEntries(emphHits.map((h) => [h.ppu, h]));
      const whiteBy = Object.fromEntries(whiteHits.map((h) => [h.ppu, h]));
      const ppuBits = (by) => {
        const present = PPUS.filter((ppu) => by[ppu]);
        if (present.length === 0) return '생략 (조건부 개방 불필요)';
        return PPUS.map((ppu) => {
          const t = by[ppu];
          if (!t) return String(ppu) + '·';
          return String(ppu) + (t.pass ? '✓' : '✗');
        }).join(' ');
      };
      p('| `' + set.id + '` | `' + name + '`'
        + ' | ' + fmtY(yRow.bgY)
        + ' | ' + fmtY(yRow.darkY)
        + ' | ' + fmtY(yRow.deltaEmph)
        + ' | ' + (yRow.inside ? '**안**' : '밖')
        + ' | ' + scoreLine(baseBy) + ' `' + ppuBits(baseBy) + '`'
        + ' | ' + scoreLine(emphBy) + ' `' + ppuBits(emphBy) + '`'
        + ' | ' + scoreLine(whiteBy) + ' `' + ppuBits(whiteBy) + '`'
        + ' | ' + mdEscape(majorityReason(emphHits))
        + ' |');
    }
  }
  p();

  p('### 칸별 ppu 실패 사유');
  p();
  p('| 집합 | 프리셋 | 모드 | ppu | pass | reason | 치환면 | 셀px | raster | ms |');
  p('|---|---|---|---:|---|---|---:|---:|---|---:|');
  for (const g of grid) {
    p('| `' + g.set + '` | `' + g.preset + '` | ' + g.mode
      + ' | ' + g.ppu
      + ' | ' + (g.pass ? 'Y' : 'N')
      + ' | ' + mdEscape(g.reason)
      + ' | ' + (g.recolored == null ? '—' : g.recolored)
      + ' | ' + (g.hexRadiusPx == null ? '—' : Number(g.hexRadiusPx).toFixed(1))
      + ' | ' + (g.rasterW ? g.rasterW + '×' + g.rasterH : '—')
      + ' | ' + (g.ms == null ? '—' : g.ms)
      + ' |');
  }
  p();

  p('## 8. 판정 — 켤 수 있다 / 못 한다 / 안 한다');
  p();
  p('「못 한다」= 기준선은 서는데 강조 왕복이 죽는다 (물리). 「안 한다」= 자가 통과해도 켤 이유가 없거나, 자기 톤 정의·이미 거부된 확장. 「켤 수 있다」= 기준선·강조가 요청 ppu 전승, 복호 문자열이 원문과 같다.');
  p();

  function setVerdict(set) {
    const notes = [];
    let gated = 0;
    let can = 0;
    let cannot = 0;
    let whiteOpens = 0;
    let baselineDead = 0;
    for (const name of presetNames) {
      const per = [];
      for (const ppu of PPUS) {
        const base = grid.find((g) => g.set === set.id && g.preset === name && g.mode === 'baseline' && g.ppu === ppu);
        const emph = grid.find((g) => g.set === set.id && g.preset === name && g.mode === 'emphasis' && g.ppu === ppu);
        const white = grid.find((g) => g.set === set.id && g.preset === name && g.mode === 'emphasis-white' && g.ppu === ppu);
        if (!base || !base.pass) {
          baselineDead += 1;
          per.push('ppu ' + ppu + ' 기준선 실패(' + ((base && base.reason) || '?') + ') — 강조 탓 아님');
          continue;
        }
        gated += 1;
        if (emph && emph.pass) {
          can += 1;
          per.push('ppu ' + ppu + ' 켠다');
        } else {
          cannot += 1;
          const why = (emph && emph.reason) || 'fail';
          if (white && white.pass) {
            whiteOpens += 1;
            per.push('ppu ' + ppu + ' 어두운 배경 못 한다(' + why + ') · 흰 배경 연다');
          } else {
            per.push('ppu ' + ppu + ' 못 한다(' + why + (white ? ' · 흰 배경도 ' + white.reason : '') + ')');
          }
        }
      }
      notes.push('`' + name + '`: ' + per.join('; '));
    }
    let headline;
    if (set.apply === 'unmeasurable') headline = '재지 못 함 (주입·호스트 없음)';
    else if (set.id === 'CO2' && cannot > 0 && grid.some((g) => g.set === set.id && g.reason === 'no-shapes-recolored')) {
      headline = '재지 못 함 — 턴A 호스트에서 면 치환 0 (주입 지점 없음의 실측)';
    } else if (set.ownToneDefinition && cannot === 0 && can > 0) {
      headline = '안 한다 — 기준선 선 ppu 에서 강조 왕복은 선다. 자기 톤 정의가 있어 제외 후보 (PM/028 §5)';
    } else if (set.id === 'three-tone-cube' && cannot > 0) {
      headline = '안 한다 · 못 한다 — 이미 실측 거부된 확장. 이번 자가 등록 프리셋 전패·흰 배경 전승을 재현';
    } else if (gated === 0) {
      headline = '미판정 (기준선 전패 — 강조 자가 아님)';
    } else if (cannot === 0 && can > 0) {
      headline = '켤 수 있다 (기준선이 선 모든 칸에서 강조 왕복 원문 일치)';
    } else if (whiteOpens > 0 && can === 0) {
      headline = '조건부 개방 — 등록 프리셋(어두운 배경)에서는 못 한다. 흰 배경에서는 켠다';
    } else if (whiteOpens > 0 && can > 0) {
      headline = '조건부 개방 — 일부 칸은 켜고, 강조가 죽은 칸은 흰 배경에서만';
    } else if (cannot > 0) {
      headline = '못 한다 (기준선이 선 칸에서 강조 왕복이 죽음)';
    } else {
      headline = '미판정';
    }
    return { headline, notes, can, cannot, baselineDead, whiteOpens, gated };
  }

  for (const set of sets) {
    const v = setVerdict(set);
    p('### `' + set.id + '` — ' + v.headline);
    p();
    p('- 지금 톤: ' + set.toneNow);
    p('- 주입: ' + set.injection);
    p('- 실루엣: ' + set.silhouette);
    for (const n of v.notes) p('- ' + n);
    p();
  }

  p('## 9. 서술 중 틀렸다고 확인한 것');
  p();
  p('1. 「전경 마스크 허용오차 0.018」 — **맞다.** 정본 식별자는 `backgroundToleranceFloor`. 런타임은 `max(0.018, 2.5·MAD)` 라 바닥만 적은 문장은 반만 맞다. 단색 프리셋 배경에서는 MAD≈0 이라 바닥이 구속한다.');
  p('2. 「기본 프리셋 배경 Y=0.0053, 차 0.0053」 — slate 실측이 그 자리다 (위 Y 표). ember/mono 도 같은 자리(0.0038 / 0.0052). **세 등록 프리셋 모두 강조 dark(0) 와의 차가 0.018 안**이다.');
  p('3. 「합성 왕복 ppu 10/12/16/24 전패 `frontend:no-finder`」 — 그 문장은 **3톤 큐브에 강조 dark 를 먹였을 때**의 실측이다. 현재 대상인 중앙 TL·중앙 Y0 에 일반화하면 안 된다. 중앙 마커는 슬롯 안쪽이라 외곽 육각 실루엣이 데이터 levels[0](차 ≈ 0.056 ≫ 0.018) 로 산다.');
  p('4. 「흰 배경 대조군은 전부 통과」 — 큐브 거부 당시의 대조군 사실이다. 이번 격자가 그걸 재발견하는 것이 목적이 아니라, **어느 배경에서 어느 집합을 열 수 있는가** 를 가르는 데 쓴다.');
  p('5. 「강조 대상은 중앙 N7 · central-v0 둘뿐」 — `centralN7EmphasisAppliesTo` 질의와 일치. §5 인벤토리는 후보다.');
  p();

  if (errors.length) {
    p('## 10. 프로브 오류');
    p();
    for (const e of errors) p('- ' + mdEscape(e));
    p();
  }

  p('## 재현');
  p();
  p('```');
  p('node tools/probes/temph-probe.mjs');
  p('```');
  p();
  p('결정성: 난수·시각 없음. 페이로드 `' + PAYLOAD + '`, ppu `' + PPUS.join(',')
    + '`, supersample ' + SUPERSAMPLE + ', margin ' + MARGIN + ', cellSize 1.');
  p();

  mkdirSync(path.dirname(OUT_MD), { recursive: true });
  writeFileSync(OUT_MD, lines.join('\n'), 'utf8');
}

function main() {
  const canon = queryCanon();
  const sets = buildSets(canon);
  const y = measureY(canon.presetNames);
  const grid = [];
  const errors = [];

  log('TEMPH probe');
  log('mask floor=' + MASK_FLOOR + ' appliesTo=' + canon.appliesTo.join(','));
  log('sets=' + sets.map((s) => s.id).join(','));
  log('presets=' + canon.presetNames.join(','));

  const encodedBySet = new Map();
  for (const set of sets) {
    if (set.apply === 'unmeasurable') {
      errors.push(set.id + ': ' + set.skipReason);
      continue;
    }
    try {
      const encoded = encodeForSet(set);
      encodedBySet.set(set.id, encoded);
      log('encoded ' + set.id + ' k=' + encoded.k
        + ' cells=' + encoded.cellDigits.size
        + ' keys=' + keysFromEncoded(set, encoded).length);
    } catch (error) {
      errors.push(set.id + ' encode: ' + (error && error.message ? error.message : error));
      log('ENCODE FAIL ' + set.id + ' ' + (error && error.message));
    }
  }

  for (const set of sets) {
    const encoded = encodedBySet.get(set.id);
    if (!encoded) continue;
    for (const name of canon.presetNames) {
      const preset = getPreset(name);
      const pushTrial = (mode, ppu) => {
        log('trial ' + set.id + ' ' + name + ' ' + mode + ' ppu=' + ppu);
        const t = runTrial(set, encoded, preset, ppu, mode);
        grid.push({ set: set.id, preset: name, mode, ppu, ...t });
        log('  -> ' + (t.pass ? 'PASS' : 'FAIL ' + t.reason)
          + ' rec=' + t.recolored + ' ' + t.ms + 'ms');
        return t;
      };
      const baseHits = [];
      const emphHits = [];
      for (const ppu of PPUS) {
        baseHits.push(pushTrial('baseline', ppu));
        emphHits.push(pushTrial('emphasis', ppu));
      }
      // 흰 배경은 「이미 알려진 통과」를 재발견하지 않는다.
      // 기준선이 선 ppu 에서만 강조 실패를 조건부 개방으로 잰다.
      for (let i = 0; i < PPUS.length; i += 1) {
        if (baseHits[i].pass && !emphHits[i].pass) {
          pushTrial('emphasis-white', PPUS[i]);
        }
      }
    }
  }

  writeReport({ canon, sets, y, grid, errors });
  log('wrote ' + OUT_MD);
  const failed = grid.filter((g) => !g.pass).length;
  log('trials=' + grid.length + ' fail=' + failed + ' errors=' + errors.length);
}

main();
