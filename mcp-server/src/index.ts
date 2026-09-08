import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { McpConfig, EgoRunner, EgoStatusResult } from './types.ts'

export const DEFAULT_CONFIG: McpConfig = {
  egoBin: process.env.EGO_BROWSER_BIN || '',
  defaultSpace: 'hermes-agent',
  maxOutputBytes: 4 * 1024 * 1024,
  graceMs: 15_000,
  enableAdvanced: process.env.EGO_BROWSER_ENABLE_ADVANCED === 'true',
}

class DefaultEgoRunner implements EgoRunner {
  private config: McpConfig

  constructor(config: McpConfig) {
    this.config = config
  }

  async runScript(): Promise<never> {
    throw new Error('EgoRunner not fully initialized in Task 1')
  }

  async getStatus(): Promise<EgoStatusResult> {
    return {
      ok: true,
      available: false,
      path: this.config.egoBin,
      exitCode: null,
      error: 'Default runner status check stub',
    }
  }
}

export function createMcpServer(
  userConfig?: Partial<McpConfig>,
  customRunner?: EgoRunner,
): McpServer {
  const config: McpConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const runner = customRunner ?? new DefaultEgoRunner(config)

  const server = new McpServer({
    name: 'hermes-ego-browser',
    version: '0.8.3',
  })

  // Minimal safe core tool for Task 1: ego_browser_status
  server.tool(
    'ego_browser_status',
    'Check whether the ego-browser runtime is available and reachable.',
    {},
    async () => {
      try {
        const status = await runner.getStatus()
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(status, null, 2),
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
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