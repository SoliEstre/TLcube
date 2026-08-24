/**
 * cell-editor-app.js — TLcube 셀 & 파인더 편집기 프론트엔드 컨트롤러
 *
 * 다중 타입(Y/O/A/K/V), 인터랙티브 드래그 채색, 페인트통 플러드 필,
 * Undo/Redo(Ctrl+Z/Ctrl+Shift+Z), JSON 양방향 임포트/익스포트, PNG/SVG 내보내기 지원.
 */

import {
  CORNER_UNIT_OFFSETS,
  FACES,
  facePolygon,
} from './hexgrid.js';
import {
  YFACES,
  moduleQuad as moduleQuadY,
} from './ygrid.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  FINDER_CUBE_TONES,
  getPreset,
} from './luminance.js';
import {
  FINDER_PATTERNS,
} from './finder-patterns.js';
import {
  HYBRID_INNER_CUBE_BANDS,
  bandRadii,
  hybridCubeRadius,
} from './bullseye.js';
import {
  DEFAULT_FINDER_STARTER,
  DEFAULT_TONE,
  TYPE_HEX_SIZES,
  TYPE_Y_SIZES,
  applyBrush,
  applyBucket,
  applyEraser,
  applyFinderStarter,
  applyMaskToggle,
  armEditStroke,
  commitCellEdit,
  coordKey,
  endEditStroke,
  createUniversalEditorState,
  cycleCellTone,
  enumerateCells,
  finderOverlayKind,
  getCellTone,
  invertAllTones,
  isCenterCell,
  listFinderStarters,
  looksLikeCellEditorJson,
  normalizeFinderName,
  parseUniversalEditor,
  pushUndoSnapshot,
  redo,
  resetAllTones,
  previewAutoplaceY,
  roleOfCoord,
  rotate120,
  serializeCellEditorFinderPattern,
  serializeUniversalEditor,
  setCellToneDirect,
  undo,
} from './cell-editor-core.js';
import {
  HISTORY_SHORTCUT_REDO,
  HISTORY_SHORTCUT_UNDO,
  classifyHistoryShortcut,
  isTextEntryTarget,
} from './cell-editor-history.js';
import { createExportFilenameFactory } from './export-filename.js';

