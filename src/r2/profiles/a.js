/** Type A의 인코더 정본 바인딩: 기본·대한·CM 예약과 중앙 QR 와이어. */
import { VERSIONS_A, VERSIONS_A_DAEHAN, capacityForA, capacityForADaehan } from '../../capacityA.js';
import { VERSIONS_ACM, capacityForAMarker, dataCellsInScanOrderAMarker } from '../../markerA.js';
import { markerGSpec } from '../../markerG.js';
import { dataCellsInScanOrderA } from '../../layoutA.js';
import { daehanReservedCells } from '../../finder-daehan.js';
import { createPlanarProfile } from './planar-binding.js';

const variants = [
  ...VERSIONS_A.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForA, scan: dataCellsInScanOrderA, formatIndex: spec.formatIndex })),
  ...VERSIONS_A.map((spec) => ({ layoutId: `${spec.name}Q`, spec, capacity: capacityForA, scan: dataCellsInScanOrderA, formatIndex: spec.formatIndex + 2 })),
  ...VERSIONS_A_DAEHAN.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForADaehan, scan: (k) => dataCellsInScanOrderA(k, daehanReservedCells(k)), formatIndex: spec.formatIndex })),
  ...VERSIONS_A_DAEHAN.map((spec) => ({ layoutId: `${spec.name}Q`, spec, capacity: capacityForADaehan, scan: (k) => dataCellsInScanOrderA(k, daehanReservedCells(k)), formatIndex: spec.formatIndex + 2 })),
  ...VERSIONS_ACM.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForAMarker, scan: dataCellsInScanOrderAMarker, formatIndex: spec.formatIndex })),
  ...VERSIONS_ACM.map((spec) => ({ layoutId: markerGSpec('tri', spec.version, true).name, spec, capacity: capacityForAMarker, scan: dataCellsInScanOrderAMarker, formatIndex: markerGSpec('tri', spec.version, true).formatIndex })),
];
export const R2_TYPE_A_PROFILE = createPlanarProfile('A', variants);
