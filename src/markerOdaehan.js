/**
 * markerOdaehan.js — Type G(CM) × daehan의 합성 배치·회계.
 *
 * G는 Type O의 코너 tetrad 자리 예약(내부 타입 G 와이어)이고 daehan은 불스아이 밖
 * 예약 셀을 쓰는 전면 파인더다. 둘은 중앙 점유 경합이 아니다. 이 모듈은 G2~G4에서
 * 다음을 실행 시점에 강제한다.
 *
 *   1. daehan 예약은 CM tetrad·format·reference 어느 역할과도 겹치지 않는다.
 *   2. 합성 scan order는 CM scan order에서 daehan 예약만 제거한 결정적 부분수열이다.
 *   3. 와이어는 V*CM formatIndex를 공유한다. 구분은 daehan 광학 검출 + RS/CRC다.
 *
 * 따라서 V*CM/V*D의 NSYM 행은 재사용할 수 없다. 합성의 사용 심볼 수가 각각
 * 39/69/114로 다르므로 V2CMD/V3CMD/V4CMD 전용 행을 쓴다.
 */

import { cellCount } from './hexgrid.js';
import { capacityFor } from './capacity.js';
import { daehanReservedCells } from './finder-daehan.js';
import {
  VERSIONS_OCM,
  dataCellsInScanOrderOMarker,
  fillerCellsOMarker,
  overheadBreakdownOMarker,
} from './markerO.js';
import { NSYM_TABLE_OCM_DAEHAN } from './rs211.js';

const NSYM_SOURCE = Object.freeze({
  table: NSYM_TABLE_OCM_DAEHAN,
  tableName: 'NSYM_TABLE_OCM_DAEHAN',
});

function key(cell) {
  return `${cell.q},${cell.r}`;
}

/** 합성 G×daehan에서 허용한 G2~G4 행. G1은 이 검증 트랙의 범위 밖이다. */
const MARKER_SPECS = Object.freeze(VERSIONS_OCM.filter((spec) => spec.version >= 2));

/**
 * daehan 예약이 CM scan order의 실제 데이터 셀에만 놓이는지 확인하고 그 집합을 준다.
 * 겹침이 생기면 단순 합산이 이중계상이므로 즉시 멈춘다.
 */
export function daehanReservedCellsOMarker(k) {
  const cmScan = new Set(dataCellsInScanOrderOMarker(k).map(key));
  const reserved = daehanReservedCells(k);
  for (const cell of reserved) {
    if (!cmScan.has(key(cell))) {
      throw new Error(
        `G×daehan k=${k}: 예약 셀 ${key(cell)}이 CM 데이터 셀이 아니다 — 역할 충돌 또는 이중계상`,
      );
    }
  }
  return reserved;
}

/** G×daehan 데이터 셀 scan order — CM 정준 순서를 유지하며 daehan 예약만 뺀다. */
export function dataCellsInScanOrderOMarkerDaehan(k) {
  const reserved = new Set(daehanReservedCellsOMarker(k).map(key));
  return dataCellsInScanOrderOMarker(k).filter((cell) => !reserved.has(key(cell)));
}

/** G×daehan 필러 — 합성 scan order의 꼬리. */
export function fillerCellsOMarkerDaehan(k) {
  const scan = dataCellsInScanOrderOMarkerDaehan(k);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

/**
 * 합성 오버헤드 실계산. `daehanReservedCellsOMarker`가 CM 데이터 셀 부분집합을
 * 강제하므로 여기 합산은 이중계상이 아니다.
 */
export function overheadBreakdownOMarkerDaehan(k) {
  const cm = overheadBreakdownOMarker(k);
  const daehan = daehanReservedCellsOMarker(k).length;
  const total = cm.total + daehan;
  const dataCells = dataCellsInScanOrderOMarkerDaehan(k).length;
  if (cellCount(k) !== total + dataCells) {
    throw new Error(
      `G×daehan k=${k}: 총 셀 ${cellCount(k)} != overhead ${total} + data ${dataCells}`,
    );
  }
  return Object.freeze({ ...cm, daehan, total });
}

/** G×daehan 버전 표. formatIndex는 같은 G(CM) 행에서 유도한다. */
export const VERSIONS_OCM_DAEHAN = Object.freeze(MARKER_SPECS.map((markerSpec) => Object.freeze({
  name: `V${markerSpec.version}CMD`,
  version: markerSpec.version,
  k: markerSpec.k,
  formatIndex: markerSpec.formatIndex,
  overhead: overheadBreakdownOMarkerDaehan(markerSpec.k).total,
  symbolKey: `V${markerSpec.version}CMD`,
})));

/** G×daehan 한 버전의 용량. 표와 실계산의 심볼 수가 어긋나면 capacityFor가 던진다. */
export function capacityForOMarkerDaehan(spec, level = 'M') {
  const base = capacityFor(spec, level, NSYM_SOURCE);
  return {
    name: spec.name,
    cornerMarker: true,
    daehanFinder: true,
    ...base,
  };
}

/** 로드 자기검증 — 기하·회계·와이어를 한곳에서 함께 잠근다. */
{
  const EXPECT = {
    V2CMD: { k: 8, formatIndex: 0, overhead: 98, dataCells: 119, symbols: 39 },
    V3CMD: { k: 10, formatIndex: 1, overhead: 122, dataCells: 209, symbols: 69 },
    V4CMD: { k: 12, formatIndex: 0, overhead: 126, dataCells: 343, symbols: 114 },
  };
  if (VERSIONS_OCM_DAEHAN.length !== 3) {
    throw new Error('G×daehan: G2~G4 세 행이어야 한다');
  }
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const want = EXPECT[spec.name];
    const markerSpec = VERSIONS_OCM.find((entry) => entry.version === spec.version);
    if (!want || !markerSpec
      || spec.k !== want.k
      || spec.formatIndex !== want.formatIndex
      || spec.formatIndex !== markerSpec.formatIndex
      || spec.overhead !== want.overhead) {
      throw new Error(`G×daehan ${spec.name}: 버전·와이어·오버헤드 계약 불일치`);
    }
    const scan = dataCellsInScanOrderOMarkerDaehan(spec.k);
    if (scan.length !== want.dataCells) {
      throw new Error(`G×daehan ${spec.name}: scan ${scan.length} != ${want.dataCells}`);
    }
    for (const level of ['L', 'M', 'H']) {
      const capacity = capacityForOMarkerDaehan(spec, level);
      if (capacity.usedSymbols !== want.symbols) {
        throw new Error(`G×daehan ${spec.name}/${level}: S=${capacity.usedSymbols} != ${want.symbols}`);
      }
    }
  }
  // 기존 CM 필러는 합성에 쓰면 안 된다. 차이가 생기는 순간 양쪽 꼬리를 따로 고정한다.
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const combined = fillerCellsOMarkerDaehan(spec.k).length;
    const marker = fillerCellsOMarker(spec.k).length;
    if (!Number.isInteger(combined) || !Number.isInteger(marker)) {
      throw new Error(`G×daehan k=${spec.k}: 필러 길이가 정수가 아니다`);
    }
  }
}
