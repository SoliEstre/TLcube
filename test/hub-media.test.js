// hub-media.test.js — 허브·README 미디어의 **성질**을 브라우저 없이 잰다.
//
// 대상: sites/tl/assets/type-{Y,O,C,A,K}.png · type-H.mp4 · type-H.webp(포스터) · type-H-spin.webp
// 만드는 쪽: tools/hub-media.mjs — 헤드리스 Chrome 으로 생성기 자신의 내보내기 버튼을 누르는 수동 도구.
//   CI 에서는 브라우저를 띄우지 않고, H.264 바이트는 브라우저 빌드마다 달라질 수 있어 비교하지 않는다.
//   대신 «매니페스트가 적은 파일 = 디스크의 파일» 과, 허브가 기대하는 성질(RGB·크기·용량·코덱·
//   프레임 수·길이·애니메이션 구조)을 잰다.
//
// ⚠ 파서는 도구의 것을 import 하지 않는다 — 같은 파서로 재면 파서의 결함이 스스로를 가린다.
// ⚠ 영상 길이는 숫자로 적지 않고 **생성기 기본값에서 유도**한다(회전 축·기울임 모드 + H1 기본 속도).
//   H 회전 기본값이 바뀌면 여기가 빨개진다 — 고치는 법은 테스트 수정이 아니라
//   `node tools/hub-media.mjs --only=video --write` 로 다시 만드는 것이다.
// ⚠ 매니페스트의 source HEAD 는 현재 HEAD 와 비교하지 않는다 — 커밋할 때마다 빨개지는 자는
//   아무것도 지키지 않는다(생성 당시의 기록일 뿐이다).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cubeVideoDurationMs } from '../src/cube-video-export.js';
import { hRotationSpeedDefault } from '../src/generator-h.js';
import { createGeneratorState } from '../src/generator-state.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ASSETS = path.join(ROOT, 'sites', 'tl', 'assets');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'hub-media.manifest.json'), 'utf8'));

const KB = 1024;
const MB = 1024 * 1024;
const PAYLOAD = 'https://tl.estre.so';
const STILLS = ['Y', 'O', 'C', 'A', 'K'].map((t) => `type-${t}.png`);
const MP4 = 'type-H.mp4';
const POSTER = 'type-H.webp';
const SPIN = 'type-H-spin.webp';

// 허브 영상 규격: 720 · 30 fps. 30 fps 는 기본 9.6 s 주기를 정수 프레임(288)으로 닫는다.
const VIDEO_SIZE = 720;
const VIDEO_FPS = 30;
const SPIN_SIZE = 360;

/** 6면 고유 데이터 H 는 자동으로 H1 이 된다 — 그 버전의 기본 속도와 생성기 기본 축·기울임으로 한 주기. */
function expectedVideoMs() {
  const state = createGeneratorState();
  return cubeVideoDurationMs({
    speed: hRotationSpeedDefault(1, state.hRotationMode),
    axis: state.hRotationMode,
    tiltMode: state.hRotationTiltMode,
  });
}

const read = (name) => readFileSync(path.join(ASSETS, name));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entry = (group, name) => {
  const e = MANIFEST[group]?.files?.[name];
  assert.ok(e, `매니페스트 ${group}.files 에 ${name} 가 없다 — node tools/hub-media.mjs --write 로 다시 만들어라`);
  return e;
};

// ── 독립 파서 ─────────────────────────────────────────────────────────────

function pngIhdr(bytes) {
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', 'PNG 서명이 아니다');
  assert.equal(bytes.toString('latin1', 12, 16), 'IHDR', 'IHDR 이 첫 청크가 아니다');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24], colorType: bytes[25] };
}

