/**
 * QR 스캔 어시스트가 시간 문턱보다 먼저 낼 수 있는 안내를 결정한다.
 * 상태·DOM과 분리해 `모름`, 셀 하한, 잘림 우선순위를 성질로 잠근다.
 */

import { CELL_PX_FLOOR } from './scanner-zoom.js';

export function immediateCornerQrHint(result, options = {}) {
  const floor = options.cellPxFloor === undefined ? CELL_PX_FLOOR : options.cellPxFloor;
  if (!(floor > 0) || !Number.isFinite(floor)) return null;
  // 2면 이상 잘림은 기존 「조금 뒤로」 축이다. 작은 코드 안내와 동시에 내지 않는다.
  if (!result || result.clipSide === 'multi') return null;
  const assist = result.scanAssist;
  if (!assist || assist.ok !== true || !(assist.cellPx > 0)) return null;
  if (assist.cellPx >= floor) return null;
  return {
    messageKey: 'status.small',
    reason: 'cell-below-floor',
    cellPx: assist.cellPx,
    cellPxFloor: floor,
    center: assist.center,
    guide: assist.guide || null,
  };
}

/**
 * 복호 결과에서 화면에 보일 페이로드를 뽑는 **문**. 어느 경로(R1 단발 · R2 누적 · 파일)든
 * 여기를 지나야 결과 패널에 닿는다. 본체가 scanner.js 가 아니라 여기 있는 이유: 테스트가
 * R2 적중 객체를 이 함수에 **직접** 넣어 본다 — 2026-09-05 시험판(.04~.05.02)에서 R2 가
 * `{ text }` 로 넘겨 이 문에서 죽었고, 철자 자는 초록이었다 (PM/029B §24.9).
 */
export function normalizeDecodePayload(result) {
  if (!result || result.ok !== true || typeof result.payload !== 'string' || result.payload === '') {
    return null;
  }
  return result.payload;
}

/**
 * 스캔 범위 안내(«QR 및 다른 바코드는 읽히지 않아요»)의 문구 키 — 3상태. R2 누적이 켜져 있으면
 * 브라우저의 QR 능력(BarcodeDetector)에 따라 «QR 도 읽어요» / «이 브라우저에선 못 읽어요» 로
 * 갈린다 (운영자 요구 ② · §26). off · 모름은 R1 위치의 문구(«TL 큐브만»)다.
 * ⚠ **2026-09-06 승격** 뒤 이 함수의 입력은 정식에서도 두 값을 다 받는다 — 정식 첫 방문은
 * R2 위치라 기본 문구가 `guide.scope.r2*` 쪽이다. 「정식은 언제나 tlcubeOnly」는 거짓이 됐다.
 */
export function scanScopeCopyKey(r2Enabled, qrCapable, expanded = false) {
  if (r2Enabled !== true) return 'guide.tlcubeOnly';
  if (expanded === true) return qrCapable === true ? 'guide.scope.r2expandedQr' : 'guide.scope.r2expanded';
  // on 은 브라우저 능력에 따라 둘 — BarcodeDetector 가 있으면 QR 도 읽는다 (§26). 판정 전(모름)은 못 읽는 쪽.
  return qrCapable === true ? 'guide.scope.r2qr' : 'guide.scope.r2';
}

/**
 * 하단 안내 카드 두 장의 표시 — 스위치 위치마다 **한 장씩**.
 *
 * 운영자 관측(2026-09-06): R2 위치에서 조준 지시(`#scan-guide-detail`, guide.dots)와 범위 안내
 * (`#scan-guide-scope`, guide.scope.r2*)가 **둘 다** 떠서 «카드 두 장» 이 됐다. 조준 지시는 R1
 * 단발이 꼭짓점·고리·중앙을 한 장에서 맞춰야 하기 때문에 있는 문구다 — R2 누적은 여러 프레임을
 * 모으므로 그 지시가 그 위치의 지시가 아니다. 그래서 R1 위치 = 조준, R2 위치 = 범위.
 *
 * ⚠ **2026-09-06 승격** 뒤 정식도 스위치를 갖는다 — `r2Enabled` 가 두 값을 다 받고, 저장값 없는
 * 첫 방문은 R2 위치라 정식의 기본 카드가 `{ detail: false, scope: true }`(범위 한 장)로 바뀌었다.
 * 승격 전의 「정식 입력은 false 하나뿐」은 이제 거짓이다 (test/engine-switch.test ⓙ 가 값으로 잰다).
 */
