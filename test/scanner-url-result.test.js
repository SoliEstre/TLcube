import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resultAutoOpen,
  resolveUrlResultPresentation,
  urlOriginOf,
} from '../src/scanner-url-result.js';

test('TL/R1·R2와 검증된 H만 자동열기 권한을 받아요', () => {
  const verified = new WeakSet();
  const h = { ok: true, payload: 'https://tl.example', source: 'h' };
  verified.add(h);
  const options = { isVerifiedHResult: (result) => verified.has(result) };
  assert.equal(urlOriginOf({ ok: true, payload: 'x' }, options), 'tl');
  assert.equal(urlOriginOf({ ok: true, payload: 'x', source: 'r2' }, options), 'tl');
  assert.equal(urlOriginOf(h, options), 'tl');
  assert.equal(resultAutoOpen(h, options), true);
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'h' }, options), false);
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'h', type: 'H', hSummary: {} }, options), false);
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'qr' }, options), false);
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'unknown' }, options), false);
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'r2', autoOpen: false }, options), false);
});

test('저장된 결과 상태는 locale 재렌더에서 window.open을 다시 부르지 않아요', () => {
  let opens = 0;
  const first = resolveUrlResultPresentation({ autoOpen: true, urlOrigin: 'tl', tryOpenUrl: () => { opens += 1; return true; } });
  const rerender = resolveUrlResultPresentation({ autoOpen: true, urlOrigin: 'tl', urlOpenState: first.state,
    tryOpenUrl: () => { opens += 1; return true; } });
  assert.equal(opens, 1);
  assert.equal(rerender.state, 'opened');
  assert.equal(rerender.introKey, 'result.url.opened');
});

test('QR만 qrManual 문구이고 unknown·권한 false TL은 일반 수동 안내예요', () => {
  const qr = resolveUrlResultPresentation({ autoOpen: false, urlOrigin: 'qr' });
  const unknown = resolveUrlResultPresentation({ autoOpen: false, urlOrigin: 'unknown' });
  const tlDenied = resolveUrlResultPresentation({ autoOpen: false, urlOrigin: 'tl' });
  assert.equal(qr.introKey, 'result.url.qrManual');
  assert.equal(unknown.introKey, 'result.url.manual');
  assert.equal(tlDenied.introKey, 'result.url.manual');
  assert.equal(qr.popupBlockedVisible, false);
});
