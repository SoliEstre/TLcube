/**
 * generator-finder-dom.test.js — 파인더 카드 UI 경로 회귀.
 *
 * 이 환경은 로컬 HTTP 브라우저 권한이 거부됐고 독립 headless Chromium도 renderer
 * 세션을 만들지 못한다. 따라서 표준 addEventListener/dispatchEvent 모양의 최소 DOM
 * 대체로 카드 클릭을 보낸다. 이벤트 바인딩, 상태 전이, 실제 encode → scene → raster →
 * verify 경로는 제품 코드와 같다. 브라우저 가능 환경에서는 이 파일의 같은 시나리오를
 * headless DOM 테스트로 승격해야 한다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encode } from '../src/encode.js';
import {
  daehanPatternId, getDaehanFinderPattern, isDaehanFinderPatternId,
} from '../src/finder-daehan.js';
import { encodeA } from '../src/encodeA.js';
import {
  FINDER_CARD_GROUPS,
  wireFinderCardActivation,
} from '../src/finder-card-ui.js';
import {
  CENTER_QR_FINDER_PATTERN_ID,
  commitFinderQrTransition,
  selectFinderPattern,
  selectGeneratorType,
} from '../src/finder-selection.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  createGeneratorState,
} from '../src/generator-state.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { sceneOptionsForOA } from '../src/generator-render-config.js';
import { rasterize } from '../src/raster.js';
import { renderWithErrorDisplay } from '../src/render-status.js';
import { buildScene, resolveSceneFinderPatternId } from '../src/scene.js';
import { verifyRaster } from '../src/verify.js';

const DEFAULT_FINDER_PATTERN_ID = 'bullseye';
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

class DomCardFallback extends EventTarget {
  constructor(finderId) {
    super();
    this.dataset = { finderId };
  }

  click() {
    return this.dispatchEvent(new Event('click', { cancelable: true }));
  }

  keydown(key) {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: key });
    return this.dispatchEvent(event);
  }
}

class DomRootFallback {
  constructor() {
    this.children = [];
  }

  append(...children) {
    this.children.push(...children);
  }

  querySelectorAll(selector) {
    if (selector !== '[data-finder-id]') {
      throw new Error('이 DOM 대체는 [data-finder-id] 질의만 지원한다');
    }
    return this.children.filter((child) => child.dataset && child.dataset.finderId);
  }
}

function appendFinderCards(root) {
  for (const group of Object.values(FINDER_CARD_GROUPS)) {
    for (const { id } of group) root.append(new DomCardFallback(id));
  }
}
/**
 * 인코더 호출은 **index.html 의 `encodeOptsFor` 와 같은 규칙**이어야 한다.
 * daehan 은 파인더가 불스아이 밖으로 60셀을 더 먹어 회계가 갈리므로 인코더에
 * 알려야 하고, 안 알리면 79셀 파인더가 data 셀 위에 덧칠돼 verifyRaster 가 깨진다
 * (2026-08-19 이 하네스에서 실제로 그렇게 터졌다 — 제품 결함이 아니라 하네스가
 * 제품 규칙을 안 따라간 것이었다). Type A 는 daehanFinder 옵션 자체가 없다.
 */
function encodeFor(type, centerQr, finderPatternId) {
  const options = { eccLevel: 'H', centerQr };
  if (type === 'A') return encodeA('https://example.com/trilume', options);
  if (isDaehanFinderPatternId(finderPatternId)) options.daehanFinder = true;
  return encode('https://example.com/trilume', options);
}

function fallbackFor(state) {
  if (state.qrPosition === 'inner') return { mode: 'center', cornerToo: false };
  if (state.qrPosition === 'none') return { mode: 'off' };
  return { mode: 'corner', corner: state.qrPosition };
}

