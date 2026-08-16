import { z } from 'zod';
import { ToolError } from '../errors.js';
import { guardTimeout, parseEnum, parseNonNegativeInt, parsePositiveInt } from '../util.js';
import { resolveLocator, resolveTarget } from '../locators.js';
import { type ToolDef, settle, actionTimeout, zTimeout } from './common.js';

const zTarget = {
  ref: z.number().int().positive().optional().describe('最近一次快照中的引用编号，与 selector 二选一'),
  selector: z.string().min(1).optional().describe('CSS 选择器、text=关键词 或 testid=值，与 ref 二选一'),
};

const MOD_KEY_MAP: Record<string, 'Alt' | 'Control' | 'Meta' | 'Shift'> = {
  alt: 'Alt',
  control: 'Control',
  meta: 'Meta',
  shift: 'Shift',
};

/** 页面滚动时使用的 window 最小结构（避免引入 DOM lib）。 */
interface WinLike {
  scrollBy(o: { top?: number; left?: number; behavior?: string }): void;
  scrollTo(x: number, y: number): void;
  scrollX: number;
  scrollY: number;
  document: { documentElement: { scrollHeight: number } };
}

interface ScrollableElLike {
  scrollBy(o: { top?: number; left?: number; behavior?: string }): void;
  scrollTop: number;
  scrollHeight: number;
}

