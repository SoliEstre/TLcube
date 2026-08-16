/**
 * help-popover-behavior.test.js — «?» 도움말 팝오버의 **열림/닫힘 계약**을 실제 모듈로
 * 구동해서 고정한다 (문자열 매칭이 아니라 동작).
 *
 * 왜 필요한가: 2026-08-16 적대 검증이 «ESC 로 닫힌다» 를 반증했다. 소스를 읽으면 ESC
 * 핸들러가 `close()` 를 부르니 닫히는 것처럼 보이는데, 바로 뒤 `focusTarget.focus()`
 * 가 `focus` 리스너를 타고 **방금 닫은 창을 다시 열었다**. 클릭-고정 경로는 버튼에
 * 이미 포커스가 있어 `focus()` 가 no-op 이라 우연히 통과했고, hover 경로만 깨졌다 —
 * 즉 «코드를 읽어서» 는 안 잡히고 «두 경로를 각각 굴려서» 만 잡히는 결함이었다.
 *
 * 그래서 여기서는 스텁 DOM 으로 컨트롤러를 실제로 돌린다. 스텁이 브라우저와 맞춰야
 * 하는 지점은 둘뿐이다:
 *   ① `focus()` 는 **이미 포커스인 요소에는 이벤트를 안 낸다** (그래서 case B 가 통과했다)
 *   ② `document.activeElement` 가 포커스를 따라간다 (복귀 여부 판단의 입력)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHelpPopover } from '../src/help-popover.js';

// ── 스텁 DOM ──────────────────────────────────────────────────────────────

function makeDom() {
  const doc = {
    activeElement: null,
    listeners: {},
    addEventListener(type, fn) { (doc.listeners[type] ||= []).push(fn); },
    dispatch(type, ev = {}) { for (const fn of doc.listeners[type] || []) fn(ev); },
    createElement: (tag) => makeEl(tag),
  };

  function makeEl(tag) {
    const el = {
      tagName: tag,
      attrs: {}, dataset: {}, style: {}, classes: new Set(),
      hidden: false, id: '', className: '',
      children: [], parent: null,
      offsetWidth: 200, offsetHeight: 100,
      listeners: {},
      classList: {
        add: (c) => el.classes.add(c),
        remove: (c) => el.classes.delete(c),
        toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)),
        contains: (c) => el.classes.has(c),
      },
      setAttribute(k, v) { el.attrs[k] = v; },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null;
      },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      dispatch(type, ev = {}) { for (const fn of el.listeners[type] || []) fn(ev); },
      appendChild(child) { child.parent = el; el.children.push(child); return child; },
      contains(node) {
        for (let n = node; n; n = n.parent) if (n === el) return true;
        return false;
      },
      getBoundingClientRect: () => ({
        left: 100, top: 100, width: 16, height: 16, bottom: 116,
      }),
      // 브라우저와 같은 규칙 — 이미 포커스면 이벤트가 안 난다.
      focus() {
        if (doc.activeElement === el) return;
        const prev = doc.activeElement;
        doc.activeElement = el;
        if (prev) prev.dispatch('blur');
        el.dispatch('focus');
      },
    };
    // 브라우저와 같은 규칙 — textContent 대입은 자식 노드를 전부 지운다.
    // (paint() 가 `body.textContent = ''` 로 이전 줄을 비우는 데 의존한다.)
    let text = '';
    Object.defineProperty(el, 'textContent', {
      get: () => text,
      set: (value) => {
        text = String(value);
        for (const child of el.children) child.parent = null;
        el.children = [];
      },
      enumerable: true,
    });
    return el;
  }

  return { doc, makeEl };
}

const CLICK = Object.freeze({ preventDefault() {}, stopPropagation() {} });

function setup({ hoverCapable = true } = {}) {
  const { doc, makeEl } = makeDom();
  const popover = makeEl('div');
  popover.hidden = true;                 // 정적 마크업의 `hidden` 과 같은 초기 상태
  const body = makeEl('div');
  const closeButton = makeEl('button');
  popover.appendChild(closeButton);
  popover.appendChild(body);

  const button = makeEl('button');
  button.dataset.help = 'g900';
  const other = makeEl('button');
  other.dataset.help = 'g901';

  const view = {
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: () => ({ matches: hoverCapable }),
    addEventListener() {},
  };

  const control = createHelpPopover({
    popover, body, closeButton, doc, view,
    linesFor: (btn) => [`본문 ${btn.dataset.help} 첫 줄`, '둘째 줄'],
    hoverCapable: () => hoverCapable,
  });
  control.attach(button);
  control.attach(other);
  return { doc, popover, body, closeButton, button, other, control };
}

/** 계약상 «닫힘» 의 정의 — 셋이 같이 참이어야 닫힌 것이다. */
function assertClosed(ctx, label) {
  assert.equal(ctx.popover.hidden, true, `${label}: 팝오버가 안 숨었다`);
  assert.equal(ctx.button.getAttribute('aria-expanded'), 'false', `${label}: aria-expanded 가 true 로 남았다`);
  assert.equal(ctx.control.isOpen(), false, `${label}: 컨트롤러가 아직 열림이라고 말한다`);
}

