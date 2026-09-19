/**
 * Type X 프로파일 registry(v0) — 유한 후보 {X0, X0g, X1} 만 알고, 모르는 profileId 는 거절해요(rd-5 bootstrap).
 *
 * v0 는 능동·강체·정적(X-A)·2톤·예약 없음이에요. 파인더/포맷/워드 예약(rd-3·rd-5)은 확정 뒤
 * `reservations` 에 «실제 예약 siteId 집합 + 탈락 whole-group 목록» 으로 들어가고, 그때 profileLayout
 * hash 가 raw hash 와 갈라져요. scan order 'cell-order-v0' 와 mask 'identity-v0' 는 rd-4/마스크 결정 전
 * 잠정값이라 이름으로 명시해요.
 */
import { layoutX, xOrderedTriples, xLayoutCanonical, xScanOrderCanonical, X_SCAN_ORDER_IDS } from './x-layout.js';
import { xFinderSpec, xFinderCanonical, X_FINDER_IDS } from './x-finder.js';

export const X_PROFILE_SCHEMA = 'TLcube:X:profile:v0';
export const X_TONE_CODEBOOKS = Object.freeze(['tl-binary', 'tl-lehmer']);
/** registry 의 정식 값은 'cell-order-v0' 뿐이에요. 'morton-v0' 는 rd-4 연구 후보 — `xProfileLayout(id, {scanOrderId})` 연구 override 로만 쓰고 DTO/registry 로는 안 나가요. */
export const X_SCAN_ORDERS = X_SCAN_ORDER_IDS;
export const X_MASKS = Object.freeze(['identity-v0']);
/** 파인더 패턴 id — 연구 옵션(rd-3). registry 기본 finderId 는 null(예약 0, v0 와이어 불변) */
export const X_FINDERS = X_FINDER_IDS;

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

/** registry 조회 — 미지 profileId 는 거절(부트스트랩 순환 방지: 후보는 이 표 밖에서 생기지 않아요). 자기 키만 — `__proto__`/`constructor` 같은 상속 키는 미지예요. */
export function xProfile(profileId) {
  if (typeof profileId !== 'string' || !Object.hasOwn(X_PROFILES, profileId)) throw new RangeError(`알 수 없는 X profileId: ${describeId(profileId)}`);
  return { ...X_PROFILES[profileId] };
}

/** 거절 메시지용 — 비문자열은 «값을 문자열로 만들지 않고» 타입만 적어요(toString/Symbol.toPrimitive 호출 0, codex REPORT_005) */
function describeId(value) {
  return typeof value === 'string' ? JSON.stringify(value) : `<${value === null ? 'null' : typeof value}>`;
}

/** 외부 입력에서 registry 를 검증할 때 반드시 같아야 하는 필드 — 하나라도 빠지면(undefined) 거절해요 */
export const X_PROFILE_STRICT_KEYS = Object.freeze(['layoutId', 'N', 'c', 'tones', 'toneCodebookId', 'scanOrderId', 'maskId']);

/** profile 객체 검증(외부 입력용) — registry 항목과 필드가 같아야 해요. 반환은 «registry 원본 + 입력 ecc» 예요. */
export function assertXProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('X profile 객체가 필요해요');
  if (typeof profile.profileId !== 'string' || !Object.hasOwn(X_PROFILES, profile.profileId)) throw new RangeError(`알 수 없는 X profileId: ${describeId(profile.profileId)}`);
  const ref = X_PROFILES[profile.profileId];
  for (const key of X_PROFILE_STRICT_KEYS) {
    if (!Object.hasOwn(profile, key)) throw new RangeError(`profile.${key} 가 없어요(strict)`);
    if (profile[key] !== ref[key]) throw new RangeError(`profile.${key} 가 registry 와 달라요: ${profile[key]} vs ${ref[key]}`);
  }
  if (Object.hasOwn(profile, 'schemaVersion') && profile.schemaVersion !== X_PROFILE_SCHEMA) throw new RangeError(`schemaVersion 은 ${X_PROFILE_SCHEMA} 여야 해요: ${profile.schemaVersion}`);
  if (!['L', 'M', 'H'].includes(profile.ecc)) throw new RangeError(`ecc 는 L/M/H 여야 해요: ${profile.ecc}`);
  return { ...ref, ecc: profile.ecc };
}

/**
 * blind DTO 투영(codex X.6.1 allowlist) — 관측기/평가기 blind 경로에는 이 다섯 키만 건너가요.
 * 정답 라벨·seed·ecc 는 여기 없어요(ecc 는 코덱 쪽 사실이지 «후보 근거» 가 아니에요).
 */
export function xProfileDto(profileOrId) {
  const p = typeof profileOrId === 'string' ? xProfile(profileOrId) : assertXProfile(profileOrId);
  return { profileId: p.profileId, layoutId: p.layoutId, N: p.N, c: p.c, tones: p.tones };
}

