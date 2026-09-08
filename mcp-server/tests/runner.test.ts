import { describe, it, expect } from 'vitest'
import {
  parseSentinel,
  SENTINEL,
  useSpace,
  ensureRealTab,
  bool,
  num,
  str,
} from '../src/runtime/sentinel.ts'
import { SequentialLock } from '../src/runtime/lock.ts'
import { NodeEgoRunner, isColdStartError, withWarmupRetry } from '../src/runtime/runner.ts'
import type { EgoScriptResult } from '../src/types.ts'

describe('Sentinel & Formatting', () => {
  it('parses valid sentinel line correctly', () => {
    const stdout = `some debug logs\nmore lines\n${SENTINEL}{"ok":true,"text":"hello"}\n`
    const result = parseSentinel(stdout)
    expect(result).toEqual({ ok: true, text: 'hello' })
  })

  it('scans from bottom to top and selects the latest sentinel line', () => {
    const stdout = `log 1\n${SENTINEL}{"first":1}\nlog 2\n${SENTINEL}{"second":2}\nlog 3\n`
    const result = parseSentinel(stdout)
    expect(result).toEqual({ second: 2 })
  })

  it('returns undefined if sentinel is absent', () => {
    const stdout = `some debug logs\nmore lines\n`
    expect(parseSentinel(stdout)).toBeUndefined()
  })

  it('returns undefined if sentinel payload is malformed JSON', () => {
    const stdout = `${SENTINEL}{not valid json}\n`
    expect(parseSentinel(stdout)).toBeUndefined()
  })

  it('formats sentinel script helpers accurately', () => {
    expect(useSpace('task-1')).toBe('const task = await taskSpaces.useOrCreate("task-1")\n')
    expect(ensureRealTab()).toContain('browser.listTabs')
    expect(bool(true, false)).toBe(true)
    expect(bool(undefined, false)).toBe(false)
    expect(num(42, 10)).toBe(42)
    expect(num('invalid', 10)).toBe(10)
    expect(str('valid', 'fallback')).toBe('valid')
    expect(str('', 'fallback')).toBe('fallback')
  })
})

describe('SequentialLock', () => {
  it('serializes concurrent async tasks in order', async () => {
    const lock = new SequentialLock()
    const log: number[] = []

    const task1 = lock.run(async () => {
      await new Promise((r) => setTimeout(r, 50))
      log.push(1)
      return 1
    })

    const task2 = lock.run(async () => {
      await new Promise((r) => setTimeout(r, 10))
      log.push(2)
      return 2
    })

    const task3 = lock.run(async () => {
      log.push(3)
      return 3
    })

    const results = await Promise.all([task1, task2, task3])
    expect(results).toEqual([1, 2, 3])
    expect(log).toEqual([1, 2, 3])
  })

  it('continues processing queued tasks even if a prior task throws', async () => {
    const lock = new SequentialLock()
    const log: string[] = []

    const t1 = lock.run(async () => {
      log.push('t1')
      throw new Error('t1-failed')
    })

    const t2 = lock.run(async () => {
      log.push('t2')
      return 't2-ok'
    })

    await expect(t1).rejects.toThrow('t1-failed')
    const res2 = await t2
    expect(res2).toBe('t2-ok')
    expect(log).toEqual(['t1', 't2'])
  })
})

describe('Warmup Retry Logic', () => {
  it('detects cold start error signatures', () => {
    expect(isColdStartError('DevTools active port file not found')).toBe(true)
    expect(isColdStartError('CDP channel is not open')).toBe(true)
    expect(isColdStartError('connect ECONNREFUSED 127.0.0.1')).toBe(true)
    expect(isColdStartError('syntax error in script')).toBe(false)
  })

  it('retries on cold start errors until success', async () => {
    let attempts = 0
    const fn = async (): Promise<EgoScriptResult> => {
      attempts++
      if (attempts < 3) {
        return { ok: false, error: 'CDP channel is not open', stdout: '', stderr: '' }
      }
      return { ok: true, value: { success: true }, stdout: '', stderr: '' }
    }

    const res = await withWarmupRetry(fn, { tries: 3, baseDelayMs: 10 })
    expect(res.ok).toBe(true)
    expect(attempts).toBe(3)
  })

  it('does not retry on permanent errors', async () => {
    let attempts = 0
    const fn = async (): Promise<EgoScriptResult> => {
      attempts++
      return { ok: false, error: 'ReferenceError: foo is not defined', stdout: '', stderr: '' }
    }

    const res = await withWarmupRetry(fn, { tries: 3, baseDelayMs: 10 })
    expect(res.ok).toBe(false)
    expect(attempts).toBe(1)
  })

  it('returns the last error if all retries are exhausted', async () => {
    let attempts = 0
    const fn = async (): Promise<EgoScriptResult> => {
      attempts++
      return { ok: false, error: 'DevTools active port file not found', stdout: '', stderr: '' }
    }

    const res = await withWarmupRetry(fn, { tries: 3, baseDelayMs: 10 })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('DevTools active port file not found')
    expect(attempts).toBe(3)
  })
})

describe('NodeEgoRunner Process Execution', () => {
  it('getStatus returns available true on the vendored runtime', async () => {
    const runner = new NodeEgoRunner({
      egoBin: '',
      defaultSpace: 'test',
      maxOutputBytes: 1024 * 1024,
      graceMs: 10_000,
    })

    const status = await runner.getStatus()
    expect(status.ok).toBe(true)
    expect(status.available).toBe(true)
    expect(status.path).toContain('ego-browser.mjs')
    expect(status.exitCode).toBe(0)
  })

  it('getStatus returns available false for non-existent path', async () => {
    const runner = new NodeEgoRunner({
      egoBin: 'non_existent_binary_xyz.mjs',
      defaultSpace: 'test',
      maxOutputBytes: 1024 * 1024,
      graceMs: 10_000,
    })

    const status = await runner.getStatus()
    expect(status.ok).toBe(true)
    expect(status.available).toBe(false)
    expect(status.error).toBeDefined()
  })

  it('handles non-zero exit code cleanly', async () => {
    // Pass a fake egoBin script that exits with non-zero
    const runner = new NodeEgoRunner({
      egoBin: 'mcp-server/tests/fixtures/exit-one.mjs',
      defaultSpace: 'test',
      maxOutputBytes: 1024 * 1024,
      graceMs: 5000,
    })

    const res = await runner.runScript('console.log("hello")')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/exited with code 1|could not be started/)
  })

  it('handles timeout cleanly', async () => {
    const runner = new NodeEgoRunner({
      egoBin: 'mcp-server/tests/fixtures/sleep.mjs',
      defaultSpace: 'test',
      maxOutputBytes: 1024 * 1024,
      graceMs: 5000,
    })

    const res = await runner.runScript('console.log("hello")', { timeoutMs: 100 })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('aborted')
  })

  it('handles cancellation via AbortSignal', async () => {
    const runner = new NodeEgoRunner({
      egoBin: 'mcp-server/tests/fixtures/sleep.mjs',
      defaultSpace: 'test',
      maxOutputBytes: 1024 * 1024,
      graceMs: 5000,
    })

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    const res = await runner.runScript('console.log("hello")', { signal: controller.signal })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('aborted')
  })
})
