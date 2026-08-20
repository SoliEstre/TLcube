// formatIndex × k 점유를 «코드에서 유도» 한다 — 손으로 세지 않는다.
import { hexTriAxisOccupancy, TURN_A_FORMAT_INDEX, K1_RESERVED_FORMAT_INDEX, CUBE_AXIS_FORMAT_INDEXES }
  from '../../../src/turnA.js';
import { MARKER_G_FORMAT_INDEX } from '../../../src/markerG.js';

const K_VALUES = [6, 8, 10];
const grid = new Map(); // "idx,k" -> [owner…]
const put = (idx, k, owner) => {
  const key = idx + ',' + k;
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(owner);
};

for (const row of hexTriAxisOccupancy()) put(row.formatIndex, row.k, row.owner);
for (const row of TURN_A_FORMAT_INDEX) put(row.formatIndex, row.k, row.name + '(턴A·미배선)');
for (const row of MARKER_G_FORMAT_INDEX) put(row.formatIndex, row.k, row.name + '(G·배선됨)');

console.log('── 현행 점유 (hex/tri 실배선 + 턴A 예약 + 내부 타입 G) ──');
for (let idx = 0; idx < 16; idx += 1) {
  const cells = K_VALUES.map((k) => {
    const v = grid.get(idx + ',' + k);
    return String(k) + ':' + (v ? v.join('+') : '—');
  });
  const note = idx === K1_RESERVED_FORMAT_INDEX ? '  ⚠ K1 예약'
    : CUBE_AXIS_FORMAT_INDEXES.includes(idx) ? '  ⚠ cube 축' : '';
  console.log(String(idx).padStart(2) + ' | ' + cells.join('  ') + note);
}

console.log('\n── 충돌 (같은 idx,k 를 둘 이상이 쓴다) ──');
let clash = 0;
for (const [key, owners] of grid) if (owners.length > 1) { console.log('  ' + key + ' : ' + owners.join(' vs ')); clash += 1; }
if (clash === 0) console.log('  없음');

console.log('\n── 빈 (idx,k) — K1·cube 예약 제외 ──');
const free = [];
for (let idx = 0; idx < 16; idx += 1) {
  if (idx === K1_RESERVED_FORMAT_INDEX || CUBE_AXIS_FORMAT_INDEXES.includes(idx)) continue;
  for (const k of K_VALUES) if (!grid.has(idx + ',' + k)) free.push(idx + ',' + k);
}
console.log('  ' + free.length + '칸: ' + free.join(' · '));
console.log('\n── 내부 타입 G (2026-08-20 배선) ──');
console.log('  O-CM 과 A-CM 은 **갈랐다** (6칸) — (formatIndex, k) 쌍당 소유자 1 관례 보존.');
console.log('  centerQr 는 마커와 배타(인코더가 던진다)라 Q 변형은 없다.');
