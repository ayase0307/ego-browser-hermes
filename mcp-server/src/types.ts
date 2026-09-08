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

export interface ToolTextContent {
  type: 'text'
  text: string
}

export interface ToolImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export type ToolContent = ToolTextContent | ToolImageContent

export interface McpToolResponse {
  content: ToolContent[]
  isError?: boolean
}