// ── ESC 계약 ──────────────────────────────────────────────────────────────

// 회귀 (적대 검증 case A, 2026-08-16): hover 로 열린 창은 앵커에 포커스가 없다.
// 닫은 뒤 무조건 `focus()` 를 부르면 focus 리스너가 그 창을 곧바로 다시 열었다.
test('hover 로 연 창도 ESC 로 닫힌다 (닫자마자 다시 열리지 않는다)', () => {
  const ctx = setup();
  ctx.button.dispatch('mouseenter');
  assert.equal(ctx.popover.hidden, false, '전제: hover 로 열려 있어야 한다');
  assert.equal(ctx.doc.activeElement, null, '전제: hover 경로는 포커스를 안 준다');

  ctx.doc.dispatch('keydown', { key: 'Escape' });

  assertClosed(ctx, 'hover + ESC');
  assert.equal(ctx.button.getAttribute('aria-describedby'), null);
});

test('hover 경로의 ESC 는 포커스를 훔치지 않는다', () => {
  const ctx = setup();
  const elsewhere = ctx.doc.createElement('input');
  elsewhere.focus();
  ctx.button.dispatch('mouseenter');

  ctx.doc.dispatch('keydown', { key: 'Escape' });

  assertClosed(ctx, 'hover + ESC (포커스 타처)');
  assert.equal(ctx.doc.activeElement, elsewhere, 'ESC 가 남의 포커스를 앵커로 끌어갔다');
});

test('클릭으로 고정한 창은 ESC 로 닫히고 포커스가 앵커로 돌아온다', () => {
  const ctx = setup();
  ctx.button.focus();                    // 브라우저는 클릭 전에 버튼을 포커스한다
  ctx.button.dispatch('click', CLICK);
  assert.equal(ctx.control.isPinned(), true, '전제: 클릭은 고정이다');

  ctx.doc.dispatch('keydown', { key: 'Escape' });

  assertClosed(ctx, '고정 + ESC');
  assert.equal(ctx.doc.activeElement, ctx.button, '포커스가 앵커로 안 돌아왔다');
});

test('키보드 포커스로 연 창도 ESC 뒤 다시 열리지 않는다', () => {
  const ctx = setup();
  ctx.button.focus();                    // Tab 이동 = focus 리스너가 임시로 연다
  assert.equal(ctx.popover.hidden, false, '전제: 포커스로 열려야 한다');

  ctx.doc.dispatch('keydown', { key: 'Escape' });

  assertClosed(ctx, '포커스 + ESC');
  assert.equal(ctx.doc.activeElement, ctx.button, '포커스는 버튼에 남아야 한다');
});

test('ESC 가 아닌 키는 닫지 않는다', () => {
  const ctx = setup();
  ctx.button.dispatch('mouseenter');
  ctx.doc.dispatch('keydown', { key: 'Enter' });
  assert.equal(ctx.popover.hidden, false);
  assert.equal(ctx.control.isOpen(), true);
});

// ── X 버튼 키보드 도달성 ──────────────────────────────────────────────────

test('고정하면 포커스가 팝오버 안 X 로 옮겨 간다 (키보드로 닫을 수 있다)', () => {
  const ctx = setup();
  ctx.button.focus();
  ctx.button.dispatch('click', CLICK);

  assert.equal(ctx.closeButton.hidden, false, '고정 상태에서 X 가 보여야 한다');
  assert.equal(ctx.doc.activeElement, ctx.closeButton,
    'X 로 포커스가 안 가면 키보드에서 도달할 방법이 없다');
  assert.equal(ctx.control.isOpen(), true, '포커스 이동이 창을 닫아 버리면 안 된다');
});

