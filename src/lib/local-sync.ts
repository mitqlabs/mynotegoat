"use client";

/**
 * Local Sync — lightweight pub/sub so multiple React hook instances
 * that share the same localStorage key stay in sync within a single page.
 *
 * When any hook writes to localStorage, it calls `notifyChange(key)`.
 * All other hook instances subscribed via `onLocalChange(key, callback)`
 * will re-read from localStorage and update their state.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Subscribe to changes for a given localStorage key. Returns an unsubscribe function. */
export function onLocalChange(key: string, callback: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(callback);
  return () => {
    set!.delete(callback);
    if (set!.size === 0) listeners.delete(key);
  };
}

// ── Recent-local-write guard ────────────────────────────────────────
// When a key is being actively edited locally, incoming cloud realtime
// echoes (which can arrive out of order and stale) must NOT overwrite it.
// Writers call markLocalWrite(key); the realtime handler and sync hooks
// check wasRecentlyWrittenLocally(key) before applying a foreign change.
const recentWrites = new Map<string, number>();

export function markLocalWrite(key: string): void {
  recentWrites.set(key, Date.now());
}

export function wasRecentlyWrittenLocally(key: string, windowMs = 6000): boolean {
  const at = recentWrites.get(key);
  return at !== undefined && Date.now() - at < windowMs;
}

/** Notify all subscribers (except the caller) that a key has changed. */
export function notifyChange(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  // Use microtask to batch with React's batching
  queueMicrotask(() => {
    set.forEach((cb) => {
      try {
        cb();
      } catch {
        // ignore
      }
    });
  });
}
