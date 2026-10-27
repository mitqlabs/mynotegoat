/**
 * Settings → "Save to Cloud": force-push every settings change THIS device made but the cloud hasn't
 * confirmed, through the normal workspace_kv write path — without ever overwriting newer cloud data.
 *
 * Per key (only keys this device changed — see dirty-keys.ts):
 *   - cloud row missing                      → push
 *   - cloud value already equal              → nothing to do (marked clean)
 *   - both copies carry `savedAt`            → the newer savedAt wins (same rule as login merge)
 *   - otherwise, cloud row written AFTER this device's change (another device saved since) → keep the
 *     cloud copy, report it, do NOT push
 *   - otherwise                              → push
 * Held (failed, retrying) writes are flushed first. Every pushed key is read back to verify it landed.
 */
export interface SettingsPushDeps {
  /** A reason the cloud can't be written right now (not signed in, no workspace), else null. */
  notReady(): string | null;
  /** Unconfirmed local changes: key → when this device first changed it (ms). */
  dirtyKeys(): Map<string, number>;
  /** Raw localStorage value of a key (null when absent). */
  localRaw(key: string): string | null;
  /** Cloud rows for these keys. */
  fetchCloud(keys: string[]): Promise<Map<string, { value: unknown; updatedAt: string | null }>>;
  /** The real write (throws on failure, queues it for retry). */
  upsert(key: string, value: unknown): Promise<void>;
  /** Retry any held failed writes; resolves with how many are STILL waiting. */
  flushHeldWrites(): Promise<number>;
  markClean(key: string): void;
}

export interface SettingsPushResult {
  pushed: string[];
  /** Cloud copy was newer — left untouched. */
  keptNewerCloud: string[];
  /** Already identical in the cloud. */
  alreadySaved: number;
}

const SKEW_MS = 2_000;

function savedAtOf(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = (value as Record<string, unknown>).savedAt;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Order-insensitive deep equality for JSON values (jsonb doesn't keep key order). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export async function pushPendingSettings(deps: SettingsPushDeps): Promise<SettingsPushResult> {
  const reason = deps.notReady();
  if (reason) throw new Error(reason);

  // 1) writes that already failed once and are waiting to retry
  const stillHeld = await deps.flushHeldWrites();
  if (stillHeld > 0) {
    throw new Error(`${stillHeld} change${stillHeld === 1 ? " is" : "s are"} still waiting for the connection — check your internet and try again.`);
  }

  // 2) this device's unconfirmed changes, compared against what the cloud has now
  const dirty = deps.dirtyKeys();
  const keys = Array.from(dirty.keys());
  const result: SettingsPushResult = { pushed: [], keptNewerCloud: [], alreadySaved: 0 };
  if (keys.length === 0) return result;
  const cloud = await deps.fetchCloud(keys);

  const toPush: Array<{ key: string; value: unknown }> = [];
  for (const key of keys) {
    const raw = deps.localRaw(key);
    if (raw === null) {
      deps.markClean(key); // removed locally; nothing to push
      continue;
    }
    let local: unknown;
    try {
      local = JSON.parse(raw);
    } catch {
      continue; // not a JSON setting; leave it to its own writer
    }
    const row = cloud.get(key);
    if (!row) {
      toPush.push({ key, value: local });
      continue;
    }
    if (sameJson(local, row.value)) {
      deps.markClean(key);
      result.alreadySaved += 1;
      continue;
    }
    const ls = savedAtOf(local);
    const cs = savedAtOf(row.value);
    if (ls !== null && cs !== null) {
      if (ls > cs) toPush.push({ key, value: local });
      else {
        result.keptNewerCloud.push(key);
        deps.markClean(key);
      }
      continue;
    }
    const cloudMs = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN;
    const changedAt = dirty.get(key) ?? 0;
    if (!Number.isNaN(cloudMs) && cloudMs > changedAt + SKEW_MS) {
      result.keptNewerCloud.push(key); // another device saved after our change — don't clobber it
      continue;
    }
    toPush.push({ key, value: local });
  }

  for (const { key, value } of toPush) {
    await deps.upsert(key, value); // throws → caller shows the error + Retry
  }

  // 3) read back: prove the cloud now holds what we pushed
  if (toPush.length > 0) {
    const after = await deps.fetchCloud(toPush.map((p) => p.key));
    const missing = toPush.filter((p) => {
      const row = after.get(p.key);
      return !row || !sameJson(row.value, p.value);
    });
    if (missing.length > 0) {
      throw new Error(`The cloud didn't confirm ${missing.length} setting${missing.length === 1 ? "" : "s"} (${missing.map((m) => m.key.replace(/^casemate\./, "")).join(", ")}). Try again.`);
    }
    for (const p of toPush) {
      deps.markClean(p.key);
      result.pushed.push(p.key);
    }
  }
  return result;
}
