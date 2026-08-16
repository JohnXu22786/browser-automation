import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ConfigError, DEFAULT_CONFIG } from '../src/config.js';

function tmpJson(content: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bridge-cfg-'));
  const file = path.join(dir, 'web-bridge.config.json');
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

test('无任何输入时返回默认配置', () => {
  const cfg = loadConfig([], {});
  assert.equal(cfg.browserName, DEFAULT_CONFIG.browserName);
  assert.equal(cfg.headless, true);
  assert.deepEqual(cfg.viewport, { width: 1280, height: 720 });
  assert.equal(cfg.actionTimeoutMs, DEFAULT_CONFIG.actionTimeoutMs);
  assert.equal(cfg.testIdAttribute, 'data-testid');
  assert.deepEqual(cfg.permissions, []);
});

test('环境变量覆盖配置', () => {
  const cfg = loadConfig([], {
    WEB_BRIDGE_HEADLESS: 'false',
    WEB_BRIDGE_VIEWPORT: '1440x900',
    WEB_BRIDGE_BROWSER: 'firefox',
    WEB_BRIDGE_PERMISSIONS: 'geolocation,clipboard-read',
    WEB_BRIDGE_ACTION_TIMEOUT: '1500',
    WEB_BRIDGE_NAV_TIMEOUT: '30000',
    WEB_BRIDGE_SETTLE_MS: '50',
    WEB_BRIDGE_SANDBOX: 'false',
    WEB_BRIDGE_IGNORE_HTTPS_ERRORS: 'true',
    WEB_BRIDGE_TEST_ID_ATTR: 'data-qa',
  });
  assert.equal(cfg.headless, false);
  assert.deepEqual(cfg.viewport, { width: 1440, height: 900 });
  assert.equal(cfg.browserName, 'firefox');
  assert.deepEqual(cfg.permissions, ['geolocation', 'clipboard-read']);
  assert.equal(cfg.actionTimeoutMs, 1500);
  assert.equal(cfg.navigationTimeoutMs, 30000);
  assert.equal(cfg.settleMs, 50);
  assert.equal(cfg.sandbox, false);
  assert.equal(cfg.ignoreHTTPSErrors, true);
  assert.equal(cfg.testIdAttribute, 'data-qa');
});

test('布尔环境变量解析', () => {
  for (const truthy of ['true', 'TRUE', '1', 'yes']) {
    const cfg = loadConfig([], { WEB_BRIDGE_HEADLESS: truthy });
    assert.equal(cfg.headless, true, `expected true for ${truthy}`);
  }
  for (const falsy of ['false', 'FALSE', '0', 'no']) {
    const cfg = loadConfig([], { WEB_BRIDGE_HEADLESS: falsy });
    assert.equal(cfg.headless, false, `expected false for ${falsy}`);
  }
  assert.throws(() => loadConfig([], { WEB_BRIDGE_HEADLESS: 'maybe' }), ConfigError);
});

test('非法环境变量值抛出 ConfigError', () => {
  assert.throws(() => loadConfig([], { WEB_BRIDGE_VIEWPORT: 'banana' }), ConfigError);
  assert.throws(() => loadConfig([], { WEB_BRIDGE_VIEWPORT: '1280' }), ConfigError);
  assert.throws(() => loadConfig([], { WEB_BRIDGE_ACTION_TIMEOUT: '-5' }), ConfigError);
  assert.throws(() => loadConfig([], { WEB_BRIDGE_ACTION_TIMEOUT: 'abc' }), ConfigError);
  assert.throws(() => loadConfig([], { WEB_BRIDGE_BROWSER: 'safari' }), ConfigError);
  assert.throws(() => loadConfig([], { WEB_BRIDGE_VIEWPORT: '0x720' }), ConfigError);
});

test('配置文件加载（WEB_BRIDGE_CONFIG）', () => {
  const file = tmpJson({
    browser: { name: 'webkit', headless: false, viewport: { width: 800, height: 600 } },
    timeouts: { action: 3000, settle: 100 },
    sandbox: false,
  });
  const cfg = loadConfig([], { WEB_BRIDGE_CONFIG: file });
  assert.equal(cfg.browserName, 'webkit');
  assert.equal(cfg.headless, false);
  assert.deepEqual(cfg.viewport, { width: 800, height: 600 });
  assert.equal(cfg.actionTimeoutMs, 3000);
  assert.equal(cfg.settleMs, 100);
  assert.equal(cfg.sandbox, false);
  // 未提及的键保持默认
  assert.equal(cfg.navigationTimeoutMs, DEFAULT_CONFIG.navigationTimeoutMs);
});

test('CLI --config 与配置文件加载', () => {
  const file = tmpJson({ browser: { name: 'chromium', headless: true } });
  const cfg = loadConfig(['--config', file], {});
  assert.equal(cfg.headless, true);
});

test('环境变量优先于配置文件', () => {
  const file = tmpJson({ browser: { headless: false }, timeouts: { action: 999 } });
  const cfg = loadConfig([], { WEB_BRIDGE_CONFIG: file, WEB_BRIDGE_HEADLESS: 'true' });
  assert.equal(cfg.headless, true);
  assert.equal(cfg.actionTimeoutMs, 999);
});

test('配置文件中的未知键抛出 ConfigError', () => {
  const file = tmpJson({ browserName: 'chromium' });
  assert.throws(() => loadConfig([], { WEB_BRIDGE_CONFIG: file }), ConfigError);
});

test('配置文件损坏或路径不存在抛出 ConfigError', () => {
  assert.throws(() => loadConfig([], { WEB_BRIDGE_CONFIG: 'C:/nope/nonexistent.json' }), ConfigError);
  const bad = tmpJson({ browser: '{bad json' });
  fs.writeFileSync(bad, '{bad json');
  assert.throws(() => loadConfig([], { WEB_BRIDGE_CONFIG: bad }), ConfigError);
});

test('配置文件中的错误类型抛出 ConfigError', () => {
  const file = tmpJson({ timeouts: { action: 'fast' } });
  assert.throws(() => loadConfig([], { WEB_BRIDGE_CONFIG: file }), ConfigError);
  const file2 = tmpJson({ browser: { viewport: { width: 0, height: 720 } } });
  assert.throws(() => loadConfig([], { WEB_BRIDGE_CONFIG: file2 }), ConfigError);
});

test('权限列表支持逗号与空白分隔', () => {
  const cfg = loadConfig([], { WEB_BRIDGE_PERMISSIONS: ' geolocation , clipboard-write ' });
  assert.deepEqual(cfg.permissions, ['geolocation', 'clipboard-write']);
});
