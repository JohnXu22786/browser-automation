#!/usr/bin/env node
import { loadConfig, ConfigError, type BridgeConfig } from './config.js';
import { startServer, SERVER_NAME, VERSION } from './server.js';

const USAGE = `${SERVER_NAME} v${VERSION} — 使用真实浏览器的自动化 MCP server（dsh 插件）

用法:
  web-bridge [--config <配置文件>]

选项:
  --config <path>   配置文件路径（也可用环境变量 WEB_BRIDGE_CONFIG）
  -h, --help        显示本帮助

环境变量（前缀 WEB_BRIDGE_，优先级高于配置文件）:
  BROWSER            浏览器引擎: chromium | firefox | webkit
  HEADLESS           无头模式: true/false
  VIEWPORT           视口尺寸，如 1280x720
  EXECUTABLE         浏览器可执行文件路径
  USER_DATA_DIR      用户数据目录（持久化登录态）
  PROXY              代理地址
  LOCALE / TIMEZONE  区域与时区
  USER_AGENT         自定义 User-Agent
  IGNORE_HTTPS_ERRORS  忽略证书错误: true/false
  SANDBOX            浏览器沙箱: true/false
  PERMISSIONS        授予权限，逗号分隔（如 geolocation,clipboard-read）
  ACTION_TIMEOUT     动作超时毫秒
  NAV_TIMEOUT        导航超时毫秒
  SETTLE_MS          动作后安定等待毫秒
  STORAGE_STATE      会话恢复文件路径
  TEST_ID_ATTR       testid= 选择器使用的属性名

说明: 通过 stdio 与 MCP 客户端通信，日志输出到 stderr。`;

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  let config: BridgeConfig;
  try {
    config = loadConfig(argv, process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[${SERVER_NAME}] 配置错误: ${err.message}`);
    } else {
      console.error(`[${SERVER_NAME}] 配置加载失败: ${err instanceof Error ? err.message : err}`);
    }
    process.exit(1);
  }

  startServer(config).catch((err) => {
    console.error(`[${SERVER_NAME}] 启动失败: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}

main();
