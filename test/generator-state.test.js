import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';


import { commitFinderQrTransition } from '../src/finder-selection.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  GENERATOR_STATE_SCHEMA, createGeneratorState, exposedGeneratorStateKeys,
  resolutionTierForVersion, transitionGeneratorMode, versionForResolutionTier,
} from '../src/generator-state.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX_SOURCE = readFileSync(ROOT + 'index.html', 'utf8');

function sectionStateKeys(id) {
  const match = new RegExp(
    '<div id="' + id + '"[^>]*data-state-keys="([^"]+)"',
  ).exec(INDEX_SOURCE);
  assert.ok(match, id + '의 data-state-keys를 못 찾았다');
  return match[1].trim().split(/\s+/);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

test('일반 노출 선택은 전부 고급에도 있고 실제 패널 메타데이터가 스키마와 같다', () => {
  const shared = [
    ...sectionStateKeys('sharedContent'),
    ...sectionStateKeys('sharedControls'),
  ];
  const normal = sortedUnique([...shared, ...sectionStateKeys('panelNormal')]);
  const advanced = sortedUnique([...shared, ...sectionStateKeys('panelAdvanced')]);
  const expectedNormal = sortedUnique(exposedGeneratorStateKeys('normal'));
  const expectedAdvanced = sortedUnique(exposedGeneratorStateKeys('advanced'));

  assert.deepEqual(normal, expectedNormal);
  assert.deepEqual(advanced, expectedAdvanced);
  for (const key of normal) assert.ok(advanced.includes(key), key + '가 고급 모드에서 누락됨');

  const sharedStart = INDEX_SOURCE.indexOf('<div id="sharedControls"');
  const sharedEnd = INDEX_SOURCE.indexOf('<!-- ══════════════════════ 공통', sharedStart);
  const sharedSource = INDEX_SOURCE.slice(sharedStart, sharedEnd);
  assert.match(sharedSource, /id="finderSection"/);
  assert.match(sharedSource, /id="finderScorePanel"/);
});

test('일반 티어와 고급 정확 버전은 모든 타입에서 같은 canonical 값으로 왕복한다', () => {
  for (const type of ['O', 'A', 'Y']) {
    for (const tier of ['auto', 'low', 'mid', 'high']) {
      const version = versionForResolutionTier(type, tier);
      assert.equal(resolutionTierForVersion(type, version), tier, type + ' ' + tier);
    }
  }
  assert.match(INDEX_SOURCE,
    /<select id="versionY">\s*<option value="auto" selected[^>]*>[^<]+<\/option>/);
  assert.match(INDEX_SOURCE,
    /<select id="versionA">\s*<option value="auto" selected[^>]*>[^<]+<\/option>/);
});

test('모드·타입 혼합 왕복이 모든 상태 키를 항목별로 보존한다', () => {
  const state = createGeneratorState();

  // 키 목록을 손으로 적지 않는다. 스키마의 각 선택지에서 기본값과 다른 값을 골라
  // 다음 필드가 추가되어도 같은 테스트가 자동으로 그 필드를 왕복시킨다.
  /*
   * ⚠ `qrPosition: 'inner'` 는 독립 축이 아니다 — Type O/A 에서 **중앙 QR 파인더를
   *   강제**하므로 finderPatternId 와 짝지어 움직인다. 그 둘을 각각 «기본값과 다른 첫
   *   선택지» 로 잡으면 모순된 조합이 만들어지고, 전환이 그걸 옳게 해소한 결과를
   *   «왕복이 깨졌다» 로 읽게 된다. (기본 파인더가 불스아이일 땐 대안이 마침
   *   center-qr 이라 이 결함이 우연히 가려져 있었다 — 2026-08-13 기본값 변경에서 드러남.)
   */
  const coupledToFinder = new Set(['inner']);
  for (const key of Object.keys(state)) {
    const descriptor = GENERATOR_STATE_SCHEMA[key];
    const alternative = descriptor.options.find(
      (candidate) => !Object.is(candidate, state[key])
        && !(key === 'qrPosition' && coupledToFinder.has(candidate)),
    );
    assert.notEqual(alternative, undefined, key + '에 기본값과 다른 테스트 선택지가 필요함');
    state[key] = alternative;
  }
  assert.equal(state.type, 'O');
  const before = structuredClone(state);

  let mode = 'normal';
  mode = transitionGeneratorMode('advanced');
  commitFinderQrTransition(
    state, { ...state, type: 'Y' }, 'Y', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    { cancelPendingRender() {}, render() {} },
  );
  commitFinderQrTransition(
    state, { ...state, type: 'O' }, 'O', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    { cancelPendingRender() {}, render() {} },
  );
  mode = transitionGeneratorMode('normal');

  assert.equal(mode, 'normal');
  for (const key of Object.keys(state)) {
    assert.deepEqual(state[key], before[key], key + '가 일반→고급→Y→O→일반에서 변함');
  }
});

test('buildConfig은 모드나 고급 DOM이 아니라 단일 generatorState만 소비한다', () => {
  const start = INDEX_SOURCE.indexOf('function buildConfig()');
  const end = INDEX_SOURCE.indexOf('// ── 렌더', start);
  assert.ok(start >= 0 && end > start);
  const source = INDEX_SOURCE.slice(start, end);
  // ⚠ «UI 모드» 식별자만 잡는다. `.mode` 는 fallback.mode 처럼 전혀 다른 것이고,
  //   느슨하게 쓰면 (실제로 그랬다) 정상 코드를 결함으로 신고한다.
  assert.doesNotMatch(source, /(?<![.\w])mode\s*(?:===|!==)/);
  assert.doesNotMatch(source, /if\s*\(\s*(?<![.\w])mode\b/);
  assert.doesNotMatch(source,
    /els\.(codeType|versionO|versionY|versionA|ecc|preset|tone|faceGain|qrUrl|qrCornerToo)/);
  // **의도적 갱신 (2026-08-25)** — 구 락은 buildConfig 본문에 `generatorState.versionY`
  // 리터럴이 있는지 봤다. Y2(n=25) 편입으로 «자동이 고른 버전» 을 인코더까지 옮겨야 해서
  // 그 읽기가 `effectiveVersionYForEncode()` 로 이름을 얻었고 리터럴이 사라졌다.
  // 이 락이 지키려던 것은 **리터럴이 아니라 출처**(DOM 이 아니라 상태)이므로 락을
  // 헬퍼까지 따라가게 옮긴다 — 헬퍼가 els.* 를 읽으면 여기서 빨개진다.
  assert.match(source, /generatorState\.versionY|effectiveVersionYForEncode\(\)/);
  if (!/generatorState\.versionY/.test(source)) {
    const hStart = INDEX_SOURCE.indexOf('function effectiveVersionYForEncode()');
    assert.ok(hStart >= 0, 'buildConfig 이 헬퍼로 versionY 를 내는데 그 헬퍼가 없다');
    const hSource = INDEX_SOURCE.slice(hStart, INDEX_SOURCE.indexOf('\n}', hStart));
    assert.match(hSource, /generatorState\.versionY/, '헬퍼가 상태를 안 읽는다');
    assert.doesNotMatch(hSource, /els\./, '헬퍼가 DOM 을 읽는다 — 락이 우회됐다');
  }
  assert.match(source, /fallback\.mode === 'window'[\s\S]*\? 2/);
});


test('Type Y 톤은 일반·고급 카드가 같은 단일 상태를 쓰고 기본값은 3톤이다', () => {
  const state = createGeneratorState();
  assert.equal(state.tone, 3);
  assert.ok(exposedGeneratorStateKeys('normal').includes('tone'));
  assert.ok(exposedGeneratorStateKeys('advanced').includes('tone'));
  assert.match(INDEX_SOURCE, /id="toneCardsNormal"[\s\S]*data-tone="2"[\s\S]*data-tone="3"/);
  assert.match(INDEX_SOURCE, /id="toneCardsAdvanced"[\s\S]*data-tone="2"[\s\S]*data-tone="3"/);
  assert.match(INDEX_SOURCE,
    /const generatorState = createGeneratorState\(\);\s*const nextExportFilename = createExportFilenameFactory\(\);/);
});
