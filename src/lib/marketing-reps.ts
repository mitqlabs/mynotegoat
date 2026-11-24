/**
 * Marketing → "Our Rep" list. The people from our office who do marketing
 * visits (Dr. Mike, …). Managed in Settings → Marketing, offered as a
 * dropdown when logging marketing activity.
 *
 * Stored in the cloud as a list of records (id + name). The boot merge
 * (UNION_MERGE_KEYS) keeps both sides per id, newest `updatedAt` wins, and a
 * remove is a tombstone (`deleted`) — so another computer's edits are never
 * overwritten. A logged activity keeps the rep NAME as plain text
 * (MarketingActivity.repName), so removing or renaming a rep never changes or
 * loses what was already logged.
 */

import { unionMerge } from "@/lib/kv-merge";

export const MARKETING_REPS_KEY = "casemate.marketing-reps.v1";

/** The rep a new marketing entry starts with. */
export const DEFAULT_MARKETING_REP_NAME = "Dr. Mike";
const DEFAULT_REP_ID = "dr-mike";

export interface MarketingRep {
  id: string;
  name: string;
  /** Display order. */
  sort: number;
  updatedAt: string;
  deleted?: boolean;
}

export function getDefaultMarketingReps(): MarketingRep[] {
  return [{ id: DEFAULT_REP_ID, name: DEFAULT_MARKETING_REP_NAME, sort: 0, updatedAt: "" }];
}

/**
 * Cleans a stored/cloud list. Empty/invalid falls back to the seed list. The
 * built-in "Dr. Mike" is added back if it isn't in the list at all (a removed
 * one stays removed — it is a tombstone, not missing). Sorted by `sort`.
 */
export function normalizeMarketingReps(value: unknown): MarketingRep[] {
  const defaults = getDefaultMarketingReps();
  if (!Array.isArray(value)) return defaults;
  const seen = new Set<string>();
  const out: MarketingRep[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<MarketingRep>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || id.length > 100 || seen.has(id)) continue;
    const name = typeof r.name === "string" ? r.name.trim().replace(/\s+/g, " ").slice(0, 60) : "";
    if (!name) continue;
    seen.add(id);
    out.push({
      id,
      name,
      sort: typeof r.sort === "number" && Number.isFinite(r.sort) ? r.sort : out.length,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
      ...(r.deleted === true ? { deleted: true } : {}),
    });
  }
  if (out.length === 0) return defaults;
  for (const d of defaults) if (!seen.has(d.id)) out.unshift({ ...d, sort: -1 });
  return out.sort((a, b) => a.sort - b.sort).map((r, i) => ({ ...r, sort: i }));
}

/** Reps that aren't removed, in order. */
export const liveMarketingReps = (reps: MarketingRep[]) => reps.filter((r) => !r.deleted);

export function loadMarketingReps(): MarketingRep[] {
  if (typeof window === "undefined") return getDefaultMarketingReps();
  try {
    const raw = window.localStorage.getItem(MARKETING_REPS_KEY);
    return raw ? normalizeMarketingReps(JSON.parse(raw)) : getDefaultMarketingReps();
  } catch {
    return getDefaultMarketingReps();
  }
}

export function mergeMarketingReps(local: MarketingRep[], cloud: unknown): MarketingRep[] {
  return normalizeMarketingReps(unionMerge(local, Array.isArray(cloud) ? normalizeMarketingReps(cloud) : local));
}

/** Save locally, then merge with the cloud copy before writing it (never drops another device's edits). */
export async function saveMarketingReps(reps: MarketingRep[]): Promise<void> {
  if (typeof window === "undefined") return;
  const clean = normalizeMarketingReps(reps);
  try {
    window.localStorage.setItem(MARKETING_REPS_KEY, JSON.stringify(clean));
  } catch {
    // cache only; the cloud write below is the record
  }
  const kv = await import("@/lib/kv-cloud");
  const remote = await kv.fetchKvValue<unknown>(MARKETING_REPS_KEY).catch(() => null);
  const merged = remote == null ? clean : mergeMarketingReps(clean, remote);
  try {
    window.localStorage.setItem(MARKETING_REPS_KEY, JSON.stringify(merged));
  } catch {
    // cache only
  }
  await kv.dualWriteKv(MARKETING_REPS_KEY, "contacts", merged);
}

// ---- pure edits (each returns a new list with the touched rep stamped `now`) ----

const clean = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 60);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function newMarketingRepId(now: number = Date.now(), rand: number = Math.random()): string {
  return `r-${now.toString(36)}${Math.floor(rand * 1679616).toString(36).padStart(4, "0")}`;
}

function touch(reps: MarketingRep[], id: string, patch: Partial<MarketingRep>, now: string): MarketingRep[] {
  return reps.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now } : r));
}

/** Add (or bring back a removed rep with that name). Unchanged for a blank/duplicate name. */
export function addMarketingRep(reps: MarketingRep[], name: string, now: string, id: string = newMarketingRepId()): MarketingRep[] {
  const n = clean(name);
  if (!n || liveMarketingReps(reps).some((r) => same(r.name, n))) return reps;
  const dead = reps.find((r) => r.deleted && same(r.name, n));
  if (dead) return touch(reps, dead.id, { deleted: undefined, sort: reps.length }, now);
  return [...reps, { id, name: n, sort: reps.length, updatedAt: now }];
}

/** Rename keeps the id. Blank/duplicate = unchanged. Already-logged activities keep the name they were logged with. */
export function renameMarketingRep(reps: MarketingRep[], id: string, name: string, now: string): MarketingRep[] {
  const n = clean(name);
  if (!n || liveMarketingReps(reps).some((r) => r.id !== id && same(r.name, n))) return reps;
  const cur = reps.find((r) => r.id === id);
  if (!cur || cur.name === n) return reps;
  return touch(reps, id, { name: n }, now);
}

/** Remove = tombstone (so the removal survives the cloud merge). Logged activities are NOT rewritten. */
export const removeMarketingRep = (reps: MarketingRep[], id: string, now: string) =>
  touch(reps, id, { deleted: true }, now);

/** Move a rep up (-1) or down (+1) among the live reps. */
export function moveMarketingRep(reps: MarketingRep[], id: string, dir: -1 | 1, now: string): MarketingRep[] {
  const live = liveMarketingReps(reps).sort((x, y) => x.sort - y.sort);
  const i = live.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= live.length) return reps;
  const a = live[i];
  const b = live[j];
  return reps.map((r) =>
    r.id === a.id ? { ...r, sort: b.sort, updatedAt: now } : r.id === b.id ? { ...r, sort: a.sort, updatedAt: now } : r,
  );
}

/**
 * What the "Our Rep" dropdown offers. `current` is the value already saved on an
 * entry being edited: if it isn't one of the reps (old free-text, or a rep that was
 * since removed) it is added as an extra choice so it keeps showing — never lost.
 */
export function repChoices(reps: MarketingRep[], current?: string): string[] {
  const names = liveMarketingReps(reps).map((r) => r.name);
  const cur = (current ?? "").trim();
  if (cur && !names.some((n) => same(n, cur))) names.push(cur);
  return names;
}

/** The rep a NEW entry starts with: Dr. Mike when he's still in the list, else the first rep, else none. */
export function defaultRepName(reps: MarketingRep[]): string {
  const live = liveMarketingReps(reps);
  return (live.find((r) => same(r.name, DEFAULT_MARKETING_REP_NAME)) ?? live[0])?.name ?? "";
}
