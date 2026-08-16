import type { Page } from 'playwright';
import { ToolError } from './errors.js';

const MAX_STRING = 2000;
const MAX_ARRAY = 200;
const MAX_DEPTH = 8;

/**
 * 把 evaluate 的任意返回值转换为 JSON 安全的结构：
 * - undefined / function / symbol → null
 * - NaN / ±Infinity → 字符串
 * - bigint → 安全整数则转 number，否则转字符串
 * - 循环引用 → "[Circular]"
 * - 深度超限 → "[DepthLimit]"
 * - 超长字符串截断、超大数组截断
 */
export function toJSONSafe(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[DepthLimit]';
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING - 1) + '…' : value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      const len = Math.min(value.length, MAX_ARRAY);
      // 显式索引遍历：保留数组空洞（转换为 null），.map 会跳过空洞
      for (let i = 0; i < len; i++) {
        items.push(toJSONSafe(value[i], seen, depth + 1));
      }
      if (value.length > MAX_ARRAY) items.push(`…（共 ${value.length} 项，截断显示 ${MAX_ARRAY} 项）`);
      result = items;
    } else {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>)) {
        out[key] = toJSONSafe((value as Record<string, unknown>)[key], seen, depth + 1);
      }
      result = out;
    }
    seen.delete(value);
    return result;
  }
  return String(value);
}

type ClassifiedScript =
  | {
      /** 函数表达式形态：页面内以 `(script)(arg)` 调用一次 */
      mode: 'fn';
      makeCall: Function;
    }
  | {
      /** 表达式形态：页面内直接求值（返回最后表达式的值） */
      mode: 'expr';
    }
  | {
      /** 语句序列形态：页面内以函数体执行（无返回值） */
      mode: 'body';
      fn: Function;
    };

/** 剥离 JS 注释（块注释与行注释），防止注释文本干扰形态判定。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

/**
 * 判定脚本形态。所有决策都在 Node 侧、页面执行之前完成，且 Node 侧
 * 只编译不执行，因此：
 * - Node 进程内不可能执行脚本副作用
 * - 页面内脚本最多执行一次（不存在失败重试路径）
 *
 * 形态规则（按优先级）：
 * 1. 函数表达式（function / async function / 箭头函数，非立即调用）
 *    → 页面内以 (script)(arg) 调用
 * 2. 合法表达式 → 页面内直接求值
 * 3. 合法语句序列 → 页面内以函数体执行（无返回值）
 * 4. 均不合法 → 抛 ToolError
 */
export function classifyScript(trimmed: string): ClassifiedScript {
  const fnLike =
    /^(?:async\s+)?function\b/.test(trimmed) ||
    /^(?:async\s+)?\([^)]*\)\s*=>/.test(trimmed) ||
    /^(?:async\s+)?[\w$]+\s*=>/.test(trimmed);

  if (fnLike) {
    // 剥离注释后检测立即调用/结尾调用/方法调用形态：这类脚本在 Node 侧
    // 求值会执行副作用，必须按代码在页面中求值
    const stripped = stripComments(trimmed);
    if (!/}\s*\(|\)\s*\([^)]*\)\s*$|\.\s*(?:call|apply)\s*\(/.test(stripped)) {
      try {
        // 仅编译验证：Node 侧零副作用
        new Function('arg', `return (${trimmed});`);
        const makeCall = new Function('argVal', `return (${trimmed})(argVal);`);
        return { mode: 'fn', makeCall };
      } catch {
        // 不是单一函数表达式（如 `function f(){} f()`）：落入语句序列判定
      }
    }
  }

  // 表达式形态：`(script)` 包装可编译
  try {
    new Function('arg', `return (${trimmed});`);
    return { mode: 'expr' };
  } catch {
    // 落入语句序列判定
  }

  // 语句序列形态：函数体可编译
  try {
    const fn = new Function('arg', trimmed) as (a: unknown) => unknown;
    return { mode: 'body', fn };
  } catch {
    throw new ToolError('script 语法无效，无法编译执行', 'invalid');
  }
}

/**
 * 在页面上下文中执行脚本并返回 JSON 安全结果。
 *
 * script 三种形态：
 * - 函数表达式（function / async function / 箭头函数）→ 以 arg 为参数调用并返回结果
 * - 表达式 → 直接求值并返回结果
 * - 语句序列（let/var、函数声明+调用等）→ 作为函数体执行，无返回值（如需结果请用表达式或函数形态）
 * 注意：异步逻辑请使用 async 函数形态。
 */
export async function runScript(page: Page, script: string, arg?: unknown): Promise<unknown> {
  const trimmed = script.trim();
  if (!trimmed) throw new ToolError('script 不能为空', 'invalid');

  const classified = classifyScript(trimmed);
  switch (classified.mode) {
    case 'fn':
      return toJSONSafe(await page.evaluate(classified.makeCall as never, arg));
    case 'expr':
      return toJSONSafe(await page.evaluate(trimmed, arg));
    case 'body':
      return toJSONSafe(await page.evaluate(classified.fn as never, arg));
  }
}
