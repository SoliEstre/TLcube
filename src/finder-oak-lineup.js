/**
 * finder-oak-lineup.js — O/A/K 파인더 후보 라인업 표 (oak2 ①·②).
 *
 * 정본 셀 데이터는 바깥 repo 의 `finder-oak-candidates.json` · `finder-daehan-editor.json`
 * 이고 (repo 밖 — 읽기만), 이 모듈은 그 **명부(roster)** 를 코드로 든다. 표가 유일한
 * 진실이고 산술 유도가 없다 (turnA.js 전례 — 표 주도 + 로드 자기검증).
 *
 * 지위 규약 (이 프로젝트의 드랍 규약 — 차단이지 삭제가 아니다):
 *  · `active`  — 살아 있는 후보. liveOakCandidates() 에 나온다.
 *  · `dead`    — 구 Nitrogen. margin 0.0351 = 게이트 동률 사망(정본 `_status`,
 *                2026-08-15) + 운영자 폐기 확정 (2026-08-17, 재논의 금지 —
 *                «r2 가 같은 19셀 발자국의 재도색 결과물이므로 재도색 선택지는 소진»).
 *  · `dropped` — Xylene. 정본 `_default_policy` «탈락 확정: Xylene(v2r2 하회)».
 *
 * daehan 편입 (2026-08-17, 운영자 확정 + 통합자 실측을 이 레인이 재현):
 *  · margin 0.6452 (게이트 0.035 의 18.4×) — 재현: claude-oak2-daehan.mjs §B
 *  · 거울 agreement: 물리 관례(거울 좌표 ∘ L↔R 스왑) 0.6774 · 통합자 공표 관례
 *    (거울 좌표 ∘ 면 순환 — orientation-scorer.js hexAuxCoordMaps 주석의 스윕) 0.6559.
 *    **두 값 모두 게이트 0.78 미달 — 거울이 톤 게이트에서 기각되는 최초의 후보다**
 *    (기존 후보들은 물리 관례 0.8246~1.0000 전원 공변 — 거울 방어를 자세 체인
 *    det<0 배제에 의존). 재현·관례 규명: claude-oak2-daehan.mjs §C·§C2·§D.
 *  · 두 축 독립의 반례 증거: finderStarter 가 순수 불스아이(bullseye)인데 margin
 *    0.6452 — 방향은 starter 가 아니라 **셀 표면**(full-surface 31셀)이 진다 (운영자
 *    정정 2026-08-17: finderMode 와 finderStarter 는 다른 축이다).
 *
 * margin = «좌표 회전(rotate120) ∘ 면 순환(T→R→L)» 합성 사상 기준 (정본
 * `_margins_canonical` 규약 — claude-oak-margins.mjs 가 재측정 정본 스크립트).
 * mirrorAgreement 는 물리 관례 값을 든다 (7후보는 oak ④ 픽셀 스윕 실측과 동치 확인).
 *
 * 이 모듈은 어떤 파이프라인에도 배선되지 않았다 (MODULE_ORDER 미등재 — turnA.js·
 * orientation-scorer.js 전례, 번들 바이트 무영향). UI 배선은 통합자 몫이다.
 */

export const OAK_STATUSES = Object.freeze(['active', 'dead', 'dropped']);

const entry = (e) => Object.freeze({ ...e, counts: Object.freeze({ ...e.counts }) });

