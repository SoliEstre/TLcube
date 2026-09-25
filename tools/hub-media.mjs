#!/usr/bin/env node
/**
 * tools/hub-media.mjs — 허브(tl.estre.so)·README 의 타입 이미지와 타입 H 회전 영상을
 * **생성기 자신의 내보내기 경로**로 다시 만든다.
 *
 * 왜 브라우저를 모는가: 타입마다의 기본 좌석·파인더·보조 QR·버전 선택은 index.html 안에서
 * 정해진다. Node 로 그 로직의 손 사본을 만들면 기본값이 바뀌는 날 조용히 어긋난다
 * (tools/asset-render.mjs 의 기본 상태 사본이 바로 그렇게 낡았다). 그래서 실제 생성기
 * 페이지를 헤드리스 Chrome 으로 열고 사용자가 누르는 버튼(#exportPng · #exportCubeVideo)을
 * 그대로 누른다.
 *
 * 산출물 — 전부 sites/tl/assets/, 전부 https://tl.estre.so 를 싣는다
 *   type-{Y,O,C,A,K}.png  각 타입 기본 상태의 1024 PNG → 기본 프리셋 배경에 평탄화 → 내용 경계 + 48 px
 *                         (C 는 O + «초 대용량» = C0)
 *                         Y 를 뺀 넷(O·C·A·K)은 «안전영역» 의 여백 줄에서 «자동» 을 끄고 4 셀로 맞춘다
 *                         (STILL_QUIET). 자동 두께는 «스캔이 되는 최소» 를 코드 폭 배수로 맞춘 값이라
 *                         허브 한 칸에선 흰 테두리가 타입마다 두껍고 제각각이었다. 색 모드는 기본(자동)
 *                         그대로다. Y 는 기본 상태 그대로 뜬다(Y 의 자동 안전영역은 그리지 않는다).
 *                         O·A 는 기본 파인더가 스캐너 게이트에서 떨어지면 같은 4 셀로 «중앙 QR»
 *                         파인더 선택지(QR 위치 «안쪽» 카드)를 한 번 더 시도하고, 매니페스트에
 *                         finder: 'centre-qr' 와 떨어진 이유를 적는다. 그것도 떨어지면 기존 파일을 둔다.
 *                         자른 결과의 짧은 변이 하한 아래면 같은 설정을 더 큰 «커스텀» 크기로 한 번 더
 *                         내보낸다(stillResizeFor) — 게이트를 낮추지 않고 화소를 늘린다. 매니페스트의
 *                         파일별 exportSize · resizedFrom 이 그 기록이다.
 *   type-H.mp4            타입 H(6면 고유 데이터) 회전 영상 — «투명 표시 격자» 배경 · 720 · 30 fps ·
 *                         기본 회전 한 주기 · moov 를 앞으로 옮김(faststart)
 *   type-H.webp           같은 내보내기의 0 번 프레임(타임스탬프 0) 포스터
 *   type-H-spin.webp      README 용 360 px 애니메이션 WebP (GitHub 는 <video> 를 지운다)
 *   tools/hub-media.manifest.json  무엇을 어떤 조건에서 만들었는지
 *
 * 사용자 다운로드와 다른 점은 **셋**이다. 매니페스트의 video.config.deviation 에도 그렇게 적는다.
 *   ① 영상 비트레이트 — 생성기 공식은 720p30 에 약 10 Mbps 라 허브 한 칸에는 과하다. 그래서 페이지
 *      안에서 VideoEncoder.configure 의 bitrate 만 바꾼다.
 *   ② faststart — 생성기 MP4 는 ftyp·mdat·moov 순이다. 바로 재생되게 moov 를 mdat 앞으로 옮기고
 *      stco 오프셋을 고친다(mdat 바이트는 그대로).
 *   ③ 시작 자세 — 사용자 다운로드는 미리보기의 현재 회전 위치에서 시작하고, 이 도구는 면 카드를
 *      다시 눌러 회전 0 에서 시작한다(포스터 = 0 번 프레임 = 기본 자세).
 *   프레임과 avcC 는 생성기 것 그대로다.
 *
 * 게이트 — 하나라도 어기면 그 파일은 바꾸지 않는다
 *   정지 이미지: ① 생성기 자체 검사(#selfCheckRow 에 ✓) ② 실제 스캐너(/sites/tlscan/)의 사진
 *     업로드 경로가 https://tl.estre.so 로 읽는다. 맨 decodeFrontend 호출은 스캐너가 쓰는 경로가
 *     아니라서 참고로만 기록한다. 그리고 PNG 성질(RGB · 짧은 변 · 용량).
 *   영상: configure 가 정확히 한 번 · 0 번 프레임이 타임스탬프 0 · 스핀 프레임 코덱이 그 안(plan)의
 *     것(손실 'VP8 ' / 무손실 VP8L — 알파 없음) · 상자 배치 · 코덱 · 크기 · 프레임 수 · 길이 · 용량 ·
 *     포스터 크기 = 영상 크기.
 *
 * 사용법
 *   node tools/hub-media.mjs                        드라이런 — 임시 폴더에만 쓰고 그 경로를 알린다
 *   node tools/hub-media.mjs --write                게이트를 다 통과하면 저장소 파일을 바꾼다
 *   node tools/hub-media.mjs --only=stills          정지 이미지만 (또는 --only=video)
 *   node tools/hub-media.mjs --write --keep-failed  실패한 쪽은 기존 파일을 두고 나머지만 쓴다
 *   TLCUBE_BROWSER=<실행 파일>                      브라우저 지정 (없으면 Chrome → Edge 순으로 찾는다)
 *
 * ⚠ 수동 도구다. 이름이 build-* 가 아니라서 신선도 테스트·rebuild-all·CI 에 들어가지 않는다 —
 *   H.264 바이트는 브라우저 빌드마다 달라질 수 있어 CI 에서 바이트를 비교할 수 없다.
 *   산출물의 **성질**은 test/hub-media.test.js 가 브라우저 없이 잰다.
 * ⚠ 전부 포그라운드로 돈다(정지 이미지만 3 분 안팎 — O·A 는 두 번 시도한다). 로컬 서버는
 *   127.0.0.1 에만 열고, 브라우저는 로컬 외 호스트 이름을 못 풀게 띄운다 — 스캐너의 링크 자동 열기·계측 비콘이 밖으로 나가지 않는다.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cubeVideoDurationMs } from '../src/cube-video-export.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { hRotationSpeedDefault } from '../src/generator-h.js';
import { createGeneratorState } from '../src/generator-state.js';
import { DEFAULT_PRESET, getPreset } from '../src/luminance.js';
import { rasterToPng } from '../src/png.js';
import { pngToRaster } from './asset-render.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SELF = fileURLToPath(import.meta.url);
const ASSETS = path.join(ROOT, 'sites', 'tl', 'assets');
export const MANIFEST_FILE = path.join(ROOT, 'tools', 'hub-media.manifest.json');

const KB = 1024;
const MB = 1024 * 1024;

/** 허브 캡션이 약속하는 내용 — 모든 타입 이미지와 영상이 이 URL 을 싣는다. */
export const PAYLOAD = 'https://tl.estre.so';

export const STILL_TYPES = Object.freeze(['Y', 'O', 'C', 'A', 'K']);
export const STILL = Object.freeze({
  exportSize: 1024,
  cropPad: 48,
  maxBytes: 200 * KB,
  shortSide: Object.freeze([650, 1100]),
  // 자른 결과의 짧은 변이 하한에 못 미치면 같은 시도를 이 배수의 «커스텀» 크기로 한 번 더 내보낸다
  // (stillResizeFor). 중앙 QR 선택지는 모서리 QR 자리를 비워 둔 채 같은 장면 크기를 써서,
  // 1024 에서 O 의 자른 결과가 648×598 로 하한 아래였다(2026-09-25).
  resizeStep: 128,
  resizeMargin: 8,
});

/**
 * 짧은 변이 하한(STILL.shortSide[0])에 못 미치는 자른 결과를 하한 + 여유 위로 올리는 내보내기 크기.
 * 내용(자른 결과 − 양쪽 cropPad)은 내보내기 크기에 비례하므로 거기서 역산하고, resizeStep 의 배수로
 * 올린다. 하한을 넘으면 null(다시 내보내지 않는다). 다시 낸 결과도 같은 게이트를 다 지난다.
 */
export function stillResizeFor(short, exportSize = STILL.exportSize) {
  if (short >= STILL.shortSide[0]) return null;
  const content = short - 2 * STILL.cropPad;
  if (!(content > 0)) throw new Error(`자른 결과의 짧은 변 ${short} px 에 내용이 없다`);
  const want = STILL.shortSide[0] + STILL.resizeMargin - 2 * STILL.cropPad;
  return Math.ceil((exportSize * want) / content / STILL.resizeStep) * STILL.resizeStep;
}

/**
 * 정지 이미지의 안전영역 여백 — Y 를 뺀 타입은 생성기 «안전영역» 절의 여백 줄에서 «자동»
 * (#quietMarginAuto)을 끄고 슬라이더(#quietMarginRange)를 이 셀 수로 맞춘다. 사용자가 누르는 그대로다.
 * Y 는 넣지 않는다 — Y 의 자동 안전영역은 실루엣을 지키려고 그리지 않아서 두께가 아무 데도 안 쓰인다.
 */
