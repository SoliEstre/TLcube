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
import { correctedCellsForHit } from './r2/corrections.js';
import { finalLayoutIdsForN, resolveFormatWire } from './cellSurfaceFinal.js';
import { buildYLayout as buildLayout } from './r2/y-layout.js';
import { unframe } from './header.js';
import { createR2TypeExpansionRuntime } from './r2/type-expansion-runtime.js';

/**
 * 후보를 접기 전에 참는 **락 없는 연속 프레임** 수 (R2, 2026-09-06).
 *
 * 🔴 옛 뜻은 «bind 이후 총 프레임» 이었다. 그러면 락이 멀쩡히 살아 있어도 42프레임마다
 * 후보가 전부 폐기되고, 락이 남아 있으니 **같은 프레임에 즉시 재bind** 된다 — 즉
 * 3\~4초마다 누적 증거가 0 으로 돌아갔다. 운영자 실기 3차 ③ 「수집은 되나 리셋 반복」의
 * 두 기전 중 하나다(다른 하나는 COAST 만료 → R3).
 *
 * 이 상수가 답해야 하는 질문은 「락을 잃은 채 얼마나 기다렸다 접나」 하나다.
 * 40프레임 ≈ 3\~5초 @7\~15 fps — 손이 흔들려 놓친 시간과 「다른 코드로 옮겼다」를 가르는
 * 자리다. 락이 살아 있는 동안은 0 으로 리셋된다.
 */
const CANDIDATE_PATIENCE_FRAMES = 40;

/**
 * 🔴 **n 이 바뀌었을 때 옛 후보를 «선반» 에 두는 프레임 수** (2026-09-06 검토 R3c, 결함 3·9b).
 *
 * 왜: 재bind 는 증거를 통째로 버린다. 그런데 락이 한 프레임 흔들려 로케이터가 잡음 shape 을
 * 내면 그 **한 프레임**이 수백 프레임 치 누적을 죽였다 — 실측 y2@066: n=25 로 D 0.62 까지
 * 모은 뒤 f8 한 프레임의 n=13 검출이 bind(13) 을 불러 D 0.36 에 영원히 정체했다.
 *
 * ⚠ **왜 «지연» 이 아니라 «선반» 인가 — 사다리를 양쪽 끝까지 재고 골랐다** (실측, 창 스윕
 * `y0 y1 y2 y2-p9rot swap-multi` × stride 6 · 길이 45 = 104창):
 *   · 아무것도 안 함(즉시 bind, 옛 거동)  : DONE 59 · 개선 16 · 악화 0
 *   · 「연속 3프레임 확인 뒤 bind」(지연)  : DONE 58 · 개선 16 · **악화 1**
 *     — swap-multi@132 에서 n25 로 바뀐 **첫 두 프레임(F 1990·2854)** 이 확인을 기다리다 버려져
 *       DONE f44 를 놓쳤다. 지연은 옛 증거를 지키려고 **새 증거의 가장 좋은 프레임**을 버린다.
 *   · 선반(즉시 bind + 옛 후보 보류)      : DONE 59 · 개선 16 · 악화 0  ← 채택
 * 즉 새 `n` 으로는 **곧바로** 모으되, 옛 후보는 버리지 않고 이 프레임 수만큼 얼려 둔다.
 * 그 사이에 락이 옛 `n`(+같은 포맷)으로 돌아오면 얼린 증거를 그대로 되살린다.
 *
 * ⚠ 후보가 **없을 때**(첫 락)는 선반이 비어 있다 — 지킬 증거가 없다.
 */
const BIND_N_CONFIRM_FRAMES = 3;

/**
 * @param {object} [options]
 * @param {boolean} [options.enabled] 꺼져 있으면 이 런타임은 **아무것도 하지 않는다**.
 * @param {number} [options.intervalMs] R2 캐던스. 기본 0 = 매 프레임.
 * @param {string} [options.eccName] 포맷을 못 읽었을 때 쓸 ecc. 기본 'H'.
 * @param {number} [options.maskIndex] 같은 이유의 mask. 기본 0.
 * @param {number} [options.maxCandidates] 안전 상한.
 */
