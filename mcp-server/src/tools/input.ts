import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner } from '../types.ts'
import { errorResult, prepareSpace, runTool } from './shared.ts'

const spaceArg = z.string().min(1).max(256).optional().describe('Task-space name or id; defaults to the active space.')

export const pressSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Key or combo to press, e.g. "Enter", "Tab", "Escape", "Control+a".'),
    text: z.string().max(100_000).optional().describe('Text to type with real key events (for editors that ignore fill).'),
    selector: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe('Optional CSS/xpath/ref/loc selector to focus before typing or pressing.'),
    space: spaceArg,
  })
  .refine((v) => Boolean(v.key) || Boolean(v.text), { message: 'Provide key, text, or both.' })

export const scrollSchema = z.object({
  dy: z.number().int().min(-100_000).max(100_000).optional().default(600).describe('Vertical scroll in CSS pixels (positive scrolls down).'),
  dx: z.number().int().min(-100_000).max(100_000).optional().default(0).describe('Horizontal scroll in CSS pixels.'),
  space: spaceArg,
})

export const dialogSchema = z.object({
  accept: z.boolean().describe('true accepts (OK) the open native dialog, false dismisses it (Cancel).'),
  promptText: z.string().max(4096).optional().describe('Text to submit when the dialog is a prompt().'),
  space: spaceArg,
})

export function registerInputTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('ego_browser_press')) {
    server.registerTool(
      'ego_browser_press',
      {
        description:
          'Send real keyboard input: type text and/or press a key combo, optionally focusing a selector first. Use this to submit a search box with "Enter" after fill.',
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
          `const pginfo = await page.info()\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, typed: ${j(args.text ?? null)}, pressed: ${j(
            args.key ?? null,
          )}, page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 45_000 })
      },
    )
  }

  if (isAllowed('ego_browser_scroll')) {
    server.registerTool(
      'ego_browser_scroll',
      {
        description:
          'Scroll the page with a real wheel event and return the new scroll offsets. Needed for lazy-loaded and infinite-scroll content that a snapshot cannot reach.',
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

  if (isAllowed('ego_browser_dialog')) {
    server.registerTool(
      'ego_browser_dialog',
      {
        description:
          'Accept or dismiss an open native alert/confirm/prompt dialog. Call this when page_info reports a `dialog` field — page JavaScript stays blocked until the dialog is handled.',
        inputSchema: dialogSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const params =
          args.promptText === undefined
            ? `{ accept: ${args.accept} }`
            : `{ accept: ${args.accept}, promptText: ${j(args.promptText)} }`
        const script =
          `${useSpace(space)}` +
          `await cdp('Page.handleJavaScriptDialog', ${params})\n` +
          `const pginfo = await page.info()\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, accepted: ${args.accept}, page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 30_000 })
      },
    )
  }
}