const I18N = Object.freeze({
  ko: Object.freeze({
    title: 'TLcube 셀 & 파인더 편집기',
    devBadge: '엔드포인트 전용',
    subtitle: 'Type Y/O/A/K 셀 표면 검출기 및 중앙 파인더를 자유롭게 설계하고 검증해요.',
    modeTone: '🎨 톤 채색 모드',
    modeMask: '🔲 데이터 마스크 모드',
    fullSurface: '전체 셀 표면',
    centralFinder: '중앙 파인더 (19셀)',
    dataCells: '데이터 셀',
    undo: '되돌리기',
    redo: '다시하기',
    refRole: '레퍼런스',
    fmtRole: '포맷',
    ancRole: '앵커',
    detRole: '검출기 (비데이터)',
    dataRole: '데이터',
    dragHint: '드래그: 연속 채색 · Shift+드래그: 셀 3면 전체 · 우클릭: 톤 역순환',
    typeSection: '1. 코드 타입 & 해상도',
    sizeLabel: '격자 크기',
    finderModeLabel: '파인더 영역',
    optCentralFinder: '중앙 파인더 (19셀)',
    optFullSurface: '전체 셀 표면 (커스텀)',
    starterLabel: '중앙 파인더 프리셋',
    finderNameLabel: '파인더 이름',
    finderNamePlaceholder: '이 파인더 패턴의 이름',
    toolsSection: '2. 도구 & 톤 팔레트',
    toolBrush: '붓 (드래그)',
    toolBucket: '페인트통',
    toolEraser: '지우개',
    toolDropper: '스포이드',
    toneLabel: '선택 톤 (Active Tone)',
    rotate120: '🔄 120° 회전',
    invert: '🌓 톤 반전',
    reset: '🗑️ 초기화',
    cntDataLbl: '데이터 셀',
    cntDetLbl: '검출기 셀',
    cntFixLbl: '고정 역할',
    simSection: '3. 실제 인코딩 문맥 시뮬레이터',
    simRefresh: '새 무늬',
    exportSection: '4. JSON & 이미지 내보내기',
    copyJson: '📋 JSON 복사',
    downloadJson: '💾 JSON 저장',
    copyFinderPattern: '📐 파인더 패턴 복사',
    importJson: '📥 JSON 파일',
    pasteJsonLabel: 'JSON 붙여넣기',
    pasteJsonPlaceholder: '여기에 셀·파인더 편집기 JSON을 붙여넣으세요',
    applyPasteJson: '붙여넣은 JSON 적용',
    clipboardJson: '클립보드에서 읽기',
    pasteEmpty: '붙여넣을 JSON이 비어 있어요.',
    pasteFailed: '클립보드를 읽지 못했어요: {message}',
    exportPng: '🖼️ PNG 내보내기',
    exportSvg: '📐 SVG 내보내기',
    ready: '도구를 선택하고 격자 셀을 클릭하거나 드래그해 편집하세요.',
    copied: 'JSON 스키마를 클립보드에 복사했어요.',
    copiedFinder: '파인더 패턴 코드를 클립보드에 복사했어요.',
    copyFailed: '클립보드 복사에 실패했어요: {message}',
    savedJson: 'JSON 파일을 다운로드했어요.',
    imported: 'JSON 설정을 불러왔어요.',
    importFailed: 'JSON 불러오기 실패: {message}',
    undoDone: '이전 편집 상태로 되돌렸어요.',
    redoDone: '다음 편집 상태를 다시 적용했어요.',
    resetDone: '모든 셀을 기본 상태로 초기화했어요.',
    invertDone: '모든 톤을 반전했어요.',
    rotatedDone: '120° 회전했어요.',
    pngSaved: 'PNG 이미지를 내보냈어요.',
    svgSaved: 'SVG 이미지를 내보냈어요.',
    dropperPicked: '{face}면 톤 {tone}을(를) 추출했어요.',
    autoplaceOk: 'ref/format 자동 배치 · 점유 {occupied} · D_ref {dRef} · S_fmt {sFmt}',
    autoplaceFail: 'ref/format 자동 배치 불가: {message}',
  }),
  en: Object.freeze({
    title: 'TLcube Cell & Finder Editor',
    devBadge: 'Dedicated Endpoint',
    subtitle: 'Design and verify Type Y/O/A/K cell surface detectors and central finders freely.',
    modeTone: '🎨 Tone Edit Mode',
    modeMask: '🔲 Data Mask Mode',
    fullSurface: 'Full Cell Surface',
    centralFinder: 'Central Finder (19 cells)',
    dataCells: 'Data Cells',
    undo: 'Undo',
    redo: 'Redo',
    refRole: 'Reference',
    fmtRole: 'Format',
    ancRole: 'Anchor',
    detRole: 'Detector (Non-data)',
    dataRole: 'Data',
    dragHint: 'Drag: continuous paint · Shift+drag: all 3 faces · Right click: cycle reverse',
    typeSection: '1. Code Type & Size',
    sizeLabel: 'Grid Size',
    finderModeLabel: 'Finder Region',
    optCentralFinder: 'Central Finder (19 cells)',
    optFullSurface: 'Full Cell Surface (Custom)',
    starterLabel: 'Finder Preset',
    finderNameLabel: 'Finder name',
    finderNamePlaceholder: 'Name of this finder pattern',
    toolsSection: '2. Tools & Tone Palette',
    toolBrush: 'Brush (Drag)',
    toolBucket: 'Paint Bucket',
    toolEraser: 'Eraser',
    toolDropper: 'Eyedropper',
    toneLabel: 'Active Tone',
    rotate120: '🔄 Rotate 120°',
    invert: '🌓 Invert Tones',
    reset: '🗑️ Reset',
    cntDataLbl: 'Data Cells',
    cntDetLbl: 'Detector Cells',
    cntFixLbl: 'Fixed Roles',
    simSection: '3. Real Data Context Simulator',
    simRefresh: 'New Seed',
    exportSection: '4. JSON & Image Export',
    copyJson: '📋 Copy JSON',
    downloadJson: '💾 Save JSON',
    copyFinderPattern: '📐 Copy Finder Code',
    importJson: '📥 JSON file',
    pasteJsonLabel: 'Paste JSON',
    pasteJsonPlaceholder: 'Paste cell/finder editor JSON here',
    applyPasteJson: 'Apply pasted JSON',
    clipboardJson: 'Read from clipboard',
    pasteEmpty: 'There is no JSON to paste.',
    pasteFailed: 'Could not read the clipboard: {message}',
    exportPng: '🖼️ Export PNG',
    exportSvg: '📐 Export SVG',
    ready: 'Select a tool and click or drag across grid cells to edit.',
    copied: 'Copied JSON schema to clipboard.',
    copiedFinder: 'Copied finder pattern snippet to clipboard.',
    copyFailed: 'Failed to copy to clipboard: {message}',
    savedJson: 'Downloaded JSON file.',
    imported: 'Loaded JSON configuration.',
    importFailed: 'Failed to load JSON: {message}',
    undoDone: 'Reverted to previous edit.',
    redoDone: 'Reapplied next edit.',
    resetDone: 'Reset all cells to default state.',
    invertDone: 'Inverted all tones.',
    rotatedDone: 'Rotated 120°.',
    pngSaved: 'Exported PNG image.',
    svgSaved: 'Exported SVG image.',
    dropperPicked: 'Picked tone {tone} from {face} face.',
    autoplaceOk: 'Auto-placed ref/format · occupied {occupied} · D_ref {dRef} · S_fmt {sFmt}',
    autoplaceFail: 'Cannot auto-place ref/format: {message}',
  }),
  ja: Object.freeze({
    title: 'TLcube セル＆ファインダーエディター',
    devBadge: '専用エンドポイント',
    subtitle: 'Type Y/O/A/K セル表面検出器および中央ファインダーを自由に設計・検証します。',
    modeTone: '🎨 トーン編集モード',
    modeMask: '🔲 データマスクモード',
    fullSurface: '全面セル表面',
    centralFinder: '中央ファインダー (19セル)',
    dataCells: 'データセル',
    undo: '元に戻す',
    redo: 'やり直す',
    refRole: '参照',
    fmtRole: 'フォーマット',
    ancRole: 'アンカー',
    detRole: '検出器 (非データ)',
    dataRole: 'データ',
    dragHint: 'ドラッグ：連続描画 · Shift+ドラッグ：3面全体 · 右クリック：逆順トーン',
    typeSection: '1. コードタイプ＆サイズ',
    sizeLabel: 'グリッドサイズ',
    finderModeLabel: 'ファインダー領域',
    optCentralFinder: '中央ファインダー (19セル)',
    optFullSurface: '全面セル表面 (カスタム)',
    starterLabel: 'ファインダープリセット',
    finderNameLabel: 'ファインダー名',
    finderNamePlaceholder: 'このファインダーパターンの名前',
    toolsSection: '2. ツール＆トーンパレット',
    toolBrush: 'ブラシ (ドラッグ)',
    toolBucket: '塗りつぶし',
    toolEraser: '消しゴム',
    toolDropper: 'スポイト',
    toneLabel: '選択トーン (Active Tone)',
    rotate120: '🔄 120°回転',
    invert: '🌓 トーン反転',
    reset: '🗑️ リセット',
    cntDataLbl: 'データセル',
    cntDetLbl: '検出器セル',
    cntFixLbl: '固定役割',
    simSection: '3. 実データ文脈シミュレーター',
    simRefresh: '新規パターン',
    exportSection: '4. JSON＆画像エクスポート',
    copyJson: '📋 JSONコピー',
    downloadJson: '💾 JSON保存',
    copyFinderPattern: '📐 ファインダーコードコピー',
    importJson: '📥 JSONファイル',
    pasteJsonLabel: 'JSON貼り付け',
    pasteJsonPlaceholder: 'セル／ファインダー編集JSONをここに貼り付けてください',
    applyPasteJson: '貼り付けたJSONを適用',
    clipboardJson: 'クリップボードから読む',
    pasteEmpty: '貼り付けるJSONが空です。',
    pasteFailed: 'クリップボードを読めませんでした：{message}',
    exportPng: '🖼️ PNG出力',
    exportSvg: '📐 SVG出力',
    ready: 'ツールを選択し、セルをクリックまたはドラッグして編集してください。',
    copied: 'JSONスキーマをクリップボードにコピーしました。',
    copiedFinder: 'ファインダーパターンコードをコピーしました。',
    copyFailed: 'クリップボードへのコピーに失敗しました：{message}',
    savedJson: 'JSONファイルを保存しました。',
    imported: 'JSON設定を読み込みました。',
    importFailed: 'JSON読み込みに失敗しました：{message}',
    undoDone: '前の編集に戻りました。',
    redoDone: '次の編集を再適用しました。',
    resetDone: 'すべてのセルを初期状態に戻しました。',
    invertDone: 'すべてのトーンを反転しました。',
    rotatedDone: '120°回転しました。',
    pngSaved: 'PNG画像を出力しました。',
    svgSaved: 'SVG画像を出力しました。',
    dropperPicked: '{face}面からトーン{tone}を取得しました。',
    autoplaceOk: 'ref/format 自動配置 · 占有 {occupied} · D_ref {dRef} · S_fmt {sFmt}',
    autoplaceFail: 'ref/format を自動配置できません: {message}',
  }),
});

