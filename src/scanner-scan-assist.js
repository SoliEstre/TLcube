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
 * 갈린다 (운영자 요구 ② · §26). off · 모름은 정식 문구 그대로 — 정식 경로(/)는 R2 가 항상
 * 꺼져 있어 이 함수가 정식 문구 밖을 낼 수 없다.
 */
export function scanScopeCopyKey(r2Enabled, qrCapable) {
  if (r2Enabled !== true) return 'guide.tlcubeOnly';
  // on 은 브라우저 능력에 따라 둘 — BarcodeDetector 가 있으면 QR 도 읽는다 (§26). 판정 전(모름)은 못 읽는 쪽.
  return qrCapable === true ? 'guide.scope.r2qr' : 'guide.scope.r2';
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
 * 승격 플래그 — 정식(/)에 엔진 스위치와 R2 를 연다. 승격 커밋에서 true 로 바꾼다(그때 «승격 전 핀» 자가
 * 빨개져 사람이 본다). 능력 원장(R2_CAPABILITIES)과 섞지 않는다 — 능력과 출시 결정은 다른 것이다.
 */
export const ENGINE_SWITCH_PRODUCT_ENABLED = false;

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
 * 저장된 엔진 선택을 푼다 — 새 키가 있으면 그것, 없으면 옛 키, 둘 다 없으면 **켬**(시험판의 존재
 * 이유가 R2 실기다; 승격 후 기본은 결정 3 에서 다시 정한다).
 */
export function resolveEngineChoice(stored, legacy) {
  if (stored === '1') return true;
  if (stored === '0') return false;
  if (legacy === '0') return false;
  return true;
}
