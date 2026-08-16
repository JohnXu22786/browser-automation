[简体中文](README.md)

# Web Bridge — Browser Automation MCP Server (dsh plugin)

Web Bridge is an automation MCP server that uses a **real browser**. It gives agents a browser's eyes and hands: open web pages, read page structure, click, fill forms, take screenshots, and execute scripts. Its core mechanism is the **accessibility-tree snapshot** — rendering the page into a structured text tree with numbered interactive elements, so agents can interact with pages precisely without a vision model.

- Language: TypeScript (Node.js ≥ 20), communicating over the MCP protocol (stdio transport)
- Browser engines: Chromium / Firefox / WebKit (Chromium by default)
- Tool count: 22, all named with the `web_` prefix

## Features

- **Snapshot driven**: `web_snapshot` produces an accessibility tree with reference numbers (ref), so elements can be clicked/filled precisely without guessing selectors
- **Real interactions**: click, double-click, right-click, key combos, form filling, dropdown selection, hover, scroll, keyboard input
- **Visual capabilities**: viewport / full-page / element screenshots (PNG/JPEG), returned to the caller or saved locally
- **Script execution**: run JS in the page context; results are sanitized (circular references, BigInt, NaN, etc. safely converted)
- **Multi-tab**: create, list, switch, and close tabs; popups are captured automatically
- **Fine-grained waiting**: wait by load state / element state / URL match / fixed duration
- **Session management**: lazy browser startup, `web_shutdown` releases resources, automatic cleanup on disconnect

## Installation

```bash
npm install          # install dependencies
npm run build        # compile to dist/
npx playwright install chromium   # install browser engine (required on first use)
```

> Firefox / WebKit engines are also supported: `npx playwright install firefox`, switchable via configuration.

## Quick Start

**Option A: generic MCP client (stdio)**

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

**Option B: command line verification**

```bash
node dist/index.js --help        # view usage
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' | node dist/index.js
```

**Option C: load as a dsh plugin (see next section)**

## Installing in DSH

```bash
dsh plugin --profile demo add github:JohnXu22786/browser-automation
```

Adds this plugin to the dsh `demo` profile from `github:JohnXu22786/browser-automation`. See the next section for authorization, loading, and lifecycle details.

## dsh Plugin Integration

This plugin follows the dsh "everything is a plugin" convention and describes itself via the `dsh-plugin.json` manifest in the root directory:

| Field | Value | Meaning |
|------|-----|------|
| `id` | `dsh.web-bridge` | Unique plugin identifier |
| `kind` | `mcp-server` | Plugin type: provides an MCP tool set |
| `entry` | `dist/index.js` | Entry file (run with `node dist/index.js`) |
| `transport` | `stdio` | Transport: MCP clients communicate with the plugin via stdin/stdout |
| `config.envPrefix` | `WEB_BRIDGE_` | Plugin config is injected via environment variables with this prefix |
| `tools` | 22 items | Tool list exposed by the plugin (name + title) |

**Harness loading flow** (the dsh runtime integrates the plugin as follows):

1. Scan the plugin directory, read `dsh-plugin.json`, validate `kind` / `entry` / `runtime`;
2. Check that the Node version satisfies `runtime.minVersion`;
3. Spawn the plugin process with `spawn('node', [entry])`, connecting stdin/stdout to the MCP protocol (JSON-RPC 2.0, line-delimited);
4. Map harness config to environment variables injected into the child process according to `config.envPrefix` (e.g. `actionTimeout` → `WEB_BRIDGE_ACTION_TIMEOUT`);
5. After the MCP client handshake (initialize / notifications/initialized / tools/list), the tools in the `tools` list enter the agent's tool set automatically; each tool's schema and permission description are provided by the plugin in the `tools/list` response;
6. When the session ends or the process exits, the harness closes stdin and the plugin recycles the browser and exits automatically (see "Lifecycle").

Any standard MCP client (that does not support manifest) can also connect directly as in Option A.

## Configuration

Priority: defaults < config file (`--config` or `WEB_BRIDGE_CONFIG`) < environment variables.

### Environment variables (prefix `WEB_BRIDGE_`)

