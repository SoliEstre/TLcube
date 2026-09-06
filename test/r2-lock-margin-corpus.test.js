/**
 * r2-lock-margin-corpus.test.js — **락 마진 게이트(3d)의 코퍼스 무회귀.**
 *
 * 합성 자(`test/r2-a3-wire.test.js` 의 ⓐ\~ⓔ)는 「기전이 이 방향으로 갈린다」를 잰다.
 * 이 파일이 재는 것은 다른 질문 하나다: **그 게이트가 이미 읽히던 코드를 죽이지 않는가.**
 *
 * 🔴 왜 따로 있나 — 게이트를 추가하는 변경은 「나쁜 것을 막았다」를 보여 주기 쉽고
 * 「좋은 것을 안 막았다」를 보여 주기 어렵다. 그런데 사용자가 겪는 회귀는 후자다.
 * 그래서 **DONE 프레임 번호**를 값으로 못 박는다 — 한 프레임이라도 늦어지면 빨개진다.
 *
 * ## 이 파일이 **못** 재는 축 (이름을 붙여 둔다)
 *   · **창 스윕**(sliding window). 시퀀스 시작점을 6프레임 stride 로 옮긴 104창에서
 *     DONE 창 수가 유지되는지는 여기서 안 잰다 — 한 창이 45프레임이라 스위트에 넣으면
 *     분 단위가 된다. 레인에서 out-of-suite 로 쟀다 (2026-09-06, 3c 대비):
 *     **DONE 창 59 → 59 · 악화 0 · 개선 0 · D 는 41창에서 내려가고 한 창도 안 올라갔다**
 *     (`.agent/lanes/r2-field3/fix3c-sweep.mjs` · `3d-sweep-wt.json` ↔ `fix3c-sweep-wt.json`).
 *     내려간 41창은 **전부 DONE 이 안 나던 창**이다 — 즉 사라진 D 는 가짜 진행이었다.
 *   · **실기 라이브.** 코퍼스 재생은 정지 덤프의 되풀이고 라이브 스캔이 아니다
 *     (memory: 정지사진은 라이브 스캔이 아니다). 마진 분포가 실기에서 같은지는 미측정.
 *   · **끝단 코퍼스의 마진 분포.** `lockMarginMin = 3` 은 이 코퍼스의 값이지 성질이 아니다
 *     (params 주석의 가설 J1). 여기서 재는 것은 「이 코퍼스에서 정상 락이 하한 위」 하나다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';
import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { DEFAULT_R2_PARAMS } from '../src/r2/params.js';
import { R2_INDICATOR } from '../src/r2/session.js';

/**
 * DONE 프레임의 **잠긴 값**. 3c 착지 시점의 실측이고 `nrelottery.md` §9.1 이 같은 수를 적는다.
 * 늦어지면 이 자가 빨개진다 — 「게이트가 정상 경로를 늦췄다」가 그 뜻이다.
 */
const DONE_FRAME = Object.freeze({ y0: 6, y1: 5, y2: 4 });

/** 락이 서는지 보기에 충분하고 스위트에 넣기에 싼 창. DONE 이 4\~6 프레임이라 12 면 여유가 두 배다. */
const FRAME_BUDGET = 12;

function sequenceNamed(name) {
  return listLumaSequences().find((s) => s.name.split('/').pop() === name) || null;
}

/** 한 시퀀스를 DONE 까지(또는 예산까지) 밀고 프레임별 락 상태를 모은다. */
function run(seq, budget) {
  const runtime = createR2ScanRuntime({ enabled: true });
  const frames = [];
  let done = -1;
  let text = '';
  const limit = Math.min(seq.frames.length, budget > 0 ? budget : FRAME_BUDGET);
  for (let i = 0; i < limit; i += 1) {
    const hit = runtime.pushFrame(readLumaDump(seq.frames[i].path), seq.timestampsMs[i]);
    frames.push({
      i,
      locked: runtime.stats.locked,
      margin: runtime.stats.lockMargin,
      distrusted: runtime.stats.lockDistrusted,
      indicator: runtime.stats.indicator,
      D: runtime.stats.progressD,
    });
    if (hit) { done = i; text = hit.text; break; }
  }
  return { done, text, frames, runtime };
}

