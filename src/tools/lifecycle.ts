import type { ToolDef } from './common.js';

export const lifecycleTools: ToolDef[] = [
  {
    name: 'web_shutdown',
    title: '关闭浏览器',
    description:
      '关闭浏览器实例并清理全部标签页与引用。之后任何操作都会自动重新启动浏览器。用于释放系统资源或清除会话痕迹。',
    permission: '关闭浏览器进程，当前会话的未保存状态（登录态等）将丢失。',
    schema: {},
    handler: async (ctx) => {
      await ctx.session.close();
      return { text: 'browser closed; the next call will relaunch it' };
    },
  },
];
