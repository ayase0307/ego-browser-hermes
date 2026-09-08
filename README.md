# ego-browser-hermes

Hermes-native MCP adapter for the [ego-lite](https://github.com/CitroLabs/ego-lite) agent browser. It gives Hermes an isolated Chromium task space with structured navigation, semantic snapshots, form interaction, screenshots, uploads, and downloads.

## Status

**v0.2.0 functional preview**

Verified on Windows with Node.js 22 and Hermes Agent:

- TypeScript typecheck passes
- 74 unit/integration tests pass
- MCP stdio `initialize` and `tools/list` smoke test passes
- Hermes discovers all 18 safe tools
- Real Chromium smoke opens `https://example.com`, reads page info and semantic content, captures a screenshot, and closes its task space

The original DSH sidebar/live-view UI has not been ported. This release focuses on the Hermes MCP tool surface and the vendored ego-lite runtime.

## Default tools

18 safe tools. The keyboard, scroll, dialog and control tools exist so that ordinary
interactive work — submitting a search box, reaching lazy-loaded content, clearing a native
dialog, letting a human log in — never requires enabling the advanced surface.

- `ego_browser_status`
- `ego_browser_space_open` / `ego_browser_space_close` / `ego_browser_space_list`
- `ego_browser_navigate` / `ego_browser_tabs`
- `ego_browser_snapshot` / `ego_browser_page_info`
- `ego_browser_click` / `ego_browser_fill` / `ego_browser_press` / `ego_browser_scroll` / `ego_browser_wait`
- `ego_browser_dialog`
- `ego_browser_control` (hand control to the user / take it back)
- `ego_browser_screenshot`
- `ego_browser_upload` / `ego_browser_download`

Raw JavaScript, CDP, arbitrary CLI scripts, and HTTP requests are disabled by default. They require `EGO_BROWSER_ENABLE_ADVANCED=true`; `EGO_BROWSER_TOOLS` can further restrict the exposed set.

## Build and verify

```bash
npm install
npm run verify
```

`npm run verify` runs typecheck, 74 tests, production build, and a real MCP JSON-RPC tool-discovery smoke test.

`npm run sim` replays a Discord-shaped conversation (login wall, handoff to the human, takeover,
search submit, screenshot, download) against the real MCP server over stdio with a faked Chrome —
no browser required. The optional real-browser test is:

```bash
node scripts/real-browser-smoke.mjs
```

## Hermes installation

See [`docs/HERMES.md`](docs/HERMES.md). On the verified Windows setup:

```bash
hermes mcp add ego_browser \
  --command C:/Users/msdn/AppData/Local/hermes/node/node.exe \
  --connect-timeout 30 \
  --env EGO_LINUX_DATA_DIR=D:/Users/msdn/Hermes/ego-browser-data \
  --args D:/Users/msdn/Hermes/workspaces/dsh-ego-browser/mcp-server/dist/index.js

hermes mcp test ego_browser
```

The bundled skill lives at [`skills/ego-browser-hermes/SKILL.md`](skills/ego-browser-hermes/SKILL.md).

## Chat-host notes

Set `EGO_BROWSER_OUTPUT_DIR` to a directory the agent host can read. Screenshots and downloads
without an explicit path land there, so a Discord/Telegram session can attach the file instead of
quoting a path on a machine the user cannot see.

The active-space pointer lives in the server process and is shared by every chat that gateway
serves; the bundled skill therefore requires an explicit `space` on every call.

## Design and safety

- Local stdio MCP transport; Hermes remains the agent host.
- Browser calls are serialized per server process.
- Commands use `spawn()` with argv arrays, not shell interpolation.
- `navigate` only accepts `http`/`https` URLs; `file:`, `javascript:`, `data:`, and `chrome://` are rejected before launch.
- A failed call (navigate, snapshot, click, fill, wait, screenshot, upload, download, or an advanced tool) does not change the active task space.
- Upload files must exist and use absolute paths.
- Screenshot/download destinations must be absolute.
- Safe downloads do not execute arbitrary trigger JavaScript.
- The runtime cursor identifies itself as Hermes while respecting an explicit user override.
- Control handoff is explicit in both directions: `control` never takes the browser back on its own.
- A download that completes without producing a file is reported as an error, not as a success.

## Upstream and attribution

This project adapts work from `Fisfzy/dsh-ego-browser` and the vendored ego-lite runtime. Upstream notices and runtime patch history are preserved in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`runtime/PATCHES.md`](runtime/PATCHES.md).

## License

MIT. Review third-party notices before redistribution.
