import fs from 'node:fs';
import path from 'node:path';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export const WAIT_UNTILS = ['commit', 'domcontentloaded', 'load', 'networkidle'] as const;
export type WaitUntil = (typeof WAIT_UNTILS)[number];

export interface ViewportSize {
  width: number;
  height: number;
}

export interface BridgeConfig {
  /** 浏览器引擎：chromium / firefox / webkit */
  browserName: BrowserName;
  /** 无头模式。插件默认无头；需要可视化调试时设为 false */
  headless: boolean;
  /** 自定义浏览器可执行文件路径 */
  executablePath?: string;
  /** 默认视口尺寸（CSS 像素） */
  viewport: ViewportSize;
  /** 用户数据目录；设置后使用持久化上下文（登录态跨会话保留） */
  userDataDir?: string;
  /** 代理服务器地址，如 http://proxy:3128 */
  proxy?: string;
  locale?: string;
  timezoneId?: string;
  userAgent?: string;
  /** 忽略 HTTPS 证书错误（仅调试环境建议开启） */
  ignoreHTTPSErrors: boolean;
  /** 是否启用浏览器沙箱；容器环境无沙箱时设为 false */
  sandbox: boolean;
  /** 授予浏览器上下文的权限，如 geolocation / clipboard-read */
  permissions: string[];
  /** 单次动作默认超时（毫秒），0 表示不限制 */
  actionTimeoutMs: number;
  /** 导航默认超时（毫秒），0 表示不限制 */
  navigationTimeoutMs: number;
  /** 动作触发异步任务后等待其安定的时长（毫秒） */
  settleMs: number;
  /** 会话恢复文件（storage state JSON），仅非持久化模式生效 */
  storageState?: string;
  /** testid= 选择器使用的属性名 */
  testIdAttribute: string;
}

export const DEFAULT_CONFIG: BridgeConfig = {
  browserName: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 720 },
  actionTimeoutMs: 10_000,
  navigationTimeoutMs: 60_000,
  settleMs: 500,
  ignoreHTTPSErrors: false,
  sandbox: true,
  permissions: [],
  testIdAttribute: 'data-testid',
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const BROWSER_NAMES: readonly BrowserName[] = ['chromium', 'firefox', 'webkit'];

const FILE_TOP_KEYS = ['browser', 'context', 'timeouts', 'sandbox', 'testIdAttribute'];
const FILE_BROWSER_KEYS = ['name', 'headless', 'executablePath', 'viewport', 'userDataDir', 'proxy', 'locale', 'timezoneId', 'userAgent'];
const FILE_CONTEXT_KEYS = ['ignoreHTTPSErrors', 'permissions', 'storageState'];
const FILE_TIMEOUT_KEYS = ['action', 'navigation', 'settle'];

function fail(message: string): never {
  throw new ConfigError(message);
}

function parseBool(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(v)) return true;
    if (['false', '0', 'no'].includes(v)) return false;
  }
  fail(`${name} 必须是布尔值（true/false/1/0/yes/no）`);
}

function parseIntStrict(value: unknown, name: string, min: number, max: number): number {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    fail(`${name} 必须是 ${min} ~ ${max} 之间的整数`);
  }
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    fail(`${name} 必须是 ${min} ~ ${max} 之间的整数`);
  }
  return n;
}

function parseViewport(value: unknown, name: string): ViewportSize {
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    checkKeys(v, ['width', 'height'], name);
    return {
      width: parseIntStrict(v.width, `${name}.width`, 1, 10_000),
      height: parseIntStrict(v.height, `${name}.height`, 1, 10_000),
    };
  }
  if (typeof value === 'string') {
    const m = /^\s*(\d{1,5})\s*[xX*]\s*(\d{1,5})\s*$/.exec(value);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w >= 1 && w <= 10_000 && h >= 1 && h <= 10_000) return { width: w, height: h };
    }
  }
  fail(`${name} 必须是 "宽x高" 格式（如 1280x720）或 {width, height} 对象`);
}

function parsePermissions(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value as string[];
  }
  fail('permissions 必须是字符串数组或逗号分隔的字符串');
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length) fail(`${where} 包含未知配置键：${unknown.join('、')}`);
}

type EnvMap = Record<string, string | undefined>;

