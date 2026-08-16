import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRefs, formatTree, type RawNode } from '../src/snapshot.js';

function node(partial: Partial<RawNode> & { role: string }): RawNode {
  return { role: partial.role, ...partial } as RawNode;
}

test('collectRefs 按文档顺序分配自增引用', () => {
  const tree: RawNode[] = [
    node({ role: 'heading', name: 'A', level: 1 }),
    node({
      role: 'form',
      name: '登录',
      children: [
        node({ role: 'textbox', name: '用户名', path: 'html > #u' }),
        node({ role: 'checkbox', name: '记住', path: 'html > #c' }),
      ],
    }),
    node({ role: 'link', name: '退出', path: 'html > #out' }),
  ];
  const refs = collectRefs(tree);
  assert.equal(refs.size, 3);
  assert.equal(refs.get(1), 'html > #u');
  assert.equal(refs.get(2), 'html > #c');
  assert.equal(refs.get(3), 'html > #out');
  assert.equal(refs.has(4), false);
});

test('formatTree 缩进与引用前缀', () => {
  const tree: RawNode[] = [
    node({ role: 'heading', name: '欢迎', level: 1 }),
    node({
      role: 'navigation',
      children: [
        node({ role: 'link', name: '首页', path: 'a1' }),
        node({ role: 'link', name: '文档', path: 'a2' }),
      ],
    }),
  ];
  const text = formatTree(tree);
  assert.equal(
    text,
    [
      'heading "欢迎" (level: 1)',
      'navigation',
      '  [1] link "首页"',
      '  [2] link "文档"',
    ].join('\n')
  );
});

test('formatTree 状态与属性展示', () => {
  const tree: RawNode[] = [
    node({ role: 'textbox', name: '用户名', path: 'u', hint: '请输入', value: 'abc' }),
    node({ role: 'textbox', name: '密码', path: 'p', password: true, hint: '请输入密码' }),
    node({ role: 'checkbox', name: '记住我', path: 'c', checked: false }),
    node({ role: 'checkbox', name: '订阅', path: 's', checked: true }),
    node({ role: 'button', name: '提交', path: 'b', disabled: true }),
    node({ role: 'option', name: '中文', selected: true }),
    node({ role: 'button', name: '更多', path: 'm', expanded: false }),
    node({ role: 'summary', name: '展开', path: 'd', expanded: true }),
  ];
  const text = formatTree(tree).split('\n');
  assert.equal(text[0], '[1] textbox "用户名" (value: "abc") (placeholder: "请输入")');
  assert.equal(text[1], '[2] textbox "密码" (password) (placeholder: "请输入密码")');
  assert.equal(text[2], '[3] checkbox "记住我" (unchecked)');
  assert.equal(text[3], '[4] checkbox "订阅" (checked)');
  assert.equal(text[4], '[5] button "提交" (disabled)');
  assert.equal(text[5], 'option "中文" (selected)');
  assert.equal(text[6], '[6] button "更多" (collapsed)');
  assert.equal(text[7], '[7] summary "展开" (expanded)');
});

test('formatTree 无名字节点省略引号', () => {
  const tree: RawNode[] = [node({ role: 'navigation' })];
  assert.equal(formatTree(tree), 'navigation');
});

test('formatTree maxDepth 截断子树', () => {
  const tree: RawNode[] = [
    node({
      role: 'form',
      children: [
        node({
          role: 'group',
          children: [node({ role: 'link', name: '深处', path: 'x' })],
        }),
      ],
    }),
  ];
  const text = formatTree(tree, { maxDepth: 1 });
  assert.equal(text, ['form', '  group'].join('\n'));
  const full = formatTree(tree);
  assert.equal(full, ['form', '  group', '    [1] link "深处"'].join('\n'));
});

test('空树返回空字符串', () => {
  assert.equal(formatTree([]), '');
  assert.equal(collectRefs([]).size, 0);
});
