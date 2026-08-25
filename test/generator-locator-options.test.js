/**
 * generator-locator-options.test.js — 로케이터 카드 표시 규칙(운영자 명세)을 잠근다.
 *
 * ⚠ 이 규칙이 모듈로 나와 있는 이유: 인라인 HTML 에 두면 **정규식으로만** 잴 수 있고,
 *   정규식은 «그 줄이 있는가» 만 본다. 2026-08-25 하루에 그 층에서 두 번 데였다
 *   (앱 전체 파싱 실패 · Type K 가 O 로 렌더). 표는 값으로 잰다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedYLocatorCards, effectiveVersionYForOptions, activeLocatorCardId,
  INNER_FORCED_VERSION_Y,
} from '../src/generator-locator-options.js';
import {
  LOCATOR_PROFILE_OFF,
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0T,
  LOCATOR_PROFILE_CELL_SURFACE_V0TR,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0TY,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
} from '../src/locatorY.js';

const OFF = LOCATOR_PROFILE_OFF;
const V0 = LOCATOR_PROFILE_CELL_SURFACE_V0;
const V0T = LOCATOR_PROFILE_CELL_SURFACE_V0T;
const V0TR = LOCATOR_PROFILE_CELL_SURFACE_V0TR;
const V0TRQ = LOCATOR_PROFILE_CELL_SURFACE_V0TRQ;

test('① 운영자 명세 4행을 표 그대로 잠근다', () => {
  const rows = [
    ['Y0 · 바깥QR', { inner: false, far: false, versionY: 0 }, [OFF, V0]],
    ['Y1 · 바깥QR', { inner: false, far: false, versionY: 1 }, [OFF, V0T, V0TR]],
    ['Y2 · 바깥QR', { inner: false, far: false, versionY: 2 }, [OFF, V0T, V0TR]],
    ['안쪽 · 중앙측', { inner: true, far: false, versionY: 1 }, [V0TRQ]],
    ['안쪽 · 코너측', { inner: true, far: true, versionY: 1 }, [OFF, V0T, V0TR]],
  ];
  for (const [label, state, expected] of rows) {
    assert.deepEqual(allowedYLocatorCards(state), expected, label);
  }
});

test('② 중앙측은 «v0TRQ 만» 이다 — 없음조차 없다', () => {
  // 중앙 슬롯이 강제되므로 «끔» 이 성립하지 않는다. 이 한 칸이 명세에서 유일하게
  // OFF 를 빼는 자리라, 실수로 넣으면 «고를 수 있는데 안 먹는» 카드가 생긴다.
  const seam = allowedYLocatorCards({ inner: true, far: false, versionY: 1 });
  assert.deepEqual(seam, [V0TRQ]);
  assert.ok(!seam.includes(OFF), '중앙측에 «끔» 이 들어갔다');
});

test('③ 안쪽 QR 은 자동 사다리를 묻지 않는다 (T 계열 강제)', () => {
  // resolveAutoLocatorProfileY 가 inner 를 사다리보다 먼저 가로챈다. 여기서 사다리
  // 값을 쓰면 짧은 페이로드에서 Y0(n=13)이 나오고 T 계열이 «n 미지원» 으로 걸려
  // **v0T 카드가 조용히 사라진다** — 2026-08-25 브라우저 실측에서 실제로 그랬다.
  assert.equal(
    effectiveVersionYForOptions({ inner: true, versionY: 'auto', autoVersion: 0 }),
    INNER_FORCED_VERSION_Y,
    '안쪽인데 사다리 값(0)을 따라갔다 — v0T 카드가 사라진다',
  );
  assert.equal(effectiveVersionYForOptions({ inner: true, versionY: 2, autoVersion: 0 }), 1,
    '안쪽은 명시 버전보다 T 계열 강제가 이긴다');
  // 바깥이면 사다리를 따른다.
  assert.equal(effectiveVersionYForOptions({ inner: false, versionY: 'auto', autoVersion: 0 }), 0);
  assert.equal(effectiveVersionYForOptions({ inner: false, versionY: 'auto', autoVersion: 2 }), 2);
  assert.equal(effectiveVersionYForOptions({ inner: false, versionY: 1, autoVersion: 0 }), 1);
  // 사다리가 못 정하면(페이로드 못 읽음) T 계열이 안전한 기본값이다.
  assert.equal(effectiveVersionYForOptions({ inner: false, versionY: 'auto', autoVersion: null }), 1);
});

test('④ 파생 프로파일은 기반 카드로 표시된다 — 아니면 «아무 것도 안 켜진다»', () => {
  // v0TY·v0TRY 는 카드가 없다(W2 C3 파생값 강등). 사상 없이 그대로 비교하면
  // 안쪽+코너측에서 사용자가 카드를 눌러도 선택 흔적이 화면에 안 남는다.
  assert.equal(activeLocatorCardId(LOCATOR_PROFILE_CELL_SURFACE_V0TY), V0T);
  assert.equal(activeLocatorCardId(LOCATOR_PROFILE_CELL_SURFACE_V0TRY), V0TR);
  // 카드가 있는 값은 그대로 통과한다.
  for (const id of [OFF, V0, V0T, V0TR, V0TRQ]) {
    assert.equal(activeLocatorCardId(id), id, id + ' 이 엉뚱한 카드로 사상됐다');
  }
});

test('⑤ 허용 목록에 «자동» 은 없다 — 호출자가 항상 보인다', () => {
  // 자동의 값은 렌더 시점에 정해지므로 상태로 가릴 수 없다. 목록에 넣으면
  // 어느 조합에서 자동이 사라지는 사고가 난다.
  for (const state of [
    { inner: false, far: false, versionY: 0 },
    { inner: true, far: false, versionY: 1 },
    { inner: true, far: true, versionY: 1 },
  ]) {
    assert.ok(!allowedYLocatorCards(state).includes('auto'), '허용 목록에 auto 가 들었다');
  }
});
