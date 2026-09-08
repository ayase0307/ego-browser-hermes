import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { bool, ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import { isHttpUrl } from './navigation.ts'
import type { EgoRunner, McpToolResponse } from '../types.ts'

export const spaceOpenSchema = z.object({
  name: z.string().min(1).max(256).describe('Short task-space name, e.g. "discord-1194-invoice".'),
  url: z
    .string()
    .max(2048)
    .optional()
    .describe('Absolute http(s) URL to open right away, saving a separate navigate call.'),
})

export const spaceCloseSchema = z.object({
  name: z.string().min(1).max(256).describe('Task-space name or id.'),
  keep: z.boolean().optional().default(false).describe('Keep the live page open (default false).'),
})

export function registerSpaceTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('space_open')) {
    server.registerTool(
      'space_open',
      {
        description:
          'Open or reuse an isolated task space that inherits your login state; becomes the active space.',
        inputSchema: spaceOpenSchema,
      },
      async (args): Promise<McpToolResponse> => {
        try {
          if (args.url !== undefined && !isHttpUrl(args.url)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    { ok: false, error: `Unsupported URL scheme. Only http and https are allowed: ${args.url}` },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            }
          }
          const open = args.url
            ? `${ensureRealTab()}await page.goto(${j(args.url)}, { wait: true, timeout: 20000 })\n` +
              `const pginfo = await page.info()\n`
            : `const pginfo = null\n`
          const script =
            `${useSpace(args.name)}` +
            open +
            `console.log('${SENTINEL}' + JSON.stringify({ ok: true, id: task.id ?? null, name: task.name ?? ${j(
              args.name,
            )}, page: pginfo }))\n`

          const result = await runner.runScript(script, { timeoutMs: args.url ? 45_000 : 30_000 })
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

  if (isAllowed('space_close')) {
    server.registerTool(
      'space_close',
      {
        description:
          'Close a task space. Must be the final call for a task; keep: true leaves the page open for the user.',
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
