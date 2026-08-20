/**
 * zoom-telemetry-autocrop.test.js — 계측이 **실제 분석 배율**을 싣는가.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 있나 — 자가 재는 대상을 안 재고 있었다
 * ─────────────────────────────────────────────────────────────────────────
 * `scanner.js` 는 실패 2초/4초 뒤 분석 입력을 **중앙 크롭**한다 (자동 크롭 사다리,
 * 커밋 `85b3a69`·`4d52ae9`). 실제로 자르는 배율의 유일한 출처는
 *
 *     effectiveCropZoom() = zoomPlan.cropApplied × autoCropZoomFor(autoCropIndex)
 *
 * 인데, 텔레메트리는 `zoomPlan` 만 읽었다. 그래서 **사다리가 2.2배로 걸려 있어도
 * `crop: 1` 로 보고**했고, 로그를 뒤져 「크롭은 1배였다」로 읽으면 오판했다.
 * 2026-08-20 실기기 회귀(중앙 3톤 큐브 «아예 인식 안 됨»)를 파는 도중,
 * 그 축이 계측에 **한 자리도 없다**는 것이 드러나 여기를 뚫었다.
 *
 * 고정하는 것 — **값이 아니라 관계로.** 사다리 상수가 바뀌어도 살아야 한다:
 *   ① 사다리가 걸리면 계측의 총 크롭이 «계획 × 사다리» 와 같다
 *   ② `effectiveZoom` 은 사다리를 **포함**한다 (이름이 «실효» 인 값은 실효여야 한다)
 *   ③ 사다리 0단이면 옛 동작과 같다 (무회귀)
 *   ④ 정규화기가 옛 프레임(필드 부재)을 «사다리 없음» 으로 안전하게 읽는다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { zoomTelemetry, autoCropZoomFor, AUTO_CROP_LADDER } from '../src/scanner-zoom.js';
import { normalizeFrameBody } from '../src/lab-telemetry.js';

const PLAN = {
  trackRequested: 1,
  trackApplied: 1,
  cropRequested: 1.4,
  cropApplied: 1.4,
  trackNative: 1,
  error: '',
};

test('① 사다리가 걸리면 총 크롭 = 계획 × 사다리 (상수를 하드코딩하지 않는다)', () => {
  for (let rung = 0; rung < AUTO_CROP_LADDER.length; rung += 1) {
    const t = zoomTelemetry({ ...PLAN, autoCropRung: rung });
    const want = PLAN.cropApplied * autoCropZoomFor(rung);
    assert.equal(t.autoCropRung, rung);
    assert.equal(t.autoCrop, autoCropZoomFor(rung));
    assert.ok(Math.abs(t.cropTotal - want) < 1e-9,
      `rung ${rung}: cropTotal ${t.cropTotal} != 계획×사다리 ${want}`);
    // `crop` 은 계획 그대로여야 한다 — 뜻을 바꾸면 과거 데이터와 비교가 깨진다.
    assert.equal(t.crop, PLAN.cropApplied);
  }
});

test('② effectiveZoom 은 사다리를 포함한다 — 이름이 «실효» 면 실효여야 한다', () => {
  const flat = zoomTelemetry({ ...PLAN, autoCropRung: 0 });
  const top = zoomTelemetry({ ...PLAN, autoCropRung: AUTO_CROP_LADDER.length - 1 });
  const ladderTop = autoCropZoomFor(AUTO_CROP_LADDER.length - 1);
  assert.ok(ladderTop > 1, '사다리 최상단이 1배면 이 검사가 공허하다 — 사다리 상수를 확인하라');
  assert.ok(top.effectiveZoom > flat.effectiveZoom,
    'effectiveZoom 이 사다리를 안 담는다 — 계측이 실제 분석 배율을 놓친다');
  assert.ok(Math.abs(top.effectiveZoom / flat.effectiveZoom - ladderTop) < 1e-6,
    'effectiveZoom 의 사다리 반영 비율이 사다리 배율과 다르다');
});

test('③ 사다리 0단은 옛 동작과 같다 (무회귀)', () => {
  const withField = zoomTelemetry({ ...PLAN, autoCropRung: 0 });
  const withoutField = zoomTelemetry({ ...PLAN });
  assert.equal(withField.crop, withoutField.crop);
  assert.equal(withField.cropTotal, withoutField.cropTotal);
  assert.equal(withField.effectiveZoom, withoutField.effectiveZoom);
  assert.equal(withoutField.autoCrop, 1, '필드가 없으면 사다리 없음(1배)으로 읽어야 한다');
});

test('④ 정규화기가 옛 프레임(필드 부재)을 안전하게 읽는다', () => {
  const legacy = normalizeFrameBody({ zoom: 1, crop: 1.4, w: 720, h: 960 });
  assert.equal(legacy.autoCropRung, 0);
  assert.equal(legacy.autoCrop, 1);
  assert.ok(Math.abs(legacy.cropTotal - 1.4) < 1e-9);

  const modern = normalizeFrameBody({
    zoom: 1, crop: 1.4, autoCropRung: 2, autoCrop: autoCropZoomFor(2), w: 720, h: 960,
  });
  assert.equal(modern.autoCropRung, 2);
  assert.ok(Math.abs(modern.cropTotal - 1.4 * autoCropZoomFor(2)) < 1e-9);
});

test('⑤ 스캐너가 autoCropRung 을 실제로 넘긴다 — 배선이 끊기면 ①~④ 가 공허해진다', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');
  // currentZoomTelemetry() 가 사다리 인덱스를 넘기는지. 넘기지 않으면 계측은 다시 거짓말한다.
  const call = src.slice(src.indexOf('function currentZoomTelemetry'), src.indexOf('function formatZoomLabel'));
  assert.match(call, /autoCropRung\s*:\s*autoCropIndex/,
    'currentZoomTelemetry 가 autoCropIndex 를 안 넘긴다 — 사다리가 다시 계측에서 사라진다');
});