export const STILL_QUIET = Object.freeze({ cells: 4, types: Object.freeze(['O', 'C', 'A', 'K']) });
/** 기본 파인더가 스캐너 게이트에서 떨어지면 «중앙 QR» 파인더 선택지로 한 번 더 시도하는 타입. */
export const STILL_CENTRE_QR_FALLBACK = Object.freeze(['O', 'A']);

/** 한 타입의 시도 목록 — 앞에서부터 게이트를 다 넘는 첫 시도를 쓴다. */
export function stillAttempts(type) {
  const quietCells = STILL_QUIET.types.includes(type) ? STILL_QUIET.cells : null;
  const finders = STILL_CENTRE_QR_FALLBACK.includes(type) ? ['default', 'centre-qr'] : ['default'];
  return finders.map((finder) => ({ finder, quietCells }));
}

export const VIDEO = Object.freeze({
  file: 'type-H.mp4',
  faces: 6, // 6면 고유 데이터 — 자동으로 H1 17×17 이 된다. 어느 면이 보여도 코드가 있다.
  hVersion: 1, // 6면 자동 해상도가 고르는 버전. 기본 회전 속도가 이 버전에서 나온다.
  background: 'checker', // «투명 표시 격자» — bgMode 가 transparent(기본)일 때만 효력이 있다.
  fps: 30, // 24 fps 는 ceil 로 231 프레임이 돼 0.26% 느리게 돈다. 30 fps 는 정확히 288.
  size: 720,
  bitrate: 1_500_000, // 유일한 이탈. 생성기 공식은 이 크기에 약 10 Mbps.
  maxBytes: 2.5 * MB,
});
export const POSTER = Object.freeze({ file: 'type-H.webp', quality: 0.85, maxBytes: 60 * KB });
export const SPIN = Object.freeze({
  file: 'type-H-spin.webp',
  size: 360,
  maxBytes: 2 * MB,
  // 위에서부터 용량 상한 안에 드는 첫 안을 쓴다. first-turn 은 첫 바퀴(0‥143)만 —
  // 'turn' 기울임은 바퀴 경계에서 기울임·기울임 속도가 0 이라 첫 바퀴만 돌려도 이음매가 없다.
  // quality 는 캔버스 toBlob('image/webp', q) 값이다: 1 이면 Chrome 이 무손실(VP8L)로, 그 아래면
  // 손실('VP8 ')로 낸다. 손실 안을 앞에 둔다 — 무손실 프레임은 이 크기에서 손실 q≈0.85 의 약 3 배라,
  // 무손실만 쓰면 2 MB 안에 10 fps 첫 바퀴(한 프레임에 7.5° 도는 끊긴 움직임)밖에 안 들어갔다.
  // 무손실 안은 뒤에 남겨 둔다(손실 인코더가 없거나 예상보다 커질 때의 마지막 길).
  plans: Object.freeze([
    Object.freeze({ step: 2, span: 'loop', quality: 0.85 }),
    Object.freeze({ step: 2, span: 'first-turn', quality: 0.85 }),
    Object.freeze({ step: 3, span: 'loop', quality: 0.85 }),
    Object.freeze({ step: 3, span: 'first-turn', quality: 0.85 }),
    Object.freeze({ step: 2, span: 'loop', quality: 1 }),
    Object.freeze({ step: 3, span: 'loop', quality: 1 }),
    Object.freeze({ step: 2, span: 'first-turn', quality: 1 }),
    Object.freeze({ step: 3, span: 'first-turn', quality: 1 }),
  ]),
});

/** 스핀 안의 프레임 코덱 — toBlob 품질 1 은 무손실(VP8L), 그 아래는 손실('VP8 '). */
export const spinFrameCodec = (quality) => (quality >= 1 ? 'VP8L' : 'VP8 ');
/** 싱크 파일 이름에 쓰는 품질 표지(q85 · q100). */
export const spinQualityTag = (quality) => `q${Math.round(quality * 100)}`;

const PREFIX = 'tlcube-hub-media-';
const WATCHDOG_MS = 15 * 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** 생성기 기본 회전(축·기울임 모드)과 H1 기본 속도로 정해지는 영상 한 주기. */
export function expectedVideoDurationMs() {
  const state = createGeneratorState();
  return cubeVideoDurationMs({
    speed: hRotationSpeedDefault(VIDEO.hVersion, state.hRotationMode),
    axis: state.hRotationMode,
    tiltMode: state.hRotationTiltMode,
  });
}

// ── PNG ──────────────────────────────────────────────────────────────────

/** IHDR 만 읽는다 — 폭·높이·색 타입. */
export function pngHeader(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 33 || b.readUInt32BE(12) !== 0x49484452) throw new Error('PNG: IHDR 이 첫 청크가 아니다');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colorType: b[25] };
}

/**
 * 투명 배경 내보내기를 배경색 위에 평탄화하고, 불투명 픽셀 경계 + pad 로 자른다.
 * 경계 + pad 가 원본 밖으로 나가면 배경색으로 채운다 — 네 변의 여백이 늘 같다.
 */
