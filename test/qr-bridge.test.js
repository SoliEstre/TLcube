/**
 * qr-bridge.test.js — 일반 QR 브리지(BarcodeDetector 위임)의 계약 (PM/029B §26).
 *
 *   ⓐ 분류가 등록부와 왕복한다 — TL 리더 URL 은 정확히 `URL`·`URL/`·`URL/x` 만 비노출(힌트), 그 밖은 노출.
 *   ⓑ 능력 판정은 생성자·포맷 목록·qr_code 셋을 다 본다 — node 에선 항상 false.
 *   ⓒ 브리지는 한 번에 하나만 비행하고, 간격을 지키고, reset 뒤 늦은 결과를 버리며(잠금도 안 푼다),
 *      실패·콜백 예외를 세고 삼킨다.
 *   ⓓ QR 적중이 R1·R2 와 같은 문(normalizeDecodePayload)을 값으로 통과한다. TL 종류는 못 간다.
 *   ⓔ 범위 문구 키가 3상태이고, 능력 원장과 8언어 문구가 맞는다.
 *   ⓖ 게이트 진리표 · 프레임 라우팅(TL 우선·비노출·첫 OTHER) · 가시 영역 필터와 정렬.
 *   ⓗ 텔레메트리 via 값 집합이 잠긴다.
 *   ⓕ 배선 (⚠ 철자 자 — 브라우저 밖): 순수 함수를 부르는지, 영역을 넘기는지, 토글·정지에서 비우는지,
 *      정식에서 probe 를 안 하는지, QR URL 을 자동으로 안 여는지.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  QR_VALUE_KIND, classifyQrValue, qrHitToDecodeResult, probeQrDetector, createQrBridge,
  qrFrameGateOpen, routeQrHits, frameYieldForQr, summarizeQrBridge,
} from '../src/qr-bridge.js';
import { summarizeFrameDebug } from '../src/scanner-debug-overlay.js';
import { TL_READER_HINT_REGISTRY, TL_READER_URL, tlReaderUrlWithHint } from '../src/qr.js';
import {
  normalizeDecodePayload, scanScopeCopyKey, scanViaOf, SCAN_VIA_VALUES, resultAutoOpen,
} from '../src/scanner-scan-assist.js';
import { R2_CAPABILITIES } from '../src/r2-scan-runtime.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const box = (x, y, w = 10, h = 10) => ({ x, y, width: w, height: h });

function fakeDetectorClass({ formats = ['qr_code'], results = [], reject = false, throwSync = false, delayMs = 0, delaysMs = null } = {}) {
  let calls = 0;
  return class FakeBarcodeDetector {
    static async getSupportedFormats() { return formats; }
    detect() {
      if (throwSync) throw new Error('sync-throw');
      // delaysMs: 호출 순서대로 다른 지연 — «옛 detect 가 새 비행 중에 돌아오는» 상황을 만든다.
      const wait = Array.isArray(delaysMs) ? (delaysMs[calls] ?? delaysMs[delaysMs.length - 1]) : delayMs;
      calls += 1;
      return (async () => {
        if (wait > 0) await sleep(wait);
        if (reject) throw new Error('detect-failed');
        return results;
      })();
    }
  };
}

test('ⓐ 분류 — 등록부 힌트 전수가 tl-hint 로 왕복하고, TL 종류는 정확히 URL·URL/·URL/x 뿐이다', () => {
  for (const entry of TL_READER_HINT_REGISTRY) {
    const url = tlReaderUrlWithHint(entry.family);
    const hit = classifyQrValue(url);
    assert.equal(hit.kind, QR_VALUE_KIND.TL_HINT, url);
    assert.equal(hit.family, entry.family, url + ' 의 가족');
    assert.equal(classifyQrValue(url.toLowerCase()).family, entry.family, '소문자 ' + url);
  }
  assert.equal(classifyQrValue(TL_READER_URL).kind, QR_VALUE_KIND.TL_PLAIN);
  assert.equal(classifyQrValue(TL_READER_URL + '/').kind, QR_VALUE_KIND.TL_PLAIN);
  // 예약 숫자·미지의 한 글자 = «TL 코드지만 가족은 모름» (qr.js 규약 그대로).
  assert.equal(classifyQrValue(TL_READER_URL + '/9').kind, QR_VALUE_KIND.TL_PLAIN);
  assert.equal(classifyQrValue(TL_READER_URL + '/Q').kind, QR_VALUE_KIND.TL_PLAIN);
  // 규약 밖 경로는 일반 QR 이다 — 시험판 링크(/lab)·두 글자·쿼리. 넓게 잡으면 «아무 일도 안 일어남».
  assert.equal(classifyQrValue(TL_READER_URL + '/LAB').kind, QR_VALUE_KIND.OTHER);
  assert.equal(classifyQrValue(TL_READER_URL + '/AB').kind, QR_VALUE_KIND.OTHER);
  assert.equal(classifyQrValue(TL_READER_URL + '/Y/').kind, QR_VALUE_KIND.OTHER);
  assert.equal(classifyQrValue(TL_READER_URL + '?x=1').kind, QR_VALUE_KIND.OTHER);
  assert.equal(classifyQrValue(TL_READER_URL + '.EVIL.COM/Y').kind, QR_VALUE_KIND.OTHER);
  assert.equal(classifyQrValue('https://example.com/x').kind, QR_VALUE_KIND.OTHER);
  assert.equal(classifyQrValue('WIFI:S:x;;').kind, QR_VALUE_KIND.OTHER);
  assert.equal(classifyQrValue('').kind, QR_VALUE_KIND.EMPTY);
  assert.equal(classifyQrValue(null).kind, QR_VALUE_KIND.EMPTY);
});

test('ⓑ 능력 판정 — 생성자 없음 · 포맷에 qr_code 없음 · 프로브가 던짐 은 전부 false, 셋 다 맞으면 true', async () => {
  assert.deepEqual(await probeQrDetector(undefined), { supported: false, reason: 'no-api' });
  assert.deepEqual(await probeQrDetector(fakeDetectorClass({ formats: ['ean_13'] })), { supported: false, reason: 'no-qr-format' });
  class Throws { static async getSupportedFormats() { throw new Error('x'); } }
  assert.deepEqual(await probeQrDetector(Throws), { supported: false, reason: 'probe-threw' });
  assert.deepEqual(await probeQrDetector(fakeDetectorClass()), { supported: true, reason: '' });
  const bridge = createQrBridge();
  assert.equal(await bridge.probe(), false, 'node 에 BarcodeDetector 가 있을 리 없다');
  assert.equal(bridge.reason, 'no-api');
  assert.equal(bridge.pushFrame({}, 0, () => {}), false, '미지원인데 detect 를 시도했다');
});

test('ⓒ 브리지 — 한 번에 하나 · 간격 · reset 뒤 늦은 결과는 버리고 잠금도 안 푼다 · 실패와 콜백 예외는 세고 삼킨다', async () => {
  const results = [{ rawValue: 'https://example.com/a', boundingBox: box(50, 50) }];
  const slow = createQrBridge({ BarcodeDetector: fakeDetectorClass({ results, delayMs: 20 }), intervalMs: 100 });
  assert.equal(await slow.probe(), true);
  const hits = [];
  assert.equal(slow.pushFrame({}, 1000, (h) => hits.push(h)), true);
  assert.equal(slow.pushFrame({}, 1001, (h) => hits.push(h)), false, '비행 중인데 또 제출했다');
  await sleep(40);
  assert.equal(hits.length, 1);
  assert.equal(hits[0][0].kind, QR_VALUE_KIND.OTHER);
  assert.equal(slow.pushFrame({}, 1050, (h) => hits.push(h)), false, '간격(100ms) 안인데 제출했다');
  assert.equal(slow.pushFrame({}, 1101, (h) => hits.push(h)), true);
  await sleep(40);
  assert.equal(hits.length, 2);

  // reset 뒤 늦게 도착한 옛 결과: 콜백으로 안 나가고, **새 비행의 잠금도 풀지 않는다.**
  // 옛 detect 10 ms · 새 detect 40 ms — 옛 것이 새 비행 «중» 에 돌아온다.
  const stale = createQrBridge({ BarcodeDetector: fakeDetectorClass({ results, delaysMs: [10, 40] }), intervalMs: 0 });
  await stale.probe();
  const late = [];
  assert.equal(stale.pushFrame({}, 2000, (h) => late.push(h)), true);
  stale.reset();
  assert.equal(stale.pushFrame({}, 2001, (h) => late.push(h)), true, 'reset 직후 새 제출이 막혔다');
  assert.equal(stale.inFlight, true);
  await sleep(22);
  assert.equal(stale.stats.dropped, 1, '옛 결과가 안 버려졌다');
  assert.equal(late.length, 0, '옛 결과가 콜백으로 나갔다');
  assert.equal(stale.inFlight, true, '옛 결과가 새 비행의 잠금을 풀었다 — detect 가 둘씩 겹친다');
  await sleep(40);
  assert.equal(late.length, 1, '새 결과가 안 나갔다');
  assert.equal(stale.inFlight, false);

  const failing = createQrBridge({ BarcodeDetector: fakeDetectorClass({ reject: true }), intervalMs: 0 });
  await failing.probe();
  assert.equal(failing.pushFrame({}, 0, () => { throw new Error('호출되면 안 된다'); }), true);
  await sleep(5);
  assert.equal(failing.stats.errors, 1);
  assert.equal(failing.inFlight, false, '실패 뒤 비행 플래그가 안 풀렸다 — 브리지가 영원히 막힌다');
  assert.equal(failing.pushFrame({}, 1, () => {}), true, '실패 뒤 다시 제출이 안 된다');

  const sync = createQrBridge({ BarcodeDetector: fakeDetectorClass({ throwSync: true }), intervalMs: 0 });
  await sync.probe();
  assert.equal(sync.pushFrame({}, 0, () => {}), true);
  assert.equal(sync.stats.errors, 1, '동기 throw 를 안 셌다');
  assert.equal(sync.inFlight, false, '동기 throw 뒤 잠금이 안 풀렸다');

  const throwing = createQrBridge({ BarcodeDetector: fakeDetectorClass({ results }), intervalMs: 0 });
  await throwing.probe();
  assert.equal(throwing.pushFrame({}, 0, () => { throw new Error('render-failed'); }), true);
  await sleep(5);
  assert.equal(throwing.stats.errors, 1, '콜백 예외가 errors 에 안 잡혔다 — unhandled rejection 으로 샌다');
  assert.equal(throwing.inFlight, false);
});

test('ⓓ QR 적중이 R1·R2 와 같은 문을 값으로 통과하고, TL 종류는 문에 못 간다', () => {
  const other = classifyQrValue('https://example.com/x');
  assert.equal(normalizeDecodePayload(qrHitToDecodeResult(other)), 'https://example.com/x');
  assert.equal(qrHitToDecodeResult(other).source, 'qr');
  assert.equal(qrHitToDecodeResult(classifyQrValue(tlReaderUrlWithHint('cube'))), null, 'TL 힌트 QR 이 결과로 노출된다');
  assert.equal(qrHitToDecodeResult(classifyQrValue(TL_READER_URL)), null);
  assert.equal(qrHitToDecodeResult(classifyQrValue('')), null);
  assert.equal(qrHitToDecodeResult(null), null);
  // URL 자동 열기는 허용 목록 — TL 출처(R1·R2)만. QR 은 결과에 autoOpen:false 를 직접 싣고, 스캐너의
  // 허용 목록도 'qr' 을 안 연다 (이중 안전). 미지의 출처는 «연다» 가 아니라 «누른다» 가 기본.
  assert.equal(qrHitToDecodeResult(other).autoOpen, false);
  assert.equal(resultAutoOpen(qrHitToDecodeResult(other)), false, '일반 QR 의 URL 이 자동으로 열린다');
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'qr' }), false, 'autoOpen 표시가 없어도 qr 출처는 안 열어야 한다');
  assert.equal(resultAutoOpen({ ok: true, payload: 'x' }), true, 'R1(TL) 결과의 자동 열기가 꺼졌다 — 종전 동작 회귀');
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'r2' }), true, 'R2(TL) 결과의 자동 열기가 꺼졌다');
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', source: 'mystery' }), false, '미지의 출처가 자동으로 열린다 — 기본이 안전 반대편');
  assert.equal(resultAutoOpen({ ok: true, payload: 'x', autoOpen: false }), false, '결과의 autoOpen:false 가 무시된다');
  assert.equal(resultAutoOpen(null), false);
});

test('ⓔ 범위 문구 키 3상태 — off 는 정식, on 은 브라우저 능력에 따라 둘, 8언어 문구가 원장과 맞는다', () => {
  assert.equal(scanScopeCopyKey(false, true), 'guide.tlcubeOnly', 'off 인데 QR 능력이 문구를 바꿨다');
  assert.equal(scanScopeCopyKey(true, false), 'guide.scope.r2');
  assert.equal(scanScopeCopyKey(true, undefined), 'guide.scope.r2', '판정 전(모름)은 못 읽는 쪽');
  assert.equal(scanScopeCopyKey(true, true), 'guide.scope.r2qr');
  const keys = new Set([scanScopeCopyKey(false), scanScopeCopyKey(true, false), scanScopeCopyKey(true, true)]);
  assert.equal(keys.size, 3, '세 상태가 세 문구여야 한다');
  for (const lang of Object.keys(SCANNER_STRINGS)) {
    for (const key of keys) assert.equal(typeof SCANNER_STRINGS[lang][key], 'string', lang + '/' + key);
  }
  // 원장 ↔ 문구. 원장이 바뀌면 여기가 먼저 빨개져야 문구가 따라온다.
  assert.equal(R2_CAPABILITIES.readsQr, true);
  assert.equal(R2_CAPABILITIES.readsQrVia, 'BarcodeDetector');
  assert.equal(R2_CAPABILITIES.qrRuntimeGated, true, 'QR 이 실행 시 판정이 아니라면 3상태 문구가 거짓이다');
  // 8언어 부정 토큰 — «이 브라우저에선 못 읽는다» 문구가 실제로 부정문이어야 한다. 손 목록이지만 한 곳뿐이다.
  const NEG = { ko: '않아요', en: 'cannot', ja: 'ません', fr: 'ne lit', it: 'non legge', de: 'weder', es: 'no lee', pt: 'não lê' };
  for (const lang of Object.keys(SCANNER_STRINGS)) {
    const noQr = SCANNER_STRINGS[lang]['guide.scope.r2'];
    const withQr = SCANNER_STRINGS[lang]['guide.scope.r2qr'];
    assert.ok(noQr.includes('QR'), lang + ' 미지원 문구가 QR 을 안 말한다');
    assert.ok(NEG[lang] && noQr.includes(NEG[lang]), lang + ' 미지원 문구가 부정문이 아니다: ' + noQr);
    assert.ok(withQr.includes('QR'), lang + ' 지원 문구가 QR 을 안 말한다');
    if (R2_CAPABILITIES.readsQr) assert.ok(!withQr.includes(NEG[lang]) || withQr.indexOf('QR') < withQr.indexOf(NEG[lang]), lang + ' 지원 문구가 QR 을 부정한다: ' + withQr);
  }
  assert.match(SCANNER_STRINGS.ko['guide.scope.r2'], /브라우저/, '미지원이 «이 브라우저» 탓임을 안 말한다');
  assert.ok(SCANNER_STRINGS.ko['guide.scope.r2qr'].includes('QR 코드도 읽어요'));
  assert.match(SCANNER_STRINGS.ko['guide.scope.r2qr'], /다른 바코드/, 'QR 만 읽고 다른 바코드는 아직이라는 한계가 빠졌다');
  for (const key of ['guide.scope.r2', 'guide.scope.r2qr']) assert.match(SCANNER_STRINGS.ko[key], /타입 Y/);
  assert.ok(R2_CAPABILITIES.accumulatesFamilies.includes('Y'));
});

test('ⓖ 게이트 진리표 · 프레임 라우팅(TL 우선·비노출) · 가시 영역 필터와 중심순 정렬', async () => {
  // 게이트: 셋 다 참일 때만.
  assert.equal(qrFrameGateOpen({ r2Enabled: true, qrSupported: true, readyState: 2 }), true);
  assert.equal(qrFrameGateOpen({ r2Enabled: true, qrSupported: true, readyState: 4 }), true);
  assert.equal(qrFrameGateOpen({ r2Enabled: false, qrSupported: true, readyState: 4 }), false, '정식 경로(R2 off)에서 QR 이 돈다');
  assert.equal(qrFrameGateOpen({ r2Enabled: true, qrSupported: false, readyState: 4 }), false);
  assert.equal(qrFrameGateOpen({ r2Enabled: true, qrSupported: true, readyState: 1 }), false, 'HAVE_METADATA 에서 detect 를 던진다');
  assert.equal(qrFrameGateOpen({ r2Enabled: true, qrSupported: true }), false);
  assert.equal(qrFrameGateOpen(null), false);

  // 라우팅.
  const tl = classifyQrValue(tlReaderUrlWithHint('star'));
  const plain = classifyQrValue(TL_READER_URL);
  const link = classifyQrValue('https://example.com/a');
  const link2 = classifyQrValue('https://example.com/b');
  assert.deepEqual(routeQrHits([tl]), { family: 'star', expose: null });
  assert.deepEqual(routeQrHits([plain]), { family: null, expose: null });
  assert.deepEqual(routeQrHits([link, link2]), { family: null, expose: link }, '첫 OTHER(중심에 가장 가까운 것)를 노출해야 한다');
  assert.deepEqual(routeQrHits([link, tl]), { family: 'star', expose: null }, 'TL 코드가 프레임에 있으면 옆 링크를 노출하면 안 된다');
  assert.deepEqual(routeQrHits([plain, tl]), { family: 'star', expose: null });
  assert.deepEqual(routeQrHits([]), { family: null, expose: null });
  assert.deepEqual(routeQrHits(null), { family: null, expose: null });

  // 영역 필터: 가시 정사각 밖은 버리고, 안쪽은 중심에 가까운 순.
  const results = [
    { rawValue: 'https://far.example', boundingBox: box(0, 0) },          // 밖 (왼쪽 위 구석)
    { rawValue: 'https://edge.example', boundingBox: box(420, 240) },     // 안, 중심에서 멂
    { rawValue: 'https://center.example', boundingBox: box(635, 355) },   // 안, 중심
    { rawValue: 'https://nowhere.example' },                              // 위치 없음 — 살리되 센다
  ];
  const bridge = createQrBridge({ BarcodeDetector: fakeDetectorClass({ results }), intervalMs: 0 });
  await bridge.probe();
  let got = null;
  // 1280×720 프레임의 가운데 720 정사각 (x 280..1000).
  bridge.pushFrame({}, 0, (h) => { got = h; }, { region: { x: 280, y: 0, width: 720, height: 720 } });
  await sleep(5);
  assert.ok(got, '콜백이 안 왔다');
  assert.deepEqual(got.map((h) => h.text), ['https://center.example', 'https://edge.example', 'https://nowhere.example']);
  assert.equal(bridge.stats.outside, 1);
  assert.equal(bridge.stats.unlocated, 1);
  // 영역을 안 주면 필터 없음 (호출자 책임).
  const all = createQrBridge({ BarcodeDetector: fakeDetectorClass({ results }), intervalMs: 0 });
  await all.probe();
  let gotAll = null;
  all.pushFrame({}, 0, (h) => { gotAll = h; });
  await sleep(5);
  assert.equal(gotAll.length, 4);
});

test('ⓗ 텔레메트리 via — 경로 이름으로 가르고, 값 집합이 잠긴다', () => {
  assert.equal(scanViaOf({ source: 'r2' }), 'r2');
  assert.equal(scanViaOf({ source: 'qr' }), 'qr-direct');
  assert.equal(scanViaOf({ hypothesis: { centerQr: true } }), 'qr');
  assert.equal(scanViaOf({ hypothesis: { source: 'center-qr-finder' } }), 'qr');
  assert.equal(scanViaOf({ hypothesis: { source: 'anchor-detector' } }), 'cube');
  assert.equal(scanViaOf(null), 'cube');
  assert.deepEqual([...SCAN_VIA_VALUES].sort(), ['cube', 'qr', 'qr-direct', 'r2']);
  for (const r of [{ source: 'r2' }, { source: 'qr' }, { hypothesis: { centerQr: true } }, {}, null]) {
    assert.ok(SCAN_VIA_VALUES.includes(scanViaOf(r)), '집합 밖 via 값');
  }
});

test('ⓕ 배선 — 순수 함수 호출 · 영역 · 세션+토글 재확인 · 토글·정지에서 비움 · 정식 probe 없음 · QR URL 자동 열기 없음 (⚠ 철자 자)', () => {
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  const at = js.indexOf('qrBridge.pushFrame(');
  assert.ok(at > 0, 'QR 브리지가 프레임을 못 받는다');
  const gate = js.slice(js.lastIndexOf('\n    if (', at), at);
  assert.ok(gate.includes('qrFrameGateOpen({'), '게이트가 진리표 함수를 안 쓴다 — 조건이 손으로 조립되면 정식 불변을 자가 못 잰다');
  const blockEnd = js.indexOf('\n    }\n', at);
  assert.ok(blockEnd > at, 'QR 블록의 닫는 줄을 못 찾았다');
  const call = js.slice(at, blockEnd);
  assert.ok(call.includes('cameraVideo, timestamp'), '<video> 를 안 넘긴다 — grab 을 중복하거나 축소본을 읽는다');
  assert.ok(call.includes('region: visibleVideoRegion()'), '가시 영역을 안 넘긴다 — 화면 밖 QR 이 읽힌다');
  assert.ok(call.includes('session !== scanSession || !r2Runtime.enabled'), '비동기 콜백이 세션·토글을 다시 안 본다');
  assert.ok(call.includes('routeQrHits(hits)'), '라우팅을 손으로 한다 — TL 우선·비노출 규약이 자 밖이다');
  assert.ok(call.includes('qrHitToDecodeResult(route.expose)'), 'QR 적중이 모양 변환 없이 문으로 간다');
  assert.ok(js.includes('const familyEvidence = liveFamilyEvidence() || scannerFamilyEvidence;'), 'runPass 가 실행 시 힌트(TTL)를 한 번 읽은 스냅샷으로 안 쓴다');
  const loop = js.slice(js.indexOf('function startFrameLoop('), js.indexOf('const nextFrame ='));
  assert.ok(loop.includes('qrBridge.reset()') && loop.includes('runtimeFamilyHint = null'), 'startFrameLoop 이 브리지·힌트를 안 비운다 — 정지 경로와 비대칭');
  const stop = js.slice(js.indexOf('function stopCamera()'), js.indexOf('function cameraFailure('));
  assert.ok(stop.includes('qrBridge.reset()') && stop.includes('runtimeFamilyHint = null'),
    'stopCamera 가 브리지·힌트를 안 비운다 — 다음 세션에 옛 QR·옛 힌트가 산다');
  const toggleAt = js.indexOf("r2Toggle.addEventListener('click'");
  const toggle = js.slice(toggleAt, js.indexOf('\n  });', toggleAt));
  assert.ok(toggle.includes('qrBridge.reset()') && toggle.includes('runtimeFamilyHint = null'),
    'R2 토글이 브리지·힌트를 안 비운다 — off 직후 QR 결과가 뜨고 옛 힌트가 R1 을 편향한다');
  assert.ok(js.includes('scanScopeCopyKey(r2Runtime.enabled, qrBridge.supported)'), '문구가 브라우저 능력을 안 본다');
  assert.ok(js.includes('if (isLabPath()) void qrBridge.probe().then('), '정식 경로에서도 BarcodeDetector 를 만든다 — 정식 불변 위반');
  assert.ok(js.includes('autoOpen: resultAutoOpen(result)'), 'URL 자동 열기가 허용 목록(resultAutoOpen)을 안 거친다 — QR·미지 출처가 열린다');
  assert.ok(js.includes('autoOpen ? tryOpenUrl(url) : false'), 'renderUrlPayload 가 autoOpen 을 안 본다');
  assert.ok(js.includes('popupBlockedNote.hidden = !autoOpen'), '자동으로 안 연 결과에 «새 탭을 열지 못했어요» 가 같이 뜬다 — intro 와 모순');
  assert.ok(readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8').includes('id="popup-blocked-note"'), '팝업 차단 문단에 id 가 없다');
  assert.ok(js.includes('showResult(lastResult, lastResultOptions)'), '언어 전환 재렌더가 autoOpen 을 잃는다 — 재렌더에서 URL 이 열린다');
});

/*
 * 0단계 (PM/029B §27.4) — «QR 이 TL 처럼 오래 걸린다». 두 복호기가 동기라 detect 결과가 R1 뒤로 밀린다.
 * ⓘ 유예 진리표 · ⓙ 타이밍 통계 · ⓚ 요약이 키 전부를 찍는다 · ⓕ' 제출 순서(QR → R2 → R1)와 유예 배선.
 */

