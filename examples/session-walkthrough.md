# 一次完整的 agent 会话走查

以下演示 agent 使用本插件完成「在演示站点登录并截图确认」的任务。
假设站点位于 `http://localhost:8080`（也可用 `test/fixtures/site/index.html` 通过任意静态服务器托管）。

## 1. 打开页面

```json
{ "name": "web_open", "arguments": { "url": "http://localhost:8080/index.html" } }
```

返回：`navigated to http://localhost:8080/index.html / title: Demo Home`

## 2. 获取页面快照（agent 的眼睛）

```json
{ "name": "web_snapshot", "arguments": {} }
```

返回（节选）：

```
title: Demo Home
url: http://localhost:8080/index.html
tree:
  navigation
    [1] link "首页"
    [2] link "文档"
  main
    heading "欢迎来到演示站点" (level: 1)
    form
      [3] textbox "用户名" (placeholder: "请输入用户名")
      [4] textbox "密码" (password) (placeholder: "请输入密码")
      [5] combobox "语言" (value: "中文")
      [6] checkbox "记住我" (unchecked)
      [7] button "提交表单"
```

## 3. 填表（用 ref 精确定位）

```json
{ "name": "web_fill", "arguments": { "ref": 3, "value": "agent-007" } }
{ "name": "web_fill", "arguments": { "ref": 4, "value": "s3cret" } }
{ "name": "web_select", "arguments": { "ref": 5, "value": "en" } }
{ "name": "web_click", "arguments": { "ref": 6 } }
```

## 4. 核对表单状态（脚本验证）

```json
{
  "name": "web_evaluate",
  "arguments": {
    "script": "() => ({ user: document.getElementById('username').value, lang: document.getElementById('lang').value })"
  }
}
```

返回：

```json
{
  "user": "agent-007",
  "lang": "en"
}
```

## 5. 截图确认（agent 的手眼协同）

```json
{ "name": "web_screenshot", "arguments": { "format": "png" } }
```

返回 MCP image 内容（base64 PNG），可同时 `"save_to": "C:/tmp/login.png"` 落盘。

## 6. 收尾

```json
{ "name": "web_shutdown", "arguments": {} }
```

## 失败路径示例

- **ref 失效**：导航后使用旧 ref → `引用 #3 已失效（页面可能已变化），请重新获取快照` → 重新 `web_snapshot`。
- **参数错误**：`web_click` 同时给 ref 和 selector → `必须且只能提供 ref 或 selector 之一`。
- **等待元素**：点击后目标由 JS 渲染 → `web_wait { condition: "selector", selector: "#result", state: "visible" }`。
