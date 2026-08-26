/**
 * scan-steady.js — 「안정 유지」 추적기 (운영자 요청 2026-08-16).
 *
 * 목적: 손떨림 허용 범위 안에서 **같은 뷰가 1.5초 이상 유지**되면 「사용자가 코드를
 * 가이드에 어느 정도 맞췄다」 고 전제할 수 있다. 그 전제가 서는 순간에만 가이드-사전
 * (prior) 포즈 스캔을 발동한다 (`scan-guide-prior.js` · `decoder/bootstrap.js`).
 *
 * ## 왜 시각 신호가 기본이고 센서가 보조인가 (결합 방식의 근거)
 *
 * 두 신호는 **틀리는 방향이 반대**다.
 *
 *   · 시각(다운샘플 luma 프레임 차)은 «화면에 보이는 것» 을 직접 잰다. 하지만 표본이
 *     드문드문하다 — 프레임 루프가 «복호가 끝난 뒤에만» 다음 표본을 뜨기 때문이다
 *     (아래 「표본 주기」 참조). 그 사이에 일어난 빠른 패닝은 **에일리어싱**으로
 *     «비슷한 두 장» 이 될 수 있다 (특히 배경이 단조로울 때).
 *   · 센서(DeviceMotion rotationRate/accel)는 60Hz 급이라 그 빠른 움직임을 놓치지
 *     않는다. 반대로 센서가 조용하다는 것은 «뷰가 안정» 의 증거가 **못 된다** —
 *     평행 이동, 피사체 이동, 오토포커스 헌팅, 노출 재조정은 자이로에 안 잡힌다.
 *
 * 그래서 결합은 비대칭이다: **센서는 거부권만 갖는다(veto-only)**. 안정 판정은 시각이
 * 단독으로 내리고, 센서는 «지금 확실히 움직였다» 를 보태 조기 리셋만 한다.
 *   → 센서 부재·권한 거부 = veto 가 영원히 발동하지 않음 = **시각 단독 동작과 완전히 동일**.
 *     (기능 저하가 «없다» 가 아니라, 구조상 없을 수밖에 없다. 테스트가 이 동치를
 *      마지막 스냅샷이 아니라 **전 프레임 전 필드 시퀀스**로 단언한다.)
 *
 * ⚠ 센서는 **상시 켜져 있는 것이 아니다.** iOS 는 `DeviceMotionEvent.requestPermission()`
 *   이 사용자 제스처 게이트라, 카메라 권한이 이미 허용돼 **제스처 없이 자동 시작**되는
 *   경로(스캐너의 주 동선)에서는 부착이 다음 제스처까지 미뤄진다. 부착 실패·지연은
 *   기능 저하가 아니라 위 동치에 따른 정상 경로이고, 상태는 lab 오버레이가 그대로 찍는다
 *   (`motionAttachPlan()` · `sites/tlscan/scanner.js`).
 *
 * ## 표본 주기 (1.5초의 실제 의미)
 * 프레임 루프는 직전 전체 프레임 비용과 100ms 하한 중 큰 값을 다음 시작 간격으로 쓴다.
 * 즉 **실 주기 = max(100ms, 직전·현재 프레임 비용)** 이고, 복호는 프레임당 수십
 * ms\~수 초까지 간다. 그래서 `heldMs` 를 표본 간격 그대로 누적하면 «표본 두 장이
 * 1600ms 떨어져 있다» 만으로 1.5초 유지가 성립해 버린다 — 실측으로 재현되던 구멍이다.
 * `STEADY_SAMPLE_MS_CAP` 이 그 구멍을 막는다.
 *
 * ## 결정성
 * 이 모듈은 시계를 읽지 않는다. 모든 시각(time)은 호출자가 주입한다 —
 * `observeFrame({ timeMs })` · `observeMotion({ timeMs })`. Node 단위 테스트에서 임의의
 * 시퀀스를 그대로 재생할 수 있다.
 */

/** 「같은 뷰가 유지됐다」 로 인정하는 최소 시간(ms). 운영자 지정. */
export const STEADY_HOLD_MS = 1500;

