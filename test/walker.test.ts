import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkerApi } from '../src/walker.js';

const { buildPath, computeRole, isHidden, nodeName, nodeValue, nodeStates } = walkerApi();

interface FakeEl {
  nodeType: number;
  tagName: string;
  hidden: boolean;
  parentElement: FakeEl | null;
  previousElementSibling: FakeEl | null;
  children: FakeEl[];
  id?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  textContent?: string;
  innerText?: string;
  selectedOptions?: FakeEl[];
  hasAttribute(n: string): boolean;
  getAttribute(n: string): string | null;
  closest(sel: string): FakeEl | null;
}

function el(tag: string, props: Record<string, unknown> = {}, children: FakeEl[] = []): FakeEl {
  const attrs = new Map<string, string>((props.attrs as Array<[string, string]> | undefined) ?? []);
  const node: FakeEl = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    hidden: (props.hidden as boolean | undefined) ?? false,
    parentElement: null,
    previousElementSibling: null,
    children,
    value: props.value as string | undefined,
    checked: props.checked as boolean | undefined,
    disabled: props.disabled as boolean | undefined,
    textContent: props.textContent as string | undefined,
    innerText: props.innerText as string | undefined,
    id: props.id as string | undefined,
    hasAttribute(n: string) {
      return attrs.has(n);
    },
    getAttribute(n: string) {
      return attrs.get(n) ?? null;
    },
    closest() {
      return null;
    },
  };
  for (const c of children) c.parentElement = node;
  children.forEach((c, i) => {
    c.previousElementSibling = children[i - 1] ?? null;
  });
  return node;
}

test('buildPath 生成从 html 起的 nth-of-type 链', () => {
  const btn = el('button', {});
  const div = el('div', {}, [el('button', {}), btn]);
  const main = el('main', {}, [div]);
  const body = el('body', {}, [main]);
  const html = el('html', {}, [body]);
  btn.parentElement = div;
  div.parentElement = main;
  main.parentElement = body;
  body.parentElement = html;
  assert.equal(buildPath(btn), 'html > body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(2)');
});

test('buildPath 同标签兄弟计数只统计同标签', () => {
  const b2 = el('button', {});
  const b1 = el('button', {});
  const span = el('span', {});
  const p = el('p', {}, [span, b1, b2]);
  const body = el('body', {}, [p]);
  const html = el('html', {}, [body]);
  p.parentElement = body;
  body.parentElement = html;
  assert.equal(buildPath(b2), 'html > body:nth-of-type(1) > p:nth-of-type(1) > button:nth-of-type(2)');
});

test('buildPath 跨文档元素返回 null（不分配 ref）', () => {
  const btn = el('button', {});
  const body = el('body', {}, [btn]);
  const html = el('html', {}, [body]);
  btn.parentElement = body;
  body.parentElement = html;
  (btn as { ownerDocument?: unknown }).ownerDocument = { notTheTopDoc: true };
  assert.equal(buildPath(btn), null);
});

test('buildPath 父链断裂（shadow 边界）返回 null', () => {
  const btn = el('button', {});
  const inner = el('div', {}, [btn]);
  btn.parentElement = inner;
  // inner 的父链断裂：parentElement 为 null 且不是 html
  assert.equal(buildPath(btn), null);
});

test('buildPath 正常文档内元素返回完整路径', () => {
  const btn = el('button', {});
  const body = el('body', {}, [btn]);
  const html = el('html', {}, [body]);
  btn.parentElement = body;
  body.parentElement = html;
  assert.equal(buildPath(btn), 'html > body:nth-of-type(1) > button:nth-of-type(1)');
});

test('computeRole 基本标签映射', () => {
  assert.equal(computeRole(el('a', { attrs: [['href', '/x']] })), 'link');
  assert.equal(computeRole(el('a', {})), null);
  assert.equal(computeRole(el('button', {})), 'button');
  assert.equal(computeRole(el('h3', {})), 'heading');
  assert.equal(computeRole(el('p', {})), 'paragraph');
  assert.equal(computeRole(el('nav', {})), 'navigation');
  assert.equal(computeRole(el('main', {})), 'main');
  assert.equal(computeRole(el('aside', {})), 'complementary');
  assert.equal(computeRole(el('img', { attrs: [['alt', 'x']] })), 'img');
  assert.equal(computeRole(el('img', { attrs: [['alt', '']] })), null);
  assert.equal(computeRole(el('div', {})), null);
  assert.equal(computeRole(el('span', { attrs: [['role', 'switch']] })), 'switch');
  assert.equal(computeRole(el('span', { attrs: [['role', '  ']] })), null);
});

test('computeRole input 类型映射', () => {
  const input = (t: string) => el('input', { attrs: [['type', t]] });
  assert.equal(computeRole(input('checkbox')), 'checkbox');
  assert.equal(computeRole(input('radio')), 'radio');
  assert.equal(computeRole(input('range')), 'slider');
  assert.equal(computeRole(input('number')), 'spinbutton');
  assert.equal(computeRole(input('search')), 'searchbox');
  assert.equal(computeRole(input('password')), 'textbox');
  assert.equal(computeRole(input('hidden')), null);
  assert.equal(computeRole(input('submit')), 'button');
  assert.equal(computeRole(input('text')), 'textbox');
  assert.equal(computeRole(input('email')), 'textbox');
  assert.equal(computeRole(el('textarea', {})), 'textbox');
  assert.equal(computeRole(el('select', {})), 'combobox');
  assert.equal(computeRole(el('option', {})), 'option');
});