| Variable | Default | Description |
|------|------|------|
| `WEB_BRIDGE_BROWSER` | `chromium` | Engine: `chromium` / `firefox` / `webkit` |
| `WEB_BRIDGE_HEADLESS` | `true` | Headless mode |
| `WEB_BRIDGE_VIEWPORT` | `1280x720` | Viewport size, e.g. `1440x900` |
| `WEB_BRIDGE_EXECUTABLE` | — | Custom browser executable path |
| `WEB_BRIDGE_USER_DATA_DIR` | — | User data directory (persistent context; login state survives across sessions) |
| `WEB_BRIDGE_PROXY` | — | Proxy address, e.g. `http://proxy:3128` |
| `WEB_BRIDGE_LOCALE` / `WEB_BRIDGE_TIMEZONE` | — | Locale and browser timezone |
| `WEB_BRIDGE_USER_AGENT` | — | Custom User-Agent |
| `WEB_BRIDGE_IGNORE_HTTPS_ERRORS` | `false` | Ignore certificate errors (debug only) |
| `WEB_BRIDGE_SANDBOX` | `true` | Browser sandbox; set to `false` when no sandbox in container |
| `WEB_BRIDGE_PERMISSIONS` | — | Permissions granted to the context, comma-separated (e.g. `geolocation,clipboard-read`) |
| `WEB_BRIDGE_ACTION_TIMEOUT` | `10000` | Per-action timeout (ms, `0` = unlimited) |
| `WEB_BRIDGE_NAV_TIMEOUT` | `60000` | Navigation timeout (ms, `0` = unlimited) |
| `WEB_BRIDGE_SETTLE_MS` | `500` | Wait for async tasks to settle after an action (ms) |
| `WEB_BRIDGE_STORAGE_STATE` | — | Session restore file path (non-persistent mode only) |
| `WEB_BRIDGE_TEST_ID_ATTR` | `data-testid` | Attribute name used by the `testid=` selector |
| `WEB_BRIDGE_CONFIG` | — | Config file path |

### Config file

```json
{
  "browser": { "name": "chromium", "headless": true, "viewport": { "width": 1280, "height": 720 } },
  "context": { "ignoreHTTPSErrors": false, "permissions": ["geolocation"] },
  "timeouts": { "action": 10000, "navigation": 60000, "settle": 500 },
  "sandbox": true,
  "testIdAttribute": "data-testid"
}
```

Start: `node dist/index.js --config web-bridge.config.json`.

## Tool List

Full tool descriptions and **permission notes** are returned by MCP `tools/list`; key points are listed here.

### Navigation

| Tool | Description | Permission impact |
|------|------|----------|
| `web_open` | Open a URL (supports `http/https/file/data`), optional wait strategy | Makes real network requests and renders the page |
| `web_back` / `web_forward` | History back / forward | Triggers navigation, may reload the page |
| `web_refresh` | Refresh current page | Re-requests all page resources |

### Interaction

| Tool | Description | Permission impact |
|------|------|----------|
| `web_click` | Click (ref/selector; supports button, double-click, modifier keys) | Dispatches mouse events, may trigger navigation/submit/scripts |
| `web_fill` | Clear and fill an input/textarea | Modifies form data, may trigger validation |
| `web_type` | Type keystrokes into the focused element | Sends keyboard events |
| `web_press` | Press keys (Enter, Control+a, etc.) | Sends keyboard events |
| `web_select` | Dropdown selection (by value or label) | Modifies form data |
| `web_hover` | Hover (triggers menus/tooltips) | Dispatches mouse-move events |
| `web_scroll` | Scroll page/element (up/down/left/right/top/bottom/into_view) | Only changes scroll position |

### Observation

| Tool | Description | Permission impact |
|------|------|----------|
| `web_snapshot` | Generate an accessibility-tree snapshot (ref numbers + state annotations) | Read-only, no network requests |
| `web_screenshot` | Screenshot (PNG/JPEG, viewport/full-page/element, can save locally) | Read-only page; `save_to` writes to caller-specified path |
| `web_status` | Session status: running state, tabs, current page | Read-only |

### Scripting and viewport

| Tool | Description | Permission impact |
|------|------|----------|
| `web_evaluate` | Run JS in the page context, returns sanitized result | **High risk**: can read/write page data, cookies, login state; can make network requests |
| `web_resize` | Resize the viewport | Only changes the rendered viewport |

### Tabs and session

