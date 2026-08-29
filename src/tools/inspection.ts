import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { takeSnapshot, type SnapshotRequest } from '../snapshot.js';
import { resolveLocator, resolveTarget } from '../locators.js';
import { ToolError } from '../errors.js';
import { guardTimeout, parseEnum, parseNonNegativeInt, parsePositiveInt } from '../util.js';
import { type ToolDef, actionTimeout, zTimeout } from './common.js';

export const inspectionTools: ToolDef[] = [
  {
    name: 'web_snapshot',
    title: '页面快照',
    description:
      '生成当前页面的无障碍树快照：包含标题、URL 与带引用编号（ref）的元素树。交互元素（按钮/链接/输入框等）带 [编号] 前缀，后续 web_click / web_fill 等工具可用该编号定位。快照只包含结构化信息，不包含像素图像。',
    permission: '只读操作，不产生网络请求；快照内容仅返回给调用方。',
    schema: {
      selector: z.string().min(1).optional().describe('只快照该选择器命中的子树'),
      max_depth: z.number().int().min(1).max(50).optional().describe('树的最大深度，默认 8'),
      max_nodes: z.number().int().min(1).max(10_000).optional().describe('节点总数上限，默认 600'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const tabId = ctx.session.currentTabId();
      const request: SnapshotRequest = {
        selector: typeof args.selector === 'string' ? args.selector : undefined,
        maxDepth: args.max_depth === undefined ? undefined : parsePositiveInt(args.max_depth, 'max_depth', 50),
        maxNodes: args.max_nodes === undefined ? undefined : parsePositiveInt(args.max_nodes, 'max_nodes', 10_000),
      };
      const result = await takeSnapshot(page, ctx.session, request);
      ctx.session.refsByTab.set(tabId, result.refs);
      return {
        text: `title: ${result.title}\nurl: ${result.url}\ntree:\n${result.text}`,
      };
    },
  },
  {
    name: 'web_screenshot',
    title: '截图',
    description:
      '截取当前页面（视口或整页）或指定元素（ref / selector）的图像，作为 MCP image 内容返回；可同时保存到本地文件。适合需要视觉确认的场合；日常结构化观察请优先使用 web_snapshot。',
    permission: '只读页面内容；若提供 save_to 参数会向本地文件系统写入文件（路径由调用方指定）。',
    schema: {
      ref: z.number().int().positive().optional().describe('只截取该引用编号命中的元素，与 selector 二选一'),
      selector: z.string().min(1).optional().describe('只截取该选择器命中的元素，与 ref 二选一'),
      format: z.enum(['png', 'jpeg']).optional().describe('图像格式，默认 png'),
      quality: z.number().int().min(0).max(100).optional().describe('jpeg 质量 0-100，默认 90'),
      full_page: z.boolean().optional().describe('截取整页而非视口，默认 false（仅对全页截图有效）'),
      save_to: z.string().min(1).optional().describe('同时保存到本地文件路径'),
      timeout: zTimeout('10 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const format = args.format === undefined ? 'png' : parseEnum(args.format, ['png', 'jpeg'] as const, 'format');
      const fullPage = args.full_page === true;
      const quality = args.quality === undefined ? undefined : parseNonNegativeInt(args.quality, 'quality', 100);
      const timeout = actionTimeout(ctx.config, args.timeout);
      const hasTarget = args.ref !== undefined || (typeof args.selector === 'string' && args.selector.trim() !== '');

      let buffer: Buffer;
      let targetDesc = '';
      if (hasTarget) {
        const tabId = ctx.session.currentTabId();
        const target = resolveTarget(page, ctx.session, tabId, args);
        targetDesc = ` of ${target.via}`;
        buffer = await guardTimeout(
          target.locator.screenshot({ type: format, quality: format === 'jpeg' ? quality : undefined, timeout }),
          `元素截图 ${target.via}`
        );
      } else {
        buffer = await guardTimeout(
          page.screenshot({ type: format, quality: format === 'jpeg' ? quality : undefined, fullPage, timeout }),
          '页面截图'
        );
      }

      let savedTo: string | undefined;
      if (typeof args.save_to === 'string' && args.save_to.trim() !== '') {
        savedTo = path.resolve(args.save_to.trim());
        await fs.promises.writeFile(savedTo, buffer);
      }

      const size = buffer.length;
      const text = `screenshot${targetDesc} (${format}, ${size} bytes)${savedTo ? `\nsaved to: ${savedTo}` : ''}`;
      return {
        text,
        image: { data: buffer.toString('base64'), mimeType: format === 'png' ? 'image/png' : 'image/jpeg' },
      };
    },
  },
  {
    name: 'web_status',
    title: '会话状态',
    description: '报告浏览器会话状态：是否运行、标签页列表（含 URL 与标题）、当前活动标签页。',
    permission: '只读操作。',
    schema: {},
    handler: async (ctx) => {
      const running = ctx.session.isRunning();
      const lines = [`running: ${running}`];
      if (running) {
        const { lines: tabLines, activeId } = await ctx.session.describeTabs();
        lines.push(`tabs: ${tabLines.length}`);
        lines.push(...tabLines);
        if (activeId) lines.push(`active: ${activeId}`);
      }
      return { text: lines.join('\n') };
    },
  },
];