function makeUiHarness(type) {
  const state = createGeneratorState({ type, finderPatternId: DEFAULT_FINDER_PATTERN_ID });
  const errors = [];
  const errorOutput = {
    value: '',
    get textContent() { return this.value; },
    set textContent(value) {
      this.value = String(value);
      if (this.value) errors.push(this.value);
    },
  };
  let pendingRenderCancelled = 0;
  let renderCount = 0;
  let rendered = null;

  const render = () => renderWithErrorDisplay(errorOutput, () => {
    renderCount += 1;
    const fallback = fallbackFor(state);
    const centerQr = fallback.mode === 'center';
    const encoded = encodeFor(type, centerQr, state.finderPatternId);
    // Type A 는 daehan 을 못 그린다 — index.html renderTypeA 의 가드와 같은 규칙이다
    // (O·A 가 파인더 프로필을 공유해 O 에서 고른 daehan 이 A 로 새어 온다).
    // 그리는 k 도 버전이 정한다 — renderTypeO 의 daehanPatternId 재사상과 같다.
    const finderPatternId = isDaehanFinderPatternId(state.finderPatternId)
      ? (type === 'A' ? DEFAULT_FINDER_PATTERN_ID : daehanPatternId(encoded.k))
      : state.finderPatternId;
    const scene = buildScene(encoded, sceneOptionsForOA({
      fallback,
      finderPatternId,
      palette: PALETTE,
      qrText: 'HTTPS://TLSCAN.ESTRE.SO',
      type,
    }));
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
    const check = verifyRaster(raster, scene, encoded);
    assert.equal(check.ok, true, type + '/' + state.finderPatternId + ' 자체 검증 실패');
    rendered = { encoded, finderPatternId: scene.finderPatternId, scene };
    return '';
  });

  const root = new DomRootFallback();
  appendFinderCards(root);
  const cards = root.querySelectorAll('[data-finder-id]');
  for (const card of cards) {
    wireFinderCardActivation(card, () => {
      commitFinderQrTransition(
        state,
        selectFinderPattern(state, card.dataset.finderId, type, DEFAULT_FINDER_PATTERN_ID),
        type,
        DEFAULT_FINDER_PATTERN_ID,
        {
          cancelPendingRender() { pendingRenderCancelled += 1; },
          render,
        },
      );
    });
  }
  return {
    root, errors,
    get pendingRenderCancelled() { return pendingRenderCancelled; },
    get renderCount() { return renderCount; },
    get rendered() { return rendered; },
    state,
  };
}

test('정식 파인더 카드 행은 불스아이 → 하이브리드 → 3톤 큐브 → 중앙 QR이고 나머지는 동적으로 이어진다', () => {
  const root = new DomRootFallback();
  appendFinderCards(root);
  const ids = root.querySelectorAll('[data-finder-id]').map((card) => card.dataset.finderId);

  // 사용자 지시 2026-08-13: 실사진에서 실제로 읽히는 큐브 선택지가 하이브리드라 두 번째다.
  assert.deepEqual(ids.slice(0, 4), [
    'bullseye',
    'cube-bullseye',
    'central-cube-3tone',
    CENTER_QR_FINDER_PATTERN_ID,
  ]);
  // **의도적 갱신 (2026-08-18, OAK 편입)** — 15 → 18. 정식 4 + 생성 8 + 손그림 3 에
  // O/A/K 후보 3(Nitrogen r2 · Aspirin · Benzene)이 별도 줄로 붙었다. 세 후보는
  // 계보(편집기 export)도 표현(면당 3레벨)도 앞의 것들과 달라서 같은 줄에 안 섞는다
  // — 카드만 보고 계보를 읽을 수 있어야 한다 (finder-oak-patterns.js 헤더).
  // **의도적 갱신 (2026-08-19, daehan 편입)** — 18 → 19. daehan 은 **한 장**이다
  // (k=6/8/10 은 잘림본이고 어느 것을 그릴지는 버전이 정한다). OAK 와도 다른 줄에
  // 두는 이유는 회계다 — 이 후보만 용량을 깎는다 (V3 65 B → 46 B).
  assert.equal(ids.length, 19);
  assert.deepEqual(ids.slice(-4, -1),
    ['oak-nitrogen-r2', 'oak-aspirin', 'oak-benzene'],
    'OAK 카드가 daehan 앞 세 자리가 아니다');
  assert.equal(ids.at(-1), 'oak-daehan-k10', 'daehan 카드가 맨 뒤가 아니다');
  assert.equal(new Set(ids).size, ids.length);
});

