#!/usr/bin/env node
/**
 * Replays a Discord-shaped conversation against the REAL MCP server over stdio.
 *
 * Everything below the chat lines is genuine: real JSON-RPC, the real tool schemas, the real
 * generated ego-browser scripts. Only Chrome is faked (scripts/fake-ego-runtime.mjs), so the
 * run is deterministic and needs no browser. Usage: node scripts/discord-sim.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const OUT = join(tmpdir(), 'ego-hermes-sim')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const server = spawn(process.execPath, [resolve('mcp-server/dist/index.js')], {
  env: {
    ...process.env,
    EGO_BROWSER_BIN: resolve('scripts/fake-ego-runtime.mjs'),
    EGO_BROWSER_OUTPUT_DIR: OUT,
    EGO_SIM_DIR: OUT,
    EGO_BROWSER_ENABLE_ADVANCED: 'false',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let buffer = ''
let nextId = 1
const pending = new Map()

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  while (buffer.includes('\n')) {
    const i = buffer.indexOf('\n')
    const line = buffer.slice(0, i).replace(/\r$/, '')
    buffer = buffer.slice(i + 1)
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    const resolver = pending.get(msg.id)
    if (resolver) {
      pending.delete(msg.id)
      resolver(msg)
    }
  }
})
server.stderr.on('data', (c) => process.stderr.write(c))

function rpc(method, params) {
  const id = nextId++
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((res) => pending.set(id, res))
}

const SPACE = 'discord-1194-invoice'
const dim = (s) => `[2m${s}[0m`
const bold = (s) => `[1m${s}[0m`
const green = (s) => `[32m${s}[0m`
const red = (s) => `[31m${s}[0m`
const cyan = (s) => `[36m${s}[0m`

const chat = (who, text) => console.log(`  ${bold(who)}  ${text}`)
const note = (text) => console.log(dim(`  ── ${text}`))

async function tool(name, args, { expectError = false } = {}) {
  const res = await rpc('tools/call', { name, arguments: args })
  const payload = res.result?.content?.[0]?.text ?? JSON.stringify(res.error)
  const failed = Boolean(res.result?.isError)
  const flat = payload.replace(/\s+/g, ' ').trim()
  console.log(dim(`     → ${name} ${JSON.stringify(args)}`))
  console.log(`     ${failed ? red('← isError') : green('← ok')} ${dim(flat.slice(0, 180))}`)
  if (failed !== expectError) {
    console.error(red(`\nUNEXPECTED: ${name} isError=${failed}, expected ${expectError}`))
    process.exit(1)
  }
  return JSON.parse(payload)
}

await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'discord-sim', version: '1.0.0' },
})
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const list = await rpc('tools/list', {})
const names = list.result.tools.map((t) => t.name).sort()

console.log(bold('\n╭─ Hermes MCP: ego_browser ') + dim('(real server, faked Chrome)'))
console.log(`│  ${names.length} tools: ${dim(names.map((n) => n.replace('ego_browser_', '')).join(' '))}`)
console.log(bold('╰─\n'))

console.log(bold(`╭─ #billing  ${dim('Discord')}`))
chat('kirit', '幫我上 billing.example.com 把這個月的發票 PDF 抓下來')
chat('hermes', '開瀏覽器查一下，稍等 ⏳')
note('progress line first — a long tool chain must not look dead in chat')

await tool('ego_browser_status', {})
await tool('ego_browser_space_open', { name: SPACE })
note('space name carries the channel id, so another chat cannot steal the active space')
await tool('ego_browser_navigate', { url: 'https://billing.example.com/invoices', space: SPACE })
const wall = await tool('ego_browser_snapshot', { space: SPACE, scope: 'full_page', maxChars: 20000 })

console.log()
note(`snapshot shows a login wall (${wall.totalChars} chars, truncated=${wall.truncated})`)
await tool('ego_browser_control', { action: 'handoff', space: SPACE })
chat(
  'hermes',
  '這個站需要登入，我把瀏覽器交還給你了 👉 請到主機上那個 Chromium 視窗登入，好了在這邊跟我說一聲。',
)

console.log()
note('while the user holds control, every other call is a hard stop — not something to retry')
await tool('ego_browser_snapshot', { space: SPACE, scope: 'full_page' }, { expectError: true })

console.log()
chat('kirit', '好了，登進去了')
await tool('ego_browser_control', { action: 'takeover', space: SPACE })
note('takeover only after the user says so')

await tool('ego_browser_fill', { selector: 'css:input#q', text: '2026-09', space: SPACE })
await tool('ego_browser_press', { key: 'Enter', selector: 'css:input#q', space: SPACE })
note('fill + press Enter — before this change the safe tool set could not submit a search box')
await tool('ego_browser_scroll', { dy: 900, space: SPACE })
await tool('ego_browser_snapshot', { space: SPACE, scope: 'full_page' })

const shot = await tool('ego_browser_screenshot', { space: SPACE })
const dl = await tool('ego_browser_download', { triggerSelector: 'loc=href:/invoices/2026-09.pdf', space: SPACE })
note('both artifacts landed in EGO_BROWSER_OUTPUT_DIR, so the host can attach them')

await tool('ego_browser_tabs', { action: 'close', space: SPACE })
await tool('ego_browser_space_close', { name: SPACE, keep: false })

console.log()
chat('hermes', '2026-09 的發票抓好了，NT$12,480（未付）。附上 PDF 跟頁面截圖：')
console.log(`     ${cyan('📎 ' + dl.path.split(/[\\/]/).pop())}   ${cyan('🖼 ' + shot.path.split(/[\\/]/).pop())}`)
console.log(bold('╰─\n'))

const files = readdirSync(OUT)
  .filter((f) => f !== 'sim-state.json')
  .map((f) => `${f} (${statSync(join(OUT, f)).size} bytes)`)
console.log(bold('Files actually written:'), OUT)
for (const f of files) console.log('  •', f)
console.log(green('\nSimulation completed with no unexpected tool errors.\n'))

server.kill()
