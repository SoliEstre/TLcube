// finder-oak-lineup.test.js — O/A/K 라인업 회귀 (oak2 ① Nitrogen 폐기 · ② daehan 편입)
//
// 폐기 규약 회귀가 본론이다: 구 Nitrogen 은 liveOakCandidates() 에 **없어야** 하고
// (내림), OAK_LINEUP 에는 **있어야** 한다 (차단이지 삭제가 아니다). daehan 은 그
// 반대다. 정본 JSON 이 있는 기계에서는 표의 수치를 정본에서 재계산해 대조한다
// (margin 재계산 = «좌표 회전 ∘ 면 순환» 합성 — claude-oak-margins.mjs 규약).
//
// 정본 팩 경로는 두 배치 관례를 탐침한다 — 기계 고정 절대경로는 다른 체크아웃에서
// 조용히 skip 되어 거짓 초록이 되므로 금지 (통합자 수정 2026-08-17 의 규약 승계):
//   ① 중첩 체크아웃  <바깥repo>/TLcube/test → ../../.agent/...
//   ② 형제 워크트리  E:/WorkBase/wt-* → ../../TrilLuminanceCube/.agent/...

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OAK_LINEUP, OAK_STATUSES, liveOakCandidates, oakCandidate,
} from '../src/finder-oak-lineup.js';
import {
  FACE_CYCLE_CW, FACE_CYCLE_CW2,
  hexHypothesis, hexKey, hexLayoutFrom, hexRotationHypotheses,
  idealAgreement, scoreLayoutOrientation,
} from '../src/decoder/orientation-scorer.js';

const DATA_LAYOUTS = ['../../.agent/decoder/data/', '../../TrilLuminanceCube/.agent/decoder/data/'];
function canonicalPathOrNull(fileName) {
  for (const rel of DATA_LAYOUTS) {
    const p = fileURLToPath(new URL(rel + fileName, import.meta.url));
    if (existsSync(p)) return p;
  }
  return null;
}

test('폐기 회귀 — 구 Nitrogen 은 내려가 있고, 기록은 남아 있다', () => {
  const live = liveOakCandidates();
  assert.ok(!live.some((e) => e.name === 'Nitrogen'), '구 Nitrogen 이 살아 있는 라인업에 있다');
  const dead = oakCandidate('Nitrogen');
  assert.ok(dead, '구 Nitrogen 기록이 삭제됐다 — 드랍 규약은 차단이지 삭제가 아니다');
  assert.equal(dead.status, 'dead');
  assert.equal(dead.margin, 0.0351, 'dead 사유(게이트 동률 margin)가 기록에서 사라졌다');
});

test('Nitrogen r2 드랍 — 카드만 닫고 패턴·판독 명부는 보존한다', async () => {
  const row = oakCandidate('Nitrogen r2');
  assert.ok(row, 'Nitrogen r2 기록이 삭제됐다 — 드랍 규약은 차단이지 삭제가 아니다');
  assert.equal(row.status, 'dropped');
  assert.equal(row.id, 'O-1r2-central3tone');
  assert.match(row.note, /Footprint/);

  assert.equal(liveOakCandidates().some((e) => e.name === 'Nitrogen r2'), false);
  const { getOakFinderPattern, OAK_FINDER_PATTERN_IDS } = await import('../src/finder-oak-patterns.js');
  assert.ok(OAK_FINDER_PATTERN_IDS.includes('oak-nitrogen-r2'),
    'Nitrogen r2 검출 패턴이 삭제됐다 — 발행 프레임 호환이 깨진다');
  assert.ok(getOakFinderPattern('oak-nitrogen-r2'),
    'Nitrogen r2 렌더/판독 패턴 조회가 삭제됐다');
});

test('편입 회귀 — daehan 은 살아 있는 O 후보다', () => {
  const live = liveOakCandidates();
  const d = live.find((e) => e.name === 'daehan');
  assert.ok(d, 'daehan 이 살아 있는 라인업에 없다');
  assert.equal(d.type, 'O');
  assert.equal(d.finderMode, 'full-surface');
  assert.equal(d.finderStarter, 'bullseye', '두 축 독립 반례 증거 — starter 는 순수 불스아이');
  assert.equal(d.margin, 0.6452);
  assert.ok(d.mirrorAgreement < 0.78, 'daehan 거울은 톤 게이트 미달이어야 한다 (최초 후보)');
});

