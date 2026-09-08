import { describe, it, expect } from 'vitest'
import { createMcpServer, DEFAULT_SAFE_TOOLS } from '../src/index.ts'
import type { EgoRunner, EgoScriptResult, EgoStatusResult } from '../src/types.ts'

describe('MCP Server Tool Registry & Safe Exposure', () => {
  it('registers all default safe tools without launching Chrome or opening ports', () => {
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

    const anyServer = server as any
    const tools = anyServer._registeredTools || anyServer._tools
    expect(tools).toBeDefined()

    // All Package 1 safe tools must be registered
    for (const toolName of DEFAULT_SAFE_TOOLS) {
      expect(tools[toolName]).toBeDefined()
    }
    expect(Object.keys(tools).sort()).toEqual([...DEFAULT_SAFE_TOOLS].sort())
  })

  it('instantiates cleanly with default NodeEgoRunner when customRunner is omitted', () => {
    const server = createMcpServer()
    expect(server).toBeDefined()
    const anyServer = server as any
    const tools = anyServer._registeredTools || anyServer._tools
    for (const toolName of DEFAULT_SAFE_TOOLS) {
      expect(tools[toolName]).toBeDefined()
    }
  })

  describe('default safe exposure and allowedTools filtering', () => {
    it('restricts registered tools when allowedTools is specified', () => {
      const server = createMcpServer({
        allowedTools: ['status', 'navigate'],
      })
      const anyServer = server as any
      const tools = anyServer._registeredTools || anyServer._tools

      expect(tools.status).toBeDefined()
      expect(tools.navigate).toBeDefined()
      expect(tools.space_open).toBeUndefined()
      expect(tools.space_close).toBeUndefined()
    })

    it('registers no tools when allowedTools is empty', () => {
      const server = createMcpServer({ allowedTools: [] })
      const anyServer = server as any
      const tools = anyServer._registeredTools || anyServer._tools
      expect(Object.keys(tools)).toHaveLength(0)
    })

    it('ignores unknown tool names in allowedTools gracefully', () => {
      const server = createMcpServer({ allowedTools: ['status', 'unknown_future_tool'] })
      const anyServer = server as any
      const tools = anyServer._registeredTools || anyServer._tools
      expect(Object.keys(tools)).toEqual(['status'])
    })
  })

  describe('tool executions', () => {
    it('handles status success and error', async () => {
      let shouldFail = false
      const mockRunner: EgoRunner = {
        runScript: async () => ({ ok: true, stdout: '', stderr: '' }),
        getStatus: async (): Promise<EgoStatusResult> => {
          if (shouldFail) {
            throw new Error('Connection refused')
          }
          return {
            ok: true,
            available: true,
            path: 'd:/test/ego-browser.mjs',
            exitCode: 0,
          }
        },
      }

      const server = createMcpServer({}, mockRunner)
      const anyServer = server as any
      const statusTool = (anyServer._registeredTools || anyServer._tools).status
      const handler = statusTool.handler || statusTool.execute

      // Success
      const res = await handler({})
      expect(res.isError).toBeUndefined()
      const data = JSON.parse(res.content[0].text)
      expect(data.ok).toBe(true)
      expect(data.available).toBe(true)

      // Error
      shouldFail = true
      const errRes = await handler({})
      expect(errRes.isError).toBe(true)
      const errData = JSON.parse(errRes.content[0].text)
      expect(errData.ok).toBe(false)
      expect(errData.error).toContain('Connection refused')
    })

    it('handles space_open and active space tracking', async () => {
      let executedScript = ''
      const mockRunner: EgoRunner = {
        runScript: async (script): Promise<EgoScriptResult> => {
          executedScript = script
          return {
            ok: true,
            value: { ok: true, id: 'space-99', name: 'my-research' },
            stdout: '',
            stderr: '',
          }
        },
        getStatus: async () => ({ ok: true, available: true, path: '', exitCode: 0 }),
      }

      const server = createMcpServer({ defaultSpace: 'hermes-agent' }, mockRunner)
      const anyServer = server as any
      const openTool = (anyServer._registeredTools || anyServer._tools).space_open
      const handler = openTool.handler || openTool.execute

      const res = await handler({ name: 'my-research' })
      expect(res.isError).toBeUndefined()
      expect(executedScript).toContain('taskSpaces.useOrCreate("my-research")')
      const payload = JSON.parse(res.content[0].text)
      expect(payload.id).toBe('space-99')
      expect(payload.activeSpace).toBe('space-99')
    })

    it('handles space_open failure cleanly', async () => {
      const mockRunner: EgoRunner = {
        runScript: async (): Promise<EgoScriptResult> => ({
          ok: false,
          error: 'Browser daemon not reachable',
          stdout: '',
          stderr: '',
        }),
        getStatus: async () => ({ ok: true, available: true, path: '', exitCode: 0 }),
      }

      const server = createMcpServer({}, mockRunner)
      const anyServer = server as any
      const openTool = (anyServer._registeredTools || anyServer._tools).space_open
      const res = await (openTool.handler || openTool.execute)({ name: 'fail-space' })

      expect(res.isError).toBe(true)
      const payload = JSON.parse(res.content[0].text)
      expect(payload.ok).toBe(false)
      expect(payload.error).toContain('Browser daemon not reachable')
    })

    it('handles space_close with keep flag and tracker reset', async () => {
      let executedScript = ''
      const mockRunner: EgoRunner = {
        runScript: async (script): Promise<EgoScriptResult> => {
          executedScript = script
          return {
            ok: true,
            value: { ok: true, done: true },
            stdout: '',
            stderr: '',
          }
        },
        getStatus: async () => ({ ok: true, available: true, path: '', exitCode: 0 }),
      }

      const server = createMcpServer({ defaultSpace: 'hermes-agent' }, mockRunner)
      const anyServer = server as any
      const closeTool = (anyServer._registeredTools || anyServer._tools).space_close
      const handler = closeTool.handler || closeTool.execute

      const res = await handler({ name: 'space-99', keep: true })
      expect(res.isError).toBeUndefined()
      expect(executedScript).toContain('taskSpaces.complete("space-99", { keep: true })')
      const payload = JSON.parse(res.content[0].text)
      expect(payload.done).toBe(true)
      expect(payload.activeSpace).toBe('hermes-agent')
    })

    it('handles navigate execution and parameters', async () => {
      let executedScript = ''
      let passedOptions: { timeoutMs?: number } | undefined
      const mockRunner: EgoRunner = {
        runScript: async (script, options): Promise<EgoScriptResult> => {
          executedScript = script
          passedOptions = options
          return {
            ok: true,
            value: {
              ok: true,
              reused: false,
              page: { title: 'Test Page', url: 'https://example.com' },
            },
            stdout: '',
            stderr: '',
          }
        },
        getStatus: async () => ({ ok: true, available: true, path: '', exitCode: 0 }),
      }

      const server = createMcpServer({ defaultSpace: 'hermes-agent' }, mockRunner)
      const anyServer = server as any
      const navTool = (anyServer._registeredTools || anyServer._tools).navigate
      const handler = navTool.handler || navTool.execute

      const res = await handler({
        url: 'https://example.com',
        wait: true,
        timeout: 10_000,
        space: 'custom-nav-space',
      })

      expect(res.isError).toBeUndefined()
      expect(executedScript).toContain('taskSpaces.useOrCreate("custom-nav-space")')
      expect(executedScript).toContain('page.goto("https://example.com", { wait: true, timeout: 10000 })')
      expect(passedOptions?.timeoutMs).toBe(25_000)

      const payload = JSON.parse(res.content[0].text)
      expect(payload.page.title).toBe('Test Page')
      expect(payload.activeSpace).toBe('custom-nav-space')
    })

    it('handles navigate failure cleanly', async () => {
      const mockRunner: EgoRunner = {
        runScript: async (): Promise<EgoScriptResult> => ({
          ok: false,
          error: 'net::ERR_NAME_NOT_RESOLVED',
          stdout: '',
          stderr: '',
        }),
        getStatus: async () => ({ ok: true, available: true, path: '', exitCode: 0 }),
      }

      const server = createMcpServer({}, mockRunner)
      const anyServer = server as any
      const navTool = (anyServer._registeredTools || anyServer._tools).navigate
      const res = await (navTool.handler || navTool.execute)({
        url: 'https://invalid-non-existent-domain.xyz',
        wait: true,
        timeout: 5000,
      })

      expect(res.isError).toBe(true)
      const payload = JSON.parse(res.content[0].text)
      expect(payload.ok).toBe(false)
      expect(payload.error).toBe('net::ERR_NAME_NOT_RESOLVED')
    })
  })
})