test('장면 기본 파인더도 중앙 QR일 때는 실험판 기본값으로 새지 않는다', () => {
  assert.equal(
    resolveSceneFinderPatternId(undefined, true, 'pinwheel-c2-2-1100-cw'),
    CENTER_QR_FINDER_PATTERN_ID,
  );
});

test('중앙 QR 렌더 옵션은 실험 기본 파인더를 중앙 QR로 명시 치환한다', () => {
  const options = sceneOptionsForOA({
    fallback: { mode: 'center', cornerToo: false },
    finderPatternId: 'pinwheel-c2-2-1100-cw',
    palette: PALETTE,
    qrText: 'HTTPS://TLSCAN.ESTRE.SO',
    type: 'O',
  });

  assert.equal(options.centerQr, true);
  assert.equal(options.finderPatternId, CENTER_QR_FINDER_PATTERN_ID);
  assert.equal(options.qrText, 'HTTPS://TLSCAN.ESTRE.SO');
});

test('배치 불변 — O·A 캔버스는 QR 배치(코너/안쪽/없음)와 무관하게 동일하다', () => {
  /*
   * 운영자 2026-08-23 (PM/022 W1-b): 코너 QR 이 안 그려지는 경로에서 margin 이
   * 라이브러리 기본(2)으로 떨어지면 Type O V1 scene 이 62.517×60 → 26.517×24 로
   * 줄어 미리보기 코드가 2.4~2.5배 «확대» 돼 보였다 — QR 배치 간 스캔 성능·미리보기
   * 비교가 불가능했다. sceneOptionsForOA 의 배치 불변 정책(!needsCornerQr → margin 20)
   * 이 그 구제이고, 이 테스트는 O 전용 결함이 재발하지 않도록 O·A 둘 다 잠근다.
   */
  const FALLBACKS = [
    { label: 'corner', fallback: { mode: 'corner', corner: 'TL' } },
    { label: 'center', fallback: { mode: 'center', cornerToo: false } },
    { label: 'off', fallback: { mode: 'off' } },
  ];
  for (const type of ['O', 'A']) {
    const sizes = FALLBACKS.map(({ label, fallback }) => {
      const encoded = encodeFor(type, fallback.mode === 'center');
      const scene = buildScene(encoded, sceneOptionsForOA({
        fallback,
        finderPatternId: GENERATOR_DEFAULT_FINDER_PATTERN_ID,
        palette: PALETTE,
        qrText: 'HTTPS://TLSCAN.ESTRE.SO',
        type,
      }));
      return { label, width: scene.width, height: scene.height };
    });
    for (const size of sizes.slice(1)) {
      assert.equal(size.width, sizes[0].width,
        `${type} ${size.label} 폭이 corner 와 다르다 (${size.width} vs ${sizes[0].width})`);
      assert.equal(size.height, sizes[0].height,
        `${type} ${size.label} 높이가 corner 와 다르다`);
    }
  }
});

