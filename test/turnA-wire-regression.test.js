/**
 * turnA-wire-regression.test.js — **턴A 배선 전에 발행 규약을 못 박는다.**
 *
 * 왜 이 파일이 먼저인가: 턴A 표(`src/turnA.js`)를 인코더에 붙이려면 `encodeA` 의
 * formatIndex 산출을 **산술 유도 → 표 조회**로 바꿔야 한다
 * (`spec.formatIndex + (centerQr ? 2 : 0)`). 그런데 formatIndex 는 **발행된 코드의
 * 판독 규약**이다 — 이미 만들어져 돌아다니는 A 코드들이 이 값으로 읽힌다.
 *
 * ⚠ 왕복 테스트만으로는 못 잡는다: 인코더와 디코더를 **같이** 바꾸면 둘 다 새 규약으로
 * 옮겨가 왕복은 초록인데 **기존 발행본은 못 읽게** 된다. 그래서 여기서는 인코더가
 * 내는 **formatIndex 값 자체를 고정 벡터로 박는다.** 이 표가 움직이면 그것은
 * «구현 변경» 이 아니라 **와이어 변경**이고, SPEC·인코더·디코더·포맷비트 4면
 * 동시 갱신이 필요하다 (AGENTS §7 N-way sync 등록부).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeA } from '../src/encodeA.js';
import { VERSIONS_A } from '../src/capacityA.js';
import {
  TURN_A_FORMAT_INDEX, K1_RESERVED_FORMAT_INDEX, CUBE_AXIS_FORMAT_INDEXES,
} from '../src/turnA.js';

/**
 * 현행 발행 규약 — 2026-08-18 실측 고정. (version, centerQr) → formatIndex.
 * ECC 레벨은 formatIndex 에 영향을 주지 않는다 (그 사실도 아래에서 잰다).
 */
const PUBLISHED_FORMAT_INDEX = Object.freeze([
  { version: 0, centerQr: false, k: 6, formatIndex: 1 },
  { version: 0, centerQr: true, k: 6, formatIndex: 3 },
  { version: 1, centerQr: false, k: 8, formatIndex: 12 },
  { version: 1, centerQr: true, k: 8, formatIndex: 14 },
  { version: 2, centerQr: false, k: 10, formatIndex: 13 },
  { version: 2, centerQr: true, k: 10, formatIndex: 15 },
]);

test('발행 규약 고정 — A 의 (version, centerQr) → formatIndex 는 이 표다', () => {
  for (const want of PUBLISHED_FORMAT_INDEX) {
    for (const eccLevel of ['L', 'M', 'H']) {
      const encoded = encodeA('tlcube turnA regression', {
        version: want.version, eccLevel, centerQr: want.centerQr,
      });
      assert.equal(encoded.formatIndex, want.formatIndex,
        `A v${want.version}${want.centerQr ? 'Q' : ''}/${eccLevel} 의 formatIndex 가 바뀌었다`
        + ' — **와이어 변경**이다. 발행된 코드가 안 읽힌다.');
      assert.equal(encoded.k, want.k, `A v${want.version} 의 k 가 바뀌었다`);
    }
  }
});

test('formatIndex 는 ECC 레벨에 의존하지 않는다', () => {
  for (const want of PUBLISHED_FORMAT_INDEX) {
    const indexes = ['L', 'M', 'H'].map((eccLevel) => encodeA('x', {
      version: want.version, eccLevel, centerQr: want.centerQr,
    }).formatIndex);
    assert.deepEqual(indexes, [want.formatIndex, want.formatIndex, want.formatIndex],
      'ECC 레벨이 formatIndex 를 움직인다 — 규약 가정이 깨졌다');
  }
});

test('현행 규약이 VERSIONS_A 의 산술 유도와 일치한다 (지금의 구현 사실)', () => {
  // 이 테스트는 «지금 이렇게 유도한다» 를 기록한다. 턴A 를 표 주도로 바꾸면
  // **이 테스트가 먼저 터져야 한다** — 터지지 않으면 배선이 안 된 것이다.
  for (const want of PUBLISHED_FORMAT_INDEX) {
    const spec = VERSIONS_A.find((v) => v.version === want.version);
    assert.ok(spec, 'VERSIONS_A 에 version ' + want.version + ' 이 없다');
    assert.equal(spec.formatIndex + (want.centerQr ? 2 : 0), want.formatIndex,
      '산술 유도가 발행 규약과 어긋난다');
  }
});

