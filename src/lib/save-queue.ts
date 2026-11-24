"use client";

/**
 * Retry queue for cloud settings writes (workspace_kv). When a write fails
 * (wifi dropped on a plane, at the pool…), the latest value per key is held
 * here — in memory and in sessionStorage so a reload doesn't lose it — and
 * retried every 15s and as soon as the browser is back online. Entries are
 * dropped after 10 minutes or when a newer write of the same key succeeds.
 *
 * It also powers the ONE save badge: subscribe() reports how many writes
 * are waiting and whether the browser is offline.
 */

type Entry = { value: unknown; at: number; tries: number };

const STORE_KEY = "casemate.cache.v1.save-queue";
const MAX_AGE_MS = 10 * 60_000;
const RETRY_MS = 15_000;

const queue = new Map<string, Entry>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let flushing = false;
let writer: ((key: string, value: unknown) => Promise<void>) | null = null;

export type SaveQueueState = { waiting: number; offline: boolean };
let snapshot: SaveQueueState = { waiting: 0, offline: false };

function emit() {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (snapshot.waiting !== queue.size || snapshot.offline !== offline) {
    snapshot = { waiting: queue.size, offline };
  }
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // ignore
    }
  });
}

function persist() {
  try {
    if (queue.size === 0) window.sessionStorage.removeItem(STORE_KEY);
    else window.sessionStorage.setItem(STORE_KEY, JSON.stringify(Array.from(queue.entries())));
  } catch {
    // storage full / private mode — memory copy still works
  }
}

function restore() {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return;
    for (const [k, e] of JSON.parse(raw) as Array<[string, Entry]>) {
      if (Date.now() - e.at < MAX_AGE_MS && !queue.has(k)) queue.set(k, e);
    }
  } catch {
    // ignore corrupt copy
  }
}

function schedule(ms = RETRY_MS) {
  if (timer || queue.size === 0) return;
  timer = setTimeout(() => {
    timer = null;
    void flushSaveQueue();
  }, ms);
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  restore();
  window.addEventListener("online", () => {
    emit();
    void flushSaveQueue();
  });
  window.addEventListener("offline", emit);
  if (queue.size) schedule(2_000);
}

/** Register the function that performs the real cloud write. */
export function setSaveQueueWriter(fn: (key: string, value: unknown) => Promise<void>) {
  writer = fn;
  install();
}

/** Hold a failed write for retry (latest value per key wins). */
export function enqueueFailedWrite(key: string, value: unknown) {
  install();
  const prev = queue.get(key);
  queue.set(key, { value, at: Date.now(), tries: prev?.tries ?? 0 });
  persist();
  emit();
  schedule();
}

/** A newer write of `key` reached the cloud — the held copy is obsolete. */
export function markWriteSucceeded(key: string) {
  if (!queue.delete(key)) return;
  persist();
  emit();
}

export async function flushSaveQueue(): Promise<void> {
  if (flushing || !writer || queue.size === 0) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    schedule();
    return;
  }
  flushing = true;
  try {
    for (const [key, entry] of Array.from(queue.entries())) {
      if (Date.now() - entry.at > MAX_AGE_MS) {
        queue.delete(key);
        console.warn(`[save-queue] gave up on "${key}" after 10 minutes`);
        continue;
      }
      try {
        await writer(key, entry.value);
        // Only drop it if nothing newer was queued while we were writing.
        if (queue.get(key) === entry) queue.delete(key);
      } catch {
        entry.tries += 1;
      }
    }
  } finally {
    flushing = false;
    persist();
    emit();
    schedule();
  }
}

export function getSaveQueueState(): SaveQueueState {
  return snapshot;
}

export function subscribeSaveQueue(listener: () => void): () => void {
  install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