test('ⓘ frameYieldForQr — 비행 중이고 제출 뒤 cap 안일 때만 true, 그 밖은 전부 false', () => {
  assert.equal(frameYieldForQr({ inFlight: true, submittedAt: 1000, now: 1010 }), true);
  assert.equal(frameYieldForQr({ inFlight: true, submittedAt: 1000, now: 1149 }), true);
  assert.equal(frameYieldForQr({ inFlight: true, submittedAt: 1000, now: 1150 }), false, 'cap 에 닿으면 굶기지 않는다');
  assert.equal(frameYieldForQr({ inFlight: true, submittedAt: 1000, now: 1050 }, 40), false, 'cap 인자');
  assert.equal(frameYieldForQr({ inFlight: false, submittedAt: 1000, now: 1010 }), false, '비행 중이 아닌데 유예 — 정식 경로가 느려진다');
  assert.equal(frameYieldForQr({ inFlight: true, submittedAt: NaN, now: 1010 }), false, 'reset 뒤(submittedAt NaN) 유예');
  assert.equal(frameYieldForQr({ inFlight: true, submittedAt: 1000, now: NaN }), false);
  assert.equal(frameYieldForQr(null), false);
});

test('ⓙ 타이밍 통계 — 제출 시각 · 왕복 ms · settle 수, reset 이 제출 시각을 지운다', async () => {
  let clock = 5000;
  const results = [{ rawValue: 'https://example.com/t', boundingBox: box(10, 10) }];
  const bridge = createQrBridge({ BarcodeDetector: fakeDetectorClass({ results, delayMs: 15 }), intervalMs: 0, now: () => clock });
  await bridge.probe();
  assert.equal(Number.isNaN(bridge.stats.submittedAt), true, '제출 전 submittedAt 이 NaN 이 아니다');
  assert.equal(bridge.pushFrame({}, 0, () => {}), true);
  assert.equal(bridge.stats.submittedAt, 5000);
  clock = 5087;
  await sleep(30);
  assert.equal(bridge.stats.lastDetectMs, 87, '왕복 ms 가 now() 차이가 아니다');
  assert.equal(bridge.stats.maxDetectMs, 87);
  assert.equal(bridge.stats.settled, 1);
  clock = 6000;
  bridge.pushFrame({}, 1, () => {});
  clock = 6020;
  await sleep(30);
  assert.equal(bridge.stats.lastDetectMs, 20);
  assert.equal(bridge.stats.maxDetectMs, 87, '최대가 내려갔다');
  assert.equal(bridge.stats.settled, 2);
  bridge.reset();
  assert.equal(Number.isNaN(bridge.stats.submittedAt), true, 'reset 뒤 옛 제출 시각이 남아 유예를 만든다');
  // 실패 settle 도 시간을 센다.
  const failing = createQrBridge({ BarcodeDetector: fakeDetectorClass({ reject: true }), intervalMs: 0, now: () => clock });
  await failing.probe();
  clock = 7000; failing.pushFrame({}, 0, () => {}); clock = 7033;
  await sleep(5);
  assert.equal(failing.stats.lastDetectMs, 33);
  assert.equal(failing.stats.settled, 1);
});

