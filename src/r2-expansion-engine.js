/** 시험판에서만 C와 세 면 기하 Y를 기존 R2에 더하는 제품 조립점이에요. */
import { createR2ScanRuntime, R2_CAPABILITIES } from './r2-scan-runtime.js';
import { createR2TypeExpansionRuntime } from './r2/type-expansion-runtime.js';
import { createCubeYCandidateRuntime } from './r2/cube-y-runtime.js';
import { R2_CANDIDATE_SLOTS } from './r2-candidate-hud-model.js';

export const R2_EXPANSION_SETTINGS = Object.freeze({
  maxCandidates: 8, maxTrustedFrames: 12, maxStalledFrames: 12,
  // 원자 관측은 이 시간을 넘을 수 있어요. 초과량은 expansionStats로 드러내요.
  maxAdditionalMs: 32, maxIdleFrames: 60, minTrackedNcc: 0.96,
});

export const R2_EXPANSION_CAPABILITIES = Object.freeze({
  ...R2_CAPABILITIES,
  accumulatesFamilies: Object.freeze(['Y', 'C']),
  geometryModes: Object.freeze(['y-grid', 'c-hex', 'y-faces']),
  trialOnly: true,
});

/** 시험판 진단은 추가 CPU를 숨기지 않아요. 기존 Y의 단계 합과 중복 합산하지 않아요. */
export function r2ExpansionDebugLine(stats) {
  if (!stats) return '';
  const short = (value) => !Number.isFinite(value) ? '—'
    : Math.abs(value) >= 10000 ? value.toExponential(1) : value.toFixed(1);
  return `ext K${stats.totalCandidateCount} C${stats.cCandidateCount} Y3D${stats.cubeYCandidateCount}`
    + ` | Y/C/3D ${short(stats.lastYMs)}/${short(stats.lastCMs)}/${short(stats.lastCubeYMs)}ms`
    + ` | soft+${short(Math.max(0, stats.lastAdditionalMs - R2_EXPANSION_SETTINGS.maxAdditionalMs))}ms`;
}

export function createScannerR2Runtime({ enabled = false, trial = false } = {}) {
  const yRuntime = createR2ScanRuntime({ enabled });
  if (trial !== true) return yRuntime;
  const settings = R2_EXPANSION_SETTINGS;
  return createR2TypeExpansionRuntime({ yRuntime,
    cubeYRuntime: createCubeYCandidateRuntime({ maxIdleFrames: settings.maxIdleFrames }),
    maxCandidates: settings.maxCandidates, maxHudCandidates: R2_CANDIDATE_SLOTS.length,
    maxTrustedFrames: settings.maxTrustedFrames, maxStalledFrames: settings.maxStalledFrames,
    maxAdditionalMs: settings.maxAdditionalMs,
    cOptions: { maxIdleFrames: settings.maxIdleFrames, observation: {
      budget: { detectMs: settings.maxAdditionalMs }, maxHypotheses: settings.maxCandidates,
      geometrySources: ['n7', 'cq', 'daehan'], refineCq: true, refineN7: true,
      tracking: { minNcc: settings.minTrackedNcc },
    } },
  });
}