/**
 * **표본 하나가 유지 시간에 기여할 수 있는 상한(ms).**
 *
 * 왜 필요한가 (실측으로 재현된 구멍): `heldMs += elapsed` 에 상한이 없으면 표본 **두 장**
 * 이 1600ms 떨어져 있는 것만으로 `armed` 가 선다. 그리고 그 간격은 흔하다 — 표본 주기가
 * 복호 시간에 묶여 있는데(위 「표본 주기」), 트리거가 의미 있는 구간이 바로 «연속 스캔이
 * 계속 실패 중» = 복호가 가장 오래 걸리는 구간이기 때문이다. 즉 보완이 가장 필요한
 * 자리에서 근거가 가장 얇아진다.
 *
 * **왜 캡이고 「최소 표본 수」 가 아닌가 — 캡이 두 성질을 동시에 준다.**
 *   ① 캡한 값은 실제 경과 시간보다 절대 크지 않으므로 `heldMs ≥ 1500` 이면 **벽시계로도
 *      1.5초 이상**이 반드시 흘렀다. 즉 「1.5초 유지」 의 뜻이 약해지지 않는다(엄격해질 뿐).
 *   ② 동시에 최소 비교 횟수가 강제된다: ⌈1500/640⌉ = **3회 비교(프레임 4장)**.
 *      표본 2장으로는 어떤 간격이어도 1500 을 못 채운다.
 *   최소 표본 수만 요구하면 ①이 안 나오고(간격이 짧으면 벽시계 1.5초가 안 채워질 수 있다),
 *   캡만으로 둘 다 나오므로 캡을 택했다.
 *
 * 640ms 는 느린 복호 구간에서 표본 두 장만으로 1.5초가 성립하던 사고를 막은 기존 증거
 * 상한이다. 100ms 최속 경로에서는 걸리지 않고, 프레임 비용이 커져 표본이 드물어진
 * 구간에서만 보수적으로 유지 시간을 덜 센다.
 */
export const STEADY_SAMPLE_MS_CAP = 640;

/** 안정 서명 격자 한 변 (grid×grid 블록 평균). */
export const STEADY_GRID = 12;

/**
 * 서명을 만들 때 프레임에서 건너뛰며 읽는 픽셀 간격.
 *
 * 960² 전수는 92만 픽셀이라 매 프레임 도는 것이 아깝다. stride 4 면 240×240 = 5.76만
 * 표본으로 블록마다 400 표본이 들어간다 — 블록 평균의 표준오차가 표본 잡음의 1/20 이라
 * 손떨림 신호(블록당 수 %)에 비해 무시할 수준이고, 비용은 1/16 이다.
 */
export const STEADY_SAMPLE_STRIDE = 4;

/**
 * 서명 정규화의 표준편차 하한. 거의 균일한 프레임(렌즈 가림·백색 벽)에서 정규화가
 * 잡음을 무한 증폭하는 것을 막는다. luma 는 0..1 스케일이다.
 */
export const STEADY_CONTRAST_FLOOR = 0.02;

/**
 * 손떨림 톨러런스 — **직전 프레임 대비** 정규화 서명 평균절대차(MAD)의 상한. **0 이 아니다.**
 *
 * 산정 (`tools/probes/probe-steady-tolerance.mjs`, O-k6 · 셀 12.96px · 960² 프레임):
 *
 *   교란                       MAD        판정 요구
 *   ─────────────────────────  ─────────  ─────────────────────────────
 *   센서 잡음 ±4/255           0.0038     안정 (아니면 트리거가 안 걸린다)
 *   노출 ×1.10                 0.0046     안정 (정규화가 흡수해야 한다)
 *   회전 4°                    0.0110     ─
 *   이동 4px (0.31 셀)         0.0135     안정
 *   이동 6px (0.46 셀)         0.0207     ─ (경계)
 *   이동 8px (0.62 셀)         0.0260     움직임 (사전 포획 봉투 밖)
 *   이동 16px (1.24 셀)        0.0526     움직임
 *
 * 0.020 은 「4px 는 안정 · 8px 는 움직임」 사이에 있고, 잡음·노출 항(≤0.005)의 4배라
 * 실기기 잡음이 실측의 4배여도 트리거가 살아 있다.
 *
 * (구 값 0.055 는 이동 16px 까지 「안정」 으로 통과시켰다 — 사전 포즈가 절대 못 따라가는
 *  범위다. 실측 없이 고른 값이 정확히 그렇게 틀렸다.)
 */
export const STEADY_VISUAL_TOLERANCE = 0.020;

