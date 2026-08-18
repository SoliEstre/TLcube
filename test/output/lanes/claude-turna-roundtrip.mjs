/**
 * claude-turna-roundtrip.mjs — 턴A 왕복: 인코드 → (방향 알림) → 디코드.
 *
 * 마지막 연결(2026-08-18)의 검증. `typeASpecFromFormatIndex(index, turn)` 이
 * 방향을 받아 표를 조회하므로, 턴A 로 만든 코드가 **방향을 아는 디코더**에서
 * 제 버전으로 해석돼야 한다. 그리고 **방향을 모르면(기본) 기존 A 로 본다** —
 * 그것이 종전 동작 보존의 근거다.
 *
 * ⚠ 여기서 재는 것은 «formatIndex 해석» 층이다. 픽셀 왕복(렌더→스캔)이 아니다.
 */
import { encodeA } from '../../../src/encodeA.js';
import { decodeCells } from '../../../src/decode.js';
import { TURN_A_FORMAT_INDEX } from '../../../src/turnA.js';
import { VERSIONS_A } from '../../../src/capacityA.js';

/*
 * 공개 진입점은 `decodeCells(cellDigits, format)` 뿐이라 그것으로 «format 이 해석되는가»
 * 를 잰다. 빈 cellDigits 를 주면 프로파일 해석은 통과하고 그 뒤(본문 부족)에서 실패한다
 * — 즉 **«알 수 없는 formatIndex»** 로 죽으면 해석 실패, 다른 사유면 해석은 성공이다.
 * 자를 이렇게 정한 이유: 해석 층만 떼어 잴 공개 API 가 없다.
 */
const tryProfile = (format) => {
  try {
    decodeCells(new Map(), format);
    return { ok: true, k: null };
  } catch (e) {
    const msg = String(e.message);
    if (/알 수 없|version\/formatIndex/.test(msg)) return { ok: false, err: msg.slice(0, 46) };
    return { ok: true, k: null, note: msg.slice(0, 30) };
  }
};

console.log('=== 턴A — 방향을 알려준 디코더 ===');
console.log('이름    fmtIdx  기대k  결과');
let fail = 0;
for (const entry of TURN_A_FORMAT_INDEX) {
  const enc = encodeA('turnA roundtrip', {
    version: entry.version, centerQr: entry.centerQr, turnA: true,
  });
  const r = tryProfile({ type: 'A', formatIndex: enc.formatIndex, eccLevel: 'M', turn: true });
  const good = r.ok;
  if (!good) fail += 1;
  console.log(`${entry.name.padEnd(8)}${String(enc.formatIndex).padEnd(8)}${String(entry.k).padEnd(7)}`
    + (r.ok ? '해석 성공 ✅' : `★해석 실패 ${r.err}`));
}

console.log('\n=== 기본 A — 방향 미지정 (종전 동작이어야 함) ===');
console.log('버전   fmtIdx  기대k  결과');
for (const spec of VERSIONS_A) {
  for (const [q, idx] of [[false, spec.formatIndex], [true, spec.formatIndex + 2]]) {
    const r = tryProfile({ type: 'A', formatIndex: idx, eccLevel: 'M' });
    const good = r.ok;
    if (!good) fail += 1;
    console.log(`${(spec.name + (q ? 'Q' : '')).padEnd(7)}${String(idx).padEnd(8)}${String(spec.k).padEnd(7)}`
      + (r.ok ? '해석 성공 ✅' : `★해석 실패 ${r.err}`));
  }
}

console.log('\n=== 교차 확인 — A2TQ(3) 과 A0Q(3) 이 방향으로 갈리는가 ===');
const asTurn = tryProfile({ type: 'A', formatIndex: 3, eccLevel: 'M', turn: true });
const asPlain = tryProfile({ type: 'A', formatIndex: 3, eccLevel: 'M' });
console.log(`  fmtIdx 3 · turn=true  → ${asTurn.ok ? '해석 성공 (A2TQ)' : '실패 ' + asTurn.err}`);
console.log(`  fmtIdx 3 · turn=없음  → ${asPlain.ok ? '해석 성공 (A0Q)' : '실패 ' + asPlain.err}`);
const split = asTurn.ok && asPlain.ok;
if (!split) fail += 1;
console.log(`  → ${split ? '양쪽 다 해석된다 (방향이 뜻을 정한다) ✅' : '★한쪽이 못 읽는다'}`);

console.log(`\n실패 ${fail}건`);
