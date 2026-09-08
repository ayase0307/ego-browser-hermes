import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { ensureRealTab, j, SAFE_FN, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner } from '../types.ts'
import { activeSpace, runTool } from './shared.ts'

export const ADVANCED_TOOLS = [
  'ego_browser_js',
  'ego_browser_cdp',
  'ego_browser_cli',
  'ego_browser_http',
] as const

const space = z.string().min(1).max(256).optional()

export function registerAdvancedTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  enabled: boolean,
  isAllowed: (name: string) => boolean,
): void {
  if (!enabled) return

  if (isAllowed('ego_browser_js')) {
    server.registerTool(
      'ego_browser_js',
      {
        description: 'ADVANCED: evaluate a JavaScript expression in the current page.',
        inputSchema: z.object({ expression: z.string().min(1).max(100_000), space }),
      },
      async (args) => {
        const target = activeSpace(tracker, args.space)
        const script =
          `${useSpace(target)}${ensureRealTab()}${SAFE_FN}` +
          `const result = await page.evaluate(${j(args.expression)})\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, result: safe(result) }))\n`
        return runTool(runner, script, target, 120_000)
      },
    )
  }

  if (isAllowed('ego_browser_cdp')) {
    server.registerTool(
      'ego_browser_cdp',
      {
        description: 'ADVANCED: issue a raw Chrome DevTools Protocol command.',
        inputSchema: z.object({
          method: z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/).max(200),
          params: z.record(z.string(), z.unknown()).optional(),
          space,
        }),
      },
      async (args) => {
        const target = activeSpace(tracker, args.space)
        const call = args.params ? `await cdp(${j(args.method)}, ${j(args.params)})` : `await cdp(${j(args.method)})`
        const script =
          `${useSpace(target)}${ensureRealTab()}${SAFE_FN}` +
          `const result = ${call}\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, result: safe(result) }))\n`
        return runTool(runner, script, target, 120_000)
      },
    )
  }

  if (isAllowed('ego_browser_cli')) {
    server.registerTool(
      'ego_browser_cli',
      {
        description: 'ADVANCED: execute an arbitrary ego-browser Node script. Disabled unless explicitly enabled and allowlisted.',
        inputSchema: z.object({ script: z.string().min(1).max(200_000) }),
      },
      async (args) => {
        const wrapped = `${args.script}\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true }))\n`
        return runTool(runner, wrapped, undefined, 120_000)
      },
    )
  }

  if (isAllowed('ego_browser_http')) {
    server.registerTool(
      'ego_browser_http',
      {
        description: 'ADVANCED: make an HTTP request from the browser context.',
        inputSchema: z.object({
          url: z.string().url().max(4096),
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional().default('GET'),
          headers: z.record(z.string(), z.string()).optional().default({}),
          body: z.string().max(2_000_000).optional(),
          timeout: z.number().int().min(500).max(120_000).optional().default(20_000),
          space,
        }),
      },
      async (args) => {
        const target = activeSpace(tracker, args.space)
        const options: Record<string, unknown> = { method: args.method, headers: args.headers, timeout: args.timeout }
        if (args.body !== undefined) options.body = args.body
        const script =
          `${useSpace(target)}${ensureRealTab()}${SAFE_FN}` +
          `const result = await fetch.browser(${j(args.url)}, ${j(options)})\n` +
          `const status = typeof result.status !== 'undefined' ? result.status : 200\n` +
          `let body = null\n` +
          `try { body = typeof result.text === 'function' ? await result.text() : JSON.stringify(safe(result)) } catch { body = null }\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, status, body, url: ${j(args.url)} }))\n`
        return runTool(runner, script, target, args.timeout + 15_000)
      },
    )
  }
}
