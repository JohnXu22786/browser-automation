import { ToolError } from './errors.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析正整数参数（数字或数字字符串）。
 * 校验失败抛 ToolError('invalid')。
 */
export function parsePositiveInt(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > max) {
    throw new ToolError(`${name} 必须是 1 ~ ${max} 之间的整数`, 'invalid');
  }
  return n;
}

/** 解析非负整数参数（0 表示不限制）。 */
export function parseNonNegativeInt(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) {
    throw new ToolError(`${name} 必须是 0 ~ ${max} 之间的整数`, 'invalid');
  }
  return n;
}

/** 解析枚举参数，非法值抛 ToolError('invalid')。 */
export function parseEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new ToolError(`${name} 必须是以下值之一：${allowed.join('、')}`, 'invalid');
}

const SUPPORTED_PAGE_PROTOCOLS = ['http:', 'https:', 'file:', 'data:'];

/** 校验页面 URL：格式合法且协议受支持，返回规范化后的 URL 字符串。 */
export function validatePageUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') throw new ToolError('url 不能为空', 'invalid');
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ToolError(`url 格式无效：${url}`, 'invalid');
  }
  if (!SUPPORTED_PAGE_PROTOCOLS.includes(parsed.protocol)) {
    throw new ToolError(`不支持的协议 ${parsed.protocol}（仅支持 http/https/file/data）`, 'invalid');
  }
  return url;
}

/**
 * 把 Playwright 的超时错误转换为 ToolError('timeout')，
 * 其余错误原样抛出。
 */
export async function guardTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof Error && /Timeout \d+ms exceeded/i.test(err.message)) {
      throw new ToolError(`操作超时（${what}）：${err.message}`, 'timeout');
    }
    throw err;
  }
}
