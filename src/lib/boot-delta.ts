/**
 * Fast boot: download only what changed in the cloud since this browser's
 * last successful load, instead of every encounter note and every
 * workspace_kv value on every open.
 *
 * Measured 2026-10-26 (biggest office): ~2,900 encounter notes ≈ 135 MB of
 * JSON and ~1.7 MB of workspace_kv were downloaded and parsed before the app
 * could open, even seconds after the last visit.
 *
 * SAFETY (2026-04-08 data-loss guard): nothing here lets local data
 * overwrite the cloud. We always ask the cloud first for a tiny list of
 * (id, server updated_at) rows. Anything the cloud changed since our last
 * load, anything this device changed, anything not yet confirmed in the
 * cloud, and anything we can't prove is identical is downloaded in full and
 * goes through the SAME merge rules as before. Only rows proven identical
 * (cloud untouched since our last load AND local untouched since then) are
 * skipped. No saved cursor (new browser, cleared cache, other workspace) =
 * the old full download.
 */

/** Rows written while the last load ran can carry a slightly older now(). */
export const BOOT_DELTA_OVERLAP_MS = 10 * 60 * 1000;

export interface NoteMeta {
  id: string;
  /** Server-side updated_at (trigger-maintained). */
  updatedAt: string;
  /** The note's own updatedAt as stored in the cloud row. */
  recordUpdatedAt: string;
}

export interface LocalNoteLike {
  id: string;
  updatedAt: string;
}

export function maxIso(values: Iterable<string | null | undefined>): string | null {
  let best = Number.NaN;
  let bestIso: string | null = null;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) continue;
    if (Number.isNaN(best) || ms > best) {
      best = ms;
      bestIso = v;
    }
  }
  return bestIso;
}

/**
 * Decide which notes must be downloaded in full. Returns null when a delta
 * load is not safe (no cursor / bad cursor) — the caller does a full load.
 */
export function planNotesDelta<T extends LocalNoteLike>(args: {
  meta: NoteMeta[];
  local: T[];
  cursor: string | null;
  unconfirmedIds: Set<string>;
}): { fetchIds: string[]; standIns: T[] } | null {
  const cursorMs = args.cursor ? Date.parse(args.cursor) : Number.NaN;
  if (Number.isNaN(cursorMs)) return null;
  const since = cursorMs - BOOT_DELTA_OVERLAP_MS;
  const localById = new Map(args.local.map((n) => [n.id, n]));
  const fetchIds: string[] = [];
  const standIns: T[] = [];
  for (const m of args.meta) {
    const serverMs = Date.parse(m.updatedAt);
    const local = localById.get(m.id);
    const changedInCloud = Number.isNaN(serverMs) || serverMs >= since;
    if (changedInCloud) {
      fetchIds.push(m.id);
      continue;
    }
    if (!local) continue; // old, unchanged, not cached here: the full load would prune it too
    if (args.unconfirmedIds.has(m.id) || local.updatedAt !== m.recordUpdatedAt) {
      // This device edited it (or its save isn't confirmed): let the full
      // merge rules compare against the real cloud copy.
      fetchIds.push(m.id);
      continue;
    }
    standIns.push(local); // proven identical to the cloud copy
  }
  return { fetchIds, standIns };
}

/** Small, fast, non-crypto string hash (FNV-1a, 32 bit) for change detection. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

export interface KvStamp {
  /** Cloud row updated_at when we last applied it. */
  u: string;
  /** Hash of the local value right after we applied it. */
  h: string;
}

/**
 * Which workspace_kv keys must be downloaded. A key is skipped only when the
 * cloud row is unchanged since we last applied it AND the local value is
 * byte-identical to what we left after applying it.
 */
export function planKvDelta(args: {
  meta: Array<{ key: string; updatedAt: string | null }>;
  stamps: Record<string, KvStamp> | null;
  localRaw: (key: string) => string | null;
}): string[] {
  const out: string[] = [];
  for (const m of args.meta) {
    const stamp = args.stamps?.[m.key];
    if (!stamp || !m.updatedAt || stamp.u !== m.updatedAt) {
      out.push(m.key);
      continue;
    }
    const raw = args.localRaw(m.key);
    if (raw === null || hashString(raw) !== stamp.h) out.push(m.key);
  }
  return out;
}

// ── tiny persisted state (outside the casemate.* snapshot, per workspace) ──

const STATE_PREFIX = "notegoat.boot-delta.v1.";

export interface BootDeltaState {
  notesCursor?: string | null;
  kv?: Record<string, KvStamp>;
}

export function readBootDeltaState(workspaceId: string): BootDeltaState {
  if (typeof window === "undefined" || !workspaceId) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STATE_PREFIX + workspaceId) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as BootDeltaState) : {};
  } catch {
    return {};
  }
}

export function writeBootDeltaState(workspaceId: string, patch: BootDeltaState): void {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    const next = { ...readBootDeltaState(workspaceId), ...patch };
    window.localStorage.setItem(STATE_PREFIX + workspaceId, JSON.stringify(next));
  } catch {
    // Quota: next boot simply does a full load.
  }
}

export function clearBootDeltaState(): void {
  if (typeof window === "undefined") return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STATE_PREFIX)) window.localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
