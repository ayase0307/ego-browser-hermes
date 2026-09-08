# Hermes ego-browser MCP Adapter Implementation Plan

> **For agentic workers:** Use this plan task-by-task with tests and verification after each task.

**Goal:** 將 `dsh-ego-browser` 的 ego-lite 瀏覽器核心改造成可由 Hermes 透過本機 stdio MCP 使用的獨立工具包。

**Architecture:** 保留 `runtime/ego-linux`、Windows Chrome 探測、task-space、CDP 與既有瀏覽器腳本邏輯；移除 DSH-only host/client/settings 依賴，新增 Node.js MCP stdio server。先提供安全核心工具，危險的 raw CDP/JS/CLI 工具必須透過明確設定才暴露。第一版不移植 DSH sidebar UI，提供可選 localhost viewer 的乾淨邊界。

**Tech Stack:** Node.js >=22, TypeScript, MCP TypeScript SDK, Vitest, pnpm/corepack.

**Spec:** 本檔案。

## Global Constraints

- Hermes integration MUST be a standalone MCP stdio server; do not modify Hermes core.
- Preserve the vendored ego-lite runtime and record runtime changes in `runtime/PATCHES.md`.
- Default exposed tools MUST exclude raw `cli`, `cdp`, `js`, and unrestricted HTTP execution.
- All browser-mutating calls MUST remain serialized by one lock per server process.
- Every tool result MUST be structured JSON/text and must preserve meaningful runtime errors.
- Paths must work on Windows; use `process.platform`, `path`, and `os.homedir()` rather than POSIX-only assumptions.
- Do not claim Hermes installation until typecheck, unit tests, build, MCP smoke test, and Hermes tool discovery all pass.

### Task 1: Establish Hermes MCP package boundary

**Files:**
- Modify: `package.json`
- Create: `mcp-server/src/types.ts`
- Create: `mcp-server/src/index.ts`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/vitest.config.ts`
- Test: `mcp-server/tests/server-shape.test.ts`

- [ ] Add the MCP SDK and scripts `mcp:typecheck`, `mcp:test`, `mcp:build`, `mcp:smoke` without breaking existing DSH scripts.
- [ ] Define `McpConfig`, `EgoRunner`, and normalized result/error types.
- [ ] Create a stdio server entrypoint that starts without opening HTTP ports and registers a minimal `ego_browser_status` tool.
- [ ] Add a test proving the server module can construct its tool registry without launching Chrome.

### Task 2: Extract reusable ego runtime runner

**Files:**
- Create: `mcp-server/src/runtime/runner.ts`
- Create: `mcp-server/src/runtime/config.ts`
- Create: `mcp-server/src/runtime/lock.ts`
- Create: `mcp-server/src/runtime/sentinel.ts`
- Test: `mcp-server/tests/runner.test.ts`
- Test: `mcp-server/tests/config.test.ts`

- [ ] Port the existing `runEgoScript`, sentinel parsing, bounded stdout/stderr handling, timeout/cancellation, warmup retry, and Chrome discovery behavior into focused modules.
- [ ] Replace DSH `ctx.subprocess` with `child_process.spawn`/`execFile` using argv arrays, never shell interpolation.
- [ ] Resolve the vendored runtime path relative to the built server, with an explicit `EGO_BROWSER_BIN` override.
- [ ] Preserve user-provided Chrome path and args; make profile/data directory configurable and isolated by default.
- [ ] Write failing unit tests for sentinel success, missing sentinel, non-zero exit, timeout, and lock serialization; then implement and run them.

### Task 3: Port safe core browser tools

**Files:**
- Create: `mcp-server/src/tools/spaces.ts`
- Create: `mcp-server/src/tools/navigation.ts`
- Create: `mcp-server/src/tools/interaction.ts`
- Create: `mcp-server/src/tools/observation.ts`
- Modify: `mcp-server/src/index.ts`
- Test: `mcp-server/tests/tool-schemas.test.ts`
- Test: `mcp-server/tests/tool-handlers.test.ts`

- [ ] Port only these default tools with Hermes/MCP names: `ego_browser_space_open`, `ego_browser_space_close`, `ego_browser_status`, `ego_browser_navigate`, `ego_browser_snapshot`, `ego_browser_page_info`, `ego_browser_click`, `ego_browser_fill`, `ego_browser_wait`, `ego_browser_screenshot`, `ego_browser_download`, `ego_browser_upload`.
- [ ] Use strict JSON schemas with bounded strings, numeric ranges, and required fields; reject malformed selectors/paths before spawning the runtime.
- [ ] Preserve task-space selection across calls within one MCP server process and return the selected space in results.
- [ ] Return screenshot/download artifacts as MCP-compatible content with explicit absolute paths where applicable.
- [ ] Add schema tests that assert dangerous tools are not in the default registry.

### Task 4: Add gated advanced tools and Hermes skill

**Files:**
- Create: `mcp-server/src/tools/advanced.ts`
- Modify: `mcp-server/src/index.ts`
- Create: `skills/ego-browser-hermes/SKILL.md`
- Create: `mcp.json`
- Test: `mcp-server/tests/security-surface.test.ts`

- [ ] Implement `ego_browser_js`, `ego_browser_cdp`, `ego_browser_cli`, and `ego_browser_http` only when `EGO_BROWSER_ENABLE_ADVANCED=true`; never enable them by default.
- [ ] Make `EGO_BROWSER_TOOLS` an optional comma-separated allowlist layered on top of the safe defaults.
- [ ] Write the skill with Hermes-native MCP usage, task-space reuse, verification after actions, captcha handoff, and cleanup guidance; do not instruct the model to use DSH or OpenClaw commands.
- [ ] Add portable `mcp.json` only if its command paths are package-relative and contain no secrets; otherwise document the explicit `config.yaml` entry instead.
- [ ] Test that advanced tools remain absent under default environment and appear only under the explicit opt-in.

### Task 5: Windows build, integration smoke test, and documentation

**Files:**
- Modify: `README.md`
- Create: `docs/HERMES.md`
- Create: `scripts/mcp-smoke.mjs`
- Modify: `.gitignore` if needed

- [ ] Add Windows setup using `corepack pnpm`, build commands, Hermes `mcp_servers` example, tool filtering, and isolated browser profile notes.
- [ ] Add a smoke script that starts the MCP server, sends initialize/list-tools JSON-RPC over stdin/stdout, and verifies the expected safe tool names without launching a browser.
- [ ] Run existing tests plus all MCP tests, typecheck, production build, and MCP smoke test from the cloned workspace.
- [ ] Verify no DSH-only imports remain in the MCP source, no secrets are committed, and package files include runtime artifacts.
- [ ] Produce a concise implementation report containing exact commands and exit codes; do not claim installation yet if any real-browser prerequisite is missing.

### Task 6: Hermes installation and read-back verification

**Files:**
- No source changes unless a verification defect is found.

- [ ] Install the verified local MCP server into the active Hermes profile using the documented Hermes CLI/config path, without hand-editing unrelated settings.
- [ ] Reload MCP and verify Hermes discovers the expected safe tool names.
- [ ] Run one real browser smoke task: open a static page, obtain page info/snapshot, take a screenshot, and close the task space.
- [ ] Read back Hermes MCP status/tool listing and the generated artifact path before reporting success.
- [ ] If verification fails, return to the smallest failing task, fix it, rerun the full relevant gate, and only then continue.
