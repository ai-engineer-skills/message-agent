/**
 * Per-key async mutex using promise chaining.
 * Different keys proceed concurrently; same key serializes.
 */
export class ConversationMutex {
  private locks = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    let releaseFn: () => void;
    const newLock = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });

    const existing = this.locks.get(key) ?? Promise.resolve();
    this.locks.set(key, existing.then(() => newLock));

    await existing;
    return releaseFn!;
  }
}
