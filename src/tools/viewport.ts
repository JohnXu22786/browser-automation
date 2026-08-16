import { z } from 'zod';
import { guardTimeout, parsePositiveInt } from '../util.js';
import type { ToolDef } from './common.js';

export const viewportTools: ToolDef[] = [
  {
    name: 'web_resize',
    title: '调整视口',
    description: '调整浏览器视口尺寸（CSS 像素）。',
    permission: '只改变渲染视口，不产生网络请求。',
    schema: {
      width: z.number().int().min(1).max(10_000).describe('视口宽度'),
      height: z.number().int().min(1).max(10_000).describe('视口高度'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const width = parsePositiveInt(args.width, 'width', 10_000);
      const height = parsePositiveInt(args.height, 'height', 10_000);
      await guardTimeout(page.setViewportSize({ width, height }), '调整视口');
      return { text: `viewport resized to ${width}x${height}` };
    },
  },
];
