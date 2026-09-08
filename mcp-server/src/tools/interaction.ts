import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner, McpConfig } from '../types.ts'
import { defaultArtifactPath, errorResult, prepareSpace, runTool } from './shared.ts'

export const clickSchema = z
  .object({
    selector: z.string().min(1).max(4096).optional(),
    x: z.number().finite().min(0).max(100_000).optional(),
    y: z.number().finite().min(0).max(100_000).optional(),
    label: z.string().min(1).max(120).optional(),
    double: z.boolean().optional().default(false),
    space: z.string().min(1).max(256).optional(),
    timeout: z.number().int().min(500).max(120_000).optional().default(20_000),
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
  if (isAllowed('ego_browser_click')) {
    server.registerTool(
      'ego_browser_click',
      {
        description: 'Click a selector/ref/locator or viewport coordinates in the current task space.',
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
          `const pginfo = await page.info()\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, double: ${args.double}, page: pginfo }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: args.timeout + 15_000 })
      },
    )
  }

  if (isAllowed('ego_browser_fill')) {
    server.registerTool(
      'ego_browser_fill',
      {
        description: 'Replace the value of an input identified by CSS, xpath, loc, or snapshot ref.',
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

  if (isAllowed('ego_browser_wait')) {
    server.registerTool(
      'ego_browser_wait',
      {
        description: 'Pause the current task space for a bounded number of milliseconds.',
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

  if (isAllowed('ego_browser_screenshot')) {
    server.registerTool(
      'ego_browser_screenshot',
      {
        description:
          'Capture a page or element screenshot and return its absolute file path. With EGO_BROWSER_OUTPUT_DIR set, the file lands there so the agent host can attach it to the chat.',
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
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 45_000 })
      },
    )
  }
}
