/** C 관측 소켓을 공용 후보 수명/누적/RS 실행기에 연결해요. */
import { createCAdapters, FAMILY_C } from './adapter-c.js';
import { createObservedCandidateRuntime } from './observed-candidate-runtime.js';

export function createCCandidateRuntime(options = {}) {
  return createObservedCandidateRuntime({ ...options, family: FAMILY_C, preferPendingAcquisition: true, preferInitialService: true,
    adapters: options.adapters ?? createCAdapters(options.observation) });
}