export const interactionTools: ToolDef[] = [
  {
    name: 'web_click',
    title: '点击',
    description:
      '点击页面元素。目标可以是快照引用（推荐，ref 编号见最近一次 web_snapshot 输出）或选择器。支持鼠标按钮、双击与修饰键组合。',
    permission: '向页面派发鼠标事件，可能触发跳转、表单提交或脚本副作用。',
    schema: {
      ...zTarget,
      button: z.enum(['left', 'right', 'middle']).optional().describe('鼠标按钮，默认 left'),
      click_count: z.number().int().min(1).max(10).optional().describe('点击次数，2 表示双击，默认 1'),
      modifiers: z
        .array(z.enum(['alt', 'control', 'meta', 'shift']))
        .optional()
        .describe('组合修饰键列表'),
      timeout: zTimeout('10 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const tabId = ctx.session.currentTabId();
      const target = resolveTarget(page, ctx.session, tabId, args);
      const button = args.button === undefined ? undefined : parseEnum(args.button, ['left', 'right', 'middle'] as const, 'button');
      const clickCount = args.click_count === undefined ? undefined : parsePositiveInt(args.click_count, 'click_count', 10);
      const modifiers =
        args.modifiers === undefined
          ? undefined
          : (args.modifiers as string[]).map((m) => {
              const mapped = MOD_KEY_MAP[m];
              if (!mapped) throw new ToolError(`未知修饰键：${m}`, 'invalid');
              return mapped;
            });
      await guardTimeout(
        target.locator.click({ button, clickCount, modifiers, timeout: actionTimeout(ctx.config, args.timeout) }),
        `点击 ${target.via}`
      );
      await settle(page, ctx.config);
      return { text: `clicked ${target.via}` };
    },
  },
  {
    name: 'web_fill',
    title: '填写输入',
    description:
      '清空并填写输入框/文本域/可编辑区域。目标是快照引用或选择器。填写后触发 input 与 change 事件。',
    permission: '修改页面表单数据，可能触发校验与提交逻辑。',
    schema: {
      ...zTarget,
      value: z.string().max(1_000_000).describe('要填入的完整内容（会先清空原内容）'),
      timeout: zTimeout('10 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const tabId = ctx.session.currentTabId();
      const target = resolveTarget(page, ctx.session, tabId, args);
      const value = typeof args.value === 'string' ? args.value : String(args.value ?? '');
      await guardTimeout(
        target.locator.fill(value, { timeout: actionTimeout(ctx.config, args.timeout) }),
        `填写 ${target.via}`
      );
      await settle(page, ctx.config);
      return { text: `filled ${target.via}` };
    },
  },
  {
    name: 'web_type',
    title: '键入文本',
    description: '向当前聚焦元素逐键输入文本，可模拟真实输入节奏。',
    permission: '发送键盘事件到当前页面。',
    schema: {
      text: z.string().max(10_000).describe('要键入的文本'),
      delay: z.number().int().min(0).max(1000).optional().describe('相邻按键间隔毫秒，默认 0'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const text = String(args.text ?? '');
      const delay = args.delay === undefined ? undefined : parseNonNegativeInt(args.delay, 'delay', 1000);
      await guardTimeout(page.keyboard.type(text, { delay }), '键入文本');
      await settle(page, ctx.config);
      return { text: `typed ${text.length} characters` };
    },
  },
  {
    name: 'web_press',
    title: '按键',
    description:
      '按下键盘按键（如 Enter、Escape、Tab、Control+a）。可先用 ref/selector 聚焦目标元素；未提供时作用于当前聚焦元素。',
    permission: '发送键盘事件到当前页面。',
    schema: {
      ...zTarget,
      key: z.string().min(1).describe('按键名，遵循 Playwright 按键规范，如 Enter / Control+a / F5'),
      timeout: zTimeout('10 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const tabId = ctx.session.currentTabId();
      const key = String(args.key ?? '');
      if (!key) throw new ToolError('key 不能为空', 'invalid');
      if (args.ref !== undefined || (typeof args.selector === 'string' && args.selector.trim() !== '')) {
        const target = resolveTarget(page, ctx.session, tabId, args);
        await guardTimeout(
          target.locator.focus({ timeout: actionTimeout(ctx.config, args.timeout) }),
          `聚焦 ${target.via}`
        );
      }
      await guardTimeout(page.keyboard.press(key), `按键 ${key}`);
      await settle(page, ctx.config);
      return { text: `pressed ${key}` };
    },
  },
  {
    name: 'web_select',
    title: '下拉选择',
    description: '在下拉列表（select）中选择一个或多个选项，可按 value 或按显示文本 label 选择。',
    permission: '修改页面表单数据。',
    schema: {
      ...zTarget,
      value: z.union([z.string().min(1), z.array(z.string().min(1))]).optional().describe('按选项 value 选择，与 label 二选一'),
      label: z.union([z.string().min(1), z.array(z.string().min(1))]).optional().describe('按选项显示文本选择，与 value 二选一'),
      timeout: zTimeout('10 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const tabId = ctx.session.currentTabId();
      const target = resolveTarget(page, ctx.session, tabId, args);
      const hasValue = args.value !== undefined;
      const hasLabel = args.label !== undefined;
      if (hasValue === hasLabel) {
        throw new ToolError('必须且只能提供 value 或 label 之一', 'invalid');
      }
      const values = args.value as string | string[] | undefined;
      const labels = args.label as string | string[] | undefined;
      type Selection = string | string[] | { label: string } | Array<{ label: string }>;
      const selection: Selection = hasValue
        ? Array.isArray(values)
          ? values.map((v) => String(v))
          : String(values)
        : Array.isArray(labels)
          ? labels.map((l) => ({ label: String(l) }))
          : { label: String(labels) };
      await guardTimeout(
        target.locator.selectOption(selection as never, { timeout: actionTimeout(ctx.config, args.timeout) }),
        `选择 ${target.via}`
      );
      await settle(page, ctx.config);
      return { text: `selected option in ${target.via}` };
    },
  },
  {
    name: 'web_hover',
    title: '悬停',
    description: '把鼠标移动到元素上方（常用于触发悬停菜单与提示）。',
    permission: '派发鼠标移动事件，可能触发 CSS 悬停效果。',
    schema: {
      ...zTarget,
      timeout: zTimeout('10 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const tabId = ctx.session.currentTabId();
      const target = resolveTarget(page, ctx.session, tabId, args);
      await guardTimeout(
        target.locator.hover({ timeout: actionTimeout(ctx.config, args.timeout) }),
        `悬停 ${target.via}`
      );
      return { text: `hovered ${target.via}` };
    },
  },
  {
    name: 'web_scroll',
    title: '滚动',
    description:
      '滚动页面或元素。direction=into_view 时将元素滚动到视野中央；提供 selector 时在元素内部滚动（或先将其带入视野）；未提供 selector 时滚动整个页面。',
    permission: '仅改变滚动位置，不产生网络请求。',
    schema: {
      direction: z
        .enum(['up', 'down', 'left', 'right', 'top', 'bottom', 'into_view'])
        .describe('滚动方向；top/bottom 直达首尾；into_view 将元素滚入视野'),
      amount: z.number().int().min(1).max(100_000).optional().describe('步进像素，默认 600；top/bottom/into_view 忽略'),
      selector: z.string().min(1).optional().describe('目标元素（滚动其内部或将其带入视野）'),
      timeout: zTimeout('10 秒'),
    },
    handler: async (ctx, args) => {
      const page = ctx.session.currentPage();
      const direction = parseEnum(args.direction, ['up', 'down', 'left', 'right', 'top', 'bottom', 'into_view'] as const, 'direction');
      const amount = args.amount === undefined ? 600 : parsePositiveInt(args.amount, 'amount', 100_000);
      const selector = typeof args.selector === 'string' && args.selector.trim() !== '' ? args.selector : undefined;
      const timeout = actionTimeout(ctx.config, args.timeout);

      if (direction === 'into_view') {
        if (!selector) throw new ToolError('into_view 需要提供 selector', 'invalid');
        const locator = resolveLocator(page, selector, ctx.config.testIdAttribute);
        await guardTimeout(locator.scrollIntoViewIfNeeded({ timeout }), '滚动到视野');
        return { text: `scrolled ${selector} into view` };
      }

      if (selector) {
        const locator = resolveLocator(page, selector, ctx.config.testIdAttribute);
        await guardTimeout(
          locator.evaluate(
            (el, d) => {
              const target = d as { direction: string; amount: number };
              const elem = el as unknown as ScrollableElLike;
              switch (target.direction) {
                case 'up':
                  elem.scrollBy({ top: -target.amount, behavior: 'auto' });
                  break;
                case 'down':
                  elem.scrollBy({ top: target.amount, behavior: 'auto' });
                  break;
                case 'left':
                  elem.scrollBy({ left: -target.amount, behavior: 'auto' });
                  break;
                case 'right':
                  elem.scrollBy({ left: target.amount, behavior: 'auto' });
                  break;
                case 'top':
                  elem.scrollTop = 0;
                  break;
                case 'bottom':
                  elem.scrollTop = elem.scrollHeight;
                  break;
              }
            },
            { direction, amount }
          ),
          `滚动 ${selector}`
        );
        return { text: `scrolled ${direction} within ${selector}` };
      }

      await page.evaluate(
        (d) => {
          const target = d as { direction: string; amount: number };
          const w = globalThis as unknown as WinLike;
          switch (target.direction) {
            case 'up':
              w.scrollBy({ top: -target.amount, behavior: 'auto' });
              break;
            case 'down':
              w.scrollBy({ top: target.amount, behavior: 'auto' });
              break;
            case 'left':
              w.scrollBy({ left: -target.amount, behavior: 'auto' });
              break;
            case 'right':
              w.scrollBy({ left: target.amount, behavior: 'auto' });
              break;
            case 'top':
              w.scrollTo(0, 0);
              break;
            case 'bottom':
              w.scrollTo(0, w.document.documentElement.scrollHeight);
              break;
          }
        },
        { direction, amount }
      );
      const pos = (await page.evaluate(() => {
        const w = globalThis as unknown as WinLike;
        return { x: w.scrollX, y: w.scrollY };
      })) as { x: number; y: number };
      return { text: `scrolled ${direction} (position ${pos.x},${pos.y})` };
    },
  },
];
