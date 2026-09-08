import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { dialogReadback, ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner, McpConfig } from '../types.ts'
import { defaultArtifactPath, errorResult, OUTPUT_DIR_WARNING, prepareSpace, runTool } from './shared.ts'

export const clickSchema = z
  .object({
    selector: z.string().min(1).max(4096).optional(),
    x: z.number().finite().min(0).max(100_000).optional(),
    y: z.number().finite().min(0).max(100_000).optional(),
    label: z.string().min(1).max(120).optional(),
    double: z.boolean().optional().default(false),
    space: z.string().min(1).max(256).optional(),
    timeout: z.number().int().min(500).max(120_000).optional().default(20_000),
  onDialog: z
    .enum(['accept', 'dismiss'])
    .optional()
    .describe('Answer a native dialog this action opens. Only this call can; omit to just report it.'),
  })
  .refine((v) => Boolean(v.selector) || (v.x !== undefined && v.y !== undefined), {
    message: 'Provide selector or both x and y coordinates.',
  })

export const fillSchema = z.object({
  selector: z.string().min(1).max(4096),
  text: z.string().max(1_000_000),
  space: z.string().min(1).max(256).optional(),
  timeout: z.number().int().min(500).max(120_000).optional().default(20_000),
})

export const waitSchema = z.object({
  ms: z.number().int().min(0).max(120_000),
  space: z.string().min(1).max(256).optional(),
})

export const screenshotSchema = z.object({
  selector: z.string().min(1).max(4096).optional(),
  path: z.string().min(1).max(32_768).optional(),
  space: z.string().min(1).max(256).optional(),
})

export function registerInteractionTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
  config: Partial<McpConfig> = {},
): void {
  if (isAllowed('click')) {
    server.registerTool(
      'click',
      {
        description:
          'Click a selector/ref/locator or viewport coordinates. Reports any dialog it opens; answer it with onDialog, because no later call can.',
        inputSchema: clickSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        let action: string
        if (args.selector) {
          const options = args.label ? `{ label: ${j(args.label)} }` : ''
          action = args.double
            ? `await page.locator(${j(args.selector)}).dblclick(${options})`
            : `await page.locator(${j(args.selector)}).click(${options})`
        } else {
          action = args.double
            ? `await page.mouse.dblclick(${args.x}, ${args.y})`
            : `await page.mouse.click(${args.x}, ${args.y})`
        }
        const script =
          `${useSpace(space)}${ensureRealTab()}${action}\n` +
          dialogReadback(args.onDialog) +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, double: ${args.double}, dialog: __dialog, page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: args.timeout + 15_000 })
      },
    )
  }

  if (isAllowed('fill')) {
    server.registerTool(
      'fill',
      {
        description: 'Replace an input value (CSS, xpath, loc, or snapshot ref).',
        inputSchema: fillSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `await page.locator(${j(args.selector)}).fill(${j(args.text)})\n` +
          `const pginfo = await page.info()\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: args.timeout + 15_000 })
      },
    )
  }

  if (isAllowed('wait')) {
    server.registerTool(
      'wait',
      {
        description: 'Pause the task space for N milliseconds.',
        inputSchema: waitSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const script =
          `${useSpace(space)}await page.waitForTimeout(${args.ms})\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, waitedMs: ${args.ms} }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: args.ms + 15_000 })
      },
    )
  }

  if (isAllowed('screenshot')) {
    server.registerTool(
      'screenshot',
      {
        description:
          'Capture a page or element screenshot; returns its absolute path (inside EGO_BROWSER_OUTPUT_DIR when set, so the host can attach it).',
        inputSchema: screenshotSchema,
      },
      async (args) => {
        if (args.path && !isAbsolute(args.path)) return errorResult('Screenshot path must be absolute.')
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const target = args.path ?? defaultArtifactPath(config.outputDir, 'shot', '.png')
        const options = target ? `{ path: ${j(target)} }` : ''
        const shot = args.selector
          ? `await page.locator(${j(args.selector)}).screenshot(${options})`
          : `await page.screenshot(${options})`
        const script =
          `${useSpace(space)}${ensureRealTab()}const path = ${shot}\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, path }))\n`
        return runTool(runner, script, {
          active: space,
          commitSpace,
          timeoutMs: 45_000,
          extra: target ? undefined : { warning: OUTPUT_DIR_WARNING },
        })
      },
    )
  }
}
