/**
 * typeK-generator-finder.test.js — Type K 생성기의 **파인더 축**을 값으로 잠근다.
 *
 * 운영자 신고 (2026-08-25): 「생성 현재 중앙 파인더 C2 쌍날로만 고정 렌더, 그 외 모든
 * 파인더 옵션 작동 안 함. 스캔도 당연히 안됨.」 두 결함이 겹쳐 있었다:
 *
 *   ① `renderTypeK` 가 sceneOpts 에 **finderPatternId 를 안 넘겼다** — 어느 카드를
 *      골라도 buildScene 이 라이브러리 기본으로 되돌아갔다. (내가 만든 결함.
 *      sceneOptsForOA 는 늘 실어 왔는데 K 는 그 함수를 못 써서 손으로 조립하다 빠졌다.)
 *   ② 넘기고 나서 재보니 **대부분이 스캔이 안 된다** — 이건 더 오래된 공백이다.
 *      star 검출 경로가 불스아이 밖을 못 읽는다.
 *
 * ⚠ 대조군이 ②를 «K 고유» 로 확정했다: 같은 셀마스크 파인더가 Type O 에서는 전부
 *   성립한다. 파인더의 문제가 아니라 패밀리 검출의 문제다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { encodeK } from '../src/encodeK.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset } from '../src/luminance.js';
import { K_SCANNABLE_FINDER_PATTERN_ID, selectGeneratorType } from '../src/finder-selection.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID, createGeneratorState,
} from '../src/generator-state.js';

const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background, levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const roundTrip = (encoded, text, finderPatternId) => {
  const opts = { palette: PALETTE, margin: 20 };
  if (finderPatternId) opts.finderPatternId = finderPatternId;
  try {
    const r = decodeFrontend(rasterize(buildScene(encoded, opts), { pixelsPerUnit: 12, supersample: 1 }));
    return r.ok === true && r.text === text;
  } catch { return false; }
};

test('① renderTypeK 는 finderPatternId 를 scene 으로 넘긴다 (안 넘기면 카드가 무동작)', () => {
  const body = INDEX.slice(INDEX.indexOf('function renderTypeK'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /finderPatternId: cfg\.finderPatternId/,
    'renderTypeK 가 finderPatternId 를 안 싣는다 — 어느 파인더를 골라도 같은 그림이 나온다');
});

test('② 허용한 파인더는 **전 버전에서** 실제로 스캔된다', () => {
  // 「가끔 된다」는 「된다」가 아니다 — K0 만 되는 것을 열면 사용자가 K1 에서 못 읽는
  // 코드를 만든다 (cube-bullseye 가 정확히 그 경우라 목록 밖이다).
  for (const version of [0, 1, 2]) {
    const text = 'K-finder-lock-' + version;
    const encoded = encodeK(text, { version, eccLevel: 'M' });
    assert.equal(roundTrip(encoded, text, K_SCANNABLE_FINDER_PATTERN_ID), true,
      'K' + version + ' 가 허용 파인더(' + K_SCANNABLE_FINDER_PATTERN_ID + ')로 안 읽힌다');
  }
});

test('③ K 의 기본 파인더가 곧 그 허용 파인더다 — 기본 상태가 안 읽히면 안 된다', () => {
  const next = selectGeneratorType(
    createGeneratorState({ type: 'Y' }), 'K', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  );
  assert.equal(next.finderPatternId, K_SCANNABLE_FINDER_PATTERN_ID,
    'K 기본 파인더가 스캔되는 것이 아니다 — 첫 렌더가 못 읽는 코드가 된다');
  assert.notEqual(K_SCANNABLE_FINDER_PATTERN_ID, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    '두 값이 같아졌다면 star 검출이 넓어진 것이다 — 그렇다면 이 테스트와 '
    + 'index.html 의 K_SCANNABLE_FINDER_IDS 허용 목록을 함께 갱신하라');
});

test('④ ⛔ 알려진 공백 — star 검출은 불스아이 밖을 못 읽는다 (K 고유, 대조군 확인)', () => {
  // 이 단언이 뒤집히는 날 = star 검출이 넓어진 날이다. 그때 허용 목록을 걷는다.
  const CELL_MASK = 'pinwheel-3-0101-cw-missing-solid';
  const kText = 'K-gap';
  assert.equal(roundTrip(encodeK(kText, { version: 0, eccLevel: 'M' }), kText, CELL_MASK), false,
    'K 가 셀마스크 파인더로 읽히기 시작했다 — index.html 의 K_SCANNABLE_FINDER_IDS 를 넓혀라');
  // **대조군** — 같은 파인더가 Type O 에서는 성립한다. 이게 «K 고유» 의 근거다.
  const oText = 'O-control';
  assert.equal(roundTrip(encode(oText, { version: 1, eccLevel: 'M' }), oText, CELL_MASK), true,
    'Type O 대조군까지 죽었다 — 그러면 K 고유 결함이 아니라 파인더·렌더 회귀다');
});

test('⑤ UI 허용 목록이 실측과 같은 값을 쓴다 (사본이 갈리면 화면과 코드가 어긋난다)', () => {
  assert.match(INDEX, /const K_SCANNABLE_FINDER_IDS = typeK \? new Set\(\['bullseye'\]\) : null;/,
    'index.html 의 K 파인더 허용 목록이 실측 집합과 다르다');
});