test('isHidden 判断 display/visibility/opacity/aria-hidden', () => {
  const style = (o: Record<string, string>) => () => o;
  assert.equal(isHidden(el('div', {}), style({})), false);
  assert.equal(isHidden(el('div', { hidden: true }), style({})), true);
  assert.equal(isHidden(el('div', { attrs: [['aria-hidden', 'true']] }), style({})), true);
  assert.equal(isHidden(el('div', {}), style({ display: 'none' })), true);
  assert.equal(isHidden(el('div', {}), style({ visibility: 'hidden' })), true);
  assert.equal(isHidden(el('div', {}), style({ opacity: '0' })), true);
  assert.equal(isHidden(el('div', {}), style({ opacity: '0.5' })), false);
});

test('nodeName 优先级：aria-labelledby > aria-label > 标签特定 > title > 文本', () => {
  const doc = (map: Map<string, FakeEl>) => ({
    getElementById(id: string) {
      return map.get(id) ?? null;
    },
    querySelector() {
      return null;
    },
  });
  const emptyDoc = doc(new Map());

  // aria-label
  assert.equal(nodeName(el('button', { attrs: [['aria-label', '保存']] }), 'button', emptyDoc), '保存');
  // aria-labelledby
  const labelEl = el('span', { textContent: '  收件人  ' });
  const doc2 = doc(new Map([['lbl', labelEl]]));
  assert.equal(
    nodeName(el('button', { attrs: [['aria-labelledby', 'lbl']] }), 'button', doc2),
    '收件人'
  );
  // aria-label 优先于文本
  assert.equal(
    nodeName(el('button', { attrs: [['aria-label', 'A']], textContent: 'B' }), 'button', emptyDoc),
    'A'
  );
  // img 用 alt
  assert.equal(nodeName(el('img', { attrs: [['alt', 'logo']] }), 'img', emptyDoc), 'logo');
  // button 用文本
  assert.equal(nodeName(el('button', { textContent: '提交表单' }), 'button', emptyDoc), '提交表单');
  // title 兜底
  assert.equal(
    nodeName(el('div', { attrs: [['title', '提示']], textContent: '内容' }), 'group', emptyDoc),
    '提示'
  );
  // 无标签输入框返回空字符串（由 placeholder 兜底为 hint）
  assert.equal(nodeName(el('input', {}), 'textbox', emptyDoc), '');
  // 提交类 input 用 value 作名字
  assert.equal(
    nodeName(el('input', { attrs: [['type', 'submit'], ['value', '提交']] }), 'button', emptyDoc),
    '提交'
  );
});

test('nodeName label[for] 与包裹 label', () => {
  const input = el('input', { id: 'username' });
  const lab = el('label', { textContent: '用户名' });
  const doc = {
    getElementById() {
      return null;
    },
    querySelector(sel: string) {
      return sel === 'label[for="username"]' ? lab : null;
    },
  };
  assert.equal(nodeName(input, 'textbox', doc), '用户名');
  // 包裹 label
  const wrap = el('label', { textContent: '记住我' }, [input]);
  input.parentElement = wrap;
  const doc2 = {
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
  };
  // 手工模拟 closest
  (input as { closest: (s: string) => FakeEl | null }).closest = (s: string) =>
    s === 'label' ? wrap : null;
  assert.equal(nodeName(input, 'checkbox', doc2), '记住我');
});

test('nodeValue 不泄露密码、返回输入值', () => {
  const pw = el('input', { attrs: [['type', 'password']], value: 'secret' });
  assert.equal(nodeValue(pw, 'textbox'), undefined);
  const text = el('input', { value: 'abc' });
  assert.equal(nodeValue(text, 'textbox'), 'abc');
  const empty = el('input', { value: '' });
  assert.equal(nodeValue(empty, 'textbox'), undefined);
  const ta = el('textarea', { value: '多行\n内容' });
  assert.equal(nodeValue(ta, 'textbox'), '多行 内容');
  const sel = el('select', {});
  sel.selectedOptions = [el('option', { textContent: '中文' })];
  assert.equal(nodeValue(sel, 'combobox'), '中文');
});

test('nodeStates 各角色状态', () => {
  const cb = el('input', { checked: true });
  assert.deepEqual(nodeStates(cb, 'checkbox'), { checked: true });
  const cb2 = el('input', { checked: false });
  assert.deepEqual(nodeStates(cb2, 'checkbox'), { checked: false });
  const dis = el('button', { disabled: true });
  assert.deepEqual(nodeStates(dis, 'button'), { disabled: true });
  const ariaDis = el('button', { attrs: [['aria-disabled', 'true']] });
  assert.deepEqual(nodeStates(ariaDis, 'button'), { disabled: true });
  const opt = el('option', { attrs: [['selected', '']] });
  assert.deepEqual(nodeStates(opt, 'option'), { selected: true });
  const opt2 = el('option', {});
  assert.deepEqual(nodeStates(opt2, 'option'), { selected: false });
  // aria-expanded
  const btn = el('button', { attrs: [['aria-expanded', 'true']] });
  assert.deepEqual(nodeStates(btn, 'button'), { expanded: true });
  const btn2 = el('button', { attrs: [['aria-expanded', 'false']] });
  assert.deepEqual(nodeStates(btn2, 'button'), { expanded: false });
  // 无 aria-expanded 的原生 select 不报告展开状态
  assert.deepEqual(nodeStates(el('select', {}), 'combobox'), {});
});
