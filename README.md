# Web Bridge — 浏览器自动化 MCP server（dsh 插件）

Web Bridge 是一个使用**真实浏览器**的自动化 MCP server。它让 agent 拥有浏览器的眼睛和手：打开网页、读取页面结构、点击、填表、截图、执行脚本。核心机制是**无障碍树快照**——把页面渲染成结构化文本树并给可交互元素编号，agent 无需视觉模型即可精确操作页面。

- 语言：TypeScript（Node.js ≥ 20），通过 MCP 协议（stdio 传输）通信
- 浏览器引擎：Chromium / Firefox / WebKit（默认 Chromium）
- 工具数量：22 个，全部以 `web_` 前缀命名

## 功能特性

- **快照驱动**：`web_snapshot` 生成带引用编号（ref）的无障碍树，元素可被精确点击/填写，无需猜测选择器
- **真实交互**：点击、双击、右键、组合键、填表、下拉选择、悬停、滚动、键盘输入
- **视觉能力**：视口/整页/元素截图（PNG/JPEG），可返回给调用方或保存到本地
- **脚本执行**：在页面上下文执行 JS，结果自动净化（循环引用、BigInt、NaN 等安全转换）
- **多标签页**：新建、列出、切换、关闭标签页，弹窗自动接管
- **细粒度等待**：按加载状态 / 元素状态 / URL 匹配 / 固定时长等待
- **会话管理**：浏览器懒启动、`web_shutdown` 释放资源、断开连接自动清理

## 安装

```bash
npm install          # 安装依赖
npm run build        # 编译到 dist/
npx playwright install chromium   # 安装浏览器引擎（首次使用必需）
```

> 也支持 firefox / webkit 引擎：`npx playwright install firefox`，并通过配置切换。

## 快速开始

**方式一：通用 MCP 客户端（stdio）**

```json
{
  "mcpServers": {
    "web-bridge": {
      "command": "node",
      "args": ["D:/path/to/browser-automation/dist/index.js"]
    }
  }
}
```

**方式二：命令行验证**

```bash
node dist/index.js --help        # 查看用法
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' | node dist/index.js
```

**方式三：dsh 插件化加载（见下节）**

## dsh 插件接入说明

本插件遵循 dsh「一切皆是插件」的约定，通过根目录的 `dsh-plugin.json` 清单描述自身：

| 字段 | 值 | 含义 |
|------|-----|------|
| `id` | `dsh.web-bridge` | 插件唯一标识 |
| `kind` | `mcp-server` | 插件类型：提供 MCP 工具集 |
| `entry` | `dist/index.js` | 入口文件（`node dist/index.js` 直接运行） |
| `transport` | `stdio` | 传输方式：MCP 客户端通过标准输入输出与插件通信 |
| `config.envPrefix` | `WEB_BRIDGE_` | 插件配置通过该前缀的环境变量注入 |
| `tools` | 22 项 | 插件暴露的工具清单（名称 + 标题） |

**harness 加载流程**（dsh 运行时按以下步骤接入）：

1. 扫描插件目录，读取 `dsh-plugin.json`，校验 `kind` / `entry` / `runtime`；
2. 检查 Node 版本满足 `runtime.minVersion`；
3. 以 `spawn('node', [entry])` 拉起插件进程，stdin/stdout 接 MCP 协议（JSON-RPC 2.0，换行分隔）；
4. 依据 `config.envPrefix` 把 harness 配置映射为环境变量注入子进程（例如 `actionTimeout` → `WEB_BRIDGE_ACTION_TIMEOUT`）；
5. MCP 客户端握手（initialize / notifications/initialized / tools/list）后，`tools` 清单中的工具自动进入 agent 的工具集，每个工具的 schema 与权限说明由插件在 `tools/list` 响应中提供；
6. 会话结束或进程退出时，harness 关闭 stdin，插件自动回收浏览器并退出（见「生命周期」）。

任何标准的 MCP 客户端（不支持 manifest 的）也可直接按「方式一」接入。

## 配置

优先级：默认值 < 配置文件（`--config` 或 `WEB_BRIDGE_CONFIG`）< 环境变量。

### 环境变量（前缀 `WEB_BRIDGE_`）

