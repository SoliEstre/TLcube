
import {
  DEFAULT_LAYOUT, FACES, faceCentroid,
} from './hexgrid.js';
import {
  FINDER_CELL_ORDER, FINDER_FACE_BITS, FINDER_PATTERNS,
} from './finder-patterns.js';
import {
  cloneFinderEditorPattern, cycleCubeToneRanks, finderEditorPatternsEqual,
  serializeFinderEditorPattern,
} from './finder-editor-pattern.js';
import { bandRadii } from './bullseye.js';
import { encode } from './encode.js';
import { encodeA } from './encodeA.js';
import { buildScene } from './scene.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, FINDER_CUBE_TONES, getPreset,
} from './luminance.js';
import { rasterize } from './raster.js';
import { rasterToPng } from './png.js';
import { createExportFilenameFactory } from './export-filename.js';

const I18N = Object.freeze({
  ko: Object.freeze({
    title: '파인더 에디터', devBadge: '개발 도구',
    subtitle: '실제 Type O/A 데이터 필드 안에서 중앙 19셀 또는 3톤 큐브를 편집해요.',
    litFaces: '/ 57 밝은 면', cubeFaces: '/ 3톤 면', contextBadge: '실제 데이터 문맥',
    pointerHint: '좌클릭: 다음 톤 · 우클릭: 이전 톤 (드래그도 같은 방향)',
    shiftHint: '2톤에서는 Shift+클릭·드래그: 셀 3면 전체',
    keyboardHint: '키보드: 방향키로 면 선택, Space 다음 톤 · Shift+Space 이전 톤',
    contextTitle: '문맥', typeLabel: '코드 타입', dataLabel: '고정 테스트 데이터',
    regenerate: '재생성', editTitle: '편집', starterLabel: '시작점 불러오기',
    undo: '되돌리기', redo: '다시하기', reset: '초기화', invert: '반전',
    dataExportTitle: '데이터 내보내기', copyPattern: '표현 복사',
    pngTitle: 'PNG 내보내기', fullPng: '전체 코드', finderPng: '파인더 단독',
    custom: '사용자 편집',
    canvasAriaCell: '전체 Type {type} 코드. 중앙 19셀의 57면을 편집할 수 있어요.',
    canvasAriaCube: '전체 Type {type} 코드. 중앙 3톤 큐브의 세 면을 편집할 수 있어요.',
    ready: '시작점을 고른 뒤 면을 클릭하거나 드래그해 편집하세요.',
    dataChanged: '테스트 데이터 {index}로 주변 데이터 무늬를 다시 만들었어요.',
    loaded: '{name} 시작점을 불러왔어요.',
    resetDone: '57면을 모두 0으로 초기화했어요.', resetCubeDone: '3톤 큐브의 기본 밝기 순위를 복원했어요.',
    invertDone: '57면을 모두 반전했어요.', invertCubeDone: '3톤 큐브의 밝기 순서를 반전했어요.',
    undoDone: '이전 편집으로 돌아갔어요.', redoDone: '다음 편집을 다시 적용했어요.',
    copied: '파인더 표현을 클립보드에 복사했어요.',
    copyFailed: '클립보드 복사에 실패했어요: {message}',
    exporting: 'PNG를 만드는 중이에요…',
    fullSaved: '전체 코드 PNG를 저장했어요.', finderSaved: '파인더 단독 PNG를 저장했어요.',
    exportFailed: 'PNG 내보내기에 실패했어요: {message}',
    faceOn: '{cell}번 셀 {face}면을 켰어요.', faceOff: '{cell}번 셀 {face}면을 껐어요.',
    cellOn: '{cell}번 셀의 세 면을 켰어요.', cellOff: '{cell}번 셀의 세 면을 껐어요.',
    toneChanged: '{face}면: {from} → {to}', tone0: '어두움', tone1: '중간', tone2: '밝음',
  }),
  en: Object.freeze({
    title: 'Finder Editor', devBadge: 'Development tool',
    subtitle: 'Edit the central 19 cells or three-tone cube inside a real Type O or Type A data field.',
    litFaces: '/ 57 light faces', cubeFaces: '/ 3 tone faces', contextBadge: 'Real data context',
    pointerHint: 'Left click: next tone · right click: previous tone (drag keeps that direction)',
    shiftHint: 'For two-tone patterns, Shift+click or drag edits all three faces of a cell',
    keyboardHint: 'Keyboard: arrows select a face, Space next tone, Shift+Space previous tone',
    contextTitle: 'Context', typeLabel: 'Code type', dataLabel: 'Fixed test data',
    regenerate: 'Regenerate', editTitle: 'Edit', starterLabel: 'Load a starting point',
    undo: 'Undo', redo: 'Redo', reset: 'Reset', invert: 'Invert',
    dataExportTitle: 'Export data', copyPattern: 'Copy representation',
    pngTitle: 'Export PNG', fullPng: 'Full code', finderPng: 'Finder only',
    custom: 'Custom edit',
    canvasAriaCell: 'Full Type {type} code. Edit the 57 faces in its central 19 cells.',
    canvasAriaCube: 'Full Type {type} code. Edit the three faces of its central three-tone cube.',
    ready: 'Choose a starting point, then click or drag faces to edit the finder.',
    dataChanged: 'Rebuilt the surrounding data pattern with test data {index}.',
    loaded: 'Loaded the {name} starting point.',
    resetDone: 'Reset all 57 faces to 0.', resetCubeDone: 'Restored the default brightness order of the three-tone cube.',
    invertDone: 'Inverted all 57 faces.', invertCubeDone: 'Inverted the brightness order of the three-tone cube.',
    undoDone: 'Returned to the previous edit.', redoDone: 'Reapplied the next edit.',
    copied: 'Copied the finder representation to the clipboard.',
    copyFailed: 'Could not copy to the clipboard: {message}',
    exporting: 'Creating the PNG…',
    fullSaved: 'Saved the full-code PNG.', finderSaved: 'Saved the finder-only PNG.',
    exportFailed: 'Could not export the PNG: {message}',
    faceOn: 'Turned on face {face} of cell {cell}.', faceOff: 'Turned off face {face} of cell {cell}.',
    cellOn: 'Turned on all faces of cell {cell}.', cellOff: 'Turned off all faces of cell {cell}.',
    toneChanged: 'Face {face}: {from} → {to}', tone0: 'dark', tone1: 'middle', tone2: 'light',
  }),
  ja: Object.freeze({
    title: 'ファインダーエディター', devBadge: '開発ツール',
    subtitle: '実際の Type O / A データ領域の中央19セルまたは3トーンキューブを編集します。',
    litFaces: '/ 57 明面', cubeFaces: '/ 3トーン面', contextBadge: '実データの文脈',
    pointerHint: '左クリック：次のトーン・右クリック：前のトーン（ドラッグも同じ方向）',
    shiftHint: '2トーンでは Shift+クリック・ドラッグでセルの3面すべてを編集',
    keyboardHint: 'キーボード：矢印で面を選択、Spaceで次、Shift+Spaceで前のトーン',
    contextTitle: 'コンテキスト', typeLabel: 'コードタイプ', dataLabel: '固定テストデータ',
    regenerate: '再生成', editTitle: '編集', starterLabel: '開始パターンを読み込む',
    undo: '元に戻す', redo: 'やり直す', reset: '初期化', invert: '反転',
    dataExportTitle: 'データを書き出す', copyPattern: '表現をコピー',
    pngTitle: 'PNGを書き出す', fullPng: 'コード全体', finderPng: 'ファインダーのみ',
    custom: 'ユーザー編集',
    canvasAriaCell: 'Type {type} コード全体。中央19セルの57面を編集できます。',
    canvasAriaCube: 'Type {type} コード全体。中央3トーンキューブの3面を編集できます。',
    ready: '開始パターンを選び、面をクリックまたはドラッグして編集してください。',
    dataChanged: 'テストデータ {index} で周囲のデータ模様を再生成しました。',
    loaded: '{name} を開始パターンとして読み込みました。',
    resetDone: '57面をすべて0に初期化しました。', resetCubeDone: '3トーンキューブの標準の明度順を復元しました。',
    invertDone: '57面をすべて反転しました。', invertCubeDone: '3トーンキューブの明度順を反転しました。',
    undoDone: '前の編集に戻りました。', redoDone: '次の編集を再適用しました。',
    copied: 'ファインダー表現をクリップボードにコピーしました。',
    copyFailed: 'クリップボードにコピーできませんでした：{message}',
    exporting: 'PNGを作成しています…',
    fullSaved: 'コード全体のPNGを保存しました。', finderSaved: 'ファインダーのみのPNGを保存しました。',
    exportFailed: 'PNGを書き出せませんでした：{message}',
    faceOn: 'セル{cell}の{face}面をオンにしました。', faceOff: 'セル{cell}の{face}面をオフにしました。',
    cellOn: 'セル{cell}の3面をオンにしました。', cellOff: 'セル{cell}の3面をオフにしました。',
    toneChanged: '{face}面：{from} → {to}', tone0: '暗い', tone1: '中間', tone2: '明るい',
  }),
});

