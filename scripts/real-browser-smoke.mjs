/**
 * Real-browser smoke: drives an actual Chromium task space through the MCP server.
 *
 * It serves its own fixture page on 127.0.0.1 so the assertions are deterministic and no
 * external site is involved. Covers the safe surface end to end, including the tools that
 * exist specifically for chat hosts: press (submit a form with Enter), scroll, dialog
 * (a native confirm blocks page JavaScript until it is handled), tabs and space_list.
 *
 * Paths come from the OS temp dir; override with EGO_LINUX_DATA_DIR / EGO_BROWSER_OUTPUT_DIR.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const outputDir = process.env.EGO_BROWSER_OUTPUT_DIR || join(tmpdir(), 'ego-hermes-smoke')
const dataDir = process.env.EGO_LINUX_DATA_DIR || join(tmpdir(), 'ego-hermes-smoke-data')
mkdirSync(outputDir, { recursive: true })

const FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ego smoke fixture</title></head>
<body style="font-family:system-ui">
  <h1 id="top">ego-browser smoke fixture</h1>
  <form method="get" action="/">
    <input id="q" name="q" placeholder="Search" style="font-size:18px">
  </form>
  <button id="ask" onclick="setTimeout(function(){ if (confirm('proceed?')) document.title = 'confirmed'; }, 300)">
    Ask
  </button>
  <div style="height:3000px"></div>
  <p id="bottom">bottom marker</p>
</body></html>`

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(FIXTURE)
})
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${http.address().port}/`

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('mcp-server/dist/index.js')],
  env: {
    ...process.env,
    EGO_LINUX_DATA_DIR: dataDir,
    EGO_BROWSER_OUTPUT_DIR: outputDir,
    EGO_BROWSER_ENABLE_ADVANCED: 'false',
  },
})
const client = new Client({ name: 'ego-browser-real-smoke', version: '0.2.0' })
const space = 'hermes-real-smoke'
const checks = []

function parse(result) {
  const text = result.content?.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('MCP tool returned no text content')
  const value = JSON.parse(text)
  if (result.isError || value.ok === false) throw new Error(value.error || value.reason || text)
  return value
}

const callTool = async (name, args) => parse(await client.callTool({ name, arguments: { ...args, space } }))

function check(label, condition, detail) {
  checks.push({ label, ok: Boolean(condition), detail })
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

let opened = false
try {
  await client.connect(transport)
  const status = parse(await client.callTool({ name: 'status', arguments: {} }))
  check('runtime available', status.available, status.path)

  // space_open carries the first URL, so a task costs one runtime spawn less
  const openedSpace = parse(await client.callTool({ name: 'space_open', arguments: { name: space, url: base } }))
  opened = true
  check('space_open', Boolean(openedSpace.ok), `activeSpace=${openedSpace.activeSpace}`)
  check('space_open opened the page in the same call', openedSpace.page?.url?.startsWith('http://127.0.0.1'), openedSpace.page?.title)

  const nav = await callTool('navigate', { url: `${base}?nav=1`, wait: true, timeout: 30_000 })
  check('navigate to fixture', nav.page?.url?.includes('nav=1'), nav.page?.title)

  const snap = await callTool('snapshot', { scope: 'full_page', maxChars: 20_000 })
  check('snapshot has content', typeof snap.text === 'string' && snap.text.length > 0, `${snap.totalChars} chars`)
  check('snapshot reports truncation flag', snap.truncated === false, `truncated=${snap.truncated}`)

  // press: fill the box, then submit the form with Enter — the query must land in the URL.
  await callTool('fill', { selector: 'css:#q', text: 'hermes' })
  const pressed = await callTool('press', { key: 'Enter', selector: 'css:#q' })
  const afterPress = await callTool('page_info', {})
  check('press Enter submitted the form', afterPress.page?.url?.includes('q=hermes'), afterPress.page?.url)
  check('press reported the key', pressed.pressed === 'Enter')

  // dialog: only the call that opens a native dialog can answer it — a later call, even a
  // browser-level CDP one, blocks on the modal. onDialog does it in the same script.
  const answered = await callTool('click', {
    selector: 'css:#ask',
    timeout: 20_000,
    onDialog: 'accept',
  })
  check('click reported the dialog it opened', Boolean(answered.dialog), JSON.stringify(answered.dialog ?? null).slice(0, 90))
  check('onDialog answered it in the same call', answered.dialog?.answered === 'accept')
  const cleared = await callTool('page_info', {})
  check('page JS resumed after the dialog was answered', !cleared.page?.dialog, `title=${cleared.page?.title}`)
  check('the accepted confirm ran its handler', cleared.page?.title === 'confirmed', cleared.page?.title)

  // scroll: a real wheel event must move the document.
  const scrolled = await callTool('scroll', { dy: 900 })
  check('scroll moved the page', (scrolled.page?.sy ?? 0) > 0, `sy=${scrolled.page?.sy} movedY=${scrolled.movedY}`)

  // screenshot with no path must land in EGO_BROWSER_OUTPUT_DIR.
  const shot = await callTool('screenshot', {})
  const inOutputDir = typeof shot.path === 'string' && shot.path.replace(/\\/g, '/').includes(outputDir.replace(/\\/g, '/'))
  check('screenshot landed in the output dir', inOutputDir, shot.path)
  check('screenshot file is non-empty', existsSync(shot.path) && statSync(shot.path).size > 0, `${existsSync(shot.path) ? statSync(shot.path).size : 0} bytes`)

  const tabs = await callTool('tabs', { action: 'list' })
  check('tabs list', Array.isArray(tabs.tabs) && tabs.tabs.length > 0, `${tabs.tabs?.length} tab(s)`)

  const spaces = parse(await client.callTool({ name: 'space_list', arguments: {} }))
  check('space_list sees this space', (spaces.spaces ?? []).some((s) => String(s.name) === space || String(s.id) === String(openedSpace.activeSpace)), JSON.stringify(spaces.spaces?.map((s) => s.name)))
} finally {
  if (opened) {
    try {
      parse(await client.callTool({ name: 'space_close', arguments: { name: space, keep: false } }))
      check('space_close', true)
    } catch (error) {
      check('space_close', false, error instanceof Error ? error.message : String(error))
    }
  }
  await client.close()
  http.close()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) {
  console.error('FAILED: ' + failed.map((c) => c.label).join(', '))
  process.exitCode = 1
}
