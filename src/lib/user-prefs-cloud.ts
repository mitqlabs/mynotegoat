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
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
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

async function cloudKey(): Promise<string | null> {
  if (userKey) return userKey;
  const client = getSupabaseBrowserClient();
  const { data } = (await client?.auth.getUser()) ?? { data: { user: null } };
  if (!data.user?.id) return null;
  userKey = `casemate.user-prefs.v1.u.${data.user.id}`;
  return userKey;
}

/** Fetch the cloud copy, merge with this browser's, save both, apply newer values locally. */
export async function syncUserPrefs(): Promise<void> {
  if (typeof window === "undefined") return;
  const client = getSupabaseBrowserClient();
  const workspaceId = getActiveWorkspaceIdSync();
  const key = await cloudKey();
  if (!client || !workspaceId || !key) return;
  const { data, error } = await client
    .from("workspace_kv")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.warn("[user-prefs] cloud read failed:", error.message);
    return;
  }
  const remote = mergePrefs((data?.value ?? {}) as PrefMap);
  const local = readMirror();
  const merged = mergePrefs(remote, local);
  writeMirror(merged);
  const set = rawSet ?? window.localStorage.setItem.bind(window.localStorage);
  for (const [k, e] of Object.entries(merged)) {
    if (window.localStorage.getItem(k) !== e.v && (!local[k] || e.at > local[k].at)) {
      set(k, e.v);
      notifyChange(k);
    }
  }
  if (JSON.stringify(merged) !== JSON.stringify(remote)) {
    const { error: upErr } = await client
      .from("workspace_kv")
      .upsert({ workspace_id: workspaceId, key, value: merged }, { onConflict: "workspace_id,key" });
    if (upErr) console.warn("[user-prefs] cloud save failed:", upErr.message);
  }
}

/** Called by the storage interceptor after every localStorage.setItem. */
export function recordUserPrefWrite(key: string, value: string, original: (k: string, v: string) => void) {
  rawSet = original;
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