export function createR2ScanRuntime(options = {}) {
  if (options.expansion?.enabled === true) {
    // 격리 평가용 명시적 설정만 받으며 기존 기본 실행과 capability는 유지해요.
    return createR2TypeExpansionRuntime({
      yRuntime: createR2ScanRuntime({ ...options, expansion: undefined }),
      maxCandidates: options.expansion.maxCandidates,
      maxTrustedFrames: options.expansion.maxTrustedFrames,
      maxStalledFrames: options.expansion.maxStalledFrames,
      cOptions: options.expansion.cOptions,
    });
  }
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
  // 선택적 조합기만 쓴다. Y 후보의 생성/복원 직전에 다른 관측기 좌석을 비워요.
  // 콜백이 없으면 기존 Y 순서·후보·누적에는 아무 영향이 없어요.
  let reserveCandidates = null;
  /*
   * HUD 후보 feed는 복호 세션의 표현 사본만 소유한다. ID는 layoutId나 배열 위치가 아니라
   * 이 런타임 안에서 단조 증가하는 세대 번호다. reset/bind 뒤에도 되감지 않는다.
   */
  let nextHudCandidateId = 1;
  const hudCandidateRows = [];
  let currentLockValid = false;
  /*
   * 3b — 정정 셀 보관함. DONE 에서만 쓰이고 스크래치는 필요한 만큼만 자란다 (줄어들지 않는다 —
   * 재bind 마다 다시 잡으면 그것도 할당이다). 적중이 돌려주는 것은 이 버퍼의 **뷰**다.
   * 채우는 규칙은 `r2/corrections.js` 의 `correctedCellsForHit` 하나다 — 여기서 다시 적지 않는다
   * (그래야 코퍼스가 못 지나는 이 분기를 자가 값으로 지난다 · 3b 검토 F4).
   */
  const correctedHolder = { scratch: new Uint16Array(0), count: 0, cells: new Uint16Array(0) };
  // 검출 출력 스크래치 — 프레임마다 새로 만들지 않는다 (핫 경로 할당 금지).
  const detection = {
    found: 0, family: 0, n: 0, H: null, layoutId: '', faceLabels: null,
  };
  let boundN = 0;
  /*
   * R3c 결함 1 — bind 키의 나머지 반쪽. `n` 만으로는 **같은 n 의 다른 포맷**(mask·ecc·wire)을
   * 가르지 못한다. 어댑터는 재락마다 포맷을 다시 읽는데(adapter-locator `readFormatAt`) 런타임이
   * 그것을 소비하지 않아, mask 0 코드로 묶인 세션이 mask 2 코드를 계속 받으며 **영구히** 못 풀었다
   * (실측 review-R-out-swapmask: rtFmt=H/0 이 150프레임 유지, decodeAttempts 30 = decodeFailures 30,
   * DONE 0). 인내 폐기(빈 45프레임)로 후보가 접힌 **뒤에야** 정상으로 돌아왔다.
   */
  let boundFormatKey = '';
  /**
   * 얼린 옛 후보 (BIND_N_CONFIRM_FRAMES 프레임). `{ n, formatKey, format, candidates, age }`.
   * 얼린 동안 프레임을 안 받으므로 누적기는 얼린 시점 그대로다.
   */
  let shelf = null;
  let lastAt = -Infinity;
  /** R2 — «락이 없는 연속 프레임». 락이 살아 있는 프레임마다 0 으로 돌아간다. */
  let framesWithoutLock = 0;
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
    /*
     * R7 — HUD 재사영 조건의 나머지 반쪽. `lockRevision` 은 **어댑터 락 세대**라
     * 「같은 락 위에서 후보를 다시 묶었다」(레이아웃·cellCount·셀맵 버퍼가 통째로 바뀐다)를
     * 표현하지 못한다. `disposeCandidates` 는 `view.H`·`n` 만 비우고 세대를 안 올려서
     * 재bind 뒤 HUD 비교식(lockRevision·n)이 **같은 값**이 되고 재사영이 일어나지 않았다.
     * 그래서 bind 세대를 따로 낸다. 소비자는 둘 다 봐도 되고 `lockKey` 하나만 봐도 된다.
     */
    bindRevision: 0,
    lockKey: 0,
    /*
     * 빚 3 — **이 후보들이 묶인 포맷 세대**. HUD 는 이 값으로 역할 격자를 만든다: 격자가 세대를
     * 모르면 레거시(와이어 1) 프레임에서 정정 강조·소거 색칠이 **다른 칸**을 지목한다 (3a 유산).
     * 「모른다」는 없다 — 포맷을 못 읽은 프레임은 현행 세대로 묶이므로(`resolveFormatWire`)
     * 그 값이 그대로 실린다. 격자를 만든 세대와 후보를 묶은 세대가 **같은 수**여야 한다.
     */
    formatWire: resolveFormatWire(undefined),
  };
  const stats = {
    frames: 0,
    binds: 0,
    bindRevision: 0,
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
    /**
     * 3d — 어댑터의 락 마진 `F_1위/F_2위`. **미측정은 NaN** (락이 없거나 아직 정합 프레임이 없다).
     * 화면은 이 수를 「왜 안 모으나」의 답으로 읽는다 — F 는 통과했는데 막대가 안 차는 프레임의 이유다.
     */
    lockMargin: NaN,
    /**
     * 3d — 마진 게이트 미달 = «격자를 못 믿는 중». 어댑터가 매 정합 프레임에 정한다.
     * ⚠ 후보가 하나도 없어 `alignInto` 가 안 불린 프레임에서는 **직전 판정이 그대로 남는다**
     * (락이 걷히면 어댑터가 false 로 되돌린다) — 「이 락에 대한 마지막 정합의 판정」이 뜻이다.
     */
    lockDistrusted: false,
    layoutIdLocked: '',
    leadingLayoutId: '',
    /** 후보별 [{layoutId, D, indicator, alive}] — bind 때 한 번 만들고 매 프레임 덧쓴다. */
    candidates: [],
    /*
     * R7 — 「무엇이 몇 번 일어났나」. HUD 프로그램이 «왜 리셋됐나» 를 화면에서 가르려면
     * 라벨(indicator)이 아니라 이 수가 필요하다. 전부 누적값이고 `reset()` 에서만 0 이다.
     */
    counters: {
      hardDrops: 0,
      coastFrames: 0,
      lockClears: 0,
      relocates: 0,
      binds: 0,
      decodeAttempts: 0,
      decodeFailures: 0,
    },
    /** R6 — 이번 락에 쓰인 ecc·mask 의 출처. 'default' 면 코드가 말해 주지 않은 것이다. */
    format: {
      source: 'default', eccName: '', maskIndex: 0, candidateCount: 0,
      // 빚 3 — bind 가 실제로 쓴 세대(해석 뒤). `formatWireVersion`(어댑터의 «읽었나») 과 달리
      // 여기 값은 언제나 유효한 세대다 — 소비자(HUD)가 «모름» 을 다시 해석하지 않게.
      formatWire: resolveFormatWire(undefined),
    },
    /** R7 — 프레임 단위 ms. 시험판 패널의 frame 총합을 단계별로 가른다. */
    phaseMs: { detect: 0, align: 0, decode: 0 },
  };

  /*
   * R7 — 세션 카운터는 **세션 수명**이라 후보를 버리면 0 으로 돌아간다. HUD 가 묻는 것은
   * 「이 스캔에서 몇 번 리셋됐나」이므로, 버리기 전에 은퇴분을 여기 더해 둔다.
   * 안 하면 「많이 드랍됐다」가 재bind 한 번에 조용히 0 이 되고, 그 화면은 거짓말이다.
   */
  const retired = {
    hardDrops: 0, coastFrames: 0, decodeAttempts: 0, decodeFailures: 0,
  };

  function newHudGeneration(candidate) {
    const cellCount = candidate.session.layout.cellCount;
    candidate.hud = {
      id: 'r2-y-' + nextHudCandidateId,
      type: 'Y',
      n: candidate.n,
      layoutId: candidate.layoutId,
      D: 0,
      indicator: R2_INDICATOR.LOCKED,
      tracking: false,
      retained: true,
      alive: candidate.alive !== false,
      // 세션 progress 버퍼를 밖으로 직접 내보내지 않는다. 후보 세대가 이 사본을 단독 소유한다.
      cellMap: new Uint8Array(cellCount),
      cellCount,
      H: null,
      frameWidth: 0,
      frameHeight: 0,
      formatWire: candidate.formatWire,
      revision: 0,
    };
    nextHudCandidateId += 1;
    candidate.hudNeedsGeneration = false;
  }

  function indicatorTracks(indicator) {
    return indicator !== R2_INDICATOR.HOLD
      && indicator !== R2_INDICATOR.DROPPED
      && indicator !== R2_INDICATOR.SEARCHING
      && indicator !== R2_INDICATOR.FAILED;
  }

  function updateHudCandidate(candidate, result, luma) {
    const hardDrops = candidate.session.counters
      ? candidate.session.counters.hardDrops : 0;
    if (hardDrops > candidate.hudHardDrops) {
      candidate.hudHardDrops = hardDrops;
      candidate.hudNeedsGeneration = true;
    }
    // DROPPED 행은 옛 세대 ID로 한 번 보인다. 재획득/재초기화가 시작되는 순간 새 ID를 준다.
    if (candidate.hudNeedsGeneration && result.indicator !== R2_INDICATOR.DROPPED) {
      newHudGeneration(candidate);
    }

    const row = candidate.hud;
    const progress = result && result.progress;
    const sourceMap = progress && progress.cellMap;
    if (sourceMap && sourceMap.length >= row.cellCount) {
      if (sourceMap.length === row.cellCount) row.cellMap.set(sourceMap);
      else for (let i = 0; i < row.cellCount; i += 1) row.cellMap[i] = sourceMap[i];
    }
    row.D = progress && Number.isFinite(progress.D) ? progress.D : 0;
    row.indicator = result.indicator;
    row.alive = candidate.alive !== false;
    const freshLock = currentLockValid && Boolean(adapters && adapters.stats && adapters.stats.locked);
    currentLockValid = freshLock;
    const freshH = Boolean(adapters && adapters.H && adapters.H.length >= 9);
    row.tracking = row.alive && freshLock && freshH && indicatorTracks(row.indicator);
    row.retained = !row.tracking;
    if (row.tracking) {
      if (row.H === null) row.H = new Float64Array(9);
      for (let i = 0; i < 9; i += 1) row.H[i] = adapters.H[i];
      row.frameWidth = luma.width;
      row.frameHeight = luma.height;
    }
    row.revision += 1;
  }

  function markActiveHudNotTracking() {
    for (const candidate of candidates) {
      if (!candidate.hud || (!candidate.hud.tracking && candidate.hud.retained)) continue;
      candidate.hud.tracking = false;
      candidate.hud.retained = true;
      candidate.hud.revision += 1;
    }
  }

  function hudCandidates() {
    let count = 0;
    for (const candidate of candidates) {
      if (candidate.alive === false) continue;
      const row = candidate.hud;
      if (!currentLockValid && row.tracking) {
        row.tracking = false;
        row.retained = true;
        row.revision += 1;
      }
      hudCandidateRows[count] = row;
      count += 1;
    }
    if (shelf !== null) {
      for (const candidate of shelf.candidates) {
        if (candidate.alive === false) continue;
        const row = candidate.hud;
        if (row.tracking || !row.retained) {
          row.tracking = false;
          row.retained = true;
          row.revision += 1;
        }
        hudCandidateRows[count] = row;
        count += 1;
      }
    }
    hudCandidateRows.length = count;
    return hudCandidateRows;
  }

  /** 후보 배열의 세션 카운터를 은퇴분에 더한다 — 「버리는 순간 화면의 수가 0 이 되는」 것을 막는다. */
  function retireCounters(list) {
    for (const candidate of list) {
      const cc = candidate.session && candidate.session.counters;
      if (!cc) continue;
      retired.hardDrops += cc.hardDrops;
      retired.coastFrames += cc.coastFrames;
      retired.decodeAttempts += cc.decodeAttempts;
      retired.decodeFailures += cc.decodeFailures;
    }
  }

  /** 선반을 비운다 (되살리지 않고 버릴 때). 카운터는 은퇴분으로 옮긴다. */
  function retireShelf() {
    if (shelf === null) return;
    retireCounters(shelf.candidates);
    shelf = null;
  }

  function disposeCandidates() {
    retireCounters(candidates);
    candidates = [];
    boundN = 0;
    boundFormatKey = '';
    framesWithoutLock = 0;
    stats.candidateCount = 0;
    // 진행률도 같이 버린다 — 후보가 없는데 막대가 차 있으면 거짓말이다.
    stats.progressD = 0;
    view.cellMap = null;
    view.cellFaceCentres = null;
    view.cellCount = 0;
    view.layoutId = '';
    // 빚 3 — 세대도 「모른다」로 돌린다. 남기면 다음 락이 세대를 못 읽은 프레임에 옛 세대로 그린다.
    view.formatWire = resolveFormatWire(undefined);
    view.H = null;
    view.n = 0;
    stats.candidates.length = 0;
    stats.leadingLayoutId = '';
    // 후보가 사라지는 것도 «HUD 가 다시 그려야 할 사건» 이다 — 세대를 올린다.
    bumpBindRevision();
    if (reserveCandidates) reserveCandidates(0);
  }

  /**
   * 후보와 **선반**을 같이 버린다. 「이 스캔의 증거를 전부 버린다」가 뜻인 자리
   * (인내 폐기 · 엔진 토글 · `reset()`)는 이쪽을 부른다 — 선반만 남으면 다음 n 복귀에
   * 「버렸다고 생각한 증거」가 되살아난다.
   */
  function disposeAll() {
    retireShelf();
    disposeCandidates();
  }

  /**
   * 3d — 어댑터의 «이 락을 믿을 수 있나» 를 그대로 올린다.
   *
   * 함수로 두는 이유: 부르는 자리가 **둘**(적중 프레임 · 평시 프레임)이고, 그 둘은 이미
   * 카운터·phaseMs 를 각자 베껴 적고 있다. 두 줄을 한 번 더 베끼면 다음 사람이 한쪽만 고친다.
   * 자 주입 가짜 어댑터는 이 필드가 없을 수 있다 — 없으면 «미측정(NaN)·안 불신» 이다.
   */
  function noteLockTrust() {
    const margin = adapters && adapters.stats ? adapters.stats.lockMargin : undefined;
    stats.lockMargin = typeof margin === 'number' ? margin : NaN;
    stats.lockDistrusted = Boolean(adapters && adapters.stats && adapters.stats.lockDistrusted);
  }

  function bumpBindRevision() {
    stats.bindRevision += 1;
    view.bindRevision = stats.bindRevision;
    view.lockKey = (view.lockRevision * 1000) + stats.bindRevision;
  }

  /**
   * ⓐ·ⓒ — 락이 준 `n` 으로 후보를 **유도**해 세션을 만든다.
   * `n` 이 바뀌면 이전 후보를 통째로 버린다 (틀린 격자 위 누적은 못 되산다).
   */
  /**
   * ⓐ·ⓒ 에 더해 R6 — ecc·mask 를 **락 시점에 읽은 포맷**에서 가져온다.
   *
   * 🔴 왜: 옛 코드는 `defaultEcc`('H') · `defaultMask`(0) 를 못박았고 인코더의 `auto` 는
   * 용량이 되면 H, 길면 M/L 을 쓴다 ⇒ **ecc M/L 코드는 R2 가 구조적으로 DONE 불가**였다
   * (`buildLayout` 의 nsym 이 곧 RS 패리티 수라 틀리면 본문 RS 가 절대 안 선다).
   * 포맷이 안 읽히면 옛 기본값 그대로다 — 나빠지는 축이 없다.
   */
  function formatChoice() {
    const f = adapters && adapters.stats && adapters.stats.format
      ? adapters.stats.format : null;
    if (f && f.source === 'locator' && typeof f.eccName === 'string' && f.eccName !== '') {
      return {
        source: 'locator',
        eccName: f.eccName,
        maskIndex: Number.isInteger(f.maskIndex) ? f.maskIndex : 0,
        candidateCount: Number(f.candidateCount) || 0,
        formatWire: f.formatWireVersion === 1 || f.formatWireVersion === 2
          ? f.formatWireVersion : undefined,
      };
    }
    return {
      source: 'default',
      eccName: defaultEcc,
      maskIndex: defaultMask,
      candidateCount: 0,
      formatWire: undefined,
    };
  }

  /**
   * bind 키의 포맷 부분. **문자열을 손으로 조립하는 곳이 여기 하나**여야 bind 시점 값과
   * 비교 시점 값이 같은 규칙으로 만들어진다.
   */
  function formatKeyOf(choice) {
    return choice.eccName + '|' + choice.maskIndex + '|' + (choice.formatWire === undefined ? '-' : choice.formatWire);
  }

  /**
   * 락 `n` 에 대해 지금 비교에 쓸 포맷 키. locator 가 말하지 않았으면 「모른다」이므로
   * 선반의 키를 그대로 인정한다 — 「읽기 실패」를 「다른 코드」로 읽으면 증거를 헛되이 버린다.
   */
  function boundFormatKeyFor() {
    const nowChoice = formatChoice();
    if (nowChoice.source !== 'locator') return shelf === null ? '' : shelf.formatKey;
    return formatKeyOf(nowChoice);
  }

  function bind(n) {
    disposeCandidates();
    let ids;
    try {
      ids = finalLayoutIdsForN(n);
    } catch {
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) return;
    const choice = formatChoice();
    stats.format.source = choice.source;
    stats.format.eccName = choice.eccName;
    stats.format.maskIndex = choice.maskIndex;
    stats.format.candidateCount = choice.candidateCount;
    /*
     * 빚 3 — `buildLayout` 이 `choice.formatWire` 를 그대로 넘기고, 그 안의 접근자가 `undefined` 를
     * 현행 세대로 해석한다. HUD 는 «해석 뒤» 값을 필요로 하므로 여기서 같은 규칙으로 한 번 편다 —
     * 두 층이 다른 규칙을 쓰면 「런타임이 묶은 세대」와 「HUD 가 그린 세대」가 조용히 갈린다.
     */
    stats.format.formatWire = resolveFormatWire(choice.formatWire);
    const prepared = [];
    for (const layoutId of ids.slice(0, maxCandidates)) {
      let layout;
      try {
        layout = buildLayout(
          n, layoutId, choice.eccName, choice.maskIndex, choice.formatWire,
        );
      } catch {
        continue;
      }
      prepared.push({ layoutId, layout });
    }
    // 예약은 전체 집합에 한 번만 한다. 생성 중 예외가 나도 반쪽 후보를 공개하지 않아요.
    if (reserveCandidates) reserveCandidates(prepared.length);
    const nextCandidates = [];
    try {
      for (const { layoutId, layout } of prepared) {
        const decodeInto = createRsDecodeInto({
          codewordCapacity: Math.floor(layout.cellCount / 3),
        });
        nextCandidates.push({
          layoutId,
          n,
          formatWire: stats.format.formatWire,
          alive: true,
          session: createR2Session({
            layout,
            // 🔴 어댑터를 **공유**한다 — 검출·락이 후보 수만큼 중복되지 않는다.
            detectInto: adapters.detectInto,
            alignInto: adapters.alignInto,
            decodeInto,
          }),
        });
        const candidate = nextCandidates[nextCandidates.length - 1];
        candidate.hudHardDrops = candidate.session.counters ? candidate.session.counters.hardDrops : 0;
        candidate.hudNeedsGeneration = false;
        newHudGeneration(candidate);
      }
    } catch (error) {
      for (const candidate of nextCandidates) candidate.session.reset();
      if (reserveCandidates) reserveCandidates(0);
      throw error;
    }
    candidates = nextCandidates;
    boundN = n;
    boundFormatKey = formatKeyOf(choice);
    seatCandidates();
  }

  /**
   * 지금 `candidates` 를 표시·버퍼에 앉힌다. `bind` 와 **선반 복원**이 같은 규칙을 쓰도록
   * 한 자리에 둔다 — 두 곳에 적으면 복원 경로만 조용히 어긋난다.
   */
  function seatCandidates() {
    stats.binds += 1;
    stats.counters.binds += 1;
    bumpBindRevision();
    stats.candidateCount = candidates.length;
    stats.candidates = candidates.map((c) => ({
      layoutId: c.layoutId, D: 0, indicator: R2_INDICATOR.LOCKED, alive: c.alive !== false,
    }));
    // 좌표 버퍼는 후보 중 가장 큰 격자에 맞춰 **한 번** 잡는다.
    let maxCells = 0;
    for (const candidate of candidates) {
      const count = candidate.session.layout.cellCount;
      if (count > maxCells) maxCells = count;
    }
    if (centres.length < maxCells * 6) centres = new Float32Array(maxCells * 6);
  }

  /**
   * 🔴 **n 이 바뀐 재bind** — 옛 후보를 버리지 않고 선반에 얼린다 (R3c 결함 3·9b).
   * 소유권을 선반으로 넘긴 뒤 `bind` 를 부른다: 그래야 `disposeCandidates` 가 같은 세션을
   * **두 번** 은퇴시키지 않는다(카운터 이중 계상).
   */
  function shelveAndBind(n) {
    retireShelf();
    if (candidates.length > 0) {
      shelf = {
        n: boundN,
        formatKey: boundFormatKey,
        format: { ...stats.format },
        candidates,
        age: 0,
      };
      for (const candidate of shelf.candidates) {
        candidate.hud.tracking = false;
        candidate.hud.retained = true;
        candidate.hud.revision += 1;
      }
      candidates = [];
    }
    bind(n);
  }

  /** 선반의 후보를 되살린다 — 얼린 시점의 누적기 그대로. 지금 후보는 은퇴시킨다. */
  function restoreShelf() {
    const kept = shelf;
    disposeCandidates();
    if (reserveCandidates) reserveCandidates(kept.candidates.length);
    shelf = null;
    candidates = kept.candidates;
    boundN = kept.n;
    boundFormatKey = kept.formatKey;
    // 필드 목록을 손으로 적지 않는다 — 선반은 `{ ...stats.format }` 로 얼렸으므로 같은 키 집합이다
    // (사본 목록은 썩는다: 옛 판은 넷을 적어 두어 새 칸 `formatWire` 가 복원에서만 빠질 뻔했다).
    for (const key of Object.keys(stats.format)) stats.format[key] = kept.format[key];
    seatCandidates();
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
    currentLockValid = false;
    const detectAt = performance.now();
    try {
      adapters.detectInto(luma.data, luma.width, luma.height, timestamp, null, detection);
    } catch {
      markActiveHudNotTracking();
      return null;
    }
    /*
     * R3c 결함 10 — 이 값은 **여기서 확정하지 않는다**. 프레임 중간에 락이 풀리면 그 뒤 세션이
     * 부르는 `detectInto` 가 로케이터를 통째로 돌리는데(session.js 의 검출 호출) 그 시간은 이
     * 호출 밖이다. 어댑터가 프레임 합으로 세므로 프레임 **끝**에서 그 값을 읽는다(아래 두 자리).
     * 어댑터가 그것을 안 내면(자 주입 가짜) 이 자기 계측이 폴백이다.
     */
    stats.phaseMs.detect = performance.now() - detectAt;

    // 락이 준 n 을 읽는다. 후보 세션이 없거나 n 이 바뀌었으면 다시 묶는다 (ⓐ).
    const lockedN = detection.found ? adapters.stats.n : 0;
    stats.lockedN = lockedN;
    stats.locked = adapters.stats.locked;
    stats.lockF = adapters.stats.gridLockF;
    stats.layoutIdLocked = adapters.stats.layoutId;
    currentLockValid = Boolean(detection.found && adapters.stats.locked);
    /*
     * ⓐ + R5 — bind 키는 **n 하나**다. 후보 집합은 `finalLayoutIdsForN(n)` 에서 유도되므로
     * 어댑터가 재락에서 다른 `layoutId` 를 지목해도 **후보 집합은 같고**, 그때 세션을
     * 버리면 그건 「자기 레이아웃 순서로 잘 모으던 후보들」을 이유 없이 죽이는 것이다.
     * (옛 코드는 어댑터 layoutId 를 세션 전체의 스캔순서로 썼기 때문에 이 재락이 오염이었다.
     *  R5 로 후보마다 자기 순서를 갖게 된 뒤에는 오염이 아니다.)
     */
    /*
     * ⓐ + R5 + R3c(결함 1·3·9b) — bind 키는 **(n, ecc, mask, wire)** 다.
     *   · 후보 집합은 `finalLayoutIdsForN(n)` 에서 유도되므로 어댑터가 재락에서 다른 `layoutId`
     *     를 지목해도 후보 집합은 같다 — 그때 세션을 버리는 것은 「자기 레이아웃 순서로 잘 모으던
     *     후보들」을 이유 없이 죽이는 것이다(R5 로 후보마다 자기 순서를 갖게 된 뒤에는 오염이 아니다).
     *   · 반면 **포맷이 바뀐 재락은 «다른 코드»** 다. 같은 n·layout 이라도 mask/ecc/wire 가 다르면
     *     쌓아 둔 심볼은 되살릴 수 없다 — 버리는 것이 옳다. 포맷을 «locator 가 실제로 말했을 때만»
     *     본다: 읽기 실패는 「다르다」가 아니라 「모른다」이므로 기본값 폴백으로 세션을 죽이지 않는다.
     *   · `n` 변화는 **연속 확인** 뒤에만 (한 프레임 잡음이 증거를 죽였다 — 상수 주석 참조).
     */
    if (shelf !== null) shelf.age += 1;
    if (lockedN > 0 && lockedN !== boundN) {
      // 선반이 지키던 n 으로 **돌아왔다** — 얼린 증거를 되살린다 (잡음 한 프레임의 왕복).
      if (shelf !== null && shelf.n === lockedN && shelf.formatKey === boundFormatKeyFor(lockedN)) {
        restoreShelf();
      } else {
        shelveAndBind(lockedN);
      }
    } else if (lockedN > 0 && candidates.length > 0) {
      const nowChoice = formatChoice();
      if (nowChoice.source === 'locator' && formatKeyOf(nowChoice) !== boundFormatKey) {
        // 포맷이 바뀐 재락은 «다른 코드» 다 — 되살릴 여지가 없으므로 선반도 같이 버린다.
        retireShelf();
        bind(lockedN);
      }
    }
    // 선반은 오래 못 간다 — 확인 창을 넘기면 「그 n 은 안 돌아온다」로 읽고 버린다.
    if (shelf !== null && shelf.age > BIND_N_CONFIRM_FRAMES) retireShelf();
    if (candidates.length === 0) return null;

    // R2 — 락이 살아 있는 동안은 인내 카운터가 0 이다.
    if (stats.locked) framesWithoutLock = 0;
    else framesWithoutLock += 1;
    let decodeMs = 0;
    let hardDrops = retired.hardDrops;
    let coastFrames = retired.coastFrames;
    let decodeAttempts = retired.decodeAttempts;
    let decodeFailures = retired.decodeFailures;
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
        if (candidate.hud) {
          candidate.hud.alive = false;
          candidate.hud.tracking = false;
          candidate.hud.retained = true;
          candidate.hud.revision += 1;
        }
        if (entry) entry.alive = false;
        continue;
      }
      const cc = candidate.session.counters;
      if (cc) {
        hardDrops += cc.hardDrops;
        coastFrames += cc.coastFrames;
        decodeAttempts += cc.decodeAttempts;
        decodeFailures += cc.decodeFailures;
      }
      if (candidate.session.frameMs) decodeMs += candidate.session.frameMs.decode;
      const d = result.progress && Number.isFinite(result.progress.D) ? result.progress.D : 0;
      if (entry) { entry.D = d; entry.indicator = result.indicator; entry.alive = true; }
      if (d > bestD) {
        bestD = d;
        bestIndicator = result.indicator;
        leading = candidate;
      }
      if (result.indicator !== R2_INDICATOR.DONE) {
        updateHudCandidate(candidate, result, luma);
        continue;
      }
      let text = null;
      try {
        text = unframe(Uint8Array.from(result.payload.slice(0, result.payloadLength))).text;
      } catch {
        /*
         * 프레이밍이 막았다 — 이 후보는 이번 프레임에 답이 아니다.
         * 🔴 「세션은 살려 둔다」가 **거짓이었다** (R3c 결함 8): RS 가 선 순간 세션은
         * `complete = 1` 이라 이후 `pushFrame` 이 즉시 반환한다 — 같은 payload 를 되돌릴 뿐
         * 누적하지 않는다. n=13 은 후보 1개라 그 순간 R2 가 `reset()` 까지 죽었다.
         * `rejectPayload()` 가 `complete` 만 되돌린다 (증거·셀맵·개정은 유지).
         */
        if (typeof candidate.session.rejectPayload === 'function') candidate.session.rejectPayload();
        // RS의 DONE을 프레이밍이 거부했다. feed에는 scanner가 수용하지 않은 성공을 내보내지 않는다.
        updateHudCandidate(candidate, candidate.session.result, luma);
        continue;
      }
      // scanner framing까지 수용된 뒤에만 HUD 행이 DONE이 된다.
      updateHudCandidate(candidate, result, luma);
      stats.doneLayoutId = candidate.layoutId;
      stats.doneFrame = stats.frames - 1;
      stats.text = text;
      // 적중 프레임에도 카운터를 낸다 — 안 그러면 「무엇이 몇 번 있었나」가 DONE 직전
      // 프레임 값으로 얼어붙어, 결과 카드가 읽는 수가 한 프레임 묵는다.
      stats.counters.hardDrops = hardDrops;
      stats.counters.coastFrames = coastFrames;
      stats.counters.decodeAttempts = decodeAttempts;
      stats.counters.decodeFailures = decodeFailures;
      stats.counters.lockClears = adapters.stats.counters ? adapters.stats.counters.lockClears : 0;
      stats.counters.relocates = adapters.stats.counters ? adapters.stats.counters.relocates : 0;
      noteLockTrust();
      if (adapters.stats.phaseMs) {
        stats.phaseMs.detect = adapters.stats.phaseMs.detect;
        stats.phaseMs.align = adapters.stats.phaseMs.align;
      } else {
        stats.phaseMs.align = 0;
      }
      stats.phaseMs.decode = decodeMs;
      /*
       * 🔴 **정정 심볼 → 스캔 순서 셀** (3b). DONE 프레임에서 **한 번** 편다 — 프레임 경로가
       * 아니다. 규칙은 `r2/corrections.js` 한 곳이고(소거 셀맵과 같은 식) 여기서 다시 세지 않는다.
       * 스크래치는 런타임이 들고 있다가 필요한 만큼만 키운다; 적중은 그 앞부분을 가리키는
       * 뷰라 소비자가 `correctedCells.length` 로 곧장 순회할 수 있다.
       */
      // 매핑 불가(-1)면 `cells` 가 비고 `count` 는 남는다 — **수는 맞고 자리는 모른다**.
      correctedCellsForHit(candidate.session.result, candidate.session.layout, correctedHolder);
      // 적중 표면은 순수 함수가 만든다 — 세대 칸이 「지금 묶은 세대」에서 온다는 것을 자가 값으로 잰다.
      return buildR2Hit(stats, {
        text,
        layoutId: candidate.layoutId,
        candidateId: candidate.hud.id,
        n: boundN,
        correctedCount: correctedHolder.count,
        correctedCells: correctedHolder.cells,
      });
    }

    stats.progressD = bestD < 0 ? 0 : bestD;
    stats.indicator = leading === null ? R2_INDICATOR.SEARCHING : bestIndicator;
    stats.leadingLayoutId = leading === null ? '' : leading.layoutId;
    stats.counters.hardDrops = hardDrops;
    stats.counters.coastFrames = coastFrames;
    stats.counters.decodeAttempts = decodeAttempts;
    stats.counters.decodeFailures = decodeFailures;
    stats.counters.lockClears = adapters.stats.counters ? adapters.stats.counters.lockClears : 0;
    stats.counters.relocates = adapters.stats.counters ? adapters.stats.counters.relocates : 0;
    noteLockTrust();
    if (adapters.stats.phaseMs) {
      stats.phaseMs.detect = adapters.stats.phaseMs.detect;
      stats.phaseMs.align = adapters.stats.phaseMs.align;
    } else {
      stats.phaseMs.align = 0;
    }
    stats.phaseMs.decode = decodeMs;

    // 표시용 뷰 갱신 — 선두 후보의 셀맵(참조) + 어댑터가 사영한 셀 중심.
    if (leading !== null) {
      const cellCount = leading.session.layout.cellCount;
      // R5 — 선두 후보의 **자기 스캔순서**로 사영해야 HUD 가 그 후보의 셀맵과 맞는다.
      const mapped = adapters.projectCellFaceCentres(centres, cellCount, leading.layoutId);
      view.cellMap = leading.session.result.progress.cellMap;
      view.cellFaceCentres = centres;
      view.cellCount = mapped > 0 ? cellCount : 0;
      view.H = adapters.H;
      view.n = boundN;
      view.lockRevision = adapters.stats.lockRevision;
      view.lockKey = (view.lockRevision * 1000) + stats.bindRevision;
      view.bindRevision = stats.bindRevision;
      view.frameWidth = luma.width;
      view.frameHeight = luma.height;
      view.layoutId = leading.layoutId;
      // 빚 3 — 격자를 만들 세대. layoutId 와 **같은 자리**에서 실어야 HUD 가 둘을 한 프레임의 것으로 읽는다.
      view.formatWire = stats.format.formatWire;
    }

    /*
     * R2 — **락이 없는 채로** 오래 버티면 접는다. 락이 살아 있으면 위에서 0 으로
     * 리셋됐으므로 여기 안 걸린다. 접고 나면 다음 락에서 새 bind 가 온다.
     */
    if (framesWithoutLock > CANDIDATE_PATIENCE_FRAMES) disposeAll();
    return null;
  }

  function reset() {
    if (adapters !== null) adapters.reset();
    currentLockValid = false;
    disposeAll();
    lastAt = -Infinity;
    stats.frames = 0;
    stats.progressD = 0;
    stats.indicator = 0;
    stats.doneLayoutId = '';
    stats.doneFrame = -1;
    stats.text = null;
    stats.counters.hardDrops = 0;
    stats.counters.coastFrames = 0;
    stats.counters.lockClears = 0;
    stats.counters.relocates = 0;
    stats.counters.binds = 0;
    stats.counters.decodeAttempts = 0;
    stats.counters.decodeFailures = 0;
    retired.hardDrops = 0;
    retired.coastFrames = 0;
    retired.decodeAttempts = 0;
    retired.decodeFailures = 0;
    stats.format.source = 'default';
    stats.format.eccName = '';
    stats.format.maskIndex = 0;
    stats.format.candidateCount = 0;
    stats.format.formatWire = resolveFormatWire(undefined);
    stats.phaseMs.detect = 0;
    stats.phaseMs.align = 0;
    stats.phaseMs.decode = 0;
    // 3d — 락이 없어졌으니 마진도 «미측정» 이다 (거짓 0 금지 · 어댑터 reset 과 같은 뜻).
    stats.lockMargin = NaN;
    stats.lockDistrusted = false;
  }

  /**
   * R1(d) — **락만** 푼다. 세션·증거·후보는 그대로다 (레인 H 는 줌 커밋에서 이걸 부르고,
   * 수동 리셋에서는 `reset()` 을 부른다).
   *
   * 🔴 왜 두 문이 갈려야 하나: 줌은 「좌표계가 바뀌었다」이지 「다른 코드다」가 아니다.
   * 여기서 `reset()` 을 부르면 운영자 요구 ③ 「읽은 데이터를 버리지 말라」를 정면으로 어긴다.
   * 락이 풀리면 다음 프레임에 로케이터가 새 H 를 세우고, n 이 같으면 bind 도 유지된다.
   */
  function invalidateLock() {
    if (adapters === null) return 0;
    const cleared = typeof adapters.invalidateLock === 'function'
      ? adapters.invalidateLock() : 0;
    if (cleared) {
      currentLockValid = false;
      markActiveHudNotTracking();
      stats.locked = 0;
      stats.lockedN = 0;
      stats.layoutIdLocked = '';
      // 3d — 락과 함께 그 락의 신뢰 판정도 사라진다 (어댑터 clearLock 이 이미 되돌렸다).
      noteLockTrust();
      view.lockRevision = adapters.stats.lockRevision;
      view.lockKey = (view.lockRevision * 1000) + stats.bindRevision;
    }
    return cleared;
  }

  function setEnabled(next) {
    const flag = next === true;
    if (flag === enabled) return;
    enabled = flag;
    currentLockValid = false;
    // 켜든 끄든 누적을 버린다 — 전환 전 증거가 전환 후 답에 섞이면 A/B 가 오염된다.
    disposeAll();
    lastAt = -Infinity;
  }

  function setCandidateReservation(callback) {
    if (callback !== null && typeof callback !== 'function') {
      throw new TypeError('후보 예약은 함수 또는 null이어야 해요');
    }
    if (callback) callback(candidates.length);
    reserveCandidates = callback;
  }

  return {
    get enabled() { return enabled; },
    setEnabled,
    setCandidateReservation,
    pushFrame,
    reset,
    invalidateLock,
    get hudCandidates() { return hudCandidates(); },
    stats,
    view,
  };
}

