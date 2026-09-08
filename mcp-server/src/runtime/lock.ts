/**
 * Sequential lock to serialize all ego-browser mutations and executions.
 * Chrome is a single shared instance; concurrent executions would race on task spaces / tabs.
 */
export class SequentialLock {
  private chain: Promise<unknown> = Promise.resolve()

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.chain.then(
      () => fn(),
      () => fn(),
    )
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

export const globalLock = new SequentialLock()

export function withEgoLock<T>(fn: () => Promise<T> | T): Promise<T> {
  return globalLock.run(fn)
}