const PATTERN_NAMES = Object.freeze({
  bullseye: Object.freeze({ ko: '불스아이', en: 'Bullseye', ja: 'ブルズアイ' }),
  'central-cube-3tone': Object.freeze({ ko: '최대 3톤 큐브', en: 'Maximum 3-Tone Cube', ja: '最大3トーンキューブ' }),
  'cube-bullseye': Object.freeze({ ko: '하이브리드 (불스아이 속 큐브)', en: 'Cube in bullseye', ja: 'ブルズアイ内キューブ' }),
  'pinwheel-3-0101-cw-missing-solid': Object.freeze({ ko: '3날 바람개비', en: '3-Blade Pinwheel', ja: '3枚羽根の風車' }),
  'gap-ring-01-2-1-solid': Object.freeze({ ko: '솔리드 틈 링', en: 'Solid Gap Ring', ja: 'ソリッド・ギャップリング' }),
  'flower-7-0020-coprime-offset': Object.freeze({ ko: '7잎 꽃 (컴팩트)', en: '7-Petal Flower', ja: '7枚花' }),
  'swirl-2-200': Object.freeze({ ko: '면 나선 (Swirl)', en: 'Face Swirl', ja: '面スワール' }),
  'pinwheel-c2-2-1100-cw': Object.freeze({ ko: '이중 바람개비', en: 'Compound pinwheel', ja: '複合風車' }),
  'gap-ring-01-2-1-open': Object.freeze({ ko: '열린 틈 링', en: 'Open gap ring', ja: 'オープン・ギャップリング' }),
  'flower-7-1020-coprime-offset': Object.freeze({ ko: '7잎 꽃 (오프셋)', en: '7-Petal flower (offset)', ja: '7枚花（オフセット）' }),
  'swirl-c2-5-5-11-both': Object.freeze({ ko: '이중 나선', en: 'Compound swirl', ja: '複合スワール' }),
  'tristar-refined-h3': Object.freeze({ ko: '개선 삼지성', en: 'Refined tristar', ja: '改良トライスター' }),
  'cats-refined-h3': Object.freeze({ ko: '개선 고양이 (Cats)', en: 'Refined Cats', ja: '改良キャッツ' }),
  'tree-refined-h3': Object.freeze({ ko: '개선 나무 (Tree)', en: 'Refined Tree', ja: '改良ツリー' }),
});

const nextExportFilename = createExportFilenameFactory();
const basePreset = getPreset('slate');
const PALETTE = Object.freeze({
  background: '#0e111a',
  levels: basePreset.levels, // [dark, mid, bright]
  refColor: '#4fa3e3',
  fmtColor: '#f2c037',
  ancColor: '#5cdb95',
  detOutline: '#ff6b6b',
  gridLine: 'rgba(255,255,255,0.08)',
  gridLineAccent: 'rgba(255,255,255,0.22)',
  hoverLine: '#f0a35d',
});

// UI 상태
let currentLang = 'ko';
let editorState = createUniversalEditorState({ type: 'Y' });
let isPointerDown = false;
let pointerStrokeChanged = false;
let hoveredElement = null; // { face, coord }
let simSeed = 42;

/**
 * 진행 중인 붓질을 끝낸다. 버튼을 뗐을 때뿐 아니라 **되돌리기/다시하기 직전**에도
 * 부른다 — 스트로크를 연 채로 스냅샷만 팝하면 남은 드래그가 코얼레싱돼 통째로 기록에서
 * 사라진다 (히스토리 모듈도 undo/redo 에서 같은 규칙으로 스트로크를 닫는다).
 */
function stopPointerStroke() {
  isPointerDown = false;
  pointerStrokeChanged = false;
  endEditStroke(editorState);
}

