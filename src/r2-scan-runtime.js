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
  /*
   * 🔴 **런타임 중에 껐다 켤 수 있어야 한다** (2026-09-04 운영자 요구).
   * 「R2 가 R1 을 완전대체 가능할거라고 생각하지 않기 때문에도 있고, 비교하기 쉽게
   * 하기 위한것도」 — 같은 코드로 A/B 하려면 앱을 다시 띄우지 않고 전환돼야 한다.
   *
   * ⚠ 끄면 **후보 세션을 버린다.** 껐다 켰을 때 옛 누적이 살아 있으면 A/B 가
   * 오염된다 — 「껐다고 생각했는데 그때 모은 증거로 풀린」 프레임이 섞인다.
   */
  let enabled = options.enabled === true;
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
  /*
   * 표시용 뷰 (PM/029 §18\~19 우하단 셀맵 렌더). **선두 후보**(D 최대)의 셀맵과
   * 셀 중심 사영 좌표를 내보낸다. 셀맵은 세션 버퍼 **참조**라 복사가 없고, 좌표 버퍼는
   * bind 때 한 번 잡는다 — 핫 경로 할당 금지.
   * ⚠ 셀맵은 `session.js` 가 매 프레임 `margin >= tauCellQ8 ? CONFIRMED : CANDIDATE` 로
   * 칠한다. 벽에 붙은 세트는 전 셀 CANDIDATE 다 (PM/029B §25.7) — 그것이 이 렌더가
   * 보여 줘야 할 바로 그 그림이다.
   */
  let centres = new Float32Array(0);
  const view = {
    cellMap: null,
    /** 셀당 세 면 마름모 중심 (cellCount×6). 옛 «셀 중심 평균» 은 Y-심으로 붕괴해 퇴역 (adapter 주석). */
    cellFaceCentres: null,
    cellCount: 0,
    frameWidth: 0,
    frameHeight: 0,
    layoutId: '',
    // 2a — HUD 기하 원천. H 는 어댑터 내부 버퍼의 **읽기 전용 참조**(쓰지 마라), lockRevision 이 바뀐 프레임에만 다시 사영한다.
    H: null,
    n: 0,
    lockRevision: 0,
  };
  const stats = {
    frames: 0,
    binds: 0,
    candidateCount: 0,
    lockedN: 0,
    doneLayoutId: '',
    doneFrame: -1,
    text: null,
    // 표시용 (PM/029 §17\~19). 데이터는 A6·C5 가 이미 낸다 — 없는 건 그리는 층이다.
    progressD: 0,
    indicator: 0,
    // 2a — 좌 패널·HUD 가 읽는 «확정/변동» 원천 (전부 기존 값 전달, 핫 경로 할당 0).
    locked: 0,
    lockF: 0,
    layoutIdLocked: '',
    leadingLayoutId: '',
    /** 후보별 [{layoutId, D, indicator, alive}] — bind 때 한 번 만들고 매 프레임 덧쓴다. */
    candidates: [],
  };

  function disposeCandidates() {
    candidates = [];
    boundN = 0;
    framesSinceBind = 0;
    stats.candidateCount = 0;
    // 진행률도 같이 버린다 — 후보가 없는데 막대가 차 있으면 거짓말이다.
    stats.progressD = 0;
    view.cellMap = null;
    view.cellFaceCentres = null;
    view.cellCount = 0;
    view.layoutId = '';
    view.H = null;
    view.n = 0;
    stats.candidates.length = 0;
    stats.leadingLayoutId = '';
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
    stats.candidates = candidates.map((c) => ({ layoutId: c.layoutId, D: 0, indicator: R2_INDICATOR.LOCKED, alive: true }));
    // 좌표 버퍼는 후보 중 가장 큰 격자에 맞춰 **한 번** 잡는다.
    let maxCells = 0;
    for (const candidate of candidates) {
      const count = candidate.session.layout.cellCount;
      if (count > maxCells) maxCells = count;
    }
    if (centres.length < maxCells * 6) centres = new Float32Array(maxCells * 6);
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

    // options.adapters 는 **테스트 주입용** — 코퍼스가 못 만드는 상태(락은 됐는데 증거 0)를 가짜 어댑터로 만든다 (ⓝ).
    if (adapters === null) adapters = options.adapters || createA3Adapters({});

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
    stats.locked = adapters.stats.locked;
    stats.lockF = adapters.stats.gridLockF;
    stats.layoutIdLocked = adapters.stats.layoutId;
    if (lockedN > 0 && lockedN !== boundN) bind(lockedN);
    if (candidates.length === 0) return null;

    framesSinceBind += 1;
    // 표시용 — 후보 중 **가장 앞선** 진행률을 남긴다. 사용자에게 「몇 개 후보를 돌리는
    // 중인지」는 관심사가 아니고 「얼마나 찼는지」가 관심사다 (PM/029 §17).
    // bestD 를 -1 에서 시작한다 — 첫 살아 있는 후보가 D=0 이어도 선두가 되고 **그 indicator 가 나간다**.
    // (옛 코드는 0 에서 시작해 D 가 전부 0 이면 SEARCHING 으로 남았다: 락 직후 «전 셀 미관측» 인데
    // 패널은 «탐색 중» — 2a 수리.) 동률은 안 바꾼다(strict >) 라 선두 = 첫 살아 있는 후보.
    let bestD = -1;
    let bestIndicator = R2_INDICATOR.SEARCHING;
    let leading = null;
    for (let idx = 0; idx < candidates.length; idx += 1) {
      const candidate = candidates[idx];
      const entry = stats.candidates[idx];
      if (!candidate.alive) { if (entry) entry.alive = false; continue; }
      let result;
      try {
        result = candidate.session.pushFrame(luma.data, luma.width, luma.height, timestamp, null);
      } catch {
        candidate.alive = false;
        if (entry) entry.alive = false;
        continue;
      }
      const d = result.progress && Number.isFinite(result.progress.D) ? result.progress.D : 0;
      if (entry) { entry.D = d; entry.indicator = result.indicator; entry.alive = true; }
      if (d > bestD) {
        bestD = d;
        bestIndicator = result.indicator;
        leading = candidate;
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

    stats.progressD = bestD < 0 ? 0 : bestD;
    stats.indicator = leading === null ? R2_INDICATOR.SEARCHING : bestIndicator;
    stats.leadingLayoutId = leading === null ? '' : leading.layoutId;

    // 표시용 뷰 갱신 — 선두 후보의 셀맵(참조) + 어댑터가 사영한 셀 중심.
    if (leading !== null) {
      const cellCount = leading.session.layout.cellCount;
      const mapped = adapters.projectCellFaceCentres(centres, cellCount);
      view.cellMap = leading.session.result.progress.cellMap;
      view.cellFaceCentres = centres;
      view.cellCount = mapped > 0 ? cellCount : 0;
      view.H = adapters.H;
      view.n = boundN;
      view.lockRevision = adapters.stats.lockRevision;
      view.frameWidth = luma.width;
      view.frameHeight = luma.height;
      view.layoutId = leading.layoutId;
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
    stats.progressD = 0;
    stats.indicator = 0;
    stats.doneLayoutId = '';
    stats.doneFrame = -1;
    stats.text = null;
  }

  function setEnabled(next) {
    const flag = next === true;
    if (flag === enabled) return;
    enabled = flag;
    // 켜든 끄든 누적을 버린다 — 전환 전 증거가 전환 후 답에 섞이면 A/B 가 오염된다.
    disposeCandidates();
    lastAt = -Infinity;
  }

  return {
    get enabled() { return enabled; },
    setEnabled,
    pushFrame,
    reset,
    stats,
    view,
  };
}

/**
 * R2 적중을 R1 과 **같은 문**(handleDecodeResult → normalizeDecodePayload)이 받는 모양으로
 * 만든다. R1 은 `payload: result.text` 로 감싼다 (scanner.js 단발 경로). `text` 를 그대로
 * 넘기면 문이 `payload` 만 보므로 성공이 실패로 떨어진다 — 2026-09-05 시험판에서 실제로
 * 그랬고(.04~.05.02), 자 ⓑ 는 `handleDecodeResult(` 철자만 재서 초록이었다. 이제 ⓘ 가
 * 이 함수의 출력을 그 문에 **값으로** 넣어 본다.
 */
export function r2HitToDecodeResult(hit) {
  if (!hit || typeof hit.text !== 'string') return null;
  return {
    ok: true,
    payload: hit.text,
    source: 'r2',
    layoutId: hit.layoutId,
    n: hit.n,
    r2Frame: hit.frame,
  };
}

/**
 * R2 가 지금 «할 수 있다»고 말해도 되는 것 — 시험판 범위 안내 문구(`guide.scope.r2`)는
 * 이 원장과 묶인다 (`test/r2-scan-runtime.test.js` ⓛ). 능력이 바뀌면 여기부터 바꾸고,
 * 문구는 자가 빨개진 뒤 따라온다.
 *  · readsQr: 일반 QR 을 읽는다 — 단 readsQrVia 의 브라우저 BarcodeDetector 에 위임해서(§26),
 *    자체 복호기는 없다. qrRuntimeGated: 가용 여부가 실행 시 판정이라 문구는 3상태다 (`scanScopeCopyKey`).
 *  · accumulatesFamilies: 누적 후보는 `finalLayoutIdsForN` 의 라인업 = Type Y 계열뿐이다.
 *    다른 타입(A·V·K·O·C·daehan)은 R2 on 에서도 R1 단발로만 읽힌다.
 */
export const R2_CAPABILITIES = Object.freeze({
  readsQr: true,
  readsQrVia: 'BarcodeDetector',
  qrRuntimeGated: true,
  accumulatesFamilies: Object.freeze(['Y']),
});
