import type { ActiveSpaceTracker } from '../runtime/config.ts'
import type { EgoRunner, McpToolResponse } from '../types.ts'

/**
 * Resolve the task space a call should act on WITHOUT mutating the tracker.
 * A requested space is only promoted to "active" after the call succeeds (see
 * runTool's commitSpace), so a failed call never poisons the active-space pointer.
 */
export function activeSpace(tracker: ActiveSpaceTracker, requested?: string): string | number {
  return requested || tracker.current()
}

/**
 * Resolve the target space plus a commit callback for runTool. The space is
 * returned without mutating the tracker; the commit callback promotes it to
 * active and runTool invokes it only after a successful run.
 */
export function prepareSpace(
  tracker: ActiveSpaceTracker,
  requested?: string,
): { space: string | number; commitSpace: ((space: string | number) => void) | undefined } {
  const space = requested || tracker.current()
  const commitSpace = requested !== undefined ? () => tracker.selected(space) : undefined
  return { space, commitSpace }
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

export interface RunToolOptions {
  active?: string | number
  /** Called with the resolved space only after a successful run, to promote it to active. */
  commitSpace?: (space: string | number) => void
  timeoutMs?: number
}

export async function runTool(
  runner: EgoRunner,
  script: string,
  options: RunToolOptions = {},
): Promise<McpToolResponse> {
  try {
    const result = await runner.runScript(
      script,
      options.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs },
    )
    if (!result.ok) return errorResult(result.error ?? 'ego-browser command failed')
    const value = result.value ?? { ok: true }
    // A script that resolves to { ok: false } is a deliberate failure (e.g. snapshot
    // returning no content) and must surface as an MCP error, not as a silent success.
    if (value !== null && typeof value === 'object' && (value as Record<string, unknown>).ok === false) {
      const record = value as Record<string, unknown>
      const message =
        typeof record.error === 'string' && record.error !== ''
          ? record.error
          : typeof record.reason === 'string' && record.reason !== ''
            ? record.reason
            : 'ego-browser command failed'
      return errorResult(message)
    }
    if (options.active !== undefined && options.commitSpace) {
      options.commitSpace(options.active)
    }
    return textResult(value, options.active)
  } catch (error) {
    return errorResult(error)
  }
}
