/**
 * Per-file facts cache: memory first, IndexedDB ("notegoat-goat-facts") for next time.
 * Keyed by file id; a record is only used when its text hash still matches, so a changed
 * file is re-extracted. Everything stays in this browser (nothing goes to the cloud).
 * When browser storage runs low, the least recently used patients' facts are dropped first.
 */
import type { GoatFile } from "@/lib/goat-docs";
import { extractFileFacts, factsHash, type FileFacts } from "@/lib/goat-facts";

const DB_NAME = "notegoat-goat-facts";
const FACTS = "facts";
const PATIENTS = "patients";
/** Drop old patients when the site uses more than this share of its quota… */
export const FACTS_USAGE_LIMIT = 0.8;
/** …or keeps facts for more patients than this. */
export const FACTS_MAX_PATIENTS = 300;

const mem = new Map<string, FileFacts>();
const fileHashes = new WeakMap<GoatFile, string>();

/** Facts for one file (memoized by id + hash; extraction is fast and pure). */
export function factsFor(file: GoatFile): FileFacts | null {
  if (!file.pages || !file.pages.length) return null;
  let hash = fileHashes.get(file);
  if (!hash) {
    hash = factsHash(file);
    fileHashes.set(file, hash);
  }
  const hit = mem.get(file.id);
  if (hit && hit.hash === hash) return hit;
  const f = extractFileFacts(file);
  mem.set(file.id, f);
  dirty.add(file.id);
  return f;
}

export function factsForFiles(files: GoatFile[] | null | undefined): FileFacts[] {
  return (files ?? []).map(factsFor).filter((f): f is FileFacts => !!f);
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------
const dirty = new Set<string>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FACTS)) db.createObjectStore(FACTS, { keyPath: "fileId" }).createIndex("patientId", "patientId");
      if (!db.objectStoreNames.contains(PATIENTS)) db.createObjectStore(PATIENTS, { keyPath: "patientId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

const done = (tx: IDBTransaction) => new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); });

/** Which patients to drop (least recently used first) to get back under the limits. Pure. */
export function patientsToEvict(
  patients: Array<{ patientId: string; lastUsed: number; bytes: number }>,
  opts: { usage: number; quota: number; keep?: string; maxPatients?: number; usageLimit?: number },
): string[] {
  const limit = (opts.usageLimit ?? FACTS_USAGE_LIMIT) * opts.quota;
  const max = opts.maxPatients ?? FACTS_MAX_PATIENTS;
  const lru = [...patients].filter((p) => p.patientId !== opts.keep).sort((a, b) => a.lastUsed - b.lastUsed);
  const out: string[] = [];
  let usage = opts.usage;
  let count = patients.length;
  for (const p of lru) {
    if (!(opts.quota && usage > limit) && count <= max) break;
    out.push(p.patientId);
    usage -= p.bytes;
    count--;
  }
  return out;
}

/**
 * Load this patient's saved facts, save new / changed ones, mark the patient used,
 * and evict old patients if storage is low. Safe to call often (background).
 */
export async function syncPatientFacts(patientId: string, files: GoatFile[]): Promise<void> {
  const db = await openDb();
  if (!db) {
    factsForFiles(files);
    return;
  }
  try {
    // Hydrate from IndexedDB (skips extraction for unchanged files).
    const saved: Array<FileFacts & { patientId: string }> = await new Promise((res) => {
      const r = db.transaction(FACTS).objectStore(FACTS).index("patientId").getAll(patientId);
      r.onsuccess = () => res(r.result ?? []);
      r.onerror = () => res([]);
    });
    for (const s of saved) if (!mem.has(s.fileId)) mem.set(s.fileId, s);
    const facts = factsForFiles(files);
    const ids = new Set(files.map((f) => f.id));
    const tx = db.transaction([FACTS, PATIENTS], "readwrite");
    for (const f of facts) if (dirty.has(f.fileId) || !saved.some((s) => s.fileId === f.fileId && s.hash === f.hash)) {
      tx.objectStore(FACTS).put({ ...f, patientId });
      dirty.delete(f.fileId);
    }
    for (const s of saved) if (!ids.has(s.fileId)) tx.objectStore(FACTS).delete(s.fileId); // file removed
    const bytes = JSON.stringify(facts).length;
    tx.objectStore(PATIENTS).put({ patientId, lastUsed: Date.now(), bytes });
    await done(tx);
    await evictIfLow(db, patientId);
  } catch (e) {
    console.warn("[goat-facts] cache sync failed", e);
  } finally {
    db.close();
  }
}

async function evictIfLow(db: IDBDatabase, keep: string) {
  let usage = 0;
  let quota = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
  } catch {
    // no estimate: only the patient-count limit applies
  }
  const patients: Array<{ patientId: string; lastUsed: number; bytes: number }> = await new Promise((res) => {
    const r = db.transaction(PATIENTS).objectStore(PATIENTS).getAll();
    r.onsuccess = () => res(r.result ?? []);
    r.onerror = () => res([]);
  });
  const drop = patientsToEvict(patients, { usage, quota, keep });
  if (!drop.length) return;
  const tx = db.transaction([FACTS, PATIENTS], "readwrite");
  const idx = tx.objectStore(FACTS).index("patientId");
  for (const id of drop) {
    tx.objectStore(PATIENTS).delete(id);
    const r = idx.getAllKeys(id);
    r.onsuccess = () => (r.result ?? []).forEach((k) => tx.objectStore(FACTS).delete(k));
  }
  await done(tx);
  console.info(`[goat-facts] storage low: dropped facts for ${drop.length} least recently used patient(s)`);
}

export function __resetFactsMemForTest() {
  mem.clear();
  dirty.clear();
}