/**
 * profileLayout — raw layout + 예약 적용(v0 는 예약 0). 트리플 순서 = scan order 'cell-order-v0'
 * (중심 siteId 오름차순의 셀 순, 셀 안에서는 트리플 순).
 *
 * 지문은 둘로 갈라요(codex 2233 지적): `structureCanonical` 은 «어느 사이트가 어떤 digit 인가»(layout+예약+scan order+mask)
 * 만이라 ECC 가 달라도 같고, `profileCanonical` 은 거기에 ecc·tones·코드북·finder/format·관측 profile 까지 더한 최종
 * 프로파일 지문이라 ECC L/M/H 가 서로 달라요. 코드북 호환성 비교는 structure, 왕복 재현성 비교는 profile 로 해요.
 */
export function xProfileLayout(profileOrId, options = {}) {
  const base = typeof profileOrId === 'string' ? xProfile(profileOrId) : assertXProfile(profileOrId);
  // 연구 override(rd-4): scanOrderId 만 바꿔 «같은 registry 프로파일의 다른 심볼 묶음» 을 실제 코덱으로 비교해요. registry·DTO 는 그대로예요.
  const scanOrderId = options.scanOrderId === undefined ? base.scanOrderId : options.scanOrderId; // null 도 «명시된 잘못된 값» — ?? 로 삼키지 않아요
  if (!X_SCAN_ORDERS.includes(scanOrderId)) throw new RangeError(`scanOrderId 는 ${X_SCAN_ORDERS.join('/')} 중 하나여야 해요`);
  // 연구 override(rd-3): finderId — 파인더 구조 사이트를 예약하고 그 사이트를 품은 트리플은 «whole-group 탈락»(계약 X.5: 실제 예약 siteId 집합 + 탈락 목록이 계약).
  // undefined 만 «registry 값»(기본 null = 예약 0). null 은 명시 «예약 없음», 그 외는 X_FINDERS 안이어야 해요.
  const finderId = options.finderId === undefined ? base.finderId : options.finderId;
  if (finderId !== null && !X_FINDERS.includes(finderId)) throw new RangeError(`finderId 는 null 또는 ${X_FINDERS.join('/')} 중 하나여야 해요`);
  const profile = { ...base, scanOrderId, finderId };
  const raw = layoutX({ layoutId: profile.layoutId, N: profile.N, c: profile.c });
  const centres = new Set(raw.cells.map(cell => cell.centre));
  const finderSpec = finderId === null ? null : xFinderSpec(raw.N, finderId);
  // 예약 = 구조 사이트 중 중심이 아닌 것(중심은 상시 on 이라 예약 불필요 — 모티프 표시만 그 자리에서 깨져요, 리포트 05 §2). 잔여 사이트는 탈락 없이 예약.
  const reservedSet = new Set(finderSpec ? finderSpec.structureSites.filter(id => !centres.has(id)) : []);
  const droppedTriples = [];
  const kept = { ...raw, cells: raw.cells.map(cell => ({ ...cell, triples: cell.triples.filter(t => { const hit = t.some(id => reservedSet.has(id)); if (hit) droppedTriples.push(t); return !hit; }) })) };
  const triples = xOrderedTriples(kept, scanOrderId);
  const rawCanonical = xLayoutCanonical(raw);
  const scanOrderCanonical = xScanOrderCanonical(kept, scanOrderId);
  const reservations = finderSpec ? { finderId, finder: xFinderCanonical(finderSpec), reservedSites: [...reservedSet].sort((a, b) => a - b), droppedTriples, structureOnCentres: finderSpec.structureSites.filter(id => centres.has(id)) } : [];
  const structure = { schema: X_PROFILE_SCHEMA, profileId: profile.profileId, layout: rawCanonical, reservations, scanOrderId, scanOrder: scanOrderCanonical, maskId: profile.maskId };
  const structureCanonical = JSON.stringify(structure);
  const profileCanonical = JSON.stringify({
    ...structure, ecc: profile.ecc, tones: profile.tones, toneCodebookId: profile.toneCodebookId,
    finderId: profile.finderId, formatId: profile.formatId, observation: profile.observation,
  });
  // finderLevels: 파인더 구조 사이트의 v0 레벨(중심 제외 — 중심은 xLevelsTemplate 가 톤 최대로). 인코더가 데이터 레벨 뒤에 덮어써요.
  const finderLevels = new Map(finderSpec ? [...finderSpec.levels].filter(([id]) => !centres.has(id)) : []);
  return {
    profile, raw, triples, reservedTriples: droppedTriples, reservations, reservedSites: [...reservedSet].sort((a, b) => a - b), finderId, finderSpec, finderLevels, digits: triples.length,
    rawCanonical, scanOrderCanonical, structureCanonical, profileCanonical,
  };
}

/** 사이트별 기본 레벨 — 중심 = 최대 톤(항상 on), 데이터·잔여 = 0. 렌더·관측 대조군의 시작점이에요. */
export function xLevelsTemplate(profileLayout) {
  const { raw } = profileLayout;
  const levels = new Uint8Array(raw.N ** 3);
  for (const cell of raw.cells) levels[cell.centre] = profileLayout.profile.tones - 1;
  return levels;
}