const PATTERN_NAMES = Object.freeze({
  bullseye: Object.freeze({ ko: '불스아이', en: 'Bullseye', ja: 'ブルズアイ' }),
  'pinwheel-3-0101-cw-missing-solid': Object.freeze({
    ko: '3날 바람개비', en: 'Three-blade pinwheel', ja: '3枚羽根の風車',
  }),
  'gap-ring-01-2-1-solid': Object.freeze({
    ko: '솔리드 틈 링', en: 'Solid gap ring', ja: 'ソリッド・ギャップリング',
  }),
  'flower-7-0020-coprime-offset': Object.freeze({
    ko: '7잎 꽃 — 컴팩트', en: 'Seven-petal flower — compact', ja: '7枚花 — コンパクト',
  }),
  'swirl-2-200': Object.freeze({ ko: '면 나선', en: 'Face swirl', ja: '面スワール' }),
  'pinwheel-c2-2-1100-cw': Object.freeze({
    ko: 'C2 쌍날 바람개비', en: 'C2 twin pinwheel', ja: 'C2 ツイン風車',
  }),
  'gap-ring-01-2-1-open': Object.freeze({
    ko: '열린 틈 링', en: 'Open gap ring', ja: 'オープン・ギャップリング',
  }),
  'flower-7-1020-coprime-offset': Object.freeze({
    ko: '7잎 꽃 — 와이드', en: 'Seven-petal flower — wide', ja: '7枚花 — ワイド',
  }),
  'swirl-c2-5-5-11-both': Object.freeze({ ko: 'C2 면 나선', en: 'C2 face swirl', ja: 'C2 面スワール' }),
  'tristar-refined-h3': Object.freeze({ ko: '개선 트라이스타', en: 'Refined tristar', ja: '改良トライスター' }),
  'tree-refined-h3': Object.freeze({ ko: '개선 나무', en: 'Refined tree', ja: '改良ツリー' }),
  'cats-refined-h3': Object.freeze({ ko: '개선 고양이', en: 'Refined cats', ja: '改良キャッツ' }),
  'central-cube-3tone': Object.freeze({ ko: '최대 3톤 큐브', en: 'Maximum three-tone cube', ja: '最大3トーンキューブ' }),
});

