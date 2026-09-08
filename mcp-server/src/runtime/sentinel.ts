/**
 * Sentinel marker and script formatting helpers.
 */
export const SENTINEL = '@@DSH_RESULT@@'

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

export const ensureRealTab = (): string =>
  `const __tabs = await browser.listTabs()\n` +
  `const __real = __tabs.find(t => !t.url.startsWith('about:') && !t.url.startsWith('chrome://')) ?? __tabs[0]\n` +
  `if (__real) await browser.switchTab(__real.targetId)\n`

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
