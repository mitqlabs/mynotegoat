/**
 * + mode (the in-browser model) was removed. Once per browser, silently delete what it left
 * behind: the web-llm model / wasm / config caches (Cache Storage and IndexedDB, often 1–2 GB)
 * and its local settings. Never throws; nothing is sent anywhere.
 */
export const PLUS_CLEANUP_KEY = "notegoat.goat-plus-removed.v1";
export const PLUS_LOCAL_KEYS = ["notegoat.goat-smart-mode.v1", "notegoat.goat-plus-intro.v1", "notegoat.goat-smart-model.v1"];

/** Cache / database names that belong to web-llm. Pure (tested). */
export function isWebLlmStore(name: string): boolean {
  return /^webllm\b|web-?llm|mlc[-_]?(ai|llm)|tvmjs/i.test(name ?? "");
}

export async function cleanupPlusModeOnce(): Promise<{ caches: string[]; dbs: string[] } | null> {
  if (typeof window === "undefined") return null;
  try {
    if (window.localStorage.getItem(PLUS_CLEANUP_KEY) === "1") return null;
  } catch {
    return null;
  }
  const out = { caches: [] as string[], dbs: [] as string[] };
  try {
    if ("caches" in window) {
      for (const name of await caches.keys()) {
        if (isWebLlmStore(name) && (await caches.delete(name))) out.caches.push(name);
      }
    }
  } catch {
    // ignore
  }
  try {
    const list = (await (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases?.()) ?? [];
    for (const db of list) {
      if (db.name && isWebLlmStore(db.name)) {
        indexedDB.deleteDatabase(db.name);
        out.dbs.push(db.name);
      }
    }
  } catch {
    // ignore
  }
  try {
    for (const k of PLUS_LOCAL_KEYS) window.localStorage.removeItem(k);
    window.localStorage.setItem(PLUS_CLEANUP_KEY, "1");
  } catch {
    // ignore
  }
  return out;
}
