import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { BrowserService } from '../src/browser.js';
import type { BridgeConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { buildToolList, type ToolDef } from '../src/registry.js';
import { makeTestConfig, startFixtureServer } from './helpers.js';

let base = '';
let closeServer: () => Promise<void>;
let tools = new Map<string, ToolDef>();
let session: BrowserService;
let cfg: BridgeConfig;

before(async () => {
  const s = await startFixtureServer();
  base = s.base;
  closeServer = s.close;
  tools = new Map(buildToolList().map((t) => [t.name, t]));
});

after(async () => {
  await session?.close();
  await closeServer();
});

async function browserAvailable(): Promise<boolean> {
  try {
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

const available = await browserAvailable();

function fresh(): void {
  cfg = makeTestConfig();
  session = new BrowserService(cfg);
}

interface ToolResult {
  text: string;
  image?: { data: string; mimeType: string };
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const def = tools.get(name);
  assert.ok(def, `tool ${name} 未注册`);
  return (await def.handler({ config: cfg, session }, args)) as ToolResult;
}

function textOf(r: ToolResult): string {
  return r.text;
}

function imageOf(r: ToolResult): { data: string; mimeType: string } {
  assert.ok(r.image?.data, '结果缺少图片内容');
  return r.image;
}

/** 从快照文本中提取某个元素的引用编号，如 `[3] link "文档"`。 */
function refOf(snapshotText: string, pattern: RegExp): number {
  const match = snapshotText.match(pattern);
  assert.ok(match, `快照中未找到 ${pattern}`);
  return Number(match[1]);
}

const SKIP = { skip: !available ? 'chromium 不可用，跳过集成测试' : false };

test('web_open 导航并返回标题', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  const r = await call('web_open', { url: base + '/index.html' });
  const text = textOf(r);
  assert.match(text, /navigated to/);
  assert.match(text, /title: Demo Home/);
});

test('web_status 报告运行状态与当前页面', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  const before1 = textOf(await call('web_status', {}));
  assert.match(before1, /running: false/);
  await call('web_open', { url: base + '/index.html' });
  const after1 = textOf(await call('web_status', {}));
  assert.match(after1, /running: true/);
  assert.match(after1, /Demo Home/);
  assert.match(after1, /index\.html/);
});

test('web_snapshot 生成无障碍树与引用', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const text = textOf(await call('web_snapshot', {}));
  assert.match(text, /title: Demo Home/);
  assert.match(text, /heading "欢迎来到演示站点" \(level: 1\)/);
  assert.match(text, /\[1\] link "首页"/);
  assert.match(text, /\[2\] link "文档"/);
  assert.match(text, /checkbox "记住我" \(unchecked\)/);
  assert.match(text, /combobox "语言" \(value: "中文"\)/);
  assert.match(text, /textbox "用户名" \(placeholder: "请输入用户名"\)/);
});

test('通过 ref 点击链接完成导航', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const snap = textOf(await call('web_snapshot', {}));
  const ref = refOf(snap, /\[(\d+)\] link "文档"/);
  await call('web_click', { ref });
  const status = textOf(await call('web_status', {}));
  assert.match(status, /docs\.html/);
  assert.match(status, /Docs/);
});

test('通过 ref 点击按钮触发页面脚本', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const snap = textOf(await call('web_snapshot', {}));
  const ref = refOf(snap, /\[(\d+)\] button "点击计数: 0"/);
  await call('web_click', { ref });
  const r = await call('web_evaluate', { script: "document.getElementById('counter').textContent" });
  assert.match(textOf(r), /点击计数: 1/);
});

test('web_fill / web_select / web_click(checkbox) 填表流程', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const snap = textOf(await call('web_snapshot', {}));
  const userRef = refOf(snap, /\[(\d+)\] textbox "用户名"/);
  const pwRef = refOf(snap, /\[(\d+)\] textbox "密码"/);
  const langRef = refOf(snap, /\[(\d+)\] combobox "语言"/);
  const rememberRef = refOf(snap, /\[(\d+)\] checkbox "记住我"/);

  await call('web_fill', { ref: userRef, value: 'agent-007' });
  await call('web_fill', { ref: pwRef, value: 's3cret' });
  await call('web_select', { ref: langRef, value: 'ja' });
  await call('web_click', { ref: rememberRef });

  const r = await call('web_evaluate', {
    script: `() => ({
      user: document.getElementById('username').value,
      pw: document.getElementById('password').value,
      lang: document.getElementById('lang').value,
      remember: document.getElementById('remember').checked,
    })`,
  });
  assert.match(textOf(r), /"user": "agent-007"/);
  assert.match(textOf(r), /"pw": "s3cret"/);
  assert.match(textOf(r), /"lang": "ja"/);
  assert.match(textOf(r), /"remember": true/);
});

