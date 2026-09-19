/**
 * Type X 프로파일 registry(v0) — 유한 후보 {X0, X0g, X1} 만 알고, 모르는 profileId 는 거절해요(rd-5 bootstrap).
 *
 * v0 는 능동·강체·정적(X-A)·2톤·예약 없음이에요. 파인더/포맷/워드 예약(rd-3·rd-5)은 확정 뒤
 * `reservations` 에 «실제 예약 siteId 집합 + 탈락 whole-group 목록» 으로 들어가고, 그때 profileLayout
 * hash 가 raw hash 와 갈라져요. scan order 'cell-order-v0' 와 mask 'identity-v0' 는 rd-4/마스크 결정 전
 * 잠정값이라 이름으로 명시해요.
 */
import { layoutX, xOrderedTriples, xLayoutCanonical } from './x-layout.js';

export const X_PROFILE_SCHEMA = 'TLcube:X:profile:v0';
export const X_TONE_CODEBOOKS = Object.freeze(['tl-binary', 'tl-lehmer']);
export const X_SCAN_ORDERS = Object.freeze(['cell-order-v0']);
export const X_MASKS = Object.freeze(['identity-v0']);

const BASE = Object.freeze({
  schemaVersion: X_PROFILE_SCHEMA, tones: 2, ecc: 'M', toneCodebookId: 'tl-binary',
  scanOrderId: 'cell-order-v0', maskId: 'identity-v0', finderId: null, formatId: null, observation: 'X-A',
});

/** 유한 registry — 이름은 SPEC 관례(0 기반 «X<v> (N<n>)»), g 접미는 GPT 회귀 배치 */
export const X_PROFILES = Object.freeze({
  X0: Object.freeze({ ...BASE, profileId: 'X0', label: 'X0 (N8)', layoutId: 'lee-fo-v1', N: 8, c: 0 }),
  X0g: Object.freeze({ ...BASE, profileId: 'X0g', label: 'X0g (N8, gpt 회귀)', layoutId: 'x8-gpt-v1', N: 8, c: 0 }),
  X1: Object.freeze({ ...BASE, profileId: 'X1', label: 'X1 (N10)', layoutId: 'lee-fo-v1', N: 10, c: 0 }),
});

export const X_PROFILE_IDS = Object.freeze(Object.keys(X_PROFILES));

/** registry 조회 — 미지 profileId 는 거절(부트스트랩 순환 방지: 후보는 이 표 밖에서 생기지 않아요) */
export function xProfile(profileId) {
  const profile = X_PROFILES[profileId];
  if (!profile) throw new RangeError(`알 수 없는 X profileId: ${profileId}`);
  return { ...profile };
}

/** profile 객체 검증(외부 입력용) — registry 항목과 필드가 같아야 해요 */
export function assertXProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('X profile 객체가 필요해요');
  const ref = X_PROFILES[profile.profileId];
  if (!ref) throw new RangeError(`알 수 없는 X profileId: ${profile.profileId}`);
  for (const key of ['layoutId', 'N', 'c', 'tones', 'toneCodebookId', 'scanOrderId', 'maskId']) {
    if (profile[key] !== ref[key]) throw new RangeError(`profile.${key} 가 registry 와 달라요: ${profile[key]} vs ${ref[key]}`);
  }
  if (!['L', 'M', 'H'].includes(profile.ecc)) throw new RangeError(`ecc 는 L/M/H 여야 해요: ${profile.ecc}`);
  return ref;
}

/**
 * profileLayout — raw layout + 예약 적용(v0 는 예약 0). 트리플 순서 = scan order 'cell-order-v0'
 * (중심 siteId 오름차순의 셀 순, 셀 안에서는 트리플 순).
 */
export function xProfileLayout(profileOrId) {
  const profile = typeof profileOrId === 'string' ? xProfile(profileOrId) : { ...assertXProfile(profileOrId), ecc: profileOrId.ecc };
  const raw = layoutX({ layoutId: profile.layoutId, N: profile.N, c: profile.c });
  const triples = xOrderedTriples(raw);
  return {
    profile, raw, triples, reservedTriples: [], reservations: [], digits: triples.length,
    rawCanonical: xLayoutCanonical(raw),
    profileCanonical: JSON.stringify({ schema: X_PROFILE_SCHEMA, profileId: profile.profileId, layout: xLayoutCanonical(raw), reservations: [], scanOrderId: profile.scanOrderId, maskId: profile.maskId }),
  };
}

/** 사이트별 기본 레벨 — 중심 = 최대 톤(항상 on), 데이터·잔여 = 0. 렌더·관측 대조군의 시작점이에요. */
export function xLevelsTemplate(profileLayout) {
  const { raw } = profileLayout;
  const levels = new Uint8Array(raw.N ** 3);
  for (const cell of raw.cells) levels[cell.centre] = profileLayout.profile.tones - 1;
  return levels;
}
