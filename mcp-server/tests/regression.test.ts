import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../src/index.ts'
import type { EgoRunner, EgoScriptResult } from '../src/types.ts'

function toolsOf(server: ReturnType<typeof createMcpServer>): Record<string, any> {
  const value = server as any
  return value._registeredTools || value._tools
}

async function call(server: ReturnType<typeof createMcpServer>, name: string, args: unknown) {
  const tool = toolsOf(server)[name]
  return (tool.handler || tool.execute)(args)
}

function scriptedRunner(): { runner: EgoRunner; scripts: string[]; ctl: { failNext: number } } {
  const scripts: string[] = []
  const ctl = { failNext: 0 }
  const runner: EgoRunner = {
    runScript: async (script): Promise<EgoScriptResult> => {
      scripts.push(script)
      if (ctl.failNext > 0) {
        ctl.failNext -= 1
        return { ok: false, error: 'boom', stdout: '', stderr: '' }
      }
      return { ok: true, value: { ok: true, page: { title: 'T', url: 'https://x' } }, stdout: '', stderr: '' }
    },
    getStatus: async () => ({ ok: true, available: true, path: 'mock', exitCode: 0 }),
  }
  return { runner, scripts, ctl }
}

describe('regression: navigate failure must not poison the active space', () => {
  it('keeps the previously good active space when a later navigation fails', async () => {
    const { runner, scripts, ctl } = scriptedRunner()
    const server = createMcpServer({ defaultSpace: 'default' }, runner)
    const tools = toolsOf(server)

    // 1. Successful navigation promotes "good" to active.
    await call(server, 'navigate', { url: 'https://example.com', space: 'good', wait: true, timeout: 500 })
    // 2. A navigation to "poison" fails at the runner level.
    ctl.failNext = 1
    const failed = await call(server, 'navigate', {
      url: 'https://bad.example',
      space: 'poison',
      wait: true,
      timeout: 500,
    })
    expect(failed.isError).toBe(true)

    // 3. A subsequent no-space call must still target "good", not the failed "poison".
    scripts.length = 0
    await call(server, 'page_info', {})
    expect(scripts[scripts.length - 1]).toContain('taskSpaces.useOrCreate("good")')
    expect(scripts[scripts.length - 1]).not.toContain('useOrCreate("poison")')
    expect(tools.page_info).toBeDefined()
  })
})

describe('regression: any failed tool must not poison the active space', () => {
  it('keeps the good space after a failed snapshot on another space', async () => {
    const { runner, scripts, ctl } = scriptedRunner()
    const server = createMcpServer({ defaultSpace: 'default' }, runner)

    // 1. Successful navigation promotes "good" to active.
    await call(server, 'navigate', { url: 'https://example.com', space: 'good', wait: true, timeout: 500 })
    // 2. A snapshot on "poison" fails at the runner level.
    ctl.failNext = 1
    const failed = await call(server, 'snapshot', { scope: 'full_page', space: 'poison' })
    expect(failed.isError).toBe(true)

    // 3. A later no-space call must still target "good", not the failed "poison".
    scripts.length = 0
    await call(server, 'page_info', {})
    expect(scripts[scripts.length - 1]).toContain('taskSpaces.useOrCreate("good")')
    expect(scripts[scripts.length - 1]).not.toContain('useOrCreate("poison")')
  })

  it('keeps the good space after an ok:false snapshot on another space', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({ defaultSpace: 'default' }, runner)
    await call(server, 'navigate', { url: 'https://example.com', space: 'good', wait: true, timeout: 500 })

    // Override runScript to return an ok:false snapshot on the "poison" space.
    const orig = runner.runScript.bind(runner)
    runner.runScript = async (script, options) => {
      if (script.includes('useOrCreate("poison")')) {
        return { ok: true, value: { ok: false, reason: 'empty' }, stdout: '', stderr: '' }
      }
      return orig(script, options)
    }
    const failed = await call(server, 'snapshot', { scope: 'full_page', space: 'poison' })
    expect(failed.isError).toBe(true)

    scripts.length = 0
    await call(server, 'page_info', {})
    expect(scripts[scripts.length - 1]).toContain('taskSpaces.useOrCreate("good")')
    expect(scripts[scripts.length - 1]).not.toContain('useOrCreate("poison")')
  })
})

describe('regression: navigate must reject non-http(s) schemes', () => {
  it('rejects file://, javascript:, data: and chrome:// URLs before launching', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    for (const url of [
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'chrome://settings',
    ]) {
      const result = await call(server, 'navigate', { url, wait: true, timeout: 500 })
      expect(result.isError).toBe(true)
    }
    expect(scripts).toHaveLength(0)
  })

  it('still allows http and https URLs', async () => {
    const { runner } = scriptedRunner()
    const server = createMcpServer({}, runner)
    for (const url of ['https://example.com', 'http://localhost:8080']) {
      const result = await call(server, 'navigate', { url, wait: true, timeout: 500 })
      expect(result.isError).toBeUndefined()
    }
  })
})

describe('regression: script-level ok:false must surface as an MCP error', () => {
  it('marks snapshot empty-result as an error instead of a success', async () => {
    const runner: EgoRunner = {
      runScript: async () => ({
        ok: true,
        value: { ok: false, text: '', reason: 'snapshot returned no content after retries' },
        stdout: '',
        stderr: '',
      }),
      getStatus: async () => ({ ok: true, available: true, path: 'mock', exitCode: 0 }),
    }
    const server = createMcpServer({}, runner)
    const result = await call(server, 'snapshot', { scope: 'full_page' })
    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.ok).toBe(false)
    expect(payload.error).toContain('snapshot returned no content')
  })
})