const DATA_CASES = Object.freeze([
  'FINDER-01-K7M2Q9X4P6R8T3W5', 'FINDER-02-Z4B8N1C7V5L3S9D2',
  'FINDER-03-H6J2F8A4G9K1M7Q5', 'FINDER-04-P3W9R5T1Y7U2I8O6',
  'FINDER-05-C8X4Z1V6B2N9M5L7', 'FINDER-06-S2D7F3G8H4J9K5A1',
  'FINDER-07-Q9W5E1R6T2Y8U4I7', 'FINDER-08-M4N8B3V7C2X6Z1L5',
  'FINDER-09-A7S3D9F5G1H6J2K8', 'FINDER-10-U5I1O7P3L9K4J8H2',
  'FINDER-11-R8T4Y9U5I2O6P1Q7', 'FINDER-12-V1C6X2Z8L4K9J5H3',
]);

const dictionaryKeys = Object.keys(I18N.ko).sort().join('|');
for (const language of ['en', 'ja']) {
  if (Object.keys(I18N[language]).sort().join('|') !== dictionaryKeys) {
    throw new Error('언어별 문구 키 불일치: ' + language);
  }
}
if (FINDER_CELL_ORDER.length !== 19 || FACES.join(',') !== 'T,L,R') {
  throw new Error('파인더 형식 계약 불일치');
}

const basePreset = getPreset('slate');
const PALETTE = Object.freeze({
  background: basePreset.background, levels: basePreset.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
});
const CELL_PLACEHOLDER_PATTERN = FINDER_PATTERNS.find((pattern) => pattern.renderKind === 'cell-mask');
const CUBE_PATTERN = FINDER_PATTERNS.find((pattern) => pattern.renderKind === 'three-tone-cube');
if (!CELL_PLACEHOLDER_PATTERN || !CUBE_PATTERN) {
  throw new Error('셀 마스크와 3톤 큐브 시작점이 모두 필요하다');
}
const CELL_FACE_COUNT = FINDER_CELL_ORDER.length * FACES.length;
const CUBE_SCENE_SHAPE_COUNT = 10; // 슬롯 배경 3 + 큐브 면 3 + seam 3 + 중심점 1
const nextEditorExportFilename = createExportFilenameFactory();

