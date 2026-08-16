import { navigationTools } from './tools/navigation.js';
import { interactionTools } from './tools/interaction.js';
import { inspectionTools } from './tools/inspection.js';
import { scriptingTools } from './tools/scripting.js';
import { viewportTools } from './tools/viewport.js';
import { tabTools } from './tools/tabs.js';
import { waitingTools } from './tools/waiting.js';
import { lifecycleTools } from './tools/lifecycle.js';
import type { ToolDef } from './tools/common.js';

/** 全部工具定义。MCP server 与测试共用。 */
export function buildToolList(): ToolDef[] {
  return [
    ...navigationTools,
    ...interactionTools,
    ...inspectionTools,
    ...scriptingTools,
    ...viewportTools,
    ...tabTools,
    ...waitingTools,
    ...lifecycleTools,
  ];
}

export type { ToolDef } from './tools/common.js';
