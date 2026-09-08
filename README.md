# ego-browser-hermes

> **WIP** — Hermes MCP adapter for the [ego-lite](https://github.com/CitroLabs/ego-lite) agent browser.

This repository is an in-progress Hermes-compatible adaptation of the original DSH plugin. The goal is to expose ego-lite's isolated task spaces and structured browser automation through a local stdio MCP server.

## Current status

- Hermes MCP server scaffold exists.
- Safe tool surface and runtime runner are under active implementation.
- The original DSH plugin is preserved in [`README-DSH.md`](README-DSH.md).
- This project is **not ready for production installation yet**.
- Do not treat the current branch as a completed release.

## Planned safe tools

Task spaces, status, navigation, semantic snapshots, page information, click/fill/wait, screenshots, downloads, and uploads. Raw JavaScript, CDP, arbitrary CLI, and unrestricted HTTP tools will remain disabled by default and require explicit opt-in.

## Development target

- Windows and other Node.js environments
- Node.js >= 22
- Local stdio MCP transport for Hermes Agent
- Vendored ego-lite runtime retained with attribution and patch notes
- Unit tests, MCP JSON-RPC smoke tests, and a real-browser smoke test before release

## Development

The adapter is currently on the `feat/hermes-mcp-adapter` branch. See [`docs/superpowers/plans/2026-09-08-hermes-mcp-adapter.md`](docs/superpowers/plans/2026-09-08-hermes-mcp-adapter.md) for the implementation plan.

This is a public work-in-progress repository. Until the first verified release, expect breaking changes and incomplete tools.

## License

The original DSH integration and bundled runtime retain their upstream notices. The Hermes adapter's final licensing will be documented before the first release.
