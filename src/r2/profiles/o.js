/** Type O의 인코더 정본 바인딩: 기본·대한·CM·CM대한. 중앙 QR은 같은 데이터 표/다른 포맷이다. */
import { VERSIONS, capacityFor } from '../../capacity.js';
import { VERSIONS_DAEHAN, capacityForDaehan } from '../../capacityDaehan.js';
import { VERSIONS_OCM, capacityForOMarker, dataCellsInScanOrderOMarker } from '../../markerO.js';
import { VERSIONS_OCM_DAEHAN, capacityForOMarkerDaehan, dataCellsInScanOrderOMarkerDaehan } from '../../markerOdaehan.js';
import { dataCellsInScanOrder } from '../../layout.js';
import { daehanReservedCells } from '../../finder-daehan.js';
import { createPlanarProfile } from './planar-binding.js';
import { markerGSpec } from '../../markerG.js';

const variants = [
  ...VERSIONS.map((spec) => ({ layoutId: `V${spec.version}`, spec, capacity: capacityFor, scan: dataCellsInScanOrder, formatIndex: spec.version - 1 })),
  ...VERSIONS.map((spec) => ({ layoutId: `V${spec.version}Q`, spec, capacity: capacityFor, scan: dataCellsInScanOrder, formatIndex: spec.version + 3 })),
  ...VERSIONS_DAEHAN.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForDaehan, scan: (k) => dataCellsInScanOrder(k, daehanReservedCells(k)), formatIndex: spec.version - 1 })),
  // 사괘+QR은 대한 예약을 공유하지만 원자 대한과 달리 중앙 QR을 허용한다.
  ...VERSIONS_DAEHAN.map((spec) => ({ layoutId: `${spec.name}Q`, spec, capacity: capacityForDaehan, scan: (k) => dataCellsInScanOrder(k, daehanReservedCells(k)), formatIndex: spec.version + 3 })),
  ...VERSIONS_OCM.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForOMarker, scan: dataCellsInScanOrderOMarker, formatIndex: spec.formatIndex })),
  ...VERSIONS_OCM.map((spec) => ({ layoutId: markerGSpec('hex', spec.version, true).name, spec, capacity: capacityForOMarker, scan: dataCellsInScanOrderOMarker, formatIndex: markerGSpec('hex', spec.version, true).formatIndex })),
  ...VERSIONS_OCM_DAEHAN.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForOMarkerDaehan, scan: dataCellsInScanOrderOMarkerDaehan, formatIndex: spec.formatIndex })),
  ...VERSIONS_OCM_DAEHAN.map((spec) => ({ layoutId: `${spec.name}Q`, spec, capacity: capacityForOMarkerDaehan, scan: dataCellsInScanOrderOMarkerDaehan, formatIndex: markerGSpec('hex', spec.version, true).formatIndex })),
];
export const R2_TYPE_O_PROFILE = createPlanarProfile('O', variants);