/**
 * **유지 시작 시점의 서명(anchor) 대비** 누적 드리프트 상한.
 *
 * 왜 프레임 간 상한만으로는 부족한가 (예시는 설계 주기 320ms 기준 — 실 주기가 복호로
 * 늘어나면 표본당 이동 허용량도 같이 늘어나 이 서술은 보수 쪽으로만 어긋난다):
 * 프레임 주기 320ms 에 매번 4px 씩 **같은 방향으로**
 * 밀리면 프레임 간 판정은 계속 「안정」 인데 1.5초 뒤에는 20px 가 어긋나 있다. 사전 포즈의
 * 포획 봉투(실측 0.5\~0.8 셀 ≈ 4\~8px)를 이미 벗어난 자리다.
 *
 * 0.028 은 위 표에서 이동 8px(0.62 셀) 자리 — **축 방향** 봉투의 가장자리다. 즉 「유지 중
 * 누적 드리프트가 사전이 흡수할 수 있는 범위를 넘으면 유지를 끊는다」 가 수치의 뜻이다.
 *
 * ⚠ 정정 (2026-08-16 적대 검증): 그 등식은 **축 위에서만** 정확하다. 1단계 오프셋 사다리가
 *   십자(cross)뿐이라 **대각 봉투가 축보다 반지름 기준 약 12% 좁다** (실측: O-k6 축
 *   9px = 0.69 셀 vs 대각 (5,5) = 7.07px = 0.55 셀). 대각으로 흐르면 「유지는 살아 있는데
 *   사전이 못 잡는」 구간이 생긴다 — 결함이 아니라 **안전 실패**(연속 경로가 계속 돈다)
 *   이지만, 「유지됨 ≡ 흡수 가능」 을 무조건으로 쓰면 거짓이 된다.
 *   봉투 표 정본: `test/output/claude-steady-scan.md` §2.
 */
export const STEADY_ANCHOR_TOLERANCE = 0.028;

/**
 * 센서 거부 임계 — 자이로 각속도 크기(deg/s). 이 이상이면 「확실히 움직였다」.
 * 정지 파지의 미세 떨림은 대략 1\~3 deg/s 범위이므로 그 위에 둔다.
 *
 * `rotationRate` 가 없는 브라우저에서는 중력 벡터 차분에서 유도한 각속도(아래
 * `gravityAngularRate`)를 **같은 임계**로 잰다 — 두 값이 같은 물리량이기 때문이다.
 */
export const STEADY_ROTATION_RATE_LIMIT = 12;

/**
 * 센서 거부 임계 — **선형** 가속 크기(m/s²). 이 채널만 순수 평행이동을 본다.
 * (`acceleration` = 중력 제거된 값. 주지 않는 브라우저에서는 이 채널이 기권한다.)
 */
export const STEADY_ACCELERATION_LIMIT = 1.6;

/** 중력 벡터 차분에서 각도를 뽑을 때 쓰는 중력 크기(m/s²). */
const GRAVITY_MAGNITUDE = 9.80665;

/**
 * 중력 차분에서 각속도를 유도할 때 유효한 표본 간격(ms) 범위.
 *
 * 아래(4ms)를 두는 이유: Δt 가 0 에 가까우면 유도 각속도가 발산해 **거짓 veto** 가 된다
 * (유지가 영영 안 쌓여 트리거가 죽는다). 위(500ms)를 두는 이유: 그만큼 벌어진 두 표본의
 * 차이는 «그 사이의 최대 각속도» 가 아니라 «누적 결과» 라, 평균으로 나눈 수가 물리량을
 * 대표하지 못한다. 둘 다 **기권**(null)으로 접는다 — 모르는 것을 「움직였다」 로도
 * 「멈췄다」 로도 읽지 않는다.
 */
const GRAVITY_DT_MIN_MS = 4;
const GRAVITY_DT_MAX_MS = 500;

/**
 * 중력 벡터 두 표본의 차 |Δg| 를 **각속도(deg/s)** 로 바꾼다.
 *
 * ⚠ 이 정규화가 없던 구현의 결함(2026-08-16 적대 검증): `|Δg| > 1.6 m/s²` 를 그대로
 *   임계로 쓰면 그것은 가속도가 아니라 **Δ(자세)** 라 표본율에 통째로 의존한다. 같은
 *   1.6 은 60Hz 에서 561 deg/s(자이로 임계의 46.8배) · 3Hz 에서 28 deg/s 로, 실사용
 *   표본율에서는 사실상 발화하지 않는 **죽은 채널**이었다.
 *
 * 기하: 두 중력 벡터 사이 각 θ 는 |Δg| = 2·G·sin(θ/2) 를 만족한다.
 *
 * ⚠ 이 채널이 **구조적으로 못 보는 것**: 자세가 안 변하는 **순수 평행이동**(Δg = 0).
 *   중력 벡터는 방향만 알려 주므로 원리상 불가능하다 — 평행이동은 `acceleration`(선형
 *   가속) 채널이 보고, 그마저 없는 브라우저에서는 **시각 단독**이 맡는다(veto 는 보완이지
 *   요건이 아니다). 이 한계를 「센서가 덮는다」 고 말하면 거짓이 된다.
 *
 * @returns {number|null} deg/s. 간격이 유효 범위 밖이면 기권(null).
 */