const elements = {
  canvas: document.getElementById('cellCanvas'),
  canvasStage: document.getElementById('canvasStage'),
  tooltip: document.getElementById('cellTooltip'),
  typeChip: document.getElementById('typeChip'),
  modeChip: document.getElementById('modeChip'),
  finderModeChip: document.getElementById('finderModeChip'),
  dataCountChip: document.getElementById('dataCountChip'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  typeButtons: document.querySelectorAll('#typeButtons button'),
  sizeSelect: document.getElementById('sizeSelect'),
  finderModeContainer: document.getElementById('finderModeContainer'),
  finderModeSelect: document.getElementById('finderModeSelect'),
  finderStarterContainer: document.getElementById('finderStarterContainer'),
  starterSelect: document.getElementById('starterSelect'),
  finderNameContainer: document.getElementById('finderNameContainer'),
  finderNameInput: document.getElementById('finderNameInput'),
  toolButtons: document.querySelectorAll('.tool-btn'),
  toneButtons: document.querySelectorAll('.tone-btn'),
  modeToneBtn: document.getElementById('modeToneBtn'),
  modeMaskBtn: document.getElementById('modeMaskBtn'),
  rotateBtn: document.getElementById('rotateBtn'),
  invertBtn: document.getElementById('invertBtn'),
  resetBtn: document.getElementById('resetBtn'),
  cntData: document.getElementById('cntData'),
  cntDetector: document.getElementById('cntDetector'),
  cntFixed: document.getElementById('cntFixed'),
  simPayload: document.getElementById('simPayload'),
  simRefreshBtn: document.getElementById('simRefreshBtn'),
  jsonOutput: document.getElementById('jsonOutput'),
  copyJsonBtn: document.getElementById('copyJsonBtn'),
  downloadJsonBtn: document.getElementById('downloadJsonBtn'),
  copyFinderPatternBtn: document.getElementById('copyFinderPatternBtn'),
  importJsonBtn: document.getElementById('importJsonBtn'),
  jsonPaste: document.getElementById('jsonPaste'),
  applyPasteJsonBtn: document.getElementById('applyPasteJsonBtn'),
  clipboardJsonBtn: document.getElementById('clipboardJsonBtn'),
  exportPngBtn: document.getElementById('exportPngBtn'),
  exportSvgBtn: document.getElementById('exportSvgBtn'),
  jsonFileInput: document.getElementById('jsonFileInput'),
  statusBar: document.getElementById('statusBar'),
  autoplaceHint: document.getElementById('autoplaceHint'),
  finderCopyContainer: document.getElementById('finderCopyContainer'),
};

let yPlacementPreview = null;

function t(key, values = {}) {
  let text = I18N[currentLang][key] || I18N.ko[key] || key;
  for (const [k, v] of Object.entries(values)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return text;
}

function notify(key, values = {}, isError = false) {
  elements.statusBar.textContent = t(key, values);
  elements.statusBar.classList.toggle('error', isError);
}

function updateI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 캔버스 기하 렌더링 & 히트 테스트
// ─────────────────────────────────────────────────────────────────────────────

let faceHitPolygons = []; // [{ face, coord, poly: [{x,y}, ...] }]

function cssRgb(color) {
  return `rgb(${color.r},${color.g},${color.b})`;
}

function toneFill(tone) {
  const color = PALETTE.levels[tone];
  if (color && typeof color === 'object' && Number.isFinite(color.r)) {
    return cssRgb(color);
  }
  const gray = Math.round(Number(color) * 255);
  return `rgb(${gray},${gray},${gray})`;
}

function finderMaskFill(tone) {
  return cssRgb(tone === 2 ? BULLSEYE_LIGHT : BULLSEYE_DARK);
}

function fillPolygon(ctx, poly, fill, stroke, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
}

function appendFinderOverlay(ctx, cellRadius, centerX, centerY) {
  const pattern = editorState.finderPattern;
  const overlay = finderOverlayKind(pattern);
  if (!overlay || editorState.type === 'Y' || editorState.finderMode !== 'central-finder') {
    return;
  }

  if (overlay === 'cube-bullseye') {
    const radii = bandRadii(cellRadius);
    for (let i = radii.length - 1; i >= HYBRID_INNER_CUBE_BANDS; i -= 1) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radii[i], 0, Math.PI * 2);
      ctx.fillStyle = cssRgb(i % 2 === 0 ? BULLSEYE_DARK : BULLSEYE_LIGHT);
      ctx.fill();
    }
    const cubeLayout = {
      size: hybridCubeRadius(cellRadius),
      originX: centerX,
      originY: centerY,
    };
    for (const face of FACES) {
      const poly = facePolygon(0, 0, face, cubeLayout);
      fillPolygon(ctx, poly, cssRgb(FINDER_CUBE_TONES[pattern.toneRanks[face]]));
      faceHitPolygons.push({ face, coord: { q: 0, r: 0 }, poly });
    }
    return;
  }

  const radius = (pattern.radiusCells || 3.5) * cellRadius;
  const cubeLayout = { size: radius, originX: centerX, originY: centerY };
  for (const face of FACES) {
    const poly = facePolygon(0, 0, face, cubeLayout);
    fillPolygon(ctx, poly, cssRgb(FINDER_CUBE_TONES[pattern.toneRanks[face]]), 'rgba(255,255,255,0.16)', 1);
    faceHitPolygons.push({ face, coord: { q: 0, r: 0 }, poly });
  }
  const seamHalfWidth = 0.075 * cellRadius;
  for (const cornerIndex of [1, 3, 5]) {
    const unit = CORNER_UNIT_OFFSETS[cornerIndex];
    const perpendicular = { x: -unit.y, y: unit.x };
    const far = { x: centerX + unit.x * radius, y: centerY + unit.y * radius };
    fillPolygon(ctx, [
      { x: centerX + perpendicular.x * seamHalfWidth, y: centerY + perpendicular.y * seamHalfWidth },
      { x: far.x + perpendicular.x * seamHalfWidth, y: far.y + perpendicular.y * seamHalfWidth },
      { x: far.x - perpendicular.x * seamHalfWidth, y: far.y - perpendicular.y * seamHalfWidth },
      { x: centerX - perpendicular.x * seamHalfWidth, y: centerY - perpendicular.y * seamHalfWidth },
    ], cssRgb(BULLSEYE_DARK));
  }
  ctx.fillStyle = cssRgb(BULLSEYE_DARK);
  ctx.beginPath();
  ctx.arc(centerX, centerY, 0.18 * cellRadius, 0, Math.PI * 2);
  ctx.fill();
}

function getSimulatedContextTone(face, coord) {
  // 결정적 pseudo-random 해시로 주변 데이터 톤 모사
  const k = editorState.type === 'Y'
    ? (coord.i * 37 + coord.j * 17 + simSeed + (face === 'T' ? 1 : face === 'L' ? 3 : 5))
    : (coord.q * 37 + coord.r * 19 + simSeed + (face === 'T' ? 1 : face === 'L' ? 3 : 5));
  return Math.abs(k) % 3;
}