test('임시(hover) 상태에서는 포커스를 옮기지 않는다', () => {
  const ctx = setup();
  ctx.button.dispatch('mouseenter');
  assert.equal(ctx.doc.activeElement, null, 'hover 마다 포커스가 튀면 안 된다');
  assert.equal(ctx.closeButton.hidden, true, '임시 상태에는 X 가 없다');
});

test('X 를 누르면 닫히고 포커스가 앵커로 돌아온다', () => {
  const ctx = setup();
  ctx.button.focus();
  ctx.button.dispatch('click', CLICK);

  ctx.closeButton.dispatch('click', CLICK);

  assertClosed(ctx, 'X 닫기');
  assert.equal(ctx.doc.activeElement, ctx.button, '포커스가 사라진 X 에 남았다');
});

test('열린 «?» 를 다시 누르면 닫히고 포커스가 그 버튼에 남는다', () => {
  const ctx = setup();
  ctx.button.focus();
  ctx.button.dispatch('click', CLICK);
  ctx.button.dispatch('click', CLICK);          // 토글 닫기

  assertClosed(ctx, '토글 닫기');
  assert.equal(ctx.doc.activeElement, ctx.button);
});

// ── 나머지 경로가 그대로인지 (수정이 다른 계약을 깨지 않았는가) ───────────

test('포인터가 떠나면 임시 창은 닫힌다', () => {
  const ctx = setup();
  ctx.button.dispatch('mouseenter');
  ctx.button.dispatch('mouseleave');
  assertClosed(ctx, 'mouseleave');
});

test('고정 상태는 포인터가 떠나도 유지되고 바깥 클릭으로 닫힌다', () => {
  const ctx = setup();
  ctx.button.focus();
  ctx.button.dispatch('click', CLICK);
  ctx.button.dispatch('mouseleave');
  assert.equal(ctx.popover.hidden, false, '고정은 mouseleave 로 안 닫힌다');

  ctx.doc.dispatch('pointerdown', { target: ctx.doc.createElement('div') });
  assertClosed(ctx, '바깥 클릭');
});

test('팝오버 안을 눌러도 고정이 풀리지 않는다', () => {
  const ctx = setup();
  ctx.button.focus();
  ctx.button.dispatch('click', CLICK);
  ctx.doc.dispatch('pointerdown', { target: ctx.body });
  assert.equal(ctx.popover.hidden, false);
  assert.equal(ctx.control.isPinned(), true);
});

test('다른 «?» 를 누르면 이전 버튼의 상태가 정리된다', () => {
  const ctx = setup();
  ctx.button.focus();
  ctx.button.dispatch('click', CLICK);
  ctx.other.focus();
  ctx.other.dispatch('click', CLICK);

  assert.equal(ctx.button.getAttribute('aria-expanded'), 'false', '이전 버튼이 열림으로 남았다');
  assert.equal(ctx.button.getAttribute('aria-describedby'), null);
  assert.equal(ctx.other.getAttribute('aria-expanded'), 'true');
  assert.equal(ctx.control.currentButton(), ctx.other);
});

test('hover 불가 기기에서는 mouseenter 가 창을 열지 않는다', () => {
  const ctx = setup({ hoverCapable: false });
  ctx.button.dispatch('mouseenter');
  assert.equal(ctx.popover.hidden, true, '터치 기기에 hover 툴팁이 뜨면 안 된다');
  ctx.button.dispatch('click', CLICK);
  assert.equal(ctx.control.isPinned(), true, '탭은 곧 고정이다');
});

test('본문은 textContent 로만 그린다 (사전 문자열이라도 innerHTML 경로 없음)', () => {
  const ctx = setup();
  ctx.button.dispatch('mouseenter');
  assert.equal(ctx.body.children.length, 2);
  assert.equal(ctx.body.children[0].textContent, '본문 g900 첫 줄');
  assert.equal(ctx.body.children[0].className, 'help-popover-line');
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.body, 'innerHTML'), false);
});

test('refresh 는 열려 있을 때만 본문을 다시 그린다 (언어 전환 경로)', () => {
  const ctx = setup();
  ctx.control.refresh();                        // 닫혀 있으면 아무 일도 없어야 한다
  assert.equal(ctx.body.children.length, 0);
  ctx.button.dispatch('mouseenter');
  ctx.control.refresh();
  assert.equal(ctx.body.children.length, 2, '다시 그릴 때 이전 줄이 남으면 안 된다');
});
