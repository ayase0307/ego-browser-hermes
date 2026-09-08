import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner } from '../types.ts'
import { prepareSpace, runTool } from './shared.ts'

export const snapshotSchema = z.object({
  space: z.string().min(1).max(256).optional(),
  scope: z.enum(['full_page', 'only_within_viewport']).optional().default('full_page'),
})

export const pageInfoSchema = z.object({
  space: z.string().min(1).max(256).optional(),
})

export function registerObservationTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('ego_browser_snapshot')) {
    server.registerTool(
      'ego_browser_snapshot',
      {
        description:
          'Read the current page semantic tree as text annotated with refs and stable locators. Retries briefly when a just-navigated page returns an empty capture.',
        inputSchema: snapshotSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const call = `await page.snapshotRaw({ scope: ${j(args.scope)} })`
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `let s = ${call}\n` +
          `let tries = 0\n` +
          `while (!(s.content ?? '') && tries < 3) { await page.waitForTimeout(400); s = ${call}; tries++ }\n` +
          `const text = s.content ?? ''\n` +
          `console.log('${SENTINEL}' + JSON.stringify(text === '' ? ` +
          `{ ok: false, text, tries, reason: 'snapshot returned no content after retries' } : ` +
          `{ ok: true, text, tries }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 30_000 })
      },
    )
  }

  if (isAllowed('ego_browser_page_info')) {
    server.registerTool(
      'ego_browser_page_info',
      {
        description: 'Return current page URL, title, viewport, scroll offsets, dimensions, and dialog state.',
        inputSchema: pageInfoSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `const pginfo = await page.info()\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace })
      },
    )
  }
}
