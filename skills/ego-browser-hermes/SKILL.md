---
name: ego-browser-hermes
description: Use when browser automation needs login or interaction.
version: 0.1.0
metadata:
  hermes:
    tags: [browser, mcp, ego-lite, automation, authenticated-session]
---

# ego-browser for Hermes

Use the `mcp_ego_browser_ego_browser_*` tools for interactive sites that need a real Chromium session, persistent task spaces, downloads/uploads, or authenticated state. Prefer `web_search` and `web_extract` for ordinary read-only research; use this browser only when interaction or session state is necessary.

## Safe workflow

1. Call `mcp_ego_browser_ego_browser_status` before the first browser task in a session.
2. Open one short, goal-specific task space with `mcp_ego_browser_ego_browser_space_open`.
3. Navigate, then observe with `snapshot` or `page_info` before acting.
4. Prefer semantic selectors/refs from the latest snapshot. Use coordinates only when the page lacks useful semantic controls.
5. After every meaningful click, fill, navigation, upload, or download, read back page state or the returned artifact path.
6. Close the task space with `space_close` when the task is complete. Use `keep: true` only when the user explicitly needs the live page left open.

## Human control and authentication

- Stop and ask the user when login credentials, CAPTCHA, payment confirmation, consent, or another human-only action is required.
- Never guess credentials or seize control back without confirmation.
- Keep each task in its original task space across follow-ups so authenticated state and tabs remain consistent.

## Limits and safety

- `navigate` accepts only `http` and `https` URLs. `file:`, `javascript:`, `data:`, and `chrome://` are rejected before the browser runs.
- A failed call (navigate, snapshot, click, fill, wait, screenshot, upload, download, or an advanced tool) does not change the active task space; later calls keep targeting the space that was active before the failure.
- An empty snapshot (no semantic content after retries) is reported as an error, not a silent success.
- Screenshot, upload, and download paths must be absolute.
- Verify a returned file exists before claiming delivery.
- The safe download tool accepts a selector trigger, not arbitrary page JavaScript.

## Advanced tools

`js`, `cdp`, `cli`, and `http` are absent by default. They appear only when the MCP server starts with `EGO_BROWSER_ENABLE_ADVANCED=true`; an optional `EGO_BROWSER_TOOLS` allowlist can narrow the exposed set further. Do not enable advanced tools merely for convenience.

## Cleanup

Always close completed task spaces. Do not kill unrelated user Chrome/Edge processes; the ego-lite runtime owns its own browser state.