test('formatIndex 는 **타입 안에서만** 유일하다 — 턴A 는 자기 표를 가질 수 있다', async () => {
  /*
   * ⚠ **두 번 정정한 자리다. 경위를 남긴다.**
   *
   * 1차: «충돌은 formatIndex 3 하나» — 현행 A 점유만 세고 O 축을 안 봤다.
   * 2차: «4bit 공간 포화, 빈 자리 3 인데 턴A 는 6 요구 → 주소 부족» —
   *      **세 타입의 점유를 한 통에 부어 셌다.** 그것도 틀렸다.
   * 3차(지금): 운영자 제안(«턴A 를 별도 타입처럼, UI 에서만 같은 타입»)을 따라
   *      `src/decode.js` 의 해석 경로를 읽으니 답이 나왔다 —
   *      `typeOSpecFromFormatIndex` / `typeASpecFromFormatIndex` /
   *      `typeYSpecFromFormatIndex` 가 **타입별로 분리**돼 있고, 타입은 실루엣
   *      (육각/삼각/큐브)이 먼저 가른다. 같은 값이 타입마다 다른 뜻이다
   *      (0 = Y0 이면서 O V1 · 12 = A1 이면서 Y 미사용).
   *
   * → 그러므로 «주소 부족» 은 없었다. **A 타입 안에서만** 유일하면 되고,
   *   턴A 는 역삼각 실루엣이라 정삼각 A 와 기하로 갈리므로 자기 표를 가질 수 있다.
   *   와이어(발행 규약)를 깨지 않는다.
   */
  const { VERSIONS } = await import('../src/capacity.js');
  const { VERSIONS_Y } = await import('../src/capacityY.js');

  // ⓐ 같은 값이 타입마다 다른 뜻이라는 사실 — 전역 유일 가정의 반증.
  const yZero = VERSIONS_Y.find((v) => v.formatIndex === 0);
  assert.ok(yZero, 'Y 에 formatIndex 0 이 없다 — 반증 근거가 사라졌다');
  const aTwelve = VERSIONS_A.find((v) => v.formatIndex === 12);
  assert.ok(aTwelve, 'A 에 formatIndex 12 가 없다');
  assert.ok(!VERSIONS_Y.some((v) => v.formatIndex === 12),
    'Y 가 12 를 쓰기 시작했다 — 그래도 타입이 다르면 무해하지만 회계를 다시 보라');
  assert.ok(VERSIONS.length > 0, 'O 버전표가 비었다');

  // ⓑ **A 타입 안에서** 쓰는 값과 남는 값. 여기가 턴A 의 실제 예산이다.
  const usedInA = new Set(PUBLISHED_FORMAT_INDEX.map((r) => r.formatIndex));
  const freeInA = [...Array(16).keys()].filter((i) => !usedInA.has(i));
  assert.deepEqual([...usedInA].sort((x, z) => x - z), [1, 3, 12, 13, 14, 15],
    'A 타입 점유가 바뀌었다');
  assert.equal(freeInA.length, 10,
    'A 타입 안의 빈 자리가 10 이 아니다: ' + JSON.stringify(freeInA));

  // ⓒ 턴A 표 6자리가 A 안의 빈 자리로 **들어간다** (별도 타입이면 더 여유롭다).
  const wanted = TURN_A_FORMAT_INDEX.map((e) => e.formatIndex);
  assert.equal(new Set(wanted).size, wanted.length, '턴A 표 안에서 값이 중복된다');
  assert.ok(wanted.length <= freeInA.length + wanted.filter((x) => usedInA.has(x)).length,
    '턴A 요구가 A 예산을 넘는다');

  // ⓓ 예약 축 침범은 여전히 금지 — 이건 타입과 무관한 규약이다.
  assert.ok(!wanted.includes(K1_RESERVED_FORMAT_INDEX), '턴A 가 K1 예약(7)을 침범한다');
  for (const cube of CUBE_AXIS_FORMAT_INDEXES) {
    assert.ok(!wanted.includes(cube), '턴A 가 cube 축(' + cube + ')을 침범한다');
  }
});

