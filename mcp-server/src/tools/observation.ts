import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner } from '../types.ts'
import { prepareSpace, runTool } from './shared.ts'

export const snapshotSchema = z.object({
  space: z.string().min(1).max(256).optional(),
  scope: z.enum(['full_page', 'only_within_viewport']).optional().default('full_page'),
  maxChars: z
    .number()
    .int()
    .min(1_000)
    .max(200_000)
    .optional()
    .default(20_000)
    .describe('Truncate at this many characters (default 20000).'),
})

export const pageInfoSchema = z.object({
  space: z.string().min(1).max(256).optional(),
})


/**
 * Page JavaScript is unavailable while a native dialog is open — in a freshly spawned runtime
 * process the call simply never resolves. Racing it turns a full-timeout stall into a fast,
 * actionable error naming the tool that can clear the dialog.
 */
const DIALOG_HINT =
  'page JavaScript is blocked, which almost always means a native alert/confirm/prompt is open. ' +
  'A dialog can only be answered by the call that opened it (pass onDialog to click/press), or by ' +
  'a human clicking it in the browser window. Otherwise close this space with space_close ' +
  'and redo the action with onDialog set.'

const raceBlocked = (expr: string, ms = 5_000): string =>
  `const __raced = await Promise.race([(async () => ({ v: ${expr} }))(), ` +
  `new Promise(r => setTimeout(() => r({ blocked: true }), ${ms}))])\n`

export function registerObservationTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('snapshot')) {
    server.registerTool(
      'snapshot',
      {
        description:
          'Page semantic tree as text with refs and stable locators. Retries briefly on an empty just-navigated capture.',
        inputSchema: snapshotSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const call = `await page.snapshotRaw({ scope: ${j(args.scope)} })`
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          raceBlocked(call) +
          `if (__raced.blocked) { console.log('${SENTINEL}' + JSON.stringify({ ok: false, error: ${j(
            DIALOG_HINT,
          )} })); } else {\n` +
          `let s = __raced.v\n` +
          `let tries = 0\n` +
          `while (!(s.content ?? '') && tries < 3) { await page.waitForTimeout(400); s = ${call}; tries++ }\n` +
          `const full = s.content ?? ''\n` +
          `const text = full.slice(0, ${args.maxChars})\n` +
          `console.log('${SENTINEL}' + JSON.stringify(full === '' ? ` +
          `{ ok: false, text, tries, reason: 'snapshot returned no content after retries' } : ` +
          `{ ok: true, text, tries, totalChars: full.length, truncated: full.length > ${args.maxChars} }))\n` +
          `}\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 30_000 })
      },
    )
  }

  if (isAllowed('page_info')) {
    server.registerTool(
      'page_info',
      {
        description: 'Current URL, title, viewport, scroll offsets and dialog state.',
        inputSchema: pageInfoSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          raceBlocked('await page.info()') +
          `console.log('${SENTINEL}' + JSON.stringify(__raced.blocked ? ` +
          `{ ok: false, error: ${j(DIALOG_HINT)} } : { ok: true, page: __raced.v }))\n`
        return runTool(runner, script, { active: space, commitSpace })
      },
    )
  }
}
