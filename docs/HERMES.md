# Hermes installation

`ego-browser-hermes` exposes the vendored ego-lite runtime to Hermes as a local stdio MCP server. The default surface contains seventeen safe tools. Raw JavaScript, CDP, arbitrary CLI scripts, and HTTP requests are disabled by default.

## Requirements

- Node.js 22 or newer
- Chrome, Edge, Brave, or Chromium
- Hermes Agent with MCP support
- A checkout that includes `runtime/ego-linux/`

## Build and verify

From the repository root on this Windows installation:

```bash
PNPM='C:/Users/msdn/AppData/Local/hermes/node/node_modules/corepack/dist/pnpm.js'
node "$PNPM" install
node "$PNPM" mcp:typecheck
node "$PNPM" mcp:test
node "$PNPM" mcp:build
node "$PNPM" mcp:smoke
```

The smoke test performs a real MCP `initialize` and `tools/list` exchange over stdio without launching Chrome.

## Install into Hermes

Use the Hermes CLI rather than hand-editing `config.yaml`:

```bash
hermes mcp add ego_browser \
  --command C:/Users/msdn/AppData/Local/hermes/node/node.exe \
  --connect-timeout 30 \
  --env EGO_LINUX_DATA_DIR=D:/Users/msdn/Hermes/ego-browser-data \
  --args D:/Users/msdn/Hermes/workspaces/dsh-ego-browser/mcp-server/dist/index.js

hermes mcp test ego_browser
```

Hermes prefixes the tools with the server name. For example, MCP tool `status` becomes `mcp_ego_browser_status`. Tool names carry no `ego_browser_` prefix of their own; an `EGO_BROWSER_TOOLS` allowlist written with the old prefixed names is still accepted.

After adding the server, reload MCP in the active session or restart the gateway so long-lived Discord/Telegram sessions discover the new tools.

## Default safe tools

- `status`
- `space_open` (optionally with a `url`) / `space_close` / `space_list`
- `navigate` / `tabs`
- `snapshot` / `page_info`
- `click` / `fill` / `press` / `scroll` / `wait`
- `control` (hand control to the user / take it back)
- `screenshot`
- `upload` / `download`

## Artifact delivery

```text
EGO_BROWSER_OUTPUT_DIR=D:/Users/msdn/Hermes/ego-browser-out
```

Screenshots and downloads without an explicit path are written there. Point it at a directory the
Hermes host can read so long-lived Discord/Telegram sessions can attach the file to a reply; an
absolute path on the host machine is not a deliverable for a remote user. Without it, artifacts
stay wherever the runtime puts them.

## Advanced opt-in

Advanced tools remain absent unless explicitly enabled:

```text
EGO_BROWSER_ENABLE_ADVANCED=true
```

The advanced set is `js`, `cdp`, `cli`, and `http`. To expose only selected tools, set a comma-separated allowlist:

```text
EGO_BROWSER_TOOLS=status,snapshot,js
```

When an allowlist is present, no unlisted safe or advanced tool is registered. Advanced tools still require `EGO_BROWSER_ENABLE_ADVANCED=true` even if named in the allowlist.

## Security notes

- Child processes use `spawn()` with argv arrays; commands are not passed through a shell.
- `navigate` only accepts `http`/`https` URLs; `file:`, `javascript:`, `data:`, and `chrome://` are rejected before launch.
- A failed call (navigate, snapshot, click, fill, wait, screenshot, upload, download, or an advanced tool) does not change the active task space pointer.
- Browser-mutating calls are serialized within one MCP server process.
- Upload paths must be absolute and exist before the browser runs.
- Screenshot and download destination paths must be absolute.
- Safe downloads do not accept arbitrary trigger JavaScript.
- Keep advanced tools disabled unless a concrete task requires them; keyboard, scroll and dialog
  handling are part of the safe surface precisely so nobody enables `js`/`cdp` to press Enter.
- `control` hands the task space to the user and takes it back only when called
  explicitly; while the user holds control every other call fails with "user is controlling".
- Every tool call is its own runtime process. A native dialog blocks page JavaScript for any
  process that attaches afterwards, so `click`/`press` take `onDialog` to answer one in the same
  call; `snapshot` and `page_info` detect the blocked state and fail fast with that explanation.