export function flattenAndCrop(raster, background, pad) {
  const { width: W, height: H, pixels: p } = raster;
  let minX = W; let minY = H; let maxX = -1; let maxY = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (p[(y * W + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('내보낸 PNG 에 불투명 픽셀이 하나도 없다');
  const x0 = minX - pad;
  const y0 = minY - pad;
  const w = maxX - minX + 1 + 2 * pad;
  const h = maxY - minY + 1 + 2 * pad;
  const out = new Uint8ClampedArray(w * h * 4);
  const { r: br, g: bg, b: bb } = background;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const sx = x + x0;
      const sy = y + y0;
      let r = br; let g = bg; let b = bb;
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
        const i = (sy * W + sx) * 4;
        const a = p[i + 3];
        if (a === 255) { r = p[i]; g = p[i + 1]; b = p[i + 2]; } else if (a > 0) {
          r = Math.round((p[i] * a + br * (255 - a)) / 255);
          g = Math.round((p[i + 1] * a + bg * (255 - a)) / 255);
          b = Math.round((p[i + 2] * a + bb * (255 - a)) / 255);
        }
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return {
    raster: { width: w, height: h, pixels: out },
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

// ── MP4 (ISO BMFF) ───────────────────────────────────────────────────────

function readBoxes(b, start, end) {
  const out = [];
  let at = start;
  while (at < end) {
    if (at + 8 > end) throw new Error('MP4: 잘린 상자 머리');
    let size = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) { size = Number(b.readBigUInt64BE(at + 8)); header = 16; } else if (size === 0) size = end - at;
    if (size < header || at + size > end) throw new Error(`MP4: ${type} 상자 크기가 범위를 벗어났다`);
    out.push({ type, start: at, end: at + size, data: at + header, size });
    at += size;
  }
  return out;
}

function childBox(b, parent, type, skip = 0) {
  const found = readBoxes(b, parent.data + skip, parent.end).find((box) => box.type === type);
  if (!found) throw new Error(`MP4: ${parent.type} 안에 ${type} 가 없다`);
  return found;
}

/** 생성기 muxer 가 쓰는 단일 비디오 트랙 MP4 를 읽는다 (버전 0 상자만). */
export function inspectMp4(bytes) {
  const b = Buffer.from(bytes);
  const roots = readBoxes(b, 0, b.length);
  const root = (type) => {
    const found = roots.find((box) => box.type === type);
    if (!found) throw new Error(`MP4: 최상위 ${type} 가 없다`);
    return found;
  };
  const ftyp = root('ftyp');
  const moov = root('moov');
  const mdat = root('mdat');
  const mvhd = childBox(b, moov, 'mvhd');
  const trak = childBox(b, moov, 'trak');
  const tkhd = childBox(b, trak, 'tkhd');
  const mdia = childBox(b, trak, 'mdia');
  const mdhd = childBox(b, mdia, 'mdhd');
  const minf = childBox(b, mdia, 'minf');
  const stbl = childBox(b, minf, 'stbl');
  const stsd = childBox(b, stbl, 'stsd');
  const avc1 = childBox(b, stsd, 'avc1', 8);
  const avcC = childBox(b, avc1, 'avcC', 78);
  const stsz = childBox(b, stbl, 'stsz');
  const stss = childBox(b, stbl, 'stss');
  const stco = childBox(b, stbl, 'stco');
  for (const box of [mvhd, tkhd, mdhd]) {
    if (b[box.data] !== 0) throw new Error(`MP4: ${box.type} 버전 ${b[box.data]} 은 읽지 않는다`);
  }
  const timescale = b.readUInt32BE(mdhd.data + 12);
  const duration = b.readUInt32BE(mdhd.data + 16);
  const movieTimescale = b.readUInt32BE(mvhd.data + 12);
  const movieDuration = b.readUInt32BE(mvhd.data + 16);
  const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  const [profile, compat, level] = [b[avcC.data + 1], b[avcC.data + 2], b[avcC.data + 3]];
  const chunkCount = b.readUInt32BE(stco.data + 4);
  const chunkOffsets = Array.from({ length: chunkCount }, (_, i) => b.readUInt32BE(stco.data + 8 + i * 4));
  return {
    bytes: b.length,
    layout: roots.map((box) => box.type).join(','),
    brand: b.toString('latin1', ftyp.data, ftyp.data + 4),
    codec: `avc1.${hex(profile)}${hex(compat)}${hex(level)}`,
    profile,
    trackWidth: b.readUInt32BE(tkhd.end - 8) / 65536,
    trackHeight: b.readUInt32BE(tkhd.end - 4) / 65536,
    width: b.readUInt16BE(avc1.data + 24),
    height: b.readUInt16BE(avc1.data + 26),
    frames: b.readUInt32BE(stsz.data + 8),
    keyframes: b.readUInt32BE(stss.data + 4),
    timescale,
    duration,
    durationMs: (duration * 1000) / timescale,
    movieDurationMs: (movieDuration * 1000) / movieTimescale,
    chunkOffsets,
    stcoFirstEntry: stco.data + 8,
    mdat: { start: mdat.start, data: mdat.data, end: mdat.end },
  };
}

/**
 * moov 를 mdat 앞으로 옮긴다. 생성기 muxer 는 청크 하나(stco 항목 1개)로 쓰므로
 * 그 오프셋 하나만 moov 크기만큼 민다. 표본 바이트는 한 바이트도 안 바뀐다.
 * (배치 ftyp,mdat,moov 자체는 test/cube-video-export.test.js 가 muxer 에 잠가 두었다 — 여기서 고친다.)
 */
export function faststart(bytes) {
  const b = Buffer.from(bytes);
  const info = inspectMp4(b);
  if (info.layout === 'ftyp,moov,mdat') return b;
  if (info.layout !== 'ftyp,mdat,moov') throw new Error(`MP4: 예상 밖 상자 배치 ${info.layout}`);
  if (info.chunkOffsets.length !== 1 || info.chunkOffsets[0] !== info.mdat.data) {
    throw new Error('MP4: 단일 청크 stco 가 mdat 본문을 가리키지 않는다');
  }
  const roots = readBoxes(b, 0, b.length);
  const [ftyp, mdat, moov] = roots;
  const moovBytes = Buffer.from(b.subarray(moov.start, moov.end));
  const newDataStart = ftyp.size + moov.size + (mdat.data - mdat.start);
  moovBytes.writeUInt32BE(newDataStart, info.stcoFirstEntry - moov.start);
  const out = Buffer.concat([b.subarray(ftyp.start, ftyp.end), moovBytes, b.subarray(mdat.start, mdat.end)]);
  const after = inspectMp4(out);
  if (after.layout !== 'ftyp,moov,mdat' || after.chunkOffsets[0] !== after.mdat.data) {
    throw new Error('MP4: faststart 뒤 stco 가 mdat 본문을 가리키지 않는다');
  }
  if (Buffer.compare(out.subarray(after.mdat.start, after.mdat.end), b.subarray(mdat.start, mdat.end)) !== 0) {
    throw new Error('MP4: faststart 가 mdat 바이트를 바꿨다');
  }
  return out;
}

// ── WebP ─────────────────────────────────────────────────────────────────

export function riffChunks(bytes, start = 12, end = null) {
  const b = Buffer.from(bytes);
  if (start === 12) {
    if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') {
      throw new Error('WebP: RIFF/WEBP 머리가 아니다');
    }
    if (b.readUInt32LE(4) + 8 !== b.length) throw new Error('WebP: RIFF 크기가 파일 길이와 다르다');
  }
  const stop = end ?? b.length;
  const out = [];
  let at = start;
  while (at < stop) {
    if (at + 8 > stop) throw new Error('WebP: 잘린 청크 머리');
    const fourcc = b.toString('latin1', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const data = at + 8;
    if (data + size > stop) throw new Error(`WebP: ${fourcc} 청크가 범위를 벗어났다`);
    out.push({ fourcc, data, size, payload: b.subarray(data, data + size) });
    at = data + size + (size & 1);
  }
  return out;
}

/** VP8L(무손실) 비트스트림 머리: 서명 0x2f · 14 bit 폭-1 · 14 bit 높이-1 · 알파 사용 1 bit. */
export function vp8lInfo(payload) {
  if (payload[0] !== 0x2f) throw new Error('WebP: VP8L 서명이 아니다');
  const bits = payload.readUInt32LE(1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: (bits >>> 28) & 1 };
}

/** VP8(손실) 키 프레임 머리: 3 B 태그 · 시작 코드 9d 01 2a · 14 bit 폭 · 14 bit 높이. */
export function vp8Info(payload) {
  if (payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) throw new Error('WebP: VP8 시작 코드가 아니다');
  return { width: payload.readUInt16LE(6) & 0x3fff, height: payload.readUInt16LE(8) & 0x3fff };
}

export function inspectWebp(bytes) {
  const b = Buffer.from(bytes);
  const chunks = riffChunks(b);
  const first = chunks[0];
  if (!first) throw new Error('WebP: 청크가 없다');
  if (first.fourcc === 'VP8 ') return { bytes: b.length, format: 'lossy', ...vp8Info(first.payload) };
  if (first.fourcc === 'VP8L') return { bytes: b.length, format: 'lossless', ...vp8lInfo(first.payload) };
  if (first.fourcc !== 'VP8X') throw new Error(`WebP: 첫 청크 ${first.fourcc}`);
  const flags = first.payload[0];
  const info = {
    bytes: b.length,
    format: 'extended',
    animation: Boolean(flags & 0x02),
    alpha: Boolean(flags & 0x10),
    width: first.payload.readUIntLE(4, 3) + 1,
    height: first.payload.readUIntLE(7, 3) + 1,
  };
  if (!info.animation) return info;
  const anim = chunks.find((c) => c.fourcc === 'ANIM');
  if (!anim) throw new Error('WebP: 애니메이션 플래그인데 ANIM 이 없다');
  info.loop = anim.payload.readUInt16LE(4);
  info.frames = chunks.filter((c) => c.fourcc === 'ANMF').map((c) => {
    const inner = riffChunks(b, c.data + 16, c.data + c.size);
    return {
      x: c.payload.readUIntLE(0, 3) * 2,
      y: c.payload.readUIntLE(3, 3) * 2,
      width: c.payload.readUIntLE(6, 3) + 1,
      height: c.payload.readUIntLE(9, 3) + 1,
      durationMs: c.payload.readUIntLE(12, 3),
      codec: inner.map((x) => x.fourcc).join('+'),
    };
  });
  info.durationMs = info.frames.reduce((sum, f) => sum + f.durationMs, 0);
  return info;
}

/** 정수 ms 프레임 길이 — 합이 정확히 round(n·1000/fps) 가 되게 누적 반올림한다. */
export function frameDurations(count, fps) {
  return Array.from({ length: count }, (_, i) => Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps));
}

function riffChunk(fourcc, payload) {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, payload, Buffer.alloc(payload.length & 1)]);
}
function u24(n) {
  const b = Buffer.alloc(3);
  b.writeUIntLE(n, 0, 3);
  return b;
}

/**
 * 프레임들을 확장 WebP 애니메이션(VP8X · ANIM · ANMF)으로 묶는다. 의존성 없음.
 * 프레임 하나 = { codec: 'VP8L'(무손실) | 'VP8 '(손실), bitstream, durationMs }. 손실 프레임은 알파(ALPH)
 * 없이만 받는다 — 불투명 캔버스에서 떴기 때문이다.
 * 프레임은 전부 캔버스 전체를 덮는 불투명 프레임이라 «섞지 않음 · 버리지 않음» 이다.
 */
export function muxAnimatedWebp({ width, height, frames, loop = 0, background = { r: 255, g: 255, b: 255, a: 255 } }) {
  if (!frames.length) throw new Error('WebP: 프레임이 없다');
  let alpha = false;
  const anmf = frames.map(({ codec, bitstream, durationMs }, i) => {
    if (codec !== 'VP8L' && codec !== 'VP8 ') throw new Error(`WebP: ${i} 번 프레임 코덱 ${JSON.stringify(codec)}`);
    const info = codec === 'VP8L' ? vp8lInfo(bitstream) : vp8Info(bitstream);
    if (info.width !== width || info.height !== height) throw new Error(`WebP: ${i} 번 프레임 ${info.width}×${info.height}`);
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 0xffffff) throw new Error(`WebP: ${i} 번 프레임 길이 ${durationMs}`);
    alpha ||= info.alpha === 1;
    return riffChunk('ANMF', Buffer.concat([
      u24(0), u24(0), u24(width - 1), u24(height - 1), u24(durationMs),
      Buffer.from([0b10]), // 섞지 않음(B=1) · 버리지 않음(D=0)
      riffChunk(codec, bitstream),
    ]));
  });
  const vp8x = Buffer.concat([Buffer.from([0x02 | (alpha ? 0x10 : 0)]), Buffer.alloc(3), u24(width - 1), u24(height - 1)]);
  const anim = Buffer.from([background.b, background.g, background.r, background.a, loop & 0xff, (loop >> 8) & 0xff]);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), riffChunk('VP8X', vp8x), riffChunk('ANIM', anim), ...anmf]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** 스핀 안 하나가 쓰는 원본 프레임 번호 — 간격이 이음매에서도 같도록 끝이 step 의 배수여야 한다. */
export function spinPlanIndices(plan, totalFrames) {
  const end = plan.span === 'loop' ? totalFrames : totalFrames / 2;
  if (!Number.isInteger(end) || end % plan.step !== 0) {
    throw new Error(`스핀 안 ${plan.step}/${plan.span}: ${totalFrames} 프레임에서 간격이 이음매에서 어긋난다`);
  }
  const out = [];
  for (let i = 0; i < end; i += plan.step) out.push(i);
  return out;
}

// ── 브라우저 · 서버 ─────────────────────────────────────────────────────

