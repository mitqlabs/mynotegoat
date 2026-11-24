/**
 * Which workspace settings keys this device changed but has not yet confirmed in the cloud.
 * localStorage writes mark a key dirty (storage-sync-interceptor); a successful cloud write of the
 * key clears it (kv-cloud). The Settings "Save to Cloud" button pushes exactly these — never a key
 * this device didn't change — so it can't overwrite another device's newer data with a stale copy.
 */
const STORE_KEY = "casemate.cache.v1.dirty-keys";
const dirty = new Map<string, number>();
let restored = false;

function persist() {
  try {
    if (typeof window === "undefined") return;
    if (dirty.size === 0) window.sessionStorage.removeItem(STORE_KEY);
    else window.sessionStorage.setItem(STORE_KEY, JSON.stringify(Array.from(dirty.entries())));
  } catch {
    // memory copy still works
  }
}

function restore() {
  if (restored) return;
  restored = true;
  try {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return;
    for (const [k, at] of JSON.parse(raw) as Array<[string, number]>) {
      if (typeof at === "number" && !dirty.has(k)) dirty.set(k, at);
    }
  } catch {
    // ignore corrupt copy
  }
}

/** This device just changed `key` locally. Keeps the EARLIEST unconfirmed change time. */
export function markKeyDirty(key: string, at = Date.now()) {
  restore();
  if (!dirty.has(key)) dirty.set(key, at);
  persist();
}

/** `key` reached the cloud. `startedAt` = when that write began; a newer local edit stays dirty. */
export function markKeyClean(key: string, startedAt = Number.POSITIVE_INFINITY) {
  restore();
  const at = dirty.get(key);
  if (at === undefined) return;
  if (at <= startedAt) {
    dirty.delete(key);
    persist();
  }
}

export function getDirtyKeys(): Map<string, number> {
  restore();
  return new Map(dirty);
}

export function resetDirtyKeysForTests() {
  dirty.clear();
  restored = true;
}
