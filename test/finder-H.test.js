/**
 * finder-H.test.js — H 파인더 (타입 G 기본 파인더, 2026-08-21 운영자 결정) 회귀.
 *
 * §6 새 회귀 조건 (레인 브리프) 준수:
 *   · 값이 아니라 규칙으로 — 12셀 자리는 전부 `markerCells(k)` 에서 **유도**해 단언한다.
 *     이 파일에 마커 좌표 리터럴은 없다 (좌표 손 나열은 이 저장소 최다 결함).
 *   · 팔레트 잠금 — 렌더된 H 셀 색이 `palette.bullseyeLight`(순백) 가 **아님**을 단언.
 *   · 레거시 무변경 — digit-only 프레임 래스터 sha256 이 HEAD 실측과 바이트 동일.
 *
 * 고정하는 것:
 *   ① 정본 전사 — repo 사본 `test/output/lanes/finder-H.json` (편집기 v2 export,
 *      바이트 동일 사본) → 중간톤 규약(없는 면 = 1) 전개 → H_LOCAL_TONES_O 전수 대조.
 *   ② k=8/10 유도 규칙 — 같은 (코너, 라벨) 튜플을 markerCells(k) 자리에 복사.
 *   ③ 팔레트 잠금 — H 셀 면 색 = palette.levels[tone] (파인더 축 아님).
 *   ④ 12셀이 실제로 그려진다 — verifyRaster 0 mismatch + digit 프레임과 픽셀이 다르다.
 *   ⑤ 레거시 무변경 — H 를 안 쓴 O/A 프레임 sha256 = HEAD 실측 (claude-h-head-hashes).
 *   ⑥ H 톤 프레임은 코너 마커 절대 톤 경로로 읽힌다 (F-85). digit-only O-CM 은
 *      종전대로 앵커 경로. encode 의 markerTones 기본값은 아직 false — 기본값
 *      전환은 실기기 라운드 뒤 운영자 판단이다.
 *   ⑦ 옵션 가드 — markerTones 는 boolean 이고 cornerMarker(자리) 없이 못 켠다.
 *
 * 변이 검증: encode.js 의 markerTones 적재 분기를 끄면 ③④ 가 빨개진다 (lane-out/verify.txt).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { H_NAME, H_LOCAL_TONES_O, hTonesByKeyO } from '../src/finder-H.js';
import { markerCells, MARKER_LABELS, VERSIONS_OCM } from '../src/markerO.js';
import { markerGSpec } from '../src/markerG.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { verifyRaster } from '../src/verify.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { findOCornerMarkerHypotheses } from '../src/decoder/corner-marker-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { FACES, facePolygon } from '../src/hexgrid.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const KS = VERSIONS_OCM.map((spec) => spec.k); // [6, 8, 10] — 표에서 유도
const key = (c) => `${c.q},${c.r}`;
const sha256 = (raster) => createHash('sha256').update(raster.pixels).digest('hex');

function renderPinned(encoded, margin) {
  const scene = buildScene(encoded, { palette: PALETTE, cellSize: 8, margin });
  return rasterize(scene, { pixelsPerUnit: 1, supersample: 2 });
}

test('① 정본 전사 — repo 사본 JSON 전개가 H_LOCAL_TONES_O 와 전수 일치한다', () => {
  const json = JSON.parse(readFileSync(
    new URL('./output/lanes/finder-H.json', import.meta.url), 'utf8',
  ));
  assert.equal(json.k, 6, '정본은 k=6 export 다');
  assert.equal(json.finderStarter, 'bullseye', '중앙 기준선은 불스아이다 — 대체 금지');

  // 편집기 v2 규약: override 가 닿는 셀만, export 에 없는 면은 중간톤 1.
  const fromJson = new Map();
  for (const o of json.toneOverrides) {
    const kk = o.q + ',' + o.r;
    if (!fromJson.has(kk)) fromJson.set(kk, { T: 1, L: 1, R: 1 });
    fromJson.get(kk)[o.face] = o.tone;
  }

  // 발자국 = markerCells(6) 위치 (유도) — 정본에만/마커에만 있는 셀 0.
  const cells = markerCells(json.k);
  assert.equal(fromJson.size, cells.length, '정본 톤 셀 수 ≠ 마커 셀 수');
  for (const cell of cells) {
    const got = fromJson.get(key(cell));
    assert.ok(got, '정본에 마커 자리 ' + key(cell) + ' 의 톤이 없다');
    assert.deepEqual(
      got,
      { ...H_LOCAL_TONES_O[cell.corner][cell.label] },
      '코너 ' + cell.corner + ' 라벨 ' + cell.label + ' (' + key(cell) + ') 전사 불일치',
    );
  }
});

test('② k=8/10 유도 규칙 — (코너,라벨) 튜플 복사가 전 k 에서 선다 + 심볼 성질', () => {
  const base = hTonesByKeyO(6);
  for (const k of KS) {
    const cells = markerCells(k, hTonesByKeyO(k));
    assert.equal(cells.length, 12, 'k=' + k + ' 마커 셀 수');
    for (const cell of cells) {
      assert.ok(cell.tones, 'k=' + k + ' ' + key(cell) + ' 톤 누락');
      // 규칙 그 자체: k 무관하게 같은 (코너, 라벨) → 같은 튜플.
      assert.deepEqual(cell.tones, H_LOCAL_TONES_O[cell.corner][cell.label],
        'k=' + k + ' ' + key(cell) + ' 이 로컬 라벨 복사 규칙과 다르다');
    }
    // 위치 집합 = markerCells(k) 유도 집합 (hTonesByKeyO 키가 곧 그 집합이다).
    const derived = new Set(markerCells(k).map(key));
    const toneKeys = new Set(hTonesByKeyO(k).keys());
    assert.deepEqual(toneKeys, derived, 'k=' + k + ' 톤 표 좌표가 markerCells 유도와 다르다');
  }
  void base;
  // 심볼 성질 (값으로): 비-순열 6셀 — 데이터 셀(순열 digit)이 못 만드는 무늬가 실재한다.
  let nonPermutation = 0;
  const cornerTuples = [];
  for (const [corner, labels] of Object.entries(H_LOCAL_TONES_O)) {
    const parts = [];
    for (const label of MARKER_LABELS) {
      const t = labels[label];
      if (new Set([t.T, t.L, t.R]).size < 3) nonPermutation += 1;
      parts.push(t.T + '' + t.L + t.R);
    }
    cornerTuples.push(corner + ':' + parts.join('|'));
  }
  assert.equal(nonPermutation, 6, '비-순열 셀 수가 정본과 다르다');
  assert.equal(new Set(cornerTuples).size, 3, '세 코너 튜플이 서로 달라야 한다 (코너 구별)');
  // 라인업 배선 — 타입 G(hex) 전 버전의 기본 파인더가 H 로 적혀 있다 (markerG 표).
  for (const spec of VERSIONS_OCM) {
    assert.equal(markerGSpec('hex', spec.version).defaultFinder, H_NAME,
      'V' + spec.version + 'CM 의 기본 파인더가 H 가 아니다');
  }
});

test('③ 팔레트 잠금 — 렌더된 H 셀 면 색 = palette.levels[tone], 파인더 축 아님', () => {
  const encoded = encode('TLcube-H', {
    version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true,
  });
  const expectedTones = hTonesByKeyO(encoded.k);
  const scene = buildScene(encoded, { palette: PALETTE, cellSize: 8 });

  // buildScene 은 cellDigits 순회 순서대로 면 폴리곤을 push 한다 (scene-marker-tones 전례).
  let idx = 0;
  let tonedFaces = 0;
  for (const [kk, entry] of encoded.cellDigits) {
    const [q, r] = kk.split(',').map(Number);
    for (const face of FACES) {
      const shape = scene.shapes[idx];
      assert.deepEqual(shape.points, facePolygon(q, r, face, scene.layout),
        kk + ':' + face + ' 폴리곤 어긋남 — 순회 계약이 바뀌었나');
      if (entry.tones) {
        const tone = expectedTones.get(kk)[face];
        assert.equal(entry.tones[face], tone, kk + ':' + face + ' 적재 톤이 정본과 다르다');
        assert.deepEqual(shape.color, PALETTE.levels[tone],
          kk + ':' + face + ' 색이 palette.levels[' + tone + '] 가 아니다');
        assert.notDeepEqual(shape.color, PALETTE.bullseyeLight,
          kk + ':' + face + ' 가 파인더 축(순백)으로 그려졌다 — §4.3 위반');
        tonedFaces += 1;
      }
      idx += 1;
    }
  }
  // 톤 실린 셀 = markerCells(k) 전부 (유도값 12 × 3면) — 손 숫자 없음.
  assert.equal(tonedFaces, markerCells(encoded.k).length * FACES.length,
    '톤 실린 면 수가 마커 12셀 × 3면과 다르다 — 적재가 죽었거나 샜다');
  // 위치도 유도 집합과 일치.
  const markerSet = new Set(markerCells(encoded.k).map(key));
  for (const [kk, entry] of encoded.cellDigits) {
    if (entry.tones) assert.ok(markerSet.has(kk), '마커 밖 셀 ' + kk + ' 에 톤이 실렸다');
  }
});

test('④ 12셀이 실제로 그려진다 — verifyRaster 0 mismatch · digit 프레임과 픽셀이 다르다', () => {
  const toned = encode('TLcube-H', {
    version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true,
  });
  const digit = encode('TLcube-H', { version: 1, eccLevel: 'M', cornerMarker: true });
  const sceneToned = buildScene(toned, { palette: PALETTE, cellSize: 8 });
  const rasterToned = rasterize(sceneToned, { pixelsPerUnit: 1, supersample: 2 });
  const verdict = verifyRaster(rasterToned, sceneToned, toned);
  assert.equal(verdict.mismatches.length, 0,
    '무왜곡 H 렌더에 mismatch: ' + JSON.stringify(verdict.mismatches.slice(0, 3)));
  const rasterDigit = renderPinned(digit);
  assert.notEqual(sha256(rasterToned), sha256(rasterDigit),
    'H 톤 프레임과 digit 프레임 픽셀이 같다 — 톤이 렌더에 안 실렸다');
});

test('⑤ 레거시 무변경 — H 를 안 쓴 O/A 프레임 sha256 = HEAD 실측 (바이트)', () => {
  // 기준값: test/output/lanes/claude-h-head-hashes.out.txt (HEAD b992b9f 실측).
  assert.equal(
    sha256(renderPinned(encode('pin', { version: 1, eccLevel: 'M' }))),
    '35f4cb375c5478373f8bdc073752f857c4c7c8088779ee83d8ac9cb290ec93a4',
    'O V1 plain 렌더가 움직였다',
  );
  const cmPins = {
    1: 'd52180b495c71b14b44b8369b32f4ec84428df425c3b4b6c87cfcf1670b93b58',
    2: '26637a56b7812baec357f9d6671d46dbeeb3eb1c9660e0bc281e9b4f6f070340',
    3: '3f87b0ed912a90602ee081fa6ec1b97f8cf427fda258c5cc04edf3c61290b91c',
  };
  for (const spec of VERSIONS_OCM) {
    assert.equal(
      sha256(renderPinned(encode('pin', { version: spec.version, eccLevel: 'M', cornerMarker: true }))),
      cmPins[spec.version],
      'O V' + spec.version + 'CM digit-only 렌더가 움직였다 — markerTones 기본값이 샌다',
    );
  }
  assert.equal(
    sha256(renderPinned(encodeA('pin', { version: 0, eccLevel: 'M', cornerMarker: true }), 80)),
    '108478c8aa81155e0602a33c94f3d8c3be01f65919da69879c8f2ffcefcd7c65',
    'A0CM 렌더가 움직였다 — 이 레인은 A 경로 무접촉이어야 한다',
  );
});

test('⑥ H 톤 프레임은 코너 마커 절대 톤 경로로 읽힌다 (F-85)', () => {
  const render12 = (encoded) => rasterize(
    buildScene(encoded, { palette: PALETTE }),
    { pixelsPerUnit: 12, supersample: 1 },
  );
  // digit-only 는 왕복이 선다 — 자리(예약)는 멀쩡하다는 대조군.
  const digit = decodeFrontend(render12(
    encode('TLcube-H', { version: 1, eccLevel: 'M', cornerMarker: true }),
  ));
  assert.equal(digit.ok, true, 'digit-only O-CM 왕복이 죽었다');
  assert.equal(digit.text, 'TLcube-H');

  const encoded = encode('TLcube-H', {
    version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true,
  });
  // 검출기 단 — 프런트가 안 탄 `if (cell.tones)` 가지가 H 변형 groups 로 열린다.
  const cellSize = 20;
  const scene = buildScene(encoded, { palette: PALETTE, cellSize });
  const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: 4 });
  const luma = toRelativeLuminance(raster);
  const cm = findOCornerMarkerHypotheses(luma, {
    center: { x: scene.layout.originX, y: scene.layout.originY },
    cellSize,
  }, [encoded.k]);
  assert.equal(cm.ok, true, 'H 톤 코너 마커 검출이 죽었다: ' + (cm.reason || ''));
  assert.ok(cm.hypotheses.some((h) => String(h.hypothesisId).endsWith('-h')),
    '이긴 가설에 tag=h 가 없다 — 절대 톤 변형이 안 열렸다');

  const toned = decodeFrontend(render12(encoded));
  assert.equal(toned.ok, true,
    'H 톤 프런트 왕복이 죽었다: ' + (toned.reason || '') + '@' + (toned.detail && toned.detail.stage));
  assert.equal(toned.text, 'TLcube-H');
  assert.equal(toned.hypothesis.source, 'corner-marker',
    'H 톤이 앵커 경로로 읽혔다 — tetrad A 피복이 풀린 것이다');

  // V2 도 같은 경로. ppu 12 는 k=8 에서 가끔 no-anchors 로 남는다 (해상도, 문턱 아님).
  const v2 = decodeFrontend(rasterize(
    buildScene(encode('TLcube-H', {
      version: 2, eccLevel: 'M', cornerMarker: true, markerTones: true,
    }), { palette: PALETTE }),
    { pixelsPerUnit: 16, supersample: 1 },
  ));
  assert.equal(v2.ok, true, 'V2CM+H ppu16 왕복이 죽었다: ' + (v2.reason || ''));
  assert.equal(v2.text, 'TLcube-H');
  assert.equal(v2.hypothesis.source, 'corner-marker');
});

test('⑦ 옵션 가드 — markerTones 는 boolean · cornerMarker(자리) 없이 못 켠다', () => {
  assert.throws(
    () => encode('TL', { version: 1, eccLevel: 'M', markerTones: true }),
    RangeError,
  );
  assert.throws(
    () => encode('TL', { version: 1, eccLevel: 'M', cornerMarker: true, markerTones: 1 }),
    TypeError,
  );
  // 켜지 않으면 결과 플래그도 꺼져 있다 (인코더 산출 자기서술).
  assert.equal(encode('TL', { version: 1, eccLevel: 'M', cornerMarker: true }).markerTones, false);
  assert.equal(
    encode('TL', { version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true }).markerTones,
    true,
  );
});
