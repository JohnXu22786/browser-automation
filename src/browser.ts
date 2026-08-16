import { randomUUID } from 'node:crypto';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from 'playwright';
import type { BridgeConfig, WaitUntil } from './config.js';
import { ToolError } from './errors.js';
import { guardTimeout } from './util.js';

export interface TabInfo {
  id: string;
  page: Page;
  url: string;
  active: boolean;
}

interface TabEntry {
  id: string;
  page: Page;
}

export interface OpenOptions {
  waitUntil?: WaitUntil;
  timeout?: number;
}

/**
 * 浏览器会话服务：负责浏览器实例的懒启动、标签页登记与引用表管理。
 * 一个插件进程共享一个浏览器实例与一个上下文（含持久化登录态）。
 */
export class BrowserService {
  readonly config: BridgeConfig;
  /** tabId -> ref 表（ref -> 元素绝对路径），快照时刷新 */
  readonly refsByTab = new Map<string, Map<number, string>>();

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private tabs = new Map<string, TabEntry>();
  private activeId: string | null = null;
  /** page -> tabId，用于防止 context 'page' 事件与显式登记重复注册 */
  private pageIds = new Map<Page, string>();
  /** 进行中的启动 promise：并发调用共享同一次启动，避免重复拉起浏览器 */
  private starting: Promise<BrowserContext> | null = null;
  /** 进行中的关闭 promise：关闭期间禁止新启动 */
  private closing: Promise<void> | null = null;

  constructor(config: BridgeConfig) {
    this.config = config;
  }

  isRunning(): boolean {
    return this.context !== null;
  }