test('초기 Y에서 O/A로 전환하면 중앙 QR 포맷과 장면을 실제 기본 경로로 렌더한다', () => {
  for (const type of ['O', 'A']) {
    const state = selectGeneratorType(
      createGeneratorState(), type, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    );
    const fallback = fallbackFor(state);
    const encoded = encodeFor(type, fallback.mode === 'center');
    const scene = buildScene(encoded, sceneOptionsForOA({
      fallback,
      finderPatternId: state.finderPatternId,
      palette: PALETTE,
      qrText: 'HTTPS://TLSCAN.ESTRE.SO',
      type,
    }));

    assert.equal(state.qrPosition, 'inner', type);
    assert.equal(encoded.centerQr, true, type);
    assert.equal(scene.finderPatternId, 'centerQr', type);
    assert.equal(verifyRaster(
      rasterize(scene, { pixelsPerUnit: 12, supersample: 2 }), scene, encoded,
    ).ok, true, type);
  }
});

test('DOM 이벤트 대체: Type O/A의 실제 카드 목록 전체와 무대기 연속 클릭은 오류 없이 렌더한다', () => {
  for (const type of ['O', 'A']) {
    const harness = makeUiHarness(type);
    const cards = harness.root.querySelectorAll('[data-finder-id]');
    const ids = cards.map((card) => card.dataset.finderId);
    assert.ok(ids.length > 0, type + ': 카드가 없다');

    for (const card of cards) {
      card.click();
      assert.equal(
        harness.errors.length,
        0,
        type + '/' + card.dataset.finderId + ': 렌더 오류: ' + harness.errors.join(' | '),
      );
      assert.equal(harness.state.finderPatternId, card.dataset.finderId);
      assert.ok(harness.rendered && harness.rendered.scene.shapes.length > 0);
      if (card.dataset.finderId === CENTER_QR_FINDER_PATTERN_ID) {
        assert.equal(harness.state.qrPosition, 'inner');
        assert.equal(harness.rendered.finderPatternId, 'centerQr');
      }
      // «카드가 있다» 가 아니라 «누르면 인코딩이 바뀐다» 를 잰다 (2026-08-19 브리프 §4).
      // daehan 은 파인더가 60셀을 더 먹어 **용량이 준다** — 그게 이 카드의 실제 효과다.
      if (isDaehanFinderPatternId(card.dataset.finderId)) {
        if (type === 'O') {
          assert.equal(harness.rendered.encoded.daehanFinder, true,
            'daehan 카드를 눌렀는데 인코더가 daehan 회계로 안 갔다');
          assert.equal(harness.rendered.finderPatternId,
            daehanPatternId(harness.rendered.encoded.k),
            '그려진 템플릿 id 가 버전이 정한 k 와 안 맞는다');
          // ⚠ **같은 버전끼리** 비교해야 한다. 자동 버전 선택이 daehan 에서 한 단
          //   올라가므로(V2→V3) auto 끼리 재면 31 vs 32 로 «늘었다» 는 엉뚱한 답이
          //   나온다 — 대상이 아니라 자가 틀린 것이다 (실측 2026-08-19).
          const sameVersionLegacy = encode('https://example.com/trilume', {
            eccLevel: 'H', centerQr: false, version: harness.rendered.encoded.version,
          }).capacity.maxPayloadBytes;
          assert.ok(harness.rendered.encoded.capacity.maxPayloadBytes < sameVersionLegacy,
            `daehan 을 눌렀는데 같은 버전 용량이 안 줄었다 (`
            + `${harness.rendered.encoded.capacity.maxPayloadBytes} vs ${sameVersionLegacy} B)`
            + ' — 표시가 legacy 회계를 말하고 있다');
        } else {
          // Type A 는 daehan 을 못 그린다 — 조용히 legacy 회계 위에 덧칠하면 안 된다.
          assert.notEqual(harness.rendered.finderPatternId, card.dataset.finderId,
            'Type A 가 daehan 을 그대로 그렸다 — encodeA 에 daehanFinder 가 없다');
        }
      }
      if (card.dataset.finderId === 'central-cube-3tone') {
        assert.equal(harness.rendered.finderPatternId, 'central-cube-3tone');
        assert.equal(
          harness.rendered.scene.shapes.filter((shape) => shape.kind === 'disc').length,
          1,
          type + '/central-cube-3tone: 3톤 큐브 중심 표식이 렌더돼야 한다',
        );
      }
    }

    // 사람보다 빠른 통합 순회와 같은 조건: DOM에서 읽은 카드 모두를 대기 없이 누른다.
    for (const card of cards) card.click();
    assert.equal(harness.errors.length, 0, type + ': 빠른 연속 클릭 렌더 오류');
    assert.equal(harness.pendingRenderCancelled, cards.length * 2);
    assert.equal(harness.renderCount, cards.length * 2, type + ': 카드 전환마다 렌더는 정확히 한 번이어야 한다');
  }
});