function readConfigFile(filePath: string): Record<string, unknown> {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    fail(`无法读取配置文件：${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`配置文件不是合法 JSON：${filePath}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(`配置文件顶层必须是 JSON 对象：${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function mergeFileConfig(file: Record<string, unknown>): BridgeConfig {
  const cfg: BridgeConfig = { ...DEFAULT_CONFIG };
  if (Object.keys(file).length === 0) return cfg;

  checkKeys(file, FILE_TOP_KEYS, '配置文件');
  const browser = file.browser as Record<string, unknown> | undefined;
  if (browser !== undefined) {
    if (typeof browser !== 'object' || browser === null || Array.isArray(browser)) fail('browser 必须是对象');
    checkKeys(browser, FILE_BROWSER_KEYS, 'browser');
    if (browser.name !== undefined) {
      if (!BROWSER_NAMES.includes(browser.name as BrowserName)) fail(`browser.name 必须是 ${BROWSER_NAMES.join('、')} 之一`);
      cfg.browserName = browser.name as BrowserName;
    }
    if (browser.headless !== undefined) cfg.headless = parseBool(browser.headless, 'browser.headless');
    if (browser.executablePath !== undefined) {
      if (typeof browser.executablePath !== 'string' || !browser.executablePath) fail('browser.executablePath 必须是字符串');
      cfg.executablePath = browser.executablePath;
    }
    if (browser.viewport !== undefined) cfg.viewport = parseViewport(browser.viewport, 'browser.viewport');
    if (browser.userDataDir !== undefined) {
      if (typeof browser.userDataDir !== 'string' || !browser.userDataDir) fail('browser.userDataDir 必须是字符串');
      cfg.userDataDir = browser.userDataDir;
    }
    if (browser.proxy !== undefined) {
      if (typeof browser.proxy !== 'string' || !browser.proxy) fail('browser.proxy 必须是字符串');
      cfg.proxy = browser.proxy;
    }
    if (browser.locale !== undefined) {
      if (typeof browser.locale !== 'string') fail('browser.locale 必须是字符串');
      cfg.locale = browser.locale;
    }
    if (browser.timezoneId !== undefined) {
      if (typeof browser.timezoneId !== 'string') fail('browser.timezoneId 必须是字符串');
      cfg.timezoneId = browser.timezoneId;
    }
    if (browser.userAgent !== undefined) {
      if (typeof browser.userAgent !== 'string') fail('browser.userAgent 必须是字符串');
      cfg.userAgent = browser.userAgent;
    }
  }

  const context = file.context as Record<string, unknown> | undefined;
  if (context !== undefined) {
    if (typeof context !== 'object' || context === null || Array.isArray(context)) fail('context 必须是对象');
    checkKeys(context, FILE_CONTEXT_KEYS, 'context');
    if (context.ignoreHTTPSErrors !== undefined) {
      cfg.ignoreHTTPSErrors = parseBool(context.ignoreHTTPSErrors, 'context.ignoreHTTPSErrors');
    }
    if (context.permissions !== undefined) cfg.permissions = parsePermissions(context.permissions);
    if (context.storageState !== undefined) {
      if (typeof context.storageState !== 'string') fail('context.storageState 必须是字符串');
      cfg.storageState = context.storageState;
    }
  }

  const timeouts = file.timeouts as Record<string, unknown> | undefined;
  if (timeouts !== undefined) {
    if (typeof timeouts !== 'object' || timeouts === null || Array.isArray(timeouts)) fail('timeouts 必须是对象');
    checkKeys(timeouts, FILE_TIMEOUT_KEYS, 'timeouts');
    if (timeouts.action !== undefined) cfg.actionTimeoutMs = parseIntStrict(timeouts.action, 'timeouts.action', 0, 3_600_000);
    if (timeouts.navigation !== undefined) cfg.navigationTimeoutMs = parseIntStrict(timeouts.navigation, 'timeouts.navigation', 0, 3_600_000);
    if (timeouts.settle !== undefined) cfg.settleMs = parseIntStrict(timeouts.settle, 'timeouts.settle', 0, 60_000);
  }

  if (file.sandbox !== undefined) cfg.sandbox = parseBool(file.sandbox, 'sandbox');
  if (file.testIdAttribute !== undefined) {
    if (typeof file.testIdAttribute !== 'string' || !file.testIdAttribute.trim()) fail('testIdAttribute 必须是非空字符串');
    cfg.testIdAttribute = file.testIdAttribute.trim();
  }
  return cfg;
}

function applyEnv(cfg: BridgeConfig, env: EnvMap): void {
  const get = (name: string) => env[name];

  const browser = get('WEB_BRIDGE_BROWSER');
  if (browser !== undefined) {
    if (!BROWSER_NAMES.includes(browser as BrowserName)) fail(`WEB_BRIDGE_BROWSER 必须是 ${BROWSER_NAMES.join('、')} 之一`);
    cfg.browserName = browser as BrowserName;
  }
  const headless = get('WEB_BRIDGE_HEADLESS');
  if (headless !== undefined) cfg.headless = parseBool(headless, 'WEB_BRIDGE_HEADLESS');
  const exec = get('WEB_BRIDGE_EXECUTABLE');
  if (exec !== undefined && exec.trim() !== '') cfg.executablePath = exec.trim();
  const viewport = get('WEB_BRIDGE_VIEWPORT');
  if (viewport !== undefined) cfg.viewport = parseViewport(viewport, 'WEB_BRIDGE_VIEWPORT');
  const userDataDir = get('WEB_BRIDGE_USER_DATA_DIR');
  if (userDataDir !== undefined && userDataDir.trim() !== '') cfg.userDataDir = userDataDir.trim();
  const proxy = get('WEB_BRIDGE_PROXY');
  if (proxy !== undefined && proxy.trim() !== '') cfg.proxy = proxy.trim();
  const locale = get('WEB_BRIDGE_LOCALE');
  if (locale !== undefined && locale.trim() !== '') cfg.locale = locale.trim();
  const timezoneId = get('WEB_BRIDGE_TIMEZONE');
  if (timezoneId !== undefined && timezoneId.trim() !== '') cfg.timezoneId = timezoneId.trim();
  const userAgent = get('WEB_BRIDGE_USER_AGENT');
  if (userAgent !== undefined && userAgent.trim() !== '') cfg.userAgent = userAgent.trim();
  const ignoreHttps = get('WEB_BRIDGE_IGNORE_HTTPS_ERRORS');
  if (ignoreHttps !== undefined) cfg.ignoreHTTPSErrors = parseBool(ignoreHttps, 'WEB_BRIDGE_IGNORE_HTTPS_ERRORS');
  const sandbox = get('WEB_BRIDGE_SANDBOX');
  if (sandbox !== undefined) cfg.sandbox = parseBool(sandbox, 'WEB_BRIDGE_SANDBOX');
  const permissions = get('WEB_BRIDGE_PERMISSIONS');
  if (permissions !== undefined) cfg.permissions = parsePermissions(permissions);
  const action = get('WEB_BRIDGE_ACTION_TIMEOUT');
  if (action !== undefined) cfg.actionTimeoutMs = parseIntStrict(action, 'WEB_BRIDGE_ACTION_TIMEOUT', 0, 3_600_000);
  const nav = get('WEB_BRIDGE_NAV_TIMEOUT');
  if (nav !== undefined) cfg.navigationTimeoutMs = parseIntStrict(nav, 'WEB_BRIDGE_NAV_TIMEOUT', 0, 3_600_000);
  const settle = get('WEB_BRIDGE_SETTLE_MS');
  if (settle !== undefined) cfg.settleMs = parseIntStrict(settle, 'WEB_BRIDGE_SETTLE_MS', 0, 60_000);
  const storageState = get('WEB_BRIDGE_STORAGE_STATE');
  if (storageState !== undefined && storageState.trim() !== '') cfg.storageState = storageState.trim();
  const testIdAttr = get('WEB_BRIDGE_TEST_ID_ATTR');
  if (testIdAttr !== undefined) {
    if (testIdAttr.trim() === '') fail('WEB_BRIDGE_TEST_ID_ATTR 不能为空');
    cfg.testIdAttribute = testIdAttr.trim();
  }
}

function cliConfigPath(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') {
      if (i + 1 < argv.length) return path.resolve(argv[i + 1]);
      fail('--config 后需要跟配置文件路径');
    }
    if (a.startsWith('--config=')) {
      const v = a.slice('--config='.length);
      if (!v) fail('--config 后需要跟配置文件路径');
      return path.resolve(v);
    }
  }
  return undefined;
}

/**
 * 配置加载优先级：默认值 < 配置文件（--config 或 WEB_BRIDGE_CONFIG）< 环境变量。
 */
export function loadConfig(argv: string[], env: EnvMap = process.env): BridgeConfig {
  const filePath = cliConfigPath(argv) ?? env.WEB_BRIDGE_CONFIG;
  const cfg = filePath ? mergeFileConfig(readConfigFile(filePath)) : { ...DEFAULT_CONFIG };
  applyEnv(cfg, env);
  return cfg;
}
