import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { McpConfig } from '../types.ts'

export const EGO_CLI_BLOCKED = new Set<string>([
  '--status',
  '--stop',
  '--open',
  '--spaces',
  '--spaces-daemon',
  '--prune-spaces',
  '--import-chrome-profile',
  '--install-desktop-entry',
  '--help',
  '-h',
])

export const CHROME_BLOCKED = new Set<string>([
  '--user-data-dir',
  '--remote-debugging-port',
  '--remote-allow-origins',
  '--headless',
  '--no-startup-window',
  '--proxy-server',
  '--proxy-bypass-list',
])

export function tokenizeArgs(input: unknown): string[] {
  if (typeof input !== 'string') return []
  const out: string[] = []
  let cur = ''
  let i = 0
  let quote: string | null = null
  while (i < input.length) {
    const c = input[i]!
    if (quote) {
      if (c === '\\') {
        const next = input[i + 1]
        if (next !== undefined) {
          cur += next
          i += 2
          continue
        }
      } else if (c === quote) {
        quote = null
        i += 1
        continue
      }
      cur += c
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      i += 1
      continue
    }
    if (c === '\\') {
      const next = input[i + 1]
      if (next !== undefined) {
        cur += next
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (cur !== '') {
        out.push(cur)
        cur = ''
      }
      i += 1
      continue
    }
    cur += c
    i += 1
  }
  if (cur !== '') out.push(cur)
  return out
}

export function filterArgs(raw: string, blocked: Set<string>): string[] {
  const tokens = tokenizeArgs(raw)
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    const key = tok.includes('=') ? tok.slice(0, tok.indexOf('=')) : tok
    if (blocked.has(key)) {
      if (!tok.includes('=') && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) {
        i += 1
      }
      continue
    }
    kept.push(tok)
  }
  return kept
}

const COMMON_POSIX_CHROME_BINS = [
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/google-chrome',
]

function windowsChromeCandidates(): string[] {
  const pf = process.env.ProgramFiles
  const pfx86 = process.env['ProgramFiles(x86)']
  const local = process.env.LOCALAPPDATA
  const base = local || `${process.env.USERPROFILE || process.env.HOME || ''}\\AppData\\Local`
  const b = (p: string | undefined): string | undefined => (p ? p.replace(/\\+$/, '') : p)
  const out = [
    b(pf) + '\\Google\\Chrome\\Application\\chrome.exe',
    b(pfx86) + '\\Google\\Chrome\\Application\\chrome.exe',
    b(local) + '\\Google\\Chrome\\Application\\chrome.exe',
    b(pf) + '\\Microsoft\\Edge\\Application\\msedge.exe',
    b(pfx86) + '\\Microsoft\\Edge\\Application\\msedge.exe',
    b(local) + '\\Microsoft\\Edge\\Application\\msedge.exe',
    b(pfx86) + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    b(local) + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ]
  return out.filter(Boolean) as string[]
}

export function findChromeBinary(customPath?: string): string | undefined {
  if (customPath && customPath.trim() !== '') {
    return customPath
  }
  if (process.env.EGO_LINUX_CHROME) {
    return process.env.EGO_LINUX_CHROME
  }

  if (process.platform === 'win32') {
    for (const p of windowsChromeCandidates()) {
      try {
        if (existsSync(p)) return p
      } catch {
        // fall through
      }
    }
    const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .filter(Boolean)
      .map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
    const dirs = (process.env.PATH ?? '')
      .split(';')
      .map((d) => d.replace(/^"|"$/g, ''))
      .filter(Boolean)
    for (const dir of dirs) {
      for (const name of ['chrome', 'msedge', 'brave']) {
        for (const ext of exts) {
          try {
            const p = `${dir}\\${name}${ext}`
            if (existsSync(p)) return p
          } catch {
            // fall through
          }
        }
      }
    }
    return undefined
  }

  // POSIX
  for (const name of COMMON_POSIX_CHROME_BINS) {
    if (name.includes('/')) {
      try {
        if (existsSync(name)) return name
      } catch {
        // fall through
      }
    } else {
      for (const dir of (process.env.PATH ?? '').split(':')) {
        if (!dir) continue
        const p = `${dir}/${name}`
        try {
          if (existsSync(p)) return p
        } catch {
          // fall through
        }
      }
    }
  }
  return undefined
}

export function resolveVendoredBin(overrideBin?: string): string {
  if (overrideBin && overrideBin.trim() !== '') {
    return overrideBin
  }
  if (process.env.EGO_BROWSER_BIN && process.env.EGO_BROWSER_BIN.trim() !== '') {
    return process.env.EGO_BROWSER_BIN
  }
  try {
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)
    const candidates = [
      resolve(currentDir, '../../../runtime/ego-linux/bin/ego-browser.mjs'),
      resolve(currentDir, '../../runtime/ego-linux/bin/ego-browser.mjs'),
      resolve(process.cwd(), 'runtime/ego-linux/bin/ego-browser.mjs'),
    ]
    for (const cand of candidates) {
      if (existsSync(cand)) return cand
    }
    return candidates[0]!
  } catch {
    return resolve(process.cwd(), 'runtime/ego-linux/bin/ego-browser.mjs')
  }
}

export function resolveEgoEnv(
  config: Partial<McpConfig> = {},
  { platform = process.platform, baseEnv = process.env }: { platform?: NodeJS.Platform; baseEnv?: NodeJS.ProcessEnv } = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }

  const chrome = config.chromePath || findChromeBinary(config.chromePath)
  if (env.EGO_LINUX_CHROME === undefined && chrome) {
    env.EGO_LINUX_CHROME = chrome
  }

  if (env.EGO_LINUX_HEADLESS === undefined) {
    if (platform !== 'win32' && platform !== 'darwin') {
      if (!env.DISPLAY) {
        env.EGO_LINUX_HEADLESS = '1'
      }
    }
  }

  const chromeArgs = config.chromeArgs
  if (env.EGO_LINUX_EXTRA_ARGS === undefined && typeof chromeArgs === 'string' && chromeArgs.trim() !== '') {
    env.EGO_LINUX_EXTRA_ARGS = chromeArgs
  }

  if (config.dataDir && !env.EGO_LINUX_DATA_DIR) {
    env.EGO_LINUX_DATA_DIR = config.dataDir
  }

  return env
}

export interface ActiveSpaceTracker {
  current(): string | number
  opened(args: { name?: string | number }, result?: { id?: string | number; name?: string; done?: boolean; [key: string]: unknown }): void
  selected(space: string | number): void
  closed(space: string | number, done: boolean): void
}

export function createActiveSpaceTracker(defaultSpace: string | number = 'hermes-agent'): ActiveSpaceTracker {
  let activeSpace: string | number = defaultSpace
  let activeName: string | null = typeof defaultSpace === 'string' ? defaultSpace : null
  return {
    current: () => activeSpace,
    opened: (args, result) => {
      activeName = (result?.name as string) ?? (typeof args?.name === 'string' ? args.name : String(defaultSpace))
      activeSpace = (result?.id as string | number) ?? activeName ?? defaultSpace
    },
    selected: (space) => {
      if (space !== undefined && space !== '') {
        activeSpace = space
        activeName = typeof space === 'string' ? space : null
      }
    },
    closed: (space, done) => {
      if (done && (String(space) === String(activeSpace) || (activeName !== null && String(space) === String(activeName)))) {
        activeSpace = defaultSpace
        activeName = typeof defaultSpace === 'string' ? defaultSpace : null
      }
    },
  }
}