function renderCanvas() {
  const canvas = elements.canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const stageRect = elements.canvasStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const displaySize = Math.max(340, Math.min(stageRect.width - 32, stageRect.height - 32, 900));

  canvas.width = displaySize * dpr;
  canvas.height = displaySize * dpr;
  canvas.style.width = `${displaySize}px`;
  canvas.style.height = `${displaySize}px`;

  ctx.resetTransform();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, displaySize, displaySize);

  const centerX = displaySize / 2;
  const centerY = displaySize / 2;

  // 배경 렌더링
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, displaySize, displaySize);

  faceHitPolygons = [];
  const cells = enumerateCells(editorState.type, editorState.size);

  if (editorState.type === 'Y') {
    // Type Y Isometric Grid Rendering
    const n = editorState.size;
    const margin = 24;
    const radius = (displaySize - margin * 2) / (Math.sqrt(3) * n * 1.05);
    yPlacementPreview = previewAutoplaceY(editorState);
    const yRoles = yPlacementPreview && yPlacementPreview.ok
      ? yPlacementPreview.roles
      : new Map();

    for (const c of cells) {
      const isDet = editorState.userNonData.has(coordKey('Y', c));
      const role = roleOfCoord('Y', n, c, { roles: yRoles });

      for (const face of YFACES) {
        const quad = moduleQuadY(face, c.i, c.j, { size: radius, originX: centerX, originY: centerY });
        const poly = quad.map((pt) => ({ x: pt.x, y: pt.y }));
        faceHitPolygons.push({ face, coord: c, poly });

        // 톤 색상 결정
        let tone = getCellTone(editorState, face, c);
        if (tone === DEFAULT_TONE && !isDet && role === 'data') {
          // 데이터 셀 배경 시뮬레이션
          tone = getSimulatedContextTone(face, c);
        }

        ctx.fillStyle = toneFill(tone);
        ctx.strokeStyle = isDet ? PALETTE.detOutline : PALETTE.gridLine;
        ctx.lineWidth = isDet ? 1.5 : 0.6;

        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i += 1) {
          ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 역할 표시 마커
        if (face === 'T') {
          if (role === 'reference') {
            drawMarker(ctx, poly, PALETTE.refColor, 'R');
          } else if (role === 'format') {
            drawMarker(ctx, poly, PALETTE.fmtColor, 'F');
          }
        }
      }
    }
  } else {
    // Type O / A / K Axial Grid Rendering
    const k = editorState.size;
    // V(턴A)는 A 의 180° 상이라 범위가 같다 — 같은 분기를 쓴다.
    const maxExtent = editorState.type === 'K' || editorState.type === 'A' || editorState.type === 'V'
      ? 2 * k + 1 : k + 1;
    const margin = 24;
    const cellRadius = (displaySize - margin * 2) / (Math.sqrt(3) * maxExtent * 2);

    const overlayKind = finderOverlayKind(editorState.finderPattern);
    const usesFinderOverlay = editorState.finderMode === 'central-finder' && Boolean(overlayKind);

    for (const c of cells) {
      const isDet = editorState.userNonData.has(coordKey(editorState.type, c));
      const role = roleOfCoord(editorState.type, k, c, { finderMode: editorState.finderMode });
      const isOverlaySlot = usesFinderOverlay && isCenterCell(editorState.type, c);

      for (const face of FACES) {
        const poly = facePolygon(c.q, c.r, face, { size: cellRadius, originX: centerX, originY: centerY });
        faceHitPolygons.push({ face, coord: c, poly });

        let fillStyle = null;
        if (isOverlaySlot) {
          fillStyle = '#12151f';
        } else if (editorState.finderMode === 'central-finder'
          && editorState.finderPattern
          && editorState.finderPattern.renderKind === 'cell-mask'
          && isCenterCell(editorState.type, c)) {
          fillStyle = finderMaskFill(getCellTone(editorState, face, c));
        } else {
          let tone = getCellTone(editorState, face, c);
          if (tone === DEFAULT_TONE && !isDet && role === 'data') {
            tone = getSimulatedContextTone(face, c);
          }
          fillStyle = toneFill(tone);
        }
        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = isDet ? PALETTE.detOutline : PALETTE.gridLine;
        ctx.lineWidth = isDet ? 1.5 : 0.6;

        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i += 1) {
          ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 역할 마커
        if (face === 'T') {
          if (role === 'reference') drawMarker(ctx, poly, PALETTE.refColor, 'R');
          else if (role === 'format') drawMarker(ctx, poly, PALETTE.fmtColor, 'F');
          else if (role === 'anchor') drawMarker(ctx, poly, PALETTE.ancColor, 'A');
        }
      }
    }
    appendFinderOverlay(ctx, cellRadius, centerX, centerY);
  }

  // 호버 하이라이트
  if (hoveredElement) {
    const hit = faceHitPolygons.find((h) => (
      h.face === hoveredElement.face
      && ((editorState.type === 'Y'
        && h.coord.i === hoveredElement.coord.i && h.coord.j === hoveredElement.coord.j)
        || (editorState.type !== 'Y'
        && h.coord.q === hoveredElement.coord.q && h.coord.r === hoveredElement.coord.r))
    ));
    if (hit) {
      ctx.strokeStyle = PALETTE.hoverLine;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(hit.poly[0].x, hit.poly[0].y);
      for (let i = 1; i < hit.poly.length; i += 1) {
        ctx.lineTo(hit.poly[i].x, hit.poly[i].y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawMarker(ctx, poly, color, label) {
  const cx = poly.reduce((acc, p) => acc + p.x, 0) / poly.length;
  const cy = poly.reduce((acc, p) => acc + p.y, 0) / poly.length;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = ((yi > py) !== (yj > py))
      && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function hitTest(canvasX, canvasY) {
  for (let i = faceHitPolygons.length - 1; i >= 0; i -= 1) {
    const item = faceHitPolygons[i];
    if (pointInPolygon(canvasX, canvasY, item.poly)) {
      return item;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 도구 실행 및 상태 갱신
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 도구 한 번. 스텝은 `commitCellEdit` 가 **실제로 바뀐 뒤에만** 만든다 —
 * 잠긴 셀 마스크 토글·스포이드·이미 같은 톤인 셀 클릭이 빈 되돌리기 스텝을 남기면
 * 상한 50 스택이 밀려 진짜 편집을 잃는다 (생성기 섹션 편집기와 같은 규칙).
 */
function applyToolAt(face, coord, isShift, isRightClick = false) {
  if (editorState.mode === 'mask') {
    const { changed } = commitCellEdit(editorState, () => applyMaskToggle(editorState, coord));
    if (changed) updateUI();
    return changed;
  }

  if (isRightClick) {
    commitCellEdit(editorState, () => {
      const curTone = getCellTone(editorState, face, coord);
      setCellToneDirect(editorState, face, coord, cycleCellTone(curTone, -1));
      return true; // 톤 순환은 언제나 바뀐다
    });
    updateUI();
    return true;
  }

  if (editorState.activeTool === 'dropper') {
    const pickedTone = getCellTone(editorState, face, coord);
    editorState.activeTone = pickedTone;
    elements.toneButtons.forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.tone === String(pickedTone) ? 'true' : 'false');
    });
    notify('dropperPicked', { face, tone: pickedTone });
    return false;
  }

  if (editorState.activeTool === 'bucket') {
    const { changed } = commitCellEdit(
      editorState,
      () => applyBucket(editorState, face, coord, editorState.activeTone),
    );
    if (changed) updateUI();
    return changed;
  }

  if (editorState.activeTool === 'eraser') {
    const { changed } = commitCellEdit(
      editorState,
      () => applyEraser(editorState, face, coord, { allFaces: isShift }),
    );
    if (changed) updateUI();
    return changed;
  }

  // Brush
  const { changed } = commitCellEdit(editorState, () => applyBrush(editorState, face, coord, {
    allFaces: isShift,
    tone: editorState.activeTone,
  }));
  if (changed) updateUI();
  return changed;
}

function importEditorJson(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) {
    notify('pasteEmpty', {}, true);
    return false;
  }
  try {
    const next = parseUniversalEditor(raw);
    pushUndoSnapshot(editorState);
    next.undoStack = editorState.undoStack;
    next.redoStack = editorState.redoStack;
    next.strokeOpen = editorState.strokeOpen === true;
    next.activeTool = editorState.activeTool;
    next.activeTone = editorState.activeTone;
    next.mode = editorState.mode;
    editorState = next;
    if (elements.jsonPaste) elements.jsonPaste.value = raw;
    rebuildSizeOptions();
    rebuildStarterOptions();
    updateUI();
    notify('imported');
    return true;
  } catch (err) {
    notify('importFailed', { message: err.message }, true);
    return false;
  }
}

function updateUI() {
  const serialized = serializeUniversalEditor(editorState);
  elements.jsonOutput.textContent = JSON.stringify(serialized, null, 2);

  elements.typeChip.textContent = `Type ${editorState.type} (${editorState.type === 'Y' ? `n=${editorState.size}` : `k=${editorState.size}`})`;
  elements.modeChip.textContent = editorState.mode === 'tone' ? t('modeTone') : t('modeMask');
  elements.finderModeChip.textContent = editorState.type === 'Y'
    ? t('fullSurface')
    : (editorState.finderMode === 'central-finder' ? t('centralFinder') : t('fullSurface'));

  elements.dataCountChip.textContent = String(serialized.counts.data);
  elements.cntData.textContent = String(serialized.counts.data);
  elements.cntDetector.textContent = String(serialized.counts.detector);
  elements.cntFixed.textContent = String(serialized.counts.fixed);

  if (elements.autoplaceHint) {
    if (editorState.type === 'Y') {
      yPlacementPreview = previewAutoplaceY(editorState);
      if (yPlacementPreview.ok) {
        const metrics = yPlacementPreview.placement.metrics;
        elements.autoplaceHint.textContent = t('autoplaceOk', {
          occupied: metrics.occupied,
          dRef: metrics.dRef,
          sFmt: metrics.sFmtMax,
        });
        elements.autoplaceHint.classList.remove('error');
      } else {
        elements.autoplaceHint.textContent = t('autoplaceFail', {
          message: yPlacementPreview.message,
        });
        elements.autoplaceHint.classList.add('error');
      }
    } else {
      yPlacementPreview = null;
      elements.autoplaceHint.textContent = '';
      elements.autoplaceHint.classList.remove('error');
    }
  }

  elements.undoBtn.disabled = editorState.undoStack.length === 0;
  elements.redoBtn.disabled = editorState.redoStack.length === 0;

  // Type buttons active state
  elements.typeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === editorState.type);
    btn.setAttribute('aria-pressed', btn.dataset.type === editorState.type ? 'true' : 'false');
  });

  // Mode buttons — 다른 카드 묶음과 같은 접근성 표기를 쓴다.
  for (const [btn, mode] of [[elements.modeToneBtn, 'tone'], [elements.modeMaskBtn, 'mask']]) {
    const on = editorState.mode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  // 크기 드롭다운도 상태를 따라간다 — 되돌리기가 크기를 바꿔 놓으면 표시가 어긋난다.
  // (select 안에서 Ctrl+Z 가 죽어 있던 동안에는 이 어긋남이 보이지 않았다.)
  const sizeValue = String(editorState.size);
  if (elements.sizeSelect.value !== sizeValue
    && [...elements.sizeSelect.options].some((opt) => opt.value === sizeValue)) {
    elements.sizeSelect.value = sizeValue;
  }

  // Tool buttons
  elements.toolButtons.forEach((btn) => {
    const isActive = btn.dataset.tool === editorState.activeTool;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  // Tone buttons
  elements.toneButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.tone === String(editorState.activeTone) ? 'true' : 'false');
  });

  // Finder controls visibility
  const showFinderControls = editorState.type !== 'Y';
  elements.finderModeContainer.style.display = showFinderControls ? 'block' : 'none';
  elements.finderStarterContainer.style.display = (showFinderControls && editorState.finderMode === 'central-finder') ? 'block' : 'none';
  elements.finderNameContainer.style.display = 'block';
  elements.finderCopyContainer.style.display = (showFinderControls && editorState.finderMode === 'central-finder') ? 'grid' : 'none';
  if (showFinderControls) {
    elements.finderModeSelect.value = editorState.finderMode;
    if (editorState.finderStarter) {
      elements.starterSelect.value = editorState.finderStarter;
    }
  }
  if (document.activeElement !== elements.finderNameInput) {
    elements.finderNameInput.value = editorState.finderName || '';
  }

  renderCanvas();
}

function rebuildSizeOptions() {
  elements.sizeSelect.innerHTML = '';
  const sizes = editorState.type === 'Y' ? TYPE_Y_SIZES : TYPE_HEX_SIZES;
  sizes.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = String(s);
    opt.textContent = editorState.type === 'Y' ? `n = ${s}` : `k = ${s}`;
    if (s === editorState.size) opt.selected = true;
    elements.sizeSelect.appendChild(opt);
  });
}

