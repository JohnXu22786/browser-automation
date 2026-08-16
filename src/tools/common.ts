import { z, type ZodRawShape } from 'zod';
import type { Page } from 'playwright';
import type { BridgeConfig } from '../config.js';
import type { BrowserService } from '../browser.js';
import { parseNonNegativeInt, sleep } from '../util.js';

export interface ToolContext {
  config: BridgeConfig;
  session: BrowserService;
}

export interface ToolResult {
  text: string;
  image?: { data: string; mimeType: string };
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** 权限与影响说明：工具会对页面/网络产生什么影响 */
  permission: string;
  schema: ZodRawShape;
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

/** 动作触发异步工作后的安定等待。 */
export async function settle(page: Page, config: BridgeConfig): Promise<void> {
  if (config.settleMs > 0) await sleep(config.settleMs);
}

/** 解析调用级动作超时：0 表示不限制（与 Playwright timeout=0 语义一致）。 */
export function actionTimeout(config: BridgeConfig, timeout?: unknown): number {
  return timeout === undefined ? config.actionTimeoutMs : parseNonNegativeInt(timeout, 'timeout', 3_600_000);
}

/** 解析调用级导航超时：0 表示不限制。 */
export function navigationTimeout(config: BridgeConfig, timeout?: unknown): number {
  return timeout === undefined ? config.navigationTimeoutMs : parseNonNegativeInt(timeout, 'timeout', 3_600_000);
}

export const zTimeout = (defaultDesc: string) =>
  z.number().int().min(0).max(3_600_000).optional().describe(`超时毫秒数，默认 ${defaultDesc}，0 表示不限制`);