export function gravityAngularRate(deltaMagnitude, dtMs) {
  const magnitude = Number(deltaMagnitude);
  const dt = Number(dtMs);
  if (!Number.isFinite(magnitude) || magnitude < 0) return null;
  if (!Number.isFinite(dt) || dt < GRAVITY_DT_MIN_MS || dt > GRAVITY_DT_MAX_MS) return null;
  const sinHalf = Math.min(1, magnitude / (2 * GRAVITY_MAGNITUDE));
  const radians = 2 * Math.asin(sinHalf);
  return ((radians * 180) / Math.PI) / (dt / 1000);
}

/**
 * 센서 거부가 유지되는 시간(ms). 한 번 크게 움직였으면 그 직후 프레임은 모션블러가
 * 남아 있어 시각 서명이 우연히 비슷해질 수 있다 — 그 구간을 통째로 덮는다.
 * 최속 프레임 주기(100ms)보다 길어 최소 한 프레임은 확실히 거른다.
 */
export const STEADY_MOTION_VETO_MS = 400;

/**
 * 유지 중 사전 스캔 재시도 간격(ms). 1.5s 를 채운 뒤에도 계속 들고 있으면 다시 시도한다
 * — 다만 매 프레임 던지면 연속 스캔 경로를 굶긴다. 1.5s 는 「한 번 실패하면 다음 유지
 * 창을 새로 채운 것과 같은 간격」 이라는 뜻이다.
 */
export const STEADY_RETRY_MS = 1500;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 프레임(RGBA)에서 grid×grid **정규화 luma 서명**을 만든다.
 *
 * 정규화(평균 0 · 표준편차 1 로 스케일)는 자동노출·화이트밸런스가 프레임 전체를
 * 밝기 방향으로 밀어도 「움직였다」 로 오판하지 않게 한다. 손떨림은 밝기 오프셋이
 * 아니라 **블록 사이 재배치**로 나타나므로 정규화 뒤에도 그대로 남는다.
 *
 * @param {{width:number,height:number,data:ArrayLike<number>}} frame RGBA 프레임
 * @param {{grid?:number, stride?:number}} [options]
 * @returns {Float32Array|null} 길이 grid² 의 정규화 서명
 */
export function lumaSignature(frame, options = {}) {
  if (!frame) return null;
  const width = Number(frame.width);
  const height = Number(frame.height);
  const data = frame.data;
  if (!(width > 0) || !(height > 0) || !data || data.length < width * height * 4) return null;

  const grid = Number.isInteger(options.grid) && options.grid > 0 ? options.grid : STEADY_GRID;
  const stride = Number.isInteger(options.stride) && options.stride > 0
    ? options.stride
    : STEADY_SAMPLE_STRIDE;

  const sums = new Float64Array(grid * grid);
  const counts = new Uint32Array(grid * grid);
  for (let y = 0; y < height; y += stride) {
    const row = Math.min(grid - 1, Math.floor((y * grid) / height));
    for (let x = 0; x < width; x += stride) {
      const column = Math.min(grid - 1, Math.floor((x * grid) / width));
      const offset = (y * width + x) * 4;
      const value = (0.2126 * data[offset] + 0.7152 * data[offset + 1]
        + 0.0722 * data[offset + 2]) / 255;
      const cell = row * grid + column;
      sums[cell] += value;
      counts[cell] += 1;
    }
  }

  const raw = new Float64Array(grid * grid);
  let total = 0;
  let filled = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (counts[index] === 0) continue;
    raw[index] = sums[index] / counts[index];
    total += raw[index];
    filled += 1;
  }
  if (filled === 0) return null;
  const mean = total / filled;

  let variance = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const delta = raw[index] - mean;
    variance += delta * delta;
  }
  variance /= raw.length;
  const scale = 1 / Math.max(STEADY_CONTRAST_FLOOR, Math.sqrt(variance));

  const signature = new Float32Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    signature[index] = (raw[index] - mean) * scale;
  }
  return signature;
}

/**
 * 두 정규화 서명의 평균절대차. 길이가 다르면 비교하지 않는다(null).
 * @returns {number|null}
 */
export function signatureDistance(left, right) {
  if (!left || !right || left.length === 0 || left.length !== right.length) return null;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += Math.abs(left[index] - right[index]);
  }
  return sum / left.length;
}