function starterLabel(id) {
  if (PATTERN_NAMES[id] && PATTERN_NAMES[id][currentLang]) return PATTERN_NAMES[id][currentLang];
  const pattern = FINDER_PATTERNS.find((item) => item.id === id);
  return pattern ? pattern.name : id;
}

function rebuildStarterOptions() {
  const selected = editorState.finderStarter || DEFAULT_FINDER_STARTER;
  elements.starterSelect.innerHTML = '';
  for (const item of listFinderStarters()) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = starterLabel(item.id);
    elements.starterSelect.appendChild(opt);
  }
  if ([...elements.starterSelect.options].some((opt) => opt.value === selected)) {
    elements.starterSelect.value = selected;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 이벤트 리스너 등록
// ─────────────────────────────────────────────────────────────────────────────

function bindEvents() {
  const canvas = elements.canvas;

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    canvas.focus();
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const hit = hitTest(x, y);

    if (hit) {
      isPointerDown = true;
      // 스트로크 **예약**. 이 안의 편집은 코얼레싱되므로 드래그 도색 한 번이 되돌리기
      // 한 스텝이다 (예전엔 pointerdown + applyToolAt 이 두 번 쌓아서 클릭 한 번에
      // Ctrl+Z 를 두 번 눌러야 했다). 예약이라 **아무것도 안 바뀌면 스텝도 없다** —
      // 잠긴 셀 클릭·스포이드가 빈 스텝을 남기지 않는다.
      armEditStroke(editorState);
      const isRight = ev.button === 2;
      applyToolAt(hit.face, hit.coord, ev.shiftKey, isRight);
      pointerStrokeChanged = true;
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    // 창 밖에서 버튼을 뗐으면 pointerup 이 안 온다 — 스트로크가 열린 채로 남으면
    // 그 뒤의 편집이 전부 코얼레싱돼 기록에서 사라진다. 버튼 상태로 자가 치유한다
    // (생성기 섹션 편집기에 있던 장치를 여기에도 붙인다).
    if (isPointerDown && ev.buttons === 0) stopPointerStroke();
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const hit = hitTest(x, y);

    hoveredElement = hit;
    if (hit) {
      const role = roleOfCoord(editorState.type, editorState.size, hit.coord, {
        finderMode: editorState.finderMode,
        roles: yPlacementPreview && yPlacementPreview.ok ? yPlacementPreview.roles : null,
      });
      const coordStr = editorState.type === 'Y' ? `(${hit.coord.i}, ${hit.coord.j})` : `(${hit.coord.q}, ${hit.coord.r})`;
      const tone = getCellTone(editorState, hit.face, hit.coord);
      elements.tooltip.style.display = 'block';
      elements.tooltip.style.left = `${ev.clientX - rect.left + 14}px`;
      elements.tooltip.style.top = `${ev.clientY - rect.top + 14}px`;
      elements.tooltip.textContent = `${hit.face} ${coordStr} · [${role}] · Tone ${tone}`;
    } else {
      elements.tooltip.style.display = 'none';
    }

    if (isPointerDown && hit && editorState.activeTool === 'brush') {
      // 드래그 도색도 commit 을 지난다 — pointerdown 이 아무것도 안 바꿔 예약만 남은
      // 경우(같은 톤 셀에서 시작) 여기서 스트로크가 확정돼야 드래그를 되돌릴 수 있다.
      commitCellEdit(editorState, () => applyBrush(editorState, hit.face, hit.coord, {
        allFaces: ev.shiftKey,
        tone: editorState.activeTone,
      }));
      updateUI();
    } else {
      renderCanvas();
    }
  });

  window.addEventListener('pointerup', stopPointerStroke);
  window.addEventListener('pointercancel', stopPointerStroke);

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
  });

  // Undo / Redo 버튼 — 진행 중인 붓질을 먼저 끝낸다 (stopPointerStroke 주석 참조).
  elements.undoBtn.addEventListener('click', () => {
    stopPointerStroke();
    if (undo(editorState)) {
      notify('undoDone');
      updateUI();
    }
  });
  elements.redoBtn.addEventListener('click', () => {
    stopPointerStroke();
    if (redo(editorState)) {
      notify('redoDone');
      updateUI();
    }
  });

  // Type 버튼들
  elements.typeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const newType = btn.dataset.type;
      if (newType === editorState.type) return;
      pushUndoSnapshot(editorState);
      const next = createUniversalEditorState({
        type: newType,
        finderStarter: editorState.finderStarter || elements.starterSelect.value || DEFAULT_FINDER_STARTER,
        finderName: editorState.finderName,
        mode: editorState.mode,
        activeTool: editorState.activeTool,
        activeTone: editorState.activeTone,
      });
      next.undoStack = editorState.undoStack;
      next.redoStack = editorState.redoStack;
      editorState = next;
      rebuildSizeOptions();
      rebuildStarterOptions();
      updateUI();
    });
  });

  // Size 변경
  elements.sizeSelect.addEventListener('change', () => {
    pushUndoSnapshot(editorState);
    editorState.size = Number(elements.sizeSelect.value);
    updateUI();
  });

  // Finder mode 변경
  elements.finderModeSelect.addEventListener('change', () => {
    pushUndoSnapshot(editorState);
    editorState.finderMode = elements.finderModeSelect.value;
    if (editorState.finderMode === 'central-finder') {
      applyFinderStarter(editorState, editorState.finderStarter || elements.starterSelect.value || DEFAULT_FINDER_STARTER);
    }
    updateUI();
  });

  // Starter select
  elements.starterSelect.addEventListener('change', () => {
    pushUndoSnapshot(editorState);
    const previousLabel = starterLabel(editorState.finderStarter);
    applyFinderStarter(editorState, elements.starterSelect.value);
    if (!editorState.finderName || editorState.finderName === previousLabel) {
      editorState.finderName = starterLabel(elements.starterSelect.value);
    }
    updateUI();
  });

  elements.finderNameInput.addEventListener('focus', () => {
    pushUndoSnapshot(editorState);
  });
  elements.finderNameInput.addEventListener('input', () => {
    editorState.finderName = normalizeFinderName(elements.finderNameInput.value);
    elements.jsonOutput.textContent = JSON.stringify(serializeUniversalEditor(editorState), null, 2);
  });
  elements.finderNameInput.addEventListener('change', () => {
    editorState.finderName = normalizeFinderName(elements.finderNameInput.value);
    elements.finderNameInput.value = editorState.finderName;
    updateUI();
  });

  // Tool buttons
  elements.toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      editorState.activeTool = btn.dataset.tool;
      updateUI();
    });
  });

  // Tone buttons
  elements.toneButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      editorState.activeTone = Number(btn.dataset.tone);
      updateUI();
    });
  });

  // Mode buttons
  elements.modeToneBtn.addEventListener('click', () => {
    editorState.mode = 'tone';
    updateUI();
  });
  elements.modeMaskBtn.addEventListener('click', () => {
    editorState.mode = 'mask';
    updateUI();
  });

  // 일괄 조작
  elements.rotateBtn.addEventListener('click', () => {
    if (rotate120(editorState)) {
      notify('rotatedDone');
      updateUI();
    }
  });
  elements.invertBtn.addEventListener('click', () => {
    invertAllTones(editorState);
    notify('invertDone');
    updateUI();
  });
  elements.resetBtn.addEventListener('click', () => {
    resetAllTones(editorState);
    notify('resetDone');
    updateUI();
  });

  // 시뮬레이터 Refresh
  elements.simRefreshBtn.addEventListener('click', () => {
    simSeed = Math.floor(Math.random() * 100000);
    elements.simPayload.textContent = `TL-SIM-CONTEXT-${simSeed}`;
    renderCanvas();
  });

  // JSON 복사 & 다운로드 & 임포트
  elements.copyJsonBtn.addEventListener('click', async () => {
    const jsonStr = elements.jsonOutput.textContent;
    try {
      await navigator.clipboard.writeText(jsonStr);
      notify('copied');
    } catch (err) {
      notify('copyFailed', { message: err.message }, true);
    }
  });

  elements.downloadJsonBtn.addEventListener('click', () => {
    const jsonStr = elements.jsonOutput.textContent;
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tlcube-cell-${editorState.type}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('savedJson');
  });

  elements.copyFinderPatternBtn.addEventListener('click', async () => {
    if (editorState.finderPattern) {
      const snippet = serializeCellEditorFinderPattern(editorState.finderPattern);
      try {
        await navigator.clipboard.writeText(snippet);
        notify('copiedFinder');
      } catch (err) {
        notify('copyFailed', { message: err.message }, true);
      }
    }
  });

  elements.importJsonBtn.addEventListener('click', () => {
    elements.jsonFileInput.click();
  });

  elements.jsonFileInput.addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      importEditorJson(String(e.target.result || ''));
    };
    reader.readAsText(file);
    ev.target.value = '';
  });

  elements.applyPasteJsonBtn.addEventListener('click', () => {
    importEditorJson(elements.jsonPaste.value);
  });

  elements.clipboardJsonBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      elements.jsonPaste.value = text;
      importEditorJson(text);
    } catch (err) {
      notify('pasteFailed', { message: err.message }, true);
      elements.jsonPaste.focus();
    }
  });

  elements.jsonPaste.addEventListener('paste', (ev) => {
    const text = ev.clipboardData && ev.clipboardData.getData('text');
    if (!looksLikeCellEditorJson(text)) return;
    ev.preventDefault();
    importEditorJson(text);
  });

  window.addEventListener('paste', (ev) => {
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const text = ev.clipboardData && ev.clipboardData.getData('text');
    if (!looksLikeCellEditorJson(text)) return;
    ev.preventDefault();
    importEditorJson(text);
  });

  // PNG & SVG Export
  elements.exportPngBtn.addEventListener('click', () => {
    const canvas = elements.canvas;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `tlcube-${editorState.type}-cell-surface-${Date.now()}.png`;
    a.click();
    notify('pngSaved');
  });

  elements.exportSvgBtn.addEventListener('click', () => {
    const serialized = serializeUniversalEditor(editorState);
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
      <rect width="800" height="800" fill="#0b0d13"/>
      <!-- TLcube Cell Editor Export: ${editorState.type} -->
    </svg>`;
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tlcube-${editorState.type}-cell-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    notify('svgSaved');
  });

  // 언어 스위처
  document.querySelectorAll('.lang-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentLang = btn.dataset.lang;
      document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateI18n();
      rebuildStarterOptions();
      updateUI();
    });
  });

  // 단축키 (Keyboard Shortcuts)
  window.addEventListener('keydown', (ev) => {
    // 글상자(이름·붙여넣기) 안에서는 브라우저 기본 동작을 그대로 둔다 — 판정은
    // cell-editor-history.js 한 곳이 소유한다 (생성기 섹션 편집기와 같은 규칙).
    if (isTextEntryTarget(ev.target)) return;
    const shortcut = classifyHistoryShortcut(ev);

    if (shortcut === HISTORY_SHORTCUT_UNDO) {
      ev.preventDefault();
      stopPointerStroke();
      if (undo(editorState)) {
        notify('undoDone');
        updateUI();
      }
      return;
    }
    if (shortcut === HISTORY_SHORTCUT_REDO) {
      ev.preventDefault();
      stopPointerStroke();
      if (redo(editorState)) {
        notify('redoDone');
        updateUI();
      }
      return;
    }
    // 도구·톤 단축키는 **수식키 없는 맨 키** 일 때만. 안 그러면 Ctrl+B(북마크) ·
    // Ctrl+E · Cmd+I 같은 브라우저 단축키가 도구를 바꿔 버린다.
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === '0' || ev.key === '1' || ev.key === '2') {
      editorState.activeTone = Number(ev.key);
      updateUI();
    } else if (ev.key.toLowerCase() === 'b') {
      editorState.activeTool = 'brush';
      updateUI();
    } else if (ev.key.toLowerCase() === 'g') {
      editorState.activeTool = 'bucket';
      updateUI();
    } else if (ev.key.toLowerCase() === 'e') {
      editorState.activeTool = 'eraser';
      updateUI();
    } else if (ev.key.toLowerCase() === 'i') {
      editorState.activeTool = 'dropper';
      updateUI();
    }
  });

  window.addEventListener('resize', () => {
    renderCanvas();
  });
}

export function initCellEditorApp() {
  rebuildSizeOptions();
  rebuildStarterOptions();
  updateI18n();
  bindEvents();
  updateUI();
  notify('ready');
}

if (typeof document !== 'undefined') {
  initCellEditorApp();
}