export const OAK_LINEUP = Object.freeze([
  entry({
    name: 'H2O', id: 'A-central3tone', type: 'A', status: 'active',
    finderMode: 'central-finder', finderStarter: 'central-cube-3tone',
    counts: { total: 91, detector: 18 },
    margin: 0.6667, mirrorAgreement: 1.0,
    note: '코너 18셀 margin — 중앙 19셀 기여 별도 (4갈래 실측: claude-oak2-central4.mjs)',
  }),
  entry({
    name: 'H2CO3', id: 'K-central3tone', type: 'K', status: 'active',
    finderMode: 'central-finder', finderStarter: 'central-cube-3tone',
    counts: { total: 121, detector: 30 },
    margin: 0.4667, mirrorAgreement: 1.0,
    note: '코너 30셀 margin — 중앙 19셀 기여 별도 (동상)',
  }),
  entry({
    name: 'Nitrogen', id: 'O-1-central3tone', type: 'O', status: 'dead',
    finderMode: 'full-surface', finderStarter: 'central-cube-3tone',
    counts: { total: 61, detector: 19 },
    margin: 0.0351, mirrorAgreement: 1.0,
    note: '정본 _status dead (margin = 게이트 동률) · 운영자 폐기 확정 2026-08-17 — 차단이지 삭제가 아니다',
  }),
  entry({
    name: 'Nitrogen r2', id: 'O-1r2-central3tone', type: 'O', status: 'active',
    finderMode: 'full-surface', finderStarter: 'central-cube-3tone',
    counts: { total: 61, detector: 19 },
    margin: 0.2982, mirrorAgreement: 0.8246,
    note: '구 Nitrogen 승계판 (같은 19셀 발자국 재도색) — 거울 공변 7후보 중 최저',
  }),
  entry({
    name: 'Aspirin', id: 'O-2-central3tone', type: 'O', status: 'active',
    finderMode: 'full-surface', finderStarter: 'central-cube-3tone',
    counts: { total: 61, detector: 19 },
    margin: 0.3333, mirrorAgreement: 0.9298,
  }),
  entry({
    name: 'Benzene', id: 'O-3-bullseye', type: 'O', status: 'active',
    finderMode: 'full-surface', finderStarter: 'cube-bullseye',
    counts: { total: 61, detector: 19 },
    margin: 0.386, mirrorAgreement: 1.0,
  }),
  entry({
    name: 'Xylene', id: 'O-4-bullseye', type: 'O', status: 'dropped',
    finderMode: 'full-surface', finderStarter: 'cube-bullseye',
    counts: { total: 61, detector: 19 },
    margin: 0.1754, mirrorAgreement: 1.0,
    note: '정본 _default_policy «탈락 확정: Xylene(v2r2 하회)» — 차단이지 삭제가 아니다',
  }),
  entry({
    name: 'daehan', id: 'O-daehan', type: 'O', status: 'active',
    finderMode: 'full-surface', finderStarter: 'bullseye',
    counts: { total: 127, detector: 31 },
    margin: 0.6452, mirrorAgreement: 0.6774,
    mirrorAgreementIntegratorConvention: 0.6559,
    note: '편입 2026-08-17 — O 최고 margin(게이트 18.4×) · 거울 톤 기각 최초 후보 · '
      + 'starter 순수 불스아이인데 margin 0.6452 (두 축 독립의 반례 증거) · '
      + '정본 finder-daehan-editor.json (n=6 · 점유 31/127 = 24.4 %)',
  }),
]);

/** 살아 있는 후보만 — dead(구 Nitrogen)·dropped(Xylene)는 여기 안 나온다. */
export function liveOakCandidates() {
  return OAK_LINEUP.filter((e) => e.status === 'active');
}

/** 이름으로 조회 (지위 무관 — 기록 보존 규약상 dead 도 조회는 된다). */
export function oakCandidate(name) {
  return OAK_LINEUP.find((e) => e.name === name) || null;
}

// ── 로드 자기검증 (turnA.js 전례) ────────────────────────────────────────────
{
  const names = new Set();
  for (const e of OAK_LINEUP) {
    if (names.has(e.name)) throw new Error('oak 라인업 이름 중복: ' + e.name);
    names.add(e.name);
    if (!OAK_STATUSES.includes(e.status)) {
      throw new Error('oak 라인업 지위 오류: ' + e.name + ' = ' + e.status);
    }
    if (e.status === 'active' && !(e.margin >= 0.035)) {
      throw new Error('active 후보의 margin 이 게이트(0.035) 미만: ' + e.name);
    }
  }
  const live = liveOakCandidates();
  if (live.some((e) => e.name === 'Nitrogen')) {
    throw new Error('구 Nitrogen 이 살아 있는 라인업에 있다 — 폐기 회귀 위반');
  }
  if (live.filter((e) => e.type === 'A').length !== 1
    || live.filter((e) => e.type === 'K').length !== 1) {
    throw new Error('A·K 는 정확히 1후보씩이어야 한다');
  }
  if (!live.some((e) => e.name === 'daehan')) {
    throw new Error('daehan 이 살아 있는 라인업에 없다 — 편입 회귀 위반');
  }
}
