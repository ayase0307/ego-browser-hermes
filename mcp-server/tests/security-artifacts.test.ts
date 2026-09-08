import { describe, expect, it } from 'vitest'
import { createMcpServer, DEFAULT_SAFE_TOOLS } from '../src/index.ts'
import { ADVANCED_TOOLS } from '../src/tools/advanced.ts'
import type { EgoRunner, EgoScriptResult } from '../src/types.ts'

function toolsOf(server: ReturnType<typeof createMcpServer>): Record<string, any> {
  const value = server as any
  return value._registeredTools || value._tools
}

function recordingRunner(value: Record<string, unknown> = { ok: true }) {
  const scripts: string[] = []
  const runner: EgoRunner = {
    runScript: async (script): Promise<EgoScriptResult> => {
      scripts.push(script)
      return { ok: true, value, stdout: '', stderr: '' }
    },
    getStatus: async () => ({ ok: true, available: true, path: 'mock', exitCode: 0 }),
  }
  return { runner, scripts }
}

async function call(server: ReturnType<typeof createMcpServer>, name: string, args: unknown) {
  const tool = toolsOf(server)[name]
  return (tool.handler || tool.execute)(args)
}

describe('artifact tools', () => {
  it('keeps download and upload in the default safe registry', () => {
    const names = Object.keys(toolsOf(createMcpServer()))
    expect(names.sort()).toEqual([...DEFAULT_SAFE_TOOLS].sort())
    expect(names).toContain('ego_browser_download')
    expect(names).toContain('ego_browser_upload')
  })

  it('rejects relative upload paths before spawning', async () => {
    const r = recordingRunner()
    const result = await call(createMcpServer({}, r.runner), 'ego_browser_upload', {
      selector: 'input[type=file]',
      path: 'relative.txt',
    })
    expect(result.isError).toBe(true)
    expect(r.scripts).toHaveLength(0)
  })

  it('builds selector-triggered download without arbitrary page script support', async () => {
    const r = recordingRunner({ ok: true, path: 'D:/downloads/report.pdf' })
    const server = createMcpServer({}, r.runner)
    const result = await call(server, 'ego_browser_download', {
      triggerSelector: 'a.download',
      timeout: 5000,
    })
    expect(result.isError).toBeUndefined()
    expect(r.scripts[0]).toContain('page.waitForEvent')
    expect(r.scripts[0]).toContain('page.locator("a.download").click()')
    expect(r.scripts[0]).not.toContain('page.evaluate')
  })
})

describe('advanced tool gate', () => {
  it('does not expose advanced tools by default', () => {
    const names = Object.keys(toolsOf(createMcpServer()))
    for (const name of ADVANCED_TOOLS) expect(names).not.toContain(name)
  })

  it('exposes advanced tools only when enableAdvanced is true', () => {
    const names = Object.keys(toolsOf(createMcpServer({ enableAdvanced: true })))
    for (const name of ADVANCED_TOOLS) expect(names).toContain(name)
  })

  it('requires both advanced enablement and allowlist membership when allowlisted', () => {
    const disabled = Object.keys(
      toolsOf(createMcpServer({ enableAdvanced: false, allowedTools: ['ego_browser_js'] })),
    )
    expect(disabled).not.toContain('ego_browser_js')

    const enabled = Object.keys(
      toolsOf(createMcpServer({ enableAdvanced: true, allowedTools: ['ego_browser_status', 'ego_browser_js'] })),
    )
    expect(enabled.sort()).toEqual(['ego_browser_js', 'ego_browser_status'])
  })

  it('JSON-escapes JS expressions and CDP parameters', async () => {
    const js = recordingRunner({ ok: true, result: 'x' })
    const jsServer = createMcpServer({ enableAdvanced: true }, js.runner)
    await call(jsServer, 'ego_browser_js', { expression: 'document.title + "\\n"' })
    expect(js.scripts[0]).toContain('page.evaluate("document.title + \\"\\\\n\\"")')

    const cdp = recordingRunner({ ok: true })
    const cdpServer = createMcpServer({ enableAdvanced: true }, cdp.runner)
    await call(cdpServer, 'ego_browser_cdp', { method: 'Page.handleJavaScriptDialog', params: { accept: true } })
    expect(cdp.scripts[0]).toContain('cdp("Page.handleJavaScriptDialog", {"accept":true})')
  })
})