/**
 * 자이로/가속도 표본 하나를 「확실히 움직였다」 로 판정할지.
 *
 * 채널은 둘이고, **각각 독립적으로 기권**한다 (값이 없으면 그 축은 판정하지 않는다):
 *
 *   ① 각속도 (deg/s, 임계 `rotationLimit`)
 *        · 우선: `rotationRate` 그대로.
 *        · 자이로가 없으면: 중력 벡터 차분에서 **Δt 로 정규화해** 유도한 각속도
 *          (`gravityAngularRate`). 자이로가 있으면 유도값은 쓰지 않는다 — 같은
 *          물리량을 두 번 재 봐야 잡음만 는다.
 *   ② 선형 가속 (m/s², 임계 `accelerationLimit`) — `acceleration` 이 있을 때만.
 *      **순수 평행이동을 보는 유일한 채널**이다.
 *
 * ⚠ 두 채널 모두 없는 브라우저(중력만 주고 자이로·선형 가속은 null)에서는 평행이동이
 *   센서에 안 잡힌다. 그때는 시각 단독으로 동작한다 — veto 는 보완이지 요건이 아니다.
 *
 * @param {{rotationRate?:object, acceleration?:object,
 *          accelerationIncludingGravity?:object, timeMs?:number}} sample
 * @param {{x:number,y:number,z:number,timeMs:number}|null} previousGravity 직전 중력 표본
 * @param {{rotationLimit?:number, accelerationLimit?:number}} [limits]
 * @returns {{exceeded:boolean, rate:number|null, rateSource:string|null,
 *            accel:number|null, dtMs:number|null}}
 */
export function motionExceedsLimit(sample, previousGravity, limits = {}) {
  const rotationLimit = toFiniteNumber(limits.rotationLimit) ?? STEADY_ROTATION_RATE_LIMIT;
  const accelerationLimit = toFiniteNumber(limits.accelerationLimit) ?? STEADY_ACCELERATION_LIMIT;
  const idle = {
    exceeded: false, rate: null, rateSource: null, accel: null, dtMs: null,
  };
  if (!sample || typeof sample !== 'object') return idle;

  let rate = null;
  let rateSource = null;
  const rotation = sample.rotationRate;
  if (rotation && typeof rotation === 'object'
    && (rotation.alpha != null || rotation.beta != null || rotation.gamma != null)) {
    rate = Math.hypot(
      toFiniteNumber(rotation.alpha) ?? 0,
      toFiniteNumber(rotation.beta) ?? 0,
      toFiniteNumber(rotation.gamma) ?? 0,
    );
    rateSource = 'gyro';
  }

  let accel = null;
  const linear = sample.acceleration;
  if (linear && typeof linear === 'object'
    && (linear.x != null || linear.y != null || linear.z != null)) {
    accel = Math.hypot(
      toFiniteNumber(linear.x) ?? 0,
      toFiniteNumber(linear.y) ?? 0,
      toFiniteNumber(linear.z) ?? 0,
    );
  }

  // 자이로가 없을 때만 중력 차분을 각속도로 환산해 대신 쓴다 (Δt 정규화 필수).
  let dtMs = null;
  if (rate === null && previousGravity) {
    const current = gravityVectorOf(sample);
    if (current) {
      dtMs = toFiniteNumber(sample.timeMs) !== null
        && toFiniteNumber(previousGravity.timeMs) !== null
        ? Number(sample.timeMs) - Number(previousGravity.timeMs)
        : null;
      const magnitude = Math.hypot(
        current.x - previousGravity.x,
        current.y - previousGravity.y,
        current.z - previousGravity.z,
      );
      const derived = gravityAngularRate(magnitude, dtMs);
      if (derived !== null) {
        rate = derived;
        rateSource = 'gravity';
      }
    }
  }

  const exceeded = (rate !== null && rate > rotationLimit)
    || (accel !== null && accel > accelerationLimit);
  return { exceeded, rate, rateSource, accel, dtMs };
}

function gravityVectorOf(sample) {
  const withGravity = sample && sample.accelerationIncludingGravity;
  if (!withGravity || typeof withGravity !== 'object') return null;
  if (withGravity.x == null && withGravity.y == null && withGravity.z == null) return null;
  return {
    x: toFiniteNumber(withGravity.x) ?? 0,
    y: toFiniteNumber(withGravity.y) ?? 0,
    z: toFiniteNumber(withGravity.z) ?? 0,
  };
}

/** 표본이 실제로 쓸 값을 하나라도 담고 있나 (전 필드 null 인 이벤트를 「센서 살아 있음」 으로 읽지 않기 위해). */
function motionSampleHasData(sample) {
  if (!sample || typeof sample !== 'object') return false;
  for (const key of ['rotationRate', 'acceleration', 'accelerationIncludingGravity']) {
    const field = sample[key];
    if (!field || typeof field !== 'object') continue;
    if (key === 'rotationRate') {
      if (field.alpha != null || field.beta != null || field.gamma != null) return true;
    } else if (field.x != null || field.y != null || field.z != null) return true;
  }
  return false;
}

