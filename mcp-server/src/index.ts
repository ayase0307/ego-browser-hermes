import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { NodeEgoRunner } from './runtime/runner.ts'
import { createActiveSpaceTracker } from './runtime/config.ts'
import { registerSpaceTools } from './tools/spaces.ts'
import { registerNavigationTools } from './tools/navigation.ts'
import { registerObservationTools } from './tools/observation.ts'
import { registerInteractionTools } from './tools/interaction.ts'
import { registerArtifactTools } from './tools/artifacts.ts'
import { registerInputTools } from './tools/input.ts'
import { registerControlTools } from './tools/control.ts'
import { ADVANCED_TOOLS, registerAdvancedTools } from './tools/advanced.ts'
import { OUTPUT_DIR_WARNING } from './tools/shared.ts'
import type { McpConfig, EgoRunner, McpToolResponse } from './types.ts'

export { NodeEgoRunner } from './runtime/runner.ts'

const envToolList = process.env.EGO_BROWSER_TOOLS

/**
 * Tools dropped their redundant `ego_browser_` prefix (the MCP host already namespaces by server
 * name, so it only ever read as `mcp_ego_browser_ego_browser_click`). Existing EGO_BROWSER_TOOLS
 * allowlists still use the old names, so accept both.
 */
export function normalizeToolName(name: string): string {
  return name.trim().replace(/^ego_browser_/, '')
}

export const DEFAULT_CONFIG: McpConfig = {
  egoBin: process.env.EGO_BROWSER_BIN || '',
  defaultSpace: 'hermes-agent',
  maxOutputBytes: 4 * 1024 * 1024,
  graceMs: 15_000,
  enableAdvanced: process.env.EGO_BROWSER_ENABLE_ADVANCED === 'true',
  outputDir: process.env.EGO_BROWSER_OUTPUT_DIR || undefined,
  allowedTools:
    envToolList === undefined
      ? undefined
      : envToolList.split(',').map((name) => normalizeToolName(name)).filter(Boolean),
}

export const DEFAULT_SAFE_TOOLS = [
  'status',
  'space_open',
  'space_close',
  'navigate',
  'snapshot',
  'page_info',
  'click',
  'fill',
  'wait',
  'press',
  'scroll',
  'screenshot',
  'download',
  'upload',
  'control',
  'space_list',
  'tabs',
] as const

export function createMcpServer(
  userConfig?: Partial<McpConfig>,
  customRunner?: EgoRunner,
): McpServer {
  const config: McpConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const runner = customRunner ?? new NodeEgoRunner(config)
  const tracker = createActiveSpaceTracker(config.defaultSpace)

  const isAllowed = (name: string): boolean => {
    if (config.allowedTools !== undefined) {
      return config.allowedTools.map(normalizeToolName).includes(name)
    }
    return (
      (DEFAULT_SAFE_TOOLS as readonly string[]).includes(name) ||
      (config.enableAdvanced === true && (ADVANCED_TOOLS as readonly string[]).includes(name))
    )
  }

  const server = new McpServer({
    name: 'hermes-ego-browser',
    version: '0.2.0',
  })

  if (isAllowed('status')) {
    server.registerTool(
      'status',
      {
        description:
          'Runtime availability, and whether an output directory for delivering files is configured.',
      },
      async (): Promise<McpToolResponse> => {
        try {
          const status = await runner.getStatus()
          const outputDir = config.outputDir ?? null
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  outputDir ? { ...status, outputDir } : { ...status, outputDir, warning: OUTPUT_DIR_WARNING },
                  null,
                  2,
                ),
              },
            ],
          }
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: false,
                  available: false,
                  error: (err as Error)?.message ?? String(err),
                }),
              },
            ],
            isError: true,
          }
        }
      },
    )
  }

  registerSpaceTools(server, runner, tracker, isAllowed)
  registerNavigationTools(server, runner, tracker, isAllowed)
  registerObservationTools(server, runner, tracker, isAllowed)
  registerInteractionTools(server, runner, tracker, isAllowed, config)
  registerInputTools(server, runner, tracker, isAllowed)
  registerArtifactTools(server, runner, tracker, isAllowed, config)
  registerControlTools(server, runner, tracker, isAllowed)
  registerAdvancedTools(server, runner, tracker, config.enableAdvanced === true, isAllowed)

  return server
}

export async function main(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error('Fatal error in hermes-ego-browser MCP server:', err)
    process.exit(1)
  })
}