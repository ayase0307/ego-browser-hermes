#!/usr/bin/env node
/**
 * A stand-in for runtime/ego-linux/bin/ego-browser.mjs used by scripts/discord-sim.mjs.
 *
 * It never launches Chrome. It reads the generated script on stdin, pattern-matches the
 * facade calls the MCP server emitted, and prints the sentinel line the real runtime would
 * print — including the "user is controlling" hard stop while a space is handed off. State
 * lives in a JSON file because every call is a fresh process, exactly like the real runtime.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SENTINEL = '@@HERMES_EGO_RESULT@@'
const STATE = join(process.env.EGO_SIM_DIR || process.cwd(), 'sim-state.json')

if (process.argv.includes('--status')) process.exit(0)

const state = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, 'utf8'))
  : { handedOff: false, loggedIn: false, tabs: 3 }

const save = () => writeFileSync(STATE, JSON.stringify(state))
const emit = (value) => {
  save()
  process.stdout.write(SENTINEL + JSON.stringify(value) + '\n')
  process.exit(0)
}
const die = (message) => {
  save()
  process.stderr.write(message + '\n')
  process.exit(1)
}

// 1x1 transparent PNG, so the "screenshot" is a real file the host can attach.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const write = (path, body) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  return path
}

const script = readFileSync(0, 'utf8')
const arg = (re) => {
  const m = script.match(re)
  return m ? m[1] : null
}
// Paths inside the generated script are JSON-escaped (Windows separators are doubled).
const pathArg = (re) => {
  const raw = arg(re)
  if (raw === null) return null
  try {
    return JSON.parse('"' + raw + '"')
  } catch {
    return raw
  }
}

const page = (url, title) => ({ url, title, w: 1280, h: 800, sx: 0, sy: state.scrolled || 0 })

// --- ownership first: while the user holds the space, everything else is a hard stop ---
if (script.includes('taskSpaces.handOff(')) {
  state.handedOff = true
  emit({ ok: true, done: true })
}
if (script.includes('taskSpaces.takeOver(')) {
  state.handedOff = false
  state.loggedIn = true
  emit({ ok: true, page: page('https://billing.example.com/invoices', 'Invoices — Example Billing') })
}
if (state.handedOff) {
  die('ego error: user is controlling this task space')
}

// --- normal calls ---
if (script.includes('taskSpaces.list()')) {
  emit({
    ok: true,
    spaces: [
      { id: 7, name: 'discord-1194-invoice', ownership: 'agent', tabs: ['Invoices — Example Billing'] },
      { id: 4, name: 'discord-0921-flight-check', ownership: 'agent', tabs: ['Booking'] },
    ],
  })
}
if (script.includes('taskSpaces.complete(')) emit({ ok: true, done: true, skipped: false })
if (script.includes('browser.closeTab(')) emit({ ok: true, closed: 'current', remaining: --state.tabs })
if (script.includes('page.screenshot(') || script.includes('.screenshot(')) {
  const path = pathArg(/screenshot\(\{ path: "([^"]+)" \}\)/)
  emit({ ok: true, path: path ? write(path, PNG) : '/runtime/tmp/shot.png' })
}
if (script.includes("waitForEvent('download'")) {
  const path = pathArg(/saveAs\("([^"]+)"/)
  const finalPath = (path || '/runtime/tmp/dl') + '-invoice-2026-09.pdf'
  emit({
    ok: true,
    path: write(finalPath, '%PDF-1.4 simulated invoice\n'),
    suggestedFilename: 'invoice-2026-09.pdf',
    url: 'https://billing.example.com/invoices/2026-09.pdf',
  })
}
if (script.includes('page.keyboard.press(')) {
  emit({
    ok: true,
    typed: arg(/keyboard\.type\("([^"]*)"\)/),
    pressed: arg(/keyboard\.press\("([^"]*)"\)/),
    page: page('https://billing.example.com/invoices?q=2026-09', 'Search: 2026-09'),
  })
}
if (script.includes('page.mouse.wheel(')) {
  state.scrolled = (state.scrolled || 0) + 900
  emit({ ok: true, dx: 0, dy: 900, movedY: 900, page: page('https://billing.example.com/invoices', 'Invoices') })
}
if (script.includes('snapshotRaw(')) {
  const text = state.loggedIn
    ? [
        'document',
        '  heading "Invoices" [ref=11, loc=role:heading]',
        '  textbox "Search invoices" [ref=14, loc=css:input#q]',
        '  table [ref=20]',
        '    row "2026-09  NT$12,480  Unpaid" [ref=21]',
        '      link "Download PDF" [ref=22, loc=href:/invoices/2026-09.pdf]',
      ].join('\n')
    : [
        'document',
        '  heading "Sign in to Example Billing" [ref=3, loc=role:heading]',
        '  textbox "Email" [ref=5, loc=css:input#email]',
        '  textbox "Password" [ref=6, loc=css:input#password]',
        '  button "Sign in" [ref=7, loc=role:button]',
      ].join('\n')
  emit({ ok: true, text, tries: 0, totalChars: text.length, truncated: false })
}
if (script.includes('page.goto(') || script.includes('browser.switchTab(')) {
  emit({
    ok: true,
    reused: false,
    page: state.loggedIn
      ? page('https://billing.example.com/invoices', 'Invoices — Example Billing')
      : page('https://billing.example.com/login', 'Sign in — Example Billing'),
  })
}
if (script.includes('taskSpaces.useOrCreate(')) {
  emit({ ok: true, id: 7, name: arg(/useOrCreate\("([^"]+)"\)/) })
}

emit({ ok: true, page: page('https://billing.example.com/', 'Example Billing') })