| Tool | Description | Permission impact |
|------|------|----------|
| `web_tab_new` | Create a new tab (optional URL, optional activation) | Creates a tab; may make network requests |
| `web_tab_list` | List all tabs | Read-only |
| `web_tab_switch` | Switch the active tab | Read-only |
| `web_tab_close` | Close a tab (current by default) | Closes the tab; unsaved data is lost |
| `web_wait` | Wait: load / networkidle / selector / url / sleep | Read-only |
| `web_shutdown` | Close the browser and clean up the session | Closes the browser process; login state is lost |

## Snapshot and ref Mechanism

`web_snapshot` renders the page as an indented structured text, for example:

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

- `[n]` is a **reference number (ref)**, assigned only to interactive elements (buttons/links/inputs/dropdowns/checkboxes, etc.);
- Subsequent `web_click` / `web_fill` / `web_select` calls can locate elements by `ref` (`ref: 3`), or by selector (`selector: "#username"`, `text=keyword`, `testid=value`);
- The snapshot shows states: `(checked/unchecked)`, `(disabled)`, `(selected)`, `(expanded/collapsed)`, `(password)`, `(value: ...)`, `(placeholder: ...)`;
- The `value` of password boxes is never shown;
- The `selector` parameter snapshots only a subtree, `max_depth` limits depth, and `max_nodes` limits the total node count (protects against token bombs).

**ref is a positional path** (determined by the DOM structure): after navigation, old refs automatically become invalid (reporting an error and asking for a re-snapshot); if the page script adds/removes DOM without navigation, old refs may resolve to other elements — re-snapshot if an operation fails.

## Wait Strategies

`web_open`'s `wait_until`: `commit` (request sent) → `domcontentloaded` (DOM ready) → `load` (resources loaded) → `networkidle` (network idle). Default is `load`.

Actions wait for `settleMs` (500ms) by default so async tasks (navigation, requests) settle.

## Permissions and Security Notes

- This plugin is **not a security boundary**. `web_evaluate` can run arbitrary scripts, `web_open` can access any site, and `save_to` can write to any path — only use it in trusted environments, and configure per-tool permissions at the harness layer.
- Prefer least privilege: use `web_snapshot` for routine observation (zero network requests, zero side effects), `web_screenshot` when visual confirmation is needed, and only consider `web_evaluate` as a last resort.
- The browser process is managed by the plugin: client disconnect, `web_shutdown`, and SIGINT/SIGTERM all recycle the browser process.
- Headless mode is on by default; set `WEB_BRIDGE_HEADLESS=false` for visual debugging.

## Known Limitations

- **Shadow DOM / iframe content is not in snapshots**: the walker only covers the regular DOM subtree of the main document; if the page hosts interactive elements inside shadow DOM, use `web_evaluate` or the page's own test hooks (`testid=`).
- **ref is a positional path**: see "Snapshot and ref Mechanism" above.
- **Popups activate automatically**: new tabs opened via `target=_blank` etc. automatically become the active page (the agent's intuitive click behavior); use `web_tab_list` + `web_tab_switch` to get other tabs back.
- The statement-sequence form of `web_evaluate` (multi-statement including function declarations) executes for side effects and returns no value; expression and function forms return results. Use the `async` function form for async logic.

## Development and Testing

```bash
npm run build          # compile with tsc to dist/
npm test               # all tests (unit + browser integration + MCP protocol chain)
npm run test:unit      # unit tests only (config/tool functions/snapshot format/walker)
npm run test:integration  # browser integration tests only
```

Test coverage: config parsing, walker behavior, snapshot format, result sanitization, 16+ real browser integration scenarios (navigation/click/form fill/screenshot/tabs/history/wait/scroll/failure paths), and a real stdio process chain (including browser-recycle assertions after disconnect).

## Project Structure

```
src/
  index.ts       entry: CLI args, config loading, startup of the MCP server
  config.ts      config (three-level default/file/env merge and validation)
  server.ts      MCP server assembly, error mapping, lifecycle cleanup
  browser.ts     browser session: lazy start / tabs / ref table / shutdown
  walker.ts      page-side accessibility-tree walker (single source shared by Node tests and the page)
  snapshot.ts    snapshot orchestration, ref assignment, text formatting
  scripting.ts   script execution and result sanitization
  locators.ts    ref/selector resolution
  util.ts        argument validation, URL validation, timeout error classification
  tools/         22 tool implementations (grouped by responsibility)
  registry.ts    tool registry
dsh-plugin.json  plugin manifest (see README for dsh harness integration)
test/           tests and fixtures
```

## License

[MIT](LICENSE)