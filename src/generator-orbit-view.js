/**
 * generator-orbit-view.js — Y 3D 미리보기 «궤도 자세» 축의 **선언 정본**.
 *
 * ─ 왜 생겼나 (운영자 지시 2026-09-07 21:0x KST) ──────────────────────────────
 * 「8개 자세 x 2 배경 해서 16개 프리셋 카드를 만들어줘야겠네」.
 *
 * 그 앞의 합의(`GUIDE_3d-shoot-32.md` §1): **자세 8은 카메라가 아니라 «렌더의 궤도
 * 회전»** 이다. 인쇄물을 비스듬히 찍으면 큐브 세 면이 여전히 한 평면에 있어 단일 H
 * 로 전부 설명되고, 3D 관측층이 필요해지는 «면별 H» 는 **렌더 자체가 돌았을 때만**
 * 생긴다. ⇒ 촬영 프리셋이 궤도 자세를 세울 수 있어야 한다.
 *
 * ─ 이 모듈이 푸는 문제 (실측) ───────────────────────────────────────────────
 * 궤도 값은 `index.html` 의 `y3dPreview` **모듈 지역 객체**에만 살았다. 그 객체는
 * 선언 주석이 못 박은 대로 「generatorState 가 아니다 — encode/scene 에 새면 안
 * 된다」. 그래서 프리셋(=상태 필드 묶음)이 **닿을 자리가 없었다.**
 *
 * 그냥 «상태를 하나 더 만들고 뷰어가 읽게» 하면 **집이 둘**이 된다 — 드래그는
 * 여전히 `y3dPreview` 에 쓰므로 두 값이 어긋나고, 무엇보다 «드래그로 프리셋을
 * 벗어남» 을 이탈 판정이 구조적으로 못 본다(`shotPresetIdForState` 는 상태만 읽는다).
 * ⇒ **읽기·쓰기를 둘 다 상태로 보낸다** (`defineOrbitViewAccessors`).
 *
 * ─ 단위가 두 벌이라는 것이 이 모듈의 존재 이유다 ────────────────────────────
 *   · **상태**(사람·프리셋·가이드가 쓰는 것) = **도(°)** 와 **노브(0~100)**.
 *     `GUIDE_3d-shoot-32.md` §2 자세 표가 도로 적혀 있고, 카드 라벨도 도로 보인다.
 *   · **뷰어**(`buildOrbitMesh`)가 받는 것 = **라디안** 과 **정규화 t(0~1)**.
 *     실측: 드래그가 `yaw -= dx * 0.01`(라디안) · `Y3D_ROLL_STEP = 3π/180` ·
 *     `perspective: y3dPreview.persp / 100`(index.html §paintY3dPreview).
 * 변환이 두 군데 이상에 흩어지면 그 순간 사본이다. **변환은 여기 한 곳에만 산다.**
 *
 * ⚠ 이 모듈은 `generator-state.js` 도 `y3d-viewer.js` 도 **import 하지 않는다.**
 *   전자는 순환(generator-state 가 이쪽 허용값을 읽는다), 후자는 레인 경계다
 *   (`render3d-parity` 레인이 `src/y3d-viewer.js` 의 렌더 «동작» 을 고치는 중).
 *   이 모듈이 아는 것은 **«어떤 수를 어떤 단위로 넘기는가»** 뿐이다.
 *
 * @module generator-orbit-view
 */

/** 2.5D = 오늘까지의 기본 미리보기 (평행투영 · 궤도 0). */
export const ORBIT_VIEW_25D = '2.5d';
/** 3D = 궤도 회전 + 원근이 켜진 뷰. 촬영 프리셋이 세우는 값. */
export const ORBIT_VIEW_3D = '3d';

/** 상태 필드 `orbitView` 의 허용값 — 손 목록 0(스키마가 이 배열을 그대로 쓴다). */
export const ORBIT_VIEW_CHOICES = Object.freeze([ORBIT_VIEW_25D, ORBIT_VIEW_3D]);

/**
 * 기본은 **2.5D** 다 — 무회귀의 핵심.
 * `index.html` 의 종전 `y3dPreview.on = false` 와 같은 값이고, 원근 노브 0 은
 * `y3d-viewer.js` 가 early return 으로 **정확히 평행투영**임을 보장한다.
 */
