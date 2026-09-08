import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { bool, ensureRealTab, j, num, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner, McpToolResponse } from '../types.ts'

export const navigateSchema = z.object({
  url: z.string().url().max(2048).describe('Absolute URL to open, e.g. https://example.com/path.'),
  wait: z.boolean().optional().default(true).describe('Wait for document load (default true).'),
  timeout: z
    .number()
    .int()
    .min(500)
    .max(120_000)
    .optional()
    .default(20_000)
    .describe('Load wait timeout in ms (default 20000).'),
  space: z.string().max(256).optional().describe('Task-space name or id; defaults to the active space.'),
})

export function registerNavigationTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('ego_browser_navigate')) {
    server.registerTool(
      'ego_browser_navigate',
      {
        description:
          'Open a URL in the task space, or switch to the existing tab for it. Waits for document load. Returns resulting page info.',
        inputSchema: navigateSchema,
      },
      async (args): Promise<McpToolResponse> => {
        try {
          const targetSpace = args.space || tracker.current()
          if (args.space) {
            tracker.selected(args.space)
          }

          const wait = bool(args.wait, true)
          const timeout = num(args.timeout, 20_000)
          const u = args.url

          const script =
            `${useSpace(targetSpace)}${ensureRealTab()}` +
            `const __existing = __tabs.find(t => t.url.split('#')[0] === ${j(u.split('#')[0])})\n` +
            `const tab = __existing ? await browser.switchTab(__existing.targetId) : await page.goto(${j(u)}, { wait: ${wait}, timeout: ${timeout} })\n` +
            `const pginfo = await page.info()\n` +
            `console.log('${SENTINEL}' + JSON.stringify({ ok: true, reused: !!__existing, page: pginfo }))\n`

          const result = await runner.runScript(script, { timeoutMs: timeout + 15_000 })
          if (!result.ok) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result.error }, null, 2) }],
              isError: true,
            }
          }

          const value = (result.value as Record<string, unknown>) ?? { ok: true }
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
