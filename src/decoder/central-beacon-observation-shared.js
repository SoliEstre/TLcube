/**
 * central-beacon-observation-shared.js — v0/n7 관측이 공유하는 기하·표본·검색 설정.
 * 인코더나 본문 복호기를 import하지 않는다. 기존 관측 함수와 상수의 단일 정본이다.
 */
import { FINDER_CELL_ORDER } from '../finder-patterns.js';
import { CORNER_UNIT_OFFSETS, hexCorners, regionCells } from '../hexgrid.js';
import { VERSIONS } from '../capacity.js';
import { VERSIONS_K } from '../capacityK.js';
import { regionCellsK } from '../layoutK.js';

export const ORIENTATION_DEGREES = Object.freeze([0, 120, 240]);

/**
 * 이 어댑터의 두 발견 입구(`discoverCentralBeaconFinders`·`discoverCentralN7Finders`)가
 * 블록 로케이터에 얹는 **`calibration.csBlockLocator` 오버레이의 정본**. 두 입구는 이것을
 * 스프레드하고 그 뒤에 호출자의 `csBlockLocator` 를 스프레드하므로, 호출자가 덮을 수 있다.
 * ⚠ 오버레이는 `calibration.csBlockLocator` 아래로 가야 먹는다 (calibration() 의 병합 규칙).
 *
 * ⚠ 2026-09-06 까지 두 입구에 **손 사본**으로 들어가 있었다 (REPORT_r1-type-limits §13 적대
 * 검토). 사본은 썩는다 — 한 곳만 고치면 조용히 갈린다. 그래서 한 상수로 뽑아 export 하고,
 * `test/k3-cluster-order.test.js` ⓓ 가 이 값을 import 해 «축소 없음» 을 단언하며, 같은 파일의
 * ⓗ 가 이 소스에 이 키들의 리터럴이 이 정의 **밖**에 없음을 잰다 (철자 자).
 *
 * · `maximumPosesPerFamily: 6` — **후보 풀만 넓힌다 — Type Y 경로의 기본(2)은 그대로다.**
 *   V3 실측('beacon-v3'): 바깥 3톤 필드 조각이 자체 점수로 진짜 중앙 블록을 상위 컷 밖으로
 *   밀었다. 넓힌 풀의 진짜/가짜 판정은 locator 톤 대조가 진다.
 * · `centreWindowFraction: 0.5` — **중앙 창 제한** (2026-08-24) — 이 어댑터가 찾는 블록은
 *   계약상 **중앙 고정**이다 (central-v0 는 19셀 슬롯 삽입물). 그런데 상위 컷(centres
 *   slice(0,3))은 점수 순이라, 코너 QR 의 파인더 3개가 v0-center 로 **1.00** 을 받아 컷을
 *   통째로 점거하고 진짜 비컨(0.81)을 밀어냈다 (A×비컨×코너QR 실측: shapes 0, verified
 *   랭크 5). 예산을 늘리는 대신 **계약을 주입**한다 — 중앙 박스 밖 v0-center 후보는 이
 *   경로에서 애초에 후보가 아니다. Type Y 전면 CS 경로는 이 어댑터를 안 지나므로 한 비트도
 *   안 바뀐다.
 * · `searchMaxSide: 1920` — **검색 해상도** (2026-08-25, 레인 TLK) — 기본 480 은 1080×1440
 *   프레임을 factor=3 으로 줄인다. 중앙 비컨은 13×13 모듈이 19셀 슬롯 안에 들어가므로, 같은
 *   화면에 별 전체를 담으면 k 가 클수록 모듈 px 가 줄어 factor=3 에서 K3 코어 문턱
 *   (minimumCoreUnitPx) 아래로 떨어진다. 240px 창·factor=1 에서는 K0/K1/K2 텔레 프레임이
 *   모두 locator 톤 1.00 으로 섰고, 480 검색은 18프레임 전부 파인더 0 이었다. 문턱은 안
 *   내린다. 이 어댑터만 1080p 짧은 변이 네이티브가 되게 캡을 올린다 (1920×1080 → factor=1).
 *   Type Y 전면 경로는 기본 480 그대로다.
 */
