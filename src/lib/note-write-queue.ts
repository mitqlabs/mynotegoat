/**
 * Per-record cloud write queue for encounter notes.
 *
 * Why this exists: the old dual-write diffed each save against a "last
 * saved" snapshot that was advanced BEFORE the cloud write finished, and a
 * save that arrived while another was in flight REPLACED the queued one. Two
 * rapid saves (e.g. an edit, then Close) or one failed write could therefore
 * drop a change for good — the note looked closed on screen but stayed open
 * in the cloud (seen in production: note.closed logged, row still unsigned).
 *
 * Rules this queue guarantees:
 *   - A record is "confirmed" only after its write succeeds.
 *   - Saves are merged per record id (latest version wins); nothing queued
 *     is ever dropped because another save came in.
 *   - Only one write per record is in flight at a time, so an older version
 *     can never land after a newer one from this tab.
 *   - A failed write is re-queued and retried with backoff.
 *   - `saveNow` lets a caller wait until a specific version is confirmed.
 *
 * Pure module (no app imports) so it can be tested in isolation.
 */

export type QueueRecord = { id: string };

export type NoteWriteQueueOptions<T extends QueueRecord> = {
  write: (record: T) => Promise<void>;
  /**
   * Return true to refuse sending `next` (e.g. blank overwrite, stale copy).
   * `latestIsLocal` is true when the latest known copy was written (or is
   * being written) by THIS tab, so timestamps share one clock.
   */
  shouldSkip?: (latestKnown: T | undefined, next: T, latestIsLocal: boolean) => boolean;
  concurrency?: number;
  retryDelaysMs?: number[];
  onBatchStart?: () => void;
  onBatchDone?: (result: { ok: number; failed: number; firstError?: unknown }) => void;
  /** Injected for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
};

type Waiter = { version: string; resolve: (ok: boolean) => void };

export function createNoteWriteQueue<T extends QueueRecord>(options: NoteWriteQueueOptions<T>) {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const retryDelays = options.retryDelaysMs ?? [2000, 5000, 10000, 30000, 60000];
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const confirmed = new Map<string, { record: T; version: string; local: boolean }>();
  const pending = new Map<string, T>();
  const inFlight = new Map<string, { record: T; version: string }>();
  const waiters = new Map<string, Waiter[]>();
  let running: Promise<void> | null = null;
  let retryAttempt = 0;
  let retryTimerSet = false;

  const versionOf = (record: T) => JSON.stringify(record);

  const latestKnown = (id: string): { record: T | undefined; local: boolean } => {
    const queued = pending.get(id) ?? inFlight.get(id)?.record;
    if (queued) return { record: queued, local: true };
    const done = confirmed.get(id);
    return { record: done?.record, local: done?.local ?? false };
  };

  const settleWaiters = (id: string, version: string, ok: boolean) => {
    const list = waiters.get(id);
    if (!list) return;
    const remaining = list.filter((w) => {
      if (w.version !== version) return true;
      w.resolve(ok);
      return false;
    });
    if (remaining.length) waiters.set(id, remaining);
    else waiters.delete(id);
  };

  /** Baseline: what the cloud is known to hold (e.g. right after a load). */
  const setConfirmed = (records: T[]) => {
    for (const record of records) {
      confirmed.set(record.id, { record, version: versionOf(record), local: false });
    }
  };

  /**
   * Queue every record that differs from what the cloud is known to hold.
   * Returns the number of records newly queued.
   */
  const enqueue = (records: T[]): number => {
    let queued = 0;
    for (const record of records) {
      const version = versionOf(record);
      const existing = pending.get(record.id);
      if (existing && versionOf(existing) === version) continue;
      const flying = inFlight.get(record.id);
      if (!existing && flying && flying.version === version) continue;
      const done = confirmed.get(record.id);
      if (!existing && !flying && done && done.version === version) continue;
      const latest = latestKnown(record.id);
      if (options.shouldSkip?.(latest.record, record, latest.local)) continue;
      pending.set(record.id, record);
      queued++;
    }
    if (queued > 0) void kick();
    return queued;
  };

  const runLoop = async () => {
    while (pending.size > 0) {
      const batch = Array.from(pending.values());
      pending.clear();
      for (const record of batch) inFlight.set(record.id, { record, version: versionOf(record) });
      options.onBatchStart?.();

      let ok = 0;
      let failed = 0;
      let firstError: unknown;
      let cursor = 0;
      const worker = async () => {
        while (cursor < batch.length) {
          const record = batch[cursor++];
          const version = inFlight.get(record.id)!.version;
          try {
            await options.write(record);
            confirmed.set(record.id, { record, version, local: true });
            ok++;
            settleWaiters(record.id, version, true);
          } catch (err) {
            failed++;
            if (firstError === undefined) firstError = err;
            // Re-queue unless a newer version is already waiting.
            if (!pending.has(record.id)) pending.set(record.id, record);
            settleWaiters(record.id, version, false);
          } finally {
            inFlight.delete(record.id);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
      options.onBatchDone?.({ ok, failed, firstError });

      if (failed > 0) {
        scheduleRetry();
        return; // the retry timer (or the next enqueue) resumes the loop
      }
      retryAttempt = 0;
    }
  };

  const scheduleRetry = () => {
    if (retryTimerSet) return;
    retryTimerSet = true;
    const delay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
    retryAttempt++;
    setTimer(() => {
      retryTimerSet = false;
      void kick();
    }, delay);
  };

  const kick = (): Promise<void> => {
    if (running) return running;
    running = runLoop().finally(() => {
      running = null;
      // Something was queued while the last batch was settling.
      if (pending.size > 0 && !retryTimerSet) void kick();
    });
    return running;
  };

  /**
   * Queue `record` and resolve true once THIS version is confirmed in the
   * cloud, false if its write fails (it keeps retrying in the background).
   */
  const saveNow = (record: T): Promise<boolean> => {
    const version = versionOf(record);
    if (!pending.has(record.id) && !inFlight.has(record.id) && confirmed.get(record.id)?.version === version) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const list = waiters.get(record.id) ?? [];
      list.push({ version, resolve });
      waiters.set(record.id, list);
      // Force it into the queue even if it equals an in-flight copy that
      // might still fail; a duplicate identical write is harmless.
      if (!pending.has(record.id) || versionOf(pending.get(record.id)!) !== version) {
        pending.set(record.id, record);
      }
      void kick();
    });
  };

  /** Forget the confirmed copy so the next enqueue re-sends it. */
  const invalidate = (id: string) => {
    confirmed.delete(id);
  };

  const getConfirmed = (id: string): T | undefined => confirmed.get(id)?.record;

  return {
    setConfirmed,
    enqueue,
    saveNow,
    invalidate,
    getConfirmed,
    flush: kick,
    pendingCount: () => pending.size + inFlight.size,
  };
}

export type NoteWriteQueue<T extends QueueRecord> = ReturnType<typeof createNoteWriteQueue<T>>;
