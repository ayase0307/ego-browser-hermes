import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { ensureRealTab, j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner, McpConfig } from '../types.ts'
import { defaultArtifactPath, errorResult, OUTPUT_DIR_WARNING, prepareSpace, runTool } from './shared.ts'

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
  config: Partial<McpConfig> = {},
): void {
  if (isAllowed('upload')) {
    server.registerTool(
      'upload',
      { description: 'Set a local file on an input[type=file].', inputSchema: uploadSchema },
      async (args) => {
        if (!isAbsolute(args.path)) return errorResult('Upload path must be absolute.')
        if (!existsSync(args.path)) return errorResult(`Upload file does not exist: ${args.path}`)
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `await page.locator(${j(args.selector)}).setInputFiles(${j(args.path)})\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, upload: ${j(args.selector)}, path: ${j(args.path)} }))\n`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 45_000 })
      },
    )
  }

  if (isAllowed('download')) {
    server.registerTool(
      'download',
      {
        description: 'Wait for a download, optionally clicking a selector to trigger it; returns the saved path. Selector triggers only, never page scripts.',
        inputSchema: downloadSchema,
      },
      async (args) => {
        if (args.savePath && !isAbsolute(args.savePath)) return errorResult('Download savePath must be absolute.')
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const saveDir = args.savePath ? undefined : defaultArtifactPath(config.outputDir, 'dl', '')
        const trigger = args.triggerSelector
          ? `await page.locator(${j(args.triggerSelector)}).click()\n`
          : '/* waiting for a download initiated by an earlier action */\n'
        const save = args.savePath
          ? `const __final = await __dl.saveAs(${j(args.savePath)}).catch(() => null)\n`
          : saveDir
            ? `const __final = await __dl.saveAs(${j(saveDir)} + (__name ? '-' + __name : '.bin')).catch(() => null)\n`
            : 'const __final = await __dl.path().catch(() => null)\n'
        const script =
          `${useSpace(space)}${ensureRealTab()}` +
          `const __dlPromise = page.waitForEvent('download', { timeout: ${args.timeout} })\n` +
          trigger +
          'const __dl = await __dlPromise\n' +
          "const __name = typeof __dl.suggestedFilename === 'function' ? __dl.suggestedFilename() : null\n" +
          "const __url = typeof __dl.url === 'function' ? __dl.url() : null\n" +
          save +
          `console.log('${SENTINEL}' + JSON.stringify(__final ? ` +
          `{ ok: true, path: __final, suggestedFilename: __name, url: __url } : ` +
          `{ ok: false, error: 'download completed but no file path was produced (saveAs failed)', suggestedFilename: __name, url: __url }))\n`
        return runTool(runner, script, {
          active: space,
          commitSpace,
          timeoutMs: args.timeout + 15_000,
          extra: args.savePath || saveDir ? undefined : { warning: OUTPUT_DIR_WARNING },
        })
      },
    )
  }
}