function boxes(b, start, end) {
  const out = [];
  let at = start;
  while (at < end) {
    assert.ok(at + 8 <= end, 'MP4 상자 머리가 잘렸다');
    const size = b.readUInt32BE(at);
    assert.ok(size >= 8 && at + size <= end, 'MP4 상자 크기가 범위 밖이다');
    out.push({ type: b.toString('latin1', at + 4, at + 8), start: at, data: at + 8, end: at + size });
    at += size;
  }
  assert.equal(at, end, 'MP4 상자가 부모 끝에 딱 맞지 않는다');
  return out;
}
function child(b, parent, type, skip = 0) {
  const found = boxes(b, parent.data + skip, parent.end).find((x) => x.type === type);
  assert.ok(found, `MP4: ${parent.type} 안에 ${type} 가 없다`);
  return found;
}
function parseMp4(b) {
  const roots = boxes(b, 0, b.length);
  const root = (type) => roots.find((x) => x.type === type);
  const moov = root('moov');
  const mdat = root('mdat');
  const trak = child(b, moov, 'trak');
  const mdia = child(b, trak, 'mdia');
  const stbl = child(b, child(b, mdia, 'minf'), 'stbl');
  const avc1 = child(b, child(b, stbl, 'stsd'), 'avc1', 8);
  const avcC = child(b, avc1, 'avcC', 78);
  const mvhd = child(b, moov, 'mvhd');
  const mdhd = child(b, mdia, 'mdhd');
  const tkhd = child(b, trak, 'tkhd');
  const stco = child(b, stbl, 'stco');
  return {
    order: roots.map((x) => x.type),
    profile: b[avcC.data + 1],
    avc1: [b.readUInt16BE(avc1.data + 24), b.readUInt16BE(avc1.data + 26)],
    tkhd: [b.readUInt32BE(tkhd.end - 8) / 65536, b.readUInt32BE(tkhd.end - 4) / 65536],
    samples: b.readUInt32BE(child(b, stbl, 'stsz').data + 8),
    mdhdMs: (b.readUInt32BE(mdhd.data + 16) * 1000) / b.readUInt32BE(mdhd.data + 12),
    mvhdMs: (b.readUInt32BE(mvhd.data + 16) * 1000) / b.readUInt32BE(mvhd.data + 12),
    stco: Array.from({ length: b.readUInt32BE(stco.data + 4) }, (_, i) => b.readUInt32BE(stco.data + 8 + i * 4)),
    mdatData: mdat?.data,
  };
}