function bullseyeCellMasks() {
  const radii = bandRadii(1);
  return FINDER_CELL_ORDER.map(function (cell) {
    let mask = 0;
    for (const face of FACES) {
      const point = faceCentroid(cell.q, cell.r, face, DEFAULT_LAYOUT);
      const distance = Math.hypot(point.x, point.y);
      const band = radii.findIndex(function (radius) { return distance <= radius + 1e-9; });
      if (band >= 0 && band % 2 === 1) mask |= FINDER_FACE_BITS[face];
    }
    return mask;
  });
}

const STARTERS = Object.freeze([
  Object.freeze({
    id: 'bullseye',
    pattern: Object.freeze({ renderKind: 'cell-mask', cellMasks: Object.freeze(bullseyeCellMasks()) }),
  }),
  ...FINDER_PATTERNS.map(function (pattern) {
    return Object.freeze({ id: pattern.id, pattern: cloneFinderEditorPattern(pattern) });
  }),
]);

const elements = {
  preview: document.getElementById('preview'),
  canvasStage: document.getElementById('canvasStage'),
  typeChip: document.getElementById('typeChip'),
  dataChip: document.getElementById('dataChip'),
  litCount: document.getElementById('litCount'), metricSuffix: document.getElementById('metricSuffix'),
  typeO: document.getElementById('typeO'), typeA: document.getElementById('typeA'),
  payload: document.getElementById('payload'), regenerate: document.getElementById('regenerate'),
  starter: document.getElementById('starter'),
  undo: document.getElementById('undo'), redo: document.getElementById('redo'),
  reset: document.getElementById('reset'), invert: document.getElementById('invert'),
  maskOutput: document.getElementById('maskOutput'), copyPattern: document.getElementById('copyPattern'),
  exportFull: document.getElementById('exportFull'), exportFinder: document.getElementById('exportFinder'),
  status: document.getElementById('status'),
};

const initialPattern = cloneFinderEditorPattern(STARTERS[0].pattern);
const state = {
  language: 'ko', type: 'O', dataIndex: 0,
  pattern: initialPattern, starterId: 'bullseye',
  history: [cloneFinderEditorPattern(initialPattern)], historyIndex: 0,
  encoded: null, scene: null, finderSceneShapes: [], finderShapes: [],
  selectedFace: 0, hoverFace: -1, drag: null,
  statusMessage: { key: 'ready', values: {} },
};

function t(key, values) {
  let output = I18N[state.language][key];
  if (output === undefined) throw new Error('번역 키 없음: ' + key);
  for (const [name, value] of Object.entries(values || {})) {
    output = output.split('{' + name + '}').join(String(value));
  }
  return output;
}
function patternName(id) {
  const translated = PATTERN_NAMES[id];
  if (translated) return translated[state.language];
  const pattern = FINDER_PATTERNS.find((candidate) => candidate.id === id);
  return pattern ? pattern.name : id;
}
function isCubePattern() { return state.pattern.renderKind === 'three-tone-cube'; }
function currentAriaKey() { return isCubePattern() ? 'canvasAriaCube' : 'canvasAriaCell'; }
function toneName(rank) { return t('tone' + rank); }
function announce(key, values, isError) {
  state.statusMessage = { key, values: values || {}, isError: Boolean(isError) };
  elements.status.textContent = t(key, values);
  elements.status.classList.toggle('error', Boolean(isError));
}
function rebuildStarterOptions() {
  const selected = state.starterId;
  elements.starter.replaceChildren();
  const custom = document.createElement('option');
  custom.value = 'custom'; custom.textContent = t('custom'); custom.disabled = true;
  elements.starter.append(custom);
  for (const starter of STARTERS) {
    const option = document.createElement('option');
    option.value = starter.id; option.textContent = patternName(starter.id);
    elements.starter.append(option);
  }
  elements.starter.value = selected;
}
function applyLanguage(language) {
  if (!I18N[language]) return;
  state.language = language;
  document.documentElement.lang = language;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === language));
  }
  rebuildStarterOptions();
  syncUi();
  elements.status.textContent = t(state.statusMessage.key, state.statusMessage.values);
}
function rgb(color) { return 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')'; }