async function findBrowser() {
  const override = process.env.TLCUBE_BROWSER;
  if (override) {
    await fs.access(override);
    return override;
  }
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const local = process.env.LOCALAPPDATA;
  const candidates = [
    ...[pf, pf86, local].filter(Boolean).map((dir) => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ...[pf86, pf, local].filter(Boolean).map((dir) => path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/microsoft-edge',
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 다음 설치 위치를 본다.
    }
  }
  throw new Error('Chrome/Edge 를 찾지 못했다 — TLCUBE_BROWSER 로 실행 파일 경로를 지정해라');
}

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
});

/** 저장소 루트 정적 서버 + 페이지가 blob 을 넘기는 POST 싱크. 127.0.0.1 전용. */
async function startServer(root, sinkDir) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/__sink') {
        const name = url.searchParams.get('name') ?? '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) { res.writeHead(400).end(); return; }
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > 64 * MB) { res.writeHead(413).end(); return; }
          chunks.push(chunk);
        }
        await fs.writeFile(path.join(sinkDir, name), Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end(String(total));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(root, `.${rel}`);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const body = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      }).end(req.method === 'HEAD' ? undefined : body);
    } catch {
      if (!res.headersSent) res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

/** 임시 폴더 경계 안인지 확인한 뒤에만 지운다. */
function assertInsideTemp(dir, tmpRoot) {
  const resolved = path.resolve(dir);
  const rel = path.relative(tmpRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !rel.split(path.sep)[0].startsWith(PREFIX)) {
    throw new Error(`임시 폴더 경계 검증 실패: ${resolved}`);
  }
  return resolved;
}
async function removeTemp(dir, tmpRoot) {
  await fs.rm(assertInsideTemp(dir, tmpRoot), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function launchBrowser(executable, profileDir) {
  const args = [
    '--headless=new', `--user-data-dir=${profileDir}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-sync',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--mute-audio', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--window-size=1400,1000', '--lang=en-US',
    // 로컬 서버 밖으로는 이름을 못 푼다 — 스캐너의 링크 자동 열기·비콘이 밖으로 안 나간다.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    'about:blank',
  ];
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 200; i += 1) {
    try {
      const [port, wsPath] = (await fs.readFile(portFile, 'utf8')).split(/\r?\n/);
      if (port && wsPath) return { child, url: `ws://127.0.0.1:${port}${wsPath}` };
    } catch {
      // 아직 안 썼다.
    }
    if (child.exitCode !== null) throw new Error(`브라우저가 바로 끝났다 (exit ${child.exitCode})`);
    await sleep(100);
  }
  throw new Error('DevToolsActivePort 를 20 초 안에 못 읽었다');
}

/** 브라우저 한 개에 붙는 CDP 연결(flatten 세션). Node 24 내장 WebSocket 만 쓴다. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Set();
    this.exceptions = [];
    ws.onmessage = (event) => {
      const m = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown' && this.exceptions.length < 50) {
        const d = m.params.exceptionDetails;
        this.exceptions.push(oneLine(d.exception?.description ?? d.text).slice(0, 300));
      }
      for (const w of [...this.waiters]) {
        if (w.method === m.method && w.sessionId === m.sessionId) { this.waiters.delete(w); w.resolve(m.params); }
      }
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('CDP 연결이 닫혔다'));
      this.pending.clear();
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('CDP 연결 실패'));
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  waitFor(method, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve: (v) => { clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`${method} 대기 시간 초과`)); }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  close() {
    try { this.ws.close(); } catch { /* 이미 닫혔다 */ }
  }
}

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  static async open(cdp) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.bringToFront');
    return page;
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async goto(url, timeoutMs = 60_000) {
    const loaded = this.cdp.waitFor('Page.loadEventFired', this.sessionId, timeoutMs);
    const nav = await this.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`페이지를 못 열었다: ${nav.errorText}`);
    await loaded;
  }

  /**
   * 페이지 안에서 fn(arg, helpers) 를 돌린다 — fn 은 모듈 스코프를 쓰면 안 된다(문자열로 넘어간다).
   * helpers 는 pageHelpers() 의 반환값이다(같이 문자열로 넘긴다).
   */
  async evaluate(fn, arg = null, timeoutMs = 120_000) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(arg)}, (${pageHelpers.toString()})())`,
      awaitPromise: true, returnByValue: true, timeout: timeoutMs,
    });
    if (r.exceptionDetails) {
      throw new Error(oneLine(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

// ── 페이지 안에서 도는 함수들 (문자열로 넘어간다 — 바깥 식별자를 쓰지 마라) ─────

/** 공통: 보이는 쪽 요소를 고르고(일반/고급 두 벌), 렌더가 멎을 때까지 기다린다. */
function pageHelpers() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const need = (selector) => {
    const all = [...document.querySelectorAll(selector)];
    const el = all.find((e) => e.offsetParent !== null) ?? all[0];
    if (!el) throw new Error(`생성기에 ${selector} 가 없다 — 도구가 기대하는 UI 가 바뀌었다`);
    return el;
  };
  const text = (selector) => document.querySelector(selector)?.innerText ?? '';
  const settle = async () => {
    let last = null;
    let same = 0;
    for (let i = 0; i < 120; i += 1) {
      await sleep(150);
      const cur = `${text('#info')}|${text('#selfCheckRow')}`;
      if (cur === last && cur !== '|') {
        same += 1;
        if (same >= 3) return;
      } else same = 0;
      last = cur;
    }
    throw new Error('생성기 렌더가 18 초 안에 멎지 않았다');
  };
  const setPayload = (payload) => {
    if (!document.querySelector('#tabUrl')?.classList.contains('active')) throw new Error('URL 탭이 기본이 아니다');
    const input = need('#nUrlPayload');
    input.value = payload;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (input.value !== payload) throw new Error(`페이로드 입력이 ${input.value} 로 남았다`);
    return input.value;
  };
  return { sleep, need, text, settle, setPayload };
}

async function pageStill({ type, payload, size, finder, quietCells }, { sleep, need, text, settle, setPayload }) {
  const urlValue = setPayload(payload);
  await settle();
  const base = type === 'C' ? 'O' : type;
  need(`[data-type="${base}"]`).click();
  await settle();
  if (type === 'C') {
    need('[data-res="ultra"]').click();
    await settle();
  }
  const activeType = [...document.querySelectorAll('[data-type].active')].map((e) => e.dataset.type);
  if (!activeType.includes(base)) throw new Error(`타입 카드 ${base} 가 활성이 아니다: ${activeType.join(',')}`);

  // 파인더 — 'default' 는 손대지 않는다. 'centre-qr' 는 사용자가 누르는 자리(«TL스캐너 QR링크 포함» 의
  // «안쪽» 카드)를 누른다. 검출기 절의 «중앙 QR» 카드와 같은 상태다(안쪽 ⟺ 중앙 QR 불변식).
  const finderUi = () => ({
    finderId: document.querySelector('[data-finder-id].active')?.dataset.finderId ?? null,
    qrPosition: document.querySelector('#qrPositionCards [data-pos].active')?.dataset.pos ?? null,
  });
  if (finder === 'centre-qr') {
    const inner = need('#qrPositionCards [data-pos="inner"]');
    if (inner.classList.contains('disabled')) throw new Error('QR 위치 «안쪽» 카드가 잠겨 있다');
    inner.click();
    await settle();
    const now = finderUi();
    if (now.qrPosition !== 'inner' || now.finderId !== 'center-qr') {
      throw new Error(`중앙 QR 선택지가 안 먹었다: 파인더 ${now.finderId} · QR 위치 ${now.qrPosition}`);
    }
  } else if (finder !== 'default') throw new Error(`모르는 파인더 선택 ${finder}`);

  // 안전영역 여백 — 색 모드는 기본(자동) 그대로, 여백 줄의 «자동» 체크를 끄고 슬라이더를 맞춘다.
  const quietReadout = () => {
    const row = document.querySelector('#quietMarginRow');
    return {
      colourMode: document.querySelector('#quietModeCards [data-quiet].active')?.dataset.quiet ?? null,
      drawn: Boolean(row) && !row.classList.contains('off'),
      auto: need('#quietMarginAuto').checked,
      cells: Number(need('#quietMarginRange').value),
      hint: text('#quietModeHint'),
      coverage: text('#quietCoverageHint'),
    };
  };
  if (quietCells !== null) {
    const before = quietReadout();
    if (before.colourMode !== 'auto') throw new Error(`안전영역 색 모드가 기본(auto)이 아니다: ${before.colourMode}`);
    if (!before.drawn) throw new Error('안전영역을 그리지 않는 상태다 — 여백 두께가 아무 데도 안 쓰인다');
    const auto = need('#quietMarginAuto');
    if (auto.disabled) throw new Error('여백 «자동» 체크가 잠겨 있다');
    if (auto.checked) auto.click(); // 사용자 클릭 — checked 를 뒤집고 input·change 를 낸다
    await settle();
    const range = need('#quietMarginRange');
    if (range.disabled) throw new Error('«자동» 을 껐는데 여백 슬라이더가 잠겨 있다');
    range.value = String(quietCells);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  const quiet = quietReadout();
  if (quietCells !== null && (quiet.auto || quiet.cells !== quietCells || !quiet.drawn || quiet.colourMode !== 'auto')) {
    throw new Error(`안전영역 여백이 ${quietCells} 셀로 안 남았다: ${JSON.stringify({ ...quiet, hint: undefined, coverage: undefined })}`);
  }

  // 내보내기 크기 — 목록에 있는 크기(1024 등)는 그 항목을, 없는 크기는 «커스텀» 을 고르고 폭·높이를 친다.
  const select = need('#exportSize');
  const preset = [...select.options].some((o) => o.value === String(size));
  select.value = preset ? String(size) : 'custom';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  if (select.value !== (preset ? String(size) : 'custom')) throw new Error(`내보내기 크기가 ${select.value} 로 남았다`);
  if (!preset) {
    for (const id of ['#exportWidth', '#exportHeight']) {
      const input = need(id);
      input.value = String(size);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (input.value !== String(size)) throw new Error(`${id} 가 ${input.value} 로 남았다`);
    }
  }
  await settle();
  const original = HTMLAnchorElement.prototype.click;
  let captured = null;
  HTMLAnchorElement.prototype.click = function hubMediaCapture() {
    if (this.download && /\.png$/i.test(this.download)) {
      const name = this.download;
      captured = fetch(this.href).then((r) => r.blob()).then((blob) => ({ name, blob }));
      return undefined;
    }
    return original.call(this);
  };
  try {
    need('#exportPng').click();
    for (let i = 0; i < 200 && !captured; i += 1) await sleep(50);
  } finally {
    HTMLAnchorElement.prototype.click = original;
  }
  if (!captured) throw new Error(`PNG 내보내기가 다운로드를 안 냈다: ${text('#error')}`);
  const { name, blob } = await captured;
  const res = await fetch(`/__sink?name=${encodeURIComponent(`raw-${type}-${finder}.png`)}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`싱크 ${res.status}`);
  // 내보낸 뒤에 다시 읽는다 — 내보내기 직전 렌더가 설정을 되돌렸다면 여기서 드러난다.
  const quietAfter = quietReadout();
  if (quietCells !== null && (quietAfter.auto || quietAfter.cells !== quietCells)) {
    throw new Error(`내보낸 뒤 안전영역 여백이 ${quietAfter.cells} 셀(자동 ${quietAfter.auto})로 바뀌어 있다`);
  }
  return {
    exportName: name, bytes: blob.size, urlValue, exportSize: select.value === 'custom' ? size : Number(select.value),
    info: text('#info'), selfCheck: text('#selfCheckRow'), build: text('#buildTag'),
    finderUi: finderUi(), quiet: quietAfter,
  };
}