/**
 * 안정 유지 추적기.
 *
 * @param {{
 *   holdMs?: number,
 *   tolerance?: number,
 *   retryMs?: number,
 *   motionVetoMs?: number,
 *   rotationLimit?: number,
 *   accelerationLimit?: number,
 *   grid?: number,
 *   stride?: number,
 * }} [options]
 */
export function createSteadyTracker(options = {}) {
  const holdMs = toFiniteNumber(options.holdMs) ?? STEADY_HOLD_MS;
  const sampleCapMs = toFiniteNumber(options.sampleCapMs) ?? STEADY_SAMPLE_MS_CAP;
  const tolerance = toFiniteNumber(options.tolerance) ?? STEADY_VISUAL_TOLERANCE;
  const anchorTolerance = toFiniteNumber(options.anchorTolerance) ?? STEADY_ANCHOR_TOLERANCE;
  const retryMs = toFiniteNumber(options.retryMs) ?? STEADY_RETRY_MS;
  const motionVetoMs = toFiniteNumber(options.motionVetoMs) ?? STEADY_MOTION_VETO_MS;
  const rotationLimit = toFiniteNumber(options.rotationLimit) ?? STEADY_ROTATION_RATE_LIMIT;
  const accelerationLimit = toFiniteNumber(options.accelerationLimit)
    ?? STEADY_ACCELERATION_LIMIT;
  const signatureOptions = { grid: options.grid, stride: options.stride };

  let lastSignature = null;
  let anchorSignature = null;
  let lastFrameAt = null;
  let heldMs = 0;
  let lastDelta = null;
  let lastAnchorDelta = null;
  /** 직전 프레임의 판정. `stable` 을 스냅샷에서 다시 계산하면 «끊긴 직후» 프레임에서
   *  heldMs=0 인데 stable=true 로 어긋난다 — 판정은 한 곳(observeFrame)에서만 낸다. */
  let lastStable = false;
  let vetoUntil = -Infinity;
  let lastTriggerAt = null;
  let triggerCount = 0;
  let sensorSampleCount = 0;
  let sensorDataCount = 0;
  let sensorVetoCount = 0;
  let lastGravity = null;
  let lastMotionRate = null;
  let lastMotionRateSource = null;
  let lastMotionAccel = null;
  /** 지금 유지 창에 기여한 **비교 횟수**. 캡과 함께 「표본 두 장 발동」 을 막는다. */
  let holdSamples = 0;

  function snapshot(atMs) {
    const now = toFiniteNumber(atMs);
    const vetoed = now !== null ? now < vetoUntil : false;
    const armed = heldMs >= holdMs && !vetoed;
    const dueForRetry = lastTriggerAt === null
      || (now !== null && now - lastTriggerAt >= retryMs);
    return {
      /** 직전 프레임 대비 서명 거리 (첫 프레임은 null). */
      delta: lastDelta,
      /** 유지 시작 시점(anchor) 대비 누적 드리프트 (유지 중이 아니면 null). */
      anchorDelta: lastAnchorDelta,
      /** 톨러런스. 게이지 표시에 쓴다. */
      tolerance,
      anchorTolerance,
      /** 이번 프레임이 「같은 뷰」 였나 (observeFrame 이 낸 판정 그대로). */
      stable: lastStable && !vetoed,
      /** 연속 유지 시간(ms) — **표본당 `sampleCapMs` 로 캡한 합**이라 벽시계 경과의 하계다. */
      heldMs,
      /** 지금 유지 창을 만든 비교 횟수. armed 가 서려면 최소 ⌈holdMs/sampleCapMs⌉ 회가 든다. */
      holdSamples,
      /** 표본당 기여 상한(ms). lab 게이지가 「왜 아직 안 찼나」 를 말할 수 있게 한다. */
      sampleCapMs,
      /** 0..1 게이지. */
      progress: holdMs > 0 ? Math.min(1, heldMs / holdMs) : 0,
      /** 1.5s 를 채웠나. */
      armed,
      /** 지금 사전 스캔을 던져도 되나 (armed + rate limit). */
      trigger: armed && dueForRetry,
      /** 센서가 지금 거부 중인가. */
      motionVetoed: vetoed,
      /**
       * 센서가 **쓸 값을 담은** 표본을 한 번이라도 줬나.
       * ⚠ 이벤트 수가 아니라 데이터 수다 — 전 필드 null 인 `devicemotion` 을 흘리는
       *   기기가 있고, 그것을 `sensor:on` 으로 읽으면 오버레이가 거짓말을 한다.
       */
      sensorActive: sensorDataCount > 0,
      sensorSampleCount,
      sensorDataCount,
      sensorVetoCount,
      motionRate: lastMotionRate,
      /** 각속도의 출처 — 'gyro' | 'gravity'(Δt 정규화 유도) | null(기권). */
      motionRateSource: lastMotionRateSource,
      motionAccel: lastMotionAccel,
      triggerCount,
    };
  }

  return {
    holdMs,
    sampleCapMs,
    tolerance,
    retryMs,

    /**
     * 프레임 하나를 관측한다. `signature` 를 직접 주면 그것을 쓰고, `frame`(RGBA)을
     * 주면 여기서 서명을 만든다.
     *
     * @param {{ frame?:object, signature?:ArrayLike<number>, timeMs:number }} input
     */
    observeFrame(input = {}) {
      const now = toFiniteNumber(input.timeMs);
      if (now === null) return snapshot(null);

      const signature = input.signature
        ? Float32Array.from(input.signature)
        : lumaSignature(input.frame, signatureOptions);
      if (!signature) {
        // 서명을 못 만들면 안정 근거가 없다 — 유지를 끊는다(조용히 유지하지 않는다).
        lastSignature = null;
        anchorSignature = null;
        lastDelta = null;
        lastAnchorDelta = null;
        lastStable = false;
        heldMs = 0;
        holdSamples = 0;
        lastFrameAt = now;
        return snapshot(now);
      }

      const delta = signatureDistance(lastSignature, signature);
      const anchorDelta = signatureDistance(anchorSignature, signature);
      /*
       * 표본 하나가 기여하는 시간은 `sampleCapMs` 로 **캡한다**. 복호가 루프를 막아
       * 표본이 드물어져도 「1.5초 유지」 가 표본 두 장으로 성립하지 않게 하는 장치다
       * (STEADY_SAMPLE_MS_CAP 주석의 ①②). 캡한 값 ≤ 실제 경과이므로 판정은 항상
       * 실제 시간보다 **보수적**이다.
       */
      const rawElapsed = lastFrameAt === null ? 0 : Math.max(0, now - lastFrameAt);
      const elapsed = Math.min(rawElapsed, sampleCapMs);
      const vetoed = now < vetoUntil;

      const broken = delta === null
        || vetoed
        || delta > tolerance
        || (anchorDelta !== null && anchorDelta > anchorTolerance);
      if (broken) {
        heldMs = 0;
        holdSamples = 0;
        lastStable = false;
        // 새 유지 창의 기준점은 **이번 프레임**이다 — 끊긴 뒤에도 옛 anchor 를 들고
        // 있으면 누적 드리프트가 영영 상한 위에 남아 다시는 유지가 시작되지 않는다.
        anchorSignature = signature;
        lastAnchorDelta = null;
      } else {
        heldMs += elapsed;
        holdSamples += 1;
        lastStable = true;
        lastAnchorDelta = anchorDelta;
      }

      lastSignature = signature;
      lastDelta = delta;
      lastFrameAt = now;
      return snapshot(now);
    },

    /**
     * DeviceMotion 표본. **거부권만** 행사한다 — 안정을 «부여» 하지 않는다.
     * 호출이 한 번도 없으면(센서 부재·권한 거부) 시각 단독 동작과 동일하다.
     */
    observeMotion(input = {}) {
      const now = toFiniteNumber(input.timeMs);
      if (now === null) return snapshot(null);
      sensorSampleCount += 1;
      if (motionSampleHasData(input)) sensorDataCount += 1;
      const verdict = motionExceedsLimit({ ...input, timeMs: now }, lastGravity, {
        rotationLimit,
        accelerationLimit,
      });
      const gravity = gravityVectorOf(input);
      if (gravity) lastGravity = { ...gravity, timeMs: now };
      lastMotionRate = verdict.rate;
      lastMotionRateSource = verdict.rateSource;
      lastMotionAccel = verdict.accel;
      if (verdict.exceeded) {
        sensorVetoCount += 1;
        vetoUntil = now + motionVetoMs;
        heldMs = 0;
        holdSamples = 0;
      }
      return snapshot(now);
    },

    /** 사전 스캔을 실제로 던졌다고 기록한다 (rate limit 기준점). */
    markTriggered(timeMs) {
      const now = toFiniteNumber(timeMs);
      if (now === null) return snapshot(null);
      lastTriggerAt = now;
      triggerCount += 1;
      return snapshot(now);
    },

    /** 카메라 재시작·결과 표시 등 수명주기 경계에서 전부 초기화한다. */
    reset() {
      lastSignature = null;
      anchorSignature = null;
      lastFrameAt = null;
      heldMs = 0;
      holdSamples = 0;
      lastDelta = null;
      lastAnchorDelta = null;
      lastStable = false;
      vetoUntil = -Infinity;
      lastTriggerAt = null;
      triggerCount = 0;
      sensorSampleCount = 0;
      sensorDataCount = 0;
      sensorVetoCount = 0;
      lastGravity = null;
      lastMotionRate = null;
      lastMotionRateSource = null;
      lastMotionAccel = null;
      return snapshot(null);
    },

    snapshot(timeMs) {
      return snapshot(toFiniteNumber(timeMs));
    },
  };
}