function buildCurrentScene() {
  const payload = DATA_CASES[state.dataIndex];
  const encoded = state.type === 'O'
    ? encode(payload, { version: 2, eccLevel: 'M' })
    : encodeA(payload, { version: 1, eccLevel: 'M' });
  const cube = isCubePattern();
  const options = {
    palette: PALETTE,
    finderPatternId: cube ? CUBE_PATTERN.id : CELL_PLACEHOLDER_PATTERN.id,
  };
  if (state.type === 'A') options.margin = 20;
  const scene = buildScene(encoded, options);
  const finderShapeCount = cube ? CUBE_SCENE_SHAPE_COUNT : CELL_FACE_COUNT;
  const expectedShapes = encoded.cellDigits.size * FACES.length + finderShapeCount;
  if (scene.shapes.length !== expectedShapes) {
    throw new Error('파인더 도형 경계 불일치: ' + scene.shapes.length + ' !== ' + expectedShapes);
  }
  state.encoded = encoded;
  state.scene = scene;
  state.finderSceneShapes = scene.shapes.slice(scene.shapes.length - finderShapeCount);
  // 중앙 큐브의 편집 대상은 슬롯 배경/seam이 아닌 실제 T/L/R 세 면이다.
  state.finderShapes = cube ? state.finderSceneShapes.slice(3, 6) : state.finderSceneShapes;
  state.selectedFace = Math.max(0, Math.min(state.selectedFace, state.finderShapes.length - 1));
  syncFinderColors();
}
function syncFinderColors() {
  if (isCubePattern()) {
    for (let faceIndex = 0; faceIndex < FACES.length; faceIndex += 1) {
      const face = FACES[faceIndex];
      // 프리셋 레벨이 아니라 고정 파인더 색 — 편집기가 실제 렌더와 달라 보이면 안 된다.
      state.finderShapes[faceIndex].color = FINDER_CUBE_TONES[state.pattern.toneRanks[face]];
    }
    return;
  }
  for (let cellIndex = 0; cellIndex < FINDER_CELL_ORDER.length; cellIndex += 1) {
    for (let faceIndex = 0; faceIndex < FACES.length; faceIndex += 1) {
      const face = FACES[faceIndex];
      const shape = state.finderShapes[cellIndex * FACES.length + faceIndex];
      shape.color = state.pattern.cellMasks[cellIndex] & FINDER_FACE_BITS[face]
        ? PALETTE.bullseyeLight : PALETTE.bullseyeDark;
    }
  }
}
function drawShape(context, shape) {
  context.fillStyle = rgb(shape.color);
  context.beginPath();
  if (shape.kind === 'disc') context.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
  else {
    shape.points.forEach(function (point, index) {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
  }
  context.fill();
}
function strokeShape(context, shape, color, width) {
  context.strokeStyle = color; context.lineWidth = width; context.beginPath();
  shape.points.forEach(function (point, index) {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath(); context.stroke();
}
function canvasCssSize() {
  const stageWidth = Math.max(260, elements.canvasStage.clientWidth - 24);
  const maxHeight = Math.max(320, Math.min(720, window.innerHeight - 170));
  let width = stageWidth;
  let height = width * state.scene.height / state.scene.width;
  if (height > maxHeight) {
    height = maxHeight; width = height * state.scene.width / state.scene.height;
  }
  return { width, height };
}
function draw() {
  if (!state.scene) return;
  const size = canvasCssSize();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  elements.preview.style.width = Math.round(size.width) + 'px';
  elements.preview.style.height = Math.round(size.height) + 'px';
  elements.preview.width = Math.max(1, Math.round(size.width * dpr));
  elements.preview.height = Math.max(1, Math.round(size.height * dpr));
  const context = elements.preview.getContext('2d');
  const scale = size.width / state.scene.width;
  context.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  context.fillStyle = rgb(state.scene.background);
  context.fillRect(0, 0, state.scene.width, state.scene.height);
  for (const shape of state.scene.shapes) drawShape(context, shape);
  for (const shape of state.finderShapes) {
    strokeShape(context, shape, 'rgba(240,163,93,.24)', 0.7 / scale);
  }
  if (state.selectedFace >= 0) {
    strokeShape(context, state.finderShapes[state.selectedFace], 'rgba(255,220,175,.92)', 2 / scale);
  }
  if (state.hoverFace >= 0 && state.hoverFace !== state.selectedFace) {
    strokeShape(context, state.finderShapes[state.hoverFace], 'rgba(240,163,93,.9)', 1.5 / scale);
  }
}
function litFaceCount() {
  if (isCubePattern()) return FACES.length;
  return state.pattern.cellMasks.reduce(function (sum, mask) {
    return sum + Number(Boolean(mask & 1)) + Number(Boolean(mask & 2)) + Number(Boolean(mask & 4));
  }, 0);
}
function syncUi() {
  elements.typeO.setAttribute('aria-pressed', String(state.type === 'O'));
  elements.typeA.setAttribute('aria-pressed', String(state.type === 'A'));
  elements.typeChip.textContent = 'Type ' + state.type;
  elements.dataChip.textContent = 'Data ' + String(state.dataIndex + 1).padStart(2, '0');
  elements.payload.textContent = DATA_CASES[state.dataIndex];
  elements.litCount.textContent = String(litFaceCount());
  elements.metricSuffix.textContent = t(isCubePattern() ? 'cubeFaces' : 'litFaces');
  elements.maskOutput.textContent = serializeFinderEditorPattern(state.pattern);
  elements.undo.disabled = state.historyIndex === 0;
  elements.redo.disabled = state.historyIndex === state.history.length - 1;
  elements.starter.value = state.starterId;
  elements.preview.setAttribute('aria-label', t(currentAriaKey(), { type: state.type }));
}
function refreshScene() { buildCurrentScene(); syncUi(); draw(); }
function recordCurrent() {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(cloneFinderEditorPattern(state.pattern));
  state.historyIndex += 1;
}
function detectStarterId(pattern) {
  const match = STARTERS.find(function (starter) {
    return finderEditorPatternsEqual(pattern, starter.pattern);
  });
  return match ? match.id : 'custom';
}
function commitPattern(nextPattern, messageKey, values) {
  if (finderEditorPatternsEqual(state.pattern, nextPattern)) return;
  state.pattern = cloneFinderEditorPattern(nextPattern);
  recordCurrent();
  state.starterId = detectStarterId(state.pattern);
  state.hoverFace = -1;
  refreshScene();
  announce(messageKey, values || {});
}
function restoreHistory(index, messageKey) {
  if (index < 0 || index >= state.history.length || index === state.historyIndex) return;
  state.historyIndex = index;
  state.pattern = cloneFinderEditorPattern(state.history[index]);
  state.starterId = detectStarterId(state.pattern);
  state.hoverFace = -1;
  refreshScene();
  announce(messageKey);
}
function undo() { restoreHistory(state.historyIndex - 1, 'undoDone'); }
function redo() { restoreHistory(state.historyIndex + 1, 'redoDone'); }
function resetPattern() {
  if (isCubePattern()) {
    commitPattern(CUBE_PATTERN, 'resetCubeDone');
    return;
  }
  commitPattern({ renderKind: 'cell-mask', cellMasks: new Array(FINDER_CELL_ORDER.length).fill(0) }, 'resetDone');
}
function invertPattern() {
  if (isCubePattern()) {
    const toneRanks = {};
    for (const face of FACES) toneRanks[face] = 2 - state.pattern.toneRanks[face];
    commitPattern({ ...state.pattern, toneRanks }, 'invertCubeDone');
    return;
  }
  commitPattern({
    renderKind: 'cell-mask',
    cellMasks: state.pattern.cellMasks.map(function (mask) { return mask ^ 7; }),
  }, 'invertDone');
}
function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    if (currentPoint.y > y !== previousPoint.y > y
      && x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x) inside = !inside;
  }
  return inside;
}
function pointerScenePoint(event) {
  const rect = elements.preview.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * state.scene.width / rect.width,
    y: (event.clientY - rect.top) * state.scene.height / rect.height,
  };
}
function faceAtPointer(event) {
  const point = pointerScenePoint(event);
  for (let index = state.finderShapes.length - 1; index >= 0; index -= 1) {
    if (pointInPolygon(point.x, point.y, state.finderShapes[index].points)) return index;
  }
  return -1;
}
function faceDetails(faceIndex) {
  if (isCubePattern()) return { face: FACES[faceIndex], faceIndex };
  const cellIndex = Math.floor(faceIndex / FACES.length);
  const face = FACES[faceIndex % FACES.length];
  return { cellIndex, face, bit: FINDER_FACE_BITS[face], faceIndex };
}
function applyDragFace(faceIndex) {
  const details = faceDetails(faceIndex);
  const key = state.drag.mode === 'cell' ? String(details.cellIndex) : String(faceIndex);
  if (state.drag.visited.has(key)) return;
  state.drag.visited.add(key);

  if (isCubePattern()) {
    const before = state.pattern.toneRanks[details.face];
    state.pattern.toneRanks = cycleCubeToneRanks(state.pattern.toneRanks, details.face, state.drag.direction);
    const after = state.pattern.toneRanks[details.face];
    state.drag.lastChange = { face: details.face, before, after };
  } else {
    const previous = state.pattern.cellMasks[details.cellIndex];
    const next = state.drag.mode === 'cell' ? previous ^ 7 : previous ^ details.bit;
    if (next === previous) return;
    state.pattern.cellMasks[details.cellIndex] = next;
    state.drag.lastChange = {
      cell: details.cellIndex + 1, face: details.face,
      enabled: state.drag.mode === 'cell' ? next === 7 : Boolean(next & details.bit),
    };
  }
  state.drag.changed = true;
  state.starterId = 'custom';
  state.selectedFace = faceIndex;
  syncFinderColors(); syncUi(); draw();
}
function finishDrag() {
  if (!state.drag) return;
  const finished = state.drag;
  state.drag = null;
  if (!finished.changed) return;
  recordCurrent();
  state.starterId = detectStarterId(state.pattern);
  syncUi();
  if (isCubePattern()) {
    announce('toneChanged', {
      face: finished.lastChange.face,
      from: toneName(finished.lastChange.before),
      to: toneName(finished.lastChange.after),
    });
  } else if (finished.mode === 'cell') {
    announce(finished.lastChange.enabled ? 'cellOn' : 'cellOff', { cell: finished.lastChange.cell });
  } else {
    announce(finished.lastChange.enabled ? 'faceOn' : 'faceOff', {
      cell: finished.lastChange.cell, face: finished.lastChange.face,
    });
  }
}

elements.preview.addEventListener('contextmenu', function (event) {
  // 브라우저의 우클릭 메뉴는 이 캔버스에서만 막는다. 페이지의 이미지 저장 등은 보존한다.
  event.preventDefault();
});
elements.preview.addEventListener('pointerdown', function (event) {
  if (event.button !== 0 && event.button !== 2) return;
  const faceIndex = faceAtPointer(event);
  if (faceIndex < 0) return;
  event.preventDefault();
  elements.preview.focus({ preventScroll: true });
  elements.preview.setPointerCapture(event.pointerId);
  state.selectedFace = faceIndex;
  const mode = !isCubePattern() && event.shiftKey ? 'cell' : 'face';
  state.drag = {
    mode,
    direction: event.button === 2 ? -1 : 1,
    visited: new Set(), changed: false, lastChange: null,
  };
  state.pattern = cloneFinderEditorPattern(state.pattern);
  applyDragFace(faceIndex);
});
elements.preview.addEventListener('pointermove', function (event) {
  const faceIndex = faceAtPointer(event);
  if (state.drag) {
    if (faceIndex >= 0) applyDragFace(faceIndex);
    return;
  }
  if (faceIndex !== state.hoverFace) { state.hoverFace = faceIndex; draw(); }
});
elements.preview.addEventListener('pointerleave', function () {
  if (!state.drag && state.hoverFace !== -1) { state.hoverFace = -1; draw(); }
});
elements.preview.addEventListener('pointerup', finishDrag);
elements.preview.addEventListener('pointercancel', finishDrag);
elements.preview.addEventListener('lostpointercapture', finishDrag);

function applyKeyboardEdit(direction, wholeCell) {
  const faceIndex = state.selectedFace;
  const details = faceDetails(faceIndex);
  state.pattern = cloneFinderEditorPattern(state.pattern);
  if (isCubePattern()) {
    const before = state.pattern.toneRanks[details.face];
    state.pattern.toneRanks = cycleCubeToneRanks(state.pattern.toneRanks, details.face, direction);
    const after = state.pattern.toneRanks[details.face];
    recordCurrent(); state.starterId = detectStarterId(state.pattern);
    syncFinderColors(); syncUi(); draw();
    announce('toneChanged', { face: details.face, from: toneName(before), to: toneName(after) });
    return;
  }
  const previous = state.pattern.cellMasks[details.cellIndex];
  const next = wholeCell ? previous ^ 7 : previous ^ details.bit;
  state.pattern.cellMasks[details.cellIndex] = next;
  recordCurrent(); state.starterId = detectStarterId(state.pattern);
  syncFinderColors(); syncUi(); draw();
  if (wholeCell) announce(next === 7 ? 'cellOn' : 'cellOff', { cell: details.cellIndex + 1 });
  else announce(next & details.bit ? 'faceOn' : 'faceOff', {
    cell: details.cellIndex + 1, face: details.face,
  });
}

elements.preview.addEventListener('keydown', function (event) {
  const maxFace = state.finderShapes.length - 1;
  let next = state.selectedFace;
  if (event.key === 'ArrowRight') next = Math.min(maxFace, next + 1);
  else if (event.key === 'ArrowLeft') next = Math.max(0, next - 1);
  else if (event.key === 'ArrowDown') next = Math.min(maxFace, next + (isCubePattern() ? 1 : 3));
  else if (event.key === 'ArrowUp') next = Math.max(0, next - (isCubePattern() ? 1 : 3));
  else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    applyKeyboardEdit(event.shiftKey ? -1 : 1, !isCubePattern() && event.shiftKey);
    return;
  } else return;
  event.preventDefault(); state.selectedFace = next; draw();
});