async function pageVideoSetup({ payload, faces, fps, background, size }, { need, text, settle, setPayload }) {
  const urlValue = setPayload(payload);
  await settle();
  const typeY = need('[data-type="Y"]');
  if (!typeY.classList.contains('active')) typeY.click();
  await settle();
  need('[data-h-representation="3d"]').click();
  await settle();
  need(`[data-h-faces="${faces}"]`).click();
  await settle();
  if (need('#cubeVideoSection').hidden) throw new Error('회전 영상 섹션이 안 보인다 — H 자동 회전이 꺼졌나');
  if (!document.querySelector('[data-bg="transparent"]')?.classList.contains('active')) throw new Error('배경 모드가 transparent(기본)가 아니다');
  if (need('#cubeVideoTransparency').hidden) throw new Error('투명 배경 영상 선택지가 숨어 있다 — bgMode 가 transparent 가 아니다');
  need(`[data-video-background="${background}"]`).click();
  need(`[data-video-fps="${fps}"]`).click();
  const active = (attr) => document.querySelector(`[${attr}].active`)?.getAttribute(attr);
  if (active('data-video-background') !== background) throw new Error(`영상 배경이 ${active('data-video-background')} 로 남았다`);
  if (active('data-video-fps') !== String(fps)) throw new Error(`영상 fps 가 ${active('data-video-fps')} 로 남았다`);
  if (active('data-h-faces') !== String(faces)) throw new Error(`H 면 수가 ${active('data-h-faces')} 로 남았다`);
  const button = need('#exportCubeVideo');
  if (button.dataset.videoSize !== String(size)) throw new Error(`#exportCubeVideo 크기가 ${button.dataset.videoSize} 다`);
  return {
    urlValue, info: text('#info'), selfCheck: text('#selfCheckRow'), build: text('#buildTag'),
    durationText: text('#cubeVideoDuration'),
  };
}

