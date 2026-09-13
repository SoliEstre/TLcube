/** Type K의 인코더 정본 바인딩: 기본·대한·CM 예약 변형. 중앙 그림은 같은 와이어다. */
import { VERSIONS_K, VERSIONS_K_DAEHAN, capacityForK, capacityForKDaehan } from '../../capacityK.js';
import { VERSIONS_KCM, capacityForKMarker, dataCellsInScanOrderKMarker } from '../../markerK.js';
import { dataCellsInScanOrderK } from '../../layoutK.js';
import { daehanReservedCells } from '../../finder-daehan.js';
import { createPlanarProfile } from './planar-binding.js';

const variants = [
  ...VERSIONS_K.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForK, scan: dataCellsInScanOrderK, formatIndex: spec.formatIndex })),
  ...VERSIONS_K_DAEHAN.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForKDaehan, scan: (k) => dataCellsInScanOrderK(k, daehanReservedCells(k)), formatIndex: spec.formatIndex })),
  ...VERSIONS_KCM.map((spec) => ({ layoutId: spec.name, spec, capacity: capacityForKMarker, scan: dataCellsInScanOrderKMarker, formatIndex: spec.formatIndex })),
];
export const R2_TYPE_K_PROFILE = createPlanarProfile('K', variants);
