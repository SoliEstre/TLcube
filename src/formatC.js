/**
 * formatC.js — Type C(3시 노치) formatIndex 배정 표.
 *
 * Type C는 k=14/16/18/20이라는 새 `(값,k)` 열을 쓴다. 기존 hex·tri 축의 어느 claim도
 * 이 k에 없으므로 16값 전부 신규지만, 오분류 방지 관례를 이어 7(K1)과 8..11(cube
 * 예약 밴드)은 비운다. 평 C는 값 0, C*D(대한 또는 사괘 예약 회계)는 값 1, CQ(중앙
 * QR)는 값 4를 버전마다 같은 값으로 쓰고 k가 행을 가른다. 배정은 이 표가 전부이며
 * 산술 오프셋이 없다.
 */

import {
  hexTriAxisOccupancy,
  TURN_A_FORMAT_INDEX,
  K1_RESERVED_FORMAT_INDEX,
  CUBE_RESERVED_FORMAT_INDEXES,
} from './turnA.js';
import { MARKER_G_FORMAT_INDEX } from './markerG.js';

/**
 * 4단 등간 사다리 (운영자 정정 2026-08-30): C0=14 · C1=16 · C2=18 · C3=20.
 * 초기 발행분(30.03)의 [14,17,20] 3단은 운영자 계산 착오였다 — 채택 전 정정.
 */
export const TYPE_C_RADII = Object.freeze([14, 16, 18, 20]);
export const TYPE_C_RESERVED_FORMAT_INDEXES = Object.freeze([
  K1_RESERVED_FORMAT_INDEX,
  ...CUBE_RESERVED_FORMAT_INDEXES,
]);

/** CM 병용 공용 거절 사유 — 표 조회와 인코더가 같은 문자열을 쓴다. */
export const TYPE_C_CM_UNSUPPORTED_REASON =
  'Type C × cornerMarker(CM) 는 이번 범위 밖이다 — 3시 노치가 CM tetrad 3셀과 겹쳐 배치·회계·검출을 검증하지 않았다';

/**
 * Type C 와이어 표. 평 4행 → C*D 4행 → CQ(중앙 QR) 4행.
 *
 * CQ 행의 값 4는 **이 표가 배정한 값**이다 — 헤더의 «산술 오프셋 없음» 선언 그대로,
 * 배정 근거는 표 자체다. (O 가족의 «Q = 기저 +4» 관례(V1Q..V3Q)와 우연히 같은 모양인
 * 것은 참고 사항일 뿐 규칙이 아니다 — 그 관례는 기저 0..2에서만 닫히고, O 자신도
 * V4Q를 산술이 아니라 hex 표 7 예약으로 처리한다.) CQ는 19셀 중앙 슬롯의 점유자를
 * 불스아이 → QR 블록으로 교체할 뿐이라 회계·RS 블록이 같은 version의 평 C 행과
 * 완전 동일하다 (capacityC.VERSIONS_C_Q가 값으로 잠근다). CDQ(C*D + 중앙 QR)는
 * **행이 없다** — sagoae × 정식 중앙 검증기 확장 트랙 몫이라 배정하지 않는다.
 */
export const C_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'C0', version: 0, k: 14, formatIndex: 0, daehanFinder: false, centerQr: false }),
  Object.freeze({ name: 'C1', version: 1, k: 16, formatIndex: 0, daehanFinder: false, centerQr: false }),
  Object.freeze({ name: 'C2', version: 2, k: 18, formatIndex: 0, daehanFinder: false, centerQr: false }),
  Object.freeze({ name: 'C3', version: 3, k: 20, formatIndex: 0, daehanFinder: false, centerQr: false }),
  Object.freeze({ name: 'C0D', version: 0, k: 14, formatIndex: 1, daehanFinder: true, centerQr: false }),
  Object.freeze({ name: 'C1D', version: 1, k: 16, formatIndex: 1, daehanFinder: true, centerQr: false }),
  Object.freeze({ name: 'C2D', version: 2, k: 18, formatIndex: 1, daehanFinder: true, centerQr: false }),
  Object.freeze({ name: 'C3D', version: 3, k: 20, formatIndex: 1, daehanFinder: true, centerQr: false }),
  Object.freeze({ name: 'CQ0', version: 0, k: 14, formatIndex: 4, daehanFinder: false, centerQr: true }),
  Object.freeze({ name: 'CQ1', version: 1, k: 16, formatIndex: 4, daehanFinder: false, centerQr: true }),
  Object.freeze({ name: 'CQ2', version: 2, k: 18, formatIndex: 4, daehanFinder: false, centerQr: true }),
  Object.freeze({ name: 'CQ3', version: 3, k: 20, formatIndex: 4, daehanFinder: false, centerQr: true }),
]);

