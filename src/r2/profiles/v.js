/** Type V(턴 A)의 바인딩. 좌표는 A 정본을 180도 turn 정본으로 옮긴다. */
import { VERSIONS_A, VERSIONS_A_DAEHAN, capacityForA, capacityForADaehan } from '../../capacityA.js';
import { VERSIONS_ACM, capacityForAMarker, dataCellsInScanOrderAMarker } from '../../markerA.js';
import { dataCellsInScanOrderA } from '../../layoutA.js';
import { regionCellsA, regionCellsTurnA } from '../../placementA.js';
import { daehanReservedCells } from '../../finder-daehan.js';
import { TURN_A_FORMAT_INDEX } from '../../turnA.js';
import { createPlanarProfile } from './planar-binding.js';

function key(cell) { return `${cell.q},${cell.r}`; }
function turnedScan(k, source) {
  const upright = regionCellsA(k), turned = regionCellsTurnA(k);
  if (upright.length !== turned.length) throw new Error(`V k=${k}: turn 영역 길이가 다르다`);
  const map = new Map(upright.map((cell, i) => [key(cell), turned[i]]));
  return source.map((cell) => {
    const target = map.get(key(cell));
    if (!target) throw new Error(`V k=${k}: turn 정본에 없는 좌표 ${key(cell)}`);
    return { q: target.q, r: target.r, maskQ: cell.q, maskR: cell.r };
  });
}

const baseByVersion = new Map(VERSIONS_A.map((spec) => [spec.version, spec]));
const cmByVersion = new Map(VERSIONS_ACM.map((spec) => [spec.version, spec]));
const daehanByVersion = new Map(VERSIONS_A_DAEHAN.map((spec) => [spec.version, spec]));
const normal = TURN_A_FORMAT_INDEX.filter((entry) => entry.cornerMarker !== true).map((entry) => {
  const spec = baseByVersion.get(entry.version);
  return { layoutId: entry.name, spec, capacity: capacityForA,
    scan: (k) => turnedScan(k, dataCellsInScanOrderA(k)), maskCell: (cell) => ({ q: cell.maskQ, r: cell.maskR }), formatIndex: entry.formatIndex };
});
const marker = TURN_A_FORMAT_INDEX.filter((entry) => entry.cornerMarker === true).map((entry) => {
  const spec = cmByVersion.get(entry.version);
  return { layoutId: entry.name, spec, capacity: capacityForAMarker,
    scan: (k) => turnedScan(k, dataCellsInScanOrderAMarker(k)), maskCell: (cell) => ({ q: cell.maskQ, r: cell.maskR }), formatIndex: entry.formatIndex };
});
// V×대한은 encodeA(turnA:true, daehanFinder:true)의 발행 조합이다. V 표에는 대한 이름
// 행이 없으므로 turn 표 이름 + D를 조합하되, 용량·예약·좌표는 모두 기존 정본에서 유도한다.
const daehan = VERSIONS_A_DAEHAN.flatMap((spec) => {
  const variants = TURN_A_FORMAT_INDEX.filter((entry) => entry.version === spec.version && entry.cornerMarker !== true);
  return variants.map((turn) => ({ layoutId: `V${turn.version}D${turn.centerQr ? 'Q' : ''}`, spec: daehanByVersion.get(spec.version), capacity: capacityForADaehan,
    scan: (k) => turnedScan(k, dataCellsInScanOrderA(k, daehanReservedCells(k))), maskCell: (cell) => ({ q: cell.maskQ, r: cell.maskR }), formatIndex: turn.formatIndex }));
});
export const R2_TYPE_V_PROFILE = createPlanarProfile('V', [...normal, ...marker, ...daehan]);
