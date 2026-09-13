/** 정적 ESM import 그래프를 공유하므로 단일 HTML의 blob 모듈도 그대로 Worker가 돼요. */
import { createR2RoutedEngine } from './r2-routed-engine.js';

export const R2_WORKER_ENTRY_URL = import.meta.url;

export function createR2WorkerEndpoint(send, { createEngine = createR2RoutedEngine } = {}) {
  let engine = null, generation = null;
  return function receive(message) {
    if (!message || !Number.isSafeInteger(message.generation) || !Number.isSafeInteger(message.requestId)) return;
    if (message.type === 'invalidate') {
      engine?.invalidateLock(); generation = message.generation;
      send({ type: 'invalidated', generation, requestId: message.requestId,
        snapshot: engine ? { stats: engine.stats, view: engine.view, hudCandidates: engine.hudCandidates } : null });
      return;
    }
    if (message.type !== 'frame') return;
    try {
      if (!engine || generation !== message.generation) {
        engine?.reset(); generation = message.generation;
        engine = createEngine({ ...message.options, enabled: true });
      }
      const at = performance.now();
      const hit = engine.pushFrame(message.field, message.timestamp, { frameId: message.frameId, ownedInput: true,
        ...(message.hField?{hField:message.hField}:{}) });
      // runtime이 input/표본을 보유할 수 있어요. 그 버퍼를 transfer로 떼어 보내지 않아요.
      const snapshot = { stats: engine.stats, view: engine.view, hudCandidates: engine.hudCandidates };
      send({ type: 'result', generation, requestId: message.requestId, frameId: message.frameId,
        timestamp: message.timestamp, hit, snapshot, serviceMs: performance.now() - at });
    } catch (error) {
      send({ type: 'error', generation: message.generation, requestId: message.requestId,
        message: String(error?.message ?? error) });
    }
  };
}

// 메인 페이지는 URL만 가져가요. 이벤트 설치는 DedicatedWorker 안에서만 일어나요.
if (typeof DedicatedWorkerGlobalScope !== 'undefined' && globalThis instanceof DedicatedWorkerGlobalScope) {
  const receive = createR2WorkerEndpoint(message => globalThis.postMessage(message));
  globalThis.onmessage = event => receive(event.data);
}
