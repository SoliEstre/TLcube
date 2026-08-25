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
  LOCATOR_PROFILE_CELL_SURFACE_V0T,
  LOCATOR_PROFILE_CELL_SURFACE_V0TY,
  LOCATOR_PROFILE_CELL_SURFACE_V0TR,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
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
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
  // v0T 가 Type Y 최종 파인더로 확정되면서 허용값이 v0 · v0T · v0TY 로 바뀌었다.
  // v0W 계열 넷은 v2r2·v1r2·v0XQ·v0X 와 같은 규약으로 허용값에서 빠졌다 (상수는
  // `locatorY.js` 에, `encodeOptionsForY` 분기는 그대로 — 발행분 재생성 경로).
  // «면» 카드는 이제 v0TY 로 전환한다 (v0WY 시절과 같은 문법).
  assert.deepEqual(
    [...GENERATOR_STATE_SCHEMA.locatorProfileY.options],
    [
      LOCATOR_PROFILE_OFF,
      LOCATOR_PROFILE_HEX_FRAME_V1,
      LOCATOR_PROFILE_CELL_SURFACE_V0,
      LOCATOR_PROFILE_CELL_SURFACE_V0T,
      LOCATOR_PROFILE_CELL_SURFACE_V0TY,
      LOCATOR_PROFILE_CELL_SURFACE_V0TR,
      LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
      // **의도적 갱신 «v0TRY 편입» (2026-08-18)** — 허용값 맨 뒤에 v0TRY. 카드도
      // 함께 났다 (아래 `data-locator="cell-surface-v0try"` 단언). 드랍은 0 이다.
      LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
    ],
  );
  // 이 단언이 지키는 것은 «허용값 목록에 없다» 는 사실 자체다. 상태 복원기는
  // 현재 존재하지 않는다 — 생기는 날 이 목록이 검증 기준이 된다.
  for (const dropped of [
    LOCATOR_PROFILE_CELL_SURFACE_V2R2, LOCATOR_PROFILE_CELL_SURFACE_V1R2,
    LOCATOR_PROFILE_CELL_SURFACE_V0XQ, LOCATOR_PROFILE_CELL_SURFACE_V0X,
    LOCATOR_PROFILE_CELL_SURFACE_V0W, LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
    LOCATOR_PROFILE_CELL_SURFACE_V0W2, LOCATOR_PROFILE_CELL_SURFACE_V0WY,
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
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
  // v0W 계열 카드 넷(v0w·v0wq·v0w2·v0wy)이 내려가고 v0T 카드가 섰다.
  // 카드 부재는 정확한 닫는 따옴표까지 재서 형제 id 오검을 막는다.
  assert.match(INDEX, /data-locator="cell-surface-v0t"/);
  assert.match(INDEX, /data-locator="cell-surface-v0t"[\s\S]{0,1200}?data-i18n="g993"/);
  // **의도적 갱신 (2026-08-25, 운영자 지시)** — W2 C3 의 «파생값 강등» 을 **철회**하고
  // v0TY 카드를 되살렸다 («코너측일 땐 v0TY랑 v0TRY이 표시 되어야 돼»). 표시 범위는
  // generator-locator-options 의 허용 목록이 «안쪽 + 코너측» 으로 좁힌다.
  // ⚠ 구 핸들러의 역방향 강제(qrPosition = 'plane')는 되살리지 **않았다** — 'plane' 은
  //   (안쪽 × 면배치) 분해로 사라진 값이고, 그 양방향 쌍이 C3 가 없애려던 위험이었다.
  assert.match(INDEX, /data-locator="cell-surface-v0ty"/);
  assert.match(INDEX, /data-locator="cell-surface-v0ty"[\s\S]{0,1200}?data-i18n="g996"/);
  // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — 카드 둘이 더 섬 (v0T 계열은
  // 그대로 있다 — 드랩 없는 편입). i18n 키는 사전의 빈 슬롯을 썼다 (g955·g958) —
  // 4자리 키를 만들면 i18n-coverage 의 3자리 파서가 그 키를 조용히 놓친다.
  assert.match(INDEX, /data-locator="cell-surface-v0tr"/);
  assert.match(INDEX, /data-locator="cell-surface-v0trq"/);
  assert.match(INDEX, /data-locator="cell-surface-v0tr"[\s\S]{0,1200}?data-i18n="g955"/);
  assert.match(INDEX, /data-locator="cell-surface-v0trq"[\s\S]{0,1200}?data-i18n="g958"/);
  // **의도적 갱신 (2026-08-25)** — v0TRY 도 v0TY 와 같은 규약으로 되살렸다.
  assert.match(INDEX, /data-locator="cell-surface-v0try"/);
  assert.match(INDEX, /data-locator="cell-surface-v0try"[\s\S]{0,1200}?data-i18n="g936"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v0w"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v0wq"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v0w2"/);
  assert.doesNotMatch(INDEX, /data-locator="cell-surface-v0wy"/);
  // **의도적 갱신 (W2 C3)** — «면»(plane) QR 위치 카드는 삭제됐다. 그 축은
  // «QR 면 배치» 서브섹션(중앙측 seam / 코너측 far)으로 분해됐고, 레이아웃 병기
  // 관례(운영자 제기 2026-08-17)는 서브섹션 부제(g862 v0TRQ · g864 v0TRY)가 잇는다.
  assert.doesNotMatch(INDEX, /data-pos="plane"/);
  assert.match(INDEX, /id="qrFacePlacementSection"/);
  assert.match(INDEX, /data-placement="seam"[\s\S]{0,600}?data-i18n="g862"/);
  assert.match(INDEX, /data-placement="far"[\s\S]{0,600}?data-i18n="g864"/);
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
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
  // 신규 키 g993(v0T 라벨) · g994(힌트) · g995(부제) · g996(v0TY 라벨) · g997(힌트) ·
  // g998(부제) 는 **8언어 전부** 있어야 한다. g965(«면» 부제)의 병기는 v0WY → v0TY
  // 로 바뀌었다 (전환 대상이 바뀌었으므로 — 옛 병기가 남으면 화면이 거짓말을 한다).
  // v0W 계열 카드 키(g606~g611 · g948·g949·g954 · g966~g968)는 사전에 **보존**된다
  // (v1r2·v2r2·v0X·v0XQ 전례 — 위 g966~g968 순회가 그 보존을 이미 강제한다).
  for (const key of ['g993', 'g994', 'g995', 'g996', 'g997', 'g998']) {
    for (const lang of ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  assert.match(INDEX, /"g965":\s*"먼 코너 \(v0TY\)"/);
  assert.doesNotMatch(INDEX, /"g965":\s*"면-평면/);
  assert.doesNotMatch(INDEX, /"g965":\s*"[^"]*v0WY/);
  // 드랍 보존 — v0W2 카드는 내려갔지만 사전 문자열은 남는다 (재번역 방지).
  assert.match(INDEX, /"g610":\s*"셀 표면 v0W2 \(Y1\)"/);
  // v0T 카드가 실제로 사전 라벨을 쓴다.
  assert.match(INDEX, /data-locator="cell-surface-v0t"[\s\S]*?data-i18n="g993">셀 표면 v0T \(Y1\)</);
  // 운영자가 «v0TY» 로 찾을 수 있어야 한다 — 부제에 그 문자열이 실제로 있다.
  for (const lang of ['ko', 'en', 'ja']) {
    assert.match(langBlock(lang), /"g965":\s*"[^"]*v0TY[^"]*"/, lang + ' 의 g965 에 v0TY 가 없다');
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