  private engine(): BrowserType {
    switch (this.config.browserName) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      default:
        return chromium;
    }
  }

  private launchBase(): Record<string, unknown> {
    const opts: Record<string, unknown> = { headless: this.config.headless };
    if (this.config.executablePath) opts.executablePath = this.config.executablePath;
    if (!this.config.sandbox) opts.args = ['--no-sandbox'];
    return opts;
  }

  private contextOptions(): Record<string, unknown> {
    const opts: Record<string, unknown> = {
      viewport: this.config.viewport,
      ignoreHTTPSErrors: this.config.ignoreHTTPSErrors,
    };
    if (this.config.locale) opts.locale = this.config.locale;
    if (this.config.timezoneId) opts.timezoneId = this.config.timezoneId;
    if (this.config.proxy) opts.proxy = { server: this.config.proxy };
    if (this.config.userAgent) opts.userAgent = this.config.userAgent;
    return opts;
  }

  /** 懒启动浏览器与上下文（并发调用共享同一次启动），并登记已有页面。 */
  async ensureStarted(): Promise<BrowserContext> {
    // 关闭期间等待关闭完成，避免与清理中的旧实例并发启动
    if (this.closing) await this.closing;
    if (this.context) return this.context;
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<BrowserContext> {
    try {
      if (this.config.userDataDir) {
        // 持久化上下文：登录态保存在用户数据目录中
        this.context = await this.engine().launchPersistentContext(this.config.userDataDir, {
          ...this.launchBase(),
          ...this.contextOptions(),
        });
      } else {
        this.browser = await this.engine().launch(this.launchBase());
        this.context = await this.browser.newContext({
          ...this.contextOptions(),
          ...(this.config.storageState ? { storageState: this.config.storageState } : {}),
        });
      }

      if (this.config.permissions.length > 0) {
        await this.context.grantPermissions(this.config.permissions);
      }

      // 页面事件（如 target=_blank 弹出的新页）自动登记并激活
      this.context.on('page', (page) => {
        this.registerTab(page);
      });

      for (const page of this.context.pages()) {
        this.registerTab(page, { activate: this.activeId === null });
      }
      return this.context;
    } catch (err) {
      // 启动中途失败：回收已创建的浏览器/上下文，避免进程残留
      await this.browser?.close().catch(() => undefined);
      await this.context?.close().catch(() => undefined);
      this.browser = null;
      this.context = null;
      throw err;
    }
  }

  /** 登记页面；已在册时返回既有 id 并跳过（幂等）。 */
  private registerTab(page: Page, opts?: { activate?: boolean }): string {
    const existing = this.pageIds.get(page);
    if (existing !== undefined) return existing;
    const id = randomUUID();
    page.setDefaultTimeout(this.config.actionTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    this.pageIds.set(page, id);
    this.tabs.set(id, { id, page });
    if (opts?.activate ?? true) this.activeId = id;
    // 主文档导航后，旧快照的 ref 指向的内容已失效，立即清除
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.refsByTab.delete(id);
    });
    page.on('close', () => {
      this.tabs.delete(id);
      this.pageIds.delete(page);
      this.refsByTab.delete(id);
      if (this.activeId === id) {
        const first = this.tabs.values().next();
        this.activeId = first.done ? null : first.value.id;
      }
    });
    return id;
  }

  /** 返回页面对应的标签页 id，必要时登记。 */
  private tabIdOf(page: Page): string {
    return this.registerTab(page);
  }

  listTabs(): TabInfo[] {
    const tabs: TabInfo[] = [];
    for (const [id, entry] of this.tabs) {
      tabs.push({
        id,
        page: entry.page,
        url: entry.page.url(),
        active: id === this.activeId,
      });
    }
    return tabs;
  }

  currentTabId(): string {
    if (!this.activeId || !this.tabs.has(this.activeId)) {
      throw new ToolError('当前没有可用的标签页，请先使用 web_open 打开页面', 'state');
    }
    return this.activeId;
  }

  currentPage(): Page {
    return this.tabs.get(this.currentTabId())!.page;
  }

  pageById(id: string): Page {
    const entry = this.tabs.get(id);
    if (!entry) throw new ToolError(`标签页 ${id} 不存在`, 'not_found');
    return entry.page;
  }

  /** 在活动标签页导航；没有标签页时自动新建。 */
  async open(url: string, opts: OpenOptions = {}): Promise<{ tabId: string; url: string; title: string }> {
    const ctx = await this.ensureStarted();
    let page: Page | null = this.activeId ? this.tabs.get(this.activeId)?.page ?? null : null;
    if (!page) {
      page = await ctx.newPage();
      this.tabIdOf(page);
    }
    await guardTimeout(
      page.goto(url, {
        waitUntil: opts.waitUntil ?? 'load',
        timeout: opts.timeout ?? this.config.navigationTimeoutMs,
      }),
      '导航'
    );
    const tabId = this.currentTabId();
    return { tabId, url: page.url(), title: await page.title() };
  }

  /** 新建标签页，可选带 URL 导航。 */
  async newTab(url?: string, activate = true, opts: OpenOptions = {}): Promise<string> {
    const ctx = await this.ensureStarted();
    const previousActive = this.activeId;
    const page = await ctx.newPage();
    const id = this.tabIdOf(page);
    // context 'page' 事件可能已把新页设为活动页，这里按参数修正
    this.activeId = activate ? id : previousActive;
    if (url) {
      await guardTimeout(
        page.goto(url, {
          waitUntil: opts.waitUntil ?? 'load',
          timeout: opts.timeout ?? this.config.navigationTimeoutMs,
        }),
        '导航'
      );
    }
    return id;
  }

  async switchTab(id: string): Promise<void> {
    this.pageById(id);
    this.activeId = id;
  }

  /** 关闭标签页（默认当前页）；返回仍活动的标签页 id。 */
  async closeTab(id?: string): Promise<string | null> {
    const target = id ?? this.currentTabId();
    await this.pageById(target).close();
    // 活动页关闭时，close 事件处理器会自动切换到剩余的第一个标签页
    return this.activeId;
  }

  /** 关闭浏览器并清理全部状态；之后调用会重新启动。并发调用共享同一次关闭。 */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.doClose().finally(() => {
      this.closing = null;
    });
    return this.closing;
  }

  private async doClose(): Promise<void> {
    // 等待在途启动完成，避免与 close 竞争产生第二个实例
    if (this.starting) {
      await this.starting.catch(() => undefined);
    }
    this.refsByTab.clear();
    this.tabs.clear();
    this.pageIds.clear();
    this.activeId = null;
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;
    if (browser) {
      // 独立启动的浏览器：必须关掉浏览器进程，否则子进程会阻塞事件循环
      await guardTimeout(browser.close(), '关闭浏览器').catch(() => undefined);
    } else if (context) {
      await guardTimeout(context.close(), '关闭浏览器').catch(() => undefined);
    }
  }

  /** 格式化标签页列表行：`#n id — title — url (active)`。 */
  async describeTabs(): Promise<{ lines: string[]; activeId: string | null }> {
    const tabs = this.listTabs();
    const lines: string[] = [];
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const title = await t.page.title().catch(() => '');
      lines.push(`#${i + 1} ${t.id} — ${title} — ${t.url}${t.active ? ' (active)' : ''}`);
    }
    return { lines, activeId: this.activeId };
  }
}