test('표 정합성 — 지위 규약·A/K 유일성·이름 유일성', () => {
  const names = new Set();
  for (const e of OAK_LINEUP) {
    assert.ok(!names.has(e.name), '이름 중복: ' + e.name);
    names.add(e.name);
    assert.ok(OAK_STATUSES.includes(e.status), e.name + ' 지위 오류');
  }
  const live = liveOakCandidates();
  assert.equal(live.filter((e) => e.type === 'A').length, 1);
  assert.equal(live.filter((e) => e.type === 'K').length, 1);
  assert.equal(oakCandidate('Xylene').status, 'dropped', '정본 _default_policy 탈락 확정 반영');
});

// ── 정본 대조 (JSON 있는 기계에서만 — 없으면 사유 명시 skip) ────────────────

function layoutOfCandidate(cand) {
  const cells = new Map();
  const touch = (q, r) => {
    const k = hexKey(q, r);
    if (!cells.has(k)) cells.set(k, { q, r, tones: { T: 1, L: 1, R: 1 } });
    return cells.get(k);
  };
  for (const [q, r] of cand.userNonData) touch(q, r);
  for (const face of ['T', 'L', 'R']) {
    for (const [q, r, tone] of (cand.toneOverrides[face] || [])) touch(q, r).tones[face] = tone;
  }
  return hexLayoutFrom([...cells.values()]);
}

test('정본 대조 — oak 7종의 표 margin·지위가 정본 JSON 과 일치한다', (t) => {
  const path = canonicalPathOrNull('finder-oak-candidates.json');
  if (!path) {
    t.skip('finder-oak-candidates.json 없음 — 정본 있는 기계에서 도는 검증이다');
    return;
  }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  for (const cand of doc.candidates) {
    const row = oakCandidate(cand.name);
    assert.ok(row, cand.name + ' 이 표에 없다');
    assert.equal(row.id, cand.id);
    assert.equal(row.type, cand.type);
    assert.equal(row.counts.total, cand.counts.total);
    assert.equal(row.counts.detector, cand.counts.detector);
    const scored = scoreLayoutOrientation(layoutOfCandidate(cand), hexRotationHypotheses());
    assert.ok(
      Math.abs(scored.orientationMargin - row.margin) < 5e-4,
      cand.name + ' margin 재계산 ' + scored.orientationMargin.toFixed(4) + ' vs 표 ' + row.margin,
    );
    if (typeof cand._status === 'string' && cand._status.startsWith('dead')) {
      assert.equal(row.status, 'dead', cand.name + ' 정본 _status dead 인데 표 지위가 다르다');
    }
  }
});

test('정본 대조 — daehan 편입 수치가 정본 JSON 에서 재현된다', (t) => {
  const path = canonicalPathOrNull('finder-daehan-editor.json');
  if (!path) {
    t.skip('finder-daehan-editor.json 없음 — 정본 있는 기계에서 도는 검증이다');
    return;
  }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const row = oakCandidate('daehan');

  // 전사 대조 (_transcriptionCheck — 손 전사 오류 방지 독립 계수)
  const cells = doc.cells.map(([q, r, T, L, R]) => ({ q, r, tones: { T, L, R } }));
  assert.equal(cells.length, doc._transcriptionCheck.cells);
  for (const face of ['T', 'L', 'R']) {
    assert.equal(
      cells.filter((c) => c.tones[face] === 2).length,
      doc._transcriptionCheck.brightPerFace[face],
      'bright ' + face + ' 전사 불일치',
    );
  }
  assert.equal(row.counts.total, doc.counts.total);
  assert.equal(row.counts.detector, cells.length);

  // margin 재계산 = 표 값
  const layout = hexLayoutFrom(cells);
  const scored = scoreLayoutOrientation(layout, hexRotationHypotheses());
  assert.equal(scored.orientationMargin.toFixed(4), row.margin.toFixed(4));

  // 거울 두 관례 재계산 = 표 값 (물리: 거울 좌표 ∘ L↔R 스왑 합성 3종 최고 ·
  // 통합자: 거울 좌표 ∘ 면 순환 3종 최고 — 관례 규명은 claude-oak2-daehan.mjs §C)
  const MIR = (q, r) => ({ q: -q - r, r });
  const SWAP = { T: 'T', L: 'R', R: 'L' };
  const rot120 = (q, r) => ({ q: -q - r, r: q });
  const rot240 = (q, r) => ({ q: r, r: -q - r });
  const compose = (outer, inner) => (q, r) => { const p = inner(q, r); return outer(p.q, p.r); };
  const composeFace = (outer, inner) => {
    const m = {};
    for (const f of ['T', 'L', 'R']) m[f] = outer[inner[f]];
    return m;
  };
  const bestOf = (hyps) => Math.max(...hyps.map((h) => idealAgreement(layout, h).agreement));
  const physical = bestOf([
    hexHypothesis('m0', MIR, SWAP),
    hexHypothesis('m120', compose(rot120, MIR), composeFace(FACE_CYCLE_CW, SWAP)),
    hexHypothesis('m240', compose(rot240, MIR), composeFace(FACE_CYCLE_CW2, SWAP)),
  ]);
  assert.equal(physical.toFixed(4), row.mirrorAgreement.toFixed(4));
  const integratorConvention = bestOf([
    hexHypothesis('mc0', MIR, { T: 'T', L: 'L', R: 'R' }),
    hexHypothesis('mc1', MIR, FACE_CYCLE_CW),
    hexHypothesis('mc2', MIR, FACE_CYCLE_CW2),
  ]);
  assert.equal(
    integratorConvention.toFixed(4),
    row.mirrorAgreementIntegratorConvention.toFixed(4),
  );
  assert.ok(physical < 0.78 && integratorConvention < 0.78,
    '거울 톤 기각은 두 관례 모두에서 성립해야 한다');
});