test('web_evaluate 表达式 / 函数 / 结果净化', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const expr = textOf(await call('web_evaluate', { script: 'document.title' }));
  assert.match(expr, /Demo Home/);
  const fn = textOf(
    await call('web_evaluate', { script: '(arg) => arg.n * 2', arg: { n: 21 } })
  );
  assert.match(fn, /42/);
  const dirty = JSON.parse(
    textOf(
      await call('web_evaluate', {
        script: `() => { const o = {}; o.self = o; return { u: undefined, big: 10n, hole: [1,,3], loop: o }; }`,
      })
    )
  ) as {
    u: unknown;
    big: unknown;
    hole: unknown[];
    loop: { self: unknown };
  };
  assert.equal(dirty.u, null);
  assert.equal(dirty.big, 10);
  assert.deepEqual(dirty.hole, [1, null, 3]);
  assert.match(String(dirty.loop.self), /Circular/);

  // 脚本形态判定：表达式体箭头函数 / 语句序列 / 立即调用
  const exprBody = textOf(await call('web_evaluate', { script: 'x => x * 2' }));
  assert.match(exprBody, /NaN/); // 以函数形态调用（x 未定义 → NaN），而非返回函数对象 null
  const fnArg = textOf(await call('web_evaluate', { script: '(arg) => arg.a + arg.b', arg: { a: 1, b: 2 } }));
  assert.match(fnArg, /3/);
  // 语句序列：函数声明+调用（playwright 原生不支持，回退为函数体执行副作用）
  await call('web_evaluate', {
    script: `function bump() { window.__bump = (window.__bump || 0) + 1; } bump(); bump();`,
  });
  const bumpCount = textOf(await call('web_evaluate', { script: 'window.__bump' }));
  assert.match(bumpCount, /2/);
  // IIFE 在页面内执行且只执行一次（使用 globalThis 计数器：若在 Node 侧
  // 被错误执行，页面内计数会立即暴露）
  const iife = textOf(
    await call('web_evaluate', {
      script: `(() => { globalThis.__iifeRan = (globalThis.__iifeRan || 0) + 1; return globalThis.__iifeRan; })()`,
    })
  );
  assert.match(iife, /1/);
  const iifeAgain = textOf(
    await call('web_evaluate', {
      script: `(() => { globalThis.__iifeRan = (globalThis.__iifeRan || 0) + 1; return globalThis.__iifeRan; })()`,
    })
  );
  assert.match(iifeAgain, /2/);

  // 运行时抛 SyntaxError：脚本只执行一次（无失败重试导致的重复执行）
  await assert.rejects(
    call('web_evaluate', {
      script: `(() => { globalThis.__errCount = (globalThis.__errCount || 0) + 1; throw new SyntaxError('boom'); })()`,
    })
  );
  const errCount = textOf(await call('web_evaluate', { script: 'globalThis.__errCount' }));
  assert.match(errCount, /1/);

  // 语法无效的脚本报 invalid 错误
  await assert.rejects(call('web_evaluate', { script: 'let = = =' }), ToolError);
});

test('web_screenshot 输出 png/jpeg 与保存文件', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const png = imageOf(await call('web_screenshot', {}));
  assert.equal(png.mimeType, 'image/png');
  const pngBuf = Buffer.from(png.data, 'base64');
  assert.equal(pngBuf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  const jpeg = imageOf(await call('web_screenshot', { format: 'jpeg', quality: 80 }));
  assert.equal(jpeg.mimeType, 'image/jpeg');
  const jpegBuf = Buffer.from(jpeg.data, 'base64');
  assert.equal(jpegBuf.subarray(0, 2).toString('hex'), 'ffd8');

  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-bridge-shot-')), 'page.png');
  const saved = textOf(await call('web_screenshot', { save_to: outFile }));
  assert.match(saved, /saved to/);
  assert.ok(fs.existsSync(outFile));
  assert.ok(fs.statSync(outFile).size > 0);
});

