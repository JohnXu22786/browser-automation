import type { Page } from 'playwright';
import { compileElementWalker, compilePageWalker } from './walker.js';
import { ToolError } from './errors.js';
import { resolveLocator } from './locators.js';
import type { BrowserService } from './browser.js';

export interface RawNode {
  role: string;
  name?: string;
  level?: number;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  password?: boolean;
  value?: string;
  hint?: string;
  /** 交互元素的绝对 CSS 路径，用作 ref 的持久化地址 */
  path?: string;
  children?: RawNode[];
}

export interface SnapshotRequest {
  /** 只快照该选择器命中的子树 */
  selector?: string;
  /** 树的最大深度（显示与遍历均截断） */
  maxDepth?: number;
  /** 节点总数上限，防止超大页面产生 token 炸弹 */
  maxNodes?: number;
}

export interface SnapshotResult {
  refs: Map<number, string>;
  text: string;
  title: string;
  url: string;
}

interface WalkerOutput {
  nodes: RawNode[];
  truncated: boolean;
  maxNodes: number;
}

export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_MAX_NODES = 600;

/** 在页面中执行遍历器，构建无障碍树快照。 */
export async function takeSnapshot(
  page: Page,
  session: BrowserService,
  request: SnapshotRequest
): Promise<SnapshotResult> {
  const maxDepth = request.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = request.maxNodes ?? DEFAULT_MAX_NODES;
  const opts = { maxNodes, maxDepth };

  let out: WalkerOutput;
  if (request.selector !== undefined) {
    const locator = resolveLocator(page, request.selector, session.config.testIdAttribute);
    const handle = await locator.elementHandle().catch(() => null);
    if (!handle) {
      throw new ToolError(`找不到元素：${request.selector}`, 'not_found');
    }
    out = (await handle.evaluate(compileElementWalker() as never, opts)) as WalkerOutput;
  } else {
    out = (await page.evaluate(compilePageWalker() as never, opts)) as WalkerOutput;
  }

  const refs = collectRefs(out.nodes);
  const treeText = formatTree(out.nodes, { maxDepth });
  const note = out.truncated ? `\n…（节点过多，快照已在 ${out.maxNodes} 个节点处截断）` : '';
  return {
    refs,
    text: treeText + note,
    title: await page.title(),
    url: page.url(),
  };
}

/** 按文档顺序为带 path 的节点分配 1 起始的引用号。 */
export function collectRefs(nodes: RawNode[]): Map<number, string> {
  const refs = new Map<number, string>();
  let next = 1;
  const walk = (list: RawNode[]): void => {
    for (const n of list) {
      if (n.path) {
        refs.set(next, n.path);
        next += 1;
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return refs;
}

interface FormatOptions {
  maxDepth?: number;
}

/** 把树格式化为带缩进与状态标注的文本。 */
export function formatTree(nodes: RawNode[], opts: FormatOptions = {}): string {
  const maxDepth = opts.maxDepth ?? Infinity;
  const lines: string[] = [];
  const refCount = { n: 0 };

  const walk = (list: RawNode[], depth: number): void => {
    for (const n of list) {
      lines.push(lineFor(n, depth, refCount));
      if (n.children?.length && depth < maxDepth) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return lines.join('\n');
}

function lineFor(node: RawNode, depth: number, refCount: { n: number }): string {
  const parts: string[] = [];
  if (node.path) {
    refCount.n += 1;
    parts.push(`[${refCount.n}]`);
  }
  parts.push(node.role);
  if (node.name) parts.push(`"${node.name}"`);
  if (node.level !== undefined) parts.push(`(level: ${node.level})`);
  if (node.checked !== undefined) parts.push(node.checked ? '(checked)' : '(unchecked)');
  if (node.disabled) parts.push('(disabled)');
  if (node.selected) parts.push('(selected)');
  if (node.expanded !== undefined) parts.push(node.expanded ? '(expanded)' : '(collapsed)');
  if (node.password) parts.push('(password)');
  if (node.value !== undefined) parts.push(`(value: "${node.value}")`);
  if (node.hint !== undefined) parts.push(`(placeholder: "${node.hint}")`);
  return '  '.repeat(depth) + parts.join(' ');
}
