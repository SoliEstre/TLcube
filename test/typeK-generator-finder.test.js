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
import { selectGeneratorType } from '../src/finder-selection.js';
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
    assert.equal(roundTrip(encoded, text, GENERATOR_DEFAULT_FINDER_PATTERN_ID), true,
      'K' + version + ' 가 허용 파인더(' + GENERATOR_DEFAULT_FINDER_PATTERN_ID + ')로 안 읽힌다');
  }
});

test('③ K 의 기본 파인더가 곧 그 허용 파인더다 — 기본 상태가 안 읽히면 안 된다', () => {
  const next = selectGeneratorType(
    createGeneratorState({ type: 'Y' }), 'K', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  );
  // **의도적 갱신** — star 검출이 열려 K 도 다른 타입과 같은 기본 파인더를 쓴다.
  assert.equal(next.finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    'K 기본 파인더가 표준 기본값이 아니다');
  const dtext = 'K-default-finder';
  assert.equal(roundTrip(encodeK(dtext, { version: 1, eccLevel: 'M' }), dtext,
    GENERATOR_DEFAULT_FINDER_PATTERN_ID), true,
    '기본 파인더로 만든 K1 이 안 읽힌다 — 첫 렌더가 못 읽는 코드가 된다');
});

test('④ **공백 해소** — star 검출이 중앙 파인더 전종을 읽는다 (레인 POSE)', () => {
  // ⛔ 2026-08-25 낮까지 이 자리는 「star 는 불스아이 밖을 못 읽는다」는 **음성 단언**이었다.
  // 같은 날 레인 POSE 가 닫았고, 원인은 정밀도가 아니라 **호출 부재**였다: 분류에 star 가
  // 없으면 K 앵커 검출(findKAnchorHypotheses)이 아예 안 불렸다. 그래서 수백 개의 hex/tri
  // 가설이 star 포맷 인덱스를 한 번도 허용받지 못했다 (formatProposalCount=0).
  // 정형 ③ 대로 음성 락을 **양성 단언**으로 전환한다.
  const CELL_MASK = 'pinwheel-3-0101-cw-missing-solid';
  for (const version of [0, 1, 2]) {
    const text = 'K-cellmask-' + version;
    assert.equal(roundTrip(encodeK(text, { version, eccLevel: 'M' }), text, CELL_MASK), true,
      'K' + version + ' 가 셀마스크 파인더로 안 읽힌다 — star 독립 검출이 되돌아갔나');
  }
  // 대조군은 그대로 둔다 — Type O 가 함께 죽으면 K 고유가 아니라 파인더·렌더 회귀다.
  const oText = 'O-control';
  assert.equal(roundTrip(encode(oText, { version: 1, eccLevel: 'M' }), oText, CELL_MASK), true,
    'Type O 대조군이 죽었다 — K 고유 결함이 아니라 파인더·렌더 회귀다');
});

test('⑤ UI 허용 목록이 실측과 같은 값을 쓴다 (사본이 갈리면 화면과 코드가 어긋난다)', () => {
  // 허용 목록은 철회됐다 — 남는 차단은 **인코더가 실제로 던지는 것**뿐이다.
  assert.ok(INDEX.includes('const K_BLOCKED_FINDER_IDS = typeK'),
    'K 배타 게이트가 사라졌다 — encodeK 가 던지는 조합이 카드로 열린다');
  assert.ok(!INDEX.includes('K_SCANNABLE_FINDER_IDS'),
    '허용 목록이 남아 있다 — star 검출이 열렸으므로 걷어야 한다');
});
