import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../src/index.ts'
import type { EgoRunner, EgoScriptResult } from '../src/types.ts'

function toolsOf(server: ReturnType<typeof createMcpServer>): Record<string, any> {
  const value = server as any
  return value._registeredTools || value._tools
}

function mockRunner(value: Record<string, unknown> = { ok: true }): {
  runner: EgoRunner
  scripts: string[]
  timeouts: Array<number | undefined>
} {
  const scripts: string[] = []
  const timeouts: Array<number | undefined> = []
  return {
    scripts,
    timeouts,
    runner: {
      runScript: async (script, options): Promise<EgoScriptResult> => {
        scripts.push(script)
        timeouts.push(options?.timeoutMs)
        return { ok: true, value, stdout: '', stderr: '' }
      },
      getStatus: async () => ({ ok: true, available: true, path: 'mock', exitCode: 0 }),
    },
  }
}

async function call(server: ReturnType<typeof createMcpServer>, name: string, args: unknown) {
  const tool = toolsOf(server)[name]
  return (tool.handler || tool.execute)(args)
}

describe('observation and interaction tools', () => {
  it('builds a bounded full-page snapshot script', async () => {
    const m = mockRunner({ ok: true, text: 'semantic tree', tries: 0 })
    const server = createMcpServer({}, m.runner)
    const result = await call(server, 'ego_browser_snapshot', { scope: 'full_page', space: 'research' })
    expect(m.scripts[0]).toContain('taskSpaces.useOrCreate("research")')
    expect(m.scripts[0]).toContain('page.snapshotRaw({ scope: "full_page" })')
    expect(m.scripts[0]).toContain('tries < 3')
    expect(JSON.parse(result.content[0].text).activeSpace).toBe('research')
  })

  it('reads page info from a real tab', async () => {
    const m = mockRunner({ ok: true, page: { title: 'Example' } })
    const server = createMcpServer({}, m.runner)
    await call(server, 'ego_browser_page_info', {})
    expect(m.scripts[0]).toContain('browser.listTabs()')
    expect(m.scripts[0]).toContain('page.info()')
  })

  it('escapes selector and fill text through JSON string literals', async () => {
    const m = mockRunner({ ok: true })
    const server = createMcpServer({}, m.runner)
    await call(server, 'ego_browser_fill', {
      selector: 'input[name="q"]',
      text: 'line 1\n"quoted"',
      timeout: 2000,
    })
    expect(m.scripts[0]).toContain('page.locator("input[name=\\"q\\"]")')
    expect(m.scripts[0]).toContain('.fill("line 1\\n\\"quoted\\"")')
    expect(m.timeouts[0]).toBe(17_000)
  })

  it('supports selector and coordinate clicks', async () => {
    const a = mockRunner({ ok: true })
    const selectorServer = createMcpServer({}, a.runner)
    await call(selectorServer, 'ego_browser_click', { selector: '@21', double: false, timeout: 500 })
    expect(a.scripts[0]).toContain('page.locator("@21").click()')

    const b = mockRunner({ ok: true })
    const coordinateServer = createMcpServer({}, b.runner)
    await call(coordinateServer, 'ego_browser_click', { x: 420, y: 260, double: true, timeout: 500 })
    expect(b.scripts[0]).toContain('page.mouse.dblclick(420, 260)')
  })

  it('waits inside the selected task space', async () => {
    const m = mockRunner({ ok: true, waitedMs: 250 })
    const server = createMcpServer({}, m.runner)
    await call(server, 'ego_browser_wait', { ms: 250, space: 'animation' })
    expect(m.scripts[0]).toContain('taskSpaces.useOrCreate("animation")')
    expect(m.scripts[0]).toContain('page.waitForTimeout(250)')
    expect(m.timeouts[0]).toBe(15_250)
  })

  it('rejects relative screenshot paths before running the browser', async () => {
    const m = mockRunner({ ok: true, path: 'never-used' })
    const server = createMcpServer({}, m.runner)
    const result = await call(server, 'ego_browser_screenshot', { path: 'relative/shot.png' })
    expect(result.isError).toBe(true)
    expect(m.scripts).toHaveLength(0)
  })

  it('returns runtime screenshot artifact paths without fabricating image data', async () => {
    const absolute = process.platform === 'win32' ? 'D:\\tmp\\shot.png' : '/tmp/shot.png'
    const m = mockRunner({ ok: true, path: absolute })
    const server = createMcpServer({}, m.runner)
    const result = await call(server, 'ego_browser_screenshot', { path: absolute, selector: '#hero' })
    expect(m.scripts[0]).toContain(`page.locator("#hero").screenshot`)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.path).toBe(absolute)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
  })

  it('propagates runner failures as MCP errors', async () => {
    const runner: EgoRunner = {
      runScript: async () => ({ ok: false, error: 'browser unavailable', stdout: '', stderr: '' }),
      getStatus: async () => ({ ok: true, available: false, path: '', exitCode: null }),
    }
    const result = await call(createMcpServer({}, runner), 'ego_browser_page_info', {})
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).error).toContain('browser unavailable')
  })
})