/** version + {daehanFinder, centerQr} 3키 → 표 항목. 없으면 RangeError. */
export function cFormatSpec(version, options = {}) {
  if (options.cornerMarker === true) {
    throw new RangeError(TYPE_C_CM_UNSUPPORTED_REASON);
  }
  const daehanFinder = options.daehanFinder === true;
  const centerQr = options.centerQr === true;
  const spec = C_FORMAT_INDEX.find(
    (entry) => entry.version === version
      && entry.daehanFinder === daehanFinder
      && entry.centerQr === centerQr,
  );
  if (!spec) {
    const allowed = C_FORMAT_INDEX
      .filter((entry) => entry.daehanFinder === daehanFinder && entry.centerQr === centerQr)
      .map((entry) => `${entry.name}(v${entry.version})`).join(', ');
    throw new RangeError(
      `알 수 없는 Type C 버전: ${version}${daehanFinder ? '+daehan' : ''}${centerQr ? '+centerQr' : ''} `
      + `(허용 ${allowed || '없음 — CDQ 는 sagoae×정식 중앙 검증기 확장 트랙 몫이라 행이 없다'})`,
    );
  }
  return spec;
}

/** formatIndex + k → Type C 표 항목 (C-DEC 역해석용). 없으면 null. */
export function cSpecFromFormatIndex(formatIndex, k) {
  return C_FORMAT_INDEX.find(
    (entry) => entry.formatIndex === formatIndex && entry.k === k,
  ) || null;
}

// 모듈 로드 자기검증 — markerG/turnA 표 문법과 동일하게 claim을 실제 코드에서 대조한다.
{
  const seen = new Map();
  const claim = (owner, formatIndex, k) => {
    if (!Number.isInteger(formatIndex) || formatIndex < 0 || formatIndex > 15) {
      throw new Error(`formatC: formatIndex 4bit 범위 위반 — ${owner}=${formatIndex}`);
    }
    const key = `${formatIndex}|${k}`;
    if (seen.has(key)) {
      throw new Error(`formatC: (값,k) 경합 — ${owner} 와 ${seen.get(key)} 가 ${key}를 겹쳐 쓴다`);
    }
    seen.set(key, owner);
  };

  for (const occ of hexTriAxisOccupancy()) claim(occ.owner, occ.formatIndex, occ.k);
  for (const entry of TURN_A_FORMAT_INDEX) claim(entry.name, entry.formatIndex, entry.k);
  for (const entry of MARKER_G_FORMAT_INDEX) claim(entry.name, entry.formatIndex, entry.k);
  for (const entry of C_FORMAT_INDEX) {
    if (TYPE_C_RESERVED_FORMAT_INDEXES.includes(entry.formatIndex)) {
      throw new Error(`formatC: 혼동 방지 예약값 ${entry.formatIndex} 침범 — ${entry.name}`);
    }
    claim(entry.name, entry.formatIndex, entry.k);
  }

  for (const entry of C_FORMAT_INDEX) {
    if (typeof entry.daehanFinder !== 'boolean' || typeof entry.centerQr !== 'boolean') {
      throw new Error(`formatC: ${entry.name} 의 daehanFinder/centerQr 는 명시 boolean 이어야 한다`);
    }
  }
  const plain = C_FORMAT_INDEX.filter((entry) => !entry.daehanFinder && !entry.centerQr);
  const daehan = C_FORMAT_INDEX.filter((entry) => entry.daehanFinder && !entry.centerQr);
  const centerQrRows = C_FORMAT_INDEX.filter((entry) => entry.centerQr);
  if (plain.length !== TYPE_C_RADII.length || daehan.length !== TYPE_C_RADII.length
    || centerQrRows.length !== TYPE_C_RADII.length) {
    throw new Error('formatC: 평 C·C*D·CQ가 각각 TYPE_C_RADII 행수만큼 있어야 한다');
  }
  // CDQ 는 아직 배정하지 않는다 — sagoae×정식 중앙 검증기 확장 전까지 centerQr 행은
  // 평 C 전용이다 (PM/027 §5.4). 이 단언이 깨지면 그 트랙이 열린 것이니 함께 재작성.
  if (centerQrRows.some((entry) => entry.daehanFinder)) {
    throw new Error('formatC: CDQ 행은 아직 없다 — centerQr 행은 평 C(daehanFinder=false) 전용이다');
  }
  for (let version = 0; version < TYPE_C_RADII.length; version += 1) {
    const p = cFormatSpec(version);
    const d = cFormatSpec(version, { daehanFinder: true });
    const q = cFormatSpec(version, { centerQr: true });
    if (p.k !== TYPE_C_RADII[version] || d.k !== p.k || q.k !== p.k) {
      throw new Error(`formatC: C${version}/C${version}D/CQ${version}의 k 단계가 ${TYPE_C_RADII[version]}가 아니다`);
    }
    if (new Set([p.formatIndex, d.formatIndex, q.formatIndex]).size !== 3) {
      throw new Error(
        `formatC: v${version} 의 평/C*D/CQ 세 행이 값(${p.formatIndex}/${d.formatIndex}/${q.formatIndex})을 `
        + '겹쳐 써서 예약 회계·중앙 점유자를 구분할 수 없다',
      );
    }
  }
}