/*
 * ── 명부 ↔ 파인더 패턴 레지스트리 결속 (2026-08-18, 첫 배선) ────────────────
 *
 * `finder-oak-lineup.js` 는 지금까지 **아무도 import 하지 않는 고아 모듈**이었다
 * (grep 확인). 테스트가 초록이어도 런타임은 한 비트도 안 바뀌는 상태였다
 * ([[green-tests-are-not-a-working-ui]]).
 *
 * 첫 배선은 «명부가 실재하는 어휘를 쓴다» 를 잠그는 것이다. 명부의 `finderStarter`
 * 는 `finder-patterns.js` 의 패턴 id 와 **같은 문자열 공간**을 쓰는데, 지금은 아무도
 * 대조하지 않아 오타가 나도 조용히 통과한다. 여기서 묶으면 한쪽이 바뀔 때 다른 쪽이
 * 터진다 — 그게 결속의 값어치다.
 *
 * ⚠ 이 테스트는 **검출 라인업 편입이 아니다.** O/A/K 후보가 실제로 스캔되려면
 * 채점기(orientation-scorer)와 타입별 검출 경로가 더 붙어야 한다. 여기서 잠그는
 * 것은 «명부가 거짓말하지 않는다» 까지다.
 */
test('명부의 finderStarter 는 전부 finder-patterns 의 실재 id 다', async () => {
  const patterns = await import('../src/finder-patterns.js');
  const known = new Set(Object.values(patterns).filter((v) => typeof v === 'string'));
  // 레지스트리가 이 셋을 갖고 있다는 것 자체도 못 박는다 (한쪽만 바뀌는 것 방지).
  for (const id of ['bullseye', 'cube-bullseye', 'central-cube-3tone']) {
    assert.ok(known.has(id), 'finder-patterns 에 ' + id + ' 가 없다');
  }
  for (const entry of OAK_LINEUP) {
    assert.ok(known.has(entry.finderStarter),
      entry.name + ' 의 finderStarter «' + entry.finderStarter + '» 가 레지스트리에 없다');
  }
  // 살아있는 후보가 하나도 없으면 명부가 무의미하다 — 전부 dead/dropped 로 흘러가는
  // 것을 막는 하한이다 (드랍은 차단이지 삭제가 아니라는 규약의 회귀).
  assert.ok(liveOakCandidates().length >= 5,
    '살아있는 O/A/K 후보가 5 미만이다: ' + liveOakCandidates().map((c) => c.name).join(','));
});

test('드랍하면 카드가 닫힌다 — 이름 조인 전수 유도 (갤러리 레인 적발 회귀)', async () => {
  // id/candidate 키 조인은 footprint·daehan 행에서 어긋나 «미스=유지» 폴백과 만나
  // 드랍 규약이 무력했다 (2026-08-24 수리 — finder-card-ui 이름 조인 + 미스 throw).
  // 여기서는 표현 전수에 대해 「명부 지위 ↔ 카드 존재」가 1:1 임을 유도로 잠근다.
  const { OAK_ALL_FINDER_PATTERNS } = await import('../src/finder-oak-patterns.js');
  const { FINDER_CARD_GROUPS } = await import('../src/finder-card-ui.js');
  const cardIds = new Set(FINDER_CARD_GROUPS.oak.map((card) => card.id));
  for (const pattern of OAK_ALL_FINDER_PATTERNS) {
    const row = OAK_LINEUP.find((entry) => entry.name === pattern.lineupName);
    assert.ok(row, pattern.lineupName + ' 이 명부에 없다 (②-b 규약 위반)');
    assert.equal(cardIds.has(pattern.id), row.status === 'active',
      pattern.lineupName + ' (' + row.status + ') 의 카드 존재가 명부 지위와 어긋났다');
  }
});