test('标签页管理：新建 / 列表 / 切换 / 关闭', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const firstId = textOf(await call('web_tab_list', {})).match(/^#\d+\s+(\S+)/m)![1];

  await call('web_tab_new', { url: base + '/docs.html', activate_tab: false });
  const list2 = textOf(await call('web_tab_list', {}));
  assert.match(list2, /Docs/);
  const lines = list2.split('\n').filter((l) => /^#/.test(l));
  assert.equal(lines.length, 2);
  const secondId = lines[1].replace(/^#\d+\s+/, '').split(/\s+—/)[0];

  const switched = textOf(await call('web_tab_switch', { id: firstId }));
  assert.match(switched, /switched/);
  const status = textOf(await call('web_status', {}));
  assert.match(status, /index\.html/);

  await call('web_tab_close', { id: secondId });
  const list1 = textOf(await call('web_tab_list', {}));
  assert.doesNotMatch(list1, /Docs/);
  // 关闭当前标签页后自动切换到剩余标签页
  await call('web_tab_new', { url: base + '/docs.html' });
  await call('web_tab_close', {});
  const status2 = textOf(await call('web_status', {}));
  assert.match(status2, /index\.html/);
});

test('历史导航：back / forward / refresh', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  await call('web_click', { selector: 'a[href="docs.html"]' });
  let status = textOf(await call('web_status', {}));
  assert.match(status, /docs\.html/);
  await call('web_back', {});
  status = textOf(await call('web_status', {}));
  assert.match(status, /index\.html/);
  await call('web_forward', {});
  status = textOf(await call('web_status', {}));
  assert.match(status, /docs\.html/);
  await call('web_refresh', {});
  status = textOf(await call('web_status', {}));
  assert.match(status, /docs\.html/);
});

test('web_wait 各条件', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  await call('web_wait', { condition: 'selector', selector: '#counter', state: 'visible' });
  await call('web_wait', { condition: 'sleep', ms: 100 });
  await call('web_click', { selector: 'a[href="docs.html"]' });
  await call('web_wait', { condition: 'url', url_pattern: '**/docs.html' });
  await call('web_wait', { condition: 'load' });
  await assert.rejects(
    call('web_wait', { condition: 'selector', selector: '#not-exists', timeout: 300 }),
    ToolError
  );
});

test('web_resize 修改视口', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  await call('web_resize', { width: 800, height: 600 });
  const r = await call('web_evaluate', { script: '({ w: innerWidth, h: innerHeight })' });
  assert.match(textOf(r), /"w": 800/);
  assert.match(textOf(r), /"h": 600/);
});

test('web_type / web_press 键盘操作', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const snap = textOf(await call('web_snapshot', {}));
  const userRef = refOf(snap, /\[(\d+)\] textbox "用户名"/);
  await call('web_click', { ref: userRef });
  await call('web_type', { text: 'hello' });
  let r = await call('web_evaluate', { script: "document.getElementById('username').value" });
  assert.match(textOf(r), /hello/);
  await call('web_press', { key: 'Control+a' });
  await call('web_type', { text: 'world' });
  r = await call('web_evaluate', { script: "document.getElementById('username').value" });
  assert.match(textOf(r), /world/);
});

test('web_scroll 方向与回顶', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  await call('web_scroll', { direction: 'down' });
  let r = await call('web_evaluate', { script: 'scrollY' });
  assert.ok(Number(textOf(r)) > 0, '滚动后 scrollY 应大于 0');
  await call('web_scroll', { direction: 'top' });
  r = await call('web_evaluate', { script: 'scrollY' });
  assert.equal(Number(textOf(r)), 0);
  await call('web_scroll', { direction: 'into_view', selector: '#counter' });
});

test('web_hover 悬停', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  await call('web_hover', { selector: '#counter' });
});

test('失效引用在快照后重新导航时报错', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const snap = textOf(await call('web_snapshot', {}));
  const ref = refOf(snap, /\[(\d+)\] link "首页"/);
  await call('web_open', { url: base + '/docs.html' });
  await assert.rejects(call('web_click', { ref }), (e: unknown) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /失效|快照/);
    return true;
  });
});

test('参数错误返回 ToolError', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  await assert.rejects(call('web_click', {}), (e: unknown) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.message, /ref|selector/);
    return true;
  });
  await assert.rejects(call('web_click', { ref: 1, selector: '#x' }), ToolError);
  await assert.rejects(call('web_open', { url: 'ftp://example.com' }), ToolError);
  await assert.rejects(
    call('web_fill', { selector: '#not-exists', value: 'x' }),
    ToolError
  );
  // timeout: 0 表示不限制，应被接受；负数应被拒绝
  await call('web_wait', { condition: 'selector', selector: '#counter', timeout: 0 });
  await assert.rejects(
    call('web_wait', { condition: 'selector', selector: '#counter', timeout: -1 }),
    ToolError
  );
});

test('web_shutdown 关闭浏览器后可自动重启', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const shut = textOf(await call('web_shutdown', {}));
  assert.match(shut, /closed/);
  const status = textOf(await call('web_status', {}));
  assert.match(status, /running: false/);
  await call('web_open', { url: base + '/index.html' });
  const status2 = textOf(await call('web_status', {}));
  assert.match(status2, /running: true/);
});

test('快照支持 selector 子树与 max_depth', SKIP, async (t) => {
  fresh();
  t.after(() => session.close());
  await call('web_open', { url: base + '/index.html' });
  const sub = textOf(await call('web_snapshot', { selector: '#login' }));
  assert.match(sub, /textbox "用户名"/);
  assert.doesNotMatch(sub, /link "首页"/);
  const shallow = textOf(await call('web_snapshot', { max_depth: 1 }));
  assert.match(shallow, /^banner$/m);
  assert.match(shallow, /^main$/m);
  // depth-2 及更深的内容应被截断：表单内控件、列表项
  assert.doesNotMatch(shallow, /textbox "用户名"/);
  assert.doesNotMatch(shallow, /listitem/);
});
