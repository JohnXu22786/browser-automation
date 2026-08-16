import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BridgeConfig } from '../src/config.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'site');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
};

/** 在随机端口上启动静态夹具服务器，返回 base URL 与关闭函数。 */
export async function startFixtureServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.join(FIXTURE_DIR, safePath);
    if (!file.startsWith(FIXTURE_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture server failed to bind');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** 集成测试使用的基线配置（短超时，保证测试快速失败）。 */
export function makeTestConfig(): BridgeConfig {
  return {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeoutMs: 2000,
    navigationTimeoutMs: 5000,
    settleMs: 30,
    ignoreHTTPSErrors: false,
    sandbox: true,
    permissions: [],
    testIdAttribute: 'data-testid',
  };
}
