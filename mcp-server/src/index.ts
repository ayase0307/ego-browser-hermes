import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { NodeEgoRunner } from './runtime/runner.ts'
import { createActiveSpaceTracker } from './runtime/config.ts'
import { registerSpaceTools } from './tools/spaces.ts'
import { registerNavigationTools } from './tools/navigation.ts'
import { registerObservationTools } from './tools/observation.ts'
import { registerInteractionTools } from './tools/interaction.ts'
import { registerArtifactTools } from './tools/artifacts.ts'
import { ADVANCED_TOOLS, registerAdvancedTools } from './tools/advanced.ts'
import type { McpConfig, EgoRunner, McpToolResponse } from './types.ts'

export { NodeEgoRunner } from './runtime/runner.ts'

const envToolList = process.env.EGO_BROWSER_TOOLS

export const DEFAULT_CONFIG: McpConfig = {
  egoBin: process.env.EGO_BROWSER_BIN || '',
  defaultSpace: 'hermes-agent',
  maxOutputBytes: 4 * 1024 * 1024,
  graceMs: 15_000,
  enableAdvanced: process.env.EGO_BROWSER_ENABLE_ADVANCED === 'true',
  allowedTools:
    envToolList === undefined
      ? undefined
      : envToolList.split(',').map((name) => name.trim()).filter(Boolean),
}

export const DEFAULT_SAFE_TOOLS = [
  'ego_browser_status',
  'ego_browser_space_open',
  'ego_browser_space_close',
  'ego_browser_navigate',
  'ego_browser_snapshot',
  'ego_browser_page_info',
  'ego_browser_click',
  'ego_browser_fill',
  'ego_browser_wait',
  'ego_browser_screenshot',
  'ego_browser_download',
  'ego_browser_upload',
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
      return config.allowedTools.includes(name)
    }
    return (
      (DEFAULT_SAFE_TOOLS as readonly string[]).includes(name) ||
      (config.enableAdvanced === true && (ADVANCED_TOOLS as readonly string[]).includes(name))
    )
  }

  const server = new McpServer({
    name: 'hermes-ego-browser',
    version: '0.8.3',
  })

  if (isAllowed('ego_browser_status')) {
    server.registerTool(
      'ego_browser_status',
      {
        description: 'Check whether the ego-browser runtime is available and reachable.',
      },
      async (): Promise<McpToolResponse> => {
        try {
          const status = await runner.getStatus()
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(status, null, 2),
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
  registerInteractionTools(server, runner, tracker, isAllowed)
  registerArtifactTools(server, runner, tracker, isAllowed)
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