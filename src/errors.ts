/**
 * 工具层错误类型。所有工具实现只抛出 ToolError，
 * 由 MCP server 层统一映射为协议错误码。
 */
export type ErrorKind = 'invalid' | 'not_found' | 'state' | 'timeout' | 'internal';

export class ToolError extends Error {
  readonly kind: ErrorKind;

  constructor(message: string, kind: ErrorKind = 'internal') {
    super(message);
    this.name = 'ToolError';
    this.kind = kind;
  }
}
