import { z } from 'zod';
import { ToolError } from '../errors.js';
import { validatePageUrl } from '../util.js';
import { type ToolDef, navigationTimeout, zTimeout } from './common.js';

export const tabTools: ToolDef[] = [
  {
    name: 'web_tab_new',
    title: '新建标签页',
    description: '新建一个标签页，可带初始 URL；默认立即激活。',
    permission: '新建浏览器标签页并可能发起网络请求。',
    schema: {
      url: z.string().min(1).optional().describe('初始 URL（省略则打开空白页）'),
      activate_tab: z.boolean().optional().describe('创建后是否切换为活动标签页，默认 true'),
      timeout: zTimeout('60 秒'),
    },
    handler: async (ctx, args) => {
      const url = args.url === undefined ? undefined : validatePageUrl(args.url);
      const activate = args.activate_tab !== false;
      const id = await ctx.session.newTab(url, activate, {
        timeout: navigationTimeout(ctx.config, args.timeout),
      });
      return { text: `new tab: ${id}${activate ? ' (active)' : ''}` };
    },
  },
  {
    name: 'web_tab_list',
    title: '标签页列表',
    description: '列出全部标签页及其 URL 与标题。',
    permission: '只读操作。',
    schema: {},
    handler: async (ctx) => {
      const { lines } = await ctx.session.describeTabs();
      return { text: [`tabs: ${lines.length}`, ...lines].join('\n') };
    },
  },
  {
    name: 'web_tab_switch',
    title: '切换标签页',
    description: '切换活动标签页，后续动作作用到该标签页。',
    permission: '只读操作。',
    schema: {
      id: z.string().min(1).describe('标签页 id（见 web_tab_list 输出）'),
    },
    handler: async (ctx, args) => {
      const id = String(args.id ?? '');
      if (!id) throw new ToolError('id 不能为空', 'invalid');
      await ctx.session.switchTab(id);
      return { text: `switched to tab ${id}` };
    },
  },
  {
    name: 'web_tab_close',
    title: '关闭标签页',
    description: '关闭标签页（默认关闭当前活动标签页）。关闭当前页后自动切换到剩余的第一个标签页。',
    permission: '关闭浏览器标签页，未保存的表单数据将丢失。',
    schema: {
      id: z.string().min(1).optional().describe('要关闭的标签页 id，省略则关闭当前页'),
    },
    handler: async (ctx, args) => {
      const id = args.id === undefined ? undefined : String(args.id);
      const closedId = id ?? ctx.session.currentTabId();
      const remaining = await ctx.session.closeTab(id);
      const lines = [`closed tab ${closedId}`];
      if (remaining) lines.push(`active tab: ${remaining}`);
      else lines.push('no tabs left');
      return { text: lines.join('\n') };
    },
  },
];
