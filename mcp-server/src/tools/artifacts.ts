import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner } from '../types.ts'
import { activeSpace, errorResult, runTool } from './shared.ts'

export const uploadSchema = z.object({
  selector: z.string().min(1).max(4096),
  path: z.string().min(1).max(32_768),
  space: z.string().min(1).max(256).optional(),
})

export const downloadSchema = z.object({
  triggerSelector: z.string().min(1).max(4096).optional(),
  savePath: z.string().min(1).max(32_768).optional(),
  timeout: z.number().int().min(500).max(120_000).optional().default(30_000),
  space: z.string().min(1).max(256).optional(),
})

export function registerArtifactTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('ego_browser_upload')) {
    server.registerTool(
      'ego_browser_upload',
      { description: 'Set a verified local file on an input[type=file] element.', inputSchema: uploadSchema },
      async (args) => {
        if (!isAbsolute(args.path)) return errorResult('Upload path must be absolute.')
        if (!existsSync(args.path)) return errorResult(`Upload file does not exist: ${args.path}`)
        const space = activeSpace(tracker, args.space)
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `await page.locator(${j(args.selector)}).setInputFiles(${j(args.path)})\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, upload: ${j(args.selector)}, path: ${j(args.path)} }))\n`
        return runTool(runner, script, space, 45_000)
      },
    )
  }

  if (isAllowed('ego_browser_download')) {
    server.registerTool(
      'ego_browser_download',
      {
        description: 'Wait for a browser download, optionally clicking a selector to trigger it, and return the saved path and metadata. Arbitrary trigger scripts are intentionally not allowed in the safe tool.',
        inputSchema: downloadSchema,
      },
      async (args) => {
        if (args.savePath && !isAbsolute(args.savePath)) return errorResult('Download savePath must be absolute.')
        const space = activeSpace(tracker, args.space)
        const trigger = args.triggerSelector
          ? `await page.locator(${j(args.triggerSelector)}).click()\n`
          : '/* waiting for a download initiated by an earlier action */\n'
        const save = args.savePath
          ? `const __final = await __dl.saveAs(${j(args.savePath)}).catch(() => null)\n`
          : 'const __final = await __dl.path().catch(() => null)\n'
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `const __dlPromise = page.waitForEvent('download', { timeout: ${args.timeout} })\n` +
          trigger +
          'const __dl = await __dlPromise\n' +
          "const __name = typeof __dl.suggestedFilename === 'function' ? __dl.suggestedFilename() : null\n" +
          "const __url = typeof __dl.url === 'function' ? __dl.url() : null\n" +
          save +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, path: __final, suggestedFilename: __name, url: __url }))\n`
        return runTool(runner, script, space, args.timeout + 15_000)
      },
    )
  }
}