export function guideCardVisibility(r2Enabled) {
  return { detail: r2Enabled !== true, scope: true };
}

/**
 * 텔레메트리 `via` — 결과가 어느 경로로 왔는가. 값 집합은 아래 상수가 잠근다 (PM/026 · PM/010 의
 * `via enum` 은 이 집합을 따른다). R2 누적·일반 QR 은 hypothesis 가 없으므로 경로 이름으로 가른다.
 * 페이로드 내용은 어디에도 싣지 않는다 — 이 값은 경로 라벨뿐이다.
 */
export const SCAN_VIA_VALUES = Object.freeze(['cube', 'qr', 'qr-direct', 'r2']);

export function scanViaOf(result) {
  if (result && result.source === 'r2') return 'r2';
  if (result && result.source === 'qr') return 'qr-direct';
  const hypothesis = result && result.hypothesis;
  return hypothesis && (hypothesis.centerQr === true || /qr/i.test(hypothesis.source || ''))
    ? 'qr'
    : 'cube';
}

/**
 * 결과 URL 을 **자동으로** 열어도 되는가 — 허용 목록이다. TL 출처(R1: top-level source 없음 · R2:
 * 'r2')만 열고, 일반 QR('qr')과 미지의 출처는 사용자가 누른다. 결과가 `autoOpen: false` 를 직접
 * 실으면 언제나 그것이 이긴다. 기본값이 «연다» 쪽이 아니라서 새 출처가 표시를 잊어도 안전하다.
 */
export function resultAutoOpen(result) {
  if (!result || result.autoOpen === false) return false;
  return result.source === undefined || result.source === 'r2';
}

/**
 * 🔴 **분석 배율** — 프레임에 실제로 걸린 확대의 전부 (2026-09-06 검토 R3c, 결함 15).
 *
 * `zoomPlan` 에는 확대가 **두 길**로 실린다:
 *   · `mode:'track'`  — 카메라 트랙이 광학/디지털로 당긴다. `cropApplied` 는 **1** 이다.
 *   · `mode:'crop*'`  — 트랙이 못 해서 우리가 자른다. `trackApplied` 는 native(보통 1) 다.
 * 거기에 자동 사다리(`autoCropZoom`)가 곱해진다.
 *
 * 옛 게이트는 `effectiveCropZoom()`(크롭 × 자동)만 봤다 — 즉 **track 줌을 못 봤다.**
 * `zoomCapability` 가 있는 기기에서 1× → 2× 커밋은 전후 모두 크롭 1 이라 「안 바뀜」으로 읽혔고,
 * 어댑터의 크기 가드(luma 폭 동일)도 안 걸려, 남는 것은 감도 약한 F 게이트뿐이었다.
 * 즉 실기의 대다수 기기에서 운영자 요구 ①(줌 뒤 실루엣이 안 움직인다)의 수리가 **불발**이었다.
 *
 * 잘못된 입력·1 미만은 **1** 로 읽는다 (모르는 값 때문에 락을 흔들지 않는다).
 */
export function analysisScaleOf(plan, autoCropZoom) {
  const norm = (value) => {
    const v = Number(value);
    return Number.isFinite(v) && v > 1.001 ? v : 1;
  };
  return norm(plan && plan.trackApplied) * norm(plan && plan.cropApplied) * norm(autoCropZoom);
}

/**
 * 뷰파인더 **중앙 탭**의 기본 반경 — 정사각 한 변에 대한 비율. 0.25 = 「중심에서 한 변의 25 % 안」
 * (운영자 요구 ⑫ · 실기 3차). 값이 여기 하나뿐이라 스캐너와 자가 같은 수를 본다.
 */
export const STAGE_CENTRE_TAP_FRACTION = 0.25;

