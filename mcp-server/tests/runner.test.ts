import { describe, it, expect } from 'vitest'
import { parseSentinel, SENTINEL } from '../src/runtime/sentinel.ts'
import { SequentialLock } from '../src/runtime/lock.ts'
import { NodeEgoRunner, isColdStartError, withWarmupRetry } from '../src/runtime/runner.ts'
import type { EgoScriptResult } from '../src/types.ts'

describe('Sentinel & Formatting', () => {
  it('parses valid sentinel line correctly', () => {
    const stdout = `some debug logs\nmore lines\n${SENTINEL}{"ok":true,"text":"hello"}\n`
    const result = parseSentinel(stdout)
    expect(result).toEqual({ ok: true, text: 'hello' })
  })

  it('returns undefined if sentinel is absent', () => {
    const stdout = `some debug logs\nmore lines\n`
    expect(parseSentinel(stdout)).toBeUndefined()
  })

  it('returns undefined if sentinel payload is malformed JSON', () => {
    const stdout = `${SENTINEL}{not valid json}\n`
    expect(parseSentinel(stdout)).toBeUndefined()
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
})