test('3d 무회귀 — y0·y1·y2 의 DONE 프레임이 그대로고, 그 락들의 마진은 하한 위다', (t) => {
  const min = DEFAULT_R2_PARAMS.lockMarginMin;
  let measured = 0;
  let worst = Infinity;
  for (const [name, expected] of Object.entries(DONE_FRAME)) {
    const seq = sequenceNamed(name);
    if (!seq || !seq.frames.length) {
      t.skip('휘도 덤프 없음 (test/output 은 gitignore) — 통합자 기기에서만 돈다');
      return;
    }
    const { done, frames } = run(seq);
    assert.equal(done, expected,
      name + ' 의 DONE 이 f' + expected + ' → f' + done + ' 로 움직였다 — 마진 게이트가 정상 경로를 건드렸다');
    /*
     * 그 DONE 까지의 **모든 락 프레임**이 신뢰돼야 한다. 한 프레임이라도 불신이면 그 프레임의
     * 증거가 빠진 것이고, 그때 DONE 이 같은 자리에 선 것은 여유분 덕이지 무회귀가 아니다.
     */
    for (const f of frames) {
      if (!f.locked) continue;
      assert.equal(f.distrusted, false,
        name + ' f' + f.i + ' 의 락이 불신이다 (마진 ' + f.margin + ') — 정상 시퀀스에서 증거가 버려졌다');
      assert.ok(f.margin >= min,
        name + ' f' + f.i + ' 의 마진 ' + f.margin + ' 이 하한 ' + min + ' 아래다');
      measured += 1;
      if (f.margin < worst) worst = f.margin;
    }
  }
  // 공허 방지 — 락 프레임을 한 장도 안 봤으면 위 반복문은 아무것도 안 잰 것이다.
  assert.ok(measured >= 10, '락 프레임을 ' + measured + '장만 봤다 — 코퍼스 재생이 깨졌다');
  /*
   * 하한 표본. 2026-09-06 실측 최소는 **y0 의 23.14** (y1 59.00 · y2 85.40) — 하한 3 과 한 자릿수
   * 차이다. 이 여유가 줄어들면(예: 5 아래로) 그것은 「하한을 낮춰라」가 아니라 «정상 락의 마진이
   * 왜 떨어졌나» 를 물을 신호다. 그래서 여유 자체를 잰다.
   */
  assert.ok(worst >= min * 2,
    '정상 락의 최소 마진이 ' + worst + ' 로 하한 ' + min + ' 의 두 배 아래다 — 게이트가 정상군의 코앞까지 왔다');
});

