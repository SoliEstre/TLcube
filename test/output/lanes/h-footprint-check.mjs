// H 파인더의 꼭짓점 셀이 O-CM 이 «예약해 둔» 자리와 정확히 겹치는가.
// 겹치면 「CM = 자리 예약, H = 그 자리의 심볼」이라는 운영자 규정이 코드로 확인된다.
import fs from 'node:fs';
import { markerCells, markerTetrads } from '../../../src/markerO.js';

const H = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const key = (q, r) => q + ',' + r;

const overrideCells = new Set(H.toneOverrides.map((o) => key(o.q, o.r)));
const nonData = new Set(H.userNonData.map((c) => key(c.q, c.r)));
const cm = markerCells(H.k);
const cmKeys = new Set(cm.map((c) => key(c.q, c.r)));

console.log('H (k=' + H.k + ') · finderMode=' + H.finderMode + ' · starter=' + H.finderStarter);
console.log('  toneOverrides 가 닿는 셀 : ' + overrideCells.size + '개');
console.log('  userNonData             : ' + nonData.size + '개');
console.log('  counts.detector         : ' + H.counts.detector);
console.log('  중앙 cellMasks          : ' + H.finderPattern.cellMasks.length + '개');
console.log('');
console.log('O-CM markerCells(' + H.k + ') : ' + cm.length + '개');
const tet = markerTetrads(H.k);
console.log('  tetrad ' + tet.length + '개 × ' + (tet[0]?.cells?.length ?? '?') + '셀');
console.log('');

const inCm = [...overrideCells].filter((k) => cmKeys.has(k));
const outCm = [...overrideCells].filter((k) => !cmKeys.has(k));
const cmNotH = [...cmKeys].filter((k) => !overrideCells.has(k));
console.log('겹침 판정:');
console.log('  H 톤셀 중 O-CM 자리 안 : ' + inCm.length + '/' + overrideCells.size);
console.log('  H 톤셀 중 O-CM 밖      : ' + outCm.length + (outCm.length ? '  → ' + outCm.join(' ') : ''));
console.log('  O-CM 자리 중 H 가 안 쓴 : ' + cmNotH.length + (cmNotH.length ? '  → ' + cmNotH.join(' ') : ''));
console.log('');
console.log('O-CM 좌표: ' + [...cmKeys].sort().join(' '));
console.log('H  톤셀 : ' + [...overrideCells].sort().join(' '));