/**
 * 🔴 **DONE 적중의 표면** (빚 3 · 3b 검토 F2). 한 자리에서 만든다.
 *
 * 여기 있는 이유는 `formatWire` 한 칸 때문이다 — 그 값은 「이 셀 번호들이 **어느 세대의 스캔
 * 순서** 안의 번호인가」이고, `stats.format`(런타임이 **지금 묶은** 세대)에서만 와야 한다.
 * 상수를 적으면 레거시 프레임에서 정정 강조 래치가 다른 세대를 붙잡고, 소비자
 * (`hudCorrectionGridOk`)가 「격자와 어긋난다」고 판정해 강조가 통째로 꺼진다 — 코퍼스가
 * 전부 세대 2 라 끝단 자에 안 걸리는 종류의 침묵이다. 순수 함수로 빼 두면 자가 «세대 1 을
 * 묶은 stats» 를 넣어 **값으로** 확인한다.
 *
 * ⚠ 이 함수가 닫는 것은 **유도**뿐이다. 「세대 1 로 DONE 까지 가는 실물·합성 프레임」은
 * 여전히 없다 (보고서 §6.1 — 레거시 인코더 미보유).
 *
 * @param {{doneFrame:number, format:{formatWire:number}}} stats 런타임 표면 (읽기만 한다)
 * @param {{text:string, layoutId:string, candidateId?:string, n:number, correctedCount:number,
 *          correctedCells:ArrayLike<number>}} parts 이 프레임이 만든 값
 */
export function buildR2Hit(stats, parts) {
  const hit = {
    text: parts.text,
    layoutId: parts.layoutId,
    n: parts.n,
    frame: stats.doneFrame,
    correctedCount: parts.correctedCount,
    correctedCells: parts.correctedCells,
    // 빚 3 — 정정 강조 래치가 이 값을 같이 붙잡아야 유예 창 중 세대가 바뀐 재bind 가 와도
    // 「다른 세대의 격자에 옛 셀 번호」를 안 찍는다.
    formatWire: stats.format.formatWire,
  };
  // 공급한 호출만 새 식별자를 받는다. 미공급 호출의 기존 exact shape는 그대로다.
  if (typeof parts.candidateId === 'string') hit.candidateId = parts.candidateId;
  return hit;
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
    // 3b — 결과 카드용은 **수** 하나다. 셀 목록은 HUD 의 몫이라 문을 지나가지 않는다.
    r2Corrected: Number.isInteger(hit.correctedCount) && hit.correctedCount > 0 ? hit.correctedCount : 0,
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