test('3d — y2-p9rot 은 락이 서지만 마진이 하한 아래라 D 가 0 에 머문다 (가짜 진행이 안 쌓인다)', (t) => {
  const seq = sequenceNamed('y2-p9rot');
  if (!seq || !seq.frames.length) {
    t.skip('휘도 덤프 없음 (test/output 은 gitignore) — 통합자 기기에서만 돈다');
    return;
  }
  const { done, frames, runtime } = run(seq);
  assert.equal(done, -1, 'y2-p9rot 이 DONE 을 냈다 — 이 시퀀스는 3c 에서도 전수 109프레임에 DONE 0 이다');

  /*
   * ⚠ **경계 하나를 먼저 적는다**: `stats.locked` 는 `detectInto` 직후에 찍히고 마진은 프레임 **끝**
   * 값이다. 그래서 「그 프레임의 정합 중에 락이 걷힌」 프레임은 `locked = 1` 인데 마진이 `NaN` 으로
   * 나온다 (실측: y2-p9rot f4 — F 연속 미달 3회째가 clearLock 을 불렀다). 그것은 «믿는다» 가 아니라
   * «잴 락이 없다» 다 — 이 자가 그 둘을 안 섞도록, 재는 대상을 **마진이 실제로 측정된 프레임**으로 쓴다.
   */
  const measuredLocks = frames.filter((f) => f.locked && Number.isFinite(f.margin));
  assert.ok(measuredLocks.length > 0,
    '마진이 측정된 락 프레임이 없다 — 그러면 이 자는 마진이 아니라 검출을 재고 있다 (전제가 깨졌다)');
  for (const f of measuredLocks) {
    assert.equal(f.distrusted, true,
      'y2-p9rot f' + f.i + ' 의 락(마진 ' + f.margin + ')이 신뢰됐다 — '
      + '이 시퀀스의 락은 실측에서 자세가 틀린 락이다 (nrelottery §9.1: 채택 n 이 13×107 · 참 n 은 25)');
    assert.ok(f.margin < DEFAULT_R2_PARAMS.lockMarginMin,
      'y2-p9rot f' + f.i + ' 의 마진이 하한 위다 (' + f.margin + ')');
  }
  /*
   * 🔴 결론 — **막대가 안 찬다.** 3c 는 같은 코퍼스 전수에서 D 0.769 까지 갔다
   * (`.agent/lanes/r2-field3/fix3c-corpus-wt.json`) — 그 0.769 는 자세가 틀린 격자 위의 누적이라
   * 복호로는 절대 이어지지 않는 수였다. 「막대가 100 % 인데 실패」가 그 끝이다(PM/029B §27.13.2).
   */
  const maxD = frames.reduce((m, f) => Math.max(m, f.D), 0);
  assert.equal(maxD, 0,
    'y2-p9rot 에서 D 가 ' + maxD + ' 까지 올랐다 — 불신 락 위에 증거가 쌓인다');

  /*
   * 🔴 **회복 경로가 실재하는가** (2026-09-06 검토 3d, 결함 1). 3c 는 「락을 유지하니 재검출·인내가
   * 고쳐 준다」를 마진 미달을 견디는 근거로 적었다. 그 문장은 이 코퍼스에서 **거짓**이었다:
   * 재검출 방아쇠는 `fStale`(F 반토막)·`due`(96프레임) 둘뿐인데 이 시퀀스의 락은 F 10\~14 로
   * 안정적이라 어느 쪽도 안 걸렸고(전수 109프레임 relocates 0), 런타임 인내는 락이 살아 있으면
   * 매 프레임 0 이다. 그래서 **방아쇠가 실제로 당겨지는지를 값으로** 잰다 — 「회복이 가능하다」가
   * 아니라 「회복 시도가 일어난다」가 이 자의 명제다.
   */
  assert.ok(runtime.stats.counters.relocates >= 1,
    'y2-p9rot ' + frames.length + '프레임에 재검출이 ' + runtime.stats.counters.relocates
    + '회다 — 불신 락에 회복 «시도» 조차 없다 (3c 주석의 회복 경로가 실재하지 않는다)');
});

