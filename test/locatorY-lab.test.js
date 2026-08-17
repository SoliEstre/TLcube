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
  LOCATOR_PROFILE_CELL_SURFACE_V0W2,
  LOCATOR_PROFILE_CELL_SURFACE_V0WY,
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
  // 뺐다. 효과는 UI 카드 소멸 + 허용값 목록 이탈이다 (검증 렌즈 2026-08-17 정정:
  // 생성기 상태는 저장되지 않으므로 «저장값 폴백» 기전은 존재하지 않는다 — 아래
  // 회귀가 거는 것은 목록 포함 여부다).
  // 와이어·정본·디코더 판독은 그대로다 (cellSurfaceFinal.js 의 DROPPED_IDS).
  //
  // **의도적 갱신 «v0W 편입» (운영자 신설 설계 2026-08-16)** — 허용값 맨 뒤에 v0W 를
  // 더했다. 카드도 함께 났으므로 «값만 살아 있는» hex-frame-v1 과는 다른 처지다.
  //
  // **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)** — 맨 뒤에 v0WQ. **v0WY 는 여기
  // 없다** — 로케이터 프로파일이 아니라 `qrPosition: 'plane'` 이라서다.
  //
  // **의도적 갱신 «v0XQ 드랍» (운영자 실기기 확정 2026-08-17)** — v2r2·v1r2 와 같은
  // 규약으로 허용값에서 뺐다 (조건부 드랍 규칙 «v0WQ > v0XQ» 성립). 상수 자체는
  // `locatorY.js` 에 그대로 살아 있고 `encodeOptionsForY` 의 분기도 남아 있다 —
  // 발행분 재생성 경로다.
  //
  // **의도적 갱신 «v0W2 편입» (운영자 신설 설계 2026-08-17)** — 허용값 맨 뒤에
  // v0W2. 카드도 함께 났다 (아래 `data-locator="cell-surface-v0w2"` 단언).
  //
  // **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드)** —
  // v2r2·v1r2·v0XQ 와 같은 규약으로 허용값에서 뺐다 («파인더 인식 다 해놓고도 잘
  // 못 읽음 + v0 과 혼선 자주»). 그래서 **남은 셀 표면 카드는 전부 v0W 계열**이다.
  // 상수는 `locatorY.js` 에 그대로 살아 있고 `encodeOptionsForY` 의 v0X 분기도
  // 남아 있다 — 발행분 재생성 경로다.
  assert.deepEqual(
    [...GENERATOR_STATE_SCHEMA.locatorProfileY.options],
    [
      LOCATOR_PROFILE_OFF,
      LOCATOR_PROFILE_HEX_FRAME_V1,
      LOCATOR_PROFILE_CELL_SURFACE_V0,
      LOCATOR_PROFILE_CELL_SURFACE_V0W,
      LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
      LOCATOR_PROFILE_CELL_SURFACE_V0W2,
      // **의도적 갱신 «v0WY 편입» (운영자 재설계 2026-08-17)** — 허용값 맨 뒤에 v0WY.
      // 위 «v0W 파생 2종» 문단이 「v0WY 는 여기 없다 — 로케이터 프로파일이 아니라
      // qrPosition: 'plane' 이라서다」 라고 적었던 것은 **허공 마름모 설계**의
      // 서술이고, QR 이 실루엣 안쪽 먼 코너로 들어오면서 뒤집혔다. 지금은 카드도
      // 프로파일도 실재하고, «면» 카드는 그 프로파일로 **전환하는 스위치**다.
      LOCATOR_PROFILE_CELL_SURFACE_V0WY,
    ],
  );
  // 이 단언이 지키는 것은 «허용값 목록에 없다» 는 사실 자체다. 상태 복원기는
  // 현재 존재하지 않는다 — 생기는 날 이 목록이 검증 기준이 된다.
  for (const dropped of [
    LOCATOR_PROFILE_CELL_SURFACE_V2R2, LOCATOR_PROFILE_CELL_SURFACE_V1R2,
    LOCATOR_PROFILE_CELL_SURFACE_V0XQ, LOCATOR_PROFILE_CELL_SURFACE_V0X,
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
  assert.match(INDEX, /data-locator="cell-surface-v0w"/);
  // 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): v0WQ 카드 신설. v0WY 는 **카드가
  // 여기 없다** — QR 위치 카드('plane')로 붙었고, 아래 별도 단언이 그것을 고정한다.
  assert.match(INDEX, /data-locator="cell-surface-v0wq"/);
  // 의도적 갱신 «v0W2 편입» (2026-08-17): v0W2 카드 신설 (부제 g954).
  assert.match(INDEX, /data-locator="cell-surface-v0w2"/);
  // **의도적 갱신 «v0WY 편입» (2026-08-17 재설계)** — 여기 있던 `doesNotMatch` 를
  // **뒤집는다**. 그 부재 단언은 허공 마름모 v0WY 가 «QR 위치일 뿐 레이아웃이
  // 아니다» 를 지키던 자였는데, 재설계로 v0WY 가 진짜 레이아웃이 되면서 그 명제
  // 자체가 거짓이 됐다. 지금 지킬 것은 **카드가 실재하고 «면» 카드와 이어져 있다** 다.
  assert.match(INDEX, /data-locator="cell-surface-v0wy"/);
  assert.match(INDEX, /data-locator="cell-surface-v0wy"[\s\S]{0,900}?data-i18n="g966"/);
  assert.match(INDEX, /data-pos="plane"/);
  // **운영자 제기 (2026-08-17)**: «면» 카드를 v0WY 라는 이름으로 찾다 못 찾았다.
  // 그래서 부제에 병기했다 — 3언어 모두 «v0WY» 문자열을 갖는다 (아래 문구 테스트).
  assert.match(INDEX, /data-pos="plane"[\s\S]{0,600}?data-i18n="g965"/);
  // **의도적 갱신 «드랍 정본화» (2026-08-16)** — v2r2 · v1r2 카드를 내렸다.
  // hex-frame-v1 전례와 같은 «카드만 내림» 이다: 사전 키(g543/g547/g945/g946)는
  // 여덟 언어 모두 남아 있고(아래 문구 테스트가 고정), 와이어·판독은 그대로다.
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v2r2"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v1r2"/);
  // **의도적 갱신 «v0XQ 드랍» (운영자 실기기 확정 2026-08-17, 2라운드)** — 같은 규약이다.
  // 사전 키(g604/g605/g947)는 여덟 언어 모두 남는다 (아래 문구 테스트가 고정).
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v0xq"/);
  // **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 3라운드)** — 또 같은
  // 규약. 사전 키(g602/g603/g944)는 여덟 언어 모두 남는다.
  //   ⚠ 정규식에 닫는 따옴표가 필요하다 — `cell-surface-v0x` 는
  //     `cell-surface-v0xq` 의 접두사라, 없으면 이 단언이 v0xq 행에 걸려 «항상 참»
  //     이 되거나 반대로 «항상 거짓» 이 된다.
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v0x"/);
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

test('로케이터 문구는 8언어가 같고 성능 보장을 하지 않는다', () => {
  // ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): ko/en/ja → 8언어.
  //   드랍된 후보(g543·g547)의 사전 보존을 강제하는 자리라, 새 언어에도 같은 보존이
  //   적용돼야 한다 — 되살릴 때 5언어를 다시 번역하지 않기 위해서다.
  for (const key of ['g515', 'g516', 'g517', 'g518', 'g519', 'g520', 'g541', 'g542', 'g543', 'g544', 'g545', 'g546', 'g547', 'g548']) {
    for (const lang of ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  assert.match(INDEX, /실험용입니다\. 회전·조명·인쇄·라이브 스캔 성능을 보장하지 않아요/);
  assert.match(INDEX, /Does not guarantee rotation, lighting, print, or live-scan performance/);
  assert.match(INDEX, /回転・照明・印刷・ライブスキャンの性能は保証しません/);
  assert.match(INDEX, /data-locator="cell-surface-v0"[\s\S]*?data-i18n="g542">셀 표면 v0 \(Y0\)</);
  // 의도적 갱신 «v0X 드랍» (2026-08-17): 카드가 없어졌으므로 **사전 보존**만 잰다
  // (v1r2/v2r2 전례 — 아래 g543/g547 문자열 단언과 같은 모양).
  assert.match(INDEX, /"g602":\s*"셀 표면 v0X \(Y1\)"/);
  for (const lang of ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
    for (const key of ['g602', 'g603', 'g944']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\s*:'),
        `${lang} 에 드랍 보존 키 ${key} 가 없다`);
    }
  }
  // 의도적 갱신 «v0W2 편입» (2026-08-17) — 신규 키 g610(라벨) · g611(힌트) ·
  // g954(부제) · g965(«면» 카드 부제, v0WY 병기) 는 **3언어 전부** 있어야 한다.
  for (const key of ['g610', 'g611', 'g954', 'g965']) {
    for (const lang of ['ko', 'en', 'ja']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  // **의도적 갱신 «v0WY 편입» (2026-08-17)** — 신규 키 g966(라벨) · g967(부제) ·
  // g968(힌트) 은 **8언어 전부** 있어야 한다 (신규 키의 기본 규약 — 3언어가 아니다).
  // 그리고 g965(«면» 카드 부제)는 값이 «면-평면» → «먼 코너» 로 바뀌었다:
  // 허공 마름모가 사라졌으므로 그 낱말이 남아 있으면 화면이 거짓말을 한다.
  for (const key of ['g966', 'g967', 'g968']) {
    for (const lang of ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  assert.match(INDEX, /"g965":\s*"먼 코너 \(v0WY\)"/);
  assert.doesNotMatch(INDEX, /"g965":\s*"면-평면/);
  assert.match(INDEX, /data-locator="cell-surface-v0w2"[\s\S]*?data-i18n="g610">셀 표면 v0W2 \(Y1\)</);
  // 운영자가 «v0WY» 로 찾을 수 있어야 한다 — 3언어 부제에 그 문자열이 실제로 있다.
  for (const lang of ['ko', 'en', 'ja']) {
    assert.match(langBlock(lang), /"g965":\s*"[^"]*v0WY[^"]*"/, lang + ' 의 g965 에 v0WY 가 없다');
  }
  // **의도적 갱신 «드랍 정본화» (2026-08-16)** — 카드는 내렸지만 **사전 항목은
  // 여덟 언어 모두 남긴다**. 되살릴 때 재번역하지 않기 위해서고, 위 키 순회
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