/**
 * 이 브라우저의 DeviceMotion 게이트 종류.
 *
 *   'unsupported'      — DeviceMotionEvent 자체가 없다 (데스크톱 다수).
 *   'no-gate'          — 권한 API 가 없다 (Android Chrome 등). 리스너를 그냥 붙이면 된다.
 *   'gesture-required' — iOS 계열. `requestPermission()` 을 **제스처 안에서** 불러야 한다.
 *
 * @param {object} [scope] window (테스트에서 대역 주입)
 * @returns {'unsupported'|'no-gate'|'gesture-required'}
 */
export function motionGateKind(scope) {
  const view = scope || (typeof globalThis === 'undefined' ? null : globalThis);
  const ctor = view && view.DeviceMotionEvent;
  if (!ctor) return 'unsupported';
  if (typeof ctor.requestPermission !== 'function') return 'no-gate';
  return 'gesture-required';
}

/**
 * 「지금 이 호출에서 센서를 붙일 수 있나」 의 **순수** 판정.
 *
 * 왜 함수로 뽑았나 (2026-08-16 적대 검증 F2): 기존 배선은 `attachMotionAssist()` 를
 * **스캔 시작 버튼 클릭 한 곳**에서만 불렀다. 그런데 스캐너의 주 동선은 「카메라 권한이
 * 이미 허용된 아이폰 → 페이지 로드 → 자동 시작」 이라 그 버튼을 거치지 않는다. 결과적으로
 * 센서가 **가장 중요한 기기에서 영원히 off** 였고, 문서는 `sensor:on` 을 정상 상태로
 * 서술하고 있었다. 판정을 순수 함수로 꺼내 두면 테스트가 경로별 결론을 직접 단언할 수 있다.
 *
 *   attach — 지금 붙인다 (게이트 없음, 또는 제스처 안이라 권한 요청이 통한다).
 *   defer  — 제스처가 필요한데 지금은 제스처 밖이다. **다음 제스처 기회로 미룬다.**
 *            (제스처 밖에서 `requestPermission()` 을 부르면 거부로 소진될 뿐이다.)
 *   skip   — 센서가 없는 브라우저. 시각 단독으로 간다.
 *
 * @param {{scope?:object, userGesture?:boolean}} [options]
 * @returns {{action:'attach'|'defer'|'skip', gate:string, needsPermission:boolean}}
 */
