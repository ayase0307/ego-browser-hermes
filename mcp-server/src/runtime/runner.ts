import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { EgoRunner, EgoScriptResult, EgoStatusResult, McpConfig } from '../types.ts'
import { filterArgs, resolveEgoEnv, resolveVendoredBin, EGO_CLI_BLOCKED } from './config.ts'
import { globalLock, SequentialLock } from './lock.ts'
import { parseSentinel, SENTINEL } from './sentinel.ts'

export const COLD_START_SIGNS = [
  /CDP channel is not open/i,
  /DevTools.*(port|timeout|active)/i,
  /could not connect to/i,
  /browser (was |is )?not (reachable|running|ready)/i,
  /target.*(closed|not found|detached|crashed)/i,
  /ECONNREFUSED/i,
]

export function isColdStartError(message: string): boolean {
  return COLD_START_SIGNS.some((re) => re.test(message))
}

export async function withWarmupRetry(
  fn: () => Promise<EgoScriptResult>,
  { tries = 3, baseDelayMs = 600 }: { tries?: number; baseDelayMs?: number } = {},
): Promise<EgoScriptResult> {
  let last: EgoScriptResult | undefined
  for (let i = 0; i < tries; i++) {
    const result = await fn()
    if (result.ok || !isColdStartError(result.error ?? '')) {
      return result
    }
    last = result
    if (i < tries - 1) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)))
    }
  }
  return last!
}

function describeStderr(stderr: string): string {
  const tail = stderr.trim()
  return tail === '' ? '' : `\n--- ego-browser stderr (tail) ---\n${tail.slice(-2000)}`
}

function describeSpawnFailure(err: unknown, egoBin: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOENT|spawn .* ENOENT|not found|could not load|cannot find module/i.test(msg)) {
    return (
      `ego-browser CLI could not be started (${egoBin}). ` +
      `Make sure a Chrome/Chromium is reachable, or set EGO_BROWSER_BIN. ${msg}`
    )
  }
  return `failed to start ego-browser: ${msg}`
}

interface SpawnOutcome {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: Error
}

function spawnProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    input?: string
    maxStdoutBytes: number
    maxStderrBytes: number
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      return resolve({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: err instanceof Error ? err : new Error(String(err)),
      })
    }

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let timer: NodeJS.Timeout | null = null

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }, 1500).unref()
      }, options.timeoutMs)
    }

    const abortHandler = () => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, 1500).unref()
    }

    if (options.signal) {
      if (options.signal.aborted) {
        abortHandler()
      } else {
        options.signal.addEventListener('abort', abortHandler, { once: true })
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const len = chunk.length
      stdoutBytes += len
      if (stdout.length < options.maxStdoutBytes) {
        stdout += chunk.toString('utf8', 0, Math.min(len, options.maxStdoutBytes - stdout.length))
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const len = chunk.length
      stderrBytes += len
      if (stderr.length < options.maxStderrBytes) {
        stderr += chunk.toString('utf8', 0, Math.min(len, options.maxStderrBytes - stderr.length))
      }
    })

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', abortHandler)
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        error: err,
      })
    })

    child.on('close', (exitCode, signal) => {
      if (timer) clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', abortHandler)
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      })
    })

    if (child.stdin) {
      if (options.input !== undefined) {
        try {
          child.stdin.write(options.input)
          child.stdin.end()
        } catch {
          // ignore stdin write error if already closed
        }
      } else {
        child.stdin.end()
      }
    }
  })
}

export class NodeEgoRunner implements EgoRunner {
  private config: McpConfig
  private lock: SequentialLock

  constructor(config: McpConfig, lock?: SequentialLock) {
    this.config = {
      ...config,
      egoBin: resolveVendoredBin(config.egoBin),
    }
    this.lock = lock ?? globalLock
  }

  async runScript(
    script: string,
    options?: { timeoutMs?: number; signal?: AbortSignal; graceOverrideMs?: number },
  ): Promise<EgoScriptResult> {
    return this.lock.run(async () => {
      return withWarmupRetry(() => this.spawnScriptOnce(script, options))
    })
  }

  private async spawnScriptOnce(
    script: string,
    options?: { timeoutMs?: number; signal?: AbortSignal; graceOverrideMs?: number },
  ): Promise<EgoScriptResult> {
    const extraCliArgs = filterArgs(this.config.egoCliArgs ?? '', EGO_CLI_BLOCKED)
    const argv = [this.config.egoBin, 'nodejs', ...extraCliArgs]
    const timeoutMs = options?.timeoutMs ?? this.config.graceMs ?? 30_000

    const outcome = await spawnProcess(process.execPath, argv, {
      cwd: process.cwd(),
      env: resolveEgoEnv(this.config),
      input: script,
      maxStdoutBytes: this.config.maxOutputBytes || 4 * 1024 * 1024,
      maxStderrBytes: 512 * 1024,
      timeoutMs,
      signal: options?.signal,
    })

    if (outcome.error) {
      return {
        ok: false,
        error: describeSpawnFailure(outcome.error, this.config.egoBin),
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      }
    }

    if (outcome.timedOut || (options?.signal && options.signal.aborted)) {
      return {
        ok: false,
        error: 'ego-browser tool aborted (timeout or cancellation)',
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      }
    }

    if (outcome.exitCode !== 0) {
      const missingModule = /Cannot find module|MODULE_NOT_FOUND/i.test(outcome.stderr)
      return {
        ok: false,
        error: missingModule
          ? describeSpawnFailure(new Error(`node could not load ${this.config.egoBin}`), this.config.egoBin)
          : `ego-browser exited with ${
              outcome.exitCode !== null ? `code ${outcome.exitCode}` : `signal ${String(outcome.signal)}`
            }${describeStderr(outcome.stderr)}`,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      }
    }

    const value = parseSentinel(outcome.stdout)
    if (value === undefined) {
      return {
        ok: false,
        error: `ego-browser finished but no ${SENTINEL} JSON payload was found on stdout${describeStderr(
          outcome.stderr,
        )}`,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      }
    }

    return {
      ok: true,
      value,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
    }
  }

  async getStatus(): Promise<EgoStatusResult> {
    const egoBin = this.config.egoBin
    if (!existsSync(egoBin)) {
      return {
        ok: true,
        available: false,
        path: egoBin,
        exitCode: null,
        error: `Runtime script not found at ${egoBin}`,
      }
    }

    try {
      const outcome = await spawnProcess(process.execPath, [egoBin, '--status'], {
        cwd: process.cwd(),
        env: resolveEgoEnv(this.config),
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 64 * 1024,
        timeoutMs: 10_000,
      })

      if (outcome.error) {
        return {
          ok: true,
          available: false,
          path: egoBin,
          exitCode: null,
          error: outcome.error.message,
        }
      }

      return {
        ok: true,
        available: outcome.exitCode === 0,
        path: egoBin,
        exitCode: outcome.exitCode,
        error: outcome.exitCode !== 0 ? outcome.stderr.trim() : undefined,
      }
    } catch (err) {
      return {
        ok: true,
        available: false,
        path: egoBin,
        exitCode: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
