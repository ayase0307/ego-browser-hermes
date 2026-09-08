import type { ActiveSpaceTracker } from '../runtime/config.ts'
import type { EgoRunner, McpToolResponse } from '../types.ts'

export function activeSpace(tracker: ActiveSpaceTracker, requested?: string): string | number {
  if (requested) tracker.selected(requested)
  return requested || tracker.current()
}

export function textResult(value: unknown, active?: string | number): McpToolResponse {
  const payload =
    active === undefined || value === null || typeof value !== 'object' || Array.isArray(value)
      ? value
      : { ...(value as Record<string, unknown>), activeSpace: active }
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export function errorResult(error: unknown): McpToolResponse {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }, null, 2) }],
    isError: true,
  }
}

export async function runTool(
  runner: EgoRunner,
  script: string,
  active?: string | number,
  timeoutMs?: number,
): Promise<McpToolResponse> {
  try {
    const result = await runner.runScript(script, timeoutMs === undefined ? undefined : { timeoutMs })
    if (!result.ok) return errorResult(result.error ?? 'ego-browser command failed')
    return textResult(result.value ?? { ok: true }, active)
  } catch (error) {
    return errorResult(error)
  }
}