export const DEFAULT_ORBIT_VIEW = ORBIT_VIEW_25D;

/** 원근 노브의 상한. UI 슬라이더 `#y3dPersp` 의 `max` 와 같은 수다. */
export const ORBIT_PERSP_KNOB_MAX = 100;

/**
 * 노브 최대에서의 반각 α. `index.html` 의 `Y3D_PERSP_MAX_DEG` 와 같은 수이고,
 * 그쪽 상한의 근거는 `y3d-viewer.js` `BETA_MAX = sin(60°)` 다 (α > 60° 면 근점
 * 코너가 카메라 평면에 닿아 정점이 날아간다).
 *
 * ⇒ **α = (knob / 100) · 60°**. `rot-analysis.md` §0 의 「p9」(= 원근 9°)는
 *   t 0.15 = **노브 15** 다. y2-p9rot 독립 측정치 t ≈ 0.143(α ≈ 8.5°) 의 반올림.
 */
export const ORBIT_PERSP_MAX_DEG = 60;

/** 상태 키 다섯 — «궤도 축이 무엇인가» 의 유일한 목록. */
export const ORBIT_STATE_KEYS = Object.freeze([
  'orbitView', 'orbitYaw', 'orbitPitch', 'orbitRoll', 'orbitPersp',
]);

/** 그중 각도(도) 축 셋. 프리셋 검사·이탈 자가 «수 축» 만 따로 볼 때 쓴다. */
export const ORBIT_ANGLE_STATE_KEYS = Object.freeze(['orbitYaw', 'orbitPitch', 'orbitRoll']);

/**
 * 기본값 — `generator-state.js` 가 이 객체에서 필드를 만든다(손 목록 0).
 * 전부 0 / 2.5D 이므로 **프리셋을 안 고른 화면은 종전과 픽셀 동일**이다.
 */
export const ORBIT_STATE_DEFAULTS = Object.freeze({
  orbitView: DEFAULT_ORBIT_VIEW,
  orbitYaw: 0,
  orbitPitch: 0,
  orbitRoll: 0,
  orbitPersp: 0,
});

/**
 * 선언(프리셋)이 세울 수 있는 범위.
 *
 * ⚠ **런타임 상태를 여기서 자르지 않는다.** 드래그는 오늘도 무한히 돌 수 있고
 *   (`yaw -= dx*0.01` 에 클램프가 없다), 그걸 자르면 조작감이 바뀌는 **무회귀 위반**
 *   이다. 이 상수는 **선언된 프리셋 값**만 검사한다 — 「형제 가드는 상수를 공유해도
 *   일은 다르다」.
 */
export const ORBIT_YAW_ABS_MAX_DEG = 180;
export const ORBIT_PITCH_ABS_MAX_DEG = 90;
export const ORBIT_ROLL_ABS_MAX_DEG = 180;

const DEG_TO_RAD = Math.PI / 180;

/** 도 → 라디안. 뷰어가 받는 단위. */
export function orbitDegToRad(deg) {
  return deg * DEG_TO_RAD;
}

/** 라디안 → 도. 드래그가 상태에 되쓸 때. */
export function orbitRadToDeg(rad) {
  return rad / DEG_TO_RAD;
}

/**
 * 노브(0~100) → 정규화 원근 t(0~1). `buildOrbitMesh({perspective})` 가 받는 값이다.
 *
 * ⚠ **여기가 노브를 t 로 푸는 유일한 자리다.** index.html 이 `persp / 100` 을
 *   따로 들면 그것이 사본이 되고, 상한이 바뀌는 날 한쪽만 늙는다.
 */
export function orbitPerspToT(knob) {
  return knob / ORBIT_PERSP_KNOB_MAX;
}

/** 노브 → 반각 α(도). 화면 표시와 카드 부제가 이걸 쓴다. */
export function orbitPerspToDeg(knob) {
  return orbitPerspToT(knob) * ORBIT_PERSP_MAX_DEG;
}

/** t(0~1) → 노브. 선언이 «t 0.15» 로 말할 때 노브로 되돌린다. */
export function orbitTToPersp(t) {
  return t * ORBIT_PERSP_KNOB_MAX;
}