/** 인코더 설정·프레임 생성자·다운로드를 감싼다. 프레임·mux 는 생성기 코드가 그대로 만든다. */
function pageVideoInstall({ bitrate, posterQuality, spinSize, spinPlans, fps }) {
  const hm = { configure: [], timestamps: [], poster: null, spin: [], mp4: null, outstanding: 0, errors: [] };
  window.__hubMedia = hm;
  const post = (name, blob) => {
    if (!blob) { hm.errors.push(`toBlob 이 빈 값을 냈다: ${name}`); hm.outstanding -= 1; return; }
    fetch(`/__sink?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })
      .then((r) => { if (!r.ok) hm.errors.push(`싱크 ${r.status}: ${name}`); })
      .catch((e) => hm.errors.push(`싱크 실패 ${name}: ${e}`))
      .finally(() => { hm.outstanding -= 1; });
  };
  const configure = VideoEncoder.prototype.configure;
  VideoEncoder.prototype.configure = function hubMediaConfigure(config) {
    hm.configure.push({ codec: config.codec, width: config.width, height: config.height, framerate: config.framerate, generatorBitrate: config.bitrate });
    return configure.call(this, { ...config, bitrate });
  };
  const BaseFrame = globalThis.VideoFrame;
  class HubMediaFrame extends BaseFrame {
    constructor(source, init) {
      super(source, init);
      try {
        if (!(source instanceof HTMLCanvasElement) || typeof init?.timestamp !== 'number') return;
        const index = Math.round((init.timestamp * fps) / 1e6);
        hm.timestamps.push(init.timestamp);
        if (init.timestamp === 0) {
          hm.poster = { timestamp: 0, width: source.width, height: source.height };
          hm.outstanding += 1;
          source.toBlob((blob) => post('poster.webp', blob), 'image/webp', posterQuality);
        }
        // 이 프레임을 쓰는 안(plan)들의 품질마다 한 장씩 — 같은 360 px 캔버스에서 뜬다.
        const qualities = [...new Set(spinPlans.filter((plan) => index % plan.step === 0).map((plan) => plan.quality))];
        if (qualities.length) {
          const small = document.createElement('canvas');
          small.width = spinSize;
          small.height = spinSize;
          const ctx = small.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(source, 0, 0, spinSize, spinSize);
          hm.spin.push(index);
          for (const quality of qualities) {
            const name = `spin-q${Math.round(quality * 100)}-${String(index).padStart(4, '0')}.webp`;
            hm.outstanding += 1;
            small.toBlob((blob) => post(name, blob), 'image/webp', quality);
          }
        }
      } catch (e) {
        hm.errors.push(`프레임 가로채기 실패: ${e}`);
      }
    }
  }
  globalThis.VideoFrame = HubMediaFrame;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function hubMediaDownload() {
    if (this.download && /\.mp4$/i.test(this.download)) {
      const name = this.download;
      hm.outstanding += 1;
      fetch(this.href).then((r) => r.blob()).then((blob) => {
        hm.mp4 = { name, bytes: blob.size };
        hm.outstanding += 1;
        post('h.mp4', blob);
      }).catch((e) => hm.errors.push(`MP4 수집 실패: ${e}`)).finally(() => { hm.outstanding -= 1; });
      return undefined;
    }
    return click.call(this);
  };
  return true;
}

/** 같은 평가 안에서 자세를 0 으로 되돌리고 곧바로 내보낸다 — 미리보기 rAF 가 끼어들 틈이 없다. */
function pageVideoStart() {
  const activeFaces = [...document.querySelectorAll('[data-h-faces]')].find((b) => b.classList.contains('active'));
  if (!activeFaces) throw new Error('활성 H 면 카드가 없다');
  activeFaces.click(); // refreshHSelection → 회전 경과 0
  const button = document.querySelector('#exportCubeVideo');
  button.click();
  return { busy: button.disabled, status: document.querySelector('#cubeVideoStatus')?.textContent ?? '' };
}

function pageVideoPoll() {
  const hm = window.__hubMedia;
  return {
    busy: document.querySelector('#exportCubeVideo').disabled,
    status: document.querySelector('#cubeVideoStatus')?.textContent ?? '',
    frames: hm.timestamps.length, mp4: hm.mp4, outstanding: hm.outstanding, errors: hm.errors.length,
  };
}

async function pageVideoFinish() {
  const hm = window.__hubMedia;
  for (let i = 0; i < 1200 && hm.outstanding > 0; i += 1) await new Promise((r) => setTimeout(r, 50));
  return {
    configure: hm.configure, frames: hm.timestamps.length, firstTimestamp: hm.timestamps[0] ?? null,
    poster: hm.poster, spin: hm.spin, mp4: hm.mp4, outstanding: hm.outstanding, errors: hm.errors,
    status: document.querySelector('#cubeVideoStatus')?.textContent ?? '',
  };
}

function pageScanState() {
  const panel = document.getElementById('scan-result');
  const link = document.querySelector('#result-content .payload-url');
  return {
    ready: Boolean(document.getElementById('image-input')),
    shown: Boolean(panel) && !panel.hidden,
    url: link ? link.textContent : null,
    text: document.getElementById('result-content')?.innerText ?? '',
    title: document.getElementById('result-title')?.textContent ?? '',
    status: document.getElementById('scan-status')?.innerText ?? '',
  };
}

// ── 단계 ─────────────────────────────────────────────────────────────────

/** 실제 스캐너 페이지의 사진 업로드 경로(#image-input)로 읽힌 텍스트. */
async function scanWithScanner(page, origin, file) {
  await page.goto(`${origin}/sites/tlscan/index.html`);
  for (let i = 0; i < 100; i += 1) {
    if ((await page.evaluate(pageScanState)).ready) break;
    await sleep(50);
  }
  await sleep(500);
  const handle = await page.send('Runtime.evaluate', { expression: "document.getElementById('image-input')" });
  if (!handle.result?.objectId) throw new Error('스캐너에 #image-input 이 없다');
  await page.send('DOM.setFileInputFiles', { files: [file], objectId: handle.result.objectId });
  const started = Date.now();
  let lastStatus = null;
  let stableSince = started;
  for (;;) {
    const state = await page.evaluate(pageScanState);
    const now = Date.now();
    if (state.shown) return { text: (state.url ?? state.text).trim(), title: oneLine(state.title), ms: now - started };
    // 결과 시트 없이 상태 문구가 한동안 그대로면 스캐너가 «못 읽음» 으로 끝난 것이다.
    if (state.status !== lastStatus) { lastStatus = state.status; stableSince = now; }
    if (now - started > 5000 && now - stableSince > 8000) return { text: null, status: oneLine(state.status), ms: now - started };
    if (now - started > 60_000) return { text: null, status: oneLine(state.status), ms: now - started, timeout: true };
    await sleep(250);
  }
}

function advisoryDecode(raster) {
  try {
    const r = decodeFrontend(raster);
    return r?.ok ? { ok: true, text: r.text ?? null } : { ok: false, reason: oneLine(r?.reason ?? 'no result').slice(0, 120) };
  } catch (error) {
    return { ok: false, reason: oneLine(error?.message ?? error).slice(0, 120) };
  }
}

/** 시도 하나 — 생성기에서 내보내고, 평탄화·자르기, PNG 성질과 실제 스캐너 게이트를 잰다. */
async function runStillAttempt({ gen, scan, origin, sink, candidates, background, type, plan }) {
  const attempt = { finder: plan.finder, quietCells: plan.quietCells, failures: [] };
  const fail = (message) => attempt.failures.push(message);
  try {
    const exportOnce = async (size) => {
      await gen.send('Page.bringToFront');
      await gen.goto(`${origin}/index.html`);
      const generator = await gen.evaluate(pageStill, {
        type, payload: PAYLOAD, size, finder: plan.finder, quietCells: plan.quietCells,
      });
      const source = pngToRaster(await fs.readFile(path.join(sink, `raw-${type}-${plan.finder}.png`)));
      const { raster, bounds } = flattenAndCrop(source, background, STILL.cropPad);
      return { generator, source, raster, bounds, png: Buffer.from(rasterToPng(raster)) };
    };
    let shot = await exportOnce(STILL.exportSize);
    const resize = stillResizeFor(Math.min(shot.raster.width, shot.raster.height));
    if (resize !== null) {
      // 하한 아래 — 같은 설정을 더 큰 «커스텀» 크기로 다시 낸다. 게이트는 다시 낸 쪽에 건다.
      attempt.resizedFrom = {
        exportSize: STILL.exportSize, width: shot.raster.width, height: shot.raster.height, sha256: sha256(shot.png),
      };
      shot = await exportOnce(resize);
    }
    const { source, raster, bounds, png } = shot;
    attempt.generator = shot.generator;
    if (!attempt.generator.selfCheck.includes('✓')) fail(`생성기 자체 검사에 ✓ 가 없다: ${oneLine(attempt.generator.selfCheck)}`);
    // 후보는 시도마다 따로 둔다 — 드라이런에서 떨어진 쪽도 열어 볼 수 있게.
    attempt.candidate = path.join(candidates, `type-${type}-${plan.finder}.png`);
    await fs.writeFile(attempt.candidate, png);
    const head = pngHeader(png);
    attempt.output = {
      sha256: sha256(png), bytes: png.length, width: head.width, height: head.height, colorType: head.colorType,
      exported: { width: source.width, height: source.height, bounds },
    };
    if (head.colorType !== 2) fail(`PNG 색 타입 ${head.colorType} — 불투명 RGB(2)여야 한다`);
    const short = Math.min(head.width, head.height);
    if (short < STILL.shortSide[0] || short > STILL.shortSide[1]) fail(`짧은 변 ${short} px 가 ${STILL.shortSide.join('‥')} 밖이다`);
    if (png.length > STILL.maxBytes) fail(`${png.length} B > ${STILL.maxBytes} B`);
    await scan.send('Page.bringToFront');
    attempt.scanner = await scanWithScanner(scan, origin, attempt.candidate);
    if (attempt.scanner.text === null) {
      fail(`스캐너 사진 경로가 못 읽었다${attempt.scanner.timeout ? ' (60 초 초과)' : ''}: ${attempt.scanner.status}`);
    } else if (attempt.scanner.text !== PAYLOAD) {
      fail(`스캐너 사진 경로가 ${JSON.stringify(attempt.scanner.text)} 로 읽었다 — ${PAYLOAD} 여야 한다`);
    }
    attempt.decodeFrontend = advisoryDecode(raster);
  } catch (error) {
    fail(oneLine(error?.message ?? error));
  }
  attempt.ok = attempt.failures.length === 0;
  return attempt;
}

async function runStills({ cdp, origin, sink, out }) {
  const gen = await Page.open(cdp);
  const scan = await Page.open(cdp);
  await scan.send('DOM.enable');
  await scan.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.open = () => null;' });
  const background = getPreset(DEFAULT_PRESET).background;
  const candidates = path.join(out, 'candidates');
  await fs.mkdir(candidates, { recursive: true });
  const rows = [];
  for (const type of STILL_TYPES) {
    const row = { type, file: `type-${type}.png`, attempts: [], failures: [] };
    for (const plan of stillAttempts(type)) {
      const attempt = await runStillAttempt({ gen, scan, origin, sink, candidates, background, type, plan });
      row.attempts.push(attempt);
      if (attempt.ok) break;
    }
    const chosen = row.attempts.find((a) => a.ok) ?? null;
    row.ok = chosen !== null;
    if (chosen) {
      Object.assign(row, {
        finder: chosen.finder, quietCells: chosen.quietCells, generator: chosen.generator,
        output: chosen.output, scanner: chosen.scanner, decodeFrontend: chosen.decodeFrontend,
        resizedFrom: chosen.resizedFrom ?? null,
      });
      await fs.copyFile(chosen.candidate, path.join(out, row.file));
    } else {
      row.failures = row.attempts.flatMap((a) => a.failures.map((f) => `[${a.finder}] ${f}`));
    }
    if (!row.ok) {
      // 실패하면 커밋된 파일을 둔다 — 그 파일도 같은 스캐너 게이트로 재서 «검증된 대체» 인지 기록한다.
      const committed = path.join(ASSETS, row.file);
      try {
        await fs.access(committed);
        await scan.send('Page.bringToFront');
        row.previousScanner = await scanWithScanner(scan, origin, committed);
      } catch (error) {
        row.previousScanner = { text: null, error: oneLine(error?.message ?? error) };
      }
    }
    rows.push(row);
  }
  return rows;
}

async function runVideo({ cdp, origin, sink, out }) {
  const expectedMs = expectedVideoDurationMs();
  const expectedFrames = Math.ceil((expectedMs * VIDEO.fps) / 1000);
  const result = { failures: [], expected: { durationMs: expectedMs, frames: expectedFrames } };
  const fail = (message) => result.failures.push(message);
  try {
    const gen = await Page.open(cdp);
    await gen.goto(`${origin}/index.html`);
    result.setup = await gen.evaluate(pageVideoSetup, {
      payload: PAYLOAD, faces: VIDEO.faces, fps: VIDEO.fps, background: VIDEO.background, size: VIDEO.size,
    });
    const spinPlans = SPIN.plans.map(({ step, quality }) => ({ step, quality }));
    await gen.evaluate(pageVideoInstall, {
      bitrate: VIDEO.bitrate, posterQuality: POSTER.quality, spinSize: SPIN.size, spinPlans, fps: VIDEO.fps,
    });
    const started = Date.now();
    const start = await gen.evaluate(pageVideoStart);
    if (!start.busy) throw new Error(`내보내기가 시작되지 않았다 — 생성기 처리기가 조건 미달로 돌아갔다 (${oneLine(start.status)})`);
    let poll;
    for (;;) {
      await sleep(500);
      poll = await gen.evaluate(pageVideoPoll);
      if (!poll.busy) break;
      if (Date.now() - started > 300_000) throw new Error(`영상 내보내기가 5 분 안에 안 끝났다 (${oneLine(poll.status)})`);
    }
    const done = await gen.evaluate(pageVideoFinish, null, 90_000);
    result.exportMs = Date.now() - started;
    result.page = { status: oneLine(done.status), configure: done.configure, frames: done.frames, spinCaptured: done.spin.length };
    if (done.errors.length) fail(`페이지 오류: ${done.errors.slice(0, 3).join(' / ')}`);
    if (done.outstanding !== 0) fail(`페이지 전송 ${done.outstanding} 건이 끝나지 않았다`);
    if (done.configure.length !== 1) fail(`VideoEncoder.configure 가 ${done.configure.length} 번 불렸다 — 정확히 한 번이어야 한다`);
    if (!done.mp4) throw new Error(`MP4 다운로드를 못 잡았다 (${oneLine(done.status)})`);
    if (done.frames !== expectedFrames) fail(`생성기가 ${done.frames} 프레임을 만들었다 — ${expectedFrames} 여야 한다`);
    if (done.firstTimestamp !== 0 || !done.poster || done.poster.timestamp !== 0) fail('0 번 프레임이 타임스탬프 0 이 아니다 — 포스터를 못 잡았다');

    // MP4 — 생성기 바이트를 그대로 받아 moov 만 앞으로.
    const raw = await fs.readFile(path.join(sink, 'h.mp4'));
    const rawInfo = inspectMp4(raw);
    if (rawInfo.layout !== 'ftyp,mdat,moov') fail(`생성기 MP4 배치가 ${rawInfo.layout} 다`);
    const mp4 = faststart(raw);
    const info = inspectMp4(mp4);
    await fs.writeFile(path.join(out, VIDEO.file), mp4);
    if (info.layout !== 'ftyp,moov,mdat') fail(`MP4 배치 ${info.layout}`);
    if (info.profile !== 0x42) fail(`AVC 프로필 ${info.codec} — Baseline(42) 이어야 한다`);
    if (info.width !== VIDEO.size || info.height !== VIDEO.size || info.trackWidth !== VIDEO.size || info.trackHeight !== VIDEO.size) {
      fail(`MP4 크기 ${info.width}×${info.height} (트랙 ${info.trackWidth}×${info.trackHeight})`);
    }
    if (info.frames !== expectedFrames) fail(`MP4 표본 ${info.frames} — ${expectedFrames} 여야 한다`);
    if (info.durationMs !== expectedMs || info.movieDurationMs !== expectedMs) fail(`MP4 길이 ${info.durationMs} ms — ${expectedMs} ms 여야 한다`);
    if (mp4.length > VIDEO.maxBytes) fail(`MP4 ${mp4.length} B > ${VIDEO.maxBytes} B`);
    result.mp4 = {
      sha256: sha256(mp4), bytes: mp4.length, width: info.width, height: info.height, codec: info.codec,
      frames: info.frames, keyframes: info.keyframes, durationMs: info.durationMs, fps: VIDEO.fps, layout: info.layout,
      generatorLayout: rawInfo.layout, generatorBytes: raw.length,
    };

    // 포스터 — 무손실 0 번 프레임을 페이지 캔버스에서 WebP 로.
    const poster = await fs.readFile(path.join(sink, 'poster.webp'));
    const posterInfo = inspectWebp(poster);
    await fs.writeFile(path.join(out, POSTER.file), poster);
    if (posterInfo.width !== info.width || posterInfo.height !== info.height) fail(`포스터 ${posterInfo.width}×${posterInfo.height} ≠ 영상 ${info.width}×${info.height}`);
    if (poster.length > POSTER.maxBytes) fail(`포스터 ${poster.length} B > ${POSTER.maxBytes} B`);
    result.poster = { sha256: sha256(poster), bytes: poster.length, width: posterInfo.width, height: posterInfo.height, format: posterInfo.format };

    // 스핀 — 캡처한 360 px 프레임을 묶는다. 안마다 품질(손실/무손실)이 정해져 있고, 캡처한 프레임의
    // 비트스트림이 그 안의 코덱과 다르면(예: 무손실을 바랐는데 손실) 조용히 섞지 않고 멈춘다.
    const frameCache = new Map();
    const frameOf = async (index, quality) => {
      const tag = spinQualityTag(quality);
      const key = `${tag}-${index}`;
      if (frameCache.has(key)) return frameCache.get(key);
      const codec = spinFrameCodec(quality);
      const bytes = await fs.readFile(path.join(sink, `spin-${tag}-${String(index).padStart(4, '0')}.webp`));
      const chunks = riffChunks(bytes);
      const streams = chunks.filter((c) => c.fourcc === 'VP8L' || c.fourcc === 'VP8 ');
      if (streams.length !== 1 || streams[0].fourcc !== codec || chunks.some((c) => c.fourcc === 'ALPH')) {
        throw new Error(`스핀 ${index} 번 프레임(${tag})이 ${JSON.stringify(codec)} 단일 비트스트림이 아니다: ${chunks.map((c) => c.fourcc).join('+')}`);
      }
      const bitstream = Buffer.from(streams[0].payload);
      const dims = codec === 'VP8L' ? vp8lInfo(bitstream) : vp8Info(bitstream);
      if (dims.width !== SPIN.size || dims.height !== SPIN.size) throw new Error(`스핀 ${index} 번 프레임 ${dims.width}×${dims.height}`);
      const frame = { codec, bitstream };
      frameCache.set(key, frame);
      return frame;
    };
    result.spinTried = [];
    for (const plan of SPIN.plans) {
      const indices = spinPlanIndices(plan, info.frames);
      const fps = VIDEO.fps / plan.step;
      const durations = frameDurations(indices.length, fps);
      const frames = [];
      for (const [i, index] of indices.entries()) frames.push({ ...(await frameOf(index, plan.quality)), durationMs: durations[i] });
      const webp = muxAnimatedWebp({ width: SPIN.size, height: SPIN.size, frames, loop: 0 });
      const frameCodec = spinFrameCodec(plan.quality);
      result.spinTried.push({ fps, span: plan.span, quality: plan.quality, frameCodec, frames: frames.length, bytes: webp.length });
      if (webp.length > SPIN.maxBytes) continue;
      const spinInfo = inspectWebp(webp);
      await fs.writeFile(path.join(out, SPIN.file), webp);
      result.spin = {
        sha256: sha256(webp), bytes: webp.length, width: spinInfo.width, height: spinInfo.height,
        frames: spinInfo.frames.length, fps, durationMs: spinInfo.durationMs, span: plan.span,
        sourceStep: plan.step, loop: spinInfo.loop, frameCodec, quality: plan.quality,
      };
      break;
    }
    if (!result.spin) fail(`스핀 WebP 가 어느 안으로도 ${SPIN.maxBytes} B 안에 안 든다`);
  } catch (error) {
    fail(oneLine(error?.message ?? error));
  }
  result.ok = result.failures.length === 0;
  return result;
}

// ── 매니페스트 · 쓰기 ───────────────────────────────────────────────────

function gitSource() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return {
      head: git('rev-parse', 'HEAD'),
      // 프레임을 정하는 입력(생성기·src·스캐너)만 본다. 산출물·이 도구 자신은 toolSha256 이 따로 적는다.
      dirty: git('status', '--porcelain', '--', 'index.html', 'src', 'sites/tlscan').length > 0,
    };
  } catch {
    return { head: null, dirty: null };
  }
}

async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 공개 저장소에 커밋되는 매니페스트에 로컬 경로(임시 폴더·홈·저장소 위치)가 새지 않게 지운다.
 * 실패 사유는 fs 오류 문구를 그대로 담을 수 있어서 이 한 곳을 거친다.
 */
function scrubPaths(text, roots) {
  let out = String(text);
  for (const [dir, label] of roots) {
    if (!dir) continue;
    for (const form of [dir, dir.split(path.sep).join('/'), dir.split('/').join('\\')]) out = out.split(form).join(label);
  }
  return out;
}

async function describeExisting(name, reason) {
  try {
    const bytes = await fs.readFile(path.join(ASSETS, name));
    const entry = { sha256: sha256(bytes), bytes: bytes.length, keptPrevious: reason };
    if (name.endsWith('.png')) Object.assign(entry, (({ width, height, colorType }) => ({ width, height, colorType }))(pngHeader(bytes)));
    return entry;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const opts = { write: false, keepFailed: false, only: null, help: false };
  for (const arg of argv) {
    if (arg === '--write') opts.write = true;
    else if (arg === '--keep-failed') opts.keepFailed = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--only=')) {
      opts.only = arg.slice('--only='.length);
      if (!['stills', 'video'].includes(opts.only)) throw new Error(`--only 는 stills|video 다: ${opts.only}`);
    } else throw new Error(`모르는 인자: ${arg} (--write · --only=stills|video · --keep-failed · --help)`);
  }
  return opts;
}

const HELP = `node tools/hub-media.mjs [--write] [--only=stills|video] [--keep-failed]
  기본은 드라이런(임시 폴더에만 쓴다). --write 는 게이트를 다 통과하면 sites/tl/assets/ 와
  tools/hub-media.manifest.json 을 바꾼다. TLCUBE_BROWSER 로 Chrome/Edge 실행 파일을 지정할 수 있다.`;

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const tmpRoot = path.resolve(os.tmpdir());
  const work = await fs.mkdtemp(path.join(tmpRoot, PREFIX));
  const sink = path.join(work, 'sink');
  const out = path.join(work, 'out');
  const profile = path.join(work, 'profile');
  await Promise.all([sink, out, profile].map((dir) => fs.mkdir(dir, { recursive: true })));

  let child = null;
  let cdp = null;
  let server = null;
  const watchdog = setTimeout(() => {
    console.error(`hub-media: ${WATCHDOG_MS / 60_000} 분 감시 시간을 넘겼다 — 브라우저를 끄고 멈춘다`);
    try { child?.kill(); } catch { /* 이미 끝났다 */ }
    try { rmSync(assertInsideTemp(work, tmpRoot), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 경계 밖이면 안 지운다 */ }
    process.exit(3);
  }, WATCHDOG_MS);

  const report = { mode: opts.write ? 'write' : 'dry-run', only: opts.only, payload: PAYLOAD };
  let exitCode = 0;
  let keepWork = !opts.write;
  try {
    const executable = await findBrowser();
    server = await startServer(ROOT, sink);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const launched = await launchBrowser(executable, profile);
    child = launched.child;
    cdp = await Cdp.connect(launched.url);
    const version = await cdp.send('Browser.getVersion');
    const generatedFrom = {
      ...gitSource(),
      browser: version.product,
      toolSha256: sha256(await fs.readFile(SELF)),
    };
    const started = Date.now();
    const stills = opts.only === 'video' ? null : await runStills({ cdp, origin, sink, out });
    const video = opts.only === 'stills' ? null : await runVideo({ cdp, origin, sink, out });
    report.ms = Date.now() - started;
    report.stills = stills;
    report.video = video;
    if (cdp.exceptions.length) report.pageExceptions = cdp.exceptions.slice(0, 10);

    const build = (stills ?? []).flatMap((r) => r.attempts).find((a) => a.generator?.build)?.generator.build
      ?? video?.setup?.build ?? null;
    Object.assign(generatedFrom, { generatorBuild: build });
    const failed = [
      ...(stills ?? []).filter((r) => !r.ok).map((r) => ({ file: r.file, failures: r.failures })),
      ...(video && !video.ok ? [{ file: `${VIDEO.file} + ${POSTER.file} + ${SPIN.file}`, failures: video.failures }] : []),
    ];
    report.failed = failed;

    // 매니페스트 — 이번에 안 돈 쪽은 기존 기록을 그대로 둔다.
    const scrubRoots = [[work, '<tmp>'], [ROOT, '<repo>'], [tmpRoot, '<tmp>'], [os.homedir(), '<home>']];
    const reasonOf = (failures) => scrubPaths(failures.join(' / '), scrubRoots);
    const previous = (await readManifest()) ?? {};
    const manifest = {
      $comment: 'tools/hub-media.mjs 가 쓴다 — 손으로 고치지 마라. 성질은 test/hub-media.test.js 가 잰다.',
      payload: PAYLOAD,
      stills: previous.stills ?? null,
      video: previous.video ?? null,
    };
    const toWrite = [];
    if (stills) {
      const files = {};
      // 게이트에서 떨어진 시도 — 후속 조사(디코더/인코더)의 출발점이다.
      const rejectedOf = (a) => ({
        finder: a.finder,
        quietCells: a.quietCells,
        reason: reasonOf(a.failures),
        sha256: a.output?.sha256 ?? null,
        exportSize: a.generator?.exportSize ?? null,
        ...(a.resizedFrom ? { resizedFrom: a.resizedFrom } : {}),
        generatorInfo: a.generator ? oneLine(a.generator.info) : null,
        selfCheck: a.generator ? oneLine(a.generator.selfCheck) : null,
        finderUi: a.generator?.finderUi ?? null,
        decodeFrontendAdvisory: a.decodeFrontend ?? null,
      });
      for (const row of stills) {
        if (row.ok) {
          const fellBack = row.attempts.filter((a) => !a.ok);
          files[row.file] = {
            ...row.output,
            // 'default' = 생성기 기본 파인더 그대로 · 'centre-qr' = QR 위치 «안쪽»(중앙 QR 파인더 선택지)
            finder: row.finder,
            ...(fellBack.length ? { finderFallback: fellBack.map(rejectedOf) } : {}),
            // 안전영역 여백 셀 수 — O·C·A·K 는 «자동» 을 끄고 맞춘 값, Y 는 null(생성기 기본 그대로).
            quietCells: row.quietCells,
            quiet: {
              colourMode: row.generator.quiet.colourMode,
              auto: row.generator.quiet.auto,
              cells: row.generator.quiet.cells,
              drawn: row.generator.quiet.drawn,
            },
            finderUi: row.generator.finderUi,
            // 생성기 내보내기 크기 — 기본은 config.exportSize, 하한 아래였으면 다시 낸 «커스텀» 크기.
            exportSize: row.generator.exportSize,
            ...(row.resizedFrom ? { resizedFrom: row.resizedFrom } : {}),
            generatorInfo: oneLine(row.generator.info),
            selfCheck: oneLine(row.generator.selfCheck),
            scanner: row.scanner.text,
            decodeFrontendAdvisory: row.decodeFrontend,
          };
          toWrite.push(row.file);
        } else {
          const kept = await describeExisting(row.file, reasonOf(row.failures));
          if (kept) {
            files[row.file] = {
              ...kept,
              scanner: row.previousScanner?.text ?? null,
              rejected: row.attempts.map(rejectedOf),
            };
          }
        }
      }
      manifest.stills = {
        generatedFrom,
        config: {
          type: 'generator default state per type (C = O + ultra), quiet margin set per STILL_QUIET; O and A fall back to the centre-QR finder option when the default finder fails the scanner gate',
          exportButton: '#exportPng',
          exportSize: STILL.exportSize,
          flattenPreset: DEFAULT_PRESET,
          background: getPreset(DEFAULT_PRESET).background,
          cropPad: STILL.cropPad,
          resize: {
            when: `cropped short side below ${STILL.shortSide[0]} px at exportSize`,
            to: `smallest multiple of ${STILL.resizeStep} px (generator «custom» size) whose predicted cropped short side clears the floor by ${STILL.resizeMargin} px; the gates run on the re-export`,
          },
          quiet: {
            cells: STILL_QUIET.cells,
            types: [...STILL_QUIET.types],
            controls: '#quietMarginAuto unchecked, then #quietMarginRange set (input event); colour mode left at its default (auto)',
            otherTypes: 'generator default (Y draws no automatic quiet zone)',
          },
          finderFallback: {
            types: [...STILL_CENTRE_QR_FALLBACK],
            control: '#qrPositionCards [data-pos="inner"] (same state as the centre-QR finder card)',
            when: 'the default finder fails a gate',
          },
          gates: ['generator self-check ✓', 'scanner photo-upload path decodes the payload'],
        },
        files,
      };
    }
    if (video) {
      const files = {};
      if (video.ok) {
        files[VIDEO.file] = video.mp4;
        files[POSTER.file] = { ...video.poster, source: 'export frame at timestamp 0', quality: POSTER.quality };
        files[SPIN.file] = video.spin;
        toWrite.push(VIDEO.file, POSTER.file, SPIN.file);
      } else {
        for (const name of [VIDEO.file, POSTER.file, SPIN.file]) {
          const kept = await describeExisting(name, reasonOf(video.failures));
          if (kept) files[name] = kept;
        }
      }
      const state = createGeneratorState();
      manifest.video = {
        generatedFrom,
        config: {
          type: 'H', faces: VIDEO.faces, hVersion: VIDEO.hVersion, exportButton: '#exportCubeVideo',
          background: VIDEO.background, size: VIDEO.size, fps: VIDEO.fps,
          rotation: {
            axis: state.hRotationMode,
            speedDegPerSec: hRotationSpeedDefault(VIDEO.hVersion, state.hRotationMode),
            tiltMode: state.hRotationTiltMode,
          },
          bitrate: VIDEO.bitrate,
          generatorBitrate: video.page?.configure?.[0]?.generatorBitrate ?? null,
          deviation: 'bitrate override (VideoEncoder.configure in the page) + faststart box reorder (moov before mdat, stco rewritten; mdat bytes unchanged) + start pose reset to rotation 0 (a user download starts at the preview\'s current rotation); frames and avcC are the generator\'s own',
          faststart: true,
          generatorInfo: oneLine(video.setup?.info),
          durationText: oneLine(video.setup?.durationText),
        },
        files,
      };
    }
    report.manifest = manifest;
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

    if (failed.length && !opts.keepFailed) {
      exitCode = 2;
      report.written = [];
      report.note = '게이트 실패 — 아무 파일도 바꾸지 않았다 (--keep-failed 로 통과한 쪽만 쓸 수 있다)';
    } else if (opts.write) {
      for (const name of toWrite) await fs.copyFile(path.join(out, name), path.join(ASSETS, name));
      await fs.writeFile(MANIFEST_FILE, manifestText);
      report.written = [...toWrite.map((name) => `sites/tl/assets/${name}`), 'tools/hub-media.manifest.json'];
      if (failed.length) report.note = '--keep-failed: 실패한 쪽은 기존 파일을 두었다';
    } else {
      await fs.writeFile(path.join(out, 'hub-media.manifest.json'), manifestText);
      report.written = [];
      report.outputDir = out;
    }
    // 둔 파일마저 스캐너가 못 읽으면 허브 캡션(«모든 코드가 이 URL») 이 거짓이 된다 — 쓰기와 별개로 알린다.
    const keptUnverified = (stills ?? []).filter((r) => !r.ok && r.previousScanner?.text !== PAYLOAD).map((r) => r.file);
    if (keptUnverified.length) {
      report.keptUnverified = keptUnverified;
      exitCode = 2;
    }
    if (exitCode !== 0) keepWork = true;
  } catch (error) {
    exitCode = 1;
    keepWork = true;
    report.error = error?.stack ?? String(error);
    if (cdp?.exceptions?.length) report.pageExceptions = cdp.exceptions.slice(0, 10);
  } finally {
    clearTimeout(watchdog);
    try { await cdp?.send('Browser.close'); } catch { /* 이미 닫혔다 */ }
    cdp?.close();
    if (child && child.exitCode === null) {
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)]);
      if (child.exitCode === null) child.kill();
    }
    server?.close();
    try {
      await removeTemp(profile, tmpRoot);
      if (!keepWork) await removeTemp(work, tmpRoot);
      else report.workDir = work;
    } catch (error) {
      report.cleanupError = String(error?.message ?? error);
    }
  }
  console.log(JSON.stringify(report, null, 2));
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
