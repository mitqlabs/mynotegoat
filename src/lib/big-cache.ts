"use client";

/**
 * Big local caches (encounter notes, appointments) live in IndexedDB instead
 * of localStorage. localStorage is ~5 MB per site; a big office (2,600+ notes,
 * 5,000+ appointments) filled it, and every save then logged QuotaExceededError.
 *
 * Existing code keeps using localStorage.getItem / setItem for these keys:
 * installBigCacheShim() routes those keys to an in-memory copy that is saved
 * to IndexedDB in the background. hydrateBigCache() runs BEFORE the app mounts
 * (portal layout bootstrap), loads the copy from IndexedDB and, the first time,
 * migrates the old localStorage value: write to IndexedDB, read it back to
 * verify, and only then remove the old key to free space.
 *
 * Safety:
 *  - Before hydration the keys pass straight through to localStorage.
 *  - If IndexedDB is unavailable, nothing is migrated or removed: the old
 *    localStorage behaviour continues (plus the in-memory copy).
 *  - Records are tagged with the workspace id; another workspace's copy is ignored.
 *  - The cloud stays the record: notes and appointments are still dual-written
 *    to Supabase on every save, exactly as before.
 */

export const BIG_CACHE_KEYS = ["casemate.encounter-notes.v1", "casemate.schedule-appointments.v1"] as const;
const BIG = new Set<string>(BIG_CACHE_KEYS);

const DB_NAME = "notegoat-big-cache";
const STORE = "kv";

interface Rec {
  key: string;
  workspaceId: string;
  value: string;
  savedAt: string;
}

const mem = new Map<string, string>();
let hydrated = false;
let idbOk = false;
let workspace = "";
let original: { getItem: Storage["getItem"]; setItem: Storage["setItem"]; removeItem: Storage["removeItem"] } | null = null;
const writing = new Map<string, Promise<void>>();
const latest = new Map<string, string | null>();

export function isBigCacheKey(key: string): boolean {
  return BIG.has(key);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

async function idbGet(key: string): Promise<Rec | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as Rec | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(rec: Rec): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

async function idbDelete(key: string): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Save the newest value for `key`; writes for one key never overlap, the last value wins. */
function persist(key: string, value: string | null) {
  latest.set(key, value);
  if (writing.has(key)) return;
  const run = (async () => {
    while (latest.has(key)) {
      const v = latest.get(key)!;
      latest.delete(key);
      try {
        if (v === null) await idbDelete(key);
        else await idbPut({ key, workspaceId: workspace, value: v, savedAt: new Date().toISOString() });
      } catch (err) {
        console.error(`[big-cache] couldn't save ${key} to IndexedDB (kept in memory; the cloud copy is unaffected)`, err);
      }
    }
  })().finally(() => writing.delete(key));
  writing.set(key, run);
}

/** Route the big keys' localStorage calls to the in-memory copy (once hydrated). */
export function installBigCacheShim() {
  if (original || typeof window === "undefined") return;
  const ls = window.localStorage;
  original = { getItem: ls.getItem.bind(ls), setItem: ls.setItem.bind(ls), removeItem: ls.removeItem.bind(ls) };
  const o = original;
  ls.getItem = (key: string) => (hydrated && BIG.has(key) ? (mem.get(key) ?? null) : o.getItem(key));
  ls.setItem = (key: string, value: string) => {
    if (!hydrated || !BIG.has(key)) return o.setItem(key, value);
    mem.set(key, value);
    if (idbOk) persist(key, value);
    else o.setItem(key, value); // no IndexedDB: old behaviour (may throw QuotaExceededError, as before)
  };
  ls.removeItem = (key: string) => {
    if (hydrated && BIG.has(key)) {
      mem.delete(key);
      if (idbOk) persist(key, null);
    }
    o.removeItem(key);
  };
}

/**
 * Load the big caches for this workspace before the app mounts, migrating the
 * old localStorage values the first time. Never throws.
 */
export async function hydrateBigCache(workspaceId: string): Promise<{ idb: boolean; migrated: string[] }> {
  const migrated: string[] = [];
  if (typeof window === "undefined" || !original) return { idb: false, migrated };
  workspace = workspaceId;
  try {
    if (typeof indexedDB === "undefined") throw new Error("no IndexedDB");
    for (const key of BIG_CACHE_KEYS) {
      const legacy = original.getItem(key);
      const rec = await idbGet(key);
      const stored = rec && rec.workspaceId === workspaceId ? rec.value : null;
      if (legacy !== null) {
        // The localStorage copy is only ever written before this shim takes over, so it's the newest.
        await idbPut({ key, workspaceId, value: legacy, savedAt: new Date().toISOString() });
        const check = await idbGet(key);
        if (check?.value !== legacy) throw new Error(`verify failed for ${key}`);
        mem.set(key, legacy);
        original.removeItem(key);
        migrated.push(key);
        console.info(`[big-cache] moved ${key} (${Math.round(legacy.length / 1024)} KB) from localStorage to IndexedDB`);
      } else if (stored !== null) {
        mem.set(key, stored);
      } else if (rec) {
        // Another workspace's copy: never show it here.
        await idbDelete(key);
      }
    }
    idbOk = true;
  } catch (err) {
    idbOk = false;
    mem.clear();
    console.error("[big-cache] IndexedDB unavailable; staying on localStorage for notes/appointments", err);
  }
  hydrated = true;
  return { idb: idbOk, migrated };
}

/** The big keys' current values (for the full local snapshot, which used to read them from localStorage). */
export function bigCacheEntries(): Array<[string, string]> {
  return hydrated && idbOk ? Array.from(mem.entries()) : [];
}

/** True once notes/appointments are cached in IndexedDB (room for a much bigger cache). */
export function bigCacheUsesIdb(): boolean {
  return hydrated && idbOk;
}

/** Wait for pending IndexedDB writes (tests, sign-out). */
export async function flushBigCache(): Promise<void> {
  await Promise.all(Array.from(writing.values()));
}

/** Drop the big caches (workspace switch / sign-out). */
export async function clearBigCache(): Promise<void> {
  for (const key of BIG_CACHE_KEYS) {
    mem.delete(key);
    if (idbOk) persist(key, null);
  }
  await flushBigCache();
}

/** Test-only: reset module state. */
export function __resetBigCacheForTest() {
  mem.clear();
  hydrated = false;
  idbOk = false;
  original = null;
  dbPromise = null;
}
