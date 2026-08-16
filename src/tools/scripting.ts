import { z } from 'zod';
import { runScript } from '../scripting.js';
import { ToolError } from '../errors.js';
import type { ToolDef } from './common.js';

export const scriptingTools: ToolDef[] = [
  {
    name: 'web_evaluate',
    title: '执行脚本',
    description:
      '在页面上下文中执行 JavaScript 并返回结果。支持三种形态：函数表达式（function / async function / 箭头函数，以 arg 为参数调用并返回其返回值）；表达式（返回求值结果）；语句序列（let/var 多语句，返回最后一个表达式的值；含函数声明的语句序列按副作用执行，不返回结果，如需返回值请改用块箭头函数 + return）。返回值为 JSON 安全结构（undefined→null，循环引用→[Circular]，NaN/Infinity→字符串，超长内容截断）。异步逻辑请使用 async 函数形态。',
    permission:
      '高危操作：在页面内执行任意 JavaScript，可读取/修改页面数据、发起网络请求、获取 cookie 与登录态。仅在信任的页面上使用。',
    schema: {
      script: z.string().min(1).describe('要执行的 JavaScript（函数表达式 / 语句序列 / 表达式）'),
      arg: z.unknown().optional().describe('传给函数形态脚本的参数（任意 JSON 值）'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const script = typeof args.script === 'string' ? args.script : '';
      if (!script.trim()) throw new ToolError('script 不能为空', 'invalid');
      const result = await runScript(page, script, args.arg);
      return { text: JSON.stringify(result, null, 2) };
    },
  },
];
