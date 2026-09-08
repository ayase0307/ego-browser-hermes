# ego-browser-hermes

Hermes-native MCP adapter for the [ego-lite](https://github.com/CitroLabs/ego-lite) agent browser. It gives Hermes an isolated Chromium task space with structured navigation, semantic snapshots, form interaction, screenshots, uploads, and downloads.

## Status

**v0.1.0 functional preview**

Verified on Windows with Node.js 22 and Hermes Agent:

- TypeScript typecheck passes
- 54 unit/integration tests pass
- MCP stdio `initialize` and `tools/list` smoke test passes
- Hermes discovers all 12 safe tools
- Real Chromium smoke opens `https://example.com`, reads page info and semantic content, captures a screenshot, and closes its task space

The original DSH sidebar/live-view UI has not been ported. This release focuses on the Hermes MCP tool surface and the vendored ego-lite runtime.

## Default tools

- `ego_browser_status`
- `ego_browser_space_open` / `ego_browser_space_close`
- `ego_browser_navigate`
- `ego_browser_snapshot` / `ego_browser_page_info`
- `ego_browser_click` / `ego_browser_fill` / `ego_browser_wait`
- `ego_browser_screenshot`
- `ego_browser_upload` / `ego_browser_download`

Raw JavaScript, CDP, arbitrary CLI scripts, and HTTP requests are disabled by default. They require `EGO_BROWSER_ENABLE_ADVANCED=true`; `EGO_BROWSER_TOOLS` can further restrict the exposed set.

## Build and verify

```bash
npm install
npm run verify
```

`npm run verify` runs typecheck, 54 tests, production build, and a real MCP JSON-RPC tool-discovery smoke test. The optional real-browser test is:

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

## Design and safety

- Local stdio MCP transport; Hermes remains the agent host.
- Browser calls are serialized per server process.
- Commands use `spawn()` with argv arrays, not shell interpolation.
- Upload files must exist and use absolute paths.
- Screenshot/download destinations must be absolute.
- Safe downloads do not execute arbitrary trigger JavaScript.
- The runtime cursor identifies itself as Hermes while respecting an explicit user override.

## Upstream and attribution

This project adapts work from `Fisfzy/dsh-ego-browser` and the vendored ego-lite runtime. Upstream notices and runtime patch history are preserved in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`runtime/PATCHES.md`](runtime/PATCHES.md).

## License

MIT. Review third-party notices before redistribution.
