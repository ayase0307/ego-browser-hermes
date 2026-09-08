import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { bool, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner, McpToolResponse } from '../types.ts'

export const spaceOpenSchema = z.object({
  name: z.string().min(1).max(256).describe('Short name or identifier for the task space (e.g. "search-task").'),
})

export const spaceCloseSchema = z.object({
  name: z.string().min(1).max(256).describe('Task-space name or numeric id to close.'),
  keep: z.boolean().optional().default(false).describe('Keep the live page open (default false: close it).'),
})

export function registerSpaceTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('ego_browser_space_open')) {
    server.registerTool(
      'ego_browser_space_open',
      {
        description:
          'Open (or reuse) an ego-lite task space — an isolated browsing context that inherits your login state. It becomes the active space for later calls.',
        inputSchema: spaceOpenSchema,
      },
      async (args): Promise<McpToolResponse> => {
        try {
          const script =
            `${useSpace(args.name)}` +
            `console.log('${SENTINEL}' + JSON.stringify({ ok: true, id: task.id ?? null, name: task.name ?? ${j(
              args.name,
            )} }))\n`

          const result = await runner.runScript(script)
          if (!result.ok) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result.error }, null, 2) }],
              isError: true,
            }
          }

          const value = (result.value as Record<string, unknown>) ?? { ok: true }
          tracker.opened(args, value)

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ...value, activeSpace: tracker.current() }, null, 2),
              },
            ],
          }
        } catch (err) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(err) }, null, 2) }],
            isError: true,
          }
        }
      },
    )
  }

  if (isAllowed('ego_browser_space_close')) {
    server.registerTool(
      'ego_browser_space_close',
      {
        description:
          'Complete (close) an ego-lite task space. Must be the final call for a task — never leave a space hanging. `keep: true` keeps the page open for the user.',
        inputSchema: spaceCloseSchema,
      },
      async (args): Promise<McpToolResponse> => {
        try {
          const keep = bool(args.keep, false)
          const script =
            `const res = await taskSpaces.complete(${j(args.name)}, { keep: ${keep} })\n` +
            `console.log('${SENTINEL}' + JSON.stringify({ ok: true, done: !!res.done, skipped: !!res.skipped, reason: res.skipped ? ${j(
              'target space was not agent-owned',
            )} : null }))\n`

          const result = await runner.runScript(script)
          if (!result.ok) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result.error }, null, 2) }],
              isError: true,
            }
          }

          const value = (result.value as Record<string, unknown>) ?? { ok: true }
          tracker.closed(args.name, !!value.done)

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ...value, activeSpace: tracker.current() }, null, 2),
              },
            ],
          }
        } catch (err) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(err) }, null, 2) }],
            isError: true,
          }
        }
      },
    )
  }
}
