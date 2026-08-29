import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CENTER_QR_FINDER_PATTERN_ID,
  commitFinderQrTransition,
  createFinderQrProfiles,
  finderPatternConflictsWithInnerQr,
  finderPatternForTypeTransition,
  finderPatternSupportedForType,
  normalizeFinderQrState,
  selectFinderPattern,
  selectGeneratorType,
  selectQrPosition,
} from '../src/finder-selection.js';
import {
  CENTRAL_V0_FINDER_CARD, FINDER_CARD_GROUPS,
} from '../src/finder-card-ui.js';
import { CENTRAL_MARKER_N7_FINDER_PATTERN_ID } from '../src/centralMarkerN7.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';

const OFFICIAL_DEFAULT = 'bullseye';
const TRIAL_DEFAULT = 'pinwheel-c2-2-1100-cw';

function state(overrides = {}) {
  return {
    finderPatternId: OFFICIAL_DEFAULT,
    previousFinderPatternId: OFFICIAL_DEFAULT,
    qrPosition: 'TL',
    previousOuterQrPosition: 'TL',
    ...overrides,
  };
}

test('O/A/K 검출기 선택은 상위 QR 위치를 안쪽으로 바꾸지 못한다', () => {
  for (const type of ['O', 'A', 'K']) {
    const next = selectFinderPattern(
      state(), CENTER_QR_FINDER_PATTERN_ID, type, OFFICIAL_DEFAULT,
    );
    assert.equal(next.finderPatternId, OFFICIAL_DEFAULT);
    assert.equal(next.qrPosition, 'TL');
    assert.equal(next.previousFinderPatternId, OFFICIAL_DEFAULT);
  }
});

test('O/A/K 안쪽 QR 선택은 직전 파인더를 기억하고 중앙 QR을 고른다', () => {
  for (const type of ['O', 'A', 'K']) {
    const next = selectQrPosition(state({
      finderPatternId: TRIAL_DEFAULT,
      previousFinderPatternId: TRIAL_DEFAULT,
    }), 'inner', type, TRIAL_DEFAULT);
    assert.equal(next.finderPatternId, CENTER_QR_FINDER_PATTERN_ID);
    assert.equal(next.qrPosition, 'inner');
    assert.equal(next.previousFinderPatternId, TRIAL_DEFAULT);
  }
});

test('안쪽에서 벗어나면 중앙 QR 대신 직전에 고른 파인더를 복원한다', () => {
  const centered = selectQrPosition(state({
    finderPatternId: TRIAL_DEFAULT,
    previousFinderPatternId: TRIAL_DEFAULT,
  }), 'inner', 'O', TRIAL_DEFAULT);
  const next = selectQrPosition(centered, 'BR', 'O', TRIAL_DEFAULT);
  assert.equal(next.finderPatternId, TRIAL_DEFAULT);
  assert.equal(next.qrPosition, 'BR');
  assert.equal(next.previousOuterQrPosition, 'BR');
});

test('직전 파인더 이력이 없으면 빌드별 기본값으로 복원한다', () => {
  for (const defaultFinder of [OFFICIAL_DEFAULT, TRIAL_DEFAULT]) {
    const next = normalizeFinderQrState(state({
      finderPatternId: CENTER_QR_FINDER_PATTERN_ID,
      previousFinderPatternId: null,
      qrPosition: 'TR',
    }), 'O', defaultFinder);
    assert.equal(next.finderPatternId, defaultFinder);
    assert.equal(next.qrPosition, 'TR');
  }
});

test('안쪽에서 중앙 점유 파인더를 고르면 잠금이 상태를 그대로 보존한다', () => {
  const initial = state({
    finderPatternId: CENTER_QR_FINDER_PATTERN_ID,
    previousFinderPatternId: OFFICIAL_DEFAULT,
    qrPosition: 'inner',
    previousOuterQrPosition: 'BL',
  });
  const next = selectFinderPattern(initial, TRIAL_DEFAULT, 'A', OFFICIAL_DEFAULT);
  assert.deepEqual(next, initial);
});

test('카드 명부에서 안쪽 QR 과 충돌하지 않는 유일한 검출기는 중앙 QR 자신이다', () => {
  const ids = new Set(Object.values(FINDER_CARD_GROUPS).flat().map((card) => card.id));
  ids.add(CENTRAL_V0_FINDER_CARD.id);
  assert.equal(ids.has(CENTER_QR_FINDER_PATTERN_ID), true);
  for (const id of ids) {
    assert.equal(
      finderPatternConflictsWithInnerQr(id),
      id !== CENTER_QR_FINDER_PATTERN_ID,
      id,
    );
  }
});

