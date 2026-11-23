"use client";

/**
 * Cloud backup for per-user preferences (sorts, column order, panel
 * state, G.O.A.T. chat, note signers…). Every write to a "user" key in
 * cloud-key-registry.ts is recorded with a timestamp and saved to the
 * user's own workspace_kv row (casemate.user-prefs.v1.u.<userId>).
 * Copies are merged per key — newest change wins — so nothing set on one
 * computer is lost by another or by a sign-out wipe.
 */
import { isMirroredUserKey } from "@/lib/cloud-key-registry";
import { notifyChange } from "@/lib/local-sync";
import { getSupabaseBrowserClient, getSessionUser } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";

export type PrefEntry = { v: string; at: number };
export type PrefMap = Record<string, PrefEntry>;

const MIRROR_KEY = "casemate.user-prefs-mirror.v1";
/** Huge values (e.g. a long chat) are skipped so one row stays small. */
const MAX_VALUE_CHARS = 200_000;

export function mergePrefs(...maps: PrefMap[]): PrefMap {
  const out: PrefMap = {};
  for (const m of maps) {
    for (const [k, e] of Object.entries(m ?? {})) {
      if (!e || typeof e.v !== "string" || !Number.isFinite(e.at)) continue;
      if (!out[k] || e.at > out[k].at) out[k] = { v: e.v, at: e.at };
    }
  }
  return out;
}

/**
 * Write a merged pref back into localStorage when the stored value is not
 * the merged one and the merged entry is at least as new as the mirror.
 *
 * Removing the real key does not clear the mirror, so the mirror can still
 * hold the same entry and timestamp. A strict "newer than the mirror" check
 * then never restores it, and the sidebar order looks unsaved.
 * Missing mirror entry, or merged.at >= mirror.at, means the key is missing
 * or stale and should be written.
 */
export function shouldRestorePref(stored: string | null, merged: PrefEntry, mirror: PrefEntry | undefined): boolean {
  if (!merged || typeof merged.v !== "string" || !Number.isFinite(merged.at)) return false;
  if (stored === merged.v) return false;
  if (!mirror || !Number.isFinite(mirror.at)) return true;
  return merged.at >= mirror.at;
}

let rawSet: ((k: string, v: string) => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let userKey: string | null = null;

function readMirror(): PrefMap {
  try {
    return mergePrefs(JSON.parse(window.localStorage.getItem(MIRROR_KEY) ?? "{}") as PrefMap);
  } catch {
    return {};
  }
}

function writeMirror(map: PrefMap) {
  const s = JSON.stringify(map);
  (rawSet ?? window.localStorage.setItem.bind(window.localStorage))(MIRROR_KEY, s);
}

/** Copy merged prefs onto the real keys. `mirror` is the pre-merge snapshot. */
export function applyUserPrefRestore(mirror: PrefMap, merged: PrefMap): void {
  if (typeof window === "undefined") return;
  const set = rawSet ?? window.localStorage.setItem.bind(window.localStorage);
  for (const [k, e] of Object.entries(merged)) {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(k);
    } catch {
      continue;
    }
    if (!shouldRestorePref(stored, e, mirror[k])) continue;
    try {
      set(k, e.v);
    } catch {
      continue;
    }
    notifyChange(k);
  }
}

async function cloudKey(): Promise<string | null> {
  if (userKey) return userKey;
  const client = getSupabaseBrowserClient();
  const { data } = (await getSessionUser(client)) ?? { data: { user: null } };
  if (!data.user?.id) return null;
  userKey = `casemate.user-prefs.v1.u.${data.user.id}`;
  return userKey;
}

let inFlight: Promise<void> | null = null;

async function syncUserPrefsOnce(): Promise<void> {
  const client = getSupabaseBrowserClient();
  const workspaceId = getActiveWorkspaceIdSync();
  const key = await cloudKey();
  let remote: PrefMap = {};
  let remoteReady = false;
  if (client && workspaceId && key) {
    try {
      const { data, error } = await client
        .from("workspace_kv")
        .select("value")
        .eq("workspace_id", workspaceId)
        .eq("key", key)
        .maybeSingle();
      if (error) console.warn("[user-prefs] cloud read failed:", error.message);
      else {
        remote = mergePrefs((data?.value ?? {}) as PrefMap);
        remoteReady = true;
      }
    } catch (err) {
      console.warn("[user-prefs] cloud read failed:", err);
    }
  }
  // A failed or skipped cloud read still restores from the mirror. Returning
  // early used to leave a wiped key empty, so the app opened on Patient List.
  const local = readMirror();
  const merged = mergePrefs(remote, local);
  writeMirror(merged);
  applyUserPrefRestore(local, merged);
  if (remoteReady && client && workspaceId && key && JSON.stringify(merged) !== JSON.stringify(remote)) {
    const { error: upErr } = await client
      .from("workspace_kv")
      .upsert({ workspace_id: workspaceId, key, value: merged }, { onConflict: "workspace_id,key" });
    if (upErr) console.warn("[user-prefs] cloud save failed:", upErr.message);
  }
}

/**
 * Fetch the cloud copy, merge with this browser's, save both, apply newer
 * values locally. Callers that overlap (the portal boot and the home page)
 * share one run, so a 10s boot cap cannot read the sidebar key before this
 * restore has written it.
 */
export function syncUserPrefs(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!inFlight) {
    inFlight = syncUserPrefsOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// Offline edits stay in the local mirror; push them as soon as we're back online.
let onlineHooked = false;
function hookOnline() {
  if (onlineHooked || typeof window === "undefined") return;
  onlineHooked = true;
  window.addEventListener("online", () => {
    void syncUserPrefs().catch((e: unknown) => console.warn("[user-prefs] sync failed:", e));
  });
}

/** Called by the storage interceptor after every localStorage.setItem. */
export function recordUserPrefWrite(key: string, value: string, original: (k: string, v: string) => void) {
  rawSet = original;
  hookOnline();
  if (!isMirroredUserKey(key) || value.length > MAX_VALUE_CHARS) return;
  const map = readMirror();
  map[key] = { v: value, at: Math.max(Date.now(), (map[key]?.at ?? 0) + 1) };
  writeMirror(map);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncUserPrefs().catch((e: unknown) => console.warn("[user-prefs] sync failed:", e)), 1500);
}

/** On sign-out the cached user id must not carry over. */
export function resetUserPrefsIdentity() {
  userKey = null;
}
