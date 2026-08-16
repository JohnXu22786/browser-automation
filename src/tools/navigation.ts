import { z } from 'zod';
import { WAIT_UNTILS, type WaitUntil } from '../config.js';
import { ToolError } from '../errors.js';
import { guardTimeout, parseEnum, validatePageUrl } from '../util.js';
import {
  type ToolDef,
  settle,
  navigationTimeout,
  zTimeout,
} from './common.js';

function waitUntilOf(value: unknown): WaitUntil | undefined {
  return value === undefined
    ? undefined
    : parseEnum(value, WAIT_UNTILS, 'wait_until');
}

const zWaitUntil = z
  .enum(WAIT_UNTILS)
  .optional()
  .describe('等待策略：commit=请求已发出 / domcontentloaded=DOM 就绪 / load=资源加载完成 / networkidle=网络空闲');

export const navigationTools: ToolDef[] = [
  {
    name: 'web_open',
    title: '打开页面',
    description:
      '在活动标签页中导航到指定 URL（无标签页时自动新建）。可选用更细的等待策略控制返回时机，适用于需要等待单页应用渲染完成或网络请求全部结束的场景。',
    permission: '发起真实网络请求并渲染目标页面；请确保目标站点允许自动化访问。',
    schema: {
      url: z.string().min(1).describe('要打开的完整 URL，支持 http/https/file/data'),
      wait_until: zWaitUntil,
      timeout: zTimeout('60 秒'),
    },
    handler: async (ctx, args) => {
      const url = validatePageUrl(args.url);
      const { tabId, url: finalUrl, title } = await ctx.session.open(url, {
        waitUntil: waitUntilOf(args.wait_until),
        timeout: navigationTimeout(ctx.config, args.timeout),
      });
      await settle(ctx.session.currentPage(), ctx.config);
      return { text: `navigated to ${finalUrl}\ntitle: ${title}\ntab: ${tabId}` };
    },
  },
  {
    name: 'web_back',
    title: '后退',
    description: '在活动标签页中后退到上一页历史记录。',
    permission: '触发浏览器历史导航，可能重新加载页面。',
    schema: {
      wait_until: zWaitUntil,
      timeout: zTimeout('60 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const result = await guardTimeout(
        page.goBack({ waitUntil: waitUntilOf(args.wait_until), timeout: navigationTimeout(ctx.config, args.timeout) }),
        '后退'
      );
      if (result === null) throw new ToolError('没有可后退的历史记录', 'state');
      await settle(page, ctx.config);
      return { text: `back to ${page.url()}` };
    },
  },
  {
    name: 'web_forward',
    title: '前进',
    description: '在活动标签页中前进到下一页历史记录。',
    permission: '触发浏览器历史导航，可能重新加载页面。',
    schema: {
      wait_until: zWaitUntil,
      timeout: zTimeout('60 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const result = await guardTimeout(
        page.goForward({ waitUntil: waitUntilOf(args.wait_until), timeout: navigationTimeout(ctx.config, args.timeout) }),
        '前进'
      );
      if (result === null) throw new ToolError('没有可前进的历史记录', 'state');
      await settle(page, ctx.config);
      return { text: `forward to ${page.url()}` };
    },
  },
  {
    name: 'web_refresh',
    title: '刷新',
    description: '重新加载活动标签页。',
    permission: '重新请求当前页面全部资源。',
    schema: {
      wait_until: zWaitUntil,
      timeout: zTimeout('60 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      await guardTimeout(
        page.reload({ waitUntil: waitUntilOf(args.wait_until), timeout: navigationTimeout(ctx.config, args.timeout) }),
        '刷新'
      );
      await settle(page, ctx.config);
      return { text: `refreshed ${page.url()}` };
    },
  },
];