/**
 * 스테이지 안의 (x, y) 가 **중앙 탭 영역**인가 — 순수 판정. 좌표는 스테이지 좌상단 기준 CSS px,
 * `side` 는 정사각 한 변이다. 원 안(중심에서 `frac × side` 이하)이면 참 — 경계는 **포함**한다.
 *
 * 여기서 재지 않는 것: 카메라가 켜졌는가 · 상단 행이나 버튼 위를 눌렀는가. 그건 DOM 이 아는 것이고
 * (이벤트 표적), 이 함수는 «기하» 만 답한다 — 그래야 브라우저 없이 진리표를 잴 수 있다.
 *
 * 잘못된 입력(비유한 좌표 · side ≤ 0 · frac ≤ 0)은 **거짓**이다: 모르는 상태에서 리셋을 트리거하면
 * 사용자가 «아무 데나 눌렀는데 스캔이 처음부터» 를 겪는다.
 */
export function stageTapIsCentre(x, y, side, frac = STAGE_CENTRE_TAP_FRACTION) {
  const px = Number(x);
  const py = Number(y);
  const edge = Number(side);
  const ratio = Number(frac);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  if (!Number.isFinite(edge) || edge <= 0) return false;
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  const dx = px - edge / 2;
  const dy = py - edge / 2;
  const radius = ratio * edge;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * 승격 플래그 — 정식(/)에 엔진 스위치와 R2 를 연다. **2026-09-06 승격**(운영자 실기 4차 판정 · 결정 ①):
 * 정식 화면 = 시험판 화면(스위치 · R2 좌 패널 · HUD · 수동 리셋)이고, 저장값이 없는 첫 방문의 기본 엔진은
 * `resolveEngineChoice` 의 기본값 그대로 **R2** 다. 능력 원장(R2_CAPABILITIES)과 섞지 않는다 — 능력과
 * 출시 결정은 다른 것이다.
 *
 * ⚠ 되돌리면(false) 정식에서 R2 가 통째로 사라진다 — 스위치·패널·HUD·QR 브리지·R1 유휴 창(결정 ⑮)까지
 *   한꺼번에 닫힌다. 그래서 이 값을 되돌리는 것은 «플래그 한 줄» 이 아니라 결정 ① 을 다시 여는 일이다
 *   (`test/engine-switch.test.js` ⓐ 의 핀이 그때 빨개진다).
 */
export const ENGINE_SWITCH_PRODUCT_ENABLED = true;

/**
 * «R2 가용» 진리표 — 시험판이거나 승격됐으면 참. 런타임 enabled · QR probe · 패널 렌더 · 스위치 표시 ·
 * 디버그 qr 줄이 **전부 이것 하나**를 본다 (배타를 열면 소비자도 쓸어라 — 한 곳이 isLabPath 를 따로 보면
 * 승격 날 «켰는데 안 먹는» 상태가 된다).
 */
export function engineSwitchAvailable(state) {
  return Boolean(state) && (state.labPath === true || state.productEnabled === true);
}

/** 엔진 선택 저장 키 — 새 키. 옛 시험판 키는 1회 이관용으로만 읽는다. */
export const ENGINE_STORAGE_KEY = 'tlscan.engine.r2';
export const ENGINE_STORAGE_KEY_LEGACY = 'tlscan.lab.r2Accumulate';

/**
 * 저장된 엔진 선택을 푼다 — 새 키가 있으면 그것, 없으면 옛 키, 둘 다 없으면 **켬**.
 *
 * 승격(2026-09-06) 뒤 이 기본값이 곧 **정식의 기본 엔진 = R2** 다 (결정 ①). 새 코드로 정하지 않는다:
 * «저장값 없음 → 켬» 이라는 이 한 규칙이 시험판과 정식 양쪽의 기본을 동시에 쥔다. 그 성질을
 * `test/engine-switch.test.js` ⓑ 가 값으로 잰다.
 */
export function resolveEngineChoice(stored, legacy) {
  if (stored === '1') return true;
  if (stored === '0') return false;
  if (legacy === '0') return false;
  return true;
}
