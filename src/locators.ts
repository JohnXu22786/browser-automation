import type { Locator, Page } from 'playwright';
import { ToolError } from './errors.js';
import type { BrowserService } from './browser.js';
import { parsePositiveInt } from './util.js';

export type SelectorKind = 'css' | 'text' | 'testid';

export interface ParsedSelector {
  kind: SelectorKind;
  value: string;
}

/**
 * 解析选择器前缀：
 * - `text=关键词`   按文本匹配（子串，不区分大小写规则遵循浏览器实现）
 * - `testid=值`     按测试标识属性匹配
 * - 其他            视为 CSS 选择器
 */
export function parseSelector(raw: string): ParsedSelector {
  const s = raw.trim();
  if (s.startsWith('text=')) return { kind: 'text', value: s.slice('text='.length).trim() };
  if (s.startsWith('testid=')) return { kind: 'testid', value: s.slice('testid='.length).trim() };
  return { kind: 'css', value: raw };
}

function cssStringEscape(v: string): string {
  // 转义反斜杠与双引号；控制字符在 CSS 字符串字面量中非法，替换为空格
  return v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, ' ');
}

export function resolveLocator(page: Page, raw: string, testIdAttribute: string): Locator {
  const parsed = parseSelector(raw);
  switch (parsed.kind) {
    case 'text':
      return page.getByText(parsed.value, { exact: false });
    case 'testid':
      return page.locator(`[${testIdAttribute}="${cssStringEscape(parsed.value)}"]`);
    default:
      return page.locator(parsed.value);
  }
}

export interface TargetArgs {
  ref?: unknown;
  selector?: unknown;
}

export interface ResolvedTarget {
  locator: Locator;
  /** 用于结果展示的来源描述，如 ref #3 或 selector "#login" */
  via: string;
}

/**
 * 解析动作目标：ref（快照引用）与 selector（文本/CSS/测试 id）二选一。
 * ref 必须来自最近一次快照，否则视为失效。
 */
export function resolveTarget(page: Page, session: BrowserService, tabId: string, args: TargetArgs): ResolvedTarget {
  const hasRef = args.ref !== undefined;
  const hasSelector = typeof args.selector === 'string' && args.selector.trim().length > 0;
  if (hasRef === hasSelector) {
    throw new ToolError('必须且只能提供 ref 或 selector 之一', 'invalid');
  }
  if (hasSelector) {
    return {
      locator: resolveLocator(page, args.selector as string, session.config.testIdAttribute),
      via: `selector "${args.selector}"`,
    };
  }
  const ref = parsePositiveInt(args.ref, 'ref');
  const refMap = session.refsByTab.get(tabId);
  const path = refMap?.get(ref);
  if (!path) {
    throw new ToolError(`引用 #${ref} 已失效（页面可能已变化），请重新获取快照`, 'not_found');
  }
  return { locator: page.locator(path), via: `ref #${ref}` };
}