| 变量 | 默认 | 说明 |
|------|------|------|
| `WEB_BRIDGE_BROWSER` | `chromium` | 引擎：`chromium` / `firefox` / `webkit` |
| `WEB_BRIDGE_HEADLESS` | `true` | 无头模式 |
| `WEB_BRIDGE_VIEWPORT` | `1280x720` | 视口尺寸，如 `1440x900` |
| `WEB_BRIDGE_EXECUTABLE` | — | 自定义浏览器可执行文件路径 |
| `WEB_BRIDGE_USER_DATA_DIR` | — | 用户数据目录（持久化上下文，登录态跨会话保留） |
| `WEB_BRIDGE_PROXY` | — | 代理地址，如 `http://proxy:3128` |
| `WEB_BRIDGE_LOCALE` / `WEB_BRIDGE_TIMEZONE` | — | 区域与浏览器时区 |
| `WEB_BRIDGE_USER_AGENT` | — | 自定义 User-Agent |
| `WEB_BRIDGE_IGNORE_HTTPS_ERRORS` | `false` | 忽略证书错误（仅调试） |
| `WEB_BRIDGE_SANDBOX` | `true` | 浏览器沙箱；容器内无沙箱时设 `false` |
| `WEB_BRIDGE_PERMISSIONS` | — | 授予上下文的权限，逗号分隔（如 `geolocation,clipboard-read`） |
| `WEB_BRIDGE_ACTION_TIMEOUT` | `10000` | 单次动作超时（毫秒，`0` 不限制） |
| `WEB_BRIDGE_NAV_TIMEOUT` | `60000` | 导航超时（毫秒，`0` 不限制） |
| `WEB_BRIDGE_SETTLE_MS` | `500` | 动作后等待异步任务安定的时长（毫秒） |
| `WEB_BRIDGE_STORAGE_STATE` | — | 会话恢复文件路径（仅非持久化模式） |
| `WEB_BRIDGE_TEST_ID_ATTR` | `data-testid` | `testid=` 选择器使用的属性名 |
| `WEB_BRIDGE_CONFIG` | — | 配置文件路径 |

### 配置文件

```json
{
  "browser": { "name": "chromium", "headless": true, "viewport": { "width": 1280, "height": 720 } },
  "context": { "ignoreHTTPSErrors": false, "permissions": ["geolocation"] },
  "timeouts": { "action": 10000, "navigation": 60000, "settle": 500 },
  "sandbox": true,
  "testIdAttribute": "data-testid"
}
```

启动：`node dist/index.js --config web-bridge.config.json`。

## 工具清单

全部工具的描述与**权限说明**由 MCP `tools/list` 返回，此处列要点。

### 导航

| 工具 | 说明 | 权限影响 |
|------|------|----------|
| `web_open` | 打开 URL（支持 `http/https/file/data`），可选等待策略 | 发起真实网络请求并渲染页面 |
| `web_back` / `web_forward` | 历史后退 / 前进 | 触发导航，可能重载页面 |
| `web_refresh` | 刷新当前页 | 重新请求页面全部资源 |

### 交互

| 工具 | 说明 | 权限影响 |
|------|------|----------|
| `web_click` | 点击（ref/selector；支持按钮、双击、修饰键） | 派发鼠标事件，可能触发跳转/提交/脚本 |
| `web_fill` | 清空并填写输入框/文本域 | 修改表单数据，可能触发校验 |
| `web_type` | 向聚焦元素逐键输入 | 发送键盘事件 |
| `web_press` | 按键（Enter、Control+a 等） | 发送键盘事件 |
| `web_select` | 下拉选择（按 value 或 label） | 修改表单数据 |
| `web_hover` | 悬停（触发菜单/提示） | 派发鼠标移动事件 |
| `web_scroll` | 滚动页面/元素（up/down/left/right/top/bottom/into_view） | 仅改变滚动位置 |

### 观察

| 工具 | 说明 | 权限影响 |
|------|------|----------|
| `web_snapshot` | 生成无障碍树快照（ref 编号 + 状态标注） | 只读，不产生网络请求 |
| `web_screenshot` | 截图（PNG/JPEG、视口/整页/元素、可保存本地） | 只读页面；`save_to` 会写入调用方指定路径 |
| `web_status` | 会话状态：运行状态、标签页、当前页 | 只读 |

### 脚本与视口

| 工具 | 说明 | 权限影响 |
|------|------|----------|
| `web_evaluate` | 页面上下文执行 JS，返回净化结果 | **高危**：可读写页面数据、cookie、登录态，可发起网络请求 |
| `web_resize` | 调整视口尺寸 | 只改变渲染视口 |

### 标签页与会话

| 工具 | 说明 | 权限影响 |
|------|------|----------|
| `web_tab_new` | 新建标签页（可带 URL、可选是否激活） | 新建标签页，可能发起网络请求 |
| `web_tab_list` | 列出全部标签页 | 只读 |
| `web_tab_switch` | 切换活动标签页 | 只读 |
| `web_tab_close` | 关闭标签页（默认当前页） | 关闭标签页，未保存数据丢失 |
| `web_wait` | 等待：load / networkidle / selector / url / sleep | 只读 |
| `web_shutdown` | 关闭浏览器并清理会话 | 关闭浏览器进程，登录态丢失 |

