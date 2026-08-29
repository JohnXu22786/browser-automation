import { z } from 'zod';
import { resolveTarget } from '../locators.js';
import { classifyScript } from '../scripting.js';
import { ToolError } from '../errors.js';
import { guardTimeout, parseEnum, parsePositiveInt, sleep } from '../util.js';
import { type ToolDef, actionTimeout, navigationTimeout } from './common.js';

export const waitingTools: ToolDef[] = [
  {
    name: 'web_wait',
    title: '等待',
    description:
      '按条件等待页面达到预期状态：页面加载完成（load）、网络空闲（networkidle）、元素出现/消失（selector，支持 ref/selector）、URL 匹配（url）、JS 判定函数（fn）、或固定时长（sleep）。适合在页面渲染较慢或异步更新时同步状态。',
    permission: '只读操作（等待本身不产生网络请求）。',
    schema: {
      condition: z
        .enum(['load', 'networkidle', 'selector', 'url', 'sleep', 'fn'])
        .describe('等待条件；selector 需要配合 selector/state 或 ref，url 需要配合 url_pattern，sleep 需要配合 ms，fn 需要配合 script'),
      ref: z.number().int().positive().optional().describe('selector 条件的目标元素引用编号（与 selector 二选一）'),
      selector: z.string().min(1).optional().describe('selector 条件的目标元素选择器（与 ref 二选一）'),
      state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().describe('selector 条件的期望状态，默认 visible'),
      url_pattern: z.string().min(1).optional().describe('url 条件的匹配模式（glob 或字符串）'),
      script: z.string().min(1).optional().describe('fn 条件的 JS 判定表达式或函数（在页面上下文中返回真值时解除等待）'),
      arg: z.unknown().optional().describe('传给 fn 脚本的参数（可选）'),
      ms: z.number().int().min(1).max(3_600_000).optional().describe('sleep 条件的时长毫秒，默认 1000'),
      timeout: z.number().int().min(0).max(3_600_000).optional().describe('等待超时毫秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const condition = parseEnum(args.condition, ['load', 'networkidle', 'selector', 'url', 'sleep', 'fn'] as const, 'condition');

      switch (condition) {
        case 'load':
          await guardTimeout(
            page.waitForLoadState('load', { timeout: navigationTimeout(ctx.config, args.timeout) }),
            '等待页面加载完成'
          );
          break;
        case 'networkidle':
          await guardTimeout(
            page.waitForLoadState('networkidle', { timeout: navigationTimeout(ctx.config, args.timeout) }),
            '等待网络空闲'
          );
          break;
        case 'selector': {
          const tabId = ctx.session.currentTabId();
          const target = resolveTarget(page, ctx.session, tabId, args);
          const state = args.state === undefined ? 'visible' : parseEnum(args.state, ['attached', 'detached', 'visible', 'hidden'] as const, 'state');
          await guardTimeout(
            target.locator.waitFor({ state, timeout: actionTimeout(ctx.config, args.timeout) }),
            `等待元素 ${state}: ${target.via}`
          );
          break;
        }
        case 'url': {
          const pattern = typeof args.url_pattern === 'string' && args.url_pattern.trim() !== '' ? args.url_pattern : undefined;
          if (!pattern) throw new ToolError('url 条件需要提供 url_pattern', 'invalid');
          await guardTimeout(
            page.waitForURL(pattern, { timeout: navigationTimeout(ctx.config, args.timeout) }),
            `等待 URL 匹配 ${pattern}`
          );
          break;
        }
        case 'fn': {
          const script = typeof args.script === 'string' && args.script.trim() !== '' ? args.script.trim() : undefined;
          if (!script) throw new ToolError('fn 条件需要提供 script', 'invalid');
          const classified = classifyScript(script);
          const pageFn =
            classified.mode === 'fn'
              ? (classified.makeCall as never)
              : classified.mode === 'body'
                ? (classified.fn as never)
                : script;
          await guardTimeout(
            page.waitForFunction(pageFn, args.arg, { timeout: actionTimeout(ctx.config, args.timeout) }),
            `等待 JS 判定满足 ${script}`
          );
          break;
        }
        case 'sleep': {
          const ms = args.ms === undefined ? 1000 : parsePositiveInt(args.ms, 'ms', 3_600_000);
          await sleep(ms);
          break;
        }
      }
      return { text: `waited for ${condition}` };
    },
  },
];
