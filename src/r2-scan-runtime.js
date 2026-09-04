/**
 * r2-scan-runtime.js — **R2 누적 복호기의 스캐너 배선** (S5 · PM/029B §22·§23).
 *
 * 스캐너가 매 카메라 프레임을 여기로 밀어 넣는다. R1(단발)과 **독립 캐던스**다 —
 * S2(옛 안)는 `!isDecoding` 게이트 **안**에 있어서 R2 가 「카메라 프레임당」이 아니라
 * 「단발 복호 1사이클당」 한 장을 받았고, 그러면 다중프레임 누적기가 단발보다 프레임을
 * 더 볼 방법이 **구조적으로 없다** (PM/029 §6.5.1).
 *
 * ## 왜 후보를 여럿 돌리나
 * 라이브에서는 `layoutId` 를 알 수 없다. 실측 (PM/029B §23.6):
 *   · 블록 로케이터는 **계열을 틀린다** (`v0tr` 코드에 `v0t` 를 30/30)
 *   · 포맷 CRC 는 **전혀 못 가른다** (후보 전부 crcOk 16/40 동일)
 *   · R1 은 맞히는데, 그 기전이 **본문 RS 로 가르기**다
 * ⇒ 레이아웃은 본문 RS 로만 갈린다. 그래서 후보별로 누적하고 **먼저 복호되는 쪽**을 쓴다.
 *
 * 🟢 그 설계가 안전한 근거 (`tools/wrong-grid-probe.mjs`, 2026-09-04):
 * 후보 5개 × ecc×mask 9 × 3시퀀스 전수에서 **틀린 격자가 낸 DONE 은 0건**이다.
 * 쓰레기 DONE 도 0. 참 격자만 DONE 을 내고 그때 **복호 시도는 1회**다.
 *
 * ## 🔴 어댑터를 **공유**한다
 * 후보마다 어댑터를 만들면 초기 로케이터 패스(≈200 ms)를 후보 수만큼 중복한다.
 * 하나를 공유하면 검출·락이 1회이고 후보별로는 정합+누적만 든다.
 *
 * ## 착지 조건 (PM/029B §22·§23.6 — 이 파일이 지켜야 하는 것)
 *   ⓐ `(n, layoutId)` 가 바뀌면 **세션을 다시 만든다** (재생성 0.013\~0.017 ms).
 *      틀린 격자 위 누적은 되사올 수 없으므로 버리는 것이 옳다.
 *   ⓑ 포맷 미해결을 `found = 0` 으로 표현하지 **않는다** — 그러면 `clearLock` 이
 *      `alignInto` 안에만 있어서 잘못된 락이 영구 동결된다 (닫힌 고리).
 *   ⓒ 후보 수를 `finalLayoutIdsForN` 에서 **유도**한다. 상수로 박으면 n=13(후보 1개)이
 *      쓸데없이 비싸진다.
 */

import { createA3Adapters } from './r2/adapter-locator.js';
import { createR2Session, R2_INDICATOR } from './r2/session.js';
import { createRsDecodeInto } from './r2/decode-rs.js';
import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from './cellSurfaceFinal.js';
import { maskValue } from './mask.js';
import { unframe } from './header.js';

/** 한 후보가 살아 있는 채로 소비할 수 있는 최대 프레임. 넘으면 접는다. */
const CANDIDATE_PATIENCE_FRAMES = 40;

function buildLayout(n, layoutId, eccName, maskIndex) {
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId);
  const capacity = capacityForCellSurfaceFinal(n, eccName, 2, layoutId);
  const maskDigits = new Uint8Array(scan.length);
  for (let k = 0; k < scan.length; k += 1) {
    maskDigits[k] = maskValue(scan[k].i, scan[k].j, maskIndex);
  }
  return {
    cellCount: scan.length,
    requiredSymbolCount: capacity.dataSymbols,
    nsym: capacity.nsym,
    maskDigits,
    maxPayloadBytes: capacity.dataBytes,
    payloadBytes: capacity.dataBytes,
  };
}

/**
 * @param {object} [options]
 * @param {boolean} [options.enabled] 꺼져 있으면 이 런타임은 **아무것도 하지 않는다**.
 * @param {number} [options.intervalMs] R2 캐던스. 기본 0 = 매 프레임.
 * @param {string} [options.eccName] 포맷을 못 읽었을 때 쓸 ecc. 기본 'H'.
 * @param {number} [options.maskIndex] 같은 이유의 mask. 기본 0.
 * @param {number} [options.maxCandidates] 안전 상한.
 */