/**
 * **상태 → 뷰어 입력의 이음매.** 이 함수가 이 모듈의 존재 이유다.
 *
 * `index.html` §paintY3dPreview 와 자(테스트)가 **같은 함수**를 지나 `buildOrbitMesh`
 * 에 닿는다 — 그래서 자가 «렌더 경로의 모형» 이 아니라 **렌더 경로 자체**를 잰다
 * (교훈 「초록 테스트는 동작하는 UI 가 아니다」의 사각을 여기서 좁힌다).
 *
 * @param {object} state 생성기 상태
 * @returns {{on:boolean, yaw:number, pitch:number, roll:number, perspective:number}}
 *   `yaw`·`pitch`·`roll` 은 **라디안**, `perspective` 는 **정규화 t(0~1)**.
 */
export function orbitStateToViewerInput(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('생성기 상태가 필요하다');
  }
  return Object.freeze({
    on: state.orbitView === ORBIT_VIEW_3D,
    yaw: orbitDegToRad(state.orbitYaw),
    pitch: orbitDegToRad(state.orbitPitch),
    roll: orbitDegToRad(state.orbitRoll),
    perspective: orbitPerspToT(state.orbitPersp),
  });
}

/**
 * 상태 스키마에 궤도 축이 실재하는가 — **스키마를 인자로 받는다**(순환 회피).
 * `generator-state.js` 가 로드 시점에 부른다. 어긋나면 그 자리에서 던진다:
 * 조용히 두면 「고르면 3D 로 안 바뀌는」 프리셋이 된다.
 */
export function assertOrbitStateFields(schema) {
  if (schema === null || typeof schema !== 'object') {
    throw new TypeError('생성기 상태 스키마가 필요하다');
  }
  for (const key of ORBIT_STATE_KEYS) {
    if (schema[key] === undefined) {
      throw new Error('생성기 상태에 궤도 축이 없다: ' + key);
    }
  }
  const options = schema.orbitView.options;
  if (options === undefined || options.length !== ORBIT_VIEW_CHOICES.length
    || ORBIT_VIEW_CHOICES.some((v, i) => options[i] !== v)) {
    throw new Error('orbitView 허용값이 선언 유도가 아니다: ' + String(options));
  }
  return true;
}

/**
 * **선언된** 궤도 값이 쓸 만한 수인가 (프리셋 필드 검사).
 *
 * `assertShotPresetFields` 는 «스키마에 있는 키인가 · 허용값 안인가» 를 묻는다.
 * 그런데 궤도 각도 축은 연속값이라 스키마에 `options` 가 **없고**, 그 검사가
 * 원리적으로 아무 말도 못 한다 — 「시스템 자신의 «없음» 출력이 곧 입력이다」.
 * 그 구멍을 여기서 메운다. 대답하는 질문이 다르므로 형제 가드로 나눠 둔다.
 */
export function assertOrbitPresetFields(fields) {
  if (fields === null || typeof fields !== 'object') {
    throw new TypeError('프리셋 필드가 필요하다');
  }
  const bounds = {
    orbitYaw: ORBIT_YAW_ABS_MAX_DEG,
    orbitPitch: ORBIT_PITCH_ABS_MAX_DEG,
    orbitRoll: ORBIT_ROLL_ABS_MAX_DEG,
  };
  for (const [key, limit] of Object.entries(bounds)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    const value = fields[key];
    if (!Number.isFinite(value)) {
      throw new Error('궤도 각 ' + key + ' 가 유한 수가 아니다: ' + String(value));
    }
    if (Math.abs(value) > limit) {
      throw new RangeError('궤도 각 ' + key + ' 가 범위 밖이다: ' + value + ' (|·| ≤ ' + limit + ')');
    }
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'orbitPersp')) {
    const knob = fields.orbitPersp;
    if (!Number.isInteger(knob) || knob < 0 || knob > ORBIT_PERSP_KNOB_MAX) {
      // 정수를 요구하는 이유: 슬라이더가 `step="1"` 이라 정수가 아니면 화면 값과
      // 상태 값이 갈리고, 그 어긋남이 «안 건드렸는데 프리셋 이탈» 로 보인다.
      throw new RangeError('원근 노브가 0~' + ORBIT_PERSP_KNOB_MAX
        + ' 정수가 아니다: ' + String(knob));
    }
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'orbitView')
    && !ORBIT_VIEW_CHOICES.includes(fields.orbitView)) {
    throw new RangeError('orbitView 값이 허용값 밖이다: ' + String(fields.orbitView));
  }
  return true;
}