for (const button of document.querySelectorAll('[data-lang]')) {
  button.addEventListener('click', function () { applyLanguage(button.dataset.lang); });
}
elements.typeO.addEventListener('click', function () {
  if (state.type !== 'O') { state.type = 'O'; refreshScene(); }
});
elements.typeA.addEventListener('click', function () {
  if (state.type !== 'A') { state.type = 'A'; refreshScene(); }
});
elements.regenerate.addEventListener('click', function () {
  state.dataIndex = (state.dataIndex + 1) % DATA_CASES.length;
  refreshScene();
  announce('dataChanged', { index: String(state.dataIndex + 1).padStart(2, '0') });
});
elements.starter.addEventListener('change', function () {
  const starter = STARTERS.find(function (item) { return item.id === elements.starter.value; });
  if (!starter) return;
  state.pattern = cloneFinderEditorPattern(starter.pattern);
  recordCurrent();
  state.starterId = starter.id;
  state.selectedFace = 0; state.hoverFace = -1;
  refreshScene();
  announce('loaded', { name: patternName(starter.id) });
});
elements.undo.addEventListener('click', undo);
elements.redo.addEventListener('click', redo);
elements.reset.addEventListener('click', resetPattern);
elements.invert.addEventListener('click', invertPattern);
document.addEventListener('keydown', function (event) {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 'z') {
    event.preventDefault(); if (event.shiftKey) redo(); else undo();
  } else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
});

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text); return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
  document.body.append(textarea); textarea.select();
  const copied = document.execCommand('copy'); textarea.remove();
  if (!copied) throw new Error('copy command rejected');
}
elements.copyPattern.addEventListener('click', async function () {
  try { await copyText(elements.maskOutput.textContent); announce('copied'); }
  catch (error) { announce('copyFailed', { message: error.message }, true); }
});