export function createR2ScanRuntime(options = {}) {
  const enabled = options.enabled === true;
  const intervalMs = Number.isFinite(options.intervalMs) ? Number(options.intervalMs) : 0;
  const defaultEcc = typeof options.eccName === 'string' ? options.eccName : 'H';
  const defaultMask = Number.isInteger(options.maskIndex) ? options.maskIndex : 0;
  const maxCandidates = Number.isInteger(options.maxCandidates) ? options.maxCandidates : 6;

  let adapters = null;
  let candidates = [];
  // 검출 출력 스크래치 — 프레임마다 새로 만들지 않는다 (핫 경로 할당 금지).
  const detection = {
    found: 0, family: 0, n: 0, H: null, layoutId: '', faceLabels: null,
  };
  let boundN = 0;
  let lastAt = -Infinity;
  let framesSinceBind = 0;
  const stats = {
    frames: 0,
    binds: 0,
    candidateCount: 0,
    lockedN: 0,
    doneLayoutId: '',
    doneFrame: -1,
    text: null,
  };

  function disposeCandidates() {
    candidates = [];
    boundN = 0;
    framesSinceBind = 0;
    stats.candidateCount = 0;
  }

  /**
   * ⓐ·ⓒ — 락이 준 `n` 으로 후보를 **유도**해 세션을 만든다.
   * `n` 이 바뀌면 이전 후보를 통째로 버린다 (틀린 격자 위 누적은 못 되산다).
   */
  function bind(n) {
    disposeCandidates();
    let ids;
    try {
      ids = finalLayoutIdsForN(n);
    } catch {
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) return;
    for (const layoutId of ids.slice(0, maxCandidates)) {
      let layout;
      try {
        layout = buildLayout(n, layoutId, defaultEcc, defaultMask);
      } catch {
        continue;
      }
      const decodeInto = createRsDecodeInto({
        codewordCapacity: Math.floor(layout.cellCount / 3),
      });
      candidates.push({
        layoutId,
        alive: true,
        session: createR2Session({
          layout,
          // 🔴 어댑터를 **공유**한다 — 검출·락이 후보 수만큼 중복되지 않는다.
          detectInto: adapters.detectInto,
          alignInto: adapters.alignInto,
          decodeInto,
        }),
      });
    }
    boundN = n;
    stats.binds += 1;
    stats.candidateCount = candidates.length;
  }

  /**
   * 프레임 하나를 민다. **DONE 이면 그 글자를 돌려주고, 아니면 null.**
   * @param {{width:number, height:number, data:Float32Array}} luma
   * @param {number} timestamp
   */
  function pushFrame(luma, timestamp) {
    if (!enabled || !luma) return null;
    if (Number.isFinite(timestamp) && timestamp - lastAt < intervalMs) return null;
    lastAt = Number.isFinite(timestamp) ? timestamp : lastAt;
    stats.frames += 1;

    if (adapters === null) adapters = createA3Adapters({});

    /*
     * 🔴 **검출을 여기서 직접 한 번 돌린다.** 안 그러면 닫힌 고리가 된다 —
     * `adapters.stats.n` 은 `detectInto` 가 채우는데 그것을 부르는 것은 **세션**이고,
     * 세션은 후보가 있어야 생기고, 후보는 `n` 이 있어야 만들어진다.
     * (첫 구현이 정확히 이 교착에 걸려 후보 0 · 0.01 ms/프레임으로 아무것도 안 했다.
     *  F1(§21.3)과 같은 모양이다 — 상태를 만드는 쪽과 읽는 쪽이 서로를 기다린다.)
     *
     * 락이 있으면 이 호출은 0.01 ms 즉시 반환이다 (§23 실측). 락이 없을 때만
     * 로케이터가 돈다 — 그리고 그것이 어차피 필요한 일이다.
     */
    detection.found = 0;
    detection.n = 0;
    try {
      adapters.detectInto(luma.data, luma.width, luma.height, timestamp, null, detection);
    } catch {
      return null;
    }

    // 락이 준 n 을 읽는다. 후보 세션이 없거나 n 이 바뀌었으면 다시 묶는다 (ⓐ).
    const lockedN = detection.found ? adapters.stats.n : 0;
    stats.lockedN = lockedN;
    if (lockedN > 0 && lockedN !== boundN) bind(lockedN);
    if (candidates.length === 0) return null;

    framesSinceBind += 1;
    for (const candidate of candidates) {
      if (!candidate.alive) continue;
      let result;
      try {
        result = candidate.session.pushFrame(luma.data, luma.width, luma.height, timestamp, null);
      } catch {
        candidate.alive = false;
        continue;
      }
      if (result.indicator !== R2_INDICATOR.DONE) continue;
      let text = null;
      try {
        text = unframe(Uint8Array.from(result.payload.slice(0, result.payloadLength))).text;
      } catch {
        // 프레이밍이 막았다 — 이 후보는 이번 프레임에 답이 아니다. 세션은 살려 둔다.
        continue;
      }
      stats.doneLayoutId = candidate.layoutId;
      stats.doneFrame = stats.frames - 1;
      stats.text = text;
      return { text, layoutId: candidate.layoutId, n: boundN, frame: stats.doneFrame };
    }

    // 오래 붙들고도 아무도 못 풀면 접는다 — 락이 틀렸을 수 있고, 그때는 어댑터의
    // F 게이트가 락을 걷어내 다음 bind 가 다른 n 으로 온다.
    if (framesSinceBind > CANDIDATE_PATIENCE_FRAMES) disposeCandidates();
    return null;
  }

  function reset() {
    if (adapters !== null) adapters.reset();
    disposeCandidates();
    lastAt = -Infinity;
    stats.frames = 0;
    stats.doneLayoutId = '';
    stats.doneFrame = -1;
    stats.text = null;
  }

  return { enabled, pushFrame, reset, stats };
}