export const BEACON_CS_BLOCK_LOCATOR = Object.freeze({
  maximumPosesPerFamily: 6,
  centreWindowFraction: 0.5,
  searchMaxSide: 1920,
});

/**
 * scene.js 의 지역 함수 `centralSlotRadius` 와 **같은 식**.
 * 그 함수는 export 되지 않고, 이 레인은 scene.js 를 고치지 않는다.
 * 정본이 둘이 되지 않게 좌표 표(FINDER_CELL_ORDER · CORNER_UNIT_OFFSETS)만 공유한다.
 */
function centralSlotSupportRadius(layout, center) {
  const points = FINDER_CELL_ORDER.flatMap((cell) => hexCorners(cell.q, cell.r, layout));
  const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map((point) =>
    (point.x - center.x) * axis.x + (point.y - center.y) * axis.y)));
  return Math.min(...supports);
}

export const UNIT_CENTRAL_SLOT_RADIUS = centralSlotSupportRadius(
  { size: 1, originX: 0, originY: 0 },
  { x: 0, y: 0 },
);

if (!(UNIT_CENTRAL_SLOT_RADIUS > 0) || !Number.isFinite(UNIT_CENTRAL_SLOT_RADIUS)) {
  throw new Error('중앙 슬롯 단위 반지름을 유도하지 못했다');
}

/** size=1 레이아웃에서 중앙 19셀 슬롯의 지지 반지름. 정방향 식의 계수. */
export function unitCentralSlotRadius() {
  return UNIT_CENTRAL_SLOT_RADIUS;
}

export function affineCellHomography(center, cellSize, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return new Float64Array([
    cellSize * cosine, -cellSize * sine, center.x,
    cellSize * sine, cellSize * cosine, center.y,
    0, 0, 1,
  ]);
}

/** locator 면 중심의 luma 를 최근접 픽셀로 읽는다. */
export function sampleLuma(luma, x, y) {
  const ix = Math.max(0, Math.min(luma.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(luma.height - 1, Math.round(y)));
  return luma.data[iy * luma.width + ix];
}

/**
 * k-육각 코드 영역 **전체**의 단위 지지 반지름 — 슬롯과 같은 6축 metric.
 * k 목록은 손으로 적지 않고 용량표(VERSIONS)에서 온다.
 */
export const UNIT_OUTER_SUPPORT = (() => {
  const table = new Map();
  const layout = { size: 1, originX: 0, originY: 0 };
  for (const spec of VERSIONS) {
    const points = regionCells(spec.k).flatMap((cell) => hexCorners(cell.q, cell.r, layout));
    const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map(
      (point) => point.x * axis.x + point.y * axis.y)));
    table.set(spec.k, Math.min(...supports));
  }
  return table;
})();

/** Type K 별 실루엣의 단위 지지 반지름. 중앙 슬롯은 O와 같지만 바깥 경계가 3k
 * 꼭짓점까지 뻗으므로, O 표로 역산한 cellSize는 K에서 틀린다. 기존 표는 건드리지
 * 않고 별 후보를 나란히 둔 뒤 locator 톤 대조가 맞는 배율만 남긴다. */
export const UNIT_STAR_OUTER_SUPPORT = (() => {
  const table = new Map();
  const layout = { size: 1, originX: 0, originY: 0 };
  for (const spec of VERSIONS_K) {
    const points = regionCellsK(spec.k).flatMap((cell) => hexCorners(cell.q, cell.r, layout));
    const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map(
      (point) => point.x * axis.x + point.y * axis.y)));
    table.set(spec.k, Math.min(...supports));
  }
  return table;
})();
