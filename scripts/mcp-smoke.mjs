import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const serverPath = resolve('mcp-server/dist/index.js')
const child = spawn(process.execPath, [serverPath], {
  cwd: process.cwd(),
  env: { ...process.env, EGO_BROWSER_ENABLE_ADVANCED: 'false' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stderr = ''
let buffer = ''
let initialized = false
let finished = false

const timeout = setTimeout(() => fail(`MCP smoke timed out. stderr: ${stderr}`), 10_000)

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

function fail(message) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  child.kill()
  console.error(message)
  process.exitCode = 1
}

function succeed(toolNames) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  child.kill()
  console.log(JSON.stringify({ ok: true, toolCount: toolNames.length, tools: toolNames }, null, 2))
}

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8')
})

child.on('error', (error) => fail(`Failed to start MCP server: ${error.message}`))
child.on('exit', (code) => {
  if (!finished) fail(`MCP server exited early with code ${code}. stderr: ${stderr}`)
})

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n')
    const line = buffer.slice(0, index).replace(/\r$/, '')
    buffer = buffer.slice(index + 1)
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      fail(`Invalid JSON-RPC line: ${line}; ${error.message}`)
      return
    }
    if (message.id === 1 && message.result && !initialized) {
      initialized = true
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      continue
    }
    if (message.id === 2) {
      const names = (message.result?.tools ?? []).map((tool) => tool.name).sort()
      const expected = [
        'ego_browser_click',
        'ego_browser_download',
        'ego_browser_fill',
        'ego_browser_navigate',
        'ego_browser_page_info',
        'ego_browser_screenshot',
        'ego_browser_snapshot',
        'ego_browser_space_close',
        'ego_browser_space_open',
        'ego_browser_status',
        'ego_browser_upload',
        'ego_browser_wait',
      ].sort()
      if (JSON.stringify(names) !== JSON.stringify(expected)) {
        fail(`Unexpected tool list. expected=${JSON.stringify(expected)} actual=${JSON.stringify(names)}`)
        return
      }
      succeed(names)
    }
  }
})

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'ego-browser-hermes-smoke', version: '0.1.0' },
  },
})
