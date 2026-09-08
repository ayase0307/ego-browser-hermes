export interface McpConfig {
  egoBin: string
  defaultSpace: string | number
  maxOutputBytes: number
  graceMs: number
  chromePath?: string
  chromeArgs?: string
  egoCliArgs?: string
  enableAdvanced?: boolean
  allowedTools?: string[]
  dataDir?: string
}

export interface EgoScriptResult {
  ok: boolean
  value?: unknown
  stdout: string
  stderr: string
  error?: string
}

export interface EgoStatusResult {
  ok: boolean
  available: boolean
  path: string
  exitCode: number | null
  error?: string
}

export interface EgoRunner {
  runScript(script: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<EgoScriptResult>
  getStatus(): Promise<EgoStatusResult>
}

import type { CallToolResult, ContentBlock, ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js'

export type ToolTextContent = TextContent

export type ToolImageContent = ImageContent

export type ToolContent = ContentBlock

export type McpToolResponse = CallToolResult