export function motionAttachPlan(options = {}) {
  const gate = motionGateKind(options.scope);
  if (gate === 'unsupported') return { action: 'skip', gate, needsPermission: false };
  if (gate === 'no-gate') return { action: 'attach', gate, needsPermission: false };
  if (options.userGesture) return { action: 'attach', gate, needsPermission: true };
  return { action: 'defer', gate, needsPermission: true };
}

/**
 * iOS 의 `DeviceMotionEvent.requestPermission()` 은 **사용자 제스처 안에서만** 통한다.
 * 그래서 호출자는 `motionAttachPlan()` 이 `action:'attach'` 를 준 경우에만 이것을 부르고,
 * 제스처 밖(`defer`)에서는 다음 제스처까지 미룬다. 거부·미지원·예외는 전부 `false` 로 접어
 * 호출자가 갈래를 만들지 않게 한다 — 실패해도 시각 단독으로 완전히 동작하므로
 * 「센서 없음」 은 오류가 아니라 정상 경로다.
 *
 * @param {object} [scope] window (테스트에서 대역 주입)
 * @returns {Promise<{granted:boolean, reason:string}>}
 */
export async function requestMotionPermission(scope) {
  const view = scope || (typeof globalThis === 'undefined' ? null : globalThis);
  const gate = motionGateKind(view);
  if (gate === 'unsupported') return { granted: false, reason: 'unsupported' };
  // Android Chrome 등 — 게이트 자체가 없다. 리스너를 그냥 붙이면 된다.
  if (gate === 'no-gate') return { granted: true, reason: 'no-gate' };
  const ctor = view.DeviceMotionEvent;
  try {
    const state = await ctor.requestPermission();
    return { granted: state === 'granted', reason: String(state) };
  } catch (error) {
    return { granted: false, reason: 'threw:' + ((error && error.name) || 'unknown') };
  }
}
