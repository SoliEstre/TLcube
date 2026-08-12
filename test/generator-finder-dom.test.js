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
import { encodeA } from '../src/encodeA.js';
import {
  FINDER_CARD_GROUPS,
  wireFinderCardActivation,
} from '../src/finder-card-ui.js';
import {
  CENTER_QR_FINDER_PATTERN_ID,
  commitFinderQrTransition,
  selectFinderPattern,
} from '../src/finder-selection.js';
import { createGeneratorState } from '../src/generator-state.js';
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
function encodeFor(type, centerQr) {
  const options = { eccLevel: 'H', centerQr };
  return type === 'A'
    ? encodeA('https://example.com/trilume', options)
    : encode('https://example.com/trilume', options);
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
    const encoded = encodeFor(type, centerQr);
    const scene = buildScene(encoded, sceneOptionsForOA({
      fallback,
      finderPatternId: state.finderPatternId,
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

test('정식 파인더 카드 행은 불스아이 → 3톤 큐브 → 중앙 QR이고 나머지는 동적으로 이어진다', () => {
  const root = new DomRootFallback();
  appendFinderCards(root);
  const ids = root.querySelectorAll('[data-finder-id]').map((card) => card.dataset.finderId);

  assert.deepEqual(ids.slice(0, 3), [
    'bullseye',
    'central-cube-3tone',
    CENTER_QR_FINDER_PATTERN_ID,
  ]);
  assert.equal(ids.length, 14);
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
