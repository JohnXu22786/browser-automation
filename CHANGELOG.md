# Changelog

All notable changes are tracked here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-08-16

Initial release of Web Bridge, a real-browser automation MCP server for dsh.

### Added

- Snapshot-driven interaction: `web_snapshot` renders the page as an
  accessibility-tree with numbered `ref`s for precise click/fill without
  selectors.
- Navigation and history: `web_open` / `web_back` / `web_forward` /
  `web_refresh`.
- Interaction: `web_click` / `web_fill` / `web_type` / `web_press` /
  `web_select` / `web_hover` / `web_scroll`.
- Observation: `web_screenshot` (viewport / full-page / element, PNG or JPEG,
  optional `save_to`), `web_snapshot`, `web_status`.
- Scripting: `web_evaluate` with result sanitization (circular references,
  BigInt, NaN, depth and length caps).
- Multi-tab and session: `web_tab_new` / `web_tab_list` / `web_tab_switch` /
  `web_tab_close`, `web_wait`, `web_resize`, `web_shutdown`.
- 22 tools total, all namespaced under `web_`, speaking MCP over stdio
  (Chromium/Firefox/WebKit via Playwright).
- dsh bundle: `package.json` declares `dsh.bundle`; `cordis.patch.yml`
  installs web-bridge into a dsh profile; `index.js` spawns the MCP server and
  re-exposes its tools to the harness (builds `dist/` on demand in a source
  checkout).

[0.1.0]: https://github.com/JohnXu22786/browser-automation/commits/