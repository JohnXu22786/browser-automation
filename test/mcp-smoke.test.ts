import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createToolServer } from '../src/server.js';
import { BrowserService } from '../src/browser.js';
import { makeTestConfig } from './helpers.js';

const TOOL_COUNT = 22;

test('MCP server 注册全部工具并可通过协议调用', async (t) => {
  const config = makeTestConfig();
  const session = new BrowserService(config);
  t.after(() => session.close());
  const server = createToolServer(config, session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'smoke-test', version: '0.0.1' });
  t.after(() => client.close());
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  assert.equal(tools.length, TOOL_COUNT);
  const names = tools.map((t) => t.name);
  for (const n of ['web_open', 'web_click', 'web_fill', 'web_snapshot', 'web_screenshot', 'web_evaluate', 'web_status', 'web_tab_list', 'web_wait', 'web_shutdown']) {
    assert.ok(names.includes(n), `缺少工具 ${n}`);
  }
  // 工具描述包含权限说明
  const open = tools.find((t) => t.name === 'web_open')!;
  assert.match(open.description, /权限说明/);
  assert.match(open.description, /网络请求/);

  // 调用无需浏览器的工具
  const status = await client.callTool({ name: 'web_status', arguments: {} });
  const text = (status.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')!.text;
  assert.match(text, /running: false/);

  const shutdown = await client.callTool({ name: 'web_shutdown', arguments: {} });
  const shutText = (shutdown.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')!.text;
  assert.match(shutText, /closed/);
});

test('MCP server 参数校验与错误映射为 isError 结果', async (t) => {
  const config = makeTestConfig();
  const session = new BrowserService(config);
  t.after(() => session.close());
  const server = createToolServer(config, session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'smoke-test', version: '0.0.1' });
  t.after(() => client.close());
  await client.connect(clientTransport);

  const textOf = (r: { content?: Array<{ type: string; text?: string }> }): string =>
    (r.content ?? []).find((c) => c.type === 'text')?.text ?? '';

  // zod 校验失败 → isError 结果
  const badType = await client.callTool({
    name: 'web_resize',
    arguments: { width: 'not-a-number', height: 10 },
  });
  assert.equal(badType.isError, true);
  assert.match(textOf(badType), /Invalid arguments for tool web_resize/);

  // 缺少必填参数 → isError 结果
  const missing = await client.callTool({ name: 'web_open', arguments: {} });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /Invalid arguments for tool web_open/);

  // 工具内业务错误（无页面时点击）→ isError 结果
  const biz = await client.callTool({ name: 'web_click', arguments: { selector: '#x' } });
  assert.equal(biz.isError, true);
  assert.match(textOf(biz), /web_open|标签页/);

  // 合法调用不报错
  const status = await client.callTool({ name: 'web_status', arguments: {} });
  assert.notEqual(status.isError, true);
  assert.match(textOf(status), /running: false/);
});

test('通过真实 stdio 进程链路完成一次会话，断开后浏览器被回收', { timeout: 60_000 }, async (t) => {
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    env: { ...process.env, WEB_BRIDGE_HEADLESS: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  t.after(async () => {
    child.kill();
    await new Promise((r) => setTimeout(r, 200));
  });

  const client = new Client({ name: 'stdio-test', version: '0.0.1' });
  await client.connect(new StdioLikeTransport(child));

  const { tools } = await client.listTools();
  assert.ok(tools.length >= TOOL_COUNT, `工具数量 ${tools.length}，stderr: ${stderr.slice(0, 300)}`);

  // 真实启动浏览器会话，验证断开时浏览器进程会被清理
  const opened = await client.callTool({
    name: 'web_open',
    arguments: { url: 'data:text/html,<h1>probe</h1>' },
  });
  assert.notEqual(opened.isError, true, `web_open 失败: ${stderr.slice(0, 300)}`);

  const status = await client.callTool({ name: 'web_status', arguments: {} });
  const text = (status.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')!.text;
  assert.match(text, /running: true/);

  await client.close();
  // 客户端断开（stdin EOF）后服务端应自动关闭浏览器并退出；
  // 浏览器在运行时事件循环不会自然排空，只有 shutdown 路径能退出 —— 此处是真实断言
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 10_000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  assert.equal(child.exitCode, 0, `服务端未干净退出，stderr: ${stderr.slice(0, 500)}`);
});

/** 把子进程 stdio 包装为 MCP SDK 传输（按行缓冲，避免跨块解析错误）。 */
class StdioLikeTransport {
  private closed = false;
  private buffer = '';

  constructor(private readonly child: ReturnType<typeof spawn>) {}

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;

  async start(): Promise<void> {
    this.child.stdout!.on('data', (d) => {
      this.buffer += String(d);
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          this.onmessage?.(JSON.parse(line));
        } catch (err) {
          this.onerror?.(err as Error);
        }
      }
    });
    this.child.on('exit', () => {
      if (!this.closed) {
        this.closed = true;
        this.onclose?.();
      }
    });
  }

  async send(message: unknown): Promise<void> {
    this.child.stdin!.write(JSON.stringify(message) + '\n');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin!.end();
    this.onclose?.();
  }
}