test('ⓚ summarizeQrBridge 가 stats 의 키 전부를 찍고, 디버그 패널이 그 줄을 받는다', async () => {
  const bridge = createQrBridge({ BarcodeDetector: fakeDetectorClass(), intervalMs: 0 });
  await bridge.probe();
  const line = summarizeQrBridge(bridge.stats, bridge.supported);
  assert.ok(line.startsWith('qr on'));
  for (const key of Object.keys(bridge.stats)) assert.ok(line.includes(key + ' '), '요약에 ' + key + ' 가 없다 — 키가 늘면 손 목록이 썩는다');
  assert.ok(summarizeQrBridge({ a: NaN, b: 'x' }, false).startsWith('qr off · a — · b x'));
  const lines = summarizeFrameDebug({ qr: line });
  assert.ok(lines.includes(line), '디버그 패널이 qr 줄을 안 그린다');
  assert.ok(!summarizeFrameDebug({}).some((l) => l.startsWith('qr ')), 'qr 줄이 없을 때 빈 줄을 그린다');
});

test("ⓕ' 배선 — QR 제출이 R2·R1 보다 앞이고, 유예가 두 grab 을 건너뛰며, 패널에 qr 줄이 간다 (⚠ 철자 자)", () => {
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  const qrAt = js.indexOf('qrBridge.pushFrame(');
  const r2At = js.indexOf('r2Runtime.pushFrame(');
  const r1At = js.indexOf('adaptiveFrameIntervalMs(lastFrameCostMs)');
  assert.ok(qrAt > 0 && r2At > 0 && r1At > 0);
  assert.ok(qrAt < r2At && r2At < r1At, 'QR 제출이 두 복호기보다 뒤다 — 같은 틱의 동기 복호가 detect 결과를 밀어낸다');
  const yieldAt = js.indexOf('const yieldForQr = frameYieldForQr({');
  assert.ok(yieldAt > qrAt && yieldAt < r2At, '유예 판정이 QR 제출 뒤·R2 앞이 아니다');
  assert.equal(js.split('yieldForQr ? null : grabVideoFrame(').length - 1, 2, 'R2·R1 두 grab 이 유예를 안 본다');
  assert.ok(js.includes('qr: isLabPath() ? summarizeQrBridge(qrBridge.stats, qrBridge.supported)'), '디버그 패널에 qr 통계가 안 간다');
});