/**
 * 뷰어 객체(`y3dPreview`)가 들고 있던 다섯 속성 — 접근자가 대신할 이름들.
 * 단위는 **뷰어 쪽**이다 (`yaw`·`pitch`·`roll` = 라디안, `persp` = 노브).
 */
export const ORBIT_VIEWER_PROPS = Object.freeze(['on', 'yaw', 'pitch', 'roll', 'persp']);

/**
 * `y3dPreview` 의 다섯 속성을 **상태로 넘기는 접근자**로 세운다.
 *
 * 왜 접근자인가 — 두 이유가 있고 둘 다 실측이다:
 *   ① 사용처가 ~30곳(드래그 · 리셋 · 슬라이더 · sync · paint)이고 단위가 라디안이다.
 *      전부 고쳐 쓰면 변환이 그만큼 흩어지고, 하나라도 빠지면 「집이 둘」이 된다.
 *   ② 그중 `paintY3dPreview` 의 `buildOrbitMesh({...})` 인자 블록은 **다른 레인
 *      (`render3d-parity`)이 배경·강조를 더하려고 만지는 자리**다. 접근자면 그 블록을
 *      한 줄도 안 건드린다.
 *
 * ⚠ **집이 둘이 되는 것을 로드 시점에 막는다.** 대상 객체가 같은 이름의 자기 속성을
 *   이미 들고 있으면 던진다 — 그 상태로 두면 `defineProperty` 가 조용히 덮어
 *   «값 하나는 살아 있는데 아무도 안 읽는» 유령이 남는다.
 *
 * @param {object} target `y3dPreview` 같은 뷰어 상태 객체
 * @param {object} state 생성기 상태 (**안정된 참조**여야 한다 — 재대입 금지)
 */
export function defineOrbitViewAccessors(target, state) {
  if (target === null || typeof target !== 'object') {
    throw new TypeError('뷰어 상태 객체가 필요하다');
  }
  if (state === null || typeof state !== 'object') {
    throw new TypeError('생성기 상태가 필요하다');
  }
  for (const prop of ORBIT_VIEWER_PROPS) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      throw new Error('뷰어 객체가 궤도 속성 "' + prop + '" 를 아직 자기 값으로 들고 있다 '
        + '— 집이 둘이 되면 드래그로 벗어난 것을 이탈 판정이 못 본다');
    }
  }
  const angle = (key) => ({
    enumerable: true,
    get: () => orbitDegToRad(state[key]),
    set: (rad) => { state[key] = orbitRadToDeg(rad); },
  });
  Object.defineProperties(target, {
    on: {
      enumerable: true,
      get: () => state.orbitView === ORBIT_VIEW_3D,
      set: (v) => { state.orbitView = v ? ORBIT_VIEW_3D : ORBIT_VIEW_25D; },
    },
    yaw: angle('orbitYaw'),
    pitch: angle('orbitPitch'),
    roll: angle('orbitRoll'),
    persp: {
      enumerable: true,
      get: () => state.orbitPersp,
      set: (knob) => { state.orbitPersp = knob; },
    },
  });
  return target;
}

// ── 로드 시점 자기검증 ────────────────────────────────────────────────────────
// 「p9」의 유도가 살아 있는지 그 자리에서 확인한다. 상한이 바뀌면 여기서 던진다 —
// 조용히 두면 프리셋 16장이 전부 «다른 원근» 으로 찍힌다.
if (orbitPerspToT(15) !== 0.15 || orbitPerspToDeg(15) !== 9) {
  throw new Error('원근 노브 15 가 t 0.15 / α 9° 로 안 풀린다 — rot-analysis §0 의 p9 가 깨졌다');
}
if (orbitPerspToDeg(ORBIT_PERSP_KNOB_MAX) !== ORBIT_PERSP_MAX_DEG) {
  throw new Error('원근 노브 상한이 반각 상한과 안 맞는다');
}
