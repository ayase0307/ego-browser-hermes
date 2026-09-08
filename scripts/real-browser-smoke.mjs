import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const server = resolve('mcp-server/dist/index.js')
const screenshot = 'D:/Users/msdn/Hermes/temp/ego-browser-hermes-smoke.png'
const space = 'hermes-real-smoke'
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: {
    ...process.env,
    EGO_LINUX_DATA_DIR: 'D:/Users/msdn/Hermes/ego-browser-data',
    EGO_BROWSER_ENABLE_ADVANCED: 'false',
  },
})
const client = new Client({ name: 'ego-browser-real-smoke', version: '0.1.0' })

function parse(result) {
  const text = result.content?.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('MCP tool returned no text content')
  const value = JSON.parse(text)
  if (result.isError || value.ok === false) throw new Error(value.error || value.reason || text)
  return value
}

let opened = false
try {
  await client.connect(transport)
  const status = parse(await client.callTool({ name: 'ego_browser_status', arguments: {} }))
  const openedResult = parse(await client.callTool({ name: 'ego_browser_space_open', arguments: { name: space } }))
  opened = true
  const navigation = parse(
    await client.callTool({
      name: 'ego_browser_navigate',
      arguments: { url: 'https://example.com', wait: true, timeout: 30_000, space },
    }),
  )
  const pageInfo = parse(await client.callTool({ name: 'ego_browser_page_info', arguments: { space } }))
  const snapshot = parse(
    await client.callTool({ name: 'ego_browser_snapshot', arguments: { space, scope: 'full_page' } }),
  )
  const shot = parse(
    await client.callTool({ name: 'ego_browser_screenshot', arguments: { space, path: screenshot } }),
  )
  if (!existsSync(screenshot)) throw new Error(`Screenshot was not created: ${screenshot}`)
  const bytes = statSync(screenshot).size
  if (bytes <= 0) throw new Error(`Screenshot is empty: ${screenshot}`)
  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeAvailable: status.available,
        space: openedResult.activeSpace,
        url: pageInfo.page?.url ?? navigation.page?.url,
        title: pageInfo.page?.title ?? navigation.page?.title,
        snapshotChars: typeof snapshot.text === 'string' ? snapshot.text.length : 0,
        screenshot: shot.path,
        screenshotBytes: bytes,
      },
      null,
      2,
    ),
  )
} finally {
  if (opened) {
    try {
      await client.callTool({ name: 'ego_browser_space_close', arguments: { name: space, keep: false } })
    } catch (error) {
      console.error(`Failed to close smoke task space: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await client.close()
}
