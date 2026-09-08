import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createMcpServer, DEFAULT_SAFE_TOOLS } from '../src/index.ts'
import type { EgoRunner, EgoScriptResult } from '../src/types.ts'

function toolsOf(server: ReturnType<typeof createMcpServer>): Record<string, any> {
  const value = server as any
  return value._registeredTools || value._tools
}

async function call(server: ReturnType<typeof createMcpServer>, name: string, args: unknown) {
  const tool = toolsOf(server)[name]
  return (tool.handler || tool.execute)(args)
}

function scriptedRunner(value?: unknown): { runner: EgoRunner; scripts: string[] } {
  const scripts: string[] = []
  const runner: EgoRunner = {
    runScript: async (script): Promise<EgoScriptResult> => {
      scripts.push(script)
      return { ok: true, value: value ?? { ok: true, page: { url: 'https://x', sy: 900 } }, stdout: '', stderr: '' }
    },
    getStatus: async () => ({ ok: true, available: true, path: 'mock', exitCode: 0 }),
  }
  return { runner, scripts }
}

const last = (scripts: string[]): string => scripts[scripts.length - 1] ?? ''

describe('keyboard: a search box can be submitted without the advanced js tool', () => {
  it('focuses the selector, types the text, then presses the key', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const result = await call(server, 'ego_browser_press', {
      selector: 'input[name=q]',
      text: 'hermes mcp',
      key: 'Enter',
    })
    expect(result.isError).toBeUndefined()
    const script = last(scripts)
    expect(script).toContain('page.locator("input[name=q]").focus()')
    expect(script).toContain('page.keyboard.type("hermes mcp")')
    expect(script).toContain('page.keyboard.press("Enter")')
    expect(script.indexOf('.focus()')).toBeLessThan(script.indexOf('keyboard.type'))
    expect(script.indexOf('keyboard.type')).toBeLessThan(script.indexOf('keyboard.press'))
  })

  it('rejects a press with neither key nor text instead of running an empty script', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const result = await call(server, 'ego_browser_press', { selector: 'input' })
    expect(result.isError).toBe(true)
    expect(scripts).toHaveLength(0)
  })
})

describe('scroll: lazy-loaded content is reachable', () => {
  it('dispatches a real wheel event and reports how far the page moved', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const result = await call(server, 'ego_browser_scroll', { dy: 900, dx: 0 })
    expect(result.isError).toBeUndefined()
    expect(last(scripts)).toContain('page.mouse.wheel(0, 900)')
    expect(last(scripts)).toContain('movedY')
  })
})

describe('dialog: a native alert/confirm does not deadlock the safe tool set', () => {
  it('handles the dialog without exposing raw CDP to the caller', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    await call(server, 'ego_browser_dialog', { accept: true, promptText: 'yes' })
    expect(last(scripts)).toContain('Page.handleJavaScriptDialog')
    expect(last(scripts)).toContain('accept: true')
    expect(toolsOf(server).ego_browser_cdp).toBeUndefined()
  })
})

describe('control: handoff and takeover survive a delegated space', () => {
  it('hands control to the user without calling useOrCreate on the space', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, done: true })
    const server = createMcpServer({ defaultSpace: 'login-task' }, runner)
    await call(server, 'ego_browser_control', { action: 'handoff' })
    expect(last(scripts)).toContain('taskSpaces.handOff("login-task")')
    // useOrCreate throws once the space is delegated to the user, so it must not be emitted here.
    expect(last(scripts)).not.toContain('useOrCreate')
  })

  it('takes control back without calling useOrCreate on the space', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({ defaultSpace: 'login-task' }, runner)
    await call(server, 'ego_browser_control', { action: 'takeover' })
    expect(last(scripts)).toContain('taskSpaces.takeOver("login-task")')
    expect(last(scripts)).not.toContain('useOrCreate')
  })
})

describe('space_list and tabs: leftover state is discoverable', () => {
  it('lists task spaces with ownership', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, spaces: [] })
    const server = createMcpServer({}, runner)
    await call(server, 'ego_browser_space_list', {})
    expect(last(scripts)).toContain('taskSpaces.list()')
    expect(last(scripts)).toContain('ownership')
  })

  it('closes the current tab when no targetId is given', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true })
    const server = createMcpServer({}, runner)
    await call(server, 'ego_browser_tabs', { action: 'close' })
    expect(last(scripts)).toContain('browser.closeTab(undefined)')
  })

  it('refuses to switch tabs without a targetId', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const result = await call(server, 'ego_browser_tabs', { action: 'switch' })
    expect(result.isError).toBe(true)
    expect(scripts).toHaveLength(0)
  })
})

describe('snapshot: long pages cannot blow up a long-lived chat session', () => {
  it('truncates the returned tree at maxChars and reports the real size', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, text: 'x', tries: 0 })
    const server = createMcpServer({}, runner)
    await call(server, 'ego_browser_snapshot', { scope: 'full_page', maxChars: 5000 })
    expect(last(scripts)).toContain('full.slice(0, 5000)')
    expect(last(scripts)).toContain('truncated: full.length > 5000')
  })
})

describe('artifacts: files land where the agent host can attach them', () => {
  const outputDir = join(tmpdir(), 'ego-hermes-test-out')

  it('writes a screenshot into the configured output directory by default', async () => {
    rmSync(outputDir, { recursive: true, force: true })
    const { runner, scripts } = scriptedRunner({ ok: true, path: 'p' })
    const server = createMcpServer({ outputDir }, runner)
    await call(server, 'ego_browser_screenshot', {})
    expect(last(scripts)).toContain('ego-hermes-test-out')
    expect(last(scripts)).toContain('shot-')
    expect(existsSync(outputDir)).toBe(true)
    rmSync(outputDir, { recursive: true, force: true })
  })

  it('keeps the runtime default when no output directory is configured', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, path: 'p' })
    const server = createMcpServer({}, runner)
    await call(server, 'ego_browser_screenshot', {})
    expect(last(scripts)).toContain('await page.screenshot()')
  })

  it('reports a download that produced no file as an error', async () => {
    const runner: EgoRunner = {
      runScript: async () => ({
        ok: true,
        value: { ok: false, error: 'download completed but no file path was produced (saveAs failed)' },
        stdout: '',
        stderr: '',
      }),
      getStatus: async () => ({ ok: true, available: true, path: 'mock', exitCode: 0 }),
    }
    const server = createMcpServer({}, runner)
    const result = await call(server, 'ego_browser_download', { timeout: 1000 })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).error).toContain('no file path')
  })
})

describe('tool surface', () => {
  it('exposes the new safe tools and still hides every advanced tool by default', () => {
    const { runner } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const tools = toolsOf(server)
    for (const name of DEFAULT_SAFE_TOOLS) expect(tools[name]).toBeDefined()
    for (const name of ['ego_browser_js', 'ego_browser_cdp', 'ego_browser_cli', 'ego_browser_http']) {
      expect(tools[name]).toBeUndefined()
    }
    expect(DEFAULT_SAFE_TOOLS).toHaveLength(18)
  })
})
