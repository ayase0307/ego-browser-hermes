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
    const result = await call(server, 'press', {
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
    const result = await call(server, 'press', { selector: 'input' })
    expect(result.isError).toBe(true)
    expect(scripts).toHaveLength(0)
  })
})

describe('scroll: lazy-loaded content is reachable', () => {
  it('dispatches a real wheel event and reports how far the page moved', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const result = await call(server, 'scroll', { dy: 900, dx: 0 })
    expect(result.isError).toBeUndefined()
    expect(last(scripts)).toContain('page.mouse.wheel(0, 900)')
    expect(last(scripts)).toContain('movedY')
  })
})

describe('dialog: only the call that opens one can answer it', () => {
  it('answers the dialog in the same script when onDialog is given', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    await call(server, 'click', { selector: 'css:#ask', double: false, timeout: 20_000, onDialog: 'accept' })
    const script = last(scripts)
    // settle first: handlers routinely open the dialog a tick after the click returns
    expect(script).toContain('page.waitForTimeout(600)')
    expect(script).toContain('Page.handleJavaScriptDialog')
    expect(script).toContain('accept: true')
    expect(script.indexOf('waitForTimeout(600)')).toBeLessThan(script.indexOf('handleJavaScriptDialog'))
  })

  it('dismisses instead of accepting when asked', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    await call(server, 'press', { key: 'Enter', onDialog: 'dismiss' })
    expect(last(scripts)).toContain('accept: false')
  })

  it('only reports the dialog when onDialog is omitted, and never stalls a caller that did not ask', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    await call(server, 'click', { selector: 'css:#ask', double: false, timeout: 20_000 })
    const script = last(scripts)
    expect(script).toContain('dialog: __dialog')
    expect(script).not.toContain('handleJavaScriptDialog')
    expect(script).not.toContain('waitForTimeout(600)')
    // the standalone dialog tool cannot work across processes and must not be advertised
    expect(toolsOf(server).dialog).toBeUndefined()
  })

  it('tells an observer how to recover instead of stalling on blocked page JavaScript', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    await call(server, 'page_info', {})
    const script = last(scripts)
    expect(script).toContain('Promise.race')
    expect(script).toContain('onDialog')
    expect(script).toContain('space_close')
  })
})

describe('control: handoff and takeover survive a delegated space', () => {
  it('hands control to the user without calling useOrCreate on the space', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, done: true })
    const server = createMcpServer({ defaultSpace: 'login-task' }, runner)
    await call(server, 'control', { action: 'handoff' })
    expect(last(scripts)).toContain('taskSpaces.handOff("login-task")')
    // useOrCreate throws once the space is delegated to the user, so it must not be emitted here.
    expect(last(scripts)).not.toContain('useOrCreate')
  })

  it('takes control back without calling useOrCreate on the space', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({ defaultSpace: 'login-task' }, runner)
    await call(server, 'control', { action: 'takeover' })
    expect(last(scripts)).toContain('taskSpaces.takeOver("login-task")')
    expect(last(scripts)).not.toContain('useOrCreate')
  })
})

describe('space_list and tabs: leftover state is discoverable', () => {
  it('lists task spaces with ownership', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, spaces: [] })
    const server = createMcpServer({}, runner)
    await call(server, 'space_list', {})
    expect(last(scripts)).toContain('taskSpaces.list()')
    expect(last(scripts)).toContain('ownership')
  })

  it('closes the current tab when no targetId is given', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true })
    const server = createMcpServer({}, runner)
    await call(server, 'tabs', { action: 'close' })
    expect(last(scripts)).toContain('browser.closeTab(undefined)')
  })

  it('refuses to switch tabs without a targetId', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const result = await call(server, 'tabs', { action: 'switch' })
    expect(result.isError).toBe(true)
    expect(scripts).toHaveLength(0)
  })
})