function shapeBounds(shape) {
  if (shape.kind === 'disc') {
    return {
      minX: shape.cx - shape.r, maxX: shape.cx + shape.r,
      minY: shape.cy - shape.r, maxY: shape.cy + shape.r,
    };
  }
  return shape.points.reduce(function (bounds, point) {
    return {
      minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y), maxY: Math.max(bounds.maxY, point.y),
    };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}
function finderOnlyScene() {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const shape of state.finderSceneShapes) {
    const bounds = shapeBounds(shape);
    minX = Math.min(minX, bounds.minX); minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX); maxY = Math.max(maxY, bounds.maxY);
  }
  const margin = 1.5;
  const shapes = state.finderSceneShapes.map(function (shape) {
    if (shape.kind === 'disc') {
      return {
        kind: 'disc', color: shape.color,
        cx: shape.cx - minX + margin, cy: shape.cy - minY + margin, r: shape.r,
      };
    }
    return {
      kind: 'polygon', color: shape.color,
      points: shape.points.map(function (point) {
        return { x: point.x - minX + margin, y: point.y - minY + margin };
      }),
    };
  });
  return {
    width: maxX - minX + margin * 2, height: maxY - minY + margin * 2,
    background: PALETTE.background, shapes,
  };
}
function saveBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link);
  link.click(); link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function setExportBusy(busy) {
  elements.exportFull.disabled = busy; elements.exportFinder.disabled = busy;
}
function editorFinderLabel(kind) {
  const base = state.starterId === 'custom' ? state.pattern.renderKind : state.starterId;
  return base + '-' + kind;
}
async function exportPng(kind) {
  setExportBusy(true); announce('exporting');
  await new Promise(function (resolve) { requestAnimationFrame(resolve); });
  try {
    const scene = kind === 'full' ? state.scene : finderOnlyScene();
    const targetWidth = kind === 'full' ? 1400 : 900;
    const bytes = rasterToPng(rasterize(scene, {
      pixelsPerUnit: targetWidth / scene.width, supersample: 2,
    }));
    saveBytes(bytes, nextEditorExportFilename({
      extension: 'png', type: state.type, version: 'V' + state.encoded.version,
      finder: editorFinderLabel(kind),
    }));
    announce(kind === 'full' ? 'fullSaved' : 'finderSaved');
  } catch (error) {
    announce('exportFailed', { message: error.message }, true);
  } finally { setExportBusy(false); }
}
elements.exportFull.addEventListener('click', function () { exportPng('full'); });
elements.exportFinder.addEventListener('click', function () { exportPng('finder'); });

let resizeFrame = 0;
const resizeObserver = new ResizeObserver(function () {
  cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(draw);
});
resizeObserver.observe(elements.canvasStage);
const browserLanguage = (navigator.language || '').toLowerCase();
const initialLanguage = browserLanguage.startsWith('ja')
  ? 'ja' : browserLanguage.startsWith('en') ? 'en' : 'ko';
applyLanguage(initialLanguage);
refreshScene();
announce('ready');