## 快照与 ref 机制

`web_snapshot` 把页面渲染为带缩进的结构化文本，例如：

```
title: Demo Home
url: http://localhost:8080/index.html
tree:
  banner
    navigation
      [1] link "首页"
      [2] link "文档"
  main
    heading "欢迎来到演示站点" (level: 1)
    form
      [3] textbox "用户名" (placeholder: "请输入用户名")
      [4] checkbox "记住我" (unchecked)
      [5] button "提交表单"
```

- `[n]` 是**引用编号（ref）**，只分配给可交互元素（按钮/链接/输入框/下拉框/复选框等）；
- 后续 `web_click` / `web_fill` / `web_select` 等可用 `ref` 定位（`ref: 3`），也可用选择器（`selector: "#username"`、`text=关键词`、`testid=值`）；
- 快照展示状态：`(checked/unchecked)`、`(disabled)`、`(selected)`、`(expanded/collapsed)`、`(password)`、`(value: ...)`、`(placeholder: ...)`；
- 密码框永不展示 `value`；
- 支持 `selector` 参数只快照子树、`max_depth` 限制深度、`max_nodes` 限制节点总数（防 token 炸弹）。

**ref 是位置型路径**（由 DOM 结构决定）：页面导航后旧 ref 自动失效（报错提示重新快照）；未导航时若页面脚本增删了 DOM，旧 ref 可能解析到其他元素——操作异常时请重新快照。

## 等待策略

`web_open` 的 `wait_until`：`commit`（请求发出）→ `domcontentloaded`（DOM 就绪）→ `load`（资源加载完成）→ `networkidle`（网络空闲）。默认 `load`。

动作后默认等待 `settleMs`（500ms）让异步任务（导航、请求）安定。

## 权限与安全说明

- 本插件**不是安全边界**。`web_evaluate` 可执行任意脚本、`web_open` 可访问任意站点、`save_to` 可写任意路径——请仅在可信环境中使用，并在 harness 层配置工具级权限。
- 建议最小化权限：日常观察用 `web_snapshot`（零网络请求、零副作用），需要视觉确认时用 `web_screenshot`，最后才考虑 `web_evaluate`。
- 浏览器进程由插件管理：客户端断开、`web_shutdown`、SIGINT/SIGTERM 都会回收浏览器进程。
- 无头模式默认开启；需要可视化调试时设置 `WEB_BRIDGE_HEADLESS=false`。

## 已知限制

- **影子 DOM / iframe 内容不在快照中**：遍历器只覆盖主文档的常规 DOM 子树；若页面依赖 shadow DOM 承载交互元素，请用 `web_evaluate` 或页面自身的测试钩子（`testid=`）。
- **ref 为位置路径**：见上文「快照与 ref 机制」。
- **弹窗自动激活**：`target=_blank` 等弹出的新标签页会自动成为活动页（agent 点击链路的直觉行为）；可通过 `web_tab_list` + `web_tab_switch` 找回其他标签页。
- `web_evaluate` 的语句序列形态（含函数声明的多语句）按副作用执行、无返回值；表达式与函数形态返回结果。异步逻辑请用 `async` 函数形态。

## 开发与测试

```bash
npm run build          # tsc 编译到 dist/
npm test               # 全部测试（单元 + 浏览器集成 + MCP 协议链路）
npm run test:unit      # 仅单元测试（配置/工具函数/快照格式/遍历器）
npm run test:integration  # 仅浏览器集成测试
```

测试覆盖：配置解析、遍历器行为、快照格式、结果净化、16+ 个真实浏览器集成场景（导航/点击/填表/截图/标签页/历史/等待/滚动/失败路径）、真实 stdio 进程链路（含断开后浏览器回收断言）。

## 项目结构

```
src/
  index.ts       入口：CLI 参数、配置加载、启动 MCP server
  config.ts      配置（默认值/文件/环境变量三级合并与校验）
  server.ts      MCP server 组装、错误映射、生命周期清理
  browser.ts     浏览器会话：懒启动/标签页/引用表/关闭
  walker.ts      页面端无障碍树遍历器（单一源码，Node 测试与页面共用）
  snapshot.ts    快照编排、ref 分配、文本格式化
  scripting.ts   脚本执行与结果净化
  locators.ts    ref/selector 解析
  util.ts        参数校验、URL 校验、超时错误归类
  tools/         22 个工具实现（按职责分组）
  registry.ts    工具注册表
dsh-plugin.json  插件清单（dsh harness 接入说明见 README）
test/           测试与夹具
```