test('Type Y의 안쪽 윈도는 파인더와 결합하지 않는다', () => {
  const initial = state({ finderPatternId: TRIAL_DEFAULT });
  const inner = selectQrPosition(initial, 'inner', 'Y', TRIAL_DEFAULT);
  assert.equal(inner.finderPatternId, TRIAL_DEFAULT);
  assert.equal(inner.qrPosition, 'inner');
  const outer = selectQrPosition(inner, 'BR', 'Y', TRIAL_DEFAULT);
  assert.equal(outer.finderPatternId, TRIAL_DEFAULT);
  assert.equal(outer.qrPosition, 'BR');
});

test("구 «면»(plane) 값은 안쪽 + 코너측으로 정규화된다 (W2 C3 하위호환)", () => {
  // plane 카드는 (안쪽 여부) × (면 배치) 분해로 삭제됐다 — 구 값이 어떤 경로로
  // 들어와도 «안쪽 + 코너측(far)» 이 그 의미의 정확한 승계다. 스냅샷 복원값
  // previousOuterQrPosition 의 'plane' 은 기본 코너로 강하시킨다.
  const next = normalizeFinderQrState(state({
    qrPosition: 'plane',
    previousOuterQrPosition: 'plane',
    qrFacePlacement: 'seam',
  }), 'Y', OFFICIAL_DEFAULT);
  assert.equal(next.qrPosition, 'inner');
  assert.equal(next.qrFacePlacement, 'far');
  assert.equal(next.previousOuterQrPosition, 'TL');
  // Y 프로파일 스냅샷에 placement 가 실린다 — 타입 왕복에서 배치 선택이 보존된다.
  const profiles = createFinderQrProfiles(OFFICIAL_DEFAULT);
  assert.equal(profiles.Y.qrFacePlacement, 'seam');
  const backFromO = selectGeneratorType(
    selectGeneratorType({ ...state(), type: 'Y', qrFacePlacement: 'far', finderQrProfiles: profiles },
      'O', OFFICIAL_DEFAULT),
    'Y', OFFICIAL_DEFAULT);
  assert.equal(backFromO.qrFacePlacement, 'far');
});

test('타입 전환 기본값은 O/A/K 기본 중앙 파인더 + 바깥 QR이며 Y와 서로 새지 않는다', () => {
  const initial = state({
    type: 'Y',
    finderQrProfiles: createFinderQrProfiles(TRIAL_DEFAULT),
    finderPatternId: TRIAL_DEFAULT,
  });

  const typeO = selectGeneratorType(initial, 'O', TRIAL_DEFAULT);
  assert.equal(typeO.qrPosition, 'TL');
  assert.equal(typeO.finderPatternId, TRIAL_DEFAULT);

  const typeY = selectGeneratorType(typeO, 'Y', TRIAL_DEFAULT);
  assert.equal(typeY.qrPosition, 'TL');
  assert.equal(typeY.finderPatternId, TRIAL_DEFAULT);
});

test('O/A/K 전 타입쌍에서 지원되는 중앙 파인더 선택을 승계한다', () => {
  const types = ['O', 'A', 'K'];
  const activeFinderIds = new Set([
    ...Object.values(FINDER_CARD_GROUPS).flat().map((card) => card.id),
    CENTRAL_V0_FINDER_CARD.id,
  ]);
  // center-qr 은 독립 파인더 선택이 아니라 상위 qrPosition='inner' 의 파생값이다.
  activeFinderIds.delete(CENTER_QR_FINDER_PATTERN_ID);
  for (const sourceType of types) {
    for (const targetType of types) {
      for (const finderPatternId of activeFinderIds) {
        if (!finderPatternSupportedForType(finderPatternId, sourceType)) continue;
        const initial = state({
          type: sourceType,
          finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
          previousFinderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
          finderQrProfiles: createFinderQrProfiles(CENTRAL_N7_FINDER_PATTERN_ID),
        });
        const picked = selectFinderPattern(
          initial, finderPatternId, sourceType, CENTRAL_N7_FINDER_PATTERN_ID,
        );
        const moved = selectGeneratorType(
          picked, targetType, CENTRAL_N7_FINDER_PATTERN_ID,
        );
        const expected = finderPatternSupportedForType(finderPatternId, targetType)
          ? finderPatternId : CENTRAL_N7_FINDER_PATTERN_ID;
        assert.equal(moved.finderPatternId, expected,
          `${sourceType}→${targetType} ${finderPatternId}`);
        assert.equal(
          moved.qrPosition === 'inner',
          moved.finderPatternId === CENTER_QR_FINDER_PATTERN_ID,
          `${sourceType}→${targetType} ${finderPatternId}의 중앙 QR 결합`,
        );
      }
    }
  }
});