test('4bit 를 넘치는 값이 없다 — 산술 유도가 금지된 이유', () => {
  for (const entry of TURN_A_FORMAT_INDEX) {
    assert.ok(entry.formatIndex >= 0 && entry.formatIndex <= 15,
      entry.name + ' 의 formatIndex 가 4bit 밖이다: ' + entry.formatIndex);
  }
  // 균일 오프셋이 왜 불가능한지의 정본 — A1(12)에 +4 를 주면 16 이다.
  const a1 = VERSIONS_A.find((v) => v.version === 1);
  assert.ok(a1.formatIndex + 4 > 15,
    'A1 에 균일 오프셋 +4 가 4bit 안에 들어간다 — 표 주도의 근거가 사라진다');
});

/*
 * ── 인코더 배선 후 (2026-08-18) ────────────────────────────────────────────
 *
 * `encodeA` 에 `turnA: true` 옵션을 붙였다. 두 규약이 한 인코더 안에 공존한다:
 *   기본 A  : `spec.formatIndex + centerQr*2` (발행 규약 — 위 벡터가 지킨다)
 *   턴A     : `turnASpec(version, {centerQr}).formatIndex` (표 주도)
 *
 * ⚠ **미완 사실을 여기 박는다 — 디코더에 역삼각 실루엣 판별이 아직 없다.**
 * 그래서 `V2Q = 3` (구명 A2TQ — 2026-08-24 V 재명명) 이 기본 `A0Q = 3` 과 **같은 값**이고, 지금은 둘을 기하로 가를
 * 수단이 디코더에 없다. 「실루엣이 갈라준다」는 설계 전제는 옳지만 **구현이 선행
 * 조건**이다. 이 테스트가 그 사실을 못 박아, 검출 경로가 붙기 전에 턴A 를 기본으로
 * 켜는 일이 없게 한다.
 */
test('턴A 인코더 — 기본 A 발행 규약을 한 자리도 안 건드린다', () => {
  for (const want of PUBLISHED_FORMAT_INDEX) {
    const plain = encodeA('x', { version: want.version, centerQr: want.centerQr });
    assert.equal(plain.formatIndex, want.formatIndex, '기본 A 가 turnA 배선에 오염됐다');
    assert.equal(plain.turnA, false, '기본 A 의 turnA 플래그가 false 가 아니다');
  }
});

test('턴A 인코더 — 표 주도로 낸다 (산술 유도가 아니다)', () => {
  for (const entry of TURN_A_FORMAT_INDEX) {
    const encoded = encodeA('x', {
      version: entry.version, centerQr: entry.centerQr, turnA: true,
    });
    assert.equal(encoded.formatIndex, entry.formatIndex,
      entry.name + ' 의 formatIndex 가 표와 다르다');
    assert.equal(encoded.turnA, true);
    assert.equal(encoded.k, entry.k, entry.name + ' 의 k 가 표와 다르다');
  }
});

test('⚠ 미완 — 턴A 와 기본 A 가 formatIndex 를 공유하는 조합이 있다', () => {
  // V2Q(3) ↔ A0Q(3). 디코더에 역삼각 실루엣 판별이 붙으면 기하가 가른다.
  // **붙기 전까지는 turnA 를 명시로만 써야 한다** — 이 사실이 사라지면(= 충돌이
  // 없어지면) 여기가 터지고, 그때 이 경고 주석도 함께 걷어내야 한다.
  const plain = new Map(PUBLISHED_FORMAT_INDEX.map((r) => [r.formatIndex, r]));
  const shared = TURN_A_FORMAT_INDEX.filter((e) => plain.has(e.formatIndex));
  assert.deepEqual(shared.map((e) => e.name), ['V2Q'],
    '턴A ↔ 기본 A 의 formatIndex 공유 조합이 V2Q 하나가 아니다: '
    + JSON.stringify(shared.map((e) => e.name)));
  // 그리고 디코더에 아직 역삼각 판별이 없다는 사실 자체 — 붙으면 이 단언을 지운다.
  assert.equal(shared.length > 0, true,
    '공유가 사라졌다 — 역삼각 판별이 붙었는지 확인하고 이 테스트를 갱신하라');
});
