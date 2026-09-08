import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { dialogReadback, ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner } from '../types.ts'
import { errorResult, prepareSpace, runTool } from './shared.ts'

const spaceArg = z.string().min(1).max(256).optional().describe('Task space; defaults to the active one.')

export const pressSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('e.g. "Enter", "Tab", "Control+a".'),
    text: z.string().max(100_000).optional().describe('Typed with real key events, for editors that ignore fill.'),
    selector: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe('Focused before typing or pressing.'),
    space: spaceArg,
  onDialog: z
    .enum(['accept', 'dismiss'])
    .optional()
    .describe('Answer a native dialog this action opens. Only this call can; omit to just report it.'),
  })
  .refine((v) => Boolean(v.key) || Boolean(v.text), { message: 'Provide key, text, or both.' })

export const scrollSchema = z.object({
  dy: z.number().int().min(-100_000).max(100_000).optional().default(600).describe('CSS pixels; positive scrolls down.'),
  dx: z.number().int().min(-100_000).max(100_000).optional().default(0),
  space: spaceArg,
})

export function registerInputTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('press')) {
    server.registerTool(
      'press',
      {
        description:
          'Real keyboard input: focus a selector, type text, press a key combo. Submits a search box with "Enter" after fill.',
        inputSchema: pressSchema,
      },
      async (args) => {
        if (!args.key && !args.text) return errorResult('Provide key, text, or both.')
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const focus = args.selector ? `await page.locator(${j(args.selector)}).focus()\n` : ''
        const type = args.text ? `await page.keyboard.type(${j(args.text)})\n` : ''
        const press = args.key ? `await page.keyboard.press(${j(args.key)})\n` : ''
        const script =
          `${useSpace(space)}${ensureRealTab()}${focus}${type}${press}` +
          dialogReadback(args.onDialog) +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, typed: ${j(args.text ?? null)}, pressed: ${j(
            args.key ?? null,
          )}, dialog: __dialog, page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 45_000 })
      },
    )
  }

  if (isAllowed('scroll')) {
    server.registerTool(
      'scroll',
      {
        description:
          'Scroll with a real wheel event; returns new offsets and movedY. Needed for lazy-loaded content.',
        inputSchema: scrollSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `const __before = await page.info()\n` +
          `await page.mouse.wheel(${args.dx}, ${args.dy})\n` +
          `await page.waitForTimeout(400)\n` +
          `const pginfo = await page.info()\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, dx: ${args.dx}, dy: ${args.dy}, ` +
          `movedY: (pginfo.sy ?? 0) - (__before.sy ?? 0), page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 45_000 })
      },
    )
  }

}