test('승계 불가 조합은 QR이 아니라 정의된 기본 중앙 TL로 폴백한다', () => {
  const daehan = FINDER_CARD_GROUPS.daehan[0].id;
  for (const unsupported of [daehan, CENTRAL_MARKER_N7_FINDER_PATTERN_ID]) {
    assert.equal(finderPatternSupportedForType(unsupported, 'K'), false, unsupported);
    assert.equal(finderPatternForTypeTransition(
      unsupported, 'K', CENTRAL_N7_FINDER_PATTERN_ID,
    ), CENTRAL_N7_FINDER_PATTERN_ID, unsupported);
  }
  assert.notEqual(CENTRAL_N7_FINDER_PATTERN_ID, CENTER_QR_FINDER_PATTERN_ID,
    '불가 조합 폴백이 중앙 QR이면 운영자 미결정을 대신하게 된다');
});

test('O/A에서 사용자가 고른 바깥 QR과 파인더는 Y 왕복 뒤 복원된다', () => {
  const initial = state({
    type: 'Y',
    finderQrProfiles: createFinderQrProfiles(TRIAL_DEFAULT),
    finderPatternId: TRIAL_DEFAULT,
  });
  const typeO = selectGeneratorType(initial, 'O', TRIAL_DEFAULT);
  const outer = selectQrPosition(typeO, 'BR', 'O', TRIAL_DEFAULT);
  const typeY = selectGeneratorType(outer, 'Y', TRIAL_DEFAULT);
  const typeA = selectGeneratorType(typeY, 'A', TRIAL_DEFAULT);

  assert.equal(typeA.qrPosition, 'BR');
  assert.equal(typeA.finderPatternId, TRIAL_DEFAULT);
  assert.equal(typeA.previousOuterQrPosition, 'BR');
});

test('정규화는 멱등이고 중앙 QR/안쪽 모순을 한 번에 없앤다', () => {
  for (const inconsistent of [
    state({ finderPatternId: TRIAL_DEFAULT, qrPosition: 'inner' }),
    state({ finderPatternId: CENTER_QR_FINDER_PATTERN_ID, qrPosition: 'TR' }),
  ]) {
    const once = normalizeFinderQrState(inconsistent, 'O', OFFICIAL_DEFAULT);
    const twice = normalizeFinderQrState(once, 'O', OFFICIAL_DEFAULT);
    assert.deepEqual(twice, once);
    assert.equal(
      once.finderPatternId === CENTER_QR_FINDER_PATTERN_ID,
      once.qrPosition === 'inner',
    );
  }
});

test('빠른 파인더/QR 전환은 예약을 먼저 취소하고 정규 상태를 각 1회만 렌더한다', () => {
  const live = state({
    finderPatternId: TRIAL_DEFAULT,
    previousFinderPatternId: TRIAL_DEFAULT,
  });
  const transitions = [
    () => selectQrPosition(live, 'inner', 'O', OFFICIAL_DEFAULT),
    () => selectFinderPattern(live, TRIAL_DEFAULT, 'O', OFFICIAL_DEFAULT),
    () => selectFinderPattern(
      live, CENTER_QR_FINDER_PATTERN_ID, 'O', OFFICIAL_DEFAULT,
    ),
    () => selectQrPosition(live, 'BR', 'O', OFFICIAL_DEFAULT),
  ];
  let cancelCalls = 0;
  let renderCalls = 0;

  for (const transition of transitions) {
    const order = [];
    commitFinderQrTransition(live, transition(), 'O', OFFICIAL_DEFAULT, {
      cancelPendingRender() {
        cancelCalls += 1;
        order.push('cancel');
      },
      render(committed) {
        renderCalls += 1;
        order.push('render');
        assert.equal(
          committed.finderPatternId === CENTER_QR_FINDER_PATTERN_ID,
          committed.qrPosition === 'inner',
          '렌더가 중앙 QR/안쪽 상호배타 상태만 봐야 한다',
        );
      },
    });
    assert.deepEqual(order, ['cancel', 'render']);
  }

  assert.equal(cancelCalls, transitions.length);
  assert.equal(renderCalls, transitions.length);
  assert.equal(live.finderPatternId, TRIAL_DEFAULT);
  assert.equal(live.qrPosition, 'BR');
});
