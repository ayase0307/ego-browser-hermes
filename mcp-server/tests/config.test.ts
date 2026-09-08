import { describe, it, expect } from 'vitest'
import {
  tokenizeArgs,
  filterArgs,
  EGO_CLI_BLOCKED,
  CHROME_BLOCKED,
  resolveVendoredBin,
  resolveEgoEnv,
  createActiveSpaceTracker,
} from '../src/runtime/config.ts'

describe('Runtime Config and Args', () => {
  describe('tokenizeArgs', () => {
    it('tokenizes standard spaced arguments', () => {
      expect(tokenizeArgs('--foo bar --baz=123')).toEqual(['--foo', 'bar', '--baz=123'])
    })

    it('handles quotes and whitespace inside quotes', () => {
      expect(tokenizeArgs('--title "Hello World" --desc=\'Foo Bar\'')).toEqual([
        '--title',
        'Hello World',
        '--desc=Foo Bar',
      ])
    })

    it('handles empty or non-string input', () => {
      expect(tokenizeArgs('')).toEqual([])
      expect(tokenizeArgs(null)).toEqual([])
      expect(tokenizeArgs(undefined)).toEqual([])
    })
  })

  describe('filterArgs', () => {
    it('filters out blocked CLI subcommands', () => {
      const raw = '--sdk-path /foo/bar --status --open --window-size=800,600'
      const filtered = filterArgs(raw, EGO_CLI_BLOCKED)
      expect(filtered).toEqual(['--sdk-path', '/foo/bar', '--window-size=800,600'])
    })

    it('filters blocked flags with equals syntax', () => {
      const raw = '--headless=new --disable-gpu'
      const filtered = filterArgs(raw, CHROME_BLOCKED)
      expect(filtered).toEqual(['--disable-gpu'])
    })
  })

  describe('resolveVendoredBin', () => {
    it('returns custom override when provided', () => {
      expect(resolveVendoredBin('custom/path/bin.mjs')).toBe('custom/path/bin.mjs')
    })

    it('resolves the real vendored bin in repo', () => {
      const bin = resolveVendoredBin()
      expect(bin).toContain('ego-browser.mjs')
    })
  })

  describe('resolveEgoEnv', () => {
    it('populates Chrome path and custom args', () => {
      const env = resolveEgoEnv(
        {
          chromePath: 'C:\\test\\chrome.exe',
          chromeArgs: '--disable-features=Translate',
          dataDir: 'D:\\custom\\data',
        },
        { platform: 'win32', baseEnv: {} },
      )

      expect(env.EGO_LINUX_CHROME).toBe('C:\\test\\chrome.exe')
      expect(env.EGO_LINUX_EXTRA_ARGS).toBe('--disable-features=Translate')
      expect(env.EGO_LINUX_DATA_DIR).toBe('D:\\custom\\data')
    })

    it('sets headless on Linux if DISPLAY is missing', () => {
      const env = resolveEgoEnv({}, { platform: 'linux', baseEnv: {} })
      expect(env.EGO_LINUX_HEADLESS).toBe('1')
    })

    it('does not force headless on Windows', () => {
      const env = resolveEgoEnv({}, { platform: 'win32', baseEnv: {} })
      expect(env.EGO_LINUX_HEADLESS).toBeUndefined()
    })
  })

  describe('createActiveSpaceTracker', () => {
    it('tracks active space correctly through lifecycle', () => {
      const tracker = createActiveSpaceTracker('default-space')
      expect(tracker.current()).toBe('default-space')

      tracker.opened({ name: 'my-task' }, { id: 'space-123', name: 'my-task' })
      expect(tracker.current()).toBe('space-123')

      tracker.selected('other-space')
      expect(tracker.current()).toBe('other-space')

      tracker.closed('other-space', true)
      expect(tracker.current()).toBe('default-space')
    })
  })
})
