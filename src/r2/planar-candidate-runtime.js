/** O/A/V/K는 하나의 광학 관측기와 공용 후보 풀을 사용해요. */
import { createPlanarAdapters, FAMILY_PLANAR } from './adapter-planar.js';
import { createObservedCandidateRuntime } from './observed-candidate-runtime.js';

export function createPlanarCandidateRuntime(options = {}) {
  return createObservedCandidateRuntime({ ...options, family: FAMILY_PLANAR,
    adapters: options.adapters ?? createPlanarAdapters(options.observation) });
}
