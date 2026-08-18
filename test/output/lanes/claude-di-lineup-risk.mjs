/**
 * claude-di-lineup-risk.mjs — 「daehan 을 기본 라인업에 얹으면 레거시가 다치는가」.
 *
 * 앞선 nesting 프로브 §③ 이 «tristar 프레임이 라인업 17 에서 oak-daehan-k6 으로
 * 뽑힌다» 를 보였는데, 그건 **씨앗 정책 하나**(중심만 주고 척도는 안 줌)에서 잰 값이다.
 * 라인업 편성을 그 한 값으로 정하면 안 된다 — 씨앗 축을 갈라 전수로 다시 잰다.
 *
 * 기존 14후보 × 씨앗 정책 3 × 라인업 2 = 84 검출. 게이트는 한 값도 안 건드린다.
 * CWD = TLcube 저장소 루트.
 */
import { writeFileSync } from 'node:fs';
import { encode } from '../../../src/encode.js';
import { buildScene } from '../../../src/scene.js';
import { rasterize } from '../../../src/raster.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import {
  detectCellFinders, UNVERIFIED_CELL_FINDER_CALIBRATION,
} from '../../../src/decoder/cell-finder-detect.js';
import { FINDER_CELL_MASK_PATTERNS } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { DAEHAN_FINDER_PATTERNS, isDaehanFinderPatternId } from '../../../src/finder-daehan.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../../../src/luminance.js';

for (const [k, v] of Object.entries({
  minCorrelation: 0.56, minContrastRatio: 0.24, minOrientationMargin: 0.035,
})) {
  if (UNVERIFIED_CELL_FINDER_CALIBRATION[k] !== v) throw new Error('게이트가 바뀌었다: ' + k);
}

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = { background: PRESET.background, levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };
const say = (s) => process.stdout.write(s + '\n');
const L14 = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS];
const L17 = [...L14, ...DAEHAN_FINDER_PATTERNS];
const CELL_PX = 24;

const SEEDS = [
  ['S-a 중심+척도', (luma) => ({
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }], cellSizeSeeds: [CELL_PX] })],
  ['S-b 중심만', (luma) => ({ centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }] })],
  ['S-c 자율(씨앗 없음)', () => ({})],
];

const rows = [];
say('| 후보 | 씨앗 | 라인업 14 | 라인업 17 | 판정 |');
say('|---|---|---|---|---|');
const tally = { same: 0, stolenByDaehan: 0, failToDaehan: 0, other: 0 };
for (const pattern of L14) {
  const enc = encode('lineup risk', { version: 2, eccLevel: 'M' });
  const scene = buildScene(enc, { palette: PALETTE, finderPatternId: pattern.id });
  const luma = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: CELL_PX, supersample: 2 }), {});
  for (const [seedName, seedFn] of SEEDS) {
    const opts = seedFn(luma);
    const a = detectCellFinders(luma, L14, opts);
    const b = detectCellFinders(luma, L17, opts);
    const an = a.ok ? a.candidates[0].patternId : '검출실패';
    const bn = b.ok ? b.candidates[0].patternId : '검출실패';
    let verdict = '';
    if (an === bn) { verdict = '같음'; tally.same += 1; } else if (isDaehanFinderPatternId(bn)) {
      if (an === '검출실패') { verdict = '★ 실패 → daehan 오수용'; tally.failToDaehan += 1; } else { verdict = '★ 자기이름 → daehan 오수용'; tally.stolenByDaehan += 1; }
    } else { verdict = '★ 기타 변화'; tally.other += 1; }
    rows.push({ id: pattern.id, seed: seedName, l14: an, l17: bn, verdict,
      gates17: b.ok ? b.candidates[0].hardChecks.all : null,
      corr17: b.ok ? b.candidates[0].correlation : null });
    if (an !== bn) {
      say('| ' + [pattern.id, seedName, an, bn + (b.ok && b.candidates[0].hardChecks.all ? ' (게이트 통과)' : ''),
        verdict].join(' | ') + ' |');
    }
  }
}
say('\n요약 (14후보 × 씨앗 3 = 42칸)');
say('  결과 동일 ' + tally.same
  + ' · 자기이름 → daehan 오수용 ' + tally.stolenByDaehan
  + ' · 검출실패 → daehan 오수용 ' + tally.failToDaehan
  + ' · 기타 ' + tally.other);
say('\n씨앗 정책별');
for (const [seedName] of SEEDS) {
  const sub = rows.filter((r) => r.seed === seedName);
  const bad = sub.filter((r) => r.l14 !== r.l17 && isDaehanFinderPatternId(r.l17));
  const self14 = sub.filter((r) => r.l14 === r.id).length;
  const self17 = sub.filter((r) => r.l17 === r.id).length;
  say('  ' + seedName.padEnd(18) + ' 자기이름 14후보: 라인업14 ' + self14 + '/14 · 라인업17 '
    + self17 + '/14 · daehan 이 가로챈 칸 ' + bad.length);
}
writeFileSync('test/output/lanes/claude-di-lineup-risk.json', JSON.stringify(rows, null, 1));
