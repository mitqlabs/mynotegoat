/**
 * Boot download helpers: progress events, a bounded request pool, a resumable
 * per-chunk cache of cloud note rows, and one-tab-at-a-time coordination.
 *
 * Safety: the chunk cache only ever holds rows exactly as the cloud returned
 * them, keyed by the server's `updated_at` at that moment. A cached row is
 * reused only when the cloud's current `updated_at` for that id is the SAME,
 * so it is the cloud copy, never a stale local edit. Any doubt => fetch.
 */

export type BootProgress = { phase: "notes" | "waiting-other-tab"; done: number; total: number };
type Listener = (p: BootProgress) => void;
const listeners = new Set<Listener>();
let lastProgress: BootProgress | null = null;

export function onBootProgress(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitBootProgress(p: BootProgress): void {
  lastProgress = p;
  for (const fn of listeners) {
    try { fn(p); } catch { /* ignore listener errors */ }
  }
}
export function getLastBootProgress(): BootProgress | null {
  return lastProgress;
}

/** Run tasks with at most `limit` in flight. Rejects/aborts on the first null result. */
export async function runPool<T>(
  tasks: Array<() => Promise<T | null>>,
  limit: number,
  onDone?: (done: number, total: number) => void,
): Promise<Array<T> | null> {
  const results: Array<T> = new Array(tasks.length);
  let next = 0;
  let done = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < tasks.length) {
      const i = next++;
      const r = await tasks[i]();
      if (r === null) { failed = true; return; }
      results[i] = r;
      done++;
      onDone?.(done, tasks.length);
    }
  };
  const n = Math.max(1, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: n }, worker));
  return failed ? null : results;
}

/** Split ids into cached-and-still-current rows vs ids that must be fetched. */
export function splitByChunkCache<R>(
  ids: string[],
  serverStamp: Map<string, string>,
  cache: Map<string, { stamp: string; row: R }>,
): { reused: R[]; toFetch: string[] } {
  const reused: R[] = [];
  const toFetch: string[] = [];
  for (const id of ids) {
    const hit = cache.get(id);
    const stamp = serverStamp.get(id);
    if (hit && stamp && hit.stamp === stamp) reused.push(hit.row);
    else toFetch.push(id);
  }
  return { reused, toFetch };
}

// ── IndexedDB chunk cache (memory fallback) ──────────────────────────────
const DB_NAME = "notegoat-boot-cache";
const STORE = "notes";
const memCache = new Map<string, Map<string, { stamp: string; row: unknown }>>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const range = (ws: string) => IDBKeyRange.bound(`${ws}|`, `${ws}|\uffff`);

/** Rows saved by earlier, unfinished boots for this workspace (id -> {stamp,row}). */
export async function readChunkCache<R>(ws: string): Promise<Map<string, { stamp: string; row: R }>> {
  const out = new Map<string, { stamp: string; row: R }>(
    (memCache.get(ws) ?? new Map()) as Map<string, { stamp: string; row: R }>,
  );
  const db = await openDb();
  if (!db) return out;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor(range(ws));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        const v = cur.value as { id: string; stamp: string; row: R };
        if (v && v.id && !out.has(v.id)) out.set(v.id, { stamp: v.stamp, row: v.row });
        cur.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

/** Save one fetched chunk (rows exactly as the cloud returned them). */
export async function writeChunkRows<R extends { id: string }>(ws: string, rows: R[], stampOf: (id: string) => string | undefined): Promise<void> {
  const mem = memCache.get(ws) ?? new Map();
  memCache.set(ws, mem);
  const items = rows.map((row) => ({ id: row.id, stamp: stampOf(row.id), row })).filter((x) => x.stamp);
  for (const x of items) mem.set(x.id, { stamp: x.stamp!, row: x.row });
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      for (const x of items) st.put(x, `${ws}|${x.id}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Clear the resumable cache once a boot fully succeeded (cursor saved). */
export async function clearChunkCache(ws: string): Promise<void> {
  memCache.delete(ws);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(range(ws));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ── One tab at a time ────────────────────────────────────────────────────
/**
 * Run `fn` while holding a cross-tab lock for this workspace's notes download.
 * Other tabs wait (relaying the holder's progress so their no-progress
 * watchdog doesn't fire) and then run `fn` themselves — by then the chunk
 * cache is warm, so they mostly reuse the first tab's download.
 * Without Web Locks support it just runs `fn`.
 */
export async function withBootLock<T>(ws: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  const chan = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`notegoat-boot-${ws}`) : null;
  if (!locks) {
    try { return await fn(); } finally { chan?.close(); }
  }
  let holding = false;
  if (chan) {
    chan.onmessage = (e: MessageEvent) => {
      const p = e.data as BootProgress | undefined;
      if (!holding && p && typeof p.done === "number") emitBootProgress({ ...p, phase: "waiting-other-tab" });
    };
  }
  const relay = onBootProgress((p) => {
    if (holding && p.phase === "notes") {
      try { chan?.postMessage(p); } catch { /* ignore */ }
    }
  });
  try {
    return await locks.request(`notegoat-boot-notes-${ws}`, async () => {
      holding = true;
      return fn();
    });
  } finally {
    relay();
    chan?.close();
  }
}

/**
 * No-progress watchdog: resolves/rejects with `p`, but rejects with
 * `onStall()` only after `idleMs` passes with no progress event.
 */
export function withStallWatchdog<T>(p: Promise<T>, idleMs: number, onStall: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { off(); reject(onStall()); }, idleMs);
    };
    const off = onBootProgress(arm);
    arm();
    p.then(
      (v) => { clearTimeout(timer); off(); resolve(v); },
      (e) => { clearTimeout(timer); off(); reject(e); },
    );
  });
}