function riff(b, start, end) {
  const out = [];
  let at = start;
  while (at < end) {
    assert.ok(at + 8 <= end, 'WebP 청크 머리가 잘렸다');
    const size = b.readUInt32LE(at + 4);
    assert.ok(at + 8 + size <= end, 'WebP 청크가 범위 밖이다');
    out.push({ fourcc: b.toString('latin1', at, at + 4), data: at + 8, size });
    at += 8 + size + (size & 1);
  }
  return out;
}
function webpChunks(b) {
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.toString('latin1', 8, 12), 'WEBP');
  assert.equal(b.readUInt32LE(4) + 8, b.length, 'RIFF 크기가 파일 길이와 다르다');
  return riff(b, 12, b.length);
}
/** 비트스트림 청크(VP8 / VP8L)에서 폭·높이. */
function bitstreamSize(b, c) {
  if (c.fourcc === 'VP8L') {
    assert.equal(b[c.data], 0x2f, 'VP8L 서명');
    const bits = b.readUInt32LE(c.data + 1);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  assert.equal(c.fourcc, 'VP8 ');
  assert.deepEqual([b[c.data + 3], b[c.data + 4], b[c.data + 5]], [0x9d, 0x01, 0x2a], 'VP8 시작 코드');
  return [b.readUInt16LE(c.data + 6) & 0x3fff, b.readUInt16LE(c.data + 8) & 0x3fff];
}

// ── 단언 ──────────────────────────────────────────────────────────────────

test('허브 미디어: 매니페스트가 적은 파일 = 디스크의 파일 (sha256 · 바이트), 여덟 개 전부', () => {
  assert.equal(MANIFEST.payload, PAYLOAD);
  const listed = { stills: Object.keys(MANIFEST.stills?.files ?? {}), video: Object.keys(MANIFEST.video?.files ?? {}) };
  assert.deepEqual([...listed.stills].sort(), [...STILLS].sort(), '정지 이미지 다섯 장이 매니페스트에 다 있어야 한다');
  assert.deepEqual([...listed.video].sort(), [MP4, POSTER, SPIN].sort(), 'H 영상·포스터·스핀이 매니페스트에 다 있어야 한다');
  for (const [group, names] of Object.entries(listed)) {
    const from = MANIFEST[group].generatedFrom;
    assert.match(String(from?.head), /^[0-9a-f]{40}$/, `${group}: 생성 당시 HEAD 가 기록돼야 한다`);
    assert.equal(typeof from.dirty, 'boolean', `${group}: dirty 플래그가 기록돼야 한다`);
    assert.ok(from.browser && from.generatorBuild, `${group}: 브라우저·생성기 빌드가 기록돼야 한다`);
    for (const name of names) {
      const bytes = read(name);
      const e = entry(group, name);
      assert.equal(e.bytes, bytes.length, `${name}: 매니페스트 바이트 ≠ 디스크`);
      assert.equal(e.sha256, sha256(bytes), `${name}: 매니페스트 sha256 ≠ 디스크 — 손으로 바꿨거나 도구가 매니페스트를 안 썼다`);
    }
  }
  // og:image 는 이 도구의 대상이 아니다(링크 미리보기 규칙은 site-og-image.test.js 가 지킨다).
  assert.ok(!('og-banner.png' in (MANIFEST.stills?.files ?? {})), 'og-banner.png 는 이 도구가 건드리지 않는다');
});

test('허브 미디어: 타입 이미지 — 불투명 RGB · 짧은 변 650‥1100 px · 200 KB 이하 · 스캐너가 읽었다', () => {
  for (const name of STILLS) {
    const bytes = read(name);
    const ihdr = pngIhdr(bytes);
    const e = entry('stills', name);
    assert.equal(ihdr.bitDepth, 8, `${name}: 비트 심도`);
    assert.equal(ihdr.colorType, 2, `${name}: 색 타입 ${ihdr.colorType} — 불투명 RGB(2)여야 한다 (카드 배경과 합성된 평탄 이미지)`);
    const short = Math.min(ihdr.width, ihdr.height);
    assert.ok(short >= 650 && short <= 1100, `${name}: 짧은 변 ${short} px`);
    assert.ok(bytes.length <= 200 * KB, `${name}: ${bytes.length} B > 200 KB`);
    assert.deepEqual([e.width, e.height], [ihdr.width, ihdr.height], `${name}: 매니페스트 크기 ≠ 실제`);
    // 허브 캡션은 «모든 코드가 이 URL 을 싣는다» 고 약속한다. 새로 만든 것이든 둔 것이든 실제
    // 스캐너(사진 업로드 경로)가 읽어 낸 값이 기록돼 있어야 한다.
    assert.equal(e.scanner, PAYLOAD, `${name}: 스캐너 사진 경로가 읽은 값이 ${JSON.stringify(e.scanner)}`);
  }
});

test('허브 미디어: H 영상 — ftyp,moov,mdat · AVC Baseline · 720² · 프레임 수·길이가 생성기 기본 한 주기 · 2.5 MB 이하', () => {
  const bytes = read(MP4);
  const m = parseMp4(bytes);
  const ms = expectedVideoMs();
  const frames = Math.ceil((ms * VIDEO_FPS) / 1000);
  assert.deepEqual(m.order, ['ftyp', 'moov', 'mdat'], 'moov 가 mdat 앞에 있어야 한다(faststart) — 재생 전 꼬리 요청이 생긴다');
  assert.equal(m.profile, 0x42, `AVC 프로필 ${m.profile} — Baseline(0x42)이어야 한다`);
  assert.deepEqual(m.avc1, [VIDEO_SIZE, VIDEO_SIZE], 'avc1 크기');
  assert.deepEqual(m.tkhd, [VIDEO_SIZE, VIDEO_SIZE], 'tkhd 크기');
  assert.equal(m.samples, frames, `표본 ${m.samples} — ${ms} ms × ${VIDEO_FPS} fps 면 ${frames} 여야 한다 (H 기본 회전이 바뀌었으면 영상을 다시 만들어라)`);
  assert.equal(m.mdhdMs, ms, `트랙 길이 ${m.mdhdMs} ms ≠ 생성기 기본 한 주기 ${ms} ms`);
  assert.equal(m.mvhdMs, ms, `영화 길이 ${m.mvhdMs} ms ≠ ${ms} ms`);
  assert.deepEqual(m.stco, [m.mdatData], 'stco 단일 청크 오프셋이 mdat 본문 시작을 가리켜야 한다 (moov 이동 후 오프셋 보정)');
  assert.ok(bytes.length <= 2.5 * MB, `${bytes.length} B > 2.5 MB`);
  const e = entry('video', MP4);
  assert.equal(e.frames, m.samples);
  assert.equal(e.durationMs, ms);
  assert.equal(MANIFEST.video.config.fps, VIDEO_FPS);
  assert.equal(MANIFEST.video.config.background, 'checker', '허브 영상은 «투명 표시 격자» 배경이다');
});

test('허브 미디어: H 포스터 — WebP · 영상과 같은 크기 · 60 KB 이하', () => {
  const bytes = read(POSTER);
  const chunks = webpChunks(bytes);
  const stream = chunks.find((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
  assert.ok(stream, '포스터에 VP8/VP8L 비트스트림이 없다');
  assert.ok(!chunks.some((c) => c.fourcc === 'ANIM'), '포스터는 정지 이미지여야 한다');
  const m = parseMp4(read(MP4));
  assert.deepEqual(bitstreamSize(bytes, stream), m.avc1, '포스터 크기가 영상 크기와 달라 첫 프레임에서 튄다');
  assert.ok(bytes.length <= 60 * KB, `${bytes.length} B > 60 KB`);
});

// ⚠ **의도적 갱신** (2026-09-25, 검토 반영): 프레임 코덱을 «VP8L(무손실)» 로 못 박던 단언을
//   «매니페스트가 적은 frameCodec(VP8L 무손실 · 'VP8 ' 손실) 하나로 모든 프레임이 같다» 로 바꿨다.
//   무손실만으로는 2 MB 안에 10 fps 첫 바퀴밖에 안 들어가 README 첫 그림이 끊겨 보였고, 도구가
//   손실 안(toBlob q 0.85)을 먼저 시도하게 됐다. 손실 프레임에 알파(ALPH)가 끼면 여전히 실패한다.
test('허브 미디어: README 스핀 — VP8X 애니메이션 + ANIM + ANMF · 360² 프레임(매니페스트의 코덱 하나로 통일) · 무한 반복 · 길이 = 영상 한 주기(첫 바퀴면 절반) · 2 MB 이하', () => {
  const bytes = read(SPIN);
  const chunks = webpChunks(bytes);
  const codec = entry('video', SPIN).frameCodec;
  assert.ok(['VP8L', 'VP8 '].includes(codec), `매니페스트 스핀 frameCodec ${JSON.stringify(codec)} — VP8L 또는 'VP8 ' 여야 한다`);
  assert.equal(chunks[0].fourcc, 'VP8X', '확장 WebP(VP8X)로 시작해야 한다');
  assert.ok(bytes[chunks[0].data] & 0x02, 'VP8X 애니메이션 플래그');
  assert.deepEqual(
    [bytes.readUIntLE(chunks[0].data + 4, 3) + 1, bytes.readUIntLE(chunks[0].data + 7, 3) + 1],
    [SPIN_SIZE, SPIN_SIZE], '스핀 캔버스 크기',
  );
  const anim = chunks.find((c) => c.fourcc === 'ANIM');
  assert.ok(anim, 'ANIM 청크가 없다');
  assert.equal(bytes.readUInt16LE(anim.data + 4), 0, '반복 횟수 0(무한)이어야 한다');
  const frames = chunks.filter((c) => c.fourcc === 'ANMF');
  assert.ok(frames.length >= 2, `ANMF 프레임 ${frames.length}개`);
  let total = 0;
  for (const [i, f] of frames.entries()) {
    const at = f.data;
    assert.deepEqual([bytes.readUIntLE(at, 3), bytes.readUIntLE(at + 3, 3)], [0, 0], `${i} 번 프레임 위치`);
    assert.deepEqual([bytes.readUIntLE(at + 6, 3) + 1, bytes.readUIntLE(at + 9, 3) + 1], [SPIN_SIZE, SPIN_SIZE], `${i} 번 프레임 크기`);
    total += bytes.readUIntLE(at + 12, 3);
    const inner = riff(bytes, at + 16, at + f.size);
    const streams = inner.filter((c) => c.fourcc === 'VP8L' || c.fourcc === 'VP8 ');
    assert.ok(streams.length === 1 && streams[0].fourcc === codec && !inner.some((c) => c.fourcc === 'ALPH'),
      `${i} 번 프레임이 ${JSON.stringify(codec)} 단일 비트스트림(알파 없음)이 아니다: ${inner.map((c) => c.fourcc).join('+')}`);
    assert.deepEqual(bitstreamSize(bytes, streams[0]), [SPIN_SIZE, SPIN_SIZE], `${i} 번 프레임 비트스트림 크기`);
  }
  const e = entry('video', SPIN);
  const ms = expectedVideoMs();
  // 용량 상한 때문에 첫 바퀴(0‥143)만 쓴 경우 매니페스트가 그렇게 적는다. 'turn' 기울임은 바퀴
  // 경계에서 기울임·기울임 속도가 0 이라 첫 바퀴만으로도 이음매가 없다.
  assert.ok(['loop', 'first-turn'].includes(e.span), `스핀 span ${e.span}`);
  assert.equal(total, e.span === 'loop' ? ms : ms / 2, `스핀 길이 ${total} ms (span ${e.span}, 영상 ${ms} ms)`);
  assert.equal(e.frames, frames.length);
  assert.equal(e.durationMs, total);
  assert.ok(bytes.length <= 2 * MB, `${bytes.length} B > 2 MB`);
});
