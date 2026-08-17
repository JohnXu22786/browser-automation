import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJSONSafe } from '../src/scripting.js';
import { guardTimeout, parseEnum, parseNonNegativeInt, parsePositiveInt, validatePageUrl } from '../src/util.js';
import { parseSelector } from '../src/locators.js';
import { ToolError } from '../src/errors.js';

test('toJSONSafe 基础类型', () => {
  assert.equal(toJSONSafe(undefined), null);
  assert.equal(toJSONSafe(null), null);
  assert.equal(toJSONSafe('x'), 'x');
  assert.equal(toJSONSafe(true), true);
  assert.equal(toJSONSafe(42), 42);
  assert.equal(toJSONSafe(0.5), 0.5);
});

test('toJSONSafe 特殊数值', () => {
  assert.equal(toJSONSafe(Number.NaN), 'NaN');
  assert.equal(toJSONSafe(Number.POSITIVE_INFINITY), 'Infinity');
  assert.equal(toJSONSafe(Number.NEGATIVE_INFINITY), '-Infinity');
  assert.equal(toJSONSafe(10n), 10);
  assert.equal(toJSONSafe(2n ** 100n), '1267650600228229401496703205376');
});

test('toJSONSafe 函数与符号', () => {
  assert.equal(toJSONSafe(() => 1), null);
  assert.equal(toJSONSafe(Symbol('x')), null);
});

test('toJSONSafe 循环引用', () => {
  const o: Record<string, unknown> = {};
  o.self = o;
  const out = toJSONSafe({ a: 1, loop: o }) as Record<string, unknown>;
  assert.equal(out.a, 1);
  assert.equal((out.loop as Record<string, unknown>).self, '[Circular]');
});

test('toJSONSafe 数组中的空洞与截断', () => {
  const out = toJSONSafe([1, , 3]) as unknown[];
  assert.deepEqual(out, [1, null, 3]);
  const big = toJSONSafe(Array.from({ length: 300 }, (_, i) => i)) as unknown[];
  assert.equal(big.length, 201);
  assert.match(big[200] as string, /截断/);
});

test('toJSONSafe 深度上限', () => {
  let deep: unknown = 'bottom';
  for (let i = 0; i < 20; i++) deep = { next: deep };
  const out = toJSONSafe(deep) as Record<string, unknown>;
  let cur: unknown = out;
  for (let i = 0; i < 9; i++) cur = (cur as Record<string, unknown>).next;
  assert.equal(cur, '[DepthLimit]');
});

test('toJSONSafe 字符串截断', () => {
  const out = toJSONSafe('x'.repeat(5000)) as string;
  assert.equal(out.length, 2000);
  assert.match(out, /…$/);
});

test('parsePositiveInt 校验', () => {
  assert.equal(parsePositiveInt(42, 'timeout'), 42);
  assert.equal(parsePositiveInt('42', 'timeout'), 42);
  assert.throws(() => parsePositiveInt(0, 'timeout'), ToolError);
  assert.throws(() => parsePositiveInt(-1, 'timeout'), ToolError);
  assert.throws(() => parsePositiveInt(1.5, 'timeout'), ToolError);
  assert.throws(() => parsePositiveInt('abc', 'timeout'), ToolError);
  assert.throws(() => parsePositiveInt(null, 'timeout'), ToolError);
  assert.throws(() => parsePositiveInt(undefined, 'timeout'), ToolError);
  assert.equal(parsePositiveInt(3, 'n', 3), 3); // 等于上限时合法
  assert.throws(() => parsePositiveInt(5, 'n', 3), ToolError); // 超过上限
});

test('parseNonNegativeInt 校验（0 表示不限制）', () => {
  assert.equal(parseNonNegativeInt(0, 'timeout'), 0);
  assert.equal(parseNonNegativeInt('10', 'timeout'), 10);
  assert.throws(() => parseNonNegativeInt(-1, 'timeout'), ToolError);
  assert.throws(() => parseNonNegativeInt(1.5, 'timeout'), ToolError);
  assert.throws(() => parseNonNegativeInt('abc', 'timeout'), ToolError);
  assert.throws(() => parseNonNegativeInt(null, 'timeout'), ToolError);
  assert.equal(parseNonNegativeInt(5, 'n', 5), 5);
  assert.throws(() => parseNonNegativeInt(6, 'n', 5), ToolError);
});

test('parseEnum 校验', () => {
  assert.equal(parseEnum('png', ['png', 'jpeg'] as const, 'format'), 'png');
  assert.equal(parseEnum('jpeg', ['png', 'jpeg'] as const, 'format'), 'jpeg');
  assert.throws(() => parseEnum('gif', ['png', 'jpeg'] as const, 'format'), ToolError);
  assert.throws(() => parseEnum(42, ['png', 'jpeg'] as const, 'format'), ToolError);
  assert.throws(() => parseEnum(null, ['png', 'jpeg'] as const, 'format'), ToolError);
});

test('validatePageUrl 支持 http/https/file/data 并去除首尾空白', () => {
  assert.equal(validatePageUrl('https://example.com'), 'https://example.com');
  assert.equal(validatePageUrl(' http://example.com/a b '), 'http://example.com/a b');
  assert.equal(validatePageUrl('file:///C:/tmp/page.html'), 'file:///C:/tmp/page.html');
  assert.equal(validatePageUrl('data:text/html,<h1>hi</h1>'), 'data:text/html,<h1>hi</h1>');
});

test('validatePageUrl 拒绝空值 / 非法格式 / 不支持的协议', () => {
  assert.throws(() => validatePageUrl(''), ToolError);
  assert.throws(() => validatePageUrl('   '), ToolError);
  assert.throws(() => validatePageUrl('not a url'), ToolError);
  assert.throws(() => validatePageUrl('http://'), ToolError);
  assert.throws(() => validatePageUrl('ftp://example.com'), ToolError);
  assert.throws(() => validatePageUrl('javascript:alert(1)'), ToolError);
  assert.throws(() => validatePageUrl(null), ToolError);
  assert.throws(() => validatePageUrl(42), ToolError);
});

test('guardTimeout 透传成功值并包含错误信息', async () => {
  assert.equal(await guardTimeout(Promise.resolve('ok'), '点击'), 'ok');
  await assert.rejects(
    guardTimeout(Promise.reject(new Error('Timeout 30000ms exceeded.')), '点击'),
    (err: unknown) => err instanceof ToolError && err.kind === 'timeout' && /点击/.test(String(err.message)),
  );
  await assert.rejects(
    guardTimeout(Promise.reject(new Error('regular failure')), '导航'),
    (err: unknown) => err instanceof Error && !(err instanceof ToolError) && /regular failure/.test(err.message),
  );
});

test('parseSelector 前缀解析', () => {
  assert.deepEqual(parseSelector('text=立即购买'), { kind: 'text', value: '立即购买' });
  assert.deepEqual(parseSelector('testid=btn-save'), { kind: 'testid', value: 'btn-save' });
  assert.deepEqual(parseSelector('testid=  trimmed  '), { kind: 'testid', value: 'trimmed' });
  assert.deepEqual(parseSelector('#main > .card button'), { kind: 'css', value: '#main > .card button' });
  assert.deepEqual(parseSelector(''), { kind: 'css', value: '' });
  assert.deepEqual(parseSelector('textwith=notprefix'), { kind: 'css', value: 'textwith=notprefix' });
});
