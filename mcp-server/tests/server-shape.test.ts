import { describe, it, expect } from 'vitest'
import { createMcpServer } from '../src/index.ts'
import type { EgoRunner, EgoStatusResult } from '../src/types.ts'

describe('MCP Server Shape (Task 1)', () => {
  it('constructs tool registry without launching Chrome or opening HTTP ports', async () => {
    const mockRunner: EgoRunner = {
      runScript: async () => ({ ok: true, stdout: '', stderr: '' }),
      getStatus: async (): Promise<EgoStatusResult> => ({
        ok: true,
        available: true,
        path: '/mock/path/ego-browser.mjs',
        exitCode: 0,
      }),
    }

    const server = createMcpServer({}, mockRunner)
    expect(server).toBeDefined()
    expect(server.server).toBeDefined()

    // Inspect registered tools
    // In McpServer, registered tools can be accessed through private registry or listing via server
    // McpServer._tools or similar
    const anyServer = server as any
    expect(anyServer._registeredTools || anyServer._tools).toBeDefined()
    const tools = anyServer._registeredTools || anyServer._tools
    expect(tools.ego_browser_status).toBeDefined()
  })

  it('handles ego_browser_status call cleanly', async () => {
    const mockRunner: EgoRunner = {
      runScript: async () => ({ ok: true, stdout: '', stderr: '' }),
      getStatus: async (): Promise<EgoStatusResult> => ({
        ok: true,
        available: true,
        path: 'd:/test/ego-browser.mjs',
        exitCode: 0,
      }),
    }

    const server = createMcpServer({}, mockRunner)
    const anyServer = server as any
    const tools = anyServer._registeredTools || anyServer._tools
    const statusTool = tools.ego_browser_status

    expect(statusTool).toBeDefined()
    // execute handler
    const handler = statusTool.handler || statusTool.execute
    expect(handler).toBeTypeOf('function')
    const result = await handler({})
    expect(result).toHaveProperty('content')
    expect(result.content[0].type).toBe('text')
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.ok).toBe(true)
    expect(parsed.available).toBe(true)
    expect(parsed.path).toBe('d:/test/ego-browser.mjs')
  })
})