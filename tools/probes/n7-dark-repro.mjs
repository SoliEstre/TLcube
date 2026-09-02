#!/usr/bin/env node
/**
 * central-n7 어두운 지면 회귀의 최소 재현기.
 *
 * 전체 격자:
 *   preset  slate/ember/mono
 *   ppu     10/12/16/24
 *   mode    baseline/emphasis
 *   bg      preset/white/black
 *
 * 한 칸:
 *   node tools/probes/n7-dark-repro.mjs --only=ember,16,baseline,preset
 */
import { encode } from '../../src/encode.js';
import { buildScene } from '../../src/scene.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  getPreset,
} from '../../src/luminance.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../../src/centralN7Schema.js';

const PAYLOAD = 'TEMPH';
const PPUS = Object.freeze([10, 12, 16, 24]);
const PRESET_NAMES = Object.freeze(['slate', 'ember', 'mono']);
const MODES = Object.freeze(['baseline', 'emphasis']);
const BACKGROUNDS = Object.freeze(['preset', 'white', 'black']);
const MARGIN = 20;
const SUPERSAMPLE = 1;
const WHITE = Object.freeze({ r: 255, g: 255, b: 255 });
const BLACK = Object.freeze({ r: 0, g: 0, b: 0 });

function usage(message) {
  if (message) process.stderr.write(`오류: ${message}\n`);
  process.stderr.write(
    '사용: node tools/probes/n7-dark-repro.mjs '
      + '[--only=<slate|ember|mono>,<10|12|16|24>,<baseline|emphasis>,'
      + '<preset|white|black>]\n',
  );
  process.exitCode = 2;
}

function parseOnly(argv) {
  const unknown = argv.filter((arg) => !arg.startsWith('--only='));
  if (unknown.length > 0) {
    usage(`모르는 인자 ${unknown.join(', ')}`);
    return null;
  }
  const args = argv.filter((arg) => arg.startsWith('--only='));
  if (args.length === 0) return {};
  if (args.length !== 1) {
    usage('--only 는 한 번만 지정한다');
    return null;
  }
  const fields = args[0].slice('--only='.length).split(',');
  if (fields.length !== 4) {
    usage('--only 는 프리셋,ppu,모드,배경 네 필드여야 한다');
    return null;
  }
  const [preset, rawPpu, mode, background] = fields;
  const ppu = Number(rawPpu);
  if (!PRESET_NAMES.includes(preset)) {
    usage(`프리셋은 ${PRESET_NAMES.join('/')} 중 하나여야 한다`);
    return null;
  }
  if (!PPUS.includes(ppu)) {
    usage(`ppu 는 ${PPUS.join('/')} 중 하나여야 한다`);
    return null;
  }
  if (!MODES.includes(mode)) {
    usage(`모드는 ${MODES.join('/')} 중 하나여야 한다`);
    return null;
  }
  if (!BACKGROUNDS.includes(background)) {
    usage(`배경은 ${BACKGROUNDS.join('/')} 중 하나여야 한다`);
    return null;
  }
  return { preset, ppu, mode, background };
}

function backgroundColor(preset, background) {
  if (background === 'white') return WHITE;
  if (background === 'black') return BLACK;
  return preset.background;
}

// temph-probe.mjs 의 paletteOf와 같은 필드·값이다.
function paletteOf(preset, background) {
  return {
    background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function judge(result) {
  if (!result || typeof result !== 'object') {
    return { pass: false, reason: 'no-result', deathStage: 'frontend' };
  }
  if (result.ok === true) {
    if (result.text === PAYLOAD) {
      return { pass: true, reason: 'ok', deathStage: '—' };
    }
    return {
      pass: false,
      reason: `payload-mismatch:${JSON.stringify(result.text)}`,
      deathStage: 'selection',
    };
  }
  const detail = result.detail && typeof result.detail === 'object' ? result.detail : {};
  return {
    pass: false,
    reason: result.reason || 'fail',
    deathStage: detail.pipelineStage || detail.stage || 'frontend',
  };
}

function runTrial(encoded, presetName, ppu, mode, backgroundName, traceStages) {
  const preset = getPreset(presetName);
  const background = backgroundColor(preset, backgroundName);
  const sceneOptions = {
    palette: paletteOf(preset, background),
    margin: MARGIN,
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    centralN7Family: 'hex',
  };
  if (mode === 'emphasis') sceneOptions.centralN7Emphasis = 'all';

  const started = performance.now();
  const stageCounts = new Map();
  try {
    const scene = buildScene(encoded, sceneOptions);
    const raster = rasterize(scene, {
      pixelsPerUnit: ppu,
      supersample: SUPERSAMPLE,
    });
    const result = decodeFrontend(raster, traceStages ? {
      onStage(stage, phase) {
        if (phase !== 'enter') return;
        stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
      },
    } : {});
    return {
      preset: presetName,
      ppu,
      mode,
      background: backgroundName,
      ...judge(result),
      stageTrace: traceStages
        ? [...stageCounts].map(([stage, count]) => `${stage}:${count}`).join(',') || '—'
        : '—',
      raster: `${raster.width}x${raster.height}`,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      preset: presetName,
      ppu,
      mode,
      background: backgroundName,
      pass: false,
      reason: `throw:${error instanceof Error ? error.message : String(error)}`,
      deathStage: [...stageCounts.keys()].at(-1) || 'render',
      stageTrace: traceStages
        ? [...stageCounts].map(([stage, count]) => `${stage}:${count}`).join(',') || '—'
        : '—',
      raster: '—',
      ms: Math.round(performance.now() - started),
    };
  }
}

function printTable(rows, elapsedMs) {
  console.log('| preset | ppu | mode | background | pass | reason | hypothesis death | stage trace (--only) | raster | ms |');
  console.log('|---|---:|---|---|---|---|---|---|---|---:|');
  for (const row of rows) {
    console.log(
      `| ${row.preset} | ${row.ppu} | ${row.mode} | ${row.background} `
        + `| ${row.pass ? 'Y' : 'N'} | ${row.reason} | ${row.deathStage} `
        + `| ${row.stageTrace} | ${row.raster} | ${row.ms} |`,
    );
  }
  const failed = rows.filter((row) => !row.pass).length;
  console.log(`trials=${rows.length} pass=${rows.length - failed} fail=${failed} elapsedMs=${elapsedMs}`);
}

function main() {
  const only = parseOnly(process.argv.slice(2));
  if (only === null) return;
  const presetNames = only.preset ? [only.preset] : PRESET_NAMES;
  const ppus = only.ppu ? [only.ppu] : PPUS;
  const modes = only.mode ? [only.mode] : MODES;
  const backgrounds = only.background ? [only.background] : BACKGROUNDS;
  const traceStages = Boolean(only.preset);
  const encoded = encode(PAYLOAD, { version: 1, eccLevel: 'M', centralN7: true });
  const started = performance.now();
  const rows = [];
  for (const presetName of presetNames) {
    for (const ppu of ppus) {
      for (const mode of modes) {
        for (const background of backgrounds) {
          rows.push(runTrial(encoded, presetName, ppu, mode, background, traceStages));
        }
      }
    }
  }
  printTable(rows, Math.round(performance.now() - started));
}

main();
