import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { bool, dialogReadback, ensureRealTab, j, num, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner, McpToolResponse } from '../types.ts'
import { errorResult, textResult } from './shared.ts'

export const navigateSchema = z.object({
  url: z.string().url().max(2048).describe('Absolute http(s) URL.'),
  wait: z.boolean().optional().default(true),
  timeout: z
    .number()
    .int()
    .min(500)
    .max(120_000)
    .optional()
    .default(20_000)
    .describe('Load timeout in ms.'),
  space: z.string().max(256).optional().describe('Task space; defaults to the active one.'),
  onDialog: z
    .enum(['accept', 'dismiss'])
    .optional()
    .describe('Answer a beforeunload prompt this navigation triggers. Only this call can.'),
})

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function registerNavigationTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('navigate')) {
    server.registerTool(
      'navigate',
      {
        description:
          'Open a URL, or switch to its existing tab, and return page info. http(s) only.',
        inputSchema: navigateSchema,
      },
      async (args): Promise<McpToolResponse> => {
        try {
          const u = args.url
          if (!isHttpUrl(u)) {
            return errorResult(`Unsupported URL scheme. Only http and https are allowed: ${u}`)
          }

          const targetSpace = args.space || tracker.current()
          const wait = bool(args.wait, true)
          const timeout = num(args.timeout, 20_000)

          const script =
            `${useSpace(targetSpace)}${ensureRealTab()}` +
            `const __existing = __tabs.find(t => t.url.split('#')[0] === ${j(u.split('#')[0])})\n` +
            `const tab = __existing ? await browser.switchTab(__existing.targetId) : await page.goto(${j(u)}, { wait: ${wait}, timeout: ${timeout} })\n` +
            dialogReadback(args.onDialog) +
            `console.log('${SENTINEL}' + JSON.stringify({ ok: true, reused: !!__existing, dialog: __dialog, page: pginfo }))\n`

          const result = await runner.runScript(script, { timeoutMs: timeout + 15_000 })
          if (!result.ok) {
            return errorResult(result.error)
          }

          const value = (result.value as Record<string, unknown>) ?? { ok: true }
          // Only promote the requested space to active AFTER a successful navigation, so a
          // failed navigation never poisons the active-space pointer used by later calls.
          if (args.space) {
            tracker.selected(args.space)
          }

          return textResult({ ...value, activeSpace: tracker.current() }, undefined)
        } catch (err) {
          return errorResult(err)
        }
      },
    )
  }
}
