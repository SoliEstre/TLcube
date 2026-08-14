/*
 * lab-telemetry.test.js — 시험판 계측 클라이언트.
 *
 * 안정판 경로에서 한 바이트도 나가지 않는 것, 봉투가 릴레이 검증을 통과하는 것,
 * 페이로드 내용·영속 식별자가 안 실리는 것, 공개 문구가 안정판으로 한정된 것을 고정한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseEnvelope } from '../relay/protocol.mjs';
import {
  SID_KEY,
  classifyStage,
  createLabTelemetry,
  estimateCellPx,
  familyToType,
  fillFrameMs,
  isLabPath,
  labSocketUrl,
  makeEnvelope,
  normalizeFrameBody,
  normalizeGenBody,
  shrinkFrameShot,
} from '../src/lab-telemetry.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(ROOT + rel, 'utf8');

function memoryStore() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

class FakeWS {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this._listeners = { open: [], close: [], error: [] };
    FakeWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      for (const fn of this._listeners.open) fn();
    });
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  send(data) { this.sent.push(String(data)); }
  close() { this.readyState = 3; }
}
FakeWS.instances = [];

function labOpts(over = {}) {
  return {
    site: 'scan',
    location: { pathname: '/lab/', protocol: 'https:', host: 'tlscan.estre.so' },
    sessionStorage: memoryStore(),
    localStorage: memoryStore(),
    WebSocket: FakeWS,
    ...over,
  };
}

test('isLabPath 는 /lab 과 /lab/ 만 켠다', () => {
  assert.equal(isLabPath('/lab'), true);
  assert.equal(isLabPath('/lab/'), true);
  assert.equal(isLabPath('/lab/index.html'), true);
  assert.equal(isLabPath('/'), false);
  assert.equal(isLabPath('/index.html'), false);
  assert.equal(isLabPath('/sites/tlscan/'), false);
  assert.equal(isLabPath('/label'), false);
  assert.equal(isLabPath('/laboratory'), false);
  assert.equal(isLabPath(''), false);
});

test('안정판 경로에서는 WebSocket 을 만들지 않고 emit 이 침묵한다', async () => {
  FakeWS.instances = [];
  const session = memoryStore();
  const local = memoryStore();
  const tel = createLabTelemetry({
    site: 'scan',
    location: { pathname: '/', protocol: 'https:', host: 'tlscan.estre.so' },
    sessionStorage: session,
    localStorage: local,
    WebSocket: FakeWS,
  });
  assert.equal(tel.enabled, false);
  tel.env({ ua: { browser: 'x' } });
  tel.gen({ type: 'Y', version: 1, ecc: 'M' });
  tel.frame(normalizeFrameBody({ seq: 1, w: 10, h: 10, ms: fillFrameMs(5, 'proposal') }));
  tel.frameShot({ seq: 1, imageData: { width: 4, height: 4, data: new Uint8ClampedArray(64) } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(FakeWS.instances.length, 0);
  assert.equal(session.getItem(SID_KEY), null);
  assert.equal(local.getItem('tl-lab-queue'), null);
});

test('생성기 안정판 경로도 한 바이트도 안 나간다', async () => {
  FakeWS.instances = [];
  const tel = createLabTelemetry({
    site: 'gen',
    location: { pathname: '/', protocol: 'https:', host: 'tlcube.estre.so' },
    sessionStorage: memoryStore(),
    localStorage: memoryStore(),
    WebSocket: FakeWS,
  });
  tel.gen({ type: 'O', version: 2, ecc: 'H', payload: 'SECRET' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(tel.enabled, false);
  assert.equal(FakeWS.instances.length, 0);
});

test('시험판 env/gen/frame 봉투가 릴레이 검증을 통과한다', async () => {
  FakeWS.instances = [];
  const tel = createLabTelemetry(labOpts());
  tel.env({ ua: { browser: 'Chrome', platform: 'Android' }, screen: { w: 390, h: 844, dpr: 3 } });
  tel.gen({
    type: 'Y', version: 2, ecc: 'M', tones: 3,
    finderPatternId: 'bullseye', qrPosition: 'none', bgMode: 'transparent', quietMode: 'auto',
    text: 'MUST-NOT-APPEAR',
  });
  tel.frame({
    seq: 12, w: 960, h: 960, zoom: 1,
    ms: { total: 210, proposal: 210, verify: 0, format: 0, decode: 0 },
    stage: 'proposal', ok: false, reason: 'frontend:no-finder', type: null, cellPx: null,
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(FakeWS.instances.length, 1);
  const sent = FakeWS.instances[0].sent;
  assert.equal(JSON.parse(sent[0]).role, 'emitter');
  const events = sent.slice(1).map((line) => parseEnvelope(line));
  assert.ok(events.length >= 3, 'env/gen/frame 이 나가야 한다');
  for (const ev of events) {
    assert.equal(ev.ok, true, ev.error);
  }
  const kinds = events.map((ev) => ev.event.kind);
  assert.deepEqual(kinds.slice(0, 3), ['env', 'gen', 'frame']);
  const gen = events.find((ev) => ev.event.kind === 'gen').event;
  assert.equal(gen.body.text, undefined);
  assert.equal(gen.body.type, 'Y');
  const frame = events.find((ev) => ev.event.kind === 'frame').event;
  for (const key of ['total', 'proposal', 'verify', 'format', 'decode']) {
    assert.equal(typeof frame.body.ms[key], 'number');
  }
});

test('sid 는 sessionStorage 이고 쿠키·localStorage 영속 키가 아니다', () => {
  const session = memoryStore();
  const local = memoryStore();
  const tel = createLabTelemetry(labOpts({ sessionStorage: session, localStorage: local }));
  assert.ok(tel.sid.length > 0);
  assert.equal(session.getItem(SID_KEY), tel.sid);
  assert.equal(local.getItem(SID_KEY), null);
});

test('gen 정규화는 페이로드 내용을 버리고 config_id 를 붙인다', () => {
  const body = normalizeGenBody({
    type: 'A', version: 1, ecc: 'L', tones: 3,
    finderPatternId: 'x', qrPosition: 'TL', bgMode: 'white', quietMode: 'none',
    text: 'secret', payload: 'secret', url: 'https://evil.example/',
  });
  assert.deepEqual(Object.keys(body).sort(), [
    'bgMode', 'config_id', 'ecc', 'finderPatternId', 'qrPosition', 'quietMode', 'tones', 'type', 'version',
  ]);
  assert.match(body.config_id, /^c[0-9a-f]{8}$/);
});

test('frame 단계별 ms 가 빠지면 미측정은 null 이고 total 만 숫자다', () => {
  const body = normalizeFrameBody({ seq: 1, w: 10, h: 10, ok: false, reason: 'x' });
  assert.equal(body.ms.total, 0);
  for (const key of ['proposal', 'verify', 'format', 'decode']) {
    assert.equal(body.ms[key], null);
  }
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frame', body)));
  assert.equal(parsed.ok, true, parsed.error);
});

test('classifyStage 는 호환되고 fillFrameMs 는 total 을 단계에 복사하지 않는다', () => {
  assert.equal(classifyStage({ ok: true }), 'decode');
  assert.equal(classifyStage({ ok: false, reason: 'frontend:no-finder' }), 'proposal');
  assert.equal(classifyStage({ ok: false, reason: 'frontend:no-format-candidate' }), 'format');
  assert.equal(classifyStage({ ok: false, reason: 'frontend:reference-mismatch' }), 'verify');
  assert.equal(classifyStage({
    ok: false,
    reason: 'frontend:no-grid-hypothesis',
    detail: { pipelineStage: 'bootstrap-validation' },
  }), 'decode');
  const copied = fillFrameMs(90, 'format');
  assert.equal(copied.total, 90);
  assert.equal(copied.format, null);
  assert.equal(copied.decode, null);
  const measured = fillFrameMs(90, { format: 12, proposal: 30 });
  assert.equal(measured.total, 90);
  assert.equal(measured.format, 12);
  assert.equal(measured.proposal, 30);
  assert.equal(measured.verify, null);
  assert.notEqual(measured.format, measured.total);
});

test('familyToType · estimateCellPx', () => {
  assert.equal(familyToType('hex'), 'O');
  assert.equal(familyToType('tri'), 'A');
  assert.equal(familyToType('cube'), 'Y');
  assert.equal(estimateCellPx({ ok: true, hypothesis: { k: 4 } }, 960, 960), 960 / 9);
});

test('frameShot 은 장변 96px 그레이스케일이고 세션 총량 20을 넘지 않는다', async () => {
  FakeWS.instances = [];
  const tel = createLabTelemetry(labOpts());
  const big = {
    width: 200,
    height: 100,
    data: new Uint8ClampedArray(200 * 100 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i % 255))),
  };
  const shot = shrinkFrameShot(big);
  assert.ok(shot);
  assert.equal(shot.w, 96);
  assert.equal(shot.h, 48);
  assert.ok(shot.png.startsWith('data:image/png;base64,'));
  assert.equal(shot.png.length <= 80 * 1024, true);
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frameShot', {
    seq: 3, w: shot.w, h: shot.h, png: shot.png,
  })));
  assert.equal(parsed.ok, true, parsed.error);

  tel.beginAttempt('a-cap');
  for (let i = 0; i < 40; i += 1) {
    tel.frameShot({
      seq: i,
      imageData: big,
      attempt_id: 'a-cap',
      reason: `frontend:reason-${i}`,
      hasCandidate: i === 0,
    });
  }
  await new Promise((r) => setTimeout(r, 30));
  const shots = FakeWS.instances[0].sent
    .slice(1)
    .map((line) => JSON.parse(line))
    .filter((ev) => ev.kind === 'frameShot');
  assert.ok(shots.length <= 20);
  assert.ok(shots.length >= 8, `층화 표본이 너무 적다: ${shots.length}`);
});

test('소켓 URL 은 같은 호스트의 /lab/ws 다', () => {
  assert.equal(
    labSocketUrl({ protocol: 'https:', host: 'tlscan.estre.so' }),
    'wss://tlscan.estre.so/lab/ws',
  );
  assert.equal(
    labSocketUrl({ protocol: 'http:', host: '127.0.0.1:8787' }),
    'ws://127.0.0.1:8787/lab/ws',
  );
});

test('스캐너는 lab-telemetry 를 절대 경로 /src 로만 import 한다', () => {
  const src = read('sites/tlscan/scanner.js');
  assert.match(src, /from '\/src\/lab-telemetry\.js'/);
  assert.doesNotMatch(src, /from ['"]\.\.?\/.*lab-telemetry/);
});

test('공개 문구는 안정판으로 한정하고 시험판을 구분한다', () => {
  const llms = read('sites/_shared/llms-tlscan.txt');
  const html = read('sites/tlscan/index.html');
  assert.match(llms, /안정판/);
  assert.match(llms, /시험판/);
  assert.match(llms, /\/lab\//);
  assert.match(llms, /축소 이미지/);
  assert.doesNotMatch(
    llms,
    /동작하고, 프레임은 \*\*기기 안에서만\*\* 처리한다\(서버로 이미지를 보내지 않는다\)\./,
  );
  assert.match(html, /안정판은 프레임을 기기 안에서만 처리/);
  assert.match(html, /시험판\(\/lab\/\)/);
  assert.match(html, /id="lab-notice"/);
  assert.match(html, /축소 이미지/);
});

test('안내 카드 3언어와 생성기 사전에 시험판 문구가 있다', () => {
  const strings = read('sites/tlscan/strings.js');
  assert.match(strings, /lab\.notice\.title/);
  assert.match(strings, /기기·카메라 정보와 축소 이미지/);
  assert.match(strings, /Device and camera details, and shrunken frame images/);
  assert.match(strings, /端末・カメラ情報と、フレームの縮小画像/);
  const gen = read('index.html');
  assert.match(gen, /"g512"/);
  assert.match(gen, /"g513"/);
  assert.match(gen, /id="labNotice"/);
  assert.match(gen, /createLabTelemetry\(\{ site: 'gen' \}\)/);
});
