/**
 * claude-daehan-to-v2.mjs — daehan 정본(cells 형식)을 **셀 편집기가 실제로 읽는**
 * v2 형식(userNonData + toneOverrides)으로 변환한다.
 *
 * 왜 필요했나 (운영자 보고 2026-08-18): 편집기가 'tlcube-cell-editor/v2-compact' 를
 * 거부하고, 스키마 문자열만 v2 로 고치면 «처리는 되는데 로드가 안 된» 다.
 * 원인 — parseUniversalEditor 는 **`cells` 를 아예 안 읽는다**. userNonData 와
 * toneOverrides 만 본다 (src/cell-editor-core.js:1142\~1160).
 *
 * 변환 규약:
 *   · userNonData ← cells 의 [q,r] 전부 (편집기에서 «비데이터» 로 잡히는 셀)
 *   · toneOverrides ← 면별 [q,r,tone]. **DEFAULT_TONE(1) 은 넣지 않는다** —
 *     임포터가 `if (c.tone !== DEFAULT_TONE)` 로 거르므로 넣어도 버려지고,
 *     넣으면 «지정했는데 반영 안 됨» 으로 오해를 부른다.
 * 검증: 변환 결과를 parseUniversalEditor 에 실제로 태워 셀·톤 수를 대조한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  parseUniversalEditor, CELL_EDITOR_SCHEMA_V2, DEFAULT_TONE,
} from '../../../src/cell-editor-core.js';

const SRC = '../.agent/decoder/data/finder-daehan-editor.json';
const d = JSON.parse(readFileSync(SRC, 'utf8'));
const FACES = ['T', 'L', 'R'];

const userNonData = d.cells.map((c) => [c[0], c[1]]);
const toneOverrides = { T: [], L: [], R: [] };
for (const c of d.cells) {
  for (let f = 0; f < 3; f += 1) {
    const tone = c[2 + f];
    if (tone === DEFAULT_TONE) continue;      // 임포터가 거르는 값은 애초에 안 싣는다
    toneOverrides[FACES[f]].push([c[0], c[1], tone]);
  }
}

const out = {
  schema: CELL_EDITOR_SCHEMA_V2,
  type: d.type,
  size: d.size,
  k: d.k,
  name: d.name,
  finderMode: d.finderMode,
  finderStarter: d.finderStarter,
  source: d.source,
  toneLevels: d.toneLevels,
  counts: d.counts,
  _note: 'cells 형식(v2-compact)에서 편집기 v2(userNonData + toneOverrides)로 변환. '
    + '정본은 finder-daehan-editor.json 이고 이 파일은 편집기 입력용이다.',
  _transcriptionCheck: d._transcriptionCheck,
  userNonData,
  toneOverrides,
};
// finderPattern.cellMasks 는 cells 에서 유도되지 않음이 실측으로 확인됐다(0/19~3/19).
// 정본 행세를 하지 않도록 **싣지 않는다** — 편집기가 그걸 파인더로 덮어쓰면
// 화면과 데이터가 갈린다.

const path = 'test/output/lanes/daehan-editor-v2.json';
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');

// ── 실제 임포터로 검증 ────────────────────────────────────────────────────
const state = parseUniversalEditor(out);
const toneCount = state.tones.size;
const expectTones = d.cells.reduce((n, c) =>
  n + [2, 3, 4].filter((i) => c[i] !== DEFAULT_TONE).length, 0);
console.log('변환 결과 → ' + path);
console.log('  type=' + state.type + ' size=' + state.size
  + ' finderMode=' + state.finderMode + ' finderName=' + (state.finderName || '(없음)'));
console.log('  userNonData ' + state.userNonData.size + ' / 기대 ' + d.cells.length
  + (state.userNonData.size === d.cells.length ? '  ok' : '  ★'));
console.log('  톤 지정 면 ' + toneCount + ' / 기대 ' + expectTones
  + (toneCount === expectTones ? '  ok' : '  ★'));
const bright = { T: 0, L: 0, R: 0 };
for (const [key, tone] of state.tones) if (tone === 2) bright[key[0]] += 1;
console.log('  bright/면 ' + JSON.stringify(bright)
  + ' / 전사검증 ' + JSON.stringify(d._transcriptionCheck.brightPerFace)
  + (JSON.stringify(bright) === JSON.stringify(d._transcriptionCheck.brightPerFace) ? '  ok' : '  ★'));
