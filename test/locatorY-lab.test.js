/**
 * locatorY-lab.test.js — 로케이터 옵션이 시험판 전용·다국어·상태 보존·번들 포함인지.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GENERATOR_STATE_SCHEMA,
  createGeneratorState,
  exposedGeneratorStateKeys,
} from '../src/generator-state.js';
import {
  DEFAULT_LOCATOR_PROFILE_Y,
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0X,
  LOCATOR_PROFILE_CELL_SURFACE_V0W,
  LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0XQ,
  LOCATOR_PROFILE_CELL_SURFACE_V1R2,
  LOCATOR_PROFILE_CELL_SURFACE_V2R2,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_OFF,
} from '../src/locatorY.js';
import { buildGeneratorLabHtml } from '../tools/build-gen-variants.mjs';
import { buildSingleHtml, OFFICIAL_GENERATOR_EDITION } from '../tools/build-single.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  const at = INDEX.search(new RegExp(`["']?${lang}["']?\\s*:\\s*\\{`, 'm'));
  assert.ok(start >= 0 && at > start, `${lang} 사전을 못 찾았다`);
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i += 1) {
    if (INDEX[i] === '{') depth += 1;
    else if (INDEX[i] === '}') {
      depth -= 1;
      if (depth === 0) return INDEX.slice(open, i + 1);
    }
  }
  throw new Error(`${lang} 사전이 닫히지 않는다`);
}

test('locatorProfileY 는 내부 상태이고 기본은 off 이며 왕복 선택지가 있다', () => {
  const state = createGeneratorState();
  assert.equal(state.locatorProfileY, DEFAULT_LOCATOR_PROFILE_Y);
  assert.equal(state.locatorProfileY, LOCATOR_PROFILE_OFF);
  assert.equal(GENERATOR_STATE_SCHEMA.locatorProfileY.exposure, 'internal');
  // 최종 라인업(2026-08-15) v0 · v2r2 + (2026-08-15 밤) v1r2 = n=21 A/B 후보
  // + (의도적 갱신 2026-08-16) v0x = n=21 3파전 후보
  // + (의도적 갱신 2026-08-17) v0xq = n=21 중앙 QR 변형.
  // hex-frame-v1 은 UI 카드만 내렸고 **값은 살아 있다**(차단·비삭제).
  //
  // **의도적 갱신 «드랍 정본화» (운영자 확정 2026-08-16)** — v2r2 · v1r2 를 허용값에서
  // 뺐다. 초안 v2 · 구 v1 CS 와 같은 처리이며, **저장돼 있던 값은 검증 실패로
  // 기본(off)에 떨어진다** (아래 회귀가 그 폴백을 직접 건다).
  // 와이어·정본·디코더 판독은 그대로다 (cellSurfaceFinal.js 의 DROPPED_IDS).
  //
  // **의도적 갱신 «v0W 편입» (운영자 신설 설계 2026-08-16)** — 허용값 맨 뒤에 v0W 를
  // 더했다. 카드도 함께 났으므로 «값만 살아 있는» hex-frame-v1 과는 다른 처지다.
  //
  // **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)** — 맨 뒤에 v0WQ. **v0WY 는 여기
  // 없다** — 로케이터 프로파일이 아니라 `qrPosition: 'plane'` 이라서다.
  assert.deepEqual(
    [...GENERATOR_STATE_SCHEMA.locatorProfileY.options],
    [
      LOCATOR_PROFILE_OFF,
      LOCATOR_PROFILE_HEX_FRAME_V1,
      LOCATOR_PROFILE_CELL_SURFACE_V0,
      LOCATOR_PROFILE_CELL_SURFACE_V0X,
      LOCATOR_PROFILE_CELL_SURFACE_V0XQ,
      LOCATOR_PROFILE_CELL_SURFACE_V0W,
      LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
    ],
  );
  // 허용값 밖이라는 사실 자체가 «저장된 옛 값 → 기본(off) 폴백» 의 근거다 —
  // 상태 복원기는 이 `options` 목록으로 검증한다 (초안 v2 · 구 v1 CS 와 같은 경로).
  for (const dropped of [
    LOCATOR_PROFILE_CELL_SURFACE_V2R2, LOCATOR_PROFILE_CELL_SURFACE_V1R2,
  ]) {
    assert.equal(
      GENERATOR_STATE_SCHEMA.locatorProfileY.options.includes(dropped), false,
      dropped + ' 가 아직 허용값에 있다 — 드랍이 안 걸렸다',
    );
  }
  assert.equal(exposedGeneratorStateKeys('normal').includes('locatorProfileY'), false);
  assert.equal(exposedGeneratorStateKeys('advanced').includes('locatorProfileY'), false);

  state.locatorProfileY = LOCATOR_PROFILE_HEX_FRAME_V1;
  const clone = createGeneratorState(state);
  assert.equal(clone.locatorProfileY, LOCATOR_PROFILE_HEX_FRAME_V1);
});

test('Y타입 검출기 옵션 섹션은 소스에 있고 lab 경로에서만 연다', () => {
  assert.match(INDEX, /id="yLocatorSection"/);
  assert.match(INDEX, /data-i18n="g515"/);
  assert.match(INDEX, /data-locator="off"/);
  assert.match(INDEX, /data-locator="cell-surface-v0"/);
  assert.match(INDEX, /data-locator="cell-surface-v0x"/);
  assert.match(INDEX, /data-locator="cell-surface-v0xq"/);
  assert.match(INDEX, /data-locator="cell-surface-v0w"/);
  // 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): v0WQ 카드 신설. v0WY 는 **카드가
  // 여기 없다** — QR 위치 카드('plane')로 붙었고, 아래 별도 단언이 그것을 고정한다.
  assert.match(INDEX, /data-locator="cell-surface-v0wq"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v0wy"/);
  assert.match(INDEX, /data-pos="plane"/);
  // **의도적 갱신 «드랍 정본화» (2026-08-16)** — v2r2 · v1r2 카드를 내렸다.
  // hex-frame-v1 전례와 같은 «카드만 내림» 이다: 사전 키(g543/g547/g945/g946)는
  // 3언어 모두 남아 있고(아래 문구 테스트가 고정), 와이어·판독은 그대로다.
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v2r2"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v1r2"/);
  assert.doesNotMatch(INDEX, /data-locator="hex-frame-v1"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v2"(?!r2)/);
  // 차단이지 삭제가 아니다 — hex-frame-v1 렌더·마진 경로는 소스에 그대로 있다.
  assert.match(INDEX, /LOCATOR_PROFILE_HEX_FRAME_V1/);
  assert.match(INDEX, /function syncYLocatorUi\(\)/);
  assert.match(INDEX, /isLabPath\(\) && generatorState\.type === 'Y'/);
  assert.match(INDEX, /isLabPath\(\) && generatorState\.locatorProfileY === LOCATOR_PROFILE_HEX_FRAME_V1/);
  assert.match(INDEX, /isCellSurfaceLocatorProfileY\(generatorState\.locatorProfileY\)/);
  assert.match(INDEX, /locatorProfile: generatorState\.locatorProfileY/);
  assert.doesNotMatch(INDEX, /cellSurfaceLocked \? 3/);
  assert.doesNotMatch(INDEX, /toneLocked = isY && \(generatorState\.qrPosition === 'inner' \|\| cellSurfaceLocked\)/);
  assert.match(INDEX, /tone: generatorState\.tone,/);
  assert.doesNotMatch(INDEX, /회전·조명·인쇄·라이브 스캔 성능을 보장해요/);
});

test('로케이터 문구는 ko/en/ja 가 같고 성능 보장을 하지 않는다', () => {
  for (const key of ['g515', 'g516', 'g517', 'g518', 'g519', 'g520', 'g541', 'g542', 'g543', 'g544', 'g545', 'g546', 'g547', 'g548']) {
    for (const lang of ['ko', 'en', 'ja']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  assert.match(INDEX, /실험용입니다\. 회전·조명·인쇄·라이브 스캔 성능을 보장하지 않아요/);
  assert.match(INDEX, /Does not guarantee rotation, lighting, print, or live-scan performance/);
  assert.match(INDEX, /回転・照明・印刷・ライブスキャンの性能は保証しません/);
  assert.match(INDEX, /data-locator="cell-surface-v0"[\s\S]*?data-i18n="g542">셀 표면 v0 \(Y0\)</);
  assert.match(INDEX, /data-locator="cell-surface-v0x"[\s\S]*?data-i18n="g602">셀 표면 v0X \(Y1\)</);
  // **의도적 갱신 «드랍 정본화» (2026-08-16)** — 카드는 내렸지만 **사전 항목은
  // 3언어 모두 남긴다**. 되살릴 때 재번역하지 않기 위해서고, 위 키 순회
  // (g543 · g547)가 그 보존을 이미 강제한다. 여기서는 사전 문자열 자체를 건다.
  assert.match(INDEX, /"g543":\s*"셀 표면 v2r2 \(Y1\/Y2\)"/);
  assert.match(INDEX, /"g547":\s*"셀 표면 v1r2 \(Y1\)"/);
  assert.match(INDEX, /Cell surface v1r2 \(Y1\)/);
  assert.match(INDEX, /セル表面 v1r2 \(Y1\)/);
  assert.doesNotMatch(INDEX, /id="yLocatorArmSection"/);
  assert.doesNotMatch(INDEX, /data-locator-arm=/);
  assert.equal(GENERATOR_STATE_SCHEMA.locatorArmY, undefined);
});

test('시험판 번들에는 섹션이 있고 안정판은 런타임에 숨긴다', () => {
  const lab = buildGeneratorLabHtml();
  const official = buildSingleHtml({ generatorEdition: OFFICIAL_GENERATOR_EDITION });
  assert.match(lab, /id="yLocatorSection"/);
  assert.match(lab, /data-i18n="g515"/);
  assert.match(official, /id="yLocatorSection"/);
  assert.match(official, /section\.hidden = !show/);
  assert.match(official, /isLabPath\(\) && generatorState\.type === 'Y'/);
});
