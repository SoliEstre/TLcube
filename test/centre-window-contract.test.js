/**
 * centre-window-contract.test.js — 로케이터 **중앙 창**의 계약.
 *
 * 🔴 왜 있나 (2026-09-04, 배포 전 독립 사전검증이 잡음): `f3c142c` 가
 * `UNVERIFIED_CS_BLOCK_LOCATOR` 에 `centreWindowFraction: 0.75` 를 넣어
 * **모든 호출자의 기본값**을 바꿨는데, 그 값을 단언하는 테스트가 `test/` 전체에
 * **0건**이었다. 같은 객체의 형제 기본값들은 잠겨 있는데 이것만 안 잠겨 있었다.
 *
 * 그리고 그 기본값에는 **전제**가 있다 — `cellsurface-block-detect.js` 가 적은
 * 「찾는 블록은 프레임 중앙에 있다」. 이건 **라이브 카메라에서만** 참이다
 * (`scanner.js` 의 `imageDataCenterSquare` 가 중앙 정사각을 잘라 준다).
 * 사진 업로드 경로(`imageDataWhole`)는 정반대를 명시한다 —
 * 「사진은 코드가 가운데 있으리란 보장이 없다」며 **일부러 안 자른다.**
 * 두 계약이 충돌하므로 업로드 경로는 창을 항등으로 되돌려야 한다.
 *
 * ⚠ **이 파일이 못 재는 축** (이름을 붙여 둔다): 「코드가 프레임 가장자리에 있는
 * 실물 프레임에서 0.75 가 실제로 그것을 떨구는가」. 로케이터 헬퍼의 `embed960` 이
 * 코드를 **정중앙에 박기** 때문에 기존 스위트에 그 프레임이 없고, 실물 코퍼스에서
 * 가장자리 배치는 `edge-20260904` 뿐인데 그건 **창과 무관하게 0/20** 이라 두 팔을
 * 못 가른다 (PM/029B §17·§18). 여기서 잠그는 것은 ① 기본값 ② 손잡이가 살아 있다는
 * 성질 ③ 업로드 경로가 그 손잡이를 쥔다는 배선, 셋이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  UNVERIFIED_CS_BLOCK_LOCATOR,
  detectCellSurfaceBlockShapes,
} from '../src/decoder/cellsurface-block-detect.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

// ── ① 기본값 ──────────────────────────────────────────────────────────────
test('중앙 창 기본값이 0.75 다 — 그리고 그 값에는 전제가 붙어 있다', () => {
  assert.equal(UNVERIFIED_CS_BLOCK_LOCATOR.centreWindowFraction, 0.75,
    '기본값이 바뀌었다. 이 값은 성질이 아니라 «화면 촬영 프레임의 모서리 QR 이 어디 있었나» 로 '
    + '정해졌다 (y0 의 QR 이 (90,81) 이라 960 프레임에서 cw < 0.81 이 경계). '
    + '바꿀 거면 PM/029B §15.3 의 사다리를 다시 돌려라 — 숫자만 고치지 마라');
  // 같이 들어간 짝. 이것도 안 잠겨 있었다.
  assert.equal(UNVERIFIED_CS_BLOCK_LOCATOR.searchMaxSide, 480,
    'searchMaxSide 가 바뀌었다 — 큰 프레임에서 코드가 몇 픽셀로 줄어드는지를 정하는 값이다');
});

// ── ② 손잡이가 살아 있나 (중첩까지가 계약이다) ──────────────────────────────
test('중앙 창 손잡이가 `calibration.csBlockLocator` 중첩으로 실제로 닿는다', (t) => {
  // 🔴 이 중첩을 한 층 얕게 넣으면 **조용히 무시된다**. 통합자가 R2 어댑터에서 그 함정을
  // 밟아 A/B 두 팔이 비트 동일로 나왔고, 하마터면 「반증자 주장 재현 안 됨」을 공표할 뻔했다.
  // 그래서 이 테스트는 «값이 맞나» 가 아니라 «손잡이가 무는가» 를 잰다.
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === 'y1');
  if (!seq || !seq.frames.length) {
    t.skip('휘도 덤프 없음 (test/output 은 gitignore) — 통합자 기기에서만 돈다');
    return;
  }
  const dump = readLumaDump(seq.frames[0].path);
  const run = (centreWindowFraction) => detectCellSurfaceBlockShapes(dump.data === undefined ? dump : dump, {
    enableCellSurfaceY: true,
    calibration: { csBlockLocator: { centreWindowFraction } },
  });

  // y1 의 참 코드 중심은 (493.3, 493.0), 프레임 960 (tools/a3-wire-labels.json).
  // 항등(=1)에서는 잡히고, 창을 아주 좁히면(0.01 → 반폭 4.8px) 중심이 창 밖이라 빠진다.
  const open = run(1);
  const tight = run(0.01);

  // 「값이 있나」를 「값이 맞나」보다 먼저 묻는다 — 열린 팔이 0 이면 이 테스트는 공허하다.
  assert.ok(open.shapes.length > 0,
    `항등 창에서 y1 코드가 잡혀야 이 테스트가 뭔가를 잰다 (열림 ${open.shapes.length})`);
  assert.ok(tight.shapes.length < open.shapes.length,
    `창을 0.01 로 좁히면 후보가 줄어야 한다 — 안 줄면 손잡이가 안 닿은 것이다 `
    + `(열림 ${open.shapes.length} · 좁힘 ${tight.shapes.length}). `
    + '가장 흔한 원인: 중첩을 한 층 얕게 넣었다');
});

// ── ③ 사진 업로드 경로가 그 손잡이를 쥔다 ─────────────────────────────────
test('스캐너 배선 — 사진 업로드 경로가 중앙 창을 항등으로 되돌린다', () => {
  // ⚠ `scanner.js` 는 브라우저 모듈이라 Node 에서 import 이 안 된다. 그래서 소스를
  // 읽는다 — 이 repo 의 기존 관례다 (`central-v0-beacon.test.js` 의 「스캐너 배선」).
  // 소스 정규식은 **쓴 방식**을 고정하므로, 여기서는 「이 문자열이 있다」가 아니라
  // **「선언이 로케이터가 읽는 자리에 있다」**를 재도록 좁게 쓴다.
  const src = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');

  assert.match(src, /centreWindowFraction:\s*1\b/,
    '업로드 경로가 중앙 창을 끄지 않는다 — 코드가 가운데 없는 사진이 조용히 실패한다');

  // 위치가 계약이다: 선언은 `family: { cube: { … } }` 안에 있어야 로케이터까지 닿는다
  // (`family.js` 의 `scoreCubeTiling` 이 `options.cube` 를 통째로 cubeOptions 로 쓴다).
  // `bootstrap` 바로 아래나 최상위에 두면 조용히 무시된다.
  const familyCube = src.slice(src.indexOf('family: {'), src.indexOf('// 가이드-사전 포즈'));
  assert.ok(familyCube.includes('cube: {'), 'family.cube 블록을 못 찾았다 — 이 자가 낡았다');
  assert.match(familyCube, /calibration:/,
    'calibration 선언이 family.cube 밖에 있다 — 그 자리에서는 로케이터에 안 닿는다');

  // 그리고 그것이 **업로드 경로 한정**이어야 한다. 라이브까지 끄면 y0 을 살린
  // 수정(f3c142c, 0/108 → 108/108)이 되돌아간다.
  assert.match(familyCube, /source\s*===\s*'still'/,
    '창 끄기가 업로드 경로 한정이 아니다 — 라이브까지 끄면 f3c142c 의 y0 수정이 되돌아간다');
});