describe('snapshot: long pages cannot blow up a long-lived chat session', () => {
  it('truncates the returned tree at maxChars and reports the real size', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, text: 'x', tries: 0 })
    const server = createMcpServer({}, runner)
    await call(server, 'snapshot', { scope: 'full_page', maxChars: 5000 })
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
    await call(server, 'screenshot', {})
    expect(last(scripts)).toContain('ego-hermes-test-out')
    expect(last(scripts)).toContain('shot-')
    expect(existsSync(outputDir)).toBe(true)
    rmSync(outputDir, { recursive: true, force: true })
  })

  it('keeps the runtime default when no output directory is configured', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, path: 'p' })
    const server = createMcpServer({}, runner)
    await call(server, 'screenshot', {})
    expect(last(scripts)).toContain('await page.screenshot()')
  })

  it('warns in the result itself when artifacts have nowhere deliverable to land', async () => {
    const { runner } = scriptedRunner({ ok: true, path: 'p' })
    const server = createMcpServer({}, runner)
    const shot = JSON.parse((await call(server, 'screenshot', {})).content[0].text)
    expect(shot.warning).toContain('EGO_BROWSER_OUTPUT_DIR')
    const dl = JSON.parse((await call(server, 'download', { timeout: 1000 })).content[0].text)
    expect(dl.warning).toContain('EGO_BROWSER_OUTPUT_DIR')
    const status = JSON.parse((await call(server, 'status', {})).content[0].text)
    expect(status.outputDir).toBeNull()
    expect(status.warning).toContain('EGO_BROWSER_OUTPUT_DIR')
  })

  it('stays quiet once an output directory is configured', async () => {
    const configured = join(tmpdir(), 'ego-hermes-test-out2')
    const { runner } = scriptedRunner({ ok: true, path: 'p' })
    const server = createMcpServer({ outputDir: configured }, runner)
    const shot = JSON.parse((await call(server, 'screenshot', {})).content[0].text)
    expect(shot.warning).toBeUndefined()
    const status = JSON.parse((await call(server, 'status', {})).content[0].text)
    expect(status.outputDir).toBe(configured)
    expect(status.warning).toBeUndefined()
    rmSync(configured, { recursive: true, force: true })
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
    const result = await call(server, 'download', { timeout: 1000 })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).error).toContain('no file path')
  })
})

describe('efficiency: fewer round trips, cheaper tool list', () => {
  it('opens a space and its first page in one call', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, id: 7, name: 's' })
    const server = createMcpServer({}, runner)
    await call(server, 'space_open', { name: 'discord-1-task', url: 'https://example.com' })
    const script = last(scripts)
    expect(script).toContain('taskSpaces.useOrCreate("discord-1-task")')
    expect(script).toContain('page.goto("https://example.com"')
    expect(scripts).toHaveLength(1)
  })

  it('applies the same scheme guard as navigate when opening with a url', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'chrome://settings']) {
      const result = await call(server, 'space_open', { name: 's', url })
      expect(result.isError).toBe(true)
    }
    expect(scripts).toHaveLength(0)
  })

  it('still opens a bare space when no url is given', async () => {
    const { runner, scripts } = scriptedRunner({ ok: true, id: 7, name: 's' })
    const server = createMcpServer({}, runner)
    await call(server, 'space_open', { name: 's' })
    expect(last(scripts)).not.toContain('page.goto')
  })

  it('answers a beforeunload prompt raised by a navigation', async () => {
    const { runner, scripts } = scriptedRunner()
    const server = createMcpServer({}, runner)
    await call(server, 'navigate', { url: 'https://example.com', wait: true, timeout: 500, onDialog: 'accept' })
    expect(last(scripts)).toContain('Page.handleJavaScriptDialog')
  })

  it('accepts an allowlist written with the old prefixed tool names', async () => {
    const server = createMcpServer({ allowedTools: ['ego_browser_status', 'ego_browser_navigate'] })
    const tools = toolsOf(server)
    expect(tools.status).toBeDefined()
    expect(tools.navigate).toBeDefined()
    expect(tools.snapshot).toBeUndefined()
  })
})

describe('tool surface', () => {
  it('exposes the new safe tools and still hides every advanced tool by default', () => {
    const { runner } = scriptedRunner()
    const server = createMcpServer({}, runner)
    const tools = toolsOf(server)
    for (const name of DEFAULT_SAFE_TOOLS) expect(tools[name]).toBeDefined()
    for (const name of ['js', 'cdp', 'cli', 'http']) {
      expect(tools[name]).toBeUndefined()
    }
    expect(DEFAULT_SAFE_TOOLS).toHaveLength(17)
  })
})
