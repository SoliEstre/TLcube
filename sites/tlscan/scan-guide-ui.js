/**
 * scan-guide-ui.js — 스캐너 조준 가이드의 순수 기하 헬퍼 (Type C 링).
 *
 * 배포에서 `sites/tlscan` 이 문서 루트가 되므로 이 모듈은 `src/` 를 직접 import 하지
 * 않는다. scanner.js 가 정본 상수(EDGE_UNIT_OFFSETS · GUIDE_OUTER_FRACTION)를
 * 주입한다. 이 경계를 두면 브라우저 번들과 Node 국소 자가 같은 함수를 그대로 쓴다.
 *
 * v2 (2026-08-30, 운영자 «같이 배치» 지시): K/C 토글은 폐지됐다 — 가이드는 K 18점과
 * C 링을 **동시에** 그린다. ⚠ C 5점은 K 점집합의 부분집합이 **아니다** (E-방향 vs
 * C-방향, 30° 어긋남 실측 — 최근접 114px@1000). 그래서 «하나의 6점» 이 아니라 두
 * 링을 겹쳐 그리고, C 링의 3시 꼭짓점만 **속 빈 점**으로 구분해 노치 자리를 읽힌다.
 */

/** EDGE_UNIT_OFFSETS[1] = (1, 0), 즉 Type C의 3시 V-노치 코너다. */
export const TYPE_C_NOTCH_VERTEX_INDEX = 1;

/**
 * Type C 링 전체 — 채운 점 5개 + 3시 노치 표식(속 빈 점) 1개.
 *
 * Type C 외곽 육각의 꼭짓점은 E 방향이며, 반지름은 K 바깥 링과 같은
 * `outerFraction * side / 2` 라 두 가이드의 지름이 같다. 3시 꼭짓점은 노치가 판
 * 자리라 «맞출 큐브가 없다» — 그래서 채운 점이 아니라 속 빈 표식으로 그린다.
 *
 * @returns {{dots: {x:number,y:number}[], notch: {x:number,y:number}}|null}
 */
export function typeCGuideRingPositions({
  screenSide,
  centerX = Number(screenSide) / 2,
  centerY = Number(screenSide) / 2,
  edgeUnitOffsets,
  outerFraction,
}) {
  const side = Number(screenSide);
  const cx = Number(centerX);
  const cy = Number(centerY);
  const fraction = Number(outerFraction);
  if (!(side > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)
      || !(fraction > 0) || !Array.isArray(edgeUnitOffsets)
      || edgeUnitOffsets.length !== 6) {
    return null;
  }

  for (const offset of edgeUnitOffsets) {
    if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
  }

  const notchOffset = edgeUnitOffsets[TYPE_C_NOTCH_VERTEX_INDEX];
  if (notchOffset.x !== 1 || notchOffset.y !== 0) {
    throw new RangeError('Type C 가이드는 EDGE_UNIT_OFFSETS[1] = (1, 0)을 요구한다.');
  }

  const radius = fraction * (side / 2);
  const project = (offset) => ({ x: cx + offset.x * radius, y: cy + offset.y * radius });
  return {
    dots: edgeUnitOffsets
      .filter((_, index) => index !== TYPE_C_NOTCH_VERTEX_INDEX)
      .map(project),
    notch: project(notchOffset),
  };
}

/**
 * Type C의 채운 점 5개만 (구 계약 유지 — 국소 자·물리 봉투 자가 이 형태를 쓴다).
 */
export function typeCGuideDotPositions(options) {
  const ring = typeCGuideRingPositions(options);
  return ring === null ? null : ring.dots;
}