/**
 * 점수 패널이 **모든 카드 id 를 감당하는가** (2026-08-18, OAK 편입 때 실제로 터짐).
 *
 * 왜 생겼나 — OAK 카드를 붙였더니 카드 수·순서 회귀는 전부 초록인데 브라우저에서
 * 카드를 **고르는 순간** `finder score record missing: oak-aspirin` 으로
 * `renderFinderUi` 가 중간에 죽었다. 카드 class 만 바뀌고 점수 패널은 이전 선택에
 * 멈춰 있어서, 남의 «실측 복호율 89%» 가 OAK 카드 밑에 붙어 있었다.
 *
 * 회귀가 **카드 수만 세고 선택 동작을 안 재고 있었다.** 이 검사는 그 구멍을 막는다:
 * 카드로 나오는 모든 id 는 ⓐ 점수 레코드가 있거나 ⓑ 미측정 분기가 받아야 한다.
 * index.html 의 실제 분기 조건과 **같은 술어**(getOakFinderPattern ‖ getDaehanFinderPattern)로 잰다 —
 * 다른 술어로 재면 이 검사가 초록인 채로 UI 만 다시 죽는다.
 */
test('모든 파인더 카드 id 는 점수 레코드가 있거나 미측정 분기가 받는다', async () => {
  const { FINDER_BASELINE_SCORES, FINDER_PATTERNS } = await import('../src/finder-patterns.js');
  const { getOakFinderPattern } = await import('../src/finder-oak-patterns.js');
  const scored = new Set([
    ...FINDER_PATTERNS.map((pattern) => pattern.id),
    ...Object.keys(FINDER_BASELINE_SCORES),
  ]);
  const ids = Object.values(FINDER_CARD_GROUPS).flat().map((card) => card.id);
  assert.ok(ids.length >= 18, '카드가 18개 미만이다 — 그룹이 비었는지 보라');
  // ⚠ 술어를 **index.html 의 실제 분기와 같은 모양**으로 쓴다. 2026-08-19 에 여기서
  //   한 번 걸렸다: `isOakFinderPatternId('oak-daehan-k10')` 은 **false** 다 —
  //   OAK_BY_ID 가 세 id 만 든 Map 이라 `oak-` 접두사는 계보를 말해 주지 않는다.
  //   index.html 은 `getOakFinderPattern(id) || getDaehanFinderPattern(id)` 로 받는다.
  const unmeasured = (id) => Boolean(getOakFinderPattern(id) || getDaehanFinderPattern(id));
  const orphans = ids.filter((id) => !scored.has(id) && !unmeasured(id));
  assert.deepEqual(orphans, [],
    '점수 레코드도 없고 미측정 분기도 안 받는 카드: ' + JSON.stringify(orphans)
    + ' — 고르는 순간 renderFinderUi 가 throw 한다');
  // 반대 방향도 잠근다: 미측정으로 처리되는 카드가 **점수를 갖고 있으면** 안 된다.
  // 있는데 안 보여주면 그건 숨기는 것이지 «미측정» 이 아니다.
  for (const id of ids.filter(unmeasured)) {
    assert.equal(scored.has(id), false,
      id + ' 는 점수가 있는데 미측정으로 표시된다 — 라벨이 사실이 아니다');
  }
});
