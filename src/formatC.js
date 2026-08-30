/**
 * formatC.js — Type C(3시 노치) formatIndex 배정 표.
 *
 * Type C는 k=14/17/20이라는 새 `(값,k)` 열을 쓴다. 기존 hex·tri 축의 어느 claim도
 * 이 k에 없으므로 16값 전부 신규지만, 오분류 방지 관례를 이어 7(K1)과 8..11(cube
 * 예약 밴드)은 비운다. 평 C는 값 0, C*D(대한 또는 사괘 예약 회계)는 값 1을 버전마다
 * 같은 값으로 쓰고 k가 행을 가른다. 배정은 이 표가 전부이며 산술 오프셋이 없다.
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

/** Type C 와이어 표. 평 4행 뒤 C*D 4행. */
export const C_FORMAT_INDEX = Object.freeze([
  Object.freeze({ name: 'C0', version: 0, k: 14, formatIndex: 0, daehanFinder: false }),
  Object.freeze({ name: 'C1', version: 1, k: 16, formatIndex: 0, daehanFinder: false }),
  Object.freeze({ name: 'C2', version: 2, k: 18, formatIndex: 0, daehanFinder: false }),
  Object.freeze({ name: 'C3', version: 3, k: 20, formatIndex: 0, daehanFinder: false }),
  Object.freeze({ name: 'C0D', version: 0, k: 14, formatIndex: 1, daehanFinder: true }),
  Object.freeze({ name: 'C1D', version: 1, k: 16, formatIndex: 1, daehanFinder: true }),
  Object.freeze({ name: 'C2D', version: 2, k: 18, formatIndex: 1, daehanFinder: true }),
  Object.freeze({ name: 'C3D', version: 3, k: 20, formatIndex: 1, daehanFinder: true }),
]);

/** version + daehanFinder → 표 항목. 없으면 RangeError. */
export function cFormatSpec(version, options = {}) {
  if (options.cornerMarker === true) {
    throw new RangeError(TYPE_C_CM_UNSUPPORTED_REASON);
  }
  const daehanFinder = options.daehanFinder === true;
  const spec = C_FORMAT_INDEX.find(
    (entry) => entry.version === version && entry.daehanFinder === daehanFinder,
  );
  if (!spec) {
    throw new RangeError(
      `알 수 없는 Type C 버전: ${version}${daehanFinder ? '+daehan' : ''} `
      + `(허용 ${C_FORMAT_INDEX.filter((entry) => entry.daehanFinder === daehanFinder)
        .map((entry) => `${entry.name}(v${entry.version})`).join(', ')})`,
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

  const plain = C_FORMAT_INDEX.filter((entry) => !entry.daehanFinder);
  const daehan = C_FORMAT_INDEX.filter((entry) => entry.daehanFinder);
  if (plain.length !== TYPE_C_RADII.length || daehan.length !== TYPE_C_RADII.length) {
    throw new Error('formatC: 평 C와 C*D가 TYPE_C_RADII 행수만큼 있어야 한다');
  }
  for (let version = 0; version < TYPE_C_RADII.length; version += 1) {
    const p = cFormatSpec(version);
    const d = cFormatSpec(version, { daehanFinder: true });
    if (p.k !== TYPE_C_RADII[version] || d.k !== p.k) {
      throw new Error(`formatC: C${version}/C${version}D의 k 단계가 ${TYPE_C_RADII[version]}가 아니다`);
    }
    if (p.formatIndex === d.formatIndex) {
      throw new Error(`formatC: ${p.name}과 ${d.name}이 같은 값이라 예약 회계를 구분할 수 없다`);
    }
  }
}
