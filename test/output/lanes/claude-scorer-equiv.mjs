/**
 * claude-scorer-equiv.mjs — 새 방향 채점기가 Type Y 에서 기존 경로와 **같은 답**을 내는가.
 *
 * `orientation-scorer.js` 는 O/A/K 대비 «좌표 회전 ∘ 면 순환» 합성 사상을 가설로 받는
 * 타입 비종속 채점기다. 기존 `cellSurfaceY-detect.js` 는 **면 순환만** 쓴다 (좌표 항등).
 * Type Y 는 좌표 회전이 항등이므로 **두 경로가 같은 답을 내야 한다** — 그게 이 배선의
 * 안전 조건이다. 다르면 붙이는 순간 오늘 검증한 v0T/v0TR 이득이 흔들린다.
 *
 * 게이트 상수는 새 모듈이 «완화 아님, 동일 계승» 으로 같은 값을 들고 있다
 * (0.78 · 0.035 · 8 · 0.28). 그 사실도 여기서 대조한다 — 주석의 주장은 사실이어야 한다.
 *
 * 재는 것: 활성 n=21 레이아웃 전부에서 정방향·회전 2상의 agreement 와 margin.
 */

import {
  UNVERIFIED_ORIENTATION_SCORER, idealAgreement, scoreLayoutOrientation,
  FACE_CYCLE_CW, FACE_CYCLE_CW2, FACE_IDENTITY,
} from '../../../src/decoder/orientation-scorer.js';
import {
  locatorCellsCellSurfaceFinal, finalLayoutIdsForN,
} from '../../../src/cellSurfaceFinal.js';

console.log('=== ① 게이트 상수 대조 (주석의 «동일 계승» 이 사실인가) ===');
const yDetect = await import('../../../src/decoder/cellSurfaceY-detect.js');
const yCfg = yDetect.UNVERIFIED_CELL_SURFACE_Y;
if (!yCfg) {
  console.log('  ★ cellSurfaceY-detect 가 UNVERIFIED_CELL_SURFACE_Y 를 안 내보낸다 — 대조 불가');
} else {
  let same = true;
  for (const key of Object.keys(UNVERIFIED_ORIENTATION_SCORER)) {
    const a = UNVERIFIED_ORIENTATION_SCORER[key];
    const b = yCfg[key];
    const ok = a === b;
    if (!ok) same = false;
    console.log(`  ${key.padEnd(26)} scorer=${String(a).padEnd(8)} Y=${String(b).padEnd(8)}`
      + (ok ? 'ok' : '★다름'));
  }
  console.log('  → ' + (same ? '동일 계승 확인' : '★ 주석의 주장이 사실이 아니다'));
}

console.log('\n=== ② 면 순환 사상 대조 ===');
console.log('  scorer CW  :', JSON.stringify(FACE_CYCLE_CW));
console.log('  scorer CW2 :', JSON.stringify(FACE_CYCLE_CW2));
console.log('  scorer ID  :', JSON.stringify(FACE_IDENTITY));
console.log('  (rotation-kat 실측 고정값 T→R→L→T 인가를 눈으로 확인한다)');

console.log('\n=== ③ 이상 표본에서의 agreement — 활성 n=21 전부 ===');
console.log('레이아웃   상        agreement   판정');
for (const id of finalLayoutIdsForN(21)) {
  // 계약: layout = [{key, tones:{T,L,R}}], 가설 = {id, mapKey, faceMap}.
  // Type Y 는 **좌표 회전이 항등**이므로 mapKey 를 항등으로 준다 — 그래서 이 대조가
  // 「좌표 회전 ∘ 면 순환」의 면 순환 성분만 남긴 것이 되고, 기존 Y 경로와 같은 조건이 된다.
  const layout = locatorCellsCellSurfaceFinal(21, id).map((c) => ({
    key: c.i + ',' + c.j,
    tones: { T: c.T, L: c.L, R: c.R },
  }));
  for (const [label, faceMap] of [
    ['정방향', FACE_IDENTITY], ['120°', FACE_CYCLE_CW], ['240°', FACE_CYCLE_CW2],
  ]) {
    let value = null;
    try {
      value = idealAgreement(layout, { id: label, faceMap, mapKey: (k) => k }).agreement;
    } catch (error) {
      value = 'ERR ' + (error instanceof Error ? error.message : String(error)).slice(0, 40);
    }
    const num = typeof value === 'number' ? value.toFixed(4) : String(value);
    // ⚠ 판정 기준 정정 (1차 오독): 회전 상의 **절대 agreement** 를 게이트 0.78 과
    // 비교하면 «0.90 이니 뚫렸다» 로 읽힌다. 틀렸다 — 이 채점기의 판정 축은
    // `margin = 항등 − 최고 라이벌` 이다 (모듈 주석 §scoreLayoutOrientation).
    // 실제로 v0t 는 1 − 0.9038 = 0.0962 로 정본 margin 과 **정확히 같다**.
    // 그러니 회전 상에서 볼 것은 «게이트를 넘는가» 가 아니라 «1 − 값 ≥ 0.035 인가» 다.
    const verdict = typeof value === 'number'
      ? (label === '정방향'
        ? (value >= 0.999 ? '자기 상 = 1.0 ✅' : '★정방향이 1.0 이 아니다')
        : ((1 - value) >= 0.035
          ? `margin ${(1 - value).toFixed(4)} ✅` : `★margin ${(1 - value).toFixed(4)} 미달`))
      : '';
    console.log(`${id.padEnd(10)}${label.padEnd(10)}${num.padEnd(12)}${verdict}`);
  }
}
console.log('\n판독: 정방향 1.0 · 회전 2상 < 0.78 이면 Y 에서 새 채점기가 기존과 같은 결론이다.');
console.log('      함수 시그니처가 달라 ERR 이 나면 배선 전에 계약부터 맞춰야 한다.');
