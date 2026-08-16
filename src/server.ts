import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ErrorCode,
  McpError,
  type ImageContent,
  type TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import type { BridgeConfig } from './config.js';
import { BrowserService } from './browser.js';
import { ToolError, type ErrorKind } from './errors.js';
import { buildToolList } from './registry.js';
import type { ToolContext } from './tools/common.js';

export const SERVER_NAME = 'web-bridge';
// 与 package.json 的 version 保持一致（升版时同步修改）
export const VERSION = '0.1.0';

function toMcpCode(kind: ErrorKind): ErrorCode {
  switch (kind) {
    case 'invalid':
    case 'not_found':
    case 'state':
      return ErrorCode.InvalidParams;
    default:
      return ErrorCode.InternalError;
  }
}

/**
 * 组装 MCP server：注册全部工具（不含传输层，便于测试）。
 */
export function createToolServer(config: BridgeConfig, session: BrowserService): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  for (const tool of buildToolList()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `${tool.description}\n\n权限说明：${tool.permission}`,
        inputSchema: tool.schema,
      },
      async (args) => {
        const ctx: ToolContext = { config, session };
        try {
          const result = await tool.handler(ctx, args as Record<string, unknown>);
          const content: Array<TextContent | ImageContent> = [];
          if (result.image) {
            content.push({ type: 'image', data: result.image.data, mimeType: result.image.mimeType });
          }
          content.push({ type: 'text', text: result.text });
          return { content };
        } catch (err) {
          if (err instanceof ToolError) {
            throw new McpError(toMcpCode(err.kind), err.message);
          }
          const message = err instanceof Error ? err.message : String(err);
          throw new McpError(ErrorCode.InternalError, `内部错误：${message}`);
        }
      }
    );
  }
  return server;
}

/**
 * 启动 MCP server：stdio 传输 + 生命周期清理。
 */
export async function startServer(config: BridgeConfig): Promise<void> {
  const session = new BrowserService(config);
  const server = createToolServer(config, session);

  const transport = new StdioServerTransport();
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // 关闭浏览器并等待；给浏览器关闭过程一个兜底时限，防止僵尸进程阻塞退出
    await Promise.race([
      session.close(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]).catch(() => undefined);
    process.exit(0);
  };

  // 客户端断开（stdin EOF）时关闭浏览器并退出。
  // 注意：SDK 的 StdioServerTransport 不把 EOF 映射为 onclose，必须直接监听 stdin。
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('close', () => void shutdown());
  // 显式调用 transport.close() 的场景（如 Web 层复用）兜底
  transport.onclose = () => {
    void shutdown();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await server.connect(transport);
}
