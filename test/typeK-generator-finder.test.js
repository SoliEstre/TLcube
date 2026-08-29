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
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';

const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background, levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const roundTrip = (encoded, text, finderPatternId) => {
  const opts = { palette: PALETTE, margin: 20 };
  if (finderPatternId) opts.finderPatternId = finderPatternId;
  if (finderPatternId === CENTRAL_N7_FINDER_PATTERN_ID) opts.centralN7Family = 'star';
  try {
    const r = decodeFrontend(rasterize(buildScene(encoded, opts), { pixelsPerUnit: 12, supersample: 1 }));
    return r.ok === true && r.text === text;
  } catch { return false; }
};

test('① renderTypeK 는 finderPatternId 를 scene 으로 넘긴다 (안 넘기면 카드가 무동작)', () => {
  const body = INDEX.slice(INDEX.indexOf('function renderTypeK'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  // 2026-08-29 daehan 개설로 직결(cfg.finderPatternId)이 아니라 **재사상 변수**를
  // 싣는다 — daehan 이면 버전 k 의 잘림본 id, 아니면 고른 카드 그대로 (renderTypeO
  // 와 같은 유도). 잠글 성질은 «cfg 의 선택이 scene 까지 도달한다» 이므로 유도식과
  // 적재를 함께 잰다.
  assert.match(fn, /renderedFinderPatternId = encoded\.daehanFinder\s*\?\s*daehanPatternId\(encoded\.k\)\s*:\s*cfg\.finderPatternId/,
    'renderTypeK 의 파인더 id 유도가 cfg.finderPatternId 에서 출발하지 않는다');
  assert.match(fn, /finderPatternId: renderedFinderPatternId/,
    'renderTypeK 가 finderPatternId 를 안 싣는다 — 어느 파인더를 골라도 같은 그림이 나온다');
});

test('② 허용한 파인더는 **전 버전에서** 실제로 스캔된다', () => {
  // 「가끔 된다」는 「된다」가 아니다 — K0 만 되는 것을 열면 사용자가 K1 에서 못 읽는
  // 코드를 만든다 (cube-bullseye 가 정확히 그 경우라 목록 밖이다).
  for (const version of [0, 1, 2]) {
    const text = 'K-finder-lock-' + version;
    const encoded = encodeK(text, { version, eccLevel: 'M', centralN7: true });
    assert.equal(roundTrip(encoded, text, GENERATOR_DEFAULT_FINDER_PATTERN_ID), true,
      'K' + version + ' 가 허용 파인더(' + GENERATOR_DEFAULT_FINDER_PATTERN_ID + ')로 안 읽힌다');
  }
});

test('③ K 의 기본 상태가 안 읽히면 안 된다 — 기본 = 중앙 TL (O/A 와 같다)', () => {
  const next = selectGeneratorType(
    createGeneratorState({ type: 'Y' }), 'K', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  );
  assert.equal(next.finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    'K 기본 파인더가 생성기 공용 기본값이 아니다');
  assert.notEqual(next.qrPosition, 'inner', '중앙 TL과 중앙 QR을 같은 슬롯에 놓았다');
  assert.doesNotThrow(() => encodeK('K-default-central-tl', {
    version: 1, eccLevel: 'M', centralN7: true,
  }), 'K 기본 조합(centralN7)이 encodeK 에서 던진다 — 첫 클릭이 곧 오류다');

  // 기본과 직전 파인더가 모두 같은 중앙 TL이며 실제 프런트엔드 왕복해야 한다.
  assert.equal(next.previousFinderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    'K 의 복귀 파인더가 표준 기본값이 아니다');
  const dtext = 'K-default-finder';
  assert.equal(roundTrip(encodeK(dtext, {
    version: 1, eccLevel: 'M', centralN7: true,
  }), dtext,
    GENERATOR_DEFAULT_FINDER_PATTERN_ID), true,
    '기본 중앙 TL로 만든 K1 이 안 읽힌다');
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

test('⑤ K 카드 차단 게이트는 인코더 실측과 같이 움직인다 — 던지는 카드가 없으면 게이트도 없다', () => {
  // 허용 목록(2026-08-25 철회)에 이어 차단 집합도 2026-08-29 daehan 개설로 공집합이
  // 됐다 — encodeK 가 던지는 것(turnA·sagoae)은 **파인더 카드가 아니다**. 그래서
  // 게이트 자체를 걷었다. 재는 성질: ⓐ 어떤 중앙 파인더 카드도 K 인코더 옵션에서
  // 던지지 않는다 (encodeK 에게 직접 묻는다 — 손 목록 금지), ⓑ 걷힌 게이트·허용
  // 목록의 잔재가 없다 (남으면 다음 사람이 살아 있는 줄 알고 배선한다).
  const cardFlags = [
    {}, { daehanFinder: true }, { centralV0: true }, { centralN7: true }, { centerQr: true },
  ];
  for (const flags of cardFlags) {
    assert.doesNotThrow(() => encodeK('K-card-' + Object.keys(flags).join(''), {
      version: 0, eccLevel: 'M', ...flags,
    }), 'K 파인더 카드 조합이 인코더에서 던진다 — 카드 차단 게이트를 되살려야 한다: '
      + JSON.stringify(flags));
  }
  assert.ok(!INDEX.includes('K_BLOCKED_FINDER_IDS'),
    '걷힌 차단 게이트의 잔재가 남아 있다 — 죽은 배선은 다음 배타 때 오도한다');
  assert.ok(!INDEX.includes('K_SCANNABLE_FINDER_IDS'),
    '허용 목록이 남아 있다 — star 검출이 열렸으므로 걷어야 한다');
});
