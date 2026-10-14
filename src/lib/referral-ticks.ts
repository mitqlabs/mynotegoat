/**
 * Referral drill-down ticks ("done" checkboxes).
 *
 * Each tick is stored with the time it was last changed, so copies from
 * different computers can be MERGED: per tick, the newest change wins.
 * A stale copy (older cloud row, realtime echo, a fresh browser) can
 * never drop a tick that was set later somewhere else.
 */

export type TickEntry = { on: boolean; at: number };
export type TickMap = Record<string, TickEntry>;

export const REFERRAL_TICKS_LEGACY_KEY = "casemate.referral-checked.v1";
export const REFERRAL_TICKS_LOCAL_KEY = "casemate.referral-checked.v2";
/** Personal copy in workspace_kv, one row per user. */
export const referralTicksCloudKey = (userId: string) => `casemate.referral-checked.v2.u.${userId}`;

/** Accepts the v2 map or the old v1 array of keys (treated as ticked at time 0). */
export function parseTicks(value: unknown): TickMap {
  const out: TickMap = {};
  if (Array.isArray(value)) {
    for (const k of value) if (typeof k === "string" && k) out[k] = { on: true, at: 0 };
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const e = v as Partial<TickEntry> | null;
      if (e && typeof e.on === "boolean") out[k] = { on: e.on, at: Number.isFinite(e.at) ? Number(e.at) : 0 };
    }
  }
  return out;
}

/** Newest change per tick wins; on a tie, ticked wins (never lose a tick). */
export function mergeTicks(...maps: TickMap[]): TickMap {
  const out: TickMap = {};
  for (const m of maps) {
    for (const [k, e] of Object.entries(m)) {
      const cur = out[k];
      if (!cur || e.at > cur.at || (e.at === cur.at && e.on && !cur.on)) out[k] = { on: e.on, at: e.at };
    }
  }
  return out;
}

export function setTick(map: TickMap, key: string, on: boolean, now = Date.now()): TickMap {
  const prev = map[key]?.at ?? 0;
  return { ...map, [key]: { on, at: Math.max(now, prev + 1) } };
}

export function tickedKeys(map: TickMap): Set<string> {
  return new Set(Object.entries(map).filter(([, e]) => e.on).map(([k]) => k));
}

export function sameTicks(a: TickMap, b: TickMap): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] && b[k].on === a[k].on && b[k].at === a[k].at);
}

/**
 * Ticks found in the browser's safety backup (taken before a workspace
 * switch wiped local data). Returned as ticked-at-0 so any later change wins.
 */
export function ticksFromSafetyBackup(raw: string | null): TickMap {
  try {
    const snap = (JSON.parse(raw ?? "null") as { snapshot?: Record<string, unknown> } | null)?.snapshot;
    if (!snap) return {};
    const pick = (k: string) => {
      const v = snap[k];
      if (typeof v === "string") {
        try {
          return parseTicks(JSON.parse(v));
        } catch {
          return {};
        }
      }
      return parseTicks(v);
    };
    const merged = mergeTicks(pick(REFERRAL_TICKS_LEGACY_KEY), pick(REFERRAL_TICKS_LOCAL_KEY));
    // Backup ticks only ever ADD: unticks from an old backup are dropped.
    return Object.fromEntries(Object.entries(merged).filter(([, e]) => e.on).map(([k]) => [k, { on: true, at: 0 }]));
  } catch {
    return {};
  }
}
