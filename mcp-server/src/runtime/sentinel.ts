/**
 * Sentinel marker and script formatting helpers.
 */
export const SENTINEL = '@@HERMES_EGO_RESULT@@'

export const j = (v: unknown): string => JSON.stringify(v)

export const str = <T extends string | number>(v: unknown, fallback: T): string | T =>
  typeof v === 'string' && v !== '' ? v : fallback

export const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

export const SAFE_FN =
  'function safe(v){try{return JSON.parse(JSON.stringify(v))}catch{return String(v)}}\n'

export const useSpace = (name: string | number): string =>
  `const task = await taskSpaces.useOrCreate(${j(name)})\n`

/**
 * Switch to a real page tab, but only when we are not already on one: calling switchTab while a
 * native dialog is open wedges every later page-JavaScript call in that runtime process (verified
 * against real Chromium — page.info() then never resolves), which would make an open dialog
 * impossible to even observe, let alone clear.
 */
export const ensureRealTab = (): string =>
  `const __tabs = await browser.listTabs()\n` +
  `const __real = __tabs.find(t => !t.url.startsWith('about:') && !t.url.startsWith('chrome://')) ?? __tabs[0]\n` +
  `if (__real && !__real.active) await browser.switchTab(__real.targetId)\n`

/**
 * Scan stdout from bottom to top, find the line with SENTINEL, and parse its JSON payload.
 */
export function parseSentinel(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i]!.indexOf(SENTINEL)
    if (idx === -1) continue
    const payload = lines[i]!.slice(idx + SENTINEL.length).trim()
    try {
      return JSON.parse(payload) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * A native dialog blocks page JavaScript, and a *later* MCP call cannot clear it: a freshly
 * attached runtime process blocks even on Page.handleJavaScriptDialog (verified against real
 * Chromium). The only process that can deal with a dialog is the one whose action opened it,
 * so actions that can trigger one report it, and optionally answer it, in the same script.
 */
export const dialogReadback = (onDialog?: 'accept' | 'dismiss'): string => {
  const handle =
    onDialog === undefined
      ? ''
      : `  await cdp('Page.handleJavaScriptDialog', { accept: ${onDialog === 'accept'} })\n` +
        `  __dialog = { ...__dialog, answered: ${j(onDialog)} }\n` +
        `  pginfo = await page.info()\n`
  // A handler often opens its dialog a tick or a network round trip after the action returns,
  // so when the caller asked us to answer one, give it a moment to appear. Costs nothing on
  // calls that did not opt in.
  const settle = onDialog === undefined ? '' : `await page.waitForTimeout(600)\n`
  return (
    settle +
    `let pginfo = await page.info()\n` +
    `let __dialog = pginfo && pginfo.dialog ? pginfo.dialog : null\n` +
    `if (__dialog) {\n` +
    handle +
    `}\n`
  )
}