test('3d — 안정적인 불신 락은 세션에 하드 드랍을 만들지 않는다 (c3-tl · 12프레임)', (t) => {
  const seq = sequenceNamed('c3-tl');
  if (!seq || !seq.frames.length) {
    t.skip('휘도 덤프 없음 (test/output 은 gitignore) — 통합자 기기에서만 돈다');
    return;
  }
  const { frames, runtime } = run(seq);
  /*
   * 전제 — 이 시퀀스는 **락이 한 번도 안 걷히고**(F 게이트 통과) 마진만 미달인, 결함 2·4 가
   * 말한 바로 그 모양이다. 락이 걷히면 그건 「코드를 놓쳤다」라 드랍이 정당하고, 이 자는
   * 그 경우를 재지 않는다.
   */
  const lockedFrames = frames.filter((f) => f.locked);
  assert.equal(lockedFrames.length, frames.length, '전제: c3-tl 은 12프레임 내내 락이 산다');
  for (const f of lockedFrames) {
    assert.equal(f.distrusted, true, '전제: c3-tl f' + f.i + ' 의 락이 신뢰됐다');
  }
  /*
   * 🔴 값 — 3c 배선(`gatePassed = 0` 하나로만 말하기)에서는 `advanceCoast` 가 굴러
   * `nCoast`(12) 프레임째에 DROPPED → `hardDropReset` 이 돌았다. 실측 f11 에 hardDrops 0 → 1,
   * 전수 108프레임에서는 0 → 9. 패널의 「왜 리셋됐나」가 신원 상실이 아니라 마진 미달을 센다.
   */
  for (const f of frames) {
    assert.notEqual(f.indicator, R2_INDICATOR.DROPPED,
      'c3-tl f' + f.i + ' 에서 표시가 DROPPED 다 — 락은 살아 있는데 신원을 잃었다고 말한다');
  }
  assert.equal(runtime.stats.counters.hardDrops, 0,
    'c3-tl 12프레임에 hardDrops 가 ' + runtime.stats.counters.hardDrops
    + '회다 — 마진 미달이 «리셋» 으로 세어졌다');
});

/*
 * 🔴 **회복이 실제로 끝까지 간 하나** — swap-multi 는 3c 에서 D 0.890 까지 갔다가 DONE 0 이었고
 * (가짜 진행), 3d(회복 없는 마진 게이트)에서는 D 0 · DONE 0 이었다. ③′ 채택문과 불신 방아쇠가
 * 붙은 뒤 **f177 에 올바른 텍스트로 완주**한다 — 즉 게이트가 막은 것은 틀린 격자였고, 회복 경로가
 * 그 위에서 참 격자를 찾아냈다.
 *
 * ⚠ 비용 — 177프레임 재생 ≈2.8 s. 스위트에서 가장 비싼 자 중 하나지만, 「막았다」가 아니라
 *   「막고 나서 고쳤다」를 값으로 재는 자는 이것 하나뿐이라 여기 둔다.
 */
const SWAP_MULTI_DONE = 177;

test('3d — swap-multi 는 불신 락을 재검출로 회복해 f' + SWAP_MULTI_DONE + ' 에 올바른 페이로드로 완주한다', (t) => {
  const seq = sequenceNamed('swap-multi-c3-k2-v2-y2');
  if (!seq || !seq.frames.length) {
    t.skip('휘도 덤프 없음 (test/output 은 gitignore) — 통합자 기기에서만 돈다');
    return;
  }
  const { done, text, frames, runtime } = run(seq, SWAP_MULTI_DONE + 8);
  assert.equal(done, SWAP_MULTI_DONE,
    'swap-multi 의 DONE 이 f' + SWAP_MULTI_DONE + ' → f' + done + ' 로 움직였다');
  assert.equal(text, 'https://tl.estre.so',
    'swap-multi 가 다른 텍스트를 냈다 (' + text + ') — 회복이 «틀린 격자 위의 완주» 다');
  // 회복의 서명 — 불신 프레임이 있었고, 재검출이 돌았고, 끝에는 신뢰되는 락이다.
  assert.ok(frames.some((f) => f.locked && f.distrusted), '전제: 이 시퀀스에 불신 락 구간이 없다');
  assert.ok(runtime.stats.counters.relocates >= 1, '재검출이 한 번도 안 돌았다 — 회복이 아니다');
  assert.ok(runtime.stats.lockMargin >= DEFAULT_R2_PARAMS.lockMarginMin,
    '완주 시점의 마진이 ' + runtime.stats.lockMargin + ' 로 하한 아래다 — 불신 락 위에서 완주했다');
  assert.equal(runtime.stats.counters.hardDrops, 0,
    'swap-multi 에 hardDrops 가 ' + runtime.stats.counters.hardDrops + '회다 (3c 0 · 3d 17)');
});
